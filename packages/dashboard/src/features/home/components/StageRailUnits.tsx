import type {
  ActiveUnit,
  UnitStageProgress,
  UnitStep,
  UnitWalkUnit,
} from "@aidlc-guide/shared-types";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatStageLabel } from "@/data/stage-numbers.ts";
import { STATUS_PRESENTATION, StatusChip } from "@/shared/ui/StatusChip.tsx";
import { TimelineItem } from "@/shared/ui/timeline.tsx";

/**
 * The stage rail's Unit pieces. Stage-major keeps one row per stage and lays
 * each Unit's status across it ({@link UnitProgress}); unit-major lists the
 * per-Unit stages under each Unit ({@link UnitGroupToggle} / {@link UnitStepRow}),
 * because that is the order the engine walks them in.
 */

/** Shared with the stage rows: roving focus is owned by the rail. */
export interface RovingProps {
  tabbable: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  register: (element: HTMLButtonElement | null) => void;
}

const STEP_ROW =
  "flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted aria-[current=step]:bg-primary-light";

/**
 * One cell per Unit, in walk order, then the count. Colour, symbol and the
 * written count carry it together (BR-UI-2); each cell names its Unit on hover,
 * and the same statuses are written out once for assistive technology.
 */
export function UnitProgress({
  slug,
  units,
  progress,
}: {
  slug: string;
  units: readonly UnitWalkUnit[];
  progress: UnitStageProgress;
}): ReactNode {
  return (
    <span
      className="flex flex-wrap items-center gap-1 text-xs font-normal text-muted-foreground"
      data-testid={`unit-progress-${slug}`}
    >
      {units.map((unit) => {
        const status = unit.steps.find((step) => step.stage === slug)?.status ?? "not-started";
        const { token, symbol, label } = STATUS_PRESENTATION[status];
        return (
          <span
            key={unit.unit}
            className="unit-cell"
            style={{ "--chip-color": `var(${token})` } as CSSProperties}
            title={`${unit.unit}: ${label}`}
            aria-hidden="true"
            data-testid={`unit-cell-${unit.unit}`}
          >
            {symbol}
          </span>
        );
      })}
      <span className="sr-only" data-testid="unit-statuses">
        {units
          .map((unit) => {
            const status = unit.steps.find((step) => step.stage === slug)?.status ?? "not-started";
            return `${unit.unit}: ${STATUS_PRESENTATION[status].label}`;
          })
          .join("、")}
      </span>
      <span className="ml-1">
        {progress.completed} / {progress.total} Unit 完了
        {progress.skipped > 0 ? ` · ${progress.skipped} 対象外` : ""}
      </span>
    </span>
  );
}

/** The state file's open Unit, on the row of the stage it is working on. */
export function ActiveUnitTag({ active }: { active: ActiveUnit }): ReactNode {
  return (
    <span
      className="self-start rounded-sm bg-muted px-2 text-xs font-semibold"
      data-testid="active-unit"
    >
      Unit {active.unit} を{active.state === "paused" ? "一時停止中" : "作業中"}
    </span>
  );
}

function Chevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      className="shrink-0 text-muted-foreground"
    >
      <path d={open ? "M4 6l4 4 4-4" : "M6 4l4 4-4 4"} />
    </svg>
  );
}

/** A Unit's heading under unit-major: opens and closes its steps. */
export function UnitGroupToggle({
  unit,
  open,
  working,
  onToggle,
  ...roving
}: RovingProps & {
  unit: UnitWalkUnit;
  open: boolean;
  /** The step this Unit is on, when it is the state file's open Unit. */
  working: { stage: string; paused: boolean } | null;
  onToggle: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      ref={roving.register}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-muted",
        open && "bg-primary-light",
      )}
      aria-expanded={open}
      tabIndex={roving.tabbable ? 0 : -1}
      onClick={onToggle}
      onKeyDown={roving.onKeyDown}
      data-testid={`unit-group-${unit.unit}`}
    >
      <Chevron open={open} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>
          Unit{" "}
          <span className={cn("font-mono", open ? "font-bold" : "font-medium")}>{unit.unit}</span>
        </span>
        {working === null ? null : (
          <span className="text-xs font-normal text-muted-foreground">
            {formatStageLabel(working.stage)} を{working.paused ? "一時停止中" : "作業中"}
          </span>
        )}
      </span>
      <StatusChip status={unit.status} />
    </button>
  );
}

/** One Unit's step on one per-Unit stage; selecting it opens that stage. */
export function UnitStepRow({
  unit,
  step,
  isCurrent,
  onSelect,
  ...roving
}: RovingProps & {
  unit: string;
  step: UnitStep;
  isCurrent: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <TimelineItem status={step.status}>
      <button
        type="button"
        ref={roving.register}
        className={cn(STEP_ROW, step.status === "skipped" && "opacity-60")}
        aria-current={isCurrent ? "step" : undefined}
        tabIndex={roving.tabbable ? 0 : -1}
        onClick={onSelect}
        onKeyDown={roving.onKeyDown}
        data-testid={`unit-step-${unit}-${step.stage}`}
      >
        <span className={cn("flex-1 font-mono", isCurrent ? "font-bold" : "font-semibold")}>
          {formatStageLabel(step.stage)}
        </span>
        <StatusChip status={step.status} />
      </button>
    </TimelineItem>
  );
}
