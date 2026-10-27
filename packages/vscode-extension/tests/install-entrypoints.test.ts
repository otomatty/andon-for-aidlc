import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKFLOWS_TARGET_VERSION } from "@aidlc-guide/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import type { HarnessId } from "../src/harness-detect.ts";
import type { SetupSnapshot } from "../src/setup-state.ts";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  create: vi.fn(),
  inspect: vi.fn(),
  prepare: vi.fn(),
  install: vi.fn(),
  configure: vi.fn(),
  workspace: { isTrusted: true, workspaceFolders: [] as { uri: { fsPath: string } }[] },
}));
vi.mock("vscode", () => ({
  commands: {
    registerCommand: (id: string, run: (...args: unknown[]) => unknown) => {
      mocks.commands.set(id, run);
      return { dispose: vi.fn() };
    },
    executeCommand: (id: string, ...args: unknown[]) => mocks.commands.get(id)?.(...args),
  },
  env: { appName: "Cursor" },
  Uri: { file: (fsPath: string) => ({ fsPath }), parse: (value: string) => value },
  ViewColumn: { One: 1 },
  window: { createWebviewPanel: mocks.create, showErrorMessage: vi.fn() },
  workspace: Object.assign(mocks.workspace, {
    onDidChangeWorkspaceFolders: () => ({ dispose: vi.fn() }),
    onDidGrantWorkspaceTrust: () => ({ dispose: vi.fn() }),
  }),
}));
// No video packs installed: discovery reads the real extension registry.
vi.mock("../src/video-packs.ts", () => ({
  installedVideoPacks: () => [],
  onVideoPacksChanged: () => ({ dispose: vi.fn() }),
  videoPackRoots: () => [],
}));
vi.mock("../src/commands.ts", () => ({
  runInTerminal: vi.fn(),
}));
vi.mock("../src/dashboard-html.ts", () => ({ loadDashboardHtml: async () => "<html></html>" }));
vi.mock("../src/doctor.ts", () => ({ onPath: vi.fn(), runDoctor: vi.fn() }));
vi.mock("../src/cli-management.ts", async (original) => ({
  ...(await original<typeof import("../src/cli-management.ts")>()),
  prepareProjectCli: mocks.prepare,
}));
vi.mock("../src/guide-session.ts", () => ({
  acquireSession: () => ({ session: { subscribe: () => vi.fn() }, dispose: vi.fn() }),
  persistSelectedIntent: vi.fn(),
  disposeAllSessions: vi.fn(),
  closeAllSessions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/mcp-register.ts", () => ({
  docsSkillPath: vi.fn(),
  mcpScriptPath: vi.fn(),
  registerMcp: vi.fn(),
  refreshDocsRegistration: vi.fn(),
}));
vi.mock("../src/native-setup.ts", async (original) => {
  const native = await original<typeof import("../src/native-setup.ts")>();
  return {
    ...native,
    readNativeInstall: () => ({
      executable: "aidlc",
      version: native.SETUP_RELEASE,
      binDir: path.resolve("fixture-cli/bin"),
    }),
    readVersionedNativeInstall: () => ({
      executable: "aidlc",
      version: native.SETUP_RELEASE,
      binDir: path.resolve("fixture-cli/bin"),
    }),
    installNative: mocks.install,
    configureNative: mocks.configure,
  };
});
vi.mock("../src/native-harness-install.ts", async (original) => ({
  ...(await original<typeof import("../src/native-harness-install.ts")>()),
  configureNativeHarness: mocks.configure,
}));
vi.mock("../src/setup-state.ts", async (original) => ({
  ...(await original<typeof import("../src/setup-state.ts")>()),
  inspectSetup: mocks.inspect,
}));
vi.mock("../src/status-bar.ts", () => ({
  createStatusBar: vi.fn(),
  startStatusBarRefresh: vi.fn(),
}));
vi.mock("../src/official-docs-root.ts", () => ({ resolveOfficialDocsRoot: () => "docs" }));
vi.mock("../src/open-file.ts", () => ({ openFileRef: vi.fn() }));
vi.mock("../src/open-official-doc.ts", () => ({
  getLastOfficialDocsLocale: vi.fn(),
  handleOpenOfficialDoc: vi.fn(),
  injectDocsShellDeepLink: vi.fn(),
  OFFICIAL_DOCS_LOCALE_KEY: "locale",
}));
vi.mock("../src/workflows-update-panel.ts", () => ({
  maybePromptWorkflowsUpdate: vi.fn(),
  openWorkflowsUpdatePanel: vi.fn(),
  UPDATE_WORKFLOWS_COMMAND: "aidlc-guide.updateWorkflows",
}));
vi.mock("../src/write-global-vsix.ts", () => ({ registerApplyLatestCommand: vi.fn() }));

import { openDashboardPanel } from "../src/dashboard-panel.ts";
import { activate } from "../src/extension.ts";

function panelFixture(viewType: string) {
  const cleanups: (() => void)[] = [];
  const panel = {
    viewType,
    receive: async (_message: unknown) => {},
    webview: {
      html: "",
      postMessage: vi.fn(),
      onDidReceiveMessage: (receive: (message: unknown) => Promise<void>) => {
        panel.receive = receive;
        return { dispose: vi.fn() };
      },
    },
    onDidDispose: (callback: () => void) => {
      cleanups.push(callback);
      return { dispose: vi.fn() };
    },
    onDidChangeViewState: () => ({ dispose: vi.fn() }),
    dispose: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
  return panel;
}

let root: string;
let context: ExtensionContext;
let panels: ReturnType<typeof panelFixture>[];
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.commands.clear();
  mocks.workspace.workspaceFolders = [];
  panels = [];
  mocks.create.mockImplementation((type: string) => {
    const panel = panelFixture(type);
    panels.push(panel);
    return panel;
  });
  mocks.configure.mockResolvedValue({ doctorOk: true, details: "正常" });
  context = {
    extensionPath: "extension",
    subscriptions: [],
    workspaceState: { get: vi.fn(), update: vi.fn() },
    environmentVariableCollection: { prepend: vi.fn() },
  } as unknown as ExtensionContext;
  await activate(context);
  root = mkdtempSync(path.join(tmpdir(), "aidlc-entrypoints-"));
  mocks.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
});
afterEach(() => {
  for (const panel of panels) panel.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe.each(["dashboard", "command palette", "onboarding"])(
  "install selection via %s",
  (entry) => {
    it.each([
      {
        name: "new multiple selection",
        installed: false,
        selected: ["claude", "cursor"],
        configured: 2,
      },
      { name: "additional harness", installed: true, selected: ["cursor"], configured: 1 },
      {
        name: "existing and additional harnesses",
        installed: true,
        selected: ["claude", "cursor", "kiro"],
        configured: 2,
      },
      { name: "new single harness", installed: false, selected: ["claude"], configured: 1 },
      { name: "existing single harness", installed: true, selected: ["claude"], configured: 0 },
      {
        name: "conflicting harnesses",
        installed: false,
        selected: ["copilot", "opencode"],
        configured: 0,
        blocked: true,
      },
    ])(
      "handles $name through the real shared service",
      async ({ installed, selected, configured, blocked }) => {
        if (installed) {
          const data = path.join(root, ".claude", "tools", "data");
          mkdirSync(data, { recursive: true });
          writeFileSync(
            path.join(data, "aidlc-stamp.json"),
            JSON.stringify({
              schemaVersion: 1,
              distribution: "claude",
              frameworkVersion: WORKFLOWS_TARGET_VERSION,
            }),
          );
        }
        const snapshot: SetupSnapshot = {
          root,
          configured: installed,
          projectPresent: installed,
          native: null,
          version: installed ? WORKFLOWS_TARGET_VERSION : null,
          harnesses: installed ? ["claude"] : [],
          docsReady: false,
          preference: undefined,
          cli: {
            machineVersion: null,
            projectPin: null,
            projectVersion: installed ? WORKFLOWS_TARGET_VERSION : null,
            effectiveVersion: null,
            target: WORKFLOWS_TARGET_VERSION,
            targetInstalled: false,
            launcherReady: false,
            setupReady: false,
            canPrepare: true,
            canUpdate: true,
            confirmUpdate: false,
            status: "missing",
            message: "CLIの準備が必要です。",
            updateMessage: "CLIの準備が必要です。",
          },
        };
        mocks.inspect.mockImplementation(async () => snapshot);
        mocks.prepare.mockImplementation(async () => {
          snapshot.native = {
            executable: path.resolve("fixture-cli/versions/aidlc"),
            version: WORKFLOWS_TARGET_VERSION,
            binDir: path.resolve("fixture-cli/bin"),
          };
          snapshot.cli = {
            ...snapshot.cli,
            machineVersion: WORKFLOWS_TARGET_VERSION,
            projectPin: null,
            projectVersion: installed ? WORKFLOWS_TARGET_VERSION : null,
            effectiveVersion: WORKFLOWS_TARGET_VERSION,
            target: WORKFLOWS_TARGET_VERSION,
            targetInstalled: true,
            launcherReady: true,
            setupReady: true,
            canPrepare: false,
            canUpdate: false,
            confirmUpdate: false,
            status: "ready",
            message: "CLIの準備ができました。",
            updateMessage: "CLIは導入済みです。",
          };
          return {
            ok: true,
            stage: "complete",
            message: "CLIの準備ができました。",
            details: "",
            nextAction: "プロジェクトを設定してください。",
            recovery: "not-needed",
            applied: true,
          };
        });
        if (entry === "dashboard") {
          openDashboardPanel(context, root);
          await panels[0]?.receive({ type: "open-workflows-install" });
        } else {
          mocks.commands.get(
            entry === "onboarding" ? "aidlc-guide.setup" : "aidlc-guide.installWorkflows",
          )?.();
        }
        // Every entry point opens the one setup tab of the folder.
        await vi.waitFor(() =>
          expect(
            panels.find((panel) => panel.viewType === "aidlcGuide.setup")?.webview.html,
          ).toContain("AI-DLC"),
        );
        const panel = panels.find((panel) => panel.viewType === "aidlcGuide.setup");
        if (!panel) throw new Error("installer panel missing");
        await panel.receive({ type: "install", harnesses: selected as HarnessId[] });
        expect(mocks.configure).not.toHaveBeenCalled();
        expect(panel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "status",
            error: true,
            text: expect.stringContaining("先に「このマシンの CLI」の手順で"),
          }),
        );
        await panel.receive({ type: "prepare-cli" });
        expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ workspaceRoot: root }),
        );
        expect(context.environmentVariableCollection.prepend).toHaveBeenCalledWith(
          "PATH",
          `${path.resolve("fixture-cli/bin")}${path.delimiter}`,
        );
        if (entry === "onboarding" && installed) {
          // Existing-project setup cannot rewrite shared settings, even for a stale install message.
          await panel.receive({ type: "install", harnesses: selected as HarnessId[] });
          expect(mocks.configure).not.toHaveBeenCalled();
          expect(panel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "status",
              error: true,
              text: expect.stringContaining("ツールを追加する場合"),
            }),
          );
          // "Add tools" opens the selection in the same tab instead of another one.
          await panel.receive({ type: "add-tools" });
          expect(panel.webview.html).toContain("<legend>追加するツール</legend>");
          expect(panels).toHaveLength(1);
        }
        // Every entry point uses the service's real selection checks, including stale UI messages.
        await panel.receive({ type: "install", harnesses: selected as HarnessId[] });
        expect(mocks.install).not.toHaveBeenCalled();
        if (blocked) {
          expect(mocks.configure).not.toHaveBeenCalled();
          expect(panel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "status",
              error: true,
              text: expect.stringContaining("同じ .aidlc/"),
            }),
          );
        } else {
          expect(mocks.configure).toHaveBeenCalledTimes(configured);
          expect(mocks.configure.mock.calls.map((args) => args[2])).toEqual(
            selected.filter((id) => !installed || id !== "claude"),
          );
          expect(panel.webview.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "status",
              error: false,
              text: expect.stringContaining("準備が完了"),
            }),
          );
        }
      },
    );
  },
);
