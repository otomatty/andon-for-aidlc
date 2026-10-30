import type { WsMessage } from "@andon/shared-types";
import { type Dispatch, useEffect, useRef } from "react";
import type { Action } from "@/store/reducer.ts";
import { refetchAfterIntentSelect, refetchAfterSpaceSelect, refetchAll } from "./api.ts";
import { BACKOFF_MS, backoffFor, wsUrl } from "./live-backoff.ts";
import { getTransport, type Transport } from "@/services/transport/index.ts";

export { BACKOFF_MS, backoffFor, wsUrl };

export interface LiveOptions {
  url?: string;
  /** Injected in tests; defaults to the platform constructor. */
  create?: (url: string) => WebSocket;
  /** Override transport (tests). */
  transport?: Transport;
}

export function useLiveConnection(dispatch: Dispatch<Action>, options: LiveOptions = {}): void {
  const { url, create, transport: transportOverride } = options;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    const transport = transportOverride ?? getTransport();

    return transport.subscribe({
      ...(url === undefined ? {} : { wsUrl: url }),
      ...(create === undefined ? {} : { createWebSocket: create }),
      onConnect: () => {
        dispatchRef.current({ type: "live", connected: true });
        void refetchAll(dispatchRef.current);
      },
      onDisconnect: () => {
        dispatchRef.current({ type: "live", connected: false });
      },
      onMessage: (message: WsMessage) => {
        if (message.type === "space-selected") {
          void refetchAfterSpaceSelect(dispatchRef.current, message.space, message.intent);
          return;
        }
        if (message.type === "intent-selected") {
          void refetchAfterIntentSelect(dispatchRef.current, message.intent);
          return;
        }
        dispatchRef.current({ type: "ws", message, receivedAt: new Date().toISOString() });
      },
    });
  }, [url, create, transportOverride]);
}
