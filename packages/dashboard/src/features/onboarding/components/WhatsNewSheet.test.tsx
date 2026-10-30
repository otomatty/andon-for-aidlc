import { type OnboardingRecord, WHATS_NEW } from "@aidlc-guide/shared-types";
import { render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatEntryDate, WhatsNewSheet } from "@/features/onboarding/components/WhatsNewSheet.tsx";
import { StoreProvider, useAppState } from "@/store/context.tsx";
import { type AppState, initialState } from "@/store/state.ts";
import { workflow } from "@tests/fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ALL_IDS = WHATS_NEW.map((entry) => entry.id);
const FIRST = WHATS_NEW[0] as (typeof WHATS_NEW)[number];

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
        route: state.route.name,
        open: state.onboarding.whatsNew.open,
        seen: state.onboarding.record?.seenNews ?? null,
      })}
    </div>
  );
}

function probe(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as Record<string, unknown>;
}

function renderSheet(onboarding: Partial<AppState["onboarding"]>) {
  return render(
    <StoreProvider
      preloaded={{
        workflow: { kind: "success", value: workflow() },
        onboarding: { ...initialState.onboarding, ...onboarding },
      }}
    >
      <WhatsNewSheet />
      <Probe />
    </StoreProvider>,
  );
}

const record = (seenNews: string[]): OnboardingRecord => ({
  version: "0.35.0",
  welcome: "done",
  seenNews,
  dismissedTips: [],
});

/** The text of every badge in a region (Mantine puts it in an inner label span). */
function badgeTexts(region: HTMLElement): string[] {
  return [...region.querySelectorAll('[data-slot="badge"]')].map(
    (badge) => badge.textContent ?? "",
  );
}

describe("更新情報 sheet", () => {
  it("lists new changes first, marked in text, and records them as seen", async () => {
    const posted = webview();
    renderSheet({
      version: "0.35.0",
      record: record(ALL_IDS.slice(1)),
      whatsNew: { open: true, fresh: [FIRST.id] },
    });
    const sheet = await screen.findByRole("dialog", { name: "更新情報" });
    expect(within(sheet).getByText("Andon 0.35.0 の新機能と変更点です。")).toBeDefined();
    const fresh = within(sheet).getByRole("region", { name: "新着" });
    expect(within(fresh).getByRole("heading", { name: FIRST.title })).toBeDefined();
    expect(badgeTexts(fresh)).toContain("新着");
    const past = within(sheet).getByRole("region", { name: "これまでの更新" });
    expect(within(past).getAllByRole("listitem")).toHaveLength(WHATS_NEW.length - 1);
    expect(badgeTexts(past)).not.toContain("新着");
    expect(posted).toContainEqual({
      type: "onboarding-event",
      event: { kind: "news-seen", ids: [FIRST.id] },
    });
    expect(probe()).toMatchObject({ seen: ALL_IDS.slice(1).concat(FIRST.id) });
    // Seen now, still badged while this sheet stays open.
    expect(badgeTexts(fresh)).toContain("新着");
  });

  it("opens the changed screen from an entry and closes itself", async () => {
    renderSheet({ record: record([]), whatsNew: { open: true, fresh: ALL_IDS } });
    const withAction = WHATS_NEW.find((entry) => entry.action?.target === "docs");
    expect(withAction).toBeDefined();
    const sheet = await screen.findByRole("dialog", { name: "更新情報" });
    const item = within(sheet)
      .getAllByRole("listitem")
      .find((each) => within(each).queryByRole("heading", { name: withAction?.title }) !== null);
    await userEvent.click(
      within(item as HTMLElement).getByRole("button", { name: withAction?.action?.label }),
    );
    expect(probe()).toMatchObject({ route: "docs", open: false });
  });

  it("closes with Escape", async () => {
    renderSheet({ record: record(ALL_IDS), whatsNew: { open: true, fresh: [] } });
    await screen.findByRole("dialog", { name: "更新情報" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(probe()).toMatchObject({ open: false }));
  });

  it("reads as a plain change list in the browser", async () => {
    renderSheet({ whatsNew: { open: true, fresh: [] } });
    const sheet = await screen.findByRole("dialog", { name: "更新情報" });
    expect(within(sheet).getByText("Andon の新機能と変更点です。")).toBeDefined();
    expect(within(sheet).queryByRole("region", { name: "新着" })).toBeNull();
    const recent = within(sheet).getByRole("region", { name: "最近の更新" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(WHATS_NEW.length);
  });

  it("renders nothing while closed", () => {
    renderSheet({});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("formatEntryDate", () => {
  it("writes a Japanese calendar date", () => {
    expect(formatEntryDate("2026-09-05")).toBe("2026年9月5日");
    expect(formatEntryDate("2026-12-25")).toBe("2026年12月25日");
  });
});
