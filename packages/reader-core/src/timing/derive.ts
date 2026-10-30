import type { AuditEvent, StageTiming, TimingPolicy } from "@andon/shared-types";
import { deriveMeasurementIntervals } from "../audit/intervals.ts";
import { stageJumpReaches } from "../audit/stage-jump.ts";
import { classifyRuns, prepareRuns } from "./classify.ts";
import { pairRuns } from "./pairing.ts";
import {
  DEFAULT_TIMING_POLICY,
  SENSITIVITY_THRESHOLDS_MS,
  validateTimingPolicy,
} from "./policy.ts";

/** Pure read-time calculation: pair once, extract waits once, compare gap policies. */

/**
 * `stageOrder` is the stage-graph order a STAGE_JUMPED row's reach is judged
 * against when matching `Run floor` fields (`stageOrderOf`); without it every
 * jump reaches every stage.
 */
export function deriveStageTimings(
  events: readonly AuditEvent[],
  now: number,
  policy: TimingPolicy = DEFAULT_TIMING_POLICY,
  stageOrder: readonly string[] | null = null,
): { timings: StageTiming[]; warnings: string[] } {
  validateTimingPolicy(policy);
  const pairing = pairRuns(events);
  const measurement = deriveMeasurementIntervals(pairing.events, now, stageOrder);
  const runs = prepareRuns(
    pairing.events,
    pairing.boundaries,
    measurement.intervals,
    measurement.diagnostics,
    now,
    stageOrder,
  );
  const policies = [...new Set([policy.gapThresholdMs, ...SENSITIVITY_THRESHOLDS_MS])];
  const classified = new Map(
    policies.map((threshold) => [threshold, classifyRuns(runs, threshold)]),
  );
  const selected = classified.get(policy.gapThresholdMs);
  const ordinals = new Map<string, number>();
  const identities = new Map(
    pairing.boundaries
      .slice()
      .sort((a, b) => (a.openIndex ?? a.closeIndex ?? 0) - (b.openIndex ?? b.closeIndex ?? 0))
      .map((boundary) => {
        const epoch = pairing.events
          .slice(0, boundary.openIndex ?? boundary.closeIndex ?? 0)
          .filter(
            (event) =>
              event.event === "WORKFLOW_STARTED" ||
              // v2.11.0 stageJumpReaches: a jump starts a new epoch only for
              // its Target and the stages after it.
              (event.event === "STAGE_JUMPED" &&
                stageJumpReaches(event.fields?.Target, boundary.stage, stageOrder)),
          ).length;
        const key = `${epoch}:${boundary.stage}`;
        const ordinal = (ordinals.get(key) ?? 0) + 1;
        ordinals.set(key, ordinal);
        return [boundary, `${key}:${ordinal}`];
      }),
  );

  // Only these three dispositions are ever reported: `completed` and
  // `recovered-completed` runs close with a real (possibly zero) duration;
  // `open` runs are measured against `now`. `abandoned`, `skipped` and
  // `recovered-skipped` boundaries exist purely so attribution.ts can
  // correctly soak up the events that landed while they were open (issue #5
  // risk note 2) — they must never surface as a sample in estimate.ts's pool.
  const reportable = pairing.boundaries.filter(
    (b) =>
      b.disposition === "completed" ||
      b.disposition === "recovered-completed" ||
      b.disposition === "open",
  );

  // Reconstruct the original single-loop's push order: every run that
  // closed DURING the loop was pushed in the order it closed (closeIndex is
  // monotonic across the loop, since events are processed strictly in
  // order), and only after the loop finished did the still-open runs get
  // appended, in the `openRuns` map's own insertion order — which for a
  // boundary that's still open (never abandoned-and-reopened) is exactly
  // its own openIndex order.
  reportable.sort((a, b) => {
    const aClosed = a.closeIndex !== null;
    const bClosed = b.closeIndex !== null;
    if (aClosed !== bClosed) return aClosed ? -1 : 1;
    return (a.closeIndex ?? a.openIndex ?? 0) - (b.closeIndex ?? b.openIndex ?? 0);
  });

  const timings: StageTiming[] = reportable.map((boundary) => {
    const run = runs.find((item) => item.boundary === boundary);
    const result = selected?.get(boundary);
    const last = run?.observations.at(-1);
    return {
      stage: boundary.stage,
      startedAt: boundary.startedAt,
      endedAt: boundary.endedAt,
      runId: identities.get(boundary),
      wallMs: run?.wallMs ?? null,
      activeMs: result?.breakdown?.workMs ?? null,
      breakdown: result?.breakdown ?? null,
      quality: result?.quality,
      eventCount: run?.observations.length ?? 0,
      lastObservationAt: last && !run?.invalid ? new Date(last.at).toISOString() : null,
      sinceLastObservationMs:
        last && !run?.invalid && boundary.disposition === "open"
          ? Math.max(0, now - last.at)
          : null,
      sensitivity: SENSITIVITY_THRESHOLDS_MS.map((thresholdMs) => ({
        thresholdMs,
        workMs: classified.get(thresholdMs)?.get(boundary)?.breakdown?.workMs ?? null,
      })),
    };
  });

  return {
    timings,
    // Measurement limitations belong to each run's quality. Returning them as
    // read errors would label healthy records "unparseable" across the UI.
    warnings: pairing.warnings,
  };
}
