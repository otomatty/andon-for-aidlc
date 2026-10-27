import { render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownSurface, PLAIN_PREVIEW_LIMIT } from "@/viewer/MarkdownSurface.tsx";

/**
 * ADR-05 / team.md: every assertion here is against the **Props contract**
 * (`{markdown, editable, onEdit}`) and the DOM it must produce. Nothing pokes
 * at the renderer's internals, so swapping the renderer behind the contract
 * leaves this file untouched.
 */

vi.mock("./MermaidBlock.tsx", () => ({
  MermaidBlock: ({ code }: { code: string }): ReactNode => (
    <div data-testid="mermaid-stub">{code}</div>
  ),
}));

const SAMPLE = [
  "# 見出し1",
  "",
  "## 見出し2",
  "",
  "| 列A | 列B |",
  "|-----|-----|",
  "| a1  | b1  |",
  "| a2  | b2  |",
  "",
  "- 親",
  "  - 子",
  "    - 孫",
  "1. 一",
  "2. 二",
  "",
  "```ts",
  "const x: number = 1;",
  "```",
  "",
  "```mermaid",
  "graph TD",
  "  A --> B",
  "```",
  "",
  "`inline` と **強調** と [リンク](https://example.com)。",
  "",
  "<!-- cid:hidden-marker -->",
].join("\n");

function renderSurface(markdown: string): void {
  render(<MarkdownSurface markdown={markdown} editable={null} />);
}

describe("MarkdownSurface — the FR-6.1 five-point checklist, as a test", () => {
  it("keeps a GFM table a table, with its rows and columns", () => {
    renderSurface(SAMPLE);
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["列A", "列B"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2 body rows
    expect(within(table).getByText("a2")).toBeDefined();
  });

  it("hands a mermaid fence to MermaidBlock as bare source text", () => {
    renderSurface(SAMPLE);
    expect(screen.getByTestId("mermaid-stub").textContent).toBe("graph TD\n  A --> B");
  });

  it("keeps a non-mermaid fence as highlighted code, not as a diagram", () => {
    renderSurface(SAMPLE);
    const block = screen.getByTestId("code-block");
    expect(block.getAttribute("data-language")).toBe("ts");
    expect(block.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(block.textContent).toContain("const x: number = 1;");
    expect(screen.queryByTestId("mermaid-stub")).toBeDefined();
  });

  it("preserves the heading hierarchy and nested list structure", () => {
    renderSurface(SAMPLE);
    // Artifact headings start below the panel's own <h2>.
    expect(screen.getByRole("heading", { name: "見出し1" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "見出し2" }).tagName).toBe("H4");
    const grandchild = screen.getByText("孫");
    expect(grandchild.closest("li")?.parentElement?.closest("li")).not.toBeNull();
    expect(screen.getByText("一").closest("ol")).not.toBeNull();
  });

  it("carries the source text through without loss", () => {
    renderSurface(SAMPLE);
    const surface = screen.getByTestId("markdown-surface");
    for (const fragment of ["見出し1", "a1", "b2", "孫", "inline", "強調", "リンク"]) {
      expect(surface.textContent, fragment).toContain(fragment);
    }
  });

  it("renders **bold** as <strong> so viewer CSS can weight it", () => {
    renderSurface(SAMPLE);
    expect(screen.getByText("強調").tagName).toBe("STRONG");
  });

  it("renders read-only: no editable region, whatever `editable` says", () => {
    render(<MarkdownSurface markdown={SAMPLE} editable={{ answerLines: [3, 9] }} />);
    const surface = screen.getByTestId("markdown-surface");
    expect(surface.getAttribute("data-readonly")).toBe("true");
    expect(surface.getAttribute("data-answer-lines")).toBe("3,9");
    // Read-only is structural: nothing in the rendered tree can take input.
    expect(surface.querySelector("[contenteditable]")).toBeNull();
    expect(surface.querySelector("input, textarea, select")).toBeNull();
  });
});

describe("MarkdownSurface — the security boundary (S-AV-3)", () => {
  it("shows an HTML block as source text and never as an element", () => {
    renderSurface(['<img src="x" onerror="alert(1)">', "", "<b>太字ではない</b>"].join("\n"));
    const surface = screen.getByTestId("markdown-surface");
    expect(surface.querySelector("img")).toBeNull();
    expect(surface.querySelector("b")).toBeNull();
    expect(surface.textContent).toContain("<b>太字ではない</b>");
  });

  it("drops a javascript: link back to plain text", () => {
    renderSurface("[click](javascript:alert(1))");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("markdown-surface").textContent).toContain("click");
  });

  it("keeps an http link, with a safe rel", () => {
    renderSurface("[docs](https://example.com/a)");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/a");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("hides an HTML comment rather than printing its marker", () => {
    renderSurface(SAMPLE);
    expect(screen.getByTestId("markdown-surface").textContent).not.toContain("cid:hidden-marker");
  });

  it("highlights a fence without turning fence text into HTML elements", () => {
    renderSurface(["```html", "<img src=x onerror=alert(1)>", "```"].join("\n"));
    const block = screen.getByTestId("code-block");
    expect(block.querySelector("img")).toBeNull();
    expect(block.querySelector("script")).toBeNull();
    expect(block.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(block.querySelector("span.hljs-tag, span.hljs-name")).not.toBeNull();
  });
});

describe("MarkdownSurface — the two fallbacks to PlainPreview", () => {
  it("goes straight to plain preview above 1MB, without a rich render (P-AV-5)", () => {
    const huge = `# big\n\n${"あ".repeat(PLAIN_PREVIEW_LIMIT)}`;
    render(<MarkdownSurface markdown={huge} editable={null} />);
    expect(screen.getByTestId("plain-preview")).toBeDefined();
    expect(screen.queryByTestId("markdown-surface")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText(/1MB 超/)).toBeDefined();
  });

  // The run-time-crash fallback (D3 error(b)) needs a throwing renderer and so
  // lives in viewer-surface-crash.test.tsx, where the mock can differ.
});

describe("MarkdownSurface — file citations become jumps, in the IDE only", () => {
  const CITATIONS = "`packages/mcp-server/src/index.ts:20` と `bun run check` と `127.0.0.1`。";

  function stubHost(): { postMessage: ReturnType<typeof vi.fn> } {
    const api = { postMessage: vi.fn() };
    vi.stubGlobal("acquireVsCodeApi", () => api);
    return api;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the path and line the citation names, resolved host-side", async () => {
    const api = stubHost();
    renderSurface(CITATIONS);

    const button = screen.getByRole("button", { name: "packages/mcp-server/src/index.ts:20" });
    await userEvent.click(button);

    expect(api.postMessage).toHaveBeenCalledWith({
      type: "open-file",
      path: "packages/mcp-server/src/index.ts",
      line: 20,
    });
  });

  it("leaves a code span that is not a file alone, even in the IDE", () => {
    stubHost();
    renderSurface(CITATIONS);
    // One button, not three: the command and the IP address stay decoration.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("bun run check").tagName).toBe("CODE");
    expect(screen.getByText("127.0.0.1").tagName).toBe("CODE");
  });

  it("stays plain inside a link, where a button would fire two actions", async () => {
    const api = stubHost();
    // A button inside an anchor is invalid nested interactive content, and
    // clicking it would post `open-file` *and* follow the href.
    renderSurface("[`packages/mcp-server/src/index.ts:20`](https://example.com/doc)");

    expect(screen.queryByRole("button")).toBeNull();
    const link = screen.getByRole("link");
    expect(link.querySelector("button")).toBeNull();
    expect(within(link).getByText("packages/mcp-server/src/index.ts:20").tagName).toBe("CODE");

    await userEvent.click(link);
    expect(api.postMessage).not.toHaveBeenCalled();
  });

  it("is still a jump when the link's href was refused, since no anchor renders", () => {
    stubHost();
    // `safeHref` drops the anchor entirely (S-UI-4), so nothing encloses the
    // span and the citation is free to be a jump again.
    renderSurface("[`packages/mcp-server/src/index.ts:20`](javascript:alert(1))");
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("button", { name: "packages/mcp-server/src/index.ts:20" }),
    ).toBeDefined();
  });

  it("offers no jump over the browser transport, where nothing could open it", () => {
    // No `acquireVsCodeApi` — Mob mode. The citation is still shown as code.
    renderSurface(CITATIONS);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("packages/mcp-server/src/index.ts:20").tagName).toBe("CODE");
  });
});

describe("MarkdownSurface — the rest of the artifact dialect", () => {
  const MORE = [
    "> 引用文",
    "",
    "---",
    "",
    "- [x] 済んだ作業",
    "- [ ] まだの作業",
    "",
    "5. 五番目から",
    "",
    "~~取り消し~~ と ![図の説明](diagram.png)",
    "",
    "###### 見出し6",
  ].join("\n");

  it("renders quotes, rules, task items, list offsets, strike-through and image alt text", () => {
    renderSurface(MORE);
    const surface = screen.getByTestId("markdown-surface");

    expect(surface.querySelector("blockquote")?.textContent).toContain("引用文");
    expect(surface.querySelector("hr")).not.toBeNull();

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // A task item carries its checkbox instead of a bullet (app.css drops the marker).
    expect(boxes.every((box) => box.closest("li")?.classList.contains("viewer__task-item"))).toBe(
      true,
    );
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    // Read-only: the boxes report state, they do not accept it.
    expect(boxes.every((box) => box.readOnly)).toBe(true);

    expect(surface.querySelector("ol")?.getAttribute("start")).toBe("5");
    expect(surface.querySelector("del")?.textContent).toBe("取り消し");
    // An <img> would be a network fetch driven by document content.
    expect(surface.querySelector("img")).toBeNull();
    expect(surface.textContent).toContain("図の説明");
    // Depth is clamped so the artifact outline never runs past <h6>.
    expect(screen.getByRole("heading", { name: "見出し6" }).tagName).toBe("H6");
  });
});

describe("MarkdownSurface — tight lists keep inline markup (CommonMark text tokens)", () => {
  it("renders **bold** and relative links inside a tight list, not as source text", () => {
    renderSurface(
      [
        "- **初めて使う方**: [はじめに](01-getting-started.md)",
        "- **普段使っている方**: [CLI](12-cli-commands.md)",
      ].join("\n"),
    );

    expect(screen.getByText("初めて使う方").tagName).toBe("STRONG");
    expect(screen.getByText("普段使っている方").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "はじめに" }).getAttribute("href")).toBe(
      "01-getting-started.md",
    );
    expect(screen.getByRole("link", { name: "CLI" }).getAttribute("href")).toBe(
      "12-cli-commands.md",
    );

    const surface = screen.getByTestId("markdown-surface");
    expect(surface.textContent).not.toContain("**");
    expect(surface.textContent).not.toContain("[はじめに]");
    // Tight items are inline, not wrapped in <p> the way a loose list is.
    expect(screen.getByText("初めて使う方").closest("p")).toBeNull();
  });

  it("gives a loose task item one checkbox and no bracket source text", () => {
    renderSurface("- [x] first\n\n  more text\n\n- [ ] second");
    const surface = screen.getByTestId("markdown-surface");
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(surface.textContent).not.toContain("[x]");
    expect(surface.textContent).not.toContain("[ ]");
    expect(Array.from(surface.querySelectorAll("li > p"), (p) => p.textContent)).toEqual([
      "first",
      "more text",
      "second",
    ]);
  });

  it("still wraps a loose list item in a paragraph", () => {
    renderSurface("- **太字**\n\n- 次");
    expect(screen.getByText("太字").tagName).toBe("STRONG");
    expect(screen.getByText("太字").closest("p")).not.toBeNull();
  });

  it("hides a reference definition and still resolves the link", () => {
    renderSurface("[See][ref]\n\n[ref]: https://example.com/docs\n");
    expect(screen.getByRole("link", { name: "See" }).getAttribute("href")).toBe(
      "https://example.com/docs",
    );
    expect(screen.getByTestId("markdown-surface").textContent).not.toContain("[ref]:");
  });

  it("renders an escaped asterisk as * , not as source backslash", () => {
    renderSurface("not \\*bold\\*");
    const surface = screen.getByTestId("markdown-surface");
    expect(surface.textContent).toContain("not *bold*");
    expect(surface.textContent).not.toContain("\\*");
  });
});

describe("MarkdownSurface — GitHub alerts become labelled callouts", () => {
  it.each([
    ["NOTE", "note", "注記"],
    ["TIP", "tip", "ヒント"],
    ["IMPORTANT", "important", "重要"],
    ["WARNING", "warning", "警告"],
    ["CAUTION", "caution", "注意"],
  ])("renders > [!%s] as a %s callout titled %s", (marker, kind, title) => {
    renderSurface(`> [!${marker}]\n> 本文の **大事な** 説明`);

    const callout = screen.getByRole("note");
    expect(callout.getAttribute("data-callout")).toBe(kind);
    expect(within(callout).getByText(title)).toBeDefined();
    expect(within(callout).getByText("大事な").tagName).toBe("STRONG");
    // The marker is syntax, not prose: it never reaches the screen.
    expect(screen.getByTestId("markdown-surface").textContent).not.toContain(`[!${marker}]`);
    expect(screen.getByTestId("markdown-surface").querySelector("blockquote")).toBeNull();
  });

  it("accepts a lower-case marker and keeps later paragraphs inside the callout", () => {
    renderSurface("> [!tip]\n> 一段落目\n>\n> 二段落目");
    const callout = screen.getByRole("note");
    expect(callout.getAttribute("data-callout")).toBe("tip");
    expect(within(callout).getByText("一段落目")).toBeDefined();
    expect(within(callout).getByText("二段落目")).toBeDefined();
  });

  it("accepts a marker line ending in a two-space hard break", () => {
    renderSurface("> [!NOTE]  \n> 本文");
    const callout = screen.getByRole("note");
    expect(callout.getAttribute("data-callout")).toBe("note");
    expect(callout.textContent).toBe("注記本文");
    expect(callout.querySelector("br")).toBeNull();
  });

  it("renders a marker with no body as a title-only callout", () => {
    renderSurface("> [!WARNING]");
    const callout = screen.getByRole("note");
    expect(callout.textContent).toBe("警告");
  });

  it("leaves an unknown marker and a marker followed by text on its line as plain quotes", () => {
    renderSurface("> [!FOO]\n> 本文\n\n> [!NOTE] 同じ行の文");
    expect(screen.queryByRole("note")).toBeNull();
    const quotes = screen.getByTestId("markdown-surface").querySelectorAll("blockquote");
    expect(quotes).toHaveLength(2);
    expect(quotes[0]?.textContent).toContain("[!FOO]");
    expect(quotes[1]?.textContent).toContain("[!NOTE] 同じ行の文");
  });

  it("leaves an ordinary quote a quote", () => {
    renderSurface("> **注記:** ただの引用");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByTestId("markdown-surface").querySelector("blockquote")).not.toBeNull();
  });

  it("keeps citation evidence on the callout body", () => {
    render(
      <MarkdownSurface
        markdown={"前文\n\n> [!NOTE]\n> 根拠の文"}
        editable={null}
        evidence={{ startLine: 4, endLine: 4 }}
      />,
    );
    const marked = screen
      .getByTestId("markdown-surface")
      .querySelectorAll('[data-doc-evidence="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toBe("根拠の文");
    expect(marked[0]?.closest('[role="note"]')).not.toBeNull();
  });
});

describe("MarkdownSurface — local svg diagrams", () => {
  const DOC = "construction/u1/focus-test/focus-test-report.md";
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>図</text></svg>';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubArtifacts(
    files: Record<string, { ok: true; value: string }>,
  ): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string) => {
      const path = decodeURIComponent(new URL(url, "http://x").searchParams.get("path") ?? "");
      const body = files[path];
      return body === undefined
        ? new Response(JSON.stringify({ error: true, reason: "artifact-not-found" }), {
            status: 404,
          })
        : new Response(JSON.stringify(body));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock as unknown as ReturnType<typeof vi.fn>;
  }

  it("shows an svg beside the document as an image, read through the artifact api", async () => {
    const fetchMock = stubArtifacts({
      "construction/u1/focus-test/diagrams/map.svg": { ok: true, value: SVG },
    });
    render(
      <MarkdownSurface
        markdown={"# 報告\n\n![要件とテストの対応](diagrams/map.svg)\n"}
        editable={null}
        documentPath={DOC}
      />,
    );
    const image = await screen.findByRole("img", { name: "要件とテストの対応" });
    // A data url: the <img> fetches nothing, and an svg shown as an image runs no script.
    expect(image.getAttribute("src")).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`,
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/artifact?path=");
  });

  it("keeps the alt text while the drawing loads, and when it cannot be read", async () => {
    stubArtifacts({});
    render(
      <MarkdownSurface
        markdown={"![構成図](diagrams/missing.svg)"}
        editable={null}
        documentPath={DOC}
      />,
    );
    const surface = screen.getByTestId("markdown-surface");
    expect(surface.textContent).toContain("構成図");
    await waitFor(() => {
      expect(surface.querySelector("[data-image-state='unavailable']")).not.toBeNull();
    });
    expect(surface.querySelector("img")).toBeNull();
    expect(surface.textContent).toContain("構成図");
  });

  it("shows nothing it would have to fetch from outside the document's folder", () => {
    const fetchMock = stubArtifacts({});
    render(
      <MarkdownSurface
        markdown={[
          "![外部](https://example.com/a.svg)",
          "![外側](../other/a.svg)",
          "![写真](shot.png)",
        ].join("\n\n")}
        editable={null}
        documentPath={DOC}
      />,
    );
    const surface = screen.getByTestId("markdown-surface");
    expect(surface.querySelector("img")).toBeNull();
    expect(surface.textContent).toContain("外部");
    expect(surface.textContent).toContain("外側");
    expect(surface.textContent).toContain("写真");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows no image when the caller does not say where the document lives", () => {
    const fetchMock = stubArtifacts({});
    renderSurface("![図](diagrams/map.svg)");
    expect(screen.getByTestId("markdown-surface").querySelector("img")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not show a file that is not a drawing", async () => {
    stubArtifacts({
      "construction/u1/focus-test/diagrams/fake.svg": { ok: true, value: "<html>x</html>" },
    });
    render(
      <MarkdownSurface
        markdown={"![偽物](diagrams/fake.svg)"}
        editable={null}
        documentPath={DOC}
      />,
    );
    const surface = screen.getByTestId("markdown-surface");
    await waitFor(() => {
      expect(surface.querySelector("[data-image-state='unavailable']")).not.toBeNull();
    });
    expect(surface.querySelector("img")).toBeNull();
  });
});
