import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuditEvent, StageTiming } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { deriveStageTimings } from "../src/timing/derive.ts";
import { getStageTimings } from "../src/timing/read.ts";
import { runFloorCheck } from "../src/timing/run-floor.ts";
import { expectOk, REPO_ROOT } from "./paths.ts";
import { stateWithStages } from "./state-fixtures.ts";

/**
 * Issue #166: the engine stamps Unit events with a `Run floor` naming the
 * boundary that began the attempt, but never stamps one on STAGE_STARTED.
 * Every fixture here uses that recorded shape — a floor on the Unit event
 * only, spelled exactly as the engine spells it — never a floor on the start.
 */

const BASE = Date.parse("2026-09-24T06:00:00Z");
const MIN = 60_000;
type Row = [event: string, minute: number, stage?: string | null, fields?: Record<string, string>];

/** Engine timestamps have second resolution and no milliseconds. */
function at(minute: number): string {
  return new Date(BASE + minute * MIN).toISOString().replace(".000Z", "Z");
}
function floor(event: string, minute: number, ordinal = 1): string {
  return `${event}:${at(minute)}#${ordinal}`;
}
function unit(runFloor: string, name = "u"): Record<string, string> {
  return { Unit: name, "Run floor": runFloor };
}
/** Ascending, one shard: the sorted stream pairing hands to classification. */
function events(rows: Row[]): AuditEvent[] {
  return rows.map(([event, minute, stage = "alpha", fields = {}], position) => ({
    event,
    timestamp: at(minute),
    stage,
    fields,
    shard: "one.md",
    position,
    workflow: fields.Workflow ?? null,
  }));
}
function derive(rows: Row[], now = 1000): StageTiming[] {
  return deriveStageTimings(events(rows), BASE + now * MIN).timings;
}
function alphaRuns(rows: Row[]): StageTiming[] {
  return derive(rows).filter((run) => run.stage === "alpha");
}
function only(rows: Row[]): StageTiming {
  const runs = alphaRuns(rows);
  expect(runs).toHaveLength(1);
  return runs[0] as StageTiming;
}
function expectSample(run: StageTiming | undefined, workMinutes: number): void {
  expect(run?.activeMs).toBe(workMinutes * MIN);
  expect(run?.quality).toMatchObject({ status: "usable", reasons: [], sampleEligible: true });
}

describe("Run floor attempt identity (issue #166)", () => {
  it("uses a run whose Unit event names the stage's own STAGE_STARTED", () => {
    const run = only([
      ["STAGE_STARTED", 0],
      ["ARTIFACT_CREATED", 3],
      ["UNIT_COMPLETED", 10, "alpha", unit(floor("STAGE_STARTED", 0))],
      ["STAGE_AWAITING_APPROVAL", 12],
      ["GATE_APPROVED", 15],
      ["STAGE_COMPLETED", 15],
    ]);
    expectSample(run, 12);
    expect(run.breakdown?.approvalWaitMs).toBe(3 * MIN);
  });

  it("numbers a rerun like the engine: only this stage's main-workflow starts count", () => {
    const [first, second] = alphaRuns([
      ["STAGE_STARTED", 0],
      ["UNIT_COMPLETED", 5, "alpha", unit(floor("STAGE_STARTED", 0))],
      ["STAGE_COMPLETED", 10],
      ["STAGE_STARTED", 10, "beta"],
      ["STAGE_COMPLETED", 11, "beta"],
      ["STAGE_STARTED", 12, "alpha", { Workflow: "single-stage:alpha" }],
      ["STAGE_COMPLETED", 13, "alpha", { Workflow: "single-stage:alpha" }],
      // A backward jump lands its STAGE_STARTED in the same second.
      ["STAGE_JUMPED", 20, null],
      ["STAGE_STARTED", 20],
      ["UNIT_COMPLETED", 25, "alpha", unit(floor("STAGE_STARTED", 20, 2))],
      ["STAGE_COMPLETED", 30],
    ]);
    expectSample(first, 10);
    expectSample(second, 10);
  });

  it.each([
    ["WORKFLOW_STARTED", floor("WORKFLOW_STARTED", 0)],
    ["STAGE_JUMPED", floor("STAGE_JUMPED", 0)],
  ])("uses a unit-major run whose floor names %s instead of STAGE_STARTED", (boundary, runFloor) => {
    const run = only([
      [boundary, 0, null],
      ["STAGE_STARTED", 1],
      ["UNIT_STARTED", 2, "alpha", unit(runFloor)],
      ["UNIT_COMPLETED", 8, "alpha", unit(runFloor)],
      ["STAGE_COMPLETED", 10],
    ]);
    expectSample(run, 9);
  });

  it("uses a unit-major run recorded before any attempt boundary", () => {
    expectSample(
      only([
        ["STAGE_STARTED", 0],
        ["UNIT_COMPLETED", 6, "alpha", unit("unstarted#0")],
        ["STAGE_COMPLETED", 10],
      ]),
      10,
    );
  });

  it("uses a checkpoint run whose floor skips another Unit's rejection", () => {
    const gate = { Unit: "b", "Gate Stages": "alpha", "Gate Scope": "unit-end" };
    expectSample(
      only([
        ["WORKFLOW_STARTED", 0, null],
        ["STAGE_AWAITING_APPROVAL", 1, "alpha", gate],
        ["GATE_REJECTED", 2, "alpha", gate],
        ["STAGE_STARTED", 3],
        ["UNIT_COMPLETED", 8, "alpha", unit(floor("WORKFLOW_STARTED", 0), "a")],
        ["STAGE_COMPLETED", 10],
      ]),
      7,
    );
  });

  // Each later boundary starts a new engine attempt. A Unit event still naming
  // the earlier attempt must not bridge the current run's long gap.
  it.each<[string, (runFloor: string) => Row[], string, string, number, number]>([
    [
      "a rerun's STAGE_STARTED",
      (runFloor) => [
        ["STAGE_STARTED", 0],
        ["STAGE_COMPLETED", 5],
        ["STAGE_JUMPED", 10, null],
        ["STAGE_STARTED", 10],
        ["UNIT_COMPLETED", 20, "alpha", unit(runFloor)],
        ["STAGE_COMPLETED", 40],
      ],
      floor("STAGE_STARTED", 10, 2),
      floor("STAGE_STARTED", 0),
      30,
      0,
    ],
    [
      "a GATE_REJECTED",
      (runFloor) => [
        ["STAGE_STARTED", 0],
        ["STAGE_AWAITING_APPROVAL", 5],
        ["GATE_REJECTED", 6],
        ["UNIT_COMPLETED", 20, "alpha", unit(runFloor)],
        ["STAGE_COMPLETED", 40],
      ],
      floor("GATE_REJECTED", 6),
      floor("STAGE_STARTED", 0),
      39,
      5,
    ],
    [
      // Only the unit-major rule would still stamp the workflow's start here,
      // and that floor cannot tell this rerun from the stage's first run.
      "a stage-major rerun, even when the floor matches the unit-major rule",
      (runFloor) => [
        ["WORKFLOW_STARTED", 0, null],
        ["STAGE_STARTED", 1],
        ["STAGE_COMPLETED", 10],
        ["STAGE_STARTED", 20],
        ["UNIT_COMPLETED", 40, "alpha", unit(runFloor)],
        ["STAGE_COMPLETED", 60],
      ],
      floor("STAGE_STARTED", 20, 2),
      floor("WORKFLOW_STARTED", 0),
      40,
      0,
    ],
    [
      "a STAGE_JUMPED in a unit-major run",
      (runFloor) => [
        ["WORKFLOW_STARTED", 0, null],
        ["STAGE_STARTED", 1],
        ["STAGE_JUMPED", 5, null],
        ["UNIT_COMPLETED", 20, "alpha", unit(runFloor)],
        ["STAGE_COMPLETED", 40],
      ],
      floor("STAGE_JUMPED", 5),
      floor("WORKFLOW_STARTED", 0),
      39,
      0,
    ],
  ])("excludes a floor from before %s", (_, rows, current, stale, currentWork, staleWork) => {
    const [kept, excluded] = [rows(current), rows(stale)].map((row) => alphaRuns(row).at(-1));
    expectSample(kept, currentWork);
    expect(excluded?.activeMs).toBe(staleWork * MIN);
    expect(excluded?.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
    expect(excluded?.quality?.reasons).toContain("observation-scope-mismatch");
  });

  it("scopes an approval wait by the same floor rule", () => {
    const rows = (runFloor: string): Row[] => [
      ["STAGE_STARTED", 0],
      ["STAGE_COMPLETED", 2],
      ["STAGE_JUMPED", 5, null],
      ["STAGE_STARTED", 5],
      ["STAGE_AWAITING_APPROVAL", 10, "alpha", { "Run floor": runFloor }],
      ["GATE_APPROVED", 50, "alpha", { "Run floor": runFloor }],
      ["STAGE_COMPLETED", 60],
    ];
    const current = alphaRuns(rows(floor("STAGE_STARTED", 5, 2))).at(-1);
    expectSample(current, 15);
    expect(current?.breakdown?.approvalWaitMs).toBe(40 * MIN);
    const stale = alphaRuns(rows(floor("STAGE_STARTED", 0))).at(-1);
    expect(stale?.breakdown?.approvalWaitMs).toBe(0);
    expect(stale?.quality).toMatchObject({ status: "incomplete", sampleEligible: false });
    expect(stale?.quality?.reasons).toContain("measurement-scope-mismatch");
  });
});

describe("runFloorCheck", () => {
  function check(rows: Row[], stage = "alpha", order: readonly string[] | null = null) {
    const stream = events(rows);
    const matches = runFloorCheck(stream, order);
    const index = stream.length - 1;
    return matches(stream[index] as AuditEvent, index, stage);
  }

  it("accepts an event that makes no attempt claim", () => {
    expect(check([["STAGE_STARTED", 0], ["ARTIFACT_CREATED", 1]])).toBe(true);
  });

  it("rejects a floor the engine could not have stamped", () => {
    const rows = (runFloor: string): Row[] => [
      ["STAGE_STARTED", 0],
      ["UNIT_COMPLETED", 1, "alpha", unit(runFloor)],
    ];
    expect(check(rows("4"))).toBe(false);
    expect(check(rows(floor("STAGE_STARTED", 0, 2)))).toBe(false);
  });

  it("ignores isolated single-stage starts even when they reach it", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ["STAGE_STARTED", 1, "alpha", { Workflow: "single-stage:alpha" }],
      ["UNIT_COMPLETED", 2, "alpha", unit(floor("STAGE_STARTED", 0))],
    ];
    expect(check(rows)).toBe(true);
  });

  it("keeps a unit-major floor once a jump settles the stage's earlier restarts", () => {
    const rows: Row[] = [
      ["WORKFLOW_STARTED", 0, null],
      ["STAGE_STARTED", 1],
      ["STAGE_STARTED", 2],
      ["STAGE_JUMPED", 3, null],
      ["STAGE_STARTED", 3],
      ["UNIT_COMPLETED", 4, "alpha", unit(floor("STAGE_JUMPED", 3))],
    ];
    expect(check(rows)).toBe(true);
  });

  it("counts only boundaries recorded before the event", () => {
    const own = { "Gate Stages": "alpha", "Run floor": floor("STAGE_STARTED", 0) };
    expect(check([["STAGE_STARTED", 0], ["GATE_REJECTED", 1, "alpha", own]])).toBe(true);
  });

  it("counts a rejection only for the stages its gate names", () => {
    const rows = (gateStages: string): Row[] => [
      ["STAGE_STARTED", 0],
      ["STAGE_AWAITING_APPROVAL", 1, "alpha", { "Gate Stages": gateStages }],
      ["GATE_REJECTED", 2, "alpha", { "Gate Stages": gateStages }],
      ["UNIT_COMPLETED", 3, "alpha", unit(floor("GATE_REJECTED", 2))],
    ];
    expect(check(rows("beta, alpha"))).toBe(true);
    expect(check(rows("beta"))).toBe(false);
  });

  it("checks a stageless event against its run's stage; a stageless rejection moves nothing", () => {
    const rows: Row[] = [
      ["STAGE_STARTED", 0],
      ["GATE_REJECTED", 1, null],
      ["UNIT_COMPLETED", 2, null, unit(floor("STAGE_STARTED", 0))],
    ];
    expect(check(rows)).toBe(true);
  });

  it("counts a Unit's rejection only toward that Unit's own floor", () => {
    const rows = (eventUnit: string): Row[] => [
      ["WORKFLOW_STARTED", 0, null],
      ["GATE_REJECTED", 1, "alpha", { Unit: "a" }],
      ["UNIT_COMPLETED", 2, "alpha", unit(floor("GATE_REJECTED", 1), eventUnit)],
    ];
    expect(check(rows("a"))).toBe(true);
    expect(check(rows("b"))).toBe(false);
  });

  it("checks a checkpoint gate against the floor of the stage it names", () => {
    const rows: Row[] = [
      ["WORKFLOW_STARTED", 0, null],
      ["GATE_REJECTED", 1, "beta", { Unit: "a" }],
      ["STAGE_AWAITING_APPROVAL", 2, "beta", unit(floor("GATE_REJECTED", 1), "a")],
    ];
    expect(check(rows, "alpha")).toBe(true);
  });
});

/** A complete CONSTRUCTION_POLICY_SET row as v2.11.0 `emitConstructionPolicySet` writes it. */
function policy(
  minute: number,
  field: string,
  value: string,
  previous: string,
  after: { iteration?: string; checkpoints?: string } = {},
): Row {
  return [
    "CONSTRUCTION_POLICY_SET",
    minute,
    null,
    {
      Field: field,
      Value: value,
      "Previous Value": previous,
      "Construction Iteration": after.iteration ?? "unset",
      "Construction Checkpoints": after.checkpoints ?? "unset",
    },
  ];
}

describe("runFloorCheck under v2.11.0 rules", () => {
  function check(rows: Row[], order: readonly string[] | null = null, stage = "alpha") {
    const stream = events(rows);
    const index = stream.length - 1;
    return runFloorCheck(stream, order)(stream[index] as AuditEvent, index, stage);
  }
  const ORDER = ["alpha", "beta"];

  describe("a STAGE_JUMPED row reaches only its Target and later stages (stageJumpReaches)", () => {
    const rows = (runFloor: string, target?: string): Row[] => [
      ["WORKFLOW_STARTED", 0, null],
      ["STAGE_STARTED", 1],
      ["STAGE_JUMPED", 2, null, target === undefined ? {} : { Target: target }],
      ["UNIT_COMPLETED", 3, "alpha", unit(runFloor)],
    ];

    it("leaves an earlier stage's attempt alone", () => {
      expect(check(rows(floor("STAGE_STARTED", 1), "beta"), ORDER)).toBe(true);
      expect(check(rows(floor("STAGE_JUMPED", 2), "beta"), ORDER)).toBe(false);
    });

    it.each([
      ["the stage itself", "alpha", ORDER],
      ["an unknown Target", "gamma", ORDER],
      ["no Target", undefined, ORDER],
      ["an unknown stage order", "beta", null],
    ])("starts a new attempt for %s", (_, target, order) => {
      expect(check(rows(floor("STAGE_JUMPED", 2), target), order)).toBe(true);
      expect(check(rows(floor("STAGE_STARTED", 1), target), order)).toBe(false);
    });

    it("numbers a jump by its place among every jump, reaching or not", () => {
      const jumps = (runFloor: string): Row[] => [
        ["WORKFLOW_STARTED", 0, null],
        ["STAGE_JUMPED", 1, null, { Target: "beta" }],
        ["STAGE_JUMPED", 2, null, { Target: "alpha" }],
        ["UNIT_COMPLETED", 3, "alpha", unit(runFloor)],
      ];
      expect(check(jumps(floor("STAGE_JUMPED", 2, 2)), ORDER)).toBe(true);
      expect(check(jumps(floor("STAGE_JUMPED", 2, 1)), ORDER)).toBe(false);
    });
  });

  describe("unit-major flooring keeps the stage starts recorded under stage-major", () => {
    // Stage-major restarts, a switch to unit-major, then a start under it.
    const rows = (runFloor: string): Row[] => [
      ["STAGE_STARTED", 1],
      ["STAGE_STARTED", 3],
      policy(5, "Construction Iteration", "unit-major", "stage-major", { iteration: "unit-major" }),
      ["STAGE_STARTED", 7],
      ["UNIT_COMPLETED", 8, "alpha", unit(runFloor)],
    ];

    it("keeps the floor of the last start recorded under stage-major", () => {
      expect(check(rows(floor("STAGE_STARTED", 3, 2)))).toBe(true);
      expect(check(rows("unstarted#0"))).toBe(false);
    });

    it("numbers a counted start by its place among every start of the stage", () => {
      const switched = (runFloor: string): Row[] => [
        ["STAGE_STARTED", 1],
        policy(2, "Construction Iteration", "stage-major", "unit-major", {
          iteration: "stage-major",
        }),
        ["STAGE_STARTED", 3],
        policy(4, "Construction Checkpoints", "enabled", "unset", {
          iteration: "stage-major",
          checkpoints: "enabled",
        }),
        ["STAGE_STARTED", 6],
        ["UNIT_COMPLETED", 7, "alpha", unit(runFloor)],
      ];
      expect(check(switched(floor("STAGE_STARTED", 3, 2)))).toBe(true);
      expect(check(switched(floor("STAGE_STARTED", 3, 1)))).toBe(false);
    });

    it("ignores a policy row cut short", () => {
      const partial: Row = [
        "CONSTRUCTION_POLICY_SET",
        5,
        null,
        { Field: "Construction Iteration", Value: "unit-major" },
      ];
      const cut = rows(floor("STAGE_STARTED", 3, 2));
      cut[2] = partial;
      expect(check(cut)).toBe(false);
    });
  });

  describe("a Unit receipt's stage-major floor leaves out starts recorded under unit-major", () => {
    const rows = (event: string, runFloor: string): Row[] => [
      ["WORKFLOW_STARTED", 0, null],
      ["STAGE_STARTED", 1],
      ["STAGE_STARTED", 2],
      policy(3, "Construction Iteration", "stage-major", "unit-major", {
        iteration: "stage-major",
      }),
      [event, 4, "alpha", unit(runFloor)],
    ];

    it("keeps the Units finished before a switch back to stage-major", () => {
      expect(check(rows("UNIT_COMPLETED", floor("WORKFLOW_STARTED", 0)))).toBe(true);
    });

    it("still stops on later stage-major restarts", () => {
      const restarted = (runFloor: string): Row[] => [
        ...rows("UNIT_STARTED", runFloor).slice(0, 4),
        ["STAGE_STARTED", 5],
        ["STAGE_STARTED", 6],
        ["UNIT_STARTED", 7, "alpha", unit(runFloor)],
      ];
      expect(check(restarted(floor("WORKFLOW_STARTED", 0)))).toBe(false);
      expect(check(restarted(floor("STAGE_STARTED", 6, 4)))).toBe(true);
    });

    it("treats a stage's late first start after its unit-major Units as no restart", () => {
      const late = (event: string, runFloor: string): Row[] => [
        ["WORKFLOW_STARTED", 0, null],
        ["STAGE_STARTED", 1],
        ["UNIT_COMPLETED", 2, "beta", unit(floor("WORKFLOW_STARTED", 0), "a")],
        policy(3, "Construction Iteration", "stage-major", "unit-major", {
          iteration: "stage-major",
        }),
        ["STAGE_STARTED", 4, "beta"],
        policy(5, "Construction Execution", "swarm", "serial", { iteration: "stage-major" }),
        [event, 6, "beta", unit(runFloor, "b")],
      ];
      expect(check(late("UNIT_STARTED", floor("WORKFLOW_STARTED", 0)), null, "beta")).toBe(true);
      // Only Unit lifecycle receipts are floored this way.
      expect(
        check(late("STAGE_AWAITING_APPROVAL", floor("WORKFLOW_STARTED", 0)), null, "beta"),
      ).toBe(false);
      expect(
        check(late("STAGE_AWAITING_APPROVAL", floor("STAGE_STARTED", 4)), null, "beta"),
      ).toBe(true);
    });
  });
});

describe("run identities across a jump (v2.11.0 stageJumpReaches)", () => {
  const rows: Row[] = [
    ["STAGE_STARTED", 0],
    ["STAGE_COMPLETED", 5],
    ["STAGE_JUMPED", 10, null, { Target: "beta" }],
    ["STAGE_STARTED", 10],
    ["STAGE_COMPLETED", 15],
  ];
  const ids = (order: readonly string[] | null) =>
    deriveStageTimings(events(rows), BASE + 1000 * MIN, undefined, order)
      .timings.filter((run) => run.stage === "alpha")
      .map((run) => run.runId);

  it("keeps numbering a stage before the Target in the same epoch", () => {
    expect(ids(["alpha", "beta"])).toEqual(["0:alpha:1", "0:alpha:2"]);
  });

  it("starts a new epoch for a stage the jump reaches", () => {
    expect(ids(null)).toEqual(["0:alpha:1", "1:alpha:1"]);
    expect(ids(["beta", "alpha"])).toEqual(["0:alpha:1", "1:alpha:1"]);
  });
});

describe("getStageTimings reads the stage order from the record", () => {
  it("keeps a run whose floor predates a jump to a later stage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "run-floor-"));
    try {
      await mkdir(path.join(root, "audit"));
      await writeFile(path.join(root, "aidlc-state.md"), stateWithStages(["alpha", "beta"]));
      const rows: Row[] = [
        ["STAGE_STARTED", 0],
        ["STAGE_JUMPED", 2, null, { Target: "beta" }],
        ["UNIT_COMPLETED", 5, "alpha", unit(floor("STAGE_STARTED", 0))],
        ["STAGE_COMPLETED", 10],
      ];
      await writeFile(
        path.join(root, "audit", "one.md"),
        events(rows)
          .map((event) =>
            [
              "---",
              `**Event**: ${event.event}`,
              `**Timestamp**: ${event.timestamp}`,
              ...(event.stage ? [`**Stage**: ${event.stage}`] : []),
              ...Object.entries(event.fields ?? {}).map(([name, value]) => `**${name}**: ${value}`),
              "",
            ].join("\n"),
          )
          .join(""),
      );
      const { value } = expectOk(await getStageTimings(root, BASE + 1000 * MIN));
      const run = value.find((timing) => timing.stage === "alpha");
      expect(run?.quality?.reasons).not.toContain("observation-scope-mismatch");
      await writeFile(path.join(root, "aidlc-state.md"), "no stage order\n");
      const unknown = expectOk(await getStageTimings(root, BASE + 1000 * MIN)).value;
      expect(unknown.find((timing) => timing.stage === "alpha")?.quality?.reasons).toContain(
        "observation-scope-mismatch",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("recorded workflow 260923-docs-ask-chat (read only)", () => {
  it("uses every Unit-level Construction run as a sample", async () => {
    const record = path.join(REPO_ROOT, "aidlc", "spaces", "default", "intents", "260923-docs-ask-chat");
    const { value } = expectOk(await getStageTimings(record, Date.parse("2026-09-26T00:00:00Z")));
    const unitStages = [
      "functional-design",
      "nfr-requirements",
      "nfr-design",
      "infrastructure-design",
      "code-generation",
      "code-generation",
    ];
    const runs = value.filter((run) => unitStages.includes(run.stage));
    expect(runs.map((run) => run.stage)).toEqual(unitStages);
    for (const run of runs) {
      expect(run.quality?.reasons).not.toContain("observation-scope-mismatch");
      expect(run.quality).toMatchObject({ status: "limited", sampleEligible: true });
    }
  });
});
