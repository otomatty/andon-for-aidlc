import type { AuditEvent } from "@andon/shared-types";
import { timeOf } from "../audit/events.ts";
import { stageJumpReaches } from "../audit/stage-jump.ts";

/**
 * The engine's attempt identity, re-derived at read time (issue #166). The
 * engine stamps Unit events with a `Run floor` naming the latest attempt
 * boundary for their stage — aidlc-workflows v2.11.0 aidlc-lib.ts
 * `latestMainWorkflowStageRunFloorFromRows`, through
 * `latestMainWorkflowStageRunFloorForProject` and, for Unit lifecycle
 * receipts, `unitLifecycleRunFloorForProject` — but never stamps one on
 * STAGE_STARTED, so a floor can only be judged against the floor the engine
 * would have stamped at that point in the stream, not against the run's own
 * start.
 *
 * Which boundaries count depends on Construction settings in force when the
 * event was written. Rather than trusting today's state file for every past
 * event, a floor is current when it matches any rule the engine applies. A
 * floor naming an attempt that a later boundary superseded matches none of
 * them, which is the case readers must keep out. Unit-major rules ignore the
 * stage's own start unless a CONSTRUCTION_POLICY_SET row shows it was recorded
 * under stage-major flooring, so once that stage has started again since the
 * floor's boundary without such a row, the floor no longer says which of those
 * runs it belongs to: a stage-major rerun could otherwise take an earlier
 * attempt's floor as its own.
 */

export const ATTEMPT_BOUNDARIES = new Set([
  "WORKFLOW_STARTED",
  "STAGE_JUMPED",
  "STAGE_STARTED",
  "GATE_REJECTED",
]);
// v2.11.0 UNIT_LIFECYCLE_EVENTS: the receipts `unitLifecycleRunFloorForProject` floors.
const UNIT_LIFECYCLE_EVENTS = new Set([
  "UNIT_STARTED",
  "UNIT_PAUSED",
  "UNIT_RESUMED",
  "UNIT_COMPLETED",
  "UNIT_SKIPPED",
]);
const POLICY_FIELDS = new Set([
  "Construction Iteration",
  "Construction Checkpoints",
  "Construction Execution",
]);

interface FloorRule {
  /** Unit-major iteration or checkpoints: a stage's own start is no boundary. */
  unitMajor: boolean;
  /** Checkpoints or team ownership: another Unit's rejection is no boundary. */
  unit: string | undefined;
  /** A Unit lifecycle receipt under stage-major flooring. */
  unitReceipts: boolean;
}

/** Stage starts the CONSTRUCTION_POLICY_SET rows place, for one stream prefix. */
interface PolicyFloors {
  /** v2.11.0 `stageStartsUnderStageFlooring`. */
  stageFloored: Set<AuditEvent>;
  /** v2.11.0 `stageStartsUnderUnitFlooring`. */
  unitFloored: Set<AuditEvent>;
  /** Starts a later recorded change dates, so no rule is guessed for them. */
  dated: Set<AuditEvent>;
}

/** `Gate Stages` when present, otherwise the event's own stage. */
function gateStages(event: AuditEvent): string[] {
  const explicit = (event.fields?.["Gate Stages"] ?? "")
    .split(",")
    .map((stage) => stage.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;
  return event.stage ? [event.stage] : [];
}

/** A main-workflow start of this stage; isolated single-stage runs never count. */
function startsStage(boundary: AuditEvent, stage: string): boolean {
  return (
    boundary.event === "STAGE_STARTED" &&
    boundary.stage === stage &&
    !boundary.workflow?.startsWith("single-stage:")
  );
}

/** v2.11.0 `attemptEventDefinitelyBefore`: append order in a shard, time across shards. */
function definitelyBefore(earlier: AuditEvent, later: AuditEvent): boolean {
  if (earlier.shard === later.shard) return (earlier.position ?? 0) < (later.position ?? 0);
  return timeOf(earlier) < timeOf(later);
}

/** v2.11.0 `constructionPolicyRowComplete`: a row the typed setters wrote in full. */
export function policyRowComplete(row: AuditEvent): boolean {
  const field = row.fields?.Field;
  return (
    row.event === "CONSTRUCTION_POLICY_SET" &&
    field !== undefined &&
    POLICY_FIELDS.has(field) &&
    !!row.fields?.Value &&
    !!row.fields?.["Previous Value"] &&
    !!row.fields?.["Construction Iteration"] &&
    !!row.fields?.["Construction Checkpoints"]
  );
}

/** v2.11.0 `constructionPolicyFoundUnitMajor`: the flooring in force before the change. */
function foundUnitMajor(row: AuditEvent): boolean {
  const before = (field: string): string | undefined =>
    row.fields?.Field === field ? row.fields?.["Previous Value"] : row.fields?.[field];
  return (
    before("Construction Iteration") === "unit-major" ||
    before("Construction Checkpoints") === "enabled"
  );
}

/**
 * The changes that may be the first one after `start`. The shared causal
 * order is not transitive, so when no change is plainly first, every change
 * that may follow the start counts.
 */
function changesAfter(start: AuditEvent, changes: readonly AuditEvent[]): AuditEvent[] {
  const after = changes.filter((change) => !definitelyBefore(change, start));
  const firstAfter = after.filter(
    (change) =>
      !after.some((other) => definitelyBefore(start, other) && definitelyBefore(other, change)),
  );
  return firstAfter.length > 0 ? firstAfter : after;
}

function policyFloors(rows: readonly AuditEvent[], order: readonly string[] | null): PolicyFloors {
  const stageFloored = new Set<AuditEvent>();
  const unitFloored = new Set<AuditEvent>();
  const dated = new Set<AuditEvent>();
  const changes = rows.filter(policyRowComplete);
  if (changes.length === 0) return { stageFloored, unitFloored, dated };
  const starts = rows.filter((row) => row.event === "STAGE_STARTED");
  for (const start of starts) {
    const candidates = changesAfter(start, changes);
    if (candidates.length === 0) continue;
    dated.add(start);
    // stageStartsUnderStageFlooring: counts unless every candidate found unit-major.
    if (candidates.some((change) => !foundUnitMajor(change))) stageFloored.add(start);
    // stageStartsUnderUnitFlooring: left out only when plainly before them all.
    if (candidates.every((change) => definitelyBefore(start, change) && foundUnitMajor(change)))
      unitFloored.add(start);
  }
  // A unit-major walk finishes a later stage's Units before that stage's first
  // STAGE_STARTED; that first start in its attempt, after a change that found
  // unit-major flooring and after Unit rows of the stage, is not a restart.
  const unitRows = rows.filter((row) => UNIT_LIFECYCLE_EVENTS.has(row.event));
  const boundaries = rows.filter(
    (row) => row.event === "WORKFLOW_STARTED" || row.event === "STAGE_JUMPED",
  );
  for (const start of starts) {
    if (unitFloored.has(start)) continue;
    const slug = start.stage;
    if (!slug || start.workflow?.startsWith("single-stage:")) continue;
    const opened = (row: AuditEvent): boolean =>
      definitelyBefore(row, start) &&
      !boundaries.some(
        (boundary) =>
          (boundary.event === "WORKFLOW_STARTED" ||
            stageJumpReaches(boundary.fields?.Target, slug, order)) &&
          definitelyBefore(row, boundary) &&
          definitelyBefore(boundary, start),
      );
    const first = !starts.some(
      (other) => other !== start && startsStage(other, slug) && opened(other),
    );
    if (
      first &&
      changes.some((change) => definitelyBefore(change, start) && foundUnitMajor(change)) &&
      unitRows.some((row) => row.stage === slug && opened(row))
    )
      unitFloored.add(start);
  }
  return { stageFloored, unitFloored, dated };
}

/**
 * Where the CONSTRUCTION_POLICY_SET rows place each stage start: v2.11.0
 * `stageStartsUnderStageFlooring` (`stageFloored`) and
 * `stageStartsUnderUnitFlooring` (`unitFloored`, which includes a stage's
 * first start after its Units finished under unit-major: its late gate).
 * `events` is the sorted stream; `stageOrder` as for {@link runFloorCheck}.
 */
export function stageStartFloors(
  events: readonly AuditEvent[],
  stageOrder: readonly string[] | null = null,
): { stageFloored: ReadonlySet<AuditEvent>; unitFloored: ReadonlySet<AuditEvent> } {
  const rows = events.filter(
    (event) =>
      ATTEMPT_BOUNDARIES.has(event.event) ||
      UNIT_LIFECYCLE_EVENTS.has(event.event) ||
      event.event === "CONSTRUCTION_POLICY_SET",
  );
  const { stageFloored, unitFloored } = policyFloors(rows, stageOrder);
  return { stageFloored, unitFloored };
}

/**
 * v2.11.0 `latestMainWorkflowStageRunFloorFromRows`. A STAGE_STARTED keeps its
 * place among all of this stage's main-workflow starts and a STAGE_JUMPED its
 * place among all jumps, so neither token changes with the rule that counts it.
 * `null` when the stage started more than once since the floor's boundary
 * without a policy row dating those starts, which only a rule that ignores
 * them can produce. `AMBIGUOUS:<timestamp>`, without the engine's digest, when
 * the latest counted boundaries share one second across shards.
 */
function floorOf(
  rows: readonly AuditEvent[],
  stage: string,
  rule: FloorRule,
  policy: PolicyFloors,
  order: readonly string[] | null,
): string | null {
  const startOrdinals = new Map<AuditEvent, number>();
  const jumpOrdinals = new Map<AuditEvent, number>();
  for (const row of rows) {
    if (startsStage(row, stage)) startOrdinals.set(row, startOrdinals.size + 1);
    if (row.event === "STAGE_JUMPED") jumpOrdinals.set(row, jumpOrdinals.size + 1);
  }
  const ordinals = new Map<string, number>();
  let floor = "unstarted#0";
  let starts = 0;
  /** The counted boundaries sharing the latest timestamp. */
  let tied: AuditEvent[] = [];
  for (const row of rows) {
    if (!ATTEMPT_BOUNDARIES.has(row.event)) continue;
    let counts: boolean;
    if (row.event === "WORKFLOW_STARTED") counts = true;
    else if (row.event === "STAGE_JUMPED")
      counts = stageJumpReaches(row.fields?.Target, stage, order);
    else if (row.event === "GATE_REJECTED") {
      const unit = row.fields?.Unit;
      counts = gateStages(row).includes(stage) && (unit === undefined || unit === rule.unit);
    } else {
      if (!startsStage(row, stage)) continue;
      counts = rule.unitMajor
        ? policy.stageFloored.has(row)
        : !(rule.unitReceipts && policy.unitFloored.has(row));
      if (!counts) {
        // A start only a unit-major rule leaves out, with no recorded change
        // dating it, is the one this reader cannot place.
        if (rule.unitMajor && !policy.dated.has(row)) starts++;
        continue;
      }
    }
    if (!counts) continue;
    const ordinal =
      row.event === "STAGE_STARTED"
        ? (startOrdinals.get(row) ?? 0)
        : row.event === "STAGE_JUMPED"
          ? (jumpOrdinals.get(row) ?? 0)
          : (ordinals.get(row.event) ?? 0) + 1;
    ordinals.set(row.event, ordinal);
    floor = `${row.event}:${row.timestamp}#${ordinal}`;
    starts = 0;
    tied = tied[0]?.timestamp === row.timestamp ? [...tied, row] : [row];
  }
  if (starts > 1) return null;
  // Tied across clones, the engine names the second and a digest of the tied
  // rows' shard positions; the second is what this reader matches on.
  if (new Set(tied.map((row) => row.shard)).size > 1) return `AMBIGUOUS:${tied[0]?.timestamp}`;
  return floor;
}

/** A receipt's Run floor against the floor computed for it. */
function sameFloor(computed: string | null, floor: string): boolean {
  if (computed === null) return false;
  return computed.startsWith("AMBIGUOUS:") ? floor.startsWith(`${computed}#`) : computed === floor;
}

/**
 * `events` is the sorted stream pairing produced; the returned check asks
 * whether the event at `index` belongs to the current attempt of `stage`. An
 * event with no floor makes no attempt claim and is accepted. The event's own
 * stage is checked too: a checkpoint gate carries its final stage's floor.
 * `stageOrder` is the stage-graph order a jump's reach is judged against
 * (`stageOrderOf`); without it every jump reaches every stage. With
 * `wholeSecond`, an event is checked against every row up to the end of its
 * own second, in any shard: clones' rows in one second are unordered, and the
 * engine resolves a floor against the whole ledger. With `unitMajor` (the
 * state file's current mode), a Unit lifecycle receipt is checked under that
 * mode only and any other row under the stage-scoped one it is stamped with;
 * without it, either mode may have written the floor.
 */
export function runFloorCheck(
  events: readonly AuditEvent[],
  stageOrder: readonly string[] | null = null,
  { wholeSecond = false, unitMajor: mode }: { wholeSecond?: boolean; unitMajor?: boolean } = {},
): (event: AuditEvent, index: number, stage: string) => boolean {
  const relevant = events.flatMap((event, index) =>
    ATTEMPT_BOUNDARIES.has(event.event) ||
    UNIT_LIFECYCLE_EVENTS.has(event.event) ||
    event.event === "CONSTRUCTION_POLICY_SET"
      ? [index]
      : [],
  );
  // Floors depend on the boundaries and policy rows before an event, and on a
  // lifecycle row only when it is plainly before a stage start: never one
  // sorted after the last such anchor. So every event after the same anchor
  // shares one prefix, and its floors are worked out once.
  const anchors = relevant.filter(
    (at) => !UNIT_LIFECYCLE_EVENTS.has((events[at] as AuditEvent).event),
  );
  const policyAt = relevant.filter(
    (at) => (events[at] as AuditEvent).event === "CONSTRUCTION_POLICY_SET",
  );
  /** How many of the ascending `indices` are below `bound`. */
  const below = (indices: readonly number[], bound: number): number => {
    let lo = 0;
    let hi = indices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((indices[mid] as number) < bound) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  interface Prefix {
    rows: AuditEvent[];
    policy: PolicyFloors;
    floors: Map<string, string | null>;
    reopens: Map<string, boolean>;
  }
  const cache = new Map<number, Prefix>();
  const endOf = (index: number): number => {
    if (!wholeSecond) return index;
    const time = timeOf(events[index] as AuditEvent);
    let end = index + 1;
    while (end < events.length && timeOf(events[end] as AuditEvent) === time) end++;
    return end;
  };
  const prefix = (index: number): Prefix => {
    const anchored = below(anchors, endOf(index));
    let entry = cache.get(anchored);
    if (entry === undefined) {
      const last = anchored === 0 ? 0 : (anchors[anchored - 1] as number) + 1;
      const rows = relevant.slice(0, below(relevant, last)).map((at) => events[at] as AuditEvent);
      // The engine places each start against the whole ledger: a policy row
      // written after the event can still date a start before it.
      const later = policyAt.slice(below(policyAt, last)).map((at) => events[at] as AuditEvent);
      entry = {
        rows,
        policy: policyFloors([...rows, ...later], stageOrder),
        floors: new Map(),
        reopens: new Map(),
      };
      cache.set(anchored, entry);
    }
    return entry;
  };
  return (event, index, stage) => {
    const floor = event.fields?.["Run floor"];
    if (floor === undefined) return true;
    const { rows, policy, floors, reopens } = prefix(index);
    const unit = event.fields?.Unit;
    // Unit lifecycle receipts carry `unitLifecycleRunFloorForProject`; every
    // other floor is `latestMainWorkflowStageRunFloorForProject`.
    const receipts = UNIT_LIFECYCLE_EVENTS.has(event.event);
    // A Unit with its own rejection of the stage is floored on that Unit only.
    const ownReopen = (name: string): boolean => {
      if (!receipts || unit === undefined) return false;
      const id = JSON.stringify([unit, name]);
      let found = reopens.get(id);
      if (found === undefined) {
        found = rows.some(
          (row) =>
            row.event === "GATE_REJECTED" &&
            row.fields?.Unit === unit &&
            gateStages(row).includes(name),
        );
        reopens.set(id, found);
      }
      return found;
    };
    const rulesFor = (name: string): FloorRule[] => {
      const units = unit === undefined ? [undefined] : ownReopen(name) ? [unit] : [undefined, unit];
      // With a mode, a lifecycle receipt follows it and any other row carries
      // the stage-scoped floor the engine stamps it with.
      const modes = mode === undefined ? [false, true] : [receipts ? mode : false];
      return modes.flatMap((unitMajor) =>
        units.map((u) => ({ unitMajor, unit: u, unitReceipts: receipts && !unitMajor })),
      );
    };
    const floorFor = (name: string, rule: FloorRule): string | null => {
      const id = JSON.stringify([name, rule.unitMajor, rule.unit ?? null, rule.unitReceipts]);
      if (!floors.has(id)) floors.set(id, floorOf(rows, name, rule, policy, stageOrder));
      return floors.get(id) ?? null;
    };
    const stages = new Set([stage, ...(event.stage ? [event.stage] : [])]);
    return [...stages].some((name) =>
      rulesFor(name).some((rule) => sameFloor(floorFor(name, rule), floor)),
    );
  };
}
