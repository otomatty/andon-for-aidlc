import type { CustomizationProposal } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import {
  DOCS_QA_HISTORY_ANSWER_MAX,
  DOCS_QA_HISTORY_LIMIT,
  docsQaAskHistory,
} from "@/features/docs/hooks/docs-qa-history.ts";

describe("docsQaAskHistory", () => {
  it("sends only the newest completed turns", () => {
    const turns = [
      ...Array.from({ length: 10 }, (_, index) => ({
        phase: "completed",
        question: `q${index}`,
        answer: `a${index}`,
      })),
      { phase: "answering", question: "running", answer: "" },
    ];
    const history = docsQaAskHistory(turns);
    expect(history).toHaveLength(DOCS_QA_HISTORY_LIMIT);
    expect(history[0]?.question).toBe("q2");
    expect(history.at(-1)?.question).toBe("q9");
  });

  it("trims a long answer so the next question is still accepted", () => {
    const long = "x".repeat(DOCS_QA_HISTORY_ANSWER_MAX + 500);
    const [turn] = docsQaAskHistory([{ phase: "completed", question: "q", answer: long }]);
    expect(turn?.answer).toHaveLength(DOCS_QA_HISTORY_ANSWER_MAX);
  });

  it("writes a shown proposal into its answer so a follow-up can revise it", () => {
    const proposal: CustomizationProposal = {
      spaceId: "default",
      configurationRevision: "rev",
      changes: [],
      entries: [
        {
          operation: "create",
          itemId: "new-rule",
          kind: "rule-section",
          title: "Testing",
          location: "project › Testing",
          after: "## Testing\n\nTDD.\n",
        },
        {
          operation: "replace",
          itemId: "long",
          kind: "knowledge",
          title: "Guide",
          location: "knowledge › guide.md",
          before: "old",
          after: "y".repeat(DOCS_QA_HISTORY_ANSWER_MAX),
        },
      ],
      diagnostics: [{ severity: "error", code: "x", message: "見出しが重複しています。" }],
      canApply: false,
    };
    const [turn] = docsQaAskHistory(
      [{ id: "t1", phase: "completed", question: "追加して", answer: "追加します。", proposal }],
      (id) => (id === "t1" ? "failed" : undefined),
    );
    expect(turn?.answer.startsWith("追加します。\n\n")).toBe(true);
    expect(turn?.answer.length).toBeLessThanOrEqual(DOCS_QA_HISTORY_ANSWER_MAX);
    const { previousProposal } = JSON.parse(turn?.answer.slice("追加します。\n\n".length) ?? "");
    expect(previousProposal).toMatchObject({
      status: "apply failed",
      changes: [
        { operation: "create", title: "Testing", content: "## Testing\n\nTDD.\n" },
        { operation: "replace", itemId: "long", truncated: true },
      ],
      diagnostics: [{ severity: "error", message: "見出しが重複しています。" }],
    });
  });

  it("leaves answers without a proposal as they were", () => {
    const [turn] = docsQaAskHistory([{ phase: "completed", question: "q", answer: "a" }]);
    expect(turn?.answer).toBe("a");
  });
});
