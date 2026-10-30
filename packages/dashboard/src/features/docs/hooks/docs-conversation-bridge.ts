import type { DocsQaCitation, DocsQaJob, DocsQaTarget } from "@andon/shared-types";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { vsCodeApi } from "@/services/vscode-api.ts";

const MSG = "docs" + "-conversation";

function turnsFromConversation(turns: unknown): DocsQaJob[] {
  if (!Array.isArray(turns)) return [];
  return turns.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const turn = item as Record<string, unknown>;
    if (typeof turn.id !== "string" || typeof turn.question !== "string") return [];
    if (typeof turn.answer !== "string" || !Array.isArray(turn.citations)) return [];
    return [
      {
        id: turn.id,
        question: turn.question,
        answer: turn.answer,
        citations: turn.citations as DocsQaCitation[],
        ...(turn.locale === "en" || turn.locale === "ja" ? { locale: turn.locale } : {}),
        ...(typeof turn.target === "object" && turn.target !== null
          ? { target: turn.target as DocsQaTarget }
          : {}),
        // A proposal is not kept: it was checked against the settings of its own moment.
        ...(turn.mode === "customize" ? { mode: "customize" as const } : {}),
        tool: "claude" as const,
        phase: "completed" as const,
        createdAt: 0,
      },
    ];
  });
}

/** Restore/persist conversation via the host webview bridge. */
export function useDocsConversationBridge(
  turns: DocsQaJob[],
  draft: string,
  setTurns: Dispatch<SetStateAction<DocsQaJob[]>>,
  setDraft: Dispatch<SetStateAction<string>>,
): void {
  const restoredRef = useRef(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data !== "object" || data === null) return;
      const msg = data as Record<string, unknown>;
      if (msg.type !== MSG) return;
      const state = msg.state;
      if (typeof state !== "object" || state === null) return;
      const row = state as Record<string, unknown>;
      if (typeof row.draft !== "string" || !Array.isArray(row.turns)) return;
      setTurns(turnsFromConversation(row.turns));
      setDraft(row.draft);
      restoredRef.current = true;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setDraft, setTurns]);

  useEffect(() => {
    if (!restoredRef.current) return;
    const api = vsCodeApi();
    if (api === null) return;
    const unfinished = turns.find((turn) => turn.phase !== "completed" && turn.phase !== "error");
    api.postMessage({
      type: MSG,
      state: {
        turns: turns
          .filter((turn) => turn.phase === "completed")
          .map((turn) => ({
            id: turn.id,
            question: turn.question,
            answer: turn.answer,
            citations: turn.citations,
            ...(turn.locale ? { locale: turn.locale } : {}),
            ...(turn.target ? { target: turn.target } : {}),
            ...(turn.mode === "customize" ? { mode: turn.mode } : {}),
          })),
        draft: draft === "" && unfinished ? unfinished.question : draft,
      },
    });
  }, [turns, draft]);
}
