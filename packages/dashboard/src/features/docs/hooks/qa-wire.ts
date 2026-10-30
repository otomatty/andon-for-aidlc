import type {
  DocsQaJob,
  DocsQaTarget,
  DocsQaTool,
  DocsQaToolStatus,
  OfficialDocsLocale,
} from "@andon/shared-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { docsQaAskHistory } from "@/features/docs/hooks/docs-qa-history.ts";
import { useDocsConversationBridge } from "@/features/docs/hooks/docs-conversation-bridge.ts";
import { DocsQaError, docsQaApi } from "@/services/docs-qa.ts";

export function isRunning(job: DocsQaJob): boolean {
  return job.phase === "searching" || job.phase === "reading" || job.phase === "answering";
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "\u63a5\u7d9a\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
}

function missingJob(error: unknown): boolean {
  return (
    error instanceof DocsQaError && (error.reason === "not-found" || error.reason === "disposed")
  );
}

/** Kept mounted in DocsShell, including while the user reads a cited document. */
export function useDocsQa(open: boolean, locale: OfficialDocsLocale) {
  const [draft, setDraft] = useState("");
  const [tool, setTool] = useState<DocsQaTool>("claude");
  const [tools, setTools] = useState<DocsQaToolStatus[] | null>(null);
  const [turns, setTurns] = useState<DocsQaJob[]>([]);
  const [target, setTarget] = useState<DocsQaTarget | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const submittingRef = useRef(false);
  const cancelRequested = useRef(false);
  const mounted = useRef(true);
  const lastRefreshKey = useRef(0);
  useDocsConversationBridge(turns, draft, setTurns, setDraft);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    const recheck = lastRefreshKey.current !== refreshKey;
    lastRefreshKey.current = refreshKey;
    setTools(null);
    void docsQaApi
      .tools(recheck)
      .then((value) => {
        if (!stale) setTools(value);
      })
      .catch((cause: unknown) => {
        if (!stale) {
          setTools([]);
          setError(message(cause));
        }
      });
    return () => {
      stale = true;
    };
  }, [open, refreshKey]);

  const receive = useCallback((job: DocsQaJob) => {
    setTurns((previous) => {
      const found = previous.some((turn) => turn.id === job.id);
      return found
        ? previous.map((turn) => (turn.id === job.id && isRunning(turn) ? job : turn))
        : [...previous, job];
    });
    if (!isRunning(job)) setActiveId((current) => (current === job.id ? null : current));
  }, []);

  useEffect(() => {
    if (activeId === null || pollFailed) return;
    let stale = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await docsQaApi.job(activeId);
        if (stale) return;
        receive(job);
        if (isRunning(job))
          timer = setTimeout(() => {
            void poll();
          }, 500);
      } catch (cause) {
        if (!stale) {
          setError(message(cause));
          if (missingJob(cause)) {
            setActiveId(null);
            setTurns((previous) =>
              previous.map((turn) =>
                turn.id === activeId ? { ...turn, phase: "error", error: message(cause) } : turn,
              ),
            );
          } else setPollFailed(true);
        }
      }
    };
    void poll();
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [activeId, pollFailed, receive]);

  const submit = async (
    question = draft,
    original?: Pick<DocsQaJob, "locale" | "target">,
  ): Promise<void> => {
    if (activeId !== null || submittingRef.current || question.trim() === "") return;
    submittingRef.current = true;
    cancelRequested.current = false;
    setSubmitting(true);
    setError(null);
    setPollFailed(false);
    try {
      const job = await docsQaApi.ask({
        question: question.trim(),
        tool,
        locale: original?.locale ?? locale,
        ...((original ? original.target : target)
          ? { target: original ? original.target : target }
          : {}),
        history: docsQaAskHistory(turns),
      });
      if (!mounted.current) return;
      receive(job);
      setDraft("");
      if (isRunning(job)) setActiveId(job.id);
      if (cancelRequested.current && isRunning(job)) receive(await docsQaApi.cancel(job.id));
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const cancel = async (): Promise<void> => {
    cancelRequested.current = true;
    if (activeId === null) return;
    try {
      receive(await docsQaApi.cancel(activeId));
      setError(null);
    } catch (cause) {
      setError(message(cause));
      if (missingJob(cause)) {
        setActiveId(null);
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === activeId ? { ...turn, phase: "error", error: message(cause) } : turn,
          ),
        );
      }
    }
  };

  /** Starts a new conversation. A reply still in flight keeps the old one. */
  const reset = (): void => {
    if (activeId !== null || submittingRef.current) return;
    setTurns([]);
    setDraft("");
    setTarget(undefined);
    setError(null);
    setPollFailed(false);
  };

  const refresh = () => {
    setError(null);
    setPollFailed(false);
    setRefreshKey((key) => key + 1);
  };

  return {
    draft,
    setDraft,
    tool,
    setTool,
    tools,
    turns,
    target,
    setTarget,
    error,
    submitting,
    busy: submitting || activeId !== null,
    submit,
    cancel,
    reset,
    refresh,
  };
}

export type DocsQaState = ReturnType<typeof useDocsQa>;
