import { act, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app/App.tsx";
import { StoreProvider } from "@/store/context.tsx";
import { initialState } from "@/store/state.ts";
import { matrix, payload, stageDoc, workflow } from "@tests/fixtures.ts";
import TourOverlay from "./TourOverlay.tsx";
import { ANCHOR_TIMEOUT_MS } from "./useTourAnchor.ts";

/**
 * The tour points at real screens, so it is tested against the real App:
 * every step must find its element in the rendered dashboard. A renamed test
 * id or a moved section fails here instead of silently showing a card that
 * points at nothing.
 */

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input === "/api/workflow") return Response.json(payload());
      if (input.includes("/api/matrix")) return Response.json({ ok: true, value: matrix() });
      if (input === "/api/intents")
        return Response.json({
          ok: true,
          value: { space: "default", active: "a", all: ["a"], selected: "a" },
        });
      if (input.includes("/api/stage/"))
        return Response.json({ ok: true, value: stageDoc({ slug: input.split("/").at(-1) }) });
      if (input.includes("/api/links")) return Response.json({ ok: true, value: [] });
      return Response.json({ error: true, reason: "not_found" }, { status: 404 });
    }),
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      close(): void {}
    },
  );
}

beforeEach(stubApi);
afterEach(() => {
  vi.unstubAllGlobals();
});

async function startTour() {
  const user = userEvent.setup();
  render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);
  await screen.findByTestId("stage-rail-item-code-generation");
  await user.click(screen.getByRole("button", { name: "メニュー" }));
  await user.click(await screen.findByRole("menuitem", { name: "はじめに" }));
  const [start] = await screen.findAllByRole("button", { name: "画面を順に案内してもらう" });
  await user.click(start as HTMLElement);
  return user;
}

async function card(title: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog", { name: title });
  await waitFor(() => expect(dialog.getAttribute("data-anchor")).toBe("found"));
  return dialog;
}

describe("guided tour", () => {
  it("points at each real screen element, opening the stage on the way", async () => {
    const user = await startTour();

    const intent = await card("表示する作業を選ぶ");
    expect(within(intent).getByText("1 / 6")).toBeDefined();
    expect(screen.getByTestId("tour-spotlight")).toBeDefined();
    await user.click(within(intent).getByRole("button", { name: "次へ" }));

    const now = await card("いまの工程を知る");
    await user.click(within(now).getByRole("button", { name: "次へ" }));

    const rail = await card("工程の一覧");
    await user.click(within(rail).getByRole("button", { name: "次へ" }));

    const gate = await card("承認で確認すること");
    expect(await screen.findByTestId("detail-panel")).toBeDefined();
    await user.click(within(gate).getByRole("button", { name: "次へ" }));

    const outputs = await card("AIが作る成果物");
    await user.click(within(outputs).getByRole("button", { name: "戻る" }));
    const back = await card("承認で確認すること");
    await user.click(within(back).getByRole("button", { name: "次へ" }));
    const again = await card("AIが作る成果物");
    await user.click(within(again).getByRole("button", { name: "次へ" }));

    const menu = await card("困ったときはメニューから");
    await user.click(within(menu).getByRole("button", { name: "完了" }));
    await waitFor(() => expect(screen.queryByTestId("tour-spotlight")).toBeNull());
    expect(screen.queryByTestId("detail-panel")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-testid")).toBe("header-menu-trigger"),
    );
  });

  it("ends with Escape at any step", async () => {
    const user = await startTour();
    await card("表示する作業を選ぶ");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("tour-spotlight")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can be left from its own button", async () => {
    const user = await startTour();
    const intent = await card("表示する作業を選ぶ");
    await user.click(within(intent).getByRole("button", { name: "ツアーを終了" }));
    await waitFor(() => expect(screen.queryByTestId("tour-spotlight")).toBeNull());
  });
});

describe("guided tour without its elements", () => {
  it("keeps a readable card in the middle when a step's element never appears", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(
        <StoreProvider
          preloaded={{
            workflow: { kind: "success", value: workflow() },
            onboarding: { ...initialState.onboarding, tour: true },
          }}
        >
          <TourOverlay />
        </StoreProvider>,
      );
      // No header is rendered, so the first step has nothing to point at.
      await act(async () => {
        vi.advanceTimersByTime(ANCHOR_TIMEOUT_MS);
      });
      const dialog = screen.getByRole("dialog", { name: "表示する作業を選ぶ" });
      expect(dialog.getAttribute("data-anchor")).toBe("missing");
      expect(dialog.textContent).toContain("この画面では対象の場所を表示できませんでした");
      expect(within(dialog).getByRole("button", { name: "次へ" })).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
