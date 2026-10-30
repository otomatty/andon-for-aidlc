import type {
  IntentList,
  Matrix,
  NextStep,
  OfficialDocsLocale,
  OnboardingRecord,
  ProjectLink,
  StageDoc,
  TimingsPayload,
  WorkflowModel,
} from "@aidlc-guide/shared-types";
import { HOME_ROUTE, type AppRoute } from "@/app/routes.ts";

/**
 * UI-only types. Everything that crosses the wire is imported from
 * shared-types and never re-declared here (BR-UI-1 / domain-entities.md).
 */

export type { AgentOpen, AppRoute, DocsDeepLink, Selection } from "@/app/routes.ts";

/** Per-area display state — the five states of refined-mockups Q2. */
export type ViewState<T> =
  | { kind: "loading" }
  /**
   * `reason` carries the server's original error reason (e.g.
   * `"state-missing"` vs `"no-active-intent"`) so callers that need to tell
   * those apart — NowStrip's PreflightWizard gate (finding 1) — don't have
   * to re-derive it from `hint` text.
   */
  | { kind: "empty"; hint: string; reason?: string }
  | { kind: "error"; detail: string }
  | { kind: "partial"; value: T; notes: string[] }
  | { kind: "success"; value: T };

export type Theme = "light" | "dark";

export type { WorkflowPayload } from "@aidlc-guide/shared-types";

export interface AppState {
  workflow: ViewState<WorkflowModel>;
  nextStep: ViewState<NextStep>;
  matrix: ViewState<Matrix>;
  /**
   * Derived from the audit log, off the first-paint path: it arrives after
   * the three startup slices and refreshes on every change push.
   */
  timings: ViewState<TimingsPayload>;
  /** Enumeration + view pin (`selected`). Switching does not write `active-intent`. */
  intents: ViewState<IntentList>;
  /** In-webview route. Mutual exclusion is the type, not a reducer convention. */
  route: AppRoute;
  customizationRefresh: number;
  spaceSwitchBlocked: boolean;
  spaceSwitchPending: boolean;
  /** Advances only when the displayed record changes, including its space. */
  recordRevision: number;
  /**
   * Last Official Docs locale (LocaleControl + deep-link inject).
   * Used when building `open-official-doc` payloads; default `"ja"`.
   */
  officialDocsLocale: OfficialDocsLocale;
  /** slug → explanation. Fetched on selection and memoised for the session. */
  stageDoc: Record<string, ViewState<StageDoc>>;
  projectLinks: ViewState<ProjectLink[]>;
  live: LiveSlice;
  theme: Theme;
  onboarding: OnboardingSlice;
}

/**
 * Onboarding as the webview sees it. The host owns the stored record; the
 * browser dashboard never receives one, so there nothing opens by itself and
 * no tip is shown — the pages stay readable from the menu.
 */
export interface OnboardingSlice {
  version: string | null;
  record: OnboardingRecord | null;
  /**
   * The 更新情報 sheet. `fresh` holds the ids that were new when it opened,
   * so their 新着 badges survive the sheet marking them seen.
   */
  whatsNew: { open: boolean; fresh: string[] };
  /** The guided tour is running. */
  tour: boolean;
  /** The page the running tour started from, to return to when it ends. */
  tourFrom: AppRoute | null;
  /**
   * `armed` from the host snapshot until the automatic welcome page or
   * 更新情報 sheet has been shown or ruled out for this panel.
   */
  autoShow: "idle" | "armed";
}

/** Connection health. The sole input of `liveStatusView` (mob-mode M3). */
export interface LiveSlice {
  connected: boolean;
  degraded: boolean;
  reason?: string;
  /**
   * `true` once a socket has opened at least once. Without it "not connected"
   * cannot tell first connect from a drop, and the UI would open on
   * 「切断・再接続中…」 before anything had ever been connected.
   */
  everConnected: boolean;
  /**
   * ISO time of the most recent `change` push **actually received** — never a
   * connect time and never a guess, so 「最終更新」 cannot overstate liveness
   * (R-MM-3). Absent until the first change arrives.
   */
  lastChangeAt?: string;
  /**
   * Connects that followed a drop. The first connect, and a second `connected`
   * notice while the socket is already up, leave this unchanged so the timings
   * read already in flight is not restarted. A reconnect reads timings once:
   * the refresh that follows a drop does not include `/api/timings`.
   */
  reconnects: number;
}

export const initialState: AppState = {
  workflow: { kind: "loading" },
  nextStep: { kind: "loading" },
  matrix: { kind: "loading" },
  timings: { kind: "loading" },
  intents: { kind: "loading" },
  route: HOME_ROUTE,
  customizationRefresh: 0,
  spaceSwitchBlocked: false,
  spaceSwitchPending: false,
  recordRevision: 0,
  officialDocsLocale: "ja",
  stageDoc: {},
  projectLinks: { kind: "loading" },
  live: { connected: false, degraded: false, everConnected: false, reconnects: 0 },
  theme: "light",
  onboarding: {
    version: null,
    record: null,
    whatsNew: { open: false, fresh: [] },
    tour: false,
    tourFrom: null,
    autoShow: "idle",
  },
};

/** Convenience for components that only care about "is there a value". */
export function viewValue<T>(state: ViewState<T>): T | null {
  return state.kind === "success" || state.kind === "partial" ? state.value : null;
}

/**
 * Intents exist but none is selected: the intent chooser opens by itself, so
 * nothing else should open on top of it.
 */
export function intentChoicePending(intents: IntentList | null): boolean {
  return intents !== null && intents.selected === null && intents.all.length > 0;
}
