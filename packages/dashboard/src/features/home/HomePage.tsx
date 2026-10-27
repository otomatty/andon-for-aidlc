import { LoadingSuspense } from "@/shared/loading/LoadingSequence.tsx";
import { AreaBoundary } from "@/shell/AreaBoundary.tsx";
import { MatrixSkeleton } from "@/features/home/components/MatrixSkeleton.tsx";
import { OnboardingTip } from "@/features/onboarding/components/OnboardingTip.tsx";
import { StageModelsRail } from "@/features/home/components/StageModelsRail.tsx";
import { useAppState } from "@/store/context.tsx";
import { timingsForDisplayedIntent } from "@/store/select-timing.ts";
import { viewValue } from "@/store/state.ts";
import { lazy, type ReactNode } from "react";
import type { HomePageProps } from "./types.ts";

const UnitStageMatrix = lazy(
  async () => await import("@/features/home/components/UnitStageMatrix.tsx"),
);

export function HomePage({
  onSelectStage,
  onSelectCell,
  onRetry,
  purposes,
}: HomePageProps): ReactNode {
  const state = useAppState();
  return (
    <main className="grid grid-cols-1 items-start gap-5 p-4" aria-labelledby="stage-list-heading">
      <h1 id="stage-list-heading" className="text-page-title font-bold">
        ステージ一覧
      </h1>
      <OnboardingTip area="home" />
      <AreaBoundary name="stage-rail">
        <StageModelsRail
          key={`${viewValue(state.intents)?.space ?? ""}/${viewValue(state.intents)?.selected ?? viewValue(state.intents)?.active ?? ""}`}
          state={state.workflow}
          onSelect={onSelectStage}
          onRetry={onRetry}
          purposes={purposes}
          timings={timingsForDisplayedIntent(state)}
        />
      </AreaBoundary>
      <AreaBoundary name="matrix">
        <LoadingSuspense fallback={<MatrixSkeleton heading />}>
          <UnitStageMatrix state={state.matrix} onSelectCell={onSelectCell} onRetry={onRetry} />
        </LoadingSuspense>
      </AreaBoundary>
    </main>
  );
}
