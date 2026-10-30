import type { AuditEvent } from "@andon/shared-types";
import { compareByTime, timeOf } from "../audit/events.ts";
export const CLOCK_SKEW_RECOVERY_WINDOW_MS = 10 * 60_000;

/** Pair lifecycle boundaries independently of the work-gap policy. */

export type RunDisposition =
  | "completed"
  | "open"
  | "abandoned"
  | "skipped"
  | "recovered-completed"
  | "recovered-skipped";

/**
 * One run's pairing outcome. Issue #5 risk note 1: this is an explicit
 * ordered open/close structure — indices into `PairingResult.events`, not
 * just a final run object — so pass 2 can replay attribution by walking that
 * same sorted array instead of re-deriving its own sweep-line (which would
 * silently reintroduce pairing logic into attribution).
 *
 * Risk note 2: boundaries include runs that are ultimately NOT reported —
 * `abandoned` (a double-START's first attempt) and `skipped` (a
 * STAGE_SKIPPED-while-active run). In the single-loop original these sat in
 * `openRuns` while open: they soaked up attributed events and advanced
 * cursors, and only then vanished. Omitting them here would let pass 2
 * attribute their events to a different (wrong) run. `disposition` lets
 * final assembly report only `completed`/`recovered-completed`/`open` while
 * attribution still sees all six kinds.
 *
 * Risk note 3: "most recently opened" is insertion order of STAGE_STARTED
 * events in this sorted stream, including the delete-then-reinsert a
 * same-stage double-start performs. Pass 2 walking `events` by index and
 * opening/closing boundaries at their recorded indices reproduces that
 * insertion order for free — reconstructing it from timestamps alone would
 * reorder same-second ties.
 */
export interface RunBoundary {
  stage: string;
  startedAt: string;
  startMs: number;
  /**
   * Index into `PairingResult.events` where this run actually opens. `null`
   * for `recovered-completed`/`recovered-skipped`: the reversed pair's
   * terminal event was consumed the instant the STAGE_STARTED that recovers
   * it arrived, so the run's open interval is empty — it never occupies a
   * slot pass 2's attribution loop could bill anything against. (Verified
   * rather than special-cased: modelling it as never-open is what makes its
   * `activeMs`/`eventCount` come out zero on their own in attribution.ts.)
   */
  openIndex: number | null;
  /**
   * Index into `PairingResult.events` of the event that closes this run —
   * its own terminal event, the double-START that abandons it, or the
   * STAGE_STARTED that recovers a pending terminal. `null` while still open
   * at the end of the stream (`disposition: "open"`).
   */
  closeIndex: number | null;
  /** `null` for `open`/`abandoned`/`skipped` — none of those have a real end. */
  endedAt: string | null;
  disposition: RunDisposition;
}

export interface PairingResult {
  /**
   * `compareByTime`-sorted, with single-stage-workflow events and
   * unparseable-timestamp events removed. Pass 2 walks this exact array by
   * index — `RunBoundary.openIndex`/`closeIndex` are only meaningful against
   * this array, not against the caller's original `events`.
   */
  events: AuditEvent[];
  boundaries: RunBoundary[];
  warnings: string[];
}

/**
 * Codex round 11, finding 3: this used to be `PendingCompletion`, holding
 * only STAGE_COMPLETEDs that arrived with no matching open run. STAGE_SKIPPED
 * is terminal for a run the same way STAGE_COMPLETED is, so it can strand a
 * run open forever the exact same way — a skip that sorts before its own
 * start (cross-shard clock skew) used to only warn and leave the eventual
 * STAGE_STARTED to open a run nothing ever closes. `kind` lets the shared
 * bounded skew-recovery path in the STAGE_STARTED handler give a recovered
 * skip the discard-don't-close treatment real STAGE_SKIPPEDs get, instead of
 * the zero-duration-run treatment recovered completions get — and lets the
 * two stay distinguishable in the warning text a reader sees.
 */
interface PendingTerminal {
  event: AuditEvent;
  at: number;
  kind: "completed" | "skipped";
}

/**
 * PR#6 finding 3: the warning for a pending terminal event that's about to
 * be discarded — either superseded by a second terminal event for the same
 * stage, or still orphaned when the stream ends. Always keyed off the
 * DISCARDED entry's own `kind`, never the kind of whatever event triggered
 * the discard: a `STAGE_SKIPPED` bumping a pending `STAGE_COMPLETED` (or the
 * reverse) must still name the completion as the thing that got dropped, not
 * mislabel it with the incoming event's kind.
 */
function orphanTerminalWarning(pending: PendingTerminal, suffix = ""): string {
  return pending.kind === "completed"
    ? `STAGE_COMPLETED without STAGE_STARTED: ${pending.event.stage}${suffix}`
    : `STAGE_SKIPPED with no open run: ${pending.event.stage}${suffix}`;
}

/**
 * Codex round 11, finding 1: there used to be a `comparePairAware` wrapper
 * here that forced STAGE_STARTED before STAGE_COMPLETED whenever two events
 * named the same stage and shared a timestamp — added to fix a cross-shard
 * tie (this log has second resolution) where the shard-name tiebreak could
 * sort a stage's own completion ahead of its start, stranding the start open
 * forever.
 *
 * That rule is gone. It shared its trigger (same stage, same second, one
 * STARTED and one COMPLETED) with a case it broke: a rerun whose closing
 * COMPLETED and reopening STARTED land in the same second (a rapid backward
 * jump plus this log's second resolution). A pure comparator cannot tell
 * "cross-shard tie" from "real rerun boundary" apart — the distinction is run
 * *state*, not event content — so forcing STARTED-first unconditionally
 * reordered the rerun's real boundary too, collapsing two genuine attempts
 * into one abandoned run plus one orphaned completion.
 *
 * The cross-shard tie does not need a comparator rule: with plain
 * `compareByTime`, the completion sorts first, finds no open run, and lands
 * in `pendingTerminals` below; the same-second (or later, within
 * `CLOCK_SKEW_RECOVERY_WINDOW_MS`) STAGE_STARTED then recovers it via the bounded skew
 * recovery a few lines down (`at >= pending.at` holds on a tie). That is
 * already the correct place for "these two events are the same lifecycle
 * pair, just clock-disordered" to be resolved. The rerun boundary needs no
 * help at all: with the comparator rule gone, `compareByTime`'s stable
 * tiebreak preserves append order for a same-shard tie, so
 * COMPLETED-then-STARTED still sorts COMPLETED first, closing attempt 1
 * before attempt 2 opens.
 */

export function pairRuns(rawEvents: readonly AuditEvent[]): PairingResult {
  const warnings: string[] = [];
  const boundaries: RunBoundary[] = [];
  // Currently-open boundary per stage. Iteration order of a Map is insertion
  // order, and re-inserting a key (delete then set) moves it to the end —
  // that is what lets "most recently opened" fall out of a plain
  // `for...of openBoundaries.values()` walk for attribution's `sliceOwner`
  // fallback and tail-owner logic, instead of a separate stack. Finding 1 (unit-major
  // iteration): several design stages can legitimately be open at once —
  // see stage-protocol.md's "Unit-major iteration" section. A single global
  // "open" slot abandoned every earlier stage the moment the next one
  // started; keying by stage lets each stay open until its OWN
  // STAGE_COMPLETED (or STAGE_SKIPPED) closes it, regardless of what else
  // opened meanwhile. A genuine double-START of the SAME stage still
  // abandons and warns below — only a *different* stage starting must leave
  // existing opens undisturbed.
  const openBoundaries = new Map<string, RunBoundary>();
  // STAGE_COMPLETEDs and STAGE_SKIPPEDs that found no matching open run for
  // their own stage (whether or not OTHER stages are open), keyed by stage,
  // waiting to see whether a same-stage STAGE_STARTED shows up after them —
  // the clock-skew reversal case Part 2 below recovers. A `null`-stage
  // terminal event can't be keyed this way and falls back to the plain
  // unmatched warning immediately.
  const pendingTerminals = new Map<string, PendingTerminal>();

  // `single-stage:` filter first (a `/aidlc --stage <slug> --single` run —
  // or an `/aidlc-<stage>` runner skill — is deliberately ISOLATED from the
  // main workflow; the engine itself never lets it advance `Current Stage`,
  // aidlc-orchestrate.ts). It still emits a real STAGE_STARTED/
  // STAGE_COMPLETED pair to `audit.md`, tagged `**Workflow**:
  // single-stage:<slug>`, and the engine's own report-floor logic
  // (`auditBlockField(...).startsWith("single-stage:")`) skips that tag the
  // same way. We mirror that predicate here: without it, this synthetic
  // STAGE_STARTED would abandon whatever main-workflow run is genuinely open
  // (destroying its measured duration) and the synthetic STAGE_COMPLETED
  // would register as a run of its own — a spurious sample in the estimate
  // pool for a stage nobody actually worked on right now.
  //
  // Residual limitation: only the lifecycle pair itself carries `Workflow`.
  // Other audit events a concurrent single-stage run emits (artifact writes,
  // sensor fires) do not, so if one runs while a main-workflow stage is
  // open, those events still land inside that stage's window and inflate
  // its `activeMs` in pass 2. That's a bounded inaccuracy in a time estimate
  // — the human genuinely was doing something in that window — not the
  // total loss of a run that skipping the lifecycle pair prevents.
  const sorted = rawEvents
    .filter((event) => !event.workflow?.startsWith("single-stage:"))
    .sort(compareByTime);

  const events: AuditEvent[] = [];

  for (const event of sorted) {
    // `Date.parse` returns `NaN` for a malformed timestamp. Reject it here,
    // before it ever reaches `events` — pass 2 can then trust every
    // timestamp it sees parses, and a rejected event contributes nothing to
    // any run's gap cursor (it never occupies an index at all).
    const at = timeOf(event);
    if (Number.isNaN(at)) {
      warnings.push(`unparseable timestamp: ${event.timestamp}`);
      continue;
    }

    if (event.event === "STAGE_STARTED") {
      if (event.stage === null) {
        // PR#6 finding 1: reject BEFORE this event ever occupies a slot in
        // `events`, same as the unparseable-timestamp case above. Pass 2 cuts
        // a slice of the timeline at every event in this stream, and a
        // STAGE_STARTED/STAGE_SKIPPED owns none of it (`sliceOwner` in
        // attribution.ts). Leaving a rejected event in the stream would
        // therefore split the surrounding span in two and leave the earlier
        // half unowned — dropping whatever preceded it, exactly the leak this
        // fix closes. The three null-stage lifecycle rejections below (this
        // one, STAGE_SKIPPED, STAGE_COMPLETED) all push AFTER this check for
        // the same reason.
        warnings.push(`STAGE_STARTED with no Stage field at ${event.timestamp}`);
        continue;
      }
      const index = events.length;
      events.push(event);

      // Part 2: a terminal event (STAGE_COMPLETED or, since Codex round 11
      // finding 3, STAGE_SKIPPED) for this exact stage already arrived with
      // no run open, and this start lands at or after it — a pairing broken
      // by the two events landing in different shards with disagreeing
      // clocks. Recover it instead of opening a run that will now never see
      // its (already-consumed) terminal event and stay open forever.
      //
      // Bounded to CLOCK_SKEW_RECOVERY_WINDOW_MS: unbounded, this "recovery" hijacks an
      // unrelated LEGITIMATE rerun. If a prior attempt's STAGE_STARTED is
      // missing or malformed while its terminal event survives, that event
      // sits in `pendingTerminals` indefinitely; when the same stage is
      // genuinely re-run hours or days later, this branch would consume that
      // new, real start as the old terminal event's "reversed pair",
      // recording a spurious result that never opens — and its own real
      // terminal event becomes the next orphan. Clock disagreement between
      // clones is a small-magnitude effect (seconds, not minutes); this independent recovery window gives clock skew generous headroom
      // while staying far below the gap a real rerun leaves. Beyond the
      // window, the terminal event is left in `pendingTerminals` as the
      // genuine orphan it is (it still surfaces its unmatched-terminal
      // warning at the end) and this start falls through to open an
      // ordinary new run below.
      const pending = pendingTerminals.get(event.stage);
      if (
        pending !== undefined &&
        at >= pending.at &&
        at - pending.at <= CLOCK_SKEW_RECOVERY_WINDOW_MS
      ) {
        pendingTerminals.delete(event.stage);
        if (pending.kind === "completed") {
          warnings.push(
            `clock skew: STAGE_COMPLETED for ${event.stage} was recorded before its STAGE_STARTED (shards disagree on the clock) — closed as a zero-duration run`,
          );
          boundaries.push({
            stage: event.stage,
            startedAt: event.timestamp,
            startMs: at,
            openIndex: null,
            closeIndex: index,
            endedAt: pending.event.timestamp,
            disposition: "recovered-completed",
          });
        } else {
          // A recovered skip gets the same DISCARD treatment an ordinary
          // STAGE_SKIPPED gets below — no reported run, so it can never be
          // mistaken for a sample in estimate.ts's pool. Distinct wording
          // from the completed case so a reader can tell "this pair was a
          // skip" from "this pair was a completion" apart.
          warnings.push(
            `clock skew: STAGE_SKIPPED for ${event.stage} was recorded before its STAGE_STARTED (shards disagree on the clock) — discarded, no run recorded`,
          );
          boundaries.push({
            stage: event.stage,
            startedAt: event.timestamp,
            startMs: at,
            openIndex: null,
            closeIndex: index,
            endedAt: pending.event.timestamp,
            disposition: "recovered-skipped",
          });
        }
        continue;
      }

      // A same-stage double-START is still a genuine abandonment: the first
      // attempt never saw its own completion, so its measured duration is
      // meaningless and the warning still fires. A *different* stage
      // starting while this one is open is the unit-major case Finding 1
      // fixes — it must NOT reach this branch, and it doesn't: it simply
      // adds a new key below.
      const existing = openBoundaries.get(event.stage);
      if (existing !== undefined) {
        warnings.push(`stage run abandoned without completion: ${event.stage}`);
        existing.closeIndex = index;
        existing.disposition = "abandoned";
        openBoundaries.delete(event.stage); // re-set below so it becomes "most recently opened"
      }
      const boundary: RunBoundary = {
        stage: event.stage,
        startedAt: event.timestamp,
        startMs: at,
        openIndex: index,
        closeIndex: null,
        endedAt: null,
        disposition: "open",
      };
      boundaries.push(boundary);
      openBoundaries.set(event.stage, boundary);
      continue;
    }

    // Finding 2: STAGE_SKIPPED is terminal for that stage's run, the same
    // way STAGE_COMPLETED is — stage-protocol.md's conditional-skip section
    // is explicit that the engine "starts the next in-scope stage ...
    // without emitting STAGE_COMPLETED". Left alone, a skipped-while-active
    // stage's run would stay open forever; on the final in-scope stage that
    // means an open run survives past workflow completion, and
    // /api/timings' consumers (the dashboard's open-run poll) never see it
    // close.
    //
    // DISCARD, don't close: a skipped stage did no work, so it has no
    // duration worth reporting, and — the sharper reason — estimate.ts's
    // sample pool is keyed on nothing but `endedAt !== null`. Closing this
    // run (even at `activeMs: 0`) would still enter the pool as a same-stage
    // sample; a real run that's merely fast is legitimate signal, but a
    // skipped run is not evidence of "how long this stage takes" and must
    // never be mistaken for one. `disposition: "skipped"` is excluded from
    // final assembly entirely — the only shape that can't be misread as a
    // sample.
    if (event.event === "STAGE_SKIPPED") {
      if (event.stage === null) {
        // PR#6 finding 1: same rejected-before-push reasoning as the
        // STAGE_STARTED null-stage case above.
        warnings.push(`STAGE_SKIPPED with no Stage field at ${event.timestamp}`);
        continue;
      }
      const index = events.length;
      events.push(event);
      const open = openBoundaries.get(event.stage);
      if (open !== undefined) {
        open.closeIndex = index;
        open.disposition = "skipped";
        openBoundaries.delete(event.stage);
      } else {
        // Codex round 11, finding 3: this used to warn immediately and stop
        // there, leaving a same-stage STAGE_STARTED that arrives later (the
        // cross-shard skew case — the skip sorted before its own start) with
        // nothing telling it the stage was already skipped, so it opened a
        // run nothing would ever close. Route it through the same bounded
        // pending/recovery mechanism unmatched STAGE_COMPLETEDs already use
        // (Part 2 of the STAGE_STARTED handler above) instead of a parallel
        // one: if a same-stage start shows up within CLOCK_SKEW_RECOVERY_WINDOW_MS, it
        // recovers this as a discarded (not zero-duration-closed) run; if
        // not, this exact warning still fires at the end as the genuine
        // orphan it is.
        // PR#6 finding 3: derive the "superseded" warning from the entry
        // actually being DISCARDED (the pending one), not from this newly
        // arriving STAGE_SKIPPED — the pending entry may itself be a
        // STAGE_COMPLETED, and the warning must say so.
        const superseded = pendingTerminals.get(event.stage);
        if (superseded !== undefined) {
          warnings.push(
            orphanTerminalWarning(
              superseded,
              " (superseded by a later terminal event for the same stage before either found a start)",
            ),
          );
        }
        pendingTerminals.set(event.stage, { event, at, kind: "skipped" });
      }
      continue;
    }

    if (event.event === "STAGE_COMPLETED") {
      const completedStage = event.stage;
      if (completedStage === null) {
        // PR#6 finding 1: reject BEFORE push — same reasoning as the
        // STAGE_STARTED/STAGE_SKIPPED null-stage cases above. A stage-less
        // STAGE_COMPLETED can never close or recover a boundary (pairing has
        // no stage to key `pendingTerminals` by), so it must stay fully
        // invisible to pass 2 too, not merely warned-about while still
        // occupying a slot `events` for `advanceCursors` to silently walk
        // past.
        // PR#6 finding 2: name the timestamp, not the (always-null) stage —
        // matches the sibling STAGE_STARTED/STAGE_SKIPPED wording above,
        // which never interpolated a value that's known to always be `null`
        // in this branch.
        warnings.push(`STAGE_COMPLETED with no Stage field at ${event.timestamp}`);
        continue;
      }
      const index = events.length;
      events.push(event);
      const open = openBoundaries.get(completedStage);
      if (open === undefined) {
        // Finding 1 (Codex round 7): doesn't match any currently-open run —
        // it names a stage that isn't open yet (the cross-shard skew case:
        // its own STAGE_STARTED hasn't sorted in ahead of it). This must be
        // recorded into `pendingTerminals` unconditionally — NOT only when
        // `openBoundaries.size === 0` as before. Gating it behind an empty
        // open set meant a concurrent design stage staying open for its own
        // late cascade gate silently swallowed every OTHER stage's
        // cross-shard completion as generic "activity" in the old single
        // loop; that stage's later STAGE_STARTED then had nothing to
        // recover against and stayed open forever, corrupting both its own
        // elapsed time and the estimate pool.
        //
        // No boundary is created here — deliberately. A STAGE_COMPLETED
        // that names a stage is evidence of work on THAT stage, never on
        // whichever run happens to still be open; attribution.ts's
        // `sliceOwner` enforces the "owns nothing" half of that (see rule 1
        // there), but the pairing half is just as
        // important: creating a boundary here would let it later collide
        // with its own recovered (typically zero-duration) run via Part 2
        // above — the same instant claimed twice. If it never recovers, it
        // is an orphan with nothing reliable to attach anywhere.
        //
        // Only recover when unambiguous: at most one pending terminal
        // event per stage. A second one bumps the first rather than
        // stacking — keep the newest, warn about the one it replaces.
        //
        // PR#6 finding 3: derive the "superseded" warning from the entry
        // actually being DISCARDED (the pending one), not from this newly
        // arriving STAGE_COMPLETED — the pending entry may itself be a
        // STAGE_SKIPPED, and the warning must say so.
        const superseded = pendingTerminals.get(completedStage);
        if (superseded !== undefined) {
          warnings.push(
            orphanTerminalWarning(
              superseded,
              " (superseded by a later terminal event for the same stage before either found a start)",
            ),
          );
        }
        pendingTerminals.set(completedStage, { event, at, kind: "completed" });
        continue;
      }
      open.closeIndex = index;
      open.endedAt = event.timestamp;
      open.disposition = "completed";
      openBoundaries.delete(completedStage);
      continue;
    }

    // Any other event (ARTIFACT_CREATED, sensor events, ...) carries no
    // pairing decision at all — it stays in `events` for pass 2 to
    // attribute, untouched here.
    events.push(event);
  }

  // Any terminal event still pending at the end never found a same-stage
  // start at or after it — a genuine orphan, not a reversed pair. Same
  // warning text each direct (non-recoverable) path above uses, so every
  // route to "this terminal event never paired" reads identically.
  for (const pending of pendingTerminals.values()) {
    warnings.push(orphanTerminalWarning(pending));
  }

  return { events, boundaries, warnings };
}
