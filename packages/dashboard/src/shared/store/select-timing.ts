import type {
  NextGateEstimate,
  RemainingEstimate,
  StageView,
  TimingsPayload,
  UnitWalk,
} from "@andon/shared-types";
import { currentStageView, timingsMatchStage } from "@andon/shared-types";
import { type AppState, viewValue } from "./state.ts";

/**
 * The freshness gate between the two independently-fetched feeds, applied
 * once for the whole app (issue #10).
 *
 * `workflow` and `timings` are separate reads, so a change push can advance
 * the current stage while an in-flight timings response still describes the
 * previous one. NowStrip, Header and the VS Code status bar each used to
 * re-do that comparison — three copies of one rule, and the payload's own
 * notion of "current" was reverse-engineered from `StageView.isCurrent` each
 * time. The payload now carries its `currentStage` snapshot, and the whole
 * comparison happens here; the components below take pre-gated values and
 * hold no opinion about staleness.
 *
 * Not gated on freshness, on purpose: `StageRail`, which renders one row per
 * stage rather than "the current stage". Blanking every row because the
 * current stage moved would be a worse answer than the per-row
 * `stageViewMatches` check it already makes.
 */
export interface CurrentTiming {
  /**
   * The current stage's reconciled view, or `null` when the workflow has no
   * current stage or the payload predates the one on screen.
   */
  view: StageView | null;
  /**
   * The whole-workflow roll-up, or `null` when the payload is stale — a
   * total computed against the previous stage still bills that stage's
   * remainder, so it must not render under the new one.
   */
  remaining: RemainingEstimate | null;
  estimateCoverage: TimingsPayload["estimateCoverage"] | null;
  /**
   * The next approval gate, or `null` when the payload is stale or carries
   * none. It was walked from the payload's own current stage, so a stale one
   * would name a gate the workflow on screen has already passed.
   */
  nextGate: NextGateEstimate | null;
}

const NOTHING: CurrentTiming = {
  view: null,
  remaining: null,
  estimateCoverage: null,
  nextGate: null,
};

/**
 * The timings payload for the intent on screen, or `null` when the selection
 * is unknown or the payload was aggregated for a different record. Stage
 * names are not an identity: two intents can share them, and a payload that
 * does not name the selection must not render (issue #165 review).
 */
export function timingsForDisplayedIntent(state: AppState): TimingsPayload | null {
  const selected = viewValue(state.intents)?.selected ?? null;
  const payload = viewValue(state.timings);
  if (payload === null || selected === null || payload.intent !== selected) return null;
  if (payload.space !== undefined && payload.space !== viewValue(state.intents)?.space) return null;
  return payload;
}

export function selectCurrentTiming(state: AppState): CurrentTiming {
  const workflow = viewValue(state.workflow);
  // No workflow value at all (still loading, or the read failed) is not the
  // same fact as a workflow that reports no current stage, and folding both
  // to `null` would let a payload reporting `currentStage: null` pass the
  // freshness check against a workflow we have not actually read — the header
  // would show a total we cannot confirm (CodeRabbit review on PR #18). There
  // is nothing to be fresh *against* here, so nothing renders.
  if (workflow === null) return NOTHING;

  const stage = workflow.currentStage;
  const payload = timingsForDisplayedIntent(state);
  const fresh = timingsMatchStage(stage, payload) ? payload : null;
  return {
    view: currentStageView(stage, fresh),
    remaining: fresh === null ? null : fresh.remaining,
    estimateCoverage: fresh?.estimateCoverage ?? null,
    nextGate: fresh?.nextGate ?? null,
  };
}

/**
 * The Unit walk for the Now strip, behind the same stage gate as the other
 * timing fields: a payload from a stage the workflow has left would name a
 * Unit of that stage as the one being worked on.
 */
export function selectUnitWalk(state: AppState): UnitWalk | null {
  const workflow = viewValue(state.workflow);
  if (workflow === null) return null;
  const payload = timingsForDisplayedIntent(state);
  return timingsMatchStage(workflow.currentStage, payload) ? (payload?.unitWalk ?? null) : null;
}

/** Degradation notes from a `partial` `/api/timings` response for the intent on screen. */
export function selectTimingNotes(state: AppState): string[] {
  if (timingsForDisplayedIntent(state) === null) return [];
  return state.timings.kind === "partial" ? state.timings.notes : [];
}
