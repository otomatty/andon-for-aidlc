import { render, screen } from "@tests/render.tsx";
import { describe, expect, it, vi } from "vitest";
import { MarkdownSurface } from "@/viewer/MarkdownSurface.tsx";

/**
 * D3 error(b): an artifact the renderer cannot survive must degrade to plain
 * text, not take the panel down with it. The fault is injected at a *contract*
 * point (the mermaid delegation) rather than inside the renderer, so this test
 * keeps working after a renderer swap.
 *
 * Its own file because the mock has to throw for the whole module, and the
 * other surface tests need a mermaid stub that does not.
 */
vi.mock("./MermaidBlock.tsx", () => ({
  MermaidBlock: (): never => {
    throw new Error("renderer blew up on this artifact");
  },
}));

const SOURCE = ["# 資料", "", "```mermaid", "graph TD", "  A --> B", "```", "", "本文。"].join(
  "\n",
);

describe("MarkdownSurface run-time fallback", () => {
  it("switches to plain preview and says so, without propagating the throw", () => {
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<MarkdownSurface markdown={SOURCE} editable={null} />);

    expect(screen.getByTestId("plain-preview")).toBeDefined();
    expect(screen.getByText("リッチ表示できないため素のテキストで表示しています")).toBeDefined();
    // The raw source is still readable — degradation, not data loss.
    expect(screen.getByTestId("plain-preview").textContent).toContain("graph TD");
    expect(screen.queryByRole("heading", { name: "資料" })).toBeNull();

    noise.mockRestore();
  });
});
