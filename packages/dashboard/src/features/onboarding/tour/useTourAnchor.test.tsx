import { act, renderHook, waitFor } from "@tests/render.tsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TourAnchor } from "./steps.ts";
import { ANCHOR_TIMEOUT_MS, useTourAnchor } from "./useTourAnchor.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function element(value: string, box = { top: 10, left: 20, width: 30, height: 40 }) {
  const node = document.createElement("div");
  node.setAttribute("data-onboarding", value);
  const scroll = vi.fn();
  node.scrollIntoView = scroll;
  let current = box;
  node.getBoundingClientRect = () =>
    ({
      ...current,
      x: current.left,
      y: current.top,
      right: current.left + current.width,
      bottom: current.top + current.height,
      toJSON: () => current,
    }) as DOMRect;
  return {
    node,
    scroll,
    move(next: typeof box) {
      current = next;
    },
  };
}

const anchor = (value: string): TourAnchor => ({ attr: "data-onboarding", value });

describe("useTourAnchor", () => {
  it("waits for an element that appears later, then brings it into view", async () => {
    const { result } = renderHook(() => useTourAnchor(anchor("late")));
    expect(result.current.status).toBe("searching");
    const late = element("late");
    act(() => document.body.append(late.node));
    await waitFor(() => expect(result.current.status).toBe("found"));
    expect(result.current.element).toBe(late.node);
    expect(result.current.box).toEqual({ top: 10, left: 20, width: 30, height: 40 });
    expect(late.scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("jumps instead of animating for users who prefer reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      addEventListener() {},
      removeEventListener() {},
    }));
    const now = element("now");
    document.body.append(now.node);
    const { result } = renderHook(() => useTourAnchor(anchor("now")));
    await waitFor(() => expect(result.current.status).toBe("found"));
    expect(now.scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("settles as missing when the element never appears", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { result } = renderHook(() => useTourAnchor(anchor("never")));
    act(() => {
      vi.advanceTimersByTime(ANCHOR_TIMEOUT_MS - 1);
    });
    expect(result.current.status).toBe("searching");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.status).toBe("missing");
    expect(result.current.element).toBeNull();
    // An element that shows up after giving up does not revive the step.
    act(() => document.body.append(element("never").node));
    expect(result.current.status).toBe("missing");
  });

  it("follows the element as it moves, without waiting for a scroll or resize event", async () => {
    const moving = element("moving");
    document.body.append(moving.node);
    const { result, unmount } = renderHook(() => useTourAnchor(anchor("moving")));
    await waitFor(() => expect(result.current.box?.top).toBe(10));
    moving.move({ top: 50, left: 20, width: 30, height: 40 });
    await waitFor(() => expect(result.current.box?.top).toBe(50));
    moving.move({ top: 70, left: 25, width: 30, height: 40 });
    await waitFor(() =>
      expect(result.current.box).toEqual({ top: 70, left: 25, width: 30, height: 40 }),
    );
    // Tracking stops with the step.
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it("starts over for the next step", async () => {
    const first = element("first");
    const second = element("second");
    document.body.append(first.node, second.node);
    const { result, rerender } = renderHook(({ value }) => useTourAnchor(anchor(value)), {
      initialProps: { value: "first" },
    });
    await waitFor(() => expect(result.current.element).toBe(first.node));
    rerender({ value: "second" });
    await waitFor(() => expect(result.current.element).toBe(second.node));
    expect(second.scroll).toHaveBeenCalledOnce();
  });
});
