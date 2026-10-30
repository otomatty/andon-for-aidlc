import type {
  PluginProgress,
  PluginResult,
  PluginsHostMessage,
  PluginsPanelMessage,
  PluginsState,
} from "@andon/shared-types";
import { useCallback, useEffect, useState } from "react";
import { inVsCodeWebview, vsCodeApi } from "@/services/vscode-api.ts";

export interface PluginsHost {
  /** Whether the page runs inside the extension, which can install. */
  inIde: boolean;
  state: PluginsState | null;
  progress: PluginProgress | null;
  result: PluginResult | null;
  send: (message: PluginsPanelMessage | { type: string; [key: string]: unknown }) => void;
  clearResult: () => void;
}

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "plugins-state",
  "plugins-progress",
  "plugins-result",
]);

/**
 * The extension's side of the 「プラグイン」 page: the page asks for the project's state when it
 * opens and whenever the window regains focus (as the settings page does), and listens for the
 * state, progress and result of an operation. In the browser there is no host and nothing is sent.
 */
export function usePluginsHost(): PluginsHost {
  const inIde = inVsCodeWebview();
  const [state, setState] = useState<PluginsState | null>(null);
  const [progress, setProgress] = useState<PluginProgress | null>(null);
  const [result, setResult] = useState<PluginResult | null>(null);

  useEffect(() => {
    if (!inIde) return;
    const receive = ({ data }: MessageEvent) => {
      if (data === null || typeof data !== "object" || !MESSAGE_TYPES.has(data.type)) return;
      const message = data as PluginsHostMessage;
      if (message.type === "plugins-state") {
        setState(message.state);
        if (message.state.running === null) setProgress(null);
      } else if (message.type === "plugins-progress") setProgress(message.progress);
      else {
        setResult(message.result);
        setProgress(null);
      }
    };
    window.addEventListener("message", receive);
    const refresh = () => vsCodeApi()?.postMessage({ type: "plugins-get" });
    window.addEventListener("focus", refresh);
    refresh();
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("focus", refresh);
    };
  }, [inIde]);

  const send = useCallback<PluginsHost["send"]>((message) => {
    vsCodeApi()?.postMessage(message);
  }, []);
  const clearResult = useCallback(() => setResult(null), []);
  return { inIde, state, progress, result, send, clearResult };
}
