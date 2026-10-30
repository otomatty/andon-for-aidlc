import type { EffectivenessUsage } from "@andon/shared-types";
import { type MeasurementEvent, sortMeasurementEvents } from "./events.ts";
import { groupUsageByOrigin, UNKNOWN_USAGE_PROVENANCE } from "./usage-provenance.ts";

// Internal evidence metadata: summed stage receipts can each contribute half a cent of rounding.
// Keep it out of the public payload and let observations release it with their request.
const roundingBounds = new WeakMap<EffectivenessUsage, number>();

/** Compare overlapping observations; snapshots are never additive. */
export function selectUsage(
  local: EffectivenessUsage | null,
  audit: EffectivenessUsage | null,
  warnings: string[],
): EffectivenessUsage | null {
  if (!local) return audit;
  if (!audit)
    return warnings.includes(UNKNOWN_USAGE_PROVENANCE) ? { ...local, partial: true } : local;
  const fields = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const;
  const delta = fields.map((field) => audit[field] - local[field]);
  if (
    (audit.source === "audit-workflow" || audit.source === "audit-clones") &&
    delta.every((n) => n >= 0) &&
    delta.some((n) => n > 0)
  ) {
    warnings.push(
      "audit snapshot contains more usage than the local ledger; audit snapshot selected",
    );
    return audit;
  }
  // The engine serializes workflow costs with toFixed(2); keep the ledger's precision.
  const costsAgree =
    local.estimatedUsd === audit.estimatedUsd ||
    (audit.source === "audit-workflow" &&
      local.estimatedUsd !== null &&
      audit.estimatedUsd !== null &&
      Number(local.estimatedUsd.toFixed(2)) === audit.estimatedUsd) ||
    ((audit.source === "audit-stages" || audit.source === "audit-clones") &&
      local.estimatedUsd !== null &&
      audit.estimatedUsd !== null &&
      Math.abs(local.estimatedUsd - audit.estimatedUsd) <=
        (roundingBounds.get(audit) ?? 0) +
          Number.EPSILON * Math.max(1, local.estimatedUsd, audit.estimatedUsd));
  // The Stop hook can grow the ledger after completion. Those later tokens do
  // not establish a complete total at the workflow's recorded end boundary.
  if (
    delta.some((n) => n > 0) ||
    (audit.source === "audit-workflow" && delta.some((n) => n < 0)) ||
    (delta.every((n) => n === 0) && !costsAgree)
  ) {
    warnings.push(
      "usage observations disagree; local ledger shown as partial without combining snapshots",
    );
    return { ...local, partial: true };
  }
  return audit.source === "audit-clones" ? { ...local, partial: true } : local;
}

export function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function tokenSum(tokens: Record<string, unknown>): number | null {
  const values = [
    tokens.input,
    tokens.output,
    tokens.cacheRead,
    tokens.cacheCreate5m,
    tokens.cacheCreate1h,
  ].map(count);
  return values.every((n) => n !== null)
    ? values.reduce<number>((sum, n) => sum + (n ?? 0), 0)
    : null;
}

/** Select exactly one intent aggregate. Workspace totals and transcript paths never escape. */
export function ledgerUsage(
  ledger: unknown,
  space: string,
  dirName: string,
  uuid: string | null,
  knownModels: ReadonlySet<string>,
  warnings: string[],
): EffectivenessUsage | null {
  const parsed = objectOf(ledger);
  if (!parsed) return null;
  if (parsed.schemaVersion !== 3) {
    warnings.push("usage ledger schema unsupported");
    return null;
  }
  const cursors = objectOf(parsed.cursors);
  if (!cursors || Object.values(cursors).some((c) => count(objectOf(c)?.byteOffset) === null)) {
    warnings.push("usage ledger has legacy or invalid cursors");
    return null;
  }
  const workflows = objectOf(parsed.workflows);
  const aggregate = objectOf(workflows?.[uuid ? `intent:${uuid}` : `record:${space}/${dirName}`]);
  if (!aggregate) return null;
  const totals = objectOf(aggregate.totals);
  const tokens = objectOf(totals?.tokens);
  const byModel = objectOf(aggregate.byModel);
  if (!tokens || tokenSum(tokens) === null || amount(totals?.usd) === null || !byModel) {
    warnings.push("usage ledger aggregate malformed");
    return null;
  }
  let partial = false;
  const unknownModels: string[] = [];
  for (const [model, bucket] of Object.entries(byModel)) {
    const entry = objectOf(bucket);
    const modelTokens = objectOf(entry?.tokens);
    const magnitude = modelTokens ? tokenSum(modelTokens) : null;
    const usd = amount(entry?.usd);
    if (magnitude === null || usd === null) {
      partial = true;
      continue;
    }
    if (magnitude > 0 && usd === 0 && !knownModels.has(model))
      unknownModels.push(model.slice(0, 128));
  }
  if (Object.keys(byModel).length === 0 && (tokenSum(tokens) ?? 0) > 0) partial = true;
  partial ||= unknownModels.length > 0;
  const usd = amount(totals?.usd) as number;
  return {
    source: "claude-ledger",
    inputTokens: tokens.input as number,
    outputTokens: tokens.output as number,
    cacheReadTokens: tokens.cacheRead as number,
    cacheWriteTokens: (tokens.cacheCreate5m as number) + (tokens.cacheCreate1h as number),
    estimatedUsd: usd === 0 && partial ? null : usd,
    partial,
    unknownModels,
  };
}

function auditUsage(
  e: MeasurementEvent,
  source: EffectivenessUsage["source"],
): EffectivenessUsage | null {
  const values = ["Tokens In", "Tokens Out", "Cache Read", "Cache Write"].map((key) => {
    const field = e.fields[key];
    return field !== undefined && /^\d+$/.test(field) ? count(Number(field)) : null;
  });
  if (values.some((n) => n === null)) return null;
  const cost = e.fields["Cost USD"];
  const usd = cost !== undefined && cost !== "null" && cost !== "" ? amount(Number(cost)) : null;
  const unknownModels = (e.fields["By Model"] ?? "").split(";").flatMap((part) => {
    const match = /^\s*([^=]+)=null\s*$/.exec(part);
    return match ? [(match[1] ?? "").trim().slice(0, 128)] : [];
  });
  const observation: EffectivenessUsage = {
    source,
    inputTokens: values[0] as number,
    outputTokens: values[1] as number,
    cacheReadTokens: values[2] as number,
    cacheWriteTokens: values[3] as number,
    estimatedUsd: usd,
    partial: usd === null || unknownModels.length > 0 || source === "audit-stages",
    unknownModels,
  };
  roundingBounds.set(observation, usd === null ? 0 : 0.005);
  return observation;
}

/** Reconcile clone-local snapshots before comparing them with this checkout's ledger. */
export function auditUsageSummary(
  events: readonly MeasurementEvent[],
  warnings: string[],
): EffectivenessUsage | null {
  const clones = groupUsageByOrigin(events);
  if (!clones) {
    warnings.push(UNKNOWN_USAGE_PROVENANCE);
    return null;
  }
  if (clones.size <= 1) return cloneUsageSummary(events, warnings);
  const lastStart = events.filter((event) => event.event === "WORKFLOW_STARTED").at(-1);
  const rows: EffectivenessUsage[] = [];
  for (const group of clones.values()) {
    if (
      !group.some(
        (event) =>
          ["STAGE_COMPLETED", "WORKFLOW_COMPLETED"].includes(event.event) &&
          event.fields["Tokens In"] !== undefined,
      )
    )
      continue;
    const scoped =
      lastStart && !group.includes(lastStart)
        ? sortMeasurementEvents([...group, lastStart])
        : group;
    const row = cloneUsageSummary(scoped, warnings);
    if (row) rows.push(row);
  }
  if (!rows.length) return null;
  if (rows.length < clones.size)
    warnings.push("some clones lack usage snapshots; available totals are partial");
  warnings.push("multiple clone usage snapshots combined; totals remain partial");
  return sumAuditUsage(rows, "audit-clones");
}

/** Completion fields are cumulative within one clone. Never add its workflow and stage totals. */
function cloneUsageSummary(
  events: readonly MeasurementEvent[],
  warnings: string[],
): EffectivenessUsage | null {
  const lastWorkflow = events.filter((e) => e.event === "WORKFLOW_COMPLETED").at(-1);
  const lastStart = events.filter((e) => e.event === "WORKFLOW_STARTED").at(-1);
  // A restart invalidates the old workflow total; per-stage receipts remain cumulative.
  const currentCompletion =
    lastWorkflow &&
    (!lastStart ||
      lastWorkflow.time > lastStart.time ||
      (lastWorkflow.time === lastStart.time &&
        lastWorkflow.shard === lastStart.shard &&
        lastWorkflow.position > lastStart.position));
  if (lastWorkflow && currentCompletion) {
    const usage = auditUsage(lastWorkflow, "audit-workflow");
    if (usage) return usage;
  }
  if (lastWorkflow && !currentCompletion)
    warnings.push("workflow restarted; obsolete completion usage ignored");
  const latest = new Map<string, MeasurementEvent>();
  for (const e of events)
    if (e.event === "STAGE_COMPLETED" && e.fields.Stage) latest.set(e.fields.Stage, e);
  const rows: EffectivenessUsage[] = [];
  for (const e of latest.values()) {
    const row = auditUsage(e, "audit-stages");
    if (row) rows.push(row);
    else if (e.fields["Tokens In"] !== undefined) warnings.push("malformed usage snapshot ignored");
  }
  if (!rows.length) return null;
  return sumAuditUsage(rows, "audit-stages");
}

function sumAuditUsage(
  rows: EffectivenessUsage[],
  source: "audit-stages" | "audit-clones",
): EffectivenessUsage {
  const observation: EffectivenessUsage = {
    source,
    inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
    cacheReadTokens: rows.reduce((n, r) => n + r.cacheReadTokens, 0),
    cacheWriteTokens: rows.reduce((n, r) => n + r.cacheWriteTokens, 0),
    estimatedUsd: rows.some((r) => r.estimatedUsd !== null)
      ? rows.reduce((n, r) => n + (r.estimatedUsd ?? 0), 0)
      : null,
    partial: true,
    unknownModels: [...new Set(rows.flatMap((r) => r.unknownModels))],
  };
  roundingBounds.set(
    observation,
    rows.reduce((sum, row) => sum + (roundingBounds.get(row) ?? 0), 0),
  );
  return observation;
}
