import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

const mocks = vi.hoisted(() => ({
  docs: vi.fn(),
  native: vi.fn(),
  versioned: vi.fn(),
  git: vi.fn(),
  workspace: { isTrusted: true },
}));
vi.mock("vscode", () => ({ workspace: mocks.workspace }));
vi.mock("../src/git-prerequisite.ts", async (original) => ({
  ...(await original<typeof import("../src/git-prerequisite.ts")>()),
  isGitRepository: mocks.git,
}));
vi.mock("../src/mcp-register.ts", () => ({
  refreshDocsRegistration: mocks.docs,
  mcpScriptPath: () => "script",
  docsSkillPath: () => "skill",
}));
vi.mock("../src/native-setup.ts", async (original) => ({
  ...(await original<typeof import("../src/native-setup.ts")>()),
  readNativeInstall: mocks.native,
  readVersionedNativeInstall: mocks.versioned,
}));

import { detectHarnesses } from "../src/harness-detect.ts";
import { readNativeProjections } from "../src/native-projection.ts";
import { SETUP_RELEASE } from "../src/native-setup.ts";
import { setupPhase } from "../src/setup-phase.ts";
import { setupStateKey } from "../src/setup-preference.ts";
import { inspectSetup, needsSetup, type SetupSnapshot } from "../src/setup-state.ts";
import { readWorkspaceAidlcVersion } from "../src/workflows-version.ts";

const roots: string[] = [];
const get = vi.fn();
const context = {
  extensionPath: "extension",
  workspaceState: { get },
} as unknown as ExtensionContext;
beforeEach(() => {
  get.mockReset();
  mocks.workspace.isTrusted = true;
  mocks.git.mockClear();
  mocks.git.mockResolvedValue(true);
  mocks.docs.mockResolvedValue({ complete: false });
  mocks.native.mockReturnValue(null);
  mocks.versioned.mockReturnValue(null);
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(native: boolean): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "setup-state-"));
  roots.push(root);
  await mkdir(path.join(root, "aidlc", "spaces", "default"), { recursive: true });
  await mkdir(path.join(root, ".codex", "tools", "data"), { recursive: true });
  await writeFile(
    path.join(root, ".codex", "tools", native ? "data/aidlc-stamp.json" : "aidlc-version.ts"),
    native
      ? JSON.stringify({ schemaVersion: 1, frameworkVersion: "2.8.1", distribution: "codex" })
      : 'export const AIDLC_VERSION = "2.8.0";',
  );
  return root;
}
describe("first-run setup state", () => {
  it("asks for workspace trust without probing Git or suggesting git init", async () => {
    const root = await fixture(true);
    mocks.native.mockReturnValue({ executable: "/user/aidlc", version: "2.8.1", binDir: "/bin" });
    mocks.workspace.isTrusted = false;
    const state = await inspectSetup(context, root);
    expect(state.configured).toBe(false);
    expect(state.runtimeIssue).toContain("信頼");
    expect(state.runtimeIssueKind).toBe("trust");
    expect(state.runtimeIssue).not.toContain("git init");
    expect(mocks.git).not.toHaveBeenCalled();
    mocks.workspace.isTrusted = true;
    const trusted = await inspectSetup(context, root);
    expect(trusted.configured).toBe(true);
    expect(trusted.runtimeIssueKind).toBeUndefined();
    expect(mocks.git).toHaveBeenCalledWith(root);
  });
  it("reports missing Git after completion without reopening setup", async () => {
    const root = await fixture(true);
    mocks.native.mockReturnValue({ executable: "/user/aidlc", version: "2.8.1", binDir: "/bin" });
    get.mockReturnValue({ completed: true, docsSkipped: true, harness: "codex" });
    mocks.git.mockResolvedValue(false);
    const state = await inspectSetup(context, root);
    expect(state.configured).toBe(false);
    expect(state.runtimeIssue).toContain("git init");
    expect(state.runtimeIssueKind).toBe("git");
    expect(needsSetup(state)).toBe(false);
    mocks.git.mockResolvedValue(true);
    expect(needsSetup(await inspectSetup(context, root))).toBe(false);
  });
  it.each([undefined, "2.8", "02.8.1", 281])(
    "ignores an invalid native version (%s) and retains legacy detection",
    async (frameworkVersion) => {
      const root = await fixture(true);
      const stamp = path.join(root, ".codex", "tools", "data", "aidlc-stamp.json");
      await writeFile(
        stamp,
        JSON.stringify({ schemaVersion: 1, distribution: "codex", frameworkVersion }),
      );
      expect(readNativeProjections(root)).toEqual([]);
      expect(detectHarnesses(root).harnesses).toEqual([]);
      await writeFile(
        path.join(root, ".codex", "tools", "aidlc-version.ts"),
        'export const AIDLC_VERSION = "2.8.0";',
      );
      expect(readWorkspaceAidlcVersion(root).version).toBe("2.8.0");
    },
  );
  it("keeps setup complete when previously enabled docs are removed", async () => {
    get.mockReturnValue({ completed: true, docsSkipped: false, harness: "codex" });
    expect(needsSetup(await inspectSetup(context, await fixture(false)))).toBe(false);
  });
  it("reports runtime drift after completion without reopening setup", async () => {
    const root = await fixture(true);
    get.mockReturnValue({ completed: true, docsSkipped: true });
    mocks.native.mockReturnValue({
      executable: "/user/aidlc",
      version: "2.8.0",
      binDir: "/user/bin",
    });
    const state = await inspectSetup(context, root);
    expect(mocks.native).toHaveBeenCalledWith(root);
    expect(state.configured).toBe(false);
    expect(state.runtimeIssue).toContain("aidlc config --pin");
    expect(state.runtimeIssueKind).toBe("runtime-missing");
    expect(needsSetup(state)).toBe(false);
  });
  it("requires every native projection to match the selected runtime", async () => {
    const root = await fixture(true);
    await mkdir(path.join(root, ".cursor", "tools", "data"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "tools", "data", "aidlc-stamp.json"),
      JSON.stringify({ schemaVersion: 1, distribution: "cursor", frameworkVersion: "2.8.2" }),
    );
    mocks.native.mockReturnValue({
      executable: "/user/aidlc",
      version: "2.8.1",
      binDir: "/user/bin",
    });
    const state = await inspectSetup(context, root);
    expect(state.configured).toBe(false);
    expect(state.runtimeIssueKind).toBe("mixed-versions");
  });
  it("opens for a new workspace without a completion preference", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "setup-empty-"));
    roots.push(root);
    expect(needsSetup(await inspectSetup(context, root))).toBe(true);
  });
  it("allows completion with no Intent and remembers an explicit skip of optional docs", async () => {
    const root = await fixture(false);
    get.mockReturnValue({ completed: true, docsSkipped: true, harness: "codex" });
    const state = await inspectSetup(context, root);
    expect(state.configured).toBe(true);
    expect(needsSetup(state)).toBe(false);
    expect(get).toHaveBeenCalledWith(setupStateKey(root));
  });
  it("recognizes a previous complete registration without forcing another first run", async () => {
    mocks.docs.mockResolvedValue({ complete: true });
    expect(needsSetup(await inspectSetup(context, await fixture(false)))).toBe(false);
  });
  it("opens a configured folder without docs registration and reads native metadata only", async () => {
    const root = await fixture(true);
    mocks.native.mockReturnValue({
      executable: "/user/aidlc",
      version: "2.8.1",
      binDir: "/user/bin",
    });
    const state = await inspectSetup(context, root);
    expect(state.configured).toBe(true);
    expect(state.docsReady).toBe(false);
    expect(needsSetup(state)).toBe(false);
    expect(detectHarnesses(root).harnesses.map((h) => h.id)).toContain("codex");
    expect(readWorkspaceAidlcVersion(root).version).toBe("2.8.1");
    await writeFile(
      path.join(root, ".codex", "tools", "aidlc-version.ts"),
      'export const AIDLC_VERSION = "2.7.0";',
    );
    expect(readWorkspaceAidlcVersion(root).version).toBe("2.8.1");
  });
  it("reports a removed runtime without reopening previously completed setup", async () => {
    get.mockReturnValue({ completed: true });
    const state = await inspectSetup(context, await fixture(true));
    expect(state.configured).toBe(false);
    expect(state.runtimeIssue).toContain("対応する本体を利用できません");
    expect(needsSetup(state)).toBe(false);
  });
  it("uses the verified CLI for an older project instead of blocking setup", async () => {
    const root = await fixture(true);
    await writeFile(
      path.join(root, ".codex", "tools", "data", "aidlc-stamp.json"),
      JSON.stringify({ schemaVersion: 1, distribution: "codex", frameworkVersion: "2.6.114" }),
    );
    mocks.native.mockImplementation((project?: string) =>
      project ? null : { executable: "/user/other", version: "2.10.0", binDir: "/other" },
    );
    mocks.versioned.mockReturnValue({
      executable: "/user/aidlc",
      version: SETUP_RELEASE,
      binDir: "/user/bin",
    });
    const state = await inspectSetup(context, root);
    expect(state.native?.version).toBe(SETUP_RELEASE);
    expect(state.configured).toBe(true);
    expect(state.runtimeIssue).toBeUndefined();
  });
  it("does not fall back to an unverified machine CLI for an older project", async () => {
    const root = await fixture(true);
    await writeFile(
      path.join(root, ".codex", "tools", "data", "aidlc-stamp.json"),
      JSON.stringify({ schemaVersion: 1, distribution: "codex", frameworkVersion: "2.6.114" }),
    );
    mocks.native.mockImplementation((project?: string) =>
      project ? null : { executable: "/user/aidlc", version: "2.10.0", binDir: "/user/bin" },
    );
    const state = await inspectSetup(context, root);
    expect(state.native).toBeNull();
    expect(state.configured).toBe(false);
    expect(state.runtimeIssue).toContain("対応する本体を利用できません");
  });
  it("keeps setup completed after the repository's configuration is removed", async () => {
    get.mockReturnValue({ completed: true });
    const root = await mkdtemp(path.join(tmpdir(), "setup-removed-"));
    roots.push(root);
    const state = await inspectSetup(context, root);
    expect(state.configured).toBe(false);
    expect(state.projectPresent).toBe(false);
    expect(needsSetup(state)).toBe(false);
  });
});

describe("setup phase", () => {
  const cli = {
    machineVersion: SETUP_RELEASE,
    projectPin: null,
    projectVersion: null,
    effectiveVersion: SETUP_RELEASE,
    target: SETUP_RELEASE,
    targetInstalled: true,
    launcherReady: true,
    setupReady: true,
    canPrepare: false,
    canUpdate: false,
    confirmUpdate: false,
    engineNewer: false,
    status: "ready" as const,
    message: "",
    updateMessage: "",
  };
  const base: SetupSnapshot = {
    root: "/project",
    configured: false,
    projectPresent: false,
    native: null,
    version: null,
    harnesses: [],
    docsReady: false,
    preference: undefined,
    cli,
  };
  const missing = { ...cli, setupReady: false, status: "missing" as const };

  it("asks for trust before anything else", () => {
    expect(setupPhase({ ...base, cli: missing }, false, [], false)).toEqual({ name: "trust" });
  });
  it.each([
    ["the CLI can be prepared", { ...missing, canPrepare: true }],
    ["an older pin needs a confirmed update", { ...missing, canUpdate: true, confirmUpdate: true }],
  ])("opens the CLI step when %s", (_case, state) => {
    expect(setupPhase({ ...base, cli: state }, true, [], false)).toEqual({ name: "cli" });
  });
  it("opens the CLI step for a legacy snapshot without CLI state until a runtime exists", () => {
    expect(setupPhase({ ...base, cli: undefined }, true, [], false)).toEqual({ name: "cli" });
    const native = { executable: "aidlc", version: SETUP_RELEASE, binDir: "bin" };
    expect(setupPhase({ ...base, cli: undefined, native }, true, [], false)).toEqual({
      name: "project",
      retry: [],
    });
  });
  it("blocks on a CLI this screen cannot prepare and keeps the reason", () => {
    const blocked = { ...missing, status: "blocked" as const, blockedReason: "needs-other-cli" as const };
    expect(setupPhase({ ...base, cli: blocked }, true, [], false)).toEqual({
      name: "blocked",
      step: "cli",
      block: { kind: "cli", reason: "needs-other-cli" },
    });
  });
  it("opens the project step for a new folder, or blocks when it cannot be installed", () => {
    expect(setupPhase(base, true, ["claude"], false)).toEqual({ name: "project", retry: [] });
    const workflows = {
      root: "/project",
      target: SETUP_RELEASE,
      tools: [],
      projectPin: null,
      status: "blocked" as const,
      message: "設定を確認してください。",
      canInstall: false,
      canUpdate: false,
      engineBumpNeeded: false,
      engineVersionDiffers: false,
      updateRetryNeeded: false,
    };
    expect(setupPhase({ ...base, workflows }, true, ["claude"], false)).toEqual({
      name: "blocked",
      step: "project",
      block: { kind: "workflows" },
    });
  });
  it("retries only tools that failed while the project was being created", () => {
    const partial = { ...base, configured: true, projectPresent: true, harnesses: ["cursor" as const] };
    expect(setupPhase(partial, true, ["cursor", "claude"], true)).toEqual({
      name: "project",
      retry: ["claude"],
    });
    expect(setupPhase(partial, true, ["cursor"], true)).toEqual({ name: "ready" });
    expect(setupPhase(partial, true, ["cursor", "claude"], false)).toEqual({ name: "ready" });
  });
  it("blocks a configured-looking project by its runtime issue, or as incomplete", () => {
    const tools = { ...base, projectPresent: true, harnesses: ["codex" as const] };
    expect(setupPhase({ ...tools, runtimeIssueKind: "git" }, true, [], false)).toEqual({
      name: "blocked",
      step: "project",
      block: { kind: "runtime", issue: "git" },
    });
    expect(setupPhase(tools, true, [], false)).toEqual({
      name: "blocked",
      step: "project",
      block: { kind: "incomplete" },
    });
  });
});
