import path from "node:path";
import { readBounded } from "@andon/core-utils";
import type {
  AuditEvent,
  ReadResult,
  UnitStageProgress,
  UnitStepStatus,
  UnitWalk,
  UnitWalkUnit,
  WorkflowModel,
} from "@andon/shared-types";
import { compareByTime, timeOf } from "../audit/events.ts";
import { stageJumpReaches } from "../audit/stage-jump.ts";
import { PER_UNIT_STAGES, SKELETON_CHECKPOINT, UNIT_CHECKPOINT } from "../timing/next-gate.ts";
import { ATTEMPT_BOUNDARIES, runFloorCheck, stageStartFloors } from "../timing/run-floor.ts";

/**
 * Each Unit's progress through the per-Unit Construction stages.
 *
 * The state file's stage boxes tick only once every Unit has finished a stage,
 * so they cannot tell a part-done stage from an untouched one. The engine's
 * own answer lives in two places this module reads: the Unit DAG for which
 * Units exist and the order they are walked in, and the audit log's Unit
 * receipts for how far each one got. Read only — nothing here writes.
 */

const DAG_PATH = ["inception", "units-generation", "unit-of-work-dependency.md"] as const;

/** aidlc-workflows v2.11.0 `UNIT_NAME_REGEX`, with its 64-character cap. */
const UNIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const UNIT_CHECKPOINTS = new Set([UNIT_CHECKPOINT, SKELETON_CHECKPOINT]);

/**
 * Audit warnings that mean receipts were lost: a shard or the directory could
 * not be read, or the parser dropped a block (measurement-events.ts).
 */
const INCOMPLETE_AUDIT = [
  "audit shard skipped",
  "audit directory",
  "malformed audit blocks ignored",
  "conflicting audit field",
];

/** aidlc-lib.ts `UNIT_KINDS`: a DAG naming any other kind is refused. */
const UNIT_KINDS = new Set(["service", "spec", "ui", "packaging", "library"]);

function unquote(value: string): string {
  const t = value.trim();
  const quoted = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return quoted && t.length >= 2 ? t.slice(1, -1) : t;
}

/** The first fenced yaml block declaring `units:` (aidlc-lib.ts `extractYamlUnitsBlock`). */
function unitsBlock(body: string): string[] | null {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^```ya?ml\s*$/.test((lines[i] ?? "").trim())) continue;
    let end = i + 1;
    while (end < lines.length && !/^```\s*$/.test((lines[end] ?? "").trim())) end++;
    const inner = lines.slice(i + 1, end);
    if (inner.some((line) => /^\s*units\s*:/.test(line))) return inner;
    i = end;
  }
  return null;
}

/**
 * Positions of unquoted `target` characters in `text` from `from`, scanned as
 * aidlc-lib.ts `parseInlineDepsList` scans: characters inside `"…"` or `'…'`
 * never match, and `\` escapes inside double quotes. With `first`, the scan
 * stops at the first match. `null` when a quote is still open where it stops.
 */
function unquotedAt(text: string, from: number, target: string, first: boolean): number[] | null {
  const hits: number[] = [];
  let quote: '"' | "'" | null = null;
  for (let i = from; i < text.length; i++) {
    const char = text[i] as string;
    if (quote !== null) {
      if (quote === '"' && char === "\\") i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === target) {
      hits.push(i);
      if (first) break;
    }
  }
  return quote === null ? hits : null;
}

/** A `depends_on` value read as aidlc-lib.ts `parseInlineDepsList` reads it. */
function inlineList(raw: string): string[] {
  const t = raw.trim();
  if (t === "" || t === "[]") return [];
  // A bare scalar is kept whole: `auth # note` then names no Unit.
  if (!t.startsWith("[")) return [unquote(t)];
  // An unclosed list, or anything but a comment after it, reads as no
  // dependencies, as it does for the engine.
  const close = unquotedAt(t, 1, "]", true)?.[0] ?? -1;
  if (close === -1 || !/^[ \t]*(?:#[^\r\n]*)?$/.test(t.slice(close + 1))) return [];
  const body = t.slice(1, close);
  const commas = unquotedAt(body, 0, ",", false);
  if (commas === null) return [];
  const items: string[] = [];
  let begin = 0;
  for (const at of commas) {
    items.push(body.slice(begin, at));
    begin = at + 1;
  }
  items.push(body.slice(begin));
  return items.map(unquote).filter((item) => item !== "");
}

/**
 * The engine's Unit walk order from a `unit-of-work-dependency.md` body
 * (aidlc-lib.ts `parseBoltDag`): dependency levels by Kahn's algorithm, each
 * level sorted. `null` wherever the engine refuses the block — absent,
 * malformed (names equal but for case, an unknown kind among them) or cyclic —
 * since the Units are then unknowable.
 */
export function parseUnitWalkOrder(body: string): string[] | null {
  const lines = unitsBlock(body);
  if (lines === null) return null;
  const head = lines.findIndex((line) => /^\s*units\s*:/.test(line));
  if ((lines[head] ?? "").replace(/^\s*units\s*:/, "").trim() !== "") return null;

  const units: { name: string; deps: string[] }[] = [];
  for (const line of lines.slice(head + 1)) {
    if (line.trim() === "") continue;
    const current = units.at(-1);
    const name = /^\s*-\s+name\s*:\s*(.+?)\s*$/.exec(line);
    if (name) {
      units.push({ name: unquote(name[1] as string), deps: [] });
      continue;
    }
    const deps = /^\s*depends_on\s*:\s*(.*)$/.exec(line);
    if (deps) {
      if (current === undefined) return null;
      current.deps = inlineList(deps[1] as string);
      continue;
    }
    const kind = /^\s*kind\s*:\s*(.+?)\s*$/.exec(line);
    if (kind) {
      if (current === undefined || !UNIT_KINDS.has(unquote(kind[1] as string))) return null;
      continue;
    }
    const item = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (item && current !== undefined) {
      current.deps.push(unquote(item[1] as string));
      continue;
    }
    return null;
  }

  const names = new Set(units.map((u) => u.name));
  const folded = new Set(units.map((u) => u.name.toLowerCase()));
  if (units.length === 0 || folded.size !== units.length) return null;
  for (const u of units) {
    if (!UNIT_NAME.test(u.name)) return null;
    if (u.deps.some((dep) => dep === u.name || !names.has(dep))) return null;
  }

  const order: string[] = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    const level = units
      .filter((u) => remaining.has(u.name) && u.deps.every((dep) => !remaining.has(dep)))
      .map((u) => u.name)
      .sort();
    if (level.length === 0) return null; // cycle
    for (const name of level) remaining.delete(name);
    order.push(...level);
  }
  return order;
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A rejection's `Gate Stages`, else its own stage. */
function rejectedStages(event: AuditEvent): string[] {
  const named = csv(event.fields?.["Gate Stages"]);
  return named.length > 0 ? named : [event.stage ?? ""];
}

const key = (unit: string, stage: string): string => `${unit}\0${stage}`;

const LIFECYCLE = new Set([
  "UNIT_STARTED",
  "UNIT_RESUMED",
  "UNIT_PAUSED",
  "UNIT_COMPLETED",
  "UNIT_SKIPPED",
]);
const TERMINAL = new Set(["UNIT_COMPLETED", "UNIT_SKIPPED"]);

/**
 * The lifecycle receipts to drop because another receipt for the same Unit
 * and stage, in the same second but another clone's shard, outranks them.
 * Such rows are causally unordered (aidlc-lib.ts `currentUnitLifecycleRows`):
 * the latest row per shard is a candidate, a possible pause or start keeps the
 * step open over a finish, and only unanimous finishes settle it.
 */
function unorderedLosers(events: readonly AuditEvent[]): Set<AuditEvent> {
  const groups = new Map<string, AuditEvent[]>();
  for (const event of events) {
    if (!LIFECYCLE.has(event.event)) continue;
    const id = JSON.stringify([event.fields?.Unit?.trim(), event.stage, timeOf(event)]);
    groups.set(id, [...(groups.get(id) ?? []), event]);
  }
  const rank = (event: AuditEvent): number =>
    event.event === "UNIT_PAUSED" ? 2 : TERMINAL.has(event.event) ? 0 : 1;
  const losers = new Set<AuditEvent>();
  for (const rows of groups.values()) {
    const latest = new Map<string, AuditEvent>();
    for (const row of rows) latest.set(row.shard, row);
    if (latest.size < 2) continue;
    const winner = [...latest.values()].reduce((best, row) =>
      rank(row) >= rank(best) ? row : best,
    );
    for (const row of rows) if (row !== winner) losers.add(row);
  }
  return losers;
}

/**
 * Within one second, clones' shards are unordered. Every receipt naming a Run
 * floor that is left after the floor check belongs to the attempt after all
 * of its second's boundaries (`runFloorCheck` with `wholeSecond`), so those
 * are folded last in their second; every other row keeps {@link compareByTime}
 * order.
 */
function boundariesFirst(sorted: readonly AuditEvent[]): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (let start = 0; start < sorted.length;) {
    const time = timeOf(sorted[start] as AuditEvent);
    let end = start + 1;
    while (end < sorted.length && timeOf(sorted[end] as AuditEvent) === time) end++;
    const second = sorted.slice(start, end);
    // Only a row the floor check placed (one naming a Run floor) is known to
    // follow every boundary of its second; every other row keeps its order.
    const floored = (event: AuditEvent): boolean =>
      !ATTEMPT_BOUNDARIES.has(event.event) && event.fields?.["Run floor"] !== undefined;
    out.push(...second.filter((event) => !floored(event)), ...second.filter(floored));
    start = end;
  }
  return out;
}

/**
 * Fold the Unit receipts into one status per (Unit, per-Unit stage).
 *
 * - `UNIT_STARTED` / `UNIT_RESUMED` / `UNIT_PAUSED` open the step,
 *   `UNIT_COMPLETED` (or a swarm's `SWARM_UNIT_CONVERGED`) finishes it and
 *   `UNIT_SKIPPED` skips it — each only while its Run floor is still the
 *   current attempt, and two clones' receipts in one second resolved the way
 *   the engine resolves them.
 * - A `GATE_REJECTED` starts its Gate Stages (else its Stage) over: for the
 *   Unit it names — a reopen (aidlc-jump.ts) or a Unit checkpoint — or, with
 *   none named, a stage gate's Request Changes, for every Unit.
 * - `STAGE_JUMPED` resets every Unit from its Target on (`stageJumpReaches`);
 *   `WORKFLOW_STARTED` resets everything; a `STAGE_STARTED` starts its stage
 *   over when the engine's policy flooring counts it as a new attempt.
 * - The state file's open Unit (`Active Unit` / `Unit Stage`) is on its step,
 *   unless a receipt already finished that step: then no Unit is open.
 *
 * Then the gaps the receipts leave: a stage the workflow skips is skipped for
 * every Unit; a stage a Unit walked past (it has later progress, or its Unit
 * checkpoint was approved) was not owed; a stage whose box is ticked without
 * a receipt — records from before Unit receipts — is done, unless a jump
 * started it over since. A reopened step is
 * owed again and stays open until its own next receipt.
 */
export function deriveUnitWalk(
  workflow: WorkflowModel,
  units: readonly string[],
  events: readonly AuditEvent[],
): UnitWalk {
  const stages = workflow.stages.filter((s) => PER_UNIT_STAGES.has(s.slug)).map((s) => s.slug);
  const order = workflow.stages.map((s) => s.slug);
  const unitSet = new Set(units);
  const stageSet = new Set(stages);
  const cells = new Map<string, UnitStepStatus>();
  const checkpoint = new Map<string, "approved" | "rejected">();
  /** Steps reopened for their Unit alone: owed again, whatever came after them. */
  const reopened = new Set<string>();
  /**
   * Steps a jump started over: the engine appends STAGE_JUMPED before it
   * rewrites the state file, so a ticked box there no longer vouches for them
   * until a receipt or the stage's own approval does.
   */
  const jumped = new Set<string>();
  const byTime = events
    .filter((event) => !event.workflow?.startsWith("single-stage:"))
    .sort(compareByTime);
  // The current mode is the state file's, as the engine reads it; the policy
  // rows only place the starts before them.
  const perUnit =
    workflow.constructionPolicy?.unitMajor === true ||
    workflow.constructionPolicy?.checkpoints === true;
  // A receipt whose Run floor a boundary superseded belongs to an old attempt
  // (a stale worker finishing late): the engine, reading the whole ledger,
  // never counts it. Each receipt is checked, under the current mode only,
  // against every boundary up to the end of its own second, since clones' rows
  // in one second are unordered. Those go first; one second's receipts across
  // clones are then settled among what is left, so a stale receipt can never
  // outrank a current one.
  const isCurrentFloor = runFloorCheck(byTime, order, { wholeSecond: true, unitMajor: perUnit });
  const isReceipt = (event: AuditEvent): boolean =>
    LIFECYCLE.has(event.event) || event.event === "SWARM_UNIT_CONVERGED";
  const stale = new Set(
    byTime.filter(
      (event, index) => isReceipt(event) && !isCurrentFloor(event, index, event.stage ?? ""),
    ),
  );
  const sorted = boundariesFirst(byTime.filter((event) => !stale.has(event)));
  const losers = unorderedLosers(sorted);
  // aidlc-lib.ts `unitLifecycleSnapshot`: under unit-major iteration or
  // enabled checkpoints Unit receipts are floored per Unit, and only a stage
  // start stage-major flooring wrote begins a new attempt
  // (`stageStartsUnderStageFlooring`); otherwise every start does but those
  // unit-major flooring wrote or that open a late gate
  // (`stageStartsUnderUnitFlooring`). Both judge a start by the policy rows
  // that may precede it, so a tie across clones is not settled by row order.
  const floors = stageStartFloors(byTime, order);
  const restarts = (event: AuditEvent): boolean =>
    perUnit ? floors.stageFloored.has(event) : !floors.unitFloored.has(event);

  const set = (unit: string, stage: string, status: UnitStepStatus): void => {
    if (!unitSet.has(unit) || !stageSet.has(stage)) return;
    cells.set(key(unit, stage), status);
    reopened.delete(key(unit, stage));
    jumped.delete(key(unit, stage));
  };

  for (const event of sorted) {
    const unit = event.fields?.Unit?.trim() ?? "";
    const stage = event.stage ?? "";
    if (stale.has(event) || losers.has(event)) continue;
    switch (event.event) {
      case "WORKFLOW_STARTED":
        cells.clear();
        checkpoint.clear();
        reopened.clear();
        jumped.clear();
        break;
      case "STAGE_STARTED":
        // A new attempt of the stage (aidlc-lib.ts `currentUnitLifecycleRows`
        // cuts its rows there).
        if (stageSet.has(stage) && restarts(event)) {
          for (const name of units) {
            cells.delete(key(name, stage));
            reopened.delete(key(name, stage));
          }
          // An approval from before the new attempt no longer vouches for it.
          checkpoint.clear();
        }
        break;
      case "STAGE_JUMPED": {
        const reached = stages.filter((s) => stageJumpReaches(event.fields?.Target, s, order));
        for (const name of units)
          for (const s of reached) {
            cells.delete(key(name, s));
            jumped.add(key(name, s));
          }
        if (reached.length > 0) checkpoint.clear();
        break;
      }
      case "UNIT_STARTED":
      case "UNIT_RESUMED":
      case "UNIT_PAUSED":
        set(unit, stage, "in-progress");
        break;
      case "UNIT_COMPLETED":
        set(unit, stage, "completed");
        break;
      case "UNIT_SKIPPED":
        set(unit, stage, "skipped");
        break;
      case "SWARM_UNIT_CONVERGED": {
        // The swarm's per-Unit completion (aidlc-lib.ts `swarmConvergedUnits`),
        // which fails closed without a Run floor and counts only after a
        // rejection plainly before it: another clone's rejection in the same
        // second keeps the Unit reopened.
        if (event.fields?.["Run floor"] === undefined) break;
        const name = event.fields?.["Unit name"]?.trim() ?? "";
        const tied = sorted.some(
          (row) =>
            row.event === "GATE_REJECTED" &&
            row.shard !== event.shard &&
            timeOf(row) === timeOf(event) &&
            [name, ""].includes(row.fields?.Unit?.trim() ?? "") &&
            rejectedStages(row).includes(stage),
        );
        if (!tied) set(name, stage, "completed");
        break;
      }
      case "GATE_APPROVED": {
        const point = event.fields?.Checkpoint;
        if (unitSet.has(unit) && point !== undefined && UNIT_CHECKPOINTS.has(point))
          checkpoint.set(unit, "approved");
        // A stage gate's approval: the stage was finished after any jump.
        if (unit === "") {
          const named = csv(event.fields?.["Gate Stages"]);
          for (const s of named.length > 0 ? named : [stage])
            for (const name of units) jumped.delete(key(name, s));
        }
        break;
      }
      case "GATE_REJECTED": {
        // An attempt boundary for its Gate Stages (else its Stage), for the
        // named Unit or, without one, every Unit (run-floor.ts `floorOf`):
        // those steps are owed again, whatever came after them.
        const hit = unit === "" ? units : unitSet.has(unit) ? [unit] : [];
        const point = event.fields?.Checkpoint;
        for (const name of hit) {
          for (const s of rejectedStages(event)) {
            if (!stageSet.has(s)) continue;
            cells.delete(key(name, s));
            reopened.add(key(name, s));
          }
          if (point !== undefined && UNIT_CHECKPOINTS.has(point)) checkpoint.set(name, "rejected");
          else checkpoint.delete(name);
        }
        break;
      }
      default:
        break;
    }
  }

  // The state file's open Unit is a cache of the receipts: it puts the Unit on
  // its step, but never reopens a step whose receipt already finished it.
  // A finishing receipt whose cache cleanup never landed leaves no open Unit.
  let open = workflow.activeUnit;
  // A cached Unit outside this walk, or on a step it does not have, is no
  // Unit of it.
  if (
    open !== undefined &&
    (!unitSet.has(open.unit) || (open.stage !== null && !stageSet.has(open.stage)))
  )
    open = undefined;
  if (open?.stage) {
    const at = key(open.unit, open.stage);
    const current = cells.get(at);
    // A reopen or jump clears the cache in the state write after its audit
    // row; a cache naming a step it started over outlived a failed write.
    if (current === "completed" || current === "skipped" || reopened.has(at) || jumped.has(at))
      open = undefined;
    else set(open.unit, open.stage, "in-progress");
  }

  const stageStatus = new Map(workflow.stages.map((s) => [s.slug, s]));
  // A `[S]` box a jump or reopen would have reset (both write the state file
  // after their audit row) no longer takes a Unit's step out of scope; a stage
  // not executed does.
  const outOfScope = (name: string, stage: string): boolean => {
    const row = stageStatus.get(stage);
    const restarted = jumped.has(key(name, stage)) || reopened.has(key(name, stage));
    return row?.execution === "SKIP" || (row?.status === "skipped" && !restarted);
  };
  const walked: UnitWalkUnit[] = units.map((name) => {
    const raw = stages.map((s) => cells.get(key(name, s)) ?? "not-started");
    // The lib target predates `findLastIndex`.
    const lastTouched = raw.reduce((last, status, i) => (status === "not-started" ? last : i), -1);
    const approved = checkpoint.get(name) === "approved";
    const steps = stages.map((s, i) => {
      let status = raw[i] as UnitStepStatus;
      if (outOfScope(name, s)) status = "skipped";
      else if (status !== "not-started" || reopened.has(key(name, s))) return { stage: s, status };
      else if (i < lastTouched || approved) status = "skipped";
      else if (stageStatus.get(s)?.status === "completed" && !jumped.has(key(name, s)))
        status = "completed";
      return { stage: s, status };
    });
    // A stage the whole workflow skips says nothing about this Unit's progress.
    const owed = steps.filter((step) => !outOfScope(name, step.stage));
    const finished = owed.every((s) => s.status === "completed" || s.status === "skipped");
    const started =
      checkpoint.has(name) ||
      owed.some((s) => s.status !== "not-started") ||
      raw.some((r) => r !== "not-started");
    const status: UnitStepStatus =
      owed.length === 0
        ? "skipped"
        : finished && checkpoint.get(name) !== "rejected"
          ? "completed"
          : started
            ? "in-progress"
            : "not-started";
    return { unit: name, status, steps };
  });

  const byStage: UnitStageProgress[] = stages.map((s, i) => ({
    stage: s,
    completed: walked.filter((u) => u.steps[i]?.status === "completed").length,
    skipped: walked.filter((u) => u.steps[i]?.status === "skipped").length,
    total: walked.length,
  }));

  return { stages, units: walked, byStage, activeUnit: open ?? null };
}

/**
 * The record's Unit walk, or `null` when it has none to show: no Unit DAG,
 * one the engine would refuse, no per-Unit stage in this workflow, Units
 * Generation skipped without having run, or an audit log that cannot be read
 * in full.
 */
export async function readUnitWalk(
  recordDir: string,
  workflow: WorkflowModel,
  loadEvents: () => Promise<ReadResult<AuditEvent[]>>,
): Promise<UnitWalk | null> {
  if (!workflow.stages.some((s) => PER_UNIT_STAGES.has(s.slug))) return null;
  // aidlc-lib.ts `usesStageLevelPerUnitArtifacts`: with Units Generation
  // neither planned nor already run, Construction runs once at stage level,
  // whatever DAG file is left over.
  const unitsGeneration = workflow.stages.find((s) => s.slug === "units-generation");
  if (unitsGeneration?.execution === "SKIP" && unitsGeneration.status !== "completed") return null;
  const read = await readBounded(path.join(recordDir, ...DAG_PATH));
  if (!read.ok) return null;
  const units = parseUnitWalkOrder(read.value);
  if (units === null) return null;
  // Only a record with a DAG pays for the audit read. Without its receipts
  // every Unit would read as untouched, so an unreadable log shows nothing.
  const events = await loadEvents();
  if (!("ok" in events)) return null;
  // Receipts lost with a skipped shard or a dropped block: the rest would
  // misstate the progress, so show nothing rather than a confident guess.
  const incomplete = (events.warnings ?? []).some((warning) =>
    INCOMPLETE_AUDIT.some((prefix) => warning.startsWith(prefix)),
  );
  return incomplete ? null : deriveUnitWalk(workflow, units, events.value);
}
