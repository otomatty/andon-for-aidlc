import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuditEvent, StageInfo, UnitWalk } from "@andon/shared-types";
import { afterEach, describe, expect, it } from "vitest";
import { deriveUnitWalk, parseUnitWalkOrder, readUnitWalk } from "../src/tree/unit-walk.ts";
import { stage, workflow } from "./timing-fixtures.ts";

const PER_UNIT = [
  "functional-design",
  "nfr-requirements",
  "nfr-design",
  "infrastructure-design",
  "code-generation",
];

function stages(over: Record<string, Partial<StageInfo>> = {}): StageInfo[] {
  return [
    stage("units-generation", { phase: "INCEPTION", status: "completed" }),
    ...PER_UNIT.map((slug) => stage(slug, over[slug])),
    stage("build-and-test", over["build-and-test"]),
  ];
}

let clock = 0;
/** One audit row; rows are timestamped in call order a second apart. */
function ev(event: string, fields: Record<string, string> = {}): AuditEvent {
  clock += 1;
  const timestamp = new Date(Date.UTC(2026, 9, 1, 0, 0, clock)).toISOString();
  return {
    event,
    stage: fields.Stage ?? null,
    timestamp,
    shard: "a.md",
    workflow: fields.Workflow ?? null,
    position: clock,
    fields: { Event: event, Timestamp: timestamp, ...fields },
  };
}

const unit = (name: string, stageSlug: string, event: string): AuditEvent =>
  ev(event, { Stage: stageSlug, Unit: name });

/** `unit` → its step statuses, in per-Unit stage order. */
function grid(walk: UnitWalk): Record<string, string[]> {
  return Object.fromEntries(walk.units.map((u) => [u.unit, u.steps.map((s) => s.status)]));
}

const NS = "not-started";
const IP = "in-progress";
const OK = "completed";
const SK = "skipped";

describe("parseUnitWalkOrder — the engine's walk order (aidlc-lib.ts parseBoltDag)", () => {
  const doc = (yaml: string) => `# Units\n\n\`\`\`mermaid\ngraph TD\n\`\`\`\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;

  it("orders by dependency level, each level sorted by name", () => {
    const body = doc(
      [
        "units:",
        "  - name: web",
        "    kind: ui",
        "    depends_on: [api, auth]",
        "  - name: api",
        "    depends_on:",
        "      - auth",
        "  - name: auth",
        "    depends_on: []",
        "  - name: docs",
        "    depends_on: []",
      ].join("\n"),
    );
    expect(parseUnitWalkOrder(body)).toEqual(["auth", "docs", "api", "web"]);
  });

  it("reads commas and brackets inside quoted dependencies as part of the name", () => {
    const body = doc(
      'units:\n  - name: a\n  - name: b\n  - name: c\n    depends_on: ["a", \'b\'] # note',
    );
    expect(parseUnitWalkOrder(body)).toEqual(["a", "b", "c"]);
  });

  it("reads a quote inside the comment after a closed list as comment text", () => {
    const body = doc("units:\n  - name: a\n  - name: b\n    depends_on: [a] # it's a");
    expect(parseUnitWalkOrder(body)).toEqual(["a", "b"]);
  });

  it("reads a comment after a closed dependency list", () => {
    const body = doc("units:\n  - name: a\n  - name: b\n    depends_on: [a] # note");
    expect(parseUnitWalkOrder(body)).toEqual(["a", "b"]);
  });

  it("reads quoted names and quoted inline dependencies", () => {
    const body = doc(
      ['units:', '  - name: "b"', '    depends_on: ["a"]', "  - name: 'a'", "    depends_on: []"].join(
        "\n",
      ),
    );
    expect(parseUnitWalkOrder(body)).toEqual(["a", "b"]);
  });

  it.each([
    ["no units block", "# Units\n\nprose only\n"],
    ["a cycle", doc("units:\n  - name: a\n    depends_on: [b]\n  - name: b\n    depends_on: [a]")],
    ["an unknown dependency", doc("units:\n  - name: a\n    depends_on: [ghost]")],
    ["a duplicate name", doc("units:\n  - name: a\n  - name: a")],
    ["an invalid name", doc("units:\n  - name: ../a")],
    ["an inline units value", doc("units: [a]")],
    ["an unknown line", doc("units:\n  - name: a\n    owner: me")],
    ["no entries", doc("units:\n")],
    ["a dependency on itself", doc("units:\n  - name: a\n    depends_on: [a]")],
    ["depends_on before a name", doc("units:\n    depends_on: []\n  - name: a")],
    ["names that differ only in case", doc("units:\n  - name: Api\n  - name: api")],
    [
      "a quoted bracket inside a dependency",
      doc('units:\n  - name: a\n  - name: b\n    depends_on: ["ghost]"]'),
    ],
    [
      "a comment after a bare dependency",
      doc("units:\n  - name: a\n  - name: b\n    depends_on: a # note"),
    ],
    ["an unknown kind", doc("units:\n  - name: a\n    kind: widget")],
  ])("refuses %s, as the engine does", (_label, body) => {
    expect(parseUnitWalkOrder(body)).toBeNull();
  });
});

describe("deriveUnitWalk — per-Unit progress from the Unit receipts", () => {
  it("folds start, complete and skip receipts per Unit and stage", () => {
    const events = [
      unit("u1", "functional-design", "UNIT_STARTED"),
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      unit("u1", "nfr-requirements", "UNIT_STARTED"),
      unit("u1", "nfr-requirements", "UNIT_COMPLETED"),
      unit("u1", "nfr-design", "UNIT_SKIPPED"),
      unit("u1", "infrastructure-design", "UNIT_STARTED"),
      unit("u1", "infrastructure-design", "UNIT_COMPLETED"),
      unit("u1", "code-generation", "UNIT_STARTED"),
      unit("u1", "code-generation", "UNIT_COMPLETED"),
      unit("u2", "functional-design", "UNIT_STARTED"),
      unit("u2", "functional-design", "UNIT_PAUSED"),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1", "u2", "u3"], events);
    expect(walk.stages).toEqual(PER_UNIT);
    expect(grid(walk)).toEqual({
      u1: [OK, OK, SK, OK, OK],
      u2: [IP, NS, NS, NS, NS],
      u3: [NS, NS, NS, NS, NS],
    });
    expect(walk.units.map((u) => u.status)).toEqual([OK, IP, NS]);
    expect(walk.byStage[0]).toEqual({
      stage: "functional-design",
      completed: 1,
      skipped: 0,
      total: 3,
    });
    expect(walk.byStage[2]).toEqual({ stage: "nfr-design", completed: 0, skipped: 1, total: 3 });
  });

  it("reads a stage a Unit passed without a receipt as not owed", () => {
    // A `spec` Unit owes nothing for nfr-design: the engine walks it straight on.
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      unit("u1", "code-generation", "UNIT_STARTED"),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events);
    expect(grid(walk).u1).toEqual([OK, SK, SK, SK, IP]);
  });

  it("puts the state file's open Unit on its own step", () => {
    const walk = deriveUnitWalk(
      workflow({
        stages: stages(),
        activeUnit: { unit: "u2", stage: "nfr-design", state: "paused" },
      }),
      ["u1", "u2"],
      [unit("u2", "functional-design", "UNIT_COMPLETED"), unit("u2", "nfr-requirements", "UNIT_COMPLETED")],
    );
    expect(grid(walk).u2).toEqual([OK, OK, IP, NS, NS]);
  });

  it("drops an open Unit whose step a reopen or jump started over", () => {
    // aidlc-jump.ts clears the Active Unit fields in the state write after its
    // audit row; a cache that survived a failed write names the old step.
    const activeUnit = { unit: "u1", stage: "functional-design", state: "in-progress" as const };
    const cached = workflow({ stages: stages(), activeUnit });
    for (const boundary of [
      () => ev("GATE_REJECTED", { Stage: "functional-design", Unit: "u1" }),
      () => ev("STAGE_JUMPED", { Target: "functional-design" }),
    ]) {
      const started = unit("u1", "functional-design", "UNIT_STARTED");
      const walk = deriveUnitWalk(cached, ["u1"], [started, boundary()]);
      expect(walk.activeUnit).toBeNull();
      expect(grid(walk).u1?.[0]).toBe(NS);
    }
  });

  it("ignores an open Unit outside the DAG or on a stage that is not per-Unit", () => {
    const base = workflow({ stages: stages() });
    for (const activeUnit of [
      { unit: "ghost", stage: "code-generation", state: "in-progress" as const },
      { unit: "u1", stage: "build-and-test", state: "in-progress" as const },
      { unit: "u1", stage: null, state: "in-progress" as const },
    ]) {
      const walk = deriveUnitWalk({ ...base, activeUnit }, ["u1"], []);
      expect(grid(walk).u1).toEqual([NS, NS, NS, NS, NS]);
      // Only a Unit of this walk on one of its steps (or between steps) is open.
      expect(walk.activeUnit).toEqual(activeUnit.stage === null ? activeUnit : null);
    }
  });

  it("marks every Unit of a stage the workflow skips", () => {
    const walk = deriveUnitWalk(
      workflow({ stages: stages({ "infrastructure-design": { execution: "SKIP", status: "skipped" } }) }),
      ["u1", "u2"],
      [],
    );
    expect(grid(walk)).toEqual({ u1: [NS, NS, NS, SK, NS], u2: [NS, NS, NS, SK, NS] });
  });

  it("reads a finished stage without Unit receipts as done for every Unit", () => {
    // Records from before Unit receipts tick the stage box only.
    const walk = deriveUnitWalk(
      workflow({ stages: stages({ "functional-design": { status: "completed" } }) }),
      ["u1", "u2"],
      [],
    );
    expect(grid(walk)).toEqual({ u1: [OK, NS, NS, NS, NS], u2: [OK, NS, NS, NS, NS] });
    expect(walk.byStage[0]?.completed).toBe(2);
  });

  it("reopens the named Unit's steps on its reopen rejection", () => {
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      unit("u1", "nfr-requirements", "UNIT_COMPLETED"),
      unit("u2", "functional-design", "UNIT_COMPLETED"),
      ev("GATE_REJECTED", {
        Stage: "functional-design",
        Unit: "u1",
        "Gate Stages": "functional-design, nfr-requirements",
        "Gate Scope": "unit-end",
      }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1", "u2"], events);
    expect(grid(walk)).toEqual({ u1: [NS, NS, NS, NS, NS], u2: [OK, NS, NS, NS, NS] });
  });

  it("resets every Unit from a jump's target on, and everything on a new workflow", () => {
    const done = PER_UNIT.map((slug) => unit("u1", slug, "UNIT_COMPLETED"));
    const order = stages();
    const jumped = deriveUnitWalk(workflow({ stages: order }), ["u1"], [
      ...done,
      ev("STAGE_JUMPED", { Target: "nfr-design" }),
    ]);
    expect(grid(jumped).u1).toEqual([OK, OK, NS, NS, NS]);
    const restarted = deriveUnitWalk(workflow({ stages: order }), ["u1"], [
      ...done,
      ev("WORKFLOW_STARTED"),
    ]);
    expect(grid(restarted).u1).toEqual([NS, NS, NS, NS, NS]);
  });

  it("keeps a Unit open after its checkpoint is rejected, and closes it on approval", () => {
    const done = PER_UNIT.map((slug) => unit("u1", slug, "UNIT_COMPLETED"));
    const checkpoint = (event: string) =>
      ev(event, { Stage: "code-generation", Unit: "u1", Checkpoint: "construction-unit" });
    const rejected = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      ...done,
      checkpoint("GATE_REJECTED"),
    ]);
    // The rejection is an attempt boundary for its stage (run-floor.ts).
    expect(rejected.units[0]?.status).toBe(IP);
    expect(grid(rejected).u1).toEqual([OK, OK, OK, OK, NS]);
    const approved = deriveUnitWalk(workflow({ stages: stages() }), ["u1", "u2"], [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      checkpoint("GATE_APPROVED"),
    ]);
    // The approved Unit owed none of the stages it has no receipt for.
    expect(grid(approved).u1).toEqual([OK, SK, SK, SK, SK]);
    expect(approved.units[0]?.status).toBe(OK);
  });

  it("keeps a reopened step open even though the Unit has later progress", () => {
    // aidlc-jump.ts reopens only the named steps; the Unit's later ones stand.
    const events = [
      ...PER_UNIT.map((slug) => unit("u1", slug, "UNIT_COMPLETED")),
      ev("GATE_APPROVED", { Stage: "code-generation", Unit: "u1", Checkpoint: "construction-unit" }),
      ev("GATE_REJECTED", {
        Stage: "functional-design",
        Unit: "u1",
        "Gate Stages": "functional-design",
        "Gate Scope": "unit-end",
      }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events);
    expect(grid(walk).u1).toEqual([NS, OK, OK, OK, OK]);
    expect(walk.units[0]?.status).toBe(IP);
    const redone = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      ...events,
      unit("u1", "functional-design", "UNIT_COMPLETED"),
    ]);
    expect(grid(redone).u1).toEqual([OK, OK, OK, OK, OK]);
  });

  it("starts the rejected stages over for every Unit on a stage gate's Request Changes", () => {
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      unit("u2", "functional-design", "UNIT_COMPLETED"),
      unit("u1", "nfr-requirements", "UNIT_COMPLETED"),
      ev("GATE_REJECTED", { Stage: "functional-design" }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1", "u2"], events);
    // u1's later receipt does not make the rejected step "not owed".
    expect(grid(walk)).toEqual({ u1: [NS, OK, NS, NS, NS], u2: [NS, NS, NS, NS, NS] });
  });

  it("starts a stage over for every Unit when stage-major starts it again", () => {
    const events = [
      ev("STAGE_STARTED", { Stage: "functional-design" }),
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events);
    expect(grid(walk).u1).toEqual([NS, NS, NS, NS, NS]);
  });

  it("keeps finished Units when a stage starts under unit-major", () => {
    // unit-major starts the later per-Unit stages only for their late gates.
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      unit("u1", "nfr-requirements", "UNIT_COMPLETED"),
      ev("STAGE_STARTED", { Stage: "nfr-requirements" }),
    ];
    const unitMajor = workflow({
      stages: stages(),
      constructionPolicy: {
        checkpoints: false,
        unitMajor: true,
        iterationRecorded: true,
        swarm: false,
        autonomous: false,
        teamOwnership: false,
        unitEndRhythm: false,
        skeletonStanceRecorded: false,
        skeletonMayRun: false,
      },
    });
    expect(grid(deriveUnitWalk(unitMajor, ["u1"], events)).u1).toEqual([OK, OK, NS, NS, NS]);
  });

  it("does not let a ticked box finish a step a jump started over", () => {
    // aidlc-jump.ts appends STAGE_JUMPED before it writes the state file; if
    // that write fails, the boxes it would have cleared are still ticked.
    const ticked = stages({ "functional-design": { status: "completed" } });
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      ev("STAGE_JUMPED", { Target: "functional-design" }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: ticked }), ["u1"], events);
    expect(grid(walk).u1?.[0]).toBe(NS);
    // The stage's own approval after the jump vouches for the box again.
    events.push(ev("GATE_APPROVED", { Stage: "functional-design" }));
    const approved = deriveUnitWalk(workflow({ stages: ticked }), ["u1"], events);
    expect(grid(approved).u1?.[0]).toBe(OK);
  });

  it("does not let a skipped mark a jump or reopen would have cleared skip the stage", () => {
    // aidlc-jump.ts resets `[S]` boxes on a backward jump, after its audit row.
    const stale = stages({ "functional-design": { status: "skipped" } });
    const walk = deriveUnitWalk(workflow({ stages: stale }), ["u1"], [
      ev("STAGE_JUMPED", { Target: "functional-design" }),
    ]);
    expect(grid(walk).u1?.[0]).toBe(NS);
    // A stage the workflow does not execute at all stays out of scope.
    const notRun = stages({ "functional-design": { status: "skipped", execution: "SKIP" } });
    const skipped = deriveUnitWalk(workflow({ stages: notRun }), ["u1"], [
      ev("STAGE_JUMPED", { Target: "functional-design" }),
    ]);
    expect(grid(skipped).u1?.[0]).toBe(SK);
    // A Unit's own reopen, appended before its state write, counts the same.
    const reopened = deriveUnitWalk(workflow({ stages: stale }), ["u1"], [
      ev("GATE_REJECTED", { Stage: "functional-design", Unit: "u1" }),
    ]);
    expect(grid(reopened).u1?.[0]).toBe(NS);
  });

  it("derives a long ledger without rebuilding its history per receipt", () => {
    // 20,000 serial receipts once took ~20s here, past the dashboard's timeout.
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const floor = `STAGE_STARTED:${started.timestamp}#1`;
    const names = Array.from({ length: 50 }, (_, i) => `u${i}`);
    const events = [started];
    for (let i = 0; i < 20_000; i++)
      events.push(
        ev(i % 2 === 0 ? "UNIT_STARTED" : "UNIT_COMPLETED", {
          Stage: "functional-design",
          Unit: names[Math.floor(i / 2) % 50] as string,
          "Run floor": floor,
        }),
      );
    const walk = deriveUnitWalk(workflow({ stages: stages() }), names, events);
    expect(walk.byStage[0]?.completed).toBe(50);
  });

  it("keeps finished Units on a stage start while checkpoints are on, even under stage-major", () => {
    // aidlc-lib.ts `unitLifecycleSnapshot`: unit-major iteration or enabled
    // checkpoints both floor Unit receipts per Unit, not per stage start.
    const checkpoints = workflow({
      stages: stages(),
      constructionPolicy: {
        checkpoints: true,
        unitMajor: false,
        iterationRecorded: true,
        swarm: false,
        autonomous: false,
        teamOwnership: false,
        unitEndRhythm: false,
        skeletonStanceRecorded: false,
        skeletonMayRun: false,
      },
    });
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
    ];
    expect(grid(deriveUnitWalk(checkpoints, ["u1"], events)).u1?.[0]).toBe(OK);
    // A recorded switch turning checkpoints off brings the stage-start reset back.
    const switched = [
      ev("STAGE_STARTED", { Stage: "functional-design" }),
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Checkpoints",
        Value: "disabled",
        "Previous Value": "enabled",
        "Construction Iteration": "stage-major",
        "Construction Checkpoints": "enabled",
      }),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
    ];
    expect(grid(deriveUnitWalk(workflow({ stages: stages() }), ["u1"], switched)).u1?.[0]).toBe(NS);
  });

  it("forgets a Unit's checkpoint approval when stage-major starts a stage over", () => {
    const events = [
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Checkpoints",
        Value: "enabled",
        "Previous Value": "disabled",
        "Construction Iteration": "stage-major",
        "Construction Checkpoints": "disabled",
      }),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      ev("GATE_APPROVED", { Stage: "code-generation", Unit: "u1", Checkpoint: "construction-unit" }),
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Checkpoints",
        Value: "disabled",
        "Previous Value": "enabled",
        "Construction Iteration": "stage-major",
        "Construction Checkpoints": "enabled",
      }),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events);
    expect(grid(walk).u1).toEqual([NS, NS, NS, NS, NS]);
    expect(walk.units[0]?.status).toBe(NS);
  });

  it("takes the current flooring from the state file, not the last policy row", () => {
    // aidlc-lib.ts `unitLifecycleSnapshot` reads the state file; a policy row
    // whose state write never landed only places the starts before it.
    const events = [
      ev("STAGE_STARTED", { Stage: "functional-design" }),
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Iteration",
        Value: "unit-major",
        "Previous Value": "stage-major",
        "Construction Iteration": "stage-major",
        "Construction Checkpoints": "disabled",
      }),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
    ];
    expect(grid(deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events)).u1?.[0]).toBe(NS);
  });

  it("checks receipts only under the state file's current mode", () => {
    // aidlc-lib.ts `currentUnitLifecycleRows` floors receipts under the mode
    // the state file holds now, never under either mode.
    const policy = (from: string, to: string) =>
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Iteration",
        Value: to,
        "Previous Value": from,
        "Construction Iteration": from,
        "Construction Checkpoints": "disabled",
      });
    const first = ev("STAGE_STARTED", { Stage: "functional-design" });
    const floor = `STAGE_STARTED:${first.timestamp}#1`;
    const done = () =>
      ev("UNIT_COMPLETED", { Stage: "functional-design", Unit: "u1", "Run floor": floor });
    const events = [
      first,
      policy("stage-major", "unit-major"),
      done(),
      policy("unit-major", "stage-major"),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
      // A stale worker's receipt from before that restart.
      done(),
    ];
    expect(grid(deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events)).u1?.[0]).toBe(NS);
  });

  it("places a receipt's stage start with policy rows written after the receipt", () => {
    // The engine classifies starts against the whole ledger: a later switch to
    // unit-major shows this start was written under stage-major flooring.
    const unitMajorNow = workflow({
      stages: stages(),
      constructionPolicy: {
        checkpoints: false,
        unitMajor: true,
        iterationRecorded: true,
        swarm: false,
        autonomous: false,
        teamOwnership: false,
        unitEndRhythm: false,
        skeletonStanceRecorded: false,
        skeletonMayRun: false,
      },
    });
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const events = [
      started,
      ev("UNIT_COMPLETED", {
        Stage: "functional-design",
        Unit: "u1",
        "Run floor": `STAGE_STARTED:${started.timestamp}#1`,
      }),
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Iteration",
        Value: "unit-major",
        "Previous Value": "stage-major",
        "Construction Iteration": "stage-major",
        "Construction Checkpoints": "disabled",
      }),
    ];
    expect(grid(deriveUnitWalk(unitMajorNow, ["u1"], events)).u1?.[0]).toBe(OK);
  });

  it("ignores a policy change row the engine would not count as complete", () => {
    // aidlc-lib.ts `constructionPolicyRowComplete`: an interrupted row is not a change.
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      ev("CONSTRUCTION_POLICY_SET", { Field: "Construction Iteration", Value: "unit-major" }),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
    ];
    expect(grid(deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events)).u1?.[0]).toBe(NS);
  });

  it("keeps a finished step finished when the Active Unit cache lags behind it", () => {
    // The receipt is the source of truth; the state file is only a cache.
    const walk = deriveUnitWalk(
      workflow({
        stages: stages(),
        activeUnit: { unit: "u1", stage: "functional-design", state: "in-progress" },
      }),
      ["u1"],
      [unit("u1", "functional-design", "UNIT_COMPLETED")],
    );
    expect(grid(walk).u1?.[0]).toBe(OK);
    // Nor is the Unit still open: its receipt closed it after the cache was written.
    expect(walk.activeUnit).toBeNull();
  });

  it("judges each stage start by the iteration in force when it was written", () => {
    // Recorded stage-major first, switched to unit-major, then started again.
    const policy = (from: string, to: string) =>
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Iteration",
        Value: to,
        "Previous Value": from,
        "Construction Iteration": from,
        "Construction Checkpoints": "disabled",
      });
    const events = [
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      policy("stage-major", "unit-major"),
      ev("STAGE_STARTED", { Stage: "functional-design" }),
      unit("u2", "functional-design", "UNIT_COMPLETED"),
      policy("unit-major", "stage-major"),
      ev("STAGE_STARTED", { Stage: "nfr-requirements" }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1", "u2"], events);
    expect(grid(walk).u1?.[0]).toBe(OK);
    expect(grid(walk).u2?.[0]).toBe(OK);
  });

  it("keeps a later stage's Units on its first start after switching back to stage-major", () => {
    // aidlc-lib.ts `stageStartsUnderUnitFlooring`: unit-major finished the
    // stage's Units before it ever started; that first start opens its late
    // gate, not a new attempt.
    const policy = (from: string, to: string) =>
      ev("CONSTRUCTION_POLICY_SET", {
        Field: "Construction Iteration",
        Value: to,
        "Previous Value": from,
        "Construction Iteration": from,
        "Construction Checkpoints": "disabled",
      });
    const events = [
      policy("stage-major", "unit-major"),
      unit("u1", "functional-design", "UNIT_COMPLETED"),
      unit("u1", "nfr-requirements", "UNIT_COMPLETED"),
      policy("unit-major", "stage-major"),
      ev("STAGE_STARTED", { Stage: "nfr-requirements" }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events);
    expect(grid(walk).u1?.slice(0, 2)).toEqual([OK, OK]);
    // A second start of that stage is a new attempt again.
    events.push(ev("STAGE_STARTED", { Stage: "nfr-requirements" }));
    const again = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events);
    expect(grid(again).u1?.slice(0, 2)).toEqual([OK, NS]);
  });

  it("does not count a stage the workflow skips as a Unit's start", () => {
    const walk = deriveUnitWalk(
      workflow({ stages: stages({ "nfr-design": { execution: "SKIP", status: "skipped" } }) }),
      ["u1"],
      [],
    );
    expect(walk.units[0]?.status).toBe(NS);
  });

  it("reads a Unit owed nothing at all as skipped", () => {
    const skip = { execution: "SKIP" as const, status: "skipped" as const };
    const allSkipped = Object.fromEntries(PER_UNIT.map((slug) => [slug, skip]));
    const walk = deriveUnitWalk(workflow({ stages: stages(allSkipped) }), ["u1"], []);
    expect(walk.units[0]?.status).toBe(SK);
  });

  it("keeps the open Unit it was derived with, so a surface can pair them", () => {
    const activeUnit = { unit: "u1", stage: "nfr-design", state: "in-progress" as const };
    expect(deriveUnitWalk(workflow({ stages: stages(), activeUnit }), ["u1"], []).activeUnit).toEqual(
      activeUnit,
    );
    expect(deriveUnitWalk(workflow({ stages: stages() }), ["u1"], []).activeUnit).toBeNull();
  });

  it("drops a receipt stamped with an attempt a later boundary superseded", () => {
    // A stale worker finishing after the stage gate's Request Changes.
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const first = `STAGE_STARTED:${started.timestamp}#1`;
    const events = [
      started,
      ev("UNIT_COMPLETED", { Stage: "functional-design", Unit: "u1", "Run floor": first }),
    ];
    const rejected = ev("GATE_REJECTED", { Stage: "functional-design" });
    events.push(
      rejected,
      ev("UNIT_COMPLETED", { Stage: "functional-design", Unit: "u1", "Run floor": first }),
      ev("UNIT_COMPLETED", {
        Stage: "functional-design",
        Unit: "u2",
        "Run floor": `GATE_REJECTED:${rejected.timestamp}#1`,
      }),
    );
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1", "u2"], events);
    expect(grid(walk).u1?.[0]).toBe(NS);
    expect(grid(walk).u2?.[0]).toBe(OK);
  });

  it("drops a late receipt from before the Unit's own reopen", () => {
    // aidlc-lib.ts `unitLifecycleRunFloorForProject`: a Unit with its own
    // rejection is floored on that Unit, never on the stage alone.
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const first = `STAGE_STARTED:${started.timestamp}#1`;
    const before = [
      started,
      ev("UNIT_COMPLETED", { Stage: "functional-design", Unit: "u1", "Run floor": first }),
      ev("GATE_REJECTED", { Stage: "functional-design", Unit: "u1" }),
    ];
    const reopened = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], before);
    const late = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      ...before,
      ev("UNIT_COMPLETED", { Stage: "functional-design", Unit: "u1", "Run floor": first }),
    ]);
    expect(grid(late).u1?.[0]).toBe(grid(reopened).u1?.[0]);
    expect(grid(late).u1?.[0]).not.toBe(OK);
  });

  it("keeps a Unit open when two clones' receipts share one second", () => {
    // Cross-shard rows in one second are unordered (aidlc-lib.ts
    // `currentUnitLifecycleRows`): a possible pause or start outranks a finish.
    const at = "2026-10-01T09:00:00.000Z";
    const row = (event: string, shard: string): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp: at,
      shard,
      workflow: null,
      position: 1,
      fields: { Event: event, Stage: "functional-design", Unit: "u1" },
    });
    const open = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      row("UNIT_PAUSED", "a.md"),
      row("UNIT_COMPLETED", "b.md"),
    ]);
    expect(grid(open).u1?.[0]).toBe(IP);
    const settled = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      row("UNIT_COMPLETED", "a.md"),
      row("UNIT_COMPLETED", "b.md"),
    ]);
    expect(grid(settled).u1?.[0]).toBe(OK);
  });

  it("drops stale receipts before resolving one second's receipts across clones", () => {
    // An old-attempt pause must not outrank the current attempt's finish.
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const rejected = ev("GATE_REJECTED", { Stage: "functional-design" });
    const at = new Date(Date.parse(rejected.timestamp) + 60_000).toISOString();
    const row = (event: string, shard: string, floor: string): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp: at,
      shard,
      workflow: null,
      position: 1,
      fields: { Event: event, Stage: "functional-design", Unit: "u1", "Run floor": floor },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      started,
      rejected,
      row("UNIT_PAUSED", "a.md", `STAGE_STARTED:${started.timestamp}#1`),
      row("UNIT_COMPLETED", "b.md", `GATE_REJECTED:${rejected.timestamp}#1`),
    ]);
    expect(grid(walk).u1?.[0]).toBe(OK);
  });

  it("keeps a receipt whose Run floor names a rejection another clone wrote in the same second", () => {
    // The floor is resolved against the whole ledger: a same-second boundary in
    // a shard that sorts later still precedes the receipt that names it.
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const done = ev("UNIT_COMPLETED", {
      Stage: "functional-design",
      Unit: "u1",
      "Run floor": `STAGE_STARTED:${started.timestamp}#1`,
    });
    const at = new Date(Date.parse(done.timestamp) + 60_000).toISOString();
    const row = (event: string, shard: string, fields: Record<string, string>): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp: at,
      shard,
      workflow: null,
      position: 1,
      fields: { Event: event, Stage: "functional-design", Unit: "u1", ...fields },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      started,
      done,
      row("UNIT_COMPLETED", "a.md", { "Run floor": `GATE_REJECTED:${at}#1` }),
      row("GATE_REJECTED", "b.md", {}),
    ]);
    expect(grid(walk).u1?.[0]).toBe(OK);
  });

  it("waits for a same-second boundary that sits behind another row in its shard", () => {
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const done = ev("UNIT_COMPLETED", {
      Stage: "functional-design",
      Unit: "u1",
      "Run floor": `STAGE_STARTED:${started.timestamp}#1`,
    });
    const at = new Date(Date.parse(done.timestamp) + 60_000).toISOString();
    const row = (
      event: string,
      shard: string,
      position: number,
      fields: Record<string, string>,
    ): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp: at,
      shard,
      workflow: null,
      position,
      fields: { Event: event, Stage: "functional-design", ...fields },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      started,
      done,
      row("UNIT_COMPLETED", "a.md", 1, { Unit: "u1", "Run floor": `GATE_REJECTED:${at}#1` }),
      row("SENSOR_FIRED", "b.md", 1, {}),
      row("GATE_REJECTED", "b.md", 2, { Unit: "u1" }),
    ]);
    expect(grid(walk).u1?.[0]).toBe(OK);
  });

  it("checks a receipt against every boundary of its second, past other receipts", () => {
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const first = `STAGE_STARTED:${started.timestamp}#1`;
    const done = ev("UNIT_COMPLETED", { Stage: "functional-design", Unit: "u1", "Run floor": first });
    const at = new Date(Date.parse(done.timestamp) + 60_000).toISOString();
    const row = (
      event: string,
      shard: string,
      position: number,
      fields: Record<string, string>,
    ): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp: at,
      shard,
      workflow: null,
      position,
      fields: { Event: event, Stage: "functional-design", Unit: "u1", ...fields },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      started,
      done,
      row("UNIT_COMPLETED", "a.md", 1, { "Run floor": `GATE_REJECTED:${at}#1` }),
      row("UNIT_PAUSED", "b.md", 1, { "Run floor": first }),
      row("GATE_REJECTED", "b.md", 2, {}),
    ]);
    expect(grid(walk).u1?.[0]).toBe(OK);
  });

  it("keeps a floorless receipt before the rejection its shard wrote after it", () => {
    // Only a receipt the floor check placed is known to follow its second's
    // boundaries; one without a Run floor keeps its append order.
    const at = new Date(Date.UTC(2026, 9, 3)).toISOString();
    const row = (event: string, position: number): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp: at,
      shard: "a.md",
      workflow: null,
      position,
      fields: { Event: event, Stage: "functional-design", Unit: "u1" },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      row("UNIT_COMPLETED", 1),
      row("GATE_REJECTED", 2),
    ]);
    expect(grid(walk).u1?.[0]).not.toBe(OK);
  });

  it("drops a receipt its own shard superseded within the same second", () => {
    const started = ev("STAGE_STARTED", { Stage: "functional-design" });
    const at = new Date(Date.parse(started.timestamp) + 60_000).toISOString();
    const row = (event: string, position: number, fields: Record<string, string>): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp: at,
      shard: "a.md",
      workflow: null,
      position,
      fields: { Event: event, Stage: "functional-design", ...fields },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      started,
      row("UNIT_COMPLETED", 1, { Unit: "u1", "Run floor": `STAGE_STARTED:${started.timestamp}#1` }),
      row("GATE_REJECTED", 2, {}),
    ]);
    expect(grid(walk).u1?.[0]).toBe(NS);
  });

  it("counts a stage start tied with a policy switch in another shard as a restart", () => {
    // aidlc-lib.ts `stageStartsUnderUnitFlooring`: a start the switch may
    // follow is not one unit-major flooring is sure to have written.
    const toUnit = ev("CONSTRUCTION_POLICY_SET", {
      Field: "Construction Iteration",
      Value: "unit-major",
      "Previous Value": "stage-major",
      "Construction Iteration": "stage-major",
      "Construction Checkpoints": "disabled",
    });
    const done = ev("UNIT_COMPLETED", { Stage: "functional-design", Unit: "u1" });
    const at = new Date(Date.parse(done.timestamp) + 60_000).toISOString();
    const row = (event: string, shard: string, fields: Record<string, string>): AuditEvent => ({
      event,
      stage: fields.Stage ?? null,
      timestamp: at,
      shard,
      workflow: null,
      position: 1,
      fields: { Event: event, ...fields },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      ev("STAGE_STARTED", { Stage: "functional-design" }),
      toUnit,
      done,
      row("CONSTRUCTION_POLICY_SET", "a.md", {
        Field: "Construction Iteration",
        Value: "stage-major",
        "Previous Value": "unit-major",
        "Construction Iteration": "unit-major",
        "Construction Checkpoints": "disabled",
      }),
      row("STAGE_STARTED", "b.md", { Stage: "functional-design" }),
    ]);
    expect(grid(walk).u1?.[0]).toBe(NS);
  });

  it("accepts the engine's ambiguous Run floor when two clones start a stage in one second", () => {
    // aidlc-lib.ts `latestMainWorkflowStageRunFloorFromRows`: tied boundaries in
    // different shards give `AMBIGUOUS:<timestamp>#<digest>`.
    const at = new Date(Date.UTC(2026, 9, 2)).toISOString();
    const later = new Date(Date.UTC(2026, 9, 2, 0, 1)).toISOString();
    const row = (
      event: string,
      shard: string,
      timestamp: string,
      fields: Record<string, string> = {},
    ): AuditEvent => ({
      event,
      stage: "functional-design",
      timestamp,
      shard,
      workflow: null,
      position: 1,
      fields: { Event: event, Stage: "functional-design", ...fields },
    });
    const starts = [row("STAGE_STARTED", "a.md", at), row("STAGE_STARTED", "b.md", at)];
    const receipt = (floor: string) =>
      row("UNIT_COMPLETED", "a.md", later, { Unit: "u1", "Run floor": floor });
    const current = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      ...starts,
      receipt(`AMBIGUOUS:${at}#0123456789ab`),
    ]);
    expect(grid(current).u1?.[0]).toBe(OK);
    // An ambiguous floor from another second is an older attempt.
    const stale = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      ...starts,
      receipt("AMBIGUOUS:2026-10-01T00:00:00.000Z#0123456789ab"),
    ]);
    expect(grid(stale).u1?.[0]).toBe(NS);
  });

  it("counts a swarm Unit converged as finished with its stage", () => {
    // aidlc-lib.ts `swarmConvergedUnits`: the swarm's per-Unit completion,
    // which fails closed without a Run floor.
    const started = ev("STAGE_STARTED", { Stage: "code-generation" });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1", "u2"], [
      started,
      ev("SWARM_UNIT_CONVERGED", {
        Stage: "code-generation",
        "Unit name": "u1",
        "Run floor": `STAGE_STARTED:${started.timestamp}#1`,
      }),
      ev("SWARM_UNIT_CONVERGED", { Stage: "code-generation", "Unit name": "u2" }),
    ]);
    expect(grid(walk).u1?.[4]).toBe(OK);
    expect(grid(walk).u2?.[4]).toBe(NS);
  });

  it("checks a swarm convergence against the stage-scoped floor it carries", () => {
    // The swarm stamps `latestMainWorkflowStageRunFloorForProject(stage)`,
    // whatever the state file's mode; only Unit lifecycle rows follow that mode.
    const checkpoints = workflow({
      stages: stages(),
      constructionPolicy: {
        checkpoints: true,
        unitMajor: false,
        iterationRecorded: true,
        swarm: true,
        autonomous: false,
        teamOwnership: false,
        unitEndRhythm: false,
        skeletonStanceRecorded: false,
        skeletonMayRun: false,
      },
    });
    const started = ev("STAGE_STARTED", { Stage: "code-generation" });
    const walk = deriveUnitWalk(checkpoints, ["u1"], [
      started,
      ev("SWARM_UNIT_CONVERGED", {
        Stage: "code-generation",
        "Unit name": "u1",
        "Run floor": `STAGE_STARTED:${started.timestamp}#1`,
      }),
    ]);
    expect(grid(walk).u1?.[4]).toBe(OK);
  });

  it("keeps a Unit reopened when its rejection and a swarm convergence share a second", () => {
    // aidlc-lib.ts `swarmConvergedUnits`: the convergence counts only after a
    // rejection that is plainly before it; clones' rows in one second are not.
    const started = ev("STAGE_STARTED", { Stage: "code-generation" });
    const at = new Date(Date.parse(started.timestamp) + 60_000).toISOString();
    const row = (event: string, shard: string, fields: Record<string, string>): AuditEvent => ({
      event,
      stage: "code-generation",
      timestamp: at,
      shard,
      workflow: null,
      position: 1,
      fields: { Event: event, Stage: "code-generation", ...fields },
    });
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [
      started,
      row("SWARM_UNIT_CONVERGED", "a.md", {
        "Unit name": "u1",
        "Run floor": `STAGE_STARTED:${started.timestamp}#1`,
      }),
      row("GATE_REJECTED", "b.md", { Unit: "u1" }),
    ]);
    expect(grid(walk).u1?.[4]).not.toBe(OK);
  });

  it("orders receipts by time, not by array position", () => {
    const started = unit("u1", "functional-design", "UNIT_STARTED");
    const completed = unit("u1", "functional-design", "UNIT_COMPLETED");
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], [completed, started]);
    expect(grid(walk).u1?.[0]).toBe(OK);
  });

  it("ignores single-stage runs, Units outside the DAG and stages that are not per-Unit", () => {
    const events = [
      ev("UNIT_COMPLETED", {
        Stage: "functional-design",
        Unit: "u1",
        Workflow: "single-stage:functional-design",
      }),
      unit("ghost", "functional-design", "UNIT_COMPLETED"),
      unit("u1", "build-and-test", "UNIT_COMPLETED"),
      ev("UNIT_COMPLETED", { Unit: "u1" }),
    ];
    const walk = deriveUnitWalk(workflow({ stages: stages() }), ["u1"], events);
    expect(grid(walk)).toEqual({ u1: [NS, NS, NS, NS, NS] });
  });

  it("covers only the per-Unit stages this workflow has", () => {
    const only = [stage("functional-design"), stage("code-generation"), stage("build-and-test")];
    const walk = deriveUnitWalk(workflow({ stages: only }), ["u1"], []);
    expect(walk.stages).toEqual(["functional-design", "code-generation"]);
  });
});

describe("readUnitWalk — the record's Unit DAG", () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir !== null) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  async function record(dag: string | null): Promise<string> {
    dir = await mkdtemp(path.join(tmpdir(), "unit-walk-"));
    if (dag !== null) {
      const at = path.join(dir, "inception", "units-generation");
      await mkdir(at, { recursive: true });
      await writeFile(path.join(at, "unit-of-work-dependency.md"), dag);
    }
    return dir;
  }

  const none = async () => ({ ok: true as const, value: [] });
  const DAG = "```yaml\nunits:\n  - name: b\n    depends_on: [a]\n  - name: a\n    depends_on: []\n```\n";

  it("walks the Units the DAG names, in its order", async () => {
    const walk = await readUnitWalk(await record(DAG), workflow({ stages: stages() }), none);
    expect(walk?.units.map((u) => u.unit)).toEqual(["a", "b"]);
  });

  it("is null without a DAG, with an unreadable one, or without per-Unit stages", async () => {
    expect(await readUnitWalk(await record(null), workflow({ stages: stages() }), none)).toBeNull();
    await rm(dir as string, { recursive: true, force: true });
    expect(
      await readUnitWalk(await record("no block"), workflow({ stages: stages() }), none),
    ).toBeNull();
    await rm(dir as string, { recursive: true, force: true });
    const noUnitStages = [stage("build-and-test")];
    expect(await readUnitWalk(await record(DAG), workflow({ stages: noUnitStages }), none)).toBeNull();
  });

  it("walks Units only when Units Generation is planned or already ran", async () => {
    // aidlc-lib.ts `usesStageLevelPerUnitArtifacts`: otherwise Construction
    // runs once at stage level, whatever DAG file is left over.
    const withUnitsGeneration = (over: Partial<StageInfo>) => [
      stage("units-generation", { phase: "INCEPTION", ...over }),
      ...stages().slice(1),
    ];
    const skipped = workflow({
      stages: withUnitsGeneration({ execution: "SKIP", status: "skipped" }),
    });
    expect(await readUnitWalk(await record(DAG), skipped, none)).toBeNull();
    await rm(dir as string, { recursive: true, force: true });
    const ranBefore = workflow({
      stages: withUnitsGeneration({ execution: "SKIP", status: "completed" }),
    });
    expect((await readUnitWalk(await record(DAG), ranBefore, none))?.units).toHaveLength(2);
  });

  it.each([
    "malformed audit blocks ignored: a-clone.md",
    "conflicting audit field: a-clone.md (Unit)",
  ])("shows nothing when the audit log dropped a block: %s", async (warning) => {
    const dropped = async () => ({ ok: true as const, value: [], warnings: [warning] });
    expect(await readUnitWalk(await record(DAG), workflow({ stages: stages() }), dropped)).toBeNull();
  });

  it("shows nothing when an audit shard could not be read", async () => {
    // Its Unit receipts are missing, so the rest would misstate the progress.
    const partial = async () => ({
      ok: true as const,
      value: [],
      warnings: ["audit shard skipped: b-clone.md (file-too-large)"],
    });
    expect(await readUnitWalk(await record(DAG), workflow({ stages: stages() }), partial)).toBeNull();
  });

  it("reads the audit log only for a record with a DAG, and shows nothing when it is unreadable", async () => {
    let reads = 0;
    const counted = async () => {
      reads += 1;
      return { ok: true as const, value: [] };
    };
    await readUnitWalk(await record(null), workflow({ stages: stages() }), counted);
    expect(reads).toBe(0);
    await rm(dir as string, { recursive: true, force: true });
    const unreadable = async () => ({ error: true as const, reason: "state-unreadable" as const });
    expect(await readUnitWalk(await record(DAG), workflow({ stages: stages() }), unreadable)).toBeNull();
  });
});
