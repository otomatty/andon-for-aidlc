import path from "node:path";
import { mapBounded } from "@andon/core-utils";
import type { ConstructionWalk, ReadResult, StageTiming, TimingPolicy } from "@andon/shared-types";
import { readAllAuditEvents } from "../audit/events.ts";
import { intentsDirOf, resolveIntents } from "../intents/resolve.ts";
import { readState } from "../parse/state.ts";
import { deriveStageTimings } from "./derive.ts";
import { DEFAULT_TIMING_POLICY } from "./policy.ts";
import { constructionWalkOf } from "./walk.ts";

/** L4 — intent enumeration and sample collection. Never throws (BR-RC-2). */

/** At most this many intents read at once (each fans out over its own shards). */
const INTENT_READ_CONCURRENCY = 4;

function withWarnings(
  value: StageTiming[],
  warnings: readonly string[],
): ReadResult<StageTiming[]> {
  return warnings.length > 0 ? { ok: true, value, warnings: [...warnings] } : { ok: true, value };
}

export async function getStageTimings(
  recordDir: string,
  now: number,
  policy: TimingPolicy = DEFAULT_TIMING_POLICY,
): Promise<ReadResult<StageTiming[]>> {
  const [events, state] = await Promise.all([readAllAuditEvents(recordDir), readState(recordDir)]);
  if (!("ok" in events)) return events;
  // Stage Progress lists every stage in stage-graph order (see `stageOrderOf`).
  const order =
    "ok" in state && state.value.stages.length > 0
      ? state.value.stages.map((stage) => stage.slug)
      : null;
  const { timings, warnings } = deriveStageTimings(events.value, now, policy, order);
  const readWarnings = events.warnings ?? [];
  const value = timings.map((timing) => ({
    ...timing,
    runId: `${path.basename(recordDir)}:${timing.runId ?? `${timing.stage}:${timing.startedAt}`}`,
    ...(readWarnings.length === 0
      ? {}
      : {
          activeMs: null,
          breakdown: null,
          quality: {
            status: "incomplete" as const,
            reasons: [...new Set([...(timing.quality?.reasons ?? []), "audit-read-incomplete"])],
            sampleEligible: false,
          },
          sensitivity: (timing.sensitivity ?? []).map((entry) => ({ ...entry, workMs: null })),
        }),
  }));
  return withWarnings(value, [...readWarnings, ...warnings]);
}

/** Stamps each run with the Construction walk its workflow recorded it under. */
function withConstructionWalk(
  timings: readonly StageTiming[],
  walk: ConstructionWalk | "unknown",
): StageTiming[] {
  return timings.map((timing) => ({ ...timing, constructionWalk: walk }));
}

/** The intent's walk, or `unknown` when its state file cannot be read or parsed. */
async function recordWalk(recordDir: string): Promise<ConstructionWalk | "unknown"> {
  const state = await readState(recordDir);
  return "ok" in state ? constructionWalkOf(state.value) : "unknown";
}

/**
 * Every intent in the active space, concatenated — the sample pool an estimate
 * draws on. An intent that cannot be read is a warning, not a failure: a
 * partial pool still estimates (BR-RC-5).
 *
 * Each run is stamped with its intent's Construction walk, so a per-Unit
 * stage is sized only from workflows that walked the same way (issue #167).
 */
export async function getStageTimingSamples(
  rootPath: string,
  now: number,
  policy: TimingPolicy = DEFAULT_TIMING_POLICY,
  space?: string,
): Promise<ReadResult<StageTiming[]>> {
  const intents = await resolveIntents(rootPath, space);
  if (!("ok" in intents)) return intents;

  const dir = intentsDirOf(rootPath, intents.value.space);
  const samples: StageTiming[] = [];
  const warnings: string[] = [];

  // Intents are independent records: read them concurrently — bounded, since
  // each read itself fans out over that record's audit shards — then assemble
  // in the enumeration order so the pool stays deterministic (R-RC-5). This
  // runs per change push and from two 30s pollers, so the serialization would
  // be paid constantly; the bound keeps worst-case file handles at
  // INTENT_READ_CONCURRENCY × shard concurrency.
  const reads = await mapBounded(intents.value.all, INTENT_READ_CONCURRENCY, async (name) => {
    const record = path.join(dir, name);
    const [read, walk] = await Promise.all([
      getStageTimings(record, now, policy),
      recordWalk(record),
    ]);
    return { read, walk };
  });
  for (const [index, { read, walk }] of reads.entries()) {
    const name = intents.value.all[index] as string;
    if (!("ok" in read)) {
      warnings.push(`intent skipped: ${name}`);
      continue;
    }
    samples.push(...withConstructionWalk(read.value, walk));
    for (const warning of read.warnings ?? []) warnings.push(`${name}: ${warning}`);
  }

  return withWarnings(samples, warnings);
}
