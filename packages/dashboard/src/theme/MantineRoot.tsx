import { MantineProvider } from "@mantine/core";
import { type ReactNode, useSyncExternalStore } from "react";
import { useAppState } from "@/store/context.tsx";
import { isVsCodeDarkBody, isVsCodeWebview } from "./host.ts";
import { cssVariablesResolver, mantineTheme, testTheme } from "./mantine-theme.ts";

function subscribeBodyClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
  };
}

function editorScheme(): "dark" | "light" {
  return isVsCodeDarkBody(document.body) ? "dark" : "light";
}

/**
 * Inside the VS Code webview the editor theme decides the colour scheme; in the
 * browser the ThemeToggle state does. Mantine never keeps a choice of its own,
 * so `forceColorScheme` is always set.
 *
 * Under Vitest it takes the same settings as tests/render.tsx: the test theme,
 * no transitions or portals, and no `<style>` tags in the rendered tree.
 */
export function MantineRoot({ children }: { children: ReactNode }): ReactNode {
  const { theme } = useAppState();
  const editor = useSyncExternalStore(subscribeBodyClass, editorScheme, () => "light" as const);
  const test = import.meta.env.MODE === "test";
  return (
    <MantineProvider
      theme={test ? testTheme : mantineTheme}
      cssVariablesResolver={cssVariablesResolver}
      forceColorScheme={isVsCodeWebview() ? editor : theme}
      env={test ? "test" : "default"}
      withCssVariables={!test}
      withGlobalClasses={!test}
    >
      {children}
    </MantineProvider>
  );
}
