import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseAidlcVersionSource,
  parsePinnedManifestInfo,
  parseUpstreamSha,
  readPinnedManifestInfo,
  readWorkspaceAidlcVersion,
  requiresNativeInstaller,
} from "../src/workflows-version.ts";

const temps: string[] = [];

it("routes 2.8 native releases to the official installer instead of a missing dist archive", () => {
  expect(requiresNativeInstaller("2.8.0")).toBe(true);
  expect(requiresNativeInstaller("3.0.0")).toBe(true);
  expect(requiresNativeInstaller("2.7.1")).toBe(false);
  expect(requiresNativeInstaller("unknown")).toBe(false);
});


afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe("parseAidlcVersionSource", () => {
  it("reads the exported constant", () => {
    expect(parseAidlcVersionSource('export const AIDLC_VERSION = "2.6.99";\n')).toBe("2.6.99");
    expect(parseAidlcVersionSource("export const AIDLC_VERSION = '2.5.0';")).toBe("2.5.0");
  });

  it("returns null when the constant is missing or not a semver", () => {
    expect(parseAidlcVersionSource("export const OTHER = '2.6.99';")).toBeNull();
    expect(parseAidlcVersionSource('export const AIDLC_VERSION = "dev";')).toBeNull();
  });
});

describe("parsePinnedManifestInfo / readPinnedManifestInfo", () => {
  it("carries upstreamSha alongside the version", () => {
    expect(
      parsePinnedManifestInfo(
        JSON.stringify({
          sourceVersion: "2.6.124",
          source: "aidlc-workflows",
          capturedAt: "2026-08-31T01:58:12Z",
          upstreamSha: "82D2E304206CA352BA3DC140DCBE8B9FB0B13B3D",
        }),
      ),
    ).toEqual({ version: "2.6.124", upstreamSha: "82d2e304206ca352ba3dc140dcbe8b9fb0b13b3d" });
  });

  it("keeps the version usable when upstreamSha is absent or malformed", () => {
    expect(parsePinnedManifestInfo(JSON.stringify({ sourceVersion: "2.6.99" }))).toEqual({
      version: "2.6.99",
      upstreamSha: null,
    });
    expect(
      parsePinnedManifestInfo(JSON.stringify({ sourceVersion: "2.6.99", upstreamSha: "zzz" })),
    ).toEqual({ version: "2.6.99", upstreamSha: null });
  });

  it("rejects non-sha values", () => {
    expect(parseUpstreamSha("82d2e30")).toBe("82d2e30");
    expect(parseUpstreamSha("82d2e3")).toBeNull();
    expect(parseUpstreamSha("refs/tags/v2.6.124")).toBeNull();
    expect(parseUpstreamSha(42)).toBeNull();
  });

  it("reads the packaged docs manifest", () => {
    const docsRoot = tempDir("aidlc-pin-info-");
    mkdirSync(join(docsRoot, "docs"), { recursive: true });
    writeFileSync(
      join(docsRoot, "docs", "official-docs.manifest.json"),
      JSON.stringify({
        sourceVersion: "2.6.124",
        source: "aidlc-workflows",
        capturedAt: "2026-08-31T01:58:12Z",
        upstreamSha: "82d2e304206ca352ba3dc140dcbe8b9fb0b13b3d",
      }),
    );
    expect(readPinnedManifestInfo(docsRoot)?.upstreamSha).toBe(
      "82d2e304206ca352ba3dc140dcbe8b9fb0b13b3d",
    );
    expect(readPinnedManifestInfo(tempDir("aidlc-pin-info-missing-"))).toBeNull();
  });
});

describe("readWorkspaceAidlcVersion", () => {
  it("reports the oldest installed harness version, not the first file found", () => {
    const root = tempDir("aidlc-ws-ver-");
    mkdirSync(join(root, ".claude", "tools"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "tools", "aidlc-version.ts"),
      'export const AIDLC_VERSION = "2.5.0";\n',
    );
    expect(readWorkspaceAidlcVersion(root)).toEqual({
      version: "2.5.0",
      sourcePath: join(root, ".claude", "tools", "aidlc-version.ts"),
      raw: 'export const AIDLC_VERSION = "2.5.0";\n',
    });

    mkdirSync(join(root, ".cursor", "tools"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "tools", "aidlc-version.ts"),
      'export const AIDLC_VERSION = "2.6.99";\n',
    );
    const read = readWorkspaceAidlcVersion(root);
    expect(read.version).toBe("2.5.0");
    expect(read.sourcePath).toBe(join(root, ".claude", "tools", "aidlc-version.ts"));
  });

  it("returns unparseable when any installed version file is not a semver", () => {
    const root = tempDir("aidlc-ws-mixed-bad-");
    mkdirSync(join(root, ".cursor", "tools"), { recursive: true });
    mkdirSync(join(root, ".claude", "tools"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "tools", "aidlc-version.ts"),
      'export const AIDLC_VERSION = "2.6.99";\n',
    );
    writeFileSync(
      join(root, ".claude", "tools", "aidlc-version.ts"),
      "export const AIDLC_VERSION = 'next';\n",
    );
    const read = readWorkspaceAidlcVersion(root);
    expect(read.version).toBeNull();
    expect(read.sourcePath).toBe(join(root, ".claude", "tools", "aidlc-version.ts"));
  });

  it("returns unparseable when the file exists but is not a semver", () => {
    const root = tempDir("aidlc-ws-bad-");
    mkdirSync(join(root, ".cursor", "tools"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "tools", "aidlc-version.ts"),
      "export const AIDLC_VERSION = 'next';\n",
    );
    const read = readWorkspaceAidlcVersion(root);
    expect(read.version).toBeNull();
    expect(read.sourcePath).not.toBeNull();
    expect(read.raw).toContain("next");
  });

  it("returns no source when none of the version files exist", () => {
    const root = tempDir("aidlc-ws-none-");
    expect(readWorkspaceAidlcVersion(root)).toEqual({
      version: null,
      sourcePath: null,
      raw: null,
    });
  });
});
