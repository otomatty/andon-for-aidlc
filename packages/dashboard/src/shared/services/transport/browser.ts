import type { WsMessage } from "@andon/shared-types";
import { backoffFor } from "@/services/live-backoff.ts";
import type { SubscribeOptions, Transport } from "./types.ts";
import { GET_TIMEOUT_MS, postTimeoutMs, wsUrlFromLocation } from "./types.ts";

export function createBrowserTransport(): Transport {
  return {
    async getJson(path) {
      try {
        // `AbortSignal.timeout` rather than a `Promise.race`: racing would
        // leave the request running with its connection held (Codex review on
        // PR #18) — this actually cancels it, and the abort surfaces as the
        // rejection the catch below already turns into "unreachable".
        const response = await fetch(path, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(GET_TIMEOUT_MS),
        });
        return { reached: true, body: (await response.json()) as unknown };
      } catch {
        return { reached: false };
      }
    },

    async postJson(path, body) {
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(postTimeoutMs(path)),
        });
        let parsed: unknown;
        try {
          parsed = (await response.json()) as unknown;
        } catch {
          parsed = {};
        }
        return { ok: response.ok, status: response.status, body: parsed };
      } catch {
        return { ok: false, status: 0, body: {} };
      }
    },

    subscribe(options: SubscribeOptions) {
      const target = options.wsUrl ?? wsUrlFromLocation(window.location);
      const open = options.createWebSocket ?? ((address: string) => new WebSocket(address));

      let attempt = 0;
      let socket: WebSocket | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const connect = (): void => {
        if (stopped) return;
        let next: WebSocket;
        try {
          next = open(target);
        } catch {
          schedule();
          return;
        }
        socket = next;

        next.onopen = () => {
          attempt = 0;
          options.onConnect();
        };

        next.onmessage = (event: MessageEvent) => {
          try {
            const message = JSON.parse(String(event.data)) as WsMessage;
            options.onMessage(message);
          } catch {
            // Drop unparseable frames.
          }
        };

        next.onerror = () => {
          next.close();
        };

        next.onclose = () => {
          options.onDisconnect();
          schedule();
        };
      };

      const schedule = (): void => {
        if (stopped) return;
        const delay = backoffFor(attempt);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };

      connect();

      return () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        if (socket !== null) {
          socket.onclose = null;
          socket.close();
        }
      };
    },
  };
}
