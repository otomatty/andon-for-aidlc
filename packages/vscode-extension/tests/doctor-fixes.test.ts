import { describe, expect, it, vi } from "vitest";
import { doctorFixFor, runDoctorFix } from "../src/doctor-fixes.ts";
import { acquireWorkflowsOperation } from "../src/workflows-operation.ts";
import type { NativeDoctorCheck } from "../src/doctor-output.ts";

const row = (over: Partial<NativeDoctorCheck>): NativeDoctorCheck => ({
  section: "project",
  status: "warn",
  label: "",
  originalLabel: "",
  translated: true,
  ...over,
});
const install = { executable: "/aidlc/bin/aidlc", version: "2.11.1", binDir: "/aidlc/bin" };

describe("Doctor fixes the Guide runs", () => {
  it.each([
    "run `aidlc engine plugin sync`",
    "run: aidlc engine plugin sync",
    "run `bun .claude/tools/aidlc.ts engine plugin sync`",
  ])("recognises %j", (originalFix) => {
    expect(doctorFixFor(row({ originalFix }))?.kind).toBe("plugin-sync");
  });
  it.each([
    "run `aidlc config --force` to restore .claude/settings.json from the installed runtime",
    "run `git checkout -- .claude`",
    "run `aidlc engine plugin sync; rm -rf /`",
    "",
  ])("leaves %j to the person", (originalFix) => {
    expect(doctorFixFor(row({ originalFix }))).toBeNull();
  });
  it("offers nothing for a passing row", () => {
    expect(
      doctorFixFor(row({ status: "ok", originalFix: "run `aidlc engine plugin sync`" })),
    ).toBeNull();
  });
  it("runs plugin sync for the named tool with the project's engine", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ message: "plugin sync complete: 1 plugin(s)" }),
      stderr: "",
    });
    const log = vi.fn();
    await runDoctorFix(
      "/project",
      "cursor",
      { kind: "plugin-sync", label: "そろえる" },
      log,
      undefined,
      runner,
      install,
    );
    expect(runner).toHaveBeenCalledWith(
      install.executable,
      ["engine", "plugin", "sync", "--project-dir", "/project", "--harness-dir", ".cursor", "--json"],
      "/project",
      expect.objectContaining({ AIDLC_HARNESS_DIR: ".cursor" }),
      undefined,
    );
    expect(log).toHaveBeenCalledWith("plugin sync complete: 1 plugin(s)");
  });
  it("waits for no other operation on the project and frees it afterwards", async () => {
    const fix = { kind: "plugin-sync" as const, label: "そろえる" };
    const runner = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const held = acquireWorkflowsOperation("/locked");
    try {
      await expect(
        runDoctorFix("/locked", "claude", fix, vi.fn(), undefined, runner, install),
      ).rejects.toThrow();
      expect(runner).not.toHaveBeenCalled();
    } finally {
      held?.();
    }
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      runDoctorFix("/locked", "claude", fix, vi.fn(), undefined, failing, install),
    ).rejects.toThrow("boom");
    await runDoctorFix("/locked", "claude", fix, vi.fn(), undefined, runner, install);
    expect(runner).toHaveBeenCalledOnce();
  });
  it("reports a failed run and a missing engine", async () => {
    const fix = { kind: "plugin-sync" as const, label: "そろえる" };
    const failed = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    await expect(
      runDoctorFix("/project", "claude", fix, vi.fn(), undefined, failed, install),
    ).rejects.toThrow("boom");
    await expect(
      runDoctorFix("/project", "claude", fix, vi.fn(), undefined, failed, null),
    ).rejects.toThrow("aidlc を確認できません");
  });
});
