import path from "node:path";
import { OFFICIAL_DOCS_SECTIONS } from "@andon/shared-types";
import type { DocPath, DocSection, Locale } from "./types.ts";

/** Every bundled section, in reading order. Re-exported from shared-types. */
export const DOC_SECTIONS: readonly DocSection[] = OFFICIAL_DOCS_SECTIONS;

const SECTIONS = new Set<DocSection>(DOC_SECTIONS);

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "ja";
}

export function isDocSection(value: string): value is DocSection {
  return SECTIONS.has(value as DocSection);
}

/**
 * Where a section's pages live inside an upstream aidlc-workflows `docs/` tree.
 *
 * Four sections are directories that mirror one-to-one. `overview` is the
 * exception: upstream keeps its pages loose in the docs root, so its source is
 * that root read NON-recursively — a recursive read there would swallow every
 * other section and mirror each page twice, once under its own name and once
 * under `overview/`.
 */
export function upstreamSectionSource(section: DocSection): {
  relDir: string;
  recursive: boolean;
} {
  return section === "overview"
    ? { relDir: ".", recursive: false }
    : { relDir: section, recursive: true };
}

/**
 * Split a public DocPath into section + file relative to the locale content root.
 * Returns null when the path is not a well-formed `<section>/…` DocPath.
 */
export function parseDocPath(
  raw: string,
): { section: DocSection; relFile: string; docPath: DocPath } | null {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (normalized === "" || normalized.includes("\0")) return null;

  const slash = normalized.indexOf("/");
  if (slash <= 0) return null;

  const section = normalized.slice(0, slash);
  if (!isDocSection(section)) return null;

  const relFile = normalized.slice(slash + 1);
  if (relFile === "" || relFile.endsWith("/")) return null;

  return { section, relFile, docPath: `${section}/${relFile}` };
}

/** Absolute locale content root: `docs/<section>/<locale>/`. */
export function localeContentRoot(
  workspaceRoot: string,
  section: DocSection,
  locale: Locale,
): string {
  return path.resolve(workspaceRoot, "docs", section, locale);
}

/** Absolute `docs/` directory used as guard root for the manifest file. */
export function docsRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, "docs");
}
