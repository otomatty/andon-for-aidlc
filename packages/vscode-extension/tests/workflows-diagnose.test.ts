import { WORKFLOWS_TARGET_VERSION } from "@andon/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  doctor: vi.fn(),
  run: vi.fn(),
  inspect: vi.fn(),
  detect: vi.fn(),
}));
vi.mock("../src/native-setup.ts", () => ({
  readNativeInstall: mocks.runtime,
  runNativeDoctor: mocks.doctor,
  runSetupProcess: mocks.run,
}));
vi.mock("../src/workflows-management.ts", () => ({ inspectWorkflowsManagement: mocks.inspect }));
vi.mock("../src/harness-detect.ts", () => ({
  detectHarnesses: mocks.detect,
  HARNESS_LABELS: { claude: "Claude Code", cursor: "Cursor" },
}));
vi.mock("../src/doctor-output.ts", () => ({
  formatDoctorDetailsForLog: (report: { summary: string }) => report.summary,
}));

import { diagnoseInstalledWorkflows } from "../src/workflows-diagnose.ts";
import { acquireWorkflowsOperation } from "../src/workflows-operation.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue({
    version: WORKFLOWS_TARGET_VERSION,
    executable: "aidlc",
    binDir: "bin",
  });
  mocks.detect.mockReturnValue({ harnesses: [{ id: "claude" }, { id: "cursor" }] });
  mocks.inspect.mockReturnValue({
    status: "current",
    projectPin: WORKFLOWS_TARGET_VERSION,
    tools: [{ id: "claude" }, { id: "cursor" }],
  });
  mocks.doctor.mockResolvedValue({ outcome: "ok", summary: "healthy" });
});

const options = () => ({
  workspaceRoot: "project",
  isCurrent: () => true,
  log: vi.fn(),
  setNeedsRepair: vi.fn(async (_value: boolean) => {}),
  onHarnessResult: vi.fn(),
});

describe("Doctor rerun after a repository update", () => {
  it("diagnoses every tool with its own environment and clears incomplete update only after all succeed", async () => {
    const opts = options();
    mocks.doctor.mockImplementation(async (_runtime, _root, runner) => {
      await runner("aidlc", ["doctor"], "project", { EXISTING: "preserved" });
      return { outcome: "ok", summary: "healthy" };
    });
    const result = await diagnoseInstalledWorkflows(opts);
    expect(result.ok).toBe(true);
    expect(mocks.run.mock.calls.map((call) => call[3])).toEqual([
      { EXISTING: "preserved", AIDLC_HARNESS_DIR: ".claude" },
      { EXISTING: "preserved", AIDLC_HARNESS_DIR: ".cursor" },
    ]);
    expect(opts.setNeedsRepair).toHaveBeenCalledWith(false);
    expect(opts.onHarnessResult).toHaveBeenCalledWith({
      id: "cursor",
      status: "completed",
      message: "Doctor の確認完了",
    });
  });
  it("retains incomplete status when one tool fails and still diagnoses the remaining tool", async () => {
    const opts = options();
    mocks.doctor
      .mockResolvedValueOnce({ outcome: "error", summary: "broken" })
      .mockResolvedValueOnce({ outcome: "warning", summary: "warning" });
    expect((await diagnoseInstalledWorkflows(opts)).ok).toBe(false);
    expect(mocks.doctor).toHaveBeenCalledTimes(2);
    expect(opts.setNeedsRepair).not.toHaveBeenCalled();
    expect(opts.onHarnessResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: "claude", status: "failed" }),
    );
  });
  it("shows a thrown diagnostic error for its tool and continues with the remaining tool", async () => {
    const opts = options();
    mocks.doctor.mockRejectedValueOnce(new Error("access denied"));
    expect((await diagnoseInstalledWorkflows(opts)).ok).toBe(false);
    expect(mocks.doctor).toHaveBeenCalledTimes(2);
    expect(opts.onHarnessResult).toHaveBeenCalledWith({
      id: "claude",
      status: "failed",
      message: "Doctor の実行失敗: access denied",
    });
    expect(opts.setNeedsRepair).not.toHaveBeenCalled();
  });
  it.each([
    { status: "update", projectPin: WORKFLOWS_TARGET_VERSION },
    { status: "current", projectPin: "2.8.0" },
    { status: "current", projectPin: null },
  ])("does not mark a partly updated project complete from Doctor alone: %o", async (state) => {
    const opts = options();
    mocks.inspect.mockReturnValue(state);
    expect((await diagnoseInstalledWorkflows(opts)).ok).toBe(true);
    expect(opts.setNeedsRepair).not.toHaveBeenCalled();
  });
  it("does not mark an old runtime complete even when the repository is current", async () => {
    const opts = options();
    mocks.runtime.mockReturnValue({ version: "2.8.0", executable: "aidlc", binDir: "bin" });
    await diagnoseInstalledWorkflows(opts);
    expect(opts.setNeedsRepair).not.toHaveBeenCalled();
  });
  it("cancels on a closed or untrusted workspace and releases the operation lock", async () => {
    const controller = new AbortController();
    const opts = { ...options(), signal: controller.signal };
    mocks.doctor.mockImplementation(async () => {
      controller.abort();
      return { outcome: "ok", summary: "healthy" };
    });
    expect((await diagnoseInstalledWorkflows(opts)).ok).toBe(false);
    expect(mocks.doctor).toHaveBeenCalledOnce();
    expect(opts.setNeedsRepair).not.toHaveBeenCalled();
    const release = acquireWorkflowsOperation("project");
    expect(release).not.toBeNull();
    release?.();
  });
  it("blocks concurrent updates and reports missing runtime without changing project state", async () => {
    const opts = options();
    const release = acquireWorkflowsOperation("other");
    try {
      expect((await diagnoseInstalledWorkflows(opts)).message).toContain("実行中");
    } finally {
      release?.();
    }
    mocks.runtime.mockReturnValue(null);
    expect((await diagnoseInstalledWorkflows(opts)).message).toContain("セットアップ");
    expect(mocks.doctor).not.toHaveBeenCalled();
    expect(opts.setNeedsRepair).not.toHaveBeenCalled();
  });
});
