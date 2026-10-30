import path from "node:path";
import { WORKFLOWS_TARGET_VERSION, type WorkflowsManagementState } from "@andon/shared-types";
import { findHarnessConflict } from "./harness-conflicts.ts";
import { detectHarnesses } from "./harness-detect.ts";
import { readNativeProjections } from "./native-projection.ts";
import { inspectProjectPin } from "./native-setup.ts";
import { compareSemver, parseSemver } from "./update-release.ts";
import {
  canInitializeWorkflowsPin,
  harnessVersionRel,
  readAllWorkspaceAidlcVersions,
} from "./workflows-version.ts";

/** Version-update button: leftover repair markers must not re-enable a no-op bump. */
export function workflowsEngineCanApply(state: WorkflowsManagementState): boolean {
  return state.engineBumpNeeded;
}

/** Reads every tool, including tools whose version file is missing. Never uses the docs pin. */
export function inspectWorkflowsManagement(
  root: string,
  needsRepair = false,
): WorkflowsManagementState {
  const detected = detectHarnesses(root).harnesses;
  const projections = readNativeProjections(root);
  const records = readAllWorkspaceAidlcVersions(root);
  const pin = inspectProjectPin(root);
  const tools = detected.map((tool) => ({
    ...tool,
    version:
      projections.find((entry) => entry.harness === tool.id)?.version ??
      records.find((entry) => entry.sourcePath === path.join(root, harnessVersionRel(tool.id)))
        ?.version ??
      null,
  }));
  const state: WorkflowsManagementState = {
    root,
    target: WORKFLOWS_TARGET_VERSION,
    tools,
    projectPin: pin.version,
    status: "current",
    message: "更新の必要はありません。",
    canInstall: true,
    canUpdate: false,
    engineBumpNeeded: false,
    engineVersionDiffers: false,
    updateRetryNeeded: false,
  };
  const blocked = (message: string): WorkflowsManagementState => ({
    ...state,
    status: "blocked",
    message,
    canInstall: false,
  });
  const conflict = findHarnessConflict(detected.map((tool) => tool.id));
  if (conflict) return blocked(conflict.message);
  if (pin.exists && pin.version === null)
    return blocked(
      "プロジェクトの固定バージョン（.aidlc-version）を読めません。公式手順から確認してください。",
    );
  const versions = [
    ...tools.map((tool) => tool.version),
    ...records.map((record) => record.version),
    ...(pin.exists ? [pin.version] : []),
  ];
  if (
    versions.some(
      (version) =>
        version === null || !/^\d+\.\d+\.\d+$/.test(version) || parseSemver(version) === null,
    )
  )
    return blocked(
      "バージョンを確認できないツールがあります。公式手順から設定を確認してください。",
    );
  const target = parseSemver(WORKFLOWS_TARGET_VERSION);
  if (target === null) return blocked("導入バージョンを確認できません。");
  if (
    versions.some((version) => {
      const parsed = parseSemver(version ?? "");
      return parsed !== null && compareSemver(parsed, target) > 0;
    })
  )
    return blocked(
      `導入バージョン ${state.target} より新しい設定があります。ダウングレードは行いません。`,
    );
  if (tools.length === 0)
    return {
      ...state,
      status: "not-installed",
      message:
        pin.exists && records.length === 0
          ? `ツールは未設定です。インストール時に固定バージョンを ${state.target} に揃えます。`
          : "このプロジェクトにはツールが設定されていません。",
      canInstall:
        !pin.exists ||
        pin.version === state.target ||
        canInitializeWorkflowsPin(
          0,
          records.map((entry) => entry.version),
          pin.version,
          state.target,
        ),
    };
  const engineVersionDiffers = versions.some((version) => version !== state.target);
  const engineBumpNeeded = !pin.exists || engineVersionDiffers;
  if (needsRepair || engineBumpNeeded) {
    let message = `更新があります。すべてのツールとプロジェクトの固定バージョンを ${state.target} に揃えます。`;
    if (needsRepair)
      message = engineBumpNeeded
        ? "前回の更新は未完了です。全ツールの更新を再実行してください。"
        : "更新の必要はありません。";
    else if (!pin.exists && !engineVersionDiffers)
      message = `プロジェクトの固定バージョンが未設定です。更新で .aidlc-version を ${state.target} に設定します。マシンの既定CLIは維持します。`;
    return {
      ...state,
      status: "update",
      canInstall: false,
      canUpdate: true,
      engineBumpNeeded,
      engineVersionDiffers,
      updateRetryNeeded: needsRepair && engineBumpNeeded,
      message,
    };
  }
  return state;
}
