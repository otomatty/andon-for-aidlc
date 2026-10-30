import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmNewerRelease,
  lookupLatestRelease,
  newerRelease,
  setDefaultOnNone,
} from "../src/release-lookup.ts";
import { RELEASES_LATEST_URL, UPDATE_USER_AGENT } from "../src/update-release.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupLatestRelease", () => {
  it("sends the GitHub preview headers and returns a parsed release", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe(RELEASES_LATEST_URL);
      expect(init?.headers?.["User-Agent"]).toBe(UPDATE_USER_AGENT);
      expect(init?.headers?.Accept).toBe("application/vnd.github+json");
      return Response.json({
        tag_name: "v0.2.0",
        assets: [{ name: "andon-for-aidlc-0.2.0.vsix" }],
      });
    });
    await expect(lookupLatestRelease(fetchImpl)).resolves.toEqual({
      ok: true,
      release: {
        version: "0.2.0",
        tag: "v0.2.0",
        assetName: "andon-for-aidlc-0.2.0.vsix",
        notes: [],
      },
    });
  });

  it("maps rate limits, HTTP errors, and timeouts", async () => {
    await expect(
      lookupLatestRelease(async () => new Response("no", { status: 403 })),
    ).resolves.toEqual({ ok: false, reason: "rate-limited" });
    await expect(
      lookupLatestRelease(async () => new Response("no", { status: 500 })),
    ).resolves.toEqual({ ok: false, reason: "http" });
    await expect(
      lookupLatestRelease(async () => {
        const err = new Error("aborted");
        err.name = "TimeoutError";
        throw err;
      }),
    ).resolves.toEqual({ ok: false, reason: "timeout" });
  });
});

describe("newerRelease / confirmNewerRelease", () => {
  it("returns the newer release and honors confirm", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        tag_name: "v0.2.0",
        assets: [{ name: "andon-for-aidlc-0.2.0.vsix" }],
      }),
    );
    await expect(newerRelease("0.1.0")).resolves.toEqual({
      version: "0.2.0",
      tag: "v0.2.0",
      assetName: "andon-for-aidlc-0.2.0.vsix",
      notes: [],
    });
    await expect(newerRelease("0.2.0")).resolves.toBeUndefined();
    await expect(confirmNewerRelease("0.1.0", async () => false)).resolves.toBeUndefined();
    await expect(confirmNewerRelease("0.1.0", async () => true)).resolves.toMatchObject({
      version: "0.2.0",
    });
    const onNone = vi.fn(async () => undefined);
    await expect(confirmNewerRelease("0.2.0", async () => true, onNone)).resolves.toBeUndefined();
    expect(onNone).toHaveBeenCalledOnce();
    const fallback = vi.fn(async () => undefined);
    setDefaultOnNone(fallback);
    await expect(confirmNewerRelease("0.2.0", async () => true)).resolves.toBeUndefined();
    expect(fallback).toHaveBeenCalledOnce();
    setDefaultOnNone(async () => undefined);
  });

  it("reports lookup failures instead of treating them as up-to-date", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    const onNone = vi.fn(async () => undefined);
    const onFail = vi.fn(async () => undefined);
    await expect(
      confirmNewerRelease("0.1.0", async () => true, onNone, onFail),
    ).resolves.toBeUndefined();
    expect(onNone).not.toHaveBeenCalled();
    expect(onFail).toHaveBeenCalledWith("http");
  });
});
