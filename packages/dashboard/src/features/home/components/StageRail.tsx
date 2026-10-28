import {
  type ActiveUnit,
  formatTimingDuration,
  type Phase,
  type StageInfo,
  stageViewMatches,
  timingsMatchStage,
  type TimingsPayload,
  type UnitWalk,
  type WorkflowModel,
} from "@aidlc-guide/shared-types";
import { type KeyboardEvent, memo, type ReactNode, useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatStageLabel } from "@/data/stage-numbers.ts";
import type { ViewState } from "@/store/state.ts";
import { AreaError } from "@/shared/atoms.tsx";
import { StageRailSkeleton } from "@/features/home/components/StageRailSkeleton.tsx";
import { type ModelLoadState, StageModelLabel } from "./StageModelLabel.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { type ChipStatus, StatusChip } from "@/shared/ui/StatusChip.tsx";
import { Timeline, TimelineItem } from "@/shared/ui/timeline.tsx";
import { ActiveUnitTag, UnitGroupToggle, UnitProgress, UnitStepRow } from "./StageRailUnits.tsx";

/** The rail's own frame, shared by the loaded and not-yet-loaded wrappers. */
const RAIL = "overflow-hidden rounded-md border bg-card";

const PHASES: readonly Phase[] = [
  "INITIALIZATION",
  "IDEATION",
  "INCEPTION",
  "CONSTRUCTION",
  "OPERATION",
];

/** The phase names as the screens write them. */
const PHASE_LABEL: Record<Phase, string> = {
  INITIALIZATION: "Initialization",
  IDEATION: "Ideation",
  INCEPTION: "Inception",
  CONSTRUCTION: "Construction",
  OPERATION: "Operation",
};

const ITERATION_HINT = {
  "unit-major": "Unit ごとに 3.1〜3.5 を終えてから、次の Unit へ進みます",
  "stage-major": "ステージごとに全 Unit を終えてから、次のステージへ進みます",
} as const;

export interface StageRailProps {
  state: ViewState<WorkflowModel>;
  onSelect: (slug: string) => void;
  onRetry: () => void;
  /** slug → purpose; shown from 48rem up when present. */
  purposes?: Readonly<Record<string, string>>;
  /** When set, marks this slug instead of workflow.currentStage. */
  markedSlug?: string;
  /** `null` until `/api/timings` lands — rows render without durations. */
  timings?: TimingsPayload | null;
  observedModels?: Record<string, string[]>;
  reviewedStages?: readonly string[];
  supportedStages?: readonly string[];
  modelLoadState?: ModelLoadState;
  usageLoadState?: ModelLoadState;
}

type Duration = { text: string; estimated: boolean } | null;

interface Run {
  phase: Phase;
  stages: StageInfo[];
}

function groupStages(stages: readonly StageInfo[]): Run[] {
  const runs: Run[] = [];
  for (const phase of PHASES) {
    const inPhase = stages.filter((stage) => stage.phase === phase);
    if (inPhase.length === 0) continue;
    runs.push({ phase, stages: inPhase });
  }
  return runs;
}

/**
 * ステージを選択する一覧行。状態と推定時間を表示し、解析エラーの詳細は詳細画面に委ねる。
 * キーボード移動に必要なフォーカス登録と操作は、一覧側から受け取る。
 */
function StageRailItem({
  stage,
  purpose,
  isCurrent,
  tabbable,
  duration,
  observed,
  hasReviewer,
  hasSupport,
  modelLoadState,
  usageLoadState,
  onSelect,
  onKeyDown,
  register,
  units,
}: {
  stage: StageInfo;
  /** Unit progress and the open Unit, shown under the stage name. */
  units?: ReactNode;
  purpose: string | undefined;
  isCurrent: boolean;
  tabbable: boolean;
  duration: Duration;
  observed?: string[];
  hasReviewer: boolean;
  hasSupport: boolean;
  modelLoadState?: ModelLoadState;
  usageLoadState?: ModelLoadState;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  register: (element: HTMLButtonElement | null) => void;
}): ReactNode {
  const skipped = stage.execution === "SKIP";
  const status: ChipStatus = stage.unparseable === undefined ? stage.status : "unparseable";
  return (
    <TimelineItem status={status}>
      <button
        type="button"
        ref={register}
        className={cn(
          "flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted",
          "aria-[current=step]:bg-primary-light",
          skipped && "opacity-60",
        )}
        aria-current={isCurrent ? "step" : undefined}
        tabIndex={tabbable ? 0 : -1}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        data-testid={`stage-rail-item-${stage.slug}`}
      >
        <span className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("font-mono", isCurrent ? "font-bold" : "font-semibold")}>
              {formatStageLabel(stage.slug)}
            </span>
            <StageModelLabel
              stage={stage.slug}
              observed={observed}
              hasReviewer={hasReviewer}
              hasSupport={hasSupport}
              loadState={modelLoadState}
              usageLoadState={usageLoadState}
            />
          </span>
          {units}
          {purpose === undefined || purpose === "" ? null : (
            /* Narrow: slug + status only. From 48rem (md) up, show the stage
               purpose. */
            <span
              className="hidden font-sans text-muted-foreground text-xs font-normal leading-snug whitespace-normal md:block"
              data-testid={`stage-rail-purpose-${stage.slug}`}
            >
              {purpose}
            </span>
          )}
        </span>
        <StatusChip status={status} />
        {duration === null ? null : (
          /* Trailing edge of the row, so durations read down as one scannable
             column. Tabular figures keep that column from jittering row to
             row. A skipped row is already dimmed wholesale by the button's
             `opacity-60`; muting the figure on top of that stacks two
             reductions and costs real contrast, so it takes the row's dim
             only. */
          <span
            className={cn(
              "ml-auto text-right text-xs font-normal tabular-nums md:w-26 md:shrink-0",
              !skipped && !isCurrent && "text-muted-foreground",
              isCurrent && "font-semibold",
            )}
            data-testid={`rail-duration-${stage.slug}`}
          >
            {/* Keep forecasts distinct from recorded durations without repeating labels. */}
            {duration.estimated
              ? `≈${duration.text}${stage.status === "not-started" || stage.status === "skipped" ? " (参考)" : ""}`
              : duration.text}
          </span>
        )}
      </button>
    </TimelineItem>
  );
}

/** One focusable control in the rail, in the order focus moves through them. */
type Entry =
  | { kind: "stage"; stage: StageInfo }
  | { kind: "group"; unit: string }
  | { kind: "step"; unit: string; stage: string };

/**
 * How the CONSTRUCTION section lays out Units: `grouped` (unit-major) lists
 * each Unit's steps under it; `progress` (stage-major, or no recorded
 * iteration) keeps the stage rows and lays the Units across them. `null` when
 * there is no Unit walk to show yet, so the rail stays as it was.
 */
function unitLayout(workflow: WorkflowModel, walk: UnitWalk | null): "grouped" | "progress" | null {
  if (walk === null || walk.units.length === 0 || walk.stages.length === 0) return null;
  return workflow.constructionPolicy?.unitMajor === true ? "grouped" : "progress";
}

/**
 * The Unit to open under unit-major: the open Unit, else the first Unit that
 * has started and not finished, else the first not started. `null` once every
 * Unit is done, when only the stages' own approvals are left.
 */
function focusUnitOf(active: ActiveUnit | undefined, walk: UnitWalk): string | null {
  if (active !== undefined && walk.units.some((unit) => unit.unit === active.unit))
    return active.unit;
  return (
    walk.units.find((unit) => unit.status === "in-progress")?.unit ??
    walk.units.find((unit) => unit.status === "not-started")?.unit ??
    null
  );
}

function StageRailImpl({
  state,
  onSelect,
  onRetry,
  purposes,
  markedSlug,
  timings,
  observedModels,
  reviewedStages,
  supportedStages,
  modelLoadState,
  usageLoadState,
}: StageRailProps): ReactNode {
  const [focused, setFocused] = useState(0);
  /** Units the person opened or closed; the rest follow {@link focusUnitOf}. */
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  /** Phases the person opened or closed; the rest follow {@link phaseOpenByDefault}. */
  const [phaseToggled, setPhaseToggled] = useState<Readonly<Partial<Record<Phase, boolean>>>>({});
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  const move = useCallback((from: number, delta: number, count: number) => {
    const next = Math.min(Math.max(from + delta, 0), count - 1);
    setFocused(next);
    items.current[next]?.focus();
  }, []);

  // One wrapper; only the body varies per view state.
  if (state.kind !== "success" && state.kind !== "partial") {
    return (
      <nav className={RAIL} aria-label="ステージ一覧">
        {state.kind === "loading" ? (
          <StageRailSkeleton />
        ) : state.kind === "error" ? (
          <AreaError detail={state.detail} onRetry={onRetry} />
        ) : (
          <p className="text-sm text-muted-foreground">{state.hint}</p>
        )}
      </nav>
    );
  }

  const workflow = state.value;
  const runs = groupStages(workflow.stages);
  // Behind the same stage gate as the Now strip: a payload from a stage the
  // workflow has left would group and mark Units by that older snapshot.
  const walk = timingsMatchStage(workflow.currentStage, timings ?? null)
    ? (timings?.unitWalk ?? null)
    : null;
  const layout = unitLayout(workflow, walk);
  const unitStages = new Set(layout === null ? [] : (walk?.stages ?? []));
  const progressByStage = new Map(
    layout === "progress" ? (walk?.byStage ?? []).map((row) => [row.stage, row]) : [],
  );
  // Drawn with a walk, the open Unit comes from that walk: a newer workflow
  // read may already name the next Unit while the walk still shows this one.
  const active =
    layout !== null && walk?.activeUnit !== undefined
      ? (walk.activeUnit ?? undefined)
      : workflow.activeUnit;
  const focusUnit = layout === "grouped" && walk !== null ? focusUnitOf(active, walk) : null;
  const isOpen = (unit: string): boolean => toggled[unit] ?? unit === focusUnit;
  // Under unit-major Current Stage stays on the first per-Unit stage; the
  // open Unit's own stage is where the work is.
  const highlighted =
    markedSlug ??
    (layout === "grouped" && active?.unit === focusUnit ? active?.stage : null) ??
    workflow.currentStage;

  /**
   * unit-major CONSTRUCTION below the Unit groups: once every Unit is done,
   * the per-Unit stages' own approvals still open (`gates`); then the stages
   * that run once over the whole solution (`once`).
   */
  const belowUnits = (stages: readonly StageInfo[]) => ({
    gates:
      focusUnit === null
        ? stages.filter(
            (stage) =>
              unitStages.has(stage.slug) &&
              stage.status !== "completed" &&
              stage.status !== "skipped",
          )
        : [],
    once: stages.filter((stage) => !unitStages.has(stage.slug)),
  });

  const entriesOf = (stages: readonly StageInfo[], phase: Phase): Entry[] => {
    if (layout !== "grouped" || phase !== "CONSTRUCTION" || walk === null)
      return stages.map((stage) => ({ kind: "stage", stage }));
    const groups = walk.units.flatMap((unit): Entry[] => [
      { kind: "group", unit: unit.unit },
      ...(isOpen(unit.unit)
        ? unit.steps.map((step): Entry => ({ kind: "step", unit: unit.unit, stage: step.stage }))
        : []),
    ]);
    const { gates, once } = belowUnits(stages);
    return [...groups, ...[...gates, ...once].map((stage): Entry => ({ kind: "stage", stage }))];
  };
  // With no current stage, the first stage that runs stands in for it — the
  // same row the guided tour points at (onboarding/tour/steps.ts).
  const shownSlug =
    highlighted ??
    workflow.stages.find((stage) => stage.execution === "EXECUTE")?.slug ??
    workflow.stages[0]?.slug;
  /**
   * A phase starts open while it has work left or holds the marked stage;
   * a phase that is all done or skipped starts closed to its summary.
   */
  const phaseOpenByDefault = (run: Run): boolean =>
    run.stages.some(
      (stage) =>
        stage.slug === shownSlug ||
        (stage.status !== "completed" && stage.status !== "skipped") ||
        stage.unparseable !== undefined,
    ) ||
    (run.phase === "CONSTRUCTION" && focusUnit !== null);
  const sections = runs.map((run) => {
    const open = phaseToggled[run.phase] ?? phaseOpenByDefault(run);
    return {
      phase: run.phase,
      stages: run.stages,
      open,
      entries: open ? entriesOf(run.stages, run.phase) : [],
    };
  });
  const count = sections.reduce((sum, section) => sum + section.entries.length, 0);
  items.current.length = count;

  // The rail used to reconcile `status` against the raw run list itself —
  // re-deriving "is a run open", "is this closed run still the current
  // attempt", and "which estimate belongs to the current stage" from three
  // different fields, with three chances to disagree with `estimate.ts`
  // (Codex round 9 finding 3 was exactly that disagreement). Those rules now
  // live once, in reader-core's `resolveStageViews`, and this is a lookup.
  const viewByStage = new Map((timings?.stageViews ?? []).map((view) => [view.stage, view]));

  /**
   * Finished attempts show work inferred from their logs; other rows show
   * the full estimated duration. Both are estimates, with different inputs.
   *
   * The measurement is gated on the view still describing the row in front of
   * us — see `stageViewMatches`. Nothing is re-derived here: this is the same
   * two-fetch freshness question NowStrip and Header already ask, asked per
   * row because that is the granularity a stage row renders at.
   */
  function durationOf(stage: StageInfo): Duration {
    const view = viewByStage.get(stage.slug);
    if (view === undefined) return null;
    if (view.actualActiveMs !== null && stageViewMatches(stage, view))
      return {
        text: formatTimingDuration(view.actualActiveMs),
        estimated: false,
      };
    if (view.estimateMs === null) return null;
    return {
      text: formatTimingDuration(view.estimateMs),
      estimated: true,
    };
  }

  const keyHandler =
    (index: number) =>
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        move(index, 1, count);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        move(index, -1, count);
      } else if (event.key === "Home") {
        event.preventDefault();
        move(0, 0, count);
      } else if (event.key === "End") {
        event.preventDefault();
        move(count - 1, 0, count);
      }
    };

  const roving = (index: number) => ({
    tabbable: index === Math.min(focused, count - 1),
    onKeyDown: keyHandler(index),
    register: (element: HTMLButtonElement | null) => {
      items.current[index] = element;
    },
  });

  // Shown only when the state file records a choice: an absent line means the
  // workflow never picked one (no Units, or a record older than the setting).
  const policy = workflow.constructionPolicy;
  const iteration =
    policy?.iterationRecorded === true ? (policy.unitMajor ? "unit-major" : "stage-major") : null;

  const stageRow = (stage: StageInfo, index: number): ReactNode => {
    const progress = stage.execution === "EXECUTE" ? progressByStage.get(stage.slug) : undefined;
    const working = active?.stage === stage.slug ? active : undefined;
    const unitInfo =
      progress === undefined && working === undefined ? undefined : (
        <>
          {progress === undefined || walk === null ? null : (
            <UnitProgress slug={stage.slug} units={walk.units} progress={progress} />
          )}
          {working === undefined ? null : <ActiveUnitTag active={working} />}
        </>
      );
    return (
      <StageRailItem
        observed={observedModels?.[stage.slug]}
        hasReviewer={reviewedStages?.includes(stage.slug) ?? false}
        hasSupport={supportedStages?.includes(stage.slug) ?? false}
        modelLoadState={modelLoadState}
        usageLoadState={usageLoadState}
        key={stage.slug}
        stage={stage}
        units={unitInfo}
        purpose={purposes?.[stage.slug]}
        isCurrent={stage.slug === highlighted}
        tabbable={index === Math.min(focused, count - 1)}
        duration={durationOf(stage)}
        onSelect={() => {
          setFocused(index);
          onSelect(stage.slug);
        }}
        onKeyDown={keyHandler(index)}
        register={(element) => {
          items.current[index] = element;
        }}
      />
    );
  };

  let cursor = 0;
  const take = (): number => {
    const index = cursor;
    cursor += 1;
    return index;
  };

  /** A divider naming the rows below it. */
  const divider = (label: string): ReactNode => (
    <div className="my-3 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );

  /** unit-major CONSTRUCTION: each Unit with its steps, open approvals, then the stages run once. */
  const groupedBody = (stages: readonly StageInfo[]): ReactNode => {
    if (walk === null) return null;
    const { gates, once } = belowUnits(stages);
    return (
      <>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {walk.units.map((unit) => {
            const open = isOpen(unit.unit);
            const groupIndex = take();
            const working =
              active !== undefined && active.unit === unit.unit && active.stage !== null
                ? { stage: active.stage, paused: active.state === "paused" }
                : null;
            return (
              <li
                key={unit.unit}
                className={cn(
                  "flex flex-col overflow-hidden rounded-md border",
                  open && "border-primary",
                )}
              >
                <Collapsible
                  open={open}
                  onOpenChange={(next) => {
                    setFocused(groupIndex);
                    setToggled((prev) => ({ ...prev, [unit.unit]: next }));
                  }}
                >
                  <UnitGroupToggle
                    {...roving(groupIndex)}
                    unit={unit}
                    open={open}
                    working={working}
                  />
                  <CollapsibleContent>
                    {open ? (
                      <Timeline className="mx-4 my-3">
                        {unit.steps.map((step) => {
                          const index = take();
                          return (
                            <UnitStepRow
                              key={step.stage}
                              {...roving(index)}
                              unit={unit.unit}
                              step={step}
                              isCurrent={unit.unit === focusUnit && step.stage === highlighted}
                              onSelect={() => {
                                setFocused(index);
                                onSelect(step.stage);
                              }}
                            />
                          );
                        })}
                      </Timeline>
                    ) : null}
                  </CollapsibleContent>
                </Collapsible>
              </li>
            );
          })}
        </ul>
        {gates.length === 0 ? null : (
          <>
            {divider("ステージごとの承認")}
            <Timeline>{gates.map((stage) => stageRow(stage, take()))}</Timeline>
          </>
        )}
        {once.length === 0 ? null : (
          <>
            {divider("全 Unit の完了後に 1 回")}
            <Timeline>{once.map((stage) => stageRow(stage, take()))}</Timeline>
          </>
        )}
      </>
    );
  };

  return (
    <nav className={RAIL} aria-label="ステージ一覧">
      <Accordion
        variant="rail"
        multiple
        order={3}
        value={sections.filter((section) => section.open).map((section) => section.phase)}
        onValueChange={(open) =>
          setPhaseToggled((prev) => {
            const next = { ...prev };
            for (const section of sections)
              if (open.includes(section.phase) !== section.open)
                next[section.phase] = !section.open;
            return next;
          })
        }
      >
        {sections.map((section) => (
          <AccordionItem
            key={section.phase}
            value={section.phase}
            role="region"
            aria-label={section.phase}
          >
            <AccordionTrigger data-testid={`stage-rail-phase-${section.phase}`}>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="font-semibold">{PHASE_LABEL[section.phase]}</span>
                <PhaseSummary stages={section.stages} />
                {section.phase === "CONSTRUCTION" && iteration !== null ? (
                  <>
                    <Badge variant="info" data-testid="construction-iteration">
                      進め方: {iteration}
                    </Badge>
                    <span className="text-xs font-normal text-muted-foreground">
                      {ITERATION_HINT[iteration]}
                    </span>
                  </>
                ) : null}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {/* Only an open phase's rows hold a place in the roving focus order. */}
              {!section.open ? null : layout === "grouped" && section.phase === "CONSTRUCTION" ? (
                groupedBody(section.stages)
              ) : (
                <Timeline>
                  {section.entries.map((entry) =>
                    entry.kind === "stage" ? stageRow(entry.stage, take()) : null,
                  )}
                </Timeline>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </nav>
  );
}

/**
 * The phase's state in one badge: done of the stages it runs, or all skipped.
 * The closed phase still says how far it got. A run stage that was skipped
 * counts as done, as in the state file's own tally (reader-core state.ts).
 */
function PhaseSummary({ stages }: { stages: readonly StageInfo[] }): ReactNode {
  const skipped = stages.filter((stage) => stage.execution === "SKIP").length;
  const run = stages.length - skipped;
  if (run === 0) return <Badge variant="secondary">⊘ スキップ {skipped}</Badge>;
  const done = stages.filter(
    (stage) =>
      stage.execution === "EXECUTE" && (stage.status === "completed" || stage.status === "skipped"),
  ).length;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant={done === run ? "success" : "secondary"}>
        完了 {done} / {run}
      </Badge>
      {skipped === 0 ? null : (
        <span className="text-xs font-normal text-muted-foreground">スキップ {skipped}</span>
      )}
    </span>
  );
}

export const StageRail = memo(StageRailImpl);
