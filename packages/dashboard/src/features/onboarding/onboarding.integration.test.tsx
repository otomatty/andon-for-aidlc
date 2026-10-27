import { type OnboardingRecord, WHATS_NEW } from "@aidlc-guide/shared-types";
import { act, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app/App.tsx";
import { deliverOnboardingSnapshot } from "@/services/onboarding.ts";
import { matrix, payload, stageDoc } from "@tests/fixtures.ts";

const ALL_IDS = WHATS_NEW.map((entry) => entry.id);

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input === "/api/workflow") return Response.json(payload());
      if (input.includes("/api/matrix")) return Response.json({ ok: true, value: matrix() });
      if (input === "/api/intents")
        return Response.json({
          ok: true,
          value: { space: "default", active: "a", all: ["a"], selected: "a" },
        });
      if (input.includes("/api/stage/"))
        return Response.json({ ok: true, value: stageDoc({ slug: input.split("/").at(-1) }) });
      if (input.includes("/api/links")) return Response.json({ ok: true, value: [] });
      return Response.json({ error: true, reason: "not_found" }, { status: 404 });
    }),
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      close(): void {}
    },
  );
}

function webview(): unknown[] {
  const posted: unknown[] = [];
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage: (message: unknown) => posted.push(message),
  }));
  return posted;
}

function restore(record: Partial<OnboardingRecord>): void {
  act(() => {
    deliverOnboardingSnapshot({
      version: "0.35.0",
      record: {
        version: "0.35.0",
        welcome: "done",
        seenNews: ALL_IDS,
        dismissedTips: [],
        ...record,
      },
    });
  });
}

function renderApp() {
  return render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);
}

beforeEach(stubApi);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onboarding in the IDE", () => {
  it("greets a first-time user with the welcome page once", async () => {
    const posted = webview();
    renderApp();
    restore({ welcome: "pending", dismissedTips: ["news:onboarding", "news:docs-chat"] });
    expect(await screen.findByRole("main", { name: "はじめに" })).toBeDefined();
    await waitFor(() =>
      expect(posted).toContainEqual({
        type: "onboarding-event",
        event: { kind: "welcome", status: "done" },
      }),
    );
    // Leaving the page shows the stage list with the screen's own content.
    await userEvent.click(screen.getByRole("button", { name: "あとで読む" }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "はじめに" })).toBeNull());
    expect(await screen.findByTestId("onboarding-tip-home")).toBeDefined();
  });

  it("announces new changes once the intent list is in, and clears the menu mark", async () => {
    const posted = webview();
    renderApp();
    await screen.findByTestId("stage-rail-item-code-generation");
    restore({ seenNews: ALL_IDS.slice(1), dismissedTips: ["area:home"] });
    const sheet = await screen.findByRole("dialog", { name: "更新情報" });
    expect(
      within(within(sheet).getByRole("region", { name: "新着" })).getByRole("heading", {
        name: WHATS_NEW[0]?.title,
      }),
    ).toBeDefined();
    expect(posted).toContainEqual({
      type: "onboarding-event",
      event: { kind: "news-seen", ids: [ALL_IDS[0]] },
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "メニュー" }).getAttribute("aria-describedby")).toBe(
      null,
    );
  });

  it("shows the stage tip on the first stage visit", async () => {
    webview();
    renderApp();
    restore({});
    await userEvent.click(await screen.findByTestId("stage-rail-item-code-generation"));
    const panel = await screen.findByTestId("detail-panel");
    expect(within(panel).getByRole("note", { name: "この画面のヒント" })).toBeDefined();
  });
});

describe("onboarding in the browser", () => {
  it("opens nothing by itself and shows no tips", async () => {
    renderApp();
    await screen.findByTestId("stage-rail-item-code-generation");
    expect(screen.queryByRole("main", { name: "はじめに" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "メニュー" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "はじめに" }));
    expect(await screen.findByRole("main", { name: "はじめに" })).toBeDefined();
  });
});
