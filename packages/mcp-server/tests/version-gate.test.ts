import type { VersionGate } from "@andon/shared-types";
import { describe, expect, it, vi } from "vitest";
import { gated, versionGateReply } from "../src/version-gate.ts";

function gate(status: VersionGate["status"]): VersionGate {
  return {
    status,
    target: "2.11.0",
    tools: [],
    pin: null,
    engine: null,
    native: false,
    projectVersion: null,
    rollback: null,
    message: `理由 ${status}。`,
  };
}

const answer = { content: [{ type: "text" as const, text: "answer" }] };

describe("gated", () => {
  it("runs the tool when the check passes", async () => {
    const handler = vi.fn(async (_input: { q: string }) => answer);
    const tool = gated(() => gate("ok"), handler);
    await expect(tool({ q: "x" })).resolves.toBe(answer);
    expect(handler).toHaveBeenCalledWith({ q: "x" });
  });

  it("runs the tool when checking is switched off", async () => {
    const handler = vi.fn(async () => answer);
    await expect(gated(() => null, handler)()).resolves.toBe(answer);
  });

  it.each(["not-installed", "unknown", "project-newer", "project-older", "engine-mismatch"] as const)(
    "answers %s with the update notice instead of running the tool",
    async (status) => {
      const handler = vi.fn(async () => answer);
      const reply = await gated(() => gate(status), handler)();
      expect(handler).not.toHaveBeenCalled();
      const text = reply.content.map((block) => block.text).join("\n");
      expect(text).toContain(`理由 ${status}。`);
      expect(text).toContain('"detail": "version-gate"');
    },
  );

  it("fails closed when the check itself throws", async () => {
    const handler = vi.fn(async () => answer);
    const reply = await gated(() => {
      throw new Error("EACCES");
    }, handler)();
    expect(handler).not.toHaveBeenCalled();
    expect(reply.content[0]?.text).toContain("確認できませんでした");
  });
});

describe("versionGateReply", () => {
  it("tells the AI to relay the notice rather than retry", () => {
    const reply = versionGateReply(gate("project-older"));
    expect(reply.text).toContain("再試行しないでください");
    expect(reply.degraded).toEqual({ kind: "unsupported", detail: "version-gate" });
  });
});
