import { render } from "@tests/render.tsx";
import { describe, expect, it } from "vitest";
import { CHIP_STATUSES, STATUS_PRESENTATION, StatusChip } from "@/shared/ui/StatusChip.tsx";

describe("StatusChip (US-18 / BR-UI-2)", () => {
  it("covers exactly the seven rows of the design-system triple-representation table", () => {
    expect(CHIP_STATUSES).toEqual([
      "completed",
      "in-progress",
      "awaiting-approval",
      "revising",
      "not-started",
      "skipped",
      "unparseable",
    ]);
  });

  it.each(CHIP_STATUSES)("renders colour token, symbol and label for %s", (status) => {
    const { container } = render(<StatusChip status={status} />);
    const chip = container.querySelector(".chip");
    const expected = STATUS_PRESENTATION[status];

    // Colour: the token is in the DOM, both as the applied custom property and
    // as an attribute, so greyscale review and tests see the same thing.
    expect(chip?.getAttribute("style")).toContain(expected.token);
    expect(chip?.getAttribute("data-token")).toBe(expected.token);
    // Symbol and text label are both present — never colour alone.
    expect(chip?.querySelector(".chip__symbol")?.textContent).toBe(expected.symbol);
    expect(chip?.querySelector(".chip__label")?.textContent).toBe(expected.label);
  });

  it("gives revising its own purple token and ◑ symbol", () => {
    expect(STATUS_PRESENTATION.revising).toEqual({
      token: "--color-status-revising",
      symbol: "◑",
      label: "revising",
    });
  });
});
