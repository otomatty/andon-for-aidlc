import type { DocsQaMode, DocsQaTool } from "@andon/shared-types";
import {
  ArrowUpIcon,
  BookOpenIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
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

/** What each mode does, as the composer and the chat name it. */
export const MODE_LABELS: Record<DocsQaMode, string> = {
  docs: "ドキュメント",
  customize: "カスタマイズ",
};

const MODE_TEXT: Record<
  DocsQaMode,
  { placeholder: string; help: string; error: string; submit: string }
> = {
  docs: {
    placeholder: "質問を入力（Ctrl+Enter で送信）",
    help: "質問と関連する文書の抜粋を、選んだツールへ送信します。ツール側の利用枠を使用します。",
    error: "質問機能を確認してください",
    submit: "質問する",
  },
  customize: {
    placeholder: "変えたい設定を入力（Ctrl+Enter で送信）",
    help: "依頼と現在の設定の内容を、選んだツールへ送信します。変更は差分を確認して「適用」を押すまで保存されません。",
    error: "カスタマイズの相談を確認してください",
    submit: "依頼する",
  },
};

const NO_CHAT_TOOL =
  "拡張機能で選択しているツールに、AI チャットで使えるもの（Claude Code・Cursor・GitHub Copilot）がありません。設定の「ツール追加」で追加できます。";

function toolStatus(qa: DocsQaState): { text: string; available: boolean } {
  if (qa.tools === null) return { text: "ツールの利用状況を確認しています…", available: false };
  if (qa.tools.length === 0) return { text: NO_CHAT_TOOL, available: false };
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
  const text = MODE_TEXT[qa.mode];
  const offered = qa.tools ?? [{ tool: qa.tool, label: TOOL_LABELS[qa.tool], available: false }];
  const send = (): void => {
    if (!canAsk || qa.busy || !qa.draft.trim()) return;
    if (onSubmit) onSubmit();
    else void qa.submit();
  };
  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="docs-composer">
      {qa.error ? (
        <Alert variant="destructive" data-testid="docs-question-error">
          <AlertTitle>{text.error}</AlertTitle>
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
          placeholder={placeholder ?? text.placeholder}
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
            <div
              role="radiogroup"
              aria-label="チャットの用途"
              className="inline-flex gap-0.5 rounded-full bg-muted p-0.5"
            >
              {(Object.keys(MODE_LABELS) as DocsQaMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={qa.mode === mode}
                  data-testid={`docs-chat-mode-${mode}`}
                  disabled={qa.busy}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
                    qa.mode === mode && "bg-background text-foreground shadow-xs",
                  )}
                  onClick={() => qa.setMode(mode)}
                >
                  {mode === "docs" ? (
                    <BookOpenIcon aria-hidden="true" className="size-3.5" />
                  ) : (
                    <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
                  )}
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            {qa.mode === "customize" ? (
              qa.space ? (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary bg-primary-light py-0.5 pr-0.5 pl-2.5 text-primary-light-foreground"
                  data-testid="docs-question-space"
                >
                  <SlidersHorizontalIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{`スペース: ${qa.space}`}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="rounded-full!"
                    data-testid="docs-question-clear-space"
                    aria-label="現在のスペースを対象にする"
                    disabled={qa.busy}
                    onClick={() => qa.setSpace(undefined)}
                  >
                    <XIcon />
                  </Button>
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground"
                  data-testid="docs-question-space"
                >
                  <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
                  現在のスペースの設定
                </span>
              )
            ) : qa.target ? (
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
            {offered.length > 1 ? (
              <>
                <label htmlFor="docs-question-tool" className="sr-only">
                  回答に使うツール
                </label>
                <FormSelect
                  id="docs-question-tool"
                  className="w-40"
                  value={qa.tool}
                  disabled={qa.busy}
                  options={offered.map(({ tool }) => ({ value: tool, label: TOOL_LABELS[tool] }))}
                  onChange={(value) => {
                    const chosen = offered.find(({ tool }) => tool === value);
                    if (chosen) qa.setTool(chosen.tool);
                  }}
                />
              </>
            ) : offered.length === 1 ? (
              <span
                className="inline-flex items-center rounded-full border border-border px-2.5 py-1 font-medium text-foreground"
                data-testid="docs-question-tool-label"
                aria-label={`回答に使うツール: ${TOOL_LABELS[qa.tool]}`}
              >
                {TOOL_LABELS[qa.tool]}
              </span>
            ) : null}
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
              aria-label={text.submit}
              disabled={!canAsk || !qa.draft.trim()}
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </form>
      <p id="docs-question-help" className="text-center text-xs text-muted-foreground">
        {text.help}
      </p>
    </div>
  );
}
