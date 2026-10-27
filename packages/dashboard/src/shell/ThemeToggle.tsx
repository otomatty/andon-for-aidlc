import { MoonIcon, SunIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAppState, useDispatch } from "@/store/context.tsx";
import type { Theme } from "@/store/state.ts";
import { isVsCodeWebview, watchVsCodeTheme } from "@/theme/host.ts";

/** Click toggles light ↔ dark. Writes `class="dark"` and `data-theme` for compat. */
export function applyTheme(theme: Theme, root: HTMLElement): void {
  root.classList.toggle("dark", theme === "dark");
  root.setAttribute("data-theme", theme);
}

export function nextTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}

/**
 * Browser: local light/dark toggle.
 * VS Code webview: follows the editor theme (no toggle). MantineRoot takes the
 * editor's light/dark, and globals.css maps the colours to the theme's `--vscode-*`.
 */
export function ThemeToggle(): ReactNode {
  const { theme } = useAppState();
  const dispatch = useDispatch();
  const vscode = isVsCodeWebview();

  useEffect(() => {
    if (vscode) return watchVsCodeTheme();
    applyTheme(theme, document.documentElement);
  }, [theme, vscode]);

  if (vscode) return null;

  const toDark = theme === "light";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      data-testid="theme-toggle"
      aria-pressed={theme === "dark"}
      aria-label={toDark ? "ダークテーマに切り替え" : "ライトテーマに切り替え"}
      title={toDark ? "ダークテーマ" : "ライトテーマ"}
      onClick={() => {
        dispatch({ type: "theme", theme: nextTheme(theme) });
      }}
    >
      {toDark ? <MoonIcon /> : <SunIcon />}
    </Button>
  );
}
