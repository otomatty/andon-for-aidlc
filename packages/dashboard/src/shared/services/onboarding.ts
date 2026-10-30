import type { OnboardingEvent, OnboardingSnapshot } from "@andon/shared-types";
import type { Dispatch } from "react";
import type { Action } from "@/store/reducer.ts";
import { vsCodeApi } from "./vscode-api.ts";

type SnapshotHandler = (snapshot: OnboardingSnapshot) => void;

const handlers = new Set<SnapshotHandler>();
// The transport starts before React, so the `ready` reply may land first.
let pending: OnboardingSnapshot | null = null;

/** Subscribe to the host's onboarding snapshot. Returns the unsubscribe. */
export function onOnboardingSnapshot(handler: SnapshotHandler): () => void {
  handlers.add(handler);
  if (pending !== null) {
    const snapshot = pending;
    pending = null;
    handler(snapshot);
  }
  return () => {
    handlers.delete(handler);
  };
}

/** Called by the VS Code transport with an already validated snapshot. */
export function deliverOnboardingSnapshot(snapshot: OnboardingSnapshot): void {
  if (handlers.size === 0) {
    pending = snapshot;
    return;
  }
  pending = null;
  for (const handler of handlers) handler(snapshot);
}

/**
 * Apply an onboarding event locally and send it to the host, which validates
 * and stores it. The browser dashboard has no host and keeps nothing.
 */
export function emitOnboardingEvent(dispatch: Dispatch<Action>, event: OnboardingEvent): void {
  dispatch({ type: "onboarding-event", event });
  vsCodeApi()?.postMessage({ type: "onboarding-event", event });
}
