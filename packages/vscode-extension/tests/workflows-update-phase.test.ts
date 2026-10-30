import {
  type VersionGate,
  type VersionGateStatus,
  WORKFLOWS_TARGET_VERSION,
  type WorkflowsManagementState,
} from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import type { CliManagementState } from "../src/cli-management.ts";
import {
  compareToTarget,
  shownProjectVersion,
  updatePhase,
} from "../src/workflows-update-phase.ts";
import { NEWER_WORKFLOWS_VERSION } from "./workflows-version-fixture.ts";

const target = WORKFLOWS_TARGET_VERSION;
const gate = (status: VersionGateStatus, extra: Partial<VersionGate> = {}): VersionGate => ({
  status,
  target,
  tools: [],
  pin: null,
  engine: null,
  native: true,
  projectVersion: null,
  rollback: null,
  message: `${status} の説明`,
  ...extra,
});
const workflows: WorkflowsManagementState = {
  target,
  root: "project",
  projectPin: "2.8.0",
  status: "update",
  message: "更新があります。",
  canInstall: false,
  canUpdate: true,
  engineBumpNeeded: true,
  engineVersionDiffers: true,
  updateRetryNeeded: false,
  tools: [
    { id: "cursor", label: "Cursor", version: "2.8.0" },
    { id: "claude", label: "Claude Code", version: "2.8.0" },
  ],
};
const current: WorkflowsManagementState = {
  ...workflows,
  projectPin: target,
  status: "current",
  canUpdate: false,
  engineBumpNeeded: false,
  engineVersionDiffers: false,
  tools: workflows.tools.map((tool) => ({ ...tool, version: target })),
};
const cli: CliManagementState = {
  machineVersion: target,
  projectPin: target,
  projectVersion: target,
  effectiveVersion: target,
  target,
  targetInstalled: true,
  launcherReady: true,
  setupReady: true,
  canPrepare: false,
  canUpdate: false,
  confirmUpdate: false,
  engineNewer: false,
  status: "ready",
  message: "準備済み",
  updateMessage: "CLI の更新は不要です。",
};

describe("updatePhase", () => {
  it("names one state for each version check result", () => {
    expect(updatePhase(gate("project-older"), workflows, cli, null)).toEqual({
      name: "update",
      reason: "older",
    });
    expect(updatePhase(gate("not-installed"), workflows, cli, null)).toEqual({ name: "setup" });
    expect(updatePhase(gate("project-newer"), workflows, cli, null)).toEqual({ name: "newer" });
    expect(updatePhase(gate("unknown"), workflows, cli, null)).toEqual({
      name: "unknown",
      doctor: true,
    });
    expect(updatePhase(gate("unknown"), { ...workflows, tools: [] }, cli, null)).toEqual({
      name: "unknown",
      doctor: false,
    });
    expect(updatePhase(gate("ok"), current, cli, null)).toEqual({ name: "ok" });
  });

  it("asks this PC to install or register the project's version", () => {
    expect(
      updatePhase(gate("engine-mismatch"), current, { ...cli, canUpdate: true }, null),
    ).toEqual({ name: "install", register: false });
    expect(
      updatePhase(gate("engine-mismatch"), current, { ...cli, canPrepare: true }, null),
    ).toEqual({ name: "install", register: true });
    expect(updatePhase(gate("engine-mismatch"), current, cli, null)).toEqual({
      name: "blocked",
      message: "準備済み",
    });
  });

  it("offers the pin only while this PC's newer default would run the project", () => {
    expect(updatePhase(gate("engine-newer"), current, { ...cli, engineNewer: true }, null)).toEqual(
      { name: "pin" },
    );
    expect(updatePhase(gate("engine-newer"), current, cli, null)).toMatchObject({
      name: "blocked",
    });
  });

  it("finishes an update that stopped or writes a missing pin when the check passes", () => {
    expect(
      updatePhase(gate("project-older"), { ...workflows, updateRetryNeeded: true }, cli, null),
    ).toEqual({ name: "update", reason: "retry" });
    expect(
      updatePhase(
        gate("ok"),
        { ...current, projectPin: null, engineBumpNeeded: true, canUpdate: true },
        cli,
        null,
      ),
    ).toEqual({ name: "update", reason: "unpinned" });
  });

  it("keeps the commit in front once the change it made passes the check", () => {
    expect(updatePhase(gate("ok"), current, cli, "update")).toEqual({
      name: "commit",
      change: "update",
    });
    expect(updatePhase(gate("ok"), current, cli, "pin")).toEqual({ name: "commit", change: "pin" });
    expect(updatePhase(gate("project-older"), workflows, cli, "update")).toMatchObject({
      name: "update",
    });
  });
});

describe("versions on the update screen", () => {
  it("compares with the target, including unreadable versions", () => {
    expect(compareToTarget("2.8.0", target)).toBe(-1);
    expect(compareToTarget(target, target)).toBe(0);
    expect(compareToTarget(NEWER_WORKFLOWS_VERSION, target)).toBe(1);
    expect(compareToTarget("abc", target)).toBeNull();
    expect(compareToTarget(null, target)).toBeNull();
  });

  it("names the oldest version of a project behind the target and the newest otherwise", () => {
    const mixed = {
      ...workflows,
      tools: [
        { id: "cursor", label: "Cursor", version: "2.8.0" },
        { id: "claude", label: "Claude Code", version: target },
      ],
    };
    expect(shownProjectVersion(gate("project-older"), mixed)).toBe("2.8.0");
    // A version file a stopped install left behind counts, as it does for the check.
    expect(shownProjectVersion(gate("project-older"), current, ["2.8.0", target])).toBe("2.8.0");
    expect(
      shownProjectVersion(gate("project-newer"), {
        ...mixed,
        projectPin: NEWER_WORKFLOWS_VERSION,
      }),
    ).toBe(NEWER_WORKFLOWS_VERSION);
    expect(
      shownProjectVersion(gate("unknown", { projectVersion: "2.0.0" }), {
        ...workflows,
        projectPin: null,
        tools: [],
      }),
    ).toBe("2.0.0");
  });
});
