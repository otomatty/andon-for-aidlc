import type { OnboardingRecord } from "@aidlc-guide/shared-types";
import { render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WelcomePage from "@/features/onboarding/WelcomePage.tsx";
import { StoreProvider, useAppState } from "@/store/context.tsx";
import type { AppState } from "@/store/state.ts";
import { initialState } from "@/store/state.ts";
import { workflow } from "@tests/fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function webview(): unknown[] {
  const posted: unknown[] = [];
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage: (message: unknown) => posted.push(message),
  }));
  return posted;
}

function onboarding(record: Partial<OnboardingRecord> | null): AppState["onboarding"] {
  return {
    ...initialState.onboarding,
    version: record === null ? null : "0.35.0",
    record:
      record === null
        ? null
        : { version: "0.35.0", welcome: "done", seenNews: [], dismissedTips: [], ...record },
  };
}

function Probe(): ReactNode {
  const state = useAppState();
  return (
    <div data-testid="probe" hidden>
      {JSON.stringify({
        route: state.route.name,
        tour: state.onboarding.tour,
        sheet: state.onboarding.whatsNew.open,
        welcome: state.onboarding.record?.welcome ?? null,
        tips: state.onboarding.record?.dismissedTips ?? null,
      })}
    </div>
  );
}

function probe(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as Record<string, unknown>;
}

function renderWelcome(preloaded: Partial<AppState> = {}) {
  return render(
    <StoreProvider
      preloaded={{
        route: { name: "welcome" },
        workflow: { kind: "success", value: workflow() },
        ...preloaded,
      }}
    >
      <WelcomePage />
      <Probe />
    </StoreProvider>,
  );
}

describe("はじめに page", () => {
  it("introduces the three basics with real screenshots and honest captions", () => {
    renderWelcome();
    const page = screen.getByRole("main", { name: "はじめに" });
    expect(
      within(page).getByRole("heading", {
        level: 1,
        name: "AIと進める開発の、現在地と次の一手がわかる。",
      }),
    ).toBeDefined();
    const basics = within(page).getByRole("region", { name: "まず押さえる3つのこと" });
    const figures = within(basics).getAllByRole("figure");
    expect(figures).toHaveLength(3);
    for (const figure of figures)
      expect(within(figure).getByRole("img").getAttribute("alt")).not.toBe("");
    expect(
      within(basics).getByText(
        /完了した案件の表示例です。あなたのプロジェクトの状態ではありません。/,
      ),
    ).toBeDefined();
    expect(within(page).getByText(/2026年10月30日時点の実際の画面です/)).toBeDefined();
  });

  it("focuses its heading so keyboard and screen reader users start at the top", () => {
    renderWelcome();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("offers the guided tour when there is a workflow to show", async () => {
    renderWelcome();
    const [first] = screen.getAllByRole("button", { name: "画面を順に案内してもらう" });
    await userEvent.click(first as HTMLElement);
    expect(probe()).toMatchObject({ tour: true });
  });

  it("returns to the stage list from the secondary action", async () => {
    renderWelcome();
    const [first] = screen.getAllByRole("button", { name: "ステージ一覧へ" });
    await userEvent.click(first as HTMLElement);
    expect(probe()).toMatchObject({ route: "home" });
  });

  it("leads a project without work to the start form", async () => {
    renderWelcome({
      workflow: { kind: "empty", hint: "まだありません", reason: "no-active-intent" },
    });
    expect(screen.queryByRole("button", { name: "画面を順に案内してもらう" })).toBeNull();
    const [start] = screen.getAllByRole("button", { name: "最初の作業を始める" });
    await userEvent.click(start as HTMLElement);
    expect(probe()).toMatchObject({ route: "home" });
  });

  it("falls back to the stage list while the workflow cannot be read", () => {
    renderWelcome({ workflow: { kind: "error", detail: "x" } });
    expect(screen.getAllByRole("button", { name: "ステージ一覧へ" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "最初の作業を始める" })).toBeNull();
  });

  it("moves to the basics when asked how to read the screen", async () => {
    renderWelcome();
    await userEvent.click(screen.getByRole("button", { name: "画面の見方を見る" }));
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 2, name: "まず押さえる3つのこと" }),
    );
  });

  it("enlarges a screenshot, restores focus after Escape, and can reopen and close", async () => {
    renderWelcome();
    const [enlarge] = screen.getAllByRole("button", { name: /拡大して表示/ });
    await userEvent.click(enlarge as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "今どこまで進んだか、ひと目で確認" });
    expect(within(dialog).getByRole("img").getAttribute("alt")).not.toBe("");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(enlarge));
    await userEvent.keyboard("{Enter}");
    const reopened = await screen.findByRole("dialog", {
      name: "今どこまで進んだか、ひと目で確認",
    });
    await userEvent.click(within(reopened).getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(enlarge));
  });

  it("opens an on-demand feature from its introduction", async () => {
    renderWelcome();
    const more = screen.getByRole("region", { name: "必要になったら使う機能" });
    await userEvent.click(within(more).getByRole("button", { name: /効果測定/ }));
    await userEvent.click(await within(more).findByRole("button", { name: "効果測定を開く" }));
    expect(probe()).toMatchObject({ route: "effectiveness" });
  });

  it("introduces the plugins page and opens it", async () => {
    renderWelcome();
    const more = screen.getByRole("region", { name: "必要になったら使う機能" });
    const triggers = within(more)
      .getAllByRole("button")
      .map((button) => button.textContent ?? "");
    expect(triggers.findIndex((text) => text.startsWith("プラグイン"))).toBe(
      triggers.findIndex((text) => text.startsWith("ドキュメント")) + 1,
    );
    await userEvent.click(within(more).getByRole("button", { name: /^プラグイン/ }));
    expect(await within(more).findByText(/導入前に、必要な準備と/)).toBeDefined();
    await userEvent.click(await within(more).findByRole("button", { name: "プラグインを開く" }));
    expect(probe()).toMatchObject({ route: "plugins" });
  });

  it("opens the change list from the page", async () => {
    renderWelcome();
    await userEvent.click(screen.getByRole("button", { name: "更新情報を見る" }));
    expect(probe()).toMatchObject({ sheet: true });
  });
});

describe("はじめに progress in the IDE", () => {
  it("records that the welcome was shown", () => {
    const posted = webview();
    renderWelcome({ onboarding: onboarding({ welcome: "pending" }) });
    expect(posted).toContainEqual({
      type: "onboarding-event",
      event: { kind: "welcome", status: "done" },
    });
    expect(probe()).toMatchObject({ welcome: "done" });
  });

  it("does not record anything again when it was already done", () => {
    const posted = webview();
    renderWelcome({ onboarding: onboarding({ welcome: "done" }) });
    expect(posted).toEqual([]);
  });

  it("puts the page off and returns home", async () => {
    const posted = webview();
    renderWelcome({ onboarding: onboarding({ welcome: "done" }) });
    await userEvent.click(screen.getByRole("button", { name: "あとで読む" }));
    expect(probe()).toMatchObject({ route: "home", welcome: "deferred" });
    expect(posted).toContainEqual({
      type: "onboarding-event",
      event: { kind: "welcome", status: "deferred" },
    });
  });

  it("brings the screen tips back on request", async () => {
    const posted = webview();
    renderWelcome({ onboarding: onboarding({ dismissedTips: ["area:stage", "news:x"] }) });
    await userEvent.click(
      screen.getByRole("button", { name: "画面ごとのヒントをもう一度表示する" }),
    );
    expect(probe()).toMatchObject({ tips: ["news:x"] });
    expect(posted).toContainEqual({ type: "onboarding-event", event: { kind: "tips-reset" } });
    expect(screen.getByRole("status").textContent).toContain("ヒントをもう一度表示します");
  });

  it("offers the setup check when the workflow cannot be read", async () => {
    const posted = webview();
    renderWelcome({
      workflow: { kind: "error", detail: "x" },
      onboarding: onboarding({}),
    });
    await userEvent.click(screen.getByRole("button", { name: "セットアップを確認する" }));
    expect(posted).toContainEqual({ type: "open-workflows-setup" });
  });
});

describe("はじめに in the browser", () => {
  it("keeps the page readable without IDE-only actions", () => {
    renderWelcome();
    expect(screen.queryByRole("button", { name: "画面ごとのヒントをもう一度表示する" })).toBeNull();
    expect(screen.queryByRole("button", { name: "セットアップを確認する" })).toBeNull();
    expect(screen.getByRole("button", { name: "あとで読む" })).toBeDefined();
  });
});
