import type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaJob,
  DocsQaRequest,
  DocsQaResult,
  DocsQaToolStatus,
} from "@andon/shared-types";
import { getTransport } from "@/services/transport/index.ts";

const REASONS: Record<string, string> = {
  "workspace-untrusted": "このワークスペースを信頼してから質問してください。",
  busy: "別の質問に回答しています。完了を待つか、回答を停止してください。",
  "not-found": "回答の保存期間が終了しました。もう一度質問してください。",
  "bad-request": "質問の内容を確認して、もう一度送信してください。",
  unavailable: "質問機能に接続できません。開発サーバーを更新して再接続してください。",
  "source-unavailable":
    "参照元を読み込めませんでした。文書が移動または削除された可能性があります。",
  disposed: "質問セッションが終了しました。画面を再読み込みしてください。",
};

export class DocsQaError extends Error {
  constructor(readonly reason: string) {
    super(REASONS[reason] ?? reason);
  }
}

function unwrap<T>(body: unknown): T {
  if (typeof body !== "object" || body === null) throw new Error(REASONS.unavailable);
  const result = body as DocsQaResult<T>;
  if ("ok" in result && result.ok === true) return result.value;
  const reason = "reason" in result ? result.reason : "unavailable";
  throw new DocsQaError(reason);
}

async function get<T>(path: string): Promise<T> {
  const response = await getTransport().getJson(path);
  if (!response.reached)
    throw new Error("サーバーに接続できません。接続を確認して再試行してください。");
  return unwrap<T>(response.body);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await getTransport().postJson(path, body);
  return unwrap<T>(response.body);
}

export const docsQaApi = {
  tools: (recheck = false) =>
    get<DocsQaToolStatus[]>(`/api/docs-qa/tools${recheck ? "?recheck=true" : ""}`),
  ask: (request: DocsQaRequest) => post<DocsQaJob>("/api/docs-qa/ask", request),
  job: (id: string) => get<DocsQaJob>(`/api/docs-qa/job?id=${encodeURIComponent(id)}`),
  cancel: (id: string) => post<DocsQaJob>("/api/docs-qa/cancel", { id }),
  evidence: (citation: DocsQaCitation) => post<DocsQaEvidence>("/api/docs-qa/evidence", citation),
};
