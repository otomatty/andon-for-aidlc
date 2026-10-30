import type { AuditEvent } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { compareByTime } from "../src/audit/events.ts";
import { deriveLegacyApprovalIntervals, deriveMeasurementIntervals } from "../src/audit/intervals.ts";
import { parseMeasurementBlocks, TIMING_FIELDS } from "../src/audit/measurement-events.ts";

const BASE = Date.parse("2026-09-15T01:00:00Z");
const minute = (n: number) => BASE + n * 60_000;
function event(
  name: string,
  at: number,
  fields: Record<string, string> = {},
  shard = "a",
): AuditEvent {
  return {
    event: name,
    timestamp: new Date(minute(at)).toISOString(),
    shard,
    stage: fields.Stage ?? fields["Stage slug"] ?? null,
    workflow: fields.Workflow ?? null,
    fields,
  };
}
function derive(input: AuditEvent[], now = 60) {
  return deriveMeasurementIntervals(
    input.map((e, position) => ({ ...e, position })).sort(compareByTime),
    minute(now),
  );
}
const stage = { Stage: "code-generation" };
const wait = (at: number, fields: Record<string, string> = stage) =>
  event("STAGE_AWAITING_APPROVAL", at, fields);
const approve = (at: number, fields: Record<string, string> = stage) =>
  event("GATE_APPROVED", at, fields);

describe("measurement block normalization", () => {
  it("keeps timing scope and append position but excludes prompts and usage data", () => {
    const parsed = parseMeasurementBlocks(
      [
        "# Header",
        "---",
        "**Event**: STAGE_STARTED",
        "**Timestamp**: 2026-09-15T01:00:00Z",
        "**Stage slug**: code-generation",
        "**Unit**: unit-a",
        "**Attempt Generation**: 2",
        "**Run floor**: 4",
        "**Session**: s1",
        "**Prompt**: PRIVATE",
        "**Tokens In**: PRIVATE",
        "---",
        "**Event**: STAGE_COMPLETED",
        "**Timestamp**: 2026-09-15T01:00:00Z",
      ].join("\n"),
      "one.md",
      TIMING_FIELDS,
    );
    expect(parsed.events.map((e) => e.position)).toEqual([1, 2]);
    expect(parsed.events[0]?.fields).toMatchObject({
      Unit: "unit-a",
      "Run floor": "4",
      Session: "s1",
    });
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE");
  });
  it("leaves consumer-specific exclusions to timing and effectiveness", () => {
    const parsed = parseMeasurementBlocks(
      "**Event**: STAGE_STARTED\n**Timestamp**: 2026-09-15T01:00:00Z\n**Workflow**: single-stage:demo",
      "a",
      TIMING_FIELDS,
    );
    expect(parsed.events).toHaveLength(1);
  });
  it("reports malformed timestamps and conflicting fields without retaining text", () => {
    const parsed = parseMeasurementBlocks(
      "**Event**: STAGE_STARTED\n**Timestamp**: invalid\n**Unit**: a\n**Unit**: b",
      "a",
      TIMING_FIELDS,
    );
    expect(parsed.events).toHaveLength(0);
    expect(parsed.warnings).toEqual([
      "conflicting audit field: a (Unit)",
      "malformed audit blocks ignored: a",
    ]);
  });
  it("uses append position within the same shard and instant", () => {
    const a = { ...event("STAGE_STARTED", 0, stage), position: 2 };
    const b = { ...event("STAGE_COMPLETED", 0, stage), position: 1 };
    expect([a, b].sort(compareByTime)).toEqual([b, a]);
  });
});

describe("scope-bearing measurement intervals", () => {
  it("pairs approval and rejection separately so revisions resume work", () => {
    const result = derive([
      wait(5),
      event("GATE_REJECTED", 10, stage),
      event("STAGE_REVISING", 15, stage),
      wait(20),
      approve(30),
    ]);
    expect(result.intervals.map((i) => [i.startMs, i.endMs, i.pending])).toEqual([
      [minute(5), minute(10), false],
      [minute(20), minute(30), false],
    ]);
    expect(result.diagnostics).toEqual([]);
  });
  it("keeps approval and record-wide suspension as raw overlapping intervals", () => {
    const result = derive([
      wait(5),
      event("WORKFLOW_PARKED", 10, stage),
      event("WORKFLOW_UNPARKED", 30),
      approve(40),
    ]);
    expect(result.intervals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "suspended",
          stages: null,
          startMs: minute(10),
          endMs: minute(30),
        }),
        expect.objectContaining({
          kind: "approval-wait",
          stages: [stage.Stage],
          startMs: minute(5),
          endMs: minute(40),
        }),
      ]),
    );
    expect(result.diagnostics).toEqual([]);
  });
  it("keeps an unresolved open wait provisional until now", () => {
    const result = derive([wait(10)], 15);
    expect(result.intervals[0]).toMatchObject({ pending: true, endIndex: null, endMs: minute(15) });
    expect(result.diagnostics).toEqual([]);
  });
  it("normalizes multi-stage gate sets before matching", () => {
    const result = derive([
      wait(0, { "Gate Stages": "b, a,b", "Gate Scope": "cascade" }),
      approve(10, { "Gate Stages": "a,b", "Gate Scope": "cascade" }),
    ]);
    expect(result.intervals[0]).toMatchObject({ stages: ["a", "b"], endMs: minute(10) });
    expect(result.diagnostics).toEqual([]);
  });
  it.each(["Unit", "Attempt Generation", "Run floor", "Gate Scope"])(
    "never treats a missing %s as a wildcard",
    (field) => {
      const result = derive([wait(0, { ...stage, [field]: "one" }), approve(10)]);
      expect(result.intervals[0]?.pending).toBe(true);
      expect(result.diagnostics.map((d) => d.code)).toContain("orphan-wait-resolution");
    },
  );
  it("keeps another Unit's wait open when one Unit resolves", () => {
    const result = derive([
      wait(0, { ...stage, Unit: "a" }),
      wait(1, { ...stage, Unit: "b" }),
      approve(10, { ...stage, Unit: "b" }),
    ]);
    expect(result.intervals.find((i) => i.unit === "a")?.pending).toBe(true);
    expect(result.intervals.find((i) => i.unit === "b")?.pending).toBe(false);
  });
  it("keeps a new attempt open when an old generation resolves", () => {
    const result = derive([
      wait(0, { ...stage, "Attempt Generation": "1" }),
      event("STAGE_STARTED", 1, { ...stage, "Attempt Generation": "2" }),
      wait(2, { ...stage, "Attempt Generation": "2" }),
      approve(3, { ...stage, "Attempt Generation": "1" }),
    ]);
    expect(result.intervals.find((i) => i.attemptGeneration === "2")?.pending).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "unresolved-wait-at-reset",
      "orphan-wait-resolution",
    ]);
  });
  it.each(["WORKFLOW_STARTED", "STAGE_JUMPED"])("invalidates unresolved gates on %s", (name) => {
    const result = derive([wait(0), event(name, 5), approve(10)]);
    expect(result.intervals[0]?.endMs).toBe(minute(5));
    expect(result.diagnostics.map((d) => d.code)).toContain("unresolved-wait-at-reset");
  });
  // v2.11.0 stageJumpReaches: a jump restarts only its Target and later stages.
  describe("a STAGE_JUMPED row's reach", () => {
    const order = ["functional-design", "code-generation", "build-and-test"];
    const deriveOrdered = (input: AuditEvent[], stageOrder: readonly string[] | null) =>
      deriveMeasurementIntervals(
        input.map((e, position) => ({ ...e, position })).sort(compareByTime),
        minute(60),
        stageOrder,
      );

    it("keeps a wait of a stage before the Target open", () => {
      const result = deriveOrdered(
        [wait(0), event("STAGE_JUMPED", 5, { Target: "build-and-test" }), approve(10)],
        order,
      );
      expect(result.intervals[0]?.endMs).toBe(minute(10));
      expect(result.diagnostics.map((d) => d.code)).not.toContain("unresolved-wait-at-reset");
    });

    it.each([
      ["the Target itself", "code-generation", order],
      ["an earlier Target", "functional-design", order],
      ["an unknown Target", "unknown", order],
      ["no stage order", "build-and-test", null],
    ])("invalidates the wait on a jump to %s", (_, target, stageOrder) => {
      const result = deriveOrdered(
        [wait(0), event("STAGE_JUMPED", 5, { Target: target }), approve(10)],
        stageOrder,
      );
      expect(result.intervals[0]?.endMs).toBe(minute(5));
      expect(result.diagnostics.map((d) => d.code)).toContain("unresolved-wait-at-reset");
    });

    it("keeps a Unit's pause of a stage the jump does not reach", () => {
      const paused = { ...stage, Unit: "a" };
      const result = deriveOrdered(
        [
          event("UNIT_PAUSED", 0, paused),
          event("STAGE_JUMPED", 5, { Target: "build-and-test" }),
          event("UNIT_RESUMED", 10, paused),
        ],
        order,
      );
      expect(result.intervals[0]?.endMs).toBe(minute(10));
      expect(result.diagnostics.map((d) => d.code)).not.toContain(
        "unresolved-suspension-at-reset",
      );
    });

    it("keeps legacy effectiveness waits of stages the jump does not reach", () => {
      const blocks = [
        "---\n**Event**: STAGE_AWAITING_APPROVAL\n**Timestamp**: 2026-09-15T01:00:00Z\n**Stage**: code-generation\n",
        "---\n**Event**: STAGE_JUMPED\n**Timestamp**: 2026-09-15T01:05:00Z\n**Target**: build-and-test\n",
        "---\n**Event**: GATE_APPROVED\n**Timestamp**: 2026-09-15T01:10:00Z\n**Stage**: code-generation\n",
      ].join("");
      const { events } = parseMeasurementBlocks(blocks, "a.md");
      const kept = deriveLegacyApprovalIntervals(events, minute(60), false, order);
      expect(kept.closed).toEqual([[minute(0), minute(10)]]);
      expect(kept.excludedIntervals).toBe(0);
      const reset = deriveLegacyApprovalIntervals(events, minute(60), false);
      expect(reset.closed).toEqual([]);
      expect(reset.excludedIntervals).toBe(2);
    });
  });
  it("resets only the named Bolt's child wait", () => {
    const result = derive([
      wait(0, { ...stage, Unit: "a" }),
      wait(1, { ...stage, Unit: "b" }),
      event("BOLT_STARTED", 5, { "Bolt slug": "a" }),
    ]);
    expect(result.intervals.find((i) => i.unit === "a")?.pending).toBe(false);
    expect(result.intervals.find((i) => i.unit === "b")?.pending).toBe(true);
  });
  it("does not restart duplicate or revalidated wait openings", () => {
    const result = derive([
      wait(0),
      wait(2),
      wait(5, { ...stage, Revalidated: "true" }),
      approve(10),
    ]);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]?.startMs).toBe(minute(0));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "duplicate-wait-opening", severity: "limited" }),
    ]);
  });
  it("does not reconstruct recovered openings or a revalidation without a start", () => {
    const result = derive([
      wait(0, { ...stage, Recovered: "true" }),
      wait(5, { ...stage, Revalidated: "true" }),
    ]);
    expect(result.intervals).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "recovered-wait",
      "revalidated-wait-without-opening",
    ]);
  });
  it("marks a completed stage with an unresolved wait incomplete", () => {
    const result = derive([wait(0), event("STAGE_COMPLETED", 5, stage)]);
    expect(result.intervals[0]).toMatchObject({ endMs: minute(5), pending: false });
    expect(result.diagnostics[0]).toMatchObject({
      code: "unresolved-wait-at-completion",
      severity: "incomplete",
    });
  });
  it("does not infer a pause from an orphan unpark or session event", () => {
    const result = derive([event("WORKFLOW_UNPARKED", 0), event("SESSION_ENDED", 5)]);
    expect(result.intervals).toEqual([]);
    expect(result.sessionEvents).toHaveLength(1);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["orphan-suspension-resolution"]);
  });
  it("does not promote one Unit's pause to a whole-stage suspension", () => {
    const fields = { ...stage, Unit: "a", "Attempt Generation": "2", "Run floor": "4" };
    const result = derive([
      event("UNIT_PAUSED", 0, fields),
      event("ARTIFACT_CREATED", 5, { ...fields, Unit: "b" }),
      event("UNIT_RESUMED", 10, fields),
    ]);
    expect(result.intervals[0]).toMatchObject({
      stages: [stage.Stage],
      unit: "a",
      endMs: minute(10),
    });
    expect(result.diagnostics).toEqual([]);
  });
  it("allows Unit completion to close only the matching child suspension", () => {
    const fields = { ...stage, Unit: "a", "Run floor": "1" };
    const result = derive([
      event("UNIT_PAUSED", 0, fields),
      event("UNIT_COMPLETED", 5, { ...fields, "Run floor": "2" }),
      event("UNIT_COMPLETED", 10, fields),
    ]);
    expect(result.intervals[0]?.endMs).toBe(minute(10));
  });
  // v2.11.0 adds UNIT_SKIPPED (aidlc-state.ts `unit skip`): a skipped Unit's
  // pause ends there, and the skip is not activity during that pause.
  it("lets a Unit skip close only the matching child suspension", () => {
    const fields = { ...stage, Unit: "a", "Run floor": "1" };
    const result = derive([
      event("UNIT_PAUSED", 0, fields),
      event("UNIT_SKIPPED", 5, { ...fields, Unit: "b" }),
      event("UNIT_SKIPPED", 10, { ...fields, Reason: "not needed" }),
    ]);
    expect(result.intervals[0]?.endMs).toBe(minute(10));
    expect(result.intervals[0]?.pending).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).not.toContain("activity-during-suspension");
    expect(derive([event("UNIT_SKIPPED", 5, stage)]).diagnostics).toEqual([]);
  });
  it("treats a reply in the chat as activity during a suspension (v2.11.0 QUESTION_REPLIED)", () => {
    const result = derive([
      event("WORKFLOW_PARKED", 0),
      event("QUESTION_REPLIED", 5, stage),
      event("WORKFLOW_UNPARKED", 10),
    ]);
    expect(result.diagnostics.map((d) => d.code)).toContain("activity-during-suspension");
  });
  it("does not resolve one stage's Unit suspension with another stage's resume", () => {
    const result = derive([
      event("UNIT_PAUSED", 0, { Stage: "alpha", Unit: "a" }),
      event("UNIT_RESUMED", 5, { Stage: "beta", Unit: "a" }),
    ]);
    expect(result.intervals[0]).toMatchObject({ stages: ["alpha"], pending: true });
    expect(result.diagnostics.map((d) => d.code)).toContain("orphan-suspension-resolution");
  });
  it("does not call another stage's Unit activity a contradiction of a stage-specific pause", () => {
    const result = derive([
      event("UNIT_PAUSED", 0, { Stage: "alpha", Unit: "a" }),
      event("ARTIFACT_CREATED", 5, { Stage: "beta", Unit: "a" }),
      event("UNIT_RESUMED", 10, { Stage: "alpha", Unit: "a" }),
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.intervals[0]?.endMs).toBe(minute(10));
  });
  it("records activity during a suspension without inventing a resume time", () => {
    const result = derive([event("WORKFLOW_PARKED", 0), event("ARTIFACT_CREATED", 5, stage)]);
    expect(result.intervals[0]?.pending).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain("activity-during-suspension");
  });
  it.each(["SENSOR_FIRED", "SENSOR_PASSED", "SENSOR_FAILED", "UNIT_COMPLETED"])(
    "marks %s during a record suspension as contradictory activity",
    (name) => {
      const result = derive([event("WORKFLOW_PARKED", 0), event(name, 5, { ...stage, Unit: "a" })]);
      expect(result.diagnostics.map((d) => d.code)).toContain("activity-during-suspension");
    },
  );
  it("marks cross-shard lifecycle ties ambiguous but accepts same-shard append order", () => {
    const ambiguous = derive([wait(0), { ...approve(0), shard: "b" }]);
    expect(ambiguous.diagnostics.map((d) => d.code)).toContain("ambiguous-lifecycle-order");
    const valid = derive([wait(0), approve(0)]);
    expect(valid.diagnostics).toEqual([]);
    expect(valid.intervals[0]).toMatchObject({ startMs: minute(0), endMs: minute(0) });
  });
  it("ignores explicitly isolated events and future control endpoints", () => {
    const result = derive(
      [
        wait(0, { ...stage, Workflow: "single-stage:code-generation" }),
        event("WORKFLOW_PARKED", 20),
      ],
      10,
    );
    expect(result.intervals).toEqual([]);
  });
});
