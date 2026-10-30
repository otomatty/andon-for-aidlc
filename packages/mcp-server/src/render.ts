import path from "node:path";
import { type ReadResult, type StandardReason, supportedVersionsLabel } from "@andon/shared-types";

/**
 * The single `ReadResult` → tool-reply mapping (R-MS-2). No handler writes its
 * own: a data failure must never become an MCP protocol error, so every branch
 * of the union leaves here as an ordinary reply the AI can read and act on
 * (BR-MS-3). `isError` belongs to the schema-validation layer alone.
 */
export interface ToolReply {
  /** Japanese, human- and AI-readable (BR-MS-6). */
  text: string;
  /** Machine-readable twin of {@link text}; absent when the text *is* the data. */
  data?: unknown;
  /** Set on the two degraded branches so the AI can branch without parsing prose. */
  degraded?: { kind: "unsupported" | "error"; detail: string };
}

export interface RenderOptions {
  /**
   * The rendered text is verbatim file content (read_artifact). Two effects:
   * the body is not path-rewritten — rewriting a user's artifact would violate
   * BR-MS-4 — and it is not duplicated into `data`, which would double a
   * payload of up to 10MB for no gain (P-MS-3 「再エンコードしない」).
   */
  verbatim?: boolean;
}

/** Windows path comparison is case-insensitive; POSIX is not. */
const CASE_FLAGS = process.platform === "win32" ? "gi" : "g";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips the workspace root off any absolute path in server-generated text
 * (S-MS-4). Errors bubbling up from `node:fs` carry the full absolute path, and
 * an MCP reply is the one place that text is handed to a半-trusted consumer.
 *
 * Matching is separator-agnostic (`C:\a\b` and `C:/a/b` are the same path on
 * Windows) rather than a plain `replaceAll`, because reader-core, Bun and Node
 * do not agree on which separator they echo back.
 */
export function relativize(text: string, workspaceRoot: string): string {
  const segments = path.resolve(workspaceRoot).split(/[\\/]/).map(escapeRegExp);
  const pattern = new RegExp(`${segments.join("[\\\\/]")}[\\\\/]?`, CASE_FLAGS);
  return text.replace(pattern, "");
}

/**
 * One Japanese line per known reason, with an actionable alternative wherever
 * one exists — the point of BR-MS-3 is that the AI picks a *next action*, and
 * "失敗しました" alone does not support that.
 *
 * `Record<StandardReason, string>` on purpose: adding a reason to the shared
 * vocabulary fails this compile until this surface has a wording for it.
 */
const REASON_TEXT: Readonly<Record<StandardReason, string>> = {
  "no-active-intent":
    "アクティブなインテントがありません（ワークスペース未初期化）。Claude Code で `/aidlc <作りたいもの>` を実行するとインテントが作成されます。",
  "no-selected-intent":
    "表示するインテントが選ばれていません。Dashboard の一覧から選んでください。",
  "state-missing":
    "aidlc-state.md が見つかりません。インテントは存在しますが状態ファイルが未作成です。`/aidlc` を実行してワークフローを開始してください。",
  "state-unreadable":
    "aidlc-state.md を読み取れませんでした（権限またはファイル破損）。ファイルの存在と読取権限を確認してください。",
  "outside-record":
    "記録ディレクトリの外は読めません（読取範囲はアクティブなインテントの記録ディレクトリ配下のみ）。記録ディレクトリからの相対パスを指定してください。",
  "artifact-not-found":
    "指定されたファイルが見つかりません。aidlc_status で現在のステージを確認し、そのステージのディレクトリ配下のパスを指定してください。",
  "file-too-large": "ファイルが大きすぎて読めません（上限 10MB）。このツールでは全文を返せません。",
  "not-found":
    "該当なし: そのステージ slug は AI-DLC の 32 ステージに存在しません。aidlc_status で現在のステージ slug を確認してください。",
  "undefined-term":
    "未定義: その用語は用語集にありません。別の表記（英語 slug / 日本語）で再試行してください。",
  "config-invalid":
    "andon.config.json が不正で読み込めません。JSON 構文と docsRepoPath の型を確認してください。",
  "unknown-route":
    "サーバが知らない API パスです。クライアントとサーバのバージョンずれの可能性があります。",
  "missing-path": "パスが指定されていません。読み取りたいファイルの相対パスを指定してください。",
};

/** `internal: <msg>` is reader-core's normalisation of an unexpected fault. */
const INTERNAL_PREFIX = "internal:";

export function reasonText(reason: string): string {
  const known = (REASON_TEXT as Readonly<Record<string, string>>)[reason];
  if (known !== undefined) return known;
  if (reason.startsWith(INTERNAL_PREFIX)) {
    return `内部エラー: ${reason.slice(INTERNAL_PREFIX.length).trim()}`;
  }
  return `読み取りに失敗しました（reason: ${reason}）。`;
}

/** The two degraded branches, which read identically for every tool. Exported
 * for callers that fail *before* they have a value to describe (read_artifact's
 * pre-gate), so they need not invent a dead `describe` callback. */
export function renderDegraded(
  result: Exclude<ReadResult<unknown>, { ok: true }>,
  workspaceRoot: string,
): ToolReply {
  if ("unsupported" in result) {
    const text = `この state は State Version ${result.version} で、本ツールは ${supportedVersionsLabel()} に対応です（解析不可）。`;
    return { text, degraded: { kind: "unsupported", detail: result.version } };
  }
  return {
    text: relativize(reasonText(result.reason), workspaceRoot),
    degraded: { kind: "error", detail: result.reason },
  };
}

/**
 * `describe` renders only the success branch; the two degraded branches are
 * identical for every tool and belong here, not in five copies.
 */
export function renderResult<T>(
  result: ReadResult<T>,
  workspaceRoot: string,
  describe: (value: T) => string,
  options: RenderOptions = {},
): ToolReply {
  if (!("ok" in result)) return renderDegraded(result, workspaceRoot);

  const body = describe(result.value);
  const text = options.verbatim === true ? body : relativize(body, workspaceRoot);
  const warnings = (result.warnings ?? []).map(
    (warning) => `注意: ${relativize(warning, workspaceRoot)}`,
  );
  const withWarnings = warnings.length === 0 ? text : `${text}\n\n${warnings.join("\n")}`;

  return options.verbatim === true
    ? { text: withWarnings }
    : { text: withWarnings, data: result.value };
}

/** MCP `content` blocks. The JSON twin is a second block so BR-MS-6's two
 * audiences (human prose, machine payload) stay separable. */
export function toContent(reply: ToolReply): { content: { type: "text"; text: string }[] } {
  const content: { type: "text"; text: string }[] = [{ type: "text", text: reply.text }];
  const payload = reply.data ?? reply.degraded;
  if (payload !== undefined) {
    content.push({ type: "text", text: `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`` });
  }
  return { content };
}
