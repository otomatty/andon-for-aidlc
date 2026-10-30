import type { MatrixCell } from "@andon/shared-types";
import type { Selection } from "@/store/state.ts";
import { cellsWithArtifacts } from "@/features/stage/components/StageArtifacts.tsx";

export type ArtifactCells = { cells: MatrixCell[]; initialUnit: string };

/** Decide which matrix cells to surface under the stage explanation. */
export function resolveArtifactCells(
  cells: readonly MatrixCell[],
  selection: NonNullable<Selection>,
  stage: string,
): ArtifactCells | null {
  const withFiles = cellsWithArtifacts(cells, stage);

  if (selection.kind === "cell") {
    const selected = cells.find(
      (each) => each.unit === selection.unit && each.stage === selection.stage,
    );
    if (selected === undefined) {
      const first = withFiles[0];
      return first === undefined ? null : { cells: withFiles, initialUnit: first.unit };
    }
    // Empty cell click keeps the empty viewer; do not jump to a sibling unit.
    if (selected.files.length === 0) {
      return { cells: [selected], initialUnit: selected.unit };
    }
    return { cells: withFiles, initialUnit: selected.unit };
  }

  const first = withFiles[0];
  return first === undefined ? null : { cells: withFiles, initialUnit: first.unit };
}
