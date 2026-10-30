import type { CustomizationProposal } from "@andon/shared-types";

export const DOCS_QA_HISTORY_LIMIT = 8;
/** Matches the per-answer ceiling `parseQuestion` accepts in api-core. */
export const DOCS_QA_HISTORY_ANSWER_MAX = 16000;

type HistoryTurn = {
  id?: string;
  phase: string;
  question: string;
  answer: string;
  proposal?: CustomizationProposal;
};

/** How applying a proposal went, as the model is told it. */
export type ProposalOutcome = "applying" | "applied" | "failed" | undefined;

const OUTCOMES: Record<NonNullable<ProposalOutcome> | "pending", string> = {
  pending: "not applied",
  applying: "being applied",
  applied: "applied",
  failed: "apply failed",
};

/**
 * The proposal a turn showed, written into its answer so a follow-up
 * ("make that heading English") can revise the changes themselves rather
 * than rebuild them from the prose reply. Texts share what room is left.
 */
function withProposal(answer: string, proposal: CustomizationProposal, outcome: ProposalOutcome) {
  const room = DOCS_QA_HISTORY_ANSWER_MAX - answer.length - 1500;
  const each = Math.max(400, Math.floor(room / Math.max(1, proposal.entries.length)));
  const previousProposal = {
    status: OUTCOMES[outcome ?? "pending"],
    changes: proposal.entries.map(({ operation, itemId, kind, title, location, after }) => ({
      operation,
      itemId,
      kind,
      title,
      location,
      ...(after === undefined
        ? {}
        : after.length > each
          ? { content: after.slice(0, each), truncated: true }
          : { content: after }),
    })),
    diagnostics: proposal.diagnostics.map(({ severity, message }) => ({ severity, message })),
  };
  return `${answer}\n\n${JSON.stringify({ previousProposal })}`;
}

/** Build ask history: newest completed turns, answers trimmed to what the API accepts. */
export function docsQaAskHistory(
  turns: HistoryTurn[],
  outcome: (turnId: string) => ProposalOutcome = () => undefined,
): Array<{ question: string; answer: string }> {
  return turns
    .filter((turn) => turn.phase === "completed")
    .slice(-DOCS_QA_HISTORY_LIMIT)
    .map((turn) => ({
      question: turn.question,
      answer: (turn.proposal && turn.proposal.entries.length > 0
        ? withProposal(turn.answer, turn.proposal, turn.id ? outcome(turn.id) : undefined)
        : turn.answer
      ).slice(0, DOCS_QA_HISTORY_ANSWER_MAX),
    }));
}
