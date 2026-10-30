import type { ConstructionWalk, StageTiming, WorkflowModel } from "@andon/shared-types";
import { PER_UNIT_STAGES, UNITS_STAGE } from "./next-gate.ts";

/**
 * L3 — which Construction walk a workflow's per-Unit runs were recorded
 * under. Pure: no filesystem, no clock.
 *
 * The engine enters its unit-major walk only when `Construction Iteration` is
 * exactly `unit-major` and the plan runs `units-generation`
 * (aidlc-orchestrate.ts `emitForSlug` → `emitUnitMajorRunStage`, which falls
 * back to the stage-by-stage walk under aidlc-lib.ts
 * `usesStageLevelPerUnitArtifacts`). The plan action is the row's
 * EXECUTE/SKIP suffix, whatever its checkbox says. A state file without a
 * `units-generation` row reads as not running it: the engine would consult
 * the scope file, which this reader does not load.
 */
export function constructionWalkOf(workflow: WorkflowModel): ConstructionWalk {
  const runsUnits = workflow.stages.some(
    (stage) => stage.slug === UNITS_STAGE && stage.execution === "EXECUTE",
  );
  return workflow.constructionPolicy?.unitMajor === true && runsUnits
    ? "unit-major"
    : "stage-major";
}

/**
 * Whether a past run may size the given walk's stages. Only per-Unit
 * Construction stages depend on the walk; every other run is evidence for
 * anyone.
 *
 * - `use`: same walk, or a run nobody stamped (the workflow's own record).
 * - `unknown`: the recording workflow's state could not be read — counted
 *   among the excluded runs, since its walk cannot be told.
 * - `other`: the other walk's run, which measures something else under the
 *   same slug. Left out without being counted as a rejected measurement.
 */
export function walkMatch(
  sample: StageTiming,
  walk: ConstructionWalk | undefined,
): "use" | "unknown" | "other" {
  if (walk === undefined || !PER_UNIT_STAGES.has(sample.stage)) return "use";
  if (sample.constructionWalk === undefined || sample.constructionWalk === walk) return "use";
  return sample.constructionWalk === "unknown" ? "unknown" : "other";
}
