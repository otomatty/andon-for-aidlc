import path from "node:path";
import { guardPath, readBounded, withResult } from "@andon/core-utils";
import type { AgentModelSetting, ReadResult, StageModelsPayload } from "@andon/shared-types";
import { usageTrackingDisabled } from "../effectiveness/settings.ts";
import { objectOf } from "../effectiveness/usage.ts";

const ID = /^[a-z][a-z0-9-]{0,100}$/;
const LIMIT = 1024 * 1024;
/** Unique persona files per `/api/stage-models` request, shared across harnesses. */
const MAX_PERSONA_READS = 64;
const PERSONA_BYTES = 128 * 1024;

interface PersonaBudget {
  remaining: number;
  warned: boolean;
}

function label(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    ? value
    : null;
}

async function text(
  root: string,
  rel: string,
  warnings: string[],
  limit = LIMIT,
): Promise<string | null> {
  const guarded = await guardPath(root, rel);
  if (!("ok" in guarded)) {
    warnings.push(`${rel}: outside-record`);
    return null;
  }
  const read = await readBounded(guarded.value, limit);
  if (read.ok) return read.value;
  if (read.reason !== "not-found") warnings.push(`${rel}: ${read.reason}`);
  return null;
}

async function json(
  root: string,
  rel: string,
  warnings: string[],
  limit = LIMIT,
): Promise<unknown> {
  const content = await text(root, rel, warnings, limit);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch {
    warnings.push(`${rel}: invalid JSON`);
    return null;
  }
}

/** Only scalar model/effort fields; unsupported YAML is unknown, never session inheritance. */
function fields(content: string): Map<string, string | null> | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (frontmatter === undefined) return null;
  const result = new Map<string, string | null>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^(model|effort):\s*(.*?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    const raw = (match[2] ?? "").replace(/\s+#.*$/, "").trim();
    const scalar = /^(?:"([^"\\]*)"|'([^']*)'|([a-zA-Z0-9][a-zA-Z0-9._:/[\]-]*))$/.exec(raw);
    result.set(
      match[1],
      result.has(match[1]) ? null : label(scalar?.[1] ?? scalar?.[2] ?? scalar?.[3]),
    );
  }
  return result;
}

function inherited(agent: string): AgentModelSetting {
  return { agent, source: "session", model: null, projectModel: null, effort: null };
}

async function harnessModels(
  root: string,
  id: "claude" | "cursor",
  warnings: string[],
  budget: PersonaBudget,
): Promise<StageModelsPayload["harnesses"][number] | null> {
  const graph = await json(root, `.${id}/tools/data/stage-graph.json`, warnings);
  if (graph === null) return null;
  if (!Array.isArray(graph) || graph.length > 256) {
    warnings.push(`${id}: stage graph unavailable`);
    return null;
  }
  const settings =
    id === "claude" ? objectOf(await json(root, ".claude/settings.json", warnings)) : null;
  const local =
    id === "claude" ? objectOf(await json(root, ".claude/settings.local.json", warnings)) : null;
  const aliases = { ...objectOf(settings?.env), ...objectOf(local?.env) };
  const agents = new Map<string, Promise<AgentModelSetting>>();
  const agent = (name: string): Promise<AgentModelSetting> => {
    const cached = agents.get(name);
    if (cached) return cached;
    if (!ID.test(name)) {
      const invalid = Promise.resolve({ ...inherited(name), source: "unavailable" as const });
      agents.set(name, invalid);
      return invalid;
    }
    if (budget.remaining <= 0) {
      if (!budget.warned) {
        warnings.push("persona read budget exceeded");
        budget.warned = true;
      }
      const skipped = Promise.resolve({ ...inherited(name), source: "unavailable" as const });
      agents.set(name, skipped);
      return skipped;
    }
    budget.remaining -= 1;
    const read = (async (): Promise<AgentModelSetting> => {
      const unavailable: AgentModelSetting = { ...inherited(name), source: "unavailable" };
      if (!ID.test(name)) return unavailable;
      const content = await text(root, `.${id}/agents/${name}.md`, warnings, PERSONA_BYTES);
      const fm = content === null ? null : fields(content);
      if (fm === null || (fm.has("model") && fm.get("model") === null)) return unavailable;
      const model = fm.get("model");
      const effort = fm.get("effort") ?? null;
      if (!model || model === "inherit") return { ...inherited(name), effort };
      const alias = /^[a-z]+$/.test(model)
        ? label(aliases[`ANTHROPIC_DEFAULT_${model.toUpperCase()}_MODEL`])
        : null;
      return { agent: name, source: "agent", model, projectModel: alias, effort };
    })();
    agents.set(name, read);
    return read;
  };
  const stages: StageModelsPayload["harnesses"][number]["stages"] = [];
  // Bound parallel reads to one stage's participants; persona results are shared between stages.
  for (const raw of graph) {
    const node = objectOf(raw);
    if (
      !node ||
      typeof node.slug !== "string" ||
      !ID.test(node.slug) ||
      !label(node.lead_agent) ||
      !["inline", "subagent", "pipeline", "mob"].includes(String(node.mode))
    ) {
      warnings.push(`${id}: invalid stage declaration`);
      continue;
    }
    const leadName = node.lead_agent as string;
    const supports = Array.isArray(node.support_agents)
      ? node.support_agents
          .filter((v): v is string => typeof v === "string" && ID.test(v))
          .slice(0, 32)
      : [];
    const inlineLead = node.mode === "inline" || node.mode === "mob";
    const [lead, supportSettings, reviewer] = await Promise.all([
      inlineLead ? Promise.resolve(inherited(leadName)) : agent(leadName),
      Promise.all(
        supports.map((name) =>
          node.mode === "inline" ? Promise.resolve(inherited(name)) : agent(name),
        ),
      ),
      typeof node.reviewer === "string" ? agent(node.reviewer) : Promise.resolve(null),
    ]);
    stages.push({
      slug: node.slug,
      mode: String(node.mode),
      lead,
      supports: supportSettings,
      reviewer,
    });
  }
  return { id, label: id === "claude" ? "Claude Code" : "Cursor", stages };
}

/** Matches the engine's stored directory name or legacy slug plus UUID tail. */
function matchesRecord(row: Record<string, unknown> | null, dirName: string): boolean {
  if (!row) return false;
  if (row.dirName) return row.dirName === dirName;
  if (typeof row.slug !== "string" || typeof row.uuid !== "string") return false;
  if (!dirName.startsWith(`${row.slug}-`)) return false;
  const suffix = dirName.slice(row.slug.length + 1);
  return /^[0-9a-f]+$/.test(suffix) && row.uuid.replace(/-/g, "").slice(-suffix.length) === suffix;
}

/** Reads only the selected record's ledger bucket; ambiguous ownership yields no observations. */
async function observedModels(
  root: string,
  record: string | null,
  warnings: string[],
): Promise<StageModelsPayload["observed"]> {
  if (await usageTrackingDisabled(root, warnings)) {
    warnings.push("usage tracking disabled; token and cost data withheld");
    return null;
  }
  if (!record) return {};
  const relative = path.relative(root, record).split(path.sep).join("/");
  const match = /^aidlc\/spaces\/([a-zA-Z0-9_-]+)\/intents\/([a-zA-Z0-9_-]+)$/.exec(relative);
  if (!match) return {};
  const [, space, dirName] = match;
  if (!space || !dirName) return {};
  const [catalog, rawLedger] = await Promise.all([
    json(root, `aidlc/spaces/${space}/intents/intents.json`, warnings),
    json(root, "aidlc/.aidlc-sessions/usage-ledger.json", warnings, 10 * LIMIT),
  ]);
  const ledger = objectOf(rawLedger);
  if (!ledger) return {};
  if (ledger.schemaVersion !== 3) {
    warnings.push("usage ledger schema unsupported");
    return {};
  }
  const entries = Array.isArray(catalog)
    ? catalog.map(objectOf).filter((row) => matchesRecord(row, dirName))
    : [];
  // Ambiguous catalog ownership must never fall back to workspace totals.
  if (entries.length > 1) return {};
  const uuid = entries[0]?.uuid;
  const key = typeof uuid === "string" ? `intent:${uuid}` : `record:${space}/${dirName}`;
  const aggregate = objectOf(objectOf(ledger.workflows)?.[key]);
  const stages = objectOf(aggregate?.byStage);
  const observed: Record<string, string[]> = {};
  for (const [slug, raw] of Object.entries(stages ?? {}).slice(0, 256)) {
    if (!ID.test(slug)) continue;
    const byModel = objectOf(objectOf(raw)?.byModel);
    const models = Object.entries(byModel ?? {})
      .filter(([model, totals]) => {
        if (!label(model) || model === "unknown") return false;
        const tokens = objectOf(objectOf(totals)?.tokens);
        return ["input", "output", "cacheRead", "cacheCreate5m", "cacheCreate1h"].some((field) => {
          const value = tokens?.[field];
          return typeof value === "number" && Number.isFinite(value) && value > 0;
        });
      })
      .map(([model]) => model)
      .sort()
      .slice(0, 32);
    if (models.length) observed[slug] = models;
  }
  return observed;
}

/** Read installed settings and workflow-owned usage only. Never execute workspace code or read transcripts. */
export function readStageModels(
  root: string,
  record: string | null,
): Promise<ReadResult<StageModelsPayload>> {
  return withResult(async () => {
    const warnings: string[] = [];
    const budget: PersonaBudget = { remaining: MAX_PERSONA_READS, warned: false };
    const [claude, cursor, observed] = await Promise.all([
      harnessModels(root, "claude", warnings, budget),
      harnessModels(root, "cursor", warnings, budget),
      observedModels(root, record, warnings),
    ]);
    return {
      ok: true,
      value: { harnesses: [claude, cursor].filter((v) => v !== null), observed },
      ...(warnings.length ? { warnings: [...new Set(warnings)].sort() } : {}),
    };
  });
}
