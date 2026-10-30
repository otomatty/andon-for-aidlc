import type { Reader } from "@andon/reader-core";
import type { StageStatus, WorkflowModel } from "@andon/shared-types";
import { renderResult, type ToolReply } from "../render.ts";

export const STATUS_DESCRIPTION =
  "現在のワークフロー位置（フェーズ / ステージ / ゲート / 進捗）を知りたいときに使う。" +
  "「今どこ？」「次は何をすればいい？」と聞かれたら最初にこれを呼ぶ。" +
  "次のステージ名とそこで人間に求められることは aidlc_next_steps 側にある。";

/** Six G-3 marks → the label a human reads (project.md: 色に依存しない表現). */
const GATE_LABEL: Readonly<Record<StageStatus, string>> = {
  "not-started": "未着手",
  "in-progress": "進行中",
  "awaiting-approval": "承認待ち（ゲートが開いています — 人間の承認または差し戻しが必要）",
  revising: "差し戻し後の修正中",
  completed: "完了",
  skipped: "SKIP",
};

function describe(model: WorkflowModel): string {
  const lines = [
    `プロジェクト: ${model.project}（scope: ${model.scope} / depth: ${model.depth}）`,
    `フェーズ: ${model.phase}`,
    `現在のステージ: ${model.currentStage ?? "（なし — 未着手または完了）"}`,
    `ゲート: ${model.gate === null ? "（なし）" : GATE_LABEL[model.gate]}`,
    `進捗: ${model.done} / ${model.total} ステージ完了`,
  ];
  // Field-level degradation is part of the answer, not a footnote: an AI that
  // does not know `done` was unparseable will quote a wrong number (NFR-6).
  for (const [field, detail] of Object.entries(model.unparseable ?? {})) {
    lines.push(`解析できなかった項目 — ${field}: ${detail}`);
  }
  return lines.join("\n");
}

/**
 * M1 (FR-2.1 / US-09b). Exactly one reader call: the next stage is
 * `aidlc_next_steps`'s job, and calling `getNextStep` here would re-parse the
 * state file for a field this tool does not report (component-methods.md).
 */
export async function status(reader: Reader, workspaceRoot: string): Promise<ToolReply> {
  return renderResult(await reader.getWorkflow(), workspaceRoot, describe);
}
