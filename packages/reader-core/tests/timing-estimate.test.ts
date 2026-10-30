import {
  isLowConfidenceEstimate,
  type Phase,
  type StageTiming,
  type StageView,
  type WorkflowModel,
} from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { createStageEstimator, estimateRemaining } from "../src/timing/estimate.ts";
import { resolveStageViews } from "../src/timing/stage-view.ts";
import { run, stage, workflow } from "./timing-fixtures.ts";

/**
 * Issue #9 split this file in two. The arithmetic — the fallback ladder and
 * the roll-up — stays here; every rule about which run belongs to which
 * attempt moved to `timing-stage-view.test.ts`, because it moved out of this
 * module. The roll-up cases below therefore go through `resolveStageViews`
 * rather than hand-building views: what is being asserted is that a workflow
 * shape produces a given total, and the reconciliation is part of that path.
 */

/** Shorthand for the common case: one pool serving both roles. */
function views(over: Partial<WorkflowModel>, pool: readonly StageTiming[]): StageView[] {
  return resolveStageViews(workflow(over), pool, pool);
}

describe("createStageEstimator", () => {
  const phases = new Map<string, Phase>([
    ["a", "CONSTRUCTION"],
    ["b", "CONSTRUCTION"],
    ["c", "CONSTRUCTION"],
    ["z", "OPERATION"],
  ]);

  it("takes the median, and averages the two middles when even", () => {
    const odd = createStageEstimator([run("a", 100), run("a", 500), run("a", 900)], phases);
    expect(odd("a").estimateMs).toBe(500);

    const even = createStageEstimator(
      [run("a", 100), run("a", 200), run("a", 400), run("a", 900)],
      phases,
    );
    expect(even("a").estimateMs).toBe(300);
  });

  it("climbs stage → phase → global → none", () => {
    const estimate = createStageEstimator([run("a", 100), run("b", 300)], phases);
    expect(estimate("a")).toEqual({
      stage: "a",
      estimateMs: 100,
      sampleCount: 1,
      sampleExcludedCount: 0,
      limitedSampleCount: 0,
      basis: "stage",
    });
    // No history of its own, but two same-phase runs to borrow from.
    expect(createStageEstimator([run("a", 100), run("b", 300)], phases)("c")).toMatchObject({
      estimateMs: 200,
      basis: "phase",
    });
    // A different phase entirely — only the workspace-wide median is left.
    expect(estimate("z")).toMatchObject({ estimateMs: 200, basis: "global" });
    expect(createStageEstimator([], phases)("a")).toEqual({
      stage: "a",
      estimateMs: null,
      sampleCount: 0,
      sampleExcludedCount: 0,
      limitedSampleCount: 0,
      basis: "none",
    });
  });

  it("ignores open runs — a run in progress is not evidence of how long a stage takes", () => {
    expect(createStageEstimator([run("a", 999_999, true)], phases)("a").basis).toBe("none");
  });

  it("skips the phase rung for a slug the workflow does not place in a phase", () => {
    // A run whose slug has no state-file row (a stage removed from the scope,
    // a foreign intent's) contributes to the global pool but belongs to no
    // phase bucket — it must not be borrowed as a phase median for anyone.
    const estimate = createStageEstimator([run("a", 100), run("stranger", 900)], phases);
    expect(estimate("stranger")).toMatchObject({ estimateMs: 500, basis: "global" });
    // Asked about a slug with neither its own history nor a phase, the ladder
    // drops straight to the workspace median instead of borrowing someone's.
    expect(estimate("ghost")).toMatchObject({ estimateMs: 500, basis: "global" });
  });

  it("excludes unusable completed runs and reports counts for the selected pool", () => {
    const estimate = createStageEstimator(
      [
        run("a", 100),
        { ...run("a", 999), activeMs: null },
        {
          ...run("a", 0),
          quality: { status: "limited", reasons: ["excluded-log-gap"], sampleEligible: false },
        },
        {
          ...run("b", 999),
          quality: {
            status: "incomplete",
            reasons: ["audit-read-incomplete"],
            sampleEligible: false,
          },
        },
        run("a", 777, true),
      ],
      phases,
    );
    expect(estimate("a")).toMatchObject({
      estimateMs: 100,
      sampleCount: 1,
      sampleExcludedCount: 2,
    });
    expect(estimate("c")).toMatchObject({
      estimateMs: 100,
      basis: "phase",
      sampleExcludedCount: 3,
    });
    expect(estimate("z")).toMatchObject({
      estimateMs: 100,
      basis: "global",
      sampleExcludedCount: 3,
    });
  });

  it("marks a median as a reference value when an accepted sample has limited coverage", () => {
    const estimate = createStageEstimator(
      [
        run("a", 100),
        {
          ...run("a", 300),
          quality: { status: "limited", reasons: ["excluded-log-gap"], sampleEligible: true },
        },
      ],
      phases,
    )("a");
    expect(estimate).toMatchObject({ estimateMs: 200, sampleCount: 2, limitedSampleCount: 1 });
    expect(isLowConfidenceEstimate(estimate)).toBe(true);
  });

  it("preserves a valid zero sample and does not fabricate a median for rejected history", () => {
    expect(createStageEstimator([run("a", 0)], phases)("a").estimateMs).toBe(0);
    const estimate = createStageEstimator([{ ...run("a", 100), activeMs: null }], phases)("a");
    expect(estimate).toMatchObject({ estimateMs: null, sampleCount: 0, sampleExcludedCount: 1 });
  });
});

describe("createStageEstimator — per-Unit stages and the Construction walk (issue #167)", () => {
  const MIN = 60_000;
  const phases = new Map<string, Phase>([
    ["functional-design", "CONSTRUCTION"],
    ["nfr-design", "CONSTRUCTION"],
    ["infrastructure-design", "CONSTRUCTION"],
    ["build-and-test", "CONSTRUCTION"],
    ["requirements-analysis", "INCEPTION"],
  ]);
  const walked = (
    slug: string,
    minutes: number,
    walk: StageTiming["constructionWalk"],
    at = "01",
  ): StageTiming => ({ ...run(slug, minutes * MIN, false, at), constructionWalk: walk });

  // A stage-by-stage workflow spent 8 minutes on nfr-design; a unit-major one
  // recorded 1 minute, because its first block stage carried the block.
  const pool = [
    walked("functional-design", 16, "stage-major"),
    walked("functional-design", 60, "unit-major"),
    walked("nfr-design", 8, "stage-major"),
    walked("nfr-design", 1, "unit-major", "02"),
    walked("nfr-design", 1, "unit-major", "03"),
    walked("build-and-test", 7, "unit-major"),
    walked("build-and-test", 9, "stage-major", "02"),
  ];

  it("sizes a per-Unit stage only from runs recorded under the same walk", () => {
    expect(createStageEstimator(pool, phases, "stage-major")("nfr-design")).toMatchObject({
      estimateMs: 8 * MIN,
      sampleCount: 1,
      sampleExcludedCount: 0,
      basis: "stage",
    });
    expect(createStageEstimator(pool, phases, "unit-major")("nfr-design")).toMatchObject({
      estimateMs: 1 * MIN,
      sampleCount: 2,
      sampleExcludedCount: 0,
      basis: "stage",
    });
  });

  it("leaves stages that are not per-Unit as they were, whatever walk recorded them", () => {
    for (const walk of ["stage-major", "unit-major", undefined] as const) {
      expect(createStageEstimator(pool, phases, walk)("build-and-test")).toMatchObject({
        estimateMs: 8 * MIN,
        sampleCount: 2,
        basis: "stage",
      });
    }
  });

  it("keeps the other walk's per-Unit runs out of a per-Unit stage's phase and global rungs", () => {
    const stageMajor = createStageEstimator(pool, phases, "stage-major");
    // No infrastructure-design history: the CONSTRUCTION median of 16, 8, 7, 9.
    expect(stageMajor("infrastructure-design")).toMatchObject({
      estimateMs: 8.5 * MIN,
      sampleCount: 4,
      basis: "phase",
    });
    // A per-Unit stage with no phase in this workflow: the same four runs.
    expect(stageMajor("code-generation")).toMatchObject({
      estimateMs: 8.5 * MIN,
      sampleCount: 4,
      basis: "global",
    });
    // The unit-major pool for the same rungs: 60, 1, 1, 7, 9.
    expect(
      createStageEstimator(pool, phases, "unit-major")("infrastructure-design"),
    ).toMatchObject({ estimateMs: 7 * MIN, sampleCount: 5, basis: "phase" });
  });

  it("lets a stage that is not per-Unit fall back on every run, whatever the walk", () => {
    // All seven runs: 1, 1, 7, 8, 9, 16, 60.
    for (const walk of ["stage-major", "unit-major", undefined] as const) {
      expect(createStageEstimator(pool, phases, walk)("deployment-pipeline")).toMatchObject({
        estimateMs: 8 * MIN,
        sampleCount: 7,
        sampleExcludedCount: 0,
        basis: "global",
      });
    }
    // No build-and-test history, and the phase holds only a unit-major
    // functional-design run: a stage-by-stage workflow still borrows it.
    const onlyUnitMajor = [walked("functional-design", 60, "unit-major")];
    expect(createStageEstimator(onlyUnitMajor, phases, "stage-major")("build-and-test")).toMatchObject({
      estimateMs: 60 * MIN,
      sampleCount: 1,
      basis: "phase",
    });
  });

  it("does not count the other walk's runs as rejected measurements", () => {
    const estimate = createStageEstimator(pool, phases, "stage-major")("functional-design");
    expect(estimate).toMatchObject({ sampleCount: 1, sampleExcludedCount: 0 });
  });

  it("counts per-Unit runs of an unreadable workflow as excluded on every rung", () => {
    const withUnknown = [
      ...pool,
      walked("nfr-design", 30, "unknown", "04"),
      walked("requirements-analysis", 15, "unknown"),
    ];
    const estimate = createStageEstimator(withUnknown, phases, "stage-major");
    expect(estimate("nfr-design")).toMatchObject({
      estimateMs: 8 * MIN,
      sampleCount: 1,
      sampleExcludedCount: 1,
    });
    // Not per-Unit: an unknown walk does not matter.
    expect(estimate("requirements-analysis")).toMatchObject({
      estimateMs: 15 * MIN,
      sampleCount: 1,
      sampleExcludedCount: 0,
    });
    // A per-Unit stage's global rung: 16, 8, 7, 9 and the readable-anywhere 15.
    expect(estimate("code-generation")).toMatchObject({
      basis: "global",
      sampleCount: 5,
      sampleExcludedCount: 1,
    });
    // Any other stage's global rung takes every run, as without a walk.
    expect(estimate("deployment-pipeline")).toMatchObject({
      basis: "global",
      sampleCount: 9,
      sampleExcludedCount: 0,
    });
  });

  it("falls back a rung rather than borrowing the other walk's runs", () => {
    const unitMajorOnly = [walked("nfr-design", 1, "unit-major"), walked("build-and-test", 7, "unit-major")];
    expect(createStageEstimator(unitMajorOnly, phases, "stage-major")("nfr-design")).toMatchObject({
      estimateMs: 7 * MIN,
      sampleCount: 1,
      basis: "phase",
    });
  });

  it("pools every walk when none is given", () => {
    expect(createStageEstimator(pool, phases)("nfr-design")).toMatchObject({
      estimateMs: 1 * MIN,
      sampleCount: 3,
    });
  });

  it("uses the workflow's own walk through resolveStageViews", () => {
    const stages = [
      stage("units-generation", { phase: "INCEPTION", status: "completed" }),
      stage("nfr-design"),
    ];
    const policy = {
      checkpoints: false,
      unitMajor: true,
      iterationRecorded: true,
      swarm: false,
      autonomous: false,
      teamOwnership: false,
      unitEndRhythm: false,
      skeletonStanceRecorded: false,
      skeletonMayRun: false,
    };
    const unitMajor = resolveStageViews(workflow({ stages, constructionPolicy: policy }), [], pool);
    expect(unitMajor.find((view) => view.stage === "nfr-design")?.estimateMs).toBe(1 * MIN);

    const stageMajor = resolveStageViews(
      workflow({ stages, constructionPolicy: { ...policy, unitMajor: false } }),
      [],
      pool,
    );
    expect(stageMajor.find((view) => view.stage === "nfr-design")?.estimateMs).toBe(8 * MIN);
  });
});

describe("estimateRemaining", () => {
  it("sums the counted views' remainders", () => {
    // a: current, 100k into a 600k median → 500k left.
    // b: pending with its own 300k history.
    // c: no history of its own → phase median of (600k, 300k) = 450k.
    const result = estimateRemaining(
      views(
        {
          currentStage: "a",
          stages: [stage("a", { status: "in-progress" }), stage("b"), stage("c")],
        },
        [run("a", 600_000), run("b", 300_000), run("a", 100_000, true, "02")],
      ),
    );
    expect(result.totalRemainingMs).toBe(1_250_000);
  });

  it("charges a concurrently-open pending stage only what is left of it", () => {
    // Unit-major iteration opens several design stages at once, so a stage
    // that is not `currentStage` can still be part-way through its own run.
    const result = estimateRemaining(
      views({ currentStage: null, stages: [stage("d", { status: "in-progress" })] }, [
        run("d", 600_000),
        run("d", 100_000, true, "02"),
      ]),
    );
    expect(result.totalRemainingMs).toBe(500_000);
  });

  it("counts an unstarted current stage in full rather than dropping it", () => {
    const result = estimateRemaining(
      views({ currentStage: "a", stages: [stage("a"), stage("b", { status: "completed" })] }, [
        run("b", 600_000),
      ]),
    );
    expect(result.totalRemainingMs).toBe(600_000);
  });

  it("reports 0 for a workflow parked on its finished final stage", () => {
    const result = estimateRemaining(
      views({ currentStage: "a", stages: [stage("a", { status: "completed" })] }, [
        run("a", 1_144_000),
      ]),
    );
    expect(result.totalRemainingMs).toBe(0);
  });

  it("reports zero when every stage is finished, even without a current stage", () => {
    const result = estimateRemaining(
      views(
        {
          currentStage: null,
          stages: [stage("a", { status: "completed" }), stage("b", { status: "completed" })],
        },
        [run("a", 600_000), run("b", 900_000)],
      ),
    );
    expect(result).toMatchObject({
      totalRemainingMs: 0,
      estimateCoverage: { known: 0, unknown: 0 },
    });
  });

  it("reports null when the counted views have no estimate to offer", () => {
    expect(estimateRemaining(views({ stages: [stage("a")] }, [])).totalRemainingMs).toBeNull();
  });

  it("exposes the unknown part of a partial remaining sum", () => {
    const resolved = resolveStageViews(
      workflow({ stages: [stage("a"), stage("b"), stage("c", { status: "in-progress" })] }),
      [{ ...run("c", 0, true), activeMs: null }],
      [run("a", 5 * 60_000), run("b", 8 * 60_000)],
    );
    expect(estimateRemaining(resolved)).toMatchObject({
      totalRemainingMs: 13 * 60_000,
      estimateCoverage: { known: 2, unknown: 1 },
    });
  });

  it("flags low confidence from a fallback rung or a single sample, and only from counted views", () => {
    expect(estimateRemaining(views({ stages: [stage("a")] }, [run("a", 100)])).lowConfidence).toBe(
      true,
    );
    expect(
      estimateRemaining(views({ stages: [stage("a")] }, [run("a", 100), run("a", 200)]))
        .lowConfidence,
    ).toBe(false);
    // "b" rests on a single sample, but it is already completed — a finished
    // stage's confidence says nothing about the work that is left.
    expect(
      estimateRemaining(
        views(
          {
            stages: [stage("a"), stage("b", { phase: "OPERATION", status: "completed" })],
          },
          [run("a", 100), run("a", 200), run("b", 900)],
        ),
      ).lowConfidence,
    ).toBe(false);
  });
});
