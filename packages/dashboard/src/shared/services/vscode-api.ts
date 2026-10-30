/**
 * The one place `acquireVsCodeApi()` is ever called.
 *
 * VS Code allows it **once per webview** and throws
 * `An instance of the VS Code API has already been acquired` on every call
 * after the first. Three call sites had grown up independently — the transport
 * on boot, a since-removed doc opener, and `openFileInIde` — so in a real webview the first
 * one won and the other two threw before they could post anything. Nothing
 * caught it, because a test stub is happy to be acquired twice.
 *
 * So this is a single enforcement point rather than a convention: there is one
 * function to call, and it hands back the same instance every time.
 */

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

/**
 * Keyed on the identity of `acquireVsCodeApi` rather than a plain boolean, so
 * the memo re-acquires when — and only when — the global is a different
 * function than the one it holds. In a webview that global never changes, so
 * this acquires exactly once; under `vi.stubGlobal` each stub is a new
 * function, so tests get a clean instance without a reset hook in `src/`.
 */
let source: (() => VsCodeApi) | undefined;
let cached: VsCodeApi | null = null;

export function vsCodeApi(): VsCodeApi | null {
  const acquire = window.acquireVsCodeApi;
  if (acquire === source) return cached;
  source = acquire;
  cached = typeof acquire === "function" ? acquire() : null;
  return cached;
}

/** Whether this bundle is running inside a VS Code webview. Never acquires. */
export function inVsCodeWebview(): boolean {
  return typeof window.acquireVsCodeApi === "function";
}
