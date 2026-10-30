import { type OnboardingRecord, type OnboardingSnapshot, WHATS_NEW } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { routeSelection, showsNowStrip } from "@/app/routes.ts";
import { type Action, reducer } from "@/store/reducer.ts";
import { type AppState, initialState, intentChoicePending } from "@/store/state.ts";

const ALL_IDS = WHATS_NEW.map((entry) => entry.id);

function record(overrides: Partial<OnboardingRecord> = {}): OnboardingRecord {
  return { version: "0.35.0", welcome: "done", seenNews: ALL_IDS, dismissedTips: [], ...overrides };
}

function snapshot(overrides: Partial<OnboardingRecord> = {}, open?: OnboardingSnapshot["open"]) {
  return {
    type: "onboarding-restore" as const,
    snapshot: { version: "0.35.0", record: record(overrides), ...(open ? { open } : {}) },
  };
}

const INTENTS_SELECTED: Action = {
  type: "intents",
  result: { ok: true, value: { space: "default", active: "a", all: ["a"], selected: "a" } },
};
const INTENTS_UNCHOSEN: Action = {
  type: "intents",
  result: { ok: true, value: { space: "default", active: null, all: ["a", "b"], selected: null } },
};

function run(...actions: Action[]): AppState {
  return actions.reduce(reducer, initialState);
}

describe("welcome route", () => {
  it("opens and closes like the other full pages", () => {
    const open = run({ type: "welcome", open: true });
    expect(open.route).toEqual({ name: "welcome" });
    expect(routeSelection(open.route)).toBeNull();
    expect(showsNowStrip(open.route)).toBe(false);
    expect(reducer(open, { type: "welcome", open: false }).route).toEqual({ name: "home" });
    // Closing a page that is not open leaves the route alone.
    const settings = run({ type: "settings", open: true });
    expect(reducer(settings, { type: "welcome", open: false }).route).toEqual({
      name: "settings",
    });
  });
});

describe("onboarding slice", () => {
  it("starts empty, which is also the browser state", () => {
    expect(initialState.onboarding).toEqual({
      version: null,
      record: null,
      whatsNew: { open: false, fresh: [] },
      tour: false,
      tourFrom: null,
      autoShow: "idle",
    });
  });

  it("stores the host snapshot", () => {
    const state = run(snapshot({ welcome: "done" }));
    expect(state.onboarding.version).toBe("0.35.0");
    expect(state.onboarding.record).toEqual(record());
  });

  it("applies events to the stored record and ignores them without one", () => {
    const state = run(snapshot({ welcome: "done", dismissedTips: [] }), {
      type: "onboarding-event",
      event: { kind: "tip-dismissed", id: "area:stage" },
    });
    expect(state.onboarding.record?.dismissedTips).toEqual(["area:stage"]);
    const browser = run({
      type: "onboarding-event",
      event: { kind: "tip-dismissed", id: "area:stage" },
    });
    expect(browser.onboarding.record).toBeNull();
  });

  it("captures the unseen changes when the sheet opens, so their badges survive", () => {
    const opened = run(INTENTS_UNCHOSEN, snapshot({ seenNews: ALL_IDS.slice(1) }), {
      type: "whats-new",
      open: true,
    });
    expect(opened.onboarding.whatsNew).toEqual({ open: true, fresh: [ALL_IDS[0]] });
    const seen = reducer(opened, {
      type: "onboarding-event",
      event: { kind: "news-seen", ids: [ALL_IDS[0] as string] },
    });
    expect(seen.onboarding.whatsNew.fresh).toEqual([ALL_IDS[0]]);
    // Closing keeps the grouping, so the list does not reflow while it fades out.
    const closed = reducer(seen, { type: "whats-new", open: false });
    expect(closed.onboarding.whatsNew).toEqual({ open: false, fresh: [ALL_IDS[0]] });
    // Reopening recomputes: everything has been seen by now.
    expect(reducer(closed, { type: "whats-new", open: true }).onboarding.whatsNew).toEqual({
      open: true,
      fresh: [],
    });
  });

  it("opens the sheet without badges in the browser", () => {
    expect(run({ type: "whats-new", open: true }).onboarding.whatsNew).toEqual({
      open: true,
      fresh: [],
    });
  });

  it("toggles the tour", () => {
    const on = run({ type: "tour", active: true });
    expect(on.onboarding.tour).toBe(true);
    expect(reducer(on, { type: "tour", active: false }).onboarding.tour).toBe(false);
  });

  it("returns to the page the tour started from when it ends", () => {
    const started = run({ type: "settings", open: true }, { type: "tour", active: true });
    expect(started.onboarding.tourFrom).toEqual({ name: "settings" });
    // The tour opens the pages it explains on the way.
    const ended = reducer(reducer(started, { type: "home" }), { type: "tour", active: false });
    expect(ended.route).toEqual({ name: "settings" });
    expect(ended.onboarding).toMatchObject({ tour: false, tourFrom: null });
  });

  it("hands over to the stage list when the tour started on the welcome page", () => {
    const ended = run(
      { type: "welcome", open: true },
      { type: "tour", active: true },
      { type: "tour", active: false },
    );
    expect(ended.route).toEqual({ name: "home" });
  });

  it("keeps the first starting page when the tour is started again", () => {
    const again = run(
      { type: "settings", open: true },
      { type: "tour", active: true },
      { type: "home" },
      { type: "tour", active: true },
    );
    expect(again.onboarding.tourFrom).toEqual({ name: "settings" });
    // Ending a tour that is not running goes nowhere.
    const idle = run({ type: "settings", open: true }, { type: "tour", active: false });
    expect(idle.route).toEqual({ name: "settings" });
  });
});

describe("automatic welcome and 更新情報", () => {
  it("greets a first-time user at once, without waiting for the intent list", () => {
    const state = run(snapshot({ welcome: "pending" }));
    expect(state.route).toEqual({ name: "welcome" });
    expect(state.onboarding.autoShow).toBe("idle");
  });

  it("shows new changes once the intent list has loaded", () => {
    const waiting = run(snapshot({ seenNews: ALL_IDS.slice(2) }));
    expect(waiting.onboarding.whatsNew.open).toBe(false);
    expect(waiting.onboarding.autoShow).toBe("armed");
    const shown = reducer(waiting, INTENTS_SELECTED);
    expect(shown.onboarding.whatsNew).toEqual({ open: true, fresh: ALL_IDS.slice(0, 2) });
    expect(shown.onboarding.autoShow).toBe("idle");
    // Closing it does not bring it back on the next state change.
    const closed = reducer(shown, { type: "whats-new", open: false });
    expect(reducer(closed, INTENTS_SELECTED).onboarding.whatsNew.open).toBe(false);
  });

  it("stays out of the way of the intent chooser and waits for the next panel", () => {
    const state = run(INTENTS_UNCHOSEN, snapshot({ seenNews: [] }));
    expect(state.onboarding.whatsNew.open).toBe(false);
    expect(state.onboarding.autoShow).toBe("idle");
    expect(reducer(state, INTENTS_SELECTED).onboarding.whatsNew.open).toBe(false);
  });

  it("does not interrupt a page the user already opened", () => {
    const state = run({ type: "settings", open: true }, snapshot({ welcome: "pending" }));
    expect(state.route).toEqual({ name: "settings" });
    expect(state.onboarding.autoShow).toBe("idle");
    expect(reducer(state, { type: "home" }).route).toEqual({ name: "home" });
  });

  it("gives up when the user leaves home before the intent list arrives", () => {
    const armed = run(snapshot({ seenNews: [] }));
    const away = reducer(armed, { type: "effectiveness", open: true });
    expect(away.onboarding.autoShow).toBe("idle");
    expect(
      reducer(reducer(away, { type: "home" }), INTENTS_SELECTED).onboarding.whatsNew.open,
    ).toBe(false);
  });

  it("shows nothing when everything is known", () => {
    const state = run(INTENTS_SELECTED, snapshot());
    expect(state.route).toEqual({ name: "home" });
    expect(state.onboarding.whatsNew.open).toBe(false);
    expect(state.onboarding.autoShow).toBe("idle");
  });

  it("honours a view requested by a command, even away from home", () => {
    const welcome = run({ type: "settings", open: true }, snapshot({}, "welcome"));
    expect(welcome.route).toEqual({ name: "welcome" });
    const news = run(INTENTS_UNCHOSEN, snapshot({ seenNews: [] }, "whats-new"));
    expect(news.onboarding.whatsNew.open).toBe(true);
    expect(news.onboarding.autoShow).toBe("idle");
  });
});

describe("intentChoicePending", () => {
  it("is true only when intents exist and none is selected", () => {
    expect(intentChoicePending(null)).toBe(false);
    expect(intentChoicePending({ space: "d", active: null, all: [], selected: null })).toBe(false);
    expect(intentChoicePending({ space: "d", active: null, all: ["a"], selected: null })).toBe(
      true,
    );
    expect(intentChoicePending({ space: "d", active: "a", all: ["a"], selected: "a" })).toBe(false);
  });
});

describe("a view the extension asks for", () => {
  it("opens the plugins page when the command asks for it", () => {
    expect(run(snapshot({}, "plugins")).route).toEqual({ name: "plugins" });
  });
});
