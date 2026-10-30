import type { OfficialDocsManifest, OfficialDocsPage, OfficialDocsToc } from "@andon/shared-types";
import { cleanup, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app/App.tsx";
import { AreaBoundary } from "@/shell/AreaBoundary.tsx";
import { NowStrip } from "@/shell/now-strip/NowStrip.tsx";
import { applyTheme, nextTheme, ThemeToggle } from "@/shell/ThemeToggle.tsx";
import { StoreProvider } from "@/store/context.tsx";
import { matrix, payload, stageDoc, workflow } from "@tests/fixtures.ts";

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  // Official-docs navigation scrolls the article after its markdown chunk loads.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string) => {
    if (input === "/api/official-docs/manifest") {
      const value: OfficialDocsManifest = {
        sourceVersion: "aidlc 2.8.1",
        source: "aidlc-workflows",
        capturedAt: "2026-09-12T00:00:00.000Z",
      };
      return new Response(JSON.stringify({ ok: true, value }));
    }
    if (input.startsWith("/api/official-docs/toc/")) {
      const value: OfficialDocsToc = {
        overview: [],
        guide: [
          {
            id: "guide/getting-started.md",
            title: "Getting started",
            path: "guide/getting-started.md",
            children: [],
          },
        ],
        "harness-engineering": [],
        reference: [],
        rfcs: [],
      };
      return new Response(JSON.stringify({ ok: true, value }));
    }
    if (/^\/api\/official-docs\/(en|ja)\/guide\/getting-started\.md$/.test(input)) {
      const locale = input.includes("/ja/") ? "ja" : "en";
      const value: OfficialDocsPage = {
        localeRequested: locale,
        localeServed: locale,
        path: "guide/getting-started.md",
        title: "Getting started",
        bodyMarkdown: "# Getting started\n\nHello official docs.\n",
        sourceVersion: "aidlc 2.8.1",
        anchorApplied: "none",
      };
      return new Response(JSON.stringify({ ok: true, value }));
    }
    if (input.includes("/api/stage/")) {
      return new Response(
        JSON.stringify({ ok: true, value: stageDoc({ slug: input.split("/").at(-1) }) }),
      );
    }
    if (input.includes("/api/agents/")) {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            id: "aidlc-developer-agent",
            displayName: "開発エージェント",
            description: "実装を担当",
            markdown: "実装を担当します。",
            stages: ["code-generation"],
            knowledge: [],
          },
        }),
      );
    }
    if (input.includes("/api/matrix")) {
      return new Response(JSON.stringify({ ok: true, value: matrix() }));
    }
    if (input.includes("/api/links")) return new Response(JSON.stringify({ ok: true, value: [] }));
    if (input === "/api/guides") {
      return Response.json({ ok: true, value: [{ name: "README.md", title: "拡張機能" }] });
    }
    if (input === "/api/guides/README.md") {
      return Response.json({
        ok: true,
        value: {
          name: "README.md",
          title: "拡張機能",
          markdown: "# 拡張機能\n\nExtension guide body.\n",
        },
      });
    }
    if (input === "/api/workflow") return new Response(JSON.stringify(payload()));
    return new Response(JSON.stringify({ error: true, reason: "not_found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no WebSocket; the live layer must not be what breaks the page.
  vi.stubGlobal(
    "WebSocket",
    class {
      close(): void {}
    },
  );
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe("App bootstrap (P-UI-2)", () => {
  it("consumes the pre-mount workflow promise instead of re-requesting it", async () => {
    const fetchMock = stubApi();
    // main.tsx starts this before React exists; here we do the same by hand.
    const bootstrap = Promise.resolve({ ok: true as const, value: payload() });
    render(<App bootstrap={bootstrap} />);

    await waitFor(() => {
      expect(screen.getByTestId("now-current-stage").textContent).toBe("code-generation");
    });
    const paths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(paths).not.toContain("/api/workflow");
  });

  it("renders the four landmarks and the current stage marker", async () => {
    stubApi();
    render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);

    await waitFor(() => {
      expect(screen.getByRole("banner")).toBeDefined();
    });
    expect(screen.getByRole("navigation", { name: "ステージ一覧" })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    expect(screen.getByRole("region", { name: "現在のステージ" })).toBeDefined();

    const current = screen.getByTestId("stage-rail-item-code-generation");
    expect(current.getAttribute("aria-current")).toBe("step");

    // The lazily loaded matrix chunk resolves and fills its area.
    await waitFor(() => {
      expect(screen.getByTestId("matrix-cell-reader-core-functional-design")).toBeDefined();
    });
  });

  it("opens the panel from the rail and closes it again", async () => {
    stubApi();
    render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);
    await waitFor(() => {
      expect(screen.getByTestId("stage-rail-item-code-generation")).toBeDefined();
    });

    await userEvent.click(screen.getByTestId("stage-rail-item-code-generation"));
    const panel = await screen.findByTestId("detail-panel");
    const heading = within(panel).getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("3.5 code-generation");
    expect(within(heading).getByText("awaiting approval")).toBeDefined();
    // Home content is parked; the shared header stays visible.
    expect(document.querySelector(".app-home")?.hasAttribute("data-parked")).toBe(true);
    expect(document.querySelector(".app-home")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByTestId("header-menu-trigger")).toBeDefined();

    await userEvent.click(screen.getByTestId("panel-back"));
    expect(screen.queryByTestId("detail-panel")).toBeNull();
    expect(document.querySelector(".app-home")?.hasAttribute("data-parked")).toBe(false);
  });

  it("keeps the shared header while reading an extension guide in the docs page", async () => {
    stubApi();
    render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);
    await userEvent.click(await screen.findByTestId("header-menu-trigger"));
    await userEvent.click(await screen.findByTestId("official-docs-open"));
    await userEvent.click(await screen.findByTestId("docs-menu"));
    await userEvent.click(screen.getByRole("tab", { name: "拡張機能" }));
    await userEvent.click(await screen.findByTestId("docs-guide-README.md"));
    expect(await screen.findByText("Extension guide body.")).toBeDefined();
    expect(screen.getByTestId("docs-shell")).toBeDefined();
    expect(screen.queryByTestId("guides-panel")).toBeNull();
    expect(document.querySelector(".app-home")?.hasAttribute("data-parked")).toBe(true);
    expect(screen.getByRole("banner")).toBeDefined();

    await userEvent.click(screen.getByTestId("header-menu-trigger"));
    await userEvent.click(await screen.findByTestId("header-home"));
    expect(screen.queryByTestId("docs-shell")).toBeNull();
    expect(document.querySelector(".app-home")?.hasAttribute("data-parked")).toBe(false);
  });

  it("opens settings as the main page and returns home with navigation focus", async () => {
    stubApi();
    render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);
    await screen.findByTestId("now-toggle");
    const homeMain = screen.getByRole("main");
    const home = homeMain.closest(".app-home");
    const menu = within(screen.getByRole("banner")).getByRole("button", { name: "メニュー" });

    await userEvent.click(menu);
    await userEvent.click(await screen.findByRole("menuitem", { name: "設定" }));
    const settings = await screen.findByRole("main", { name: "設定" });
    expect(settings).toBe(screen.getByTestId("settings-page"));
    expect(screen.queryByRole("dialog")).toBeNull();
    const sharedHeader = within(screen.getByRole("banner"));
    expect(sharedHeader.getByRole("button", { name: "メニュー" })).toBe(menu);
    expect(home?.hasAttribute("data-parked")).toBe(true);
    expect(home?.getAttribute("aria-hidden")).toBe("true");
    expect(home?.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("navigation", { name: "ステージ一覧" })).toBeNull();

    await userEvent.click(screen.getByTestId("header-menu-trigger"));
    await userEvent.click(await screen.findByTestId("header-home"));
    expect(screen.queryByTestId("settings-page")).toBeNull();
    expect(screen.getByRole("main")).toBe(homeMain);
    expect(home?.hasAttribute("data-parked")).toBe(false);
    expect(home?.getAttribute("aria-hidden")).toBe("false");
    expect(home?.hasAttribute("inert")).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(menu);
    });
  });
});

describe("shared stage progress", () => {
  it.each([
    ["official-docs-open", "docs-shell"],
    ["effectiveness-open", "effectiveness-panel"],
  ])("returns focus to the header menu after leaving %s", async (page, panelId) => {
    stubApi();
    const user = userEvent.setup();
    render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);
    await screen.findByTestId("now-toggle");
    const trigger = screen.getByTestId("header-menu-trigger");
    await user.click(trigger);
    await user.click(await screen.findByTestId(page));
    const panel = await screen.findByTestId(panelId);
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    await user.click(trigger);
    await user.click(await screen.findByTestId("header-home"));
    await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps disclosure across stage and agent navigation, and hides it on unrelated pages", async () => {
    stubApi();
    const user = userEvent.setup();
    render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);
    const toggle = await screen.findByTestId("now-toggle");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByTestId("stage-rail-item-functional-design"));
    await screen.findByTestId("detail-panel");
    expect(screen.getByTestId("now-current-stage").textContent).toBe("code-generation");
    expect(screen.getByTestId("now-toggle")).toBe(toggle);
    await user.click(await screen.findByTestId("agent-link-aidlc-developer-agent"));
    await screen.findByTestId("agent-panel");
    expect(screen.getByTestId("now-toggle").getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByTestId("agent-back"));
    expect(await screen.findByTestId("detail-panel")).toBeDefined();
    for (const [page, destination] of [
      ["settings-open", "settings-page"],
      ["effectiveness-open", "effectiveness-panel"],
      ["official-docs-open", "docs-shell"],
    ] as const) {
      await user.click(screen.getByTestId("header-menu-trigger"));
      await user.click(await screen.findByTestId(page));
      // Wait for lazy pages to mount and finish their initial focus before opening the next menu.
      await screen.findByTestId(destination);
      expect(screen.queryByRole("region", { name: "現在のステージ" })).toBeNull();
    }
    expect(await screen.findByTestId("docs-home")).toBeDefined();
    await user.click(screen.getByTestId("docs-menu"));
    await user.click(screen.getByRole("tab", { name: "拡張機能" }));
    await user.click(await screen.findByTestId("docs-guide-README.md"));
    expect(await screen.findByText("Extension guide body.")).toBeDefined();
    expect(screen.queryByRole("region", { name: "現在のステージ" })).toBeNull();
    await user.click(screen.getByTestId("header-menu-trigger"));
    await user.click(await screen.findByTestId("header-home"));
    expect(screen.getByTestId("now-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "ステージ一覧", level: 1 })).toBeDefined();
    expect(screen.getByRole("heading", { name: "成果物マトリクス" })).toBeDefined();
  });
});

describe("NowStrip states", () => {
  it("starts collapsed, exposes current stage and status, and opens from the keyboard", async () => {
    render(<NowStrip state={{ kind: "success", value: workflow() }} onRetry={() => {}} />);
    const toggle = screen.getByTestId("now-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("code-generation");
    expect(toggle.textContent).toContain("awaiting approval");
    expect(screen.queryByRole("button", { name: /スコープ/ })).toBeNull();
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByTestId("done-total")).toBeDefined();
  });

  it("does not call a finished or missing current stage in progress", () => {
    const { rerender } = render(
      <NowStrip
        state={{
          kind: "success",
          value: workflow({
            currentStage: null,
            gate: null,
            done: 6,
          }),
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("now-toggle").textContent).toContain("ワークフロー完了");
    expect(screen.getByTestId("now-toggle").textContent).not.toContain("進行中");
    rerender(
      <NowStrip
        state={{ kind: "success", value: workflow({ currentStage: null, gate: null }) }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("now-toggle").textContent).toContain("現在のステージなし");
  });

  it("shows the empty state with the intent picker when there is no active intent", () => {
    render(
      <StoreProvider>
        <NowStrip
          state={{ kind: "empty", hint: "アクティブなインテントがありません" }}
          onRetry={() => {}}
          intentPicker={<button type="button" aria-label="picker" data-testid="intent-picker" />}
        />
      </StoreProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("アクティブなインテントがありません")).toBeDefined();
    expect(screen.getByTestId("intent-picker")).toBeDefined();
  });

  it("offers a retry when the server cannot be reached", async () => {
    const onRetry = vi.fn();
    render(
      <NowStrip state={{ kind: "error", detail: "サーバに接続できません" }} onRetry={onRetry} />,
    );
    expect(screen.getByText("サーバに接続できません")).toBeDefined();
    await userEvent.click(screen.getByTestId("retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows all degradation notes only while the current-stage accordion is open", async () => {
    render(
      <NowStrip
        state={{
          kind: "partial",
          value: workflow(),
          notes: ["gate: unknown mark", "build-and-test: unknown execution"],
        }}
        timingsNotes={["audit shard unreadable", "gate: unknown mark"]}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByText(/gate: unknown mark/)).toBeNull();
    expect(screen.queryByText(/build-and-test: unknown execution/)).toBeNull();
    expect(screen.queryByText(/audit shard unreadable/)).toBeNull();
    await userEvent.click(screen.getByTestId("now-toggle"));
    expect(screen.getByTestId("done-total").textContent).toBe("3 / 6");
    expect(screen.getByTestId("now-scope").textContent).toBe("mvp");
    expect(screen.getAllByText(/gate: unknown mark/)).toHaveLength(1);
    expect(screen.getByText(/build-and-test: unknown execution/)).toBeDefined();
    expect(screen.getByText(/audit shard unreadable/)).toBeDefined();
    await userEvent.click(screen.getByTestId("now-toggle"));
    await waitFor(() => expect(screen.queryByText(/gate: unknown mark/)).toBeNull());
    expect(screen.queryByText(/build-and-test: unknown execution/)).toBeNull();
    expect(screen.queryByText(/audit shard unreadable/)).toBeNull();
  });

  it.each([
    { kind: "loading" as const },
    { kind: "empty" as const, hint: "インテントを選んでください" },
    { kind: "error" as const, detail: "状態ファイルを読み取れません" },
  ])(
    "preserves timing warnings without a workflow ($kind), then folds them after recovery",
    async (state) => {
      const timingsNotes = [
        "audit shard unreadable",
        "invalid timestamp",
        "audit shard unreadable",
      ];
      const { rerender } = render(
        <NowStrip state={state} timingsNotes={timingsNotes} onRetry={() => {}} />,
      );
      expect(screen.queryByTestId("now-toggle")).toBeNull();
      expect(screen.getAllByText(/audit shard unreadable/)).toHaveLength(1);
      expect(screen.getByText(/invalid timestamp/)).toBeDefined();

      rerender(
        <NowStrip
          state={{ kind: "success", value: workflow() }}
          timingsNotes={timingsNotes}
          onRetry={() => {}}
        />,
      );
      expect(screen.queryByText(/audit shard unreadable/)).toBeNull();
      expect(screen.queryByText(/invalid timestamp/)).toBeNull();
      await userEvent.click(screen.getByTestId("now-toggle"));
      expect(screen.getAllByText(/audit shard unreadable/)).toHaveLength(1);
      expect(screen.getByText(/invalid timestamp/)).toBeDefined();

      rerender(<NowStrip state={state} timingsNotes={timingsNotes} onRetry={() => {}} />);
      expect(screen.queryByTestId("now-toggle")).toBeNull();
      expect(screen.getAllByText(/audit shard unreadable/)).toHaveLength(1);
      expect(screen.getByText(/invalid timestamp/)).toBeDefined();

      rerender(<NowStrip state={state} onRetry={() => {}} />);
      expect(screen.queryByText(/audit shard unreadable/)).toBeNull();
      expect(screen.queryByText(/invalid timestamp/)).toBeNull();
    },
  );

  it("shows the recorded Guard Policy and its source with the effective-policy explanation", async () => {
    render(
      <NowStrip
        expanded
        state={{
          kind: "success",
          value: workflow({ guardPolicy: { value: "relaxed", source: "from scope mvp" } }),
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("now-change-control").textContent).toBe("relaxed（from scope mvp）");
    await userEvent.hover(screen.getByTestId("now-field-change-control"));
    const card = await screen.findByTestId("now-explain-change-control");
    expect(within(card).getByText(/実行時はその設定が優先/)).toBeDefined();
  });

  it.each([
    [workflow(), "未記録"],
    [workflow({ unparseable: { guardPolicy: "unknown" } }), "解析不可"],
  ])("does not invent a Guard Policy value", (value, label) => {
    render(<NowStrip expanded state={{ kind: "success", value }} onRetry={() => {}} />);
    expect(screen.getByTestId("now-change-control").textContent).toBe(label);
  });

  it("shows the v2.11 ceremonies, project type and tailored plan beside Guard Policy", () => {
    render(
      <NowStrip
        expanded
        state={{
          kind: "success",
          value: workflow({
            ceremonies: { planApproval: { value: "off", source: "from scope express" } },
            projectType: { value: "Greenfield", source: "you" },
            plan: "tailored plan",
          }),
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("now-ceremonies").textContent).toContain("計画承認 off");
    expect(screen.getByTestId("now-project-type").textContent).toBe(
      "Greenfield（あなたが指定）・プラン tailored plan",
    );
  });

  it("opens a HoverCard that explains scope (definition + current + bullets)", async () => {
    render(<NowStrip expanded state={{ kind: "success", value: workflow() }} onRetry={() => {}} />);
    await userEvent.hover(screen.getByTestId("now-field-scope"));
    const card = await screen.findByTestId("now-explain-scope");
    expect(within(card).getByText(/EXECUTE \/ SKIP/)).toBeDefined();
    expect(within(card).getByText(/選択中は「mvp」/)).toBeDefined();
    expect(within(card).getByText(/\/aidlc --scope/)).toBeDefined();
  });
});

// LiveStatus moved to its own component with a four-state view model; its
// tests moved with it, to mob-mode.test.tsx.

describe("ThemeToggle", () => {
  it("toggles light ↔ dark and always writes data-theme", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");

    const root = document.documentElement;
    applyTheme("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    applyTheme("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
  });

  it("applies the picked theme to the document on click", async () => {
    render(
      <StoreProvider>
        <ThemeToggle />
      </StoreProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    const toggle = screen.getByRole("button", { name: "ダークテーマに切り替え" });
    expect(toggle.getAttribute("data-slot")).toBe("button");
    await userEvent.click(toggle);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: "ライトテーマに切り替え" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

function Boom(): ReactNode {
  throw new Error("render exploded");
}

describe("AreaBoundary (R-UI-1)", () => {
  it("contains a crash to its own area and offers a remount", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <AreaBoundary name="matrix">
          <Boom />
        </AreaBoundary>
        <AreaBoundary name="now-strip">
          <p>生存している領域</p>
        </AreaBoundary>
      </>,
    );

    expect(screen.getByTestId("area-error-matrix")).toBeDefined();
    expect(screen.getByText("生存している領域")).toBeDefined();
    expect(screen.getByRole("button", { name: "この領域を再読み込み" })).toBeDefined();
    consoleError.mockRestore();
  });
});
