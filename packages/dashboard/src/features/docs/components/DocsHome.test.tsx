import type { MarkdownItem, OfficialDocsToc, OfficialDocsTocNode } from "@aidlc-guide/shared-types";
import { cleanup, fireEvent, render, screen, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewState } from "@/store/state.ts";
import { homeDocs, homeShelves, searchHomeDocs } from "@/features/docs/utils/docs-home.ts";
import { DocsHome } from "./DocsHome.tsx";

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function page(path: string, title: string): OfficialDocsTocNode {
  return { id: path, title, path, children: [] };
}

const TOC: OfficialDocsToc = {
  overview: [
    page("overview/README.md", "AI-DLC ドキュメント"),
    page("overview/changelog.md", "aidlc-workflows release history"),
    page("overview/release-highlights.md", "aidlc-workflows の更新履歴と改善点"),
    {
      id: "overview/releases",
      title: "Releases",
      children: ["2.9.0", "2.10.0", "2.11.1"].map((version) =>
        page(`overview/releases/${version}.md`, `aidlc-workflows ${version}`),
      ),
    },
  ],
  guide: [
    page("guide/00-introduction.md", "はじめに"),
    page("guide/01-getting-started.md", "はじめに"),
    page("guide/02-your-first-workflow.md", "最初のワークフロー"),
    page("guide/04-phases-and-stages.md", "フェーズとステージ"),
    page("guide/05-scopes-and-depth.md", "スコープ・深度・テスト戦略"),
    page("guide/06-agents.md", "エージェント"),
    page("guide/12-cli-commands.md", "CLI コマンド"),
    page("guide/15-troubleshooting.md", "トラブルシュート"),
    page("guide/glossary.md", "用語集"),
  ],
  "harness-engineering": [page("harness-engineering/00-overview.md", "ハーネスエンジニアガイド")],
  reference: [
    page("reference/00-overview.md", "開発者リファレンス概要"),
    page("reference/05-agent-system.md", "エージェントシステム"),
  ],
  rfcs: [],
};

const GUIDES: MarkdownItem[] = [
  { name: "README.md", title: "使い方ガイド" },
  { name: "getting-started.md", title: "はじめに — インストールから初回 Setup まで" },
  { name: "aidlc-workflows-tips.md", title: "aidlc-workflows Tips一覧" },
  { name: "aidlc-tip-hooks.md", title: "Claude Codeのhooksを修復する" },
] as MarkdownItem[];

function success<T>(value: T): ViewState<T> {
  return { kind: "success", value } as ViewState<T>;
}

function Harness({
  tocView = success(TOC),
  ask = true,
  handlers,
}: {
  tocView?: ViewState<OfficialDocsToc>;
  ask?: boolean;
  handlers: {
    onSelectPath: (path: string) => void;
    onSelectGuide: (name: string) => void;
    onOpenCategory: (category: "workflow" | "extension") => void;
    onAsk: (draft: string) => void;
  };
}): ReactNode {
  const [query, setQuery] = useState("");
  return (
    <DocsHome
      tocView={tocView}
      guidesView={success(GUIDES)}
      query={query}
      onQueryChange={setQuery}
      onSelectPath={handlers.onSelectPath}
      onSelectGuide={handlers.onSelectGuide}
      onOpenCategory={handlers.onOpenCategory}
      {...(ask
        ? {
            onAsk: handlers.onAsk,
            questionPanel: <textarea id="docs-question" aria-label="質問" />,
          }
        : { questionPanel: <p>質問は使えません</p> })}
    />
  );
}

function handlers() {
  return {
    onSelectPath: vi.fn(),
    onSelectGuide: vi.fn(),
    onOpenCategory: vi.fn(),
    onAsk: vi.fn(),
  };
}

describe("docs home helpers", () => {
  it("finds pages by every word of the query, release notes last, across both catalogs", () => {
    const docs = homeDocs(TOC, GUIDES);
    expect(searchHomeDocs(docs, "エージェント").map((doc) => doc.title)).toEqual([
      "エージェント",
      "エージェントシステム",
    ]);
    expect(searchHomeDocs(docs, "ＨＯＯＫＳ").map((doc) => doc.title)).toEqual([
      "Claude Codeのhooksを修復する",
    ]);
    expect(searchHomeDocs(docs, "aidlc-workflows").at(-1)?.title).toMatch(/^aidlc-workflows \d/);
    expect(searchHomeDocs(docs, "   ")).toEqual([]);
  });

  it("titles the release overview pages and puts the newest version first", () => {
    const releases = homeShelves(homeDocs(TOC, GUIDES)).find((shelf) => shelf.id === "releases");
    expect(releases?.featured.map((doc) => doc.title)).toEqual([
      "更新のハイライト",
      "更新履歴一覧",
      "aidlc-workflows 2.11.1",
      "aidlc-workflows 2.10.0",
    ]);
  });

  it("keeps the Tips index off the Tips shelf, since the shelf's link opens it", () => {
    const tips = homeShelves(homeDocs(TOC, GUIDES)).find((shelf) => shelf.id === "tips");
    expect(tips?.featured.map((doc) => doc.title)).toEqual(["Claude Codeのhooksを修復する"]);
    expect(tips?.total).toBe(1);
  });

  it("drops a shelf whose pages are missing from the bundle", () => {
    const ids = homeShelves(homeDocs({ ...TOC, reference: [] }, GUIDES)).map((shelf) => shelf.id);
    expect(ids).not.toContain("reference");
  });
});

describe("DocsHome", () => {
  it("opens a reading-order step and a shelf page directly", async () => {
    const h = handlers();
    render(<Harness handlers={h} />);

    const steps = within(screen.getByRole("region", { name: "はじめて読むなら" }));
    expect(steps.getAllByRole("button")).toHaveLength(5);
    for (const [index, title] of [
      "AI-DLC の概要",
      "はじめに",
      "最初のワークフロー",
      "フェーズとステージ",
      "用語集",
    ].entries())
      expect(
        steps.getByRole("button", { name: new RegExp(`^ステップ ${index + 1}: ?${title}$`) }),
      ).toBeTruthy();
    await userEvent.click(steps.getByRole("button", { name: /ステップ 2/ }));
    expect(h.onSelectPath).toHaveBeenCalledWith("guide/01-getting-started.md");

    const extension = within(screen.getByRole("region", { name: "拡張機能の使い方" }));
    await userEvent.click(
      extension.getByRole("button", { name: "はじめに — インストールから初回 Setup まで" }),
    );
    expect(h.onSelectGuide).toHaveBeenCalledWith("getting-started.md");
  });

  it("opens the full list for a shelf with more pages than it shows", async () => {
    const h = handlers();
    render(<Harness handlers={h} />);

    await userEvent.click(
      screen.getByRole("button", { name: "ユーザーガイドをすべて見る（9件）" }),
    );
    expect(h.onOpenCategory).toHaveBeenCalledWith("workflow");
    expect(screen.queryByRole("button", { name: /更新履歴をすべて見る/ })).toBeNull();
  });

  it("replaces the shelves with results while searching and restores them on Escape", async () => {
    const h = handlers();
    render(<Harness handlers={h} />);

    const search = screen.getByRole("searchbox", { name: "ページを探す" });
    await userEvent.type(search, "hooks");
    expect(screen.getByRole("status").textContent).toBe("「hooks」に一致するページ: 1件");
    expect(screen.queryByRole("region", { name: "はじめて読むなら" })).toBeNull();
    await userEvent.click(screen.getByTestId("docs-home-result"));
    expect(h.onSelectGuide).toHaveBeenCalledWith("aidlc-tip-hooks.md");

    fireEvent.keyDown(search, { key: "Escape", isComposing: true });
    expect((search as HTMLInputElement).value).toBe("hooks");

    search.focus();
    await userEvent.keyboard("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("region", { name: "はじめて読むなら" })).toBeTruthy();
  });

  it("hands an unmatched search to the question box", async () => {
    const h = handlers();
    render(<Harness handlers={h} />);

    await userEvent.type(screen.getByRole("searchbox", { name: "ページを探す" }), "承認の取り消し");
    expect(screen.getByText("ページが見つかりませんでした")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "この内容をAIに質問する" }));
    expect(h.onAsk).toHaveBeenCalledWith("承認の取り消し");
  });

  it("offers no question path while questions are unavailable", async () => {
    const h = handlers();
    render(<Harness handlers={h} ask={false} />);

    expect(screen.queryByTestId("docs-home-ask-jump")).toBeNull();
    await userEvent.type(screen.getByRole("searchbox", { name: "ページを探す" }), "zzzz");
    expect(screen.queryByRole("button", { name: "この内容をAIに質問する" })).toBeNull();
  });

  it("keeps the official pages searchable when the guide catalog fails", async () => {
    const h = handlers();
    render(
      <DocsHome
        tocView={success(TOC)}
        guidesView={{ kind: "error", detail: "ガイド一覧を読み込めません" }}
        query="スコープ"
        onQueryChange={() => {}}
        onSelectPath={h.onSelectPath}
        onSelectGuide={h.onSelectGuide}
        onOpenCategory={h.onOpenCategory}
      />,
    );

    expect(screen.getByText("ガイド一覧を読み込めません")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("「スコープ」に一致するページ: 1件");
    await userEvent.click(screen.getByTestId("docs-home-result"));
    expect(h.onSelectPath).toHaveBeenCalledWith("guide/05-scopes-and-depth.md");
  });

  it("keeps the authored guides reachable when the official table of contents fails", () => {
    const h = handlers();
    render(
      <Harness
        handlers={h}
        tocView={{ kind: "error", detail: "目次を読み込めません" } as ViewState<OfficialDocsToc>}
      />,
    );

    expect(screen.getByText("目次を読み込めません")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "はじめて読むなら" })).toBeNull();
    expect(screen.getByRole("region", { name: "運用Tips" })).toBeTruthy();
  });
});
