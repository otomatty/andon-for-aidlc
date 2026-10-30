import { execFile, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { DocsQaTool, DocsQaToolStatus } from "@andon/shared-types";
import {
  COPILOT_ARGUMENTS,
  COPILOT_REQUIRED_FLAGS,
  CopilotOutput,
  copilotCommands,
} from "./copilot";
import { record } from "./validation";

const exec = promisify(execFile);
const MAX_OUTPUT = 2_000_000;
const MAX_ANSWER = 40_000;
export const LABELS = { claude: "Claude Code", cursor: "Cursor", copilot: "GitHub Copilot" };
export interface CliCapability extends DocsQaToolStatus {
  command?: string;
}

export function cliArguments(tool: DocsQaTool): string[] {
  if (tool === "copilot") return [...COPILOT_ARGUMENTS];
  if (tool === "claude")
    return [
      "--safe-mode",
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence",
      "--disable-slash-commands",
      "--no-chrome",
    ];
  return [
    "--print",
    "--mode",
    "ask",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--trust",
  ];
}

export async function probeTool(tool: DocsQaTool, signal?: AbortSignal): Promise<CliCapability> {
  signal?.throwIfAborted();
  const candidates =
    tool === "claude"
      ? ["claude"]
      : tool === "copilot"
        ? await copilotCommands()
        : ["agent", "cursor-agent"];
  const needed =
    tool === "claude"
      ? [
          "--safe-mode",
          "--tools",
          "--strict-mcp-config",
          "--mcp-config",
          "--no-session-persistence",
          "--include-partial-messages",
          "--disable-slash-commands",
          "--no-chrome",
        ]
      : tool === "copilot"
        ? COPILOT_REQUIRED_FLAGS
        : ["--mode", "--stream-partial-output", "--output-format", "--trust"];
  let installed = false;
  for (const command of candidates) {
    signal?.throwIfAborted();
    try {
      const { stdout } = await exec(command, ["--help"], {
        cwd: tmpdir(),
        timeout: 10_000,
        maxBuffer: 200_000,
        windowsHide: true,
        signal,
      });
      signal?.throwIfAborted();
      if (tool === "cursor" && !/cursor/i.test(stdout)) continue;
      if (tool === "copilot" && !/copilot/i.test(stdout)) continue;
      installed = true;
      if (needed.every((flag) => stdout.includes(flag)))
        return {
          tool,
          label: LABELS[tool],
          available: true,
          command,
          ...(tool === "copilot"
            ? {
                detail:
                  "CLI を検出しました。認証と Copilot の利用権限は、質問の送信時に確認します。",
              }
            : {}),
        };
    } catch {
      signal?.throwIfAborted();
      /* An absent or unsupported executable is not runnable. */
    }
  }
  return {
    tool,
    label: LABELS[tool],
    available: false,
    detail: installed
      ? `${LABELS[tool]} CLI を最新バージョンに更新してください。文書への質問に必要な実行オプションがありません。`
      : tool === "copilot"
        ? "GitHub Copilot CLI が見つかりません。CLI をインストールして copilot login でログインし、アプリを再起動してください。"
        : `${LABELS[tool]} CLI が見つかりません。CLI をインストールしてログインし、アプリを再起動してください。`,
  };
}

export interface CliRunOptions {
  command: string;
  args: string[];
  tool: DocsQaTool;
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  signal: AbortSignal;
  onText(text: string): void;
  /** Longest answer accepted, in characters. Defaults to a docs answer's budget. */
  maxText?: number;
  /** Persist ownership before supplying any prompt to the child. */
  onSpawn?(pid: number): Promise<void>;
}

function messageText(value: unknown): string {
  if (!record(value) || !Array.isArray(value.content)) return "";
  return value.content
    .map((item) =>
      record(item) && item.type === "text" && typeof item.text === "string" ? item.text : "",
    )
    .join("");
}

/** Parses the supported vendors' NDJSON formats without exposing tool output. */
export class AnswerStream {
  text = "";
  complete = false;
  private readonly copilot: CopilotOutput | undefined;
  constructor(
    private readonly tool: DocsQaTool,
    private readonly onText: (text: string) => void,
    private readonly maxText = MAX_ANSWER,
  ) {
    this.copilot = tool === "copilot" ? new CopilotOutput() : undefined;
  }
  accept(line: string): void {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("protocol");
    }
    if (!record(event)) throw new Error("protocol");
    if (
      event.type === "tool_call" ||
      (event.type === "stream_event" &&
        record(event.event) &&
        event.event.type === "content_block_start" &&
        record(event.event.content_block) &&
        event.event.content_block.type === "tool_use")
    )
      throw new Error("unexpected-tool");
    if (
      event.type === "assistant" &&
      record(event.message) &&
      Array.isArray(event.message.content) &&
      event.message.content.some((block) => record(block) && block.type === "tool_use")
    )
      throw new Error("unexpected-tool");
    if (this.copilot) {
      this.copilot.accept(event);
      this.text = this.copilot.text;
      this.complete = this.copilot.complete;
    } else if (event.type === "result") {
      if (event.is_error === true || (event.subtype !== undefined && event.subtype !== "success"))
        throw new Error(typeof event.result === "string" ? event.result : "cli-failed");
      if (typeof event.result !== "string") throw new Error("protocol");
      this.text = event.result;
      this.complete = true;
    } else if (
      this.tool === "claude" &&
      event.type === "stream_event" &&
      record(event.event) &&
      event.event.type === "content_block_delta" &&
      record(event.event.delta) &&
      event.event.delta.type === "text_delta" &&
      typeof event.event.delta.text === "string"
    ) {
      this.text += event.event.delta.text;
    } else if (
      this.tool === "cursor" &&
      event.type === "assistant" &&
      event.timestamp_ms !== undefined &&
      event.model_call_id === undefined
    ) {
      this.text += messageText(event.message);
    }
    if (this.text.length > this.maxText) throw new Error("output-limit");
    this.onText(this.text);
  }
}

export function runCli(options: CliRunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      shell: false,
    });
    let buffered = "";
    let stderr = "";
    let bytes = 0;
    let failure: Error | undefined;
    let finished = false;
    const parser = new AnswerStream(options.tool, options.onText, options.maxText);
    // Streamed vendors repeat the text in deltas, the final message and the result.
    const maxOutput = Math.max(MAX_OUTPUT, (options.maxText ?? 0) * 12);
    const stop = (error: Error) => {
      if (finished) return;
      failure ??= error;
      if (!child.pid) return;
      if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {
          child.kill("SIGKILL");
        });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const abort = () => stop(new Error("cancelled"));
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (failure) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxOutput) {
        stop(new Error("output-limit"));
        return;
      }
      buffered += chunk;
      let newline = buffered.indexOf("\n");
      try {
        while (newline !== -1) {
          parser.accept(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          newline = buffered.indexOf("\n");
        }
      } catch (error) {
        stop(error instanceof Error ? error : new Error("protocol"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    const settle = (error?: Error) => {
      if (finished) return;
      finished = true;
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(parser.text);
    };
    // @types/node@26 currently omits inherited EventEmitter methods here.
    const events = child as unknown as EventEmitter;
    // An error can precede process exit and stdio closure. Only close is a cleanup barrier.
    events.on("error", (error: Error) => {
      failure ??= error;
    });
    events.on("close", (code: number | null) => {
      try {
        if (!failure && buffered.trim()) parser.accept(buffered);
      } catch (error) {
        failure = error instanceof Error ? error : new Error("protocol");
      }
      settle(
        failure ??
          (code !== 0
            ? new Error(stderr || "cli-failed")
            : !parser.complete
              ? new Error("incomplete")
              : undefined),
      );
    });
    child.stdin.on("error", (error) => {
      if (!finished) stop(error);
    });
    const supplyPrompt = async () => {
      if (options.onSpawn && child.pid) await options.onSpawn(child.pid);
      if (!finished && !failure && !options.signal.aborted) child.stdin.end(options.prompt);
    };
    void supplyPrompt().catch((error: unknown) => {
      stop(error instanceof Error ? error : new Error("process-registration-failed"));
    });
  });
}

export function publicError(error: unknown, tool: DocsQaTool): string {
  const detail = error instanceof Error ? error.message : "";
  if (/does not support this model|version .*or newer is required|unknown option/i.test(detail)) {
    const minimum = /version (\d+\.\d+\.\d+) or newer/i.exec(detail)?.[1];
    const command =
      tool === "claude" ? "claude update" : tool === "copilot" ? "copilot update" : "agent update";
    return `${LABELS[tool]} CLI を${minimum ? ` ${minimum} 以降` : "最新バージョン"}に更新してください。現在のバージョンでは、このモデルまたは実行オプションを利用できません。ターミナルで ${command} を実行してから再試行できます。`;
  }
  if (/stale_index|invalid_index|index_too_large|docs_unavailable/.test(detail))
    return "内蔵ドキュメントの検索データを読み込めませんでした。アプリを最新バージョンに更新してください。開発環境では bun run build:docs-index を実行してから再試行してください。";
  if (/invalid_target|path_rejected/.test(detail))
    return "対象の文書を読み込めませんでした。ドキュメント一覧から文書を選び直して再試行してください。";
  if (/auth|login|log in|sign in|401|403|api.?key/i.test(detail))
    return tool === "claude"
      ? "Claude Code の認証を確認してください。ターミナルで claude auth login を実行してから再試行できます。"
      : tool === "copilot"
        ? "GitHub Copilot の認証を確認してください。copilot login でログインしてください。ログインを引き継げない場合は、アプリの起動環境に Copilot Requests 権限のある COPILOT_GITHUB_TOKEN を設定して再試行できます。"
        : "Cursor の認証を確認してください。agent login でログインするか、アプリの起動環境に CURSOR_API_KEY を設定して再試行してください。";
  if (/rate.?limit|quota|usage.?limit|429|credit|billing/i.test(detail))
    return `${LABELS[tool]} の利用上限に達しました。CLI の利用状況を確認してから再試行してください。`;
  if (/output-limit/.test(detail))
    return "回答が長すぎたため停止しました。質問の範囲を絞って再試行してください。";
  if (/unexpected-tool/.test(detail))
    return "CLI が文書の回答以外の操作を要求したため停止しました。CLI を更新して再試行してください。";
  return `${LABELS[tool]} から回答を受け取れませんでした。CLI のログイン状態と接続を確認して再試行してください。`;
}
