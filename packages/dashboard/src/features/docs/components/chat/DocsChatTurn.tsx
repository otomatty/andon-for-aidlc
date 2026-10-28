import type { DocsQaCitation, DocsQaJob, DocsQaPhase } from "@aidlc-guide/shared-types";
import { BookOpenIcon, CheckIcon, CopyIcon, LoaderCircleIcon, PencilIcon } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MarkdownSurface } from "@/viewer/lazy-markdown.ts";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { isRunning } from "@/features/docs/hooks/useDocsQa.ts";
import { TOOL_LABELS } from "./DocsComposer.tsx";

const PHASE_LABELS: Record<DocsQaPhase, string> = {
  searching: "関連する文書を検索しています…",
  reading: "参照する箇所を確認しています…",
  answering: "文書をもとに回答を作成しています…",
  completed: "回答が完了しました",
  cancelled: "回答を停止しました",
  error: "回答を作成できませんでした",
};

/** What each running phase has already finished, shown above the current one. */
const DONE_STEPS: Record<"searching" | "reading" | "answering", string[]> = {
  searching: [],
  reading: ["関連する文書を検索しました"],
  answering: ["関連する文書を検索しました", "参照する箇所を確認しました"],
};

function Progress({ turn }: { turn: DocsQaJob }): ReactNode {
  const running = isRunning(turn);
  const done =
    turn.phase === "searching" || turn.phase === "reading" || turn.phase === "answering"
      ? DONE_STEPS[turn.phase]
      : [];
  return (
    <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
      {done.map((step) => (
        <p key={step} className="flex items-center gap-2">
          <CheckIcon aria-hidden="true" className="size-3.5 text-status-done" />
          {step}
        </p>
      ))}
      {/* One live region for every phase, so each change is announced; a finished answer speaks for itself. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center gap-2",
          turn.phase === "completed" && "sr-only",
          running && "font-medium text-foreground",
        )}
      >
        {running ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-3.5 animate-spin text-primary motion-reduce:animate-none"
          />
        ) : null}
        {PHASE_LABELS[turn.phase]}
      </p>
    </div>
  );
}

/** Answer Markdown whose `[n]` markers become links that open that citation. */
function AnswerText({
  turn,
  onCitation,
}: {
  turn: DocsQaJob;
  onCitation: (citation: DocsQaCitation) => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const markdown = turn.answer.replace(/\[(\d+)\](?!\()/g, (original, id: string) =>
    turn.citations.some((citation) => citation.id === id)
      ? `[${id}](#docs-citation-${id})`
      : original,
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const click = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const interactive = event.target.closest("a, button");
      if (!interactive || !element.contains(interactive)) return;
      event.preventDefault();
      event.stopPropagation();
      const id = interactive.getAttribute("href")?.match(/^#docs-citation-(\d+)$/)?.[1];
      const citation = turn.citations.find((candidate) => candidate.id === id);
      if (citation) onCitation(citation);
    };
    element.addEventListener("click", click, true);
    return () => element.removeEventListener("click", click, true);
  }, [turn.citations, onCitation]);
  return (
    <div ref={ref} className="docs-chat-answer">
      <Suspense fallback={<DocumentSkeleton label="answer" />}>
        <MarkdownSurface markdown={markdown} editable={null} />
      </Suspense>
    </div>
  );
}

function CopyAnswer({ answer }: { answer: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-testid="docs-answer-copy"
      aria-label={copied ? "コピーしました" : "回答をコピー"}
      onClick={() => {
        void navigator.clipboard?.writeText(answer).then(() => setCopied(true));
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/**
 * One exchange, chat-style: the question as the reader's bubble on the right,
 * the answer as plain text on the left, its sources as cards below it.
 */
export function DocsChatTurn({
  turn,
  index,
  activeCitation,
  canEdit,
  onCitation,
  onEdit,
}: {
  turn: DocsQaJob;
  index: number;
  /** The citation of this turn open in the source panel, if any. */
  activeCitation: string | null;
  /** False while any reply is in flight: the box it would fill is busy. */
  canEdit: boolean;
  onCitation: (citation: DocsQaCitation) => void;
  onEdit: () => void;
}): ReactNode {
  const running = isRunning(turn);
  return (
    <div
      id={`docs-answer-${turn.id}`}
      data-testid="docs-answer"
      tabIndex={-1}
      className="flex scroll-mt-16 flex-col gap-3 outline-none"
    >
      <div className="flex flex-col items-end gap-1">
        <h3 className="m-0 max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm leading-relaxed font-normal whitespace-pre-wrap wrap-break-word">
          {turn.question}
        </h3>
        {!running && canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-testid="docs-question-edit"
            aria-label="この質問を編集する"
            onClick={onEdit}
          >
            <PencilIcon />
          </Button>
        ) : null}
      </div>
      <article aria-label={`回答 ${index + 1}`} className="flex min-w-0 flex-col gap-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-md bg-primary-light text-primary-light-foreground"
          >
            <BookOpenIcon className="size-3.5" />
          </span>
          {`内蔵ドキュメントから回答 · ${TOOL_LABELS[turn.tool]}`}
        </p>
        <Progress turn={turn} />
        {turn.answer ? <AnswerText turn={turn} onCitation={onCitation} /> : null}
        {turn.error ? (
          <Alert variant="destructive">
            <AlertDescription>{turn.error}</AlertDescription>
          </Alert>
        ) : null}
        {turn.citations.length > 0 ? (
          <section
            className="flex flex-col gap-2"
            aria-label={
              turn.sourcesKind === "related" ? "関連するドキュメント" : "参照したドキュメント"
            }
          >
            <h4 className="text-xs font-bold text-muted-foreground">
              {turn.sourcesKind === "related" ? "関連するドキュメント" : "参照したドキュメント"}
            </h4>
            <ol className="flex flex-wrap gap-2">
              {turn.citations.map((citation) => {
                const active = citation.id === activeCitation;
                return (
                  <li key={citation.id} className="min-w-0">
                    <button
                      type="button"
                      data-testid="docs-citation"
                      aria-label={`参照 ${citation.id}: ${citation.title}`}
                      aria-pressed={active}
                      className={cn(
                        "flex max-w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
                        active ? "border-primary bg-primary-light" : "border-border",
                      )}
                      onClick={() => onCitation(citation)}
                    >
                      <span className="font-bold text-primary-light-foreground">{citation.id}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {citation.title}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {`${citation.headings.join(" › ")} · ${citation.target.locale.toUpperCase()} · ${citation.version}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
        {turn.phase === "completed" && turn.answer ? (
          <div className="flex gap-1">
            <CopyAnswer answer={turn.answer} />
          </div>
        ) : null}
      </article>
    </div>
  );
}
