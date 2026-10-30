import {
  buildMatrixForUnits,
  nextStepOf,
  type Reader,
  reviewUnitsInAuditShard,
} from "@andon/reader-core";
import type { Matrix, MatrixCell, ReadResult, WatchEvent, WsMessage } from "@andon/shared-types";

/**
 * WS fan-out and the watch→broadcast mapping (P-DS-3 / BR-DS-6).
 *
 * Structurally typed on `send` alone rather than on Bun's `ServerWebSocket`, so
 * the fan-out rules are testable without a socket — and so this module stays
 * transport-shaped rather than Bun-shaped.
 */
export interface PushClient {
  send(data: string): void;
}

export interface Hub {
  add(client: PushClient): void;
  remove(client: PushClient): void;
  size(): number;
  broadcast(message: WsMessage): void;
  handleWatchEvent(event: WatchEvent, stillCurrent?: () => boolean): Promise<void>;
}

export interface HubDeps {
  reader: Reader;
  recordDir(): Promise<ReadResult<string>>;
  /** How many audit events an `audit` change re-sends. */
  auditLimit?: number;
  onMatrixInvalidated?(units?: readonly string[]): void;
  onMatrix?(result: ReadResult<Matrix>): void;
  onMatrixUnits?(units: readonly string[], cells: readonly MatrixCell[]): void;
  /** False while the version check blocks the workspace: nothing is pushed. */
  allowPush?(): boolean;
}

const DEFAULT_AUDIT_LIMIT = 50;
const MATRIX_SCOPE = "matrix:";

export function createHub(deps: HubDeps): Hub {
  const clients = new Set<PushClient>();
  const auditLimit = deps.auditLimit ?? DEFAULT_AUDIT_LIMIT;
  const auditedUnits = new Map<string, string[]>();
  let queued: Promise<void> = Promise.resolve();

  const broadcast = (message: WsMessage): void => {
    if (deps.allowPush?.() === false) return;
    const data = JSON.stringify(message);
    for (const client of clients) {
      try {
        client.send(data);
      } catch {
        clients.delete(client);
      }
    }
  };

  const degrade = (reason: string): void =>
    broadcast({ type: "live-status", degraded: true, reason });

  const onFullMatrix = async (current: () => boolean, invalidated = false): Promise<void> => {
    if (!current()) return;
    if (!invalidated) deps.onMatrixInvalidated?.();
    const matrix = await deps.reader.getMatrix();
    if (!current()) return;
    deps.onMatrix?.(matrix);
    if (!("ok" in matrix)) return degrade("matrix-unreadable");
    for (const unit of matrix.value.units)
      broadcast({
        type: "change",
        scope: `matrix:${unit}`,
        cells: matrix.value.cells.filter((cell) => cell.unit === unit),
      });
  };

  const onState = async (current: () => boolean): Promise<void> => {
    deps.onMatrixInvalidated?.();
    // One read: the next step derives from the same state parse (≤2s change path).
    const state = await deps.reader.getWorkflow();
    if (!current()) return;
    if (!("ok" in state)) {
      deps.onMatrix?.(state);
      return degrade("workflow-unreadable");
    }
    broadcast({
      type: "change",
      scope: "state",
      workflow: state.value,
      nextStep: nextStepOf(state.value),
      ...(state.warnings === undefined ? {} : { warnings: state.warnings }),
    });
    // Change Control and Construction Iteration can change review readiness
    // without touching an artifact or appending an audit row.
    await onFullMatrix(current, true);
  };

  const onAudit = async (changedPath: string, current: () => boolean): Promise<void> => {
    const events = await deps.reader.getAuditEvents(auditLimit);
    if (!current()) return;
    if (!("ok" in events)) return degrade("audit-unreadable");
    broadcast({ type: "change", scope: "audit", events: events.value });
    // The review file is written before REVIEW_COMPLETED. Its watcher event
    // may arrive before the receipt; the audit write must refresh the badge too.
    const record = await deps.recordDir();
    if (!current() || !("ok" in record)) return;
    const key = `${record.value}\0${changedPath}`;
    const units = await reviewUnitsInAuditShard(record.value, changedPath);
    if (!current()) return;
    const affected = [...new Set([...(auditedUnits.get(key) ?? []), ...(units ?? [])])];
    if (units !== null) auditedUnits.set(key, units);
    if (affected.length > 0) await onMatrixUnits(affected, current);
    else if (units === null) {
      // An entire shard can disappear during checkout. No rows remain to name
      // its units, so this exceptional path re-reads the matrix once.
      await onFullMatrix(current);
    }
  };

  const onMatrixUnits = async (units: string[], current: () => boolean): Promise<void> => {
    if (!current()) return;
    deps.onMatrixInvalidated?.(units);
    const record = await deps.recordDir();
    if (!current()) return;
    if (!("ok" in record)) return degrade("no-record");
    const state = await deps.reader.getWorkflow();
    if (!current()) return;
    if (!("ok" in state)) return degrade("workflow-unreadable");
    const stages = state.value.stages.filter((s) => s.phase === "CONSTRUCTION").map((s) => s.slug);
    const cells = await buildMatrixForUnits(record.value, units, stages);
    if (!current()) return;
    if (!("ok" in cells)) return degrade("matrix-unreadable");
    deps.onMatrixUnits?.(units, cells.value);
    for (const unit of units)
      broadcast({
        type: "change",
        scope: `matrix:${unit}`,
        cells: cells.value.filter((cell) => cell.unit === unit),
      });
  };

  return {
    add: (client) => {
      clients.add(client);
    },
    remove: (client) => {
      clients.delete(client);
    },
    size: () => clients.size,
    broadcast,

    handleWatchEvent(event, stillCurrent) {
      // Watch callbacks can overlap. Serial reads keep an older full or Unit
      // snapshot from arriving after a newer invalidation for the same record.
      const task = queued.then(async () => {
        const current = (): boolean => stillCurrent === undefined || stillCurrent();
        if (!current()) return;
        if (event.type === "watch-warning") {
          degrade(event.reason);
          return;
        }
        if (event.scope === "state") return await onState(current);
        if (event.scope === "review-inputs") return await onFullMatrix(current);
        if (event.scope === "audit") return await onAudit(event.path, current);
        if (event.scope.startsWith(MATRIX_SCOPE))
          return await onMatrixUnits([event.scope.slice(MATRIX_SCOPE.length)], current);
      });
      queued = task.catch(() => {});
      return task;
    },
  };
}
