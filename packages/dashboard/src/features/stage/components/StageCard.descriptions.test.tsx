import type { ArtifactDoc } from "@aidlc-guide/shared-types";
import { render, screen } from "@tests/render.tsx";
import { describe, expect, it } from "vitest";
import { StageCard } from "@/features/stage/components/StageCard.tsx";
import { StoreProvider } from "@/store/context.tsx";
import type { AppState } from "@/store/state.ts";
import { stageDoc } from "@tests/fixtures.ts";

const docs: Record<string, ArtifactDoc> = {
  "unit-of-work": {
    fileName: "unit-of-work.md",
    descriptions: { en: "Unit definitions and boundaries", ja: "ユニット定義と境界" },
  },
  "build-test-results": {
    fileName: "test-results.md",
    descriptions: { en: "Actual build/test execution results", ja: null },
  },
  traceability: { fileName: "traceability.json", descriptions: { en: null, ja: null } },
};

function renderCard(locale: AppState["officialDocsLocale"]): void {
  render(
    <StoreProvider preloaded={{ officialDocsLocale: locale }}>
      <StageCard
        doc={stageDoc({
          slug: "units-generation",
          inputs: ["unit-of-work"],
          outputs: ["build-test-results", "traceability"],
          artifactDocs: docs,
        })}
      />
    </StoreProvider>,
  );
}

describe("artifact descriptions on the stage card", () => {
  it("explains what each produced artifact contains, in the reader's locale", () => {
    renderCard("ja");
    expect(screen.getByTestId("artifact-description-unit-of-work").textContent).toBe(
      "ユニット定義と境界",
    );
  });

  it("switches with the docs locale", () => {
    renderCard("en");
    expect(screen.getByTestId("artifact-description-unit-of-work").textContent).toBe(
      "Unit definitions and boundaries",
    );
  });

  it("falls back to English where the ja snapshot documents no row", () => {
    renderCard("ja");
    expect(screen.getByTestId("artifact-description-build-test-results").textContent).toBe(
      "Actual build/test execution results",
    );
  });

  it("shows the artifact bare rather than inventing copy for an undocumented one", () => {
    renderCard("ja");
    expect(screen.queryByTestId("artifact-description-traceability")).toBeNull();
    expect(screen.getByText("traceability")).toBeTruthy();
  });

  it("explains the artifacts a stage reads, not only the ones it writes", () => {
    renderCard("ja");
    const input = screen.getByTestId("artifact-description-unit-of-work");
    expect(input.closest("div")?.textContent).toContain("入力");
  });
});
