import type { ActiveUnit, UnitWalk } from "@aidlc-guide/shared-types";
import { render, screen } from "@tests/render.tsx";
import { describe, expect, it } from "vitest";
import { NowStrip } from "@/shell/now-strip/NowStrip.tsx";
import { workflow } from "@tests/fixtures.ts";

function strip(
  activeUnit: ActiveUnit | undefined,
  currentStage = "functional-design",
  unitWalk?: UnitWalk | null,
) {
  return render(
    <NowStrip
      state={{ kind: "success", value: workflow({ currentStage, activeUnit }) }}
      onRetry={() => {}}
      expanded={false}
      unitWalk={unitWalk}
    />,
  );
}

describe("NowStrip — the open Unit", () => {
  it("names the Unit and the step it is on when that is not Current Stage", () => {
    // unit-major keeps Current Stage on the first per-Unit stage.
    strip({ unit: "u2-note-tags", stage: "code-generation", state: "in-progress" });
    expect(screen.getByTestId("now-active-unit").textContent).toBe(
      "作業中の Unit: u2-note-tags · 3.5 code-generation",
    );
  });

  it("names only the Unit when it is on Current Stage", () => {
    strip({ unit: "u1", stage: "code-generation", state: "in-progress" }, "code-generation");
    expect(screen.getByTestId("now-active-unit").textContent).toBe("作業中の Unit: u1");
  });

  it("says a paused Unit is paused", () => {
    strip({ unit: "u1", stage: null, state: "paused" });
    expect(screen.getByTestId("now-active-unit").textContent).toBe("一時停止中の Unit: u1");
  });

  it("follows the audit-derived walk over the state file's cache", () => {
    // The Unit's finishing receipt landed but the cache was not cleared.
    const walk: UnitWalk = { stages: [], units: [], byStage: [], activeUnit: null };
    strip({ unit: "u1", stage: "functional-design", state: "in-progress" }, undefined, walk);
    expect(screen.queryByTestId("now-active-unit")).toBeNull();
  });

  it("shows nothing between Units", () => {
    strip(undefined);
    expect(screen.queryByTestId("now-active-unit")).toBeNull();
  });
});
