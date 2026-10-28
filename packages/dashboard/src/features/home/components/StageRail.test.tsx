import { render, screen, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StageRail } from "@/features/home/components/StageRail.tsx";
import { stage, workflow } from "@tests/fixtures.ts";

const noop = (): void => {};

describe("StageRail (FR-4.2 / FR-4.5)", () => {
  const state = { kind: "success", value: workflow() } as const;

  it("starts a finished phase closed to its summary and opens it on request", async () => {
    render(<StageRail state={state} onSelect={noop} onRetry={noop} />);
    const toggle = screen.getByTestId("stage-rail-phase-IDEATION");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("完了 1 / 1");
    expect(toggle.textContent).toContain("スキップ 2");
    expect(screen.queryByTestId("stage-rail-item-intent-capture")).toBeNull();

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("stage-rail-item-intent-capture")).toBeDefined();
  });

  it("heads each phase with a level-3 heading holding its toggle", () => {
    render(<StageRail state={state} onSelect={noop} onRetry={noop} />);
    const heading = screen.getByRole("heading", { level: 3, name: /Ideation/ });
    expect(within(heading).getByTestId("stage-rail-phase-IDEATION")).toBeDefined();
  });

  it("counts a run stage that was skipped as done in the phase summary", () => {
    const value = workflow({
      currentStage: "code-generation",
      stages: [
        stage("intent-capture", { phase: "IDEATION", status: "completed" }),
        stage("feasibility", { phase: "IDEATION", status: "skipped" }),
        stage("code-generation", { status: "awaiting-approval" }),
      ],
    });
    render(<StageRail state={{ kind: "success", value }} onSelect={noop} onRetry={noop} />);
    const toggle = screen.getByTestId("stage-rail-phase-IDEATION");
    expect(toggle.textContent).toContain("完了 2 / 2");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps SKIP stages inline in server order with stage numbers", async () => {
    render(<StageRail state={state} onSelect={noop} onRetry={noop} />);
    expect(screen.queryByTestId("skip-group")).toBeNull();
    await userEvent.click(screen.getByTestId("stage-rail-phase-IDEATION"));

    const ideation = screen.getByLabelText("IDEATION");
    const labels = within(ideation)
      .getAllByRole("button")
      .filter((el) => el.getAttribute("data-testid")?.startsWith("stage-rail-item-") === true)
      .map((el) => el.textContent ?? "");
    expect(labels[0]).toContain("1.1 intent-capture");
    expect(labels[1]).toContain("1.2 market-research");
    expect(labels[2]).toContain("1.3 feasibility");
    expect(
      within(screen.getByTestId("stage-rail-item-market-research")).getByText("skipped"),
    ).toBeDefined();
  });

  it("keeps exactly one item in the tab order and moves focus with the arrows", async () => {
    render(<StageRail state={state} onSelect={noop} onRetry={noop} />);
    await userEvent.click(screen.getByTestId("stage-rail-phase-IDEATION"));
    const items = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("data-testid")?.startsWith("stage-rail-item-") === true);
    expect(items.filter((el) => el.tabIndex === 0)).toHaveLength(1);

    const first = screen.getByTestId("stage-rail-item-intent-capture");
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("stage-rail-item-market-research"));

    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(first);
    // Still exactly one tabbable item after moving.
    expect(items.filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });

  it("does not move past the ends of the rail", async () => {
    render(<StageRail state={state} onSelect={noop} onRetry={noop} />);
    await userEvent.click(screen.getByTestId("stage-rail-phase-IDEATION"));
    const first = screen.getByTestId("stage-rail-item-intent-capture");
    first.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(first);

    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByTestId("stage-rail-item-build-and-test"));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("stage-rail-item-build-and-test"));
  });

  it("selects with the mouse and marks the current stage", async () => {
    const onSelect = vi.fn();
    render(<StageRail state={state} onSelect={onSelect} onRetry={noop} />);
    await userEvent.click(screen.getByTestId("stage-rail-item-code-generation"));
    expect(onSelect).toHaveBeenCalledWith("code-generation");
    expect(screen.getByTestId("stage-rail-item-code-generation").getAttribute("aria-current")).toBe(
      "step",
    );
  });

  describe("Construction iteration", () => {
    const withIteration = (recorded: boolean, unitMajor: boolean) =>
      ({
        kind: "success",
        value: workflow({
          constructionPolicy: {
            checkpoints: false,
            unitMajor,
            iterationRecorded: recorded,
            swarm: false,
            autonomous: false,
            teamOwnership: false,
            unitEndRhythm: false,
            skeletonStanceRecorded: false,
            skeletonMayRun: false,
          },
        }),
      }) as const;

    it.each([
      [true, "進め方: unit-major"],
      [false, "進め方: stage-major"],
    ])("labels the CONSTRUCTION section with the recorded iteration", (unitMajor, text) => {
      render(<StageRail state={withIteration(true, unitMajor)} onSelect={noop} onRetry={noop} />);
      const construction = screen.getByLabelText("CONSTRUCTION");
      expect(within(construction).getByTestId("construction-iteration").textContent).toBe(text);
      expect(
        within(screen.getByLabelText("IDEATION")).queryByTestId("construction-iteration"),
      ).toBeNull();
    });

    it("shows nothing when the state file records no iteration", () => {
      render(<StageRail state={withIteration(false, false)} onSelect={noop} onRetry={noop} />);
      expect(screen.queryByTestId("construction-iteration")).toBeNull();
    });

    it("shows nothing for a model without a construction policy", () => {
      render(<StageRail state={state} onSelect={noop} onRetry={noop} />);
      expect(screen.queryByTestId("construction-iteration")).toBeNull();
    });
  });

  it("shows an unparseable stage as unparseable rather than dropping it", () => {
    const degraded = workflow();
    const target = degraded.stages.find((stage) => stage.slug === "build-and-test");
    if (target === undefined) throw new Error("fixture changed");
    target.unparseable = "unknown mark [~]";
    render(
      <StageRail
        state={{ kind: "partial", value: degraded, notes: [] }}
        onSelect={noop}
        onRetry={noop}
      />,
    );
    const item = screen.getByTestId("stage-rail-item-build-and-test");
    expect(within(item).getByText("unparseable")).toBeDefined();
    expect(screen.queryByText(/unknown mark \[~\]/)).toBeNull();
  });

  it("renders stage purposes when supplied (visible from 48rem via CSS)", () => {
    render(
      <StageRail
        state={state}
        onSelect={noop}
        onRetry={noop}
        purposes={{ "code-generation": "ユニット仕様に沿って実装を書く。" }}
      />,
    );
    expect(screen.getByTestId("stage-rail-purpose-code-generation").textContent).toBe(
      "ユニット仕様に沿って実装を書く。",
    );
    expect(screen.queryByTestId("stage-rail-purpose-intent-capture")).toBeNull();
  });
});
