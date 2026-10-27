import path from "node:path";
import { WORKFLOWS_TARGET_VERSION } from "@aidlc-guide/shared-types";
import { nativeLauncherReady } from "./cli-management.ts";
import { formatDoctorDetailsForLog } from "./doctor-output.ts";
import { detectHarnesses, HARNESS_LABELS } from "./harness-detect.ts";
import {
  readNativeInstall,
  readVersionedNativeInstall,
  runNativeDoctor,
  runSetupProcess,
  type SetupRunner,
  useNative,
} from "./native-setup.ts";
import { inspectWorkflowsManagement } from "./workflows-management.ts";
import {
  applyNativeWorkflowsUpdate,
  type NativeWorkflowsUpdateResult,
  type WorkflowsToolUpdateResult,
} from "./workflows-native-update.ts";
import { acquireWorkflowsOperation, WORKFLOWS_BUSY_MESSAGE } from "./workflows-operation.ts";
import { harnessVersionRel } from "./workflows-version.ts";

/** Application boundary: the caller cannot choose a version or omit installed tools. */
export async function updateInstalledWorkflows(opts: {
  workspaceRoot: string;
  log: (line: string) => void;
  isCurrent: () => boolean;
  canRestore: () => boolean;
  signal?: AbortSignal;
  needsRepair: boolean;
  setNeedsRepair: (value: boolean) => Promise<void>;
  onHarnessResult: (result: WorkflowsToolUpdateResult) => void;
}): Promise<NativeWorkflowsUpdateResult> {
  const target = WORKFLOWS_TARGET_VERSION;
  const isCurrent = () => !opts.signal?.aborted && opts.isCurrent();
  const release = acquireWorkflowsOperation(opts.workspaceRoot);
  if (!release) {
    opts.log(WORKFLOWS_BUSY_MESSAGE);
    return { ok: false, target, reason: "busy" };
  }
  try {
    if (!isCurrent()) return { ok: false, target, reason: "cancelled" };
    const state = inspectWorkflowsManagement(opts.workspaceRoot, opts.needsRepair);
    if (!state.canUpdate) {
      opts.log(state.message);
      return { ok: state.status === "current", target, reason: state.status };
    }
    const detected = detectHarnesses(opts.workspaceRoot).harnesses.map((tool) => tool.id);
    const previousMachine = readNativeInstall();
    if (
      !previousMachine ||
      !nativeLauncherReady(previousMachine) ||
      !readVersionedNativeInstall(target)
    ) {
      opts.log(
        `この PC に ${target} の実行環境がありません。プロジェクトの設定は変更していません。`,
      );
      return { ok: false, target, reason: "runtime-required" };
    }
    if (!isCurrent()) return { ok: false, target, reason: "cancelled" };
    await opts.setNeedsRepair(true);
    const restoreMachine = async () => {
      if (previousMachine && readNativeInstall()?.version !== previousMachine.version) {
        await useNative(previousMachine, previousMachine.version, opts.log);
        if (readNativeInstall()?.version !== previousMachine.version)
          throw new Error(
            `本体の既定バージョン ${previousMachine.version} への復元を確認できません。`,
          );
      }
    };
    let result: NativeWorkflowsUpdateResult = { ok: false, target, reason: "update-failed" };
    try {
      result = await applyNativeWorkflowsUpdate({
        ...opts,
        isCurrent,
        pin: target,
        selected: detected,
        detected,
        preserveMachine: true,
      });
    } catch (cause) {
      opts.log(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // The project keeps its target pin; restore the machine default even on failure or cancellation.
      // Cleanup must not inherit the closed panel's aborted signal.
      try {
        await restoreMachine();
      } catch (cause) {
        opts.log(
          `既定バージョンの復元に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        result = { ...result, ok: false, recovery: "failed" };
      }
    }
    if (!isCurrent()) return { ...result, ok: false, reason: "cancelled" };
    if (!result.ok) return result;
    const after = inspectWorkflowsManagement(opts.workspaceRoot);
    if (
      after.status !== "current" ||
      after.projectPin !== target ||
      after.tools.length !== detected.length ||
      detected.some((id) => !after.tools.some((tool) => tool.id === id))
    ) {
      opts.log("更新後のバージョンが揃っていません。状態を確認して再実行してください。");
      return { ok: false, target, reason: "verification" };
    }
    const runtime = readNativeInstall(opts.workspaceRoot);
    if (!runtime || runtime.version !== target)
      return { ok: false, target, reason: "runtime-verification" };
    // Earlier tool diagnostics may observe later tools before they have been updated.
    // Scope each final diagnostic explicitly; automatic selection examines only one tool.
    let allHealthy = true;
    for (const id of detected) {
      if (!isCurrent()) return { ok: false, target, reason: "cancelled" };
      const harnessDir = path.dirname(path.dirname(harnessVersionRel(id)));
      const runner: SetupRunner = (command, args, cwd, env, signal, options) =>
        runSetupProcess(
          command,
          args,
          cwd,
          { ...env, AIDLC_HARNESS_DIR: harnessDir },
          signal,
          options,
        );
      const doctor = await runNativeDoctor(runtime, opts.workspaceRoot, runner, {
        isCurrent,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!isCurrent()) return { ok: false, target, reason: "cancelled" };
      opts.log(`${HARNESS_LABELS[id]} の最終診断:\n${formatDoctorDetailsForLog(doctor)}`);
      const healthy = doctor.outcome === "ok" || doctor.outcome === "warning";
      allHealthy = allHealthy && healthy;
      opts.onHarnessResult({
        id,
        status: healthy ? "completed" : "failed",
        message: healthy ? "更新完了" : "最終診断に失敗しました。詳細を確認してください。",
      });
    }
    if (!allHealthy) return { ok: false, target, reason: "doctor" };
    await opts.setNeedsRepair(false);
    return result;
  } catch (cause) {
    if (!isCurrent()) return { ok: false, target, reason: "cancelled" };
    opts.log(cause instanceof Error ? cause.message : String(cause));
    return { ok: false, target, reason: "update-failed" };
  } finally {
    release();
  }
}
