import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import type { NativeInstall } from "../src/native-setup.ts";

const mocks = vi.hoisted(() => ({
  machineRoot: "",
  machine: "",
  retained: new Set<string>(),
  registered: false,
  install: vi.fn(),
  use: vi.fn(),
  pin: vi.fn(),
  configure: vi.fn(),
  doctor: vi.fn(),
  create: vi.fn(),
  dashboard: vi.fn(),
  workspace: { isTrusted: true, workspaceFolders: [] as { uri: { fsPath: string } }[] },
}));
vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn() },
  env: { appName: "Cursor" },
  Uri: {},
  ViewColumn: { One: 1 },
  window: { createWebviewPanel: mocks.create, showErrorMessage: vi.fn() },
  workspace: Object.assign(mocks.workspace, {
    onDidGrantWorkspaceTrust: () => ({ dispose: vi.fn() }),
    onDidChangeWorkspaceFolders: () => ({ dispose: vi.fn() }),
  }),
}));
vi.mock("../src/native-setup.ts", async (original) => ({
  ...(await original<typeof import("../src/native-setup.ts")>()),
  installLocations: () => ({
    root: mocks.machineRoot,
    binDir: path.join(mocks.machineRoot, "bin"),
  }),
  readNativeInstall: (project?: string) => {
    if (project && existsSync(path.join(project, ".aidlc-version"))) {
      const version = readFileSync(path.join(project, ".aidlc-version"), "utf8").trim();
      return mocks.registered && mocks.retained.has(version) ? runtime(version) : null;
    }
    return runtime(mocks.machine);
  },
  readVersionedNativeInstall: (version: string) =>
    mocks.retained.has(version) ? runtime(version) : null,
  installNative: mocks.install,
  useNative: mocks.use,
  pinNative: mocks.pin,
  runNativeDoctor: mocks.doctor,
}));
vi.mock("../src/native-harness-install.ts", async (original) => ({
  ...(await original<typeof import("../src/native-harness-install.ts")>()),
  configureNativeHarness: mocks.configure,
}));
vi.mock("../src/mcp-register.ts", () => ({
  refreshDocsRegistration: async () => ({ complete: false, updated: false }),
  docsSkillPath: () => "docs-skill",
  mcpScriptPath: () => "mcp-script",
}));
vi.mock("../src/dashboard-panel.ts", () => ({ openDashboardPanel: mocks.dashboard }));

import {
  inspectCliManagement,
  prepareTargetRuntime,
  updateMachineCli,
} from "../src/cli-management.ts";
import { SETUP_RELEASE } from "../src/native-setup.ts";
import { openSetupPanel } from "../src/setup-panel.ts";
import { setupStateKey } from "../src/setup-preference.ts";
import { inspectSetup } from "../src/setup-state.ts";
import { inspectWorkflowsManagement } from "../src/workflows-management.ts";
import { updateInstalledWorkflows } from "../src/workflows-update.ts";
import { NEWER_WORKFLOWS_VERSION } from "./workflows-version-fixture.ts";

let directory: string;
let root: string;
let context: ExtensionContext;
let receive: (message: unknown) => Promise<void>;
let cleanups: (() => void)[];
let panel: {
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: (listener: typeof receive) => { dispose: () => void };
  };
  onDidDispose: (callback: () => void) => { dispose: () => void };
  onDidChangeViewState: () => { dispose: () => void };
  dispose: () => void;
};

function runtime(version: string): NativeInstall {
  return {
    version,
    executable: path.join(mocks.machineRoot, "versions", version, "aidlc"),
    binDir: path.join(mocks.machineRoot, "bin"),
  };
}
function activateVersion(version: string) {
  mocks.machine = version;
  writeFileSync(path.join(mocks.machineRoot, "active-version"), `${version}\n`);
}
function view() {
  const messages: unknown[] = [];
  const dom = new JSDOM(panel.webview.html, {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.assign(window, {
        acquireVsCodeApi: () => ({
          getState: () => null,
          setState: () => {},
          postMessage: (message: unknown) => messages.push(message),
        }),
      });
    },
  });
  return { dom, messages };
}
async function click(id: string) {
  const { dom, messages } = view();
  try {
    const button = dom.window.document.getElementById(id) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
    button.click();
    await receive(messages.at(-1));
  } finally {
    dom.window.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(path.join(tmpdir(), "setup-newer-cli-"));
  root = path.join(directory, "project");
  mocks.machineRoot = path.join(directory, "machine");
  const bin = path.join(mocks.machineRoot, "bin");
  mkdirSync(root);
  mkdirSync(bin, { recursive: true });
  for (const file of [
    path.join(bin, "aidlc.cmd"),
    path.join(bin, "aidlc"),
    path.join(mocks.machineRoot, "aidlc-shim.ps1"),
  ]) {
    writeFileSync(file, "fixture launcher\n");
    chmodSync(file, 0o755);
  }
  activateVersion(NEWER_WORKFLOWS_VERSION);
  mocks.retained = new Set([NEWER_WORKFLOWS_VERSION]);
  mocks.registered = false;
  mocks.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  const preferences = new Map<string, unknown>();
  context = {
    extensionPath: "extension",
    subscriptions: [],
    workspaceState: {
      get: (key: string) => preferences.get(key),
      update: vi.fn(async (key: string, value: unknown) => {
        preferences.set(key, value);
      }),
    },
    environmentVariableCollection: { prepend: vi.fn() },
  } as unknown as ExtensionContext;
  cleanups = [];
  panel = {
    webview: {
      html: "",
      postMessage: vi.fn(),
      onDidReceiveMessage(listener) {
        receive = listener;
        return { dispose() {} };
      },
    },
    onDidDispose(callback) {
      cleanups.push(callback);
      return { dispose() {} };
    },
    onDidChangeViewState() {
      return { dispose() {} };
    },
    dispose() {
      for (const callback of cleanups) callback();
    },
  };
  mocks.create.mockReturnValue(panel);
  mocks.install.mockImplementation(async () => {
    mocks.retained.add(SETUP_RELEASE);
    activateVersion(SETUP_RELEASE);
  });
  mocks.use.mockImplementation(async (_native, version) => {
    activateVersion(version);
  });
  mocks.pin.mockImplementation(async (_native, project, version) => {
    writeFileSync(path.join(project, ".aidlc-version"), `${version}\n`);
    mocks.registered = true;
  });
  mocks.configure.mockImplementation(async (_native, project, harness, _log, _runner, options) => {
    if (options.previewOnly) return { doctorOk: true, details: "正常" };
    options.onApplyStart?.();
    const data = path.join(project, `.${harness}`, "tools", "data");
    mkdirSync(data, { recursive: true });
    mkdirSync(path.join(project, "aidlc", "spaces", "default"), { recursive: true });
    writeFileSync(
      path.join(data, "aidlc-stamp.json"),
      JSON.stringify({ schemaVersion: 1, distribution: harness, frameworkVersion: SETUP_RELEASE }),
    );
    return { doctorOk: true, details: "正常" };
  });
  mocks.doctor.mockResolvedValue({
    version: SETUP_RELEASE,
    executedAt: new Date().toISOString(),
    outcome: "ok",
    summary: "正常",
    checks: [],
    counts: null,
    rawOutput: "",
    unparsedOutput: [],
  });
});
afterEach(() => {
  panel.dispose();
  rmSync(directory, { recursive: true, force: true });
});

describe("new-project setup with a newer machine CLI", () => {
  it.each(["setup", "update", "already retained"])(
    "reaches project initialization and completion after %s preparation",
    async (route) => {
      if (route === "update")
        expect(await updateMachineCli({ workspaceRoot: root, log: vi.fn() })).toMatchObject({
          ok: true,
        });
      if (route === "already retained") mocks.retained.add(SETUP_RELEASE);
      await openSetupPanel(context, root);
      if (route === "setup") {
        const { dom } = view();
        // Only the CLI step is open until this machine's CLI is ready.
        expect(dom.window.document.getElementById("install")).toBeNull();
        expect(dom.window.document.getElementById("prepare-cli")).not.toBeNull();
        dom.window.close();
        await click("prepare-cli");
      }
      expect(inspectCliManagement(root)).toMatchObject({
        setupReady: true,
        targetInstalled: true,
        machineVersion: NEWER_WORKFLOWS_VERSION,
        projectPin: null,
      });
      expect(mocks.pin).not.toHaveBeenCalled();
      expect(existsSync(path.join(root, ".aidlc-version"))).toBe(false);
      const { dom } = view();
      expect(dom.window.document.getElementById("finish")).toBeNull();
      expect((dom.window.document.getElementById("install") as HTMLButtonElement).disabled).toBe(
        false,
      );
      dom.window.close();
      await click("install");
      expect(mocks.configure).toHaveBeenCalledExactlyOnceWith(
        runtime(SETUP_RELEASE),
        root,
        "cursor",
        expect.any(Function),
        undefined,
        expect.any(Object),
      );
      expect(mocks.pin).toHaveBeenCalledTimes(1);
      expect(readFileSync(path.join(root, ".aidlc-version"), "utf8").trim()).toBe(SETUP_RELEASE);
      expect(mocks.machine).toBe(NEWER_WORKFLOWS_VERSION);
      expect(await inspectSetup(context, root)).toMatchObject({
        configured: true,
        native: runtime(SETUP_RELEASE),
        cli: {
          setupReady: true,
          effectiveVersion: SETUP_RELEASE,
          machineVersion: NEWER_WORKFLOWS_VERSION,
        },
      });
      await click("run-doctor");
      expect(mocks.doctor).toHaveBeenCalledWith(
        runtime(SETUP_RELEASE),
        root,
        expect.any(Function),
        expect.any(Object),
      );
      await click("finish");
      expect(context.workspaceState.get(setupStateKey(root))).toMatchObject({
        completed: true,
        harnesses: ["cursor"],
      });
      expect(mocks.dashboard).toHaveBeenCalledWith(context, root);
      expect(mocks.use.mock.calls.every((call) => call[1] === NEWER_WORKFLOWS_VERSION)).toBe(true);
      expect(mocks.install).toHaveBeenCalledTimes(route === "already retained" ? 0 : 1);
    },
  );
});

describe("joining an unpinned target project with a newer machine CLI", () => {
  it.each([false, true])(
    "repairs the pin and completes setup (target retained: %s)",
    async (retained) => {
      const data = path.join(root, ".cursor", "tools", "data");
      mkdirSync(data, { recursive: true });
      mkdirSync(path.join(root, "aidlc", "spaces", "default"), { recursive: true });
      writeFileSync(
        path.join(data, "aidlc-stamp.json"),
        JSON.stringify({
          schemaVersion: 1,
          distribution: "cursor",
          frameworkVersion: SETUP_RELEASE,
        }),
      );
      if (retained) mocks.retained.add(SETUP_RELEASE);
      expect(inspectCliManagement(root)).toMatchObject({ setupReady: false, canPrepare: false });
      expect(inspectWorkflowsManagement(root)).toMatchObject({
        status: "update",
        canUpdate: true,
        projectPin: null,
      });
      expect(inspectCliManagement(root)).toMatchObject({ targetInstalled: retained });
      // The update screen readies the target runtime itself and leaves the newer default alone.
      if (!retained)
        expect(await prepareTargetRuntime({ workspaceRoot: root, log: vi.fn() })).toMatchObject({
          ok: true,
        });
      expect(mocks.machine).toBe(NEWER_WORKFLOWS_VERSION);
      expect(existsSync(path.join(root, ".aidlc-version"))).toBe(false);
      expect(inspectCliManagement(root)).toMatchObject({
        targetInstalled: true,
        launcherReady: true,
      });

      const log = vi.fn();
      const result = await updateInstalledWorkflows({
        workspaceRoot: root,
        log,
        isCurrent: () => true,
        canRestore: () => true,
        needsRepair: false,
        setNeedsRepair: vi.fn(),
        onHarnessResult: vi.fn(),
      });
      expect(result, log.mock.calls.flat().join("\n")).toMatchObject({ ok: true });
      expect(readFileSync(path.join(root, ".aidlc-version"), "utf8").trim()).toBe(SETUP_RELEASE);
      expect(mocks.machine).toBe(NEWER_WORKFLOWS_VERSION);
      expect(inspectWorkflowsManagement(root)).toMatchObject({
        status: "current",
        canUpdate: false,
      });
      expect(inspectCliManagement(root)).toMatchObject({
        setupReady: true,
        effectiveVersion: SETUP_RELEASE,
      });
      expect(mocks.configure.mock.calls.every((call) => call[0].version === SETUP_RELEASE)).toBe(
        true,
      );
      expect(mocks.configure).toHaveBeenCalledTimes(2);
      await openSetupPanel(context, root);
      await click("run-doctor");
      await click("finish");
      expect(context.workspaceState.get(setupStateKey(root))).toMatchObject({ completed: true });
      expect(mocks.use.mock.calls.every((call) => call[1] === NEWER_WORKFLOWS_VERSION)).toBe(true);
    },
  );
});
