import type {
  EffectivenessApprovalWait,
  EffectivenessReviews,
  EffectivenessSensors,
  IntentEffectiveness,
} from "@andon/shared-types";
import { deriveLegacyApprovalIntervals } from "../audit/intervals.ts";
import { stageJumpReaches } from "../audit/stage-jump.ts";
import { hasAmbiguousLifecycleOrder, type MeasurementEvent } from "./events.ts";

type Interval = [number, number];
export function unionDuration(intervals: Interval[]): number {
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of intervals) {
    total += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return total;
}

function stageOf(e: MeasurementEvent): string | undefined {
  return e.fields.Stage ?? e.fields["Stage slug"];
}
function stageUnitKey(stage: string, unit: string): string {
  return JSON.stringify([stage, unit]);
}
function ordered(a: MeasurementEvent, b: MeasurementEvent): boolean {
  return b.time > a.time || (b.time === a.time && a.shard === b.shard && b.position > a.position);
}

/**
 * `stageOrder` is the stage-graph order a STAGE_JUMPED row's reach is judged
 * against (see `stageOrderOf`); without it every jump reaches every stage.
 */
export function deriveEffectiveness(
  events: readonly MeasurementEvent[],
  now: number,
  stageOrder: readonly string[] | null = null,
): Pick<
  IntentEffectiveness,
  | "startedAt"
  | "completedAt"
  | "completionMs"
  | "elapsedMs"
  | "auditEventCount"
  | "approvalWait"
  | "rejections"
  | "revisions"
  | "humanTurns"
  | "reviews"
  | "sensors"
  | "warnings"
> {
  if (hasAmbiguousLifecycleOrder(events))
    return {
      ...deriveEffectiveness([], now),
      auditEventCount: null,
      warnings: ["cross-shard lifecycle timestamp ties; audit measurements withheld"],
    };
  const warnings: string[] = [];
  const starts = events.filter((e) => e.event === "WORKFLOW_STARTED");
  const start = starts[0];
  const latestStart = starts.at(-1);
  const completion = events
    .filter((e) => e.event === "WORKFLOW_COMPLETED" && (!latestStart || ordered(latestStart, e)))
    .at(-1);
  if (starts.length > 1)
    warnings.push("multiple workflow starts: elapsed time spans the intent history");
  if (events.some((e) => e.time > now))
    warnings.push("audit timestamps are ahead of the measurement clock");
  const duration = (end: number): number | null =>
    start && end >= start.time ? end - start.time : null;

  const {
    closed,
    pending,
    excludedIntervals,
    hasGate,
    warnings: gateWarnings,
  } = deriveLegacyApprovalIntervals(events, now, completion !== undefined, stageOrder);
  warnings.push(...gateWarnings);
  let rejections = 0;
  let revisions = 0;
  let humanTurns = 0;
  const review: EffectivenessReviews = {
    completed: 0,
    ready: 0,
    notReady: 0,
    firstPassReady: 0,
    firstPassTotal: 0,
    firstPassRate: null,
    unmatched: 0,
  };
  const reviewRequests = new Map<string, MeasurementEvent>();
  const reviewTerminals = new Set<string>();
  const epochs = new Map<string, number>();
  const unitEpochs = new Map<string, number>();
  let globalEpoch = 0;
  const jumpTargets: (string | undefined)[] = [];
  const jumpEpoch = (stage: string): number =>
    jumpTargets.filter((target) => stageJumpReaches(target, stage, stageOrder)).length;
  const firstReviews = new Set<string>();
  const sensor: EffectivenessSensors = {
    scope: "intent-record",
    verifiedPassed: 0,
    failed: 0,
    skipped: 0,
    incomplete: 0,
    findings: 0,
  };
  const firings = new Map<string, MeasurementEvent>();
  const sensorTerminals = new Set<string>();
  let hasReview = false;
  let hasSensor = false;

  for (const e of events) {
    const stage = stageOf(e);
    if (e.event === "WORKFLOW_STARTED") {
      review.unmatched += reviewRequests.size;
      reviewRequests.clear();
      globalEpoch++;
    }
    if (e.event === "STAGE_JUMPED") {
      // v2.11.0 stageJumpReaches: only the Target and later stages restart.
      const target = e.fields.Target;
      jumpTargets.push(target);
      for (const [key, request] of reviewRequests) {
        if (stageJumpReaches(target, stageOf(request) ?? "", stageOrder)) {
          review.unmatched++;
          reviewRequests.delete(key);
        }
      }
    }
    if (e.event === "BOLT_STARTED") {
      for (const unit of (e.fields["Bolt slug"] ?? e.fields["Bolt names"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        unitEpochs.set(unit, (unitEpochs.get(unit) ?? 0) + 1);
      }
    }
    if (["STAGE_STARTED", "GATE_REJECTED"].includes(e.event)) {
      const resetStages = e.fields["Gate Stages"]
        ? e.fields["Gate Stages"]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : stage
          ? [stage]
          : [];
      for (const resetStage of resetStages) {
        const attemptKey = stageUnitKey(resetStage, e.fields.Unit ?? "");
        epochs.set(attemptKey, (epochs.get(attemptKey) ?? 0) + 1);
      }
    }
    if (e.event === "GATE_REJECTED") rejections++;
    if (e.event === "STAGE_REVISING") revisions++;
    if (e.event === "HUMAN_TURN") humanTurns++;
    if (e.event === "REVIEW_REQUESTED" || e.event === "REVIEW_COMPLETED") {
      hasReview = true;
      const iteration = Number(e.fields.Iteration);
      if (!stage || !e.fields.Reviewer || !Number.isInteger(iteration) || iteration < 1) {
        review.unmatched++;
        continue;
      }
      const unit = e.fields.Unit ?? "";
      const reviewScope = JSON.stringify([
        globalEpoch,
        jumpEpoch(stage),
        stage,
        unit,
        e.fields["Attempt Generation"] ?? "",
        epochs.get(stageUnitKey(stage, unit)) ?? 0,
        unitEpochs.get(unit) ?? 0,
        e.fields.Reviewer,
        e.fields.Workflow ?? "",
      ]);
      // v2.8.2 may retry an iteration with a different request. Legacy rows
      // have no id on either side; never pair them with a modern receipt.
      const reviewKey = JSON.stringify([reviewScope, iteration, e.fields["Request Id"] ?? ""]);
      if (e.event === "REVIEW_REQUESTED") {
        if (!reviewRequests.has(reviewKey)) reviewRequests.set(reviewKey, e);
      } else {
        if (reviewTerminals.has(reviewKey)) {
          warnings.push("duplicate review completion ignored");
          continue;
        }
        const request = reviewRequests.get(reviewKey);
        const verdict = e.fields.Verdict;
        if (
          !request ||
          !ordered(request, e) ||
          (verdict !== "READY" && verdict !== "NOT-READY") ||
          (request.fields["Artifact Fingerprint"] &&
            request.fields["Artifact Fingerprint"] !==
              (e.fields["Request Fingerprint"] ?? e.fields["Artifact Fingerprint"])) ||
          // v2.8.2 binds workspace-writing reviews to both the requested and
          // completed source snapshot, plus the Unit snapshot when supplied.
          (request.fields["Source Fingerprint"] !== undefined &&
            (e.fields["Request Source Fingerprint"] !== request.fields["Source Fingerprint"] ||
              e.fields["Source Fingerprint"] !== request.fields["Source Fingerprint"])) ||
          (request.fields["Unit Source Fingerprint"] !== undefined &&
            e.fields["Unit Source Fingerprint"] !== request.fields["Unit Source Fingerprint"])
        ) {
          review.unmatched++;
          continue;
        }
        reviewRequests.delete(reviewKey);
        reviewTerminals.add(reviewKey);
        review.completed++;
        if (verdict === "READY") review.ready++;
        else review.notReady++;
        if (iteration === 1 && !firstReviews.has(reviewScope)) {
          firstReviews.add(reviewScope);
          review.firstPassTotal++;
          if (verdict === "READY") review.firstPassReady++;
        }
      }
    }
    if (e.event.startsWith("SENSOR_")) {
      if (
        !["SENSOR_FIRED", "SENSOR_PASSED", "SENSOR_FAILED", "SENSOR_BUDGET_OVERRIDE"].includes(
          e.event,
        )
      )
        continue;
      const fire = e.fields["Fire id"];
      if (!fire || !e.fields["Sensor ID"] || !stage) {
        warnings.push("sensor receipt missing correlation fields");
        continue;
      }
      const sensorKey = JSON.stringify([fire, e.fields["Sensor ID"], stage]);
      if (e.event === "SENSOR_FIRED") {
        hasSensor = true;
        if (firings.has(sensorKey) || sensorTerminals.has(sensorKey))
          warnings.push("duplicate sensor firing ignored");
        else firings.set(sensorKey, e);
      } else {
        const fired = firings.get(sensorKey);
        if (!fired || !ordered(fired, e) || sensorTerminals.has(sensorKey)) {
          warnings.push("unmatched sensor terminal ignored");
          continue;
        }
        sensorTerminals.add(sensorKey);
        firings.delete(sensorKey);
        if (e.event === "SENSOR_PASSED" && !e.fields.Note) sensor.verifiedPassed++;
        else if (e.event === "SENSOR_FAILED") {
          sensor.failed++;
          const rawCount = e.fields["Findings count"];
          const count = rawCount !== undefined && /^\d+$/.test(rawCount) ? Number(rawCount) : NaN;
          if (
            !Number.isSafeInteger(count) ||
            !Number.isSafeInteger((sensor.findings ?? 0) + count)
          ) {
            sensor.findings = null;
            warnings.push("sensor findings count unavailable");
          } else if (sensor.findings !== null) sensor.findings += count;
        } else sensor.skipped++;
      }
    }
  }
  review.unmatched += reviewRequests.size;
  if (review.firstPassTotal) review.firstPassRate = review.firstPassReady / review.firstPassTotal;
  sensor.incomplete = firings.size;
  const approvalWait: EffectivenessApprovalWait = {
    completedMs: closed.length ? unionDuration(closed) : null,
    pendingMs: pending.length ? unionDuration(pending) : null,
    completedIntervals: closed.length,
    pendingIntervals: pending.length,
    excludedIntervals,
  };
  return {
    startedAt: start?.timestamp ?? null,
    completedAt: completion?.timestamp ?? null,
    completionMs: completion ? duration(completion.time) : null,
    elapsedMs: duration(completion?.time ?? now),
    auditEventCount: events.length,
    approvalWait: hasGate ? approvalWait : null,
    rejections: hasGate ? rejections : null,
    revisions: hasGate || revisions ? revisions : null,
    humanTurns: humanTurns || null,
    reviews: hasReview ? review : null,
    sensors: hasSensor ? sensor : null,
    warnings: [...new Set(warnings)],
  };
}
