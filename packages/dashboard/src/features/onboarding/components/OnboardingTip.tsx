import {
  activeSpotlight,
  areaTipId,
  areaTipVisible,
  type OnboardingArea,
  type OnboardingTarget,
  spotlightTipId,
  WHATS_NEW,
} from "@andon/shared-types";
import { LightbulbIcon, SparklesIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { emitOnboardingEvent } from "@/services/onboarding.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { AREA_TIPS } from "../content/tips.ts";
import { targetActions } from "../utils/target-actions.ts";

/** The screen an area tip sits on, as an onboarding target. */
const AREA_TARGET: Record<OnboardingArea, OnboardingTarget | null> = {
  home: "home",
  stage: null,
  docs: "docs",
  customization: "customization",
  effectiveness: "effectiveness",
};

interface TipView {
  id: string;
  kind: "new" | "tip";
  text: string;
  guide?: string;
  action?: { label: string; target: OnboardingTarget };
}

/**
 * One dismissible note at the top of a screen: a 新機能 announcement placed
 * where the feature lives, else the screen's first-visit tip. It sits in the
 * page flow rather than floating over it, so it never hides content. Only the
 * IDE remembers tips, so the browser dashboard shows none.
 */
export function OnboardingTip({ area }: { area: OnboardingArea }): ReactNode {
  const { onboarding, workflow, officialDocsLocale } = useAppState();
  const dispatch = useDispatch();
  const { record } = onboarding;
  if (record === null || onboarding.tour) return null;

  const spotlight = activeSpotlight(WHATS_NEW, record, area);
  const tip: TipView | null =
    spotlight?.spotlight !== undefined
      ? {
          id: spotlightTipId(spotlight.id),
          kind: "new",
          text: spotlight.spotlight.text,
          ...(spotlight.action !== undefined && spotlight.action.target !== AREA_TARGET[area]
            ? { action: spotlight.action }
            : {}),
        }
      : areaTipVisible(record, area)
        ? { id: areaTipId(area), kind: "tip", ...AREA_TIPS[area] }
        : null;
  if (tip === null) return null;

  const hasWorkflow = workflow.kind === "success" || workflow.kind === "partial";
  const isNew = tip.kind === "new";
  return (
    <aside
      role="note"
      aria-label={isNew ? "新機能のお知らせ" : "この画面のヒント"}
      data-testid={`onboarding-tip-${area}`}
      className="flex items-start gap-3 rounded-lg bg-muted px-4 py-3 text-sm"
    >
      {isNew ? (
        <SparklesIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      ) : (
        <LightbulbIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-gate" />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        {isNew ? <Badge variant="secondary">新機能</Badge> : null}
        <p className="leading-relaxed">{tip.text}</p>
        {tip.guide === undefined && tip.action === undefined ? null : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {tip.action === undefined ? null : (
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  const target = tip.action?.target;
                  if (target === undefined) return;
                  for (const action of targetActions(target, hasWorkflow)) dispatch(action);
                }}
              >
                {tip.action.label}
              </Button>
            )}
            {tip.guide === undefined ? null : (
              <Button
                type="button"
                variant="link"
                onClick={() =>
                  dispatch({
                    type: "docs-shell",
                    open: true,
                    locale: officialDocsLocale,
                    guide: tip.guide,
                  })
                }
              >
                ガイドを読む
              </Button>
            )}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={isNew ? "お知らせを閉じる" : "ヒントを閉じる"}
        title="閉じる"
        onClick={() => emitOnboardingEvent(dispatch, { kind: "tip-dismissed", id: tip.id })}
      >
        <XIcon />
      </Button>
    </aside>
  );
}
