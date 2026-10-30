import {
  currentStageView,
  formatTimingDuration,
  isNextGateOverrun,
  isStageEstimateOverrun,
  type NextGateEstimate,
  nextGateTarget,
  type StageView,
} from "@aidlc-guide/shared-types";
import { type ExtensionContext, StatusBarAlignment, type StatusBarItem, window } from "vscode";
import {
  acquireSession,
  type GuideSession,
  persistSelectedIntent,
  type SelectedIntentPersist,
} from "./guide-session.ts";
import { resolveOfficialDocsRoot } from "./official-docs-root.ts";

let item: StatusBarItem | undefined;

/**
 * Monotonic refresh id: event-driven and interval refreshes overlap, and an
 * older refresh resolving last must not overwrite a newer one's text with a
 * stale (though internally consistent) workflow/timings pair. Only the latest
 * refresh may touch the item.
 */
let refreshSeq = 0;

function approxDuration(ms: number | null): string {
  return ms === null ? "—" : `≈${formatTimingDuration(ms)}`;
}

/**
 * The compact half of the text: where the human is needed next. A payload
 * without a next gate keeps the stage remainder this used to show.
 */
function nextGateStatus(
  nextGate: NextGateEstimate | undefined,
  current: StageView,
  remaining: string,
): string {
  if (nextGate === undefined)
    return isStageEstimateOverrun(current) ? "見積り超過" : `残り ${remaining}`;
  if (nextGate.kind === "open") return "承認待ち";
  if (nextGate.kind === "none") return "承認ゲートなし";
  if (isNextGateOverrun(nextGate, current)) return "見積り超過";
  return `次の承認まで ${approxDuration(nextGate.remainingMs)}`;
}

/** Tooltip lines naming the next gate and what the number before it covers. */
function nextGateDetails(nextGate: NextGateEstimate, current: StageView): string[] {
  if (nextGate.kind === "open") return [`次の承認: ${nextGateTarget(nextGate)}（承認待ち）`];
  const lines =
    nextGate.kind === "none"
      ? [
          "次の承認: なし",
          ...(nextGate.remainingMs === 0
            ? []
            : [`完了までの作業: ${approxDuration(nextGate.remainingMs)}`]),
        ]
      : [
          `次の承認: ${nextGateTarget(nextGate)}`,
          `次の承認までの作業: ${approxDuration(nextGate.remainingMs)}${
            isNextGateOverrun(nextGate, current) ? "（見積り超過・未完了）" : ""
          }${nextGate.kind === "unit" ? "（Unit が複数あると早まります）" : ""}`,
        ];
  if (nextGate.autoApproved.length > 0) {
    lines.push(`承認なしで進むステージ: ${nextGate.autoApproved.join("、")}`);
  }
  if (nextGate.planApproval) lines.push("コード生成の前に計画承認があります");
  const { unknown } = nextGate.estimateCoverage;
  if (unknown > 0 && nextGate.remainingMs !== null) {
    lines.push(`推定できない ${unknown} 工程を含みません`);
  }
  return lines;
}

export function createStatusBar(context: ExtensionContext): StatusBarItem {
  item = window.createStatusBarItem(StatusBarAlignment.Left, 100);
  item.command = "aidlc-guide.open";
  item.text = "$(list-tree) Andon";
  item.tooltip = "Andon: Open";
  context.subscriptions.push(item);
  item.show();
  return item;
}

export async function refreshStatusBar(
  workspaceRoot: string,
  officialDocsRoot: string = workspaceRoot,
  persist?: SelectedIntentPersist,
): Promise<void> {
  if (item === undefined) return;
  const lease = acquireSession(workspaceRoot, officialDocsRoot, persist);
  try {
    await refreshSessionStatus(lease.session);
  } finally {
    lease.dispose();
  }
}

async function refreshSessionStatus(session: GuideSession): Promise<void> {
  if (item === undefined) return;
  const seq = ++refreshSeq;
  const stale = (): boolean => seq !== refreshSeq;
  // The status bar reads the reader directly, so it applies the version check itself.
  const gate = session.service.versionGate();
  if (gate !== null && gate.status !== "ok") {
    item.text = "$(warning) Andon: 更新が必要";
    item.tooltip = `Andon — ${gate.message}`;
    return;
  }
  try {
    const state = await session.service.reader.getWorkflow();
    if (stale()) return;
    if (!("ok" in state) || state.value.currentStage === null) {
      item.text = "$(list-tree) Andon";
      item.tooltip = "Andon: Open";
      return;
    }

    const stage = state.value.currentStage;
    // Stage-only label first, so a timing failure below has something
    // already-correct to fall back on instead of the bare default.
    item.text = `$(list-tree) ${stage}`;
    item.tooltip = `Andon — ${state.value.phase} / ${stage}`;

    // Timing is best-effort decoration: a failure here must not blank the
    // stage name set above — this inner try means it doesn't.
    try {
      const timings = await session.service.reader.getTimings();
      if (stale()) return;
      // Which view is the current stage, and whether its runs describe the
      // attempt in play, was decided once in reader-core (issue #9) — this
      // surface reads the answer rather than re-deriving it. `currentStageView`
      // also applies the shared staleness gate (the payload's own
      // `currentStage` snapshot vs. the state read above), so two independent
      // reads can never put another stage's numbers next to this stage's name.
      const payload = "ok" in timings ? timings.value : null;
      const record = state.value.record;
      if (!record || !payload || payload.space !== record.space || payload.intent !== record.intent)
        return;
      const current = currentStageView(stage, payload);
      // Past this check the payload is fresh, so its next gate is too: it was
      // walked from the same current stage.
      if (current === null || payload === null) return;

      const elapsed = formatTimingDuration(current.elapsedActiveMs);
      const remaining = approxDuration(current.remainingMs);
      const overrun = isStageEstimateOverrun(current);
      item.text = `$(list-tree) ${stage} · 作業時間 ${elapsed} / ${nextGateStatus(payload.nextGate, current, remaining)}`;
      const details = [
        `Andon — ${state.value.phase} / ${stage}`,
        `作業時間: ${elapsed}`,
        `残り時間: ${remaining}${overrun ? "（見積り超過・未完了）" : ""}${current.remainingMs !== null && (current.status === "not-started" || current.status === "skipped") ? " (参考)" : ""}`,
        ...(payload.nextGate === undefined ? [] : nextGateDetails(payload.nextGate, current)),
      ];
      if (current.running && current.sinceLastObservationMs != null) {
        details.push(
          `最終記録から: ${formatTimingDuration(current.sinceLastObservationMs)}（作業へ未加算）`,
        );
      }
      if (current.quality?.status === "incomplete") {
        details.push(
          current.elapsedActiveMs === null
            ? "記録が不完全なため作業時間は不明です。ステージ詳細で理由を確認できます。"
            : "記録が不完全なため判明分だけを表示しています。所要時間の実績には使いません。",
        );
      }
      item.tooltip = details.join("\n");
    } catch {
      // Stage-only label above already stands.
    }
  } catch {
    if (stale()) return;
    item.text = "$(list-tree) Andon";
  }
}

export function startStatusBarRefresh(
  context: ExtensionContext,
  workspaceRoot: string,
  intervalMs = 30_000,
): { dispose(): void } {
  const officialDocsRoot = resolveOfficialDocsRoot(context.extensionPath, workspaceRoot);
  const persist = persistSelectedIntent(context);
  const lease = acquireSession(workspaceRoot, officialDocsRoot, persist);
  const { session } = lease;
  let disposed = false;
  const refresh = () => {
    if (!disposed) void refreshSessionStatus(session);
  };
  refresh();

  // Change-driven refresh via the session's existing watch→hub channel, so the
  // status bar reflects a stage change within the ≤2s budget (NFR-3) instead
  // of waiting out the poll. The interval below stays as the elapsed-time tick
  // (time since the last observation advances) and as a fallback.
  const pushClient = {
    send: refresh,
  };
  session.service.hub.add(pushClient);

  const handle = setInterval(refresh, intervalMs);
  const disposable = {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      refreshSeq++;
      clearInterval(handle);
      session.service.hub.remove(pushClient);
      lease.dispose();
      if (item) {
        item.text = "$(list-tree) Andon";
        item.tooltip = "Andon: Open";
      }
    },
  };
  context.subscriptions.push(disposable);
  return disposable;
}
