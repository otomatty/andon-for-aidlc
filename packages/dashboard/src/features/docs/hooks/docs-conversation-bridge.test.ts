import type { DocsQaJob } from "@andon/shared-types";
import { act, renderHook } from "@tests/render.tsx";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocsConversationBridge } from "@/features/docs/hooks/docs-conversation-bridge.ts";

const postMessage = vi.fn();
vi.mock("@/services/vscode-api.ts", () => ({ vsCodeApi: () => ({ postMessage }) }));

function job(id: string, phase: DocsQaJob["phase"], extra: Partial<DocsQaJob> = {}): DocsQaJob {
  return {
    id,
    question: `q-${id}`,
    tool: "claude",
    phase,
    answer: "",
    citations: [],
    createdAt: 0,
    ...extra,
  };
}

function useHarness() {
  const [turns, setTurns] = useState<DocsQaJob[]>([]);
  const [draft, setDraft] = useState("");
  useDocsConversationBridge(turns, draft, setTurns, setDraft);
  return { turns, setTurns, draft };
}

function restore(state: unknown) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "docs-conversation", state } }),
    );
  });
}

beforeEach(() => postMessage.mockClear());

describe("useDocsConversationBridge", () => {
  it("restores locale and target so a refresh asks the original question", () => {
    const { result } = renderHook(useHarness);
    const target = { kind: "guide", path: "concepts.md", locale: "en" };
    restore({
      turns: [{ id: "t1", question: "q", answer: "a", citations: [], locale: "en", target }],
      draft: "",
    });
    expect(result.current.turns[0]).toMatchObject({ locale: "en", target, phase: "completed" });
  });

  it("keeps an in-flight question as the draft so it can be sent again after reopening", () => {
    const { result } = renderHook(useHarness);
    restore({ turns: [], draft: "" });
    act(() => {
      result.current.setTurns([
        job("done", "completed", { answer: "a" }),
        job("live", "answering"),
      ]);
    });
    const saved = postMessage.mock.calls.at(-1)?.[0];
    expect(saved.state.draft).toBe("q-live");
    expect(saved.state.turns.map((turn: { id: string }) => turn.id)).toEqual(["done"]);
  });

  it("does not save before the host has restored the conversation", () => {
    const { result } = renderHook(useHarness);
    act(() => {
      result.current.setTurns([job("done", "completed")]);
    });
    expect(postMessage).not.toHaveBeenCalled();
  });
});
