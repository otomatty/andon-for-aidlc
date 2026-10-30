import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  harnessVersionRel,
  parseAidlcVersionSource,
  readAllWorkspaceAidlcVersions,
  type WorkspaceAidlcVersion,
} from "@andon/reader-core";
import { compareSemver, parseSemver } from "./update-release.ts";

/** A pin with no remaining tool files can be initialized with the first tool installation. */
export function canInitializeWorkflowsPin(
  harnessCount: number,
  versions: (string | null)[],
  pin: string | null,
  target: string,
): boolean {
  if (harnessCount !== 0 || versions.length !== 0 || pin === null || !/^\d+\.\d+\.\d+$/.test(pin))
    return false;
  const pinned = parseSemver(pin);
  const release = parseSemver(target);
  return pinned !== null && release !== null && compareSemver(pinned, release) <= 0;
}

/** Moved to reader-core so every surface reads versions the same way. */
export { harnessVersionRel, parseAidlcVersionSource, readAllWorkspaceAidlcVersions };
export type { WorkspaceAidlcVersion };

const UPSTREAM_SHA_RE = /^[0-9a-f]{7,40}$/;

export const UPDATE_WORKFLOWS_COMMAND = "andon.updateWorkflows";
export const OFFICIAL_DOCS_MANIFEST_REL = path.join("docs", "official-docs.manifest.json");

/** Native releases no longer carry dist/ in the source archive used by our copy updater. */
export function requiresNativeInstaller(pin: string): boolean {
  const version = parseSemver(pin);
  return version !== null && (version.major > 2 || (version.major === 2 && version.minor >= 8));
}

export type PinnedManifest = {
  version: string;
  upstreamSha: string | null;
};

/** The manifest's `upstreamSha`, normalised, or null when it is absent or malformed. */
export function parseUpstreamSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return UPSTREAM_SHA_RE.test(trimmed) ? trimmed : null;
}

/**
 * `sourceVersion` is the upstream `AIDLC_VERSION`, bumped on every upstream
 * commit; release tags only exist for milestones, so most pins have no tag of
 * their own. `upstreamSha` identifies the exact snapshotted tree, and the
 * updater prefers it when fetching the archive.
 */
export function parsePinnedManifestInfo(json: string): PinnedManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const sourceVersion = record.sourceVersion;
  if (typeof sourceVersion !== "string" || sourceVersion.trim() === "") return null;
  const trimmed = sourceVersion.trim();
  if (parseSemver(trimmed) === null) return null;
  return { version: trimmed, upstreamSha: parseUpstreamSha(record.upstreamSha) };
}

/** Read the packaged docs manifest; null when it is missing or unparseable. */
export function readPinnedManifestInfo(docsRoot: string): PinnedManifest | null {
  const file = path.join(docsRoot, OFFICIAL_DOCS_MANIFEST_REL);
  if (!existsSync(file)) return null;
  try {
    return parsePinnedManifestInfo(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function readWorkspaceAidlcVersion(workspaceRoot: string): WorkspaceAidlcVersion {
  const all = readAllWorkspaceAidlcVersions(workspaceRoot);
  if (all.length === 0) return { version: null, sourcePath: null, raw: null };
  const unparseable = all.find((item) => item.version === null);
  if (unparseable !== undefined) return unparseable;
  let oldest = all[0];
  if (oldest === undefined) return { version: null, sourcePath: null, raw: null };
  for (const item of all.slice(1)) {
    if (item.version === null || oldest.version === null) continue;
    const candidate = parseSemver(item.version);
    const current = parseSemver(oldest.version);
    if (candidate !== null && current !== null && compareSemver(candidate, current) < 0) {
      oldest = item;
    }
  }
  return oldest;
}
