import type { DocsQaMode, DocsShellDeepLink } from "@andon/shared-types";

/**
 * In-webview route. One value at a time — there is no URL, so this union is
 * the whole navigation state. Overlay booleans used to live beside `selected`;
 * they could not actually be true together, and the reducer spent its bulk
 * proving that. A discriminated union makes the exclusivity structural.
 */
export type AppRoute =
  | { name: "home" }
  | { name: "stage"; slug: string }
  | { name: "cell"; unit: string; stage: string }
  | { name: "agent"; id: string; returnTo: Selection }
  | { name: "docs"; deepLink?: DocsDeepLink }
  | { name: "effectiveness" }
  | { name: "plugins" }
  | { name: "customization" }
  | { name: "settings" }
  | { name: "welcome" };

/** Stage or matrix-cell selection. `null` is home (or a non-record route). */
export type Selection =
  | { kind: "stage"; slug: string }
  | { kind: "cell"; unit: string; stage: string }
  | null;

export type AgentOpen = { id: string; returnTo: Selection };

/** Opens the AI chat; `mode` omitted keeps the chat's current one. */
export type DocsChatLink = { mode?: DocsQaMode; space?: string };

/** One-shot host inject applied when the docs shell opens, then cleared. */
export type DocsDeepLink = DocsShellDeepLink & { guide?: string; chat?: DocsChatLink };

export const HOME_ROUTE: AppRoute = { name: "home" };

/** はじめに — the onboarding page. */
export const WELCOME_ROUTE: AppRoute = { name: "welcome" };

export function routeSelection(route: AppRoute): Selection {
  switch (route.name) {
    case "stage":
      return { kind: "stage", slug: route.slug };
    case "cell":
      return { kind: "cell", unit: route.unit, stage: route.stage };
    case "home":
    case "agent":
    case "docs":
    case "effectiveness":
    case "plugins":
    case "customization":
    case "settings":
    case "welcome":
      return null;
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}

export function routeAgent(route: AppRoute): AgentOpen | null {
  return route.name === "agent" ? { id: route.id, returnTo: route.returnTo } : null;
}

export function routeDeepLink(route: AppRoute): DocsDeepLink | null {
  return route.name === "docs" ? (route.deepLink ?? null) : null;
}

export function isHomeRoute(route: AppRoute): boolean {
  return route.name === "home";
}

/** NowStrip stays on the record pages; other routes hide it. */
export function showsNowStrip(route: AppRoute): boolean {
  return (
    route.name === "home" ||
    route.name === "stage" ||
    route.name === "cell" ||
    route.name === "agent"
  );
}

export function selectionRoute(selection: NonNullable<Selection>): AppRoute {
  return selection.kind === "stage"
    ? { name: "stage", slug: selection.slug }
    : { name: "cell", unit: selection.unit, stage: selection.stage };
}
