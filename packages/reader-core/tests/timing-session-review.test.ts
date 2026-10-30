import type { AuditEvent, StageTiming } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { deriveStageTimings } from "../src/timing/derive.ts";
import { resolveStageViews } from "../src/timing/stage-view.ts";
import { run as sampleRun, stage, workflow } from "./timing-fixtures.ts";

const BASE = Date.parse("2026-09-15T00:00:00Z");
const MINUTE = 60_000;
type Row = [event: string, minute: number, fields?: Record<string, string>, stage?: string | null];

function derive(rows: Row[], now = 100): StageTiming[] {
  const events: AuditEvent[] = rows.map(
    ([event, minute, fields = {}, stage = "alpha"], position) => ({
      event,
      timestamp: new Date(BASE + minute * MINUTE).toISOString(),
      stage,
      fields,
      workflow: "main",
      shard: "one.md",
      position,
    }),
  );
  return deriveStageTimings(events, BASE + now * MINUTE).timings;
}
function only(rows: Row[], now = 100): StageTiming {
  return derive(rows, now)[0] as StageTiming;
}

describe("session timing scope and control regressions", () => {
  it.each(["HEALTH_CHECKED", "ARTIFACT_CREATED"])(
    "ignores a future %s without losing a healthy run",
    (event) => {
      const run = only([
        ["STAGE_STARTED", 0],
        ["STAGE_COMPLETED", 10],
        [event, 110, {}, "other"],
      ]);
      expect(run.activeMs).toBe(10 * MINUTE);
      expect(run.quality).toMatchObject({ status: "usable", sampleEligible: true });
    },
  );

  it.each([50, 110])("isolates a future terminal with start at %s to its own run", (start) => {
    const runs = derive([
      ["STAGE_STARTED", 0],
      ["STAGE_COMPLETED", 10],
      ["STAGE_STARTED", start, {}, "other"],
      ["STAGE_COMPLETED", 120, {}, "other"],
    ]);
    expect(runs[0]?.activeMs).toBe(10 * MINUTE);
    expect(runs[0]?.quality?.sampleEligible).toBe(true);
    expect(runs[1]).toMatchObject({
      activeMs: null,
      breakdown: null,
      quality: { status: "incomplete", sampleEligible: false },
    });
    expect(runs[1]?.quality?.reasons).toContain("future-event");
  });

  it("does not use a future observation to extend an open run", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["ARTIFACT_CREATED", 5],
      ["ARTIFACT_CREATED", 110],
    ]);
    expect(run.breakdown).toMatchObject({ workMs: 5 * MINUTE, pendingObservationMs: 95 * MINUTE });
    expect(run.quality?.reasons).not.toContain("future-event");
  });

  it.each(["STAGE_COMPLETED", "STAGE_SKIPPED"])(
    "keeps a healthy stage measurable after an unrelated orphan %s",
    (terminal) => {
      const timings = derive([
        [terminal, 0, {}, "other"],
        ["STAGE_STARTED", 20],
        ["STAGE_COMPLETED", 30],
      ]);
      expect(timings).toHaveLength(1);
      expect(timings[0]).toMatchObject({
        activeMs: 10 * MINUTE,
        breakdown: { workMs: 10 * MINUTE },
        quality: { status: "usable", reasons: [], sampleEligible: true },
      });
      const views = resolveStageViews(workflow({ stages: [stage("alpha")] }), [], timings);
      expect(views[0]?.sampleCount).toBe(1);
    },
  );

  it("does not invalidate a later attempt of a stage with an orphan completion", () => {
    const runs = derive([
      ["STAGE_COMPLETED", 0],
      ["STAGE_STARTED", 20],
      ["STAGE_COMPLETED", 30],
    ]);
    expect(runs[0]?.activeMs).toBe(10 * MINUTE);
    expect(runs[0]?.quality?.sampleEligible).toBe(true);
  });

  it("keeps a recovered run invalid without invalidating a healthy later run", () => {
    const runs = derive([
      ["STAGE_COMPLETED", 0],
      ["STAGE_STARTED", 1],
      ["STAGE_STARTED", 20],
      ["STAGE_COMPLETED", 30],
    ]);
    expect(runs[0]).toMatchObject({
      activeMs: null,
      breakdown: null,
      quality: { status: "incomplete", sampleEligible: false },
    });
    expect(runs[0]?.quality?.reasons).toContain("missing-boundary");
    expect(runs[1]?.activeMs).toBe(10 * MINUTE);
    expect(runs[1]?.quality?.sampleEligible).toBe(true);
  });

  it("keeps a replacement attempt measurable after an abandoned run", () => {
    const runs = derive([
      ["STAGE_STARTED", 0],
      ["STAGE_STARTED", 20],
      ["STAGE_COMPLETED", 30],
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.activeMs).toBe(10 * MINUTE);
    expect(runs[0]?.quality?.sampleEligible).toBe(true);
  });

  it("does not use an old attempt's activity to shorten a new attempt's long gap", () => {
    const current = { Unit: "a", "Attempt Generation": "2" };
    const run = only([
      ["STAGE_STARTED", 0, current],
      ["ARTIFACT_CREATED", 15, { Unit: "a", "Attempt Generation": "1" }],
      ["STAGE_COMPLETED", 30, current],
    ]);
    expect(run.activeMs ?? 0).toBe(0);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });

  it("does not apply a matched gate from an old Attempt Generation to the current run", () => {
    const current = { "Attempt Generation": "current" };
    const stale = { "Attempt Generation": "stale" };
    const run = only([
      ["STAGE_STARTED", 0, current],
      ["STAGE_AWAITING_APPROVAL", 10, stale],
      ["GATE_APPROVED", 50, stale],
      ["STAGE_COMPLETED", 60, current],
    ]);
    expect(run.breakdown?.approvalWaitMs ?? 0).toBe(0);
    expect(run.activeMs ?? 0).toBe(0);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });

  it("does not apply a matched gate whose Run floor names an earlier attempt", () => {
    // Recorded shape (issue #166): no floor on STAGE_STARTED. The rerun after
    // the jump is the stage's second start, so the current floor would be #2.
    const stale = { "Run floor": `STAGE_STARTED:${new Date(BASE).toISOString()}#1` };
    const run = derive([
      ["STAGE_STARTED", 0],
      ["STAGE_COMPLETED", 2],
      ["STAGE_JUMPED", 5, {}, null],
      ["STAGE_STARTED", 5],
      ["STAGE_AWAITING_APPROVAL", 10, stale],
      ["GATE_APPROVED", 50, stale],
      ["STAGE_COMPLETED", 60],
    ]).at(-1) as StageTiming;
    expect(run.startedAt).toBe(new Date(BASE + 5 * MINUTE).toISOString());
    expect(run.breakdown?.approvalWaitMs ?? 0).toBe(0);
    expect(run.activeMs ?? 0).toBe(0);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
    expect(run.quality?.reasons).toContain("measurement-scope-mismatch");
  });

  it("keeps a pending old-generation gate out of current-run waiting time", () => {
    const run = only(
      [
        ["STAGE_STARTED", 0, { "Attempt Generation": "2" }],
        ["STAGE_AWAITING_APPROVAL", 10, { "Attempt Generation": "1" }],
      ],
      40,
    );
    expect(run.breakdown?.approvalWaitMs ?? 0).toBe(0);
    expect(run.activeMs ?? 0).toBe(0);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });

  it("does not let observations inside a full gate shorten the gap after approval", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ["STAGE_AWAITING_APPROVAL", 5],
      ["GATE_APPROVED", 45],
      ["STAGE_COMPLETED", 70],
    ];
    const baseline = only(rows);
    const withSensor = only([...rows, ["SENSOR_PASSED", 40]]);
    expect(withSensor.breakdown).toEqual(baseline.breakdown);
    expect(withSensor.breakdown).toMatchObject({
      workMs: 5 * MINUTE,
      approvalWaitMs: 40 * MINUTE,
      excludedGapMs: 25 * MINUTE,
    });
  });

  it("does not let a child's pause/resume endpoints shorten a whole-stage long gap", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["UNIT_PAUSED", 10, { Unit: "a" }],
      ["UNIT_RESUMED", 50, { Unit: "a" }],
      ["STAGE_COMPLETED", 60],
    ]);
    expect(run.activeMs ?? 0).toBe(0);
    expect(run.breakdown?.suspendedMs ?? 0).toBe(0);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });

  it("does not use activity from a paused Unit to infer work after its resume", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ["UNIT_PAUSED", 10, { Unit: "a" }],
      ["UNIT_RESUMED", 50, { Unit: "a" }],
      ["STAGE_COMPLETED", 60],
    ];
    const baseline = only(rows);
    const contradictory = only([...rows, ["ARTIFACT_CREATED", 40, { Unit: "a" }]]);
    expect(baseline.activeMs ?? 0).toBe(0);
    expect(contradictory.activeMs ?? 0).toBe(0);
    expect(contradictory.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });

  it("keeps a completed prior attempt's gate out of a later run", () => {
    const runs = derive([
      ["STAGE_STARTED", 0],
      ["STAGE_AWAITING_APPROVAL", 5],
      ["GATE_APPROVED", 10],
      ["STAGE_COMPLETED", 15],
      ["STAGE_STARTED", 20],
      ["STAGE_COMPLETED", 50],
    ]);
    expect(runs[0]?.breakdown?.approvalWaitMs).toBe(5 * MINUTE);
    expect(runs[1]?.breakdown).toMatchObject({
      workMs: 0,
      approvalWaitMs: 0,
      excludedGapMs: 30 * MINUTE,
    });
  });

  it("does not turn an unknown gate target into a stage-wide wait", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["STAGE_AWAITING_APPROVAL", 10, {}, null],
      ["GATE_APPROVED", 50, {}, null],
      ["STAGE_COMPLETED", 60],
    ]);
    expect(run.breakdown?.approvalWaitMs ?? 0).toBe(0);
    expect(run.activeMs ?? 0).toBe(0);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });
  it("does not report zero remaining from another attempt's terminal receipt", () => {
    const timings = derive([
      ["STAGE_STARTED", 0, { "Attempt Generation": "2" }],
      ["STAGE_COMPLETED", 10, { "Attempt Generation": "1" }],
    ]);
    const views = resolveStageViews(
      workflow({
        currentStage: "alpha",
        stages: [stage("alpha", { status: "awaiting-approval" })],
      }),
      timings,
      [sampleRun("alpha", 15 * MINUTE)],
    );
    expect(timings[0]?.activeMs).toBeNull();
    expect(views[0]?.remainingMs).toBeNull();
  });
});
