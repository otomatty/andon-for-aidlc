import path from "node:path";
import type { OnboardingView } from "@andon/shared-types";
import { commands, type ExtensionContext, window, workspace } from "vscode";
import { openDashboardPanel } from "./dashboard-panel.ts";
import { setBundledPluginStore } from "./native-plugin-inputs.ts";
import { setAdminInstallConfirm } from "./native-setup.ts";
import { closeAllSessions, disposeAllSessions } from "./guide-session.ts";
import {
  docsSkillPath,
  mcpScriptPath,
  refreshDocsRegistration,
  registerMcp,
} from "./mcp-register.ts";
import { extensionVersion, startOnboarding, updateNotice, WHATS_NEW_ACTION } from "./onboarding.ts";
import { maybePromptSetup, openSetupPanel, openWorkflowsInstallPanel } from "./setup-panel.ts";
import { inspectSetup, needsSetup, type SetupPreference, setupStateKey } from "./setup-state.ts";
import { createStatusBar, startStatusBarRefresh } from "./status-bar.ts";
import {
  maybePromptWorkflowsUpdate,
  openWorkflowsUpdatePanel,
  UPDATE_WORKFLOWS_COMMAND,
} from "./workflows-update-panel.ts";

const SHOW_WELCOME_COMMAND = "andon.showWelcome";
const SHOW_WHATS_NEW_COMMAND = "andon.showWhatsNew";
const OPEN_PLUGINS_COMMAND = "andon.openPlugins";

function primaryRoot(): string | undefined {
  return workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Record the running version and, after an update, point at 更新情報 once.
 * The dashboard shows the same changes when it next opens, so a dismissed
 * notification loses nothing.
 */
async function announceOnboarding(context: ExtensionContext): Promise<void> {
  const version = extensionVersion(context);
  const roots = workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  const start = await startOnboarding(context, version);
  const notice = updateNotice(start, version);
  // Without a folder there is no dashboard to open the changes in.
  if (notice === null || roots.length === 0) return;
  const choice = await window.showInformationMessage(notice, WHATS_NEW_ACTION);
  if (choice === WHATS_NEW_ACTION) await commands.executeCommand(SHOW_WHATS_NEW_COMMAND);
}

/** Register manual UI commands and maintain status and managed docs for trusted workspaces. */
const CONTINUE_AS_ADMIN = "管理者として導入を続ける";

export async function activate(context: ExtensionContext): Promise<void> {
  createStatusBar(context);
  // Plugins installed from the bundle keep their package here, outside the extension folder an
  // update replaces, so adding a tool later can still prove the composed bytes.
  if (context.globalStorageUri !== undefined)
    setBundledPluginStore(path.join(context.globalStorageUri.fsPath, "plugins"));
  // The official installer asks before installing from an elevated window; the Guide asks here.
  setAdminInstallConfirm(
    async (warning, advice) =>
      (await window.showWarningMessage(
        warning,
        { modal: true, detail: advice },
        CONTINUE_AS_ADMIN,
      )) === CONTINUE_AS_ADMIN,
  );
  context.subscriptions.push({ dispose: () => setAdminInstallConfirm(undefined) });

  const openDashboard = async (view?: OnboardingView): Promise<void> => {
    const ws = primaryRoot();
    if (ws === undefined) {
      void window.showErrorMessage("ワークスペースを開いてください。");
      return;
    }
    const isCurrent = () => primaryRoot() === ws;
    if (!(await maybePromptSetup(context, ws, isCurrent)) && isCurrent()) {
      if (view === undefined) openDashboardPanel(context, ws);
      else openDashboardPanel(context, ws, { open: view });
    }
  };

  context.subscriptions.push(
    commands.registerCommand("andon.open", () => openDashboard()),

    commands.registerCommand(SHOW_WELCOME_COMMAND, () => openDashboard("welcome")),

    commands.registerCommand(SHOW_WHATS_NEW_COMMAND, () => openDashboard("whats-new")),

    commands.registerCommand(OPEN_PLUGINS_COMMAND, () => openDashboard("plugins")),

    commands.registerCommand("andon.setup", (requestedRoot?: unknown) => {
      const ws = requestedRoot === undefined ? primaryRoot() : requestedRoot;
      if (ws === undefined) {
        void window.showErrorMessage("ワークスペースを開いてください。");
        return;
      }
      if (
        typeof ws !== "string" ||
        !workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === ws)
      ) {
        void window.showErrorMessage("セットアップ対象のワークスペースを開き直してください。");
        return;
      }
      void openSetupPanel(context, ws);
    }),

    commands.registerCommand("andon.installWorkflows", (requestedRoot?: unknown) => {
      const ws = requestedRoot === undefined ? primaryRoot() : requestedRoot;
      if (ws === undefined) {
        void window.showErrorMessage("ワークスペースを開いてください。");
        return;
      }
      if (
        typeof ws !== "string" ||
        !workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === ws)
      ) {
        void window.showErrorMessage("インストール対象のワークスペースを開き直してください。");
        return;
      }
      if (!workspace.isTrusted) {
        void window.showErrorMessage(
          "ワークスペースを信頼してから、ワークフローをインストールしてください。",
        );
        return;
      }
      void openWorkflowsInstallPanel(context, ws);
    }),

    commands.registerCommand("andon.registerMcp", async () => {
      const ws = primaryRoot();
      if (ws === undefined) return;
      if (!workspace.isTrusted) {
        void window.showErrorMessage("ワークスペースを信頼してから登録してください。");
        return;
      }
      const result = await registerMcp(
        ws,
        mcpScriptPath(context.extensionPath),
        docsSkillPath(context.extensionPath),
      );
      if (result.ok) {
        const preference = context.workspaceState.get<SetupPreference>(setupStateKey(ws));
        if (preference)
          await context.workspaceState.update(setupStateKey(ws), {
            ...preference,
            docsSkipped: false,
          });
        void window.showInformationMessage(
          "MCP と Claude Code / Cursor の文書参照 Skill を登録しました。AI セッションを再起動すると、AI-DLC の質問で文書を参照します。",
        );
      } else {
        void window.showErrorMessage(`MCP 登録失敗: ${result.reason}`);
      }
    }),

    commands.registerCommand(UPDATE_WORKFLOWS_COMMAND, (requestedRoot?: unknown) => {
      const ws = requestedRoot === undefined ? primaryRoot() : requestedRoot;
      if (ws === undefined) {
        void window.showErrorMessage("ワークスペースを開いてください。");
        return;
      }
      if (
        typeof ws !== "string" ||
        !workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === ws)
      ) {
        void window.showErrorMessage("更新対象のワークスペースを開き直してください。");
        return;
      }
      if (!workspace.isTrusted) {
        void window.showErrorMessage(
          "ワークスペースを信頼してから、ワークフローを更新してください。",
        );
        return;
      }
      void openWorkflowsUpdatePanel(context, ws);
    }),

    { dispose: () => disposeAllSessions() },
  );

  void announceOnboarding(context).catch((error: unknown) => {
    // Onboarding is an aid; storage trouble must not stop activation.
    console.warn("Andon: オンボーディングの状態を初期化できませんでした。", error);
  });

  let refreshingRoot: string | undefined;
  let stopRefresh: { dispose(): void } | undefined;
  let generation = 0;
  const initializeRoot = async () => {
    const currentGeneration = ++generation;
    const root = primaryRoot();
    if (root === undefined) {
      stopRefresh?.dispose();
      refreshingRoot = undefined;
      return;
    }
    if (workspace.isTrusted && refreshingRoot !== root) {
      stopRefresh?.dispose();
      refreshingRoot = root;
      stopRefresh = startStatusBarRefresh(context, root);
    }
    const isCurrent = () => currentGeneration === generation && root === primaryRoot();
    if (!workspace.isTrusted) return;
    // Extension upgrades move the bundled MCP script; repair managed registrations
    // independently of opening setup, including when setup is still incomplete.
    const registration = await refreshDocsRegistration(
      root,
      mcpScriptPath(context.extensionPath),
      docsSkillPath(context.extensionPath),
    );
    if (!isCurrent() || !workspace.isTrusted) return;
    if (registration.updated)
      void window.showInformationMessage(
        "Andon: 登録済みの文書参照連携を更新しました。AI セッションを再起動してください。",
      );
    const setup = await inspectSetup(context, root);
    if (isCurrent() && !needsSetup(setup) && workspace.isTrusted)
      await maybePromptWorkflowsUpdate(context, root, isCurrent);
  };
  const initialize = () => {
    void initializeRoot().catch((error) => {
      void window.showErrorMessage(`Andon の起動に失敗しました: ${String(error)}`);
    });
  };
  context.subscriptions.push(
    {
      dispose: () => {
        generation++;
        stopRefresh?.dispose();
      },
    },
    workspace.onDidChangeWorkspaceFolders(initialize),
    workspace.onDidGrantWorkspaceTrust(initialize),
  );
  initialize();
}

export function deactivate(): Promise<void> {
  return closeAllSessions();
}
