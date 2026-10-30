import { parseOnboardingSnapshot, type WsMessage } from "@aidlc-guide/shared-types";
import {
  deliverDocsShellDeepLink,
  deliverOfficialDocsLocale,
  parseDocsShellDeepLink,
} from "@/services/docs-shell-inject.ts";
import { deliverNowDisclosureRestore } from "@/services/now-disclosure-inject.ts";
import { deliverOnboardingSnapshot } from "@/services/onboarding.ts";
import { vsCodeApi } from "@/services/vscode-api.ts";
import type { SubscribeOptions, Transport } from "./types.ts";
import { GET_TIMEOUT_MS, postTimeoutMs } from "./types.ts";

type PendingGet = (result: { reached: true; body: unknown } | { reached: false }) => void;
type PendingPost = (result: { ok: boolean; status: number; body: unknown }) => void;

/**
 * VS Code webview transport — all I/O goes through the extension host, which
 * runs api-core directly (no HTTP port in the IDE path).
 */
export function createVscodeTransport(): Transport {
  const vscode = vsCodeApi();
  if (vscode === null) {
    throw new Error("acquireVsCodeApi is not available");
  }

  const pendingGet = new Map<string, PendingGet>();
  const pendingPost = new Map<string, PendingPost>();
  const pushHandlers = new Set<SubscribeOptions>();

  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as Record<string, unknown>;
    if (typeof data !== "object" || data === null) return;

    if (data.type === "get-response" && typeof data.id === "string") {
      const resolve = pendingGet.get(data.id);
      if (resolve === undefined) return;
      pendingGet.delete(data.id);
      if (data.reached === true) {
        resolve({ reached: true, body: data.body });
      } else {
        resolve({ reached: false });
      }
      return;
    }

    if (data.type === "post-response" && typeof data.id === "string") {
      const resolve = pendingPost.get(data.id);
      if (resolve === undefined) return;
      pendingPost.delete(data.id);
      resolve({
        ok: data.ok === true,
        status: typeof data.status === "number" ? data.status : 0,
        body: data.body,
      });
      return;
    }

    if (data.type === "docs-shell-deeplink") {
      const deepLink = parseDocsShellDeepLink(data);
      if (deepLink === null) return;
      deliverDocsShellDeepLink(deepLink);
      return;
    }

    if (data.type === "official-docs-locale" && (data.locale === "en" || data.locale === "ja")) {
      deliverOfficialDocsLocale(data.locale);
      return;
    }

    if (data.type === "now-disclosure" && typeof data.expanded === "boolean") {
      deliverNowDisclosureRestore(data.expanded);
      return;
    }

    if (data.type === "onboarding") {
      const snapshot = parseOnboardingSnapshot(data.state);
      if (snapshot !== null) deliverOnboardingSnapshot(snapshot);
      return;
    }

    if (data.type === "push" && data.message !== undefined) {
      const message = data.message as WsMessage;
      for (const handler of pushHandlers) {
        handler.onMessage(message);
      }
    }

    if (data.type === "connected") {
      for (const handler of pushHandlers) {
        handler.onConnect();
      }
    }
  });

  vscode.postMessage({ type: "ready" });

  return {
    getJson(path) {
      return new Promise((resolve) => {
        const id = crypto.randomUUID();
        // Nothing else can settle this promise: it waits on a `get-response`
        // that a restarted host or a disposed panel will never post, and the
        // entry would sit in `pendingGet` for the life of the webview while
        // the caller waited on it forever (Codex review on PR #18). The
        // deadline drops the entry and answers "unreachable" — the same state
        // a failed HTTP read produces, which every caller already renders.
        const deadline = setTimeout(() => {
          pendingGet.delete(id);
          resolve({ reached: false });
        }, GET_TIMEOUT_MS);
        pendingGet.set(id, (result) => {
          clearTimeout(deadline);
          resolve(result);
        });
        vscode.postMessage({ type: "get", id, path });
      });
    },

    postJson(path, body) {
      return new Promise((resolve) => {
        const id = crypto.randomUUID();
        const deadline = setTimeout(() => {
          pendingPost.delete(id);
          resolve({ ok: false, status: 0, body: {} });
        }, postTimeoutMs(path));
        pendingPost.set(id, (result) => {
          clearTimeout(deadline);
          resolve(result);
        });
        try {
          vscode.postMessage({ type: "post", id, path, body });
        } catch {
          clearTimeout(deadline);
          pendingPost.delete(id);
          resolve({ ok: false, status: 0, body: {} });
        }
      });
    },

    subscribe(options: SubscribeOptions) {
      pushHandlers.add(options);
      vscode.postMessage({ type: "subscribe" });
      options.onConnect();

      return () => {
        pushHandlers.delete(options);
        vscode.postMessage({ type: "unsubscribe" });
      };
    },
  };
}
