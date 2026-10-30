import { readdir } from "node:fs/promises";
import path from "node:path";
import { mapBounded, readBounded } from "@andon/core-utils";
import type { AuditEvent, ReadResult } from "@andon/shared-types";
import { parseMeasurementBlocks, TIMING_FIELDS } from "./measurement-events.ts";

/**
 * L3 — audit shard extraction. Shards are per-clone Markdown files whose
 * records are `---`-separated blocks of `**Field**: value` lines. Only the
 * fields the model needs are kept; bodies are never retained (BR-RC-6).
 * Scope fields identify gates and child Units; append position preserves
 * same-shard ordering. The shared parser drops prompts and feedback bodies.
 */

export const AUDIT_DIRNAME = "audit";

/** At most this many shard files in flight per record (each up to ~10MB). */
const SHARD_READ_CONCURRENCY = 4;

/**
 * `Date.parse(event.timestamp)`, parsed once per event object. The two sort
 * comparators alone would otherwise parse O(n log n) times per read, and
 * pairing/attribution each once more; a WeakMap keeps the cache exactly as
 * long as the events it describes.
 */
const parsedTimes = new WeakMap<AuditEvent, number>();
export function timeOf(event: AuditEvent): number {
  let time = parsedTimes.get(event);
  if (time === undefined) {
    time = Date.parse(event.timestamp);
    parsedTimes.set(event, time);
  }
  return time;
}

/**
 * Shared by this module's descending merge and `../timing/derive.ts`'s
 * ascending sort, so there is exactly one definition of "same instant" for
 * two events. The engine stamps a stage's STAGE_COMPLETED and the next
 * stage's STAGE_STARTED with the same second, and same-shard append order
 * says which came first. If the two sort sites disagreed
 * on which pairs of events tie, they could silently invert that ordering. Time
 * is compared numerically (`Date.parse`), never by string equality, so an
 * offset or millisecond timestamp form still ties correctly.
 *
 * `Date.parse` returns `NaN` for a malformed timestamp, and `NaN` comparisons
 * are always false — a comparator that returns `NaN` is not a total order,
 * and `Array.prototype.sort` is free to leave unrelated well-formed events
 * out of order around it (regression, finding 1: this used to compare
 * timestamp *strings*, which never produced `NaN`). Every malformed
 * timestamp is partitioned to a fixed position — after every well-formed one
 * — in *both* comparators, independent of direction, so it can never sit
 * between two well-formed events and corrupt their relative order. Ties
 * within that partition (two malformed events, or two equal well-formed
 * ones) still fall back to shard name and then recorded append position.
 */
function compareCore(a: AuditEvent, b: AuditEvent, direction: 1 | -1): number {
  const aTime = timeOf(a);
  const bTime = timeOf(b);
  const aValid = !Number.isNaN(aTime);
  const bValid = !Number.isNaN(bTime);
  if (aValid && bValid) {
    const delta = direction * (aTime - bTime);
    return delta !== 0
      ? delta
      : a.shard.localeCompare(b.shard) || (a.position ?? 0) - (b.position ?? 0);
  }
  if (aValid !== bValid) return aValid ? -1 : 1; // malformed always sorts last
  return a.shard.localeCompare(b.shard) || (a.position ?? 0) - (b.position ?? 0); // both malformed
}

/** Ascending by parsed time, then shard name and same-shard append position. */
export function compareByTime(a: AuditEvent, b: AuditEvent): number {
  return compareCore(a, b, 1);
}

/** Descending by parsed time; the tiebreak stays ascending shard either way. */
function compareByTimeDescending(a: AuditEvent, b: AuditEvent): number {
  return compareCore(a, b, -1);
}

/**
 * Newest-first merge across shards, unbounded.
 *
 * A shard that cannot be read is skipped and reported in `warnings` — the
 * remaining shards still produce a usable timeline (failure mode 5 / BR-RC-5).
 */
export async function readAllAuditEvents(recordDir: string): Promise<ReadResult<AuditEvent[]>> {
  const dir = path.join(recordDir, AUDIT_DIRNAME);

  let shards: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    // Selected by name only, not by `isFile()`: anything occupying a shard name
    // that turns out not to be a readable file becomes a visible warning below
    // rather than a silent omission from the timeline.
    shards = entries
      .filter((e) => e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort(); // R-RC-5
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: [] }; // no audit dir = no events, not an error
    return { ok: true, value: [], warnings: ["audit directory could not be read"] };
  }

  const events: AuditEvent[] = [];
  const warnings: string[] = [];

  // Shards are independent files: read them concurrently — but bounded, since
  // a shard can be ~10MB and this runs nested inside the per-intent read —
  // then assemble in sorted-name order so the result stays deterministic
  // (R-RC-5).
  const reads = await mapBounded(shards, SHARD_READ_CONCURRENCY, (shard) =>
    readBounded(path.join(dir, shard)),
  );
  for (const [index, read] of reads.entries()) {
    const shard = shards[index] as string;
    if (!read.ok) {
      warnings.push(`audit shard skipped: ${shard} (${read.reason})`);
      continue;
    }
    const parsed = parseMeasurementBlocks(read.value, shard, TIMING_FIELDS);
    warnings.push(...parsed.warnings);
    for (const entry of parsed.events) {
      events.push({
        event: entry.event,
        stage: entry.fields.Stage ?? entry.fields["Stage slug"] ?? null,
        timestamp: entry.timestamp,
        shard,
        workflow: entry.fields.Workflow ?? null,
        position: entry.position,
        fields: entry.fields,
      });
    }
  }

  // R-RC-5: timestamp descending, shard name ascending as the tiebreak, so the
  // same filesystem always yields the same order.
  events.sort(compareByTimeDescending);

  return warnings.length > 0 ? { ok: true, value: events, warnings } : { ok: true, value: events };
}

/** The bounded read every UI surface uses. `limit <= 0` yields an empty timeline. */
export async function readAuditEvents(
  recordDir: string,
  limit: number,
): Promise<ReadResult<AuditEvent[]>> {
  const all = await readAllAuditEvents(recordDir);
  if (!("ok" in all)) return all;
  const value = limit > 0 ? all.value.slice(0, limit) : [];
  return all.warnings === undefined
    ? { ok: true, value }
    : { ok: true, value, warnings: all.warnings };
}
