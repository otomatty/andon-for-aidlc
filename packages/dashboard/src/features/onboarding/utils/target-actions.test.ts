import { ONBOARDING_TARGETS } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { reducer } from "@/store/reducer.ts";
import { initialState } from "@/store/state.ts";
import { targetActions } from "./target-actions.ts";

describe("targetActions", () => {
  it.each([
    ["home", "home"],
    ["welcome", "welcome"],
    ["docs", "docs"],
    ["plugins", "plugins"],
    ["customization", "customization"],
    ["effectiveness", "effectiveness"],
    ["settings", "settings"],
  ] as const)("opens %s on the %s route", (target, route) => {
    const state = targetActions(target, true).reduce(reducer, {
      ...initialState,
      route: { name: "stage", slug: "x" },
    });
    expect(state.route.name).toBe(route);
  });

  it("starts the tour only when there is a workflow to point at", () => {
    expect(targetActions("tour", true).reduce(reducer, initialState).onboarding.tour).toBe(true);
    const without = targetActions("tour", false).reduce(reducer, initialState);
    expect(without.onboarding.tour).toBe(false);
    expect(without.route.name).toBe("welcome");
  });

  it("covers every target", () => {
    for (const target of ONBOARDING_TARGETS)
      expect(targetActions(target, true).length).toBeGreaterThan(0);
  });
});
