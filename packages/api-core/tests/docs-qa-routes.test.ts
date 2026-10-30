import type { DocsQaCitation, DocsQaEvidence, DocsQaJob } from "@aidlc-guide/shared-types";
import { describe, expect, it, vi } from "vitest";
import { type DocsQaService } from "../src/docs-qa/index.ts";
import { handlePost, routePost } from "../src/handlers/post.ts";
import { handleRead, type ReadContext, routeRead } from "../src/handlers/read.ts";
import type { GuideService } from "../src/service.ts";

const citation: DocsQaCitation = {
  id: "1",
  sourceId: "guide:browser:3",
  target: { kind: "guide", path: "browser-dashboard.md", locale: "ja" },
  title: "ブラウザー",
  headings: ["ブラウザー"],
  version: "Andon 1.2.3",
  hash: "a".repeat(64),
  startLine: 3,
  endLine: 3,
  quote: "Dashboard を開きます。",
};
const job: DocsQaJob = {
  id: "job-private-id",
  question: "ブラウザーで開くには？",
  tool: "claude",
  phase: "completed",
  answer: "Dashboard を開きます。[1]",
  citations: [citation],
  createdAt: 1000,
};
const evidence: DocsQaEvidence = {
  target: citation.target,
  title: citation.title,
  markdown: "# ブラウザー\n\nDashboard を開きます。",
  hash: citation.hash,
  matches: true,
};
const question = { question: job.question, tool: "claude", locale: "ja" };

function fixture() {
  const qa = {
    tools: vi.fn<DocsQaService["tools"]>(async () => [
      { tool: "claude", label: "Claude Code", available: true },
    ]),
    start: vi.fn<DocsQaService["start"]>(async () => ({ ok: true, value: job })),
    get: vi.fn<DocsQaService["get"]>(() => ({ ok: true, value: job })),
    cancel: vi.fn<DocsQaService["cancel"]>(() => ({
      ok: true,
      value: { ...job, phase: "cancelled" },
    })),
    evidence: vi.fn<DocsQaService["evidence"]>(async () => ({ ok: true, value: evidence })),
    dispose: vi.fn(),
  } satisfies DocsQaService;
  const readContext: ReadContext = {
    docsQa: qa,
    workspaceRoot: "unused",
    officialDocsRoot: "unused",
    reader: {} as ReadContext["reader"],
    bridge: {} as ReadContext["bridge"],
    recordDir: async () => ({ error: true, reason: "unused" }),
    selected: () => null,
    matrix: () => null,
  };
  const service: GuideService = {
    switchSpace: async () => ({ status: 400, body: {} }),
    docsQa: qa,
    readContext,
    reader: readContext.reader,
    bridge: readContext.bridge,
    hub: {} as GuideService["hub"],
    answerContext: { recordDir: readContext.recordDir },
    startMatrixBackground: vi.fn(),
    startWatch: () => vi.fn(),
    selectIntent: async () => ({ status: 400, body: { error: true, reason: "unused" } }),
    versionGate: () => null,
    invalidateVersionGate: vi.fn(),
  };
  return { service, qa, readContext };
}

function post(action: string, body: unknown, origin = "http://127.0.0.1:5173"): Request {
  return new Request(`http://127.0.0.1:4700/api/docs-qa/${action}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
}

describe("document question HTTP and WebView routes", () => {
  it.each(["", "?recheck=true", "?recheck=false"])(
    "passes explicit capability rechecks on both transports: %s",
    async (query) => {
      const { qa, readContext } = fixture();
      const url = new URL(`http://127.0.0.1:4700/api/docs-qa/tools${query}`);
      await routeRead(readContext, url);
      await handleRead(readContext, url);
      expect(qa.tools).toHaveBeenCalledTimes(2);
      expect(qa.tools).toHaveBeenNthCalledWith(1, query === "?recheck=true");
      expect(qa.tools).toHaveBeenNthCalledWith(2, query === "?recheck=true");
    },
  );
  it.each([
    { action: "ask", body: question, method: "start", argument: question },
    { action: "cancel", body: { id: job.id }, method: "cancel", argument: job.id },
    { action: "evidence", body: citation, method: "evidence", argument: citation },
  ] as const)(
    "keeps $action responses and arguments identical on both transports",
    async ({ action, body, method, argument }) => {
      const { service, qa } = fixture();
      const url = `/api/docs-qa/${action}`;
      const direct = await routePost(service, url, body);
      const http = await handlePost(service, url, post(action, body));
      expect(http?.status).toBe(200);
      expect(http?.status).toBe(direct?.status);
      expect(await http?.json()).toEqual(direct?.body);
      expect(http?.headers.get("cache-control")).toBe("no-store");
      expect(qa[method]).toHaveBeenCalledTimes(2);
      expect(qa[method]).toHaveBeenNthCalledWith(1, argument);
      expect(qa[method]).toHaveBeenNthCalledWith(2, argument);
    },
  );

  it.each([
    { url: "http://127.0.0.1:4700", origin: "https://hostile.example", site: "cross-site" },
    { url: "http://127.0.0.1:4700", origin: "http://127.0.0.1:4700", site: "cross-site" },
    {
      url: "http://rebound.example:4700",
      origin: "http://rebound.example:4700",
      site: "same-origin",
    },
    { url: "http://rebound.example:4700", origin: "http://127.0.0.1:4700", site: "same-origin" },
    { url: "http://127.0.0.1:4700", origin: "null", site: "same-origin" },
  ])(
    "rejects an unsafe caller before dispatch: $url / $origin / $site",
    async ({ url, origin, site }) => {
      const { service, qa } = fixture();
      for (const action of ["ask", "cancel", "evidence"]) {
        const request = new Request(`${url}/api/docs-qa/${action}`, {
          method: "POST",
          headers: { origin, "sec-fetch-site": site, "content-type": "application/json" },
          body: JSON.stringify(question),
        });
        const result = await handlePost(service, `/api/docs-qa/${action}`, request);
        expect(result?.status).toBe(403);
        expect(await result?.json()).toEqual({ error: true, reason: "forbidden-origin" });
      }
      expect(qa.start).not.toHaveBeenCalled();
      expect(qa.cancel).not.toHaveBeenCalled();
      expect(qa.evidence).not.toHaveBeenCalled();
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "allows same-host loopback proxy requests on %s",
    async (host) => {
      const { service } = fixture();
      const result = await handlePost(
        service,
        "/api/docs-qa/ask",
        new Request(`http://${host}:4700/api/docs-qa/ask`, {
          method: "POST",
          headers: { origin: `http://${host}:5173`, "content-type": "application/json" },
          body: JSON.stringify(question),
        }),
      );
      expect(result?.status).toBe(200);
    },
  );

  it("allows a local non-browser client without an Origin header", async () => {
    const { service } = fixture();
    const request = post("ask", question);
    request.headers.delete("origin");
    expect((await handlePost(service, "/api/docs-qa/ask", request))?.status).toBe(200);
  });

  it.each([null, "text/plain", "application/x-www-form-urlencoded"])(
    "rejects a missing or non-JSON content type: %s",
    async (contentType) => {
      const { service, qa } = fixture();
      const request = post("ask", question);
      if (contentType === null) request.headers.delete("content-type");
      else request.headers.set("content-type", contentType);
      const result = await handlePost(service, "/api/docs-qa/ask", request);
      expect(result?.status).toBe(415);
      expect(await result?.json()).toEqual({ error: true, reason: "json-required" });
      expect(qa.start).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "{"])("rejects an absent or malformed JSON body", async (body) => {
    const { service, qa } = fixture();
    const request = new Request("http://127.0.0.1:4700/api/docs-qa/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const result = await handlePost(service, "/api/docs-qa/ask", request);
    expect(result?.status).toBe(400);
    expect(await result?.json()).toEqual({ error: true, reason: "bad-request" });
    expect(qa.start).not.toHaveBeenCalled();
  });

  it("limits UTF-8 body bytes before parsing or dispatching", async () => {
    const { service, qa } = fixture();
    const result = await handlePost(
      service,
      "/api/docs-qa/ask",
      post("ask", { question: "質問".repeat(22_000) }),
    );
    expect(result?.status).toBe(413);
    expect(await result?.json()).toEqual({ error: true, reason: "body-too-large" });
    expect(qa.start).not.toHaveBeenCalled();
  });

  it.each([null, {}, { id: 12 }])("rejects cancellation without a string job id", async (body) => {
    const { service, qa } = fixture();
    expect(await routePost(service, "/api/docs-qa/cancel", body)).toEqual({
      status: 400,
      body: { error: true, reason: "bad-request" },
    });
    expect(qa.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["busy", 409],
    ["not-found", 404],
    ["bad-request", 400],
  ] as const)("maps %s consistently to HTTP %s", async (reason, status) => {
    const { service, qa } = fixture();
    qa.start.mockResolvedValue({ error: true, reason });
    const direct = await routePost(service, "/api/docs-qa/ask", question);
    const http = await handlePost(service, "/api/docs-qa/ask", post("ask", question));
    expect(direct).toEqual({ status, body: { error: true, reason } });
    expect(http?.status).toBe(status);
    expect(await http?.json()).toEqual(direct?.body);
  });

  it("reports an older host without the Q&A service as unavailable", async () => {
    const { service } = fixture();
    service.docsQa = undefined;
    expect(await routePost(service, "/api/docs-qa/ask", question)).toEqual({
      status: 503,
      body: { error: true, reason: "unavailable" },
    });
  });

  it("returns the same job privately over local HTTP and the internal WebView route", async () => {
    const { readContext, qa } = fixture();
    const direct = await routeRead(
      readContext,
      new URL(`http://aidlc-guide.local/api/docs-qa/job?id=${job.id}`),
    );
    const http = await handleRead(
      readContext,
      new URL(`http://127.0.0.1:4700/api/docs-qa/job?id=${job.id}`),
    );
    expect(direct?.body).toEqual({ ok: true, value: job });
    expect(await http?.json()).toEqual(direct?.body);
    expect(http?.headers.get("cache-control")).toBe("no-store");
    expect(qa.get).toHaveBeenCalledWith(job.id);
  });

  it.each(["rebound.example", "aidlc-guide.local", "192.168.1.20"])(
    "rejects non-loopback HTTP reads on %s",
    async (host) => {
      const { readContext, qa } = fixture();
      for (const route of ["tools", `job?id=${job.id}`]) {
        const result = await handleRead(
          readContext,
          new URL(`http://${host}:4700/api/docs-qa/${route}`),
        );
        expect(result?.status).toBe(403);
        expect(await result?.json()).not.toHaveProperty("value");
      }
      expect(qa.get).not.toHaveBeenCalled();
      expect(qa.tools).not.toHaveBeenCalled();
    },
  );
});
