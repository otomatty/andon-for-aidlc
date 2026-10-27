import { render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { adjacentStages, DetailPanel } from "@/features/stage/StagePage.tsx";
import { StoreProvider, useDispatch } from "@/store/context.tsx";
import type { AppState } from "@/store/state.ts";
import { matrix, nextStep, stageDoc, workflow } from "@tests/fixtures.ts";

/**
 * C-2 / a11y checklist 2.1.2: the panel is **non-modal**. It must move focus
 * in, restore it on close, and never hold focus captive.
 */

const preloaded: Partial<AppState> = {
  workflow: { kind: "success", value: workflow() },
  nextStep: { kind: "success", value: nextStep() },
  stageDoc: {
    "code-generation": { kind: "success", value: stageDoc() },
    "build-and-test": {
      kind: "success",
      value: stageDoc({
        slug: "build-and-test",
        purpose: "ビルドとテストを確認する。",
        gateRequirement: "コードとテストの承認",
      }),
    },
  },
};

function Harness(): ReactNode {
  const dispatch = useDispatch();
  return (
    <>
      <button
        type="button"
        data-testid="trigger"
        onClick={() => {
          dispatch({ type: "select", selection: { kind: "stage", slug: "code-generation" } });
        }}
      >
        code-generation を開く
      </button>
      <button type="button" data-testid="outside">
        別の操作
      </button>
      <DetailPanel />
    </>
  );
}

function setup(): void {
  render(
    <StoreProvider preloaded={preloaded}>
      <Harness />
    </StoreProvider>,
  );
}

describe("DetailPanel", () => {
  it("moves focus to the heading when it opens", async () => {
    setup();
    await userEvent.click(screen.getByTestId("trigger"));
    const heading = screen.getByRole("heading", { name: /3\.5 code-generation/, level: 2 });
    expect(document.activeElement).toBe(heading);
  });

  it("shows the stage status in the panel header", async () => {
    setup();
    await userEvent.click(screen.getByTestId("trigger"));
    const heading = screen.getByRole("heading", { level: 2 });
    const chip = within(heading).getByText("awaiting approval");
    expect(chip.closest("[data-status]")?.getAttribute("data-status")).toBe("awaiting-approval");
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    setup();
    const trigger = screen.getByTestId("trigger");
    await userEvent.click(trigger);
    expect(screen.getByTestId("detail-panel")).toBeDefined();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("detail-panel")).toBeNull();
    // Radix restores focus on the next macrotask after unmount.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("is not a modal: no aria-modal, and focus may leave the panel", async () => {
    setup();
    await userEvent.click(screen.getByTestId("trigger"));
    const panel = screen.getByTestId("detail-panel");
    expect(panel.hasAttribute("aria-modal")).toBe(false);
    expect(panel.getAttribute("role")).toBeNull(); // <aside> = complementary

    // A focus trap would yank focus back; a non-modal panel lets it go.
    const outside = screen.getByTestId("outside");
    outside.focus();
    expect(document.activeElement).toBe(outside);
    expect(screen.getByTestId("detail-panel")).toBeDefined();
  });

  it("switches between overview and timing without a next-step callout", async () => {
    setup();
    await userEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByRole("tab", { name: "概要" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "概要" }).textContent).toContain("目的");
    expect(screen.queryByRole("tabpanel", { name: "時間" })).toBeNull();
    expect(screen.queryByTestId("next-step-callout")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "時間" }));
    expect(screen.getByRole("tabpanel", { name: "時間" }).textContent).toContain("時間の内訳");
    expect(screen.queryByRole("tabpanel", { name: "概要" })).toBeNull();

    await userEvent.keyboard("{ArrowLeft}{Enter}");
    expect(screen.getByRole("tab", { name: "概要" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "概要" }).textContent).toContain("目的");
    expect(screen.queryByRole("tabpanel", { name: "時間" })).toBeNull();
  });

  it("shows a local error inside the panel without taking the page down", async () => {
    render(
      <StoreProvider
        preloaded={{
          ...preloaded,
          stageDoc: { "code-generation": { kind: "error", detail: "解説が見つかりません" } },
        }}
      >
        <Harness />
      </StoreProvider>,
    );
    await userEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByText("解説が見つかりません")).toBeDefined();
    expect(screen.getByTestId("trigger")).toBeDefined();
  });

  it("shows only the selected stage's parse errors, even when its explanation fails", async () => {
    const degraded = workflow();
    degraded.stages = degraded.stages.map((stage) => ({
      ...stage,
      ...(stage.slug === "code-generation"
        ? { unparseable: 'unknown-mark: "~"; unknown-execution: RUN' }
        : stage.slug === "build-and-test"
          ? { unparseable: 'unknown-mark: "?"' }
          : {}),
    }));
    render(
      <StoreProvider
        preloaded={{
          ...preloaded,
          workflow: { kind: "partial", value: degraded, notes: [] },
          stageDoc: { "code-generation": { kind: "error", detail: "解説が見つかりません" } },
        }}
      >
        <Harness />
      </StoreProvider>,
    );
    await userEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByText(/unknown-mark: "~"; unknown-execution: RUN/)).toBeDefined();
    expect(screen.queryByText(/unknown-mark: "\?"/)).toBeNull();
    expect(screen.getByText("解説が見つかりません")).toBeDefined();
    await userEvent.click(screen.getByTestId("panel-next-stage"));
    expect(screen.getByText(/unknown-mark: "\?"/)).toBeDefined();
    expect(screen.queryByText(/unknown-execution: RUN/)).toBeNull();
  });

  it("moves to the previous and next stage in workflow order", async () => {
    setup();
    await userEvent.click(screen.getByTestId("trigger"));

    await userEvent.click(screen.getByRole("tab", { name: "時間" }));
    expect(screen.getByRole("tabpanel", { name: "時間" }).textContent).toContain("時間の内訳");

    await userEvent.click(screen.getByTestId("panel-next-stage"));
    expect(screen.getByRole("heading", { name: /3\.6 build-and-test/, level: 2 })).toBeDefined();
    expect(screen.getByRole("tab", { name: "概要" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "概要" }).textContent).toContain(
      "コードとテストの承認",
    );
    expect((screen.getByTestId("panel-next-stage") as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByTestId("panel-prev-stage"));
    expect(screen.getByRole("heading", { name: /3\.5 code-generation/, level: 2 })).toBeDefined();

    await userEvent.click(screen.getByTestId("panel-prev-stage"));
    expect(screen.getByRole("heading", { name: /3\.1 functional-design/, level: 2 })).toBeDefined();
  });

  it("disables previous on the first stage", async () => {
    render(
      <StoreProvider
        preloaded={{
          ...preloaded,
          route: { name: "stage", slug: "intent-capture" },
          stageDoc: {
            "intent-capture": { kind: "success", value: stageDoc({ slug: "intent-capture" }) },
          },
        }}
      >
        <DetailPanel />
      </StoreProvider>,
    );
    expect((screen.getByTestId("panel-prev-stage") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("panel-next-stage") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("DetailPanel back navigation", () => {
  it("returns to the list from the button before the status without a close button or list dialog", async () => {
    setup();
    await userEvent.click(screen.getByTestId("trigger"));
    const panel = screen.getByTestId("detail-panel");
    const back = within(panel).getByRole("button", { name: "ステージ一覧に戻る" });
    const chip = within(panel).getByText("awaiting approval");
    expect(back.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "閉じる" })).toBeNull();
    expect(screen.queryByTestId("panel-stage-list")).toBeNull();
    expect(screen.queryByTestId("stage-rail-dialog")).toBeNull();
    await userEvent.click(back);
    expect(screen.queryByTestId("detail-panel")).toBeNull();
  });
});

describe("adjacentStages", () => {
  it("returns neighbors from the server array order", () => {
    const stages = workflow().stages;
    expect(adjacentStages(stages, "code-generation")).toEqual({
      prev: "functional-design",
      next: "build-and-test",
    });
    expect(adjacentStages(stages, "intent-capture")).toEqual({
      prev: null,
      next: "market-research",
    });
    expect(adjacentStages(stages, "build-and-test")).toEqual({
      prev: "code-generation",
      next: null,
    });
    expect(adjacentStages(stages, "missing")).toEqual({ prev: null, next: null });
  });
});

/**
 * The cross-unit seam: a matrix cell selection opens that cell's artifacts,
 * from the `MatrixCell.files` the server already sent. The viewer arrives
 * through `React.lazy` (P-AV-1), so this also proves the split point resolves.
 */
describe("DetailPanel — matrix cell selection (US-13)", () => {
  function CellHarness(): ReactNode {
    const dispatch = useDispatch();
    return (
      <>
        <button
          type="button"
          data-testid="open-cell"
          onClick={() => {
            dispatch({
              type: "select",
              selection: { kind: "cell", unit: "reader-core", stage: "nfr-design" },
            });
          }}
        >
          セルを開く
        </button>
        <DetailPanel />
      </>
    );
  }

  it("lazily mounts the artifact viewer with the cell's own file list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, value: "# 論理コンポーネント" }))),
    );
    render(
      <StoreProvider preloaded={{ ...preloaded, matrix: { kind: "success", value: matrix() } }}>
        <CellHarness />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-cell"));

    // The stage explanation stays; the viewer is added below it.
    await waitFor(() => {
      expect(screen.getByTestId("artifact-viewer")).toBeDefined();
    });
    expect(
      screen.getByRole("tab", { name: "logical-components.md" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "performance-design.md" })).toBeDefined();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "論理コンポーネント" })).toBeDefined();
    });
    vi.unstubAllGlobals();
  });

  it("shows no viewer for a stage selection with no artifacts", async () => {
    setup();
    await userEvent.click(screen.getByTestId("trigger"));
    expect(screen.queryByTestId("artifact-viewer")).toBeNull();
  });
});

describe("DetailPanel — stage selection with artifacts", () => {
  function StageHarness({ slug }: { slug: string }): ReactNode {
    const dispatch = useDispatch();
    return (
      <>
        <button
          type="button"
          data-testid="open-stage"
          onClick={() => {
            dispatch({ type: "select", selection: { kind: "stage", slug } });
          }}
        >
          ステージを開く
        </button>
        <DetailPanel />
      </>
    );
  }

  it("auto-opens the sole unit that has artifacts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, value: "# 業務ルール" }))),
    );
    render(
      <StoreProvider
        preloaded={{
          ...preloaded,
          matrix: { kind: "success", value: matrix() },
          stageDoc: {
            "functional-design": {
              kind: "success",
              value: stageDoc({ slug: "functional-design" }),
            },
          },
        }}
      >
        <StageHarness slug="functional-design" />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-stage"));
    await waitFor(() => {
      expect(screen.getByTestId("artifact-viewer")).toBeDefined();
    });
    expect(screen.queryByTestId("unit-tabs")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "business-rules.md" }).getAttribute("aria-selected"),
    ).toBe("true");
    vi.unstubAllGlobals();
  });

  it("offers unit tabs when several units have artifacts", async () => {
    const multi = matrix({
      cells: [
        {
          unit: "reader-core",
          stage: "functional-design",
          files: ["business-rules.md"],
          verdict: "READY",
        },
        {
          unit: "mcp-server",
          stage: "functional-design",
          files: ["api-contract.md"],
          verdict: null,
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = decodeURIComponent(new URL(url, "http://x").searchParams.get("path") ?? "");
        const body = path.includes("mcp-server")
          ? { ok: true, value: "# API" }
          : { ok: true, value: "# 業務ルール" };
        return new Response(JSON.stringify(body));
      }),
    );
    render(
      <StoreProvider
        preloaded={{
          ...preloaded,
          matrix: { kind: "success", value: multi },
          stageDoc: {
            "functional-design": {
              kind: "success",
              value: stageDoc({ slug: "functional-design" }),
            },
          },
        }}
      >
        <StageHarness slug="functional-design" />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-stage"));
    await waitFor(() => {
      expect(screen.getByTestId("unit-tabs")).toBeDefined();
    });
    expect(screen.getByRole("tab", { name: "reader-core" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "業務ルール" })).toBeDefined();
    });

    await userEvent.click(screen.getByRole("tab", { name: "mcp-server" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "API" })).toBeDefined();
    });
    expect(screen.getByRole("tab", { name: "api-contract.md" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    vi.unstubAllGlobals();
  });
});
