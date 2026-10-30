import type {
  ConstructionGatePolicy,
  StageInfo,
  TimingsPayload,
  UnitStepStatus,
  UnitWalk,
  WorkflowModel,
} from "@andon/shared-types";
import { render, screen, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StageRail } from "@/features/home/components/StageRail.tsx";
import { workflow } from "@tests/fixtures.ts";

const noop = (): void => {};

const POLICY: ConstructionGatePolicy = {
  checkpoints: true,
  unitMajor: false,
  iterationRecorded: true,
  swarm: false,
  autonomous: false,
  teamOwnership: false,
  unitEndRhythm: false,
  skeletonStanceRecorded: false,
  skeletonMayRun: false,
};

const UNIT_STAGES = ["functional-design", "nfr-design", "code-generation"];

function stage(slug: string, over: Partial<StageInfo> = {}): StageInfo {
  return { slug, phase: "CONSTRUCTION", execution: "EXECUTE", status: "not-started", ...over };
}

const NS: UnitStepStatus = "not-started";
const IP: UnitStepStatus = "in-progress";
const OK: UnitStepStatus = "completed";
const SK: UnitStepStatus = "skipped";

/** Units in walk order → their step statuses over {@link UNIT_STAGES}. */
function walkOf(rows: Record<string, UnitStepStatus[]>): UnitWalk {
  const units = Object.entries(rows).map(([unit, statuses]) => {
    const finished = statuses.every((s) => s === OK || s === SK);
    const started = statuses.some((s) => s !== NS);
    const status: UnitStepStatus = finished ? OK : started ? IP : NS;
    return {
      unit,
      status,
      steps: UNIT_STAGES.map((s, i) => ({ stage: s, status: statuses[i] ?? NS })),
    };
  });
  return {
    stages: UNIT_STAGES,
    units,
    byStage: UNIT_STAGES.map((s, i) => ({
      stage: s,
      completed: units.filter((u) => u.steps[i]?.status === OK).length,
      skipped: units.filter((u) => u.steps[i]?.status === SK).length,
      total: units.length,
    })),
  };
}

const WALK = walkOf({
  u1: [OK, SK, OK],
  u2: [OK, OK, IP],
  u3: [NS, NS, NS],
});

/** A payload for `currentStage`, the stage the workflow read is on unless a test moves it. */
function timings(
  unitWalk: UnitWalk | null,
  currentStage: string | null = "code-generation",
): TimingsPayload {
  return {
    intent: "i",
    timings: [],
    currentStage,
    stageViews: [],
    remaining: { totalRemainingMs: null, lowConfidence: false },
    unitWalk,
  };
}

function model(over: Partial<WorkflowModel>): { kind: "success"; value: WorkflowModel } {
  return {
    kind: "success",
    value: workflow({
      currentStage: "code-generation",
      stages: [
        stage("units-generation", { phase: "INCEPTION", status: "completed" }),
        stage("functional-design", { status: "completed" }),
        stage("nfr-design", { status: "completed" }),
        stage("code-generation", { status: "in-progress" }),
        stage("build-and-test"),
      ],
      ...over,
    }),
  };
}

describe("StageRail — stage-major Units (plan A)", () => {
  const stageMajor = model({
    constructionPolicy: POLICY,
    activeUnit: { unit: "u2", stage: "code-generation", state: "in-progress" },
  });

  it("shows how many Units have finished each per-Unit stage", () => {
    render(<StageRail state={stageMajor} timings={timings(WALK)} onSelect={noop} onRetry={noop} />);
    expect(screen.getByTestId("unit-progress-functional-design").textContent).toContain(
      "2 / 3 Unit 完了",
    );
    expect(screen.getByTestId("unit-progress-code-generation").textContent).toContain(
      "1 / 3 Unit 完了",
    );
    // A Unit that owed nothing for a stage is counted apart from the done ones.
    expect(screen.getByTestId("unit-progress-nfr-design").textContent).toContain(
      "1 / 3 Unit 完了 · 1 対象外",
    );
    expect(screen.queryByTestId("unit-progress-build-and-test")).toBeNull();
  });

  it("draws no Unit progress from a payload of a stage the workflow has left", () => {
    // The workflow read moved on before /api/timings refreshed.
    render(
      <StageRail
        state={stageMajor}
        timings={timings(WALK, "nfr-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByTestId("unit-progress-code-generation")).toBeNull();
  });

  it("draws one cell per Unit, in walk order, with symbol and Unit name", () => {
    render(<StageRail state={stageMajor} timings={timings(WALK)} onSelect={noop} onRetry={noop} />);
    const cells = within(screen.getByTestId("unit-progress-code-generation")).getAllByTestId(
      /^unit-cell-/,
    );
    expect(cells.map((cell) => [cell.textContent, cell.getAttribute("title")])).toEqual([
      ["✔", "u1: completed"],
      ["◐", "u2: in progress"],
      ["○", "u3: not started"],
    ]);
  });

  it("reads each Unit's status out to assistive technology", () => {
    render(<StageRail state={stageMajor} timings={timings(WALK)} onSelect={noop} onRetry={noop} />);
    // The cells are drawn aria-hidden; their statuses are written out once.
    expect(
      within(screen.getByTestId("unit-progress-code-generation")).getByTestId("unit-statuses")
        .textContent,
    ).toBe("u1: completed、u2: in progress、u3: not started");
  });

  it("names the Unit being worked on in the current stage's row", () => {
    render(<StageRail state={stageMajor} timings={timings(WALK)} onSelect={noop} onRetry={noop} />);
    const row = screen.getByTestId("stage-rail-item-code-generation");
    expect(row.getAttribute("aria-current")).toBe("step");
    expect(within(row).getByTestId("active-unit").textContent).toBe("Unit u2 を作業中");
  });

  it("says a paused Unit is paused", () => {
    const paused = model({
      constructionPolicy: POLICY,
      activeUnit: { unit: "u2", stage: "code-generation", state: "paused" },
    });
    render(<StageRail state={paused} timings={timings(WALK)} onSelect={noop} onRetry={noop} />);
    expect(screen.getByTestId("active-unit").textContent).toBe("Unit u2 を一時停止中");
  });

  it("keeps the plain rows until the Unit walk is known", () => {
    render(<StageRail state={stageMajor} timings={timings(null)} onSelect={noop} onRetry={noop} />);
    expect(screen.queryByTestId(/^unit-progress-/)).toBeNull();
    expect(screen.getByTestId("stage-rail-item-functional-design")).toBeDefined();
  });

  it("treats a workflow that never recorded an iteration as stage-major", () => {
    const unrecorded = model({ constructionPolicy: { ...POLICY, iterationRecorded: false } });
    render(<StageRail state={unrecorded} timings={timings(WALK)} onSelect={noop} onRetry={noop} />);
    expect(screen.getByTestId("unit-progress-functional-design")).toBeDefined();
    expect(screen.queryByTestId(/^unit-group-/)).toBeNull();
  });
});

describe("StageRail — unit-major Units (plan B)", () => {
  const unitMajorPolicy = { ...POLICY, unitMajor: true };
  // Under unit-major Current Stage stays on the first per-Unit stage.
  const unitMajor = model({
    constructionPolicy: unitMajorPolicy,
    currentStage: "functional-design",
    stages: [
      stage("units-generation", { phase: "INCEPTION", status: "completed" }),
      stage("functional-design", { status: "in-progress" }),
      stage("nfr-design"),
      stage("code-generation"),
      stage("build-and-test"),
      stage("ci-pipeline"),
    ],
    activeUnit: { unit: "u2", stage: "code-generation", state: "in-progress" },
  });

  it("groups the per-Unit stages by Unit in walk order, then the stages run once", () => {
    render(
      <StageRail
        state={unitMajor}
        timings={timings(WALK, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    const construction = screen.getByLabelText("CONSTRUCTION");
    expect(
      within(construction)
        .getAllByTestId(/^unit-group-/)
        .map((el) => el.getAttribute("data-testid")),
    ).toEqual(["unit-group-u1", "unit-group-u2", "unit-group-u3"]);
    expect(within(construction).queryByTestId("stage-rail-item-functional-design")).toBeNull();
    expect(within(construction).getByText("全 Unit の完了後に 1 回")).toBeDefined();
    expect(within(construction).getByTestId("stage-rail-item-build-and-test")).toBeDefined();
    expect(within(construction).getByTestId("stage-rail-item-ci-pipeline")).toBeDefined();
  });

  it("offers no switch between stage and Unit order", () => {
    render(
      <StageRail
        state={unitMajor}
        timings={timings(WALK, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByText("ステージ順")).toBeNull();
    expect(screen.queryByText("Unit 順")).toBeNull();
  });

  it("opens the Unit being worked on and marks its step as current", () => {
    render(
      <StageRail
        state={unitMajor}
        timings={timings(WALK, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId("unit-group-u2").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("unit-group-u1").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("unit-step-u1-functional-design")).toBeNull();
    const step = screen.getByTestId("unit-step-u2-code-generation");
    expect(step.getAttribute("aria-current")).toBe("step");
    expect(within(step).getByText("in progress")).toBeDefined();
    expect(screen.getByTestId("unit-step-u2-functional-design").getAttribute("aria-current")).toBe(
      null,
    );
    expect(
      within(screen.getByTestId("unit-group-u2")).getByText("3.5 code-generation を作業中"),
    ).toBeDefined();
  });

  it("shows each Unit's own status", () => {
    render(
      <StageRail
        state={unitMajor}
        timings={timings(WALK, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(within(screen.getByTestId("unit-group-u1")).getByText("completed")).toBeDefined();
    expect(within(screen.getByTestId("unit-group-u2")).getByText("in progress")).toBeDefined();
    expect(within(screen.getByTestId("unit-group-u3")).getByText("not started")).toBeDefined();
  });

  it("opens and closes a Unit, and selects a step's stage", async () => {
    const onSelect = vi.fn();
    render(
      <StageRail
        state={unitMajor}
        timings={timings(WALK, "functional-design")}
        onSelect={onSelect}
        onRetry={noop}
      />,
    );
    await userEvent.click(screen.getByTestId("unit-group-u1"));
    expect(screen.getByTestId("unit-group-u1").getAttribute("aria-expanded")).toBe("true");
    expect(
      within(screen.getByTestId("unit-step-u1-nfr-design")).getByText("skipped"),
    ).toBeDefined();
    await userEvent.click(screen.getByTestId("unit-step-u1-nfr-design"));
    expect(onSelect).toHaveBeenCalledWith("nfr-design");
    await userEvent.click(screen.getByTestId("unit-group-u2"));
    expect(screen.queryByTestId("unit-step-u2-code-generation")).toBeNull();
  });

  it("opens the first unfinished Unit between Units", () => {
    const between = model({ ...unitMajor.value, activeUnit: undefined });
    render(
      <StageRail
        state={between}
        timings={timings(WALK, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId("unit-group-u2").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("unit-group-u3").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps one tab stop across groups and steps, and moves with the arrows", async () => {
    render(
      <StageRail
        state={unitMajor}
        timings={timings(WALK, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    const focusables = screen
      .getAllByRole("button")
      .filter((el) => /^(stage-rail-item|unit-group|unit-step)-/.test(el.dataset.testid ?? ""));
    expect(focusables.filter((el) => el.tabIndex === 0)).toHaveLength(1);
    screen.getByTestId("unit-group-u2").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("unit-step-u2-functional-design"));
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByTestId("unit-group-u1"));
  });

  it("takes the open Unit from the walk it is drawn with, not a newer workflow read", () => {
    // The workflow already moved to u3; the walk in hand still has u2 open.
    const newer = model({
      ...unitMajor.value,
      activeUnit: { unit: "u3", stage: "functional-design", state: "in-progress" },
    });
    const walk = {
      ...WALK,
      activeUnit: { unit: "u2", stage: "code-generation", state: "in-progress" as const },
    };
    render(
      <StageRail
        state={newer}
        timings={timings(walk, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByTestId("unit-group-u2").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("unit-group-u3").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("unit-step-u2-code-generation").getAttribute("aria-current")).toBe(
      "step",
    );
  });

  it("lists the stage approvals still open once every Unit is done", () => {
    const done = walkOf({ u1: [OK, SK, OK], u2: [OK, OK, OK] });
    const gates = model({
      ...unitMajor.value,
      activeUnit: undefined,
      stages: [
        stage("units-generation", { phase: "INCEPTION", status: "completed" }),
        stage("functional-design", { status: "awaiting-approval" }),
        stage("nfr-design"),
        stage("code-generation"),
        stage("build-and-test"),
      ],
    });
    render(
      <StageRail
        state={gates}
        timings={timings(done, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    const construction = screen.getByLabelText("CONSTRUCTION");
    expect(within(construction).getByText("ステージごとの承認")).toBeDefined();
    const gate = within(construction).getByTestId("stage-rail-item-functional-design");
    expect(gate.getAttribute("aria-current")).toBe("step");
    expect(within(gate).getByText("awaiting approval")).toBeDefined();
    expect(within(construction).getByTestId("stage-rail-item-code-generation")).toBeDefined();
  });

  it("lists no stage approvals while a Unit is still working", () => {
    render(
      <StageRail
        state={unitMajor}
        timings={timings(WALK, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByText("ステージごとの承認")).toBeNull();
  });

  it("falls back to the plain rows until the Unit walk is known", () => {
    render(
      <StageRail
        state={unitMajor}
        timings={timings(null, "functional-design")}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByTestId(/^unit-group-/)).toBeNull();
    expect(screen.getByTestId("stage-rail-item-functional-design")).toBeDefined();
    expect(screen.getByTestId("construction-iteration").textContent).toBe("進め方: unit-major");
  });
});
