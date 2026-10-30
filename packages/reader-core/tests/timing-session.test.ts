import type { AuditEvent, StageTiming, TimingBreakdown } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { deriveStageTimings } from "../src/timing/derive.ts";
import { DEFAULT_TIMING_POLICY } from "../src/timing/policy.ts";
import { deriveLegacyTimings } from "./timing-legacy-reference.ts";

const BASE = Date.parse("2026-09-15T00:00:00Z");
const MIN = 60_000;
type Row = [
  name: string,
  minute: number,
  stage?: string | null,
  fields?: Record<string, string>,
  shard?: string,
];
function events(rows: Row[]): AuditEvent[] {
  return rows
    .map(([event, minute, stage = "alpha", fields = {}, shard = "a.md"], position) => ({
      event,
      timestamp: new Date(BASE + minute * MIN).toISOString(),
      stage,
      fields,
      shard,
      position,
      workflow: fields.Workflow ?? "main",
    }))
    .reverse();
}
function derive(rows: Row[], now = 1000, threshold = 20) {
  return deriveStageTimings(events(rows), BASE + now * MIN, {
    ...DEFAULT_TIMING_POLICY,
    gapThresholdMs: threshold * MIN,
  });
}
function only(rows: Row[], now = 1000) {
  return derive(rows, now).timings[0] as StageTiming;
}
function breakdown(run: StageTiming, expected: Partial<TimingBreakdown>) {
  expect(run.breakdown).toEqual({
    observedWallMs: 0,
    workMs: 0,
    approvalWaitMs: 0,
    suspendedMs: 0,
    excludedGapMs: 0,
    pendingObservationMs: 0,
    unattributedMs: 0,
    ...Object.fromEntries(Object.entries(expected).map(([key, minutes]) => [key, minutes * MIN])),
  });
  expect(run.activeMs).toBe(run.breakdown?.workMs);
}

describe("session-gap-v2 acceptance", () => {
  it("reports activity during an explicit suspension with the UI diagnostic key", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["WORKFLOW_PARKED", 5],
      ["ARTIFACT_UPDATED", 7],
      ["WORKFLOW_UNPARKED", 10, null],
      ["STAGE_COMPLETED", 15],
    ]);
    expect(run.quality).toMatchObject({
      status: "incomplete",
      reasons: expect.arrayContaining(["activity-during-suspension"]),
      sampleEligible: false,
    });
  });

  it("A-01/A-02 separates lunch and overnight carryover; compares the prior cap", () => {
    for (const [offsets, work, gap, old] of [
      [[0, 10, 70, 80], 20, 60, 30],
      [[0, 10, 900, 915], 25, 890, 30],
    ] as const) {
      const rows: Row[] = [
        ["STAGE_STARTED", offsets[0]],
        ["ARTIFACT_CREATED", offsets[1]],
        ["ARTIFACT_UPDATED", offsets[2]],
        ["STAGE_COMPLETED", offsets[3]],
      ];
      const run = only(rows);
      breakdown(run, { observedWallMs: offsets[3], workMs: work, excludedGapMs: gap });
      expect(run.quality).toMatchObject({ status: "limited", sampleEligible: true });
      expect(deriveLegacyTimings(events(rows), BASE + 1000 * MIN).timings[0]?.activeMs).toBe(
        old * MIN,
      );
    }
  });
  it("A-03 cannot detect a hidden short break", () => {
    breakdown(
      only([
        ["STAGE_STARTED", 0],
        ["ARTIFACT_CREATED", 5],
        ["STAGE_COMPLETED", 10],
      ]),
      { observedWallMs: 10, workMs: 10 },
    );
  });
  it("A-04 does not learn a long silent AI operation as a zero-minute sample", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["STAGE_COMPLETED", 26],
    ]);
    breakdown(run, { observedWallMs: 26, excludedGapMs: 26 });
    expect(run.quality?.sampleEligible).toBe(false);
  });
  it("A-05 separates approval waiting before applying the gap threshold", () => {
    breakdown(
      only([
        ["STAGE_STARTED", 0],
        ["ARTIFACT_CREATED", 10],
        ["STAGE_AWAITING_APPROVAL", 15],
        ["GATE_APPROVED", 45],
        ["STAGE_COMPLETED", 45],
      ]),
      { observedWallMs: 45, workMs: 15, approvalWaitMs: 30 },
    );
  });
  it("A-06 counts overlap once, giving suspension priority", () => {
    breakdown(
      only([
        ["STAGE_STARTED", 0],
        ["STAGE_AWAITING_APPROVAL", 5],
        ["WORKFLOW_PARKED", 10],
        ["WORKFLOW_UNPARKED", 30, null],
        ["GATE_APPROVED", 40],
        ["STAGE_COMPLETED", 40],
      ]),
      { observedWallMs: 40, workMs: 5, approvalWaitMs: 15, suspendedMs: 20 },
    );
  });
  it("A-07 resumes candidate work after rejection", () => {
    breakdown(
      only([
        ["STAGE_STARTED", 0],
        ["STAGE_AWAITING_APPROVAL", 10],
        ["GATE_REJECTED", 20],
        ["STAGE_REVISING", 25],
        ["STAGE_COMPLETED", 30],
      ]),
      { observedWallMs: 30, workMs: 20, approvalWaitMs: 10 },
    );
  });
  it("A-08 waits for the next observation before classifying a tail", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ["ARTIFACT_CREATED", 5],
    ];
    const open = only(rows, 12);
    breakdown(open, { observedWallMs: 12, workMs: 5, pendingObservationMs: 7 });
    expect(open.sinceLastObservationMs).toBe(7 * MIN);
    expect(open.quality?.sampleEligible).toBe(false);
    breakdown(only([...rows, ["STAGE_COMPLETED", 15]], 15), { observedWallMs: 15, workMs: 15 });
    breakdown(only([...rows, ["STAGE_COMPLETED", 30]], 30), {
      observedWallMs: 30,
      workMs: 5,
      excludedGapMs: 25,
    });
    expect(only(rows, 12).runId).toBe(only(rows, 60).runId);
  });
  it("A-09 includes exactly the threshold and excludes one millisecond beyond it", () => {
    expect(
      only([
        ["STAGE_STARTED", 0],
        ["STAGE_COMPLETED", 20],
      ]).activeMs,
    ).toBe(20 * MIN);
    const over = only([
      ["STAGE_STARTED", 0],
      ["STAGE_COMPLETED", 20 + 1 / MIN],
    ]);
    expect(over.breakdown?.excludedGapMs).toBe(20 * MIN + 1);
    expect(over.activeMs).toBe(0);
  });
  it("A-10 midnight does not split five minutes of work", () => {
    breakdown(
      only(
        [
          ["STAGE_STARTED", 1438],
          ["STAGE_COMPLETED", 1443],
        ],
        1444,
      ),
      { observedWallMs: 5, workMs: 5 },
    );
  });
  it("A-11 a waiting stage does not stop another stage", () => {
    const runs = derive([
      ["STAGE_STARTED", 0],
      ["STAGE_AWAITING_APPROVAL", 5],
      ["STAGE_STARTED", 10, "beta"],
      ["STAGE_COMPLETED", 20, "beta"],
      ["GATE_APPROVED", 30],
      ["STAGE_COMPLETED", 30],
    ]).timings;
    breakdown(runs.find((r) => r.stage === "alpha") as StageTiming, {
      observedWallMs: 30,
      workMs: 5,
      approvalWaitMs: 25,
    });
    breakdown(runs.find((r) => r.stage === "beta") as StageTiming, {
      observedWallMs: 10,
      workMs: 10,
    });
  });
  it("A-12 an old generation resolution never closes the current wait", () => {
    const run = only(
      [
        ["STAGE_STARTED", 0, "alpha", { "Attempt Generation": "2" }],
        ["STAGE_AWAITING_APPROVAL", 5, "alpha", { "Attempt Generation": "2" }],
        ["GATE_APPROVED", 10, "alpha", { "Attempt Generation": "1" }],
      ],
      20,
    );
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
    expect(run.breakdown?.approvalWaitMs).toBe(15 * MIN);
  });
  it("A-13 orphan resumes are incomplete; session receipts never establish work or breaks", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ["SESSION_ENDED", 5, null],
      ["SESSION_STARTED", 10, null],
      ["STAGE_COMPLETED", 60],
    ];
    breakdown(only(rows), { observedWallMs: 60, excludedGapMs: 60 });
    expect(only([...rows, ["WORKFLOW_UNPARKED", 20, null]]).quality?.status).toBe("incomplete");
  });
  it("A-14 makes ambiguous ordering, recovered pairs and future clocks unknown", () => {
    for (const [rows, now] of [
      [
        [
          ["STAGE_STARTED", 0, "alpha", {}, "a.md"],
          ["STAGE_COMPLETED", 0, "alpha", {}, "b.md"],
        ],
        10,
      ],
      [
        [
          ["STAGE_COMPLETED", 0, "alpha", {}, "a.md"],
          ["STAGE_STARTED", 1, "alpha", {}, "b.md"],
        ],
        10,
      ],
      [
        [
          ["STAGE_STARTED", 10],
          ["STAGE_COMPLETED", 20],
        ],
        5,
      ],
      [
        [
          ["STAGE_STARTED", 0],
          ["STAGE_COMPLETED", 20],
        ],
        5,
      ],
    ] as Array<[Row[], number]>) {
      const run = only(rows, now);
      expect(run.activeMs).toBeNull();
      expect(run.breakdown).toBeNull();
      expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
    }
  });
  it("A-15 excludes explicitly isolated activity and marks unnamed attribution", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["ARTIFACT_CREATED", 10, "alpha", { Workflow: "single-stage:alpha" }],
      ["STAGE_COMPLETED", 30],
    ]);
    breakdown(run, { observedWallMs: 30, excludedGapMs: 30 });
    expect(
      only([
        ["STAGE_STARTED", 0],
        ["ARTIFACT_CREATED", 5, null],
        ["STAGE_COMPLETED", 10],
      ]).quality?.reasons,
    ).toContain("unscoped-event");
  });
  it("A-17 background heartbeats cannot bridge a sixty-minute gap", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ...Array.from({ length: 59 }, (_, i): Row => ["HEALTH_CHECKED", i + 1]),
      ["STAGE_COMPLETED", 60],
    ];
    breakdown(only(rows), { observedWallMs: 60, excludedGapMs: 60 });
  });
  it("A-18 a Unit pause does not suspend other Units in the same stage", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["UNIT_PAUSED", 5, "alpha", { Unit: "a" }],
      ["ARTIFACT_CREATED", 10, "alpha", { Unit: "b" }],
      ["ARTIFACT_UPDATED", 15, "alpha", { Unit: "b" }],
      ["UNIT_RESUMED", 20, "alpha", { Unit: "a" }],
      ["STAGE_COMPLETED", 25],
    ]);
    expect(run.breakdown?.suspendedMs).toBe(0);
    expect(run.breakdown?.workMs).toBeGreaterThanOrEqual(10 * MIN);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });
  it("A-19 exposes policy sensitivity using the same input", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ["STAGE_COMPLETED", 25],
    ];
    expect(only(rows).sensitivity).toEqual(
      [10, 20, 30].map((n) => ({ thresholdMs: n * MIN, workMs: n < 25 ? 0 : 25 * MIN })),
    );
    expect(derive(rows, 100, 30).timings[0]?.activeMs).toBe(25 * MIN);
    expect(() => derive(rows, 100, 0)).toThrow(RangeError);
  });
  it("A-21 distinguishes raw time since observation from the exclusive pending category", () => {
    const runs = derive(
      [
        ["STAGE_STARTED", 0],
        ["ARTIFACT_CREATED", 5],
        ["STAGE_STARTED", 6, "beta"],
        ["STAGE_COMPLETED", 10, "beta"],
      ],
      12,
    ).timings;
    const alpha = runs.find((r) => r.stage === "alpha") as StageTiming;
    breakdown(alpha, { observedWallMs: 12, workMs: 5, unattributedMs: 4, pendingObservationMs: 3 });
    expect(alpha.sinceLastObservationMs).toBe(7 * MIN);
    breakdown(runs.find((r) => r.stage === "beta") as StageTiming, {
      observedWallMs: 4,
      workMs: 4,
    });
  });
  it("another stage's short events cannot turn a long gap into work", () => {
    const runs = derive([
      ["STAGE_STARTED", 0],
      ["STAGE_STARTED", 10, "beta"],
      ["ARTIFACT_CREATED", 15, "beta"],
      ["STAGE_COMPLETED", 20, "beta"],
      ["STAGE_COMPLETED", 60],
    ]).timings;
    breakdown(runs.find((r) => r.stage === "alpha") as StageTiming, {
      observedWallMs: 60,
      excludedGapMs: 50,
      unattributedMs: 10,
    });
  });
  it("accepts a genuine same-shard zero duration; unfinished waits cannot become samples", () => {
    expect(
      only([
        ["STAGE_STARTED", 0],
        ["STAGE_COMPLETED", 0],
      ]).quality?.sampleEligible,
    ).toBe(true);
    const run = only([
      ["STAGE_STARTED", 0],
      ["STAGE_AWAITING_APPROVAL", 5],
      ["STAGE_COMPLETED", 10],
    ]);
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
  });
  it("old-attempt observations cannot bridge the current attempt's long gap", () => {
    // Recorded shape (issue #166): the engine stamps no floor on STAGE_STARTED;
    // Unit events carry one naming that start. Only the generation differs.
    const current = { Unit: "a", "Attempt Generation": "2" };
    const runFloor = `STAGE_STARTED:${new Date(BASE).toISOString()}#1`;
    const old = { ...current, "Attempt Generation": "1", "Run floor": runFloor };
    const run = only([
      ["STAGE_STARTED", 0, "alpha", current],
      ["ARTIFACT_CREATED", 15, "alpha", old],
      ["STAGE_COMPLETED", 30, "alpha", current],
    ]);
    breakdown(run, { observedWallMs: 30, excludedGapMs: 30 });
    expect(run.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
    expect(run.quality?.reasons).toContain("observation-scope-mismatch");
  });
  it("a completion from another explicit Unit cannot establish a measured end", () => {
    const run = only([
      ["STAGE_STARTED", 0, "alpha", { Unit: "a" }],
      ["STAGE_COMPLETED", 10, "alpha", { Unit: "b" }],
    ]);
    expect(run.activeMs).toBeNull();
    expect(run.quality?.sampleEligible).toBe(false);
  });
});
