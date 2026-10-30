import type {
  CustomizationChange,
  CustomizationDiagnostic,
  CustomizationKind,
} from "./customization.ts";

export type DocsQaTool = "claude" | "cursor" | "copilot";

/** What a chat turn does: explain the bundled docs, or propose customization changes. */
export type DocsQaMode = "docs" | "customize";

export interface DocsQaTarget {
  kind: "official" | "guide";
  /** Locale-neutral official path, or a guides catalog filename. */
  path: string;
  locale: "en" | "ja";
}

export interface DocsQaCitation {
  /** Number used by the answer, e.g. "1" in [1]. */
  id: string;
  sourceId: string;
  target: DocsQaTarget;
  title: string;
  headings: string[];
  version: string;
  hash: string;
  startLine: number;
  endLine: number;
  quote: string;
  /** Column headings for a table-row quote; not part of the highlighted row range. */
  context?: string;
}

export interface DocsQaRequest {
  question: string;
  tool: DocsQaTool;
  locale: "en" | "ja";
  /** Omitted means "docs". */
  mode?: DocsQaMode;
  target?: DocsQaTarget;
  /** The space a customize turn reads and proposes changes for; omitted: the active one. */
  spaceId?: string;
  history?: Array<{ question: string; answer: string }>;
}

export interface DocsQaToolStatus {
  tool: DocsQaTool;
  label: string;
  available: boolean;
  detail?: string;
}

export type DocsQaPhase =
  | "searching"
  | "reading"
  | "answering"
  | "completed"
  | "cancelled"
  | "error";

export interface DocsQaJob {
  id: string;
  question: string;
  tool: DocsQaTool;
  locale?: "en" | "ja";
  /** Omitted means "docs". */
  mode?: DocsQaMode;
  target?: DocsQaTarget;
  phase: DocsQaPhase;
  answer: string;
  citations: DocsQaCitation[];
  /** Related sources remain available when an answer could not be grounded. */
  sourcesKind?: "citations" | "related";
  /** A customize turn's changes. Nothing is written until the reader applies them. */
  proposal?: CustomizationProposal;
  error?: string;
  createdAt: number;
}

/** One proposed item change, with the text before and after for review. */
export interface CustomizationProposalEntry {
  operation: "create" | "replace" | "remove";
  itemId: string;
  kind: CustomizationKind;
  title: string;
  /** Where the item lives: its file, or its rule layer and heading. */
  location: string;
  before?: string;
  after?: string;
}

/**
 * Changes an AI proposed in a customize turn, checked against the catalog it
 * read. Applying sends `changes` through the regular customization save.
 */
export interface CustomizationProposal {
  spaceId: string;
  configurationRevision: string;
  changes: CustomizationChange[];
  entries: CustomizationProposalEntry[];
  diagnostics: CustomizationDiagnostic[];
  /** False when the engine cannot save, or a check found an error. */
  canApply: boolean;
  /** Why the proposal cannot be applied as is. */
  reason?: string;
}

export interface DocsQaEvidence {
  target: DocsQaTarget;
  title: string;
  markdown: string;
  hash: string;
  /** False means the source changed after this answer was generated. */
  matches: boolean;
}

export type DocsQaResult<T> = { ok: true; value: T } | { error: true; reason: string };
