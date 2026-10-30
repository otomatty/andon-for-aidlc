import type { AuditEvent } from "@andon/shared-types";
import { timeOf } from "./events.ts";
import type { MeasurementEvent } from "./measurement-events.ts";
import { stageJumpReaches } from "./stage-jump.ts";

/**
 * Whether a reset reaches a wait over `stages`: WORKFLOW_STARTED always does;
 * a STAGE_JUMPED reaches its Target and later stages (aidlc-workflows v2.11.0
 * `stageJumpReaches`, as `unitGateStatus` reads it). A wait with no known
 * stage is reached by every jump.
 */
function resetReaches(
  event: string,
  target: string | undefined,
  stages: readonly string[] | null,
  order: readonly string[] | null,
): boolean {
  if (event === "WORKFLOW_STARTED" || !stages || stages.length === 0) return true;
  return stages.some((stage) => stageJumpReaches(target, stage, order));
}

export interface MeasurementInterval {
  kind: "approval-wait" | "suspended";
  startMs: number;
  endMs: number;
  startIndex: number;
  endIndex: number | null;
  pending: boolean;
  /** null means a record-wide suspension. An empty set is an unknown child target. */
  stages: string[] | null;
  unit: string | null;
  attemptGeneration: string | null;
  runFloor: string | null;
}

export interface IntervalDiagnostic {
  code: string;
  severity: "incomplete" | "limited";
  stages: string[] | null;
  unit: string | null;
  startMs: number;
  endMs: number;
  startIndex: number;
  endIndex: number | null;
}

interface OpenInterval extends MeasurementInterval {
  gateScope: string | null;
}

function csv(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function eventStages(e: AuditEvent): string[] {
  const set = csv(e.fields?.["Gate Stages"]);
  return set.length ? set : e.stage ? [e.stage] : [];
}

function gateKey(scope: OpenInterval): string {
  return JSON.stringify([
    scope.stages,
    scope.unit,
    scope.attemptGeneration,
    scope.runFloor,
    scope.gateScope,
  ]);
}

function unitKey(scope: OpenInterval): string {
  return JSON.stringify([scope.stages, scope.unit, scope.attemptGeneration, scope.runFloor]);
}

const SESSION_EVENTS = new Set(["SESSION_STARTED", "SESSION_RESUMED", "SESSION_ENDED", "RESUMED"]);
const ACTIVITY_EVENTS = new Set([
  "STAGE_STARTED",
  "STAGE_COMPLETED",
  "ARTIFACT_CREATED",
  "ARTIFACT_UPDATED",
  "ARTIFACT_REUSED",
  "REVIEW_REQUESTED",
  "REVIEW_COMPLETED",
  "SENSOR_FIRED",
  "SENSOR_PASSED",
  "SENSOR_FAILED",
  "SUBAGENT_COMPLETED",
  "PIPELINE_LINK_COMPLETED",
  "QUESTION_ANSWERED",
  "STAGE_REVISING",
  "UNIT_STARTED",
  "UNIT_COMPLETED",
  // v2.11.0: a Unit skipped by the person, and a reply to a chat question.
  "UNIT_SKIPPED",
  "QUESTION_REPLIED",
]);
/** Unit receipts that end the Unit's work on a stage, and so its pause. */
const UNIT_ENDS = new Set(["UNIT_COMPLETED", "UNIT_SKIPPED"]);
const ORDER_BOUNDARIES = new Set([
  "WORKFLOW_STARTED",
  "WORKFLOW_COMPLETED",
  "STAGE_STARTED",
  "STAGE_COMPLETED",
  "STAGE_JUMPED",
  "STAGE_SKIPPED",
  "BOLT_STARTED",
  "STAGE_AWAITING_APPROVAL",
  "GATE_APPROVED",
  "GATE_REJECTED",
  "WORKFLOW_PARKED",
  "WORKFLOW_UNPARKED",
  "UNIT_PAUSED",
  "UNIT_RESUMED",
  "UNIT_COMPLETED",
  "UNIT_SKIPPED",
]);

/**
 * Read scope-bearing waits without guessing missing resumes or child membership.
 * Input order must be the same sorted stream used by pairing. Indices then let a
 * caller keep old-attempt waits out of a new run, even at the same timestamp.
 */
export function deriveMeasurementIntervals(
  events: readonly AuditEvent[],
  now: number,
  stageOrder: readonly string[] | null = null,
): {
  intervals: MeasurementInterval[];
  diagnostics: IntervalDiagnostic[];
  sessionEvents: AuditEvent[];
} {
  const intervals: MeasurementInterval[] = [];
  const diagnostics: IntervalDiagnostic[] = [];
  const sessionEvents: AuditEvent[] = [];
  const gates = new Map<string, OpenInterval>();
  const units = new Map<string, OpenInterval>();
  let parked: OpenInterval | null = null;

  function scope(e: AuditEvent, index: number, kind: MeasurementInterval["kind"]): OpenInterval {
    return {
      kind,
      startMs: timeOf(e),
      endMs: now,
      startIndex: index,
      endIndex: null,
      pending: true,
      stages: eventStages(e),
      unit: e.fields?.Unit ?? null,
      attemptGeneration: e.fields?.["Attempt Generation"] ?? null,
      runFloor: e.fields?.["Run floor"] ?? null,
      gateScope: e.fields?.["Gate Scope"] ?? null,
    };
  }
  function diagnose(
    code: string,
    target: OpenInterval,
    endMs: number,
    endIndex: number | null,
    severity: IntervalDiagnostic["severity"] = "incomplete",
  ): void {
    diagnostics.push({
      code,
      severity,
      stages: target.stages,
      unit: target.unit,
      startMs: target.startMs,
      endMs,
      startIndex: target.startIndex,
      endIndex,
    });
  }
  function close(opened: OpenInterval, endMs: number, endIndex: number | null): void {
    const { gateScope: _, ...interval } = opened;
    intervals.push({
      ...interval,
      endMs: Math.min(endMs, now),
      endIndex,
      pending: endIndex === null,
    });
  }
  function invalidate(
    map: Map<string, OpenInterval>,
    match: (opened: OpenInterval) => boolean,
    at: number,
    index: number,
    code: string,
  ): void {
    for (const [key, opened] of map) {
      if (!match(opened)) continue;
      close(opened, at, index);
      diagnose(code, opened, at, index);
      map.delete(key);
    }
  }

  // A deterministic filename order is useful for display, but proves no causality.
  for (let index = 0; index < events.length;) {
    const first = events[index];
    if (!first) break;
    let end = index + 1;
    while (end < events.length && timeOf(events[end] as AuditEvent) === timeOf(first)) end++;
    const group = events.slice(index, end);
    if (
      group.some((e) => e.shard !== first.shard) &&
      group.filter((e) => ORDER_BOUNDARIES.has(e.event)).length > 1
    ) {
      const target = scope(first, index, "approval-wait");
      target.stages = null;
      diagnose("ambiguous-lifecycle-order", target, timeOf(first), end - 1);
    }
    index = end;
  }

  for (const [index, e] of events.entries()) {
    if (e.workflow?.startsWith("single-stage:")) continue;
    const at = timeOf(e);
    if (!Number.isFinite(at)) {
      const target = scope(e, index, "approval-wait");
      target.stages = null;
      diagnose("invalid-timestamp", target, now, index);
      continue;
    }
    if (at > now) continue;
    if (SESSION_EVENTS.has(e.event)) {
      sessionEvents.push(e);
      continue;
    }
    const target = scope(e, index, "approval-wait");
    const stages = target.stages ?? [];

    if (ACTIVITY_EVENTS.has(e.event) || (e.event === "HUMAN_TURN" && e.workflow)) {
      if (parked) diagnose("activity-during-suspension", parked, at, index);
      for (const opened of units.values()) {
        if (UNIT_ENDS.has(e.event)) continue;
        if (target.unit !== opened.unit) continue;
        if (
          stages.length > 0 &&
          opened.stages &&
          opened.stages.length > 0 &&
          !opened.stages.some((stage) => stages.includes(stage))
        )
          continue;
        if (
          target.attemptGeneration !== opened.attemptGeneration ||
          target.runFloor !== opened.runFloor
        )
          continue;
        diagnose("activity-during-suspension", opened, at, index);
      }
    }

    if (e.event === "WORKFLOW_STARTED" || e.event === "STAGE_JUMPED") {
      const reached = (opened: OpenInterval) =>
        resetReaches(e.event, e.fields?.Target, opened.stages, stageOrder);
      invalidate(gates, reached, at, index, "unresolved-wait-at-reset");
      invalidate(units, reached, at, index, "unresolved-suspension-at-reset");
      // A park is record-wide, so every jump reaches it.
      if (parked) {
        close(parked, at, index);
        diagnose("unresolved-suspension-at-reset", parked, at, index);
        parked = null;
      }
    }
    if (e.event === "BOLT_STARTED") {
      const resetUnits = csv(e.fields?.["Bolt slug"] ?? e.fields?.["Bolt names"]);
      const match = (opened: OpenInterval) =>
        opened.unit !== null && resetUnits.includes(opened.unit);
      invalidate(gates, match, at, index, "unresolved-wait-at-reset");
      invalidate(units, match, at, index, "unresolved-suspension-at-reset");
    }
    if (e.event === "STAGE_STARTED") {
      invalidate(
        gates,
        (opened) =>
          opened.unit === target.unit && (opened.stages ?? []).some((s) => stages.includes(s)),
        at,
        index,
        "unresolved-wait-at-reset",
      );
    }
    if (e.event === "STAGE_AWAITING_APPROVAL") {
      if (!stages.length || e.fields?.Recovered === "true") {
        diagnose(!stages.length ? "unknown-wait-scope" : "recovered-wait", target, at, index);
        continue;
      }
      const key = gateKey(target);
      if (e.fields?.Revalidated === "true") {
        if (!gates.has(key)) diagnose("revalidated-wait-without-opening", target, at, index);
        continue;
      }
      if (gates.has(key)) {
        diagnose("duplicate-wait-opening", target, at, index, "limited");
        continue;
      }
      gates.set(key, target);
    }
    if (e.event === "GATE_APPROVED" || e.event === "GATE_REJECTED") {
      const key = gateKey(target);
      const opened = gates.get(key);
      if (!opened) diagnose("orphan-wait-resolution", target, at, index);
      else {
        close(opened, at, index);
        if (e.fields?.Recovered === "true")
          diagnose("recovered-wait-resolution", opened, at, index);
        gates.delete(key);
      }
    }
    if (e.event === "WORKFLOW_PARKED") {
      target.kind = "suspended";
      target.stages = null;
      target.unit = null;
      if (parked) diagnose("duplicate-suspension-opening", target, at, index, "limited");
      else parked = target;
    }
    if (e.event === "WORKFLOW_UNPARKED") {
      target.stages = null;
      target.unit = null;
      if (parked) {
        close(parked, at, index);
        parked = null;
      } else diagnose("orphan-suspension-resolution", target, at, index);
    }
    if (e.event === "UNIT_PAUSED" || e.event === "UNIT_RESUMED" || UNIT_ENDS.has(e.event)) {
      target.kind = "suspended";
      const key = unitKey(target);
      if (!target.unit) {
        if (!UNIT_ENDS.has(e.event)) diagnose("unknown-unit-suspension-scope", target, at, index);
      } else if (e.event === "UNIT_PAUSED") {
        if (units.has(key)) diagnose("duplicate-suspension-opening", target, at, index, "limited");
        else units.set(key, target);
      } else {
        const opened = units.get(key);
        if (opened) {
          close(opened, at, index);
          units.delete(key);
        } else if (e.event === "UNIT_RESUMED")
          diagnose("orphan-suspension-resolution", target, at, index);
      }
    }
    if (["STAGE_COMPLETED", "STAGE_SKIPPED", "WORKFLOW_COMPLETED"].includes(e.event)) {
      const match = (opened: OpenInterval) =>
        e.event === "WORKFLOW_COMPLETED" ||
        ((opened.stages ?? []).some((s) => stages.includes(s)) &&
          (target.unit === null || target.unit === opened.unit));
      invalidate(gates, match, at, index, "unresolved-wait-at-completion");
      invalidate(units, match, at, index, "unresolved-suspension-at-completion");
      if (parked && e.event === "WORKFLOW_COMPLETED") {
        close(parked, at, index);
        diagnose("unresolved-suspension-at-completion", parked, at, index);
        parked = null;
      }
    }
  }
  for (const opened of [...gates.values(), ...units.values(), ...(parked ? [parked] : [])])
    close(opened, now, null);
  return { intervals, diagnostics, sessionEvents };
}

function legacyStage(e: MeasurementEvent): string | undefined {
  return e.fields.Stage ?? e.fields["Stage slug"];
}
function legacyKey(e: MeasurementEvent): string {
  return JSON.stringify([
    legacyStage(e) ?? e.fields["Gate Stages"] ?? "",
    e.fields.Unit ?? "",
    e.fields["Attempt Generation"] ?? "",
    e.fields["Gate Scope"] ?? "",
  ]);
}

/** Existing effectiveness gate semantics, extracted without changing its metric. */
export function deriveLegacyApprovalIntervals(
  events: readonly MeasurementEvent[],
  now: number,
  completed: boolean,
  stageOrder: readonly string[] | null = null,
): {
  closed: [number, number][];
  pending: [number, number][];
  excludedIntervals: number;
  hasGate: boolean;
  warnings: string[];
} {
  const waits = new Map<string, MeasurementEvent>();
  const closed: [number, number][] = [];
  const pending: [number, number][] = [];
  const warnings: string[] = [];
  let excludedIntervals = 0;
  let hasGate = false;
  for (const e of events) {
    const key = legacyKey(e);
    if (e.event === "WORKFLOW_STARTED" || e.event === "STAGE_JUMPED") {
      for (const [waitKey, opened] of waits) {
        const stages = csv(legacyStage(opened) ?? opened.fields["Gate Stages"]);
        if (!resetReaches(e.event, e.fields.Target, stages, stageOrder)) continue;
        waits.delete(waitKey);
        excludedIntervals++;
      }
    }
    if (e.event === "BOLT_STARTED") {
      for (const unit of csv(e.fields["Bolt slug"] ?? e.fields["Bolt names"])) {
        for (const [waitKey, opened] of waits)
          if (opened.fields.Unit === unit) {
            waits.delete(waitKey);
            excludedIntervals++;
          }
      }
    }
    if ((e.event === "STAGE_STARTED" || e.event === "STAGE_SKIPPED") && waits.has(key)) {
      excludedIntervals++;
      waits.delete(key);
    }
    if (e.event === "STAGE_AWAITING_APPROVAL") {
      hasGate = true;
      if ((!legacyStage(e) && !e.fields["Gate Stages"]) || e.fields.Recovered === "true") {
        excludedIntervals++;
        continue;
      }
      if (e.fields.Revalidated === "true") continue;
      if (waits.has(key)) {
        warnings.push("duplicate gate opening ignored");
        continue;
      }
      waits.set(key, e);
    }
    if (e.event === "GATE_APPROVED" || e.event === "GATE_REJECTED") {
      hasGate = true;
      const opened = waits.get(key);
      if (
        opened &&
        e.fields.Recovered !== "true" &&
        (e.time > opened.time ||
          (e.time === opened.time && e.shard === opened.shard && e.position > opened.position))
      )
        closed.push([opened.time, e.time]);
      else excludedIntervals++;
      waits.delete(key);
    }
  }
  for (const opened of waits.values()) {
    if (completed || now < opened.time) excludedIntervals++;
    else pending.push([opened.time, now]);
  }
  if (excludedIntervals)
    warnings.push("some approval intervals lack a trustworthy opening/resolution pair");
  return { closed, pending, excludedIntervals, hasGate, warnings };
}
