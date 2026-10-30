import {
  ANSWER_PREFIX,
  type AnswerError,
  type ChatAnswered,
  scanAnswerLines,
} from "@andon/shared-types";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type SaveResult, saveAnswer } from "@/viewer/services/answer.ts";

/**
 * US-14 / FR-6.2. The only editable thing in the whole application: the text
 * after `[Answer]:` on a `[Answer]:` line of a `*-questions.md` file, except
 * the answers the engine records from the chat (shown read-only with a note).
 *
 * The server's gate rejections are the write boundary. This component renders
 * nothing when the file has no `[Answer]:` lines.
 */

export interface AnswerEditorProps {
  path: string;
  /** 1-based line numbers, from {@link answerLinesOf}. */
  answerLines: number[];
  markdown: string;
  /** Receives the **re-read** body, never a locally patched string (D2). */
  onSaved: (markdown: string) => void;
}

const CHAT_NOTE: Readonly<Record<ChatAnswered, string>> = {
  "plan-approval":
    "このファイルはコード生成計画の承認記録で、AI-DLC が書き込みます。承認後に [Answer]: を書き換えるとビルドが止まるため、ここでは編集できません。回答はチャットで行ってください。",
  "summary-confirmation":
    "「Consolidated Summary Confirmation」の [Answer]: は AI-DLC が確認内容と一緒に記録するため、ここでは編集できません。回答はチャットで行ってください。",
};

/**
 * The `[Answer]:` lines a person may edit here, 1-based. Empty for any other
 * file, and never a line the engine records from the chat.
 */
export function answerLinesOf(path: string, markdown: string): number[] {
  return scanAnswerLines(path, markdown).flatMap(({ line, owner }) =>
    owner === null ? [line] : [],
  );
}

/** Why the file's other `[Answer]:` lines are answered in the chat, if any are. */
export function chatAnsweredOf(path: string, markdown: string): ChatAnswered | null {
  return scanAnswerLines(path, markdown).find(({ owner }) => owner !== null)?.owner ?? null;
}

function valueAt(markdown: string, line: number): string {
  const raw = markdown.split("\n")[line - 1] ?? "";
  return raw.slice(ANSWER_PREFIX.length).replace(/\r$/, "").trim();
}

/** The nearest preceding non-empty line — the question this answer belongs to. */
function questionAt(markdown: string, line: number): string {
  const lines = markdown.split("\n");
  for (let i = line - 2; i >= 0; i -= 1) {
    const text = (lines[i] ?? "").trim();
    if (text !== "" && !text.startsWith(ANSWER_PREFIX)) return text.replace(/^#+\s*/, "");
  }
  return "";
}

/** D2's error table. Every identifier the server can send has a line here. */
const GATE_MESSAGE: Readonly<Record<AnswerError, string>> = {
  "not-a-questions-file": "このファイルは編集できません",
  "outside-record": "記録ディレクトリ外のファイルは編集できません",
  "not-an-answer-line": "この行は編集できません",
  "chat-answered-line":
    "この回答は AI-DLC がチャットでの回答から記録します。回答はチャットで行ってください",
  "write-verification-failed": "保存を中止しました（ファイルは変更されていません）",
};

interface Feedback {
  text: string;
  tone: "ok" | "warn" | "error";
  /** Only the default branch offers a retry — a gate rejection will not change. */
  retry: boolean;
}

function feedbackFor(result: SaveResult): Feedback {
  switch (result.kind) {
    case "saved":
      return result.verified
        ? { text: "保存しました", tone: "ok", retry: false }
        : // S-AV-5: the mismatch is reported, the differing content is not.
          { text: "保存内容が想定と異なります", tone: "warn", retry: false };
    case "rejected":
      return { text: GATE_MESSAGE[result.error], tone: "error", retry: false };
    default:
      return { text: `保存できませんでした（${result.reason}）`, tone: "error", retry: true };
  }
}

/**
 * The explicit-commit control plus its result line — inseparable from the field
 * above it, hence a subcomponent here rather than a file of its own.
 */
function SaveBar({
  busy,
  feedback,
  onSave,
}: {
  busy: boolean;
  feedback: Feedback | null;
  onSave: () => void;
}): ReactNode {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" onClick={onSave} disabled={busy}>
        {busy ? "保存中…" : "保存"}
      </Button>
      <span
        className={cn(
          "text-sm",
          feedback?.tone === "ok" && "text-status-done",
          feedback?.tone === "warn" && "text-status-gate",
          feedback?.tone === "error" && "text-destructive",
        )}
        role="status"
        data-tone={feedback?.tone}
      >
        {feedback === null ? "" : feedback.text}
      </span>
      {feedback?.retry === true ? (
        <Button type="button" variant="outline" onClick={onSave} disabled={busy}>
          再試行
        </Button>
      ) : null}
    </div>
  );
}

function AnswerField({
  path,
  line,
  markdown,
  onSaved,
}: {
  path: string;
  line: number;
  markdown: string;
  onSaved: (markdown: string) => void;
}): ReactNode {
  const fieldId = useId();
  const [value, setValue] = useState(() => valueAt(markdown, line));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const save = (): void => {
    setBusy(true);
    setFeedback(null);
    void saveAnswer({ file: path, line, value }, markdown).then((result) => {
      setBusy(false);
      setFeedback(feedbackFor(result));
      if (result.kind === "saved") onSaved(result.markdown);
    });
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor={fieldId}>
        {line} 行目の回答
        {questionAt(markdown, line) === "" ? "" : `: ${questionAt(markdown, line)}`}
      </label>
      <input
        id={fieldId}
        className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        type="text"
        value={value}
        disabled={busy}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <SaveBar busy={busy} feedback={feedback} onSave={save} />
    </div>
  );
}

export function AnswerEditor({
  path,
  answerLines,
  markdown,
  onSaved,
}: AnswerEditorProps): ReactNode {
  const chatAnswered = chatAnsweredOf(path, markdown);
  if (answerLines.length === 0 && chatAnswered === null) return null;

  return (
    <section className="mt-4" aria-labelledby="answer-heading" data-testid="answer-editor">
      <h3 id="answer-heading" className="mb-3 text-base font-semibold">
        回答の記入
      </h3>
      {chatAnswered === null ? null : (
        <p role="note" className="text-sm text-muted-foreground" data-testid="answer-chat-note">
          {CHAT_NOTE[chatAnswered]}
        </p>
      )}
      {answerLines.map((line) => (
        <AnswerField key={line} path={path} line={line} markdown={markdown} onSaved={onSaved} />
      ))}
    </section>
  );
}
