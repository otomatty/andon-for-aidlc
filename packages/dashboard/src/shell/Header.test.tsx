import { act, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/shell/Header.tsx";
import { SettingsPage } from "@/features/settings/SettingsPage.tsx";
import { WHATS_NEW } from "@aidlc-guide/shared-types";
import { StoreProvider, useAppState } from "@/store/context.tsx";
import { initialState } from "@/store/state.ts";
import { workflow } from "@tests/fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubLinks(value: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, value })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function SettingsRoute() {
  return useAppState().route.name === "settings" ? <SettingsPage /> : null;
}

async function openSettings() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "メニュー" }));
  await user.click(await screen.findByRole("menuitem", { name: "設定" }));
  return screen.findByRole("main", { name: "設定" });
}

describe("Header (BLM step 7)", () => {
  it("opens a 3-column destination grid from one menu trigger at any width", async () => {
    stubLinks([]);
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(
      <StoreProvider>
        <Header />
        <SettingsRoute />
      </StoreProvider>,
    );
    expect(screen.queryByRole("navigation", { name: "メインナビゲーション" })).toBeNull();
    expect(screen.queryByRole("button", { name: "プロジェクトリンク" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ステージ一覧" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "メニュー" });
    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: "メニュー" });
    const grid = within(menu).getByTestId("header-nav-grid");
    expect(grid.className).toMatch(/grid-cols-3/);
    expect(
      within(grid)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["ステージ一覧", "効果測定", "ドキュメント", "プラグイン", "カスタマイズ", "設定"]);
    expect(
      within(grid).getByRole("menuitem", { name: "ステージ一覧" }).getAttribute("aria-current"),
    ).toBe("page");
    await userEvent.click(within(grid).getByRole("menuitem", { name: "設定" }));
    const settings = await screen.findByRole("main", { name: "設定" });
    expect(within(settings).queryByRole("button", { name: "ステージ一覧に戻る" })).toBeNull();
    await userEvent.click(trigger);
    expect(
      (await screen.findByRole("menuitem", { name: "設定" })).getAttribute("aria-current"),
    ).toBe("page");
    await userEvent.click(await screen.findByRole("menuitem", { name: "ステージ一覧" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "設定" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps project links in a labelled list below the destination grid", async () => {
    stubLinks([{ label: "リポジトリ", target: "https://example.com/repo" }]);
    render(
      <StoreProvider>
        <Header />
      </StoreProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "メニュー" }));
    const menu = await screen.findByRole("menu", { name: "メニュー" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "ステージ一覧",
      "効果測定",
      "ドキュメント",
      "プラグイン",
      "カスタマイズ",
      "設定",
      "はじめに",
      "更新情報",
      "リポジトリ",
    ]);
    expect(within(menu).getByText("プロジェクトリンク")).toBeDefined();
    expect(
      within(screen.getByTestId("header-nav-grid")).queryByRole("menuitem", { name: "リポジトリ" }),
    ).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "リポジトリ" }).getAttribute("href")).toBe(
      "https://example.com/repo",
    );
  });

  it("fetches project links after first paint and renders the safe ones", async () => {
    const fetchMock = stubLinks([
      { label: "リポジトリ", target: "https://example.com/repo" },
      { label: "設計", target: "docs/design.md" },
      { label: "危険", target: "javascript:alert(1)" },
    ]);

    render(
      <StoreProvider preloaded={{ workflow: { kind: "success", value: workflow() } }}>
        <Header />
      </StoreProvider>,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/links", expect.anything());
    });

    expect(screen.queryByText("Andon")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    const external = await screen.findByRole("menuitem", { name: "リポジトリ" });
    expect(external.tagName).toBe("A");
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toBe("noopener noreferrer");

    const local = screen.getByRole("menuitem", { name: "設計" });
    expect(local.getAttribute("target")).toBeNull();
    // S-UI-4: a non-http(s) scheme never becomes a link.
    expect(screen.queryByRole("menuitem", { name: "危険" })).toBeNull();
  });

  it("does not render a read-only participant badge", () => {
    stubLinks([]);
    render(
      <StoreProvider preloaded={{ workflow: { kind: "success", value: workflow() } }}>
        <Header />
      </StoreProvider>,
    );
    expect(screen.queryByTestId("read-only-badge")).toBeNull();
    expect(screen.getByTestId("live-status")).toBeDefined();
  });

  it("names the selected intent in the picker", () => {
    stubLinks([]);
    render(
      <StoreProvider
        preloaded={{
          workflow: { kind: "success", value: workflow() },
          intents: {
            kind: "success",
            value: {
              space: "default",
              active: "aidlc-guide",
              all: ["aidlc-guide"],
              selected: "aidlc-guide",
            },
          },
        }}
      >
        <Header />
      </StoreProvider>,
    );
    expect(screen.getByTestId("intent-picker").textContent).toContain("aidlc-guide");
  });

  it("opens a labelled menu and dismisses it with Escape or an outside click", async () => {
    stubLinks([]);
    render(
      <StoreProvider preloaded={{ workflow: { kind: "success", value: workflow() } }}>
        <Header />
      </StoreProvider>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "メニュー" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("official-docs-open")).toBeNull();
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu", { name: "メニュー" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "ステージ一覧",
      "効果測定",
      "ドキュメント",
      "プラグイン",
      "カスタマイズ",
      "設定",
      "はじめに",
      "更新情報",
    ]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await screen.findByRole("menu");
    await user.click(screen.getByTestId("live-status"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("returns to the stage list from the menu", async () => {
    stubLinks([]);
    render(
      <StoreProvider>
        <Header />
        <SettingsRoute />
      </StoreProvider>,
    );
    expect(screen.queryByRole("button", { name: "ステージ一覧" })).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    await openSettings();
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "ステージ一覧" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "設定" })).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    expect(
      (await screen.findByRole("menuitem", { name: "ステージ一覧" })).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("opens the update page from settings and restores keyboard focus", async () => {
    stubLinks([]);
    const postMessage = vi.fn();
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    render(
      <StoreProvider>
        <Header />
        <SettingsRoute />
      </StoreProvider>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "メニュー" });
    expect(screen.queryByTestId("check-update")).toBeNull();
    trigger.focus();
    await user.keyboard("{Enter}");
    // 設定 is the last destination; the help group follows it.
    await user.keyboard("{End}{ArrowUp}{ArrowUp}{Enter}");
    const page = await screen.findByRole("main", { name: "設定" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(page).getByRole("heading", { level: 1 })),
    );
    expect(
      within(screen.getByRole("banner", { hidden: true })).queryByTestId("check-update"),
    ).toBeNull();
    expect(postMessage).toHaveBeenCalledWith({ type: "get-workflows-management" });
    postMessage.mockClear();
    await user.click(within(page).getByRole("button", { name: "更新画面を開く" }));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "open-workflows-update" });
    await user.click(screen.getByTestId("header-menu-trigger"));
    await user.click(await screen.findByTestId("header-home"));
    await waitFor(() => expect(screen.queryByRole("main", { name: "設定" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("explains where browser users can update without offering an inert action", async () => {
    stubLinks([]);
    render(
      <StoreProvider>
        <Header />
        <SettingsRoute />
      </StoreProvider>,
    );
    const page = await openSettings();
    expect(page.textContent).toContain("IDEでAndonを開き");
    expect(within(page).queryByTestId("check-update")).toBeNull();
    expect(page.textContent).toContain("IDEで対象のプロジェクトを開き");
    expect(within(page).queryByRole("button", { name: "セットアップを開く" })).toBeNull();
    expect(within(page).queryByRole("button", { name: "ツール追加を開く" })).toBeNull();
    expect(within(page).queryByRole("button", { name: "更新画面を開く" })).toBeNull();
    await userEvent.click(screen.getByTestId("header-menu-trigger"));
    await userEvent.click(await screen.findByTestId("header-home"));
    await waitFor(() => expect(screen.queryByRole("main", { name: "設定" })).toBeNull());
  });

  it("routes setup, updates, and tool additions to separate screens without starting changes", async () => {
    stubLinks([]);
    const postMessage = vi.fn();
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    render(
      <StoreProvider>
        <Header />
        <SettingsRoute />
      </StoreProvider>,
    );
    const user = userEvent.setup();
    const page = await openSettings();
    const setup = within(page).getByRole("region", { name: "セットアップ" });
    const updates = within(page).getByRole("region", { name: "更新・修復" });
    const tools = within(page).getByRole("region", { name: "ツール追加" });
    expect(setup.textContent).toContain("既存プロジェクトに参加する方");
    expect(updates.textContent).toContain("このPCとプロジェクトを、Andonの対応版にそろえます");
    expect(tools.textContent).toContain("追加するツールは複数選べます");
    expect(within(page).queryByRole("button", { name: "更新を確認" })).toBeNull();
    expect(postMessage).toHaveBeenCalledWith({ type: "get-workflows-management" });
    postMessage.mockClear();
    await user.click(within(setup).getByRole("button", { name: "セットアップを開く" }));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "open-workflows-setup" });
    postMessage.mockClear();
    await user.click(within(tools).getByRole("button", { name: "ツール追加を開く" }));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "open-workflows-install" });
    postMessage.mockClear();
    await user.click(within(updates).getByRole("button", { name: "更新画面を開く" }));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "open-workflows-update" });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "workflows-management",
            state: {
              root: "project-a",
              target: "2.8.1",
              tools: [{ id: "cursor", label: "Cursor", version: "2.8.0" }],
              status: "update",
              canUpdate: true,
              canInstall: false,
              projectPin: null,
              message: "全ツールを更新できます。",
            },
          },
        }),
      );
    });
    expect(within(page).getByRole("list", { name: "設定済みツール" }).textContent).toContain(
      "Cursor：2.8.0",
    );
    expect(within(page).getByRole("status").textContent).toBe("全ツールを更新できます。");
  });
});

describe("Header onboarding entries", () => {
  function Probe() {
    const state = useAppState();
    return (
      <div data-testid="probe" hidden>
        {`${state.route.name}:${state.onboarding.whatsNew.open}`}
      </div>
    );
  }

  it("opens はじめに and 更新情報 from a help group below the destinations", async () => {
    stubLinks([]);
    render(
      <StoreProvider>
        <Header />
        <Probe />
      </StoreProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    const menu = await screen.findByRole("menu", { name: "メニュー" });
    const help = within(menu).getByRole("group", { name: "ヘルプ" });
    expect(
      within(help)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["はじめに", "更新情報"]);
    await userEvent.click(within(help).getByRole("menuitem", { name: "はじめに" }));
    expect(screen.getByTestId("probe").textContent).toBe("welcome:false");
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "更新情報" }));
    expect(screen.getByTestId("probe").textContent).toBe("welcome:true");
  });

  it("marks unseen changes on the trigger and the menu item in text", async () => {
    stubLinks([]);
    render(
      <StoreProvider
        preloaded={{
          onboarding: {
            ...initialState.onboarding,
            version: "0.35.0",
            record: {
              version: "0.35.0",
              welcome: "done",
              seenNews: WHATS_NEW.slice(2).map((entry) => entry.id),
              dismissedTips: [],
            },
          },
        }}
      >
        <Header />
      </StoreProvider>,
    );
    const trigger = screen.getByRole("button", { name: "メニュー" });
    expect(trigger.getAttribute("aria-describedby")).toBe("header-menu-news");
    expect(document.getElementById("header-menu-news")?.textContent).toBe(
      "新着の更新情報が2件あります",
    );
    await userEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /^更新情報\s*新着 2$/ })).toBeDefined();
  });

  it("shows no unseen mark in the browser", async () => {
    stubLinks([]);
    render(
      <StoreProvider>
        <Header />
      </StoreProvider>,
    );
    const trigger = screen.getByRole("button", { name: "メニュー" });
    expect(trigger.getAttribute("aria-describedby")).toBeNull();
    await userEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "更新情報" })).toBeDefined();
  });
});
