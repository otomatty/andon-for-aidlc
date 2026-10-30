import type { AuditEvent, StageTiming } from "@andon/shared-types";
import { attributeRuns } from "../src/timing/attribution.ts";
import { pairRuns } from "../src/timing/pairing.ts";

type LegacyTiming = Omit<StageTiming, "activeMs" | "wallMs"> & { activeMs: number; wallMs: number };

/**
 * L3 — stage run derivation. Pure: no filesystem, no clock. `now` is injected
 * so an open run measures deterministically under test.
 *
 * Nothing is recorded to produce this. The audit log already holds every
 * STAGE_STARTED/STAGE_COMPLETED pair; this only pairs them up.
 *
 * Composition only, split (issue #5) out of a single 544-line file that used
 * to interleave two concerns in one event loop: PAIRING (which events
 * open/close/discard a run, under cross-shard clock skew, reruns, single-
 * stage isolation — `./pairing.ts`) and ATTRIBUTION (which open run owns
 * each slice of the timeline, under concurrent unit-major runs and silent
 * tails — `./attribution.ts`). Across ~15 external-review rounds a fix to one
 * concern kept breaking the other; each is now independently testable. This
 * file's own job is just: run pairing, run attribution over its output,
 * merge warnings, assemble `LegacyTiming[]` in the order the original
 * single-loop would have pushed them.
 */
export { IDLE_THRESHOLD_MS } from "../src/timing/attribution.ts";

export function deriveLegacyTimings(
  events: readonly AuditEvent[],
  now: number,
): { timings: LegacyTiming[]; warnings: string[] } {
  const pairing = pairRuns(events);
  const attribution = attributeRuns(pairing.events, pairing.boundaries, now);

  // Only these three dispositions are ever reported: `completed` and
  // `recovered-completed` runs close with a real (possibly zero) duration;
  // `open` runs are measured against `now`. `abandoned`, `skipped` and
  // `recovered-skipped` boundaries exist purely so attribution.ts can
  // correctly soak up the events that landed while they were open (issue #5
  // risk note 2) — they must never surface as a sample in estimate.ts's pool.
  const reportable = pairing.boundaries.filter(
    (b) =>
      b.disposition === "completed" ||
      b.disposition === "recovered-completed" ||
      b.disposition === "open",
  );

  // Reconstruct the original single-loop's push order: every run that
  // closed DURING the loop was pushed in the order it closed (closeIndex is
  // monotonic across the loop, since events are processed strictly in
  // order), and only after the loop finished did the still-open runs get
  // appended, in the `openRuns` map's own insertion order — which for a
  // boundary that's still open (never abandoned-and-reopened) is exactly
  // its own openIndex order.
  reportable.sort((a, b) => {
    const aClosed = a.closeIndex !== null;
    const bClosed = b.closeIndex !== null;
    if (aClosed !== bClosed) return aClosed ? -1 : 1;
    return (a.closeIndex ?? a.openIndex ?? 0) - (b.closeIndex ?? b.openIndex ?? 0);
  });

  const timings: LegacyTiming[] = reportable.map((boundary) => {
    const result = attribution.results.get(boundary);
    return {
      stage: boundary.stage,
      startedAt: boundary.startedAt,
      endedAt: boundary.endedAt,
      wallMs: result?.wallMs ?? 0,
      activeMs: result?.activeMs ?? 0,
      eventCount: result?.eventCount ?? 0,
    };
  });

  return { timings, warnings: [...pairing.warnings, ...attribution.warnings] };
}
