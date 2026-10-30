import { LoadingSuspense } from "@/shared/loading/LoadingSequence.tsx";
import { AgentPanel } from "@/features/agent/AgentPage.tsx";
import { AreaBoundary } from "@/shell/AreaBoundary.tsx";
import { DetailPanel } from "@/features/stage/StagePage.tsx";
import { DocsShell } from "@/features/docs/DocsPage.tsx";
import { CustomizationSkeleton } from "@/features/customization/components/CustomizationSkeleton.tsx";
import { EffectivenessSkeleton } from "@/features/effectiveness/components/EffectivenessSkeleton.tsx";
import { OnboardingTip } from "@/features/onboarding/components/OnboardingTip.tsx";
import { SettingsPage } from "@/features/settings/SettingsPage.tsx";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { lazy, type ReactNode, useCallback } from "react";
import { viewValue } from "@/store/state.ts";

const EffectivenessPanel = lazy(
  async () => await import("@/features/effectiveness/EffectivenessPage.tsx"),
);
const CustomizationPage = lazy(
  async () => await import("@/features/customization/CustomizationPage.tsx"),
);
// The catalog and its sample diagram load only when the plugins page opens (NFR-2 first paint).
const PluginsPage = lazy(async () => await import("@/features/plugins/PluginsPage.tsx"));
// Screenshots and copy load only when the welcome page opens (NFR-2 first paint).
const WelcomePage = lazy(async () => await import("@/features/onboarding/WelcomePage.tsx"));

/**
 * Child routes under the shared header. Home stays parked in App, not here.
 * Customization is keep-alive: first visit mounts it, later visits only unhide.
 */
export function RouteOutlet({
  visitedCustomization,
}: {
  visitedCustomization: boolean;
}): ReactNode {
  const { route, customizationRefresh, spaceSwitchPending, intents, officialDocsLocale } =
    useAppState();
  const dispatch = useDispatch();
  const activeSpace = viewValue(intents)?.space;
  const onSwitchBlockedChange = useCallback(
    (value: boolean) => dispatch({ type: "space-switch-blocked", value }),
    [dispatch],
  );
  const customizationOpen = route.name === "customization";

  return (
    <>
      <AreaBoundary name="detail-panel">
        <DetailPanel />
      </AreaBoundary>
      <AreaBoundary name="docs-shell">
        <DocsShell />
      </AreaBoundary>
      <AreaBoundary name="agent-panel">
        <AgentPanel />
      </AreaBoundary>
      {route.name === "settings" ? (
        <AreaBoundary name="settings-page">
          <SettingsPage />
        </AreaBoundary>
      ) : null}
      {customizationOpen || visitedCustomization ? (
        <div hidden={!customizationOpen} inert={!customizationOpen}>
          <AreaBoundary name="customization-page">
            <LoadingSuspense fallback={<CustomizationSkeleton />}>
              <CustomizationPage
                open={customizationOpen}
                refreshVersion={customizationRefresh}
                {...(activeSpace === undefined ? {} : { activeSpace })}
                switching={spaceSwitchPending}
                onSwitchBlockedChange={onSwitchBlockedChange}
                onSettings={() => dispatch({ type: "settings", open: true })}
                onAskAi={(space) =>
                  dispatch({
                    type: "docs-shell",
                    open: true,
                    locale: officialDocsLocale,
                    chat: { mode: "customize", space },
                  })
                }
                tip={<OnboardingTip area="customization" />}
              />
            </LoadingSuspense>
          </AreaBoundary>
        </div>
      ) : null}
      {route.name === "welcome" ? (
        <AreaBoundary name="welcome-page">
          <LoadingSuspense fallback={<DocumentSkeleton label="はじめに" />}>
            <WelcomePage />
          </LoadingSuspense>
        </AreaBoundary>
      ) : null}
      {route.name === "plugins" ? (
        <AreaBoundary name="plugins-page">
          <LoadingSuspense fallback={<DocumentSkeleton label="プラグイン" />}>
            <PluginsPage />
          </LoadingSuspense>
        </AreaBoundary>
      ) : null}
      {route.name === "effectiveness" ? (
        <AreaBoundary name="effectiveness-panel">
          <LoadingSuspense fallback={<EffectivenessSkeleton page />}>
            <EffectivenessPanel key={activeSpace} />
          </LoadingSuspense>
        </AreaBoundary>
      ) : null}
    </>
  );
}
