import { render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailPanel } from "@/features/stage/StagePage.tsx";
import { StageCard } from "@/features/stage/components/StageCard.tsx";
import { StoreProvider } from "@/store/context.tsx";
import type { AppState } from "@/store/state.ts";
import { matrix, stageDoc, workflow } from "@tests/fixtures.ts";

vi.mock("@/viewer/MermaidBlock.tsx", () => ({
  MermaidBlock: ({ code }: { code: string }): ReactNode => (
    <div data-testid="mermaid-stub">{code}</div>
  ),
}));

const noop = (): void => {};

function ioResponse(unit: string | null): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      value: {
        stage: "functional-design",
        unit,
        inputs: { "requirements-analysis": null },
        outputs: {
          "business-rules":
            unit === "ops-guides"
              ? "construction/ops-guides/functional-design/business-rules.md"
              : "construction/reader-core/functional-design/business-rules.md",
        },
      },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stage I/O artifact links", () => {
  it("previews the displayed unit path in the dashboard without opening VS Code", async () => {
    const postMessage = vi.fn();
    let resolveOpsGuides: (() => void) | undefined;
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), "http://dashboard.test");
      if (url.pathname === "/api/io-paths") {
        const unit = url.searchParams.get("unit");
        if (unit === "ops-guides") {
          return await new Promise<Response>((resolve) => {
            resolveOpsGuides = () => {
              resolve(ioResponse(unit));
            };
          });
        }
        return ioResponse(unit);
      }
      return new Response(JSON.stringify({ ok: true, value: "# Artifact\n\nBody." }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const preloaded: Partial<AppState> = {
      route: { name: "stage", slug: "functional-design" },
      workflow: { kind: "success", value: workflow({ currentStage: "functional-design" }) },
      matrix: {
        kind: "success",
        value: matrix({
          cells: [
            {
              unit: "reader-core",
              stage: "functional-design",
              files: ["business-rules.md"],
              verdict: "READY",
            },
            {
              unit: "ops-guides",
              stage: "functional-design",
              files: ["business-rules.md"],
              verdict: "READY",
            },
          ],
        }),
      },
      stageDoc: {
        "functional-design": {
          kind: "success",
          value: stageDoc({
            slug: "functional-design",
            inputs: ["requirements-analysis"],
            outputs: ["business-rules"],
          }),
        },
      },
    };

    render(
      <StoreProvider preloaded={preloaded}>
        <DetailPanel />
      </StoreProvider>,
    );

    const open = await screen.findByTestId("io-open-business-rules");
    expect(screen.queryByTestId("io-open-requirements-analysis")).toBeNull();
    expect(open.className).toContain("underline");
    const plain = screen.getByText("requirements-analysis");
    expect(plain.tagName).toBe("SPAN");
    expect(plain.className).toContain("text-muted-foreground");

    await userEvent.click(open);
    expect(postMessage).not.toHaveBeenCalled();
    const preview = await screen.findByTestId("io-artifact-preview");
    expect(preview).toBeDefined();
    expect(screen.getByTestId("io-preview-path").textContent).toBe("business-rules.md");
    await waitFor(() => {
      expect(preview.querySelector('[data-testid="markdown-surface"]')).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        encodeURIComponent("construction/reader-core/functional-design/business-rules.md"),
      ),
      expect.anything(),
    );

    await userEvent.click(screen.getByTestId("io-preview-edit"));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "open-file",
      path: "construction/reader-core/functional-design/business-rules.md",
      line: null,
      base: "record",
      preview: false,
    });

    postMessage.mockClear();
    await userEvent.click(screen.getByRole("tab", { name: "ops-guides" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("unit=ops-guides"),
        expect.anything(),
      );
    });

    // The reader-core payload is still held by useFetchView while the new
    // request is pending, but it must not remain clickable for ops-guides.
    expect(screen.queryByTestId("io-open-business-rules")).toBeNull();
    expect(resolveOpsGuides).toBeTypeOf("function");
    resolveOpsGuides?.();

    await userEvent.click(await screen.findByTestId("io-open-business-rules"));
    expect(postMessage).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          encodeURIComponent("construction/ops-guides/functional-design/business-rules.md"),
        ),
        expect.anything(),
      );
    });
    await userEvent.click(screen.getByTestId("io-preview-edit"));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "open-file",
      path: "construction/ops-guides/functional-design/business-rules.md",
      line: null,
      base: "record",
      preview: false,
    });
  });

  it("keeps resolved I/O paths as text outside a VS Code webview", () => {
    render(
      <StoreProvider>
        <StageCard
          doc={stageDoc({ outputs: ["code-summary"] })}
          ioPaths={{
            stage: "code-generation",
            unit: "reader-core",
            inputs: {},
            outputs: { "code-summary": "construction/reader-core/code-generation/code-summary.md" },
          }}
          onPreviewIo={noop}
        />
      </StoreProvider>,
    );

    expect(screen.queryByTestId("io-open-code-summary")).toBeNull();
    const plain = screen.getByText("code-summary");
    expect(plain.tagName).toBe("SPAN");
    expect(plain.className).toContain("text-muted-foreground");
  });
});
