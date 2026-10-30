/**
 * Upstream vs packaged-snapshot diff for official docs (US-08 / FR-U6).
 *
 * Layout contract:
 * - Upstream (aidlc-workflows checkout): every section of `docs/`, resolved by
 *   `upstreamSectionSource` — the four section directories recursively, plus
 *   the loose files in the docs root that make up `overview` (English source;
 *   no locale segment).
 * - Snapshot (this repo): `docs/<section>/en/**` plus optional
 *   `docs/<section>/ja/**` for translation follow-up.
 * - Keys are public DocPaths: `<section>/…`.
 *
 * Report format: Markdown suitable as translate-PR input (see `formatDiffReport`).
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { canonicalPathSync } from "@andon/core-utils";
import { readChangelogPages } from "./changelog.ts";
import { DOC_SECTIONS, upstreamSectionSource } from "./roots.ts";
import type { DocPath, DocSection, Manifest } from "./types.ts";

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface DiffEntry {
  path: DocPath;
  status: DiffStatus;
  /** Whether `docs/<section>/ja/<rel>` exists in the snapshot workspace. */
  jaPresent: boolean;
}

export interface DiffReport {
  generatedAt: string;
  workspaceRoot: string;
  upstreamRoot: string;
  /** Optional display labels (e.g. repo-relative) for Markdown headers. */
  workspaceLabel?: string;
  upstreamLabel?: string;
  snapshotManifest: Manifest | null;
  entries: DiffEntry[];
  counts: Record<DiffStatus, number>;
}

export interface BuildDiffReportInput {
  workspaceRoot: string;
  /** Absolute path to an aidlc-workflows checkout (or any tree with docs/guide or docs/reference). */
  upstreamRoot: string;
  /** Override clock for tests. */
  now?: Date;
  workspaceLabel?: string;
  upstreamLabel?: string;
}

/** C0 controls plus DEL -- never part of a legitimate documentation path. */
// oxlint-disable-next-line no-control-regex -- matching them is the point.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

const SKIP_NAMES = new Set([".gitkeep", ".DS_Store"]);

function isSkippedName(name: string): boolean {
  return SKIP_NAMES.has(name) || name.startsWith(".");
}

/**
 * Walk a content root; return map of relative POSIX paths → sha256 hex.
 *
 * `recursive: false` reads only the files sitting directly in the root — what
 * the `overview` section needs, since its root IS upstream's docs root and
 * descending would swallow every other section.
 */
export function walkContentFiles(
  contentRoot: string,
  options: { recursive?: boolean } = {},
): Map<string, string> {
  const recursive = options.recursive ?? true;
  const out = new Map<string, string>();
  if (!existsSync(contentRoot)) return out;
  // The root itself, not just its entries: readdirSync follows a symlinked
  // root and would enumerate a tree the caller never named. Refusing loudly
  // beats returning an empty map, which a diff reads as "upstream deleted
  // everything" and turns into a mass deletion.
  if (lstatSync(contentRoot).isSymbolicLink()) {
    throw new Error(`Content root must not be a symlink: ${contentRoot}`);
  }

  const stack: string[] = [contentRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (isSkippedName(name)) continue;
      const abs = path.join(dir, name);
      // lstat, not stat: a symlink must never be followed. The upstream tree is
      // an external repository, and a Markdown-named symlink pointing at
      // something like the runner checkout's .git/config would otherwise be
      // hashed here and copied into the sync PR as a document. A symlink is
      // neither isFile() nor isDirectory() under lstat, so it is skipped by
      // both branches below and directory symlinks cannot escape the root.
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (recursive) stack.push(abs);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = path.relative(contentRoot, abs).split(path.sep).join("/");
      // A control character in a docs filename is not a page name: Git permits
      // it, and it survives into the Markdown report and the PR body, where a
      // newline ends the list item and lets the rest of the path render as a
      // heading, a checkbox or a link that misleads the reviewer. Refuse the
      // tree rather than mirror it.
      if (CONTROL_CHAR_RE.test(rel)) {
        throw new Error(`Content path contains a control character: ${JSON.stringify(rel)}`);
      }
      if (rel === "") continue;
      const body = readFileSync(abs);
      out.set(rel, createHash("sha256").update(body).digest("hex"));
    }
  }
  return out;
}

function readSnapshotManifest(workspaceRoot: string): Manifest | null {
  const abs = path.join(workspaceRoot, "docs", "official-docs.manifest.json");
  if (!existsSync(abs)) return null;
  try {
    const raw = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
    const sourceVersion = raw.sourceVersion;
    const source = raw.source;
    const capturedAt = raw.capturedAt;
    if (
      typeof sourceVersion !== "string" ||
      sourceVersion.trim() === "" ||
      typeof source !== "string" ||
      source.trim() === "" ||
      typeof capturedAt !== "string" ||
      capturedAt.trim() === ""
    ) {
      return null;
    }
    return {
      sourceVersion: sourceVersion.trim(),
      source: source.trim(),
      capturedAt: capturedAt.trim(),
    };
  } catch {
    return null;
  }
}

function jaExists(workspaceRoot: string, section: DocSection, relFile: string): boolean {
  return existsSync(path.join(workspaceRoot, "docs", section, "ja", relFile));
}

function isDir(abs: string): boolean {
  try {
    return lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve upstream docs root: prefer `<upstream>/docs`, else treat upstream as the docs root
 * when it already contains `guide/` and/or `reference/`.
 */
/**
 * The docs root must really live inside the checkout. lstat only refuses a
 * symlink as the FINAL component, so a `docs -> /etc` committed upstream would
 * still resolve `docs/guide` to a real directory and hand the walker a tree
 * outside the repository. Comparing realpaths catches a symlink anywhere in
 * the chain with one check.
 */
export function assertWithin(root: string, candidate: string): void {
  if (!existsSync(candidate)) return;
  const realRoot = canonicalPathSync(root);
  const realCandidate = canonicalPathSync(candidate);
  // path.relative, not a `realRoot + sep` prefix test: when root is a
  // filesystem root (`/`, `C:\`) that concatenation doubles the separator and
  // rejects every path inside it. Relative "" means the root itself; a leading
  // `..` segment or an absolute result means outside. `..` must be a whole
  // segment -- a sibling directory literally named `..foo` is inside.
  const rel = path.relative(realRoot, realCandidate);
  const escapes = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (escapes) {
    throw new Error(`Content root escapes its tree: ${candidate} -> ${realCandidate}`);
  }
}

export function resolveUpstreamDocsRoot(upstreamRoot: string): string {
  const nested = path.join(upstreamRoot, "docs");
  if (isDir(path.join(nested, "guide")) || isDir(path.join(nested, "reference"))) {
    assertWithin(upstreamRoot, nested);
    return nested;
  }
  if (isDir(path.join(upstreamRoot, "guide")) || isDir(path.join(upstreamRoot, "reference"))) {
    return upstreamRoot;
  }
  throw new Error(`Upstream docs root must contain guide/ or reference/: ${upstreamRoot}`);
}

function emptyCounts(): Record<DiffStatus, number> {
  return { added: 0, removed: 0, modified: 0, unchanged: 0 };
}

export function buildDiffReport(input: BuildDiffReportInput): DiffReport {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const upstreamRoot = path.resolve(input.upstreamRoot);
  const upstreamDocs = resolveUpstreamDocsRoot(upstreamRoot);

  const upstream = new Map<DocPath, string>();
  const snapshot = new Map<DocPath, string>();

  for (const section of DOC_SECTIONS) {
    // walkContentFiles refuses a symlinked root, but lstat only judges the FINAL
    // component: `docs/guide` symlinked at an external tree with a real
    // `docs/guide/en` inside it would still be walked. Containment is checked
    // here, where each root's tree is known, and covers the whole ancestor
    // chain in one realpath comparison.
    const source = upstreamSectionSource(section);
    const upstreamSection = path.join(upstreamDocs, source.relDir);
    assertWithin(upstreamRoot, upstreamSection);
    const upFiles = walkContentFiles(upstreamSection, { recursive: source.recursive });
    for (const [rel, hash] of upFiles) {
      upstream.set(`${section}/${rel}`, hash);
    }
    const snapshotSection = path.join(workspaceRoot, "docs", section, "en");
    assertWithin(workspaceRoot, snapshotSection);
    const snapFiles = walkContentFiles(snapshotSection);
    for (const [rel, hash] of snapFiles) {
      snapshot.set(`${section}/${rel}`, hash);
    }
  }

  for (const [docPath, body] of readChangelogPages(upstreamRoot)) {
    if (upstream.has(docPath))
      throw new Error(`Changelog page collides with upstream docs: ${docPath}`);
    upstream.set(docPath, createHash("sha256").update(body).digest("hex"));
  }

  const allPaths = new Set<DocPath>([...upstream.keys(), ...snapshot.keys()]);
  const sorted = [...allPaths].sort((a, b) => a.localeCompare(b));
  const counts = emptyCounts();
  const entries: DiffEntry[] = [];

  for (const docPath of sorted) {
    const upHash = upstream.get(docPath);
    const snapHash = snapshot.get(docPath);
    let status: DiffStatus;
    if (upHash === undefined) status = "removed";
    else if (snapHash === undefined) status = "added";
    else if (upHash === snapHash) status = "unchanged";
    else status = "modified";

    const slash = docPath.indexOf("/");
    const section = docPath.slice(0, slash) as DocSection;
    const relFile = docPath.slice(slash + 1);
    const jaPresent = jaExists(workspaceRoot, section, relFile);

    counts[status] += 1;
    entries.push({ path: docPath, status, jaPresent });
  }

  const now = input.now ?? new Date();
  return {
    generatedAt: now.toISOString(),
    workspaceRoot,
    upstreamRoot,
    workspaceLabel: input.workspaceLabel,
    upstreamLabel: input.upstreamLabel,
    snapshotManifest: readSnapshotManifest(workspaceRoot),
    entries,
    counts,
  };
}

/**
 * CommonMark inline code around untrusted text. A path may legitimately contain
 * a backtick, which would otherwise close the span and let the remainder render
 * as Markdown; the fence has to be longer than the longest run inside it, and
 * content touching a backtick at either end needs a space of padding.
 */
export function inlineCode(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(...runs.map((run) => run.length), 0) + 1);
  const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

function jaNote(entry: DiffEntry): string {
  if (entry.status === "removed") {
    return entry.jaPresent ? "ja present (orphan translation?)" : "ja absent";
  }
  if (entry.status === "unchanged") {
    return entry.jaPresent ? "ja present" : "ja missing";
  }
  // added | modified — primary translate-PR signal
  return entry.jaPresent ? "ja present — review for refresh" : "ja missing — needs translation";
}

/**
 * Markdown report pinned for Bolt 5 / US-08.
 * Usable as translate-PR body or attached checklist input.
 */
export function formatDiffReport(report: DiffReport): string {
  const { counts } = report;
  const workspaceShown = report.workspaceLabel ?? report.workspaceRoot;
  const upstreamShown = report.upstreamLabel ?? report.upstreamRoot;
  const lines: string[] = [
    "# Official docs diff report",
    "",
    `- generatedAt: \`${report.generatedAt}\``,
    `- workspace: \`${workspaceShown}\``,
    `- upstream: \`${upstreamShown}\``,
  ];

  if (report.snapshotManifest) {
    const m = report.snapshotManifest;
    lines.push(
      `- snapshotManifest: source=\`${m.source}\` sourceVersion=\`${m.sourceVersion}\` capturedAt=\`${m.capturedAt}\``,
    );
  } else {
    lines.push("- snapshotManifest: _(missing or invalid)_");
  }

  lines.push(
    "",
    "## Summary",
    "",
    "| Status | Count |",
    "|--------|------:|",
    `| added | ${counts.added} |`,
    `| removed | ${counts.removed} |`,
    `| modified | ${counts.modified} |`,
    `| unchanged | ${counts.unchanged} |`,
    "",
  );

  const byStatus = (status: DiffStatus): DiffEntry[] =>
    report.entries.filter((e) => e.status === status);

  const renderList = (title: string, status: DiffStatus, emptyNote: string): void => {
    lines.push(`## ${title}`, "");
    const list = byStatus(status);
    if (list.length === 0) {
      lines.push(emptyNote, "");
      return;
    }
    for (const entry of list) {
      lines.push(`- ${inlineCode(entry.path)} — ${jaNote(entry)}`);
    }
    lines.push("");
  };

  renderList("Added (in upstream, not in snapshot en)", "added", "_None._");
  renderList("Removed (in snapshot en, not in upstream)", "removed", "_None._");
  renderList("Modified (content hash differs)", "modified", "_None._");

  lines.push(
    "## Unchanged",
    "",
    counts.unchanged === 0
      ? "_None._"
      : `${counts.unchanged} file(s) identical between upstream and snapshot \`en\`.`,
    "",
    "## Translate-PR checklist",
    "",
    "- [ ] Review **added** and **modified** English pages above",
    "- [ ] Add or refresh `docs/<section>/ja/**` counterparts (US-07)",
    "- [ ] Bump `docs/official-docs.manifest.json` `sourceVersion` / `capturedAt` when snapshot is updated",
    "- [ ] Keep runtime offline — do not add fetch of upstream into the extension (NFR-1)",
    "",
  );

  return `${lines.join("\n")}`;
}
