import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  PREFLIGHT_TEXT_MAX,
  type PreflightInference,
  type PreflightPayload,
  type PreflightPlan,
  type PreflightScan,
  type PreflightScopeSummary,
  type PreflightStage,
} from "@andon/shared-types";

/**
 * /api/preflight の静的部分 — `.claude/` の固定 3 種（stage-graph.json /
 * scope-grid.json / scopes/*.md frontmatter）だけを読む。ユーザー入力を
 * パスに使う経路は無い（S: guardPath 新経路なし）。
 */

interface GraphNode {
  slug: string;
  number: string;
  name: string;
  phase: string;
  lead_agent: string;
  produces: string[];
}

type Grid = Record<string, { stages: Record<string, string> }>;

function dataPath(root: string, file: string): string {
  return path.join(root, ".claude", "tools", "data", file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadGraph(root: string): Promise<GraphNode[] | null> {
  const raw = await readJson<Record<string, GraphNode>>(dataPath(root, "stage-graph.json"));
  if (raw === null) return null;
  return Object.keys(raw)
    .map((k) => Number(k))
    .filter((k) => Number.isInteger(k))
    .sort((a, b) => a - b)
    .map((k) => raw[String(k)])
    .filter((n): n is GraphNode => n !== undefined);
}

export function parseScopeFrontmatter(
  text: string,
): { name: string; depth: string; skeleton: string; description: string } | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const fields: Record<string, string> = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    fields[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  if (fields.name === undefined) return null;
  return {
    name: fields.name,
    depth: fields.depth ?? "",
    skeleton: fields.skeleton ?? "",
    description: fields.description ?? "",
  };
}

function countsFor(
  graph: GraphNode[],
  stages: Record<string, string>,
): { executeCount: number; totalCount: number; gateCount: number } {
  let executeCount = 0;
  let gateCount = 0;
  for (const node of graph) {
    if (stages[node.slug] !== "EXECUTE") continue;
    executeCount += 1;
    if (node.phase !== "initialization") gateCount += 1;
  }
  return { executeCount, totalCount: graph.length, gateCount };
}

export async function buildCatalog(
  root: string,
): Promise<{ scopes: PreflightScopeSummary[]; errors: string[] }> {
  const graph = await loadGraph(root);
  const grid = await readJson<Grid>(dataPath(root, "scope-grid.json"));
  if (graph === null || grid === null) {
    return { scopes: [], errors: ["framework-not-found"] };
  }

  const scopesDir = path.join(root, ".claude", "scopes");
  let files: string[];
  try {
    files = (await readdir(scopesDir)).filter((f) => f.startsWith("aidlc-") && f.endsWith(".md"));
  } catch {
    return { scopes: [], errors: ["framework-not-found"] };
  }

  const scopes: PreflightScopeSummary[] = [];
  for (const file of files.sort()) {
    let front: ReturnType<typeof parseScopeFrontmatter>;
    try {
      front = parseScopeFrontmatter(await readFile(path.join(scopesDir, file), "utf8"));
    } catch {
      continue;
    }
    if (front === null) continue;
    // grid にエントリの無い scope（composed 等）は all-SKIP として数える。
    const stages = grid[front.name]?.stages ?? {};
    scopes.push({ ...front, ...countsFor(graph, stages) });
  }
  return { scopes, errors: [] };
}

export async function buildPlan(root: string, scopeName: string): Promise<PreflightPlan | null> {
  const graph = await loadGraph(root);
  const grid = await readJson<Grid>(dataPath(root, "scope-grid.json"));
  if (graph === null || grid === null || !Object.hasOwn(grid, scopeName)) return null;
  const entry = grid[scopeName];
  // narrows the Object.hasOwn guard for the compiler
  if (entry === undefined) return null;

  let front: ReturnType<typeof parseScopeFrontmatter> = null;
  try {
    front = parseScopeFrontmatter(
      await readFile(path.join(root, ".claude", "scopes", `aidlc-${scopeName}.md`), "utf8"),
    );
  } catch {
    // frontmatter 無しでもプランは出せる（depth/skeleton が空になるだけ）。
  }

  const phases: Array<{ phase: string; stages: PreflightStage[] }> = [];
  for (const node of graph) {
    const decision = entry.stages[node.slug] === "EXECUTE" ? "EXECUTE" : "SKIP";
    const stage: PreflightStage = {
      slug: node.slug,
      number: node.number,
      name: node.name,
      phase: node.phase,
      decision,
      leadAgent: node.lead_agent,
      gate: decision === "EXECUTE" && node.phase !== "initialization",
      produces: node.produces ?? [],
    };
    const bucket = phases.at(-1);
    if (bucket !== undefined && bucket.phase === node.phase) {
      bucket.stages.push(stage);
    } else {
      phases.push({ phase: node.phase, stages: [stage] });
    }
  }

  return {
    scope: scopeName,
    depth: front?.depth ?? "",
    skeleton: front?.skeleton ?? "",
    ...countsFor(graph, entry.stages),
    phases,
  };
}

const execFileAsync = promisify(execFile);

/**
 * エンジンの純関数を bun ごしに呼ぶ。`.claude/tools/` は一切改変しない
 * （core 無改変）— import 副作用が無いことは実機確認済み。
 */
const INFER_SCRIPT =
  "import {inferScopeFromText} from './.claude/tools/aidlc-utility.ts';" +
  " console.log(JSON.stringify(inferScopeFromText(Bun.argv.at(-1))))";

const SUBPROCESS_TIMEOUT_MS = 5000;

export interface PreflightDeps {
  runBun?: (args: string[], cwd: string) => Promise<string>;
  probe?: (command: string) => Promise<boolean>;
}

async function defaultRunBun(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("bun", args, {
    cwd,
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  return stdout;
}

async function defaultProbe(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: SUBPROCESS_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function parseJsonLine<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.trim()) as T;
  } catch {
    return null;
  }
}

/**
 * `?text=` requests fire on every debounced keystroke (400ms) — re-running
 * `buildCatalog` + both CLI probes + the `detect` subprocess on each one
 * would be discarded by the client immediately (it only ever wants the
 * static part once, from the mount request). So a text request runs
 * *only* inference + plan derivation; the static fields come back empty/
 * null and the caller (dashboard) is expected to keep its own copy.
 */
export async function buildPreflight(
  root: string,
  rawText: string | null,
  deps: PreflightDeps = {},
): Promise<PreflightPayload> {
  const runBun = deps.runBun ?? defaultRunBun;
  const text = rawText?.trim().slice(0, PREFLIGHT_TEXT_MAX) ?? "";

  if (text !== "") {
    const errors: string[] = [];
    let inference: PreflightInference | null = null;
    let plan: PreflightPayload["plan"] = null;
    try {
      const raw = await runBun(["-e", INFER_SCRIPT, "--", text], root);
      inference = parseJsonLine<PreflightInference>(raw);
      if (inference === null) throw new Error("unparseable");
    } catch {
      inference = null;
      errors.push("infer-failed");
    }
    if (inference !== null) {
      plan = await buildPlan(root, inference.scope);
    }
    return { scan: null, scopes: [], inference, plan, cli: null, errors };
  }

  const probe = deps.probe ?? defaultProbe;
  const errors: string[] = [];

  const [{ scopes, errors: catalogErrors }, bunOk, claudeOk] = await Promise.all([
    buildCatalog(root),
    probe("bun"),
    probe("claude"),
  ]);
  errors.push(...catalogErrors);

  let scan: PreflightScan | null = null;
  try {
    const raw = await runBun([".claude/tools/aidlc-utility.ts", "detect", "--json"], root);
    const parsed = parseJsonLine<PreflightScan & Record<string, unknown>>(raw);
    if (parsed === null) throw new Error("unparseable");
    scan = {
      projectType: String(parsed.projectType ?? ""),
      languages: String(parsed.languages ?? ""),
      frameworks: String(parsed.frameworks ?? ""),
      buildSystem: String(parsed.buildSystem ?? ""),
    };
  } catch {
    errors.push("detect-failed");
  }

  return {
    scan,
    scopes,
    inference: null,
    plan: null,
    cli: { bun: bunOk, claude: claudeOk },
    errors,
  };
}
