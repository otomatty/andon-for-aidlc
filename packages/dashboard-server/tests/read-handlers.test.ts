import { handleRead, mapResult } from "@aidlc-guide/api-core";
import { nextStepOf } from "@aidlc-guide/reader-core";
import type { Matrix, WorkflowModel } from "@aidlc-guide/shared-types";
import { describe, expect, it } from "vitest";
import { context, ok, stageDoc, stubBridge, stubReader, url } from "./support.ts";

const WORKFLOW: WorkflowModel = {
  project: "p",
  scope: "feature",
  depth: "Standard",
  stateVersion: 8,
  phase: "CONSTRUCTION",
  currentStage: "functional-design",
  nextStage: "code-generation",
  gate: "awaiting-approval",
  stages: [],
  done: 1,
  total: 3,
};

const MATRIX: Matrix = { units: ["u"], stages: ["code-generation"], cells: [] };

describe("mapResult — the single ReadResult→HTTP mapping (R-DS-1)", () => {
  it("passes an ok result through as 200", async () => {
    const response = mapResult(ok({ a: 1 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, value: { a: 1 } });
  });

  it("preserves warnings so degradation survives the boundary", async () => {
    const response = mapResult({ ok: true, value: 1, warnings: ["partial"] });
    await expect(response.json()).resolves.toMatchObject({ warnings: ["partial"] });
  });

  it("returns 200 — never 500 — for an unsupported State Version (BR-DS-4)", async () => {
    const response = mapResult({ unsupported: true, version: "99" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unsupported: true, version: "99" });
  });

  it.each(["state-missing", "state-unreadable", "no-active-intent", "internal: boom"])(
    "returns 200 — never 500 — for the %s error (BR-DS-4)",
    async (reason) => {
      const response = mapResult({ error: true, reason });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ error: true, reason });
    },
  );

  it("escalates outside-record to 403 and artifact-not-found to 404", () => {
    expect(mapResult({ error: true, reason: "outside-record" }).status).toBe(403);
    expect(mapResult({ error: true, reason: "artifact-not-found" }).status).toBe(404);
  });
});

describe("GET /api/workflow — stage 1 of first paint", () => {
  const ctx = context({
    reader: stubReader({
      getWorkflow: async () => ok(WORKFLOW),
      getMatrix: async () => ok(MATRIX),
    }),
  });

  it("returns workflow and nextStep, and no matrix or serverMode key", async () => {
    const response = await handleRead(ctx, url("/api/workflow"));
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as Record<string, unknown>;
    expect(body.workflow).toMatchObject({ currentStage: "functional-design" });
    // nextStep derives from the same state read (nextStepOf) — one parse per request.
    expect(body.nextStep).toEqual(nextStepOf(WORKFLOW));
    expect(body).not.toHaveProperty("serverMode");
    // ADR-03: the full scan must not be on the first-paint path.
    expect(body).not.toHaveProperty("matrix");
  });

  it("surfaces an unsupported workspace as 200 rather than a dead endpoint", async () => {
    const degraded = context({
      reader: stubReader({
        getWorkflow: async () => ({ unsupported: true, version: "6" }),
      }),
    });
    const response = await handleRead(degraded, url("/api/workflow"));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      unsupported: true,
      version: "6",
    });
  });
});

describe("GET /api/matrix — stage 2", () => {
  it("reports building until the background scan lands", async () => {
    const response = await handleRead(context(), url("/api/matrix"));
    await expect(response?.json()).resolves.toEqual({ building: true });
  });

  it("serves the cache once built", async () => {
    const ctx = context({ matrix: () => ok(MATRIX) });
    const response = await handleRead(ctx, url("/api/matrix"));
    await expect(response?.json()).resolves.toEqual({ ok: true, value: MATRIX });
  });

  it("does not turn a failed background scan into a 500", async () => {
    const ctx = context({ matrix: () => ({ error: true, reason: "state-missing" }) });
    const response = await handleRead(ctx, url("/api/matrix"));
    expect(response?.status).toBe(200);
  });
});

describe("GET /api/artifact — double-checked path (S-DS-4)", () => {
  const ctx = (relPath: string): ReturnType<typeof context> =>
    context({
      recordDir: async () => ok(process.cwd()),
      reader: stubReader({ readArtifact: async () => ok(`body of ${relPath}`) }),
    });

  it("returns the artifact body", async () => {
    const response = await handleRead(ctx("docs/a.md"), url("/api/artifact?path=docs/a.md"));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects traversal at the server-side gate with 403, before the reader", async () => {
    let readerCalled = false;
    const guarded = context({
      recordDir: async () => ok(process.cwd()),
      reader: stubReader({
        readArtifact: async () => {
          readerCalled = true;
          return ok("leaked");
        },
      }),
    });
    const response = await handleRead(guarded, url("/api/artifact?path=../../../etc/passwd"));
    expect(response?.status).toBe(403);
    expect(readerCalled).toBe(false);
  });

  it("rejects a missing path parameter with 400", async () => {
    const response = await handleRead(context(), url("/api/artifact"));
    expect(response?.status).toBe(400);
  });

  it("returns 404 when the reader cannot find the artifact", async () => {
    const missing = context({
      recordDir: async () => ok(process.cwd()),
      reader: stubReader({
        readArtifact: async () => ({ error: true, reason: "artifact-not-found" }),
      }),
    });
    const response = await handleRead(missing, url("/api/artifact?path=nope.md"));
    expect(response?.status).toBe(404);
  });

  it("passes no-active-intent through as 200 with the payload", async () => {
    const noIntent = context({
      recordDir: async () => ({ error: true, reason: "no-active-intent" }),
    });
    const response = await handleRead(noIntent, url("/api/artifact?path=a.md"));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      error: true,
      reason: "no-active-intent",
    });
  });
});

describe("GET /api/intents — US-15 一覧導線", () => {
  it("returns the IntentList payload shape through the shared mapping", async () => {
    const ctx = context({
      reader: stubReader({
        getIntents: async () =>
          ok({
            space: "default",
            active: "b-intent",
            all: ["a-intent", "b-intent"],
            selected: null,
          }),
      }),
    });
    const response = await handleRead(ctx, url("/api/intents"));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      ok: true,
      value: {
        space: "default",
        active: "b-intent",
        all: ["a-intent", "b-intent"],
        selected: null,
      },
    });
  });

  it("returns 200 — never 500 — for an unsupported workspace", async () => {
    const ctx = context({
      reader: stubReader({ getIntents: async () => ({ unsupported: true, version: "6" }) }),
    });
    const response = await handleRead(ctx, url("/api/intents"));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ unsupported: true, version: "6" });
  });

  it("returns 200 — never 500 — for an error reason", async () => {
    const ctx = context({
      reader: stubReader({ getIntents: async () => ({ error: true, reason: "state-unreadable" }) }),
    });
    const response = await handleRead(ctx, url("/api/intents"));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ error: true, reason: "state-unreadable" });
  });
});

describe("docs-bridge routes", () => {
  it("GET /api/stage/:slug resolves the stage doc, decoding the slug", async () => {
    const ctx = context({
      bridge: stubBridge({ resolveStage: async (slug) => ok(stageDoc(slug)) }),
    });
    const response = await handleRead(ctx, url("/api/stage/code%20generation"));
    const body = (await response?.json()) as { value: { slug: string } };
    expect(body.value.slug).toBe("code generation");
  });

  it("no longer serves GET /api/glossary/:term (MCP resolves terms directly)", async () => {
    const response = await handleRead(context(), url("/api/glossary/Bolt"));
    expect(response?.status).toBe(404);
  });

  it("GET /api/links returns the project links", async () => {
    const ctx = context({
      bridge: stubBridge({
        projectLinks: async () => ok([{ label: "PRD", target: "docs/PRD.md" }]),
      }),
    });
    const response = await handleRead(ctx, url("/api/links"));
    await expect(response?.json()).resolves.toMatchObject({ ok: true });
  });

  it("does not turn a missing docs checkout into a 500", async () => {
    const ctx = context({
      bridge: stubBridge({ resolveStage: async () => ({ error: true, reason: "docs-missing" }) }),
    });
    const response = await handleRead(ctx, url("/api/stage/x"));
    expect(response?.status).toBe(200);
  });
});

describe("GET /api/guides — in-app usage docs", () => {
  it("lists guides from the workspace docs/guides tree", async () => {
    const response = await handleRead(context(), url("/api/guides"));
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { ok: true; value: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.value.some((g) => g.name === "getting-started.md")).toBe(true);
  });

  it("reads a single guide by filename", async () => {
    const response = await handleRead(context(), url("/api/guides/getting-started.md"));
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      ok: true;
      value: { name: string; markdown: string };
    };
    expect(body.value.name).toBe("getting-started.md");
    expect(body.value.markdown).toContain("#");
  });

  it("rejects traversal names without leaking the filesystem", async () => {
    const response = await handleRead(context(), url("/api/guides/..%2Fpackage.json"));
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ error: true, reason: "not-found" });
  });
});

describe("GET /api/agents — agent personas", () => {
  it("reads an agent persona from the workspace tree", async () => {
    const response = await handleRead(context(), url("/api/agents/aidlc-quality-agent"));
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      ok: true;
      value: {
        id: string;
        displayName: string;
        description: string;
        markdown: string;
        stages: string[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.value.id).toBe("aidlc-quality-agent");
    expect(body.value.displayName).toBe("品質エージェント");
    expect(body.value.description).toContain("テスト");
    expect(body.value.markdown).toContain("品質エージェント");
    expect(body.value.stages).toContain("build-and-test");
  });

  it("reads agent knowledge by filename", async () => {
    const response = await handleRead(
      context(),
      url("/api/agents/aidlc-quality-agent/knowledge/testing-guide.md"),
    );
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      ok: true;
      value: { name: string; markdown: string };
    };
    expect(body.value.name).toBe("testing-guide.md");
    expect(body.value.markdown).toContain("#");
  });

  it("rejects traversal names for agent knowledge", async () => {
    const response = await handleRead(
      context(),
      url("/api/agents/aidlc-quality-agent/knowledge/..%2Fpackage.json"),
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ error: true, reason: "not-found" });
  });
});

describe("routing", () => {
  it("answers an unknown /api/ path with 404 JSON, not the SPA shell", async () => {
    const response = await handleRead(context(), url("/api/nope"));
    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toMatchObject({ reason: "unknown-route" });
  });

  it("returns null for a non-API path so the caller falls back to static", async () => {
    await expect(handleRead(context(), url("/dashboard/units"))).resolves.toBeNull();
  });
});
