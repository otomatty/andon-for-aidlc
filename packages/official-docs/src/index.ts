/**
 * `@aidlc-guide/official-docs` — locale-scoped load/resolve for bundled
 * aidlc-workflows docs under `docs/<section>/<locale>/`.
 *
 * Public DocPath convention: `guide/getting-started.md`,
 * `reference/scopes.md`, `harness-engineering/00-overview.md`
 * (relative to `docs/`, never includes locale).
 *
 * Dashboard must not import this package (structural ban — consumers are
 * api-core / docs-shell). No network I/O (BR-OD-9).
 */

export const OFFICIAL_DOCS_MANIFEST_REL = "docs/official-docs.manifest.json";

export { bundledDocsRoot } from "./bundled-root.ts";
export type { BuildDiffReportInput, DiffEntry, DiffReport, DiffStatus } from "./diff-report.ts";
export {
  buildDiffReport,
  formatDiffReport,
  resolveUpstreamDocsRoot,
  walkContentFiles,
} from "./diff-report.ts";
export { readManifest } from "./manifest.ts";
export { extractTitle, headingExists, slugifyHeading } from "./markdown.ts";
export { readQuestionEvidence, retrieveQuestionContext } from "./question-context.ts";
export { resolvePage } from "./resolve.ts";
export { createDocsLibrary, serializeDocsReply } from "./retrieval.ts";
export type {
  DocsFailure,
  DocsReadInput,
  DocsReadReply,
  DocsSearchInput,
  DocsSearchReply,
} from "./retrieval-types.ts";
export {
  DOC_SECTIONS,
  isDocSection,
  isLocale,
  localeContentRoot,
  parseDocPath,
  upstreamSectionSource,
} from "./roots.ts";
export { MAPPED_STAGE_SLUGS, mapStageToDoc } from "./stage-map.ts";
export { listToc } from "./toc.ts";
export type {
  AnchorApplied,
  DocPath,
  DocSection,
  Locale,
  Manifest,
  OfficialDocsReason,
  PageNotice,
  ResolvedPage,
  ResolvePageInput,
  StageDocRef,
  TocNode,
  TocTree,
} from "./types.ts";
