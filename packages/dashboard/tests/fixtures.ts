import type {
  Matrix,
  NextStep,
  StageDoc,
  StageInfo,
  StageTiming,
  StageView,
  WorkflowModel,
} from "@aidlc-guide/shared-types";
import type { WorkflowPayload } from "@/store/state.ts";

/** Shared fixtures: a small but realistic workflow, matrix and stage doc. */

export function stage(slug: string, overrides: Partial<StageInfo> = {}): StageInfo {
  return {
    slug,
    phase: "CONSTRUCTION",
    execution: "EXECUTE",
    status: "not-started",
    ...overrides,
  };
}

export function run(slug: string, activeMs: number, endedAt: string | null = null): StageTiming {
  return {
    stage: slug,
    startedAt: "2026-07-25T05:41:30Z",
    endedAt,
    wallMs: activeMs + 600_000,
    activeMs,
    eventCount: 1201,
  };
}

/**
 * A reconciled stage row as `/api/timings` ships it. The dashboard never
 * derives these — reader-core's `resolveStageViews` does (issue #9), and the
 * rules it applies are pinned in `reader-core/tests/timing-stage-view.test.ts`.
 * A dashboard test therefore states the view it wants and asserts what gets
 * rendered, rather than re-deriving the view from runs and statuses.
 */
export function stageView(slug: string, overrides: Partial<StageView> = {}): StageView {
  return {
    stage: slug,
    phase: "CONSTRUCTION",
    execution: "EXECUTE",
    status: "not-started",
    isCurrent: false,
    running: false,
    currentAttempt: null,
    history: [],
    actualActiveMs: null,
    elapsedActiveMs: null,
    estimateMs: null,
    sampleCount: 0,
    basis: "none",
    remainingMs: null,
    countsTowardRemaining: true,
    ...overrides,
  };
}

export function workflow(overrides: Partial<WorkflowModel> = {}): WorkflowModel {
  return {
    project: "aidlc-guide",
    scope: "mvp",
    depth: "standard",
    stateVersion: 8,
    phase: "CONSTRUCTION",
    currentStage: "code-generation",
    nextStage: "build-and-test",
    gate: "awaiting-approval",
    stages: [
      stage("intent-capture", { phase: "IDEATION", status: "completed" }),
      stage("market-research", { phase: "IDEATION", execution: "SKIP", status: "skipped" }),
      stage("feasibility", { phase: "IDEATION", execution: "SKIP", status: "skipped" }),
      stage("functional-design", { status: "completed" }),
      stage("code-generation", { status: "awaiting-approval" }),
      stage("build-and-test"),
    ],
    done: 3,
    total: 6,
    ...overrides,
  };
}

export function nextStep(overrides: Partial<NextStep> = {}): NextStep {
  return { nextStage: "build-and-test", requirement: "コードとテストの承認", ...overrides };
}

export function payload(overrides: Partial<WorkflowPayload> = {}): WorkflowPayload {
  return {
    workflow: workflow(),
    nextStep: nextStep(),
    ...overrides,
  };
}

/**
 * `mcp-server` has no `nfr-design` cell at all (out of scope) and a
 * `functional-design` cell with no files (in scope, nothing produced yet) —
 * the exact pair FR-4.3 asks the UI to distinguish.
 */
export function matrix(overrides: Partial<Matrix> = {}): Matrix {
  return {
    units: ["reader-core", "mcp-server"],
    stages: ["functional-design", "nfr-design"],
    cells: [
      {
        unit: "reader-core",
        stage: "functional-design",
        files: ["business-rules.md", "domain-entities.md", "business-logic-model.md", "review.md"],
        verdict: "READY",
      },
      {
        unit: "reader-core",
        stage: "nfr-design",
        files: ["logical-components.md", "performance-design.md"],
        verdict: null,
      },
      { unit: "mcp-server", stage: "functional-design", files: [], verdict: null },
    ],
    ...overrides,
  };
}

export function stageDoc(overrides: Partial<StageDoc> = {}): StageDoc {
  return {
    slug: "code-generation",
    purpose: "ユニット仕様に沿って実装を書く。",
    inputs: ["unit-specs.md"],
    outputs: ["code-summary.md"],
    agent: "aidlc-developer-agent",
    agentDisplayName: "開発エージェント",
    gateRequirement: "実装とテストの承認",
    deepLink: { docPath: "docs/guide/03-construction.md", docAnchor: "code-generation" },
    excerpt: null,
    artifactDocs: {},
    sourceVersion: "1.4.0",
    ...overrides,
  };
}
