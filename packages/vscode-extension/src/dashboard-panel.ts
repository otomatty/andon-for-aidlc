import path from "node:path";
import { inspectVersionGate } from "@andon/reader-core";
import {
  BUNDLED_PLUGINS,
  type OnboardingView,
  VERSION_GATE_ACTIONS,
  type VersionGateAction,
  WORKFLOWS_TARGET_VERSION,
} from "@andon/shared-types";
import {
  commands,
  type ExtensionContext,
  env,
  Uri,
  ViewColumn,
  type Webview,
  window,
  workspace,
} from "vscode";
import { runInTerminal } from "./commands.ts";
import { buildComposeCommand } from "./compose-command.ts";
import { loadDashboardHtml } from "./dashboard-html.ts";
import {
  loadDocsConversation,
  parseDocsConversation,
  saveDocsConversation,
} from "./docs-conversation.ts";
import { onPath } from "./doctor.ts";
import { acquireSession, persistSelectedIntent } from "./guide-session.ts";
import { resolveOfficialDocsRoot } from "./official-docs-root.ts";
import { extensionVersion, onboardingSnapshot, recordOnboardingEvent } from "./onboarding.ts";
import { openFileRef } from "./open-file.ts";
import {
  getLastOfficialDocsLocale,
  handleOpenOfficialDoc,
  injectDocsShellDeepLink,
  OFFICIAL_DOCS_LOCALE_KEY,
} from "./open-official-doc.ts";
import { inspectWorkflowsManagement } from "./workflows-management.ts";
import { onWorkflowsChanged, workflowsRepairKey } from "./workflows-operation.ts";
import { maybePromptWorkflowsUpdate, runVersionGateAction } from "./workflows-update-panel.ts";
import { readNativeInstall } from "./native-setup.ts";
import { createPluginsController, type PluginsController } from "./plugins-controller.ts";
import { registerApplyLatestCommand } from "./write-global-vsix.ts";

export { registerApplyLatestCommand };

registerApplyLatestCommand();

const PANEL_VIEW_TYPE = "andon.dashboard";

/** Actions a webview may ask for; anything else it posts is ignored. */
const VERSION_GATE_ACTION_NAMES: ReadonlySet<string> = new Set(Object.values(VERSION_GATE_ACTIONS));

const NOW_DISCLOSURE_KEY = "andon.nowExpanded";

/** Options for one dashboard panel. */
export interface DashboardPanelOptions {
  /** Open the welcome page or the 更新情報 sheet once the panel is ready. */
  open?: OnboardingView;
}

function mediaRoot(context: ExtensionContext): string {
  return path.join(context.extensionPath, "media", "dashboard");
}

function wireWebview(
  webview: Webview,
  workspaceRoot: string,
  officialDocsRoot: string,
  context: ExtensionContext,
  requestedView?: OnboardingView,
): () => void {
  const lease = acquireSession(workspaceRoot, officialDocsRoot, persistSelectedIntent(context));
  const { session } = lease;
  const unsubscribe = session.subscribe(webview);
  let settingsReady = false;
  // A command asks for its view once; a webview reload must not reopen it.
  let pendingView = requestedView;
  const sendOnboarding = () => {
    // Onboarding is an aid: unreadable storage must not stop the dashboard.
    try {
      const state = onboardingSnapshot(context, extensionVersion(context), pendingView);
      pendingView = undefined;
      void webview.postMessage({ type: "onboarding", state });
    } catch (cause) {
      console.warn("Andon: オンボーディングの状態を読み込めませんでした。", cause);
    }
  };
  const sendWorkflowsState = () => {
    if (!settingsReady) return;
    try {
      void webview.postMessage({
        type: "workflows-management",
        state: inspectWorkflowsManagement(
          workspaceRoot,
          context.workspaceState.get<boolean>(workflowsRepairKey(workspaceRoot)) === true,
        ),
      });
    } catch (cause) {
      void webview.postMessage({
        type: "workflows-management-error",
        message: `設定状態を確認できません：${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  };
  // The 「プラグイン」 page's controller, made when the page first speaks.
  let plugins: PluginsController | null = null;
  const pluginsController = (): PluginsController => {
    plugins ??= createPluginsController({
      root: workspaceRoot,
      bundles: path.join(context.extensionPath, "dist", "plugins"),
      store: path.join(context.globalStorageUri.fsPath, "plugins"),
      catalog: BUNDLED_PLUGINS.plugins,
      post: (message) => void webview.postMessage(message),
      isTrusted: () => workspace.isTrusted,
      isOpen: () =>
        workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === workspaceRoot) ?? false,
      gateOk: () => inspectVersionGate(workspaceRoot, WORKFLOWS_TARGET_VERSION).status === "ok",
      readInstall: () => readNativeInstall(workspaceRoot),
      copy: async (text) => {
        await env.clipboard.writeText(text);
        void window.showInformationMessage(
          "始めるコマンドをコピーしました。Claude Code に貼り付け、チケット番号と要約を書き換えてください。",
        );
      },
    });
    return plugins;
  };
  const unsubscribeWorkflows = onWorkflowsChanged(() => {
    sendWorkflowsState();
    void plugins?.refresh();
  });

  const sub = webview.onDidReceiveMessage(async (message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const msg = message as Record<string, unknown>;

    if (typeof msg.type === "string" && msg.type.startsWith("plugins-")) {
      await pluginsController().receive(message);
      return;
    }

    // Restore display preferences when the webview transport initializes.
    if (msg.type === "ready") {
      void webview.postMessage({
        type: "official-docs-locale",
        locale: getLastOfficialDocsLocale(context),
      });
      void webview.postMessage({
        type: "docs-conversation",
        state: loadDocsConversation(context),
      });
      sendOnboarding();
      void webview.postMessage({
        type: "now-disclosure",
        expanded: context.workspaceState.get<unknown>(NOW_DISCLOSURE_KEY) === true,
      });
      return;
    }

    if (msg.type === "now-disclosure" && typeof msg.expanded === "boolean") {
      try {
        await context.workspaceState.update(NOW_DISCLOSURE_KEY, msg.expanded);
      } catch {
        void window.showWarningMessage(
          "現在地情報の開閉状態を保存できませんでした。次回起動時に今回の変更が反映されない可能性があります。",
        );
      }
      return;
    }

    if (msg.type === "onboarding-event") {
      try {
        await recordOnboardingEvent(context, extensionVersion(context), msg.event);
      } catch (cause) {
        // A lost flag only shows a tip or the change list once more.
        console.warn("Andon: オンボーディングの状態を保存できませんでした。", cause);
      }
      return;
    }

    if (msg.type === "docs-conversation") {
      try {
        await saveDocsConversation(context, parseDocsConversation(msg.state));
      } catch {
        void window.showWarningMessage(
          "ドキュメントの会話を保存できませんでした。次回起動時に今回の会話が残らない可能性があります。",
        );
      }
      return;
    }

    // LocaleControl → host persist (reload / ready bootstrap must keep choice).
    if (msg.type === "official-docs-locale" && (msg.locale === "en" || msg.locale === "ja")) {
      void context.globalState.update(OFFICIAL_DOCS_LOCALE_KEY, msg.locale);
      return;
    }

    // The one action the version-check screen offers (docs/maintenance/version-gate-design.md).
    if (msg.type === "version-gate-action") {
      const action = msg.action as VersionGateAction;
      if (VERSION_GATE_ACTION_NAMES.has(action))
        void runVersionGateAction(context, workspaceRoot, action);
      return;
    }

    if (msg.type === "open-workflows-setup") {
      void commands.executeCommand("andon.setup", workspaceRoot);
      return;
    }

    if (msg.type === "open-workflows-install") {
      void commands.executeCommand("andon.installWorkflows", workspaceRoot);
      return;
    }

    if (msg.type === "get-workflows-management") {
      settingsReady = true;
      sendWorkflowsState();
      return;
    }
    if (msg.type === "open-workflows-update") {
      void commands.executeCommand("andon.updateWorkflows", workspaceRoot);
      return;
    }

    if (msg.type === "start-workflow" && typeof msg.text === "string") {
      const command = buildComposeCommand(msg.text);
      if (command === null) return;
      if (await onPath("claude")) {
        runInTerminal("AI-DLC", workspaceRoot, command);
      } else {
        // claude CLI 不在フォールバック（spec §6/§9）: 同じ組み立て結果をコピー。
        await env.clipboard.writeText(command);
        void window.showInformationMessage(
          "claude CLI が見つかりません。コマンドをコピーしました — Claude Code のターミナルに貼り付けてください。",
        );
      }
      return;
    }

    if (msg.type === "open-official-doc") {
      const outcome = handleOpenOfficialDoc(message, context);
      if (outcome.ok) {
        injectDocsShellDeepLink(webview, outcome.inject);
      }
      // Invalid → ignore (no persist already; no Shell; no vscode.open).
      return;
    }

    if (msg.type === "get" && typeof msg.id === "string" && typeof msg.path === "string") {
      const result = await session.handleGet(msg.path);
      void webview.postMessage({
        type: "get-response",
        id: msg.id,
        reached: result.reached,
        body: result.reached ? result.body : undefined,
      });
      return;
    }

    if (msg.type === "post" && typeof msg.id === "string" && typeof msg.path === "string") {
      const result = await session.handlePost(msg.path, msg.body);
      void webview.postMessage({
        type: "post-response",
        id: msg.id,
        ok: result.ok,
        status: result.status,
        body: result.body,
      });
      return;
    }

    if (msg.type === "open-file" && typeof msg.path === "string") {
      try {
        const beside = msg.beside === true;
        const base = msg.base === "record" ? "record" : "workspace";
        const preview = msg.preview === false ? false : undefined;
        let recordDir: string | undefined;
        if (base === "record") {
          const record = await session.service.readContext.recordDir();
          if (!("ok" in record)) {
            void window.showWarningMessage(`レコードを解決できません: ${msg.path}`);
            return;
          }
          recordDir = record.value;
        }
        await openFileRef(workspaceRoot, msg.path, typeof msg.line === "number" ? msg.line : null, {
          beside,
          base,
          recordDir,
          preview,
        });
      } catch (cause) {
        void window.showErrorMessage(
          `ファイルを開けませんでした: ${msg.path}${cause instanceof Error ? ` (${cause.message})` : ""}`,
        );
      }
      return;
    }
  });

  return () => {
    unsubscribe();
    unsubscribeWorkflows();
    plugins?.dispose();
    sub.dispose();
    lease.dispose();
  };
}

export function openDashboardPanel(
  context: ExtensionContext,
  workspaceRoot: string,
  options: DashboardPanelOptions = {},
): void {
  registerApplyLatestCommand(context);
  void maybePromptWorkflowsUpdate(context, workspaceRoot);
  // The webview may load the dashboard bundle, nothing else.
  const panel = window.createWebviewPanel(PANEL_VIEW_TYPE, "Andon", ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [Uri.file(mediaRoot(context))],
  });
  panel.iconPath = Uri.file(path.join(context.extensionPath, "media", "icon.png"));

  void loadDashboardHtml(panel.webview, context).then((html) => {
    panel.webview.html = html;
  });

  const officialDocsRoot = resolveOfficialDocsRoot(context.extensionPath, workspaceRoot);
  const teardown = wireWebview(
    panel.webview,
    workspaceRoot,
    officialDocsRoot,
    context,
    options.open,
  );
  panel.onDidDispose(teardown);
}
