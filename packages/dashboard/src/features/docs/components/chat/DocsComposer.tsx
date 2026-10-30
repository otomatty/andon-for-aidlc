import type { DocsQaTool } from "@andon/shared-types";
import { ArrowUpIcon, BookOpenIcon, RefreshCwIcon, SquareIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { FormSelect } from "@/shared/form-select";
import { cn } from "@/lib/utils";
import type { DocsQaState } from "@/features/docs/hooks/useDocsQa.ts";

export const TOOL_LABELS: Record<DocsQaTool, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
};

/** The textarea every way into a question focuses: home, the chat and "この文書について質問". */
export const DOCS_QUESTION_ID = "docs-question";

export function focusDocsQuestion(): void {
  requestAnimationFrame(() => document.getElementById(DOCS_QUESTION_ID)?.focus());
}

/** Whether the chosen tool can take a question right now. */
export function docsQaCanAsk(qa: Pick<DocsQaState, "tools" | "tool">): boolean {
  return qa.tools?.find((tool) => tool.tool === qa.tool)?.available === true;
}

function toolStatus(qa: DocsQaState): { text: string; available: boolean } {
  if (qa.tools === null) return { text: "ツールの利用状況を確認しています…", available: false };
  const selected = qa.tools.find((tool) => tool.tool === qa.tool);
  if (selected?.detail) return { text: selected.detail, available: selected.available };
  return selected?.available
    ? { text: "利用できます", available: true }
    : {
        text: "ツールを利用できません。インストールとログインを確認してください。",
        available: false,
      };
}

/**
 * The message box, chat-style: the question, then what it is asked about,
 * which tool answers and a round send (or stop) button, all in one framed
 * box. The home, the empty chat and the running conversation share it.
 */
export function DocsComposer({
  qa,
  label,
  onSubmit,
  placeholder,
  className,
}: {
  qa: DocsQaState;
  label: string;
  /** Defaults to sending the draft; the home opens the chat first. */
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
}): ReactNode {
  const status = toolStatus(qa);
  const canAsk = docsQaCanAsk(qa);
  const send = (): void => {
    if (!canAsk || qa.busy || !qa.draft.trim()) return;
    if (onSubmit) onSubmit();
    else void qa.submit();
  };
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="docs-composer">
      {qa.error ? (
        <Alert variant="destructive" data-testid="docs-question-error">
          <AlertTitle>質問機能を確認してください</AlertTitle>
          <AlertDescription>{qa.error}</AlertDescription>
        </Alert>
      ) : null}
      {qa.submitting ? (
        <p role="status" className="text-sm text-muted-foreground">
          質問を送信しています…
        </p>
      ) : null}
      <form
        className="flex flex-col gap-2 rounded-2xl border border-border bg-background px-4 pt-3 pb-2 shadow-sm focus-within:border-primary"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor={DOCS_QUESTION_ID} className="sr-only">
          {label}
        </label>
        <textarea
          id={DOCS_QUESTION_ID}
          data-testid="docs-question-input"
          value={qa.draft}
          onChange={(event) => qa.setDraft(event.target.value)}
          maxLength={2000}
          rows={2}
          placeholder={placeholder ?? "質問を入力（Ctrl+Enter で送信）"}
          aria-describedby="docs-question-help"
          className="field-sizing-content max-h-60 min-h-12 w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              (event.ctrlKey || event.metaKey)
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            {qa.target ? (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary bg-primary-light py-0.5 pr-0.5 pl-2.5 text-primary-light-foreground">
                <BookOpenIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{`この文書: ${qa.target.path}`}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-full!"
                  data-testid="docs-question-clear-target"
                  aria-label="すべての文書を対象にする"
                  onClick={() => qa.setTarget(undefined)}
                >
                  <XIcon />
                </Button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                <BookOpenIcon aria-hidden="true" className="size-3.5" />
                すべての文書
              </span>
            )}
            <label htmlFor="docs-question-tool" className="sr-only">
              回答に使うツール
            </label>
            <FormSelect
              id="docs-question-tool"
              className="w-40"
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
            <span
              className={cn(
                "inline-flex items-center gap-1",
                canAsk ? "text-status-done" : "text-muted-foreground",
              )}
            >
              {status.text}
            </span>
            <Tooltip label="接続を再確認">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-testid="docs-question-refresh"
                aria-label="接続を再確認"
                onClick={qa.refresh}
              >
                <RefreshCwIcon />
              </Button>
            </Tooltip>
          </div>
          {qa.busy ? (
            <Button
              type="button"
              size="icon"
              className="rounded-full!"
              data-testid="docs-question-stop"
              aria-label="回答を停止"
              onClick={() => {
                void qa.cancel();
              }}
            >
              <SquareIcon className="fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="rounded-full!"
              data-testid="docs-question-submit"
              aria-label="質問する"
              disabled={!canAsk || !qa.draft.trim()}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </form>
      <p id="docs-question-help" className="text-center text-xs text-muted-foreground">
        質問と関連する文書の抜粋を、選んだツールへ送信します。ツール側の利用枠を使用します。
      </p>
    </div>
  );
}
