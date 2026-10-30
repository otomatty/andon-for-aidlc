import type { AuditEvent } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { attributeRuns, IDLE_THRESHOLD_MS, partitionTimeline } from "../src/timing/attribution.ts";
import type { RunBoundary } from "../src/timing/pairing.ts";

/**
 * Pass-2-only unit tests: hand-built boundaries + events, no pairing
 * involved. Mirrors what `pairRuns` would have produced for each scenario —
 * see `timing-pairing.test.ts` for proof pairing itself builds these shapes
 * correctly; this file only tests what attribution does with a given shape.
 */

const T0 = Date.parse("2026-07-20T00:00:00Z");
const at = (offsetMin: number) => T0 + offsetMin * 60_000;
const iso = (offsetMin: number) => new Date(at(offsetMin)).toISOString();

function event(kind: string, stage: string | null, offsetMin: number): AuditEvent {
  return { event: kind, stage, timestamp: iso(offsetMin), shard: "a.md", workflow: null };
}

function boundary(
  stage: string,
  openIndex: number | null,
  closeIndex: number | null,
  disposition: RunBoundary["disposition"],
  offsets: { start: number; end?: number },
): RunBoundary {
  return {
    stage,
    startedAt: iso(offsets.start),
    startMs: at(offsets.start),
    openIndex,
    closeIndex,
    endedAt: offsets.end !== undefined ? iso(offsets.end) : null,
    disposition,
  };
}

describe("attributeRuns", () => {
  it("bills a lone open-to-close run every slice in between, one owner per slice", () => {
    const events = [
      event("STAGE_STARTED", "a", 0),
      event("ARTIFACT_CREATED", null, 3),
      event("STAGE_COMPLETED", "a", 5),
    ];
    const b = boundary("a", 0, 2, "completed", { start: 0, end: 5 });
    const { results, warnings } = attributeRuns(events, [b], at(60));
    expect(warnings).toEqual([]);
    expect(results.get(b)).toEqual({ wallMs: 5 * 60_000, activeMs: 5 * 60_000, eventCount: 2 });
  });

  it("splits concurrent open runs so the sum of activeMs over a shared span never exceeds that span's wall time", () => {
    // a opens, b opens while a stays open, one stage-null event lands (goes
    // to the most-recently-opened, b), both close.
    const events = [
      event("STAGE_STARTED", "a", 0),
      event("STAGE_STARTED", "b", 1),
      event("ARTIFACT_CREATED", null, 4),
      event("STAGE_COMPLETED", "b", 6),
      event("STAGE_COMPLETED", "a", 8),
    ];
    const a = boundary("a", 0, 4, "completed", { start: 0, end: 8 });
    const b = boundary("b", 1, 3, "completed", { start: 1, end: 6 });
    const { results, warnings } = attributeRuns(events, [a, b], at(60));
    expect(warnings).toEqual([]);
    const ra = results.get(a);
    const rb = results.get(b);
    expect(ra).toMatchObject({ activeMs: 2 * 60_000 }); // only the +6m..+8m tail-of-loop gap
    expect(rb).toMatchObject({ activeMs: 5 * 60_000 }); // +1m..+4m and +4m..+6m
    expect((ra?.activeMs ?? 0) + (rb?.activeMs ?? 0)).toBeLessThanOrEqual(8 * 60_000);
  });

  it("caps a gap at IDLE_THRESHOLD_MS instead of billing the full silence", () => {
    const events = [event("STAGE_STARTED", "a", 0), event("STAGE_COMPLETED", "a", 30)];
    const b = boundary("a", 0, 1, "completed", { start: 0, end: 30 });
    const { results } = attributeRuns(events, [b], at(60));
    expect(results.get(b)).toMatchObject({ activeMs: IDLE_THRESHOLD_MS, wallMs: 30 * 60_000 });
  });

  it("caps the tail the same way, and gives it only to the last-attributed run", () => {
    const events = [
      event("STAGE_STARTED", "a", 0),
      event("STAGE_STARTED", "b", 1),
      event("ARTIFACT_CREATED", "a", 2),
    ];
    const a = boundary("a", 0, null, "open", { start: 0 });
    const b = boundary("b", 1, null, "open", { start: 1 });
    const { results, warnings } = attributeRuns(events, [a, b], at(7));
    expect(warnings).toEqual([]);
    // The [+0m,+1m) slice ends at b's START and so goes to nobody; the +2m
    // event names "a", so a owns [+1m,+2m) (1m); the tail [+2m,+7m) (5m) is
    // a's too, since a was the run last actually working. b owns no slice at
    // all and gets no tail.
    expect(results.get(a)).toMatchObject({ wallMs: 7 * 60_000, activeMs: 6 * 60_000 });
    expect(results.get(b)).toMatchObject({ wallMs: 6 * 60_000, activeMs: 0 });
  });

  it("makes a run the tail-owner candidate the instant it opens, not just when it's billed an event (Codex round 14)", () => {
    // "a" opens, receives one real event, then "b" opens and everything
    // goes silent. Before the fix, opening a run did not make it the tail's
    // owner, so "a" (last billed before "b" even existed) kept the tail —
    // 12m (2m real + a 10m tail it never earned) — while "b", the stage
    // actually running, showed 0m.
    const events = [
      event("STAGE_STARTED", "a", 0),
      event("ARTIFACT_CREATED", "a", 2),
      event("STAGE_STARTED", "b", 3),
    ];
    const a = boundary("a", 0, null, "open", { start: 0 });
    const b = boundary("b", 2, null, "open", { start: 3 });
    const { results, warnings } = attributeRuns(events, [a, b], at(13));
    expect(warnings).toEqual([]);
    // a bills only its own +0m..+2m gap — no tail.
    expect(results.get(a)).toMatchObject({ wallMs: 13 * 60_000, activeMs: 2 * 60_000 });
    // b gets the full (capped) tail even though nothing ever billed it an
    // event: +3m..+13m is 10m, exactly IDLE_THRESHOLD_MS.
    expect(results.get(b)).toMatchObject({ wallMs: 10 * 60_000, activeMs: IDLE_THRESHOLD_MS });
    const total = (results.get(a)?.activeMs ?? 0) + (results.get(b)?.activeMs ?? 0);
    expect(total).toBeLessThanOrEqual(13 * 60_000);
  });

  it("still lets a later real attribution override the open-time tail candidate (Codex round 11 finding 2 stays intact)", () => {
    // "a" opens, "b" opens later (so "b" is the fresh open-time candidate),
    // but the next event is stage-keyed back to "a" — the earlier-opened
    // run still doing the real work while "b" idles waiting on its own
    // gate. The later, real attribution to "a" must win over "b"'s mere
    // open-time candidacy.
    const events = [
      event("STAGE_STARTED", "a", 0),
      event("STAGE_STARTED", "b", 1),
      event("ARTIFACT_CREATED", "a", 2),
    ];
    const a = boundary("a", 0, null, "open", { start: 0 });
    const b = boundary("b", 1, null, "open", { start: 1 });
    const { results } = attributeRuns(events, [a, b], at(7));
    expect(results.get(a)).toMatchObject({ wallMs: 7 * 60_000, activeMs: 6 * 60_000 });
    expect(results.get(b)).toMatchObject({ wallMs: 6 * 60_000, activeMs: 0 });
  });

  it("gives the tail to the most recently opened run when nothing was ever attributed", () => {
    const events = [event("STAGE_STARTED", "a", 0), event("STAGE_STARTED", "b", 1)];
    const a = boundary("a", 0, null, "open", { start: 0 });
    const b = boundary("b", 1, null, "open", { start: 1 });
    const { results } = attributeRuns(events, [a, b], at(7));
    expect(results.get(a)).toMatchObject({ activeMs: 0 });
    expect(results.get(b)).toMatchObject({ activeMs: 6 * 60_000 }); // +1m..+7m tail
  });

  it("counts nothing outside the observation window when the writer's clock is ahead of the reader's, and warns for both the events and the run", () => {
    const events = [event("STAGE_STARTED", "a", 10), event("ARTIFACT_CREATED", null, 15)];
    const b = boundary("a", 0, null, "open", { start: 10 });
    const { results, warnings } = attributeRuns(events, [b], T0);
    // The events warning is aggregated: one line for the whole read, however
    // many events the skewed shard contributed.
    expect(warnings).toEqual([
      "clock skew: 2 event(s) are timestamped after now (up to 900s ahead); the span past now is not counted toward any run",
      "clock skew: run a starts after now, wallMs clamped to 0",
    ]);
    const r = results.get(b);
    expect(r?.wallMs).toBe(0);
    expect(r?.activeMs).toBe(0);
    expect(r?.activeMs).toBeLessThanOrEqual(r?.wallMs as number);
  });

  it("lets abandoned/skipped boundaries soak up the events that landed while they were open, without ever being reported", () => {
    // f opens (index 0), n opens while f stays open (index 1), an event
    // lands stage-keyed to f (index 2) — must land on f's FIRST attempt, not
    // leak to n — then f double-starts, abandoning attempt 1 (index 3), and
    // both eventually close.
    const events = [
      event("STAGE_STARTED", "f", 0),
      event("STAGE_STARTED", "n", 1),
      event("ARTIFACT_CREATED", "f", 2),
      event("STAGE_STARTED", "f", 3), // abandons attempt 1
      event("STAGE_COMPLETED", "n", 5),
      event("STAGE_COMPLETED", "f", 7),
    ];
    const fFirst = boundary("f", 0, 3, "abandoned", { start: 0 });
    const n = boundary("n", 1, 4, "completed", { start: 1, end: 5 });
    const fSecond = boundary("f", 3, 5, "completed", { start: 3, end: 7 });
    const { results, warnings } = attributeRuns(events, [fFirst, n, fSecond], at(10));
    expect(warnings).toEqual([]);
    // f's first (abandoned) attempt owns only [+1m,+2m) — the slice its own
    // +2m event closes. The [+0m,+1m) slice before it ends at n's START and
    // goes to nobody. Never reported, but the number must exist and be sane
    // (R7 finding 2's "no run reaches back over a span another run was
    // given" applies to a soon-to-be-discarded run too).
    expect(results.get(fFirst)).toMatchObject({ activeMs: 1 * 60_000 });
    // n owns only [+3m,+5m), the slice its own completion closes — not the
    // full +1m..+5m span: the slices f's +2m event and f's own double-start
    // at +3m close named "n" nowhere.
    expect(results.get(n)).toMatchObject({ activeMs: 2 * 60_000 });
    // f's second attempt: opened at +3m, so the first slice it can own is
    // the one n's completion at +5m closes — and it names "n", so f's second
    // attempt owns only [+5m,+7m) (2m).
    expect(results.get(fSecond)).toMatchObject({ activeMs: 2 * 60_000 });
  });

  it("never opens a recovered-completed/recovered-skipped boundary — zero attribution and a wallMs clamped against reversed timestamps", () => {
    const recoveredCompleted = boundary("alpha", null, 1, "recovered-completed", {
      start: 5,
      end: 0,
    });
    const recoveredSkipped = boundary("beta", null, 1, "recovered-skipped", { start: 5, end: 0 });
    const events = [event("STAGE_STARTED", "alpha", 5)];
    const { results } = attributeRuns(events, [recoveredCompleted, recoveredSkipped], at(10));
    expect(results.get(recoveredCompleted)).toEqual({ wallMs: 0, activeMs: 0, eventCount: 0 });
    expect(results.get(recoveredSkipped)).toEqual({ wallMs: 0, activeMs: 0, eventCount: 0 });
  });

  it("attributes a stage-named event with no open run to nobody, not to mostRecentlyOpened", () => {
    // b's boundary opens at index 3; the event at index 1 names "b" but
    // arrives before b's own open — it must be unattributed, not billed to
    // whichever run happens to be open at that point (a).
    const events = [
      event("STAGE_STARTED", "a", 0),
      event("ARTIFACT_CREATED", "b", 2),
      event("STAGE_STARTED", "b", 4),
      event("STAGE_COMPLETED", "b", 6),
      event("STAGE_COMPLETED", "a", 8),
    ];
    const a = boundary("a", 0, 4, "completed", { start: 0, end: 8 });
    const b = boundary("b", 2, 3, "completed", { start: 4, end: 6 });
    const { results } = attributeRuns(events, [a, b], at(10));
    // a only bills the +6m..+8m tail after b closes (2m) — not the +2m
    // pre-start artifact event named for b.
    expect(results.get(a)).toMatchObject({ activeMs: 2 * 60_000, eventCount: 1 });
    expect(results.get(b)).toMatchObject({ activeMs: 2 * 60_000, eventCount: 1 });
  });
});

/**
 * The form itself (issue #8). `attributeRuns` is a fold over the partition, so
 * the guarantee "the same wall time can never reach two runs" is a property of
 * the PARTITION, not of the arithmetic — these assert it directly instead of
 * inferring it from totals, which is what the old per-run-cursor form could
 * only ever do.
 */
describe("partitionTimeline", () => {
  const events = [
    event("STAGE_STARTED", "a", 0),
    event("ARTIFACT_CREATED", "z", 1), // names a stage with no open run: unowned
    event("STAGE_STARTED", "b", 2),
    event("ARTIFACT_CREATED", null, 4),
    event("STAGE_COMPLETED", "b", 6),
  ];
  const a = boundary("a", 0, null, "open", { start: 0 });
  const b = boundary("b", 2, 4, "completed", { start: 2, end: 6 });

  it("tiles [first event, now] exactly once — contiguous, in order, no gaps and no overlaps", () => {
    const { slices } = partitionTimeline(events, [a, b], at(9));
    // One slice per adjacent pair of events, plus the tail. The first event
    // ends no slice: there is no earlier instant, and nothing is open yet.
    expect(slices).toHaveLength(events.length);
    expect(slices[0]?.fromMs).toBe(at(0));
    expect(slices.at(-1)?.toMs).toBe(at(9));
    for (const [i, slice] of slices.entries()) {
      if (i > 0) expect(slice.fromMs).toBe(slices[i - 1]?.toMs);
    }
    // Total tiled span == the wall span from the first event to `now`, so no
    // interval is covered twice and none is missing.
    const tiled = slices.reduce((sum, s) => sum + (s.toMs - s.fromMs), 0);
    expect(tiled).toBe(at(9) - at(0));
  });

  it("hands each slice to at most one owner, and drops an unowned slice's time rather than sharing it out", () => {
    const { slices } = partitionTimeline(events, [a, b], at(9));
    expect(slices.map((s) => [s.fromMs - at(0), s.toMs - at(0), s.owner?.stage ?? null])).toEqual([
      [0, 1 * 60_000, null], // [+0m,+1m) — the "z" event names a stage with no open run
      [1 * 60_000, 2 * 60_000, null], // [+1m,+2m) — ends at a START, which owns nothing
      [2 * 60_000, 4 * 60_000, "b"], // [+2m,+4m) — unnamed event → most recently opened
      [4 * 60_000, 6 * 60_000, "b"], // [+4m,+6m) — b's own completion
      [6 * 60_000, 9 * 60_000, "a"], // [+6m,+9m) — tail: b closed, a is what's left
    ]);
    // The two unowned slices went nowhere: the run open across them gained
    // nothing, and no other run absorbed them either. Wall span 9m, 2m
    // unowned, so the runs share exactly 7m between them.
    const { results } = attributeRuns(events, [a, b], at(9));
    const total = (results.get(a)?.activeMs ?? 0) + (results.get(b)?.activeMs ?? 0);
    expect(total).toBe(7 * 60_000);
  });

  it("never gives a run the slice that ends at its own STAGE_STARTED", () => {
    // A run cannot be billed for time that predates its existence — the slice
    // ending at a start is assigned before that run is opened at all, and a
    // START owns nothing anyway, so it is dropped rather than reassigned.
    const { slices } = partitionTimeline(events, [a, b], at(9));
    expect(slices.find((s) => s.toMs === at(2))?.owner).toBeNull();
  });

  it("resolves every boundary exactly once, whether it closed, stayed open, or never opened", () => {
    // A `recovered-*` boundary closes on the STAGE_STARTED that recovered it
    // (index 0 here); what matters is `openIndex: null` — it never occupies a
    // slot, so it owns no slice and is resolved before the sweep begins.
    const recovered = boundary("c", null, 0, "recovered-completed", { start: 5, end: 5 });
    const { runs } = partitionTimeline(events, [a, b, recovered], at(9));
    expect(runs.map((r) => [r.boundary.stage, r.openAtNow])).toEqual([
      ["c", false], // never opened — resolved up front, owns no slice
      ["b", false], // closed during the sweep
      ["a", true], // still open at `now`
    ]);
    expect(new Set(runs.map((r) => r.boundary)).size).toBe(runs.length);
  });
});
