import {
  type AuditEvent,
  type ConstructionGatePolicy,
  isLowConfidenceEstimate,
  type NextGateEstimate,
  type NextGateKind,
  type StageView,
} from "@andon/shared-types";
import { compareByTime } from "../audit/events.ts";
import { stageJumpReaches } from "../audit/stage-jump.ts";

/**
 * L3 — where the next human approval gate falls, and how much estimated work
 * is left before it opens. Pure: no filesystem, no clock.
 *
 * It walks the reconciled views forward from the current stage and sums their
 * {@link StageView.remainingMs} until the first stage whose completion the
 * engine presents to a human. Like `estimateRemaining`, it adds no arithmetic
 * of its own that a stage row could disagree with.
 *
 * Gate placement mirrors the engine at stage granularity, citing the engine's
 * own predicates so an engine update has one place to be checked against:
 *
 *  - Initialization stages proceed without approval; every other in-scope
 *    stage presents a gate (aidlc-orchestrate.ts `computeGate`,
 *    stage-protocol.md §1).
 *  - Construction completion gates follow aidlc-lib.ts
 *    `isAutonomousConstructionGate` and the unit-major walk in
 *    aidlc-orchestrate.ts `emitUnitMajorRunStage` ({@link placementOf}).
 *  - The walking skeleton's checkpoint always needs a person
 *    (aidlc-construction-checkpoints.ts `humanRequired`); the audit log says
 *    whether it has been passed ({@link skeletonCheckpointCleared}).
 *
 * The views carry no per-Unit progress: which Unit is current, how many are
 * left, whether a checkpoint was verified. A per-Unit approval is therefore
 * reported as `unit`, whose stage-level sum covers every Unit still to come.
 * Plan Approval inside Code Generation is flagged, never used as a delimiter.
 */

/** Construction stages the compiled stage graph runs `for_each: unit-of-work`. */
export const PER_UNIT_STAGES: ReadonlySet<string> = new Set([
  "functional-design",
  "nfr-requirements",
  "nfr-design",
  "infrastructure-design",
  "code-generation",
]);

/**
 * The per-Unit stage that writes workspace source (`workspace_requires`), which
 * is what makes checkpoints apply. Each Unit's Plan Approval happens here.
 */
export const SOURCE_STAGE = "code-generation";

/**
 * When this stage is out of the plan, per-Unit artifacts are stage-level and
 * the engine walks Construction stage by stage (aidlc-lib.ts
 * `usesStageLevelPerUnitArtifacts`).
 */
export const UNITS_STAGE = "units-generation";

const NO_POLICY: ConstructionGatePolicy = {
  checkpoints: false,
  unitMajor: false,
  iterationRecorded: false,
  swarm: false,
  autonomous: false,
  teamOwnership: false,
  unitEndRhythm: false,
  skeletonStanceRecorded: false,
  skeletonMayRun: false,
};

/** What the audit log adds to the state file's policy. */
export interface GateEvidence {
  /** {@link skeletonCheckpointCleared} over the active record's events. */
  skeletonCleared: boolean;
  /**
   * Plan approval is on for this piece of work (v2.11.0 aidlc-guard-switch.ts
   * `resolvePlanApprovalSetting`). Unset reads as on.
   */
  planApproval?: boolean;
}

const NO_EVIDENCE: GateEvidence = { skeletonCleared: false };

/**
 * How one unfinished stage's completion reaches the human.
 *
 * - `auto`: the engine approves it without asking.
 * - `stage`: its own gate, when its work ends.
 * - `unit`: a per-Unit gate after the current Unit's work on this stage.
 * - `block`: its gate waits until every Unit has finished the per-Unit block.
 * - `unit-block`: a per-Unit approval after the current Unit's whole block.
 */
type Placement = "auto" | "stage" | "unit" | "block" | "unit-block";

interface GateContext {
  policy: ConstructionGatePolicy;
  /** aidlc-lib.ts `firstConstructionApprovalStage`: never waived by autonomy. */
  firstConstruction: string | null;
  /** Per-Unit artifacts are Unit-level (not `usesStageLevelPerUnitArtifacts`). */
  unitLevel: boolean;
  /**
   * aidlc-lib.ts `constructionCheckpointsApply`. The engine also needs a
   * non-empty Unit DAG, which the views do not show; Unit-level artifacts are
   * the closest evidence and are required where it matters.
   */
  checkpointsApply: boolean;
  /**
   * The first Unit may be a walking skeleton whose checkpoint is still owed.
   * Until it is passed, autonomy waives neither that checkpoint nor the other
   * Construction gates (aidlc-lib.ts `constructionCheckpointGaps`).
   */
  skeletonPending: boolean;
}

function gateContext(
  views: readonly StageView[],
  policy: ConstructionGatePolicy,
  evidence: GateEvidence,
): GateContext {
  const inPlan = (view: StageView | undefined): boolean =>
    view !== undefined && view.execution === "EXECUTE" && view.status !== "skipped";
  const source = views.find((view) => view.stage === SOURCE_STAGE);
  return {
    policy,
    // Completed rows stay in the search: approving the first stage must not
    // make the next one "first" in turn.
    firstConstruction:
      views.find((view) => view.phase === "CONSTRUCTION" && inPlan(view))?.stage ?? null,
    // The plan action, whatever the checkbox says.
    unitLevel: views.find((view) => view.stage === UNITS_STAGE)?.execution === "EXECUTE",
    checkpointsApply: policy.checkpoints && !policy.teamOwnership && inPlan(source),
    skeletonPending: policy.skeletonMayRun && !evidence.skeletonCleared,
  };
}

/**
 * The engine's decision for one stage, at stage granularity.
 *
 * Unit-major iteration with Unit-level artifacts walks each Unit through the
 * per-Unit stages with their gates held back. Afterwards:
 *  - team-owned Units get their own Unit gates, per stage or at the Unit's end;
 *  - checkpoint workflows approve each Unit at a checkpoint, and the late stage
 *    gates are bookkeeping. Autonomy makes ordinary checkpoints automatic, but
 *    not a walking skeleton's, which is the first Unit's;
 *  - legacy workflows present the stage gates one by one once every Unit is
 *    done, and autonomy never waives them.
 * Outside that walk, autonomy waives Construction completion gates except the
 * first one (legacy), or when a Skeleton Stance is recorded and no skeleton
 * checkpoint is owed (checkpoints).
 */
function placementOf(view: StageView, context: GateContext): Placement {
  if (view.phase === "INITIALIZATION") return "auto";
  if (view.phase !== "CONSTRUCTION") return "stage";

  const { policy } = context;
  const perUnitMajor = PER_UNIT_STAGES.has(view.stage) && policy.unitMajor;
  const unitWalk = perUnitMajor && context.unitLevel;

  if (policy.teamOwnership && unitWalk) return policy.unitEndRhythm ? "unit-block" : "unit";

  if (context.checkpointsApply) {
    if (perUnitMajor || (view.stage === SOURCE_STAGE && policy.swarm)) {
      // Without Unit-level artifacts there is no checkpoint evidence, and the
      // engine keeps each stage's own human gate.
      if (!context.unitLevel) return "stage";
      if (policy.autonomous && !context.skeletonPending) return "auto";
      return perUnitMajor ? "unit-block" : "unit";
    }
    return policy.autonomous && policy.skeletonStanceRecorded && !context.skeletonPending
      ? "auto"
      : "stage";
  }

  const humanGate: Placement = unitWalk ? "block" : "stage";
  if (!policy.autonomous || view.stage === context.firstConstruction || perUnitMajor) {
    return humanGate;
  }
  return "auto";
}

function estimate(
  kind: NextGateKind,
  stage: string | null,
  summed: readonly StageView[],
  autoApproved: readonly string[],
  planApproval = true,
): NextGateEstimate {
  const parts = summed.flatMap((view) => (view.remainingMs === null ? [] : [view.remainingMs]));
  return {
    kind,
    stage,
    remainingMs:
      summed.length === 0 ? 0 : parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0),
    stages: summed.map((view) => view.stage),
    autoApproved: [...autoApproved],
    planApproval: planApproval && summed.some((view) => view.stage === SOURCE_STAGE),
    lowConfidence: summed.some(isLowConfidenceEstimate),
    estimateCoverage: { known: parts.length, unknown: summed.length - parts.length },
  };
}

/**
 * The next approval gate from the current stage, or from the first row when
 * no row is current (an unstarted or finished workflow, the `none` sentinel).
 *
 * A stage awaiting approval with nothing unfinished before it is an open gate
 * with nothing to wait for; further along the walk (a jump, a hand-edited
 * file) it is an ordinary gate after the work before it. A stage being revised
 * after a rejection is its own next gate. A per-Unit block's gate falls where
 * the block ends, before the next stage's work.
 */
export function estimateNextGate(
  views: readonly StageView[],
  policy: ConstructionGatePolicy = NO_POLICY,
  evidence: GateEvidence = NO_EVIDENCE,
): NextGateEstimate {
  const context = gateContext(views, policy, evidence);
  const plan = evidence.planApproval ?? true;
  const current = views.findIndex((view) => view.isCurrent);
  const summed: StageView[] = [];
  const autoApproved: string[] = [];
  let block: { placement: "block" | "unit-block"; first: string; last: string } | null = null;

  for (const view of views.slice(Math.max(0, current))) {
    if (!view.countsTowardRemaining) continue;
    if (view.status === "awaiting-approval" && summed.length === 0) {
      return estimate("open", view.stage, [], []);
    }
    const placement =
      view.status === "revising" || view.status === "awaiting-approval"
        ? "stage"
        : placementOf(view, context);
    if (block !== null && placement !== block.placement) break;
    summed.push(view);
    if (placement === "auto") {
      autoApproved.push(view.stage);
    } else if (placement === "stage" || placement === "unit") {
      return estimate(placement, view.stage, summed, autoApproved, plan);
    } else if (block === null) {
      block = { placement, first: view.stage, last: view.stage };
    } else {
      block.last = view.stage;
    }
  }

  if (block === null) return estimate("none", null, summed, autoApproved, plan);
  // Legacy: the first held-back gate opens once every Unit is done. Unit
  // approvals follow the current Unit's last stage.
  if (block.placement !== "block") return estimate("unit", block.last, summed, autoApproved, plan);
  const gate = estimate("block", block.first, summed, autoApproved, plan);
  // v2.11.0 approvesTogetherStages: outside autonomy, the person's one reply at
  // the block's first gate approves every stage of a block of two or more.
  const together = summed
    .slice(summed.findIndex((view) => view.stage === block.first))
    .map((view) => view.stage);
  return !policy.autonomous && together.length >= 2
    ? { ...gate, approvesTogether: together }
    : gate;
}

/** A walking skeleton's checkpoint, as the engine names it in gate events. */
export const SKELETON_CHECKPOINT = "walking-skeleton";
/** An ordinary Unit's checkpoint. */
export const UNIT_CHECKPOINT = "construction-unit";

/**
 * Whether the walking skeleton's checkpoint is behind the workflow, from the
 * active record's audit events (aidlc-construction-checkpoints.ts `snapshot`).
 *
 * The skeleton is the first Unit, and Units get their checkpoints in order, so
 * any Unit checkpoint approval since the last reset means none is owed: either
 * the skeleton was approved, or the first Unit was an ordinary one (a
 * `scope-dependent` stance the scope turned off). A later rejection of the
 * skeleton checkpoint owes it again.
 *
 * The engine also re-checks each approval's fingerprint and verification;
 * a skeleton whose files changed after approval therefore still reads as
 * passed here.
 */
export function skeletonCheckpointCleared(
  events: readonly AuditEvent[],
  options: {
    /** Stage-graph order for a jump's reach (`stageOrderOf`); null reaches every stage. */
    stageOrder?: readonly string[] | null;
    /** The per-Unit Construction stages in scope; defaults to every per-Unit stage. */
    unitStages?: readonly string[];
  } = {},
): boolean {
  const order = options.stageOrder ?? null;
  const unitStages = options.unitStages ?? [...PER_UNIT_STAGES];
  let cleared = false;
  for (const event of [...events].sort(compareByTime)) {
    const checkpoint = event.fields?.Checkpoint;
    if (event.event === "WORKFLOW_STARTED") {
      cleared = false;
    } else if (event.event === "STAGE_JUMPED") {
      // aidlc-construction-checkpoints.ts (v2.11.0): a jump counts only when it
      // reaches one of the Unit's stages (`stageJumpReaches`).
      if (unitStages.some((stage) => stageJumpReaches(event.fields?.Target, stage, order)))
        cleared = false;
    } else if (event.event === "GATE_APPROVED") {
      if (checkpoint === SKELETON_CHECKPOINT || checkpoint === UNIT_CHECKPOINT) cleared = true;
    } else if (event.event === "GATE_REJECTED" && checkpoint === SKELETON_CHECKPOINT) {
      cleared = false;
    }
  }
  return cleared;
}
