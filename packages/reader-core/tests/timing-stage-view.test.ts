import { isLowConfidenceEstimate, type StageView } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { resolveStageViews } from "../src/timing/stage-view.ts";
import { run, stage, workflow } from "./timing-fixtures.ts";

/**
 * Issue #9: every rule for reconciling the state file's `status` against the
 * audit log's runs lives in `resolveStageViews`. This file is where those
 * rules are pinned — the cases below were previously spread across
 * `timing-estimate.test.ts` and `dashboard/tests/timings.test.tsx`, each
 * asserting its own consumer's re-derivation of the same rule.
 */

/** Fails with the slug rather than a bare `undefined` when a view is missing. */
function viewOf(views: readonly StageView[], slug: string): StageView {
  const view = views.find((v) => v.stage === slug);
  expect(view, `no view for ${slug}`).toBeDefined();
  return view as StageView;
}

describe("resolveStageViews", () => {
  it("emits one view per state-file stage, in order, carrying the row verbatim", () => {
    const views = resolveStageViews(
      workflow({
        currentStage: "b",
        stages: [
          stage("a", { phase: "IDEATION", status: "completed" }),
          stage("b", { status: "in-progress", unparseable: 'unknown-mark: "@"' }),
          stage("c", { execution: "SKIP", status: "skipped" }),
        ],
      }),
      [],
    );

    expect(views.map((v) => v.stage)).toEqual(["a", "b", "c"]);
    expect(views.map((v) => v.isCurrent)).toEqual([false, true, false]);
    expect(viewOf(views, "a").phase).toBe("IDEATION");
    expect(viewOf(views, "b").unparseable).toBe('unknown-mark: "@"');
    expect(viewOf(views, "c").execution).toBe("SKIP");
  });

  it("marks no view current when `currentStage` names no row at all", () => {
    // The structural backstop for the engine's `none` sentinel (PR #4 finding
    // R15): `parse/state.ts` normalises `Current Stage: none` to null, but
    // even a literal that slips through can only fail to match a row here —
    // it can no longer be sized as if it were an unstarted stage.
    const views = resolveStageViews(
      workflow({ currentStage: "none", stages: [stage("a", { status: "completed" })] }),
      [run("a", 600_000)],
    );
    expect(views.some((v) => v.isCurrent)).toBe(false);
    expect(views.every((v) => !v.countsTowardRemaining)).toBe(true);
  });

  describe("which run is the attempt in play", () => {
    it("reads openness from the run data, not from the status", () => {
      // STAGE_COMPLETED fires only after GATE_APPROVED, so a stage sitting at
      // its gate can still have an open run — a status-based rule would call
      // this attempt finished and show the previous one's duration.
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "awaiting-approval" })] }),
        [run("a", 600_000, false, "01"), run("a", 300_000, true, "02")],
      );
      const a = viewOf(views, "a");
      expect(a.running).toBe(true);
      expect(a.currentAttempt?.activeMs).toBe(300_000);
      expect(a.actualActiveMs).toBeNull();
      expect(a.elapsedActiveMs).toBe(300_000);
      expect(a.history.map((r) => r.activeMs)).toEqual([600_000]);
    });

    it("takes the most recent closed run when the status agrees the attempt finished", () => {
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "completed" })] }),
        [run("a", 600_000, false, "01"), run("a", 900_000, false, "03")],
      );
      const a = viewOf(views, "a");
      expect(a.running).toBe(false);
      expect(a.actualActiveMs).toBe(900_000);
      expect(a.history.map((r) => r.activeMs)).toEqual([600_000]);
    });

    it("prefers the later audit-order run when two attempts closed in the same second", () => {
      // Audit timestamps are second-resolution, so two rapid reruns can share
      // an `endedAt`. `getStageTimings` emits closed runs in closure order, so
      // the later array entry is the newer attempt — a strict `>` tie-break
      // would surface the older attempt's duration as the measurement (Codex
      // review on PR #15).
      const older = { ...run("a", 600_000), endedAt: "2026-07-20T01:30:00Z" };
      const newer = { ...run("a", 120_000), endedAt: "2026-07-20T01:30:00Z" };
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "completed" })] }),
        [older, newer],
      );
      const a = viewOf(views, "a");
      expect(a.actualActiveMs).toBe(120_000);
      expect(a.history).toEqual([older]);
    });

    it("still picks the newest close, not simply the last entry, when runs arrive out of order", () => {
      // Cross-shard clock skew can put an older close after a newer one in the
      // array. The tie-break above only relaxes *equal* timestamps; a strictly
      // earlier one must still lose.
      const newer = run("a", 120_000, false, "03");
      const older = run("a", 600_000, false, "01");
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "completed" })] }),
        [newer, older],
      );
      expect(viewOf(views, "a").actualActiveMs).toBe(120_000);
    });

    it("treats a pre-jump closed run as history when a backward jump reset the status", () => {
      // `aidlc-jump.ts` resets a downstream stage to `not-started` without
      // erasing its STAGE_STARTED/STAGE_COMPLETED pair. "Closed run, no open
      // run" is indistinguishable from a finished attempt in the log alone —
      // the status is the only signal, and getting it right here is what used
      // to have to be got right separately in estimate.ts and StageRail.
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "not-started" })] }),
        [run("a", 600_000)],
      );
      const a = viewOf(views, "a");
      expect(a.currentAttempt).toBeNull();
      expect(a.actualActiveMs).toBeNull();
      expect(a.elapsedActiveMs).toBeNull();
      expect(a.history).toHaveLength(1);
    });

    it("keeps elapsed null rather than 0 for a stage that never ran", () => {
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a")] }),
        [],
        [run("b", 600_000)],
      );
      expect(viewOf(views, "a").elapsedActiveMs).toBeNull();
    });

    it("never adopts another record's run for the same slug", () => {
      // `activeRuns` is the active record's own runs; `samples` is the
      // space-wide pool. A foreign intent's open run for this slug may size
      // the estimate but must never stand in for this record's elapsed time.
      const foreignOpen = run("a", 999_999_999, true);
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "in-progress" })] }),
        [],
        [foreignOpen, run("a", 600_000)],
      );
      const a = viewOf(views, "a");
      expect(a.running).toBe(false);
      expect(a.elapsedActiveMs).toBeNull();
      expect(a.estimateMs).toBe(600_000);
    });
  });

  describe("remaining work", () => {
    it("bills the full estimate when the attempt has not started", () => {
      // `Current Stage` can advance before STAGE_STARTED is emitted, so "no
      // run yet" is not "no work left".
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a"), stage("b", { status: "completed" })] }),
        [],
        [run("b", 600_000)],
      );
      expect(viewOf(views, "a")).toMatchObject({ remainingMs: 600_000, basis: "phase" });
    });

    it("subtracts the open run's elapsed time, clamped at zero", () => {
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "in-progress" })] }),
        [run("a", 400_000, true, "02")],
        [run("a", 600_000), run("a", 400_000, true, "02")],
      );
      expect(viewOf(views, "a").remainingMs).toBe(200_000);

      const overrun = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "in-progress" })] }),
        [run("a", 900_000, true, "02")],
        [run("a", 100_000), run("a", 900_000, true, "02")],
      );
      expect(viewOf(overrun, "a").remainingMs).toBe(0);
    });

    it("reports 0 once the attempt has closed — the gate is not hands-on work", () => {
      const closed = run("a", 1_144_000);
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "awaiting-approval" })] }),
        [closed],
      );
      expect(viewOf(views, "a")).toMatchObject({ elapsedActiveMs: 1_144_000, remainingMs: 0 });
    });

    it("does not infer zero remaining from an untrustworthy closed audit run", () => {
      const closed = {
        ...run("a", 0),
        activeMs: null,
        breakdown: null,
        quality: {
          status: "incomplete" as const,
          reasons: ["terminal-scope-mismatch"],
          sampleEligible: false,
        },
      };
      const atGate = resolveStageViews(
        workflow({ stages: [stage("a", { status: "awaiting-approval" })] }),
        [closed],
        [run("a", 15 * 60_000)],
      );
      expect(viewOf(atGate, "a")).toMatchObject({
        estimateMs: 15 * 60_000,
        actualActiveMs: null,
        elapsedActiveMs: null,
        remainingMs: null,
      });
      for (const finished of [
        stage("a", { status: "completed" }),
        stage("a", { status: "skipped" }),
        stage("a", { status: "awaiting-approval", execution: "SKIP" }),
      ]) {
        const views = resolveStageViews(workflow({ stages: [finished] }), [closed]);
        expect(viewOf(views, "a").remainingMs).toBe(0);
      }
    });

    it("reports 0 for a skipped or out-of-scope stage whatever the history says", () => {
      // The final-stage skip path leaves `Current Stage` on the skipped slug
      // while flipping the workflow to Completed; a skipped run is discarded
      // upstream, so the slug looks exactly like an unstarted one here.
      const views = resolveStageViews(
        workflow({
          currentStage: "last",
          stages: [
            stage("earlier", { status: "completed" }),
            stage("last", { status: "skipped" }),
            stage("never", { execution: "SKIP", status: "skipped" }),
          ],
        }),
        [],
        [run("earlier", 600_000)],
      );
      expect(viewOf(views, "last").remainingMs).toBe(0);
      expect(viewOf(views, "never").remainingMs).toBe(0);
    });

    it("reports null when no estimate could be derived at all", () => {
      const views = resolveStageViews(workflow({ currentStage: "a", stages: [stage("a")] }), []);
      expect(viewOf(views, "a")).toMatchObject({
        estimateMs: null,
        remainingMs: null,
        basis: "none",
      });
    });

    it("reports null for an open run with nothing to size it against", () => {
      // Elapsed is known, the estimate is not — there is no remainder to
      // subtract from, and 0 would read as "this running stage is done".
      const open = run("a", 300_000, true);
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "in-progress" })] }),
        [open],
      );
      expect(viewOf(views, "a")).toMatchObject({
        elapsedActiveMs: 300_000,
        estimateMs: null,
        remainingMs: null,
      });
    });

    it("does not subtract unknown elapsed work from a known estimate", () => {
      const broken = {
        ...run("a", 0, true),
        activeMs: null,
        breakdown: null,
        quality: {
          status: "incomplete" as const,
          reasons: ["audit-read-incomplete"],
          sampleEligible: false,
        },
      };
      const views = resolveStageViews(
        workflow({ stages: [stage("a", { status: "in-progress" })] }),
        [broken],
        [run("a", 15 * 60_000)],
      );
      expect(viewOf(views, "a")).toMatchObject({
        estimateMs: 15 * 60_000,
        elapsedActiveMs: null,
        remainingMs: null,
        breakdown: null,
        quality: broken.quality,
      });
    });

    it("distinguishes a missing active audit run from an attempt that has not started", () => {
      const views = resolveStageViews(
        workflow({ stages: [stage("a"), stage("b", { status: "in-progress" })] }),
        [],
        [run("a", 15 * 60_000)],
      );
      expect(viewOf(views, "a")).toMatchObject({ remainingMs: 15 * 60_000, quality: null });
      expect(viewOf(views, "b")).toMatchObject({
        remainingMs: null,
        quality: { status: "incomplete", reasons: ["audit-run-missing"], sampleEligible: false },
      });
    });

    it("forwards the current attempt breakdown and keeps pending observation out of work", () => {
      const open = {
        ...run("a", 5 * 60_000, true),
        breakdown: {
          observedWallMs: 12 * 60_000,
          workMs: 5 * 60_000,
          approvalWaitMs: 0,
          suspendedMs: 0,
          excludedGapMs: 0,
          pendingObservationMs: 7 * 60_000,
          unattributedMs: 0,
        },
        quality: { status: "usable" as const, reasons: [], sampleEligible: false },
        lastObservationAt: "2026-07-20T01:05:00Z",
        sinceLastObservationMs: 7 * 60_000,
        sensitivity: [{ thresholdMs: 20 * 60_000, workMs: 5 * 60_000 }],
      };
      const views = resolveStageViews(
        workflow({ stages: [stage("a", { status: "in-progress" })] }),
        [open],
        [run("a", 15 * 60_000)],
      );
      expect(viewOf(views, "a")).toMatchObject({
        remainingMs: 10 * 60_000,
        breakdown: open.breakdown,
        quality: open.quality,
        lastObservationAt: open.lastObservationAt,
        sinceLastObservationMs: open.sinceLastObservationMs,
        sensitivity: open.sensitivity,
      });
    });
  });

  describe("which views count toward the roll-up", () => {
    it("counts in-scope stages that are neither completed nor skipped", () => {
      const views = resolveStageViews(
        workflow({
          currentStage: "cur",
          stages: [
            stage("cur", { status: "in-progress" }),
            stage("skipme", { execution: "SKIP" }),
            stage("done", { status: "completed" }),
            stage("gone", { status: "skipped" }),
            stage("todo"),
          ],
        }),
        [],
        [run("x", 100)],
      );
      expect(views.filter((v) => v.countsTowardRemaining).map((v) => v.stage)).toEqual([
        "cur",
        "todo",
      ]);
    });

    it("excludes a finished current stage from remaining coverage", () => {
      const views = resolveStageViews(
        workflow({ currentStage: "a", stages: [stage("a", { status: "completed" })] }),
        [run("a", 600_000)],
      );
      expect(viewOf(views, "a")).toMatchObject({ countsTowardRemaining: false, remainingMs: 0 });
    });
  });

  describe("estimate confidence", () => {
    it("carries the fallback rung and sample count on every view", () => {
      const samples = [run("a", 100), run("a", 300), run("b", 500)];
      const views = resolveStageViews(
        workflow({
          stages: [
            stage("a", { status: "completed" }),
            stage("b", { status: "completed" }),
            stage("c"),
            stage("z", { phase: "OPERATION" }),
          ],
        }),
        [],
        samples,
      );
      expect(viewOf(views, "a")).toMatchObject({ estimateMs: 200, sampleCount: 2, basis: "stage" });
      expect(viewOf(views, "c")).toMatchObject({ estimateMs: 300, basis: "phase" });
      expect(viewOf(views, "z")).toMatchObject({ estimateMs: 300, basis: "global" });
    });

    it("is readable straight off a view with the app's one low-confidence predicate", () => {
      const views = resolveStageViews(
        workflow({ stages: [stage("a"), stage("b")] }),
        [],
        [run("a", 100), run("a", 200), run("b", 300)],
      );
      expect(isLowConfidenceEstimate(viewOf(views, "a"))).toBe(false);
      expect(isLowConfidenceEstimate(viewOf(views, "b"))).toBe(true);
    });

    it("marks the current attempt's limited coverage even with two usable historical samples", () => {
      const views = resolveStageViews(
        workflow({ stages: [stage("a", { status: "in-progress" })] }),
        [
          {
            ...run("a", 50, true),
            quality: { status: "limited", reasons: ["excluded-log-gap"], sampleEligible: false },
          },
        ],
        [run("a", 100), run("a", 200)],
      );
      expect(viewOf(views, "a")).toMatchObject({ limitedSampleCount: 0, sampleCount: 2 });
      expect(isLowConfidenceEstimate(viewOf(views, "a"))).toBe(true);
    });

    it("ignores open runs when sizing an estimate", () => {
      const views = resolveStageViews(
        workflow({ stages: [stage("a")] }),
        [],
        [run("a", 999_999, true)],
      );
      expect(viewOf(views, "a").basis).toBe("none");
    });
  });
});
