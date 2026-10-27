import { act, renderHook } from "@tests/render.tsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKELETON_DELAY_MS, useDelayedLoading } from "@/hooks/useDelayedLoading.ts";

describe("useDelayedLoading (P-UI-5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays false for anything that resolves inside the threshold", () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedLoading(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(result.current).toBe(false);

    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  it("turns true once the threshold elapses while still loading", () => {
    const { result } = renderHook(() => useDelayedLoading(true));
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(result.current).toBe(true);
  });

  it("resets when loading ends", () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedLoading(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
