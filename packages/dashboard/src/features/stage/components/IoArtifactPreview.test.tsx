import { render, screen } from "@tests/render.tsx";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IoArtifactPreview } from "@/features/stage/components/IoArtifactPreview.tsx";

vi.mock("@/viewer/MermaidBlock.tsx", () => ({
  MermaidBlock: ({ code }: { code: string }): ReactNode => (
    <div data-testid="mermaid-stub">{code}</div>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IoArtifactPreview", () => {
  it("shows the diagrams a stage output embeds from its own folder", async () => {
    const files: Record<string, string> = {
      "inception/requirements-analysis/requirements.md":
        "# 要件\n\n![利用者と要件](diagrams/actors.svg)\n",
      "inception/requirements-analysis/diagrams/actors.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle r="4"/></svg>',
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input), "http://x").searchParams.get("path") ?? "";
        const value = files[path];
        return value === undefined
          ? new Response(JSON.stringify({ error: true, reason: "artifact-not-found" }), {
              status: 404,
            })
          : new Response(JSON.stringify({ ok: true, value }));
      }),
    );
    render(
      <IoArtifactPreview
        path="inception/requirements-analysis/requirements.md"
        onClose={() => {}}
      />,
    );
    const image = await screen.findByRole("img", { name: "利用者と要件" });
    expect(image.getAttribute("src")).toContain("data:image/svg+xml");
  });
});
