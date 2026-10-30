/**
 * Domain types for `@andon/official-docs`.
 *
 * DocPath convention (public API): POSIX path relative to `docs/`, always
 * prefixed with a section name — e.g. `guide/getting-started.md`,
 * `reference/scopes.md`, `harness-engineering/00-overview.md`. Locale is never
 * embedded in DocPath; it is a separate argument. On disk the file lives at
 * `docs/<section>/<locale>/<rest-of-DocPath>`.
 *
 * `overview/…` is the one section whose name is not an upstream directory: its
 * pages are the loose files in upstream's docs root, so `overview/README.md`
 * mirrors `docs/README.md`. See {@link OFFICIAL_DOCS_SECTIONS}.
 */

import type { OfficialDocsSection } from "@andon/shared-types";

export type Locale = "en" | "ja";

/** One bundled section — the list lives in shared-types (dashboard needs it). */
export type DocSection = OfficialDocsSection;

/** Public doc path: `<section>/…` (see file header). */
export type DocPath = string;

export type AnchorApplied = "scrolled" | "top" | "none";

export type PageNotice = "missing_ja";

export interface Manifest {
  sourceVersion: string;
  source: string;
  capturedAt: string;
}

export interface ResolvedPage {
  localeRequested: Locale;
  localeServed: Locale;
  path: DocPath;
  bodyMarkdown: string;
  title?: string;
  notice?: PageNotice;
  sourceVersion: string;
  anchorApplied: AnchorApplied;
}

export interface TocNode {
  /** Stable key: the DocPath for a page, the dir path for a category node. */
  id: string;
  title: string;
  /**
   * Page this row opens. Absent on a category node for a directory that has no
   * `README.md` — that row is a label, not a link.
   */
  path?: DocPath;
  children: TocNode[];
}

/** One TOC tree per section, for one locale. Empty sections stay present. */
export type TocTree = Record<DocSection, TocNode[]>;

export interface StageDocRef {
  path: DocPath;
  anchor?: string;
}

export interface ResolvePageInput {
  workspaceRoot: string;
  /** Must be `en` | `ja` at runtime; invalid values → `path_rejected`. */
  locale: Locale | (string & {});
  path: DocPath;
  anchor?: string;
}

/** Result reasons used by this package (component-methods.md). */
export type OfficialDocsReason = "not_found" | "path_rejected" | "empty_content";
