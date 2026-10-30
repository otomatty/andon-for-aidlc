import { describe, expect, it, vi } from "vitest";
import { applyReleaseFromUrl } from "../src/release-apply.ts";

function vsixBytes(): Uint8Array {
  const bytes = new Uint8Array(120);
  bytes[0] = 0x50;
  bytes[1] = 0x4b;
  return bytes;
}

describe("applyReleaseFromUrl", () => {
  it("writes, installs, and cleans up a valid VSIX", async () => {
    const bytes = vsixBytes();
    const writeBytes = vi.fn(async () => "/tmp/andon-for-aidlc-0.2.0.vsix");
    const installFromPath = vi.fn(async () => undefined);
    const cleanupPath = vi.fn(async () => undefined);
    const result = await applyReleaseFromUrl("0.2.0", "https://example.invalid/app.vsix", {
      fetchImpl: async () => new Response(bytes, { status: 200 }),
      writeBytes,
      installFromPath,
      cleanupPath,
    });
    expect(result).toEqual({ ok: true });
    expect(writeBytes).toHaveBeenCalledWith("0.2.0", bytes);
    expect(installFromPath).toHaveBeenCalledWith("/tmp/andon-for-aidlc-0.2.0.vsix");
    expect(cleanupPath).toHaveBeenCalledWith("/tmp/andon-for-aidlc-0.2.0.vsix");
  });

  it("rejects a non-VSIX payload and does not install", async () => {
    const installFromPath = vi.fn(async () => undefined);
    const result = await applyReleaseFromUrl("0.2.0", "https://example.invalid/app.vsix", {
      fetchImpl: async () => new Response(new Uint8Array(120), { status: 200 }),
      writeBytes: async () => "/tmp/x.vsix",
      installFromPath,
      cleanupPath: async () => undefined,
    });
    expect(result).toEqual({ ok: false, reason: "invalid-vsix" });
    expect(installFromPath).not.toHaveBeenCalled();
  });

  it("keeps the VSIX and records detail when install throws", async () => {
    const cleanupPath = vi.fn(async () => undefined);
    const result = await applyReleaseFromUrl("0.2.0", "https://example.invalid/app.vsix", {
      fetchImpl: async () => new Response(vsixBytes(), { status: 200 }),
      writeBytes: async () => "/tmp/x.vsix",
      installFromPath: async () => {
        throw new Error("no");
      },
      cleanupPath,
    });
    expect(result).toEqual({
      ok: false,
      reason: "install",
      detail: "no",
      filePath: "/tmp/x.vsix",
    });
    expect(cleanupPath).not.toHaveBeenCalled();
  });

  it("reuses one in-flight apply instead of starting a second write", async () => {
    let finishWrite: ((path: string) => void) | undefined;
    const writeBytes = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const first = applyReleaseFromUrl("0.2.0", "https://example.invalid/a.vsix", {
      fetchImpl: async () => new Response(vsixBytes(), { status: 200 }),
      writeBytes,
      installFromPath: async () => undefined,
      cleanupPath: async () => undefined,
    });
    const second = applyReleaseFromUrl("0.2.1", "https://example.invalid/b.vsix", {
      fetchImpl: async () => new Response(vsixBytes(), { status: 200 }),
      writeBytes,
      installFromPath: async () => undefined,
      cleanupPath: async () => undefined,
    });
    await vi.waitFor(() => {
      expect(writeBytes).toHaveBeenCalledTimes(1);
    });
    finishWrite?.("/tmp/andon-for-aidlc-0.2.0.vsix");
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it("maps writeBytes rejection without installing", async () => {
    const installFromPath = vi.fn(async () => undefined);
    const cleanupPath = vi.fn(async () => undefined);
    const result = await applyReleaseFromUrl("0.2.0", "https://example.invalid/app.vsix", {
      fetchImpl: async () => new Response(vsixBytes(), { status: 200 }),
      writeBytes: async () => {
        throw new Error("disk full");
      },
      installFromPath,
      cleanupPath,
    });
    expect(result).toEqual({ ok: false, reason: "write", detail: "disk full" });
    expect(installFromPath).not.toHaveBeenCalled();
    expect(cleanupPath).not.toHaveBeenCalled();
  });

  it("includes HTTP status on a failed download", async () => {
    const result = await applyReleaseFromUrl("0.2.0", "https://example.invalid/app.vsix", {
      fetchImpl: async () => new Response("missing", { status: 404 }),
      writeBytes: async () => "/tmp/x.vsix",
      installFromPath: async () => undefined,
      cleanupPath: async () => undefined,
    });
    expect(result).toEqual({ ok: false, reason: "http", detail: "HTTP 404" });
  });
});
