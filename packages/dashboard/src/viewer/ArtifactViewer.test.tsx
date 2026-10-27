import { act, render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactViewer, artifactPath } from "@/viewer/index.tsx";

/**
 * US-13 / D1 + D3. The five display states plus the artifact switch, driven
 * through the real `GET /api/artifact` path with `fetch` stubbed.
 */

vi.mock("./MermaidBlock.tsx", () => ({
  MermaidBlock: ({ code }: { code: string }): ReactNode => (
    <div data-testid="mermaid-stub">{code}</div>
  ),
}));

const FILES = ["business-logic-model.md", "frontend-components.md"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stub(body: unknown, byPath?: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const path = decodeURIComponent(new URL(url, "http://x").searchParams.get("path") ?? "");
    return new Response(JSON.stringify(byPath?.[path] ?? body));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function view(files = FILES): void {
  render(
    <ArtifactViewer
      unit="artifact-viewer"
      stage="functional-design"
      files={files}
      verdict="READY"
    />,
  );
}

describe("artifactPath", () => {
  it("builds a record-relative POSIX path, independent of the host OS", () => {
    expect(artifactPath("reader-core", "nfr-design", "a.md")).toBe(
      "construction/reader-core/nfr-design/a.md",
    );
  });
});

describe("ArtifactViewer — the five display states (D3)", () => {
  it("empty: says so when the cell holds no artifacts", () => {
    stub({ ok: true, value: "# x" });
    view([]);
    expect(screen.getByTestId("viewer-empty").textContent).toBe("成果物がありません");
    expect(screen.queryByTestId("viewer-toolbar")).toBeNull();
  });

  it("loading: no skeleton before 200ms, skeleton after (shared useDelayedLoading)", async () => {
    vi.useFakeTimers();
    // A read that never answers, so the wait itself is what is under test.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => await new Promise<Response>(() => {})),
    );
    view();

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByLabelText("成果物を読み込み中")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByLabelText("成果物を読み込み中")).toBeDefined();
  });

  it("success: renders the artifact through MarkdownSurface", async () => {
    stub({ ok: true, value: "# 業務ロジック\n\n本文。" });
    view();
    await waitFor(() => {
      expect(screen.getByTestId("markdown-surface")).toBeDefined();
    });
    expect(screen.getByRole("heading", { name: "業務ロジック" })).toBeDefined();
  });

  it("error: shows the server's reason locally, inside the panel", async () => {
    stub({ error: true, reason: "file-too-large" });
    view();
    await waitFor(() => {
      expect(screen.getByText(/ファイルが大きすぎます/)).toBeDefined();
    });
    expect(screen.queryByTestId("markdown-surface")).toBeNull();
  });

  it("error: an unsupported State Version is stated, not guessed at", async () => {
    stub({ unsupported: true, version: "9" });
    view();
    await waitFor(() => {
      expect(screen.getByText(/State Version 9 は未対応です/)).toBeDefined();
    });
  });

  it("partial: renders the artifact and lists the degradation notes", async () => {
    stub({ ok: true, value: "# 部分的", warnings: ["末尾が切れています"] });
    view();
    await waitFor(() => {
      expect(screen.getByTestId("markdown-surface")).toBeDefined();
    });
    expect(screen.getByTestId("viewer-notes").textContent).toContain("末尾が切れています");
  });
});

describe("ArtifactViewer — diagrams beside the artifact", () => {
  it("shows an svg the artifact embeds from its own folder", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect/></svg>';
    stub(
      { error: true, reason: "artifact-not-found" },
      {
        "construction/artifact-viewer/functional-design/business-logic-model.md": {
          ok: true,
          value: "# モデル\n\n![構成](diagrams/model.svg)\n",
        },
        "construction/artifact-viewer/functional-design/diagrams/model.svg": {
          ok: true,
          value: svg,
        },
      },
    );
    view();
    const image = await screen.findByRole("img", { name: "構成" });
    expect(image.getAttribute("src")).toContain("data:image/svg+xml");
  });
});

describe("ArtifactViewer — ViewerToolbar", () => {
  it("opens the cell's first artifact and marks it current", async () => {
    const fetchMock = stub({ ok: true, value: "# one" });
    view();
    await waitFor(() => {
      expect(screen.getByTestId("markdown-surface")).toBeDefined();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      encodeURIComponent("construction/artifact-viewer/functional-design/business-logic-model.md"),
    );
    expect(
      screen.getByRole("tab", { name: "business-logic-model.md" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("switches to another artifact of the same cell", async () => {
    stub(
      { error: true, reason: "artifact-not-found" },
      {
        "construction/artifact-viewer/functional-design/business-logic-model.md": {
          ok: true,
          value: "# 一つ目",
        },
        "construction/artifact-viewer/functional-design/frontend-components.md": {
          ok: true,
          value: "# 二つ目",
        },
      },
    );
    view();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "一つ目" })).toBeDefined();
    });

    await userEvent.click(screen.getByRole("tab", { name: "frontend-components.md" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "二つ目" })).toBeDefined();
    });
  });

  it("shows the cell verdict and closes the artifact without closing the panel", async () => {
    stub({ ok: true, value: "# one" });
    view();
    await waitFor(() => {
      expect(screen.getByTestId("markdown-surface")).toBeDefined();
    });
    expect(screen.getByTestId("viewer-verdict").textContent).toBe("READY");

    await userEvent.click(screen.getByTestId("viewer-close"));
    expect(screen.queryByTestId("markdown-surface")).toBeNull();
    // The viewer itself, and the artifact list, are still there.
    expect(screen.getByTestId("viewer-toolbar")).toBeDefined();
    expect(screen.getByTestId("viewer-closed")).toBeDefined();
  });

  it("offers an edit action that opens the record file without Beside", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    stub({ ok: true, value: "# one" });
    view();
    await waitFor(() => {
      expect(screen.getByTestId("markdown-surface")).toBeDefined();
    });

    await userEvent.click(screen.getByTestId("viewer-edit"));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "open-file",
      path: "construction/artifact-viewer/functional-design/business-logic-model.md",
      line: null,
      base: "record",
      preview: false,
    });
  });
});

describe("ArtifactViewer — the editing gate (S-AV-2)", () => {
  const QUESTIONS = ["# 質問", "", "## Q1", "", "[Answer]: 未回答"].join("\n");

  it("offers the answer field for a *-questions.md artifact", async () => {
    stub({ ok: true, value: QUESTIONS });
    render(
      <ArtifactViewer
        unit="artifact-viewer"
        stage="functional-design"
        files={["functional-design-questions.md"]}
        verdict={null}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("answer-editor")).toBeDefined();
    });
  });

  it("offers no answer field for a normal artifact", async () => {
    stub({ ok: true, value: "[Answer]: これは質問ファイルではない" });
    view(["business-logic-model.md"]);
    await waitFor(() => {
      expect(screen.getByTestId("markdown-surface")).toBeDefined();
    });
    expect(screen.queryByTestId("answer-editor")).toBeNull();
  });
});
