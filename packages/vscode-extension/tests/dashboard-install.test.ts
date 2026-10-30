import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  receive: vi.fn(),
  gateAction: vi.fn(),
  pluginsReceive: vi.fn(),
  pluginsDeps: [] as unknown[],
  folders: [] as Array<{ uri: { fsPath: string } }>,
  panels: [] as Array<{ iconPath?: unknown }>,
}));
vi.mock("vscode", () => ({
  commands: { executeCommand: mocks.execute },
  env: {},
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  ViewColumn: { One: 1 },
  workspace: {
    get workspaceFolders() {
      return mocks.folders;
    },
  },
  window: {
    createWebviewPanel: () => {
      const panel = {
        webview: { html: "", onDidReceiveMessage: mocks.receive },
        onDidDispose: vi.fn(),
      };
      mocks.panels.push(panel);
      return panel;
    },
  },
}));
vi.mock("../src/commands.ts", () => ({ runInTerminal: vi.fn() }));
vi.mock("../src/dashboard-html.ts", () => ({ loadDashboardHtml: async () => "<html></html>" }));
vi.mock("../src/doctor.ts", () => ({ onPath: vi.fn() }));
vi.mock("../src/guide-session.ts", () => ({
  acquireSession: () => ({
    session: { subscribe: () => vi.fn() },
    dispose: vi.fn(),
  }),
  persistSelectedIntent: vi.fn(),
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
  runVersionGateAction: mocks.gateAction,
}));
vi.mock("../src/write-global-vsix.ts", () => ({ registerApplyLatestCommand: vi.fn() }));
vi.mock("../src/plugins-controller.ts", () => ({
  createPluginsController: (deps: unknown) => {
    mocks.pluginsDeps.push(deps);
    return { receive: mocks.pluginsReceive, refresh: vi.fn(), running: () => null, dispose: vi.fn() };
  },
}));

import { openDashboardPanel } from "../src/dashboard-panel.ts";

beforeEach(() => vi.clearAllMocks());

describe("dashboard panel tab", () => {
  it("shows the Andon icon on the editor tab", () => {
    openDashboardPanel(
      { extensionPath: "extension", subscriptions: [] } as unknown as ExtensionContext,
      "dashboard-project",
    );
    expect(mocks.panels.at(-1)?.iconPath).toEqual({
      fsPath: path.join("extension", "media", "icon.png"),
    });
  });
});

describe("dashboard workflows installation", () => {
  it("opens setup for the host's dashboard root without accepting a webview path", async () => {
    openDashboardPanel(
      { extensionPath: "extension", subscriptions: [] } as unknown as ExtensionContext,
      "dashboard-project",
    );
    await mocks.receive.mock.calls[0]?.[0]({
      type: "open-workflows-setup",
      workspaceRoot: "unrelated-project",
    });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith("andon.setup", "dashboard-project");
  });

  it("opens updates for the host's dashboard root without accepting a webview path", async () => {
    openDashboardPanel(
      { extensionPath: "extension", subscriptions: [] } as unknown as ExtensionContext,
      "dashboard-project",
    );
    await mocks.receive.mock.calls[0]?.[0]({
      type: "open-workflows-update",
      workspaceRoot: "unrelated-project",
    });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      "andon.updateWorkflows",
      "dashboard-project",
    );
  });
  it("uses the host's dashboard workspace even when the message supplies a different path", async () => {
    openDashboardPanel(
      { extensionPath: "extension", subscriptions: [] } as unknown as ExtensionContext,
      "dashboard-project",
    );
    const receive = mocks.receive.mock.calls[0]?.[0];
    await receive({ type: "open-workflows-install", workspaceRoot: "unrelated-project" });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      "andon.installWorkflows",
      "dashboard-project",
    );
  });

  it("runs the version check's action for the host's dashboard root", async () => {
    const context = { extensionPath: "extension", subscriptions: [] } as unknown as ExtensionContext;
    openDashboardPanel(context, "dashboard-project");
    const receive = mocks.receive.mock.calls[0]?.[0];
    await receive({ type: "version-gate-action", action: "update-project", root: "elsewhere" });
    expect(mocks.gateAction).toHaveBeenCalledExactlyOnceWith(
      context,
      "dashboard-project",
      "update-project",
    );
  });

  it("ignores an action the version check does not offer", async () => {
    openDashboardPanel(
      { extensionPath: "extension", subscriptions: [] } as unknown as ExtensionContext,
      "dashboard-project",
    );
    const receive = mocks.receive.mock.calls[0]?.[0];
    await receive({ type: "version-gate-action", action: "uninstall" });
    await receive({ type: "version-gate-action", action: 1 });
    expect(mocks.gateAction).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe("dashboard plugins page", () => {
  it("hands plugin messages to one controller bound to the host's root and bundled packages", async () => {
    mocks.pluginsDeps.length = 0;
    openDashboardPanel(
      {
        extensionPath: "extension",
        globalStorageUri: { fsPath: "global" },
        subscriptions: [],
      } as unknown as ExtensionContext,
      "dashboard-project",
    );
    const receive = mocks.receive.mock.calls[0]?.[0];
    await receive({ type: "plugins-get", root: "elsewhere" });
    await receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(mocks.pluginsDeps).toHaveLength(1);
    expect(mocks.pluginsDeps[0]).toMatchObject({
      root: "dashboard-project",
      bundles: path.join("extension", "dist", "plugins"),
      store: path.join("global", "plugins"),
    });
    expect(mocks.pluginsReceive.mock.calls.map((call) => call[0])).toEqual([
      { type: "plugins-get", root: "elsewhere" },
      { type: "plugins-action", action: "install", name: "focus" },
    ]);
    // Other messages never reach it.
    await receive({ type: "open-workflows-setup" });
    expect(mocks.pluginsReceive).toHaveBeenCalledTimes(2);
  });

  it("lets the controller act only while the host's root is still an open folder", async () => {
    mocks.pluginsDeps.length = 0;
    mocks.folders = [{ uri: { fsPath: "dashboard-project" } }];
    openDashboardPanel(
      {
        extensionPath: "extension",
        globalStorageUri: { fsPath: "global" },
        subscriptions: [],
      } as unknown as ExtensionContext,
      "dashboard-project",
    );
    await mocks.receive.mock.calls[0]?.[0]({ type: "plugins-get" });
    const deps = mocks.pluginsDeps[0] as { isOpen: () => boolean };
    expect(deps.isOpen()).toBe(true);
    mocks.folders = [{ uri: { fsPath: "another-project" } }];
    expect(deps.isOpen()).toBe(false);
  });
});

