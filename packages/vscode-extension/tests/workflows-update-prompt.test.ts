import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

const mocks = vi.hoisted(() => ({
  show: vi.fn(),
  warn: vi.fn(),
  create: vi.fn(),
  status: vi.fn(),
  gate: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("vscode", () => ({
  window: {
    showInformationMessage: mocks.show,
    showWarningMessage: mocks.warn,
    createWebviewPanel: mocks.create,
  },
  commands: { executeCommand: mocks.execute },
  env: {},
  Uri: {},
  ViewColumn: { One: 1 },
  workspace: {
    isTrusted: true,
    workspaceFolders: [{ uri: { fsPath: "a" } }, { uri: { fsPath: "b" } }],
  },
}));
vi.mock("../src/official-docs-root.ts", () => ({ resolveOfficialDocsRoot: () => "docs" }));
vi.mock("@andon/reader-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@andon/reader-core")>()),
  inspectVersionGate: mocks.gate,
}));
vi.mock("../src/workflows-management.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/workflows-management.ts")>();
  return { ...actual, inspectWorkflowsManagement: mocks.status };
});

function blocked(status = "project-older") {
  return {
    status,
    target: "2.9.0",
    tools: [{ id: "cursor", label: "Cursor", version: "2.8.0" }],
    pin: "2.8.0",
    engine: null,
    native: false,
    message: "プロジェクトの aidlc-workflows 2.8.0 は古いバージョンです。",
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.gate.mockReturnValue(blocked());
  mocks.status.mockReturnValue({
    canUpdate: true,
    engineBumpNeeded: true,
    engineVersionDiffers: true,
    target: "2.9.0",
    projectPin: "2.8.0",
    tools: [{ id: "cursor", label: "Cursor", version: "2.8.0" }],
  });
});

const context = () =>
  ({
    extensionPath: "extension",
    workspaceState: { get: vi.fn(), update: vi.fn() },
  }) as unknown as ExtensionContext;

describe("workspace update prompts", () => {
  it("checks again after a successful job instead of caching an old result", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    const ctx = context();
    mocks.gate.mockReturnValueOnce({ ...blocked(), status: "ok" });
    mocks.status.mockReturnValueOnce({ updateRetryNeeded: false });
    await maybePromptWorkflowsUpdate(ctx, "a");
    expect(mocks.warn).not.toHaveBeenCalled();
    mocks.warn.mockResolvedValue(undefined);
    await maybePromptWorkflowsUpdate(ctx, "a");
    expect(mocks.gate).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("deduplicates pending checks and preserves a newer job when an obsolete one finishes", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    const ctx = context();
    let generation = 1;
    let replyOld: () => void = () => {};
    let replyNew: () => void = () => {};
    mocks.warn.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        replyOld = resolve;
      }),
    );
    mocks.warn.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        replyNew = resolve;
      }),
    );
    const old = maybePromptWorkflowsUpdate(ctx, "a", () => generation === 1);
    generation = 2;
    const current = maybePromptWorkflowsUpdate(ctx, "a", () => generation === 2);
    replyOld();
    await old;
    const duplicate = maybePromptWorkflowsUpdate(ctx, "a", () => generation === 2);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    replyNew();
    await Promise.all([current, duplicate]);
  });

  it("checks a replacement folder independently and ignores a stale notification response", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    const ctx = context();
    let current = "a";
    let replyA: (value: string) => void = () => {};
    mocks.warn.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        replyA = resolve;
      }),
    );
    mocks.warn.mockResolvedValue(undefined);
    const first = maybePromptWorkflowsUpdate(ctx, "a", () => current === "a");
    current = "b";
    await maybePromptWorkflowsUpdate(ctx, "b", () => current === "b");
    replyA("プロジェクトを 2.9.0 に更新");
    await first;
    expect(mocks.gate.mock.calls.map(([root]) => root)).toEqual(["a", "b"]);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(ctx.workspaceState.update).not.toHaveBeenCalled();
  });

  it("names the problem and offers only the one action, with no way to postpone", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    mocks.warn.mockResolvedValue(undefined);
    await maybePromptWorkflowsUpdate(context(), "a");
    expect(mocks.warn).toHaveBeenCalledWith(
      "Andon を使うには更新が必要です。プロジェクトの aidlc-workflows 2.8.0 は古いバージョンです。",
      expect.stringMatching(/^プロジェクトを .+ に更新$/),
    );
    expect(mocks.warn.mock.calls[0]).toHaveLength(2);
  });

  it("ignores a stored snooze from earlier releases", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    const ctx = context();
    vi.mocked(ctx.workspaceState.get).mockReturnValue("2.9.0");
    mocks.warn.mockResolvedValue(undefined);
    await maybePromptWorkflowsUpdate(ctx, "a");
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it("sends a newer project to the Guide's own update", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    mocks.gate.mockReturnValue(blocked("project-newer"));
    mocks.warn.mockResolvedValue("Andon を更新");
    await maybePromptWorkflowsUpdate(context(), "a");
    expect(mocks.execute).toHaveBeenCalledWith("andon.checkUpdate");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("leaves a project without aidlc to setup", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    mocks.gate.mockReturnValue(blocked("not-installed"));
    mocks.status.mockReturnValue({ updateRetryNeeded: false });
    await maybePromptWorkflowsUpdate(context(), "a");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it("does not prompt when the versions match and no update is unfinished", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    mocks.gate.mockReturnValue({ ...blocked(), status: "ok" });
    mocks.status.mockReturnValue({
      canUpdate: true,
      engineBumpNeeded: true,
      engineVersionDiffers: false,
      updateRetryNeeded: false,
      target: "2.9.0",
      projectPin: null,
      tools: [{ id: "cursor", label: "Cursor", version: "2.9.0" }],
    });
    await maybePromptWorkflowsUpdate(context(), "a");
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it("prompts to retry when a pin write is still unfinished and the versions match", async () => {
    const { maybePromptWorkflowsUpdate } = await import("../src/workflows-update-panel.ts");
    mocks.gate.mockReturnValue({ ...blocked(), status: "ok" });
    mocks.status.mockReturnValue({
      canUpdate: true,
      engineBumpNeeded: true,
      engineVersionDiffers: false,
      updateRetryNeeded: true,
      target: "2.9.0",
      projectPin: null,
      message: "前回の更新は未完了です。全ツールの更新を再実行してください。",
      tools: [{ id: "cursor", label: "Cursor", version: "2.9.0" }],
    });
    mocks.show.mockResolvedValue(undefined);
    await maybePromptWorkflowsUpdate(context(), "a");
    expect(mocks.show).toHaveBeenCalledWith(
      "Andon: 前回の更新は未完了です。全ツールの更新を再実行してください。",
      "アップデートする",
    );
  });
});
