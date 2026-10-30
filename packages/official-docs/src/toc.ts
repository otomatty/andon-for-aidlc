import { readdir } from "node:fs/promises";
import path from "node:path";
import { guardPath, readBounded, withResult } from "@andon/core-utils";
import type { ReadResult } from "@andon/shared-types";
import { folderLabel } from "./folder-labels.ts";
import { extractTitle } from "./markdown.ts";
import { DOC_SECTIONS, isLocale, localeContentRoot } from "./roots.ts";
import type { DocPath, DocSection, Locale, TocNode, TocTree } from "./types.ts";

/**
 * Every markdown file under a locale content root, as POSIX paths relative to
 * it, in `readdir` order. Dot-entries and anything `guardPath` rejects are
 * dropped rather than surfaced as an error.
 */
async function listMarkdownRel(contentRoot: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return;
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (entry.name.startsWith(".")) continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const guarded = await guardPath(contentRoot, rel);
      if (!("ok" in guarded)) continue;
      out.push(rel.replace(/\\/g, "/"));
    }
  }

  await walk(contentRoot, "");
  return out;
}

/**
 * Title of one page in the requested locale: its own `# ` heading, else the en
 * heading, else the file's basename — so a sparse locale still names its rows.
 */
function titleFor(relFile: string, titles: ReadonlyMap<string, string>): string {
  return titles.get(relFile) ?? path.basename(relFile, ".md");
}

/** En headings for the given files, the fallback layer behind `titleFor`. */
async function loadEnTitles(
  workspaceRoot: string,
  section: DocSection,
  relFiles: string[],
  locale: Locale = "en",
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const contentRoot = localeContentRoot(workspaceRoot, section, locale);
  for (let offset = 0; offset < relFiles.length; offset += 16) {
    await Promise.all(
      relFiles.slice(offset, offset + 16).map(async (rel) => {
        const guarded = await guardPath(contentRoot, rel);
        if (!("ok" in guarded)) return;
        const bounded = await readBounded(guarded.value);
        if (!bounded.ok) return;
        const title = extractTitle(bounded.value);
        if (title !== undefined) map.set(rel, title);
      }),
    );
  }
  return map;
}

/**
 * Mutable build node: one directory of the section tree.
 *
 * `readme` is the directory's own `README.md` — it names the folder rather than
 * appearing as a child row, so a category heading is also the link to its
 * overview page.
 */
interface DirBuild {
  /** Dir path relative to the locale content root; `""` for the section root. */
  relDir: string;
  /** Rel paths of markdown files directly in this dir, `README.md` excluded. */
  files: string[];
  readme: string | null;
  dirs: Map<string, DirBuild>;
}

/** A directory node with nothing in it yet. */
function emptyDir(relDir: string): DirBuild {
  return { relDir, files: [], readme: null, dirs: new Map() };
}

/** Place one rel markdown path into the directory tree, creating dirs as needed. */
function insertRel(root: DirBuild, rel: string): void {
  const parts = rel.split("/");
  const fileName = parts[parts.length - 1] ?? rel;
  let node = root;
  for (const segment of parts.slice(0, -1)) {
    const relDir = node.relDir === "" ? segment : `${node.relDir}/${segment}`;
    let next = node.dirs.get(segment);
    if (next === undefined) {
      next = emptyDir(relDir);
      node.dirs.set(segment, next);
    }
    node = next;
  }
  // A section-root README has no folder to name, so it stays a normal row.
  if (node !== root && fileName === "README.md") {
    node.readme = rel;
    return;
  }
  node.files.push(rel);
}

interface NodeCtx {
  workspaceRoot: string;
  section: DocSection;
  locale: Locale;
  enTitles: Map<string, string>;
}

/** Files first, then sub-directories — both alphabetical, so the nav is stable. */
async function buildNodes(ctx: NodeCtx, dir: DirBuild): Promise<TocNode[]> {
  const nodes: TocNode[] = [];

  for (const rel of [...dir.files].sort((a, b) => a.localeCompare(b))) {
    const docPath: DocPath = `${ctx.section}/${rel}`;
    nodes.push({
      id: docPath,
      title: titleFor(rel, ctx.enTitles),
      path: docPath,
      children: [],
    });
  }

  const subDirs = [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, sub] of subDirs) {
    const children = await buildNodes(ctx, sub);
    const id = `${ctx.section}/${sub.relDir}`;
    if (sub.readme === null) {
      // No overview page: a plain category label, not a clickable row.
      nodes.push({
        id,
        title: folderLabel(ctx.section, sub.relDir, ctx.locale),
        children,
      });
      continue;
    }
    const readmePath: DocPath = `${ctx.section}/${sub.readme}`;
    nodes.push({
      id,
      title: titleFor(sub.readme, ctx.enTitles),
      path: readmePath,
      children,
    });
  }

  return nodes;
}

/**
 * Build the TOC tree for one section, nested by the on-disk directory layout.
 * En structure is authoritative when the requested locale is sparse (F2).
 */
async function sectionToc(
  workspaceRoot: string,
  section: DocSection,
  locale: Locale,
): Promise<TocNode[]> {
  const enRoot = localeContentRoot(workspaceRoot, section, "en");
  const localeRoot = localeContentRoot(workspaceRoot, section, locale);

  const enFiles = await listMarkdownRel(enRoot);
  const localeFiles = locale === "en" ? enFiles : await listMarkdownRel(localeRoot);

  // Prefer en inventory; union any locale-only pages.
  const ordered = [...enFiles];
  for (const rel of localeFiles) {
    if (!ordered.includes(rel)) ordered.push(rel);
  }

  const enTitles = await loadEnTitles(workspaceRoot, section, ordered);
  if (locale !== "en") {
    const translated = await loadEnTitles(workspaceRoot, section, localeFiles, locale);
    for (const [rel, title] of translated) enTitles.set(rel, title);
  }

  const root = emptyDir("");
  for (const rel of ordered) insertRel(root, rel);

  return buildNodes({ workspaceRoot, section, locale, enTitles }, root);
}

/**
 * Scan every bundled section for a locale (F2).
 *
 * Driven by `DOC_SECTIONS`, so a new section needs no change here. A section
 * with nothing on disk yields an empty array rather than being omitted: the
 * Shell nav decides what to show from the arrays, and an absent key would be a
 * different shape for callers to handle.
 */
export async function listToc(
  workspaceRoot: string,
  locale: Locale | (string & {}),
): Promise<ReadResult<TocTree>> {
  return withResult(async () => {
    if (!isLocale(locale)) {
      return { error: true, reason: "path_rejected" };
    }

    const trees = await Promise.all(
      DOC_SECTIONS.map(
        async (section) => [section, await sectionToc(workspaceRoot, section, locale)] as const,
      ),
    );

    return {
      ok: true,
      value: Object.fromEntries(trees) as TocTree,
    };
  });
}
