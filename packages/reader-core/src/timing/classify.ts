import type { AuditEvent, TimingBreakdown, TimingQuality } from "@andon/shared-types";
import { timeOf } from "../audit/events.ts";
import type { IntervalDiagnostic, MeasurementInterval } from "../audit/intervals.ts";
import type { RunBoundary } from "./pairing.ts";
import { isWorkObservation } from "./policy.ts";
import { runFloorCheck } from "./run-floor.ts";

interface Observation {
  at: number;
  index: number;
  unit: string | null;
}
type Category =
  | "workMs"
  | "approvalWaitMs"
  | "suspendedMs"
  | "excludedGapMs"
  | "pendingObservationMs"
  | "unattributedMs";
interface Segment {
  start: number;
  end: number;
  /** Full observation gap, never shortened by another run's events. */
  gap: number;
  endIndex: number;
  category: Category;
}
export interface PreparedRun {
  boundary: RunBoundary;
  start: number;
  end: number;
  wallMs: number | null;
  observations: Observation[];
  segments: Segment[];
  reasons: Set<string>;
  incomplete: boolean;
  invalid: boolean;
}
export interface ClassifiedRun {
  breakdown: TimingBreakdown | null;
  quality: TimingQuality;
}

function containsIndex(run: RunBoundary, index: number): boolean {
  return (
    run.openIndex !== null &&
    index >= run.openIndex &&
    (run.closeIndex === null || index <= run.closeIndex)
  );
}
function applies(interval: MeasurementInterval, run: RunBoundary): boolean {
  if (interval.stages === null) return true;
  return (
    (interval.stages.length === 0 || interval.stages.includes(run.stage)) &&
    containsIndex(run, interval.startIndex)
  );
}
function intersects(start: number, end: number, from: number, to: number): boolean {
  return start < to && end > from;
}
function covers(interval: MeasurementInterval, start: number, end: number): boolean {
  return interval.startMs <= start && interval.endMs >= end;
}
function addObservation(run: PreparedRun, observation: Observation): void {
  if (observation.at >= run.start && observation.at <= run.end) run.observations.push(observation);
}
function unitKey(event: AuditEvent): string {
  return JSON.stringify([
    event.fields?.Unit ?? null,
    event.fields?.["Attempt Generation"] ?? null,
    event.fields?.["Run floor"] ?? null,
  ]);
}
/**
 * Unit and Attempt Generation compare with the run's own start. The engine
 * never stamps a `Run floor` on STAGE_STARTED (issue #166), so the floor is
 * judged by position instead: `currentFloor` says whether it is the floor the
 * engine would stamp for this stage at the event's place in the stream.
 */
function matchesStartScope(start: AuditEvent, event: AuditEvent, currentFloor: boolean): boolean {
  const unit = start.fields?.Unit;
  if (unit && event.fields?.Unit !== unit) return false;
  const generation = (item: AuditEvent) => item.fields?.["Attempt Generation"] ?? null;
  return currentFloor && generation(start) === generation(event);
}

/** Attribute endpoints once, shared by all sensitivity settings. */
export function prepareRuns(
  events: readonly AuditEvent[],
  boundaries: readonly RunBoundary[],
  intervals: readonly MeasurementInterval[],
  diagnostics: readonly IntervalDiagnostic[],
  now: number,
  stageOrder: readonly string[] | null = null,
): PreparedRun[] {
  const recordReasons = [
    ...(diagnostics.some((item) => item.code === "ambiguous-lifecycle-order")
      ? ["clock-order-ambiguous"]
      : []),
  ];
  const isCurrentFloor = runFloorCheck(events, stageOrder);
  const runs: PreparedRun[] = boundaries.map((boundary) => {
    const terminal =
      boundary.closeIndex === null ? now : timeOf(events[boundary.closeIndex] as AuditEvent);
    const loggedEnd = boundary.endedAt === null ? terminal : Date.parse(boundary.endedAt);
    const futureWindow = boundary.startMs > now || terminal > now || loggedEnd > now;
    const invalidWindow =
      !Number.isFinite(now) ||
      futureWindow ||
      loggedEnd < boundary.startMs ||
      boundary.openIndex === null;
    const reasons = new Set(recordReasons);
    if (futureWindow) reasons.add("future-event");
    // Pairing warnings may describe an orphan in a different stage or attempt.
    // A recovered boundary has no open interval; only that run is invalid.
    if (boundary.openIndex === null) reasons.add("missing-boundary");
    if (invalidWindow) reasons.add("invalid-run-window");
    if (boundary.disposition.startsWith("recovered")) reasons.add("recovered-boundary");
    return {
      boundary,
      start: boundary.startMs,
      end: Math.min(terminal, now),
      wallMs: invalidWindow ? null : loggedEnd - boundary.startMs,
      observations: [],
      segments: [],
      reasons,
      incomplete: invalidWindow || recordReasons.length > 0,
      invalid: invalidWindow || recordReasons.length > 0,
    };
  });
  const scopedIntervals = new Map(
    runs.map((run) => {
      const start = events[run.boundary.openIndex ?? -1];
      const matching = intervals.filter((item) => {
        if (!applies(item, run.boundary)) return false;
        if (item.stages === null) return true;
        const endpoint = events[item.startIndex];
        if (
          !start ||
          !endpoint ||
          !matchesStartScope(
            start,
            endpoint,
            isCurrentFloor(endpoint, item.startIndex, run.boundary.stage),
          ) ||
          (item.stages.length === 0 && item.unit === null)
        ) {
          run.reasons.add("measurement-scope-mismatch");
          run.incomplete = true;
          return false;
        }
        return true;
      });
      return [run, matching];
    }),
  );
  const unitOwners = new Map<string, PreparedRun>();
  for (const [index, event] of events.entries()) {
    if (!isWorkObservation(event) || timeOf(event) > now) continue;
    const at = timeOf(event);
    const unit = event.fields?.Unit ?? null;
    const active = runs.filter((run) => containsIndex(run.boundary, index));
    let owner: PreparedRun | undefined;
    if (event.stage) {
      owner = active.find(
        (run) =>
          run.boundary.stage === event.stage &&
          (event.event !== "STAGE_STARTED" || run.boundary.openIndex === index),
      );
    } else if (unit) {
      const known = unitOwners.get(unitKey(event));
      if (known && active.includes(known)) owner = known;
      else
        for (const run of active) {
          run.reasons.add("unit-scope-unavailable");
          run.incomplete = true;
        }
    } else {
      owner = active
        .filter(
          (run) =>
            !(scopedIntervals.get(run) ?? []).some(
              (item) => item.unit === null && item.startMs <= at && item.endMs > at,
            ),
        )
        .sort((a, b) => (b.boundary.openIndex ?? -1) - (a.boundary.openIndex ?? -1))[0];
      owner?.reasons.add("unscoped-event");
    }
    if (owner) {
      const start = events[owner.boundary.openIndex as number] as AuditEvent;
      if (!matchesStartScope(start, event, isCurrentFloor(event, index, owner.boundary.stage))) {
        owner.reasons.add("observation-scope-mismatch");
        owner.incomplete = true;
        // A terminal from a different attempt cannot establish this run's end.
        if (owner.boundary.closeIndex === index) {
          owner.reasons.add("terminal-scope-mismatch");
          owner.invalid = true;
          owner.wallMs = null;
        }
        continue;
      }
      // A contradictory receipt is a diagnostic, not a fresh activity endpoint.
      // Otherwise a write during a pause could shorten the gap after resume.
      const blocked = (scopedIntervals.get(owner) ?? []).some(
        (item) =>
          item.startMs <= at &&
          item.endMs > at &&
          (item.unit === null ||
            (item.unit === unit &&
              item.attemptGeneration === (event.fields?.["Attempt Generation"] ?? null) &&
              item.runFloor === (event.fields?.["Run floor"] ?? null))),
      );
      if (blocked && event.event !== "STAGE_STARTED") continue;
      if (unit) unitOwners.set(unitKey(event), owner);
      addObservation(owner, { at, index, unit });
    }
  }
  for (const run of runs) {
    const relevant = scopedIntervals.get(run) ?? [];
    for (const item of relevant) {
      // Child controls cannot establish a stage-wide stop or resume.
      if (item.unit !== null) {
        if (intersects(item.startMs, item.endMs, run.start, run.end)) {
          run.reasons.add("unit-scope-unavailable");
          run.incomplete = true;
        }
        continue;
      }
      addObservation(run, { at: item.startMs, index: item.startIndex, unit: null });
      if (item.endIndex !== null)
        addObservation(run, { at: item.endMs, index: item.endIndex, unit: null });
      if (item.pending && run.boundary.endedAt !== null && item.startMs < run.end) {
        run.reasons.add("pending-wait-on-completed-run");
        run.incomplete = true;
      }
    }
    for (const diagnostic of diagnostics) {
      if (diagnostic.code === "ambiguous-lifecycle-order") continue;
      const scopeMatches =
        diagnostic.stages === null ||
        diagnostic.stages.length === 0 ||
        diagnostic.stages.includes(run.boundary.stage);
      const positionMatches =
        containsIndex(run.boundary, diagnostic.startIndex) ||
        intersects(diagnostic.startMs, diagnostic.endMs, run.start, run.end);
      if (scopeMatches && positionMatches) {
        run.reasons.add(diagnostic.code);
        if (diagnostic.severity === "incomplete") run.incomplete = true;
      }
    }
    run.observations.sort((a, b) => a.at - b.at || a.index - b.index);
    run.observations = [...new Map(run.observations.map((item) => [item.at, item])).values()];
    if (run.invalid) continue;
    const cuts = [
      ...new Set([
        run.start,
        run.end,
        ...run.observations.map((item) => item.at),
        ...relevant.flatMap((item) => [
          Math.max(run.start, item.startMs),
          Math.min(run.end, item.endMs),
        ]),
      ]),
    ]
      .filter((at) => at >= run.start && at <= run.end)
      .sort((a, b) => a - b);
    let pointIndex = 0;
    for (let index = 1; index < cuts.length; index++) {
      const start = cuts[index - 1] as number;
      const end = cuts[index] as number;
      while (
        pointIndex + 1 < run.observations.length &&
        (run.observations[pointIndex + 1]?.at ?? Infinity) <= start
      )
        pointIndex++;
      const left = run.observations[pointIndex];
      const right = run.observations[pointIndex + 1];
      const spanning = relevant.filter((item) => covers(item, start, end));
      const full = spanning.filter((item) => item.unit === null);
      let category: Category;
      if (full.some((item) => item.kind === "suspended")) category = "suspendedMs";
      else if (full.some((item) => item.kind === "approval-wait")) category = "approvalWaitMs";
      else if (
        spanning.some((item) => item.unit !== null && (!right?.unit || right.unit === item.unit))
      )
        category = "unattributedMs";
      else if (!right || !left || left.at > start)
        category = run.boundary.disposition === "open" ? "pendingObservationMs" : "unattributedMs";
      else category = "workMs";
      run.segments.push({
        start,
        end,
        category,
        gap: right && left ? right.at - left.at : 0,
        endIndex: right?.index ?? Infinity,
      });
    }
  }
  return runs;
}

/** A global partition gives each work slice at most one owner. */
export function classifyRuns(
  runs: readonly PreparedRun[],
  thresholdMs: number,
): Map<RunBoundary, ClassifiedRun> {
  const result = new Map<RunBoundary, ClassifiedRun>();
  for (const run of runs)
    result.set(run.boundary, {
      breakdown: run.invalid
        ? null
        : {
            observedWallMs: run.end - run.start,
            workMs: 0,
            approvalWaitMs: 0,
            suspendedMs: 0,
            excludedGapMs: 0,
            pendingObservationMs: 0,
            unattributedMs: 0,
          },
      quality: { status: "usable", reasons: [...run.reasons], sampleEligible: false },
    });
  const cuts = [
    ...new Set(
      runs.flatMap((run) => run.segments.flatMap((segment) => [segment.start, segment.end])),
    ),
  ].sort((a, b) => a - b);
  const cursors = new Map<PreparedRun, number>();
  for (let index = 1; index < cuts.length; index++) {
    const start = cuts[index - 1] as number;
    const end = cuts[index] as number;
    const current: Array<{ run: PreparedRun; segment: Segment }> = [];
    for (const run of runs) {
      let cursor = cursors.get(run) ?? 0;
      while ((run.segments[cursor]?.end ?? Infinity) <= start) cursor++;
      cursors.set(run, cursor);
      const segment = run.segments[cursor];
      if (segment && segment.start <= start && segment.end >= end) current.push({ run, segment });
    }
    const owner = current
      .filter(({ segment }) => segment.category === "workMs" && segment.gap <= thresholdMs)
      .sort(
        (a, b) =>
          a.segment.endIndex - b.segment.endIndex ||
          (b.run.boundary.openIndex ?? -1) - (a.run.boundary.openIndex ?? -1),
      )[0]?.run;
    for (const { run, segment } of current) {
      const breakdown = result.get(run.boundary)?.breakdown;
      if (!breakdown) continue;
      let category = segment.category;
      if (category !== "suspendedMs" && category !== "approvalWaitMs") {
        if (owner && owner !== run) category = "unattributedMs";
        else if (category === "workMs" && segment.gap > thresholdMs) category = "excludedGapMs";
        else if (category === "workMs" && owner !== run) category = "unattributedMs";
      }
      breakdown[category] += end - start;
    }
  }
  for (const run of runs) {
    const item = result.get(run.boundary) as ClassifiedRun;
    const breakdown = item.breakdown;
    if ((breakdown?.excludedGapMs ?? 0) > 0) item.quality.reasons.push("long-gap-excluded");
    if ((breakdown?.unattributedMs ?? 0) > 0) item.quality.reasons.push("unattributed-time");
    item.quality.reasons = [...new Set(item.quality.reasons)];
    item.quality.status = run.incomplete
      ? "incomplete"
      : item.quality.reasons.length
        ? "limited"
        : "usable";
    item.quality.sampleEligible =
      run.boundary.disposition === "completed" &&
      !run.incomplete &&
      breakdown !== null &&
      !(breakdown.workMs === 0 && (breakdown.excludedGapMs > 0 || breakdown.unattributedMs > 0));
  }
  return result;
}
