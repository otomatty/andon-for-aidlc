import { type OnboardingRecord, WHATS_NEW } from "@andon/shared-types";
import { render, screen } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingTip } from "@/features/onboarding/components/OnboardingTip.tsx";
import { AREA_TIPS } from "@/features/onboarding/content/tips.ts";
import { StoreProvider, useAppState } from "@/store/context.tsx";
import { type AppState, initialState } from "@/store/state.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALL_IDS = WHATS_NEW.map((entry) => entry.id);
const SPOTLIGHT_IDS = WHATS_NEW.flatMap((entry) =>
  entry.spotlight === undefined ? [] : [`news:${entry.id}`],
);
const DOCS_SPOTLIGHT = WHATS_NEW.find((entry) => entry.spotlight?.area === "docs");
const HOME_SPOTLIGHT = WHATS_NEW.find((entry) => entry.spotlight?.area === "home");

function webview(): unknown[] {
  const posted: unknown[] = [];
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage: (message: unknown) => posted.push(message),
  }));
  return posted;
}

function Probe(): ReactNode {
  const state = useAppState();
  return (
    <div data-testid="probe" hidden>
      {JSON.stringify({
        route: state.route,
        tips: state.onboarding.record?.dismissedTips ?? null,
      })}
    </div>
  );
}

function probe(): { route: AppState["route"]; tips: string[] | null } {
  return JSON.parse(screen.getByTestId("probe").textContent ?? "{}");
}

function renderTip(
  area: Parameters<typeof OnboardingTip>[0]["area"],
  record: Partial<OnboardingRecord> | null,
  onboarding: Partial<AppState["onboarding"]> = {},
) {
  return render(
    <StoreProvider
      preloaded={{
        onboarding: {
          ...initialState.onboarding,
          ...onboarding,
          record:
            record === null
              ? null
              : {
                  version: "0.35.0",
                  welcome: "done",
                  seenNews: ALL_IDS,
                  // A first-time user: every change spotlight already closed.
                  dismissedTips: SPOTLIGHT_IDS,
                  ...record,
                },
        },
      }}
    >
      <OnboardingTip area={area} />
      <Probe />
    </StoreProvider>,
  );
}

describe("OnboardingTip", () => {
  it("stays hidden in the browser, where nothing is remembered", () => {
    renderTip("stage", null);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("explains a screen on the first visit and remembers when it is closed", async () => {
    const posted = webview();
    renderTip("stage", {});
    const tip = screen.getByRole("note", { name: "この画面のヒント" });
    expect(tip.textContent).toContain(AREA_TIPS.stage.text);
    await userEvent.click(screen.getByRole("button", { name: "ヒントを閉じる" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(posted).toContainEqual({
      type: "onboarding-event",
      event: { kind: "tip-dismissed", id: "area:stage" },
    });
    expect(probe().tips).toContain("area:stage");
  });

  it("links to the matching guide", async () => {
    renderTip("customization", {});
    await userEvent.click(screen.getByRole("button", { name: "ガイドを読む" }));
    expect(probe().route).toEqual({
      name: "docs",
      deepLink: { locale: "ja", guide: AREA_TIPS.customization.guide },
    });
  });

  it("announces a new feature where it lives, before the screen tip", async () => {
    expect(DOCS_SPOTLIGHT).toBeDefined();
    const posted = webview();
    renderTip("docs", { dismissedTips: [] });
    const note = screen.getByRole("note", { name: "新機能のお知らせ" });
    expect(note.textContent).toContain("新機能");
    expect(note.textContent).toContain(DOCS_SPOTLIGHT?.spotlight?.text);
    await userEvent.click(screen.getByRole("button", { name: "お知らせを閉じる" }));
    expect(posted).toContainEqual({
      type: "onboarding-event",
      event: { kind: "tip-dismissed", id: `news:${DOCS_SPOTLIGHT?.id}` },
    });
    // The screen's own tip takes the slot next.
    expect(screen.getByRole("note", { name: "この画面のヒント" }).textContent).toContain(
      AREA_TIPS.docs.text,
    );
  });

  it("offers a new feature's action when it leads elsewhere", async () => {
    expect(HOME_SPOTLIGHT?.action).toBeDefined();
    renderTip("home", { dismissedTips: [] });
    await userEvent.click(
      screen.getByRole("button", { name: HOME_SPOTLIGHT?.action?.label as string }),
    );
    expect(probe().route).toEqual({ name: "welcome" });
  });

  it("does not repeat an action for the screen it is already on", () => {
    renderTip("docs", { dismissedTips: [] });
    expect(
      screen.queryByRole("button", { name: DOCS_SPOTLIGHT?.action?.label as string }),
    ).toBeNull();
  });

  it("reminds where the welcome page is only after it was put off", () => {
    const { unmount } = renderTip("home", { welcome: "done" });
    expect(screen.queryByRole("note")).toBeNull();
    unmount();
    renderTip("home", { welcome: "deferred" });
    expect(screen.getByRole("note", { name: "この画面のヒント" }).textContent).toContain(
      AREA_TIPS.home.text,
    );
  });

  it("steps aside while the guided tour runs", () => {
    renderTip("stage", {}, { tour: true });
    expect(screen.queryByRole("note")).toBeNull();
  });
});
