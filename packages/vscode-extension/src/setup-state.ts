import { existsSync } from "node:fs";
import path from "node:path";
import type { WorkflowsManagementState } from "@aidlc-guide/shared-types";
import { type ExtensionContext, workspace } from "vscode";
import {
  type CliManagementState,
  inspectCliManagement,
  olderThanTarget,
} from "./cli-management.ts";
import { CODEX_GIT_REQUIRED, isGitRepository } from "./git-prerequisite.ts";
import { detectHarnesses, type HarnessId } from "./harness-detect.ts";
import { docsSkillPath, mcpScriptPath, refreshDocsRegistration } from "./mcp-register.ts";
import { readNativeProjections } from "./native-projection.ts";
import {
  type NativeInstall,
  readNativeInstall,
  readVersionedNativeInstall,
  SETUP_RELEASE,
} from "./native-setup.ts";
import { inspectWorkflowsManagement } from "./workflows-management.ts";
import { workflowsRepairKey } from "./workflows-operation.ts";
import { readWorkspaceAidlcVersion } from "./workflows-version.ts";

export type SetupPreference = {
  completed: boolean;
  docsSkipped: boolean;
  harness: HarnessId;
  /** Older preferences retain the single harness field. */
  harnesses?: HarnessId[];
};
export type RuntimeIssueKind = "trust" | "git" | "mixed-versions" | "runtime-missing";
export type SetupSnapshot = {
  root: string;
  configured: boolean;
  projectPresent: boolean;
  native: NativeInstall | null;
  version: string | null;
  harnesses: HarnessId[];
  docsReady: boolean;
  docsReason?: string;
  runtimeIssue?: string;
  runtimeIssueKind?: RuntimeIssueKind;
  preference: SetupPreference | undefined;
  workflows?: WorkflowsManagementState;
  cli?: CliManagementState;
};

export const setupStateKey = (root: string): string => `aidlc-guide.setup.v2:${root}`;

/** Setup completion does not require an Intent. Startup only reads files. */
export async function inspectSetup(
  context: ExtensionContext,
  root: string,
): Promise<SetupSnapshot> {
  const harnesses = detectHarnesses(root).harnesses.map((h) => h.id);
  const projectPresent = existsSync(path.join(root, "aidlc", "spaces")) && harnesses.length > 0;
  const version = readWorkspaceAidlcVersion(root).version;
  const cli = inspectCliManagement(root);
  const projectNative = readNativeInstall(root);
  const verifiedNative = readVersionedNativeInstall(SETUP_RELEASE);
  const useMachineForOlder =
    olderThanTarget(cli.projectVersion ?? version) &&
    projectNative === null &&
    verifiedNative !== null;
  const native = projectNative ?? (useMachineForOlder ? verifiedNative : null);
  const projections = readNativeProjections(root);
  const nativeVersions = new Set(projections.map((projection) => projection.version));
  const codexIssue = harnesses.includes("codex")
    ? !workspace.isTrusted
      ? "ワークスペースを信頼してから、Codex の設定状態を再確認してください。"
      : !(await isGitRepository(root))
        ? CODEX_GIT_REQUIRED
        : undefined
    : undefined;
  const runtimeIssueKind: RuntimeIssueKind | undefined = codexIssue
    ? workspace.isTrusted
      ? "git"
      : "trust"
    : nativeVersions.size > 1
      ? "mixed-versions"
      : projections.length > 0 && projections[0]?.version !== native?.version && !useMachineForOlder
        ? "runtime-missing"
        : undefined;
  const runtimeIssue =
    runtimeIssueKind === "trust" || runtimeIssueKind === "git"
      ? codexIssue
      : runtimeIssueKind === "mixed-versions"
        ? `ツール別の設定に異なるバージョン（${[...nativeVersions].join("、")}）があります。公式の手順で各ツールの設定を同じバージョンに揃えてください。`
        : runtimeIssueKind === "runtime-missing"
          ? `プロジェクトのバージョン ${projections[0]?.version} に対応する本体を利用できません。本体の導入後、プロジェクトのフォルダで aidlc use ${projections[0]?.version} を実行してください。.aidlc-version がある場合は、その内容がプロジェクトのバージョンと一致することを確認し、aidlc config --pin ${projections[0]?.version} で固定バージョンの登録を修復してください。`
          : undefined;
  const docs = await refreshDocsRegistration(
    root,
    mcpScriptPath(context.extensionPath),
    docsSkillPath(context.extensionPath),
    false,
  );
  return {
    root,
    cli,
    workflows: inspectWorkflowsManagement(
      root,
      context.workspaceState.get<boolean>(workflowsRepairKey(root)) === true,
    ),
    projectPresent,
    native,
    version,
    harnesses,
    configured: projectPresent && version !== null && runtimeIssue === undefined,
    runtimeIssue,
    ...(runtimeIssueKind ? { runtimeIssueKind } : {}),
    docsReady: docs.complete,
    docsReason: docs.reason,
    preference: context.workspaceState.get<SetupPreference>(setupStateKey(root)),
  };
}

export function needsSetup(snapshot: SetupSnapshot): boolean {
  // Completion belongs to this user/workspace. Later breakage is handled by Updates,
  // not by reopening onboarding. Docs registration is not shown in setup, so it never opens it.
  if (snapshot.preference?.completed) return false;
  return !snapshot.configured;
}
