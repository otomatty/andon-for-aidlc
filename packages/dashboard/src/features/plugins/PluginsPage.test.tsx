import type {
  BundledPluginCatalog,
  PluginsHostMessage,
  PluginsState,
} from "@aidlc-guide/shared-types";
import { BUNDLED_PLUGINS } from "@aidlc-guide/shared-types";
import { act, render, screen, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginsPanel } from "@/features/plugins/PluginsPage.tsx";
import { StoreProvider } from "@/store/context.tsx";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect/></svg>';

const catalog: BundledPluginCatalog = {
  schemaVersion: 1,
  plugins: [
    {
      name: "focus",
      version: "0.1.0",
      sourceHash: `sha256:${"0".repeat(64)}`,
      title: "focus",
      tagline: "チケット1枚から実装まで。",
      summary: "要件から TDD の実装まで進めます。",
      status: "preview",
      harness: "claude",
      scope: "focus-flow",
      startCommand: "/aidlc --scope focus-flow <チケット番号> <要約>",
      fitFor: ["Jira を使っている"],
      notFitFor: ["Claude Code を使っていない"],
      requirements: [
        {
          id: "atlassian-mcp",
          level: "recommended",
          label: "Atlassian の MCP",
          detail: "なくても進められます。",
        },
        { id: "opus", level: "info", label: "Claude Opus", detail: "テストと実装で使います。" },
      ],
      stages: [
        {
          slug: "requirements-analysis",
          name: "Requirements Analysis",
          phase: "inception",
          origin: "core-extended",
          perUnit: false,
        },
        {
          slug: "units-generation",
          name: "Units Generation",
          phase: "inception",
          origin: "core",
          perUnit: false,
        },
        {
          slug: "focus-test",
          name: "テスト先行",
          phase: "construction",
          origin: "plugin",
          perUnit: true,
        },
      ],
      files: {
        added: [
          ".claude/aidlc-common/stages/construction/focus-test.md",
          ".claude/agents/focus-builder-agent.md",
        ],
        changed: [".claude/aidlc-common/stages/inception/requirements-analysis.md"],
      },
      sample: { alt: "見本の図", svg: SVG },
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function view(plugins: BundledPluginCatalog = catalog): void {
  render(
    <StoreProvider preloaded={{ route: { name: "plugins" } }}>
      <PluginsPanel catalog={plugins} />
    </StoreProvider>,
  );
}

describe("PluginsPanel", () => {
  it("lists the bundled plugins with what each promises, marking a preview", () => {
    view();
    expect(screen.getByRole("heading", { name: "プラグイン" })).toBeDefined();
    expect(screen.getByText(/決まった進め方を追加します/)).toBeDefined();
    const card = screen.getByTestId("plugin-card-focus");
    expect(within(card).getByText("focus")).toBeDefined();
    expect(within(card).getByText("チケット1枚から実装まで。")).toBeDefined();
    expect(within(card).getByText("試験版")).toBeDefined();
    expect(within(card).getByText("v0.1.0")).toBeDefined();
  });

  it("in the browser, says installing happens in the extension and offers no button that does nothing", () => {
    view();
    expect(screen.getByTestId("plugins-browser-note").textContent).toContain("VS Code / Cursor");
    expect(
      screen.queryByRole("button", { name: /導入する|有効にする|無効にする|更新する/ }),
    ).toBeNull();
  });

  it("shows what changes before anything is installed", async () => {
    view();
    await userEvent.click(screen.getByRole("button", { name: /focus の詳細/ }));
    const detail = screen.getByTestId("plugin-detail-focus");

    const flow = within(detail).getByTestId("plugin-stages");
    const rows = within(flow).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-origin"))).toEqual([
      "core-extended",
      "core",
      "plugin",
    ]);
    // Never by color alone: every changed stage says so in words.
    expect(rows[0]?.textContent).toContain("手順を追記");
    expect(rows[2]?.textContent).toContain("追加");
    expect(rows[2]?.textContent).toContain("Unit ごと");

    const sample = within(detail).getByRole("img", { name: "見本の図" });
    expect(sample.getAttribute("src")).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`,
    );

    expect(within(detail).getByText("Jira を使っている")).toBeDefined();
    expect(within(detail).getByText("Claude Code を使っていない")).toBeDefined();
    const needs = within(detail).getByTestId("plugin-requirements");
    expect(needs.textContent).toContain("推奨");
    expect(needs.textContent).toContain("Atlassian の MCP");

    const files = within(detail).getByTestId("plugin-files");
    expect(files.textContent).toContain("追加されるファイル（2 件）");
    expect(files.textContent).toContain("変更されるファイル（1 件）");
    expect(files.textContent).toContain(".claude/agents/focus-builder-agent.md");
    expect(files.textContent).toContain("アプリケーションのコードは変えません");

    expect(
      within(detail).getByText("/aidlc --scope focus-flow <チケット番号> <要約>"),
    ).toBeDefined();

    await userEvent.click(within(detail).getByRole("button", { name: "一覧に戻る" }));
    expect(screen.queryByTestId("plugin-detail-focus")).toBeNull();
    expect(screen.getByTestId("plugin-card-focus")).toBeDefined();
  });

  it("explains an empty catalog", () => {
    view({ schemaVersion: 1, plugins: [] });
    expect(screen.getByTestId("plugins-empty")).toBeDefined();
  });

  it("shows focus from the catalog the extension ships", () => {
    view(BUNDLED_PLUGINS);
    expect(screen.getByTestId("plugin-card-focus")).toBeDefined();
  });
});

describe("PluginsPanel in the IDE", () => {
  const postMessage = vi.fn();
  const ready: PluginsState = {
    plugins: [{ name: "focus", status: "not-installed", installedVersion: null }],
    prerequisites: [
      {
        id: "trusted",
        level: "required",
        met: true,
        label: "ワークスペースを信頼している",
        detail: "",
      },
      {
        id: "claude",
        level: "required",
        met: true,
        label: "Claude Code（.claude）で AI-DLC を使っている",
        detail: "",
      },
      {
        id: "atlassian-mcp",
        level: "recommended",
        met: false,
        label: "Atlassian の MCP サーバーが .mcp.json にある",
        detail: "なくても導入できます。",
      },
    ],
    canAct: true,
    running: null,
  };

  function host(message: PluginsHostMessage): void {
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  }

  function ide(): void {
    postMessage.mockClear();
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    view();
  }

  async function openDetail(): Promise<HTMLElement> {
    await userEvent.click(screen.getByRole("button", { name: /focus の詳細/ }));
    return screen.getByTestId("plugin-detail-focus");
  }

  it("asks the extension for the project's state and shows it on the card", () => {
    ide();
    expect(postMessage).toHaveBeenCalledWith({ type: "plugins-get" });
    host({
      type: "plugins-state",
      state: {
        ...ready,
        plugins: [{ name: "focus", status: "enabled", installedVersion: "0.1.0" }],
      },
    });
    expect(within(screen.getByTestId("plugin-card-focus")).getByText("✔ 有効")).toBeDefined();
    expect(screen.queryByTestId("plugins-browser-note")).toBeNull();
  });

  it("installs on request, showing the steps and letting the reader cancel", async () => {
    ide();
    host({ type: "plugins-state", state: ready });
    const detail = await openDetail();
    await userEvent.click(within(detail).getByRole("button", { name: "導入する" }));
    expect(postMessage).toHaveBeenCalledWith({
      type: "plugins-action",
      action: "install",
      name: "focus",
    });

    host({
      type: "plugins-state",
      state: { ...ready, canAct: false, running: { action: "install", name: "focus" } },
    });
    host({
      type: "plugins-progress",
      progress: {
        action: "install",
        name: "focus",
        step: 3,
        total: 5,
        text: "AI-DLC に組み込んでいます",
      },
    });
    expect(within(detail).getByTestId("plugin-progress").textContent).toContain("3 / 5");
    expect(within(detail).getByTestId("plugin-progress").textContent).toContain(
      "AI-DLC に組み込んでいます",
    );
    await userEvent.click(within(detail).getByRole("button", { name: "取り消す" }));
    expect(postMessage).toHaveBeenCalledWith({ type: "plugins-cancel" });
  });

  it("shows what changed and how to start once installed", async () => {
    ide();
    host({ type: "plugins-state", state: ready });
    const detail = await openDetail();
    host({
      type: "plugins-result",
      result: {
        outcome: "succeeded",
        action: "install",
        name: "focus",
        changedFiles: [".claude/agents/focus-builder-agent.md"],
        moreFiles: 12,
        commitMessage: "chore: AI-DLC プラグイン focus 0.1.0 を導入",
      },
    });
    host({
      type: "plugins-state",
      state: {
        ...ready,
        plugins: [{ name: "focus", status: "enabled", installedVersion: "0.1.0" }],
      },
    });
    const result = within(detail).getByTestId("plugin-result");
    expect(result.textContent).toContain("導入しました");
    expect(result.textContent).toContain(".claude/agents/focus-builder-agent.md");
    expect(result.textContent).toContain("ほか 12 件");
    expect(result.textContent).toContain("chore: AI-DLC プラグイン focus 0.1.0 を導入");
    await userEvent.click(within(detail).getByRole("button", { name: "始めるコマンドをコピー" }));
    expect(postMessage).toHaveBeenCalledWith({ type: "plugins-copy-start", name: "focus" });
    // Enabled now: the one action is to disable, and the page says what that keeps.
    expect(within(detail).getByRole("button", { name: "無効にする" })).toBeDefined();
    expect(within(detail).getByText(/ファイルは残ります/)).toBeDefined();
  });

  it("says why a step failed and offers Doctor when the project needs checking", async () => {
    ide();
    host({ type: "plugins-state", state: ready });
    const detail = await openDetail();
    host({
      type: "plugins-result",
      result: {
        outcome: "failed",
        action: "install",
        name: "focus",
        message: "組み込みが行われていません。",
        doctor: true,
      },
    });
    expect(within(detail).getByTestId("plugin-result").textContent).toContain(
      "組み込みが行われていません。",
    );
    await userEvent.click(within(detail).getByRole("button", { name: "Doctor を開く" }));
    expect(postMessage).toHaveBeenCalledWith({ type: "version-gate-action", action: "doctor" });
  });

  it("keeps the action disabled while something it needs is missing, and says where to fix it", async () => {
    ide();
    host({
      type: "plugins-state",
      state: {
        ...ready,
        canAct: false,
        prerequisites: [
          {
            id: "claude",
            level: "required",
            met: false,
            label: "Claude Code（.claude）で AI-DLC を使っている",
            detail: "セットアップの「ツールを追加」で Claude Code を追加してください。",
            action: "open-workflows-install",
          },
        ],
      },
    });
    const detail = await openDetail();
    expect(
      (within(detail).getByRole("button", { name: "導入する" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const needs = within(detail).getByTestId("plugin-requirements");
    expect(needs.textContent).toContain("✖");
    await userEvent.click(within(needs).getByRole("button", { name: "開く" }));
    expect(postMessage).toHaveBeenCalledWith({ type: "open-workflows-install" });
  });
});
