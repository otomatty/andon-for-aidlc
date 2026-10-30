import { LoadingSuspense } from "@/shared/loading/LoadingSequence.tsx";
import type { MatrixCell } from "@andon/shared-types";
import { lazy, type ReactNode, useRef } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { prefetchArtifact } from "@/services/api.ts";
import { artifactPath, firstArtifact } from "@/viewer/artifact-path.ts";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";

const ArtifactViewer = lazy(async () => await import("@/viewer/index.tsx"));

/** Cells of `stage` that already hold at least one `*.md` artifact. */
export function cellsWithArtifacts(cells: readonly MatrixCell[], stage: string): MatrixCell[] {
  return cells.filter((cell) => cell.stage === stage && cell.files.length > 0);
}

export interface StageArtifactsProps {
  stage: string;
  cells: readonly MatrixCell[];
  unit: string;
  onUnitChange: (unit: string) => void;
}

/**
 * Stage-scoped artifact strip: one unit auto-opens; several units get a tab
 * switcher. File switching lives inside ArtifactViewer.
 */
export function StageArtifacts({
  stage,
  cells,
  unit,
  onUnitChange,
}: StageArtifactsProps): ReactNode {
  const warmed = useRef<string | null>(null);

  const cell = cells.find((each) => each.unit === unit) ?? cells[0];
  const openFirst = cell === undefined ? null : firstArtifact(cell.files);
  const target =
    cell === undefined || openFirst === null ? null : artifactPath(cell.unit, stage, openFirst);
  if (warmed.current !== target) {
    warmed.current = target;
    if (target !== null) prefetchArtifact(target);
  }

  if (cell === undefined) return null;

  return (
    <div className="mt-5 border-t pt-4" data-testid="stage-artifacts">
      {cells.length > 1 ? (
        <Tabs
          variant="segmented"
          value={unit}
          onValueChange={(value) => {
            if (typeof value === "string") onUnitChange(value);
          }}
          className="mb-3"
        >
          <TabsList aria-label="ユニット" data-testid="unit-tabs">
            {cells.map((each) => (
              <TabsTrigger key={each.unit} value={each.unit}>
                {each.unit}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <LoadingSuspense fallback={<DocumentSkeleton label="成果物" />}>
        <ArtifactViewer unit={cell.unit} stage={stage} files={cell.files} verdict={cell.verdict} />
      </LoadingSuspense>
    </div>
  );
}
