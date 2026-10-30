import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKFLOWS_TARGET_VERSION } from "@andon/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installWorkflows } from "../src/workflows-install.ts";
import {
  inspectWorkflowsManagement,
  workflowsEngineCanApply,
} from "../src/workflows-management.ts";
import { acquireWorkflowsOperation } from "../src/workflows-operation.ts";
import { NEWER_WORKFLOWS_VERSION } from "./workflows-version-fixture.ts";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  doctor: vi.fn(),
  runtime: vi.fn(),
  retained: vi.fn(),
  launcher: vi.fn(),
  runner: vi.fn(),
  use: vi.fn(),
}));
vi.mock("../src/workflows-native-update.ts", () => ({ applyNativeWorkflowsUpdate: mocks.apply }));
vi.mock("../src/cli-management.ts", () => ({ nativeLauncherReady: mocks.launcher }));
vi.mock("../src/native-setup.ts", async (original) => ({
  ...(await original<typeof import("../src/native-setup.ts")>()),
  runNativeDoctor: mocks.doctor,
  readNativeInstall: mocks.runtime,
  readVersionedNativeInstall: mocks.retained,
  runSetupProcess: mocks.runner,
  useNative: mocks.use,
}));

import { updateInstalledWorkflows } from "../src/workflows-update.ts";

let root: string;
const target = WORKFLOWS_TARGET_VERSION;
function tool(id: "claude" | "cursor", version: string) {
  const dir = path.join(root, `.${id}`, "tools", "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "aidlc-stamp.json"),
    JSON.stringify({ schemaVersion: 1, distribution: id, frameworkVersion: version }),
  );
}
function pin(version: string) {
  writeFileSync(path.join(root, ".aidlc-version"), version);
}
function options() {
  return {
    workspaceRoot: root,
    log: vi.fn(),
    isCurrent: () => true,
    canRestore: () => true,
    needsRepair: false,
    setNeedsRepair: vi.fn(async (_value: boolean) => {}),
    onHarnessResult: vi.fn(),
  };
}
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "workflows-management-"));
  vi.resetAllMocks();
  mocks.runtime.mockReturnValue({ executable: "runtime", version: target, binDir: "bin" });
  mocks.retained.mockReturnValue({ executable: "runtime", version: target, binDir: "bin" });
  mocks.launcher.mockReturnValue(true);
  mocks.doctor.mockResolvedValue({
    outcome: "ok",
    summary: "正常",
    checks: [],
    unparsedOutput: [],
    rawOutput: "",
    counts: null,
  });
  mocks.apply.mockImplementation(async () => {
    for (const entry of inspectWorkflowsManagement(root).tools)
      tool(entry.id as "claude" | "cursor", target);
    pin(target);
    return { ok: true, target };
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("shared workflows management", () => {
  it.each(["target", "launcher", "entrypoint"])(
    "requires the prepared %s before starting a repository update",
    async (missing) => {
      tool("claude", "2.8.0");
      if (missing === "target") mocks.retained.mockReturnValue(null);
      else if (missing === "launcher") mocks.runtime.mockReturnValue(null);
      else mocks.launcher.mockReturnValue(false);
      const opts = options();
      expect(await updateInstalledWorkflows(opts)).toMatchObject({
        ok: false,
        reason: "runtime-required",
      });
      expect(mocks.apply).not.toHaveBeenCalled();
      expect(mocks.use).not.toHaveBeenCalled();
      expect(opts.setNeedsRepair).not.toHaveBeenCalled();
      expect(inspectWorkflowsManagement(root).tools[0]?.version).toBe("2.8.0");
      const release = acquireWorkflowsOperation(root);
      expect(release).not.toBeNull();
      release?.();
    },
  );

  it.each(["success", "failure", "throw", "cancel"])(
    "does not activate a different machine CLI during repository update %s",
    async (outcome) => {
      tool("claude", "2.8.0");
      const previous = { executable: "previous", version: "2.8.0", binDir: "bin" };
      const runtime = { executable: "runtime", version: target, binDir: "bin" };
      mocks.runtime.mockImplementation((project) => (project ? runtime : previous));
      const abort = new AbortController();
      mocks.apply.mockImplementationOnce(async (request) => {
        expect(request.preserveMachine).toBe(true);
        tool("claude", target);
        pin(target);
        if (outcome === "throw") throw new Error("configuration stopped");
        if (outcome === "cancel") abort.abort();
        return { ok: outcome !== "failure", target };
      });
      expect(await updateInstalledWorkflows({ ...options(), signal: abort.signal })).toMatchObject({
        ok: outcome === "success",
      });
      expect(mocks.runtime()).toBe(previous);
      expect(mocks.use).not.toHaveBeenCalled();
      expect(readFileSync(path.join(root, ".aidlc-version"), "utf8")).toBe(target);
    },
  );

  it("updates beside an open workflow", async () => {
    tool("claude", "2.8.0");
    pin("2.8.0");
    const record = path.join(root, "aidlc", "spaces", "default", "intents", "active-12345678");
    mkdirSync(record, { recursive: true });
    writeFileSync(path.join(record, "aidlc-state.md"), "- **Status**: In Progress\n");
    expect((await updateInstalledWorkflows(options())).ok).toBe(true);
    expect(mocks.apply).toHaveBeenCalled();
  });

  it("offers installation for an old pin-only project and reaches the current state", async () => {
    pin("2.8.0");
    const previous = {
      executable: "newer-runtime",
      version: NEWER_WORKFLOWS_VERSION,
      binDir: "bin",
    };
    const runtime = { executable: "runtime", version: target, binDir: "bin" };
    let registered = false;
    mocks.runtime.mockImplementation((project) =>
      project ? (registered ? runtime : null) : previous,
    );
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      status: "not-installed",
      canInstall: true,
      canUpdate: false,
      projectPin: "2.8.0",
    });
    const result = await installWorkflows({
      workspaceRoot: root,
      selected: ["claude"],
      log: vi.fn(),
      hooks: {
        readInstall: () => runtime,
        pin: async (_runtime, _root, version) => {
          pin(version);
          registered = true;
        },
        configure: async () => {
          tool("claude", target);
          return { doctorOk: true, details: "正常" };
        },
      },
    });
    expect(result).toMatchObject({ ok: true, target });
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      status: "current",
      canInstall: true,
      canUpdate: false,
      projectPin: target,
    });
    expect(mocks.use).not.toHaveBeenCalled();
  });
  it.each([NEWER_WORKFLOWS_VERSION, "invalid"])(
    "does not offer writes for a pin-only project at %s",
    (version) => {
      pin(version);
      expect(inspectWorkflowsManagement(root)).toMatchObject({
        status: "blocked",
        canInstall: false,
        canUpdate: false,
      });
    },
  );
  it.each([
    { kind: "install", succeeds: true },
    { kind: "install", succeeds: false },
    { kind: "update", succeeds: true },
    { kind: "update", succeeds: false },
  ])(
    "excludes other roots throughout $kind and restoration (success: $succeeds)",
    async ({ kind, succeeds }) => {
      const deferred = () => {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        return { promise, resolve };
      };
      const activated = deferred();
      const finish = deferred();
      const restoring = deferred();
      const finishRestore = deferred();
      const previous = {
        executable: "newer-runtime",
        version: NEWER_WORKFLOWS_VERSION,
        binDir: "bin",
      };
      const runtime = { executable: "runtime", version: target, binDir: "bin" };
      let active = previous;
      let retained = false;
      mocks.runtime.mockImplementation((project) => (project ? runtime : active));
      mocks.use.mockImplementation(async () => {
        restoring.resolve();
        await finishRestore.promise;
        active = previous;
      });
      const activate = async () => {
        retained = true;
        active = runtime;
        activated.resolve();
        await finish.promise;
        if (!succeeds) throw new Error("operation failed after activation");
      };
      if (kind === "update") tool("claude", "2.8.0");
      mocks.apply.mockImplementationOnce(async () => {
        await activate();
        tool("claude", target);
        pin(target);
        return { ok: true, target };
      });
      const pending =
        kind === "update"
          ? updateInstalledWorkflows(options())
          : installWorkflows({
              workspaceRoot: root,
              selected: ["claude"],
              log: vi.fn(),
              hooks: {
                detect: () => [],
                readWorkspaceVersions: () => [],
                inspectPin: () => ({ exists: false, version: null }),
                readActive: mocks.runtime,
                readInstall: () => (retained ? runtime : null),
                install: activate,
                use: mocks.use,
                pin: vi.fn(),
                configure: vi.fn(async () => ({ doctorOk: true, details: "正常" })),
              },
            });
      const otherRoot = path.join(root, "other");
      const other = { ...options(), workspaceRoot: otherRoot };
      const otherRead = vi.fn(() => active);
      const assertBlocked = async () => {
        const reads = mocks.runtime.mock.calls.length;
        expect(await updateInstalledWorkflows(other)).toMatchObject({ reason: "busy" });
        expect(
          await installWorkflows({
            workspaceRoot: otherRoot,
            selected: ["claude"],
            log: vi.fn(),
            hooks: { readActive: otherRead },
          }),
        ).toMatchObject({ reason: "busy" });
        expect(mocks.runtime).toHaveBeenCalledTimes(reads);
        expect(otherRead).not.toHaveBeenCalled();
        expect(other.setNeedsRepair).not.toHaveBeenCalled();
      };
      try {
        await activated.promise;
        await assertBlocked();
        finish.resolve();
        await restoring.promise;
        await assertBlocked();
        finishRestore.resolve();
        expect(await pending).toMatchObject({ ok: succeeds });
        expect(active).toBe(previous);
        const release = acquireWorkflowsOperation(otherRoot);
        expect(release).not.toBeNull();
        release?.();
      } finally {
        finish.resolve();
        finishRestore.resolve();
        await pending;
      }
    },
  );
  it.each(["success", "failure", "throw", "cancel"])(
    "preserves a newer machine default after update %s while keeping the project pin",
    async (outcome) => {
      tool("claude", "2.8.0");
      const previous = {
        executable: "newer-runtime",
        version: NEWER_WORKFLOWS_VERSION,
        binDir: "bin",
      };
      const runtime = { executable: "runtime", version: target, binDir: "bin" };
      let active = previous;
      const cancellation = new AbortController();
      mocks.runtime.mockImplementation((project) => (project ? runtime : active));
      mocks.use.mockImplementation(async () => {
        active = previous;
      });
      mocks.apply.mockImplementationOnce(async () => {
        active = runtime;
        tool("claude", target);
        pin(target);
        if (outcome === "throw") throw new Error("installer failed after activation");
        if (outcome === "cancel") cancellation.abort();
        return { ok: outcome !== "failure", target };
      });
      const opts = { ...options(), signal: cancellation.signal };
      expect(await updateInstalledWorkflows(opts)).toMatchObject({ ok: outcome === "success" });
      expect(active).toBe(previous);
      expect(mocks.use).toHaveBeenCalledExactlyOnceWith(previous, previous.version, opts.log);
      expect(readFileSync(path.join(root, ".aidlc-version"), "utf8")).toBe(target);
      expect(opts.setNeedsRepair.mock.calls).toEqual(
        outcome === "success" ? [[true], [false]] : [[true]],
      );
      expect(mocks.doctor).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
    },
  );
  it("does not clear repair when machine restoration cannot be verified", async () => {
    tool("claude", "2.8.0");
    const previous = {
      executable: "newer-runtime",
      version: NEWER_WORKFLOWS_VERSION,
      binDir: "bin",
    };
    const runtime = { executable: "runtime", version: target, binDir: "bin" };
    let active = previous;
    mocks.runtime.mockImplementation((project) => (project ? runtime : active));
    mocks.use.mockResolvedValue(undefined);
    mocks.apply.mockImplementationOnce(async () => {
      active = runtime;
      tool("claude", target);
      pin(target);
      return { ok: true, target };
    });
    const opts = options();
    expect(await updateInstalledWorkflows(opts)).toMatchObject({
      ok: false,
      recovery: "failed",
    });
    expect(opts.log).toHaveBeenCalledWith(
      expect.stringContaining(`既定バージョン ${NEWER_WORKFLOWS_VERSION} への復元`),
    );
    expect(opts.setNeedsRepair.mock.calls).toEqual([[true]]);
    expect(mocks.doctor).not.toHaveBeenCalled();
  });
  it("rejects Copilot and opencode before applying or diagnosing their shared directory", async () => {
    mkdirSync(path.join(root, ".github", "skills", "aidlc"), { recursive: true });
    mkdirSync(path.join(root, ".opencode", "command"), { recursive: true });
    writeFileSync(path.join(root, ".opencode", "command", "aidlc.md"), "installed");
    const state = inspectWorkflowsManagement(root);
    expect(state.tools.map((entry) => entry.id)).toEqual(["copilot", "opencode"]);
    expect(state.status).toBe("blocked");
    const opts = options();
    expect(await updateInstalledWorkflows(opts)).toMatchObject({ ok: false, reason: "blocked" });
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.doctor).not.toHaveBeenCalled();
    expect(opts.setNeedsRepair).not.toHaveBeenCalled();
  });
  it("aborts a running final diagnostic and releases the workspace lock", async () => {
    tool("claude", "2.8.0");
    const native =
      await vi.importActual<typeof import("../src/native-setup.ts")>("../src/native-setup.ts");
    mocks.doctor.mockImplementation(native.runNativeDoctor);
    const cancellation = new AbortController();
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const stopped = vi.fn();
    mocks.runner.mockImplementation(
      (_command, _args, _cwd, _env, signal) =>
        new Promise((_resolve, reject) => {
          expect(signal).toBe(cancellation.signal);
          signal.addEventListener(
            "abort",
            () => {
              stopped();
              reject(new Error("aborted"));
            },
            { once: true },
          );
          started();
        }),
    );
    const opts = { ...options(), signal: cancellation.signal };
    const updating = updateInstalledWorkflows(opts);
    await start;
    expect(acquireWorkflowsOperation(root)).toBeNull();
    cancellation.abort();
    expect(await updating).toMatchObject({ ok: false, reason: "cancelled" });
    expect(stopped).toHaveBeenCalledOnce();
    expect(opts.setNeedsRepair.mock.calls).toEqual([[true]]);
    const release = acquireWorkflowsOperation(root);
    expect(release).not.toBeNull();
    release?.();
  });
  it("uses the same release for installation, state and 2.8.0 updates", () => {
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      target,
      status: "not-installed",
      canInstall: true,
      canUpdate: false,
    });
    tool("claude", "2.8.0");
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      target,
      status: "update",
      canInstall: false,
      canUpdate: true,
    });
    tool("claude", target);
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      status: "update",
      canUpdate: true,
      projectPin: null,
      engineBumpNeeded: true,
      engineVersionDiffers: false,
    });
    expect(inspectWorkflowsManagement(root).updateRetryNeeded).toBe(false);
    expect(inspectWorkflowsManagement(root, true).updateRetryNeeded).toBe(true);
    expect(inspectWorkflowsManagement(root, true)).toMatchObject({
      updateRetryNeeded: true,
      message: "前回の更新は未完了です。全ツールの更新を再実行してください。",
    });
    pin(target);
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      status: "current",
      canInstall: true,
      canUpdate: false,
    });
  });
  it("checks every installed tool and the project pin before permitting writes", () => {
    tool("claude", "2.8.0");
    tool("cursor", target);
    expect(inspectWorkflowsManagement(root).canUpdate).toBe(true);
    tool("cursor", NEWER_WORKFLOWS_VERSION);
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      status: "blocked",
      canUpdate: false,
      canInstall: false,
    });
    tool("cursor", target);
    pin(NEWER_WORKFLOWS_VERSION);
    expect(inspectWorkflowsManagement(root).status).toBe("blocked");
    pin("invalid");
    expect(inspectWorkflowsManagement(root).message).toContain("固定バージョン");
  });
  it("does not hide a detected tool with no readable version", () => {
    tool("cursor", target);
    mkdirSync(path.join(root, ".claude", "skills", "aidlc"), { recursive: true });
    const state = inspectWorkflowsManagement(root);
    expect(state.tools.find((entry) => entry.id === "claude")?.version).toBeNull();
    expect(state.status).toBe("blocked");
  });
  it("does not use a bundled document version as its update target", () => {
    mkdirSync(path.join(root, "docs"));
    writeFileSync(
      path.join(root, "docs", "official-docs.manifest.json"),
      JSON.stringify({ sourceVersion: "9.0.0" }),
    );
    tool("claude", "2.8.0");
    expect(inspectWorkflowsManagement(root)).toMatchObject({ target, canUpdate: true });
  });

  it("keeps a matching repository current when only the local CLI or pin registration is missing", () => {
    tool("claude", target);
    pin(target);
    mocks.runtime.mockReturnValue(null);
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      status: "current",
      canUpdate: false,
      message: "更新の必要はありません。",
    });
    expect(workflowsEngineCanApply(inspectWorkflowsManagement(root))).toBe(false);
  });
  it("does not offer a version bump when every tool already matches the target", () => {
    tool("claude", target);
    tool("cursor", target);
    pin(target);
    expect(inspectWorkflowsManagement(root)).toMatchObject({
      status: "current",
      canUpdate: false,
      message: "更新の必要はありません。",
    });
    expect(inspectWorkflowsManagement(root, true)).toMatchObject({
      canUpdate: true,
      engineBumpNeeded: false,
      message: "更新の必要はありません。",
    });
    expect(workflowsEngineCanApply(inspectWorkflowsManagement(root, true))).toBe(false);
    expect(inspectWorkflowsManagement(root, true).updateRetryNeeded).toBe(false);
  });
  it("keeps the update available when an undetected tool still has an older version file", () => {
    tool("claude", target);
    pin(target);
    const cursorTools = path.join(root, ".cursor", "tools");
    mkdirSync(cursorTools, { recursive: true });
    writeFileSync(
      path.join(cursorTools, "aidlc-version.ts"),
      'export const AIDLC_VERSION = "2.8.0";\n',
    );
    const state = inspectWorkflowsManagement(root);
    expect(state.tools.map((entry) => entry.id)).toEqual(["claude"]);
    expect(state).toMatchObject({
      status: "update",
      canUpdate: true,
      engineBumpNeeded: true,
    });
    expect(workflowsEngineCanApply(state)).toBe(true);
  });
  it("updates all detected tools even if a stale caller submits a subset and a different target", async () => {
    tool("claude", "2.8.0");
    tool("cursor", "2.8.0");
    const opts = options();
    expect(
      await updateInstalledWorkflows({ ...opts, ...{ selected: ["claude"], pin: "9.0.0" } }),
    ).toMatchObject({ ok: true, target });
    const call = mocks.apply.mock.calls[0]?.[0];
    expect(call.pin).toBe(target);
    expect(new Set(call.selected)).toEqual(new Set(["claude", "cursor"]));
    expect(call.detected).toEqual(call.selected);
    expect(call.preserveMachine).toBe(true);
    expect(opts.setNeedsRepair.mock.calls).toEqual([[true], [false]]);
    expect(mocks.doctor).toHaveBeenCalledTimes(2);
    expect(opts.onHarnessResult).toHaveBeenCalledTimes(2);
  });
  it.each(["claude", "cursor"] as const)(
    "keeps repair pending when %s fails its scoped final diagnostic and clears it after retry",
    async (failedTool) => {
      tool("claude", "2.8.0");
      tool("cursor", "2.8.0");
      const native =
        await vi.importActual<typeof import("../src/native-setup.ts")>("../src/native-setup.ts");
      mocks.doctor.mockImplementation(native.runNativeDoctor);
      let failing = true;
      mocks.runner.mockImplementation(async (_command, _args, _cwd, env) => {
        const failed = failing && env.AIDLC_HARNESS_DIR === `.${failedTool}`;
        return {
          code: failed ? 1 : 0,
          stdout: readFileSync(
            new URL(
              `./fixtures/doctor/v2.8.1-${failed ? "failed" : "warning"}.txt`,
              import.meta.url,
            ),
            "utf8",
          ),
          stderr: "",
        };
      });
      const opts = options();
      expect(await updateInstalledWorkflows(opts)).toMatchObject({ ok: false, reason: "doctor" });
      expect(new Set(mocks.runner.mock.calls.map((call) => call[3].AIDLC_HARNESS_DIR))).toEqual(
        new Set([".claude", ".cursor"]),
      );
      expect(mocks.runner).toHaveBeenCalledTimes(2);
      for (const call of mocks.runner.mock.calls) {
        expect(call[0]).toBe("runtime");
        expect(call[1]).toEqual(["doctor", "--project-dir", root, "--verbose", "--no-color"]);
        expect(call[2]).toBe(root);
        expect(call[3].NO_COLOR).toBe("1");
        expect(call[5]).toEqual({ timeoutMs: 120_000 });
      }
      expect(opts.onHarnessResult.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: failedTool, status: "failed" }),
          expect.objectContaining({
            id: failedTool === "claude" ? "cursor" : "claude",
            status: "completed",
          }),
        ]),
      );
      expect(opts.log).toHaveBeenCalledWith(expect.stringContaining("Claude Code の最終診断:"));
      expect(opts.log).toHaveBeenCalledWith(expect.stringContaining("Cursor の最終診断:"));
      expect(opts.setNeedsRepair.mock.calls).toEqual([[true]]);
      failing = false;
      expect(await updateInstalledWorkflows({ ...opts, needsRepair: true })).toMatchObject({
        ok: true,
      });
      expect(opts.setNeedsRepair).toHaveBeenLastCalledWith(false);
      expect(mocks.runner).toHaveBeenCalledTimes(4);
    },
  );
  it("does not clear repair or run later diagnostics when cancelled during the final check", async () => {
    tool("claude", "2.8.0");
    tool("cursor", "2.8.0");
    let current = true;
    mocks.doctor.mockImplementationOnce(async () => {
      current = false;
      throw new Error("診断を中止しました。");
    });
    const opts = { ...options(), isCurrent: () => current };
    expect(await updateInstalledWorkflows(opts)).toMatchObject({ ok: false, reason: "cancelled" });
    expect(mocks.doctor).toHaveBeenCalledOnce();
    expect(opts.setNeedsRepair.mock.calls).toEqual([[true]]);
    expect(opts.onHarnessResult).not.toHaveBeenCalled();
  });
  it("preserves a failed update marker and permits retry even after every version was written", async () => {
    tool("claude", "2.8.0");
    tool("cursor", "2.8.0");
    mocks.apply.mockImplementationOnce(async () => {
      tool("claude", target);
      tool("cursor", target);
      pin(target);
      return { ok: false, target, reason: "cursor" };
    });
    const opts = options();
    expect((await updateInstalledWorkflows(opts)).ok).toBe(false);
    expect(opts.setNeedsRepair.mock.calls).toEqual([[true]]);
    expect(inspectWorkflowsManagement(root, true).canUpdate).toBe(true);
    expect((await updateInstalledWorkflows({ ...opts, needsRepair: true })).ok).toBe(true);
    expect(opts.setNeedsRepair).toHaveBeenLastCalledWith(false);
  });
  it("does not declare completion when files remain old or final doctor fails", async () => {
    tool("claude", "2.8.0");
    mocks.apply.mockResolvedValueOnce({ ok: true, target });
    const opts = options();
    expect(await updateInstalledWorkflows(opts)).toMatchObject({
      ok: false,
      reason: "verification",
    });
    expect(mocks.doctor).not.toHaveBeenCalled();
    mocks.doctor.mockResolvedValue({
      outcome: "failed",
      checks: [],
      summary: "失敗",
      unparsedOutput: [],
      rawOutput: "",
      counts: null,
    });
    expect(await updateInstalledWorkflows({ ...opts, needsRepair: true })).toMatchObject({
      ok: false,
      reason: "doctor",
    });
    expect(opts.setNeedsRepair).not.toHaveBeenCalledWith(false);
  });
  it("shares exclusion between installation and updates and releases after failures", async () => {
    tool("claude", "2.8.0");
    const release = acquireWorkflowsOperation(root);
    try {
      expect(await updateInstalledWorkflows(options())).toMatchObject({ reason: "busy" });
      expect(
        await installWorkflows({ workspaceRoot: root, selected: ["cursor"], log: vi.fn() }),
      ).toMatchObject({ reason: "busy" });
      expect(mocks.apply).not.toHaveBeenCalled();
    } finally {
      release?.();
    }
    mocks.apply.mockRejectedValueOnce(new Error("network"));
    expect((await updateInstalledWorkflows(options())).ok).toBe(false);
    expect((await updateInstalledWorkflows(options())).ok).toBe(true);
  });
  it("rejects newer versions and cancellation without entering the installer", async () => {
    tool("claude", NEWER_WORKFLOWS_VERSION);
    expect((await updateInstalledWorkflows(options())).ok).toBe(false);
    expect(await updateInstalledWorkflows({ ...options(), isCurrent: () => false })).toMatchObject({
      reason: "cancelled",
    });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
