import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailPanel } from "@/features/stage/StagePage.tsx";
import { DocsShell } from "@/features/docs/DocsPage.tsx";
import { AnchorApplier, slugifyHeading } from "@/features/docs/components/qa/AnchorApplier.tsx";
import { Header } from "@/shell/Header.tsx";
import { StoreProvider, useDispatch } from "@/store/context.tsx";
import { reducer } from "@/store/reducer.ts";
import { initialState } from "@/store/state.ts";

const DOCS_ROOT = path.dirname(fileURLToPath(import.meta.url));

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  // Unmount and flush pending effects before restoring jsdom's missing scroll API.
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type StubOptions = {
  missingJa?: boolean;
  /** ja TOC omits concepts.md (asymmetric / sparse-ja). */
  sparseJaToc?: boolean;
  /** Page fetch returns not_found for the selected path. */
  notFoundPath?: string;
  /** Override anchorApplied on page responses. */
  anchorApplied?: "scrolled" | "top" | "none";
};

function stubOfficialDocsApi(options?: StubOptions): ReturnType<typeof vi.fn> {
  const missingJa = options?.missingJa === true;
  const sparseJaToc = options?.sparseJaToc === true;
  const notFoundPath = options?.notFoundPath;
  const anchorApplied = options?.anchorApplied ?? "none";

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/official-docs/manifest") {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            sourceVersion: "aidlc 1.4.0",
            source: "aidlc-workflows",
            capturedAt: "2026-07-31T00:00:00.000Z",
          },
        }),
      );
    }
    if (path.includes("/api/official-docs/toc/")) {
      const isJa = path.includes("/toc/ja");
      // Shaped like the real tree: top-level pages, then directory categories.
      // `harnesses` has a README (clickable category); `04-stages` has none
      // (label-only category).
      const guide = [
        {
          id: "guide/getting-started.md",
          title: "Getting started",
          path: "guide/getting-started.md",
          children: [],
        },
        ...(isJa && sparseJaToc
          ? []
          : [
              {
                id: "guide/concepts.md",
                title: "Concepts",
                path: "guide/concepts.md",
                children: [],
              },
            ]),
        {
          id: "guide/harnesses",
          title: "Running on other harnesses",
          path: "guide/harnesses/README.md",
          children: [
            {
              id: "guide/harnesses/cursor.md",
              title: "Cursor",
              path: "guide/harnesses/cursor.md",
              children: [],
            },
          ],
        },
      ];
      const reference = [
        {
          id: "reference/04-stages",
          title: "Stages",
          children: [
            {
              id: "reference/04-stages/ideation.md",
              title: "Ideation",
              path: "reference/04-stages/ideation.md",
              children: [],
            },
          ],
        },
      ];
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            overview: [
              {
                id: "overview/README.md",
                title: "AI-DLC ドキュメント",
                path: "overview/README.md",
                children: [],
              },
              ...["release-highlights", "changelog"].map((name) => ({
                id: `overview/${name}.md`,
                title: name === "release-highlights" ? "更新のハイライト" : "更新履歴一覧",
                path: `overview/${name}.md`,
                children: [],
              })),
              {
                id: "overview/releases",
                title: "Releases",
                children: ["0.3.1", "0.3.2", "0.3.9", "0.3.10", "2.7.0", "2.8.0", "2.8.1"].map(
                  (version) => ({
                    id: `overview/releases/${version}.md`,
                    title: `aidlc-workflows ${version}`,
                    path: `overview/releases/${version}.md`,
                    children: [],
                  }),
                ),
              },
            ],
            guide,
            reference,
          },
        }),
      );
    }
    if (path === "/api/guides") {
      return Response.json({
        ok: true,
        value: [
          { name: "README.md", title: "拡張機能ガイドの目次" },
          { name: "getting-started.md", title: "拡張機能のはじめかた" },
          { name: "stage-timing.md", title: "ステージ時間の算出方法" },
        ],
      });
    }
    if (path.startsWith("/api/guides/")) {
      if (path.endsWith("/stage-timing.md")) {
        return Response.json({
          ok: true,
          value: {
            name: "stage-timing.md",
            title: "ステージ時間の算出方法",
            markdown: "# ステージ時間の算出方法\n\n20分を超えるログ空白を除外します。",
          },
        });
      }
      const isIndex = path.endsWith("/README.md");
      return Response.json({
        ok: true,
        value: {
          name: isIndex ? "README.md" : "getting-started.md",
          title: isIndex ? "拡張機能ガイドの目次" : "拡張機能のはじめかた",
          markdown: isIndex
            ? "# 拡張機能ガイドの目次\n\n[セットアップ](./getting-started.md)\n"
            : "# 拡張機能のはじめかた\n\nExtension setup body.\n",
        },
      });
    }
    if (/\/api\/official-docs\/(en|ja)\/overview\//.test(path)) {
      const documentPath = path.split(/\/api\/official-docs\/(?:en|ja)\//)[1];
      return Response.json({
        ok: true,
        value: {
          localeRequested: path.includes("/ja/") ? "ja" : "en",
          localeServed: path.includes("/ja/") ? "ja" : "en",
          path: documentPath,
          title: "Release notes",
          bodyMarkdown: `# Release notes\n\nHistory body: ${documentPath}\n`,
          sourceVersion: "aidlc 1.4.0",
          anchorApplied,
        },
      });
    }
    if (notFoundPath !== undefined && path.includes(`/${notFoundPath}`)) {
      return new Response(JSON.stringify({ error: true, reason: "not_found" }));
    }
    if (path.includes("/api/official-docs/ja/guide/getting-started.md") && missingJa) {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            localeRequested: "ja",
            localeServed: "en",
            path: "guide/getting-started.md",
            bodyMarkdown: "# Getting started\n\nEnglish fallback body.\n",
            title: "Getting started",
            notice: "missing_ja",
            sourceVersion: "aidlc 1.4.0",
            anchorApplied,
          },
        }),
      );
    }
    if (path.includes("/guide/concepts.md")) {
      const isJa = path.includes("/ja/");
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            localeRequested: isJa ? "ja" : "en",
            localeServed: isJa && missingJa ? "en" : isJa ? "ja" : "en",
            path: "guide/concepts.md",
            bodyMarkdown:
              "# Concepts\n\n## Approval gates\n\nConcept body.\n\n[Gates](#approval-gates)\n\n## Reading order\n\nRead gates first.\n",
            title: "Concepts",
            ...(isJa && missingJa ? { notice: "missing_ja" } : {}),
            sourceVersion: "aidlc 1.4.0",
            anchorApplied,
          },
        }),
      );
    }
    if (path.includes("/guide/harnesses/cursor.md")) {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            localeRequested: path.includes("/ja/") ? "ja" : "en",
            localeServed: path.includes("/ja/") ? "ja" : "en",
            path: "guide/harnesses/cursor.md",
            bodyMarkdown: "# Cursor\n\nCursor harness body.\n",
            title: "Cursor",
            sourceVersion: "aidlc 1.4.0",
            anchorApplied,
          },
        }),
      );
    }
    if (path.includes("/guide/getting-started.md")) {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            localeRequested: path.includes("/ja/") ? "ja" : "en",
            localeServed: path.includes("/ja/") ? "ja" : "en",
            path: "guide/getting-started.md",
            bodyMarkdown:
              "# Getting started\n\nHello official docs.\n\n- **初めて使う方**: [Concepts](concepts.md)\n\nSee [AWS](https://example.com/).\n",
            title: "Getting started",
            sourceVersion: "aidlc 1.4.0",
            anchorApplied,
          },
        }),
      );
    }
    return new Response(JSON.stringify({ error: true, reason: "unexpected" }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function Harness(): ReactNode {
  return (
    <StoreProvider>
      <Header />
      <DocsShell />
    </StoreProvider>
  );
}

function DeepLinkOpen({
  path,
  anchor,
  locale = "en",
}: {
  path: string;
  anchor: string;
  locale?: "en" | "ja";
}): null {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: "docs-shell", open: true, locale, path, anchor });
  }, [dispatch, path, anchor, locale]);
  return null;
}

function DeepLinkHarness({
  path,
  anchor,
  locale = "en",
}: {
  path: string;
  anchor: string;
  locale?: "en" | "ja";
}): ReactNode {
  return (
    <StoreProvider>
      <DeepLinkOpen path={path} anchor={anchor} locale={locale} />
      <DocsShell />
    </StoreProvider>
  );
}

function HostDeepLinkButton(): ReactNode {
  const dispatch = useDispatch();
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({ type: "docs-shell", open: true, locale: "en", path: "guide/concepts.md" })
      }
    >
      Open host document link
    </button>
  );
}

function HostDocsHomeButton(): ReactNode {
  const dispatch = useDispatch();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: "docs-shell", open: true, locale: "en" })}
    >
      Open host document home
    </button>
  );
}

async function openDocs(): Promise<void> {
  await userEvent.click(screen.getByTestId("header-menu-trigger"));
  await userEvent.click(await screen.findByTestId("official-docs-open"));
}

async function openDocsDrawer(): Promise<void> {
  await userEvent.click(screen.getByTestId("docs-menu"));
  await waitFor(() => {
    expect(screen.getByTestId("docs-drawer")).toBeTruthy();
  });
}

async function pickToc(path: string): Promise<void> {
  await openDocsDrawer();
  const testId = `docs-toc-${path}`;
  await waitFor(() => {
    expect(screen.getByTestId(testId)).toBeTruthy();
  });
  await userEvent.click(screen.getByTestId(testId));
}

async function openFirstOfficialDoc(): Promise<void> {
  await openDocs();
  await pickToc("guide/getting-started.md");
}

function AnchorHarness({
  anchorApplied,
  anchor,
}: {
  anchorApplied: "scrolled" | "top" | "none";
  anchor?: string;
}): ReactNode {
  const articleRef = useRef<HTMLElement>(null);
  return (
    <main ref={articleRef} data-testid="anchor-article" tabIndex={-1}>
      <h1>Concepts</h1>
      <h2>Approval gates</h2>
      <p>Body</p>
      <AnchorApplier
        anchorApplied={anchorApplied}
        anchor={anchor}
        articleRef={articleRef}
        contentKey={`${anchorApplied}:${anchor ?? ""}`}
      />
    </main>
  );
}

describe("DocsShell — walking skeleton", () => {
  it("opens the timing guide from stage details through the extension guide route", async () => {
    const fetchMock = stubOfficialDocsApi();
    render(
      <StoreProvider preloaded={{ route: { name: "stage", slug: "code-generation" } }}>
        <DetailPanel />
        <DocsShell />
      </StoreProvider>,
    );
    await userEvent.click(screen.getByRole("tab", { name: "時間" }));
    await userEvent.click(screen.getByRole("button", { name: "算出方法を読む" }));
    expect(await screen.findByText("20分を超えるログ空白を除外します。")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/guides/stage-timing.md", expect.anything());
    expect(screen.queryByTestId("detail-panel")).toBeNull();
    await openDocsDrawer();
    expect(screen.getByRole("tab", { name: "拡張機能" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("opens a dedicated document home without automatically loading an article", async () => {
    const fetchMock = stubOfficialDocsApi();
    render(<Harness />);
    await openDocs();

    expect(await screen.findByTestId("docs-home")).toBeTruthy();
    expect(screen.queryByTestId("docs-article-h1")).toBeNull();
    const paths = fetchMock.mock.calls.map(([request]) => String(request));
    expect(paths.some((path) => /\/api\/official-docs\/(ja|en)\//.test(path))).toBe(false);
    expect(paths.some((path) => path.startsWith("/api/guides/"))).toBe(false);
  });

  it("opens pages straight from the home search and shelves, without the drawer", async () => {
    stubOfficialDocsApi();
    render(<Harness />);
    await openDocs();

    const home = within(await screen.findByTestId("docs-home"));
    await userEvent.type(await home.findByRole("searchbox", { name: "ページを探す" }), "concepts");
    await userEvent.click(await home.findByTestId("docs-home-result"));
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body.");
    });
    expect(screen.queryByTestId("docs-drawer")).toBeNull();

    await openDocsDrawer();
    await userEvent.click(screen.getByRole("button", { name: "トップページへ" }));
    const back = within(await screen.findByTestId("docs-home"));
    // The search survives the trip to the article and back.
    expect(back.getByRole<HTMLInputElement>("searchbox", { name: "ページを探す" }).value).toBe(
      "concepts",
    );
    await userEvent.clear(back.getByRole("searchbox", { name: "ページを探す" }));
    const extension = within(back.getByRole("region", { name: "拡張機能の使い方" }));
    await userEvent.click(extension.getByRole("button", { name: "拡張機能のはじめかた" }));
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Extension setup body");
    });
  });

  it("keeps the docs page open when its navigation menu closes and restores focus on page close", async () => {
    stubOfficialDocsApi();
    render(<Harness />);
    await openDocs();
    expect(await screen.findByTestId("docs-home")).toBeTruthy();

    const menu = screen.getByTestId("header-menu-trigger");
    await userEvent.click(menu);
    expect((await screen.findByTestId("official-docs-open")).getAttribute("aria-current")).toBe(
      "page",
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("docs-shell")).toBeTruthy();
    expect(screen.queryByTestId("docs-shell-close")).toBeNull();
    screen.getByTestId("docs-menu").focus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("docs-shell")).toBeNull();
      expect(document.activeElement).toBe(menu);
    });
  });

  it("returns from an article to the document home", async () => {
    stubOfficialDocsApi();
    render(<Harness />);
    await openFirstOfficialDoc();
    await waitFor(() => expect(screen.getByTestId("docs-article").textContent).toContain("Hello"));

    expect(screen.queryByRole("button", { name: "ドキュメントトップ" })).toBeNull();
    await openDocsDrawer();
    await userEvent.click(screen.getByRole("button", { name: "トップページへ" }));

    expect(await screen.findByTestId("docs-home")).toBeTruthy();
    expect(screen.getByTestId("docs-article").textContent).not.toContain("Hello official docs");
    expect(screen.getByTestId("docs-shell")).toBeTruthy();
  });

  it("groups official docs and release history under workflow, separate from extension", async () => {
    stubOfficialDocsApi();
    render(<Harness />);
    await openDocs();
    await openDocsDrawer();

    const officialTab = screen.getByRole("tab", { name: "ワークフロー" });
    expect(officialTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "拡張機能" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "更新履歴" })).toBeTruthy();
    expect(await screen.findByTestId("docs-toc-overview/README.md")).toBeTruthy();
    expect(screen.getByTestId("docs-toc-guide/getting-started.md")).toBeTruthy();
    expect(screen.queryByTestId("docs-toc-overview/release-highlights.md")).toBeNull();
    expect(screen.queryByTestId("docs-toc-overview/changelog.md")).toBeNull();
    expect(screen.queryByTestId("docs-toc-overview/releases/2.8.1.md")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "更新履歴" }));
    expect(await screen.findByTestId("docs-toc-overview/release-highlights.md")).toBeTruthy();
    expect(screen.getByTestId("docs-toc-overview/changelog.md")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId("docs-toc-overview/README.md")).toBeNull();
      expect(screen.queryByTestId("docs-toc-guide/getting-started.md")).toBeNull();
    });
    const versions = within(screen.getByTestId("docs-drawer"))
      .getAllByRole("button", { name: /^aidlc-workflows / })
      .map((button) => button.textContent);
    expect(versions).toEqual([
      "aidlc-workflows 2.8.1",
      "aidlc-workflows 2.8.0",
      "aidlc-workflows 2.7.0",
      "aidlc-workflows 0.3.10",
      "aidlc-workflows 0.3.9",
    ]);

    await userEvent.click(screen.getByRole("tab", { name: "拡張機能" }));
    expect(await screen.findByTestId("docs-guide-README.md")).toBeTruthy();
    expect(screen.getByTestId("docs-guide-getting-started.md")).toBeTruthy();
    expect(screen.queryByTestId("docs-toc-overview/changelog.md")).toBeNull();
  });

  it("keeps the current article while browsing another tab and opens guide links in the same shell", async () => {
    const fetchMock = stubOfficialDocsApi();
    render(<Harness />);
    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");
    });
    await openDocsDrawer();
    await userEvent.click(screen.getByRole("tab", { name: "拡張機能" }));
    expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");

    await userEvent.click(await screen.findByTestId("docs-guide-README.md"));
    await userEvent.click(await screen.findByRole("link", { name: "セットアップ" }));
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Extension setup body");
    });
    expect(screen.queryByTestId("docs-drawer")).toBeNull();
    expect(screen.queryByTestId("guides-panel")).toBeNull();
    expect(screen.getByTestId("docs-shell")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/guides/getting-started.md", expect.anything());
    await openDocsDrawer();
    expect(screen.getByRole("tab", { name: "拡張機能" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("docs-guide-getting-started.md").getAttribute("data-active")).toBe(
      "true",
    );
  });

  it("opens release highlights and the history index from the workflow tab", async () => {
    const fetchMock = stubOfficialDocsApi();
    render(<Harness />);
    await openDocs();
    await openDocsDrawer();
    await userEvent.click(screen.getByRole("button", { name: "更新履歴" }));
    await userEvent.click(await screen.findByTestId("docs-toc-overview/release-highlights.md"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/overview/release-highlights.md"),
        expect.anything(),
      );
    });
    await pickToc("overview/changelog.md");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/overview/changelog.md"),
        expect.anything(),
      );
    });
  });

  it("loads manifest version, TOC, and page body (happy path)", async () => {
    stubOfficialDocsApi();
    render(<Harness />);

    await openFirstOfficialDoc();
    expect(screen.getByTestId("docs-shell")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("source-version").textContent).toContain("aidlc 1.4.0");
    });
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");
    });
    // List is in the left drawer, not beside the article.
    expect(screen.queryByTestId("docs-toc-guide/getting-started.md")).toBeNull();

    await pickToc("guide/concepts.md");
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });
  });

  it("shows a page outline beside the article and jumps to a section from it", async () => {
    stubOfficialDocsApi();
    render(<Harness />);

    await openDocs();
    await pickToc("guide/concepts.md");

    const outline = await screen.findByRole("navigation", { name: "このページの内容" });
    expect(
      within(outline)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Approval gates", "Reading order"]);
    // Readability styles hang off this wrapper (app.css `.docs-article`).
    expect(screen.getByTestId("docs-article").querySelector(".docs-article")).not.toBeNull();

    await userEvent.click(within(outline).getByRole("button", { name: "Reading order" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Reading order" }));
    });
  });

  it("switches locale via LocaleControl and keeps path when present in both TOCs", async () => {
    const fetchMock = stubOfficialDocsApi();
    const posted: unknown[] = [];
    vi.stubGlobal("acquireVsCodeApi", () => ({
      postMessage: (message: unknown) => {
        posted.push(message);
      },
    }));
    render(<Harness />);

    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    });
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");
    });

    await pickToc("guide/concepts.md");
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });
    await openDocsDrawer();
    expect(screen.getByTestId("docs-toc-guide/concepts.md").getAttribute("data-active")).toBe(
      "true",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("docs-drawer")).toBeNull();
    });

    await userEvent.click(screen.getByTestId("locale-control"));
    await waitFor(() => {
      expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en");
    });
    await waitFor(() => {
      const paths = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(paths.some((p) => p.includes("/api/official-docs/toc/en"))).toBe(true);
      expect(paths.some((p) => p.includes("/api/official-docs/en/guide/concepts.md"))).toBe(true);
    });
    await openDocsDrawer();
    await waitFor(() => {
      expect(screen.getByTestId("docs-toc-guide/concepts.md").getAttribute("data-active")).toBe(
        "true",
      );
    });
    expect(posted).toContainEqual({ type: "official-docs-locale", locale: "en" });
  });

  it("keep-path on sparse-ja TOC: path stays even when absent from ja TOC", async () => {
    const fetchMock = stubOfficialDocsApi({ sparseJaToc: true, missingJa: true });
    render(<Harness />);

    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("English fallback body");
    });

    await userEvent.click(screen.getByTestId("locale-control"));
    await waitFor(() => {
      expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en");
    });

    await pickToc("guide/concepts.md");
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });

    await userEvent.click(screen.getByTestId("locale-control"));
    await waitFor(() => {
      expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    });

    // Path kept — still requests concepts under ja, not jump to getting-started.
    await waitFor(() => {
      const paths = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(paths.some((p) => p.includes("/api/official-docs/ja/guide/concepts.md"))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });

    await openDocsDrawer();
    await waitFor(() => {
      expect(screen.getByTestId("docs-toc-guide/getting-started.md")).toBeTruthy();
    });
    // TOC highlight only when path ∈ TOC — concepts gone from sparse ja TOC.
    expect(screen.queryByTestId("docs-toc-guide/concepts.md")).toBeNull();
    const firstToc = screen.getByTestId("docs-toc-guide/getting-started.md");
    expect(firstToc.getAttribute("data-active")).not.toBe("true");
  });

  it("shows UntranslatedNotice only for missing_ja; LocaleControl stays on ja", async () => {
    stubOfficialDocsApi({ missingJa: true });
    render(<Harness />);

    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByTestId("untranslated-notice")).toBeTruthy();
    });
    expect(screen.getByTestId("untranslated-notice").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("docs-article").textContent).toContain("English fallback body");
    // LocaleControl remains on localeRequested (ja), not localeServed (en).
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    expect(screen.getByTestId("locale-control").textContent).toBe("JA");
    expect(screen.getByTestId("locale-control").getAttribute("aria-label")).toBe("英語に切り替え");
  });

  it("404 / not_found never shows UntranslatedNotice", async () => {
    stubOfficialDocsApi({ notFoundPath: "guide/concepts.md" });
    render(<Harness />);

    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");
    });

    await pickToc("guide/concepts.md");
    await waitFor(() => {
      expect(screen.getByText("読み込みエラー")).toBeTruthy();
    });
    expect(screen.queryByTestId("untranslated-notice")).toBeNull();
  });

  it("soft Should FR-B2-S1: article exposes h1 page title when available", async () => {
    stubOfficialDocsApi();
    render(<Harness />);

    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");
    });
    // Soft: present when DocsShell cheap path ships; MarkdownSurface still demotes # → h3.
    const h1 = screen.queryByTestId("docs-article-h1");
    expect(h1).toBeTruthy();
    expect(h1?.tagName).toBe("H1");
    expect(h1?.textContent).toContain("Getting started");
  });

  it("deep-link open wires path + anchor into the page fetch (FR-B2-3)", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const fetchMock = stubOfficialDocsApi({ anchorApplied: "scrolled" });
    render(<DeepLinkHarness path="guide/concepts.md" anchor="#approval-gates" />);

    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });
    await waitFor(() => {
      const paths = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(
        paths.some(
          (p) =>
            p.includes("/api/official-docs/en/guide/concepts.md") &&
            p.includes("anchor=approval-gates"),
        ),
      ).toBe(true);
    });
  });

  it("deep-link locale applies to LocaleControl before path fetch (FR-B3-4.3)", async () => {
    const fetchMock = stubOfficialDocsApi();
    render(<DeepLinkHarness path="guide/concepts.md" anchor="approval-gates" locale="ja" />);

    await waitFor(() => {
      expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    });
    await waitFor(() => {
      const paths = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(paths.some((p) => p.includes("/api/official-docs/toc/ja"))).toBe(true);
      expect(paths.some((p) => p.includes("/api/official-docs/ja/guide/concepts.md"))).toBe(true);
    });
  });

  it("opens an official host link after a guide and returns home for a locale-only host link", async () => {
    stubOfficialDocsApi();
    render(
      <StoreProvider>
        <Header />
        <HostDeepLinkButton />
        <HostDocsHomeButton />
        <DocsShell />
      </StoreProvider>,
    );
    await openDocs();
    await openDocsDrawer();
    await userEvent.click(screen.getByRole("tab", { name: "拡張機能" }));
    await userEvent.click(await screen.findByTestId("docs-guide-getting-started.md"));
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Extension setup body");
    });

    await userEvent.click(screen.getByRole("button", { name: "Open host document link" }));
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en");
    await openDocsDrawer();
    expect(screen.getByRole("tab", { name: "ワークフロー" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("docs-drawer")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Open host document home" }));
    expect(await screen.findByTestId("docs-home")).toBeTruthy();
    expect(screen.getByTestId("docs-article").textContent).not.toContain("Concept body");
  });

  it("opens the workflow history section when a host link opens release notes", async () => {
    stubOfficialDocsApi();
    render(<DeepLinkHarness path="overview/releases/2.8.1.md" anchor="" />);
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("History body");
    });
    await openDocsDrawer();
    expect(screen.getByRole("tab", { name: "ワークフロー" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "更新履歴" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      screen.getByTestId("docs-toc-overview/releases/2.8.1.md").getAttribute("data-active"),
    ).toBe("true");
  });

  it("scrolls to the article top again when the same host link has no fragment", async () => {
    const fetchMock = stubOfficialDocsApi();
    render(
      <StoreProvider>
        <HostDeepLinkButton />
        <DocsShell />
      </StoreProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Open host document link" });
    await userEvent.click(trigger);
    const article = await screen.findByTestId("docs-article");
    await waitFor(() => expect(article.textContent).toContain("Concept body"));
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const pageReads = () =>
      fetchMock.mock.calls.filter(([request]) =>
        String(request).includes("/api/official-docs/en/guide/concepts.md"),
      ).length;
    const previousPageReads = pageReads();
    scrollIntoView.mockClear();

    await userEvent.click(trigger);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" }));
    expect(scrollIntoView.mock.contexts).toEqual([article]);
    expect(pageReads()).toBe(previousPageReads);
  });

  it("follows a relative .md link in the article to another official-docs page", async () => {
    const fetchMock = stubOfficialDocsApi();
    render(<Harness />);

    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");
    });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    await userEvent.click(screen.getByRole("link", { name: "Concepts" }));
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });
    const paths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(paths.some((p) => p.includes("/api/official-docs/ja/guide/concepts.md"))).toBe(true);
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("re-applies the same fragment when the in-page hash link is clicked again", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    stubOfficialDocsApi({ anchorApplied: "scrolled" });
    render(<DeepLinkHarness path="guide/concepts.md" anchor="#approval-gates" />);

    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Concept body");
    });
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    await userEvent.click(screen.getByRole("link", { name: "Gates" }));
    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("leaves an https link as navigation the shell does not intercept", async () => {
    stubOfficialDocsApi();
    render(<Harness />);

    await openFirstOfficialDoc();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "AWS" })).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("link", { name: "AWS" }));
    expect(screen.getByTestId("docs-article").textContent).toContain("Hello official docs");
    expect(screen.getByTestId("docs-article").textContent).not.toContain("Concept body");
  });
});

describe("AnchorApplier", () => {
  it("slugifyHeading matches GitHub-style anchors", () => {
    expect(slugifyHeading("Approval gates")).toBe("approval-gates");
  });

  it("none → does not scroll", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AnchorHarness anchorApplied="none" anchor="approval-gates" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("top → scrolls/focuses article", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AnchorHarness anchorApplied="top" />);
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    expect(document.activeElement).toBe(screen.getByTestId("anchor-article"));
  });

  it("scrolled → scrolls/focuses matching heading", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<AnchorHarness anchorApplied="scrolled" anchor="approval-gates" />);
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    expect(document.activeElement?.textContent).toBe("Approval gates");
  });
});

describe("docs-shell route exclusivity", () => {
  it("clears stage / guides when docs shell opens, and vice versa", () => {
    const withStage = reducer(initialState, {
      type: "select",
      selection: { kind: "stage", slug: "code-generation" },
    });
    const shell = reducer(withStage, {
      type: "docs-shell",
      open: true,
      locale: "en",
      path: "guide/concepts.md",
      anchor: "approval-gates",
    });
    expect(shell.route).toEqual({
      name: "docs",
      deepLink: {
        locale: "en",
        path: "guide/concepts.md",
        anchor: "approval-gates",
      },
    });
    expect(shell.officialDocsLocale).toBe("en");

    const plugins = reducer(shell, { type: "plugins", open: true });
    expect(plugins.route).toEqual({ name: "plugins" });

    const back = reducer(plugins, { type: "docs-shell", open: true });
    expect(back.route).toEqual({ name: "docs" });

    const home = reducer(back, { type: "home" });
    expect(home.route).toEqual({ name: "home" });
  });
});

describe("DocsToc — directory categories", () => {
  it("collapses books independently and restores their page links", async () => {
    stubOfficialDocsApi();
    render(<Harness />);
    await openDocs();
    await openDocsDrawer();

    const guide = await screen.findByRole("button", { name: "ユーザーガイド" });
    await userEvent.click(guide);
    expect(guide.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => {
      expect(screen.queryByTestId("docs-toc-guide/getting-started.md")).toBeNull();
    });
    expect(screen.getByTestId("docs-toc-overview/README.md")).toBeTruthy();
    expect(screen.getByTestId("docs-toc-reference/04-stages/ideation.md")).toBeTruthy();

    await userEvent.click(guide);
    expect(guide.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(await screen.findByTestId("docs-toc-guide/harnesses/cursor.md"));
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Cursor harness body");
    });
  });

  it("renders folders with separate overview pages and collapses nested children", async () => {
    stubOfficialDocsApi();
    render(<Harness />);

    await openDocs();
    await openDocsDrawer();

    // Books stay separate; guide + reference are not merged into one list.
    await waitFor(() => {
      expect(screen.getByTestId("docs-toc-book-guide").textContent).toBe("ユーザーガイド");
    });
    expect(screen.getByTestId("docs-toc-book-reference").textContent).toBe("開発者リファレンス");

    // The folder toggles separately from its own overview page.
    const folder = screen.getByTestId("docs-toc-group-guide/harnesses");
    const harnesses = screen.getByTestId("docs-toc-guide/harnesses/README.md");
    expect(harnesses.textContent).toBe("Running on other harnesses — 概要");

    // Its page rows live in a list nested under that row, not at top level.
    const cursor = screen.getByTestId("docs-toc-guide/harnesses/cursor.md");
    expect(folder.closest("li")?.contains(cursor)).toBe(true);
    await userEvent.click(folder);
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => {
      expect(screen.queryByTestId("docs-toc-guide/harnesses/cursor.md")).toBeNull();
      expect(screen.queryByTestId("docs-toc-guide/harnesses/README.md")).toBeNull();
    });
    expect(screen.getByTestId("docs-home")).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByTestId("docs-toc-guide/harnesses/cursor.md")).toBeTruthy();

    // Folders without an overview also toggle, without inventing a page link.
    const stages = screen.getByTestId("docs-toc-group-reference/04-stages");
    expect(stages.tagName).toBe("BUTTON");
    expect(stages.textContent).toBe("Stages");
    const ideation = screen.getByTestId("docs-toc-reference/04-stages/ideation.md");
    expect(stages.closest("li")?.contains(ideation)).toBe(true);
    await userEvent.click(stages);
    await waitFor(() => {
      expect(screen.queryByTestId("docs-toc-reference/04-stages/ideation.md")).toBeNull();
    });
  });

  it("selects a nested page and highlights it inside its category", async () => {
    stubOfficialDocsApi();
    render(<Harness />);

    await openDocs();
    await pickToc("guide/harnesses/cursor.md");
    await waitFor(() => {
      expect(screen.getByTestId("docs-article").textContent).toContain("Cursor harness body");
    });

    await openDocsDrawer();
    await waitFor(() => {
      expect(
        screen.getByTestId("docs-toc-guide/harnesses/cursor.md").getAttribute("data-active"),
      ).toBe("true");
    });
    expect(
      screen.getByTestId("docs-toc-guide/harnesses/README.md").getAttribute("data-active"),
    ).not.toBe("true");
  });
});

describe("docs-shell boundary", () => {
  it("DocsShell module source does not import official-docs or reader-core", async () => {
    const files = [
      "DocsPage.tsx",
      "components/qa/AnchorApplier.tsx",
      "components/DocsHome.tsx",
      "components/nav/DocsNavigation.tsx",
      "utils/docs-navigation.ts",
      "components/nav/DocsToc.tsx",
      "components/LocaleControl.tsx",
      "components/UntranslatedNotice.tsx",
      "components/SourceVersionBadge.tsx",
      "utils/resolve-doc-href.ts",
    ];
    for (const rel of files) {
      const src = await readFile(path.join(DOCS_ROOT, rel), "utf8");
      expect(src).not.toMatch(/@aidlc-guide\/official-docs/);
      expect(src).not.toMatch(/@aidlc-guide\/reader-core/);
      expect(src).not.toMatch(/from ["'].*reader-core/);
    }
  });
});
