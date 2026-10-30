import type { AuditEvent } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { readAllAuditEvents } from "../src/audit/events.ts";
import { expectOk, REAL_RECORD } from "./paths.ts";
import {
  deriveLegacyTimings as deriveStageTimings,
  IDLE_THRESHOLD_MS,
} from "./timing-legacy-reference.ts";

const T0 = Date.parse("2026-07-20T00:00:00Z");

/** Newest-first, like readAllAuditEvents — derive must sort for itself. */
function events(
  ...rows: Array<
    [
      event: string,
      stage: string | null,
      offsetMin: number,
      workflow?: string | null,
      shard?: string,
    ]
  >
) {
  return rows
    .map(([event, stage, offsetMin, workflow, shard]) => ({
      event,
      stage,
      timestamp: new Date(T0 + offsetMin * 60_000).toISOString(),
      shard: shard ?? "a.md",
      workflow: workflow ?? null,
    }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)) satisfies AuditEvent[];
}

const NOW = T0 + 60 * 60_000;

describe("legacy timing comparison reference", () => {
  it("pairs a start with its completion", () => {
    const { timings, warnings } = deriveStageTimings(
      events(
        ["STAGE_STARTED", "alpha", 0],
        ["ARTIFACT_CREATED", null, 3],
        ["STAGE_COMPLETED", "alpha", 5],
      ),
      NOW,
    );
    expect(warnings).toEqual([]);
    expect(timings).toEqual([
      {
        stage: "alpha",
        startedAt: "2026-07-20T00:00:00.000Z",
        endedAt: "2026-07-20T00:05:00.000Z",
        wallMs: 5 * 60_000,
        activeMs: 5 * 60_000,
        eventCount: 2,
      },
    ]);
  });

  it("leaves an unfinished run open and measures it against now", () => {
    const { timings } = deriveStageTimings(
      events(["STAGE_STARTED", "alpha", 0], ["ARTIFACT_CREATED", null, 4]),
      NOW,
    );
    expect(timings[0]?.endedAt).toBeNull();
    expect(timings[0]?.wallMs).toBe(60 * 60_000);
    // The last event is at +4m; NOW is at +60m, a 56m tail. That tail is
    // active time too (the run is still open) but capped at IDLE_THRESHOLD_MS
    // like every other gap, so activeMs is the 4m already counted plus a
    // 10m-capped tail, not the 4m alone and not the full 56m.
    expect(timings[0]?.activeMs).toBe(4 * 60_000 + IDLE_THRESHOLD_MS);
    expect(timings[0]?.activeMs).toBe(14 * 60_000);
    expect(timings[0]?.activeMs).toBeLessThanOrEqual(timings[0]?.wallMs as number);
  });

  it("keeps counting an open run's elapsed time between audit events, not just at them", () => {
    // The scenario the tail-gap fix exists for: a stage that emits one event
    // and then goes silent for a long stretch of real work must not show a
    // frozen elapsed time — it should report the capped tail, not 0.
    const { timings } = deriveStageTimings(events(["STAGE_STARTED", "alpha", 0]), NOW);
    expect(timings[0]?.endedAt).toBeNull();
    expect(timings[0]?.activeMs).toBe(IDLE_THRESHOLD_MS);
    expect(timings[0]?.activeMs).toBeGreaterThan(0);
    expect(timings[0]?.activeMs).toBeLessThanOrEqual(timings[0]?.wallMs as number);
  });

  it("caps a gap at the idle threshold instead of dropping it", () => {
    const under = deriveStageTimings(
      events(["STAGE_STARTED", "a", 0], ["STAGE_COMPLETED", "a", 9]),
      NOW,
    );
    const exact = deriveStageTimings(
      events(["STAGE_STARTED", "a", 0], ["STAGE_COMPLETED", "a", 10]),
      NOW,
    );
    const over = deriveStageTimings(
      events(["STAGE_STARTED", "a", 0], ["STAGE_COMPLETED", "a", 30]),
      NOW,
    );
    expect(under.timings[0]?.activeMs).toBe(9 * 60_000);
    expect(exact.timings[0]?.activeMs).toBe(IDLE_THRESHOLD_MS);
    expect(over.timings[0]?.activeMs).toBe(IDLE_THRESHOLD_MS);
    expect(over.timings[0]?.wallMs).toBe(30 * 60_000);
  });

  it("reports zero active time for a run with no events after the start", () => {
    // `now` here is T0, the same instant as STAGE_STARTED itself — the tail
    // slice is zero-width, so this stays 0 even with the tail-gap fix.
    // (Contrast the "keeps counting" test above, where `now` is later.)
    const { timings } = deriveStageTimings(events(["STAGE_STARTED", "a", 0]), T0);
    expect(timings[0]?.activeMs).toBe(0);
    expect(timings[0]?.eventCount).toBe(0);
  });

  it("abandons a run when the same stage starts again", () => {
    const { timings, warnings } = deriveStageTimings(
      events(["STAGE_STARTED", "a", 0], ["STAGE_STARTED", "a", 5], ["STAGE_COMPLETED", "a", 9]),
      NOW,
    );
    expect(timings).toHaveLength(1);
    expect(timings[0]?.startedAt).toBe("2026-07-20T00:05:00.000Z");
    expect(warnings).toEqual(["stage run abandoned without completion: a"]);
  });

  describe("concurrent runs (unit-major iteration, Codex round 5 finding 1)", () => {
    it("keeps two design stages open at once and closes both with sensible durations when completions arrive later in a cascade", () => {
      // stage-protocol.md's unit-major section: a directive's stage can name
      // a LATER design stage than Current Stage while an earlier one is
      // still open, and the gates "fire late and in a cascade at the end of
      // the design block". Simulated here: functional-design (f) opens,
      // then nfr-requirements (n) opens while f is still open, then both
      // close later, f first.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "f", 0],
          ["ARTIFACT_CREATED", null, 2], // f is the only run open — credited to f
          ["STAGE_STARTED", "n", 3], // f must NOT be abandoned by this
          ["ARTIFACT_CREATED", null, 5], // n is now most-recently-opened — credited to n, not f
          ["STAGE_COMPLETED", "f", 10],
          ["STAGE_COMPLETED", "n", 12],
        ),
        NOW,
      );
      expect(warnings).toEqual([]);
      expect(timings).toHaveLength(2);
      // Codex round 7, finding 2: f stops being the attribution target the
      // moment n opens (+3m) — from then on, events land on n, not f. f's
      // cursor is caught up (not billed) at +3m and again at +5m, so f only
      // accrues 2m (its own event at +2m) + 5m (the gap from +5m, when it
      // last saw n take an event, to its own completion at +10m) = 7m. The
      // 8m an earlier, buggy computation gave f included the +3m..+10m span
      // during which n — not f — was the real attribution target; that was
      // exactly this finding's double-billing bug.
      expect(timings[0]).toMatchObject({
        stage: "f",
        startedAt: "2026-07-20T00:00:00.000Z",
        endedAt: "2026-07-20T00:10:00.000Z",
        wallMs: 10 * 60_000,
        activeMs: 7 * 60_000,
      });
      expect(timings[1]).toMatchObject({
        stage: "n",
        startedAt: "2026-07-20T00:03:00.000Z",
        endedAt: "2026-07-20T00:12:00.000Z",
        wallMs: 9 * 60_000,
        activeMs: 4 * 60_000, // 2m (own event, +3m to +5m) + 2m (cursor caught up to
        // +10m when f closed; own completion at +12m bills only the +10m..+12m tail)
      });
      // The central invariant: neither run's activeMs exceeds its own wallMs,
      // even though the two runs overlapped in wall-clock time.
      for (const t of timings) expect(t.activeMs).toBeLessThanOrEqual(t.wallMs);
      // The sharper invariant finding 2 exists for: across the two runs'
      // shared span (n opens at +3m, f closes at +10m — 7 wall minutes),
      // the combined activeMs attributable to that window must not exceed
      // 7 minutes. f's activeMs (all attributed before n opened or after n
      // stopped being credited) plus n's activeMs together must not exceed
      // the total wall span from f's start to n's end.
      const totalActiveMs = timings.reduce((sum, t) => sum + t.activeMs, 0);
      const spanMs = 12 * 60_000; // f starts at 0, n ends at +12m
      expect(totalActiveMs).toBeLessThanOrEqual(spanMs);
    });

    it("still abandons and warns on a same-stage double-START even while a different stage remains open", () => {
      // The unit-major fix must not weaken the genuine-abandonment case: a
      // SAME stage starting twice is still a real abandonment. A DIFFERENT
      // stage staying open throughout must be completely undisturbed by it.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "f", 0],
          ["STAGE_STARTED", "n", 2], // f stays open
          ["STAGE_STARTED", "f", 4], // double-start of f: abandons the first f attempt
          ["STAGE_COMPLETED", "f", 6],
          ["STAGE_COMPLETED", "n", 8],
        ),
        NOW,
      );
      expect(warnings).toEqual(["stage run abandoned without completion: f"]);
      expect(timings).toHaveLength(2);
      const f = timings.find((t) => t.stage === "f");
      const n = timings.find((t) => t.stage === "n");
      // f's surviving run is the SECOND start (at +4m), not the first.
      expect(f).toMatchObject({
        startedAt: "2026-07-20T00:04:00.000Z",
        endedAt: "2026-07-20T00:06:00.000Z",
      });
      // n was never touched by f's double-start — its own start time survives.
      expect(n).toMatchObject({
        startedAt: "2026-07-20T00:02:00.000Z",
        endedAt: "2026-07-20T00:08:00.000Z",
      });
    });

    it("recovers a cross-shard skew completion via pendingCompletions even while a different stage is open (Codex round 7 finding 1)", () => {
      // Before the fix: "a" being open routed b's mismatched completion into
      // the "bill whatever is open" branch instead of pendingCompletions, so
      // b's later STAGE_STARTED never found anything to recover against and
      // stayed open forever — corrupting both b's own duration and a's.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "a", 0],
          // b's completion sorts before its own start — the cross-shard skew
          // case — while "a" is still open.
          ["STAGE_COMPLETED", "b", 3],
          ["STAGE_STARTED", "b", 5],
          ["STAGE_COMPLETED", "a", 10],
        ),
        NOW,
      );
      // Recovered as a zero-duration run, not left open, and NOT reported as
      // "STAGE_COMPLETED for b while a was open" (the old mismatch-bill path).
      expect(warnings).toEqual([
        "clock skew: STAGE_COMPLETED for b was recorded before its STAGE_STARTED (shards disagree on the clock) — closed as a zero-duration run",
      ]);
      // No run left open at all — the central symptom the bug produced.
      expect(timings.every((t) => t.endedAt !== null)).toBe(true);
      const b = timings.find((t) => t.stage === "b");
      const a = timings.find((t) => t.stage === "a");
      expect(b).toMatchObject({
        startedAt: "2026-07-20T00:05:00.000Z",
        endedAt: "2026-07-20T00:03:00.000Z",
        wallMs: 0,
        activeMs: 0,
      });
      // "a" closes normally; per finding 2, its cursor was advanced (not
      // billed) by b's mismatched completion at +3m and again by b's
      // recovery at +5m, so it only accrues the +5m..+10m tail (5m) — not
      // the full 10m from its own start, which would double-count wall time
      // that "b" is evidence of.
      expect(a).toMatchObject({
        startedAt: "2026-07-20T00:00:00.000Z",
        endedAt: "2026-07-20T00:10:00.000Z",
        wallMs: 10 * 60_000,
        activeMs: 5 * 60_000,
      });
    });

    it("does not let an earlier-opened run bill wall time that belonged to a later stage's work (Codex round 7 finding 2)", () => {
      // "a" opens first and stays open throughout; "b" opens later and is the
      // one actually receiving events. Before the fix, "a"'s gap cursor was
      // frozen from its own last event, so its own completion at the end
      // would bill it for the ENTIRE span since then — including the time
      // "b" was demonstrably the active one.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "a", 0],
          ["STAGE_STARTED", "b", 2], // a stays open
          ["ARTIFACT_CREATED", null, 4], // b is most-recently-opened — credited to b
          ["STAGE_COMPLETED", "b", 8],
          ["STAGE_COMPLETED", "a", 10],
        ),
        NOW,
      );
      expect(warnings).toEqual([]);
      const a = timings.find((t) => t.stage === "a");
      const b = timings.find((t) => t.stage === "b");
      // a's activeMs must not include any of b's +2m..+8m working span — only
      // the +8m..+10m tail after b closed and a became the target again.
      expect(a).toMatchObject({ activeMs: 2 * 60_000, wallMs: 10 * 60_000 });
      // b accrues both of its own gaps in full: +2m..+4m (its own event) and
      // +4m..+8m (its own completion) — none of that is stolen from a.
      expect(b).toMatchObject({ activeMs: 6 * 60_000, wallMs: 6 * 60_000 });
      // The invariant this finding exists to hold: the sum of activeMs across
      // runs that were open over a shared span must not exceed that span's
      // wall time. Both runs are open across the full [0, 10m] window.
      const totalActiveMs = (a?.activeMs ?? 0) + (b?.activeMs ?? 0);
      expect(totalActiveMs).toBeLessThanOrEqual(10 * 60_000);
    });
  });

  describe("stage-named event with no matching open run (Codex round 10)", () => {
    it("does not let a later stage's pre-start artifact events inflate an earlier, still-open stage (repro from the finding)", () => {
      // stage-protocol.md's unit-major section: a stage's own STAGE_STARTED
      // may land AFTER that stage's per-Unit artifact events. Here "b"'s
      // artifacts at +3 and +6 arrive before "b" itself starts at +7, while
      // "a" (started at +0) is still open for its own late cascade gate.
      // Before the fix, `target ?? mostRecentlyOpened()` credited those two
      // events to "a" (the only run open at the time) — stealing them from
      // "b" and inflating "a"'s activeMs/eventCount with work "a" never did.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "a", 0],
          ["ARTIFACT_CREATED", "b", 3], // b not open yet — must be unattributed, not billed to a
          ["ARTIFACT_CREATED", "b", 6], // same
          ["STAGE_STARTED", "b", 7],
          ["STAGE_COMPLETED", "b", 9],
          ["STAGE_COMPLETED", "a", 10],
        ),
        NOW,
      );
      expect(warnings).toEqual([]);
      const a = timings.find((t) => t.stage === "a");
      const b = timings.find((t) => t.stage === "b");
      // a only ever bills the +9m..+10m tail after b closed (1m); it must not
      // include any of b's pre-start artifact events at +3m/+6m.
      expect(a).toMatchObject({ activeMs: 1 * 60_000, eventCount: 1 });
      // b bills only its own +7m..+9m completion gap; its two pre-start
      // artifact events count for nobody, not even b itself, since b had no
      // open run to receive them against at the time they landed.
      expect(b).toMatchObject({ activeMs: 2 * 60_000, eventCount: 1 });
      const totalActiveMs = (a?.activeMs ?? 0) + (b?.activeMs ?? 0);
      expect(totalActiveMs).toBeLessThanOrEqual(10 * 60_000);
    });

    it("still credits an event carrying no stage at all to the most recently opened run (must not regress)", () => {
      // The fallback exists precisely for the common case: an event with
      // `stage: null` (the vast majority — only lifecycle events carry a
      // Stage field). That must keep landing on whichever run opened last.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "a", 0],
          ["STAGE_STARTED", "b", 2], // a stays open
          ["ARTIFACT_CREATED", null, 4], // no stage named — credited to b, the most recently opened
          ["STAGE_COMPLETED", "b", 6],
          ["STAGE_COMPLETED", "a", 8],
        ),
        NOW,
      );
      expect(warnings).toEqual([]);
      const a = timings.find((t) => t.stage === "a");
      const b = timings.find((t) => t.stage === "b");
      expect(b).toMatchObject({ activeMs: 4 * 60_000, eventCount: 2 }); // +2m..+4m, +4m..+6m
      expect(a).toMatchObject({ activeMs: 2 * 60_000, eventCount: 1 }); // only +6m..+8m tail
    });
  });

  describe("open-run tail attribution (Codex round 9 finding 1)", () => {
    it("charges the tail only to the most recently attributed run, not every open run", () => {
      // Reproduction from the review: runs open at +0m and +1m, one activity
      // event at +2m (credited to "b", the most-recently-opened run), now at
      // +7m. Before the fix, the +2m..+7m tail was added to EVERY open run
      // independently: a got 5m, b got 6m, summing to 11m of activeMs across
      // a 7m wall span. Only "b" was ever the real attribution target for
      // that span — "a" gets no tail at all.
      const { timings, warnings } = deriveStageTimings(
        events(["STAGE_STARTED", "a", 0], ["STAGE_STARTED", "b", 1], ["ARTIFACT_CREATED", null, 2]),
        T0 + 7 * 60_000,
      );
      expect(warnings).toEqual([]);
      const a = timings.find((t) => t.stage === "a");
      const b = timings.find((t) => t.stage === "b");
      expect(a).toMatchObject({ wallMs: 7 * 60_000, activeMs: 0 });
      expect(b).toMatchObject({ wallMs: 6 * 60_000, activeMs: 6 * 60_000 });
      // The invariant: the sum of activeMs across runs open over a shared
      // span must not exceed that span's wall time.
      const totalActiveMs = (a?.activeMs ?? 0) + (b?.activeMs ?? 0);
      const spanMs = 7 * 60_000;
      expect(totalActiveMs).toBeLessThanOrEqual(spanMs);
      for (const t of timings) expect(t.activeMs).toBeLessThanOrEqual(t.wallMs);
    });

    it("gives the tail to the run last ATTRIBUTED, not the run most recently OPENED (Codex round 11 finding 2)", () => {
      // "a" opens first, "b" opens second (so "b" is most-recently-opened),
      // but the next event is stage-keyed to "a" — the earlier-opened run —
      // exactly the unit-major cascade shape where a later-opened stage
      // (b) is waiting on its own gate while an earlier stage (a) is still
      // the one receiving real work. Then silence until `now`.
      //
      // Before the fix, `mostRecentlyOpened()` picked "b" for the tail
      // purely because it opened later, even though "b" never received a
      // single event — charging it wall time nobody worked. The fix must
      // give the tail to "a", the run that was actually last attributed.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "a", 0],
          ["STAGE_STARTED", "b", 1], // b opens later — must NOT make it the tail target
          ["ARTIFACT_CREATED", "a", 2], // stage-keyed to "a", the earlier-opened run
        ),
        T0 + 7 * 60_000,
      );
      expect(warnings).toEqual([]);
      const a = timings.find((t) => t.stage === "a");
      const b = timings.find((t) => t.stage === "b");
      // a's cursor was caught up (not billed) to +1m when b opened (finding
      // 2), so the +2m event only bills the +1m..+2m gap (1m); the tail then
      // adds the +2m..+7m span (5m) since a is `lastAttributed`. Total: 6m
      // active against a 7m wall span.
      expect(a).toMatchObject({ wallMs: 7 * 60_000, activeMs: 6 * 60_000 });
      // b never received an event and must get NO tail at all.
      expect(b).toMatchObject({ wallMs: 6 * 60_000, activeMs: 0 });
      const totalActiveMs = (a?.activeMs ?? 0) + (b?.activeMs ?? 0);
      expect(totalActiveMs).toBeLessThanOrEqual(7 * 60_000);
      for (const t of timings) expect(t.activeMs).toBeLessThanOrEqual(t.wallMs);
    });

    it("gives the tail to a run the instant it opens, not the run last billed before it (Codex round 14)", () => {
      // Reproduction from the review: "a" opens and receives one real event,
      // then "b" opens and the log goes silent all the way to `now`. "b" is
      // the one silently generating (work moved onto it the moment it
      // started) but STAGE_STARTED never billed anyone, so the old
      // `lastAttributed` — last updated by "a"'s own event — still pointed
      // at "a". The tail then went to "a": 2m of real work plus a 10m-capped
      // tail it never earned, while "b" (the stage actually running) showed
      // 0m.
      //
      // The fix: a run BECOMING OPEN makes it the tail-owner candidate too
      // (without billing it the gap that preceded its own start) — so "b"
      // opening at +3m supersedes "a" as the tail candidate even though
      // nothing has billed "b" yet.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "a", 0],
          ["ARTIFACT_CREATED", "a", 2], // stage-keyed to "a" — real work happens
          ["STAGE_STARTED", "b", 3], // work moves to "b"; b must become the tail candidate
        ),
        T0 + 13 * 60_000, // silence from +3m to +13m — a 10m tail, exactly IDLE_THRESHOLD_MS
      );
      expect(warnings).toEqual([]);
      const a = timings.find((t) => t.stage === "a");
      const b = timings.find((t) => t.stage === "b");
      // "a" only ever bills its own +0m..+2m gap — no tail, since work moved
      // to "b" the moment "b" started.
      expect(a).toMatchObject({ wallMs: 13 * 60_000, activeMs: 2 * 60_000 });
      // "b" gets the full (capped) tail, even though it never received an
      // event of its own: +3m..+13m is 10m, exactly IDLE_THRESHOLD_MS.
      expect(b).toMatchObject({ wallMs: 10 * 60_000, activeMs: IDLE_THRESHOLD_MS });
      const totalActiveMs = (a?.activeMs ?? 0) + (b?.activeMs ?? 0);
      expect(totalActiveMs).toBeLessThanOrEqual(13 * 60_000);
      for (const t of timings) expect(t.activeMs).toBeLessThanOrEqual(t.wallMs);
    });
  });

  describe("STAGE_SKIPPED (Codex round 5 finding 2)", () => {
    it("discards a stage's run when it is skipped while active, leaving no open run and no timing entry to pollute the estimate pool", () => {
      // stage-protocol.md's conditional-skip section: the engine "preserves
      // [S], emits one STAGE_SKIPPED, and starts the next in-scope stage ...
      // without emitting STAGE_COMPLETED". Only STAGE_COMPLETED closed a run
      // before this fix, so "a" would stay open forever.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_STARTED", "a", 0],
          ["ARTIFACT_CREATED", null, 2],
          ["STAGE_SKIPPED", "a", 5],
          ["STAGE_STARTED", "b", 5],
          ["STAGE_COMPLETED", "b", 10],
        ),
        NOW,
      );
      expect(warnings).toEqual([]);
      // No "a" entry at all — not open, not closed. estimate.ts's sample
      // pool is built entirely from this array, so there is nothing here
      // that could ever be mistaken for a completed run of "a".
      expect(timings.some((t) => t.stage === "a")).toBe(false);
      expect(timings).toEqual([
        {
          stage: "b",
          startedAt: "2026-07-20T00:05:00.000Z",
          endedAt: "2026-07-20T00:10:00.000Z",
          wallMs: 5 * 60_000,
          activeMs: 5 * 60_000,
          eventCount: 1,
        },
      ]);
    });

    it("leaves no open run at all when the FINAL in-scope stage is skipped — the case that would otherwise poll forever", () => {
      const { timings, warnings } = deriveStageTimings(
        events(["STAGE_STARTED", "a", 0], ["ARTIFACT_CREATED", null, 2], ["STAGE_SKIPPED", "a", 5]),
        NOW,
      );
      expect(warnings).toEqual([]);
      // Nothing left in `timings` at all: no `endedAt: null` entry for the
      // dashboard's open-run poll to keep re-fetching after the workflow
      // has already completed.
      expect(timings).toEqual([]);
    });
  });

  describe("unmatched STAGE_SKIPPED clock skew recovery (Codex round 11 finding 3)", () => {
    it("recovers an unmatched skip within the window instead of leaving the start open forever", () => {
      // A stage starts in one clone and is skipped from another whose clock
      // is behind: the skip sorts before its own start. Before the fix, the
      // "no open run" branch only warned — the STARTED that follows then had
      // nothing telling it the stage was already skipped, so it opened an
      // ordinary run that nothing ever closes.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_SKIPPED", "a", 0, null, "aaa.md"],
          ["STAGE_STARTED", "a", 5, null, "bbb.md"],
        ),
        NOW,
      );
      // Discarded like every other skip — no timing entry for "a" at all,
      // and critically nothing left open.
      expect(timings).toEqual([]);
      expect(timings.some((t) => t.stage === "a")).toBe(false);
      expect(warnings).toEqual([
        "clock skew: STAGE_SKIPPED for a was recorded before its STAGE_STARTED (shards disagree on the clock) — discarded, no run recorded",
      ]);
    });

    it("leaves nothing open when the FINAL in-scope stage's skip arrives before its start", () => {
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_SKIPPED", "a", 0, null, "aaa.md"],
          ["STAGE_STARTED", "a", 5, null, "bbb.md"],
        ),
        // now is right at the recovered stage's own timestamps — the point is
        // there is no open run at all for the dashboard to keep polling.
        T0 + 5 * 60_000,
      );
      expect(timings).toEqual([]);
      expect(warnings).toEqual([
        "clock skew: STAGE_SKIPPED for a was recorded before its STAGE_STARTED (shards disagree on the clock) — discarded, no run recorded",
      ]);
    });

    it("still reports an unmatched skip as an orphan when no same-stage start ever follows it", () => {
      const { timings, warnings } = deriveStageTimings(events(["STAGE_SKIPPED", "a", 0]), NOW);
      expect(timings).toEqual([]);
      expect(warnings).toEqual(["STAGE_SKIPPED with no open run: a"]);
    });
  });

  it("ignores a synthetic single-stage pair interleaved inside an open main-workflow run", () => {
    // Simulates `/aidlc --stage beta --single` firing while `alpha` is the
    // real, open main-workflow run — the scenario Finding 1 describes. The
    // synthetic pair must not abandon `alpha`, must not close anything, and
    // must not contribute a `beta` run of its own.
    const { timings, warnings } = deriveStageTimings(
      [
        ...events(["STAGE_STARTED", "alpha", 0]),
        ...events(["STAGE_STARTED", "beta", 5, "single-stage:beta"]),
        ...events(["STAGE_COMPLETED", "beta", 6, "single-stage:beta"]),
        ...events(["STAGE_COMPLETED", "alpha", 10]),
      ],
      NOW,
    );
    expect(warnings).toEqual([]);
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({
      stage: "alpha",
      startedAt: "2026-07-20T00:00:00.000Z",
      endedAt: "2026-07-20T00:10:00.000Z",
      activeMs: 10 * 60_000,
      eventCount: 1,
    });
  });

  it("warns on a completion with no open run", () => {
    const { timings, warnings } = deriveStageTimings(events(["STAGE_COMPLETED", "a", 0]), NOW);
    expect(timings).toEqual([]);
    expect(warnings).toEqual(["STAGE_COMPLETED without STAGE_STARTED: a"]);
  });

  it("warns when a completion names a different stage than the open run (Codex round 7 finding 1: routed to pendingCompletions, not billed to the open run)", () => {
    // "b" never started, so its completion is an orphan — it goes into
    // pendingCompletions (silently, unless a second one for "b" arrives) and
    // is reported as an orphan warning at the end, exactly like the
    // openRuns-empty case already did. It is deliberately NOT credited as
    // activity on "a": a completion names the stage it is evidence FOR, not
    // whichever run happens to still be open (see the comment on the
    // STAGE_COMPLETED mismatch branch in derive.ts).
    const { timings, warnings } = deriveStageTimings(
      events(["STAGE_STARTED", "a", 0], ["STAGE_COMPLETED", "b", 5], ["STAGE_COMPLETED", "a", 6]),
      NOW,
    );
    expect(timings).toHaveLength(1);
    expect(warnings).toEqual(["STAGE_COMPLETED without STAGE_STARTED: b"]);
    // "a" still closes correctly, but per finding 2 its cursor was advanced
    // (not billed) by b's mismatched completion at +5m, so it only accrues
    // the 1m gap from +5m to its own completion at +6m — not the full 6m
    // from its start, which would double-count wall time "b" is evidence of.
    expect(timings[0]).toMatchObject({
      stage: "a",
      endedAt: "2026-07-20T00:06:00.000Z",
      wallMs: 6 * 60_000,
      activeMs: 1 * 60_000,
      eventCount: 1,
    });
  });

  it("skips a start with no stage name", () => {
    const { timings, warnings } = deriveStageTimings(events(["STAGE_STARTED", null, 0]), NOW);
    expect(timings).toEqual([]);
    expect(warnings).toEqual(["STAGE_STARTED with no Stage field at 2026-07-20T00:00:00.000Z"]);
  });

  it("does not let a rejected no-stage STAGE_STARTED swallow the elapsed span around it (PR#6 finding 1 regression)", () => {
    // Repro from the review: a malformed, stage-less STAGE_STARTED landing
    // mid-run used to be fully invisible to gap accrual (the old single-loop
    // `continue` fired before the event ever touched a cursor). The pairing/
    // attribution split instead left the rejected event IN the stream pass 2
    // walks; a STAGE_STARTED owns nothing, so the malformed event at +5m cut
    // the run's span into an unowned [0m,5m) slice and an owned [5m,10m) one,
    // dropping the first half and reporting 5m instead of the correct 10m.
    const { timings, warnings } = deriveStageTimings(
      events(["STAGE_STARTED", "a", 0], ["STAGE_STARTED", null, 5], ["STAGE_COMPLETED", "a", 10]),
      NOW,
    );
    expect(warnings).toEqual(["STAGE_STARTED with no Stage field at 2026-07-20T00:05:00.000Z"]);
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({
      stage: "a",
      startedAt: "2026-07-20T00:00:00.000Z",
      endedAt: "2026-07-20T00:10:00.000Z",
      wallMs: 10 * 60_000,
      activeMs: 10 * 60_000,
    });
  });

  it("skips an unparseable timestamp", () => {
    const { timings, warnings } = deriveStageTimings(
      [
        {
          event: "STAGE_STARTED",
          stage: "a",
          timestamp: "not-a-date",
          shard: "a.md",
          workflow: null,
        },
      ],
      NOW,
    );
    expect(timings).toEqual([]);
    expect(warnings).toEqual(["unparseable timestamp: not-a-date"]);
  });

  it("skips an unparseable timestamp mid-run without advancing the gap cursor", () => {
    const { timings, warnings } = deriveStageTimings(
      [
        ...events(["STAGE_STARTED", "a", 0], ["STAGE_COMPLETED", "a", 8]),
        // Where this sorts is undefined (Date.parse gives NaN), and that is the
        // point: wherever it lands it contributes nothing, so the run still
        // reads as 8 minutes with one counted event.
        {
          event: "ARTIFACT_UPDATED",
          stage: null,
          timestamp: "not-a-date",
          shard: "a.md",
          workflow: null,
        },
      ],
      NOW,
    );
    expect(warnings).toEqual(["unparseable timestamp: not-a-date"]);
    expect(timings[0]).toMatchObject({ activeMs: 8 * 60_000, eventCount: 1 });
  });

  it("keeps valid events correctly ordered around an interleaved malformed timestamp (regression: comparator NaN total order, finding 1)", () => {
    // `Date.parse` on the malformed timestamp yields NaN, and NaN comparisons
    // are always false — a comparator that returns NaN for this pair is not a
    // total order. This exact pre-sort input order ([completed, malformed,
    // started]) is a known case where the old comparator left it unchanged
    // instead of sorting it, silently placing STAGE_COMPLETED ahead of the
    // STAGE_STARTED it belongs to.
    const [completed, started] = events(["STAGE_STARTED", "a", 0], ["STAGE_COMPLETED", "a", 5]);
    const malformed: AuditEvent = {
      event: "ARTIFACT_UPDATED",
      stage: null,
      timestamp: "not-a-date",
      shard: "a.md",
      workflow: null,
    };
    const { timings, warnings } = deriveStageTimings(
      [completed as AuditEvent, malformed, started as AuditEvent],
      NOW,
    );
    expect(warnings).toEqual(["unparseable timestamp: not-a-date"]);
    expect(timings).toEqual([
      {
        stage: "a",
        startedAt: "2026-07-20T00:00:00.000Z",
        endedAt: "2026-07-20T00:05:00.000Z",
        wallMs: 5 * 60_000,
        activeMs: 5 * 60_000,
        eventCount: 1,
      },
    ]);
  });

  it("clamps wallMs to zero when now precedes the start (clock skew)", () => {
    const { timings, warnings } = deriveStageTimings(events(["STAGE_STARTED", "a", 10]), T0);
    expect(timings[0]?.wallMs).toBe(0);
    expect(warnings).toEqual([
      "clock skew: 1 event(s) are timestamped after now (up to 600s ahead); the span past now is not counted toward any run",
      "clock skew: run a starts after now, wallMs clamped to 0",
    ]);
  });

  it("clamps activeMs to wallMs when the writer's clock is ahead of the reader's (finding 1)", () => {
    // Reproduction from the Codex review: the run starts at now+10m (writer
    // clock ahead of reader clock) and a second event lands at now+15m — both
    // squarely in the reader's future. wallMs is already clamped to 0, but
    // before this fix activeMs accumulated the 5m gap between those two
    // events regardless, breaking `activeMs <= wallMs`.
    //
    // Under the timeline-partition form (issue #8) this holds a step earlier:
    // both instants clamp to `now`, so the 5m gap is never cut as a slice at
    // all — there is nothing to clamp away afterwards. Both events being past
    // `now` is now itself reported, rather than only the run that starts
    // there (PR#14 review).
    const { timings, warnings } = deriveStageTimings(
      events(["STAGE_STARTED", "a", 10], ["ARTIFACT_CREATED", null, 15]),
      T0,
    );
    expect(timings[0]?.wallMs).toBe(0);
    expect(timings[0]?.activeMs).toBe(0);
    expect(timings[0]?.activeMs).toBeLessThanOrEqual(timings[0]?.wallMs as number);
    expect(warnings).toEqual([
      "clock skew: 2 event(s) are timestamped after now (up to 900s ahead); the span past now is not counted toward any run",
      "clock skew: run a starts after now, wallMs clamped to 0",
    ]);
  });

  it("pairs a same-second, same-stage start and completion even when the completion's shard sorts first (cross-shard tie, Codex round 4 finding; Codex round 11 finding 1: the dedicated same-stage comparator rule that used to make this a normal pair was deleted — the bounded skew-recovery path now produces the same zero-open-runs outcome, just via a different mechanism and a different, but still accurate, warning)", () => {
    // Two clones: the start lands in shard "zzz.md", the completion in "aaa.md",
    // both stamped the same second. The plain shard tiebreak puts the
    // completion first (compareByTime's shard tiebreak, "aaa.md" < "zzz.md").
    // Without a same-stage comparator rule, the completion is unmatched when
    // it's processed (no run open yet) and falls into pendingCompletions; the
    // same-second start then recovers it via the existing bounded skew-recovery
    // path (`at >= pending.at` holds on equality). The warning text says
    // "clock skew" even though this is a tie, not real skew — judged accurate
    // enough (a same-second tie is indistinguishable from sub-second skew at
    // this log's second resolution) rather than misleading.
    const { timings, warnings } = deriveStageTimings(
      events(
        ["STAGE_STARTED", "alpha", 5, null, "zzz.md"],
        ["STAGE_COMPLETED", "alpha", 5, null, "aaa.md"],
      ),
      NOW,
    );
    expect(warnings).toEqual([
      "clock skew: STAGE_COMPLETED for alpha was recorded before its STAGE_STARTED (shards disagree on the clock) — closed as a zero-duration run",
    ]);
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({
      stage: "alpha",
      endedAt: "2026-07-20T00:05:00.000Z",
      wallMs: 0,
      activeMs: 0,
    });
    // No run left open — the invariant that actually matters here.
    expect(timings.every((t) => t.endedAt !== null)).toBe(true);
  });

  describe("same-second reruns (Codex round 11 finding 1)", () => {
    it("does not collapse two real same-second-boundary attempts into one zero-duration run", () => {
      // Reproduction from the review: a rapid backward jump plus a
      // second-resolution audit writer puts a genuine rerun's boundary events
      // (COMPLETED closing attempt 1, STARTED opening attempt 2) at the exact
      // same second. The now-deleted same-stage comparator rule forced
      // STARTED-before-COMPLETED for ANY same-stage tie, which is correct for
      // a cross-shard tie but wrong here: it reordered this pair too, so the
      // loop saw STARTED, STARTED, COMPLETED, COMPLETED instead of STARTED,
      // COMPLETED, STARTED, COMPLETED — abandoning the first attempt and
      // stranding the second's completion as an orphan, collapsing two real
      // 5m/7m attempts into a single 0m run.
      //
      // Built directly (not via the `events()` helper) because a real
      // single-shard audit log is append-only: the file already holds
      // COMPLETED-then-STARTED in that order even though both are stamped
      // the same second, and `compareByTime` returns 0 for a same-shard,
      // same-timestamp pair — a stable sort preserves whatever order the
      // input array already has for a genuine tie. `events()`'s own
      // newest-first pre-sort uses a comparator that returns -1 for ties in
      // both directions (not a valid total order), so it cannot be trusted
      // to reproduce a specific tie order here.
      const ts = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();
      const { timings, warnings } = deriveStageTimings(
        [
          { event: "STAGE_STARTED", stage: "a", timestamp: ts(0), shard: "a.md", workflow: null },
          { event: "STAGE_COMPLETED", stage: "a", timestamp: ts(5), shard: "a.md", workflow: null },
          { event: "STAGE_STARTED", stage: "a", timestamp: ts(5), shard: "a.md", workflow: null },
          {
            event: "STAGE_COMPLETED",
            stage: "a",
            timestamp: ts(12),
            shard: "a.md",
            workflow: null,
          },
        ] satisfies AuditEvent[],
        NOW,
      );
      expect(warnings).toEqual([]);
      expect(timings).toHaveLength(2);
      expect(timings[0]).toMatchObject({
        startedAt: "2026-07-20T00:00:00.000Z",
        endedAt: "2026-07-20T00:05:00.000Z",
        wallMs: 5 * 60_000,
        activeMs: 5 * 60_000,
      });
      expect(timings[1]).toMatchObject({
        startedAt: "2026-07-20T00:05:00.000Z",
        endedAt: "2026-07-20T00:12:00.000Z",
        wallMs: 7 * 60_000,
        activeMs: 7 * 60_000,
      });
    });
  });

  it("keeps stage A's completion ordered before stage B's start when they share a second (dominant real pattern, must stay intact)", () => {
    // Different stages sharing a second is the normal case (one stage ends,
    // the next begins in the same tick) — the new same-stage pairing rule
    // must not touch it. If it wrongly fired here, B's start would sort
    // ahead of A's completion, abandoning A's run and mismatching B's. Uses
    // distinct shards for the tied pair (as a real cross-clone tie would) so
    // the outcome is decided by the shard tiebreak, not by incidental input
    // order / sort stability on an exact (shard, timestamp) duplicate.
    const { timings, warnings } = deriveStageTimings(
      events(
        ["STAGE_STARTED", "alpha", 0],
        ["STAGE_COMPLETED", "alpha", 5, null, "aaa.md"],
        ["STAGE_STARTED", "beta", 5, null, "zzz.md"],
        ["STAGE_COMPLETED", "beta", 10],
      ),
      NOW,
    );
    expect(warnings).toEqual([]);
    expect(timings).toHaveLength(2);
    expect(timings[0]).toMatchObject({ stage: "alpha", endedAt: "2026-07-20T00:05:00.000Z" });
    expect(timings[1]).toMatchObject({
      stage: "beta",
      startedAt: "2026-07-20T00:05:00.000Z",
      endedAt: "2026-07-20T00:10:00.000Z",
    });
  });

  it("recovers a completion recorded strictly before its start (cross-clone clock skew) as a zero-duration run instead of leaving the start open forever", () => {
    const { timings, warnings } = deriveStageTimings(
      events(
        ["STAGE_COMPLETED", "alpha", 0, null, "aaa.md"],
        ["STAGE_STARTED", "alpha", 5, null, "bbb.md"],
      ),
      NOW,
    );
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({
      stage: "alpha",
      startedAt: "2026-07-20T00:05:00.000Z",
      endedAt: "2026-07-20T00:00:00.000Z",
      wallMs: 0,
      activeMs: 0,
    });
    expect(warnings).toEqual([
      "clock skew: STAGE_COMPLETED for alpha was recorded before its STAGE_STARTED (shards disagree on the clock) — closed as a zero-duration run",
    ]);
    // No open run left behind for the current-stage poll to chase forever.
    expect(timings.some((t) => t.endedAt === null)).toBe(false);
  });

  describe("skew-recovery window (Codex round 8 finding 2)", () => {
    it("still recovers an orphan completion when the same-stage start lands within the window (right at IDLE_THRESHOLD_MS)", () => {
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_COMPLETED", "alpha", 0, null, "aaa.md"],
          // Exactly IDLE_THRESHOLD_MS (10m) later — still inside the window.
          ["STAGE_STARTED", "alpha", 10, null, "bbb.md"],
        ),
        NOW,
      );
      expect(timings).toHaveLength(1);
      expect(timings[0]).toMatchObject({
        stage: "alpha",
        startedAt: "2026-07-20T00:10:00.000Z",
        endedAt: "2026-07-20T00:00:00.000Z",
        wallMs: 0,
        activeMs: 0,
      });
      expect(timings.every((t) => t.endedAt !== null)).toBe(true);
      expect(warnings).toEqual([
        "clock skew: STAGE_COMPLETED for alpha was recorded before its STAGE_STARTED (shards disagree on the clock) — closed as a zero-duration run",
      ]);
    });

    it("does not recover a completion into an unrelated LATER rerun beyond the skew window", () => {
      // A prior attempt's STAGE_STARTED went missing (or malformed) while its
      // STAGE_COMPLETED survived — a genuine orphan. The stage is legitimately
      // re-run 20m later, well beyond IDLE_THRESHOLD_MS (10m). Before the fix,
      // this branch hijacked the new start as the old completion's "reversed
      // pair", recording a spurious zero-duration run and leaving the new
      // attempt's own completion as the next orphan.
      const { timings, warnings } = deriveStageTimings(
        events(
          ["STAGE_COMPLETED", "alpha", 0, null, "aaa.md"],
          ["STAGE_STARTED", "alpha", 20, null, "bbb.md"],
          ["STAGE_COMPLETED", "alpha", 25, null, "bbb.md"],
        ),
        NOW,
      );
      // The rerun opens and closes as one ordinary run — no spurious
      // zero-duration run alongside it, and nothing left open.
      expect(timings).toHaveLength(1);
      expect(timings[0]).toMatchObject({
        stage: "alpha",
        startedAt: "2026-07-20T00:20:00.000Z",
        endedAt: "2026-07-20T00:25:00.000Z",
        wallMs: 5 * 60_000,
        activeMs: 5 * 60_000,
      });
      expect(timings.every((t) => t.endedAt !== null)).toBe(true);
      // The stale completion is left as the genuine orphan it is — not
      // silently consumed, and not reported as a clock-skew recovery.
      expect(warnings).toEqual(["STAGE_COMPLETED without STAGE_STARTED: alpha"]);
    });
  });

  it("still reports the existing unmatched-completion warning when a completion never finds a same-stage start at all", () => {
    const { timings, warnings } = deriveStageTimings(
      events(["STAGE_COMPLETED", "alpha", 0], ["STAGE_STARTED", "beta", 5]),
      NOW,
    );
    // "beta" opens and stays open (measured against NOW); "alpha"'s completion
    // never gets a same-stage start, so it must still warn as an orphan, not
    // silently vanish and not be mistaken for beta's pairing.
    expect(timings).toHaveLength(1);
    expect(timings[0]?.stage).toBe("beta");
    expect(warnings).toEqual(["STAGE_COMPLETED without STAGE_STARTED: alpha"]);
  });

  it("returns nothing for an empty timeline", () => {
    expect(deriveStageTimings([], NOW)).toEqual({ timings: [], warnings: [] });
  });

  it("golden: the real record's runs are closed, ordered and non-overlapping", async () => {
    const { value } = expectOk(await readAllAuditEvents(REAL_RECORD));
    const { timings, warnings } = deriveStageTimings(value, Date.parse("2026-07-26T00:00:00Z"));
    const first21 = timings.slice(0, 21);

    expect(timings.length).toBeGreaterThanOrEqual(21);
    expect(first21.every((t) => t.endedAt !== null)).toBe(true);
    expect(timings.every((t) => t.activeMs <= t.wallMs)).toBe(true);
    expect(timings.every((t) => t.activeMs >= 0 && t.wallMs >= 0)).toBe(true);
    expect(first21.slice(0, 5).map((t) => t.stage)).toEqual([
      "workspace-scaffold",
      "workspace-detection",
      "state-init",
      "intent-capture",
      "feasibility",
    ]);
    // No run was abandoned, and none starts before the previous one ended.
    // These are what break if the same-second ordering regresses: a
    // STAGE_STARTED sorted ahead of the STAGE_COMPLETED it shares a second with
    // would abandon the open run instead of closing it.
    //
    // Runs are NOT asserted to be contiguous. The real record has a one-second
    // gap between refined-mockups and domain-design — the engine does not
    // guarantee that a completion and the next start share a timestamp, only
    // that they usually do.
    expect(warnings.filter((w) => w.startsWith("stage run abandoned"))).toEqual([]);
    for (const [index, run] of first21.slice(1).entries()) {
      expect(Date.parse(run.startedAt)).toBeGreaterThanOrEqual(
        Date.parse(first21[index]?.endedAt ?? ""),
      );
    }
  });
});
