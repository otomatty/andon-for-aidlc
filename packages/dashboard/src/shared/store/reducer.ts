import {
  applyOnboardingEvent,
  type IntentList,
  type Matrix,
  type MatrixCell,
  type OfficialDocsLocale,
  type OnboardingEvent,
  type OnboardingRecord,
  type OnboardingSnapshot,
  type ProjectLink,
  type ReadResult,
  type StageDoc,
  type TimingsPayload,
  unseenNews,
  WHATS_NEW,
  type WsMessage,
} from "@andon/shared-types";
import {
  type AppRoute,
  type DocsChatLink,
  type DocsDeepLink,
  HOME_ROUTE,
  routeSelection,
  selectionRoute,
  WELCOME_ROUTE,
} from "@/app/routes.ts";
import { deriveViewState, deriveWorkflow, matrixNotes } from "./derive-view-state.ts";
import {
  type AppState,
  intentChoicePending,
  type Selection,
  type Theme,
  type ViewState,
  viewValue,
  type WorkflowPayload,
} from "./state.ts";

/** `GET /api/matrix` answers `{building:true}` while the background scan runs. */
export type MatrixResponse = ReadResult<Matrix> | { building: true };

export type Action =
  | { type: "space-switch-blocked"; value: boolean }
  | { type: "space-switch-pending"; value: boolean }
  | { type: "workflow"; result: ReadResult<WorkflowPayload> }
  | { type: "matrix"; result: MatrixResponse }
  | { type: "timings"; result: ReadResult<TimingsPayload>; recordRevision?: number }
  | { type: "intents"; result: ReadResult<IntentList> }
  | { type: "stage-doc"; slug: string; state: ViewState<StageDoc>; recordRevision?: number }
  | { type: "links"; result: ReadResult<ProjectLink[]> }
  // `receivedAt` is stamped at the socket (services/live.ts). Required, not
  // optional: the reducer reads no clock, so a caller that omitted it would
  // silently stop 「最終更新」 from advancing.
  | { type: "ws"; message: WsMessage; receivedAt: string }
  | { type: "live"; connected: boolean }
  | { type: "select"; selection: Selection }
  | { type: "effectiveness"; open: boolean }
  | { type: "settings"; open: boolean }
  | { type: "plugins"; open: boolean }
  | { type: "customization"; open: boolean }
  | { type: "welcome"; open: boolean }
  /** The 更新情報 sheet. */
  | { type: "whats-new"; open: boolean }
  | { type: "tour"; active: boolean }
  /** Host snapshot on panel ready (webview only). */
  | { type: "onboarding-restore"; snapshot: OnboardingSnapshot }
  /** Optimistic local copy of an event also sent to the host. */
  | { type: "onboarding-event"; event: OnboardingEvent }
  | {
      type: "docs-shell";
      open: boolean;
      /** Required when setting a one-shot deep-link (host inject / mapped open). */
      locale?: OfficialDocsLocale;
      path?: string;
      anchor?: string;
      /** An extension guide opened inside the existing docs shell. UI only. */
      guide?: string;
      /** Opens the AI chat instead of a page. UI only. */
      chat?: DocsChatLink;
    }
  | { type: "official-docs-locale"; locale: OfficialDocsLocale }
  | { type: "open-agent"; id: string }
  | { type: "close-agent" }
  /** Return to the home route and close every secondary route. */
  | { type: "home" }
  | { type: "theme"; theme: Theme }
  | { type: "reloading" };

/**
 * Every action is followed by {@link settleAutoShow}: the automatic welcome or
 * 更新情報 depends on the host snapshot, the route and the intent list, which
 * arrive in any order.
 */
export function reducer(state: AppState, action: Action): AppState {
  return settleAutoShow(reduce(state, action));
}

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "space-switch-blocked":
      return { ...state, spaceSwitchBlocked: action.value };
    case "space-switch-pending":
      return { ...state, spaceSwitchPending: action.value };
    case "workflow": {
      const { workflow, nextStep } = deriveWorkflow(action.result);
      return { ...state, workflow, nextStep };
    }

    case "matrix":
      return {
        ...state,
        matrix:
          "building" in action.result
            ? { kind: "loading" }
            : deriveViewState(action.result, matrixNotes),
      };

    case "timings":
      if (action.recordRevision !== undefined && action.recordRevision !== state.recordRevision)
        return state;
      return { ...state, timings: deriveViewState(action.result) };

    case "intents": {
      const oldSpace = viewValue(state.intents)?.space;
      const spaceChanged =
        "ok" in action.result && oldSpace !== undefined && action.result.value.space !== oldSpace;
      return {
        ...(spaceChanged ? resetRecord(state) : state),
        intents: deriveViewState(action.result),
      };
    }

    case "stage-doc":
      if (action.recordRevision !== undefined && action.recordRevision !== state.recordRevision)
        return state;
      return { ...state, stageDoc: { ...state.stageDoc, [action.slug]: action.state } };

    case "links":
      return { ...state, projectLinks: deriveViewState(action.result) };

    case "ws":
      return applyWs(state, action.message, action.receivedAt);

    case "live":
      // Reconnecting clears `degraded` (and its reason): the server
      // re-announces liveness loss on the new socket if it is still degraded
      // (push.ts `degrade`). `lastChangeAt` survives — it is a fact about
      // changes received, not about the current socket.
      return {
        ...state,
        customizationRefresh: state.customizationRefresh + (action.connected ? 1 : 0),
        live: action.connected
          ? {
              connected: true,
              degraded: false,
              everConnected: true,
              reconnects:
                state.live.everConnected && !state.live.connected
                  ? state.live.reconnects + 1
                  : state.live.reconnects,
              ...carry(state.live.lastChangeAt),
            }
          : { ...state.live, connected: false },
      };

    case "select":
      // One in-webview route at a time: opening a stage parks sibling routes.
      return action.selection === null
        ? leaveRecordRoute(state)
        : go(state, selectionRoute(action.selection));

    case "docs-shell": {
      const [docs, extra] = docsRoute(action);
      return action.open ? go(state, docs, extra) : leaveNamed(state, "docs");
    }

    case "official-docs-locale":
      return { ...state, officialDocsLocale: action.locale };

    case "effectiveness":
      return action.open
        ? go(state, { name: "effectiveness" })
        : leaveNamed(state, "effectiveness");

    case "settings":
      return action.open ? go(state, { name: "settings" }) : leaveNamed(state, "settings");

    case "plugins":
      return action.open ? go(state, { name: "plugins" }) : leaveNamed(state, "plugins");

    case "customization":
      return action.open
        ? go(state, { name: "customization" })
        : leaveNamed(state, "customization");

    case "welcome":
      return action.open ? go(state, WELCOME_ROUTE) : leaveNamed(state, "welcome");

    case "whats-new":
      // Closing keeps `fresh` so the list does not reflow while the sheet fades
      // out; opening always recomputes it.
      return action.open
        ? openWhatsNew(state)
        : withOnboarding(state, { whatsNew: { ...state.onboarding.whatsNew, open: false } });

    case "tour": {
      const { tour, tourFrom } = state.onboarding;
      if (action.active) {
        return tour ? state : withOnboarding(state, { tour: true, tourFrom: state.route });
      }
      if (!tour) return state;
      // Back to where the tour started. From the welcome page it hands over to
      // the stage list, where the work starts.
      const back = tourFrom === null || tourFrom.name === "welcome" ? HOME_ROUTE : tourFrom;
      return go(withOnboarding(state, { tour: false, tourFrom: null }), back);
    }

    case "onboarding-restore": {
      const { version, record, open } = action.snapshot;
      const restored = withOnboarding(state, {
        version,
        record,
        autoShow: open === undefined ? "armed" : "idle",
      });
      if (open === "welcome") return go(restored, WELCOME_ROUTE);
      if (open === "plugins") return go(restored, { name: "plugins" });
      return open === "whats-new" ? openWhatsNew(restored) : restored;
    }

    case "onboarding-event": {
      const { record } = state.onboarding;
      if (record === null) return state;
      const next = applyOnboardingEvent(record, action.event, WHATS_NEW);
      return next === record ? state : withOnboarding(state, { record: next });
    }

    case "open-agent":
      return go(state, {
        name: "agent",
        id: action.id,
        returnTo: routeSelection(state.route),
      });

    case "close-agent":
      return state.route.name === "agent" ? go(state, fromReturnTo(state.route.returnTo)) : state;

    case "home":
      return go(state, HOME_ROUTE);

    case "theme":
      return { ...state, theme: action.theme };

    case "reloading":
      // Retry after a server outage: back to skeletons for the three startup
      // slices only. `stageDoc` memoisation and the selection survive.
      return {
        ...state,
        workflow: { kind: "loading" },
        nextStep: { kind: "loading" },
        matrix: { kind: "loading" },
      };

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unhandled action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function withOnboarding(state: AppState, patch: Partial<AppState["onboarding"]>): AppState {
  return { ...state, onboarding: { ...state.onboarding, ...patch } };
}

function freshIds(record: OnboardingRecord | null): string[] {
  return record === null ? [] : unseenNews(WHATS_NEW, record).map((entry) => entry.id);
}

function openWhatsNew(state: AppState): AppState {
  return withOnboarding(state, {
    whatsNew: { open: true, fresh: freshIds(state.onboarding.record) },
  });
}

/**
 * Decide the automatic welcome or 更新情報 once per panel, in the webview only.
 *
 * - Leaving home first means the user is busy: nothing opens.
 * - A first-time user gets the welcome page at once; it is a full page, so
 *   it never covers anything.
 * - The 更新情報 sheet waits for the intent list, and gives way to the intent
 *   chooser, which opens by itself when no intent is selected. The changes
 *   stay unseen and are offered again in the next panel.
 */
export function settleAutoShow(state: AppState): AppState {
  const { autoShow, record } = state.onboarding;
  if (autoShow !== "armed" || record === null) return state;
  const settled = withOnboarding(state, { autoShow: "idle" });
  if (state.route.name !== "home") return settled;
  if (record.welcome === "pending") return go(settled, WELCOME_ROUTE);
  if (state.intents.kind === "loading") return state;
  if (intentChoicePending(viewValue(state.intents))) return settled;
  return freshIds(record).length === 0 ? settled : openWhatsNew(settled);
}

/** Spread helper: keep an optional field out of the object when it is unset. */
function carry(lastChangeAt: string | undefined): { lastChangeAt?: string } {
  return lastChangeAt === undefined ? {} : { lastChangeAt };
}

function go(
  state: AppState,
  route: AppRoute,
  extra?: Partial<Pick<AppState, "officialDocsLocale">>,
): AppState {
  return extra === undefined ? { ...state, route } : { ...state, route, ...extra };
}

function leaveNamed(state: AppState, name: AppRoute["name"]): AppState {
  return state.route.name === name ? go(state, HOME_ROUTE) : state;
}

function isRecordRoute(route: AppRoute): boolean {
  return route.name === "stage" || route.name === "cell" || route.name === "agent";
}

function leaveRecordRoute(state: AppState): AppState {
  return isRecordRoute(state.route) ? go(state, HOME_ROUTE) : state;
}

function resetRecord(state: AppState): AppState {
  return {
    ...state,
    recordRevision: state.recordRevision + 1,
    route: isRecordRoute(state.route) ? HOME_ROUTE : state.route,
    workflow: { kind: "loading" },
    nextStep: { kind: "loading" },
    matrix: { kind: "loading" },
    timings: { kind: "loading" },
    stageDoc: {},
  };
}

function fromReturnTo(returnTo: Selection): AppRoute {
  return returnTo === null ? HOME_ROUTE : selectionRoute(returnTo);
}

function docsRoute(
  action: Extract<Action, { type: "docs-shell" }>,
): [AppRoute, Partial<Pick<AppState, "officialDocsLocale">>?] {
  // Deep-link when `locale` is present (host inject). Locale-only = Shell top.
  // A follow-up `{ open: true }` without locale consumes the one-shot target.
  if (action.locale === undefined) return [{ name: "docs" }];
  const deepLink: DocsDeepLink = {
    locale: action.locale,
    ...(action.path !== undefined && action.path !== "" ? { path: action.path } : {}),
    ...(action.guide !== undefined && action.guide !== "" ? { guide: action.guide } : {}),
    ...(action.anchor !== undefined && action.anchor !== "" ? { anchor: action.anchor } : {}),
    ...(action.chat !== undefined ? { chat: action.chat } : {}),
  };
  return [{ name: "docs", deepLink }, { officialDocsLocale: action.locale }];
}

/** Keep a loaded list and move its view pin. An unloaded list has nothing to move. */
function selectIntent(view: ViewState<IntentList>, intent: string | null): ViewState<IntentList> {
  if (view.kind !== "success" && view.kind !== "partial") return view;
  return { ...view, value: { ...view.value, selected: intent } };
}

function applyWs(state: AppState, message: WsMessage, receivedAt: string): AppState {
  switch (message.type) {
    case "customization-changed":
      return { ...state, customizationRefresh: state.customizationRefresh + 1 };
    case "matrix-ready":
      return {
        ...state,
        matrix: deriveViewState({ ok: true, value: message.matrix }, matrixNotes),
      };

    case "live-status":
      // Rebuilt rather than spread: a `degraded:false` message with no reason
      // must not leave the previous reason standing.
      return {
        ...state,
        live: {
          connected: state.live.connected,
          everConnected: state.live.everConnected,
          reconnects: state.live.reconnects,
          degraded: message.degraded,
          ...carry(state.live.lastChangeAt),
          ...(message.reason === undefined ? {} : { reason: message.reason }),
        },
      };

    case "change": {
      // Any change push proves the watch pipeline is alive, so the timestamp
      // is stamped once here for every scope — including `audit`, which
      // renders nothing but is still evidence of liveness.
      const live = { ...state.live, lastChangeAt: receivedAt };

      switch (message.scope) {
        case "state": {
          const { workflow, nextStep } = deriveWorkflow({
            ok: true,
            value: {
              workflow: message.workflow,
              nextStep: message.nextStep,
            },
            ...(message.warnings === undefined ? {} : { warnings: message.warnings }),
          });
          return { ...state, live, workflow, nextStep };
        }

        case "audit":
          // Explicitly ignored, not defaulted: this unit renders no audit view
          // (SC-UI-3 / BLM step 4). A future audit surface adds a case here
          // instead of silently inheriting a fallthrough. Only `live` moves.
          return { ...state, live };

        default:
          return applyMatrixScope({ ...state, live }, message.scope, message.cells);
      }
    }

    case "space-selected":
      return {
        ...resetRecord(state),
        intents: {
          kind: "success",
          value: {
            space: message.space,
            active: null,
            selected: message.intent,
            all: message.intent === null ? [] : [message.intent],
          },
        },
        live: { ...state.live, lastChangeAt: receivedAt },
      };

    case "intent-selected":
      // Close record-scoped UI, move the pin to the intent the server named,
      // and drop the previous record's timings. The snapshot that follows
      // confirms the same pin. lastChangeAt restarts the timings poll.
      return {
        ...state,
        recordRevision: state.recordRevision + 1,
        route: isRecordRoute(state.route) ? HOME_ROUTE : state.route,
        stageDoc: {},
        timings: { kind: "loading" },
        intents: selectIntent(state.intents, message.intent),
        live: { ...state.live, lastChangeAt: receivedAt },
      };

    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

/** `matrix:<unit>` — replace only that unit's row (BR-DS-5 on the wire). */
function applyMatrixScope(state: AppState, scope: string, cells: MatrixCell[]): AppState {
  const current = state.matrix;
  // Nothing to merge into yet; the pending full fetch will carry the change.
  if (current.kind !== "success" && current.kind !== "partial") return state;

  const unit = scope.slice("matrix:".length);
  const merged: Matrix = {
    units: current.value.units,
    stages: current.value.stages,
    cells: [...current.value.cells.filter((cell) => cell.unit !== unit), ...cells],
  };
  return { ...state, matrix: deriveViewState({ ok: true, value: merged }, matrixNotes) };
}
