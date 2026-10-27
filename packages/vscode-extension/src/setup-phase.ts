import type { CliBlockedReason } from "./cli-management.ts";
import type { HarnessId } from "./harness-detect.ts";
import { SETUP_RELEASE } from "./native-setup.ts";
import type { RuntimeIssueKind, SetupSnapshot } from "./setup-state.ts";

/** Why setup cannot go on from this screen. */
export type SetupBlock =
  | { kind: "cli"; reason: CliBlockedReason | undefined }
  | { kind: "runtime"; issue: RuntimeIssueKind }
  | { kind: "incomplete" }
  | { kind: "workflows" };

/** The one state setup shows: each has a single open step and a single primary action. */
export type SetupPhase =
  | { name: "trust" }
  | { name: "cli" }
  | { name: "project"; retry: HarnessId[] }
  | { name: "ready" }
  | { name: "blocked"; step: "cli" | "project"; block: SetupBlock };

/** Trust first, then this machine's CLI, then the project's tools; a step that cannot go on blocks. */
export function setupPhase(
  snapshot: SetupSnapshot,
  trusted: boolean,
  selected: readonly HarnessId[],
  creatingProject: boolean,
): SetupPhase {
  if (!trusted) return { name: "trust" };
  const cli = snapshot.cli;
  if (!(cli?.setupReady ?? snapshot.native !== null)) {
    const canAct = cli ? cli.canPrepare || (cli.confirmUpdate && cli.canUpdate) : true;
    return canAct
      ? { name: "cli" }
      : { name: "blocked", step: "cli", block: { kind: "cli", reason: cli?.blockedReason } };
  }
  // Tools selected while creating the project but not configured yet: a partial install to retry.
  const retry = creatingProject ? selected.filter((id) => !snapshot.harnesses.includes(id)) : [];
  if (snapshot.harnesses.length === 0 || retry.length > 0) {
    const canInstall =
      snapshot.workflows?.canInstall ?? (!snapshot.version || snapshot.version === SETUP_RELEASE);
    return canInstall
      ? { name: "project", retry }
      : { name: "blocked", step: "project", block: { kind: "workflows" } };
  }
  if (snapshot.configured) return { name: "ready" };
  return {
    name: "blocked",
    step: "project",
    block: snapshot.runtimeIssueKind
      ? { kind: "runtime", issue: snapshot.runtimeIssueKind }
      : { kind: "incomplete" },
  };
}
