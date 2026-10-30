import { describe, expect, it, vi } from "vitest";
import { fetchReleaseMetadata } from "../src/release-lookup.ts";
import { updateConfirmDetail } from "../src/update-feedback.ts";
import {
  type LatestRelease,
  parseLatestRelease,
  parseReleaseMetadata,
  RELEASE_METADATA_ASSET,
  releaseWorkflowsChange,
} from "../src/update-release.ts";

const DOWNLOAD = "https://github.com/otomatty/andon-for-aidlc/releases/download/v0.40.0";

function release(assets: unknown[]): unknown {
  return { tag_name: "v0.40.0", draft: false, prerelease: false, body: "", assets };
}

const vsix = { name: "andon-for-aidlc-0.40.0.vsix", browser_download_url: `${DOWNLOAD}/x.vsix` };

describe("parseLatestRelease metadata", () => {
  it("keeps the metadata asset's download URL", () => {
    const parsed = parseLatestRelease(
      release([
        vsix,
        { name: RELEASE_METADATA_ASSET, browser_download_url: `${DOWNLOAD}/${RELEASE_METADATA_ASSET}` },
      ]),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { metadataUrl: `${DOWNLOAD}/${RELEASE_METADATA_ASSET}` },
    });
  });

  it("has no metadata for an older release without the asset", () => {
    const parsed = parseLatestRelease(release([vsix]));
    expect(parsed.ok && parsed.value.metadataUrl).toBeUndefined();
  });

  it.each([
    ["served from anywhere but this repository's releases", "https://example.com/meta.json"],
    ["without a download URL", undefined],
  ])("keeps a listed metadata asset %s as unusable, never as absent", (_, url) => {
    const parsed = parseLatestRelease(
      release([vsix, { name: RELEASE_METADATA_ASSET, browser_download_url: url }]),
    );
    expect(parsed.ok && parsed.value.metadataUrl).toBeNull();
  });
});

describe("parseReleaseMetadata", () => {
  it("reads the supported aidlc-workflows release", () => {
    expect(
      parseReleaseMetadata({ schemaVersion: 1, version: "0.40.0", workflowsTarget: "2.11.0" }),
    ).toEqual({ version: "0.40.0", workflowsTarget: "2.11.0" });
  });

  it.each([
    null,
    "2.11.0",
    { schemaVersion: 2, version: "0.40.0", workflowsTarget: "2.11.0" },
    { schemaVersion: 1, version: "0.40.0", workflowsTarget: "latest" },
    { schemaVersion: 1, workflowsTarget: "2.11.0" },
  ])("rejects %j", (body) => {
    expect(parseReleaseMetadata(body)).toBeNull();
  });
});

describe("releaseWorkflowsChange", () => {
  const metadata = { version: "0.40.0", workflowsTarget: "2.11.0" };

  it("reports a release that moves the supported aidlc-workflows release", () => {
    expect(releaseWorkflowsChange("2.10.0", metadata)).toEqual({ from: "2.10.0", to: "2.11.0" });
  });

  it("is quiet when the supported release stays, or the release carries no metadata", () => {
    expect(releaseWorkflowsChange("2.11.0", metadata)).toBeNull();
    expect(releaseWorkflowsChange("2.10.0", "absent")).toBeNull();
  });

  it("reports a listed asset that could not be read as unverified", () => {
    expect(releaseWorkflowsChange("2.10.0", "unreadable")).toBe("unverified");
  });
});

describe("updateConfirmDetail with a supported-release change", () => {
  it("leads with what the person must do afterwards", () => {
    const detail = updateConfirmDetail("0.40.0", ["修正"], { from: "2.10.0", to: "2.11.0" });
    expect(detail?.split("\n")[0]).toBe(
      "この更新後は、プロジェクトの aidlc-workflows を 2.10.0 から 2.11.0 に更新するまで Andon を使えません。",
    );
    expect(detail).toContain("リポジトリへのコミットが必要です");
    expect(detail).toContain("今は更新しない場合は、このダイアログを閉じてください。");
    expect(detail).toContain("0.40.0 の主な変更:\n・修正");
  });

  it("warns that compatibility was not checked when the metadata could not be read", () => {
    const detail = updateConfirmDetail("0.40.0", ["修正"], "unverified");
    expect(detail?.split("\n").slice(0, 2)).toEqual([
      "新しい Andon が対応する aidlc-workflows の版を確認できませんでした。",
      "対応する版が変わっていた場合、更新後はプロジェクトの aidlc-workflows を更新するまで Andon を使えません。",
    ]);
    expect(detail).toContain("今は更新しない場合は、このダイアログを閉じてください。");
    expect(detail).toContain("0.40.0 の主な変更:\n・修正");
  });

  it("still warns when the release lists no changes", () => {
    expect(updateConfirmDetail("0.40.0", [], { from: "2.10.0", to: "2.11.0" })).toContain(
      "2.11.0 に更新するまで",
    );
  });
});

describe("fetchReleaseMetadata", () => {
  const withUrl: LatestRelease = {
    version: "0.40.0",
    tag: "v0.40.0",
    assetName: "andon-for-aidlc-0.40.0.vsix",
    notes: [],
    metadataUrl: `${DOWNLOAD}/${RELEASE_METADATA_ASSET}`,
  };

  it("downloads and parses the asset", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ schemaVersion: 1, version: "0.40.0", workflowsTarget: "2.11.0" }),
    );
    await expect(fetchReleaseMetadata(withUrl, fetchImpl)).resolves.toEqual({
      version: "0.40.0",
      workflowsTarget: "2.11.0",
    });
    expect(fetchImpl).toHaveBeenCalledWith(withUrl.metadataUrl, expect.anything());
  });

  it("is absent, without fetching, for a release that lists no asset", async () => {
    const { metadataUrl: _, ...withoutUrl } = withUrl;
    const never = vi.fn();
    await expect(fetchReleaseMetadata(withoutUrl, never)).resolves.toBe("absent");
    expect(never).not.toHaveBeenCalled();
  });

  it("is unreadable, without fetching, for a listed asset with no usable URL", async () => {
    const never = vi.fn();
    await expect(fetchReleaseMetadata({ ...withUrl, metadataUrl: null }, never)).resolves.toBe(
      "unreadable",
    );
    expect(never).not.toHaveBeenCalled();
  });

  it.each([
    ["an HTTP error", async () => new Response("", { status: 500 })],
    [
      "a timeout",
      async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    ],
    [
      "a network error",
      async () => {
        throw new Error("offline");
      },
    ],
    ["malformed JSON", async () => new Response("{not json", { status: 200 })],
    [
      "another release's metadata",
      async () =>
        Response.json({ schemaVersion: 1, version: "0.39.0", workflowsTarget: "2.11.0" }),
    ],
  ])("is unreadable on %s", async (_, fetchImpl) => {
    await expect(fetchReleaseMetadata(withUrl, fetchImpl)).resolves.toBe("unreadable");
  });
});
