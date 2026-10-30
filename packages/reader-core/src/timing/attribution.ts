import type { AuditEvent } from "@andon/shared-types";
import { timeOf } from "../audit/events.ts";
import type { RunBoundary } from "./pairing.ts";

/**
 * L3 — time attribution (pass 2 of 2). Pure aside from the injected `now`:
 * no filesystem, no clock read of its own. Given pass 1's (`./pairing.ts`)
 * sorted event stream and run boundaries, decides which open run accrues
 * each interval of wall time, under concurrent unit-major runs, silent
 * tails, and pre-start events. Knows nothing about *pairing* decisions — it
 * never opens, closes, abandons or discards a run; it only walks the
 * boundaries pass 1 already decided and bills time against them.
 *
 * FORM (issue #8): a TIMELINE PARTITION, not per-run cursors.
 *
 * This file used to give every open run its own cursor (`prevMs`) and add an
 * increment to it per event. In that shape `Σ activeMs <= wall time` was an
 * invariant maintained by DISCIPLINE — every code path had to remember that a
 * span already billed to one run must not also reach another — and review
 * broke it six times running (PR #4 rounds R7, R9, R10, R14 and two more):
 * a gap billed to two runs at once, a tail billed to every open run, an
 * event landing before its own stage started, a tail whose owner never moved
 * when work did. Each fix closed one variant and left the shape that
 * generated them intact.
 *
 * The shape here cannot express those bugs. The span between two adjacent
 * instants — two adjacent events, or the last event and `now` — is a SLICE,
 * and the timeline is exactly the ordered list of its slices: they tile
 * `[first event, now]` end to end, no gaps, no overlaps (every instant is
 * clamped to `now`, so nothing is cut past the moment being read at). Each slice is
 * capped at `IDLE_THRESHOLD_MS` and handed to AT MOST ONE owner
 * (`sliceOwner` below), then folded. No run holds a cursor, so no run can
 * reach back over a span someone else was already given; time that belongs
 * to nobody is dropped rather than shared out.
 *
 * What is left is one question — "who owns this slice?" — answered by one
 * pure function over plain data. The six historical bugs all collapse into
 * that single decision, so that is where the exhaustive tests point
 * (`tests/timing-slice-owner.test.ts`). A wrong answer there misdelivers a
 * slice; it can no longer make wall time appear or vanish.
 */

/**
 * Gaps longer than this are treated as the human being away.
 *
 * ponytail: each slice is CAPPED at this value rather than dropped. A stage
 * that spends 26 minutes on one silent generation emits few audit events;
 * dropping over-threshold slices would report it as ~1 minute and erase the
 * very number this feature exists to show. Capping bounds the error at one
 * threshold per slice in both directions. Tune if stages start emitting
 * events on a different cadence.
 *
 * Historical cap kept for regression comparisons. Production uses policy.ts.
 */
export const IDLE_THRESHOLD_MS = 10 * 60_000;

/**
 * One slice of the timeline: the half-open span between two adjacent
 * instants, and the at-most-one run that owns it.
 *
 * `owner: null` is an ordinary, common outcome, not an error — the slice's
 * time is simply dropped. Handing an unowned slice to "whoever happens to be
 * open" is precisely what R9 (a tail added to every open run) and R10 (an
 * event that landed before its own stage started, billed to an unrelated
 * still-open stage) did.
 */
export interface TimelineSlice {
  fromMs: number;
  /** Always `>= fromMs`: both ends are event instants clamped to `now` (see
   *  `partitionTimeline`), and pass 1 sorted the events. */
  toMs: number;
  owner: RunBoundary | null;
}

/**
 * One run's non-time facts, all decided during the partition sweep.
 *
 * `activeMs` is deliberately absent: it is not knowable during the sweep, only
 * by folding the slices this run owns. Keeping it out is what stops a sweep
 * that walks runs from quietly re-acquiring a per-run cursor.
 */
export interface RunTimeline {
  boundary: RunBoundary;
  wallMs: number;
  eventCount: number;
  /** Still open at `now` — its `wallMs` is measured against `now` rather than
   *  against a closing event, and it is the only kind of run that can own the
   *  tail slice. */
  openAtNow: boolean;
}

export interface TimelinePartition {
  /** In timeline order, tiling `[first event, now]` exactly once. Empty when
   *  there are no events (nothing to partition, and nothing can be open). */
  slices: TimelineSlice[];
  /** Every boundary the sweep resolved — closed, still open, or never opened
   *  (`recovered-*`). Runs pass 1 produced but that never occupied a slot
   *  are included with zero counts, so no boundary silently disappears. */
  runs: RunTimeline[];
  warnings: string[];
}

export interface RunAttribution {
  wallMs: number;
  activeMs: number;
  eventCount: number;
}

export interface AttributionResult {
  /** Every boundary pass 1 produced gets an entry, including
   *  `abandoned`/`skipped` ones — composition in `derive.ts` decides which
   *  dispositions are worth reporting. */
  results: Map<RunBoundary, RunAttribution>;
  warnings: string[];
}

export interface SliceOwnerInput {
  /** The event that ENDS the slice. A slice is owned by whoever the event
   *  closing it is evidence of work by — nothing is decided from the event
   *  that opened it, which may predate the owner's own existence. */
  event: Pick<AuditEvent, "event" | "stage">;
  /** The stage whose open run this very event closes with `completed`, else
   *  `null`. Passed in rather than re-derived: which events close which run
   *  is pass 1's decision, not this function's. */
  completes: string | null;
  /** The stages with an open run, in open order — the last one yielded is the
   *  most recently opened. (Pass 1 and the sweep below both maintain that
   *  order through a `Map`, where re-inserting a key moves it to the end.) */
  openStages: Iterable<string>;
}

/**
 * THE decision. Returns the stage whose open run owns this slice, or `null`
 * for an unowned slice. The returned stage is always one of `openStages`.
 *
 * Only lifecycle events (STARTED/COMPLETED/SKIPPED) carry a `**Stage**` field
 * in the audit log — everything else (ARTIFACT_CREATED, sensor events, ...)
 * is written with `stage: null`. So "credit an event to every open run when
 * it names no stage" would, in practice, credit *every* concurrently-open
 * design stage with *all* of the block's wall time. The rules, in the order
 * they are applied:
 *
 * 1. STAGE_COMPLETED owns the slice for the run it closes, and only that run
 *    — never the most recently opened one, even when it closes nothing (a
 *    completion whose own stage has no open run: the cross-shard skew case
 *    pairing.ts routes to `pendingTerminals`). A completion that names a
 *    stage is evidence of work on THAT stage; giving its slice to some other
 *    open run would double-count the span once the completion later recovers
 *    into its own (typically zero-duration) run via pairing's Part 2.
 * 2. STAGE_STARTED and STAGE_SKIPPED own nothing. A start marks work moving
 *    ONTO a brand-new run — the span before it belongs to whatever came
 *    before, and the new run cannot be billed for time that predates it
 *    (R14's other half). A skip's run is being discarded, not billed.
 * 3. An event that names a stage goes to that stage's open run, or to nobody
 *    if it has none (R10). stage-protocol.md (unit-major iteration) states a
 *    stage's own STAGE_STARTED can legally land AFTER that stage's per-Unit
 *    artifact events, so a stage-keyed event with no open run yet is
 *    expected, not an anomaly — and falling back to the most recently opened
 *    run for it would charge the slice to a DIFFERENT, earlier stage that is
 *    merely still open for its own late cascade gate, stealing both activeMs
 *    and eventCount from the stage that actually did the work.
 * 4. An event that names no stage (the common case) goes to the most recently
 *    opened run. That matches how unit-major actually executes: within a Unit
 *    the four design stages run one at a time in graph order even though
 *    earlier ones stay open pending their cascade gate, so whichever stage
 *    opened last is the one real work is currently landing against.
 */
export function sliceOwner({ event, completes, openStages }: SliceOwnerInput): string | null {
  // One pass over the open set answers all three questions the rules ask of
  // it: is `completes` open, is `event.stage` open, and which stage opened
  // last.
  let mostRecentlyOpened: string | null = null;
  let completesIsOpen = false;
  let eventStageIsOpen = false;
  for (const stage of openStages) {
    mostRecentlyOpened = stage;
    if (stage === completes) completesIsOpen = true;
    if (stage === event.stage) eventStageIsOpen = true;
  }

  if (event.event === "STAGE_COMPLETED") return completesIsOpen ? completes : null;
  if (event.event === "STAGE_STARTED" || event.event === "STAGE_SKIPPED") return null;
  if (event.stage !== null) return eventStageIsOpen ? event.stage : null;
  return mostRecentlyOpened;
}

/**
 * Cuts the timeline into slices and decides each one's owner, without adding
 * a single millisecond up. Exported because the partition, not the totals, is
 * where this module's guarantee lives: a test can assert directly that the
 * slices tile the timeline exactly once (`tests/timing-attribution.test.ts`),
 * which is the property the old cursor form could only be argued to have.
 */
export function partitionTimeline(
  events: readonly AuditEvent[],
  boundaries: readonly RunBoundary[],
  now: number,
): TimelinePartition {
  const warnings: string[] = [];
  const slices: TimelineSlice[] = [];
  const runs: RunTimeline[] = [];
  const eventCounts = new Map<RunBoundary, number>();

  const openAt = new Map<number, RunBoundary>();
  const closeAt = new Map<number, RunBoundary>();
  for (const boundary of boundaries) {
    if (boundary.openIndex !== null) openAt.set(boundary.openIndex, boundary);
    if (boundary.closeIndex !== null) closeAt.set(boundary.closeIndex, boundary);
    if (boundary.openIndex === null) {
      // `recovered-completed`/`recovered-skipped`: pairing already decided
      // this run's open interval is empty (its terminal was consumed the
      // instant the reversed STAGE_STARTED arrived). It never occupies an
      // `openRuns` slot below, so it can never be a slice's owner — zero
      // `activeMs` falls out of the fold with no special case. `wallMs` still
      // needs the same clock-skew clamp a still-open run's `wallMs` gets: the
      // recovered pair's "end" timestamp is, by construction, at or before
      // its "start" timestamp (that reversal is *why* it needed recovering),
      // so a bare subtraction would go negative.
      const endMs = boundary.endedAt !== null ? Date.parse(boundary.endedAt) : boundary.startMs;
      runs.push({
        boundary,
        wallMs: Math.max(0, endMs - boundary.startMs),
        eventCount: 0,
        openAtNow: false,
      });
    }
  }

  // Currently-open run per stage, driven entirely by the boundaries pass 1
  // already decided (`openAt`/`closeAt`) rather than by re-inspecting event
  // types for pairing decisions. Map iteration order is insertion order, and
  // re-inserting a key (an abandon-then-reopen) moves it to the end — "most
  // recently opened" falls out of a plain `for...of openRuns.keys()` walk in
  // `sliceOwner`, mirroring pairing's own `openBoundaries` map (see the
  // Finding 1 comment there) exactly because this map opens/closes stages in
  // the identical relative sequence.
  const openRuns = new Map<string, RunBoundary>();
  /** Start of the slice ending at the event about to be processed; `null`
   *  until the first event, which therefore ends no slice. (Nothing is open
   *  before it either, so there is no owner to lose.) */
  let sliceStartMs: number | null = null;
  // The run work is currently landing against — the last run to either be
  // handed a slice or open. It is the tail's candidate owner, and it is NOT
  // simply "the most recently opened run" (R11 finding 2): during unit-major's
  // late gate cascade a stage-keyed event can own a slice while a
  // later-opened stage sits idle waiting on its own gate, and handing the
  // tail to the idle stage just because it opened later credits a stage that
  // never did any of the work. Nor is it "the last run handed a slice" (R14):
  // a stage that opens and then goes silent all the way to `now` IS the run
  // that is working, even though nothing has been billed to it yet.
  let workingRun: RunBoundary | undefined;
  // Events whose timestamp is past `now`, aggregated (PR#14 review). Their
  // span is silently dropped by the clamp below, and silence is what let this
  // whole class of bug live: the only skew warning that existed fired for a
  // RUN starting after `now`, so a log written by a clone whose clock is ahead
  // produced no warning at all while time went missing. Aggregated rather than
  // one-per-event on purpose — skew affects a whole shard at once, so a
  // per-event warning would emit a wall of identical lines into a UI that
  // shows them verbatim.
  let clampedEvents = 0;
  let maxAheadMs = 0;

  /**
   * Records a run's close and frees its stage slot. Both call sites are
   * identical (PR#14 review); only WHEN they run differs — before this
   * instant's slice for an abandoned/skipped run, after it for a completed
   * one — and that ordering stays at the call sites where it is explained.
   */
  function closeRun(closing: RunBoundary, at: number): void {
    if (openRuns.get(closing.stage) === closing) {
      runs.push({
        boundary: closing,
        wallMs: at - closing.startMs,
        eventCount: eventCounts.get(closing) ?? 0,
        openAtNow: false,
      });
    }
    openRuns.delete(closing.stage);
  }

  for (const [index, event] of events.entries()) {
    const at = timeOf(event); // always valid: pairing already rejected NaN timestamps
    // The timeline ENDS at `now`. The reader's clock and the writer's are not
    // the same clock, so events can carry timestamps past the moment we are
    // reading at — and the span between two of them is time this read cannot
    // observe. Clamping every instant to `now` is what keeps the partition a
    // partition of `[…, now]`: without it the slices ran past `now` while each
    // run's `wallMs` stopped there, so two runs holding disjoint post-`now`
    // slices could each report a full window's worth of activity inside a
    // window only half that long. (Found by P6/P2's generator, and present in
    // the per-run-cursor form this file replaced — the same class as R7/R9,
    // reachable there through the same "billed outside the measured window"
    // door.) A closed run's `wallMs` is deliberately NOT clamped: it is
    // start→end arithmetic over the writer's own timestamps, a fact of the
    // log, whereas active accounting is bounded by what this read can see.
    const instant = Math.min(at, now);
    if (at > now) {
      clampedEvents += 1;
      maxAheadMs = Math.max(maxAheadMs, at - now);
    }
    const closing = closeAt.get(index);
    const opening = openAt.get(index);

    // (1) Structural removal of an abandoned/skipped boundary happens BEFORE
    // this instant's slice is assigned, mirroring the original single-loop's
    // delete-then-advance order for a double-START. (Observably identical
    // either way — such a run can never own the slice ending at the event
    // that discards it, since rule 2 above gives STARTED/SKIPPED no owner —
    // but a closed-then-billed `recovered-*` boundary never reaches here at
    // all, since `openIndex === null` for those means it was never inserted
    // into `openRuns` to begin with.)
    if (
      closing !== undefined &&
      closing.disposition !== "completed" &&
      closing.openIndex !== null
    ) {
      closeRun(closing, at);
    }

    // (2) The one place a mid-stream slice is created: exactly one per
    // adjacent pair of events, handed to exactly one owner or to nobody.
    // Double-billing is not expressible here — there is nowhere to say it.
    const ownerStage = sliceOwner({
      event,
      completes: closing?.disposition === "completed" ? closing.stage : null,
      openStages: openRuns.keys(),
    });
    const owner = ownerStage === null ? null : (openRuns.get(ownerStage) ?? null);
    if (sliceStartMs !== null) slices.push({ fromMs: sliceStartMs, toMs: instant, owner });
    sliceStartMs = instant;

    if (owner !== null) {
      // An event counts towards the run it hands its slice to — the same
      // single decision drives both, so eventCount can never describe a
      // different run than activeMs does.
      eventCounts.set(owner, (eventCounts.get(owner) ?? 0) + 1);
      workingRun = owner;
    }

    // (3) A completed close happens AFTER the slice is assigned: the
    // STAGE_COMPLETED's own slice belongs to the run it closes (rule 1), so
    // that run has to still be open when `sliceOwner` runs.
    if (closing !== undefined && closing.disposition === "completed") {
      closeRun(closing, at);
    }

    // (4) A run opens only after this instant's slice has been handed out, so
    // it can never be billed for the span that preceded its own start.
    if (opening !== undefined) {
      openRuns.set(opening.stage, opening);
      workingRun = opening;
    }
  }

  // The tail slice — last event to `now` — is the one slice no event closes,
  // so its owner is "who is working", not "who does the next event name". It
  // is still ONE slice with at most one owner: R9's "every open run bills the
  // tail" is as unrepresentable here as any other double-billing.
  //
  // The `workingRun` guard is identity against the stage's current slot, not
  // mere presence: if that run has since closed — or is no longer the run
  // occupying its stage's slot — no still-open run was ever actually working,
  // so this falls back to the most recently opened one, same as when nothing
  // has been attributed at all.
  const tailOwner =
    workingRun !== undefined && openRuns.get(workingRun.stage) === workingRun
      ? workingRun
      : (mostRecentlyOpened(openRuns) ?? null);
  if (sliceStartMs !== null) slices.push({ fromMs: sliceStartMs, toMs: now, owner: tailOwner });

  if (clampedEvents > 0) {
    warnings.push(
      `clock skew: ${clampedEvents} event(s) are timestamped after now (up to ${Math.round(maxAheadMs / 1000)}s ahead); the span past now is not counted toward any run`,
    );
  }

  for (const boundary of openRuns.values()) {
    // The reader's clock and the writer's clock are not the same clock; a
    // negative elapsed is skew, not a negative duration.
    if (now < boundary.startMs) {
      warnings.push(`clock skew: run ${boundary.stage} starts after now, wallMs clamped to 0`);
    }
    runs.push({
      boundary,
      wallMs: Math.max(0, now - boundary.startMs),
      eventCount: eventCounts.get(boundary) ?? 0,
      openAtNow: true,
    });
  }

  return { slices, runs, warnings };
}

/** Last-inserted (= most recently opened) run still open. */
function mostRecentlyOpened(openRuns: ReadonlyMap<string, RunBoundary>): RunBoundary | undefined {
  let last: RunBoundary | undefined;
  for (const boundary of openRuns.values()) last = boundary;
  return last;
}

export function attributeRuns(
  events: readonly AuditEvent[],
  boundaries: readonly RunBoundary[],
  now: number,
): AttributionResult {
  const { slices, runs, warnings } = partitionTimeline(events, boundaries, now);

  // The fold. Every slice is added once, to one run, capped — so
  // `Σ activeMs <= Σ slice widths = the wall span the slices tile` holds by
  // construction rather than by every future edit remembering to preserve it.
  const activeMs = new Map<RunBoundary, number>();
  for (const slice of slices) {
    if (slice.owner === null) continue;
    // `Math.max(0, …)` should never bind: both ends are sorted instants
    // clamped to `now`, including the tail's. It stays as the one guard worth
    // keeping — a negative width would SUBTRACT time from a run, silently
    // corrupting a total rather than failing a test.
    const width = Math.min(Math.max(0, slice.toMs - slice.fromMs), IDLE_THRESHOLD_MS);
    activeMs.set(slice.owner, (activeMs.get(slice.owner) ?? 0) + width);
  }

  const results = new Map<RunBoundary, RunAttribution>();
  for (const run of runs) {
    // No `Math.min(…, wallMs)` here, deliberately. `activeMs <= wallMs` is a
    // consequence of the partition, not something re-imposed at the end: the
    // slices a run can own are the ones cut at events after its own open and
    // no later than its close (plus the tail, which only a still-open run can
    // own), they are disjoint, and every instant is clamped to `now`. So they
    // all lie inside `[startMs, min(end, now)]`, whose width is at most this
    // run's `wallMs` — for an open run because `wallMs` IS `now - startMs`,
    // for a closed one because its close is its `wallMs` end. Clamping again
    // would only hide a partition that had stopped being one; P1/P6 check the
    // real thing instead.
    results.set(run.boundary, {
      wallMs: run.wallMs,
      activeMs: activeMs.get(run.boundary) ?? 0,
      eventCount: run.eventCount,
    });
  }

  return { results, warnings };
}
