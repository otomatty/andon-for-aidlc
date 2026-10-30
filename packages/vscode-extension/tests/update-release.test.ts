import { describe, expect, it } from "vitest";
import {
  compareSemver,
  decideUpdate,
  isVsixBuffer,
  parseLatestRelease,
  releaseNoteItems,
  parseSemver,
  vsixAssetName,
  vsixDownloadUrl,
} from "../src/update-release.ts";

describe("parseSemver", () => {
  it("reads dotted triples and optional v prefix", () => {
    expect(parseSemver("0.2.0")).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: "",
    });
    expect(parseSemver("v1.0.0")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: "",
    });
    expect(parseSemver("0.2.0-rc.1")?.prerelease).toBe("rc.1");
    expect(parseSemver("dev")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders release ahead of prerelease", () => {
    const a = parseSemver("0.2.0");
    const b = parseSemver("0.2.0-rc.1");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (a === null || b === null) return;
    expect(compareSemver(a, b)).toBeGreaterThan(0);
    expect(compareSemver(b, a)).toBeLessThan(0);
    expect(compareSemver(a, a)).toBe(0);
  });

  it("orders numeric prerelease identifiers and ignores build metadata", () => {
    const rc2 = parseSemver("1.0.0-rc.2");
    const rc10 = parseSemver("1.0.0-rc.10");
    const withBuild = parseSemver("1.0.0+build.9");
    const plain = parseSemver("1.0.0");
    expect(rc2).not.toBeNull();
    expect(rc10).not.toBeNull();
    expect(withBuild).not.toBeNull();
    expect(plain).not.toBeNull();
    if (rc2 === null || rc10 === null || withBuild === null || plain === null) return;
    expect(compareSemver(rc10, rc2)).toBeGreaterThan(0);
    expect(compareSemver(rc2, rc10)).toBeLessThan(0);
    expect(compareSemver(withBuild, plain)).toBe(0);
    expect(parseSemver("1.0.0+build.9")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: "",
    });
  });
});

describe("parseLatestRelease", () => {
  it("accepts a public latest release with the expected VSIX name", () => {
    expect(
      parseLatestRelease({
        tag_name: "v0.2.0",
        draft: false,
        prerelease: false,
        assets: [{ name: "aidlc-guide-0.2.0.vsix" }],
      }),
    ).toEqual({
      ok: true,
      value: { version: "0.2.0", tag: "v0.2.0", assetName: "aidlc-guide-0.2.0.vsix", notes: [] },
    });
  });

  it("carries the release notes of the offered version", () => {
    const parsed = parseLatestRelease({
      tag_name: "v0.2.0",
      body: "## What's Changed\n* feat: 新しい画面 by @dev in https://github.com/o/r/pull/1\n",
      assets: [{ name: "aidlc-guide-0.2.0.vsix" }],
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        version: "0.2.0",
        tag: "v0.2.0",
        assetName: "aidlc-guide-0.2.0.vsix",
        notes: ["新しい画面"],
      },
    });
  });

  it("rejects drafts, bad tags, and missing assets", () => {
    expect(parseLatestRelease(null)).toEqual({ ok: false, reason: "invalid-json" });
    expect(parseLatestRelease({ tag_name: "v0.2.0", prerelease: true, assets: [] })).toEqual({
      ok: false,
      reason: "draft-or-prerelease",
    });
    expect(parseLatestRelease({ tag_name: "../evil", assets: [] })).toEqual({
      ok: false,
      reason: "invalid-tag",
    });
    expect(parseLatestRelease({ tag_name: "v0.2.0", assets: [{ name: "other.zip" }] })).toEqual({
      ok: false,
      reason: "missing-asset",
    });
  });
});

describe("releaseNoteItems", () => {
  const generated = [
    "## What's Changed",
    "* feat: ドキュメント質問をチャット画面にする by @otomatty in https://github.com/otomatty/andon-for-aidlc/pull/164",
    "* fix(dashboard): render stage status with SVG icons by @otomatty in https://github.com/otomatty/andon-for-aidlc/pull/158",
    "* Show newest intents first in dashboard lists by @otomatty in https://github.com/otomatty/andon-for-aidlc/pull/161",
    "",
    "## New Contributors",
    "* @someone made their first contribution in https://github.com/otomatty/andon-for-aidlc/pull/1",
    "",
    "",
    "**Full Changelog**: https://github.com/otomatty/andon-for-aidlc/compare/v0.33.0...v0.34.0",
  ].join("\r\n");

  it("reads the generated change list without authors, links or commit prefixes", () => {
    expect(releaseNoteItems(generated)).toEqual([
      "ドキュメント質問をチャット画面にする",
      "render stage status with SVG icons",
      "Show newest intents first in dashboard lists",
    ]);
  });

  it("keeps points written above the generated list, first", () => {
    // GitHub puts the text given at release time before the generated notes.
    const body = `破壊的変更\r\n- 設定の保存先を変えました\r\n\r\n${generated}`;
    expect(releaseNoteItems(body)).toEqual([
      "設定の保存先を変えました",
      "ドキュメント質問をチャット画面にする",
      "render stage status with SVG icons",
      "Show newest intents first in dashboard lists",
    ]);
  });

  it("returns nothing for a changelog-only body or a non-string", () => {
    expect(
      releaseNoteItems(
        "**Full Changelog**: https://github.com/otomatty/andon-for-aidlc/compare/v0.34.0...v0.34.1",
      ),
    ).toEqual([]);
    expect(releaseNoteItems(undefined)).toEqual([]);
    expect(releaseNoteItems(3)).toEqual([]);
  });

  it("reads hand-written bullets when there is no generated heading", () => {
    expect(releaseNoteItems("変更点\n- 手書きの変更点\n  - 入れ子は読まない\n- もう一つ")).toEqual([
      "手書きの変更点",
      "もう一つ",
    ]);
  });

  it("drops duplicates, empty items and overly long text", () => {
    const long = "あ".repeat(200);
    const items = releaseNoteItems(`* chore: 同じ\n* chore: 同じ\n* \n* ${long}`);
    expect(items[0]).toBe("同じ");
    expect(items).toHaveLength(2);
    expect(items[1]?.length).toBeLessThanOrEqual(120);
    expect(items[1]?.endsWith("…")).toBe(true);
  });
});

describe("decideUpdate / vsix helpers", () => {
  const latest = {
    version: "0.2.0",
    tag: "v0.2.0",
    assetName: vsixAssetName("0.2.0"),
    notes: [],
  };

  it("reports available, up-to-date, and invalid current", () => {
    expect(decideUpdate("0.1.0", latest)).toEqual({ kind: "available", current: "0.1.0", latest });
    expect(decideUpdate("0.2.0", latest)).toEqual({
      kind: "up-to-date",
      current: "0.2.0",
      latest: "0.2.0",
    });
    expect(decideUpdate("dev", latest)).toEqual({ kind: "invalid-current", current: "dev" });
  });

  it("builds the first-party download URL from the tag", () => {
    expect(vsixDownloadUrl(latest)).toBe(
      "https://github.com/otomatty/andon-for-aidlc/releases/download/v0.2.0/aidlc-guide-0.2.0.vsix",
    );
  });

  it("requires a ZIP magic header and a minimum size", () => {
    const ok = new Uint8Array(100);
    ok[0] = 0x50;
    ok[1] = 0x4b;
    expect(isVsixBuffer(ok)).toBe(true);
    expect(isVsixBuffer(new Uint8Array(100))).toBe(false);
    expect(isVsixBuffer(ok.slice(0, 50))).toBe(false);
  });
});
