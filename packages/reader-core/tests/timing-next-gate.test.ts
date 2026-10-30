import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuditEvent,
  ConstructionGatePolicy,
  NextGateEstimate,
  StageInfo,
  StageStatus,
  StageTiming,
} from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import {
  estimateNextGate,
  PER_UNIT_STAGES,
  SOURCE_STAGE,
  skeletonCheckpointCleared,
  UNITS_STAGE,
} from "../src/timing/next-gate.ts";
import { resolveStageViews } from "../src/timing/stage-view.ts";
import { REPO_ROOT } from "./paths.ts";
import { run, stage, workflow } from "./timing-fixtures.ts";

/**
 * The walk sums what `resolveStageViews` already decided, so every case goes
 * through it: the assertion is that a workflow shape puts its next gate in a
 * given place with a given amount of work before it.
 */

const MIN = 60_000;

const NO_POLICY: ConstructionGatePolicy = {
  checkpoints: false,
  unitMajor: false,
  iterationRecorded: false,
  swarm: false,
  autonomous: false,
  teamOwnership: false,
  unitEndRhythm: false,
  skeletonStanceRecorded: false,
  skeletonMayRun: false,
};

/** Each stage's median, in minutes. Two runs apiece, so no estimate is low confidence. */
const MINUTES: Record<string, number> = {
  "state-init": 1,
  "intent-capture": 20,
  "scope-definition": 10,
  "requirements-analysis": 15,
  "units-generation": 30,
  "functional-design": 20,
  "nfr-requirements": 10,
  "nfr-design": 8,
  "infrastructure-design": 6,
  "code-generation": 40,
  "build-and-test": 15,
  "ci-pipeline": 5,
  "deployment-pipeline": 12,
};

function history(): StageTiming[] {
  return Object.entries(MINUTES).flatMap(([slug, minutes]) => [
    run(slug, minutes * MIN, false, "01"),
    run(slug, minutes * MIN, false, "02"),
  ]);
}

const CONSTRUCTION = [
  "functional-design",
  "nfr-requirements",
  "nfr-design",
  "infrastructure-design",
  "code-generation",
  "build-and-test",
  "ci-pipeline",
];
const BLOCK = CONSTRUCTION.slice(0, 5);

interface Scenario {
  stages: StageInfo[];
  currentStage?: string | null;
  policy?: Partial<ConstructionGatePolicy>;
  /** The record's own open runs: slug → minutes of work already observed. */
  open?: Record<string, number>;
  pool?: StageTiming[];
  skeletonCleared?: boolean;
  planApproval?: boolean;
}

function nextGate({
  stages,
  currentStage = null,
  policy = {},
  open = {},
  pool = history(),
  skeletonCleared = false,
  planApproval,
}: Scenario): NextGateEstimate {
  const model = workflow({ stages, currentStage });
  const active = Object.entries(open).map(([slug, minutes]) =>
    run(slug, minutes * MIN, true, "03"),
  );
  return estimateNextGate(
    resolveStageViews(model, active, pool),
    { ...NO_POLICY, ...policy },
    { skeletonCleared, ...(planApproval === undefined ? {} : { planApproval }) },
  );
}

/**
 * units-generation (Inception), the seven Construction rows, then one
 * Operation row. Rows before `current` are completed, `current` is in
 * progress, the rest have not started — unless `statuses` says otherwise.
 */
function grid(
  current: string,
  statuses: Record<string, StageStatus> = {},
  execution: Record<string, "EXECUTE" | "SKIP"> = {},
): StageInfo[] {
  const slugs = [UNITS_STAGE, ...CONSTRUCTION, "deployment-pipeline"];
  const at = slugs.indexOf(current);
  return slugs.map((slug, index) => {
    const planned = execution[slug] ?? "EXECUTE";
    const status: StageStatus =
      statuses[slug] ??
      (planned === "SKIP"
        ? "skipped"
        : index < at
          ? "completed"
          : index === at
            ? "in-progress"
            : "not-started");
    return stage(slug, {
      phase:
        slug === UNITS_STAGE ? "INCEPTION" : slug === "deployment-pipeline" ? "OPERATION" : "CONSTRUCTION",
      execution: planned,
      status,
    });
  });
}

/** Minutes left: `MINUTES` for unstarted stages, minus observed work on the current one. */
function minutes(value: number | null): number | null {
  return value === null ? null : value / MIN;
}

describe("estimateNextGate — gates outside Construction", () => {
  const ideation = (status: StageStatus): StageInfo[] => [
    stage("intent-capture", { phase: "IDEATION", status }),
    stage("scope-definition", { phase: "IDEATION" }),
  ];

  it("stops at the current stage's own gate, net of the work already observed", () => {
    const gate = nextGate({
      stages: ideation("in-progress"),
      currentStage: "intent-capture",
      open: { "intent-capture": 5 },
    });
    expect(gate).toMatchObject({
      kind: "stage",
      stage: "intent-capture",
      stages: ["intent-capture"],
      autoApproved: [],
      planApproval: false,
      lowConfidence: false,
      estimateCoverage: { known: 1, unknown: 0 },
    });
    expect(minutes(gate.remainingMs)).toBe(15);
  });

  it("reports a gate that is open now, with no work before it", () => {
    expect(
      nextGate({
        stages: ideation("awaiting-approval"),
        currentStage: "intent-capture",
        open: { "intent-capture": 25 },
      }),
    ).toEqual({
      kind: "open",
      stage: "intent-capture",
      remainingMs: 0,
      stages: [],
      autoApproved: [],
      planApproval: false,
      lowConfidence: false,
      estimateCoverage: { known: 0, unknown: 0 },
    });
  });

  it("keeps a rejected stage as the next gate: approval reopens after the revision", () => {
    const gate = nextGate({
      stages: ideation("revising"),
      currentStage: "intent-capture",
      open: { "intent-capture": 12 },
    });
    expect(gate).toMatchObject({ kind: "stage", stage: "intent-capture" });
    expect(minutes(gate.remainingMs)).toBe(8);
  });

  it("passes initialization stages, which proceed without approval", () => {
    const gate = nextGate({
      stages: [
        stage("state-init", { phase: "INITIALIZATION" }),
        stage("intent-capture", { phase: "IDEATION" }),
      ],
      currentStage: "state-init",
    });
    expect(gate).toMatchObject({
      kind: "stage",
      stage: "intent-capture",
      stages: ["state-init", "intent-capture"],
      autoApproved: ["state-init"],
    });
    expect(minutes(gate.remainingMs)).toBe(21);
  });

  it("skips finished and out-of-scope rows after the current stage", () => {
    const gate = nextGate({
      stages: [
        stage("intent-capture", { phase: "IDEATION", status: "completed" }),
        stage("market-research", { phase: "IDEATION", execution: "SKIP", status: "skipped" }),
        stage("feasibility", { phase: "IDEATION", status: "skipped" }),
        stage("scope-definition", { phase: "IDEATION" }),
      ],
      currentStage: "intent-capture",
    });
    expect(gate).toMatchObject({ kind: "stage", stage: "scope-definition" });
    expect(minutes(gate.remainingMs)).toBe(10);
  });

  it("starts at the first unfinished row when no stage is current", () => {
    const gate = nextGate({
      stages: [
        stage("intent-capture", { phase: "IDEATION", status: "completed" }),
        stage("scope-definition", { phase: "IDEATION" }),
      ],
      currentStage: null,
    });
    expect(gate).toMatchObject({ kind: "stage", stage: "scope-definition" });
  });

  it("starts at the first unfinished row when the current stage names no row", () => {
    expect(
      nextGate({
        stages: [stage("scope-definition", { phase: "IDEATION" })],
        currentStage: "nonexistent",
      }),
    ).toMatchObject({ kind: "stage", stage: "scope-definition" });
  });

  it("reports no gate and no work once every stage is finished", () => {
    expect(
      nextGate({
        stages: [
          stage("intent-capture", { phase: "IDEATION", status: "completed" }),
          stage("build-and-test", { status: "completed" }),
        ],
        currentStage: "build-and-test",
      }),
    ).toEqual({
      kind: "none",
      stage: null,
      remainingMs: 0,
      stages: [],
      autoApproved: [],
      planApproval: false,
      lowConfidence: false,
      estimateCoverage: { known: 0, unknown: 0 },
    });
  });

  it("keeps earlier work when an awaiting-approval row sits after unfinished rows", () => {
    // A [?] ahead of the current stage (a jump, a hand-edited file) is not a
    // gate the engine is presenting now: the unfinished work before it stays.
    const gate = nextGate({
      stages: [
        stage("state-init", { phase: "INITIALIZATION" }),
        stage("intent-capture", { phase: "IDEATION", status: "awaiting-approval" }),
      ],
      currentStage: "state-init",
      open: { "intent-capture": 20 },
    });
    expect(gate).toMatchObject({
      kind: "stage",
      stage: "intent-capture",
      stages: ["state-init", "intent-capture"],
      autoApproved: ["state-init"],
    });
    expect(minutes(gate.remainingMs)).toBe(1);
  });

  it("reports an awaiting-approval row as open when nothing unfinished comes before it", () => {
    expect(
      nextGate({
        stages: [
          stage("state-init", { phase: "INITIALIZATION", status: "completed" }),
          stage("intent-capture", { phase: "IDEATION", status: "awaiting-approval" }),
        ],
        currentStage: "state-init",
        open: { "intent-capture": 20 },
      }),
    ).toMatchObject({ kind: "open", stage: "intent-capture", remainingMs: 0, stages: [] });
  });

  it("keeps an unknown remainder unknown instead of summing it as zero", () => {
    // In progress without an audit run: the stage view cannot size it.
    const unknown = nextGate({ stages: ideation("in-progress"), currentStage: "intent-capture" });
    expect(unknown).toMatchObject({
      kind: "stage",
      remainingMs: null,
      estimateCoverage: { known: 0, unknown: 1 },
    });

    // The in-progress initialization stage has no audit run, while the gated
    // stage after it has an estimate: the sum is the known part, and says so.
    const partial = nextGate({
      stages: [
        stage("state-init", { phase: "INITIALIZATION", status: "in-progress" }),
        stage("intent-capture", { phase: "IDEATION" }),
      ],
      currentStage: "state-init",
    });
    expect(partial).toMatchObject({
      kind: "stage",
      stage: "intent-capture",
      estimateCoverage: { known: 1, unknown: 1 },
    });
    expect(minutes(partial.remainingMs)).toBe(20);

    // With no history at all, nothing is known.
    expect(
      nextGate({
        stages: [stage("scope-definition", { phase: "IDEATION" })],
        pool: [],
      }),
    ).toMatchObject({ remainingMs: null, estimateCoverage: { known: 0, unknown: 1 } });
  });

  it("flags low confidence when a summed estimate rests on too little history", () => {
    const gate = nextGate({
      stages: [stage("scope-definition", { phase: "IDEATION" })],
      pool: [run("scope-definition", 10 * MIN)],
    });
    expect(gate.lowConfidence).toBe(true);
  });
});

describe("estimateNextGate — Construction without checkpoints", () => {
  it("gates each Construction stage at its end by default", () => {
    const gate = nextGate({ stages: grid("functional-design"), currentStage: "functional-design", open: { "functional-design": 5 } });
    expect(gate).toMatchObject({ kind: "stage", stage: "functional-design", stages: ["functional-design"] });
    expect(minutes(gate.remainingMs)).toBe(15);
  });

  it("keeps the first Construction approval under autonomy", () => {
    expect(
      nextGate({
        stages: grid("functional-design"),
        currentStage: "functional-design",
        policy: { autonomous: true },
        open: { "functional-design": 5 },
      }),
    ).toMatchObject({ kind: "stage", stage: "functional-design" });
  });

  it("notes no plan approval when it is off for the intent (v2.11.0)", () => {
    const gate = nextGate({
      stages: grid("nfr-requirements"),
      currentStage: "nfr-requirements",
      policy: { autonomous: true },
      open: { "nfr-requirements": 4 },
      planApproval: false,
    });
    expect(gate).toMatchObject({ kind: "stage", stage: "deployment-pipeline", planApproval: false });
  });

  it("walks past the Construction gates autonomy waives, to the next human gate", () => {
    const gate = nextGate({
      stages: grid("nfr-requirements"),
      currentStage: "nfr-requirements",
      policy: { autonomous: true },
      open: { "nfr-requirements": 4 },
    });
    expect(gate).toMatchObject({
      kind: "stage",
      stage: "deployment-pipeline",
      stages: [...CONSTRUCTION.slice(1), "deployment-pipeline"],
      autoApproved: CONSTRUCTION.slice(1),
      planApproval: true,
    });
    // 6 left of nfr-requirements, then 8+6+40+15+5 and deployment-pipeline's 12.
    expect(minutes(gate.remainingMs)).toBe(6 + 8 + 6 + 40 + 15 + 5 + 12);
  });

  it("reports no human gate when autonomy waives everything that is left", () => {
    const gate = nextGate({
      stages: grid("build-and-test", {}, { "deployment-pipeline": "SKIP" }),
      currentStage: "build-and-test",
      policy: { autonomous: true },
      open: { "build-and-test": 5 },
    });
    expect(gate).toMatchObject({
      kind: "none",
      stage: null,
      stages: ["build-and-test", "ci-pipeline"],
      autoApproved: ["build-and-test", "ci-pipeline"],
    });
    expect(minutes(gate.remainingMs)).toBe(10 + 5);
  });

  it("finds the first Construction approval among unskipped rows, completed ones included", () => {
    // functional-design finished: it is still the first approval, so the
    // current nfr-requirements is waived like any later stage.
    expect(
      nextGate({
        stages: grid("nfr-requirements", {}, { "deployment-pipeline": "SKIP" }),
        currentStage: "nfr-requirements",
        policy: { autonomous: true },
        open: { "nfr-requirements": 1 },
      }).kind,
    ).toBe("none");
    // Jumped over ([S]): the first approval moves to nfr-requirements.
    expect(
      nextGate({
        stages: grid("nfr-requirements", { "functional-design": "skipped" }),
        currentStage: "nfr-requirements",
        policy: { autonomous: true },
        open: { "nfr-requirements": 1 },
      }),
    ).toMatchObject({ kind: "stage", stage: "nfr-requirements" });
  });

  it("defers unit-major per-Unit gates until every Unit finishes the block", () => {
    const gate = nextGate({
      stages: grid("functional-design"),
      currentStage: "functional-design",
      policy: { unitMajor: true },
      open: { "functional-design": 5 },
    });
    expect(gate).toMatchObject({
      kind: "block",
      stage: "functional-design",
      stages: BLOCK,
      autoApproved: [],
      planApproval: true,
      // v2.11.0 approvesTogetherStages: one question approves the whole block.
      approvesTogether: BLOCK,
    });
    expect(minutes(gate.remainingMs)).toBe(15 + 10 + 8 + 6 + 40);
  });

  it("keeps the unit-major block's gates human under autonomy", () => {
    expect(
      nextGate({
        stages: grid("nfr-design"),
        currentStage: "nfr-design",
        policy: { unitMajor: true, autonomous: true },
        open: { "nfr-design": 2 },
      }),
    ).toMatchObject({ kind: "block", stage: "nfr-design", stages: BLOCK.slice(2) });
    // Autonomy keeps the gates, but asks them one by one (approvesTogetherStages).
    expect(
      nextGate({
        stages: grid("nfr-design"),
        currentStage: "nfr-design",
        policy: { unitMajor: true, autonomous: true },
        open: { "nfr-design": 2 },
      }).approvesTogether,
    ).toBeUndefined();
  });

  it("gates per stage under unit-major when units-generation is out of the plan", () => {
    expect(
      nextGate({
        stages: grid("functional-design", {}, { [UNITS_STAGE]: "SKIP" }),
        currentStage: "functional-design",
        policy: { unitMajor: true },
        open: { "functional-design": 5 },
      }),
    ).toMatchObject({ kind: "stage", stage: "functional-design", stages: ["functional-design"] });
  });

  it("gates per stage when the plan has no units-generation row at all", () => {
    const stages = grid("functional-design").filter((row) => row.slug !== UNITS_STAGE);
    expect(
      nextGate({
        stages,
        currentStage: "functional-design",
        policy: { unitMajor: true },
        open: { "functional-design": 5 },
      }),
    ).toMatchObject({ kind: "stage", stage: "functional-design" });
  });

  it("does not count finished per-Unit rows into the block", () => {
    expect(
      nextGate({
        stages: grid("nfr-requirements", { "nfr-design": "completed" }),
        currentStage: "nfr-requirements",
        policy: { unitMajor: true },
        open: { "nfr-requirements": 1 },
      }).stages,
    ).toEqual(["nfr-requirements", "infrastructure-design", "code-generation"]);
  });
});

describe("estimateNextGate — Construction checkpoints", () => {
  const checkpoints = { checkpoints: true, unitMajor: true } as const;

  it("places the current Unit's checkpoint after its per-Unit block", () => {
    const gate = nextGate({
      stages: grid("functional-design"),
      currentStage: "functional-design",
      policy: checkpoints,
      open: { "functional-design": 5 },
    });
    expect(gate).toMatchObject({
      kind: "unit",
      stage: "code-generation",
      stages: BLOCK,
      planApproval: true,
    });
    expect(minutes(gate.remainingMs)).toBe(15 + 10 + 8 + 6 + 40);
  });

  it("keeps the walking skeleton's human checkpoint under autonomy until it is approved", () => {
    const skeleton = {
      ...checkpoints,
      autonomous: true,
      skeletonStanceRecorded: true,
      skeletonMayRun: true,
    };
    // The engine requires a person for the skeleton checkpoint even when
    // ordinary Unit checkpoints are automatic.
    expect(
      nextGate({
        stages: grid("functional-design"),
        currentStage: "functional-design",
        policy: skeleton,
        open: { "functional-design": 5 },
      }),
    ).toMatchObject({ kind: "unit", stage: "code-generation", stages: BLOCK });
    // Once it is approved, the remaining Units' checkpoints are automatic.
    expect(
      nextGate({
        stages: grid("functional-design"),
        currentStage: "functional-design",
        policy: skeleton,
        open: { "functional-design": 5 },
        skeletonCleared: true,
      }),
    ).toMatchObject({ kind: "stage", stage: "deployment-pipeline" });
  });

  it("treats Unit checkpoints and the late stage gates as automatic under autonomy", () => {
    const gate = nextGate({
      stages: grid("functional-design"),
      currentStage: "functional-design",
      policy: { ...checkpoints, autonomous: true, skeletonStanceRecorded: true },
      open: { "functional-design": 5 },
    });
    expect(gate).toMatchObject({
      kind: "stage",
      stage: "deployment-pipeline",
      autoApproved: CONSTRUCTION,
      planApproval: true,
    });
  });

  it("asks at build-and-test under autonomy when no Skeleton Stance is recorded", () => {
    expect(
      nextGate({
        stages: grid("build-and-test"),
        currentStage: "build-and-test",
        policy: { ...checkpoints, autonomous: true },
        open: { "build-and-test": 1 },
      }),
    ).toMatchObject({ kind: "stage", stage: "build-and-test" });
  });

  it("asks at build-and-test under autonomy while a skeleton checkpoint is owed", () => {
    const policy = {
      ...checkpoints,
      autonomous: true,
      skeletonStanceRecorded: true,
      skeletonMayRun: true,
    };
    const at = (skeletonCleared: boolean) =>
      nextGate({
        stages: grid("build-and-test"),
        currentStage: "build-and-test",
        policy,
        open: { "build-and-test": 1 },
        skeletonCleared,
      });
    expect(at(false)).toMatchObject({ kind: "stage", stage: "build-and-test" });
    expect(at(true)).toMatchObject({ kind: "stage", stage: "deployment-pipeline" });
  });

  it("keeps human per-stage gates when per-Unit artifacts are stage-level", () => {
    expect(
      nextGate({
        stages: grid("functional-design", {}, { [UNITS_STAGE]: "SKIP" }),
        currentStage: "functional-design",
        policy: { ...checkpoints, autonomous: true },
        open: { "functional-design": 5 },
      }),
    ).toMatchObject({ kind: "stage", stage: "functional-design" });
  });

  it("does not apply checkpoints when code-generation is not in the plan", () => {
    // Legacy rules instead: the unit-major block's late cascade.
    expect(
      nextGate({
        stages: grid("functional-design", {}, { "code-generation": "SKIP" }),
        currentStage: "functional-design",
        policy: checkpoints,
        open: { "functional-design": 5 },
      }),
    ).toMatchObject({ kind: "block", stage: "functional-design", planApproval: false });
  });

  it("settles stage-major swarm Code Generation in batch checkpoints", () => {
    const swarm = { checkpoints: true, swarm: true } as const;
    expect(
      nextGate({
        stages: grid("code-generation"),
        currentStage: "code-generation",
        policy: swarm,
        open: { "code-generation": 10 },
      }),
    ).toMatchObject({ kind: "unit", stage: "code-generation", stages: ["code-generation"] });
    expect(
      nextGate({
        stages: grid("code-generation"),
        currentStage: "code-generation",
        policy: { ...swarm, autonomous: true, skeletonStanceRecorded: true },
        open: { "code-generation": 10 },
      }),
    ).toMatchObject({ kind: "stage", stage: "deployment-pipeline" });
    expect(
      nextGate({
        stages: grid("code-generation", {}, { [UNITS_STAGE]: "SKIP" }),
        currentStage: "code-generation",
        policy: swarm,
        open: { "code-generation": 10 },
      }),
    ).toMatchObject({ kind: "stage", stage: "code-generation" });
  });

  it("keeps ordinary stage gates for stage-major per-Unit stages", () => {
    expect(
      nextGate({
        stages: grid("nfr-requirements"),
        currentStage: "nfr-requirements",
        policy: { checkpoints: true },
        open: { "nfr-requirements": 1 },
      }),
    ).toMatchObject({ kind: "stage", stage: "nfr-requirements" });
  });
});

describe("estimateNextGate — team-owned Units", () => {
  const team = { teamOwnership: true, unitMajor: true } as const;

  it("places a Unit gate after each stage at the per-stage rhythm", () => {
    expect(
      nextGate({
        stages: grid("nfr-requirements"),
        currentStage: "nfr-requirements",
        policy: team,
        open: { "nfr-requirements": 1 },
      }),
    ).toMatchObject({ kind: "unit", stage: "nfr-requirements", stages: ["nfr-requirements"] });
  });

  it("places one Unit gate after the block at the unit-end rhythm", () => {
    expect(
      nextGate({
        stages: grid("nfr-requirements"),
        currentStage: "nfr-requirements",
        policy: { ...team, unitEndRhythm: true },
        open: { "nfr-requirements": 1 },
      }),
    ).toMatchObject({ kind: "unit", stage: "code-generation", stages: BLOCK.slice(1) });
  });

  it("never turns team-owned Units into solo checkpoints", () => {
    expect(
      nextGate({
        stages: grid("nfr-requirements"),
        currentStage: "nfr-requirements",
        policy: { ...team, checkpoints: true },
        open: { "nfr-requirements": 1 },
      }),
    ).toMatchObject({ kind: "unit", stage: "nfr-requirements" });
  });

  it("uses the legacy rules for team stages outside the Unit walk", () => {
    expect(
      nextGate({
        stages: grid("build-and-test"),
        currentStage: "build-and-test",
        policy: { ...team, autonomous: true },
        open: { "build-and-test": 1 },
      }),
    ).toMatchObject({ kind: "stage", stage: "deployment-pipeline" });
  });
});

describe("skeletonCheckpointCleared", () => {
  function gateEvent(
    event: string,
    minute: number,
    fields: Record<string, string> = {},
  ): AuditEvent {
    return {
      event,
      stage: fields.Stage ?? null,
      timestamp: `2026-09-25T10:${String(minute).padStart(2, "0")}:00Z`,
      shard: "a.md",
      workflow: null,
      fields,
      position: minute,
    };
  }
  const skeleton = { Stage: "code-generation", Checkpoint: "walking-skeleton" };

  it("is true once the skeleton checkpoint is approved after a rejection", () => {
    expect(
      skeletonCheckpointCleared([
        gateEvent("WORKFLOW_STARTED", 0),
        gateEvent("GATE_REJECTED", 10, skeleton),
        gateEvent("GATE_APPROVED", 20, skeleton),
      ]),
    ).toBe(true);
  });

  it("is true after an ordinary Unit checkpoint: the first Unit was not a skeleton, or it passed", () => {
    expect(
      skeletonCheckpointCleared([
        gateEvent("GATE_APPROVED", 10, { ...skeleton, Checkpoint: "construction-unit" }),
      ]),
    ).toBe(true);
  });

  it("is false without a checkpoint approval, after a skeleton rejection, or after a reset", () => {
    expect(skeletonCheckpointCleared([])).toBe(false);
    expect(
      skeletonCheckpointCleared([
        gateEvent("GATE_APPROVED", 10, { Stage: "code-generation", Checkpoint: "swarm-batch" }),
        gateEvent("GATE_APPROVED", 11, { Stage: "code-generation" }),
      ]),
    ).toBe(false);
    expect(
      skeletonCheckpointCleared([
        gateEvent("GATE_APPROVED", 10, skeleton),
        gateEvent("GATE_REJECTED", 20, skeleton),
      ]),
    ).toBe(false);
    expect(
      skeletonCheckpointCleared([
        gateEvent("GATE_APPROVED", 10, skeleton),
        gateEvent("STAGE_JUMPED", 20),
      ]),
    ).toBe(false);
  });

  it("keeps the approval across a jump that reaches none of the Unit's stages (v2.11.0)", () => {
    const order = ["units-generation", "functional-design", "code-generation", "build-and-test"];
    const jumped = (target: string) => [
      gateEvent("GATE_APPROVED", 10, skeleton),
      gateEvent("STAGE_JUMPED", 20, { Target: target }),
    ];
    const unitStages = ["functional-design", "code-generation"];
    expect(skeletonCheckpointCleared(jumped("build-and-test"), { stageOrder: order, unitStages })).toBe(
      true,
    );
    expect(skeletonCheckpointCleared(jumped("code-generation"), { stageOrder: order, unitStages })).toBe(
      false,
    );
    expect(skeletonCheckpointCleared(jumped("units-generation"), { stageOrder: order, unitStages })).toBe(
      false,
    );
    expect(skeletonCheckpointCleared(jumped("build-and-test"))).toBe(false);
  });

  it("orders events by time, not by input order", () => {
    expect(
      skeletonCheckpointCleared([
        gateEvent("GATE_APPROVED", 30, skeleton),
        gateEvent("WORKFLOW_STARTED", 0),
      ]),
    ).toBe(true);
  });
});

describe("per-Unit stage names", () => {
  /**
   * The walk names the engine's per-Unit stages instead of reading the
   * compiled graph at runtime, so this pins those names to the graph shipped
   * in this repository: an engine update that changes them fails here.
   */
  it("match the compiled stage graph", async () => {
    const graph = JSON.parse(
      await readFile(path.join(REPO_ROOT, ".claude", "tools", "data", "stage-graph.json"), "utf8"),
    ) as Array<{ slug: string; phase: string; for_each?: string; workspace_requires?: boolean }>;
    const perUnit = graph.filter((node) => node.for_each === "unit-of-work");
    expect([...PER_UNIT_STAGES].sort()).toEqual(perUnit.map((node) => node.slug).sort());
    expect(
      perUnit.filter((node) => node.workspace_requires === true).map((node) => node.slug),
    ).toEqual([SOURCE_STAGE]);
    expect(graph.find((node) => node.slug === UNITS_STAGE)?.phase).toBe("inception");
  });
});
