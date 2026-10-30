import { compareReleaseIds, parseReleaseId } from "@andon/reader-core";
import type { VersionGate, WorkflowsManagementState } from "@andon/shared-types";
import { type CliManagementState, cliRegistersPin } from "./cli-management.ts";

/** Why the project's files are to be brought to the target. */
export type UpdateReason =
  /** The version check blocks the Guide until the project reaches the target. */
  | "older"
  /** An earlier update stopped partway; running it again finishes it. */
  | "retry"
  /** Every tool is at the target, but nothing pins the project to it. */
  | "unpinned"
  /** The check passes, yet a recorded version differs from the target. */
  | "differs";

/**
 * The one state the update screen shows. Each has a single primary action
 * (docs/maintenance/version-gate-design.md, "更新画面").
 */
export type UpdatePhase =
  | { name: "update"; reason: UpdateReason }
  /** An update or pin this panel ran changed shared files that still need a commit. */
  | { name: "commit"; change: "update" | "pin" }
  | { name: "install"; register: boolean }
  | { name: "pin" }
  | { name: "newer" }
  | { name: "unknown"; doctor: boolean }
  | { name: "setup" }
  | { name: "blocked"; message: string }
  | { name: "ok" };

/** The version check decides; the commit of a change made here comes first once it passes. */
export function updatePhase(
  gate: VersionGate,
  workflows: WorkflowsManagementState,
  cli: CliManagementState,
  changed: "update" | "pin" | null,
): UpdatePhase {
  if (changed !== null && gate.status === "ok") return { name: "commit", change: changed };
  switch (gate.status) {
    case "not-installed":
      return { name: "setup" };
    case "unknown":
      // Doctor needs a detected tool; a file-only problem is fixed by hand and re-checked.
      return { name: "unknown", doctor: workflows.tools.length > 0 };
    case "project-newer":
      return { name: "newer" };
    case "project-older":
      return workflows.canUpdate
        ? { name: "update", reason: workflows.updateRetryNeeded ? "retry" : "older" }
        : { name: "blocked", message: workflows.message };
    case "engine-newer":
      return cli.engineNewer ? { name: "pin" } : { name: "blocked", message: gate.message };
    case "engine-mismatch": {
      const register = cliRegistersPin(cli);
      return register || cli.canUpdate
        ? { name: "install", register }
        : { name: "blocked", message: cli.message || gate.message };
    }
    case "ok":
      if (!workflows.engineBumpNeeded) return { name: "ok" };
      return {
        name: "update",
        reason: workflows.updateRetryNeeded
          ? "retry"
          : workflows.engineVersionDiffers
            ? "differs"
            : "unpinned",
      };
  }
}

/** Whether `version` is older (-1), the same (0) or newer (1) than `target`; null when unreadable. */
export function compareToTarget(version: string | null, target: string): -1 | 0 | 1 | null {
  const at = version === null ? null : parseReleaseId(version);
  const wanted = parseReleaseId(target);
  if (at === null || wanted === null) return null;
  return Math.sign(compareReleaseIds(at, wanted)) as -1 | 0 | 1;
}

/**
 * The project's version as the screen names it: the oldest recorded one while
 * the project is behind (that is what the update fixes), the newest otherwise.
 * `records` are the workspace's version files, which the version check also
 * reads: a file a stopped install left behind counts even without its tool.
 */
export function shownProjectVersion(
  gate: VersionGate,
  workflows: WorkflowsManagementState,
  records: readonly (string | null)[] = [],
): string | null {
  const recorded = [
    ...workflows.tools.map((tool) => tool.version),
    ...records,
    workflows.projectPin,
  ].flatMap((version) => {
    const at = version === null ? null : parseReleaseId(version);
    return version === null || at === null ? [] : [{ version, at }];
  });
  if (recorded.length === 0) return gate.projectVersion;
  const pick = gate.status === "project-older" ? -1 : 1;
  return recorded.reduce((a, b) => (Math.sign(compareReleaseIds(b.at, a.at)) === pick ? b : a))
    .version;
}
