import { render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailPanel } from "@/features/stage/StagePage.tsx";
import { fetchLinks, fetchMatrix, fetchStageDoc, fetchWorkflow } from "@/services/api.ts";
import {
  deepLinkHref,
  docsOpenHref,
  isExternal,
  safeHref,
  slugOf,
  useStageDoc,
} from "@/services/docs.ts";
import { StoreProvider, useDispatch } from "@/store/context.tsx";
import { matrix, payload, stageDoc, workflow } from "./fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubJson(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe("api client", () => {
  it("lifts the bare /api/workflow body into a ReadResult", async () => {
    stubJson(payload());
    const result = await fetchWorkflow();
    expect("ok" in result && result.value.workflow.project).toBe("aidlc-guide");
  });

  it("keeps state-file warnings attached to the workflow result", async () => {
    stubJson({ ...payload(), warnings: ["Total Stages 欄が欠落"] });
    const result = await fetchWorkflow();
    expect("ok" in result && result.warnings).toEqual(["Total Stages 欄が欠落"]);
  });

  it("passes an error body through untouched", async () => {
    stubJson({ error: true, reason: "no-active-intent" });
    expect(await fetchWorkflow()).toEqual({ error: true, reason: "no-active-intent" });
  });

  it("reports a dead server as unreachable rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await fetchWorkflow()).toEqual({ error: true, reason: "server-unreachable" });
    expect(await fetchMatrix()).toEqual({ error: true, reason: "server-unreachable" });
    expect(await fetchStageDoc("x")).toEqual({ error: true, reason: "server-unreachable" });
    expect(await fetchLinks()).toEqual({ error: true, reason: "server-unreachable" });
  });

  it("recognises the still-building matrix response", async () => {
    stubJson({ building: true });
    expect(await fetchMatrix()).toEqual({ building: true });
  });

  it("returns the matrix once it is built", async () => {
    stubJson({ ok: true, value: matrix() });
    const result = await fetchMatrix();
    expect("ok" in result && result.value.units).toEqual(["reader-core", "mcp-server"]);
  });

  it("flags a body that is neither a ReadResult nor a known shape", async () => {
    stubJson({ surprise: 1 });
    expect(await fetchLinks()).toEqual({ error: true, reason: "unexpected-response" });
  });

  it("encodes the slug into the stage route", async () => {
    const fetchMock = stubJson({ ok: true, value: stageDoc() });
    await fetchStageDoc("code generation/x");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/stage/code%20generation%2Fx");
  });
});

describe("deep links (S-UI-4)", () => {
  it("keeps relative doc paths and http(s) URLs", () => {
    expect(safeHref("docs/guide/01.md")).toBe("docs/guide/01.md");
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(isExternal("https://example.com/a")).toBe(true);
    expect(isExternal("docs/guide/01.md")).toBe(false);
  });

  it("refuses any other scheme, protocol-relative URLs and blanks", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("//evil.example.com")).toBeNull();
    expect(safeHref("   ")).toBeNull();
  });

  it("joins docPath and docAnchor, and tolerates an empty anchor", () => {
    expect(deepLinkHref({ docPath: "docs/a.md", docAnchor: "b" })).toBe("docs/a.md#b");
    expect(deepLinkHref({ docPath: "docs/a.md", docAnchor: "#b" })).toBe("docs/a.md#b");
    expect(deepLinkHref({ docPath: "docs/a.md", docAnchor: "" })).toBe("docs/a.md");
    expect(deepLinkHref(null)).toBeNull();
  });

  it("resolves docPath against docsBaseUrl from config", () => {
    expect(
      deepLinkHref(
        { docPath: ".claude/aidlc-common/stages/x.md", docAnchor: "#x" },
        "https://github.com/org/repo/blob/main/",
      ),
    ).toBe("https://github.com/org/repo/blob/main/.claude/aidlc-common/stages/x.md#x");
  });

  it("prefers stageDocs override (Confluence etc.) over docsBaseUrl", () => {
    const confluence = "https://confluence.example.com/wiki/spaces/AIDLC/pages/99/Intent+Capture";
    expect(
      docsOpenHref(
        "intent-capture",
        { docPath: ".claude/aidlc-common/stages/ideation/intent-capture.md", docAnchor: "#x" },
        {
          docsBaseUrl: "https://github.com/org/repo/blob/main/",
          stageDocs: { "intent-capture": confluence },
        },
      ),
    ).toBe(confluence);
  });

  it("maps a matrix cell selection onto its stage column", () => {
    expect(slugOf({ kind: "stage", slug: "a" })).toBe("a");
    expect(slugOf({ kind: "cell", unit: "u", stage: "s" })).toBe("s");
    expect(slugOf(null)).toBeNull();
  });
});

/** BLM step 6: fetch on selection, once per slug per session. */
function DocHarness(): ReactNode {
  const dispatch = useDispatch();
  useStageDoc();
  return (
    <>
      <button
        type="button"
        data-testid="pick-a"
        onClick={() => {
          dispatch({ type: "select", selection: { kind: "stage", slug: "code-generation" } });
        }}
      >
        a
      </button>
      <button
        type="button"
        data-testid="pick-b"
        onClick={() => {
          dispatch({ type: "select", selection: { kind: "stage", slug: "build-and-test" } });
        }}
      >
        b
      </button>
      <DetailPanel />
    </>
  );
}

describe("useStageDoc memoisation", () => {
  it("fetches a slug once and re-uses the stored doc afterwards", async () => {
    const fetchMock = stubJson({ ok: true, value: stageDoc() });
    render(
      <StoreProvider preloaded={{ workflow: { kind: "success", value: workflow() } }}>
        <DocHarness />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("pick-a"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByTestId("pick-b"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Back to the first slug: served from the stageDoc slice, no third request.
    await userEvent.click(screen.getByTestId("pick-a"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-card-code-generation")).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
