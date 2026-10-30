import type { OnboardingSnapshot } from "@andon/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deliverOnboardingSnapshot,
  emitOnboardingEvent,
  onOnboardingSnapshot,
} from "@/services/onboarding.ts";
import { createVscodeTransport } from "@/services/transport/vscode.ts";

const SNAPSHOT: OnboardingSnapshot = {
  version: "0.35.0",
  record: { version: "0.35.0", welcome: "pending", seenNews: [], dismissedTips: [] },
};

function host(reply?: unknown): unknown[] {
  const posted: unknown[] = [];
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage(message: { type: string }): void {
      posted.push(message);
      if (message.type === "ready" && reply !== undefined)
        window.dispatchEvent(new MessageEvent("message", { data: reply }));
    },
  }));
  createVscodeTransport();
  return posted;
}

afterEach(() => vi.unstubAllGlobals());

describe("onboarding snapshot from the host", () => {
  it("holds a reply that arrives before anyone listens, then delivers it once", () => {
    host({ type: "onboarding", state: SNAPSHOT });
    const first = vi.fn();
    const stop = onOnboardingSnapshot(first);
    expect(first).toHaveBeenCalledExactlyOnceWith(SNAPSHOT);
    stop();
    const second = vi.fn();
    onOnboardingSnapshot(second)();
    expect(second).not.toHaveBeenCalled();
  });

  it("delivers a later snapshot to every listener", () => {
    host();
    const listener = vi.fn();
    const stop = onOnboardingSnapshot(listener);
    deliverOnboardingSnapshot(SNAPSHOT);
    expect(listener).toHaveBeenCalledWith(SNAPSHOT);
    stop();
  });

  it.each([
    { type: "onboarding", state: null },
    { type: "onboarding", state: { version: "0.35.0", record: { welcome: "maybe" } } },
    { type: "onboarding" },
  ])("ignores a malformed snapshot: %j", (message) => {
    host(message);
    const listener = vi.fn();
    onOnboardingSnapshot(listener)();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("emitOnboardingEvent", () => {
  it("updates the view at once and tells the host", () => {
    const posted = host();
    const dispatch = vi.fn();
    emitOnboardingEvent(dispatch, { kind: "tip-dismissed", id: "area:stage" });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "onboarding-event",
      event: { kind: "tip-dismissed", id: "area:stage" },
    });
    expect(posted.at(-1)).toEqual({
      type: "onboarding-event",
      event: { kind: "tip-dismissed", id: "area:stage" },
    });
  });

  it("only updates the view in the browser", () => {
    const dispatch = vi.fn();
    emitOnboardingEvent(dispatch, { kind: "tips-reset" });
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
