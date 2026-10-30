import type { Reader } from "@andon/reader-core";
import type { NextStep } from "@andon/shared-types";
import { renderResult, type ToolReply } from "../render.ts";

export const NEXT_STEPS_DESCRIPTION =
  "次に実行されるステージ名と、そこで人間に求められること（承認 / 入力 / 確認）を知りたいときに使う。" +
  "「この後どうなる？」「私は何をすればいい？」に答えるためのツール。現在地そのものは aidlc_status。";

function describe(next: NextStep): string {
  if (next.nextStage === null) return `ワークフロー完了 — ${next.requirement}`;
  return [`次のステージ: ${next.nextStage}`, `人間に求められること: ${next.requirement}`].join(
    "\n",
  );
}

/** M3 (FR-2.3). Sole caller of `getNextStep`. */
export async function nextSteps(reader: Reader, workspaceRoot: string): Promise<ToolReply> {
  return renderResult(await reader.getNextStep(), workspaceRoot, describe);
}
