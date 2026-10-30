import path from "node:path";
import { WORKFLOWS_TARGET_VERSION } from "@andon/shared-types";
import { formatDoctorDetailsForLog, type NativeDoctorReport } from "./doctor-output.ts";
import { detectHarnesses, HARNESS_LABELS, type HarnessId } from "./harness-detect.ts";
import {
  readNativeInstall,
  runNativeDoctor,
  runSetupProcess,
  type SetupRunner,
} from "./native-setup.ts";
import { inspectWorkflowsManagement } from "./workflows-management.ts";
import type { WorkflowsToolUpdateResult } from "./workflows-native-update.ts";
import { acquireWorkflowsOperation, WORKFLOWS_BUSY_MESSAGE } from "./workflows-operation.ts";
import { harnessVersionRel } from "./workflows-version.ts";

/** Rerun final diagnostics without repeating installation or configuration. */
export async function diagnoseInstalledWorkflows(opts: {
  workspaceRoot: string;
  isCurrent: () => boolean;
  signal?: AbortSignal;
  log: (line: string) => void;
  setNeedsRepair: (value: boolean) => Promise<void>;
  onHarnessResult: (result: WorkflowsToolUpdateResult) => void;
  /** Each tool's Doctor report, for the screen to list what needs attention. */
  onDoctorReport?: (id: HarnessId, report: NativeDoctorReport) => void;
}): Promise<{ ok: boolean; message: string }> {
  const current = () => !opts.signal?.aborted && opts.isCurrent();
  const cancelled = { ok: false, message: "診断を中止しました。更新完了は記録していません。" };
  if (!current()) return cancelled;
  const release = acquireWorkflowsOperation(opts.workspaceRoot);
  if (!release) return { ok: false, message: WORKFLOWS_BUSY_MESSAGE };
  try {
    const runtime = readNativeInstall(opts.workspaceRoot);
    if (!runtime)
      return {
        ok: false,
        message:
          "プロジェクトで使う CLI を確認できません。セットアップで CLI を準備してから Doctor を再実行してください。",
      };
    const tools = detectHarnesses(opts.workspaceRoot).harnesses;
    if (tools.length === 0)
      return {
        ok: false,
        message: "診断するツールがありません。セットアップでプロジェクトを設定してください。",
      };
    for (const tool of tools)
      opts.onHarnessResult({ id: tool.id, status: "pending", message: "診断未実行" });
    let healthy = true;
    for (const tool of tools) {
      if (!current()) return cancelled;
      opts.onHarnessResult({ id: tool.id, status: "updating", message: "Doctor を実行中" });
      const runner: SetupRunner = (command, args, cwd, env, signal, options) =>
        runSetupProcess(
          command,
          args,
          cwd,
          { ...env, AIDLC_HARNESS_DIR: path.dirname(path.dirname(harnessVersionRel(tool.id))) },
          signal,
          options,
        );
      try {
        const report = await runNativeDoctor(runtime, opts.workspaceRoot, runner, {
          isCurrent: current,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (!current()) return cancelled;
        opts.log(`${HARNESS_LABELS[tool.id]} の診断:\n${formatDoctorDetailsForLog(report)}`);
        opts.onDoctorReport?.(tool.id, report);
        const ok = report.outcome === "ok" || report.outcome === "warning";
        healthy = healthy && ok;
        opts.onHarnessResult({
          id: tool.id,
          status: ok ? "completed" : "failed",
          message: ok ? "Doctor の確認完了" : "Doctor の確認失敗。下の項目を確認してください。",
        });
      } catch (cause) {
        if (!current()) return cancelled;
        healthy = false;
        const message = cause instanceof Error ? cause.message : String(cause);
        opts.log(`${HARNESS_LABELS[tool.id]} の診断に失敗しました: ${message}`);
        opts.onHarnessResult({
          id: tool.id,
          status: "failed",
          message: `Doctor の実行失敗: ${message}`,
        });
      }
    }
    if (!healthy)
      return {
        ok: false,
        message:
          "診断未完了です。下に挙げた項目に対処してから Doctor を再実行してください。エンジンの再設定は行っていません。",
      };
    const state = inspectWorkflowsManagement(opts.workspaceRoot);
    if (!current()) return cancelled;
    if (
      state.status === "current" &&
      state.projectPin === WORKFLOWS_TARGET_VERSION &&
      runtime.version === WORKFLOWS_TARGET_VERSION &&
      readNativeInstall(opts.workspaceRoot)?.version === WORKFLOWS_TARGET_VERSION &&
      state.tools.length === tools.length &&
      tools.every((tool) => state.tools.some((entry) => entry.id === tool.id))
    ) {
      await opts.setNeedsRepair(false);
      return {
        ok: true,
        message: "すべてのツールの Doctor が完了しました。プロジェクトの更新も完了しています。",
      };
    }
    return {
      ok: true,
      message:
        "Doctor の確認が完了しました。プロジェクトのバージョンは更新先と揃っていないため、必要に応じてエンジンを更新してください。",
    };
  } catch (cause) {
    if (!current()) return cancelled;
    opts.log(cause instanceof Error ? cause.message : String(cause));
    return {
      ok: false,
      message:
        "Doctor の実行に失敗しました。実行ログを確認して再実行してください。エンジンの再設定は行っていません。",
    };
  } finally {
    release();
  }
}
