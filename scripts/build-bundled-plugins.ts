#!/usr/bin/env bun
// Build the catalog of AI-DLC plugins the extension ships (the 「プラグイン」 page).
//
// For each `plugins/<name>/` with a `.andon/listing.json`, the plugin is built with the
// engine's own builder, composed into a copy of this repository's tracked `.claude/` with the
// engine's own `plugin sync` and `plugin select`, and described from what that actually did:
// the stages its scope runs, the files it adds and changes, and the source hash its install
// record pins. The catalog is committed; `--check` fails when it is stale.
//
//   bun scripts/build-bundled-plugins.ts           write the catalog
//   bun scripts/build-bundled-plugins.ts --check   fail if the committed catalog is stale
//   ... --out <dir>                                 also write the built plugins to <dir>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { canonicalPathSync } from "../packages/core-utils/src/canonical-path.ts";
import type {
  BundledPlugin,
  BundledPluginCatalog,
  BundledPluginRequirement,
  BundledPluginStage,
} from "../packages/shared-types/src/bundled-plugins.ts";
// The strictest SVG check in the repository: the one the focus sensor runs before approval.
import { checkSvg } from "../plugins/focus/tools/focus-diagram.ts";

export const CATALOG_REL = "packages/shared-types/src/bundled-plugins.generated.json";
const LISTING_REL = ".andon/listing.json";
const HARNESS_DIRS: Record<string, string> = { claude: ".claude" };
// The engine tools are TypeScript run by bun; under a Node test runner, call bun by name.
const BUN = process.versions.bun === undefined ? "bun" : process.execPath;

type Listing = Omit<
  BundledPlugin,
  "name" | "version" | "sourceHash" | "stages" | "files" | "sample"
> & { sample: { file: string; alt: string } | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate a plugin's `.andon/listing.json`, naming the field that is wrong. */
export function parseListing(raw: unknown, plugin: string): Listing {
  const fail = (field: string, why: string): never => {
    throw new Error(`plugins/${plugin}/${LISTING_REL}: ${field} ${why}`);
  };
  if (!isRecord(raw)) return fail("(root)", "must be an object");
  const text = (field: string): string => {
    const value = raw[field];
    return typeof value === "string" && value.trim() !== ""
      ? value
      : fail(field, "must be a non-empty string");
  };
  const texts = (field: string): string[] => {
    const value = raw[field];
    return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "")
      ? value
      : fail(field, "must be a list of non-empty strings");
  };
  const status = text("status");
  if (status !== "preview" && status !== "stable") fail("status", "must be preview or stable");
  const harness = text("harness");
  if (!Object.hasOwn(HARNESS_DIRS, harness))
    fail("harness", `must be one of ${Object.keys(HARNESS_DIRS).join(", ")}`);
  const requirementsRaw = raw.requirements;
  if (!Array.isArray(requirementsRaw)) fail("requirements", "must be a list");
  const requirements = (requirementsRaw as unknown[]).map(
    (item, index): BundledPluginRequirement => {
      const where = `requirements[${index}]`;
      if (!isRecord(item)) return fail(where, "must be an object");
      const field = (key: string): string =>
        typeof item[key] === "string" && item[key] !== ""
          ? (item[key] as string)
          : fail(`${where}.${key}`, "must be a non-empty string");
      const level = field("level");
      if (level !== "required" && level !== "recommended" && level !== "info")
        fail(`${where}.level`, "must be required, recommended or info");
      return {
        id: field("id"),
        level: level as BundledPluginRequirement["level"],
        label: field("label"),
        detail: field("detail"),
      };
    },
  );
  let sample: Listing["sample"] = null;
  if (raw.sample !== null && raw.sample !== undefined) {
    if (!isRecord(raw.sample)) return fail("sample", "must be an object or null");
    const file = raw.sample.file;
    const alt = raw.sample.alt;
    if (
      typeof file !== "string" ||
      file.includes("\\") ||
      path.posix.isAbsolute(file) ||
      path.posix.normalize(file).startsWith("..") ||
      !file.toLowerCase().endsWith(".svg")
    )
      fail("sample.file", "must be an .svg path inside .andon/");
    if (typeof alt !== "string" || alt === "") fail("sample.alt", "must be a non-empty string");
    sample = { file: file as string, alt: alt as string };
  }
  return {
    title: text("title"),
    tagline: text("tagline"),
    summary: text("summary"),
    status: status as Listing["status"],
    harness,
    scope: text("scope"),
    startCommand: text("startCommand"),
    fitFor: texts("fitFor"),
    notFitFor: texts("notFitFor"),
    requirements,
    sample,
  };
}

/** Files that differ between two snapshots (path → content hash): added and changed, sorted. */
export function diffTrees(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): { added: string[]; changed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [file, hash] of after) {
    const previous = before.get(file);
    if (previous === undefined) added.push(file);
    else if (previous !== hash) changed.push(file);
  }
  return { added: added.sort(), changed: changed.sort() };
}

type GraphNode = { slug: string; name: string; phase: string; plugin?: string; for_each?: string };
type ScopeGrid = Record<string, { stages: Record<string, string> }>;

/** The stages a scope runs past initialization, in the compiled graph's order. */
export function scopeStages(
  graph: readonly GraphNode[],
  grid: ScopeGrid,
  scope: string,
  plugin: string,
  extended: ReadonlySet<string>,
): BundledPluginStage[] {
  const decisions = grid[scope]?.stages;
  if (decisions === undefined) throw new Error(`scope ${scope} is not in the composed scope grid`);
  return graph
    .filter((node) => node.phase !== "initialization" && decisions[node.slug] === "EXECUTE")
    .map((node) => ({
      slug: node.slug,
      name: node.name,
      phase: node.phase,
      origin:
        node.plugin === plugin ? "plugin" : extended.has(node.slug) ? "core-extended" : "core",
      perUnit: node.for_each === "unit-of-work",
    }));
}

function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile())
        files.set(
          child,
          createHash("sha256")
            .update(readFileSync(path.join(dir, child)))
            .digest("hex"),
        );
    }
  };
  walk("");
  return files;
}

function run(command: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const [file = "", ...args] = command;
  const result = spawnSync(file, args, { cwd, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0)
    throw new Error(
      `${command.slice(1, 4).join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  return result.stdout;
}

/** The core stages a plugin's contributions add steps to. */
function contributionTargets(pluginRoot: string): Set<string> {
  const targets = new Set<string>();
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".md")) {
        const target = /^---\n[\s\S]*?^target:\s*(\S+)/m.exec(readFileSync(child, "utf8"))?.[1];
        if (target) targets.add(target);
      }
    }
  };
  walk(path.join(pluginRoot, "contributions"));
  return targets;
}

/** The plugins under `plugins/` that carry a listing, sorted. */
function listedPlugins(root: string): string[] {
  return readdirSync(path.join(root, "plugins"))
    .filter((name) => existsSync(path.join(root, "plugins", name, LISTING_REL)))
    .sort();
}

function readListing(root: string, name: string): Listing {
  return parseListing(
    JSON.parse(readFileSync(path.join(root, "plugins", name, LISTING_REL), "utf8")),
    name,
  );
}

/** Build one plugin for its harness with the engine's own builder, into `out`. */
function buildPlugin(root: string, name: string, harness: string, out: string): void {
  run(
    [
      BUN,
      path.join(root, HARNESS_DIRS[harness] ?? ".claude", "tools", "aidlc-plugin-build.ts"),
      path.join(root, "plugins", name),
      harness,
      out,
    ],
    root,
  );
}

async function describePlugin(root: string, name: string, work: string): Promise<BundledPlugin> {
  const pluginRoot = path.join(root, "plugins", name);
  const listing = readListing(root, name);
  const harnessDir = HARNESS_DIRS[listing.harness] ?? ".claude";
  const built = path.join(work, name, "dist");
  const project = path.join(work, name, "project");
  buildPlugin(root, name, listing.harness, built);
  // Only what the repository tracks, so a local settings file never shows up in the catalog.
  const tracked = run(["git", "ls-files", "-z", harnessDir], root).split("\0").filter(Boolean);
  for (const file of tracked) {
    mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    cpSync(path.join(root, file), path.join(project, file));
  }
  const before = snapshot(project);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AIDLC_PLUGIN_ROOT: built,
    AIDLC_HARNESS_DIR: harnessDir,
    AIDLC_HARNESS_NAME: listing.harness,
  };
  for (const key of [
    "CLAUDE_PLUGIN_ROOT",
    "PLUGIN_ROOT",
    "CLAUDE_PROJECT_DIR",
    "AIDLC_PROJECT_DIR",
  ])
    delete env[key];
  const dispatcher = path.join(project, harnessDir, "tools", "aidlc.ts");
  run(
    [BUN, dispatcher, "engine", "plugin", "sync", "--project-dir", project, "--json"],
    project,
    env,
  );
  const data = path.join(project, harnessDir, "tools", "data");
  const harness = JSON.parse(readFileSync(path.join(data, "harness.json"), "utf8")) as {
    plugins?: unknown;
  };
  const selected = new Set(
    Array.isArray(harness.plugins) ? harness.plugins.map(String) : ["aidlc"],
  );
  selected.add(name);
  run(
    [BUN, dispatcher, "engine", "plugin", "select", [...selected].sort().join(",")],
    project,
    env,
  );
  // `plugin select` also records the change in the workflow record (`aidlc/`), under names
  // that differ by machine; the page says so in words, and lists only the harness tree.
  const changes = diffTrees(before, snapshot(project));
  const inHarness = (file: string) => file.startsWith(`${harnessDir}/`);
  const files = {
    added: changes.added.filter(inHarness),
    changed: changes.changed.filter(inHarness),
  };
  const graph = JSON.parse(
    readFileSync(path.join(data, "stage-graph.json"), "utf8"),
  ) as GraphNode[];
  const grid = JSON.parse(readFileSync(path.join(data, "scope-grid.json"), "utf8")) as ScopeGrid;
  const stamp = JSON.parse(
    readFileSync(path.join(data, `plugin-compose-${name}.json`), "utf8"),
  ) as { version?: unknown; sourceHash?: unknown };
  const manifest = JSON.parse(
    readFileSync(path.join(built, ".claude-plugin", "plugin.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof stamp.sourceHash !== "string" || stamp.version !== manifest.version)
    throw new Error(`plugins/${name}: the composed record does not match the built plugin`);
  let sample: BundledPlugin["sample"] = null;
  if (listing.sample !== null) {
    const file = path.join(pluginRoot, ".andon", listing.sample.file);
    const svg = readFileSync(file, "utf8");
    const problems = checkSvg(svg, statSync(file).size);
    if (problems.length > 0)
      throw new Error(
        `plugins/${name}/.andon/${listing.sample.file}: ${problems.map((p) => p.code).join(", ")}`,
      );
    sample = { alt: listing.sample.alt, svg: svg.replace(/\r\n?/g, "\n") };
  }
  return {
    name,
    version: String(manifest.version),
    sourceHash: stamp.sourceHash,
    title: listing.title,
    tagline: listing.tagline,
    summary: listing.summary,
    status: listing.status,
    harness: listing.harness,
    scope: listing.scope,
    startCommand: listing.startCommand,
    fitFor: listing.fitFor,
    notFitFor: listing.notFitFor,
    requirements: listing.requirements,
    stages: scopeStages(graph, grid, listing.scope, name, contributionTargets(pluginRoot)),
    files: {
      added: files.added,
      changed: files.changed,
    },
    sample,
  };
}

/**
 * The engine resolves the paths it writes and refuses any outside the project it was given, so the
 * project must be named the way the OS names it: Windows hands out the temporary folder in its 8.3
 * short form (`RUNNER~1`), which never matches the resolved one.
 */
function longPath(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return canonicalPathSync(dir);
}

/** Describe every plugin under `plugins/` that has a listing, working in `work`. */
export async function buildCatalog(root: string, work: string): Promise<BundledPluginCatalog> {
  work = longPath(work);
  const plugins: BundledPlugin[] = [];
  for (const name of listedPlugins(root)) plugins.push(await describePlugin(root, name, work));
  return { schemaVersion: 1, plugins };
}

/**
 * Write each listed plugin, built for its harness, to `<out>/<name>/<harness>/`: where the
 * extension finds the packages it installs (`dist/plugins` inside the VSIX).
 */
export async function bundlePlugins(root: string, work: string, out: string): Promise<void> {
  work = longPath(work);
  for (const name of listedPlugins(root)) {
    const { harness } = readListing(root, name);
    const built = path.join(work, name, "bundle");
    buildPlugin(root, name, harness, built);
    const target = path.join(out, name, harness);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(built, target, { recursive: true });
  }
}

export function serializeCatalog(catalog: BundledPluginCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Write the catalog, or with `check` fail without writing when the committed one is stale. */
export async function regenerateCatalog(root: string, check = false): Promise<void> {
  const work = mkdtempSync(path.join(tmpdir(), "bundled-plugins-"));
  try {
    const text = serializeCatalog(await buildCatalog(root, work));
    const target = path.join(root, CATALOG_REL);
    if (check) {
      const committed = existsSync(target) ? readFileSync(target, "utf8") : "";
      if (committed !== text)
        throw new Error(
          "同梱プラグインのカタログが古くなっています。bun run build:plugins-catalog を実行してください。",
        );
    } else writeFileSync(target, text, "utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { check: { type: "boolean" }, out: { type: "string" } },
  });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    await regenerateCatalog(root, values.check === true);
    if (values.out !== undefined) {
      const work = mkdtempSync(path.join(tmpdir(), "bundled-plugins-"));
      try {
        await bundlePlugins(root, work, path.resolve(values.out));
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    console.log(
      values.check
        ? "同梱プラグインのカタログに差分はありません。"
        : "同梱プラグインのカタログを生成しました。",
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
