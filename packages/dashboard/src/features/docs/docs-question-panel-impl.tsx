import type { DocsQaCitation, DocsQaJob, DocsQaTool } from "@aidlc-guide/shared-types";
import { ArrowUpIcon, BookOpenIcon, SquareIcon } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useRef } from "react";
import { FormSelect } from "@/shared/form-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownSurface } from "@/viewer/lazy-markdown.ts";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { type DocsQaState, isRunning } from "@/features/docs/hooks/useDocsQa.ts";

const TOOL_LABELS: Record<DocsQaTool, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
};

const PHASE_LABELS = {
  searching:
    "\u95a2\u9023\u3059\u308b\u6587\u66f8\u3092\u691c\u7d22\u3057\u3066\u3044\u307e\u3059\u2026",
  reading:
    "\u53c2\u7167\u3059\u308b\u7b87\u6240\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u2026",
  answering:
    "\u6587\u66f8\u3092\u3082\u3068\u306b\u56de\u7b54\u3092\u4f5c\u6210\u3057\u3066\u3044\u307e\u3059\u2026",
  completed: "\u56de\u7b54\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f",
  cancelled: "\u56de\u7b54\u3092\u505c\u6b62\u3057\u307e\u3057\u305f",
  error: "\u56de\u7b54\u3092\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f",
};

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
    <div ref={ref}>
      <Suspense fallback={<DocumentSkeleton label="answer" />}>
        <MarkdownSurface markdown={markdown} editable={null} />
      </Suspense>
    </div>
  );
}

export function DocsQuestionPanel({
  qa,
  onCitation,
}: {
  qa: DocsQaState;
  onCitation: (citation: DocsQaCitation, turn: DocsQaJob) => void;
}): ReactNode {
  const selectedTool = qa.tools?.find((tool) => tool.tool === qa.tool);
  const canAsk = selectedTool?.available === true;
  return (
    <section
      className="flex min-w-0 flex-col gap-5"
      aria-labelledby="docs-question-title"
      data-testid="docs-question-panel"
    >
      <Card size="lg">
        <CardHeader>
          <CardTitle>
            <h2 id="docs-question-title">
              {
                "\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u306b\u3064\u3044\u3066\u8cea\u554f\u3059\u308b"
              }
            </h2>
          </CardTitle>
          <CardDescription>
            {
              "\u5185\u8535\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u3092\u3082\u3068\u306b\u56de\u7b54\u3057\u307e\u3059\u3002\u56de\u7b54\u306e\u53c2\u7167\u756a\u53f7\u304b\u3089\u3001\u6839\u62e0\u3068\u306a\u308b\u7b87\u6240\u3092\u958b\u3051\u307e\u3059\u3002"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void qa.submit();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="docs-question">
                  {qa.turns.length ? "\u7d9a\u3051\u3066\u8cea\u554f\u3059\u308b" : "\u8cea\u554f"}
                </FieldLabel>
                {qa.target ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {"\u3053\u306e\u6587\u66f8"}: {qa.target.path}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="docs-question-clear-target"
                      onClick={() => qa.setTarget(undefined)}
                    >
                      {"\u3059\u3079\u3066\u306e\u6587\u66f8\u3092\u5bfe\u8c61\u306b\u3059\u308b"}
                    </Button>
                  </div>
                ) : null}
                <Textarea
                  id="docs-question"
                  data-testid="docs-question-input"
                  value={qa.draft}
                  onChange={(event) => qa.setDraft(event.target.value)}
                  maxLength={2000}
                  rows={3}
                  aria-describedby="docs-question-help"
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing &&
                      (event.ctrlKey || event.metaKey) &&
                      canAsk &&
                      !qa.busy
                    ) {
                      event.preventDefault();
                      void qa.submit();
                    }
                  }}
                />
                <FieldDescription id="docs-question-help">
                  {
                    "\u8cea\u554f\u3068\u95a2\u9023\u3059\u308b\u6587\u66f8\u306e\u629c\u7c8b\u3092\u3001\u9078\u3093\u3060\u30c4\u30fc\u30eb\u3078\u9001\u4fe1\u3057\u307e\u3059\u3002\u30c4\u30fc\u30eb\u5074\u306e\u5229\u7528\u67a0\u3092\u4f7f\u7528\u3057\u307e\u3059\u3002"
                  }
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="docs-question-tool">
                  {"\u56de\u7b54\u306b\u4f7f\u3046\u30c4\u30fc\u30eb"}
                </FieldLabel>
                <FormSelect
                  id="docs-question-tool"
                  value={qa.tool}
                  disabled={qa.busy}
                  options={(Object.keys(TOOL_LABELS) as DocsQaTool[]).map((tool) => ({
                    value: tool,
                    label: TOOL_LABELS[tool],
                  }))}
                  onChange={(value) => {
                    if (value === "claude" || value === "cursor" || value === "copilot")
                      qa.setTool(value);
                  }}
                />
                <FieldDescription>
                  {qa.tools === null
                    ? "\u30c4\u30fc\u30eb\u306e\u5229\u7528\u72b6\u6cc1\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059\u2026"
                    : (selectedTool?.detail ??
                      (selectedTool?.available
                        ? "\u5229\u7528\u3067\u304d\u307e\u3059"
                        : "\u30c4\u30fc\u30eb\u3092\u5229\u7528\u3067\u304d\u307e\u305b\u3093\u3002\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3068\u30ed\u30b0\u30a4\u30f3\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002"))}
                </FieldDescription>
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="docs-question-refresh"
                  onClick={qa.refresh}
                >
                  {"\u63a5\u7d9a\u3092\u518d\u78ba\u8a8d"}
                </Button>
                {qa.busy ? (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="docs-question-stop"
                    onClick={() => {
                      void qa.cancel();
                    }}
                  >
                    <SquareIcon data-icon="inline-start" />
                    {"\u56de\u7b54\u3092\u505c\u6b62"}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    data-testid="docs-question-submit"
                    disabled={!canAsk || !qa.draft.trim()}
                  >
                    <ArrowUpIcon data-icon="inline-start" />
                    {"\u8cea\u554f\u3059\u308b"}
                  </Button>
                )}
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      {qa.error ? (
        <Alert variant="destructive" data-testid="docs-question-error">
          <AlertTitle>
            {"\u8cea\u554f\u6a5f\u80fd\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044"}
          </AlertTitle>
          <AlertDescription>{qa.error}</AlertDescription>
        </Alert>
      ) : null}
      {qa.submitting ? (
        <p role="status" className="text-sm text-muted-foreground">
          {"\u8cea\u554f\u3092\u9001\u4fe1\u3057\u3066\u3044\u307e\u3059\u2026"}
        </p>
      ) : null}
      {qa.turns.map((turn, index) => (
        <Card
          key={turn.id}
          size="lg"
          id={`docs-answer-${turn.id}`}
          data-testid="docs-answer"
          tabIndex={-1}
        >
          <CardHeader>
            <CardDescription>
              {"\u8cea\u554f"} {index + 1} · {TOOL_LABELS[turn.tool]}
            </CardDescription>
            <CardTitle>
              <h3 className="whitespace-pre-wrap wrap-break-word">{turn.question}</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {PHASE_LABELS[turn.phase]}
            </p>
            {turn.answer ? (
              <AnswerText turn={turn} onCitation={(citation) => onCitation(citation, turn)} />
            ) : null}
            {turn.error ? (
              <Alert variant="destructive">
                <AlertDescription>{turn.error}</AlertDescription>
              </Alert>
            ) : null}
            {turn.citations.length > 0 ? (
              <section
                className="flex flex-col gap-2 border-t pt-4"
                aria-label={"\u53c2\u7167\u3057\u305f\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8"}
              >
                <h4 className="text-sm font-bold">
                  {turn.sourcesKind === "related"
                    ? "\u95a2\u9023\u3059\u308b\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8"
                    : "\u53c2\u7167\u3057\u305f\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8"}
                </h4>
                <ol className="flex flex-col gap-2">
                  {turn.citations.map((citation) => (
                    <li key={citation.id} className="min-w-0">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-start whitespace-normal text-left"
                        data-testid="docs-citation"
                        onClick={() => onCitation(citation, turn)}
                        aria-label={`\u53c2\u7167 ${citation.id}: ${citation.title}`}
                      >
                        <BookOpenIcon data-icon="inline-start" />
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="font-bold">
                            [{citation.id}] {citation.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {citation.headings.join(" \u203a ")} ·{" "}
                            {citation.target.locale.toUpperCase()} · {citation.version}
                          </span>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {!isRunning(turn) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="docs-question-edit"
                disabled={qa.busy}
                onClick={() => {
                  qa.setDraft(turn.question);
                  document.getElementById("docs-question")?.focus();
                }}
              >
                {"\u3053\u306e\u8cea\u554f\u3092\u7de8\u96c6\u3059\u308b"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
