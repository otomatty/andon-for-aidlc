import { readdir } from "node:fs/promises";
import path from "node:path";
import { guardPath, readBounded } from "@andon/core-utils";
import { extractTitle } from "./markdown.ts";
import { contentHash, indexSections } from "./retrieval-markdown.ts";
import {
  type DocsIndex,
  INDEX_VERSION,
  type IndexedPage,
  type TranslationApprovals,
} from "./retrieval-types.ts";
import { DOC_SECTIONS, localeContentRoot } from "./roots.ts";
import type { Locale } from "./types.ts";

export const LOCAL_GUIDES = new Set([
  "guide/getting-started.md",
  "reference/scopes.md",
  "overview/release-highlights.md",
]);

/** Read bounded text only after resolving the path inside its allowed documentation root. */
export async function readGuarded(root: string, rel: string): Promise<string> {
  const guarded = await guardPath(root, rel);
  if (!("ok" in guarded)) throw new Error("path_rejected");
  const read = await readBounded(guarded.value);
  if (!read.ok) throw new Error(`Cannot read documentation: ${rel}`);
  return read.value;
}

/** Enumerate Markdown deterministically, ignoring hidden entries and symlinks; absent roots are empty. */
async function markdownFiles(root: string, rel = ""): Promise<string[]> {
  const guarded = await guardPath(root, rel);
  if (!("ok" in guarded)) throw new Error("path_rejected");
  const entries = await readdir(guarded.value, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".")) continue;
    const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await markdownFiles(root, next)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(next);
    // Symlinks are never added to the inventory.
  }
  return files;
}

/** Build-time only. The runtime reads this index, it never writes or scans the corpus. */
export async function buildDocsIndex(
  root: string,
  approvals: TranslationApprovals = {},
): Promise<DocsIndex> {
  const manifestText = await readGuarded(path.join(root, "docs"), "official-docs.manifest.json");
  const manifest = JSON.parse(manifestText) as { sourceVersion?: string; upstreamSha?: string };
  const upstreamSha = manifest.upstreamSha;
  if (
    !manifest.sourceVersion ||
    typeof upstreamSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(upstreamSha)
  ) {
    throw new Error("Documentation manifest needs sourceVersion and a full upstreamSha");
  }
  const pages: IndexedPage[] = [];
  for (const section of DOC_SECTIONS) {
    for (const locale of ["en", "ja"] satisfies Locale[]) {
      const contentRoot = localeContentRoot(root, section, locale);
      for (const rel of await markdownFiles(contentRoot)) {
        const docPath = `${section}/${rel}`;
        const text = await readGuarded(contentRoot, rel);
        const hash = contentHash(text);
        const original = pages.find((page) => page.path === docPath && page.locale === "en");
        if (locale === "ja" && original === undefined) continue;
        const approval = approvals[docPath];
        const translation =
          locale === "en"
            ? "original"
            : approval === undefined
              ? "unverified"
              : approval.enHash === original?.hash && approval.jaHash === hash
                ? "verified"
                : "stale";
        pages.push({
          path: docPath,
          locale,
          hash,
          translation,
          title: extractTitle(text) ?? rel,
          kind:
            docPath.startsWith("overview/releases/") || docPath === "overview/changelog.md"
              ? "release-note"
              : section === "rfcs"
                ? "proposal"
                : /(^|\/)research\//.test(docPath)
                  ? "research"
                  : LOCAL_GUIDES.has(docPath)
                    ? "local-guide"
                    : "documentation",
          sections: indexSections(text, `${locale}:${docPath}:${hash.slice(0, 12)}`),
        });
      }
    }
  }
  return {
    schemaVersion: INDEX_VERSION,
    sourceVersion: manifest.sourceVersion,
    upstreamSha,
    manifestHash: contentHash(manifestText),
    pages,
  };
}
