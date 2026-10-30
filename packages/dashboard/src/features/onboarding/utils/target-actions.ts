import type { OnboardingTarget } from "@andon/shared-types";
import type { Action } from "@/store/reducer.ts";

/**
 * The navigation that opens an onboarding target. The tour needs a workflow
 * to point at; without one the welcome page explains the screens instead.
 */
export function targetActions(target: OnboardingTarget, hasWorkflow: boolean): Action[] {
  switch (target) {
    case "home":
      return [{ type: "home" }];
    case "welcome":
      return [{ type: "welcome", open: true }];
    case "tour":
      return hasWorkflow ? [{ type: "tour", active: true }] : [{ type: "welcome", open: true }];
    case "docs":
      return [{ type: "docs-shell", open: true }];
    case "plugins":
      return [{ type: "plugins", open: true }];
    case "customization":
      return [{ type: "customization", open: true }];
    case "effectiveness":
      return [{ type: "effectiveness", open: true }];
    case "settings":
      return [{ type: "settings", open: true }];
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}
