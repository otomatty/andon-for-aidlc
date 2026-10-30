import path from "node:path";
import { guardPath, readBounded, withResult } from "@andon/core-utils";
import type {
  AuditEvent,
  EffectivenessPayload,
  IntentList,
  Matrix,
  NextStep,
  ReadResult,
  StageInfo,
  TimingPolicy,
  TimingsPayload,
  WatchEvent,
  WorkflowModel,
} from "@andon/shared-types";
import { readAllAuditEvents, readAuditEvents } from "./audit/events.ts";
import { getEffectiveness } from "./effectiveness/read.ts";
import { resolveIntents, resolveRecordDir } from "./intents/resolve.ts";
import { readState } from "./parse/state.ts";
import { estimateRemaining } from "./timing/estimate.ts";
import { memoryHoldsGuardPolicyStrict } from "./tree/review-freshness.ts";
import { planApprovalSwitchedOff, scopePlanApprovalDefault } from "./effectiveness/settings.ts";
import {
  estimateNextGate,
  PER_UNIT_STAGES,
  skeletonCheckpointCleared,
} from "./timing/next-gate.ts";
import { DEFAULT_TIMING_POLICY } from "./timing/policy.ts";
import { getStageTimingSamples, getStageTimings } from "./timing/read.ts";
import { resolveStageViews } from "./timing/stage-view.ts";
import { buildMatrix } from "./tree/matrix.ts";
import { readUnitWalk } from "./tree/unit-walk.ts";
import { type WatchOptions, watch } from "./watch/watcher.ts";

/** Re-exported from core-utils so existing consumers keep one import site (S-RC-2 consumer contract). */
export type { BoundedRead, BoundedReason } from "@andon/core-utils";
export {
  canonicalPath,
  canonicalPathSync,
  guardPath,
  MAX_READ_BYTES,
  readBounded,
  readTail,
  withResult,
} from "@andon/core-utils";
export { readAllAuditEvents, readAuditEvents } from "./audit/events.ts";
export { getEffectiveness } from "./effectiveness/read.ts";
export {
  isSpaceName,
  isSwitchableSpaceName,
  listSpaces,
  readActiveSpace,
} from "./intents/spaces.ts";
export { watchSelection } from "./watch/selection.ts";
export {
  DEFAULT_SPACE,
  electActive,
  intentsDirOf,
  resolveIntents,
  resolveRecordDir,
} from "./intents/resolve.ts";
export { CURRENT_STATE_VERSION, parseState, readState, STATE_FILENAME } from "./parse/state.ts";
/** @deprecated Legacy comparison threshold. Current timing uses DEFAULT_TIMING_POLICY. */
export { IDLE_THRESHOLD_MS } from "./timing/attribution.ts";
export { deriveStageTimings } from "./timing/derive.ts";
export { createStageEstimator, estimateRemaining } from "./timing/estimate.ts";
export { estimateNextGate, skeletonCheckpointCleared } from "./timing/next-gate.ts";
export { DEFAULT_TIMING_POLICY } from "./timing/policy.ts";
export { getStageTimingSamples, getStageTimings } from "./timing/read.ts";
export { resolveStageViews } from "./timing/stage-view.ts";
export { listMarkdownRel, pickIoPath } from "./tree/io-paths.ts";
export {
  buildMatrix,
  buildMatrixForUnit,
  buildMatrixForUnits,
  CONSTRUCTION_DIRNAME,
} from "./tree/matrix.ts";
export { reviewUnitsInAuditShard } from "./tree/review-records.ts";
export { deriveUnitWalk, parseUnitWalkOrder, readUnitWalk } from "./tree/unit-walk.ts";
export {
  classifyScope,
  createChangeQueue,
  DEFAULT_DEBOUNCE_MS,
  type Scope,
  type WatchOptions,
  watch,
} from "./watch/watcher.ts";

/** Public reads return ReadResult; watch returns its disposal callback. */
export interface Reader {
  getWorkflow(): Promise<ReadResult<WorkflowModel>>;
  getMatrix(): Promise<ReadResult<Matrix>>;
  getAuditEvents(limit: number): Promise<ReadResult<AuditEvent[]>>;
  getIntents(): Promise<ReadResult<IntentList>>;
  getNextStep(): Promise<ReadResult<NextStep>>;
  /** `now` is injectable so tests measure an open run deterministically. */
  getTimings(now?: number): Promise<ReadResult<TimingsPayload>>;
  /** All intents in the active space, independent of the dashboard's view pin. */
  getEffectiveness(now?: number): Promise<ReadResult<EffectivenessPayload>>;
  readArtifact(relPath: string): Promise<ReadResult<string>>;
  watch(onChange: (event: WatchEvent) => void, options?: WatchOptions): () => void;
}

export interface ReaderOptions {
  /** Applied identically to current runs and the space-wide history. */
  timingPolicy?: TimingPolicy;
  /**
   * Record directory override. A string is a fixed path (tests). A function is
   * re-invoked on every record-dependent call (Dashboard view pin). Without it
   * the reader re-resolves the active-intent cursor — do not add caching here.
   */
  recordDir?: string | (() => Promise<ReadResult<string>>);
}

/**
 * Pure next-step derivation over an already-read {@link WorkflowModel}.
 * Exported so callers that hold a workflow (the `/api/workflow` handler, the
 * hub's state push) derive the next step from that one read instead of paying
 * a second cursor-resolve + state parse via {@link Reader.getNextStep} — both
 * sit on the ≤3s first-paint / ≤2s change-reflect critical paths.
 */
export function nextStepOf(model: WorkflowModel): NextStep {
  const from = model.stages.findIndex((s) => s.slug === model.currentStage);
  const next = model.stages
    .slice(from + 1)
    .find((s) => s.execution === "EXECUTE" && s.status !== "completed" && s.status !== "skipped");
  return { nextStage: next?.slug ?? null, requirement: requirementFor(next) };
}

/** Keep browse-compat / parse warnings on derived reads (next step, matrix, timings). */
function carryWarnings<T>(source: { warnings?: string[] }, result: ReadResult<T>): ReadResult<T> {
  if (!("ok" in result) || source.warnings === undefined) return result;
  return { ...result, warnings: [...source.warnings, ...(result.warnings ?? [])] };
}

/** What the human is asked for at `stage`. */
function requirementFor(stage: StageInfo | undefined): string {
  if (stage === undefined) return "残りの in-scope ステージはありません（ワークフロー完了）";
  switch (stage.status) {
    case "awaiting-approval":
      return `${stage.slug}: 承認ゲートが開いています — 成果物を確認して承認または差し戻しを返してください`;
    case "revising":
      return `${stage.slug}: 差し戻し後の修正中 — 修正内容を確認して再承認してください`;
    case "in-progress":
      return `${stage.slug}: 実行中 — 完了後に承認ゲートで確認を求められます`;
    default:
      return `${stage.slug}: 未着手 — 実行を開始し、完了時に承認ゲートで確認を求められます`;
  }
}

/**
 * L7 facade. Holds no state and touches no filesystem at construction time
 * (P-RC-7), so creating a reader is free and every read sees the current
 * workspace.
 */
export function createReader(rootPath: string, options: ReaderOptions = {}): Reader {
  // Derive identity from the directory actually read, never from a later cursor read.
  const recordIdentity = (record: string): WorkflowModel["record"] => {
    const parts = path.relative(rootPath, record).split(path.sep);
    return parts.length === 5 &&
      parts[0] === "aidlc" &&
      parts[1] === "spaces" &&
      parts[3] === "intents"
      ? { space: parts[2]!, intent: parts[4]! }
      : undefined;
  };
  /** Record-dependent methods share this; `no-active-intent` is failure mode 1. */
  const recordDir = async (): Promise<ReadResult<string>> => {
    const bound = options.recordDir;
    if (bound === undefined) return await resolveRecordDir(rootPath);
    if (typeof bound === "string") return { ok: true, value: bound };
    return await bound();
  };

  const workflow = async (): Promise<ReadResult<WorkflowModel>> => {
    const record = await recordDir();
    if (!("ok" in record)) return record;
    const state = await readState(record.value);
    const identity = recordIdentity(record.value);
    return "ok" in state && identity
      ? { ...state, value: { ...state.value, record: identity } }
      : state;
  };

  return {
    getIntents: () => withResult(() => resolveIntents(rootPath)),

    getEffectiveness: (now = Date.now()) => withResult(() => getEffectiveness(rootPath, now)),

    getWorkflow: () => withResult(workflow),

    getMatrix: () =>
      withResult(async () => {
        const record = await recordDir();
        if (!("ok" in record)) return record;
        // L2 receives the CONSTRUCTION slug set from L1 — the version knowledge
        // stays in parse/ (BR-RC-4).
        const state = await readState(record.value);
        if (!("ok" in state)) return state;
        const slugs = state.value.stages
          .filter((s) => s.phase === "CONSTRUCTION")
          .map((s) => s.slug);
        const matrix = carryWarnings(state, await buildMatrix(record.value, slugs));
        const identity = recordIdentity(record.value);
        return "ok" in matrix && identity
          ? { ...matrix, value: { ...matrix.value, record: identity } }
          : matrix;
      }),

    getAuditEvents: (limit) =>
      withResult(async () => {
        const record = await recordDir();
        return "ok" in record ? await readAuditEvents(record.value, limit) : record;
      }),

    getNextStep: () =>
      withResult(async () => {
        const state = await workflow();
        if (!("ok" in state)) return state;
        return carryWarnings(state, { ok: true, value: nextStepOf(state.value) });
      }),

    getTimings: (now = Date.now()) =>
      withResult(async () => {
        const record = await recordDir();
        if (!("ok" in record)) return record;
        const state = await readState(record.value);
        if (!("ok" in state)) return state;

        const policy = options.timingPolicy ?? DEFAULT_TIMING_POLICY;
        const timings = await getStageTimings(record.value, now, policy);
        if (!("ok" in timings)) return timings;

        // Two reads in the unpinned case: the active record's own runs for the
        // stage rail, the whole space for the estimate's sample pool. A full
        // audit parse is ~15ms, so sharing one pass is not worth threading an
        // intent id through StageTiming.
        //
        // A pinned recordDir (tests) scopes the pool to that one record, so the
        // second read would be the same read — `null` here rather than reusing
        // the object, so its warnings cannot be merged in twice.
        // A string pin is a test override (one record). A resolver is the
        // Dashboard view pin — estimates still draw on the whole space.
        const space = recordIdentity(record.value)?.space;
        const samples =
          typeof options.recordDir === "string"
            ? null
            : await getStageTimingSamples(rootPath, now, policy, space);
        if (samples !== null && !("ok" in samples)) return samples;

        const warnings = [
          ...(state.warnings ?? []),
          ...(timings.warnings ?? []),
          ...(samples?.warnings ?? []),
        ];
        // One reconciliation, then its readers: the roll-up and next gate below,
        // and every surface downstream (issue #9). `timings.value` is the active
        // record's own runs — what "this stage's current attempt" is measured
        // against — while the sample pool only ever sizes the estimates.
        const stageViews = resolveStageViews(
          state.value,
          timings.value,
          (samples ?? timings).value,
        );
        const remaining = estimateRemaining(stageViews);
        const construction = state.value.constructionPolicy;
        // One full audit parse at most, shared by the readers below that need
        // it; a record that needs neither never pays for it.
        let audit: Promise<ReadResult<AuditEvent[]>> | null = null;
        const auditEvents = (): Promise<ReadResult<AuditEvent[]>> =>
          (audit ??= readAllAuditEvents(record.value));
        // Only an autonomous checkpoint workflow that may run a walking skeleton
        // needs the audit log's word on it; everyone else skips the read. An
        // unreadable log leaves the skeleton owed, the earlier of the two gates.
        const skeletonCleared =
          construction?.checkpoints && construction.autonomous && construction.skeletonMayRun
            ? await auditEvents().then(
                (events) =>
                  "ok" in events &&
                  skeletonCheckpointCleared(events.value, {
                    stageOrder: state.value.stages.map((stage) => stage.slug),
                    unitStages: state.value.stages
                      .filter(
                        (stage) => stage.execution === "EXECUTE" && PER_UNIT_STAGES.has(stage.slug),
                      )
                      .map((stage) => stage.slug),
                  }),
                () => false,
              )
            : false;
        // v2.11.0 resolvePlanApprovalSetting: the machine switch wins, then the
        // intent's recorded switch (or, without one, its scope's default),
        // unless a memory layer's Guard Policy strict keeps the stop.
        const planApprovalSetting =
          state.value.ceremonies?.planApproval?.value ??
          (await scopePlanApprovalDefault(rootPath, state.value.scope));
        const planApproval =
          !(await planApprovalSwitchedOff(rootPath)) &&
          (planApprovalSetting !== "off" || (await memoryHoldsGuardPolicyStrict(record.value)));
        const nextGate = estimateNextGate(stageViews, construction, {
          skeletonCleared,
          planApproval,
        });
        const unitWalk = await readUnitWalk(record.value, state.value, auditEvents);
        const value: TimingsPayload = {
          ...(space === undefined ? {} : { space }),
          policy,
          estimateCoverage: remaining.estimateCoverage ?? { known: 0, unknown: 0 },
          // The record directory's name is the intent slug, for both the
          // active-intent cursor and the Dashboard view pin. Stamped here, at
          // the resolution this read used, not from a pin sampled later.
          intent: path.basename(record.value),
          timings: timings.value,
          // The snapshot the views were reconciled against, so a consumer
          // pairing this payload with its own (later) workflow read can tell
          // stale from current without re-deriving it (issue #10).
          currentStage: state.value.currentStage,
          stageViews,
          remaining,
          nextGate,
          unitWalk,
        };
        return warnings.length > 0 ? { ok: true, value, warnings } : { ok: true, value };
      }),

    readArtifact: (relPath) =>
      withResult(async () => {
        const record = await recordDir();
        if (!("ok" in record)) return record;
        // Containment before the size probe: a path outside the record must not
        // even get a stat (nfr-design/logical-components.md dataflow note).
        const guarded = await guardPath(record.value, relPath);
        if (!("ok" in guarded)) return guarded;
        const read = await readBounded(guarded.value);
        if (read.ok) return { ok: true, value: read.value };
        return {
          error: true,
          reason: read.reason === "file-too-large" ? "file-too-large" : "artifact-not-found",
        };
      }),

    watch: (onChange, watchOptions) => {
      if (typeof options.recordDir === "string") {
        return watch(options.recordDir, onChange, watchOptions);
      }
      let dispose: (() => void) | null = null;
      let disposed = false;
      void recordDir().then((record) => {
        if (disposed || !("ok" in record)) return;
        dispose = watch(record.value, onChange, watchOptions);
      });
      return () => {
        disposed = true;
        dispose?.();
      };
    },
  };
}
export { readStageModels } from "./models/read.ts";
export { inspectVersionGate, type VersionGateDeps } from "./version/gate.ts";
export {
  compareReleaseIds,
  isPreviewRelease,
  isReleaseId,
  parseReleaseId,
  type ReleaseId,
} from "./version/release-id.ts";
export {
  type DetectedHarness,
  detectHarnesses,
  findHarnessConflict,
  HARNESS_CONFLICTS,
  HARNESS_LABELS,
  type HarnessConflict,
  type HarnessDetectResult,
  type HarnessId,
  harnessVersionRel,
  type NativeProjection,
  parseAidlcVersionSource,
  readAllWorkspaceAidlcVersions,
  readNativeProjections,
  type WorkspaceAidlcVersion,
} from "./version/harness.ts";
export {
  inspectProjectPin,
  installLocations,
  type NativeInstall,
  type ProjectPinState,
  readNativeInstall,
} from "./version/native-install.ts";
