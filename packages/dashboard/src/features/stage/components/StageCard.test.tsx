import { render, screen } from "@tests/render.tsx";
import { describe, expect, it } from "vitest";
import { StageCard } from "@/features/stage/components/StageCard.tsx";
import { StoreProvider } from "@/store/context.tsx";
import { stageDoc } from "@tests/fixtures.ts";

describe("StageCard (US-03 / FR-4.4)", () => {
  it("renders all four mandatory fields plus a per-stage docs URL", () => {
    render(
      <StoreProvider
        preloaded={{
          stageDocs: {
            "code-generation":
              "https://confluence.example.com/wiki/spaces/AIDLC/pages/123/Code+Generation",
          },
        }}
      >
        <StageCard doc={stageDoc()} />
      </StoreProvider>,
    );
    expect(screen.getByText("目的")).toBeDefined();
    expect(screen.getByText("入力")).toBeDefined();
    expect(screen.getByText("出力")).toBeDefined();
    expect(screen.getByText("担当エージェント")).toBeDefined();
    expect(screen.getByText("ゲート要求")).toBeDefined();

    const link = screen.getByRole("link", { name: "docs を開く" });
    expect(link.getAttribute("href")).toBe(
      "https://confluence.example.com/wiki/spaces/AIDLC/pages/123/Code+Generation",
    );
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("drops a deep link whose target is not a plain path or http(s) URL (S-UI-4)", () => {
    const doc = stageDoc({ deepLink: { docPath: "javascript:alert(1)", docAnchor: "x" } });
    render(
      <StoreProvider preloaded={{ docsBaseUrl: "https://example.com/" }}>
        <StageCard doc={doc} />
      </StoreProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does not mount docs excerpt even when API returns excerpt (FR-B4-1)", () => {
    const doc = stageDoc({ excerpt: "### Excerpt\n\nbody line\n" });
    render(
      <StoreProvider>
        <StageCard doc={doc} />
      </StoreProvider>,
    );
    expect(screen.queryByTestId("docs-excerpt")).toBeNull();
    expect(screen.queryByRole("button", { name: "docs の該当箇所" })).toBeNull();
    expect(screen.queryByText(/body line/)).toBeNull();
  });
});
