import { render, screen } from "@tests/render.tsx";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MarkdownEvidence } from "@/viewer/evidence.ts";
import { MarkdownSurface } from "@/viewer/MarkdownSurface.tsx";

vi.mock("./MermaidBlock.tsx", () => ({
  MermaidBlock: ({ code }: { code: string }): ReactNode => <div>{code}</div>,
}));

function highlighted(): HTMLElement[] {
  return Array.from(
    screen
      .getByTestId("markdown-surface")
      .querySelectorAll<HTMLElement>('[data-doc-evidence="true"]'),
  );
}

function firstHighlight(): HTMLElement {
  const element = highlighted()[0];
  if (element === undefined) throw new Error("Expected a highlighted source block");
  return element;
}

function show(markdown: string, startLine: number, endLine = startLine): void {
  render(<MarkdownSurface markdown={markdown} editable={null} evidence={{ startLine, endLine }} />);
}

describe("MarkdownSurface citation evidence", () => {
  it("selects the cited paragraph among duplicate headings and text", () => {
    show("# 同じ見出し\n\n同じ文章。\n\n# 同じ見出し\n\n同じ文章。\n", 7);
    const paragraphs = screen.getAllByText("同じ文章。");
    expect(highlighted()).toEqual([paragraphs[1]]);
    expect(paragraphs[0]?.hasAttribute("data-doc-evidence")).toBe(false);
    expect(paragraphs[1]?.getAttribute("aria-description")).toBe("回答の参照箇所");
    expect(paragraphs[1]?.tabIndex).toBe(-1);
  });

  it("marks a heading by its physical line without including trailing blank lines", () => {
    const { rerender } = render(
      <MarkdownSurface
        markdown={"# 同じ\n\n# 同じ\n\n本文"}
        editable={null}
        evidence={{ startLine: 3, endLine: 3 }}
      />,
    );
    expect(highlighted()).toEqual([screen.getAllByRole("heading")[1]]);
    rerender(
      <MarkdownSurface
        markdown={"# 同じ\n\n# 同じ\n\n本文"}
        editable={null}
        evidence={{ startLine: 4, endLine: 4 }}
      />,
    );
    expect(highlighted()).toEqual([]);
  });

  it("normalizes CRLF and keeps multiline paragraphs intact", () => {
    show("# Title\r\n\r\nfirst line\r\nsecond line\r\n\r\nlast", 4);
    expect(highlighted()).toHaveLength(1);
    expect(firstHighlight().tagName).toBe("P");
    expect(firstHighlight().textContent).toBe("first line\nsecond line");
  });

  it("selects the exact nested list item without marking ancestors or siblings", () => {
    show("- parent\n  - repeated\n  - repeated\n    - repeated\n- other", 4);
    expect(highlighted()).toHaveLength(1);
    const item = firstHighlight();
    expect(item.tagName).toBe("LI");
    expect(item.textContent).toBe("repeated");
    expect(item.querySelector("ul")).toBeNull();
    expect(item.parentElement?.closest("li")?.hasAttribute("data-doc-evidence")).toBe(false);
  });

  it("does not highlight a nested list when citing only its parent's text", () => {
    show("- parent\n  - child\n  - other", 1);
    expect(highlighted().map((node) => node.textContent)).toEqual(["parent"]);
    expect(firstHighlight().contains(screen.getByText("child"))).toBe(false);
  });

  it("keeps loose list paragraph positions after blank lines", () => {
    show("1. first\n\n   repeated\n\n2. second\n\n   repeated\n", 7);
    expect(highlighted()).toEqual([screen.getAllByText("repeated")[1]]);
    expect(firstHighlight().tagName).toBe("P");
  });

  it("supports checked task items", () => {
    show("- [x] done\n- [ ] pending", 2);
    expect(highlighted().map((node) => node.textContent)).toEqual(["pending"]);
    expect(firstHighlight().tagName).toBe("LI");
  });

  it("follows a task item's own lines into its nested list", () => {
    show("- [x] parent\n  - child\n- [ ] next", 2);
    expect(highlighted().map((node) => node.textContent)).toEqual(["child"]);
  });

  it("supports loose task items", () => {
    show("- [x] first\n\n  more text\n\n- [ ] second", 5);
    expect(highlighted().map((node) => node.textContent)).toEqual(["second"]);
  });

  it("marks only the cited table row even when two rows have identical cells", () => {
    show("| A | B |\n| -- | -- |\n| x | y |\n| x | y |\n", 4);
    expect(highlighted()).toEqual([screen.getAllByRole("row")[2]]);
    expect(firstHighlight().tagName).toBe("TR");
  });

  it("does not invent a visible table row for the Markdown delimiter", () => {
    show("| A | B |\n| -- | -- |\n| x | y |", 2);
    expect(highlighted()).toEqual([]);
  });

  it("marks multiple table rows if the citation spans them", () => {
    show("| A | B |\n| -- | -- |\n| x | y |\n| z | w |", 3, 4);
    expect(highlighted()).toEqual(screen.getAllByRole("row").slice(1));
  });

  it("marks the containing code block without matching repeated code elsewhere", () => {
    show("```ts\nconst a = 1;\n```\n\n```ts\nconst a = 1;\n```", 6);
    expect(highlighted()).toEqual([screen.getAllByTestId("code-block")[1]]);
  });

  it("preserves positions through link definitions and HTML comments", () => {
    show("[ref]: /docs\n\n<!-- hidden -->\n\n[本文][ref]\n", 5);
    expect(highlighted().map((node) => node.textContent)).toEqual(["本文"]);
  });

  it("does not mark hidden comments as evidence", () => {
    show("<!-- hidden -->\n\n本文", 1);
    expect(highlighted()).toEqual([]);
  });

  it("preserves source positions inside nested block quotes", () => {
    show("> first\n>\n> > repeated\n> >\n> > repeated\n\nafter", 5);
    expect(highlighted()).toEqual([screen.getAllByText("repeated")[1]]);
  });

  it.each<MarkdownEvidence>([
    { startLine: 0, endLine: 1 },
    { startLine: 2, endLine: 1 },
    { startLine: 1, endLine: 99 },
    { startLine: 1.5, endLine: 2 },
    { startLine: Number.NaN, endLine: 2 },
  ])("rejects invalid evidence ranges: %j", (evidence) => {
    render(<MarkdownSurface markdown={"first\n\nsecond"} editable={null} evidence={evidence} />);
    expect(highlighted()).toEqual([]);
  });

  it("updates the evidence range without retaining the previous highlight", () => {
    const markdown = "first\n\nsecond";
    const { rerender } = render(
      <MarkdownSurface
        markdown={markdown}
        editable={null}
        evidence={{ startLine: 1, endLine: 1 }}
      />,
    );
    expect(highlighted().map((node) => node.textContent)).toEqual(["first"]);
    rerender(
      <MarkdownSurface
        markdown={markdown}
        editable={null}
        evidence={{ startLine: 3, endLine: 3, label: "参照 2" }}
      />,
    );
    expect(highlighted().map((node) => node.textContent)).toEqual(["second"]);
    expect(firstHighlight().getAttribute("aria-description")).toBe("参照 2");
    rerender(<MarkdownSurface markdown={markdown} editable={null} />);
    expect(highlighted()).toEqual([]);
  });
});
