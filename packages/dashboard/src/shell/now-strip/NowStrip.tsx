import type {
  ActiveUnit,
  NextGateEstimate,
  RemainingEstimate,
  StageView,
  TimingsPayload,
  UnitWalk,
  WorkflowModel,
} from "@andon/shared-types";
import {
  formatTimingDuration,
  isNextGateOverrun,
  isStageEstimateOverrun,
  nextGateTarget,
} from "@andon/shared-types";
import { Progress } from "@mantine/core";
import { memo, type ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { formatStageLabel } from "@/data/stage-numbers.ts";
import { inVsCodeWebview } from "@/services/vscode-api.ts";
import type { ViewState } from "@/store/state.ts";
import { AreaError, EmptyState, UnparseableBadge } from "@/shared/atoms.tsx";
import { StatusChip } from "@/shared/ui/StatusChip.tsx";
import {
  ceremonyText,
  explainNowFields,
  type FieldExplain,
  projectTypeText,
} from "./now-strip-explain.ts";
import { NowStripSkeleton } from "./NowStripSkeleton.tsx";
import { PreflightWizard } from "./PreflightWizard.tsx";

export interface NowStripProps {
  state: ViewState<WorkflowModel>;
  onRetry: () => void;
  intentPicker?: ReactNode;
  showStartForm?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  remaining?: RemainingEstimate | null;
  estimateCoverage?: TimingsPayload["estimateCoverage"] | null;
  /**
   * The next approval gate, freshness-gated with the roll-up by
   * `store/select-timing.ts`. `null` renders an em dash.
   */
  nextGate?: NextGateEstimate | null;
  /**
   * The current stage's reconciled timing view, already gated on freshness by
   * `store/select-timing.ts` — `null` until `/api/timings` lands, when the
   * workflow has no current stage, or when the payload still describes the
   * stage that was current a moment ago. The strip renders without it and
   * makes no staleness judgement of its own (issue #10).
   */
  current?: StageView | null;
  /**
   * Degradation notes from a `partial` `/api/timings` response (unreadable
   * audit shard, malformed timestamp, an intent skipped during the space
   * sweep) — about the timing data as a whole, not any one stage, so they
   * render here rather than duplicated per StageRail row (finding 2, Codex
   * round 13). Reuses NowStrip's existing workflow-notes pattern below
   * instead of a second one.
   */
  timingsNotes?: string[];
  /**
   * The `/api/timings` Unit walk for the displayed intent. Its open Unit is
   * the state file's cache checked against the Unit receipts, so it wins over
   * `workflow.activeUnit` whenever the record has a walk.
   */
  unitWalk?: UnitWalk | null;
}

function ExplainCard({
  fieldKey,
  label,
  explain,
  children,
  aside,
  size = "metric",
  footer,
}: {
  fieldKey: string;
  label: string;
  explain: FieldExplain;
  children: ReactNode;
  /** Right of the label, e.g. the done percentage. */
  aside?: ReactNode;
  /** `metric` for a short figure; `text` for a sentence-long value. */
  size?: "metric" | "text";
  /** Under the value, e.g. the progress bar. */
  footer?: ReactNode;
}): ReactNode {
  return (
    <HoverCard position="bottom-start" width={320}>
      <HoverCardTrigger
        variant="explain"
        render={
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the trigger injects label + children
          <button type="button" data-testid={`now-field-${fieldKey}`} />
        }
      >
        <span className="flex justify-between gap-2 text-xs font-semibold text-muted-foreground">
          <span>{label}</span>
          {aside}
        </span>
        <span
          className={
            size === "metric" ? "text-base font-bold tabular-nums" : "text-sm font-semibold"
          }
        >
          {children}
        </span>
        {footer}
      </HoverCardTrigger>
      <HoverCardContent className="p-3" data-testid={`now-explain-${fieldKey}`}>
        <div className="flex flex-col gap-2">
          <p className="font-medium text-sm">{label}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">{explain.definition}</p>
          <p className="text-xs leading-relaxed">
            <span className="font-medium">いま: </span>
            {explain.current}
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground leading-relaxed">
            {explain.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * The state file's open Unit. Under unit-major Current Stage stays on the
 * first per-Unit stage, so the Unit's own step is named when it differs.
 */
function activeUnitText(active: ActiveUnit, currentStage: string | null): string {
  const lead = active.state === "paused" ? "一時停止中の Unit" : "作業中の Unit";
  const step =
    active.stage !== null && active.stage !== currentStage
      ? ` · ${formatStageLabel(active.stage)}`
      : "";
  return `${lead}: ${active.unit}${step}`;
}

/**
 * 現在のステージを表示し、解析エラーと時間集計の警告を折り畳み内にまとめる。
 * 状態データが未取得の場合は、独立して取得した時間集計の警告を直接表示する。
 */
function NowStripImpl({
  state,
  onRetry,
  intentPicker,
  current,
  timingsNotes,
  showStartForm = true,
  expanded,
  onExpandedChange,
  remaining,
  estimateCoverage,
  nextGate,
  unitWalk,
}: NowStripProps): ReactNode {
  const workflow = state.kind === "success" || state.kind === "partial" ? state.value : null;
  const activeUnit =
    unitWalk?.activeUnit === undefined ? workflow?.activeUnit : (unitWalk.activeUnit ?? undefined);
  const currentStage = workflow?.stages.find((stage) => stage.slug === workflow.currentStage);
  const status =
    workflow?.unparseable?.gate || currentStage?.unparseable
      ? "unparseable"
      : (workflow?.gate ?? currentStage?.status);
  const notes = [
    ...new Set([...(state.kind === "partial" ? state.notes : []), ...(timingsNotes ?? [])]),
  ];
  const notesList =
    notes.length === 0 ? null : (
      <ul className="mt-3 flex list-none flex-col gap-2 p-0">
        {notes.map((note) => (
          <li key={note}>
            <UnparseableBadge detail={note} />
          </li>
        ))}
      </ul>
    );

  return (
    <section className="px-4 pt-4" aria-labelledby="now-heading">
      <h2 id="now-heading" className="sr-only">
        現在のステージ
      </h2>
      {state.kind === "loading" ? (
        <NowStripSkeleton expanded={expanded} />
      ) : state.kind === "empty" ? (
        // The wizard's "describe what to build" CTA mints a *new* intent — it
        // only belongs on `no-active-intent`. `state-missing` means an intent
        // already exists (spec §9); showing the wizard there would let a user
        // accidentally start a second one, so it falls back to EmptyState.
        showStartForm && inVsCodeWebview() && state.reason === "no-active-intent" ? (
          <PreflightWizard hint={state.hint}>{intentPicker}</PreflightWizard>
        ) : (
          <EmptyState
            hint={state.hint}
            showCreateHint={state.reason === "no-active-intent"}
            title={
              state.reason === "no-selected-intent"
                ? "インテントを選んでください"
                : "ワークフローはまだありません"
            }
          >
            {intentPicker}
          </EmptyState>
        )
      ) : state.kind === "error" ? (
        <AreaError detail={state.detail} onRetry={onRetry} />
      ) : (
        <Accordion
          variant="contained"
          value={expanded === undefined ? undefined : expanded ? ["current"] : []}
          onValueChange={(value) => onExpandedChange?.(value.includes("current"))}
        >
          <AccordionItem value="current">
            <AccordionTrigger data-testid="now-toggle" className="min-w-0 items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0">現在のステージ：</span>
                <span className="truncate font-mono" data-testid="now-current-stage">
                  {state.value.currentStage ??
                    (state.value.total > 0 && state.value.done >= state.value.total
                      ? "ワークフロー完了"
                      : "現在のステージなし")}
                </span>
                {status === undefined ? null : <StatusChip status={status} />}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <NowStripBody
                workflow={state.value}
                current={current ?? null}
                remaining={remaining ?? null}
                estimateCoverage={estimateCoverage ?? null}
                nextGate={nextGate ?? null}
              />
              {notesList}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      {activeUnit === undefined || workflow === null ? null : (
        <p className="mt-2 mb-0 px-0.5 text-xs text-muted-foreground" data-testid="now-active-unit">
          {activeUnitText(activeUnit, workflow.currentStage)}
        </p>
      )}
      {/* Timing reads are independent; keep their warnings visible when no accordion exists. */}
      {workflow === null ? notesList : null}
    </section>
  );
}

/**
 * The work before the next approval gate. An open gate reads as waiting, not
 * as zero work; an overrun is marked only when the overrun current stage is
 * all that is summed, since a later stage's estimate still stands.
 */
function NextGateValue({
  nextGate,
  current,
}: {
  nextGate: NextGateEstimate | null;
  current: StageView | null;
}): ReactNode {
  if (nextGate === null) return "—";
  if (nextGate.kind === "open") return <span className="text-status-gate">承認待ち</span>;
  if (nextGate.kind === "none") return "なし";
  if (nextGate.remainingMs === null) return "—";
  const overrun = current !== null && isNextGateOverrun(nextGate, current);
  return (
    <>
      ≈{formatTimingDuration(nextGate.remainingMs)}
      {overrun ? (
        <span className="whitespace-nowrap text-muted-foreground text-xs"> 見積り超過</span>
      ) : null}
    </>
  );
}

function nextGateNotes(nextGate: NextGateEstimate | null): string[] {
  if (nextGate === null) return [];
  const { known, unknown } = nextGate.estimateCoverage;
  return [
    ...(nextGate.kind === "unit" ? ["Unit が複数あるとこれより早く来ます"] : []),
    ...(nextGate.planApproval ? ["コード生成の前に計画承認があります"] : []),
    ...(unknown > 0 && nextGate.remainingMs !== null
      ? [`推定できた工程のみ（${known}工程、不明${unknown}工程）`]
      : []),
  ];
}

function NowStripBody({
  workflow,
  current,
  remaining,
  estimateCoverage,
  nextGate,
}: {
  workflow: WorkflowModel;
  current: StageView | null;
  remaining: RemainingEstimate | null;
  estimateCoverage: TimingsPayload["estimateCoverage"] | null;
  nextGate: NextGateEstimate | null;
}): ReactNode {
  // One value, read by both the fields below and the hover-card copy, so the
  // two cannot diverge. Which view is current was decided in reader-core
  // (issue #9); whether it is still fresh was decided in the store selector
  // (issue #10). Nothing left to get wrong here.
  const explain = explainNowFields(workflow, current, nextGate);
  const donePercent = workflow.total === 0 ? 0 : Math.round((workflow.done / workflow.total) * 100);
  const target = nextGateTarget(nextGate);
  const gateNotes = nextGateNotes(nextGate);

  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-stretch gap-2.5 @min-[25.5rem]:grid-cols-2 @min-[52.5rem]:grid-cols-4">
        <ExplainCard fieldKey="phase" label="フェーズ" explain={explain.phase}>
          {workflow.phase}
        </ExplainCard>
        <ExplainCard fieldKey="scope" label="スコープ" explain={explain.scope}>
          <span data-testid="now-scope">{workflow.scope}</span>
        </ExplainCard>
        <ExplainCard fieldKey="depth" label="Depth" explain={explain.depth}>
          {workflow.depth}
        </ExplainCard>
        <ExplainCard
          fieldKey="done"
          label="完了"
          explain={explain.done}
          aside={<span className="tabular-nums">{donePercent}%</span>}
          footer={<Progress aria-hidden="true" size="sm" value={donePercent} className="mt-1" />}
        >
          <span data-testid="done-total">
            {workflow.done} / {workflow.total}
          </span>
        </ExplainCard>
        <div className="col-span-full grid">
          <ExplainCard
            fieldKey="change-control"
            label="Guard Policy（記録値）"
            explain={explain.guardPolicy}
            size="text"
          >
            <span data-testid="now-change-control">
              {workflow.unparseable?.guardPolicy
                ? "解析不可"
                : (workflow.guardPolicy?.value ?? "未記録")}
              {workflow.guardPolicy?.source ? `（${workflow.guardPolicy.source}）` : null}
            </span>
          </ExplainCard>
        </div>
        <div className="col-span-full grid grid-cols-1 items-stretch gap-2.5 @min-[25.5rem]:grid-cols-2">
          <ExplainCard
            fieldKey="ceremonies"
            label="進め方の設定（記録値）"
            explain={explain.ceremonies}
            size="text"
          >
            <span data-testid="now-ceremonies">
              {workflow.unparseable?.ceremonies ? "一部解析不可・" : null}
              {ceremonyText(workflow)}
            </span>
          </ExplainCard>
          <ExplainCard
            fieldKey="project-type"
            label="プロジェクト種別"
            explain={explain.projectType}
            size="text"
          >
            <span data-testid="now-project-type">{projectTypeText(workflow)}</span>
          </ExplainCard>
        </div>
        <div className="col-span-full grid grid-cols-1 items-stretch gap-2.5 @min-[25.5rem]:grid-cols-2 @min-[52.5rem]:grid-cols-4">
          <ExplainCard fieldKey="elapsed" label="このステージの作業時間" explain={explain.elapsed}>
            <span data-testid="now-elapsed">{formatTimingDuration(current?.elapsedActiveMs)}</span>
          </ExplainCard>
          <ExplainCard fieldKey="remaining" label="このステージの残り" explain={explain.remaining}>
            <span data-testid="now-remaining">
              {current === null || current.remainingMs === null ? (
                "—"
              ) : (
                <>
                  ≈{formatTimingDuration(current.remainingMs)}
                  <span className="whitespace-nowrap text-muted-foreground text-xs">
                    {isStageEstimateOverrun(current) ? " 見積り超過" : null}
                    {current.status === "not-started" || current.status === "skipped"
                      ? " (参考)"
                      : null}
                  </span>
                </>
              )}
            </span>
          </ExplainCard>
          <div className="flex min-w-0 flex-col gap-1">
            <ExplainCard fieldKey="next-gate" label="次の承認まで" explain={explain.nextGate}>
              <span className="tabular-nums" data-testid="now-next-gate">
                <NextGateValue nextGate={nextGate} current={current} />
              </span>
              {target === null ? null : (
                <span
                  className="block text-muted-foreground text-xs"
                  data-testid="now-next-gate-target"
                >
                  {target}
                </span>
              )}
            </ExplainCard>
            {gateNotes.length === 0 ? null : (
              <p
                className="flex flex-col px-1 text-xs text-muted-foreground"
                data-testid="now-next-gate-notes"
              >
                {gateNotes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-4 py-3 wrap-anywhere">
            <span className="text-xs font-semibold text-muted-foreground">全体の残り時間</span>
            <span className="text-base font-bold tabular-nums" data-testid="now-total-remaining">
              {remaining?.totalRemainingMs == null ? (
                "—"
              ) : (
                <>≈{formatTimingDuration(remaining.totalRemainingMs)}</>
              )}
            </span>
            {(estimateCoverage?.unknown ?? 0) > 0 ? (
              <span className="text-xs text-muted-foreground" data-testid="now-estimate-coverage">
                推定できた工程のみ（{estimateCoverage?.known}工程、不明{estimateCoverage?.unknown}
                工程）
              </span>
            ) : null}
          </div>
        </div>
        {current?.running && current.sinceLastObservationMs != null ? (
          <p
            className="col-span-full text-xs text-muted-foreground"
            data-testid="now-last-observation"
          >
            最終記録から{formatTimingDuration(current.sinceLastObservationMs)}
            {(current.breakdown?.pendingObservationMs ?? 0) > 0 ? "・次の観測待ち" : null}
          </p>
        ) : null}
        {current?.quality?.status === "incomplete" ? (
          <p className="col-span-full text-xs text-muted-foreground">
            時間の記録が不完全です。ステージ詳細で理由を確認できます。
          </p>
        ) : null}
      </div>
    </div>
  );
}

export const NowStrip = memo(NowStripImpl);
