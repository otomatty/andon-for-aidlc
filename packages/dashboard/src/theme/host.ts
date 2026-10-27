/**
 * VS Code webview host detection + theme sync.
 * Webview body gets `vscode-light` / `vscode-dark` / `vscode-high-contrast` /
 * `vscode-high-contrast-light`; we mirror dark into `html.dark` and high
 * contrast into `html[data-contrast="high"]`.
 */

type HostWindow = { acquireVsCodeApi?: unknown };

export function isVsCodeWebview(win: HostWindow = window as HostWindow): boolean {
  return typeof win.acquireVsCodeApi === "function";
}

/** True when the webview body class indicates a dark (or dark HC) theme. */
export function isVsCodeDarkBody(body: Element): boolean {
  const classes = body.classList;
  if (classes.contains("vscode-high-contrast-light")) return false;
  if (classes.contains("vscode-high-contrast")) return true;
  return classes.contains("vscode-dark");
}

/** True for both high contrast editor themes, dark and light. */
export function isVsCodeHighContrastBody(body: Element): boolean {
  const classes = body.classList;
  return classes.contains("vscode-high-contrast") || classes.contains("vscode-high-contrast-light");
}

/** Mark the document as VS Code-hosted and sync `.dark` / `data-theme` / `data-contrast`. */
export function applyVsCodeHost(root: HTMLElement, body: Element = document.body): void {
  root.setAttribute("data-host", "vscode");
  syncVsCodeTheme(root, body);
}

export function syncVsCodeTheme(root: HTMLElement, body: Element = document.body): void {
  const dark = isVsCodeDarkBody(body);
  root.classList.toggle("dark", dark);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  // globals.css swaps the Mantine palette for the editor's own colours here.
  if (isVsCodeHighContrastBody(body)) root.setAttribute("data-contrast", "high");
  else root.removeAttribute("data-contrast");
}

/**
 * Keep `html.dark` in lockstep when the user changes the VS Code color theme.
 * Returns an unsubscribe function.
 */
export function watchVsCodeTheme(
  root: HTMLElement = document.documentElement,
  body: Element = document.body,
): () => void {
  applyVsCodeHost(root, body);
  const observer = new MutationObserver(() => {
    syncVsCodeTheme(root, body);
  });
  observer.observe(body, { attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
  };
}
