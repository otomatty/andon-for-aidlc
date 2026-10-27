import { act, renderHook } from "@tests/render.tsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKOFF_MS, backoffFor, useLiveConnection, wsUrl } from "@/services/live.ts";
import type { Action } from "@/store/reducer.ts";
import { matrix, payload } from "@tests/fixtures.ts";

/** R-UI-4: reconnect with backoff, and re-read REST state on every open. */

class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const actions: Action[] = [];
  const dispatch = (action: Action): void => {
    actions.push(action);
  };
  const create = (): WebSocket => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  return { sockets, actions, dispatch, create };
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string) =>
    input.includes("/api/matrix")
      ? new Response(JSON.stringify({ ok: true, value: matrix() }))
      : new Response(JSON.stringify(payload())),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe("backoff schedule", () => {
  it("is 1s, 2s, 4s, 8s then capped at 10s", () => {
    expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 10_000]);
    expect([0, 1, 2, 3, 4, 5, 12].map(backoffFor)).toEqual([
      1000, 2000, 4000, 8000, 10_000, 10_000, 10_000,
    ]);
  });

  it("upgrades the socket scheme with the page scheme", () => {
    expect(wsUrl({ protocol: "http:", host: "127.0.0.1:4700" })).toBe("ws://127.0.0.1:4700/ws");
    expect(wsUrl({ protocol: "https:", host: "example:8443" })).toBe("wss://example:8443/ws");
  });
});

describe("useLiveConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reconnects on the backoff schedule after repeated closes", () => {
    const { sockets, create, dispatch } = harness();
    renderHook(() => {
      useLiveConnection(dispatch, { url: "ws://test/ws", create });
    });
    expect(sockets).toHaveLength(1);

    act(() => {
      sockets[0]?.onclose?.();
    });
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(sockets).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sockets).toHaveLength(2);

    // Second failure waits twice as long.
    act(() => {
      sockets[1]?.onclose?.();
    });
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(sockets).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sockets).toHaveLength(3);
  });

  it("re-reads the REST state whenever the socket opens", async () => {
    const fetchMock = stubFetch();
    const { sockets, actions, create, dispatch } = harness();
    renderHook(() => {
      useLiveConnection(dispatch, { url: "ws://test/ws", create });
    });

    act(() => {
      sockets[0]?.onopen?.();
    });
    await vi.waitFor(() => {
      expect(actions.map((action) => action.type)).toContain("matrix");
    });

    const paths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(paths).toContain("/api/workflow");
    expect(paths).toContain("/api/matrix");
    expect(paths).not.toContain("/api/timings");
    expect(actions).toContainEqual({ type: "live", connected: true });
    expect(actions.map((action) => action.type)).toContain("workflow");
  });

  it("refetches REST and stamps intent-selected when the view pin changes", async () => {
    const fetchMock = stubFetch();
    const { sockets, actions, create, dispatch } = harness();
    renderHook(() => {
      useLiveConnection(dispatch, { url: "ws://test/ws", create });
    });
    act(() => {
      sockets[0]?.onopen?.();
    });
    await vi.waitFor(() => {
      expect(actions.map((action) => action.type)).toContain("workflow");
    });
    fetchMock.mockClear();

    act(() => {
      sockets[0]?.onmessage?.({
        data: JSON.stringify({ type: "intent-selected" }),
      } as MessageEvent);
    });
    await vi.waitFor(() => {
      expect(
        actions.some((action) => action.type === "ws" && action.message.type === "intent-selected"),
      ).toBe(true);
    });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain("/api/timings");
  });

  it("resets the backoff after a successful open", () => {
    const { sockets, create, dispatch } = harness();
    stubFetch();
    renderHook(() => {
      useLiveConnection(dispatch, { url: "ws://test/ws", create });
    });

    act(() => {
      sockets[0]?.onclose?.();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      sockets[1]?.onopen?.();
    });
    act(() => {
      sockets[1]?.onclose?.();
    });
    // Back to the first rung, not the second.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(sockets).toHaveLength(3);
  });

  it("dispatches parsed frames and drops unparseable ones", () => {
    const { sockets, actions, create, dispatch } = harness();
    renderHook(() => {
      useLiveConnection(dispatch, { url: "ws://test/ws", create });
    });

    act(() => {
      sockets[0]?.onmessage?.({
        data: JSON.stringify({ type: "live-status", degraded: true }),
      } as MessageEvent);
      sockets[0]?.onmessage?.({ data: "{not json" } as MessageEvent);
    });

    const ws = actions.filter((action) => action.type === "ws");
    expect(ws).toHaveLength(1);
  });

  it("closes the socket and stops reconnecting on unmount", () => {
    const { sockets, create, dispatch } = harness();
    const { unmount } = renderHook(() => {
      useLiveConnection(dispatch, { url: "ws://test/ws", create });
    });
    unmount();
    expect(sockets[0]?.closed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(sockets).toHaveLength(1);
  });
});
