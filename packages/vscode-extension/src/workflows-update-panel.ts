import { randomBytes } from "node:crypto";
import path from "node:path";
import { inspectVersionGate } from "@aidlc-guide/reader-core";
import {
  VERSION_GATE_ACTIONS,
  type VersionGateAction,
  versionGateActionLabel,
  versionGateRollbackGuide,
  WORKFLOWS_TARGET_VERSION,
} from "@aidlc-guide/shared-types";
import { commands, type ExtensionContext, env, Uri, ViewColumn, window, workspace } from "vscode";
import { configureCliEnvironment } from "./cli-environment.ts";
import {
  CLI_PIN_CONFIRM_ACTION,
  CLI_UPDATE_CONFIRM_ACTION,
  CLI_USE_TARGET_CONFIRM_ACTION,
  type CliManagementResult,
  cliPinConfirmMessage,
  cliRegistersPin,
  cliUpdateConfirmMessage,
  cliUseTargetConfirmMessage,
  inspectCliManagement,
  pinProjectCli,
  prepareProjectCli,
  prepareTargetRuntime,
  updateMachineCli,
  useTargetCli,
} from "./cli-management.ts";
import { HARNESS_LABELS } from "./harness-detect.ts";
import { INSTALL_GUIDE_URL, readNativeInstall } from "./native-setup.ts";
import {
  changedSince,
  gitStatusSnapshot,
  pinCommitMessage,
  updateCommitMessage,
} from "./shared-file-changes.ts";
import { diagnoseInstalledWorkflows } from "./workflows-diagnose.ts";
import { inspectWorkflowsManagement } from "./workflows-management.ts";
import type {
  NativeWorkflowsUpdateResult,
  WorkflowsToolUpdateResult,
} from "./workflows-native-update.ts";
import { workflowsRepairKey } from "./workflows-operation.ts";
import {
  type LocalPatch,
  probeRepairTools,
  REPAIR_TOOLS,
  reapplyLocalPatches,
  repairWorkflows,
} from "./workflows-repair.ts";
import { repairPath } from "./workflows-repair-files.ts";
import { updateInstalledWorkflows } from "./workflows-update.ts";
import {
  type UpdateActivity,
  type UpdateChange,
  type UpdateCheck,
  type UpdateView,
  workflowsUpdateHtml,
} from "./workflows-update-html.ts";
import { updatePhase } from "./workflows-update-phase.ts";
import { readAllWorkspaceAidlcVersions, UPDATE_WORKFLOWS_COMMAND } from "./workflows-version.ts";

/** Where the version-check screen's action lands in this panel. */
const GATE_FOCUS: Readonly<Partial<Record<VersionGateAction, string>>> = {
  "update-project": "apply",
  "install-engine": "update-cli",
  "pin-project": "pin-project",
  doctor: "doctor",
};

const isOpenFolder = (root: string): boolean =>
  workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === root) ?? false;

const errorText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function workflowsUpdateMessage(
  result: NativeWorkflowsUpdateResult,
  entries: WorkflowsToolUpdateResult[],
): string {
  const message = workflowsUpdateBaseMessage(result, entries);
  if (result.recovery === "failed")
    return `${message} 以前のバージョンへの復元にも失敗しました。現在の .aidlc-version と CLI のバージョンを実行ログ・公式手順で確認し、復元してから再実行してください。`;
  if (result.recovery === "restored")
    return `${message} 更新前のバージョンへの復元を確認しました。`;
  return message;
}

function workflowsUpdateBaseMessage(
  result: NativeWorkflowsUpdateResult,
  entries: WorkflowsToolUpdateResult[],
): string {
  if (result.ok)
    return "プロジェクトのエンジン・固定バージョンの更新と Doctor の確認が完了しました。Git の差分を確認して共有してください。";
  if (result.reason === "doctor")
    return "設定反映済み・診断未完了です。実行ログの診断内容を確認し、対処後に「Doctor で診断」を押してください。";
  if (result.reason === "runtime-required")
    return "プロジェクトの更新は未実行です。この PC に必要な実行環境を準備できませんでした。もう一度更新してください。";
  if (result.reason === "previous-runtime-required")
    return "更新前に停止しました。失敗時に以前の固定バージョンへ戻すための実行環境がありません。実行ログに示された旧固定バージョンの CLI を公式手順で復元してから再実行してください。プロジェクトの設定は変更していません。";
  if (result.reason === "pin-failed")
    return "プロジェクトの固定バージョンの設定に失敗しました。ツールのエンジンは未更新です。実行ログと .aidlc-version を確認してください。";
  if (result.reason === "preflight")
    return "更新前の確認で停止しました。ツールのエンジンは未更新です。問題を直してから、もう一度更新してください。";
  if (result.reason === "busy")
    return "別のインストールまたは更新が実行中です。処理が終わってから再実行してください。";
  if (result.reason === "verification" || result.reason === "runtime-verification")
    return "ファイル更新後のバージョン確認に失敗しました。適用済みの範囲と実行ログを確認し、状態を再確認してください。";
  const applied = entries.filter((entry) => entry.status === "completed").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;
  const pending = entries.filter((entry) => entry.status === "pending").length;
  return `更新は完了していません。設定反映済み ${applied} 件、失敗 ${failed} 件、未実行 ${pending} 件。失敗した処理にも変更が残っている場合があります。ツールごとの結果と実行ログ、Git の差分を確認してから再実行してください。`;
}

export function cliUpdateMessage(result: CliManagementResult): string {
  if (result.ok) return result.message;
  const stages = {
    preflight: "更新前の確認",
    install: "CLI の導入",
    activate: "CLI の切り替え",
    register: "固定バージョンの登録",
    verify: "更新後の検証",
    restore: "既定バージョンの復元",
    complete: "完了確認",
  };
  const applied = result.applied
    ? "マシンに変更が残っている場合があります。"
    : "変更は未適用です。";
  const recovery =
    result.recovery === "restored"
      ? "以前の既定バージョンに戻しました。"
      : result.recovery === "failed"
        ? "既定バージョンの復元にも失敗しました。"
        : "";
  return `${stages[result.stage]}で停止しました。${result.message} ${applied}${recovery} ${result.nextAction}`;
}

/** Bind update and repair actions to the selected trusted workspace, never a webview-supplied root. */
export async function openWorkflowsUpdatePanel(
  context: ExtensionContext,
  workspaceRoot: string,
  focus?: VersionGateAction,
): Promise<void> {
  if (!workspace.isTrusted || !isOpenFolder(workspaceRoot)) {
    void window.showErrorMessage("更新対象のワークスペースを開き、信頼してから実行してください。");
    return;
  }
  const target = WORKFLOWS_TARGET_VERSION;
  const repairKey = workflowsRepairKey(workspaceRoot);
  const needsRepair = () => context.workspaceState.get<boolean>(repairKey) === true;
  const inspect = () => inspectWorkflowsManagement(workspaceRoot, needsRepair());
  const inspectCli = () => inspectCliManagement(workspaceRoot);
  const gateOf = () => inspectVersionGate(workspaceRoot, target);
  const panel = window.createWebviewPanel(
    "aidlcGuide.updateWorkflows",
    "AI-DLC の更新",
    ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  // Doctor needs a detected tool; a file-only problem is fixed by hand and then re-checked.
  const focusId =
    focus === undefined
      ? undefined
      : focus === "doctor" && inspect().tools.length === 0
        ? "recheck"
        : GATE_FOCUS[focus];
  let disposed = false;
  let busy = false;
  let validFolder = true;
  const cancellation = new AbortController();
  let repairCancellation: AbortController | undefined;
  const folderSubscription = workspace.onDidChangeWorkspaceFolders?.(() => {
    if (!isOpenFolder(workspaceRoot)) {
      validFolder = false;
      panel.dispose();
    }
  });
  // Closing the UI cancels forward work but still permits rollback in an open, trusted folder.
  const canRestore = () => validFolder && workspace.isTrusted && isOpenFolder(workspaceRoot);
  const isCurrent = () => !disposed && canRestore();
  const send = (message: unknown) => {
    if (!disposed) void panel.webview.postMessage(message);
  };

  // What this panel has learned and done; the page is drawn from it and the workspace.
  let check: UpdateCheck = { state: "pending" };
  let repairTools: UpdateView["repairTools"] = null;
  let change: UpdateChange | null = null;
  let activity: UpdateActivity | null = null;
  let outcome: UpdateView["outcome"] = null;
  const toolResults = new Map<string, WorkflowsToolUpdateResult>();
  let logText = "";
  let focused = false;
  // A finished action redraws the page; the new page then reads out its status line, or
  // after the automatic check, goes back to the action the version check asked for.
  let refocus: string | null = null;
  let initialCheckStarted = false;
  // The last page drawn without its nonce, so an unchanged state does not reload the webview.
  let shown = "";

  const view = (): UpdateView => ({
    gate: gateOf(),
    workflows: inspect(),
    cli: inspectCli(),
    check,
    repairTools,
    change,
    activity,
    outcome,
    toolResults: [...toolResults.values()].map(({ id, message }) => ({ id, message })),
    records: readAllWorkspaceAidlcVersions(workspaceRoot).map((entry) => entry.version),
    extensionVersion: context.extension?.packageJSON?.version,
  });
  /** Whether the page changed; an unchanged state does not reload the webview. */
  const render = (): boolean => {
    if (!isCurrent()) return false;
    const current = view();
    const page = workflowsUpdateHtml(current, "");
    if (page === shown) return false;
    shown = page;
    panel.webview.html = workflowsUpdateHtml(current, randomBytes(18).toString("hex"));
    return true;
  };
  const phase = () => updatePhase(gateOf(), inspect(), inspectCli(), change?.kind ?? null);
  const runtimeReady = () => {
    const cli = inspectCli();
    return cli.targetInstalled && cli.launcherReady;
  };
  /** Redraw after an action; a page that stays the same is told to take its buttons back. */
  const settle = (): boolean => {
    const redrawn = render();
    if (!redrawn) send({ type: "unlock" });
    return redrawn;
  };
  const log = (line: string) => {
    logText = `${logText}${line}\n`.slice(-60000);
    send({ type: "log", line });
  };
  const doing = (text: string, cancellable = false) => {
    activity = { text, cancellable };
    render();
  };
  const reportResults = () =>
    send({
      type: "results",
      results: [...toolResults.values()].map((item) => ({
        ...item,
        label: HARNESS_LABELS[item.id],
      })),
    });
  const onHarnessResult = (entry: WorkflowsToolUpdateResult) => {
    toolResults.set(entry.id, entry);
    reportResults();
  };
  const backupParent = () => path.join(context.globalStorageUri.fsPath, "update-backups");

  /** The pre-update check: what would stop the update, and which AI tools could fix it. */
  const runCheck = async (signal: AbortSignal): Promise<boolean> => {
    check = { state: "checking" };
    render();
    const [diagnosis, capabilities] = await Promise.allSettled([
      repairWorkflows({
        root: workspaceRoot,
        backupParent: backupParent(),
        signal,
        isCurrent,
        log,
      }),
      probeRepairTools(signal),
    ]);
    if (!isCurrent()) return false;
    repairTools =
      capabilities.status === "fulfilled"
        ? { tools: capabilities.value }
        : { tools: [], message: "AI の検出に失敗しました。もう一度確認してください。" };
    if (signal.aborted) {
      check = { state: "pending" };
      outcome = { text: "確認を中止しました。", error: false };
      return false;
    }
    if (diagnosis.status === "rejected") {
      check = {
        state: "failed",
        message: errorText(diagnosis.reason) || "チェックを完了できませんでした。",
      };
      return false;
    }
    const { problems, message } = diagnosis.value;
    check =
      problems.length > 0 ? { state: "problems", problems, message } : { state: "ok", message };
    return problems.length === 0;
  };

  /**
   * Whether Git still lists a file the recorded change touched. Without Git, or
   * without the list, it cannot tell, so the commit step stays.
   */
  const uncommitted = async (recorded: UpdateChange): Promise<boolean> => {
    if (recorded.files.length === 0) return true;
    const status = await gitStatusSnapshot(workspaceRoot);
    if (status === null) return true;
    const dirty = [...status.keys()];
    return recorded.files.some((file) =>
      dirty.some(
        (entry) =>
          entry === file ||
          (file.endsWith("/") && entry.startsWith(file)) ||
          (entry.endsWith("/") && file.startsWith(entry)),
      ),
    );
  };

  /** The shared files a finished update or pin changed, as Git sees them. */
  const commitChanges = async (
    kind: UpdateChange["kind"],
    before: Awaited<ReturnType<typeof gitStatusSnapshot>>,
  ) => {
    const after = await gitStatusSnapshot(workspaceRoot);
    change = {
      kind,
      files: before === null || after === null ? [] : changedSince(before, after),
      commitMessage: kind === "pin" ? pinCommitMessage(target) : updateCommitMessage(target),
    };
  };

  const applyUpdate = async (signal: AbortSignal, patches: LocalPatch[] = [], note = "") => {
    toolResults.clear();
    reportResults();
    const before = await gitStatusSnapshot(workspaceRoot, signal);
    const unapplied = patches.length
      ? ` 更新が完了していないため、独自パッチを当て直していません: ${patches.map((p) => p.path).join(", ")}。修正前のファイルはバックアップにあります。`
      : "";
    try {
      const result = await updateInstalledWorkflows({
        workspaceRoot,
        isCurrent,
        canRestore,
        signal,
        needsRepair: needsRepair(),
        setNeedsRepair: async (value) => {
          await context.workspaceState.update(repairKey, value);
        },
        log,
        onHarnessResult,
      });
      if (result.problems)
        check =
          result.problems.length > 0
            ? {
                state: "problems",
                problems: result.problems,
                message: `${result.problems.length} 件の問題があります。`,
              }
            : check.state === "problems"
              ? { state: "pending" }
              : check;
      let patchMessage = "";
      if (patches.length && result.ok) {
        const { applied, skipped } = reapplyLocalPatches(workspaceRoot, patches);
        if (applied.length)
          patchMessage += ` 独自パッチを当て直しました: ${applied.join(", ")}。次回の更新でも同じ手順で当て直します。`;
        if (skipped.length)
          patchMessage += ` 更新後のファイルが想定した公式版と異なるため、独自パッチを当て直していません: ${skipped.join(", ")}。修正前のファイルはバックアップにあります。`;
      } else if (patches.length) patchMessage = unapplied;
      const text = `${workflowsUpdateMessage(result, [...toolResults.values()])}${patchMessage}${note ? ` ${note}` : ""}`;
      outcome = { text, error: !result.ok };
      if (result.ok) await commitChanges("update", before);
    } catch (cause) {
      outcome = { text: `更新に失敗しました：${errorText(cause)}${unapplied}`, error: true };
    }
  };

  /** The update button: this PC's runtime if missing, the check if not yet run, then the update. */
  const updateProject = async () => {
    const signal = cancellation.signal;
    if (!runtimeReady()) {
      doing(`この PC に ${target} を準備しています…`);
      const prepared = await prepareTargetRuntime({ workspaceRoot, isCurrent, signal, log });
      if (!isCurrent()) return;
      if (!prepared.ok) {
        outcome = { text: cliUpdateMessage(prepared), error: true };
        return;
      }
      const runtime = readNativeInstall();
      if (runtime) configureCliEnvironment(context, runtime);
    }
    // A check that ran and failed was shown once; pressing update again goes ahead without it.
    if (check.state === "pending") {
      doing("更新前のチェックをしています…");
      initialCheckStarted = true;
      if (!(await runCheck(signal)) || !isCurrent()) return;
    }
    doing("プロジェクトを更新しています…");
    await applyUpdate(signal);
  };

  panel.onDidDispose(() => {
    disposed = true;
    cancellation.abort();
    repairCancellation?.abort();
    folderSubscription?.dispose();
  });
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!message || typeof message !== "object" || !isCurrent()) return;
    const { type } = message as { type?: unknown };
    if (type === "ready") {
      send({ type: "restore", log: logText });
      if (!focused && focusId !== undefined) send({ type: "focus", id: focusId });
      else if (refocus !== null) send({ type: "focus", id: refocus });
      focused = true;
      refocus = null;
      // The check runs by itself once, as soon as this PC can run it.
      if (busy || initialCheckStarted || check.state !== "pending") return;
      if (phase().name !== "update" || !runtimeReady()) return;
    } else if (type === "cancel-repair") {
      repairCancellation?.abort();
      return;
    } else if (type === "docs") {
      await env.openExternal(Uri.parse(INSTALL_GUIDE_URL));
      return;
    } else if (type === "copy-commit") {
      if (!change) return;
      await env.clipboard.writeText(change.commitMessage);
      void window.showInformationMessage("コミットメッセージをコピーしました。");
      return;
    } else if (type === "copy-rollback") {
      const guide = versionGateRollbackGuide(gateOf());
      if (!guide || guide.commands.length === 0) return;
      await env.clipboard.writeText(guide.commands.join("\n"));
      void window.showInformationMessage("コマンドをコピーしました。");
      return;
    } else if (type === "copy-diagnosis") {
      await env.clipboard.writeText(
        JSON.stringify(
          { target, problems: check.state === "problems" ? check.problems : [] },
          null,
          2,
        ),
      );
      return;
    } else if (type === "problem-file") {
      const index = (message as { index?: unknown }).index;
      const problem =
        check.state === "problems" && typeof index === "number" && Number.isInteger(index)
          ? check.problems[index]
          : undefined;
      if (!problem || problem.path === "設定全体") return;
      try {
        const document = await workspace.openTextDocument(
          Uri.file(repairPath(workspaceRoot, problem.path)),
        );
        await window.showTextDocument(document, { preview: true });
      } catch {
        void window.showErrorMessage("対象ファイルを開けません。診断情報を確認してください。");
      }
      return;
    } else if (type === "open-dashboard") {
      void commands.executeCommand("aidlc-guide.open");
      return;
    } else if (type === "open-scm") {
      void commands.executeCommand("workbench.view.scm");
      return;
    }
    if (busy) return;
    if (type === "install") {
      await commands.executeCommand("aidlc-guide.installWorkflows", workspaceRoot);
      return;
    }
    if (type === "setup") {
      await commands.executeCommand("aidlc-guide.setup", workspaceRoot);
      return;
    }
    if (type === "extension-update") {
      await commands.executeCommand("aidlc-guide.checkUpdate");
      return;
    }
    if (type === "refresh") {
      outcome = null;
      toolResults.clear();
      // Once the change is committed, the screen moves on from the commit step.
      if (change && !(await uncommitted(change))) change = null;
      if (phase().name !== "update" || !runtimeReady()) {
        settle();
        return;
      }
    }
    if (
      ![
        "ready",
        "refresh",
        "diagnose",
        "repair",
        "apply",
        "update-cli",
        "pin-project",
        "use-target",
        "doctor",
      ].includes(type as string)
    )
      return;
    busy = true;
    outcome = null;
    try {
      if (type === "ready" || type === "refresh" || type === "diagnose") {
        initialCheckStarted = true;
        repairCancellation = new AbortController();
        doing("更新前のチェックをしています…", true);
        await runCheck(AbortSignal.any([cancellation.signal, repairCancellation.signal]));
      } else if (type === "repair") {
        const tool = (message as { tool?: unknown }).tool;
        if (!REPAIR_TOOLS.some((candidate) => candidate === tool)) {
          outcome = { text: "修正に使う AI を選んでください。", error: true };
          return;
        }
        repairCancellation = new AbortController();
        const signal = AbortSignal.any([cancellation.signal, repairCancellation.signal]);
        doing("AI で直しています。終わったら、そのまま更新します…", true);
        await context.workspaceState.update(repairKey, true);
        const result = await repairWorkflows({
          root: workspaceRoot,
          backupParent: backupParent(),
          signal,
          isCurrent,
          log,
          tool: tool as (typeof REPAIR_TOOLS)[number],
        });
        if (!isCurrent()) return;
        const repaired = result.message + (result.backup ? ` バックアップ: ${result.backup}` : "");
        check =
          result.problems.length > 0
            ? { state: "problems", problems: result.problems, message: result.message }
            : { state: "ok", message: result.message };
        if (result.problems.length > 0 || signal.aborted) {
          outcome = { text: repaired, error: false };
          return;
        }
        doing("プロジェクトを更新しています…", true);
        await applyUpdate(signal, result.patches, repaired);
      } else if (type === "apply") {
        await updateProject();
      } else if (type === "update-cli") {
        const cli = inspectCli();
        const pinned = cli.projectPin ?? cli.projectVersion;
        // A fresh clone registers its existing pin; the machine default stays as it is.
        const register = cliRegistersPin(cli);
        if (!register && cli.confirmUpdate && pinned) {
          const choice = await window.showWarningMessage(
            cliUpdateConfirmMessage(pinned, cli.target),
            { modal: true },
            CLI_UPDATE_CONFIRM_ACTION,
          );
          if (!isCurrent()) return;
          if (choice !== CLI_UPDATE_CONFIRM_ACTION) {
            outcome = { text: "CLI の更新を中止しました。", error: false };
            return;
          }
          const latest = inspectCli();
          if (
            latest.confirmUpdate !== true ||
            (latest.projectPin ?? latest.projectVersion) !== pinned
          ) {
            outcome = {
              text: "固定バージョンが変わったため、CLI の更新を中止しました。",
              error: true,
            };
            return;
          }
        }
        doing(register ? "この PC に登録しています…" : `この PC に ${target} を導入しています…`);
        const result = await (register ? prepareProjectCli : updateMachineCli)({
          workspaceRoot,
          isCurrent,
          signal: cancellation.signal,
          log,
        });
        const runtime = result.ok && isCurrent() ? readNativeInstall() : null;
        if (runtime) configureCliEnvironment(context, runtime);
        outcome = { text: cliUpdateMessage(result), error: !result.ok };
      } else if (type === "pin-project" || type === "use-target") {
        const cli = inspectCli();
        const machine = cli.machineVersion;
        if (!cli.engineNewer || machine === null) {
          outcome = { text: "状況が変わりました。状態を再確認してください。", error: true };
          return;
        }
        const pin = type === "pin-project";
        const confirm = pin ? CLI_PIN_CONFIRM_ACTION : CLI_USE_TARGET_CONFIRM_ACTION;
        const choice = await window.showWarningMessage(
          pin
            ? cliPinConfirmMessage(machine, cli.target)
            : cliUseTargetConfirmMessage(machine, cli.target),
          { modal: true },
          confirm,
        );
        if (!isCurrent()) return;
        if (choice !== confirm) {
          outcome = { text: "中止しました。", error: false };
          return;
        }
        doing(pin ? "このプロジェクトを固定しています…" : "この PC の既定を戻しています…");
        const before = pin ? await gitStatusSnapshot(workspaceRoot, cancellation.signal) : null;
        const result = await (pin ? pinProjectCli : useTargetCli)({
          workspaceRoot,
          isCurrent,
          signal: cancellation.signal,
          log,
        });
        const runtime = result.ok && isCurrent() ? readNativeInstall() : null;
        if (runtime) configureCliEnvironment(context, runtime);
        outcome = { text: cliUpdateMessage(result), error: !result.ok };
        if (pin && result.ok) await commitChanges("pin", before);
      } else if (type === "doctor") {
        doing("Doctor で診断しています…");
        toolResults.clear();
        reportResults();
        const result = await diagnoseInstalledWorkflows({
          workspaceRoot,
          isCurrent,
          signal: cancellation.signal,
          log,
          setNeedsRepair: async (value) => {
            await context.workspaceState.update(repairKey, value);
          },
          onHarnessResult,
        });
        outcome = { text: result.message, error: !result.ok };
      }
    } catch (cause) {
      outcome = {
        text: `処理の完了を確認できません。状態を再確認してください：${errorText(cause)}`,
        error: true,
      };
    } finally {
      busy = false;
      activity = null;
      repairCancellation = undefined;
      refocus = settle() ? (type === "ready" ? (focusId ?? "status") : "status") : null;
    }
  });
  render();
}

const promptJobs = new Map<string, { job: Promise<void>; isCurrent: () => boolean }>();
export async function maybePromptWorkflowsUpdate(
  context: ExtensionContext,
  workspaceRoot: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  const previous = promptJobs.get(workspaceRoot);
  if (previous?.isCurrent()) return previous.job;
  const job = promptOnce(context, workspaceRoot, isCurrent);
  promptJobs.set(workspaceRoot, { job, isCurrent });
  try {
    await job;
  } finally {
    if (promptJobs.get(workspaceRoot)?.job === job) promptJobs.delete(workspaceRoot);
  }
}

/** Run the one action the version check asks for (docs/maintenance/version-gate-design.md). */
export async function runVersionGateAction(
  context: ExtensionContext,
  root: string,
  action: VersionGateAction,
): Promise<void> {
  if (action === "update-guide") await commands.executeCommand("aidlc-guide.checkUpdate");
  else if (action === "setup") await commands.executeCommand("aidlc-guide.setup", root);
  else await openWorkflowsUpdatePanel(context, root, action);
}

async function promptOnce(
  context: ExtensionContext,
  root: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent() || !workspace.isTrusted || !isOpenFolder(root)) return;
  const gate = inspectVersionGate(root, WORKFLOWS_TARGET_VERSION);
  // A project without aidlc is setup's job; the dashboard says so when opened.
  if (gate.status !== "ok" && gate.status !== "not-installed") {
    const action = VERSION_GATE_ACTIONS[gate.status];
    const label = versionGateActionLabel(action, WORKFLOWS_TARGET_VERSION);
    // No "later": the Guide stays blocked until the versions match, so there is nothing to defer to.
    const pick = await window.showWarningMessage(
      `AIDLC Guide を使うには更新が必要です。${gate.message}`,
      label,
    );
    if (!isCurrent() || !workspace.isTrusted || !isOpenFolder(root)) return;
    if (pick === label) await runVersionGateAction(context, root, action);
    return;
  }
  const state = inspectWorkflowsManagement(
    root,
    context.workspaceState.get<boolean>(workflowsRepairKey(root)) === true,
  );
  if (!state.updateRetryNeeded) return;
  const pick = await window.showInformationMessage(
    `AIDLC Guide: ${state.message}`,
    "アップデートする",
  );
  if (!isCurrent() || !workspace.isTrusted || !isOpenFolder(root)) return;
  if (pick === "アップデートする") await openWorkflowsUpdatePanel(context, root);
}

export { UPDATE_WORKFLOWS_COMMAND };
