import type { WsMessage } from "@andon/shared-types";
import { reportVersionGate } from "@/services/version-gate.ts";

export type GetJsonResult = { reached: true; body: unknown } | { reached: false };

/**
 * How long a GET may stay outstanding before the transport gives up on it,
 * settles it as unreached, and releases whatever it was holding.
 *
 * Neither transport bounded a request before (Codex review on PR #18): a
 * `fetch` against a wedged connection has no timeout of its own, and the VS
 * Code transport resolves only when the extension host posts a matching
 * `get-response`, so a stranded host left the resolver in `pendingGet` for the
 * life of the webview. One user-initiated read stalling is a visible bug; the
 * dashboard's timings poll made it an accumulating one, since it asks again
 * every 30s whether or not the last answer ever came.
 *
 * 20s, deliberately under `App.tsx`'s `TIMINGS_POLL_MS`: every request the
 * poll issues is resolved — one way or the other — before the next one goes
 * out, so nothing piles up and the poll is single-flight in fact and not just
 * in shape. It is also far outside any real read: NFR-2 budgets 3s for the
 * whole first paint against the 593-file fixture, and `/api/timings` measures
 * ~90ms warm.
 */
export const GET_TIMEOUT_MS = 20_000;
/** A timed-out mutation has an unknown outcome; callers query its request ID. */
export const POST_TIMEOUT_MS = 30_000;
/** The engine's candidate builder has a 120-second bound. */
export const CUSTOMIZATION_POST_TIMEOUT_MS = 130_000;
export const postTimeoutMs = (path: string): number =>
  path.startsWith("/api/customization/") ? CUSTOMIZATION_POST_TIMEOUT_MS : POST_TIMEOUT_MS;

export interface PostJsonResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface SubscribeOptions {
  wsUrl?: string;
  /** Injected in tests; defaults to the platform WebSocket constructor. */
  createWebSocket?: (url: string) => WebSocket;
  onConnect: () => void;
  onDisconnect: () => void;
  onMessage: (message: WsMessage) => void;
}

/**
 * Pluggable wire layer for the dashboard UI.
 * Browser: fetch + WebSocket. VS Code webview: postMessage to extension host.
 */
export interface Transport {
  getJson(path: string): Promise<GetJsonResult>;
  postJson(path: string, body: unknown): Promise<PostJsonResult>;
  /** Push subscription. Returns unsubscribe. */
  subscribe(options: SubscribeOptions): () => void;
}

let active: Transport | null = null;

/**
 * Every response, GET or POST, may be the server's version-gate refusal: a
 * project updated while a tab is open is first noticed by whichever request
 * reaches the server next, which can be an answer or a customization save.
 */
function reportingVersionGate(transport: Transport): Transport {
  return {
    async getJson(path) {
      const result = await transport.getJson(path);
      if (result.reached) reportVersionGate(result.body);
      return result;
    },
    async postJson(path, body) {
      const result = await transport.postJson(path, body);
      reportVersionGate(result.body);
      return result;
    },
    subscribe: (options) => transport.subscribe(options),
  };
}

export function setTransport(transport: Transport): void {
  active = reportingVersionGate(transport);
}

export function getTransport(): Transport {
  if (active === null) {
    throw new Error("Transport not initialized — call initTransport() in main.tsx");
  }
  return active;
}

/** Detect VS Code webview vs browser and install the default transport. */
export async function initTransport(): Promise<Transport> {
  if (active !== null) return active;

  const vscodeApi =
    typeof window !== "undefined" &&
    "acquireVsCodeApi" in window &&
    typeof (window as Window & { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi ===
      "function";

  if (vscodeApi) {
    const { createVscodeTransport } = await import("./vscode.ts");
    active = reportingVersionGate(createVscodeTransport());
  } else {
    const { createBrowserTransport } = await import("./browser.ts");
    active = reportingVersionGate(createBrowserTransport());
  }
  return active;
}

export function wsUrlFromLocation(location: { protocol: string; host: string }): string {
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}
