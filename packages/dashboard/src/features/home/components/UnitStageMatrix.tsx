import type { Matrix, MatrixCell } from "@aidlc-guide/shared-types";
import { memo, type ReactNode, useMemo } from "react";
import { formatStageLabel } from "@/data/stage-numbers.ts";
import { type ViewState, viewValue } from "@/store/state.ts";
import { AreaError } from "@/shared/atoms.tsx";
import { MatrixSkeleton } from "@/features/home/components/MatrixSkeleton.tsx";
import { StatusLegend } from "./StatusLegend.tsx";

/**
 * US-05 / FR-4.3. The reader returns only the cells that exist, so the UI
 * draws the units × stages product and treats a **missing** intersection as
 * out-of-scope (—) and a present one with `files.length === 0` as empty (·).
 * Conflating the two would tell the user a stage was skipped when in fact
 * nothing has been produced yet.
 */

export interface UnitStageMatrixProps {
  state: ViewState<Matrix>;
  onSelectCell: (unit: string, stage: string) => void;
  onRetry: () => void;
}

function indexCells(cells: readonly MatrixCell[]): Map<string, MatrixCell> {
  // NUL separator: unit/stage names may themselves contain hyphens.
  return new Map(cells.map((cell) => [`${cell.unit}\0${cell.stage}`, cell]));
}

function Cell({
  cell,
  unit,
  stage,
  onSelect,
}: {
  cell: MatrixCell | undefined;
  unit: string;
  stage: string;
  onSelect: () => void;
}): ReactNode {
  const testId = `matrix-cell-${unit}-${stage}`;

  if (cell === undefined) {
    return (
      <td className="cell cell--absent" data-testid={testId} data-kind="out-of-scope">
        <span aria-hidden="true">—</span>
        <span className="sr-only">対象外</span>
      </td>
    );
  }

  // The server sends the filenames; the count is their length and is never
  // stored twice (BR-UI-3 — the client displays, it does not tally).
  const count = cell.files.length;
  const kind = cell.error !== undefined ? "error" : count === 0 ? "empty" : "filled";
  return (
    <td className="cell" data-testid={testId} data-kind={kind}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 py-1"
        onClick={onSelect}
      >
        {cell.error !== undefined ? (
          <span className="cell__error" role="status">
            <span aria-hidden="true">⚠</span> 解析不可（{cell.error}）
          </span>
        ) : count === 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="sr-only">空（成果物 0 件）</span>
          </>
        ) : (
          <span className="cell__count">{count} 件</span>
        )}
        {cell.verdict === null ? null : (
          <span className="cell__verdict" data-verdict={cell.verdict}>
            {cell.verdict}
          </span>
        )}
      </button>
    </td>
  );
}

/** Row-level memo: a `matrix:<unit>` push repaints one row, not the table. */
const Row = memo(function Row({
  unit,
  stages,
  index,
  onSelectCell,
}: {
  unit: string;
  stages: readonly string[];
  index: Map<string, MatrixCell>;
  onSelectCell: (unit: string, stage: string) => void;
}): ReactNode {
  return (
    <tr>
      <th scope="row" className="matrix__unit">
        {unit}
      </th>
      {stages.map((stage) => (
        <Cell
          key={stage}
          cell={index.get(`${unit}\0${stage}`)}
          unit={unit}
          stage={stage}
          onSelect={() => {
            onSelectCell(unit, stage);
          }}
        />
      ))}
    </tr>
  );
});

function UnitStageMatrixImpl({ state, onSelectCell, onRetry }: UnitStageMatrixProps): ReactNode {
  const matrix = viewValue(state);
  // Stable identity is what makes the row memo above actually memo.
  const index = useMemo(() => indexCells(matrix?.cells ?? []), [matrix]);

  // One wrapper, one heading; only the body varies per view state.
  const body =
    state.kind === "loading" ? (
      <MatrixSkeleton />
    ) : state.kind === "error" ? (
      <AreaError detail={state.detail} onRetry={onRetry} />
    ) : state.kind === "empty" ? (
      <p>{state.hint}</p>
    ) : matrix === null ? null : (
      /* Wide content scrolls inside its own box; the page never scrolls
         sideways (a11y checklist 1.4.10). `relative` makes this box the
         containing block for the cells' `sr-only` spans — without it they
         resolve against the viewport, so a wide table parks them past the
         right edge and the *page*, not this box, grows the scrollbar. */
      <div className="relative overflow-x-auto rounded-md border bg-card">
        <table className="matrix__table">
          <caption className="sr-only">ユニット × ステージの成果物件数</caption>
          <thead>
            <tr>
              <th scope="col">unit</th>
              {matrix.stages.map((stage) => (
                <th scope="col" key={stage}>
                  {formatStageLabel(stage)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.units.map((unit) => (
              <Row
                key={unit}
                unit={unit}
                stages={matrix.stages}
                index={index}
                onSelectCell={onSelectCell}
              />
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <section className="matrix" aria-labelledby="matrix-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="matrix-heading" className="m-0 text-section-title font-bold">
          成果物マトリクス
        </h2>
        {matrix === null ? null : <StatusLegend />}
      </div>
      {body}
    </section>
  );
}

export const UnitStageMatrix = memo(UnitStageMatrixImpl);
export default UnitStageMatrix;
