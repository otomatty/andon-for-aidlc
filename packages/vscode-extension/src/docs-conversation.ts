import type { DocsQaCitation, DocsQaTarget } from "@andon/shared-types";
import type { ExtensionContext } from "vscode";

/** Persist docs Q&A conversation (turns + draft) in the extension host via globalState. */
export const DOCS_CONVERSATION_KEY = "andon.docsConversation";

export interface DocsConversationTurn {
  id: string;
  question: string;
  answer: string;
  citations: DocsQaCitation[];
  locale?: "en" | "ja";
  target?: DocsQaTarget;
}

export interface DocsConversationState {
  turns: DocsConversationTurn[];
  draft: string;
}

const EMPTY: DocsConversationState = { turns: [], draft: "" };

function isCitation(value: unknown): value is DocsQaCitation {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.sourceId === "string";
}

function isLocale(value: unknown): value is "en" | "ja" {
  return value === "en" || value === "ja";
}

function isTarget(value: unknown): value is DocsQaTarget {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    (row.kind === "official" || row.kind === "guide") &&
    typeof row.path === "string" &&
    isLocale(row.locale)
  );
}

function isTurn(value: unknown): value is DocsConversationTurn {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.question === "string" &&
    typeof row.answer === "string" &&
    Array.isArray(row.citations) &&
    row.citations.every(isCitation) &&
    (row.locale === undefined || isLocale(row.locale)) &&
    (row.target === undefined || isTarget(row.target))
  );
}

/** Keep only well-formed turns; anything else becomes an empty thread. */
export function parseDocsConversation(value: unknown): DocsConversationState {
  if (typeof value !== "object" || value === null) return EMPTY;
  const row = value as Record<string, unknown>;
  const draft = typeof row.draft === "string" ? row.draft : "";
  const turns = Array.isArray(row.turns) ? row.turns.filter(isTurn) : [];
  return { turns, draft };
}

/** Load the saved conversation; corrupt or missing storage yields an empty thread. */
export function loadDocsConversation(
  context: Pick<ExtensionContext, "globalState">,
): DocsConversationState {
  return parseDocsConversation(context.globalState.get(DOCS_CONVERSATION_KEY));
}

/** Persist turns and draft to globalState only (never workspace files). */
export async function saveDocsConversation(
  context: Pick<ExtensionContext, "globalState">,
  state: DocsConversationState,
): Promise<void> {
  const payload: DocsConversationState = {
    turns: state.turns.map((turn) => ({
      id: turn.id,
      question: turn.question,
      answer: turn.answer,
      citations: structuredClone(turn.citations),
      ...(turn.locale ? { locale: turn.locale } : {}),
      ...(turn.target
        ? { target: { kind: turn.target.kind, path: turn.target.path, locale: turn.target.locale } }
        : {}),
    })),
    draft: state.draft,
  };
  await context.globalState.update(DOCS_CONVERSATION_KEY, payload);
}
