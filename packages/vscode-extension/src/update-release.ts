/** GitHub Releases lookup for the sideloaded Andon VSIX. */

export const RELEASES_LATEST_URL =
  "https://api.github.com/repos/otomatty/andon-for-aidlc/releases/latest";

export const UPDATE_USER_AGENT = "aidlc-guide";

export const RELEASE_FETCH_TIMEOUT_MS = 15_000;
export const VSIX_FETCH_TIMEOUT_MS = 60_000;

const TAG_RE = /^[vV]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
};

export type LatestRelease = {
  /** Semver without a leading `v`, e.g. `0.2.0`. */
  version: string;
  /** Published git tag, e.g. `v0.2.0`. */
  tag: string;
  assetName: string;
  /** Changes listed in the release body, shown before the user confirms. */
  notes: string[];
  /**
   * Where {@link RELEASE_METADATA_ASSET} downloads from; absent on releases made
   * before it, and null when the asset is listed without a usable URL (one
   * outside this repository's releases is never fetched).
   */
  metadataUrl?: string | null;
};

/**
 * Attached to every release next to the VSIX: which aidlc-workflows release the
 * Guide inside supports. The update dialog warns before installing a Guide that
 * would block the current project until it is updated (version-gate-design.md).
 */
export const RELEASE_METADATA_ASSET = "aidlc-guide-release.json";

export type ReleaseMetadata = { version: string; workflowsTarget: string };

/**
 * What reading the metadata asset gave: the metadata, "absent" for a release
 * that lists no asset (made before it existed), or "unreadable" when the asset
 * is listed but could not be read or is not this release's.
 */
export type ReleaseMetadataRead = ReleaseMetadata | "absent" | "unreadable";

/** A supported-release move to report, "unverified" when it could not be checked, or null. */
export type WorkflowsChange = { from: string; to: string } | "unverified" | null;

const DOWNLOAD_PREFIX = "https://github.com/otomatty/andon-for-aidlc/releases/download/";
const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseReleaseMetadata(body: unknown): ReleaseMetadata | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  const { version, workflowsTarget } = record;
  if (typeof version !== "string" || parseSemver(version) === null) return null;
  if (typeof workflowsTarget !== "string" || !STRICT_VERSION.test(workflowsTarget)) return null;
  return { version, workflowsTarget };
}

/** The supported-release move a new Guide would bring, or null when there is none to report. */
export function releaseWorkflowsChange(
  currentTarget: string,
  metadata: ReleaseMetadataRead,
): WorkflowsChange {
  if (metadata === "absent") return null;
  if (metadata === "unreadable") return "unverified";
  if (metadata.workflowsTarget === currentTarget) return null;
  return { from: currentTarget, to: metadata.workflowsTarget };
}

export type ReleaseParseError =
  | "invalid-json"
  | "invalid-tag"
  | "missing-asset"
  | "draft-or-prerelease";

export type ReleaseParseResult =
  | { ok: true; value: LatestRelease }
  | { ok: false; reason: ReleaseParseError };

export type UpdateDecision =
  | { kind: "up-to-date"; current: string; latest: string }
  | { kind: "available"; current: string; latest: LatestRelease }
  | { kind: "invalid-current"; current: string };

export function parseSemver(input: string): Semver | null {
  const raw = stripVersionPrefix(input);
  const match = SEMVER_RE.exec(raw);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

export function compareSemver(left: Semver, right: Semver): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === "") return 1;
  if (right.prerelease === "") return -1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function vsixAssetName(version: string): string {
  return `aidlc-guide-${version}.vsix`;
}

export function vsixDownloadUrl(release: LatestRelease): string {
  return `https://github.com/otomatty/andon-for-aidlc/releases/download/${release.tag}/${release.assetName}`;
}

export function isVsixBuffer(bytes: Uint8Array): boolean {
  return bytes.length >= 100 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function parseLatestRelease(body: unknown): ReleaseParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "invalid-json" };
  }
  const record = body as Record<string, unknown>;
  if (record.draft === true || record.prerelease === true) {
    return { ok: false, reason: "draft-or-prerelease" };
  }
  const parsedTag = parseReleaseTag(record.tag_name);
  if (parsedTag === null) {
    return { ok: false, reason: "invalid-tag" };
  }
  if (!Array.isArray(record.assets)) {
    return { ok: false, reason: "missing-asset" };
  }
  const expected = vsixAssetName(parsedTag.version);
  const hasAsset = record.assets.some(
    (asset) =>
      typeof asset === "object" &&
      asset !== null &&
      (asset as Record<string, unknown>).name === expected,
  );
  if (!hasAsset) {
    return { ok: false, reason: "missing-asset" };
  }
  const listed = record.assets.find(
    (asset): asset is Record<string, unknown> =>
      typeof asset === "object" &&
      asset !== null &&
      (asset as Record<string, unknown>).name === RELEASE_METADATA_ASSET,
  );
  const url = listed?.browser_download_url;
  return {
    ok: true,
    value: {
      version: parsedTag.version,
      tag: parsedTag.tag,
      assetName: expected,
      notes: releaseNoteItems(record.body),
      // Only this repository's own release downloads; never a URL the API body points elsewhere.
      ...(listed === undefined
        ? {}
        : {
            metadataUrl: typeof url === "string" && url.startsWith(DOWNLOAD_PREFIX) ? url : null,
          }),
    },
  };
}

const NOTE_MAX = 120;
/** A top-level Markdown bullet; nested bullets are details, not changes. */
const BULLET_RE = /^[*-]\s+(.*)$/;
const AUTHOR_RE = /\s+by\s+@[\w-]+(?:\[bot\])?\s+in\s+https?:\/\/\S+$/i;
const LINK_RE = /\s+in\s+https?:\/\/\S+$/i;
const COMMIT_PREFIX_RE =
  /^(?:feat|fix|perf|refactor|docs|chore|ci|build|test|style|revert)(?:\([^)]*\))?!?:\s*/i;

/**
 * The change list of a release body. GitHub's generated notes list each pull
 * request as `* <title> by @<author> in <url>` under "What's Changed"; the
 * titles here follow conventional commits, so the author, link and `feat:`
 * style prefix are dropped. A hand-written body falls back to its top-level
 * bullets. Anything else yields no items rather than guessed text.
 */
export function releaseNoteItems(body: unknown): string[] {
  if (typeof body !== "string") return [];
  const lines = body.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+What's Changed\s*$/i.test(line.trim()));
  // Text given when the release is made comes before the generated list, so
  // its points are read first; the generated list ends at the next heading.
  const section =
    heading === -1
      ? lines
      : [...lines.slice(0, heading), ...untilNextHeading(lines.slice(heading + 1))];
  const items: string[] = [];
  for (const line of section) {
    const bullet = BULLET_RE.exec(line)?.[1]?.trim();
    if (bullet === undefined || /made their first contribution/i.test(bullet)) continue;
    let text = bullet.replace(AUTHOR_RE, "").replace(LINK_RE, "").replace(COMMIT_PREFIX_RE, "");
    text = text.trim();
    if (text === "") continue;
    if (text.length > NOTE_MAX) text = `${text.slice(0, NOTE_MAX - 1)}…`;
    if (!items.includes(text)) items.push(text);
  }
  return items;
}

function untilNextHeading(lines: string[]): string[] {
  const end = lines.findIndex((line) => /^#{1,2}\s/.test(line));
  return end === -1 ? lines : lines.slice(0, end);
}

export function decideUpdate(current: string, latest: LatestRelease): UpdateDecision {
  const currentSemver = parseSemver(current);
  if (currentSemver === null) {
    return { kind: "invalid-current", current };
  }
  const latestSemver = parseSemver(latest.version);
  if (latestSemver === null) {
    return { kind: "invalid-current", current };
  }
  if (compareSemver(latestSemver, currentSemver) > 0) {
    return { kind: "available", current, latest };
  }
  return { kind: "up-to-date", current, latest: latest.version };
}

function parseReleaseTag(tag: unknown): { tag: string; version: string } | null {
  if (typeof tag !== "string" || !TAG_RE.test(tag)) return null;
  const version = stripVersionPrefix(tag);
  if (parseSemver(version) === null) return null;
  return { tag, version };
}

function stripVersionPrefix(input: string): string {
  return input.startsWith("v") || input.startsWith("V") ? input.slice(1) : input;
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = NUMERIC_IDENT.test(leftPart);
    const rightNumeric = NUMERIC_IDENT.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const compared = Number(leftPart) - Number(rightPart);
      if (compared !== 0) return compared;
      continue;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

const NUMERIC_IDENT = /^\d+$/;
