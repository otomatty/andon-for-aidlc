import { render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UnitStageMatrix } from "@/features/home/components/UnitStageMatrix.tsx";
import { matrix } from "@tests/fixtures.ts";

const noop = (): void => {};

describe("UnitStageMatrix (FR-4.3)", () => {
  const renderMatrix = (): void => {
    render(
      <UnitStageMatrix
        state={{ kind: "success", value: matrix() }}
        onSelectCell={noop}
        onRetry={noop}
      />,
    );
  };

  it("draws a present cell with no files as empty (·), not as out-of-scope", () => {
    renderMatrix();
    const cell = screen.getByTestId("matrix-cell-mcp-server-functional-design");
    expect(cell.getAttribute("data-kind")).toBe("empty");
    expect(cell.textContent).toContain("·");
    expect(within(cell).getByText("空（成果物 0 件）")).toBeDefined();
  });

  it("draws a missing intersection as out-of-scope (—)", () => {
    renderMatrix();
    const cell = screen.getByTestId("matrix-cell-mcp-server-nfr-design");
    expect(cell.getAttribute("data-kind")).toBe("out-of-scope");
    expect(cell.textContent).toContain("—");
    expect(within(cell).getByText("対象外")).toBeDefined();
  });

  it("prints the server's file count and verdict verbatim (BR-UI-3)", () => {
    renderMatrix();
    const cell = screen.getByTestId("matrix-cell-reader-core-functional-design");
    expect(cell.textContent).toContain("4 件");
    expect(cell.textContent).toContain("READY");
  });

  it("surfaces a cell-level error instead of showing the cell as empty", () => {
    const degraded = matrix();
    degraded.cells.push({
      unit: "mcp-server",
      stage: "nfr-design",
      files: [],
      verdict: null,
      error: "読めません",
    });
    render(
      <UnitStageMatrix
        state={{ kind: "partial", value: degraded, notes: ["mcp-server / nfr-design: 読めません"] }}
        onSelectCell={noop}
        onRetry={noop}
      />,
    );
    const cell = screen.getByTestId("matrix-cell-mcp-server-nfr-design");
    expect(cell.getAttribute("data-kind")).toBe("error");
    expect(cell.textContent).toContain("読めません");
  });

  it("reports the row and column headers as a real table", () => {
    renderMatrix();
    expect(screen.getByRole("rowheader", { name: "reader-core" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "3.3 nfr-design" })).toBeDefined();
  });

  it("opens the legend in a dialog", async () => {
    renderMatrix();
    expect(screen.queryByTestId("legend-dialog")).toBeNull();
    await userEvent.click(screen.getByTestId("legend-open"));
    const dialog = screen.getByRole("dialog", { name: "凡例" });
    expect(within(dialog).getByText("completed")).toBeDefined();
    expect(within(dialog).getByText("対象外（このユニットに無いステージ）")).toBeDefined();
  });

  it("reaches the scrollable legend by keyboard and returns focus after closing", async () => {
    renderMatrix();
    const trigger = screen.getByTestId("legend-open");
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "凡例" });
    const close = within(dialog).getByRole("button", { name: "閉じる" });

    const legend = within(dialog).getByRole("list", { name: "ステージ状態の凡例一覧" });

    close.focus();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(legend);
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "凡例" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
