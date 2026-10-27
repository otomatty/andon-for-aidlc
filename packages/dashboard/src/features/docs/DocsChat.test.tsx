import type { DocsQaCitation, DocsQaJob } from "@aidlc-guide/shared-types";
import { cleanup, render, screen } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsChat } from "@/features/docs/DocsChat.tsx";
import type { DocsQaState } from "@/features/docs/hooks/useDocsQa.ts";

const ASK = "\u8cea\u554f\u3059\u308b";
const STOP = "\u56de\u7b54\u3092\u505c\u6b62";
const FAIL = "\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f";

const citation: DocsQaCitation = {
  id: "1",
  sourceId: "guide-start",
  target: { kind: "guide", path: "start.md", locale: "ja" },
  title: "start",
  headings: ["start"],
  version: "0.9.0",
  hash: "a".repeat(64),
  startLine: 1,
  endLine: 1,
  quote: "start",
};

function turn(): DocsQaJob {
  return {
    id: "job-1",
    question: "how",
    tool: "claude",
    locale: "ja",
    phase: "completed",
    answer: "see [1]",
    citations: [citation],
    createdAt: 0,
  };
}

function qa(overrides: Partial<DocsQaState> = {}): DocsQaState {
  return {
    draft: "draft text",
    setDraft: vi.fn(),
    tool: "claude",
    setTool: vi.fn(),
    tools: [{ tool: "claude", label: "Claude", available: true }],
    turns: [turn()],
    target: undefined,
    setTarget: vi.fn(),
    error: null,
    submitting: false,
    busy: false,
    submit: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    refresh: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("DocsChat", () => {
  it("hides answer cards on the entry screen", () => {
    render(<DocsChat mode="entry" onCitation={vi.fn()} qa={qa()} />);
    expect(screen.queryByTestId("docs-answer")).toBeNull();
    expect(screen.getByTestId("docs-question-entry")).toBeTruthy();
  });

  it("shows the conversation on the chat screen", () => {
    render(<DocsChat mode="chat" onCitation={vi.fn()} qa={qa()} />);
    expect(screen.getByTestId("docs-answer").textContent).toContain("how");
  });

  it("does not offer send while a reply is in flight", () => {
    render(<DocsChat mode="chat" onCitation={vi.fn()} qa={qa({ busy: true })} />);
    expect(screen.queryByRole("button", { name: ASK })).toBeNull();
    expect(screen.getByRole("button", { name: STOP })).toBeTruthy();
  });

  it("shows a failure beside the input instead of an answer card", () => {
    render(<DocsChat mode="entry" onCitation={vi.fn()} qa={qa({ error: FAIL, turns: [] })} />);
    expect(screen.getByText(FAIL)).toBeTruthy();
    expect(screen.queryByTestId("docs-answer")).toBeNull();
  });

  it("opens a citation and keeps the draft", async () => {
    const onCitation = vi.fn();
    render(<DocsChat mode="chat" onCitation={onCitation} qa={qa()} />);
    await userEvent.click(screen.getByRole("button", { name: /start/ }));
    expect(onCitation).toHaveBeenCalledWith(citation, expect.objectContaining({ id: "job-1" }));
    expect(screen.getByDisplayValue("draft text")).toBeTruthy();
  });

  it("keeps the draft after returning to chat", () => {
    const { rerender } = render(<DocsChat mode="entry" onCitation={vi.fn()} qa={qa()} />);
    rerender(<DocsChat mode="chat" onCitation={vi.fn()} qa={qa()} />);
    expect(screen.getByDisplayValue("draft text")).toBeTruthy();
    expect(screen.getByTestId("docs-answer")).toBeTruthy();
  });
});
