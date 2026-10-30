import type { DocsQaCitation, DocsQaResult } from "@andon/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocsQaService, type DocsQaDependencies, type DocsQaService } from "../src/docs-qa";

const citation: DocsQaCitation = {
  id: "1",
  sourceId: "guide-start",
  target: { kind: "guide", path: "start.md", locale: "ja" },
  title: "start",
  headings: ["start"],
  version: "0.9.0",
  hash: "a".repeat(64),
  startLine: 1,
  endLine: 1,
  quote: "start",
};

const services: DocsQaService[] = [];

function setup(run: DocsQaDependencies["run"] = async () => "ok") {
  const dependencies: DocsQaDependencies = {
    retrieve: vi.fn(async () => ({ citations: [structuredClone(citation)] })),
    readEvidence: vi.fn(async () => ({
      target: citation.target,
      title: citation.title,
      markdown: "start",
      hash: citation.hash,
      matches: true,
    })),
    probe: vi.fn(async (tool) => ({ tool, label: tool, available: true, command: tool })),
    run,
    scratch: vi.fn(async () => ({ cwd: "/isolated", env: {}, cleanup: vi.fn(async () => {}) })),
    timeoutMs: 120_000,
    customizeTimeoutMs: 240_000,
    now: Date.now,
  };
  const service = createDocsQaService({ docsRoot: "/bundled", dependencies });
  services.push(service);
  return service;
}

function reason(result: DocsQaResult<unknown>): string {
  return "error" in result ? result.reason : "ok";
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

const base = { tool: "claude" as const, locale: "ja" as const };

describe("docs qa chat contract", () => {
  it("accepts the last 8 completed turns", async () => {
    const service = setup();
    const history = Array.from({ length: 8 }, (_, index) => ({
      question: `q${index}`,
      answer: "a".repeat(100),
    }));
    expect(reason(await service.start({ question: "next", ...base, history }))).toBe("ok");
  });

  it("refuses a 9th history turn", async () => {
    const service = setup();
    const history = Array.from({ length: 9 }, (_, index) => ({
      question: `q${index}`,
      answer: "a",
    }));
    expect(reason(await service.start({ question: "next", ...base, history }))).toBe("bad-request");
  });

  it("accepts a question of 2000 characters", async () => {
    const service = setup();
    expect(reason(await service.start({ question: "q".repeat(2000), ...base }))).toBe("ok");
  });

  it("refuses a question of 2001 characters", async () => {
    const service = setup();
    expect(reason(await service.start({ question: "q".repeat(2001), ...base }))).toBe(
      "bad-request",
    );
  });

  it("keeps a single in-flight job", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = setup(async () => {
      await gate;
      return "ok";
    });
    const first = await service.start({ question: "one", ...base });
    expect(reason(first)).toBe("ok");
    expect(reason(await service.start({ question: "two", ...base }))).toBe("busy");
    release();
  });

  it("accepts a first ask with no history so the client can open chat", async () => {
    const service = setup();
    const result = await service.start({ question: "first from entry", ...base });
    expect(reason(result)).toBe("ok");
    expect(result).toMatchObject({
      ok: true,
      value: { question: "first from entry", phase: "searching" },
    });
  });

});
