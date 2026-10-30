/**
 * Shared wire contract — reader-core produces these, all three surfaces
 * (mcp-server / dashboard-server / dashboard-ui) consume them.
 *
 * Source: construction/reader-core/functional-design/domain-entities.md.
 * This file carries the types **plus the dependency-free constants and pure
 * presenters that belong to the wire contract** (the supported State Version,
 * the artifact path formula, `formatDuration`, …). Anything with a dependency
 * — filesystem, React, a parser — still lives in its owning package; only
 * values that every surface must agree on byte-for-byte are allowed here, so
 * no surface keeps a hand-synced copy. (Charter revised from "zero runtime
 * code": `isLowConfidenceEstimate` had already established the precedent.)
 */

/**
 * The native State Version this tool is built against (the current stage
 * graph). Version knowledge lives in reader-core's `parse/` module (BR-RC-4);
 * these constants exist so surfaces can name the current and readable
 * versions without hardcoding the numbers.
 */
export type {
  EffectivenessApprovalWait,
  EffectivenessPayload,
  EffectivenessReviews,
  EffectivenessSensors,
  EffectivenessUsage,
  IntentEffectiveness,
} from "./effectiveness.ts";

export {
  VERSION_GATE_ACTIONS,
  type VersionGate,
  type VersionGateAction,
  type VersionGateRollback,
  type VersionGateRollbackGuide,
  type VersionGateStatus,
  versionGateActionLabel,
  versionGateRollbackCommands,
  versionGateRollbackGuide,
  WORKFLOWS_TARGET_VERSION,
  type WorkflowsManagementState,
} from "./workflows-management.ts";

export {
  activeSpotlight,
  advanceOnboardingVersion,
  applyOnboardingEvent,
  areaTipId,
  areaTipVisible,
  initialOnboardingRecord,
  knownTipIds,
  ONBOARDING_AREAS,
  ONBOARDING_TARGETS,
  type OnboardingArea,
  type OnboardingEvent,
  type OnboardingRecord,
  type OnboardingSnapshot,
  type OnboardingTarget,
  type OnboardingView,
  parseOnboardingEvent,
  parseOnboardingRecord,
  parseOnboardingSnapshot,
  spotlightTipId,
  unseenNews,
  type WelcomeStatus,
  type WhatsNewEntry,
} from "./onboarding.ts";
export { WHATS_NEW } from "./whats-new.ts";
export {
  BUNDLED_PLUGINS,
  type BundledPlugin,
  type BundledPluginCatalog,
  type BundledPluginRequirement,
  type BundledPluginStage,
  type BundledPluginStageOrigin,
} from "./bundled-plugins.ts";
export {
  CHANGED_FILES_SHOWN,
  parsePluginsPanelMessage,
  type PluginAction,
  type PluginInstallState,
  type PluginOperation,
  type PluginPrerequisite,
  type PluginPrerequisiteAction,
  type PluginProgress,
  type PluginResult,
  type PluginsHostMessage,
  type PluginsPanelMessage,
  type PluginsState,
  type PluginStatus,
} from "./plugins.ts";
export {
  ANSWER_PREFIX,
  type AnswerLine,
  type ChatAnswered,
  chatAnsweredLine,
  scanAnswerLines,
} from "./answers.ts";

export const CURRENT_STATE_VERSION = 8;
export const SUPPORTED_STATE_VERSIONS = [8] as const;
export type SupportedStateVersion = (typeof SUPPORTED_STATE_VERSIONS)[number];

export function isSupportedStateVersion(n: number): n is SupportedStateVersion {
  return (SUPPORTED_STATE_VERSIONS as readonly number[]).includes(n);
}

export function supportedVersionsLabel(): string {
  return SUPPORTED_STATE_VERSIONS.join(" と ");
}

/**
 * Every public read boundary returns this — reader-core never throws
 * (BR-RC-2 / R-RC-1).
 *
 * - `ok`        — usable value. `warnings` carries element-level degradation
 *                 that did not invalidate the snapshot (BR-RC-5).
 * - `unsupported` — State Version is not in {@link SUPPORTED_STATE_VERSIONS};
 *                 refusing to guess is safer than mis-reading (G-2).
 * - `error`     — entry-level failure. `reason` is normally a
 *                 {@link StandardReason}; unexpected internal faults are
 *                 normalised to `"internal: <message>"`.
 */
export type ReadResult<T> =
  | { ok: true; value: T; warnings?: string[] }
  | { unsupported: true; version: string }
  | { error: true; reason: string };

/**
 * Error reasons consumers are allowed to branch UI on. Changing one of these
 * strings is a breaking change (domain-entities.md "標準エラー reason 値").
 *
 * The full server-side vocabulary: reader-core (first six), docs-bridge
 * (`not-found` / `undefined-term` / `config-invalid`) and api-core routing
 * (`unknown-route` / `missing-path`). Surface-side reason→wording maps are
 * typed `Record<StandardReason, string>`, so adding a reason here fails every
 * surface's compile until it has a wording — coverage is compiler-checked,
 * not reviewed.
 */
export type StandardReason =
  | "state-missing"
  | "state-unreadable"
  | "no-active-intent"
  | "no-selected-intent"
  | "outside-record"
  | "artifact-not-found"
  | "file-too-large"
  | "not-found"
  | "undefined-term"
  | "config-invalid"
  | "unknown-route"
  | "missing-path";

/** Checkbox marks of the Stage Progress section, 1:1 with G-3's six marks. */
export type StageStatus =
  | "not-started"
  | "in-progress"
  | "awaiting-approval"
  | "revising"
  | "completed"
  | "skipped";

/**
 * The statuses under which a closed timing run belongs to the *current*
 * attempt rather than to history. A closed run with any other status
 * (`not-started`, `in-progress`, `revising`, `skipped`) predates a reset the
 * current attempt hasn't repeated yet. One definition, shared by
 * reader-core's estimator and the dashboard's stage rail — the reasoning
 * (STAGE_COMPLETED fires after GATE_APPROVED) must not be maintained twice.
 */
export const CURRENT_ATTEMPT_STATUSES: ReadonlySet<StageStatus> = new Set([
  "completed",
  "awaiting-approval",
]);

export type Phase = "INITIALIZATION" | "IDEATION" | "INCEPTION" | "CONSTRUCTION" | "OPERATION";

export type Verdict = "READY" | "NOT-READY";

/** v2.11.0 aidlc-lib.ts CEREMONY_KEYS, camel-cased. */
export const CEREMONY_KEYS = [
  "sensors",
  "learnings",
  "summaryConfirmation",
  "planApproval",
  "collaborators",
] as const;
export type CeremonyKey = (typeof CEREMONY_KEYS)[number];
/** v2.11.0 aidlc-lib.ts CEREMONY_FIELDS: the state-file field of each ceremony. */
export const CEREMONY_FIELDS: Readonly<Record<CeremonyKey, string>> = {
  sensors: "Sensors",
  learnings: "Learnings",
  summaryConfirmation: "Summary Confirmation",
  planApproval: "Plan Approval",
  collaborators: "Collaborators",
};
export interface CeremonySetting {
  value: "on" | "off";
  /** The label in parentheses, e.g. `from scope express`; `null` when none. */
  source: string | null;
}

export interface StageInfo {
  slug: string;
  phase: Phase;
  execution: "EXECUTE" | "SKIP";
  status: StageStatus;
  /** Line-level degradation, e.g. an unknown G-3 mark. */
  unparseable?: string;
}

export interface WorkflowModel {
  /** Reader-stamped record identity; absent on a standalone state-file parse. */
  record?: { space: string; intent: string };
  project: string;
  scope: string;
  depth: string;
  /** State-file record only; memory policy may make the effective setting stricter. */
  guardPolicy?: { value: "strict" | "relaxed" | "off"; source: string | null };
  /**
   * aidlc-workflows v2.11.0 scope-owned ceremonies as the state file records
   * them (`on (from scope classic)`); an unrecorded one is left out. A machine
   * switch can still turn one off at run time.
   */
  ceremonies?: Partial<Record<CeremonyKey, CeremonySetting>>;
  /** `Project Type` with `Project Type Source`; a `null` source means the workspace scan. */
  projectType?: { value: string; source: string | null };
  /** `Plan`: the name of a plan tailored to this piece of work (v2.11.0 composer). */
  plan?: string;
  stateVersion: SupportedStateVersion;
  /** Current Status → Lifecycle Phase. */
  phase: Phase;
  currentStage: string | null;
  /** Current Status → Next Stage (the state file's own claim). */
  nextStage: string | null;
  /** Status of {@link currentStage}; `awaiting-approval` means a gate is open. */
  gate: StageStatus | null;
  stages: StageInfo[];
  /** G-5: `Completed` field first, `[x]`+`[S]` tally as fallback. */
  done: number;
  /** G-6: `Total Stages` field first, EXECUTE-row count as fallback. */
  total: number;
  /**
   * The Construction settings that move or waive Construction approval gates.
   * reader-core's parser always sets it; a hand-built model may omit it, which
   * reads as every flag `false` — the plain one-gate-per-stage flow.
   */
  constructionPolicy?: ConstructionGatePolicy;
  /**
   * The Unit the engine is working on, from the state file's `Active Unit`
   * cache. Absent between Units and outside per-Unit Construction.
   */
  activeUnit?: ActiveUnit;
  /** Field-level degradation, keyed by {@link WorkflowModel} field name. */
  unparseable?: Record<string, string>;
}

/**
 * The state file's Unit checkpoint cache (`Active Unit`, `Unit Stage`,
 * `Unit State`). The engine writes it at `unit start` / `pause` / `resume` and
 * removes it at `unit complete`. Under unit-major, `stage` is where the work
 * actually is while `Current Stage` stays on the first per-Unit stage.
 */
export interface ActiveUnit {
  unit: string;
  /** `Unit Stage`; `null` when the field is absent or not a stage of this workflow. */
  stage: string | null;
  state: "in-progress" | "paused";
}

/**
 * State-file settings that decide where Construction approval gates fall.
 *
 * Each flag applies the engine's own exact-value test to the first matching
 * field line anywhere in the file (aidlc-lib.ts `getField`), so an absent,
 * blank or unrecognised value reads the way the engine reads it: as the
 * default. Nothing here is interpreted beyond that comparison.
 */
export interface ConstructionGatePolicy {
  /** `Construction Checkpoints` is exactly `enabled`: Unit checkpoint workflows. */
  checkpoints: boolean;
  /** `Construction Iteration` is exactly `unit-major`; anything else is stage-major. */
  unitMajor: boolean;
  /**
   * A `Construction Iteration` line exists. Tells a recorded stage-major apart
   * from a workflow that never chose one (no Units, or a pre-policy record).
   */
  iterationRecorded: boolean;
  /** `Construction Execution` is exactly `swarm`. */
  swarm: boolean;
  /** `Construction Autonomy Mode` is exactly `autonomous`. */
  autonomous: boolean;
  /** `Unit Ownership` is exactly `team`. */
  teamOwnership: boolean;
  /** `Unit Gate Rhythm` is exactly `unit-end`. Only meaningful under team ownership. */
  unitEndRhythm: boolean;
  /** A `Skeleton Stance` line exists, whatever its value. */
  skeletonStanceRecorded: boolean;
  /**
   * `Skeleton Stance` is exactly `on` or `scope-dependent`. The engine settles
   * `scope-dependent` from scope metadata this reader does not load, so it
   * counts as a walking skeleton that may run.
   */
  skeletonMayRun: boolean;
}

/** getNextStep() — data source of the NextStepCallout (FR-2.3 / US-02). */
export interface NextStep {
  /** `null` = no further in-scope stage (workflow complete). */
  nextStage: string | null;
  /** What the human is asked for at that stage. */
  requirement: string;
}

/** Where construction artifacts live under the record — the wire path's first segment. */
export const CONSTRUCTION_DIRNAME = "construction";

/**
 * The one artifact-address formula. Record-relative, POSIX-separated — the
 * wire format, not a filesystem path. Every surface that opens or prefetches
 * a cell artifact must build the path through this function so the prefetch
 * and the viewer cannot disagree (P-AV-2).
 */
export function artifactPath(unit: string, stage: string, file: string): string {
  return `${CONSTRUCTION_DIRNAME}/${unit}/${stage}/${file}`;
}

export interface MatrixCell {
  unit: string;
  stage: string;
  /**
   * The `*.md` artifacts in `<unit>/<stage>/`, filenames only, sorted
   * (R-RC-5). Carries the count *and* names the files: the matrix shows
   * `files.length`, the artifact viewer opens `construction/<unit>/<stage>/
   * <files[i]>` — no second endpoint to enumerate a cell.
   */
  files: string[];
  verdict: Verdict | null;
  /** Cell-level degradation (failure mode 4); other cells stay valid. */
  error?: string;
}

export interface Matrix {
  /** Directory actually scanned; absent for readers pinned outside the spaces tree. */
  record?: { space: string; intent: string };
  units: string[];
  stages: string[];
  cells: MatrixCell[];
}

export interface AuditEvent {
  /** Taxonomy name from the `**Event**` field. */
  event: string;
  stage: string | null;
  /** ISO 8601, verbatim from the `**Timestamp**` field. */
  timestamp: string;
  /** Originating shard filename — kept for provenance, not content. */
  shard: string;
  /**
   * Verbatim `**Workflow**` field, `null` when absent (most events carry no
   * such field — only the synthetic lifecycle pair the engine emits for an
   * isolated `--single` stage run does, as `single-stage:<slug>`). This
   * earns its place alongside the other three kept fields (BR-RC-6) because
   * `timing/derive.ts` needs it to recognise and exclude that synthetic pair
   * from the main workflow's timeline — without it, an isolated single-stage
   * run is indistinguishable from a real one.
   */
  workflow: string | null;
  /** Allowlisted measurement metadata only; never question or response bodies. */
  fields?: Record<string, string>;
  /** Position within the source shard, to order events sharing a timestamp. */
  position?: number;
}

/** The same policy is applied to the selected run and every historical sample. */
export interface TimingPolicy {
  algorithmVersion: "session-gap-v2";
  gapThresholdMs: number;
}

/** Exclusive categories whose sum equals the run's observed wall time. */
export interface TimingBreakdown {
  observedWallMs: number;
  workMs: number;
  approvalWaitMs: number;
  suspendedMs: number;
  excludedGapMs: number;
  pendingObservationMs: number;
  unattributedMs: number;
}

export interface TimingQuality {
  status: "usable" | "limited" | "incomplete";
  reasons: string[];
  sampleEligible: boolean;
}

/** Differences caused by the gap setting, not bounds on actual work time. */
export interface TimingSensitivity {
  thresholdMs: number;
  workMs: number | null;
}

/** Counts only unfinished, in-scope stages included in the remaining total. */
export interface EstimateCoverage {
  known: number;
  unknown: number;
}

/**
 * One `STAGE_STARTED` → `STAGE_COMPLETED` run, derived from the audit log.
 * Nothing new is recorded: the audit log is already the durable record.
 */
export interface StageTiming {
  stage: string;
  /** ISO 8601, verbatim from the `STAGE_STARTED` record. */
  startedAt: string;
  /** `null` while the run is still open. */
  endedAt: string | null;
  /** `(endedAt ?? now) - startedAt`, or null for an invalid clock boundary. */
  wallMs: number | null;
  /**
   * Compatibility name for inferred work time, equal to breakdown.workMs.
   * Excludes known waiting, suspension and long gaps. Null means unavailable.
   */
  activeMs: number | null;
  /** Audit events inside the run. Not a confidence signal — `estimate.ts` uses `sampleCount` (run count) for that; nothing reads this field today. */
  eventCount: number;
  /** Stable record/epoch/stage/attempt identity, independent of the read clock. */
  runId?: string;
  breakdown?: TimingBreakdown | null;
  quality?: TimingQuality;
  /** Last eligible observation belonging to this run. */
  lastObservationAt?: string | null;
  /** Wall time since that observation; not added to work time. */
  sinceLastObservationMs?: number | null;
  sensitivity?: TimingSensitivity[];
  /**
   * How the workflow that recorded this run walked its per-Unit Construction
   * stages, read from that intent's `aidlc-state.md` when the space-wide
   * sample pool is collected. `unknown` when that state file could not be
   * read. Absent on a run nobody stamped: it is taken as recorded by the
   * workflow being estimated.
   */
  constructionWalk?: ConstructionWalk | "unknown";
}

/**
 * How a workflow actually walks its per-Unit Construction stages.
 *
 * - `unit-major`: `Construction Iteration` is exactly `unit-major` and the
 *   plan runs `units-generation`. The engine keeps the block's first stage
 *   current while every Unit goes through every per-Unit stage, so that
 *   stage's run carries the whole block and the later stages' runs carry
 *   little more than their late gates.
 * - `stage-major`: anything else. Each per-Unit stage's run carries its own
 *   work.
 *
 * Runs of the two walks measure different things for the same slug, so the
 * estimator never pools them (issue #167).
 */
export type ConstructionWalk = "unit-major" | "stage-major";

/**
 * How long a stage is expected to take, and on what evidence.
 *
 * `basis` is the fallback rung that produced it: this stage's own history,
 * its phase's, the whole workspace's, or nothing at all. No surface renders
 * `basis` directly — surfaces read confidence through `isLowConfidenceEstimate`
 * instead (`RemainingEstimate.lowConfidence` aggregates the same predicate
 * across every rung; StageRail applies it per row).
 */
export interface StageEstimate {
  stage: string;
  estimateMs: number | null;
  sampleCount: number;
  basis: "stage" | "phase" | "global" | "none";
  /** Completed runs rejected from the pool used by this fallback rung. */
  sampleExcludedCount?: number;
  /** Accepted samples whose work time depends on incomplete activity coverage. */
  limitedSampleCount?: number;
}

/**
 * A `StageEstimate` is low confidence when it uses another stage's history,
 * too few runs, or activity coverage is limited or incomplete. The one
 * definition of "low confidence" in the app — `reader-core/timing/estimate.ts`
 * aggregates it into `RemainingEstimate.lowConfidence`, and the dashboard's
 * StageRail applies it per row so a fallback estimate doesn't read as a
 * measurement (Codex round 13, finding 3).
 */
export function isLowConfidenceEstimate(
  estimate: Pick<StageEstimate, "basis" | "sampleCount" | "limitedSampleCount"> & {
    quality?: TimingQuality | null;
  },
): boolean {
  return (
    estimate.basis !== "stage" ||
    estimate.sampleCount < 2 ||
    (estimate.limitedSampleCount ?? 0) > 0 ||
    estimate.quality?.status === "limited" ||
    estimate.quality?.status === "incomplete"
  );
}

/**
 * One stage with the state file and the audit log already reconciled — the
 * single record every timing-aware surface consumes (issue #9).
 *
 * The two sources disagree in four documented ways: a backward jump resets a
 * stage's `status` while its pre-jump runs stay in the log; a skip emits no
 * `STAGE_COMPLETED`; the engine writes the literal `none` sentinel into
 * `Current Stage`; and `STAGE_COMPLETED` fires only *after* `GATE_APPROVED`,
 * so an `awaiting-approval` stage may still have an open run. Every rule for
 * resolving those lives in `reader-core/timing/stage-view.ts` and nowhere
 * else — before this type existed, `estimate.ts`, `StageRail`, `NowStrip`,
 * `Header` and the VS Code status bar each re-derived them, and a fix to one
 * left the same bug standing in the others (PR #4 findings R9/R15).
 *
 * Extends {@link StageEstimate}, so `isLowConfidenceEstimate(view)` reads a
 * row's confidence with no unwrapping.
 */
export interface StageView extends StageEstimate {
  phase: Phase;
  execution: StageInfo["execution"];
  /** Verbatim from the state file — the audit log never overrides it. */
  status: StageStatus;
  /** Verbatim {@link StageInfo.unparseable}, so one row needs one record. */
  unparseable?: string;
  /** This stage is `WorkflowModel.currentStage`. At most one view has it. */
  isCurrent: boolean;
  /** A run for this stage is open right now — read from the data, never from `status`. */
  running: boolean;
  /**
   * The run that belongs to the attempt in play: the open run if there is
   * one, otherwise the most recent closed run *when `status` agrees the
   * attempt actually finished* (`completed` / `awaiting-approval`). `null`
   * when the stage has never run, or when its only runs predate a backward
   * jump that reset it.
   */
  currentAttempt: StageTiming | null;
  /** Closed runs that are not {@link currentAttempt} — earlier attempts. */
  history: StageTiming[];
  /**
   * Compatibility name for the closed current attempt's inferred work time.
   * This is an estimate from logs, not measured human or AI work time.
   * Null while open, absent, or when the audit cannot establish work time.
   */
  actualActiveMs: number | null;
  /**
   * Inferred work time on {@link currentAttempt}, open or closed. Null when
   * the attempt is absent or its work time cannot be established.
   */
  elapsedActiveMs: number | null;
  breakdown?: TimingBreakdown | null;
  quality?: TimingQuality | null;
  lastObservationAt?: string | null;
  sinceLastObservationMs?: number | null;
  sensitivity?: TimingSensitivity[];
  /**
   * Work left in this stage. `0` once it is finished, skipped, or out of
   * scope; `max(0, estimate - elapsed)` while a run is open; the full
   * {@link StageEstimate.estimateMs} when the attempt has not started.
   * Null when the estimate or the current attempt's work time is unavailable,
   * unless the state file independently marks the stage finished or skipped.
   */
  remainingMs: number | null;
  /**
   * This stage's {@link remainingMs} participates in
   * {@link RemainingEstimate.totalRemainingMs}. False for a stage that is
   * already finished, skipped or out of scope — those contribute nothing,
   * and counting their `0` would turn "nothing could be estimated" (`null`)
   * into a confident zero.
   */
  countsTowardRemaining: boolean;
}

/**
 * The workflow-level roll-up of {@link TimingsPayload.stageViews}. Purely a
 * sum over the views — it holds no per-stage numbers of its own, so there is
 * nothing here that can drift from what a stage row renders.
 */
export interface RemainingEstimate {
  /**
   * Estimated work left, not a wall-clock completion time.
   * Sums {@link StageView.remainingMs} over the views that
   * {@link StageView.countsTowardRemaining} marks. `null` only when nothing
   * at all could be estimated while stages remain. Zero when none remain.
   */
  totalRemainingMs: number | null;
  /** A counted estimate has too few samples, uses a fallback, or has limited coverage. */
  lowConfidence: boolean;
  estimateCoverage?: EstimateCoverage;
}

/**
 * How a {@link NextGateEstimate} reaches its approval.
 *
 * - `open`: the gate is open now; {@link NextGateEstimate.stage} awaits approval.
 * - `stage`: the stage's own approval gate, when that stage's work ends.
 * - `block`: unit-major iteration runs every Unit through the per-Unit
 *   Construction stages first. The stage gates then follow one by one, and
 *   {@link NextGateEstimate.stage}'s gate is the first of them.
 * - `unit`: a per-Unit approval, either a Unit checkpoint or a team Unit gate.
 *   It follows the current Unit's work on {@link NextGateEstimate.stage}. The
 *   stage-level sum covers every Unit still to come, so with several Units
 *   the approval arrives earlier than the sum says.
 * - `none`: no human approval gate remains before the workflow completes.
 */
export type NextGateKind = "open" | "stage" | "block" | "unit" | "none";

/**
 * Where the next human approval gate falls, and how much estimated work is
 * left before it opens. Like {@link RemainingEstimate}, this is inferred work
 * time, never a clock time: approval waits, breaks and questions asked inside
 * a stage are not predicted.
 *
 * Built in reader-core `timing/next-gate.ts` from {@link TimingsPayload.stageViews}
 * alone, so every number it sums is a {@link StageView.remainingMs} some stage
 * row already shows.
 */
export interface NextGateEstimate {
  kind: NextGateKind;
  /** The stage whose approval is meant. `null` only for `none`. */
  stage: string | null;
  /**
   * The summed {@link StageView.remainingMs} of {@link stages}. `0` when the
   * gate is open or nothing is left, and `null` when stages remain but none of
   * them could be estimated. When only some are unknown, it is the known part
   * and {@link estimateCoverage} counts the rest.
   */
  remainingMs: number | null;
  /** Unfinished stages whose remaining work was summed, in workflow order. */
  stages: string[];
  /** Summed stages whose completion the engine approves without a human. */
  autoApproved: string[];
  /**
   * `code-generation` is among {@link stages}. Each Unit's Plan Approval is a
   * human stop before its code is generated, and it is not a delimiter here.
   */
  planApproval: boolean;
  /**
   * aidlc-workflows v2.11.0 `approvesTogetherStages`: a `block` gate whose
   * stages one question approves together (the GATE_APPROVED row lists them
   * as `Approves Together`). Absent when they are asked one by one.
   */
  approvesTogether?: string[];
  /** A summed estimate is low confidence ({@link isLowConfidenceEstimate}). */
  lowConfidence: boolean;
  estimateCoverage: EstimateCoverage;
}

/** `GET /api/timings` success body. */
export interface TimingsPayload {
  /** Space resolved with the record; absent only for legacy or explicitly pinned readers. */
  space?: string;
  policy?: TimingPolicy;
  estimateCoverage?: EstimateCoverage;
  /**
   * Directory name of the record these numbers were aggregated for, captured
   * when the read resolved that directory. The same string as
   * {@link IntentList.selected}. A surface shows the payload only when the
   * two agree, so a response for one record cannot render under another
   * record that happens to use the same stage names.
   */
  intent: string;
  /** The active record's raw runs. Reconciliation belongs to {@link stageViews}. */
  timings: StageTiming[];
  /**
   * The `WorkflowModel.currentStage` these views were reconciled against —
   * the payload's own snapshot of what "current" meant when it was built.
   *
   * Carried explicitly rather than inferred from {@link StageView.isCurrent}:
   * "no stage is current" (a finished or unstarted workflow) and "the current
   * stage names no row at all" (the `none` sentinel, a hand-edited state file)
   * both produce zero `isCurrent` views, and a freshness check has to tell
   * them apart from the stage name the workflow feed is showing right now.
   */
  currentStage: string | null;
  /** One per `WorkflowModel.stages` entry, in the same order. */
  stageViews: StageView[];
  remaining: RemainingEstimate;
  /**
   * The next human approval gate from {@link currentStage}. reader-core always
   * sets it; surfaces treat an absent value as unknown.
   */
  nextGate?: NextGateEstimate;
  /**
   * Per-Unit progress through the per-Unit Construction stages. `null` when
   * the workflow has no readable Unit DAG; absent from payloads built before
   * this field existed.
   */
  unitWalk?: UnitWalk | null;
}

/**
 * Where one Unit stands on one per-Unit stage. `skipped` covers both a
 * recorded `UNIT_SKIPPED` and a stage the Unit passed without owing it.
 */
export type UnitStepStatus = "not-started" | "in-progress" | "completed" | "skipped";

export interface UnitStep {
  stage: string;
  status: UnitStepStatus;
}

export interface UnitWalkUnit {
  unit: string;
  /**
   * `completed` once every owed step is completed or skipped; `in-progress`
   * once any step began; `skipped` when the workflow skips every per-Unit stage.
   */
  status: UnitStepStatus;
  /** One per {@link UnitWalk.stages} entry, in the same order. */
  steps: UnitStep[];
}

/** How many Units have finished one per-Unit stage. */
export interface UnitStageProgress {
  stage: string;
  completed: number;
  skipped: number;
  total: number;
}

/**
 * Each Unit's progress through the per-Unit Construction stages, derived from
 * the Unit DAG (`unit-of-work-dependency.md`) and the audit log's Unit
 * receipts. The state file's stage checkboxes tick only when every Unit is
 * done, so this is what tells a part-done stage from an untouched one.
 */
export interface UnitWalk {
  /** The workflow's per-Unit stages, in stage order. */
  stages: string[];
  /** Units in the engine's walk order: dependency levels, each sorted by name. */
  units: UnitWalkUnit[];
  /** One per {@link stages} entry, in the same order. */
  byStage: UnitStageProgress[];
  /**
   * The open Unit this walk was derived with. A surface pairing the walk with
   * a later workflow read takes the open Unit from here, so the two never
   * disagree while the next timings read is in flight. Optional for payloads
   * built before it existed.
   */
  activeUnit?: ActiveUnit | null;
}

/**
 * Is this timings payload describing the stage the workflow feed is showing?
 *
 * `workflow.currentStage` and the timings payload come from two independent
 * reads (Codex PR #4 finding 2): a change push updates the workflow instantly,
 * but a timings read can still describe the stage that was current a moment
 * ago. Any surface that pairs the two must gate on this one predicate so it
 * never renders one stage's numbers under another stage's name — and so
 * "match" is not defined twice. The dashboard applies it once in
 * `store/select-timing.ts`; the VS Code status bar, which has no store, calls
 * {@link currentStageView} below.
 *
 * This is freshness only — *which* view is current was already decided by
 * reader-core's `resolveStageViews` (issue #9), so there is no reconciliation
 * left to get wrong at a surface.
 *
 * An absent payload is never fresh. Both `null` (neither side has a current
 * stage) is a match: there is nothing to disagree about.
 */
export function timingsMatchStage(
  workflowCurrentStage: string | null,
  timings: Pick<TimingsPayload, "currentStage"> | null,
): boolean {
  return timings !== null && timings.currentStage === workflowCurrentStage;
}

/**
 * The current stage's reconciled view, or `null` when there is no current
 * stage or the payload is stale ({@link timingsMatchStage}). The one way a
 * surface should reach for "the numbers for the stage on screen".
 */
export function currentStageView(
  workflowCurrentStage: string | null,
  timings: Pick<TimingsPayload, "currentStage" | "stageViews"> | null,
): StageView | null {
  if (!timingsMatchStage(workflowCurrentStage, timings)) return null;
  return timings?.stageViews.find((view) => view.isCurrent) ?? null;
}

/**
 * The per-row counterpart of {@link currentStageMatches}: does this view still
 * describe the row being drawn?
 *
 * Which run belongs to the attempt in play depends on the stage's `status`
 * (see {@link CURRENT_ATTEMPT_STATUSES}), so a view built from a state
 * snapshot older than the one a surface is rendering can carry a measurement
 * the fresh state has since disowned — a backward jump resets a downstream
 * row to `not-started` while the in-flight timings response still reports its
 * pre-jump run as finished (Codex review on PR #15). Gate a *measurement* on
 * this; a stage's estimate does not depend on its status and stands either
 * way.
 */
export function stageViewMatches(
  stage: Pick<StageInfo, "status">,
  view: Pick<StageView, "status"> | undefined,
): boolean {
  return view !== undefined && view.status === stage.status;
}

export type { SpaceCatalog, SpaceSelection, SwitchSpaceRequest } from "./spaces.ts";

export interface IntentList {
  space: string;
  /** Failure mode 1: `null` when the cursor is absent, empty or dangling. */
  active: string | null;
  /** Failure mode 2: always enumerated, independent of the cursor. */
  all: string[];
  /** Dashboard view pin. reader-core always emits `null`; api-core overlays it. */
  selected: string | null;
}

/** watch() notification — the record or its review inputs changed. */
export interface ChangeEvent {
  type: "change";
  scope: "state" | `matrix:${string}` | "audit" | "review-inputs";
  path: string;
}

/** watch() notification — liveness lost, the UI must stop trusting freshness (R-RC-4). */
export interface WatchWarning {
  type: "watch-warning";
  reason: "watcher-lost" | "resubscribe-failed";
}

/** Discriminated union handed to the watch callback. */
export type WatchEvent = ChangeEvent | WatchWarning;

/* ------------------------------------------------------------------ *
 * docs-bridge (U2) — source: construction/docs-bridge/functional-design/
 * domain-entities.md. Same ReadResult contract as reader-core.
 * ------------------------------------------------------------------ */

/** A project-specific link surfaced next to the built-in docs (FR-5.3). */
export interface ProjectLink {
  label: string;
  /** Relative path or URL — one field for both (component-methods.md `Link[]`). */
  target: string;
}

/** `andon.config.json`, after loading and validation (D1). */
export interface BridgeConfig {
  /** Absolute path to the docs checkout. `null` = run without excerpts. */
  docsRepoPath: string | null;
  projectLinks: ProjectLink[];
}

/** Where an entry points into the docs tree; `null` when the entry has no target. */
export interface DeepLink {
  docPath: string;
  docAnchor: string;
}

/** resolveStage() — data source of the StageCard explanation (US-03). */
export interface StageDoc {
  slug: string;
  /** ① What this stage is for, in 1–2 plain sentences. */
  purpose: string;
  /** ② Artifacts the stage consumes. */
  inputs: string[];
  /** ② Artifacts the stage produces. */
  outputs: string[];
  /** ③ Lead agent id that runs the stage (slug; not translated). */
  agent: string;
  /** ③ Learner-facing Japanese label for {@link agent}, when available. */
  agentDisplayName: string;
  /** ④ What the human is asked for at this stage's approval gate. */
  gateRequirement: string;
  deepLink: DeepLink | null;
  /** Verbatim section slice of the linked doc; `null` when docs are absent (BR-DB-2/3). */
  excerpt: string | null;
  /**
   * ② What each produced artifact contains, keyed by the canonical name used in
   * {@link outputs}. Derived from the bundled official-docs snapshot, so an
   * artifact the snapshot does not document is simply absent rather than guessed.
   */
  artifactDocs: Record<string, ArtifactDoc>;
  /** Which aidlc-workflows version the mapping was synced against (BR-DB-4). */
  sourceVersion: string;
}

/** One produced artifact, explained. Both locales ship so the card can switch. */
export interface ArtifactDoc {
  /** The file the stage writes; not always `<canonical name>.md`. */
  fileName: string;
  /** Description per locale; `null` where the snapshot documents no row. */
  descriptions: Record<OfficialDocsLocale, string | null>;
}

/** GET /api/io-paths の value。キーは bridge-map の論理名。 */
export interface StageIoPaths {
  stage: string;
  /** 解決に使った Unit。タブ無し / 非 Construction では null。 */
  unit: string | null;
  /** 論理名 → record 相対 POSIX path。無い・曖昧なら null。 */
  inputs: Record<string, string | null>;
  outputs: Record<string, string | null>;
}

/**
 * A markdown file surfaced in a catalogue — a usage guide (`GET /api/guides`)
 * or an agent knowledge file. One shape, because both endpoints list "a file
 * and its first heading".
 */
export interface MarkdownItem {
  /** Filename, e.g. `getting-started.md`. */
  name: string;
  /** First `#` heading, or a fallback from the filename. */
  title: string;
}

/** A markdown file with its content (`GET /api/guides/:name`, `/api/agents/:id/knowledge/:name`). */
export interface MarkdownDoc extends MarkdownItem {
  markdown: string;
}

/** One knowledge file under `.claude/knowledge/<agent-id>/`. */
export type AgentKnowledgeItem = MarkdownItem;

/** resolveAgent() — agent persona + owned stages and knowledge. */
export interface AgentDoc {
  id: string;
  displayName: string;
  description: string;
  /** Persona body after YAML frontmatter. */
  markdown: string;
  /** Stage slugs where bridge-map `agent` equals {@link id}. */
  stages: string[];
  knowledge: AgentKnowledgeItem[];
}

/* ------------------------------------------------------------------ *
 * official-docs (docs-i18n) — wire shapes for GET /api/official-docs/*.
 * Produced by @andon/official-docs via api-core; dashboard consumes
 * these types only (no package import of official-docs / reader-core).
 * ------------------------------------------------------------------ */

/** Supported official-docs locales. */
export type OfficialDocsLocale = "en" | "ja";

/**
 * Every bundled documentation section, in reading order.
 *
 * These are upstream aidlc-workflows' own `docs/` subdirectories, not a
 * taxonomy of ours — `overview` is the one name we coin, for the two pages
 * (`README.md`, `roadmap.md`) upstream keeps loose in the docs root and that
 * therefore have no directory to be named after.
 *
 * The single source of truth for the section list: `@andon/official-docs`
 * derives `DocSection` from it, the mirror walks it, and the Shell nav renders
 * it. It lives in shared-types because the dashboard needs the list too and
 * must not import official-docs (structural ban).
 */
export const OFFICIAL_DOCS_SECTIONS = [
  "overview",
  "guide",
  "harness-engineering",
  "reference",
  "rfcs",
] as const;

/** One bundled documentation section. */
export type OfficialDocsSection = (typeof OFFICIAL_DOCS_SECTIONS)[number];

/**
 * Upstream aidlc-workflows repository coordinates.
 *
 * Nothing here names a branch, deliberately. Upstream's default branch was
 * `v2` until GA moved it to `main` and deleted `v2`, which silently broke
 * every place that had hardcoded it: the docs-sync workflow could no longer
 * resolve an upstream tip, so the pin froze, and the links already published
 * to users started 404ing. `HEAD` resolves to whatever the default branch is
 * called at read time, and the sync workflow asks the remote rather than
 * assuming — so the next rename costs nothing.
 */
export const UPSTREAM_REPO_SLUG = "awslabs/aidlc-workflows";
export const UPSTREAM_REPO_URL = `https://github.com/${UPSTREAM_REPO_SLUG}`;
export const UPSTREAM_GIT_URL = `${UPSTREAM_REPO_URL}.git`;

/**
 * Link to a file in upstream's repository on its current default branch.
 *
 * `repoRelPath` is a path in UPSTREAM's tree, which has no locale directories:
 * a page this repo mirrors to `docs/guide/en/x.md` is `docs/guide/x.md` there.
 */
export function upstreamBlobUrl(repoRelPath: string): string {
  return `${UPSTREAM_REPO_URL}/blob/HEAD/${repoRelPath.replace(/^\/+/, "")}`;
}

/**
 * GitHub's heading-anchor algorithm: downcase, drop everything that is not a
 * word character / space / hyphen, then spaces to hyphens
 * (tech-stack-decisions.md「anchor 照合は GitHub 形式 slug」).
 *
 * Runs of removed punctuation leave the surrounding spaces intact, which is
 * why `"A & B"` becomes `a--b` rather than `a-b` — matching GitHub, so an
 * anchor copied out of a rendered page resolves here unchanged.
 *
 * Lives here because four surfaces have to agree on it byte-for-byte: the
 * excerpt slicer (docs-bridge) and the page resolver (official-docs) compute
 * the anchor a deep link is *written* against, and the Shell (dashboard)
 * computes the one it is *matched* against in the DOM. A copy that drifts in
 * any one of them breaks deep links silently rather than loudly.
 *
 * Accepts either form the two sides hold: docs-bridge and official-docs pass
 * the **raw markdown line**, the Shell passes **rendered DOM text**. ATX
 * markers are therefore recognised as a pair — the closing `##` CommonMark
 * allows is dropped only from a line that opened with one.
 *
 * Both halves of that rule are load-bearing, and each is what keeps one of the
 * two forms in step with the other:
 *  - Dropping it from a raw line is what makes `## Feature scope ##` agree
 *    with the `Feature scope` the renderer hands the Shell.
 *  - *Not* dropping it from rendered text is what keeps a heading whose
 *    content genuinely ends in hashes — ``## Command `##` ``, rendered as
 *    `Command ##` — agreeing too. Trailing hashes are only syntax on the raw
 *    line; in DOM text they are just characters.
 *
 * A closing marker also only counts when whitespace precedes it, so `## C#`
 * still slugs its content, per CommonMark.
 */
export function slugifyHeading(heading: string): string {
  const opening = /^#{1,6}\s*/.exec(heading);
  const body =
    opening === null ? heading : heading.slice(opening[0].length).replace(/\s+#+\s*$/, "");
  return body
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .replace(/\s/g, "-");
}

/** `"#foo"`, `"foo"` and `"  #Foo "` all address the same section. */
export function normalizeAnchor(anchor: string): string {
  return slugifyHeading(anchor.trim().replace(/^#/, ""));
}

/**
 * `GET /api/official-docs/stage/:slug` value when the slug is mapped.
 * Wire shape only — dashboard must not import `@andon/official-docs`.
 */
export interface StageDocRef {
  path: string;
  anchor?: string;
}

/**
 * Webview → host: open Official Docs Shell (Bolt 3).
 * Mapped: `path` present and length ≥ 1. Unmapped: omit `path` / `anchor` keys.
 */
export type OpenOfficialDocMessage =
  | {
      type: "open-official-doc";
      locale: OfficialDocsLocale;
      path: string;
      anchor?: string;
    }
  | { type: "open-official-doc"; locale: OfficialDocsLocale };

/** Host → webview inject after a valid `open-official-doc`. */
export type DocsShellDeepLinkMessage = {
  type: "docs-shell-deeplink";
  locale: OfficialDocsLocale;
  path?: string;
  anchor?: string;
};

/** One-shot Shell deep-link target (store / inject payload without `type`). */
export type DocsShellDeepLink = {
  locale: OfficialDocsLocale;
  path?: string;
  anchor?: string;
};

/** `GET /api/official-docs/manifest` value. */
export interface OfficialDocsManifest {
  sourceVersion: string;
  source: string;
  capturedAt: string;
}

/** Notice when ja was requested but en body was served. */
export type OfficialDocsPageNotice = "missing_ja";

/** `GET /api/official-docs/:locale/*` value. */
export interface OfficialDocsPage {
  localeRequested: OfficialDocsLocale;
  localeServed: OfficialDocsLocale;
  path: string;
  bodyMarkdown: string;
  title?: string;
  notice?: OfficialDocsPageNotice;
  sourceVersion: string;
  anchorApplied: "scrolled" | "top" | "none";
}

/** One node in the official-docs TOC tree, nested by the docs directory layout. */
export interface OfficialDocsTocNode {
  /** Stable key: the doc path for a page, the directory path for a category. */
  id: string;
  title: string;
  /** Page this row opens; absent on a category with no `README.md` overview. */
  path?: string;
  children: OfficialDocsTocNode[];
}

/**
 * `GET /api/official-docs/toc/:locale` value — one nav tree per section.
 *
 * Keyed by section rather than a fixed pair of fields so adding a section is a
 * change to {@link OFFICIAL_DOCS_SECTIONS} alone; a section with no pages on
 * disk is present with an empty array, never absent.
 */
export type OfficialDocsToc = Record<OfficialDocsSection, OfficialDocsTocNode[]>;

/* ------------------------------------------------------------------ *
 * dashboard-server (U5) — source: construction/dashboard-server/
 * functional-design/domain-entities.md. Shared because the WS union and
 * the answer contract are the wire format the dashboard-ui speaks.
 * ------------------------------------------------------------------ */

/** CLI-level serve contract. The dashboard always binds `127.0.0.1`. */
export interface ServeOptions {
  port: number;
}

/**
 * `GET /api/workflow` success body — stage 1 of first paint. Deliberately
 * carries no `matrix` key (ADR-03 段階的初回描画).
 */
export interface WorkflowPayload {
  workflow: WorkflowModel;
  nextStep: NextStep;
  warnings?: string[];
}

/**
 * Server → client push. The server never reads from the socket (S-DS-6), so
 * this union is one-way.
 *
 * Clients get no snapshot on connect: initial state comes from REST, the
 * socket carries only deltas (domain-entities.md ライフサイクル).
 */
export type WsMessage =
  | { type: "matrix-ready"; matrix: Matrix }
  | {
      type: "change";
      scope: "state";
      workflow: WorkflowModel;
      nextStep: NextStep;
      warnings?: string[];
    }
  | { type: "change"; scope: `matrix:${string}`; cells: MatrixCell[] }
  | { type: "change"; scope: "audit"; events: AuditEvent[] }
  | { type: "live-status"; degraded: boolean; reason?: string }
  | { type: "intent-selected"; intent: string | null }
  | { type: "space-selected"; space: string; intent: string | null }
  | { type: "customization-changed" };

/**
 * `POST /api/answer` body — a bounded update to a workflow question.
 *
 * `line` is **1-based**, matching how the artifact is displayed to the human
 * who is answering (see code-summary.md D-3).
 */
export interface AnswerRequest {
  file: string;
  line: number;
  value: string;
}

/** AnswerWriter gate rejections (business-rules.md エラー識別子). */
export type AnswerError =
  | "not-a-questions-file"
  | "outside-record"
  | "not-an-answer-line"
  /** An answer the engine records from the chat (see `chatAnsweredLine`). */
  | "chat-answered-line"
  | "write-verification-failed";

/**
 * ms → `2h10m` / `45m` / `<1m` / `—`.
 *
 * `<1m` rather than `0m`: a stage that has just started has not taken zero
 * time, and "0m" reads as a broken measurement. Lives here because the
 * dashboard and the VS Code status bar must format the same
 * {@link TimingsPayload} numbers identically (the extension bundle cannot
 * import dashboard code, and a hand-mirrored copy had already drifted).
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** Timing estimates distinguish a known zero from an unavailable duration. */
export function formatTimingDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms === 0) return "0m";
  if (ms < 60_000) return "<1m";
  return formatDuration(ms);
}

/** A zero remainder during a run does not mean that the stage has completed. */
export function isStageEstimateOverrun(
  view: Pick<StageView, "running" | "elapsedActiveMs" | "estimateMs">,
): boolean {
  return (
    view.running &&
    view.elapsedActiveMs !== null &&
    view.estimateMs !== null &&
    view.elapsedActiveMs > view.estimateMs
  );
}

/**
 * The work before the next gate is the current stage's alone, and that stage
 * has run past its estimate. A later stage's estimate still stands, so a sum
 * that includes one is not an overrun.
 */
export function isNextGateOverrun(
  nextGate: Pick<NextGateEstimate, "kind" | "stages">,
  current: Pick<StageView, "stage" | "running" | "elapsedActiveMs" | "estimateMs">,
): boolean {
  return (
    nextGate.kind !== "open" &&
    nextGate.kind !== "none" &&
    nextGate.stages.length === 1 &&
    nextGate.stages[0] === current.stage &&
    isStageEstimateOverrun(current)
  );
}

/**
 * Where a {@link NextGateEstimate}'s approval falls, as one short line. The
 * dashboard and the VS Code status bar both print it, so it lives here rather
 * than in two hand-synced copies. `null` when there is nothing to name: no
 * estimate yet, or no gate and no work left.
 */
export function nextGateTarget(nextGate: NextGateEstimate | null): string | null {
  if (nextGate === null) return null;
  switch (nextGate.kind) {
    case "open":
    case "stage":
      return `${nextGate.stage} の承認`;
    case "block":
      return `全 Unit の完了後、${nextGate.stage} から順に承認`;
    case "unit":
      return `${nextGate.stage} 後の Unit 承認`;
    case "none":
      return nextGate.remainingMs === null || nextGate.remainingMs === 0
        ? null
        : `完了まで ≈${formatTimingDuration(nextGate.remainingMs)}`;
  }
}

/* ── Preflight (/api/preflight) ──────────────────────────────────────── */

/** 記述テキストの上限。handler / textarea / sanitize の三層で同じ値を使う。 */
export const PREFLIGHT_TEXT_MAX = 8000;

/** `aidlc-utility.ts detect --json` の透過サブセット。 */
export interface PreflightScan {
  projectType: string;
  languages: string;
  frameworks: string;
  buildSystem: string;
}

export interface PreflightScopeSummary {
  name: string;
  description: string;
  depth: string;
  skeleton: string;
  executeCount: number;
  totalCount: number;
  gateCount: number;
}

/** `inferScopeFromText` の透過。 */
export interface PreflightInference {
  scope: string;
  source: "keyword" | "freeform";
  matches: Array<{ scope: string; keyword: string }>;
}

export interface PreflightStage {
  slug: string;
  number: string;
  name: string;
  phase: string;
  decision: "EXECUTE" | "SKIP";
  leadAgent: string;
  gate: boolean;
  produces: string[];
}

export interface PreflightPlan {
  scope: string;
  depth: string;
  skeleton: string;
  executeCount: number;
  totalCount: number;
  gateCount: number;
  phases: Array<{ phase: string; stages: PreflightStage[] }>;
}

/**
 * fail-soft: 取れなかった部分は null + errors に理由コード。
 * ルート全体は常に 200（BR-DS-4 と同じ思想）。
 */
export interface PreflightPayload {
  scan: PreflightScan | null;
  scopes: PreflightScopeSummary[];
  inference: PreflightInference | null;
  plan: PreflightPlan | null;
  /**
   * `null` = inference-only response (a `?text=` request): the static part
   * (`scan`/`scopes`/`cli`) is not recomputed on every keystroke, so the
   * client must carry it forward from the mount (no-`text`) response instead
   * of trusting this field on a text response.
   */
  cli: { bun: boolean; claude: boolean } | null;
  errors: string[];
}
export type * from "./customization.ts";
export {
  MAX_CUSTOMIZATION_PACKAGE_BYTES,
  MAX_CUSTOMIZATION_PACKAGE_JSON_BYTES,
} from "./customization-limits.ts";
export type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaJob,
  DocsQaPhase,
  DocsQaRequest,
  DocsQaResult,
  DocsQaTarget,
  DocsQaTool,
  DocsQaToolStatus,
} from "./docs-qa.ts";
export type { AgentModelSetting, StageModelSettings, StageModelsPayload } from "./stage-models.ts";
