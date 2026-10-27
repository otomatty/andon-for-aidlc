import { act, renderHook } from "@tests/render.tsx";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNowDisclosure } from "@/hooks/useNowDisclosure.ts";
import { createVscodeTransport } from "@/services/transport/vscode.ts";

function restore(expanded: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: "now-disclosure", expanded } }));
}

function host(saved?: unknown): { posted: unknown[]; acquire: ReturnType<typeof vi.fn> } {
  const posted: unknown[] = [];
  const acquire = vi.fn(() => ({
    postMessage(message: { type: string }): void {
      posted.push(message);
      if (message.type === "ready" && saved !== undefined) restore(saved);
    },
  }));
  vi.stubGlobal("acquireVsCodeApi", acquire);
  createVscodeTransport();
  return { posted, acquire };
}

afterEach(() => vi.unstubAllGlobals());

describe("current-stage disclosure preference", () => {
  it("starts closed and works without the VS Code host", () => {
    const { result, rerender } = renderHook(() => useNowDisclosure());
    expect(result.current.expanded).toBe(false);
    act(() => result.current.setExpanded(true));
    rerender();
    expect(result.current.expanded).toBe(true);
    act(() => result.current.setExpanded(false));
    expect(result.current.expanded).toBe(false);
  });

  it("restores a ready reply received before React mounts, including Strict Mode", () => {
    const { posted, acquire } = host(true);
    const { result } = renderHook(() => useNowDisclosure(), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    expect(result.current.expanded).toBe(true);
    // Bootstrap itself must not overwrite the workspace preference.
    expect(posted).toEqual([{ type: "ready" }]);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("restores after React mounts without acquiring the API twice", () => {
    const { acquire } = host();
    const { result } = renderHook(() => useNowDisclosure());
    act(() => restore(true));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.setExpanded(false));
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("retains a user change when a stale restore arrives afterwards", () => {
    const { posted } = host();
    const { result } = renderHook(() => useNowDisclosure());
    act(() => result.current.setExpanded(true));
    act(() => restore(false));
    expect(result.current.expanded).toBe(true);
    expect(posted).toEqual([{ type: "ready" }, { type: "now-disclosure", expanded: true }]);
  });

  it("also retains the last of several clicks over a delayed restore", () => {
    const { posted } = host();
    const { result } = renderHook(() => useNowDisclosure());
    act(() => result.current.setExpanded(true));
    act(() => result.current.setExpanded(false));
    act(() => restore(true));
    expect(result.current.expanded).toBe(false);
    expect(posted.slice(1)).toEqual([
      { type: "now-disclosure", expanded: true },
      { type: "now-disclosure", expanded: false },
    ]);
  });

  it.each([null, "true", 1, {}, []])("ignores an invalid host value: %j", (value) => {
    host(value);
    const { result } = renderHook(() => useNowDisclosure());
    expect(result.current.expanded).toBe(false);
    act(() => restore(value));
    expect(result.current.expanded).toBe(false);
  });

  it("restores the saved choice when a new panel mounts", () => {
    const firstHost = host(false);
    const first = renderHook(() => useNowDisclosure());
    act(() => first.result.current.setExpanded(true));
    expect(firstHost.posted.at(-1)).toEqual({ type: "now-disclosure", expanded: true });
    first.unmount();

    const secondHost = host(true);
    const second = renderHook(() => useNowDisclosure());
    expect(second.result.current.expanded).toBe(true);
    expect(secondHost.posted).toEqual([{ type: "ready" }]);
  });
});
