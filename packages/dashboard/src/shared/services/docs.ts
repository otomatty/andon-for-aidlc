import type { OfficialDocsLocale, OpenOfficialDocMessage, StageDocRef } from "@andon/shared-types";
import { useEffect, useMemo, useRef } from "react";
import { routeSelection } from "@/app/routes.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { deriveViewState } from "@/store/derive-view-state.ts";
import type { Selection } from "@/store/state.ts";
import { fetchLinks, fetchStageDoc } from "./api.ts";
import { inVsCodeWebview, vsCodeApi } from "./vscode-api.ts";

/**
 * On-demand fetches (BLM steps 6/7) — deliberately off the first-paint path
 * (P-UI-2) — plus the one place deep-link hrefs are built (S-UI-4).
 */

/** Which stage a selection explains; a matrix cell explains its column. */
export function slugOf(selection: Selection): string | null {
  if (selection === null) return null;
  return selection.kind === "stage" ? selection.slug : selection.stage;
}

/**
 * Step 6: fetch on selection, once per slug per session. The memo *is* the
 * `stageDoc` slice — a second cache would be a second truth.
 */
export function useStageDoc(): void {
  const state = useAppState();
  const dispatch = useDispatch();
  const slug = slugOf(routeSelection(state.route));
  const cached = slug === null ? undefined : state.stageDoc[slug];
  const known = cached !== undefined;
  const recordRevision = state.recordRevision;

  useEffect(() => {
    if (slug === null || known) return;
    dispatch({ type: "stage-doc", slug, state: { kind: "loading" } });
    void fetchStageDoc(slug).then((result) => {
      // Always dispatched, even if the user has moved on: the slice is keyed
      // by slug, so a late answer fills its own slot instead of clobbering the
      // current one. Dropping it would leave that slug stuck on "loading"
      // forever, because `known` already suppresses a second fetch.
      dispatch({ type: "stage-doc", slug, state: deriveViewState(result), recordRevision });
    });
  }, [slug, known, dispatch, recordRevision]);
}

/**
 * slug → purpose over every stage doc that has landed. The rail and its
 * dialog twin both consume this; one memoised derivation, not one per caller.
 */
export function useStagePurposes(): Record<string, string> {
  const stageDoc = useAppState().stageDoc;
  return useMemo(() => {
    const purposes: Record<string, string> = {};
    for (const [slug, doc] of Object.entries(stageDoc)) {
      if (doc.kind === "success" || doc.kind === "partial") {
        purposes[slug] = doc.value.purpose;
      }
    }
    return purposes;
  }, [stageDoc]);
}

/**
 * Prefetch stage purposes for the rail when the viewport is wide enough to
 * show them. Off the first-paint path (idle), and skipped on narrow screens.
 */
export function usePrefetchStageDocs(slugs: readonly string[]): void {
  const state = useAppState();
  const dispatch = useDispatch();
  const stageDocRef = useRef(state.stageDoc);
  stageDocRef.current = state.stageDoc;
  const roster = slugs.join("\0");
  const recordRevision = state.recordRevision;

  useEffect(() => {
    if (roster === "") return;
    const list = roster.split("\0");
    // jsdom has no matchMedia; treat as wide so purposes still warm in tests.
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 48rem)")
        : ({
            matches: true,
            addEventListener: () => {},
            removeEventListener: () => {},
          } as unknown as MediaQueryList);
    let cancelled = false;
    let cancelScheduled: (() => void) | undefined;
    const inFlight = new Set<string>();

    const prefetch = (): void => {
      if (cancelled || !mq.matches) return;
      for (const slug of list) {
        if (stageDocRef.current[slug] !== undefined || inFlight.has(slug)) continue;
        inFlight.add(slug);
        dispatch({ type: "stage-doc", slug, state: { kind: "loading" } });
        void fetchStageDoc(slug).then((result) => {
          inFlight.delete(slug);
          // Always dispatch (same as useStageDoc): the slice is keyed by slug.
          // Dropping a late answer after cancel leaves that slug stuck on loading.
          dispatch({ type: "stage-doc", slug, state: deriveViewState(result), recordRevision });
        });
      }
    };

    const schedule = (): void => {
      cancelScheduled?.();
      const idle = window.requestIdleCallback;
      if (typeof idle === "function") {
        const handle = idle(prefetch, { timeout: 2000 });
        cancelScheduled = () => {
          window.cancelIdleCallback(handle);
        };
        return;
      }
      const timer = setTimeout(prefetch, 0);
      cancelScheduled = () => {
        clearTimeout(timer);
      };
    };

    schedule();
    mq.addEventListener("change", schedule);
    return () => {
      cancelled = true;
      cancelScheduled?.();
      mq.removeEventListener("change", schedule);
    };
  }, [roster, dispatch, recordRevision]);
}

/** Step 7: header links, after first paint — never on the critical path. */
export function useProjectLinks(): void {
  const dispatch = useDispatch();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = (): void => {
      void fetchLinks().then((result) => {
        dispatch({ type: "links", result });
      });
    };

    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(run, { timeout: 2000 });
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    // Safari and jsdom have no requestIdleCallback; a macrotask is close
    // enough — the point is only "after the first paint".
    const timer = setTimeout(run, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [dispatch]);
}

/**
 * S-UI-4: only `http(s)` and same-origin relative paths become hrefs. Anything
 * else (`javascript:`, `file:`, `data:`) is refused — the values come from a
 * config file the user edits, which is still not a reason to open them blindly.
 */
export function safeHref(target: string): string | null {
  const trimmed = target.trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A scheme-ish prefix on something that is not http(s).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;
  return trimmed;
}

export function isExternal(target: string): boolean {
  return /^https?:\/\//i.test(target.trim());
}

export function canOpenDocsInIde(): boolean {
  return inVsCodeWebview();
}

/**
 * Title-case a stage slug for OpenOfficialDocLink (`intent-capture` → `Intent Capture`).
 * StageDoc has no display-name field; purpose is a sentence, not a label.
 */
export function stageDisplayName(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Build `open-official-doc` payload from stage-map lookup (Bolt 3).
 * Mapped: locale + path (+ optional anchor). Unmapped: locale only — omit path/anchor keys.
 */
export function buildOpenOfficialDocMessage(
  locale: OfficialDocsLocale,
  ref: StageDocRef | null,
): OpenOfficialDocMessage {
  const resolvedLocale: OfficialDocsLocale = locale === "ja" ? "ja" : "en";
  if (ref === null || ref.path.length < 1) {
    return { type: "open-official-doc", locale: resolvedLocale };
  }
  return {
    type: "open-official-doc",
    locale: resolvedLocale,
    path: ref.path,
    ...(ref.anchor !== undefined && ref.anchor !== "" ? { anchor: ref.anchor } : {}),
  };
}

/** Post `open-official-doc` to the VS Code host (Docs Shell inject path). */
export function openOfficialDocInIde(message: OpenOfficialDocMessage): boolean {
  const api = vsCodeApi();
  if (api === null) return false;
  api.postMessage(message);
  return true;
}

/**
 * Ask the VS Code host to open a workspace file, focused on `line`.
 *
 * A separate message from `open-doc` because the two resolve differently:
 * `open-doc` takes a bridge-map path against `docsRepoPath`, this takes a
 * citation out of an artifact — often only a basename — against the workspace.
 * The parameter is structural rather than `FileRef` so this module keeps its
 * one-way dependency on the viewer (the viewer imports services, not back).
 */
export function openFileInIde(
  ref: { path: string; line: number | null },
  options?: { beside?: boolean; base?: "workspace" | "record"; preview?: boolean },
): boolean {
  const api = vsCodeApi();
  if (api === null) return false;
  api.postMessage({
    type: "open-file",
    path: ref.path,
    line: ref.line,
    ...(options?.beside === true ? { beside: true } : {}),
    ...(options?.base === "record" ? { base: "record" } : {}),
    ...(options?.preview === false ? { preview: false } : {}),
  });
  return true;
}

/**
 * Open a record-relative Markdown artifact in the IDE editor as a lasting tab
 * in the active group (no Beside split, not a transient preview tab).
 */
export function editFileInIde(path: string): boolean {
  return openFileInIde({ path, line: null }, { base: "record", preview: false });
}
