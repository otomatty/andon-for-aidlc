import type { StageInfo, StageTiming, WorkflowModel } from "@aidlc-guide/shared-types";

/**
 * Shared builders for the timing tests. These encode the shapes the timing
 * modules reconcile — `StageInfo`/`WorkflowModel` from the state file,
 * `StageTiming` from the audit log — so keeping one copy is the same argument
 * issue #9 makes about the reconciliation itself: a second copy is a second
 * place to forget when the shapes move (CodeRabbit review on PR #15).
 */

/** An in-scope, unstarted CONSTRUCTION stage unless overridden. */
export function stage(slug: string, over: Partial<StageInfo> = {}): StageInfo {
  return { slug, phase: "CONSTRUCTION", execution: "EXECUTE", status: "not-started", ...over };
}

/** A workflow with no stages and no current stage unless overridden. */
export function workflow(over: Partial<WorkflowModel> = {}): WorkflowModel {
  return {
    project: "p",
    scope: "feature",
    depth: "practical",
    stateVersion: 8,
    phase: "CONSTRUCTION",
    currentStage: null,
    nextStage: null,
    gate: null,
    stages: [],
    done: 0,
    total: 0,
    ...over,
  };
}

/** `endedAt` is what makes a run closed — `at` orders several closed runs. */
export function run(stageName: string, activeMs: number, open = false, at = "01"): StageTiming {
  return {
    stage: stageName,
    startedAt: `2026-07-20T${at}:00:00Z`,
    endedAt: open ? null : `2026-07-20T${at}:30:00Z`,
    wallMs: activeMs * 2,
    activeMs,
    eventCount: 50,
  };
}
