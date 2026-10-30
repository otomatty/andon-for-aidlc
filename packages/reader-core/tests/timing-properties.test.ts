import type { AuditEvent, StageInfo, WorkflowModel } from "@andon/shared-types";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { attributeRuns, partitionTimeline } from "../src/timing/attribution.ts";
import { deriveStageTimings } from "../src/timing/derive.ts";
import { estimateRemaining } from "../src/timing/estimate.ts";
import { pairRuns, type RunBoundary } from "../src/timing/pairing.ts";
import { resolveStageViews } from "../src/timing/stage-view.ts";

/**
 * Property-based adversarial search over the timing pipeline (issue #7).
 *
 * PR #4 took ~15 external-review rounds and ~20 findings, most of which were
 * the reviewer generating a protocol-legal event sequence and hunting for the
 * combination that broke an invariant. That search is mechanical, so this
 * file mechanises it: generate a legal trace, inject the corruptions a real
 * multi-clone audit log suffers (shard split, clock skew, dropped events,
 * missing `Stage` fields, same-second collisions), run `pairRuns` →
 * `attributeRuns`, and assert the invariants below. fast-check shrinks any
 * violation to a minimal counterexample.
 *
 * The invariant list IS the specification — each row names the round that
 * broke it:
 *   P1  0 <= activeMs <= wallMs, every run                    (R3)
 *   P2  sum(activeMs) <= the wall span the runs jointly cover (R9)
 *   P3  conservation: every STAGE_STARTED lands in exactly one
 *       of closed / abandoned-with-warning / open, and no run
 *       stays open past a terminal event for its own stage     (R4, R11, skips)
 *   P4  a workflow whose stages all finished has remaining 0  (R13, R15)
 *   P5  determinism: an order-preserving shard re-split does
 *       not change the derived result                          (R4)
 *   P6  the timeline partition tiles [first event, now] exactly
 *       once, and no run is billed outside it                  (R7, R9, R10, R14)
 *
 * P1-P5 predate the attribution rewrite (issue #8) and were the net it was
 * done under: they constrain the OUTPUT. P6 was added with it and constrains
 * the FORM — it is the machine-checked statement of why R7/R9/R10/R14 can no
 * longer be written, and it covers the abandoned and skipped runs P2 never
 * sees because `derive.ts` does not report them.
 */

const T0 = Date.parse("2026-07-20T00:00:00Z");
const STAGES = ["alpha", "bravo", "charlie", "delta"] as const;

/** Pre-serialisation event: absolute ms, no shard yet (corruption assigns it). */
interface RawEvent {
  event: string;
  stage: string | null;
  at: number;
  workflow: string | null;
}

interface Step {
  kind: "start" | "work" | "close" | "skip-unstarted" | "single";
  stage: number;
  which: number;
  flag: boolean;
  gapS: number;
}

/**
 * Weighted, not uniform. A uniform kind draw spent most of its traces on
 * orphaned skips and left `completed` runs, concurrent runs and the clock-skew
 * recovery paths barely exercised — a generator that never reaches the
 * interesting states is a vacuous net. `generator reach` below is the guard
 * that keeps these weights honest.
 */
const kindArb = fc.oneof(
  { weight: 6, arbitrary: fc.constant("start" as const) },
  { weight: 6, arbitrary: fc.constant("work" as const) },
  { weight: 5, arbitrary: fc.constant("close" as const) },
  { weight: 1, arbitrary: fc.constant("skip-unstarted" as const) },
  { weight: 2, arbitrary: fc.constant("single" as const) },
);

function stepArb(minGapS: number): fc.Arbitrary<Step> {
  return fc.record({
    kind: kindArb,
    stage: fc.nat(STAGES.length - 1),
    which: fc.nat(STAGES.length - 1),
    flag: fc.boolean(),
    gapS: fc.oneof(
      // Mostly tight, so same-second ties and skew-induced reordering are
      // common rather than freak events...
      { weight: 3, arbitrary: fc.integer({ min: minGapS, max: 120 }) },
      // ...but long enough, often enough, to land on both sides of
      // IDLE_THRESHOLD_MS.
      { weight: 1, arbitrary: fc.integer({ min: minGapS, max: 1800 }) },
    ),
  });
}

function stageAt(index: number): string {
  return STAGES[index % STAGES.length] as string;
}

/**
 * Interprets steps against the live set of open stages so the trace stays
 * protocol-LEGAL: no stage double-starts, nothing closes that never opened,
 * several stages may be open at once (unit-major iteration), a stage may be
 * re-run after it closed (backward jump), and `single-stage:` pairs interleave
 * with the main workflow. Everything illegal is injected later, by `corrupt`.
 */
function buildTrace(steps: readonly Step[], distinct: boolean): RawEvent[] {
  const out: RawEvent[] = [];
  const open: string[] = [];
  let clock = T0;

  for (const step of steps) {
    clock += step.gapS * 1000;
    switch (step.kind) {
      case "start": {
        const stage = stageAt(step.stage);
        if (open.includes(stage)) break;
        out.push({ event: "STAGE_STARTED", stage, at: clock, workflow: null });
        open.push(stage);
        break;
      }
      case "work": {
        // Most audit events carry no `**Stage**` field at all; a stage-keyed
        // one (a sensor fire naming its stage) is the minority case.
        const named = step.flag && open.length > 0;
        const stage = named ? (open[step.which % open.length] as string) : null;
        out.push({ event: "ARTIFACT_CREATED", stage, at: clock, workflow: null });
        break;
      }
      case "close": {
        if (open.length === 0) break;
        const index = step.which % open.length;
        const stage = open[index] as string;
        out.push({
          event: step.flag ? "STAGE_SKIPPED" : "STAGE_COMPLETED",
          stage,
          at: clock,
          workflow: null,
        });
        open.splice(index, 1);
        break;
      }
      case "skip-unstarted": {
        // Conditional skip of an out-of-scope stage: the engine emits
        // STAGE_SKIPPED without ever having started it.
        const stage = stageAt(step.stage);
        if (open.includes(stage)) break;
        out.push({ event: "STAGE_SKIPPED", stage, at: clock, workflow: null });
        break;
      }
      case "single": {
        const stage = stageAt(step.stage);
        const workflow = `single-stage:${stage}`;
        out.push({ event: "STAGE_STARTED", stage, at: clock, workflow });
        clock += 1000;
        out.push({ event: "STAGE_COMPLETED", stage, at: clock, workflow });
        break;
      }
    }
    if (distinct) clock += 1000; // guarantees no two events share a second
  }
  return out;
}

interface Corruption {
  shardCount: number;
  /** Round-robin across shards vs. contiguous blocks — both occur for real. */
  interleave: boolean;
  /** Per-shard clock offset in seconds: clones do not agree on the clock. */
  skewS: number[];
  dropIdx: number[];
  nullStageIdx: number[];
  garbleIdx: number[];
}

const corruptionArb: fc.Arbitrary<Corruption> = fc.record({
  shardCount: fc.integer({ min: 1, max: 3 }),
  interleave: fc.boolean(),
  skewS: fc.array(fc.integer({ min: -300, max: 300 }), { minLength: 3, maxLength: 3 }),
  dropIdx: fc.array(fc.nat(255), { maxLength: 5 }),
  nullStageIdx: fc.array(fc.nat(255), { maxLength: 3 }),
  garbleIdx: fc.array(fc.nat(255), { maxLength: 2 }),
});

function toShards(raw: readonly RawEvent[], shardCount: number, interleave: boolean): AuditEvent[] {
  return raw.map((event, i) => {
    const shard = interleave
      ? i % shardCount
      : Math.min(Math.floor((i * shardCount) / Math.max(raw.length, 1)), shardCount - 1);
    return {
      event: event.event,
      stage: event.stage,
      timestamp: new Date(event.at).toISOString(),
      shard: `${shard}.md`,
      workflow: event.workflow,
    };
  });
}

function corrupt(raw: readonly RawEvent[], c: Corruption): AuditEvent[] {
  const modulus = Math.max(raw.length, 1);
  const dropped = new Set(c.dropIdx.map((n) => n % modulus));
  const nulled = new Set(c.nullStageIdx.map((n) => n % modulus));
  const garbled = new Set(c.garbleIdx.map((n) => n % modulus));

  return toShards(raw, c.shardCount, c.interleave)
    .map((event, i) => {
      const shard = Number(event.shard.slice(0, -3));
      const skewMs = (c.skewS[shard] ?? 0) * 1000;
      return {
        ...event,
        stage: nulled.has(i) ? null : event.stage,
        timestamp: garbled.has(i)
          ? "not-a-timestamp"
          : new Date(Date.parse(event.timestamp) + skewMs).toISOString(),
      };
    })
    .filter((_, i) => !dropped.has(i))
    .reverse(); // readAllAuditEvents hands the pipeline newest-first
}

const traceArb = (minGapS: number, distinct: boolean) =>
  fc
    .array(stepArb(minGapS), { minLength: 1, maxLength: 60 })
    .map((steps) => buildTrace(steps, distinct));

/** Last event's instant, or T0 for an empty trace. */
function lastAt(raw: readonly RawEvent[]): number {
  return raw.reduce((max, e) => Math.max(max, e.at), T0);
}

/**
 * How many runs are open at the SAME time, at the busiest moment (PR#13
 * review). Counting boundaries that merely have an `openIndex` would score
 * three strictly sequential runs as concurrent, which is the shape P2's
 * double-billing bug cannot occur in at all.
 *
 * A boundary occupies `[openIndex, closeIndex)` of pass 1's event array, the
 * same half-open window attribution keeps it in `openRuns` for. Maximum
 * overlap of a set of intervals is always attained at one of their start
 * points, so sampling each `openIndex` is exact, not a heuristic.
 */
function peakConcurrency(boundaries: readonly RunBoundary[]): number {
  const live = boundaries
    .filter((b) => b.openIndex !== null)
    .map((b) => [b.openIndex as number, b.closeIndex ?? Number.POSITIVE_INFINITY] as const);
  let peak = 0;
  for (const [start] of live) {
    peak = Math.max(peak, live.filter(([open, close]) => open <= start && start < close).length);
  }
  return peak;
}

const RUNS = { numRuns: 300 } as const;

describe("timing pipeline invariants (property-based)", () => {
  it("P1: every reported run satisfies 0 <= activeMs <= wallMs", () => {
    fc.assert(
      fc.property(
        traceArb(0, false),
        corruptionArb,
        // now can also land BEFORE the newest event: the reader's clock and
        // the writer's clock are not the same clock.
        fc.integer({ min: -600, max: 3600 }),
        (raw, c, nowGapS) => {
          const { timings } = deriveStageTimings(corrupt(raw, c), lastAt(raw) + nowGapS * 1000);
          for (const t of timings) {
            if (t.activeMs === null) {
              expect(t.quality?.status).toBe("incomplete");
              expect(t.quality?.sampleEligible).toBe(false);
              expect(t.breakdown).toBeNull();
              continue;
            }
            expect(Number.isFinite(t.activeMs)).toBe(true);
            expect(Number.isFinite(t.wallMs)).toBe(true);
            expect(t.activeMs).toBeGreaterThanOrEqual(0);
            expect(t.wallMs).toBeGreaterThanOrEqual(0);
            expect(t.activeMs).toBeLessThanOrEqual(t.wallMs as number);
            const b = t.breakdown;
            expect(b).toBeDefined();
            if (b) {
              expect(Object.values(b).every((value) => value >= 0)).toBe(true);
              expect(
                b.workMs +
                  b.approvalWaitMs +
                  b.suspendedMs +
                  b.excludedGapMs +
                  b.pendingObservationMs +
                  b.unattributedMs,
              ).toBe(b.observedWallMs);
              expect(t.activeMs).toBe(b.workMs);
            }
            expect(t.eventCount).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      RUNS,
    );
  });

  it("P2: summed activeMs never exceeds the wall span the runs jointly cover", () => {
    fc.assert(
      fc.property(
        traceArb(0, false),
        corruptionArb,
        fc.integer({ min: -600, max: 3600 }),
        (raw, c, nowGapS) => {
          const now = lastAt(raw) + nowGapS * 1000;
          const { timings } = deriveStageTimings(corrupt(raw, c), now);
          if (timings.length === 0) return;
          // Concurrent runs (unit-major) overlap, so the bound is the single
          // span they all live inside — not the sum of their own wallMs.
          //
          // `now` is NOT folded into the maximum (PR#13 review): an open run
          // already contributes `now` as its own end, so on the common read
          // path — every run closed, `now` some minutes later — adding it
          // would stretch the bound past the span the runs actually cover and
          // let an over-billing regression slip through.
          const starts = timings.map((t) => Date.parse(t.startedAt));
          const ends = timings.map((t) => (t.endedAt === null ? now : Date.parse(t.endedAt)));
          const span = Math.max(0, Math.max(...ends) - Math.min(...starts));
          const totalActive = timings.reduce((sum, t) => sum + (t.activeMs ?? 0), 0);
          expect(totalActive).toBeLessThanOrEqual(span);
        },
      ),
      RUNS,
    );
  });

  it("P3: every STAGE_STARTED lands in exactly one disposition, and no run outlives its own terminal event", () => {
    fc.assert(
      fc.property(
        traceArb(0, false),
        corruptionArb,
        fc.integer({ min: -600, max: 3600 }),
        (raw, c, nowGapS) => {
          const events = corrupt(raw, c);
          const pairing = pairRuns(events);
          const attribution = attributeRuns(
            pairing.events,
            pairing.boundaries,
            lastAt(raw) + nowGapS * 1000,
          );

          // Conservation: one boundary per surviving STAGE_STARTED. Pairing
          // rejects three kinds outright (single-stage isolation, unparseable
          // timestamp, missing Stage field); everything else must produce a
          // run with exactly one disposition.
          const surviving = events.filter(
            (e) =>
              e.event === "STAGE_STARTED" &&
              e.workflow?.startsWith("single-stage:") !== true &&
              !Number.isNaN(Date.parse(e.timestamp)) &&
              e.stage !== null,
          );
          expect(pairing.boundaries).toHaveLength(surviving.length);

          const openPerStage = new Map<string, number>();
          for (const b of pairing.boundaries) {
            // Every boundary is measured — none silently falls out of pass 2.
            expect(attribution.results.has(b)).toBe(true);
            if (b.openIndex !== null && b.closeIndex !== null) {
              expect(b.openIndex).toBeLessThan(b.closeIndex);
            }
            // Only `open` has no close; everything else is resolved.
            expect(b.closeIndex === null).toBe(b.disposition === "open");
            if (b.disposition !== "open") continue;
            openPerStage.set(b.stage, (openPerStage.get(b.stage) ?? 0) + 1);
            // The permanently-open run (R4/R11/skip path): a run left open
            // although a terminal event for its own stage arrived after it.
            const outlived = pairing.events.findIndex(
              (e, i) =>
                i > (b.openIndex ?? -1) &&
                e.stage === b.stage &&
                (e.event === "STAGE_COMPLETED" || e.event === "STAGE_SKIPPED"),
            );
            expect(outlived).toBe(-1);
          }
          for (const count of openPerStage.values()) expect(count).toBe(1);

          // An abandoned run is never silent — it always warns.
          const abandoned = pairing.boundaries.filter((b) => b.disposition === "abandoned");
          const abandonWarnings = pairing.warnings.filter((w) =>
            w.startsWith("stage run abandoned without completion:"),
          );
          expect(abandonWarnings).toHaveLength(abandoned.length);
        },
      ),
      RUNS,
    );
  });

  it("P4: a workflow whose every stage finished has nothing remaining", () => {
    // A SKIPPED stage leaves no run at all (derive discards it), so a model
    // built only from reported timings can never carry a `skipped` status —
    // and R15's actual shape (`Current Stage` parked on a final stage that was
    // skipped, with no run behind it) would go untested while P4 stayed green
    // (PR#13 review). Track that the search really does reach it.
    let skippedCurrentStages = 0;

    fc.assert(
      fc.property(traceArb(1, true), (raw) => {
        // Close whatever the trace left open, so the state file this models
        // ("Status: Completed") and the audit log actually agree.
        const closedAt = lastAt(raw) + 60_000;
        const stillOpen = new Set<string>();
        for (const e of raw) {
          if (e.workflow !== null) continue;
          if (e.event === "STAGE_STARTED") stillOpen.add(e.stage as string);
          if (e.event === "STAGE_COMPLETED" || e.event === "STAGE_SKIPPED") {
            stillOpen.delete(e.stage as string);
          }
        }
        const complete: RawEvent[] = [
          ...raw,
          ...[...stillOpen].map((stage) => ({
            event: "STAGE_COMPLETED",
            stage,
            at: closedAt,
            workflow: null,
          })),
        ];

        // The status each slug ends on, read off the trace rather than off the
        // derived runs: last terminal event wins, so a stage skipped once and
        // genuinely re-run later ends `completed`.
        const finalStatus = new Map<string, "completed" | "skipped">();
        for (const e of complete) {
          if (e.workflow !== null || e.stage === null) continue;
          if (e.event === "STAGE_COMPLETED") finalStatus.set(e.stage, "completed");
          else if (e.event === "STAGE_SKIPPED") finalStatus.set(e.stage, "skipped");
        }

        const { timings } = deriveStageTimings(toShards(complete, 1, false), closedAt + 60_000);
        // Needs at least one closed run: with no samples at all every estimate
        // is `null`, and "nothing remaining" degenerates into "nothing known".
        fc.pre(timings.length > 0);
        // Every reported run closed, so nothing is left in flight.
        expect(timings.every((t) => t.endedAt !== null)).toBe(true);

        // P4's premise is that the state file and the audit log AGREE. A slug
        // the trace ends on `completed` but that has no closed run is the two
        // disagreeing — e.g. an orphan skip recovers the stage's STAGE_STARTED
        // (`recovered-skipped`, run discarded) and its later STAGE_COMPLETED
        // then pairs with nothing. stage-view.ts deliberately bills the FULL
        // estimate there ("Current Stage can advance before a STAGE_STARTED is
        // emitted, so 'no run yet' does not mean 'no work left'"), so folding
        // it into P4 would assert the opposite of a documented behaviour.
        // SKIPPED stages are exempt on purpose: having no run is precisely
        // what they look like, and that is the R15 shape this property exists
        // to pin down.
        const withClosedRun = new Set(timings.map((t) => t.stage));
        fc.pre(
          [...finalStatus].every(
            ([slug, status]) => status !== "completed" || withClosedRun.has(slug),
          ),
        );

        const stages: StageInfo[] = [...finalStatus].map(([slug, status]) => ({
          slug,
          phase: "CONSTRUCTION",
          execution: "EXECUTE",
          status,
        }));
        // Prefer parking `Current Stage` on a skipped slug — that is exactly
        // aidlc-state.ts's final-stage skip path, where Status flips to
        // Completed but Current Stage stays on the stage that was skipped.
        const skipped = stages.filter((s) => s.status === "skipped");
        const current = (skipped[skipped.length - 1] ?? stages[stages.length - 1]) as StageInfo;
        if (current.status === "skipped") skippedCurrentStages += 1;

        const workflow: WorkflowModel = {
          project: "p",
          scope: "feature",
          depth: "practical",
          stateVersion: 8,
          phase: "CONSTRUCTION",
          currentStage: current.slug,
          nextStage: null,
          gate: null,
          stages,
          done: stages.length,
          total: stages.length,
        };

        const views = resolveStageViews(workflow, timings, timings);
        // Completion wins even when no usable historical sample survives.
        expect(views.filter((v) => v.countsTowardRemaining)).toEqual([]);
        expect(views.find((v) => v.isCurrent)?.remainingMs).toBe(0);
        expect(estimateRemaining(views).totalRemainingMs).toBe(0);
      }),
      RUNS,
    );

    expect(skippedCurrentStages).toBeGreaterThan(0);
  });

  it("P5: an order-preserving shard re-split does not change the derived result", () => {
    fc.assert(
      fc.property(
        // Distinct timestamps only: with a same-second tie the shard name IS
        // the documented tiebreak (compareByTime), so re-sharding legitimately
        // reorders. What must never move is everything else.
        traceArb(1, true),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 3600 }),
        (raw, shardsA, shardsB, interleaveB, nowGapS) => {
          const now = lastAt(raw) + nowGapS * 1000;
          const a = deriveStageTimings(toShards(raw, shardsA, false), now);
          const b = deriveStageTimings(toShards(raw, shardsB, interleaveB).reverse(), now);
          expect(b.timings).toEqual(a.timings);
          expect(b.warnings).toEqual(a.warnings);
        },
      ),
      RUNS,
    );
  });
  it("P6: the partition tiles [first event, now] exactly once, and nothing is billed outside it", () => {
    fc.assert(
      fc.property(
        traceArb(0, false),
        corruptionArb,
        fc.integer({ min: -600, max: 3600 }),
        (raw, c, nowGapS) => {
          const now = lastAt(raw) + nowGapS * 1000;
          const pairing = pairRuns(corrupt(raw, c));
          const { slices, runs } = partitionTimeline(pairing.events, pairing.boundaries, now);

          if (pairing.events.length === 0) {
            // Nothing to partition — and with no events, nothing can be open.
            expect(slices).toEqual([]);
            expect(runs.every((r) => !r.openAtNow)).toBe(true);
            return;
          }

          // Contiguous and complete: one slice per adjacent pair of events
          // plus the tail, each starting exactly where the previous ended,
          // spanning the first event through `now` with no gap and no
          // overlap. A slice counted twice, or a span reaching two runs,
          // cannot survive this.
          //
          // Every instant is clamped to `now`, so no slice runs past the
          // moment being read at and none has negative width. Without that,
          // two runs holding disjoint post-`now` slices could each report a
          // full window's worth of activity inside a shorter window — which
          // is exactly what this property caught (and what the per-run-cursor
          // form did too).
          expect(slices).toHaveLength(pairing.events.length);
          const firstMs = Date.parse(pairing.events[0]?.timestamp as string);
          expect(slices[0]?.fromMs).toBe(Math.min(firstMs, now));
          expect(slices.at(-1)?.toMs).toBe(now);
          for (const [i, slice] of slices.entries()) {
            if (i > 0) expect(slice.fromMs).toBe(slices[i - 1]?.toMs);
            expect(slice.toMs).toBeGreaterThanOrEqual(slice.fromMs);
            expect(slice.toMs).toBeLessThanOrEqual(now);
          }

          // Every boundary is resolved exactly once — none is measured twice,
          // none silently falls out of the sweep.
          expect(runs).toHaveLength(pairing.boundaries.length);
          expect(new Set(runs.map((r) => r.boundary)).size).toBe(runs.length);

          // The bound P2 asserts for REPORTED runs, over every run there is:
          // abandoned and skipped ones included, since a run that soaks up
          // time it should not have still steals it from a run that will be
          // reported.
          const { results } = attributeRuns(pairing.events, pairing.boundaries, now);
          const billed = [...results.values()].reduce((sum, r) => sum + r.activeMs, 0);
          const tiled = slices.reduce((sum, s) => sum + Math.max(0, s.toMs - s.fromMs), 0);
          expect(billed).toBeLessThanOrEqual(tiled);

          // Per run, not just in total (PR#14 review): a sum stays within
          // budget even when one run holds a slice from outside its own
          // window — it has simply taken it from another run. P1 pins this
          // for REPORTED runs; here it covers abandoned and skipped ones too,
          // and it is a real structural check rather than a restatement of a
          // clamp: `attributeRuns` no longer clamps `activeMs` to `wallMs`.
          for (const run of results.values()) {
            expect(run.activeMs).toBeLessThanOrEqual(run.wallMs);
          }
        },
      ),
      RUNS,
    );
  });

  /**
   * The properties above are only worth their runtime if the generator
   * actually reaches the states that broke in review. A green suite whose
   * generator stopped producing clock-skew recoveries or concurrent runs is
   * indistinguishable from a green suite that genuinely holds — so assert the
   * reach explicitly. If a future edit to the weights above starves one of
   * these, this fails loudly instead of the net going quietly vacuous.
   *
   * `recovered-completed` is the rarest (~0.4% of cases): it needs a
   * STAGE_COMPLETED to sort BEFORE its own STAGE_STARTED, which takes the pair
   * landing in different shards whose clocks disagree by more than the gap
   * between them. The run count is sized so that even that one is effectively
   * certain rather than seeded — a pinned seed would go stale the moment
   * fast-check's generator changes.
   */
  it("generator reach: the search visits every disposition and every warning class", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        traceArb(0, false),
        corruptionArb,
        fc.integer({ min: -600, max: 3600 }),
        (raw, c, nowGapS) => {
          const events = corrupt(raw, c);
          const pairing = pairRuns(events);
          for (const b of pairing.boundaries) seen.add(`disposition:${b.disposition}`);
          for (const w of pairing.warnings) {
            // Every class is matched POSITIVELY, with no catch-all `else`
            // (PR#13 review): a bare fallback would let a warning class added
            // to pairing.ts later stand in for `warn:orphan-terminal`, so the
            // expectation below would keep passing even if orphan terminals
            // stopped being generated entirely. An unrecognised warning is
            // surfaced verbatim instead, and fails the assertion by name.
            if (w.startsWith("clock skew:")) seen.add("warn:clock-skew");
            else if (w.startsWith("unparseable timestamp:")) seen.add("warn:unparseable");
            else if (w.includes("no Stage field")) seen.add("warn:null-stage");
            else if (w.startsWith("stage run abandoned")) seen.add("warn:abandoned");
            else if (
              w.startsWith("STAGE_COMPLETED without STAGE_STARTED:") ||
              w.startsWith("STAGE_SKIPPED with no open run:")
            ) {
              seen.add("warn:orphan-terminal");
            } else seen.add(`warn:UNCLASSIFIED: ${w}`);
          }
          const { timings } = deriveStageTimings(events, lastAt(raw) + nowGapS * 1000);
          if (timings.length > 1) seen.add("shape:several-runs");
          if (timings.some((t) => t.endedAt === null)) seen.add("shape:open-run");
          // Unit-major: three or more stages open at the SAME time, not
          // merely three runs somewhere in the trace (PR#13 review).
          if (peakConcurrency(pairing.boundaries) > 2) seen.add("shape:concurrent");
        },
      ),
      { numRuns: 4000 },
    );
    expect([...seen].sort()).toEqual([
      "disposition:abandoned",
      "disposition:completed",
      "disposition:open",
      "disposition:recovered-completed",
      "disposition:recovered-skipped",
      "disposition:skipped",
      "shape:concurrent",
      "shape:open-run",
      "shape:several-runs",
      "warn:abandoned",
      "warn:clock-skew",
      "warn:null-stage",
      "warn:orphan-terminal",
      "warn:unparseable",
    ]);
  });
});
