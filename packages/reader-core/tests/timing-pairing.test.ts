import type { AuditEvent } from "@andon/shared-types";
import { describe, expect, it } from "vitest";

import { CLOCK_SKEW_RECOVERY_WINDOW_MS, pairRuns } from "../src/timing/pairing.ts";

const T0 = Date.parse("2026-07-20T00:00:00Z");

/** Newest-first, like readAllAuditEvents — pairRuns must sort for itself. */
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

describe("pairRuns", () => {
  it("pairs a clean start with its completion", () => {
    const {
      events: sorted,
      boundaries,
      warnings,
    } = pairRuns(events(["STAGE_STARTED", "alpha", 0], ["STAGE_COMPLETED", "alpha", 5]));
    expect(warnings).toEqual([]);
    expect(sorted.map((e) => e.event)).toEqual(["STAGE_STARTED", "STAGE_COMPLETED"]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      stage: "alpha",
      openIndex: 0,
      closeIndex: 1,
      disposition: "completed",
      endedAt: "2026-07-20T00:05:00.000Z",
    });
  });

  it("abandons the first attempt on a same-stage double-START, opening a fresh boundary for the second", () => {
    const { boundaries, warnings } = pairRuns(
      events(["STAGE_STARTED", "a", 0], ["STAGE_STARTED", "a", 5], ["STAGE_COMPLETED", "a", 9]),
    );
    expect(warnings).toEqual(["stage run abandoned without completion: a"]);
    expect(boundaries).toHaveLength(2);
    // First attempt: opened at index 0, closed (abandoned) at index 1 — the
    // second STAGE_STARTED. Never reported, but its open window is still
    // tracked so attribution can correctly attribute whatever landed in it.
    expect(boundaries[0]).toMatchObject({ openIndex: 0, closeIndex: 1, disposition: "abandoned" });
    // Second attempt: opened at index 1 (same event that closed the first),
    // closed normally by its own completion at index 2.
    expect(boundaries[1]).toMatchObject({ openIndex: 1, closeIndex: 2, disposition: "completed" });
  });

  it("discards a run skipped while active — no boundary for a later re-derivation to mistake as a sample", () => {
    const { boundaries, warnings } = pairRuns(
      events(["STAGE_STARTED", "a", 0], ["STAGE_SKIPPED", "a", 5]),
    );
    expect(warnings).toEqual([]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      stage: "a",
      openIndex: 0,
      closeIndex: 1,
      disposition: "skipped",
      endedAt: null,
    });
  });

  it("recovers a clock-skew completion (terminal before its start) as a never-opened, distinctly worded boundary", () => {
    const { boundaries, warnings } = pairRuns(
      events(
        ["STAGE_COMPLETED", "alpha", 0, null, "aaa.md"],
        ["STAGE_STARTED", "alpha", 5, null, "bbb.md"],
      ),
    );
    expect(warnings).toEqual([
      "clock skew: STAGE_COMPLETED for alpha was recorded before its STAGE_STARTED (shards disagree on the clock) — closed as a zero-duration run",
    ]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      stage: "alpha",
      openIndex: null, // never opens — the terminal was consumed immediately
      closeIndex: 1, // the recovering STAGE_STARTED's own index
      disposition: "recovered-completed",
      startedAt: "2026-07-20T00:05:00.000Z",
      endedAt: "2026-07-20T00:00:00.000Z",
    });
  });

  it("recovers a clock-skew skip (terminal before its start) as a never-opened boundary with distinct wording and no reportable shape", () => {
    const { boundaries, warnings } = pairRuns(
      events(["STAGE_SKIPPED", "a", 0, null, "aaa.md"], ["STAGE_STARTED", "a", 5, null, "bbb.md"]),
    );
    expect(warnings).toEqual([
      "clock skew: STAGE_SKIPPED for a was recorded before its STAGE_STARTED (shards disagree on the clock) — discarded, no run recorded",
    ]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      stage: "a",
      openIndex: null,
      disposition: "recovered-skipped",
    });
  });

  describe("skew-recovery window", () => {
    it("still recovers right at the CLOCK_SKEW_RECOVERY_WINDOW_MS boundary (inside the window)", () => {
      const { boundaries, warnings } = pairRuns(
        events(
          ["STAGE_COMPLETED", "alpha", 0, null, "aaa.md"],
          ["STAGE_STARTED", "alpha", CLOCK_SKEW_RECOVERY_WINDOW_MS / 60_000, null, "bbb.md"],
        ),
      );
      expect(boundaries[0]?.disposition).toBe("recovered-completed");
      expect(warnings).toHaveLength(1);
    });

    it("does not recover a start beyond the window — the terminal stays an orphan and the start opens an ordinary run", () => {
      const oneMinutePastWindow = CLOCK_SKEW_RECOVERY_WINDOW_MS / 60_000 + 1;
      const { boundaries, warnings } = pairRuns(
        events(
          ["STAGE_COMPLETED", "alpha", 0, null, "aaa.md"],
          ["STAGE_STARTED", "alpha", oneMinutePastWindow, null, "bbb.md"],
        ),
      );
      expect(warnings).toEqual(["STAGE_COMPLETED without STAGE_STARTED: alpha"]);
      expect(boundaries).toHaveLength(1);
      expect(boundaries[0]).toMatchObject({ disposition: "open", openIndex: 1, closeIndex: null });
    });
  });

  it("filters out a synthetic single-stage lifecycle pair entirely — no boundary, no interference with the real open run", () => {
    const {
      events: sorted,
      boundaries,
      warnings,
    } = pairRuns([
      ...events(["STAGE_STARTED", "alpha", 0]),
      ...events(["STAGE_STARTED", "beta", 5, "single-stage:beta"]),
      ...events(["STAGE_COMPLETED", "beta", 6, "single-stage:beta"]),
      ...events(["STAGE_COMPLETED", "alpha", 10]),
    ]);
    expect(warnings).toEqual([]);
    expect(sorted.map((e) => e.stage)).toEqual(["alpha", "alpha"]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({ stage: "alpha", disposition: "completed" });
  });

  it("rejects an unparseable timestamp with a warning, and never gives it an index in the output stream", () => {
    const {
      events: sorted,
      boundaries,
      warnings,
    } = pairRuns([
      ...events(["STAGE_STARTED", "a", 0], ["STAGE_COMPLETED", "a", 8]),
      {
        event: "ARTIFACT_UPDATED",
        stage: null,
        timestamp: "not-a-date",
        shard: "a.md",
        workflow: null,
      },
    ]);
    expect(warnings).toEqual(["unparseable timestamp: not-a-date"]);
    expect(sorted).toHaveLength(2);
    expect(boundaries[0]).toMatchObject({ disposition: "completed", openIndex: 0, closeIndex: 1 });
  });

  it("keeps a boundary open (never closed) when nothing ever completes it, distinguishing it from abandoned/skipped", () => {
    const { boundaries, warnings } = pairRuns(events(["STAGE_STARTED", "alpha", 0]));
    expect(warnings).toEqual([]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({ disposition: "open", openIndex: 0, closeIndex: null });
  });

  it("tracks the not-reported abandoned/skipped boundaries' open windows correctly alongside a real concurrent run", () => {
    // f opens, n opens while f stays open, f double-starts (abandoning attempt
    // 1), n is skipped, f's second attempt completes. Every boundary's
    // open/close indices must reflect exactly when pairing made that decision
    // so attribution can soak up events correctly without re-deriving any of
    // this.
    const {
      events: sorted,
      boundaries,
      warnings,
    } = pairRuns(
      events(
        ["STAGE_STARTED", "f", 0], // index 0
        ["STAGE_STARTED", "n", 2], // index 1
        ["STAGE_STARTED", "f", 4], // index 2 — abandons f@0
        ["STAGE_SKIPPED", "n", 6], // index 3
        ["STAGE_COMPLETED", "f", 8], // index 4
      ),
    );
    expect(sorted).toHaveLength(5);
    expect(warnings).toEqual(["stage run abandoned without completion: f"]);
    expect(boundaries).toHaveLength(3);
    const fFirst = boundaries.find((b) => b.disposition === "abandoned");
    const n = boundaries.find((b) => b.stage === "n");
    const fSecond = boundaries.find((b) => b.disposition === "completed");
    expect(fFirst).toMatchObject({ stage: "f", openIndex: 0, closeIndex: 2 });
    expect(n).toMatchObject({ stage: "n", openIndex: 1, closeIndex: 3, disposition: "skipped" });
    expect(fSecond).toMatchObject({ stage: "f", openIndex: 2, closeIndex: 4 });
  });

  it("warns and never produces a boundary for a completion or skip with no start, ever", () => {
    const { boundaries, warnings } = pairRuns(events(["STAGE_COMPLETED", "a", 0]));
    expect(boundaries).toEqual([]);
    expect(warnings).toEqual(["STAGE_COMPLETED without STAGE_STARTED: a"]);
  });

  describe("rejected null-stage events never reach the emitted stream (PR#6 finding 1)", () => {
    // Pass 2 (attribution.ts) cuts a slice at every event in this stream,
    // and a STAGE_STARTED/STAGE_SKIPPED owns nothing (`sliceOwner`). A
    // rejected event that still occupied a slot in `events` would therefore
    // split the surrounding span into two slices and leave the first one
    // unowned — dropping it. The old single-loop `continue` fired before the
    // event ever touched anything; pairing must reproduce that — reject
    // BEFORE push, not warn-then-leave-it-in.
    it("excludes a no-stage STAGE_STARTED", () => {
      const { events: sorted, warnings } = pairRuns(
        events(["STAGE_STARTED", "a", 0], ["STAGE_STARTED", null, 5], ["STAGE_COMPLETED", "a", 10]),
      );
      expect(warnings).toEqual(["STAGE_STARTED with no Stage field at 2026-07-20T00:05:00.000Z"]);
      expect(sorted.map((e) => e.event)).toEqual(["STAGE_STARTED", "STAGE_COMPLETED"]);
    });

    it("excludes a no-stage STAGE_SKIPPED", () => {
      const { events: sorted, warnings } = pairRuns(
        events(["STAGE_STARTED", "a", 0], ["STAGE_SKIPPED", null, 5], ["STAGE_COMPLETED", "a", 10]),
      );
      expect(warnings).toEqual(["STAGE_SKIPPED with no Stage field at 2026-07-20T00:05:00.000Z"]);
      expect(sorted.map((e) => e.event)).toEqual(["STAGE_STARTED", "STAGE_COMPLETED"]);
    });

    it("excludes a no-stage STAGE_COMPLETED", () => {
      const { events: sorted, warnings } = pairRuns(
        events(
          ["STAGE_STARTED", "a", 0],
          ["STAGE_COMPLETED", null, 5],
          ["STAGE_COMPLETED", "a", 10],
        ),
      );
      // PR#6 finding 2: names the timestamp, not the literal (always-null)
      // stage value.
      expect(warnings).toEqual(["STAGE_COMPLETED with no Stage field at 2026-07-20T00:05:00.000Z"]);
      expect(sorted.map((e) => e.event)).toEqual(["STAGE_STARTED", "STAGE_COMPLETED"]);
    });
  });

  describe("pendingTerminals overwrite warning names the discarded side (PR#6 finding 3)", () => {
    it("names the discarded STAGE_COMPLETED when a later STAGE_SKIPPED for the same stage bumps it", () => {
      const { warnings } = pairRuns(events(["STAGE_COMPLETED", "a", 0], ["STAGE_SKIPPED", "a", 1]));
      // Before the fix the first (supersede) warning read "STAGE_SKIPPED
      // with no open run: a (superseded ...)" — naming the newly arriving
      // SKIPPED instead of the COMPLETED that actually got discarded. The
      // second warning is unrelated to the finding: the surviving (skipped)
      // pending entry is never recovered by a later STAGE_STARTED here, so
      // it reports its own ordinary orphan warning at the end.
      expect(warnings).toEqual([
        "STAGE_COMPLETED without STAGE_STARTED: a (superseded by a later terminal event for the same stage before either found a start)",
        "STAGE_SKIPPED with no open run: a",
      ]);
    });

    it("names the discarded STAGE_SKIPPED when a later STAGE_COMPLETED for the same stage bumps it", () => {
      const { warnings } = pairRuns(events(["STAGE_SKIPPED", "a", 0], ["STAGE_COMPLETED", "a", 1]));
      // Before the fix the first (supersede) warning read "STAGE_COMPLETED
      // without STAGE_STARTED: a (superseded by a later STAGE_COMPLETED
      // ...)" — naming the newly arriving COMPLETED instead of the SKIPPED
      // that actually got discarded. The second warning is the surviving
      // (completed) pending entry's own ordinary orphan warning at the end.
      expect(warnings).toEqual([
        "STAGE_SKIPPED with no open run: a (superseded by a later terminal event for the same stage before either found a start)",
        "STAGE_COMPLETED without STAGE_STARTED: a",
      ]);
    });
  });
});
