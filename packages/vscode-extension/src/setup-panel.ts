import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  commands,
  type ExtensionContext,
  env,
  Uri,
  ViewColumn,
  type WebviewPanel,
  window,
  workspace,
} from "vscode";
import { configureCliEnvironment, openCliTerminal } from "./cli-environment.ts";
import {
  CLI_UPDATE_CONFIRM_ACTION,
  cliUpdateConfirmMessage,
  prepareProjectCli,
  updateMachineCli,
} from "./cli-management.ts";
import type { NativeDoctorReport } from "./doctor-output.ts";
import { CODEX_GIT_REQUIRED, isGitRepository } from "./git-prerequisite.ts";
import { HARNESS_LABELS, type HarnessId } from "./harness-detect.ts";
import { docsSkillPath, mcpScriptPath, refreshDocsRegistration } from "./mcp-register.ts";
import {
  INSTALL_GUIDE_URL,
  runNativeDoctor,
  runSetupProcess,
  type SetupRunner,
} from "./native-setup.ts";
import { setupHtml } from "./setup-html.ts";
import { inspectSetup, needsSetup, type SetupPreference, setupStateKey } from "./setup-state.ts";
import { installWorkflows, type WorkflowsHarnessInstallResult } from "./workflows-install.ts";
import { workflowsRepairKey } from "./workflows-operation.ts";
import { harnessVersionRel } from "./workflows-version.ts";

type HarnessDoctorReport = { id: HarnessId; report: NativeDoctorReport };

type SetupView = { panel: WebviewPanel; addTools: () => void };

const panels = new Map<string, SetupView>();
const runningRoots = new Set<string>();
const HARNESS_IDS = new Set(Object.keys(HARNESS_LABELS));
const isOpenFolder = (root: string): boolean =>
  workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === root) ?? false;

/** One setup tab per folder, shared by the Open and Setup commands. */
export async function openSetupPanel(context: ExtensionContext, root: string): Promise<void> {
  return openSetupView(context, root, false);
}

/** Settings opens the same tab with the "add tools" selection open in its last step. */
export async function openWorkflowsInstallPanel(
  context: ExtensionContext,
  root: string,
): Promise<void> {
  return openSetupView(context, root, true);
}

async function openSetupView(
  context: ExtensionContext,
  root: string,
  addTools: boolean,
): Promise<void> {
  if (!isOpenFolder(root)) return;
  const existing = panels.get(root);
  if (existing) {
    existing.panel.reveal(ViewColumn.One);
    if (addTools) existing.addTools();
    return;
  }
  const panel = window.createWebviewPanel("andon.setup", "Andon セットアップ", ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  let disposed = false;
  let validFolder = true;
  const cancellation = new AbortController();
  const canRestore = () => validFolder && isOpenFolder(root) && workspace.isTrusted;
  const canWrite = () => !disposed && canRestore();
  const savePreference = async (next: SetupPreference): Promise<boolean> => {
    if (!canWrite()) return false;
    const key = setupStateKey(root);
    const previous = context.workspaceState.get<SetupPreference>(key);
    await context.workspaceState.update(key, next);
    if (canWrite()) return true;
    // Preserve a newer setting from another command while rolling back our cancelled completion.
    if (JSON.stringify(context.workspaceState.get(key)) === JSON.stringify(next))
      await context.workspaceState.update(key, previous);
    return false;
  };
  let busy = false;
  let selected: HarnessId[] = [/cursor/i.test(env.appName) ? "cursor" : "claude"];
  let selectedInitialized = false;
  // Keep the first-time flow available when adding several tools succeeds only partly.
  let creatingProject = false;
  // The "add tools" selection in the last step; it replaces the former separate install tab.
  let adding = addTools;
  // The last rendered page without its nonce, so an unchanged state does not reload the webview.
  let shown = "";
  let logText = "";
  let statusText = "";
  let statusError = false;
  let doctorReport: NativeDoctorReport | null = null;
  let doctorReports: HarnessDoctorReport[] = [];
  let doctorRunning = false;
  let installResults: WorkflowsHarnessInstallResult[] = [];
  // Only the newest read may draw, so a slow older read cannot bring back a stale page.
  let renderVersion = 0;
  const send = (message: unknown) => {
    if (!disposed) void panel.webview.postMessage(message);
  };
  const log = (text: string) => {
    logText = `${logText}${text}\n`.slice(-60000);
    send({ type: "log", text });
  };
  const status = (text: string, error = false) => {
    statusText = text;
    statusError = error;
    send({ type: "status", text, error });
  };
  const showDoctorReport = (report: NativeDoctorReport) => {
    doctorRunning = false;
    doctorReport = report;
    doctorReports = [];
    send({ type: "doctor-report", report });
  };
  const doctorUnavailable = (summary: string, rawOutput = "", version = "不明") => {
    showDoctorReport({
      version,
      executedAt: new Date().toISOString(),
      outcome: "unavailable",
      summary,
      checks: [],
      counts: null,
      rawOutput,
      unparsedOutput: [],
    });
    status(summary, true);
  };
  /** False when a newer read replaced this one; that read reports its own result. */
  const render = async (): Promise<boolean> => {
    const version = ++renderVersion;
    const state = await inspectSetup(context, root).catch((error: unknown) => {
      if (version === renderVersion) throw error;
      return undefined;
    });
    if (!state || disposed || version !== renderVersion) return false;
    if (canWrite() && state.native && state.cli?.setupReady)
      configureCliEnvironment(context, state.native);
    if (!selectedInitialized) {
      const saved =
        state.preference?.harnesses ??
        (state.preference?.harness ? [state.preference.harness] : []);
      const available = saved.filter(
        (id) =>
          HARNESS_IDS.has(id) && (state.harnesses.length === 0 || state.harnesses.includes(id)),
      );
      selected =
        available.length > 0 ? available : state.harnesses.length > 0 ? state.harnesses : selected;
      selectedInitialized = true;
    }
    selected = [...new Set([...selected, ...state.harnesses])];
    const html = (nonce: string) =>
      setupHtml(state, {
        selected,
        trusted: workspace.isTrusted,
        nonce,
        extensionVersion: context.extension?.packageJSON.version,
        creatingProject,
        adding,
      });
    const page = html("");
    if (page === shown) return true;
    shown = page;
    panel.webview.html = html(randomBytes(18).toString("hex"));
    return true;
  };
  const rerender = () => render().catch((error) => status(String(error), true));
  panels.set(root, {
    panel,
    addTools: () => {
      adding = true;
      void rerender();
    },
  });
  const dispose = panel.onDidDispose(() => {
    disposed = true;
    cancellation.abort(new Error("プロジェクトの設定を中止しました。"));
    panels.delete(root);
  });
  context.subscriptions.push(panel, dispose);
  const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (typeof message !== "object" || message === null || disposed || !isOpenFolder(root)) return;
    const msg = message as Record<string, unknown>;
    if (typeof msg.type !== "string") return;
    if (msg.type === "ready") {
      send({
        type: "restore",
        log: logText,
        text: statusText,
        error: statusError,
        doctorReport,
        doctorReports,
        installResults,
      });
      if (doctorRunning) send({ type: "doctor-running" });
      send({ type: "busy", value: busy });
      return;
    }
    if (msg.type === "docs") {
      await env.openExternal(Uri.parse(INSTALL_GUIDE_URL));
      return;
    }
    if (busy) return;
    if (msg.type === "open-workflows-update") {
      await commands.executeCommand("andon.updateWorkflows", root);
      return;
    }
    if (msg.type === "trust") {
      await commands.executeCommand("workbench.trust.manage");
      return;
    }
    if (msg.type === "add-tools" || msg.type === "cancel-add" || msg.type === "skip-failed") {
      adding = msg.type === "add-tools";
      // Leave the selection to what is installed; a failed tool is dropped instead of retried.
      if (msg.type !== "add-tools") selected = [];
      await rerender();
      return;
    }
    if (msg.type === "recheck") {
      try {
        if (await render()) status("現在の状態を確認しました。");
      } catch (error) {
        status(String(error), true);
      }
      return;
    }
    if ("harnesses" in msg) {
      if (
        !Array.isArray(msg.harnesses) ||
        msg.harnesses.some((id) => typeof id !== "string" || !HARNESS_IDS.has(id))
      ) {
        status("インストールするツールの選択を確認してください。", true);
        return;
      }
      selected = [...new Set(msg.harnesses)] as HarnessId[];
    }
    if (msg.type === "select-harnesses") return;
    if (!["prepare-cli", "cli-terminal", "install", "run-doctor", "finish"].includes(msg.type))
      return;
    // The tool picker replaces the finish button; a click from the page it replaces is stale.
    if (msg.type === "finish" && adding) return;
    if (runningRoots.has(root)) {
      status(
        "このフォルダのセットアップは実行中です。終わってから、もう一度実行してください。",
        true,
      );
      return;
    }
    if (!workspace.isTrusted) {
      status("ワークスペースを信頼してから、設定を実行してください。", true);
      return;
    }
    let approvedPin: string | undefined;
    if (msg.type === "prepare-cli") {
      const preview = await inspectSetup(context, root);
      if (!canWrite()) return;
      const pinned = preview.cli?.projectPin ?? preview.cli?.projectVersion ?? undefined;
      if (preview.cli?.confirmUpdate && pinned) {
        const choice = await window.showWarningMessage(
          cliUpdateConfirmMessage(pinned, preview.cli.target),
          { modal: true },
          CLI_UPDATE_CONFIRM_ACTION,
        );
        if (!canWrite()) return;
        if (choice !== CLI_UPDATE_CONFIRM_ACTION) {
          status("CLI の更新を中止しました。");
          return;
        }
        approvedPin = pinned;
      }
    }
    busy = true;
    runningRoots.add(root);
    send({ type: "busy", value: true });
    try {
      const state = await inspectSetup(context, root);
      if (!canWrite()) return;
      if (selected.includes("codex") && msg.type === "finish") {
        if (!(await isGitRepository(root, cancellation.signal)))
          throw new Error(CODEX_GIT_REQUIRED);
        if (!canWrite()) return;
      }
      if (msg.type === "cli-terminal") {
        if (!state.native || !state.cli?.setupReady)
          throw new Error("先に CLI の準備を完了してください。");
        openCliTerminal(context, state.native, root);
        status(
          "新しいターミナルで CLI のバージョン確認を実行しました。表示されたバージョンを確認してください。",
        );
      } else if (msg.type === "prepare-cli") {
        status("このプロジェクトで使う CLI を準備しています…");
        const currentPin = state.cli?.projectPin ?? state.cli?.projectVersion ?? undefined;
        if (approvedPin !== undefined) {
          if (currentPin !== approvedPin || state.cli?.confirmUpdate !== true) {
            status("固定バージョンが変わったため、CLI の更新を中止しました。");
            return;
          }
        } else if (state.cli?.confirmUpdate === true) {
          status("状態が変わったため、CLI の準備を中止しました。");
          return;
        }
        const manageCli = approvedPin !== undefined ? updateMachineCli : prepareProjectCli;
        const result = await manageCli({
          workspaceRoot: root,
          log,
          signal: cancellation.signal,
          isCurrent: canWrite,
        });
        if (!canWrite()) return;
        status(
          [result.message, result.details, result.nextAction].filter(Boolean).join("\n"),
          !result.ok,
        );
      } else if (msg.type === "install") {
        if (!(state.cli?.setupReady ?? state.native !== null))
          throw new Error("先に「このマシンの CLI」の手順で CLI をインストールしてください。");
        if (state.harnesses.length > 0 && !creatingProject && !adding)
          throw new Error(
            "このプロジェクトは設定済みです。ツールを追加する場合は「ツールを追加」を押してください。",
          );
        if (state.harnesses.length === 0) creatingProject = true;
        status("AI-DLC を準備しています…");
        installResults = [];
        send({ type: "install-results", results: installResults });
        const result = await installWorkflows({
          needsRepair: context.workspaceState.get<boolean>(workflowsRepairKey(root)) === true,
          workspaceRoot: root,
          selected,
          log,
          signal: cancellation.signal,
          isCurrent: canWrite,
          canRestore,
          onHarnessResult: (entry) => {
            if (!canWrite()) return;
            installResults.push(entry);
            send({ type: "install-results", results: installResults });
            if (entry.doctorReport) showDoctorReport(entry.doctorReport);
          },
        });
        if (!canWrite()) return;
        installResults = result.harnesses;
        status(result.message, !result.ok);
        const failed = result.harnesses
          .filter((entry) => entry.status === "failed")
          .map((entry) => entry.id);
        if (failed.length > 0) selected = failed;
        else if (result.ok) adding = false;
      } else if (msg.type === "run-doctor") {
        doctorReport = null;
        doctorReports = [];
        doctorRunning = true;
        send({ type: "doctor-running" });
        status("環境を診断しています…");
        // inspectSetup resolves the project's registered pin, not the machine-active version.
        if (!state.native) {
          doctorUnavailable(
            state.runtimeIssue ??
              "診断に使用する AI-DLC CLI が見つかりません。「AI-DLC CLI をセットアップする」で導入・設定を確認してください。",
            "",
            state.version ?? "不明",
          );
        } else if (state.harnesses.length > 0) {
          const reports: HarnessDoctorReport[] = [];
          for (const id of new Set(state.harnesses)) {
            status(`${HARNESS_LABELS[id]} の環境を診断しています…`);
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
            const report = await runNativeDoctor(state.native, root, runner, {
              signal: cancellation.signal,
              isCurrent: canWrite,
            });
            if (!canWrite()) return;
            reports.push({ id, report });
          }
          // Publish only a complete run: a cancelled later tool must not leave an all-clear result.
          doctorRunning = false;
          doctorReports = reports;
          send({ type: "doctor-reports", reports });
          const failed = reports.filter(
            ({ report }) => report.outcome === "failed" || report.outcome === "unavailable",
          );
          const warnings = reports.some(({ report }) => report.outcome === "warning");
          status(
            `${reports.length} 個のツールの診断が完了しました。${
              failed.length > 0
                ? `${failed.map(({ id }) => HARNESS_LABELS[id]).join("、")} の診断結果を確認してください。`
                : warnings
                  ? "確認が必要な項目があります。"
                  : "問題はありません。"
            }`,
            failed.length > 0,
          );
        } else {
          const report = await runNativeDoctor(state.native, root, undefined, {
            signal: cancellation.signal,
            isCurrent: canWrite,
          });
          if (!canWrite()) return;
          showDoctorReport(report);
          status(report.summary, report.outcome === "unavailable" || report.outcome === "failed");
        }
      } else if (msg.type === "finish") {
        if (!state.configured || !(state.cli?.setupReady ?? state.native !== null))
          throw new Error(
            "AI-DLC の設定を確認できません。セットアップ画面に表示されている手順を確認してください。",
          );
        if (selected.length === 0 || selected.some((id) => !state.harnesses.includes(id)))
          throw new Error("選択したツールの設定を完了してから、セットアップを終了してください。");
        if (
          !(await savePreference({
            completed: true,
            docsSkipped: !state.docsReady,
            harness: selected[0] ?? state.harnesses[0] ?? "claude",
            harnesses: selected,
          }))
        )
          return;
        const { openDashboardPanel } = await import("./dashboard-panel.ts");
        if (!canWrite()) return;
        openDashboardPanel(context, root);
        panel.dispose();
        return;
      }
      await render();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (canWrite() && msg.type === "run-doctor") {
        doctorUnavailable("診断を実行できませんでした。原文で詳細を確認してください。", text);
        return;
      }
      if (!canWrite() && text.includes("rollback-conflict:"))
        void window.showErrorMessage(
          `セットアップを中止しました。途中で変更されたファイルは復元せず保持しています: ${text}`,
        );
      status(text, true);
      log(text);
    } finally {
      doctorRunning = false;
      busy = false;
      runningRoots.delete(root);
      send({ type: "busy", value: false });
    }
  });
  const trust = workspace.onDidGrantWorkspaceTrust(() => {
    void rerender();
  });
  const folders = workspace.onDidChangeWorkspaceFolders(() => {
    if (!isOpenFolder(root)) {
      validFolder = false;
      panel.dispose();
    }
  });
  // Coming back to the tab re-reads the folder, which replaces a manual "recheck" button.
  const visible = panel.onDidChangeViewState(({ webviewPanel }) => {
    if (webviewPanel.visible && !busy) void rerender();
  });
  context.subscriptions.push(messages, trust, folders, visible);
  panel.onDidDispose(() => {
    messages.dispose();
    trust.dispose();
    folders.dispose();
    visible.dispose();
  });
  await render();
}

/** Open directly when setup is incomplete. Closing the tab does not mark setup complete. */
export async function maybePromptSetup(
  context: ExtensionContext,
  root: string,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  try {
    if (!isCurrent()) return false;
    if (context.workspaceState.get<SetupPreference>(setupStateKey(root))?.completed) return false;
    if (workspace.isTrusted) {
      const registration = await refreshDocsRegistration(
        root,
        mcpScriptPath(context.extensionPath),
        docsSkillPath(context.extensionPath),
      );
      if (!isCurrent()) return false;
      if (registration.updated)
        void window.showInformationMessage(
          "Andon: 登録済みの文書参照連携を更新しました。AI セッションを再起動してください。",
        );
    }
    const state = await inspectSetup(context, root);
    if (!isCurrent() || !needsSetup(state)) return false;
    await openSetupPanel(context, root);
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    void window.showErrorMessage(
      `セットアップ状態の確認に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
    return true;
  }
}
