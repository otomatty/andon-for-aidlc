import { fireEvent, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "@/features/customization/components/editor/MarkdownEditor";
import { markdownExtensions } from "@/features/customization/components/editor/markdown-extensions";

describe("customization Markdown editor", () => {
  beforeEach(() => {
    // jsdom has no layout; ProseMirror needs these when moving the caret.
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });
  it("renders formatted Japanese and English without saving on mount or external updates", () => {
    const onChange = vi.fn();
    const view = render(<MarkdownEditor value={"## 日本語\n\n**作業方針**"} onChange={onChange} />);
    expect(screen.getByRole("heading", { name: "日本語" })).toBeTruthy();
    expect(screen.getByText("作業方針").tagName).toBe("STRONG");
    view.rerender(<MarkdownEditor value={"## English\n\n**Instructions**"} onChange={onChange} />);
    expect(screen.getByRole("heading", { name: "English" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "日本語" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables standard content including checklist changes", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value={"# 標準\n\n- [ ] 確認事項"} readOnly onChange={onChange} />);
    const content = screen.getByRole("textbox", { name: "本文・作業方針" });
    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(content.getAttribute("aria-readonly")).toBe("true");
    expect(screen.queryByRole("toolbar")).toBeNull();
    fireEvent.click(within(content).getByRole("checkbox"));
    content.focus();
    await userEvent.keyboard("変更");
    expect(content.textContent).not.toContain("変更");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("edits formatted content, emits Markdown and keeps edits when the parent echoes the value", async () => {
    const onChange = vi.fn();
    const view = render(<MarkdownEditor value="Start" onChange={onChange} />);
    const content = screen.getByRole("textbox", { name: "本文・作業方針" });
    content.focus();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await userEvent.keyboard(" updated");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.lastCall?.[0] as string;
    expect(saved).toContain("Start updated");
    view.rerender(<MarkdownEditor value={saved} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "本文・作業方針" })).toBe(content);
    expect(screen.queryByRole("toolbar")).toBeNull();
    await userEvent.keyboard("{Control>}{Alt>}2{/Alt}{/Control}");
    await waitFor(() => expect(onChange.mock.lastCall?.[0]).toContain("## Start updated"));
    expect(screen.getByRole("heading", { name: "Start updated", level: 2 })).toBeTruthy();
    view.rerender(
      <MarkdownEditor value={onChange.mock.lastCall?.[0]} readOnly onChange={onChange} />,
    );
    expect(content.getAttribute("contenteditable")).toBe("false");
  });

  it("preserves Markdown structures and literal HTML through an actual content edit", () => {
    const markdown = [
      "# Title",
      "",
      "**bold** and *italic* and ~~removed~~ and `inline`",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
      "",
      "> quote",
      "",
      "- [x] finished",
      "- [ ] pending",
      "",
      "[link](https://example.com)",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| a | b |",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "<!-- keep comment -->",
      "",
      "<script>alert(1)</script>",
      "",
      "![diagram](https://example.com/image.png)",
      "",
    ].join("\n");
    const element = document.createElement("div");
    const editor = new Editor({
      element,
      extensions: markdownExtensions,
      content: markdown,
      contentType: "markdown",
    });
    try {
      expect(element.querySelector("script")).toBeNull();
      expect(element.querySelector("img[src]")).toBeNull();
      editor.state.doc.check();
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "Added" }],
      });
      const saved = editor.getMarkdown();
      for (const part of [
        "# Title",
        "**bold**",
        "*italic*",
        "~~removed~~",
        "`inline`",
        "- one",
        "1. first",
        "> quote",
        "- [x] finished",
        "- [ ] pending",
        "[link](https://example.com)",
        "```ts",
        "const x = 1;",
        "<!-- keep comment -->",
        "<script>alert(1)</script>",
        "![diagram](https://example.com/image.png)",
        "Added",
      ])
        expect(saved).toContain(part);
      expect(saved).toMatch(/\| a\s+\| b\s+\|/);
    } finally {
      editor.destroy();
    }
  });
});
