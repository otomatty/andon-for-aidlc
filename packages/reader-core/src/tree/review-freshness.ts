import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import path from "node:path";
import { canonicalPath } from "@andon/core-utils";

/**
 * Read-only projection of aidlc-workflows v2.8.2 (355903d), core/tools/aidlc-lib.ts:
 * reviewArtifactContentsFingerprint, workspaceSourceState and unitSourceFingerprint,
 * with the v2.11.0 source boundary (hard-excluded caches and byproduct files,
 * root settings, .NET outputs, sameWorkspaceSource aliases), the v2.11.1
 * additions (committed text read with CRLF as LF and its raw-bytes alias,
 * .codegraph/.idea/DerivedData, dependency folders beside their manifest, the
 * registry's `exclude` list) and Guard Policy resolution (resolveGuardPolicy).
 * Never imports or executes an installed engine. Unknown inputs fail closed.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
// v2.11.1 SOURCE_FINGERPRINT_HARD_EXCLUDED_NAMES (.codegraph, .idea and
// DerivedData are new there, with no earlier-walk alias).
const HARD = new Set([
  ".cache",
  ".codegraph",
  ".git",
  ".gradle",
  ".idea",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  ".vs",
  "DerivedData",
  "__pycache__",
  "node_modules",
  "venv",
]);
const GENERATED = new Set(["build", "coverage", "dist", "logs", "target", "tmp"]);
// v2.11.0 SOURCE_FINGERPRINT_HARD_EXCLUDED_FILES / _EDITOR_ARTIFACT_RE: OS,
// coverage and editor byproducts nobody authored. The range stops at m so a
// real `.swf` asset stays source.
const EXCLUDED_FILES = new Set([".DS_Store", ".coverage", "Thumbs.db", "desktop.ini"]);
const EDITOR_ARTIFACT = /(?:\.sw[m-p]|~)$/;
const excludedFile = (name: string) =>
  EXCLUDED_FILES.has(name) || name.startsWith(".coverage.") || EDITOR_ARTIFACT.test(name);
// v2.11.0 AIDLC_ROOT_SETTINGS_FILES: AI-DLC's own settings beside the shell.
const ROOT_SETTINGS = new Set(["aidlc.settings.json", "aidlc.settings.local.json"]);
// v2.11.0 SOURCE_FINGERPRINT_DOTNET_OUTPUT_NAMES: conditional only beside a project file.
const DOTNET_OUTPUTS = new Set(["bin", "obj", "out"]);
const DOTNET_PROJECT = /\.(?:cs|fs|vb)proj$/i;
// v2.11.1 SOURCE_FINGERPRINT_MANIFEST_DEPENDENCY_DIRS: the directories a package
// manager fills beside the manifest it reads, conditional only in that
// directory, with no earlier-walk alias.
const MANIFEST_DEPENDENCIES: ReadonlyMap<string, readonly string[]> = new Map([
  ["composer.json", ["vendor"]],
  ["go.mod", ["vendor"]],
  ["Podfile", ["Pods"]],
  ["mix.exs", ["deps", "_build"]],
  ["pubspec.yaml", [".dart_tool"]],
  ["bower.json", ["bower_components"]],
  ["Gemfile", [".bundle"]],
  ["stack.yaml", [".stack-work"]],
]);
const manifestDependencyDirs = (names: readonly string[]) =>
  new Set(names.flatMap((name) => MANIFEST_DEPENDENCIES.get(name) ?? []));
// v2.11.1 SOURCE_FINGERPRINT_REGISTRY and its size and list limits.
const REGISTRY = ".aidlc-source-paths.json";
const REGISTRY_MAX_BYTES = 1024 * 1024;
const REGISTRY_MAX_ENTRIES = 10_000;
// v2.11.0 legacyMaxFiles / legacyMaxBytes: past these the earlier value is dropped.
const LEGACY_MAX_FILES = 10_000;
const LEGACY_MAX_BYTES = 256 * 1024 * 1024;
const KINDS = new Set(["service", "spec", "ui", "packaging", "library"]);
const FILENAMES: Readonly<Record<string, string>> = {
  "build-test-results": "test-results.md",
  "load-test-results": "test-results.md",
  traceability: "traceability.json",
};
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * v2.11.1 committedTextBytes / committedTextParts: CRLF reads as LF only for a
 * file Git itself would convert. A NUL, a lone CR, or more than one control
 * byte per 128 printable ones (a trailing 0x1A not counted) keeps the raw
 * bytes. Returns the same Buffer when the reading does not apply.
 */
function committedText(bytes: Buffer): Buffer {
  if (!bytes.includes(13)) return bytes;
  const parts: Buffer[] = [];
  let printable = 0;
  let nonprintable = 0;
  let start = 0;
  for (let at = 0; at < bytes.length; at++) {
    const byte = bytes[at] as number;
    if (byte === 13) {
      // Every CR here is part of a CRLF, so the text holds at least one.
      if (bytes[at + 1] !== 10) return bytes;
      parts.push(bytes.subarray(start, at));
      start = at + 1;
      at++;
    } else if (byte === 0) {
      return bytes;
    } else if (
      byte === 127 ||
      (byte < 32 && byte !== 10 && byte !== 8 && byte !== 9 && byte !== 27 && byte !== 12)
    ) {
      nonprintable++;
    } else if (byte !== 10) {
      printable++;
    }
  }
  parts.push(bytes.subarray(start));
  if (bytes.at(-1) === 26) nonprintable--;
  return printable >> 7 >= nonprintable ? Buffer.concat(parts) : bytes;
}

/**
 * A fingerprint as v2.11.1 computes it, and the raw-bytes form recorded before
 * line endings were read as LF when that differs (rememberRawFingerprint).
 */
type Forms = { current: string; raw: string | null };
/** v2.11.1 currentFingerprintForm: a recorded value in either form matches. */
const matchesForms = (recorded: string | undefined, forms: Forms) =>
  recorded === forms.current || (forms.raw !== null && recorded === forms.raw);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const segment = (value: unknown): value is string =>
  typeof value === "string" && SEGMENT.test(value);
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
};
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;

/** A per-build IO budget and identity check, with no file bodies retained. */
class Snapshot {
  private bytes = 0;
  private entries = 0;
  private identities = new Map<string, BigIntStats | null>();
  constructor(readonly root: string) {}

  async inspect(relative: string): Promise<BigIntStats | "missing" | null> {
    const target = path.resolve(this.root, relative);
    if (!inside(this.root, target)) return null;
    let cursor = this.root;
    try {
      for (const part of path.relative(this.root, target).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        const stat = await lstat(cursor, { bigint: true });
        if (stat.isSymbolicLink()) return null;
        const previous = this.identities.get(cursor);
        if (previous !== undefined && (previous === null || !same(previous, stat))) return null;
        this.identities.set(cursor, stat);
      }
      if (!inside(this.root, await canonicalPath(target))) return null;
      const stat = await lstat(target, { bigint: true });
      const previous = this.identities.get(target);
      if (previous !== undefined && (previous === null || !same(previous, stat))) return null;
      this.identities.set(target, stat);
      return stat;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") return null;
      if (this.identities.get(cursor)) return null;
      this.identities.set(cursor, null);
      return "missing";
    }
  }

  async read(relative: string, max = MAX_FILE): Promise<Buffer | "missing" | "not-file" | null> {
    const before = await this.inspect(relative);
    if (before === null || before === "missing") return before;
    if (!before.isFile()) return "not-file";
    if (before.nlink !== 1n || before.size > BigInt(max)) return null;
    this.bytes += Number(before.size);
    if (this.bytes > MAX_BYTES) return null;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        path.join(this.root, relative),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
      if (!same(before, await handle.stat({ bigint: true }))) return null;
      const buffer = Buffer.alloc(Number(before.size) + 1);
      let count = 0;
      while (count < buffer.length) {
        const read = await handle.read(buffer, count, buffer.length - count, count);
        if (read.bytesRead === 0) break;
        count += read.bytesRead;
      }
      if (count !== Number(before.size) || !same(before, await handle.stat({ bigint: true })))
        return null;
      return buffer.subarray(0, count);
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async list(relative: string): Promise<string[] | null> {
    const stat = await this.inspect(relative);
    if (stat === null || stat === "missing" || !stat.isDirectory()) return null;
    try {
      const names: string[] = [];
      const dir = await opendir(path.join(this.root, relative));
      for await (const entry of dir) {
        if (++this.entries > MAX_ENTRIES) return null;
        names.push(entry.name);
      }
      return names.sort();
    } catch {
      return null;
    }
  }

  async stable(): Promise<boolean> {
    for (const [file, before] of this.identities) {
      try {
        const after = await lstat(file, { bigint: true });
        if (before === null || !same(before, after)) return false;
      } catch (error) {
        if (before !== null || (error as { code?: string }).code !== "ENOENT") return false;
      }
    }
    return true;
  }
}

async function json(snapshot: Snapshot, relative: string): Promise<unknown> {
  const bytes = await snapshot.read(relative);
  if (bytes === "missing") return undefined;
  if (!Buffer.isBuffer(bytes)) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

export interface ReviewArtifactStage {
  slug: string;
  phase: string;
  for_each?: string;
  produces: string[];
  optional_produces?: string[];
  produces_kinds?: Record<string, string[]>;
  review_artifact: string;
  workspace_requires?: boolean;
}

function stageDefinition(value: unknown): ReviewArtifactStage | null {
  if (
    !object(value) ||
    !segment(value.slug) ||
    !segment(value.phase) ||
    !segment(value.review_artifact)
  )
    return null;
  for (const field of ["produces", "optional_produces"]) {
    const names = value[field];
    if (names === undefined && field === "optional_produces") continue;
    if (!Array.isArray(names) || !names.every(segment) || new Set(names).size !== names.length)
      return null;
  }
  if (!(value.produces as string[]).includes(value.review_artifact)) return null;
  if (
    value.produces_kinds !== undefined &&
    (!object(value.produces_kinds) ||
      !Object.entries(value.produces_kinds).every(
        ([name, kinds]) =>
          segment(name) &&
          Array.isArray(kinds) &&
          kinds.every((kind) => typeof kind === "string" && KINDS.has(kind)),
      ))
  )
    return null;
  if (value.workspace_requires !== undefined && typeof value.workspace_requires !== "boolean")
    return null;
  return {
    slug: value.slug,
    phase: value.phase,
    review_artifact: value.review_artifact,
    produces: value.produces as string[],
    ...(value.for_each === undefined ? {} : { for_each: String(value.for_each) }),
    ...(value.optional_produces === undefined
      ? {}
      : { optional_produces: value.optional_produces as string[] }),
    ...(value.produces_kinds === undefined
      ? {}
      : { produces_kinds: value.produces_kinds as Record<string, string[]> }),
    ...(value.workspace_requires === undefined
      ? {}
      : { workspace_requires: value.workspace_requires as boolean }),
  };
}

async function artifacts(
  snapshot: Snapshot,
  record: string,
  stage: ReviewArtifactStage,
  unit: string,
  kind: string | null,
): Promise<Forms | null> {
  if (!segment(unit) || stage.for_each !== "unit-of-work" || stage.phase !== "construction")
    return null;
  const names = [...stage.produces, ...(stage.optional_produces ?? [])].filter(
    (name) =>
      kind === null ||
      stage.produces_kinds?.[name] === undefined ||
      stage.produces_kinds[name]?.includes(kind),
  );
  const entries = names
    .map((name) => ({
      name,
      logical: `construction/${unit}/${stage.slug}/${FILENAMES[name] ?? `${name}.md`}`,
    }))
    .sort((a, b) => a.logical.localeCompare(b.logical));
  const manifest: [string, string][] = [];
  // v2.11.1: the same manifest over raw bytes, as recorded before 2.11.1.
  const rawManifest: [string, string][] = [];
  let rawDiffers = false;
  let targetFound = false;
  for (const entry of entries) {
    const bytes = await snapshot.read(record ? `${record}/${entry.logical}` : entry.logical);
    if (bytes === null) return null;
    if (!Buffer.isBuffer(bytes)) {
      manifest.push([entry.logical, bytes]);
      rawManifest.push([entry.logical, bytes]);
      continue;
    }
    if (entry.name === stage.review_artifact) targetFound = true;
    const text = committedText(bytes);
    if (text !== bytes) rawDiffers = true;
    manifest.push([entry.logical, `sha256:${hash(text)}`]);
    rawManifest.push([entry.logical, `sha256:${hash(bytes)}`]);
  }
  if (!targetFound) return null;
  return {
    current: `sha256:${hash(JSON.stringify(manifest))}`,
    raw: rawDiffers ? `sha256:${hash(JSON.stringify(rawManifest))}` : null,
  };
}

/** Useful independently for callers that already resolved a stage and unit kind. */
export async function currentReviewArtifactFingerprint(
  recordDir: string,
  definition: ReviewArtifactStage,
  unit: string,
  kind: string | null = null,
): Promise<string | null> {
  const stage = stageDefinition(definition);
  if (stage === null || (kind !== null && !KINDS.has(kind))) return null;
  try {
    const snapshot = new Snapshot(await canonicalPath(recordDir));
    const result = await artifacts(snapshot, "", stage, unit, kind);
    return (await snapshot.stable()) ? (result?.current ?? null) : null;
  } catch {
    return null;
  }
}

function visibleLines(text: string): string[] | null {
  let fence: { character: string; length: number } | null = null;
  let comment = false;
  let ambiguous = false;
  const result = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (fence) {
        const closing = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1];
        if (closing?.[0] === fence.character && closing.length >= fence.length) fence = null;
        return "";
      }
      if (!comment) {
        const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (opening) {
          fence = { character: opening[0] as string, length: opening.length };
          return "";
        }
        if (/^(?: {4}|\t)/.test(line)) return "";
      }
      let visible = "";
      let offset = 0;
      while (offset < line.length) {
        if (comment) {
          const end = line.indexOf("-->", offset);
          if (end < 0) break;
          comment = false;
          offset = end + 3;
        } else {
          const start = line.indexOf("<!--", offset);
          const tick = line.indexOf("`", offset);
          if (tick >= 0 && (start < 0 || tick < start)) {
            visible += line.slice(offset, tick);
            const delimiter = /^`+/.exec(line.slice(tick))?.[0] as string;
            const rest = line.slice(tick + delimiter.length);
            const closing = [...rest.matchAll(/`+/g)].find(
              (match) => match[0].length === delimiter.length,
            );
            // Multiline code spans need a full Markdown parser. Never let an
            // uncertain literal context weaken a governing strict declaration.
            if (closing === undefined) {
              ambiguous = true;
              return "";
            }
            offset = tick + delimiter.length + closing.index + delimiter.length;
            visible += line.slice(tick, offset);
            continue;
          }
          if (start < 0) {
            visible += line.slice(offset);
            break;
          }
          visible += line.slice(offset, start);
          comment = true;
          offset = start + 4;
        }
      }
      return visible;
    });
  return ambiguous ? null : result;
}

type GuardPolicy = "strict" | "relaxed" | "off";

// v2.11.0 GUARD_POLICY_STATE_LINE_RE and changeControlSourceFromLabel.
const STATE_LINE = /^(strict|relaxed|off)\b(?:\s*\((.*)\))?\s*$/i;
function stateLine(raw: string): { value: GuardPolicy; source: string } | null {
  const match = STATE_LINE.exec(raw.trim());
  if (!match) return null;
  const label = (match[2] ?? "").trim();
  const source =
    label === "set by you" || label === "you"
      ? "you"
      : label === "set by a command"
        ? "command"
        : (/^from\s+(.+)$/.exec(label)?.[1]?.trim() ?? (label || "you"));
  return { value: (match[1] as string).toLowerCase() as GuardPolicy, source };
}

/**
 * v2.11.0 memoryGuardPolicyDeclarations: the Guard Policy mode each memory
 * layer declares, org then team then project. `null` when one cannot be read
 * or names an unknown mode (a validation error upstream).
 */
async function memoryLayers(snapshot: Snapshot, memory: string): Promise<GuardPolicy[] | null> {
  const layers: GuardPolicy[] = [];
  for (const layer of ["org", "team", "project"]) {
    const bytes = await snapshot.read(`${memory}/${layer}.md`);
    if (bytes === "missing") continue;
    if (!Buffer.isBuffer(bytes)) return null;
    const lines = visibleLines(bytes.toString("utf8"));
    if (lines === null) return null;
    for (const heading of ["## Guard Policy", "## Change Control"]) {
      if (lines.filter((line) => line.trimEnd() === heading).length > 1) return null;
      const start = lines.findIndex((line) => line.trimEnd() === heading);
      if (start < 0) continue;
      const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
      const section = lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
      const settings = [
        ...section.matchAll(
          /^([ \t]*)(?:[-*][ \t]*)?(?:\*\*)?Mode(?:\*\*)?[ \t]*:[ \t]*(.*?)[ \t]*$/gim,
        ),
      ];
      if (settings.length > 1) return null;
      const field = settings[0];
      if (!field) continue;
      const parts = [field[2]?.trim() ?? ""];
      const tail = section
        .slice((field.index ?? 0) + field[0].length)
        .split("\n")
        .slice(1);
      for (const line of tail) {
        if (!line.trim() || (line.match(/^[ \t]*/)?.[0].length ?? 0) <= (field[1]?.length ?? 0))
          break;
        if (
          /^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|[>#|]|```|~~~|(?:\*\*)?(?:Mode|Methodology|Ordering)(?:\*\*)?[ \t]*:)/i.test(
            line,
          )
        )
          break;
        parts.push(line.trim());
      }
      const setting = parts.filter(Boolean).join(" ");
      if (!setting) continue;
      const parsed = setting.toLowerCase().replace(/[`*_]/g, "").trim();
      if (parsed !== "strict" && parsed !== "relaxed" && parsed !== "off") return null;
      layers.push(parsed);
      break;
    }
  }
  return layers;
}

/**
 * v2.11.0 resolveGuardPolicy: the intent's own valid state line, else strict;
 * disagreeing Guard Policy / Change Control lines are strict. Any memory
 * layer's strict wins; otherwise the narrowest layer's relaxed or off replaces
 * a value that came from the scope (`from scope …`) or is not set. A value the
 * engine would refuse to read is `null`, which callers treat as unknown.
 */
async function mode(
  snapshot: Snapshot,
  record: string,
  memory: string,
): Promise<GuardPolicy | null> {
  const state = await snapshot.read(`${record}/aidlc-state.md`);
  if (!Buffer.isBuffer(state)) return null;
  // State fields use the engine's raw getField grammar, unlike memory sections:
  // exactly "- **Field**:" at column zero, including lines inside fences.
  const declarations = [
    ...state.toString("utf8").matchAll(/^- \*\*(Guard Policy|Change Control)\*\*:[ \t]*(.*)$/gm),
  ];
  if (new Set(declarations.map((d) => d[1])).size !== declarations.length) return null;
  const raw = (field: string) => declarations.find((d) => d[1] === field)?.[2];
  const modern = raw("Guard Policy");
  const retired = raw("Change Control");
  const intent = stateLine(modern ?? retired ?? "");
  const conflict =
    modern !== undefined &&
    retired !== undefined &&
    (intent === null || stateLine(retired)?.value !== intent.value);
  // A lone malformed line is a validation error upstream.
  if ((modern ?? retired) !== undefined && intent === null && !conflict) return null;
  const stateValue: GuardPolicy = conflict ? "strict" : (intent?.value ?? "strict");
  const layers = await memoryLayers(snapshot, memory);
  if (layers === null) return null;
  if (layers.includes("strict")) return "strict";
  const narrowest = layers.at(-1);
  if (
    narrowest !== undefined &&
    !conflict &&
    (intent === null || intent.source.startsWith("scope "))
  )
    return narrowest;
  return stateValue;
}

/**
 * Whether a review receipt still describes the current workspace. `acceptsChanges`
 * is v2.11.0 `guardPolicyAcceptsChanges`: the resolved Guard Policy is relaxed
 * or off (an unreadable policy counts as strict).
 */
export type ReviewFreshnessReader = ((
  fields: Readonly<Record<string, string>>,
) => Promise<boolean>) & {
  readonly acceptsChanges: boolean;
};

const reader = (
  check: (fields: Readonly<Record<string, string>>) => Promise<boolean>,
  acceptsChanges: boolean,
): ReviewFreshnessReader => Object.assign(check, { acceptsChanges });

// No process-wide cache: every matrix build observes fresh metadata and bytes.
/** `<project>/aidlc/spaces/<space>/intents/<intent>`, or null for any other path. */
function workspaceLayout(
  recordDir: string,
): { project: string; record: string; space: string; intent: string } | null {
  const resolved = path.resolve(recordDir);
  const parts = resolved.split(path.sep);
  const marker = parts.length - 5;
  if (
    parts[marker] !== "aidlc" ||
    parts[marker + 1] !== "spaces" ||
    parts[marker + 3] !== "intents"
  )
    return null;
  if (!segment(parts[marker + 2]) || !segment(parts[marker + 4])) return null;
  const project = parts.slice(0, marker).join(path.sep) || path.parse(resolved).root;
  return {
    project,
    record: path.relative(project, resolved).split(path.sep).join("/"),
    space: `aidlc/spaces/${parts[marker + 2]}`,
    intent: parts[marker + 4] as string,
  };
}

/**
 * v2.11.0 aidlc-guard-switch.ts `resolvePlanApprovalSetting`'s lock: a memory
 * layer that declares Guard Policy strict keeps plan approval on. Memory that
 * cannot be read keeps it on too; a record outside the workspace layout has
 * no memory to read.
 */
export async function memoryHoldsGuardPolicyStrict(recordDir: string): Promise<boolean> {
  const layout = workspaceLayout(recordDir);
  if (layout === null) return false;
  try {
    const layers = await memoryLayers(
      new Snapshot(await canonicalPath(layout.project)),
      `${layout.space}/memory`,
    );
    return layers === null || layers.includes("strict");
  } catch {
    return true;
  }
}

export async function createReviewFreshnessReader(
  recordDir: string,
): Promise<ReviewFreshnessReader> {
  const deny = reader(async () => false, false);
  const layout = workspaceLayout(recordDir);
  if (layout === null) return deny;
  const { project, record, space } = layout;
  try {
    const root = await canonicalPath(project);
    const snapshot = new Snapshot(root);
    const control = await mode(snapshot, record, `${space}/memory`);
    if (control === null) return deny;
    if (control !== "strict") return reader(async () => snapshot.stable(), true);
    const definitions = loadDefinitions(snapshot);
    const unitKinds = loadUnitKinds(snapshot, record);
    let source: Promise<SourceState | null> | undefined;
    return reader(async (fields) => {
      const unit = fields.Unit;
      const slug = fields.Stage;
      if (!segment(unit) || !segment(slug) || !HASH.test(fields["Artifact Fingerprint"] ?? ""))
        return false;
      const graph = await definitions;
      const stage = graph?.get(slug);
      if (!stage) return false;
      const kinds = await unitKinds;
      if (kinds === null && stage.produces_kinds !== undefined) return false;
      const current = await artifacts(snapshot, record, stage, unit, kinds?.get(unit) ?? null);
      if (current === null || !matchesForms(fields["Artifact Fingerprint"], current)) return false;
      if (
        stage.workspace_requires ||
        fields["Source Fingerprint"] ||
        fields["Unit Source Fingerprint"]
      ) {
        source ??= workspaceSource(snapshot, space, layout.intent);
        const currentSource = await source;
        if (
          currentSource === null ||
          !(await sameWorkspaceSource(fields["Source Fingerprint"], currentSource))
        )
          return false;
        const unitFingerprint = await unitSource(snapshot, record, stage.slug, unit, currentSource);
        if (
          unitFingerprint === null ||
          !matchesForms(fields["Unit Source Fingerprint"], unitFingerprint)
        )
          return false;
      }
      return snapshot.stable();
    }, false);
  } catch {
    return deny;
  }
}

async function loadDefinitions(
  snapshot: Snapshot,
): Promise<Map<string, ReviewArtifactStage> | null> {
  const names = await snapshot.list("");
  if (names === null) return null;
  const graph = new Map<string, ReviewArtifactStage>();
  for (const name of names.filter(
    (name) => !HARD.has(name) && /^\.[a-z0-9][a-z0-9._-]*$/i.test(name),
  )) {
    const info = await snapshot.inspect(name);
    if (info === null || info === "missing") return null;
    if (!info.isDirectory()) continue;
    const raw = await json(snapshot, `${name}/tools/data/stage-graph.json`);
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) return null;
    for (const value of raw) {
      if (!object(value) || value.phase !== "construction" || value.review_artifact === undefined)
        continue;
      const stage = stageDefinition(value);
      if (stage === null) return null;
      const prior = graph.get(stage.slug);
      if (prior && JSON.stringify(prior) !== JSON.stringify(stage)) return null;
      graph.set(stage.slug, stage);
    }
  }
  return graph;
}

/** Restrict authored YAML to the ordinary form; unfamiliar syntax is unknown. */
// v2.8.2 unquoteScalar removes matching outer quotes without YAML unescaping.
// Validate the resulting names/kinds below before using them.
function unitScalar(raw: string): string {
  const value = raw.trim();
  return /^("[\s\S]*"|'[\s\S]*')$/.test(value) ? value.slice(1, -1) : value;
}

async function loadUnitKinds(
  snapshot: Snapshot,
  record: string,
): Promise<Map<string, string> | null> {
  const bytes = await snapshot.read(
    `${record}/inception/units-generation/unit-of-work-dependency.md`,
  );
  if (bytes === "missing") {
    const runtime = await json(snapshot, `${record}/runtime-graph.json`);
    if (runtime === undefined) return new Map();
    if (!object(runtime)) return null;
    if (runtime.bolt_dag === undefined) return new Map();
    if (
      !object(runtime.bolt_dag) ||
      !Array.isArray(runtime.bolt_dag.units) ||
      !Array.isArray(runtime.bolt_dag.batches)
    )
      return null;
    const names = runtime.bolt_dag.batches.flat();
    if (!names.every(segment) || new Set(names).size !== names.length) return null;
    const kinds = new Map<string, string>();
    for (const row of runtime.bolt_dag.units) {
      if (!object(row) || !segment(row.name) || !names.includes(row.name)) return null;
      if (row.kind !== undefined) {
        if (typeof row.kind !== "string" || !KINDS.has(row.kind) || kinds.has(row.name))
          return null;
        kinds.set(row.name, row.kind);
      }
    }
    return kinds;
  }
  if (!Buffer.isBuffer(bytes)) return null;
  const blocks = [
    ...bytes.toString("utf8").matchAll(/^[ \t]*```ya?ml\s*\r?\n([\s\S]*?)^[ \t]*```\s*$/gm),
  ];
  const block = blocks.find((match) => /^\s*units\s*:/m.test(match[1] ?? ""))?.[1];
  if (block === undefined) return null;
  const rows = new Map<string, { kind?: string; deps: string[] }>();
  let row: { kind?: string; deps: string[] } | undefined;
  let started = false;
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!started && /^\s*units\s*:\s*$/.test(line)) {
      started = true;
      continue;
    }
    if (!started) continue;
    const rawName = /^\s*-\s+name\s*:\s*(.+?)\s*$/.exec(line)?.[1];
    if (rawName !== undefined) {
      const name = unitScalar(rawName);
      if (!segment(name) || rows.has(name)) return null;
      row = { deps: [] };
      rows.set(name, row);
      continue;
    }
    if (!row) return null;
    const rawKind = /^\s*kind\s*:\s*(.+?)\s*$/.exec(line)?.[1];
    if (rawKind !== undefined) {
      const kind = unitScalar(rawKind);
      if (!KINDS.has(kind)) return null;
      row.kind = kind;
      continue;
    }
    const deps = /^\s*depends_on\s*:\s*(.*)$/.exec(line)?.[1];
    if (deps !== undefined) {
      const value = deps.trim();
      const inline = /^\[([^\]]*)\][ \t]*(?:#[^\r\n]*)?$/.exec(value);
      if (value.startsWith("[") && !inline) return null;
      // Valid unit names cannot contain commas, brackets or quotes, so splitting
      // before unquoting is sufficient; malformed items remain invalid below.
      row.deps = inline
        ? (inline[1] ?? "").split(",").map(unitScalar).filter(Boolean)
        : value === ""
          ? []
          : [unitScalar(value)];
      if (!row.deps.every(segment)) return null;
      continue;
    }
    const rawDep = /^\s*-\s+(.+?)\s*$/.exec(line)?.[1];
    if (rawDep !== undefined) {
      const dep = unitScalar(rawDep);
      if (!segment(dep)) return null;
      row.deps.push(dep);
      continue;
    }
    return null;
  }
  const pending = new Set(rows.keys());
  if (
    pending.size === 0 ||
    [...rows.values()].some((entry) => entry.deps.some((dep) => !rows.has(dep)))
  )
    return null;
  while (pending.size) {
    const ready = [...pending].filter((name) =>
      rows.get(name)?.deps.every((dep) => !pending.has(dep)),
    );
    if (!ready.length) return null;
    for (const name of ready) pending.delete(name);
  }
  return new Map([...rows].flatMap(([name, entry]) => (entry.kind ? [[name, entry.kind]] : [])));
}

type SourceState = {
  fingerprint: string;
  /** v2.11.1: the fingerprint over raw bytes, when line endings made it differ. */
  raw: string | null;
  listing: Map<string, string>;
  /** v2.11.1 rawFingerprintForm of a listing entry: its raw-bytes entry. */
  rawEntries: Map<string, string>;
  shell: Set<string>;
  /** v2.11.1 registry `exclude` entries, normalized. */
  excludes: readonly string[];
  /** Dependency directories the walk left out beside their manifest. */
  dependencies: Set<string>;
  /** v2.11.0 legacyWorkspaceSourceAliases: the walk before files were excluded by name. */
  legacy: () => Promise<string | null>;
  /** v2.11.0 earlierBoundaryWorkspaceSources: the walk before .NET outputs left. */
  earlier: () => Promise<readonly string[]>;
};
function sensorCache(relative: string): boolean {
  return /(?:^|\/)aidlc\/spaces\/[^/]+\/intents\/(?:.*\/)?(?:\.aidlc-sensors|\.aidlc-engine)(?:\/|$)/.test(
    relative,
  );
}

/** A line only the earlier walk recorded, kept at the index it held there. */
type LegacyEntry =
  | { at: number; rel: string; kind: "file"; executable: boolean; size: bigint }
  | { at: number; rel: string; kind: "pycache"; linked: boolean };

interface SourceWalk {
  lines: string[];
  /** v2.11.1 rawLines: the raw form of a file line, by its index in `lines`. */
  rawLines: Map<number, string>;
  legacy: LegacyEntry[];
  listing: Map<string, string>;
  rawEntries: Map<string, string>;
  dependencies: Set<string>;
  dotnetOutputSeen: boolean;
}

const excludedBy = (excludes: readonly string[], rel: string) =>
  excludes.some((excluded) => rel === excluded || rel.startsWith(`${excluded}/`));

const workspaceDigest = (lines: readonly string[]) =>
  hash(
    `aidlc-workspace-source-v2\nfilesystem=${hash(["aidlc-filesystem-source-v2", ...lines].join("\n"))}`,
  );

/**
 * v2.11.0 filesystemSourceIdentity for one root that carries the workspace
 * shell. `dotnetOutputs` false walks .NET output directories as the walk did
 * before they left the boundary, so old evidence can be compared.
 */
async function walkSource(
  snapshot: Snapshot,
  shell: ReadonlySet<string>,
  dotnetOutputs: boolean,
  excludes: readonly string[],
): Promise<SourceWalk | null> {
  const lines: string[] = [];
  const rawLines = new Map<number, string>();
  const legacy: LegacyEntry[] = [];
  const listing = new Map<string, string>();
  const rawEntries = new Map<string, string>();
  const dependencies = new Set<string>();
  let dotnetOutputSeen = false;
  let earlierFiles = 0;
  let earlierBytes = 0;
  async function walk(relative: string, depth: number, earlierOutput: boolean): Promise<boolean> {
    if (depth > 64) return false;
    const names = await snapshot.list(relative);
    if (names === null) return false;
    const dotnetProject = names.some((name) => DOTNET_PROJECT.test(name));
    const owned = manifestDependencyDirs(names);
    for (const name of names) {
      const rel = relative ? `${relative}/${name}` : name;
      // v2.11.1: the registry's exclude list comes first, whatever the entry is.
      if (excludedBy(excludes, rel) || name === ".git" || sensorCache(rel)) continue;
      // Excluded roots are not traversed, even when installed as symlinks.
      if (!relative && shell.has(name)) continue;
      const dotnetOutput = dotnetProject && DOTNET_OUTPUTS.has(name);
      let earlier = earlierOutput;
      if (HARD.has(name) || GENERATED.has(name) || dotnetOutput || owned.has(name)) {
        const info = await lstat(path.join(snapshot.root, rel)).catch(() => null);
        if (info === null) return false;
        if (info.isDirectory() || info.isSymbolicLink()) {
          if (name === "__pycache__")
            legacy.push({ at: lines.length, rel, kind: "pycache", linked: info.isSymbolicLink() });
          if (HARD.has(name) || GENERATED.has(name)) continue;
          if (owned.has(name)) {
            dependencies.add(rel);
            continue;
          }
          dotnetOutputSeen = true;
          if (dotnetOutputs) continue;
          earlier = true;
        }
      }
      const info = await snapshot.inspect(rel);
      if (info === null || info === "missing") return false;
      if (info.isDirectory()) {
        if (
          (await snapshot.inspect(`${rel}/.git`)) !== "missing" ||
          !(await walk(rel, depth + 1, earlier))
        )
          return false;
      } else if (info.isFile()) {
        const executable = (info.mode & 0o111n) !== 0n;
        if (excludedFile(name) || (!relative && ROOT_SETTINGS.has(name))) {
          legacy.push({ at: lines.length, rel, kind: "file", executable, size: info.size });
          continue;
        }
        if (earlier) {
          // v2.11.0: the earlier walk of .NET outputs stops at the legacy bounds.
          earlierFiles += 1;
          earlierBytes += Number(info.size);
          if (earlierFiles > LEGACY_MAX_FILES || earlierBytes > LEGACY_MAX_BYTES) return false;
        }
        const bytes = await snapshot.read(rel);
        if (!Buffer.isBuffer(bytes)) return false;
        const text = committedText(bytes);
        const sha = hash(text);
        const [flag, mode] = executable ? ["x", "100755"] : ["-", "100644"];
        lines.push(`file:${rel}:${flag}=${sha}`);
        listing.set(rel, `${mode}\t${sha}`);
        if (text !== bytes) {
          const raw = hash(bytes);
          rawLines.set(lines.length - 1, `file:${rel}:${flag}=${raw}`);
          rawEntries.set(`${mode}\t${sha}`, `${mode}\t${raw}`);
        }
      } else return false;
    }
    return true;
  }
  return (await walk("", 0, false))
    ? { lines, rawLines, legacy, listing, rawEntries, dependencies, dotnetOutputSeen }
    : null;
}

/**
 * v2.11.0 legacyFilesystemFingerprint: today's lines with each legacy-only line
 * put back at the index it held. Optional: past the legacy bounds, or when a
 * cache holds anything but flat files, there is no earlier value.
 */
async function legacyFingerprint(snapshot: Snapshot, walked: SourceWalk): Promise<string | null> {
  const inserts: { at: number; line: string }[] = [];
  let files = 0;
  let bytes = 0;
  const add = async (at: number, rel: string, executable: boolean, size: bigint) => {
    files += 1;
    bytes += Number(size);
    if (files > LEGACY_MAX_FILES || bytes > LEGACY_MAX_BYTES) return false;
    const body = await snapshot.read(rel);
    if (!Buffer.isBuffer(body)) return false;
    // v2.11.1 legacyOnlyFile reads through stableFileSha256: the LF text.
    inserts.push({
      at,
      line: `file:${rel}:${executable ? "x" : "-"}=${hash(committedText(body))}`,
    });
    return true;
  };
  for (const entry of walked.legacy) {
    if (entry.kind === "file") {
      if (!(await add(entry.at, entry.rel, entry.executable, entry.size))) return null;
      continue;
    }
    if (entry.linked) return null;
    const names = await snapshot.list(entry.rel);
    if (names === null || names.length > LEGACY_MAX_FILES) return null;
    for (const name of names) {
      const info = await snapshot.inspect(`${entry.rel}/${name}`);
      if (info === null || info === "missing" || !info.isFile()) return null;
      const executable = (info.mode & 0o111n) !== 0n;
      if (!(await add(entry.at, `${entry.rel}/${name}`, executable, info.size))) return null;
    }
  }
  if (inserts.length === 0) return null;
  const merged: string[] = [];
  let next = 0;
  for (let index = 0; index <= walked.lines.length; index++) {
    while (next < inserts.length && inserts[next]?.at === index)
      merged.push((inserts[next++] as { line: string }).line);
    if (index < walked.lines.length) merged.push(walked.lines[index] as string);
  }
  return (await snapshot.stable()) ? workspaceDigest(merged) : null;
}

/**
 * v2.11.1 sameWorkspaceSource: equal, the raw-bytes form of the same walk, or
 * an earlier walk's value for the same tree.
 */
async function sameWorkspaceSource(
  recorded: string | undefined,
  current: SourceState,
): Promise<boolean> {
  if (recorded === current.fingerprint) return true;
  if (recorded === undefined) return false;
  if (recorded === current.raw) return true;
  return (await current.legacy()) === recorded || (await current.earlier()).includes(recorded);
}

/**
 * v2.11.1 sourceFingerprintRegistry, limited to what this reader reproduces:
 * no file is no exclusion; a valid file with an empty or absent `paths` yields
 * its normalized `exclude` entries. Registered paths, and anything the engine
 * would refuse, are null.
 */
async function registryExcludes(snapshot: Snapshot): Promise<string[] | null> {
  const bytes = await snapshot.read(REGISTRY, REGISTRY_MAX_BYTES);
  if (bytes === "missing") return [];
  if (!Buffer.isBuffer(bytes)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!object(parsed) || parsed.version !== 1) return null;
  const paths = parsed.paths ?? [];
  const exclude = parsed.exclude ?? [];
  for (const list of [paths, exclude])
    if (
      !Array.isArray(list) ||
      list.length > REGISTRY_MAX_ENTRIES ||
      list.some((entry) => typeof entry !== "string")
    )
      return null;
  // Registered paths need the engine's registered-only walk.
  if ((paths as string[]).length > 0) return null;
  const excludes = new Set<string>();
  for (const raw of exclude as string[]) {
    const entry = raw
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+$/, "");
    // The engine also refuses an empty, `.`, rooted or `//` entry; each has an
    // empty or dot segment here, so the segment test covers them.
    if (
      entry.length > 4096 ||
      entry.includes("\0") ||
      /^[A-Za-z]:\//.test(entry) ||
      entry.split("/").some((part) => part.length === 0 || part === "." || part === "..")
    )
      return null;
    excludes.add(entry);
  }
  return [...excludes];
}

/** Single-repository filesystem identity; complex source boundaries are unknown. */
async function workspaceSource(
  snapshot: Snapshot,
  space: string,
  intent: string,
): Promise<SourceState | null> {
  const registry = await json(snapshot, `${space}/intents/intents.json`);
  if (registry !== undefined) {
    if (!Array.isArray(registry)) return null;
    // Any repo mapping needs the multi-repository roof rules, not a single-root walk.
    for (const row of registry) {
      if (!object(row)) return null;
      // v2.8.2 recordDirMatches: a stored directory is authoritative; legacy
      // rows must match both the slug and the trailing hex of the UUID.
      const suffix =
        typeof row.slug === "string" && intent.startsWith(`${row.slug}-`)
          ? intent.slice(row.slug.length + 1)
          : "";
      const matches = row.dirName
        ? row.dirName === intent
        : typeof row.uuid === "string" &&
          /^[0-9a-f]+$/.test(suffix) &&
          row.uuid.replace(/-/g, "").slice(-suffix.length) === suffix;
      if (matches && row.repos !== undefined && (!Array.isArray(row.repos) || row.repos.length > 0))
        return null;
    }
  }
  if ((await snapshot.inspect(".aidlc/worktree-meta.json")) !== "missing") return null;
  const roots = await snapshot.list("");
  if (roots === null) return null;
  const shell = new Set(["aidlc", ".aidlc"]);
  for (const name of roots.filter(
    (name) => !HARD.has(name) && /^\.[a-z0-9][a-z0-9._-]*$/i.test(name),
  )) {
    const info = await snapshot.inspect(name);
    if (info === null || info === "missing") return null;
    if (!info.isDirectory()) continue;
    const manifest = await json(snapshot, `${name}/tools/data/harness.json`);
    if (object(manifest) && typeof manifest.name === "string" && manifest.name.trim())
      shell.add(name);
  }
  // Registered generated paths and symlink targets require the full engine walker.
  const excludes = await registryExcludes(snapshot);
  if (excludes === null) return null;
  const walked = await walkSource(snapshot, shell, true, excludes);
  if (walked === null) return null;
  // The aliases are only needed when a comparison would otherwise fail. Each
  // reads in its own snapshot so its IO never spends this build's budget.
  let legacy: Promise<string | null> | undefined;
  let earlier: Promise<readonly string[]> | undefined;
  return {
    fingerprint: workspaceDigest(walked.lines),
    raw:
      walked.rawLines.size === 0
        ? null
        : workspaceDigest(walked.lines.map((line, at) => walked.rawLines.get(at) ?? line)),
    listing: walked.listing,
    rawEntries: walked.rawEntries,
    shell,
    excludes,
    dependencies: walked.dependencies,
    legacy: () => {
      legacy ??=
        walked.legacy.length === 0
          ? Promise.resolve(null)
          : legacyFingerprint(new Snapshot(snapshot.root), walked).catch(() => null);
      return legacy;
    },
    earlier: () => {
      earlier ??= !walked.dotnetOutputSeen
        ? Promise.resolve([])
        : (async () => {
            const aux = new Snapshot(snapshot.root);
            const before = await walkSource(aux, shell, false, excludes);
            if (before === null) return [];
            const old = before.legacy.length === 0 ? null : await legacyFingerprint(aux, before);
            if (!(await aux.stable())) return [];
            return [workspaceDigest(before.lines), ...(old === null ? [] : [old])];
          })().catch(() => []);
      return earlier;
    },
  };
}

async function unitSource(
  snapshot: Snapshot,
  record: string,
  stage: string,
  unit: string,
  source: SourceState,
): Promise<Forms | null> {
  const bytes = await snapshot.read(`${record}/construction/${unit}/${stage}/source-manifest.json`);
  if (!Buffer.isBuffer(bytes)) return null;
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (
    !object(value) ||
    value.version !== 1 ||
    value.stage !== stage ||
    value.unit !== unit ||
    !Array.isArray(value.writes) ||
    Object.keys(value).some((key) => !["version", "stage", "unit", "writes"].includes(key))
  )
    return null;
  const claims = new Set<string>();
  for (const write of value.writes) {
    if (
      !object(write) ||
      typeof write.path !== "string" ||
      Object.keys(write).some((key) => key !== "path")
    )
      return null;
    const raw = write.path;
    if (
      !raw ||
      /[\\\0*?[\]{}]/.test(raw) ||
      raw.startsWith("/") ||
      /^[A-Za-z]:/.test(raw) ||
      raw.split("/").includes("..")
    )
      return null;
    const parts = raw.split("/").filter((part) => part !== "" && part !== ".");
    // Whether the engine would take a claim inside a dependency folder or an
    // excluded path turns on Git's ignore rules, which this reader cannot read.
    if (
      !parts.length ||
      source.shell.has(parts[0] as string) ||
      parts.some(
        (part, index) =>
          HARD.has(part) ||
          GENERATED.has(part) ||
          source.dependencies.has(parts.slice(0, index + 1).join("/")),
      ) ||
      excludedBy(source.excludes, parts.join("/"))
    )
      return null;
    const claim = `${parts.join("/")}${raw.endsWith("/") ? "/" : ""}`;
    if (claims.has(claim) || sensorCache(claim)) return null;
    claims.add(claim);
  }
  const escapeField = (value: string) =>
    value
      .replaceAll("\\", "\\\\")
      .replaceAll("\t", "\\t")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r");
  const claimed = [...source.listing]
    .filter(
      ([file]) =>
        claims.has(file) ||
        [...claims].some((claim) => claim.endsWith("/") && file.startsWith(claim)),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const serialize = (manifest: string, entry: (value: string) => string) =>
    `sha256:${hash(
      `manifest\t${manifest}\t-\n${claimed
        .map(([file, value]) => `\t${escapeField(file)}\t${entry(value)}\n`)
        .join("")}`,
    )}`;
  // v2.11.1 unitSourceFingerprint: the manifest's committed text, and one raw
  // form over the raw manifest and every listing entry's raw form together.
  const current = serialize(hash(committedText(bytes)), (value) => value);
  const raw = serialize(hash(bytes), (value) => source.rawEntries.get(value) ?? value);
  return { current, raw: raw === current ? null : raw };
}
