import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { act, cleanup, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsDeepLink } from "@/app/routes.ts";
import { DocsShell } from "@/features/docs/DocsPage.tsx";
import { StoreProvider } from "@/store/context.tsx";

const guides = new Map<string, { name: string; title: string; markdown: string }>();
const originalScroll = Element.prototype.scrollIntoView;

beforeAll(async () => {
  const directory = path.resolve(import.meta.dirname, "../../../../../docs/guides");
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".md")) continue;
    const markdown = await readFile(path.join(directory, name), "utf8");
    guides.set(name, { name, title: /^# (.+)$/m.exec(markdown)?.[1] ?? name, markdown });
  }
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScroll;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function showTips(deepLink?: DocsDeepLink, tocError = false): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = String(input);
      if (route === "/api/guides")
        return Response.json({
          ok: true,
          value: [...guides.values()].map(({ name, title }) => ({ name, title })),
        });
      if (route.startsWith("/api/guides/"))
        return Response.json({ ok: true, value: guides.get(route.slice("/api/guides/".length)) });
      if (route.includes("/api/official-docs/toc/"))
        return Response.json(
          tocError
            ? { error: true, reason: "not-found" }
            : { ok: true, value: { overview: [], guide: [], reference: [] } },
        );
      if (route === "/api/official-docs/manifest")
        return Response.json({ ok: true, value: { sourceVersion: "2.10.0" } });
      return Response.json({ ok: true, value: [] });
    }),
  );
  render(
    <StoreProvider preloaded={{ route: { name: "docs", ...(deepLink ? { deepLink } : {}) } }}>
      <DocsShell />
    </StoreProvider>,
  );
}

async function openNavigation(): Promise<void> {
  await userEvent.click(screen.getByTestId("docs-menu"));
  await screen.findByTestId("docs-drawer");
}

describe("bundled Tips articles", () => {
  it("opens Tips from the menu after the host restores a conversation, preserving the history", async () => {
    showTips();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "docs-conversation",
            state: {
              draft: "次に確認することは？",
              turns: [
                {
                  id: "restored-question",
                  question: "hooksを確認するには？",
                  answer: "保存された回答です。",
                  citations: [],
                  locale: "ja",
                },
              ],
            },
          },
        }),
      );
    });
    expect(await screen.findByTestId("docs-chat")).toBeTruthy();
    expect(await screen.findByText("保存された回答です。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tips一覧を開く" })).toBeNull();
    await openNavigation();
    await userEvent.click(screen.getByRole("button", { name: "運用Tips" }));
    await userEvent.click(await screen.findByTestId("docs-guide-aidlc-workflows-tips.md"));
    expect(await screen.findByTestId("docs-article-h1")).toHaveProperty(
      "textContent",
      "aidlc-workflows Tips一覧",
    );
    await openNavigation();
    await userEvent.click(screen.getByTestId("docs-home-link"));
    expect(await screen.findByText("保存された回答です。")).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "続けて質問する" }).value).toBe(
      "次に確認することは？",
    );
  });

  it("opens separate articles, related reading and the index, with Tips in workflow navigation", async () => {
    showTips();
    await userEvent.click(await screen.findByRole("button", { name: "Tips一覧を開く" }));
    await userEvent.click(
      await screen.findByRole("link", { name: "「Claude Codeのhooksを修復する」を読む" }),
    );
    expect(await screen.findByTestId("docs-article-h1")).toHaveProperty(
      "textContent",
      "Claude Codeのhooksを修復する",
    );
    await openNavigation();
    expect(screen.getByRole("tab", { name: "ワークフロー" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "運用Tips" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    const list = within(screen.getByRole("navigation", { name: "運用Tips一覧" }));
    expect(list.getAllByRole("button")[0]?.textContent).toBe("aidlc-workflows Tips一覧");
    expect(list.getByTestId("docs-guide-aidlc-tip-hooks.md").getAttribute("aria-current")).toBe(
      "page",
    );
    await userEvent.click(screen.getByRole("tab", { name: "拡張機能" }));
    expect(await screen.findByTestId("docs-guide-getting-started.md")).toBeTruthy();
    expect(screen.queryByTestId("docs-guide-aidlc-tip-hooks.md")).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("docs-drawer")).toBeNull());
    await userEvent.click(screen.getByRole("link", { name: "/clear後も環境変数は残る？" }));
    await waitFor(() =>
      expect(screen.getByTestId("docs-article-h1").textContent).toBe("/clear後も環境変数は残る？"),
    );
    await openNavigation();
    expect(screen.getByRole("tab", { name: "ワークフロー" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("docs-drawer")).toBeNull());
    await userEvent.click(screen.getByRole("link", { name: "Tips一覧へ" }));
    expect(
      await screen.findByRole("link", { name: "「Claude Codeのhooksを修復する」を読む" }),
    ).toBeTruthy();
  });

  it("retains a legacy index anchor and selects Tips for a direct guide link even if the official TOC fails", async () => {
    showTips(
      { locale: "ja", guide: "aidlc-workflows-tips.md", anchor: "claude-codeのhooksを修復する" },
      true,
    );
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Claude Codeのhooksを修復する"),
    );
    await openNavigation();
    expect(screen.getByRole("tab", { name: "ワークフロー" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await userEvent.click(await screen.findByTestId("docs-guide-aidlc-tip-hooks.md"));
    await userEvent.click(
      await screen.findByRole("link", { name: "更新時の問題を診断・修正する" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("docs-article-h1").textContent).toBe(
        guides.get("updating-workflows.md")?.title,
      ),
    );
    await openNavigation();
    expect(screen.getByRole("tab", { name: "拡張機能" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});
