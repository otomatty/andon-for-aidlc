import { render, screen } from "@tests/render.tsx";
import { describe, expect, it } from "vitest";
import { StageCard } from "@/features/stage/components/StageCard.tsx";
import { StoreProvider } from "@/store/context.tsx";
import { stageDoc } from "@tests/fixtures.ts";

describe("StageCard (US-03 / FR-4.4)", () => {
  it("renders all four mandatory fields plus the bundled-docs button", () => {
    render(
      <StoreProvider>
        <StageCard doc={stageDoc()} />
      </StoreProvider>,
    );
    expect(screen.getByText("目的")).toBeDefined();
    expect(screen.getByText("入力")).toBeDefined();
    expect(screen.getByText("出力")).toBeDefined();
    expect(screen.getByText("担当エージェント")).toBeDefined();
    expect(screen.getByText("ゲート要求")).toBeDefined();

    expect(screen.getByRole("button", { name: "Open in Docs" })).toBeDefined();
  });

  it("never turns the deep link into an href, whatever it names (S-UI-4)", () => {
    const doc = stageDoc({ deepLink: { docPath: "javascript:alert(1)", docAnchor: "x" } });
    render(
      <StoreProvider>
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
