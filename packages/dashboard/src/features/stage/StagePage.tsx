import { LoadingSuspense } from "@/shared/loading/LoadingSequence.tsx";
import { stageViewMatches } from "@andon/shared-types";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { lazy, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { formatStageLabel } from "@/data/stage-numbers.ts";
import { useFetchView } from "@/hooks/useFetchView.ts";
import { fetchIoPaths } from "@/services/api.ts";
import { routeSelection } from "@/app/routes.ts";
import { slugOf } from "@/services/docs.ts";
import { inVsCodeWebview } from "@/services/vscode-api.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { timingsForDisplayedIntent } from "@/store/select-timing.ts";
import { viewValue } from "@/store/state.ts";
import { AreaError, UnparseableBadge } from "@/shared/atoms.tsx";
import { OnboardingTip } from "@/features/onboarding/components/OnboardingTip.tsx";
import { IoArtifactPreview } from "@/features/stage/components/IoArtifactPreview.tsx";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { StageDetailSkeleton } from "@/features/stage/components/StageDetailSkeleton.tsx";
import { PanelBody, PanelShell } from "@/shell/PanelShell.tsx";
import { StageArtifacts } from "@/features/stage/components/StageArtifacts.tsx";
import { StageCard } from "@/features/stage/components/StageCard.tsx";
import { StageTimingDetails } from "@/features/stage/components/StageTimingDetails.tsx";
import { StatusChip } from "@/shared/ui/StatusChip.tsx";
import { adjacentStages } from "@/features/stage/utils/adjacent-stages.ts";
import { resolveArtifactCells } from "@/features/stage/utils/artifact-cells.ts";

const ArtifactViewer = lazy(async () => await import("@/viewer/index.tsx"));

export { adjacentStages } from "@/features/stage/utils/adjacent-stages.ts";

/**
 * 選択したステージの解説・時間情報・成果物を表示する。
 * 解析エラーは選択中のステージに限定し、解説の取得に失敗しても表示する。
 */
export function DetailPanel(): ReactNode {
  const state = useAppState();
  const dispatch = useDispatch();
  const [activeUnit, setActiveUnit] = useState<string | null>(null);
  const [ioPreviewPath, setIoPreviewPath] = useState<string | null>(null);

  const selection = routeSelection(state.route);
  const slug = slugOf(selection);
  const doc = slug === null ? undefined : state.stageDoc[slug];
  const matrixCells = viewValue(state.matrix)?.cells ?? [];
  const artifacts =
    selection === null || slug === null ? null : resolveArtifactCells(matrixCells, selection, slug);
  const initialArtifactUnit = artifacts?.initialUnit ?? null;
  const effectiveUnit =
    activeUnit !== null && artifacts?.cells.some((cell) => cell.unit === activeUnit) === true
      ? activeUnit
      : initialArtifactUnit;

  // Seed on stage change only — not when matrix refresh reshuffles
  // initialArtifactUnit (that would wipe a manual Unit tab choice). Cell
  // selections set the unit explicitly in the second effect.
  const seededSlug = useRef<string | null>(null);
  useEffect(() => {
    if (slug === null) {
      seededSlug.current = null;
      setActiveUnit(null);
      setIoPreviewPath(null);
      return;
    }
    if (seededSlug.current !== slug) {
      seededSlug.current = slug;
      setActiveUnit(initialArtifactUnit);
      setIoPreviewPath(null);
    }
  }, [slug, initialArtifactUnit]);

  useEffect(() => {
    if (selection?.kind === "cell") setActiveUnit(selection.unit);
  }, [selection]);

  // Re-fetch when this stage's on-disk file set changes (matrix push) even if
  // slug/unit stay the same — otherwise new/deleted outputs stay mislinked.
  const ioMatrixToken =
    slug === null
      ? ""
      : matrixCells
          .filter((cell) => cell.stage === slug)
          .map((cell) => `${cell.unit}:${cell.files.join(",")}`)
          .sort()
          .join("|");

  const ioLoad =
    inVsCodeWebview() && slug !== null ? () => fetchIoPaths(slug, effectiveUnit) : null;
  const ioView = useFetchView(ioLoad, [slug, effectiveUnit, ioMatrixToken]);
  const loadedIoPaths =
    ioView?.kind === "success" || ioView?.kind === "partial" ? ioView.value : null;
  const ioPaths =
    loadedIoPaths?.stage === slug && loadedIoPaths.unit === effectiveUnit ? loadedIoPaths : null;

  if (slug === null || selection === null) return null;

  const close = (): void => {
    dispatch({ type: "home" });
  };
  const openStage = (next: string): void => {
    dispatch({ type: "select", selection: { kind: "stage", slug: next } });
  };

  const workflow = viewValue(state.workflow);
  const stageInfo = workflow?.stages.find((each) => each.slug === slug);
  const timings = timingsForDisplayedIntent(state);
  const timing = timings?.stageViews.find((each) => each.stage === slug);
  const currentTiming =
    stageInfo !== undefined && timing !== undefined && stageViewMatches(stageInfo, timing)
      ? timing
      : null;
  const { prev, next } = adjacentStages(workflow?.stages ?? [], slug);

  // Single empty cell: StageArtifacts would wrap with a unit heading for one
  // empty list — keep the lean ArtifactViewer path used by matrix clicks.
  const emptyCellOnly =
    artifacts !== null &&
    artifacts.cells.length === 1 &&
    (artifacts.cells[0]?.files.length ?? 0) === 0;

  return (
    <PanelShell
      headingId="panel-heading"
      testId="detail-panel"
      title={
        <>
          {stageInfo === undefined ? null : (
            <StatusChip
              status={stageInfo.unparseable === undefined ? stageInfo.status : "unparseable"}
            />
          )}
          {formatStageLabel(slug)}
        </>
      }
      leading={
        <Button
          type="button"
          variant="outline"
          size="icon"
          data-testid="panel-back"
          aria-label="ステージ一覧に戻る"
          title="ステージ一覧に戻る"
          onClick={close}
        >
          <ArrowLeftIcon />
        </Button>
      }
      onClose={close}
      focusKey={slug}
      actions={
        <nav className="flex gap-2" aria-label="隣接ステージ">
          <Button
            type="button"
            variant="outline"
            size="icon"
            data-testid="panel-prev-stage"
            disabled={prev === null}
            aria-label={
              prev === null ? "前のステージはありません" : `前のステージ: ${formatStageLabel(prev)}`
            }
            title={prev === null ? "前のステージはありません" : `前へ: ${formatStageLabel(prev)}`}
            onClick={() => {
              if (prev !== null) openStage(prev);
            }}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            data-testid="panel-next-stage"
            disabled={next === null}
            aria-label={
              next === null ? "次のステージはありません" : `次のステージ: ${formatStageLabel(next)}`
            }
            title={next === null ? "次のステージはありません" : `次へ: ${formatStageLabel(next)}`}
            onClick={() => {
              if (next !== null) openStage(next);
            }}
          >
            <ChevronRightIcon />
          </Button>
        </nav>
      }
    >
      <PanelBody>
        <OnboardingTip area="stage" />
        {stageInfo?.unparseable === undefined ? null : (
          <div className="mb-4">
            <UnparseableBadge detail={stageInfo.unparseable} />
          </div>
        )}
        <Tabs key={`details-${slug}`} defaultValue="overview">
          <TabsList aria-label="ステージ詳細">
            <TabsTrigger value="overview">概要</TabsTrigger>
            <TabsTrigger value="timing">時間</TabsTrigger>
          </TabsList>
          <TabsPanel value="overview">
            {doc === undefined || doc.kind === "loading" ? (
              <StageDetailSkeleton />
            ) : doc.kind === "error" ? (
              <AreaError detail={doc.detail} />
            ) : doc.kind === "empty" ? (
              <p className="text-sm text-muted-foreground">{doc.hint}</p>
            ) : (
              <StageCard doc={doc.value} ioPaths={ioPaths} onPreviewIo={setIoPreviewPath} />
            )}
          </TabsPanel>
          <TabsPanel value="timing">
            <StageTimingDetails
              view={currentTiming}
              policy={timings?.policy}
              onOpenGuide={() =>
                dispatch({
                  type: "docs-shell",
                  open: true,
                  locale: state.officialDocsLocale,
                  guide: "stage-timing.md",
                })
              }
            />
          </TabsPanel>
        </Tabs>

        {ioPreviewPath === null ? null : (
          <IoArtifactPreview path={ioPreviewPath} onClose={() => setIoPreviewPath(null)} />
        )}

        {artifacts === null ? null : emptyCellOnly && artifacts.cells[0] !== undefined ? (
          <div className="mt-5 border-t pt-4">
            <LoadingSuspense fallback={<DocumentSkeleton label="成果物" />}>
              <ArtifactViewer
                unit={artifacts.cells[0].unit}
                stage={slug}
                files={artifacts.cells[0].files}
                verdict={artifacts.cells[0].verdict}
              />
            </LoadingSuspense>
          </div>
        ) : (
          <StageArtifacts
            key={slug}
            stage={slug}
            cells={artifacts.cells}
            unit={effectiveUnit ?? artifacts.initialUnit}
            onUnitChange={setActiveUnit}
          />
        )}
      </PanelBody>
    </PanelShell>
  );
}
