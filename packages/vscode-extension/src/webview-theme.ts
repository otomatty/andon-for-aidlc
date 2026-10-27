/**
 * The dashboard's Mantine palette for the extension's own HTML webviews
 * (setup, update), so every AIDLC Guide page reads as one product. VS Code
 * puts the editor theme's kind on <body> as a class; light and dark take
 * Mantine's colours (primary blue shade 8, as in the dashboard theme), and the
 * high contrast themes take the editor's own colours instead.
 */
export const webviewThemeStyles = `
body {
  --m-body: #ffffff; --m-card: #ffffff; --m-text: #000000; --m-bright: #000000;
  --m-dimmed: #495057; --m-border: #dee2e6; --m-input-border: #ced4da;
  --m-hover: #f8f9fa; --m-track: #e9ecef; --m-code: #f1f3f5;
  --m-primary: #1971c2; --m-primary-hover: #1864ab; --m-primary-contrast: #ffffff;
  --m-primary-light: rgba(34, 139, 230, .1); --m-primary-light-color: #1971c2;
  --m-success: #1e7d34; --m-success-light: rgba(64, 192, 87, .1);
  --m-warning: #8a5a00; --m-warning-light: rgba(250, 176, 5, .15);
  --m-error: #c92a2a; --m-error-light: rgba(250, 82, 82, .1);
  --m-shadow: 0 1px 3px rgba(0, 0, 0, .05), 0 1px 2px rgba(0, 0, 0, .1);
  --m-focus: #1971c2;
}
body.vscode-dark {
  --m-body: #242424; --m-card: #2e2e2e; --m-text: #c9c9c9; --m-bright: #ffffff;
  --m-dimmed: #a1a1a1; --m-border: #424242; --m-input-border: #424242;
  --m-hover: #3b3b3b; --m-track: #424242; --m-code: #2e2e2e;
  --m-primary-light: rgba(34, 139, 230, .15); --m-primary-light-color: #74c0fc;
  --m-success: #69db7c; --m-success-light: rgba(64, 192, 87, .15);
  --m-warning: #ffd43b; --m-warning-light: rgba(250, 176, 5, .15);
  --m-error: #ff8787; --m-error-light: rgba(250, 82, 82, .15);
  --m-shadow: none;
}
body.vscode-high-contrast, body.vscode-high-contrast-light {
  --m-body: var(--vscode-editor-background); --m-card: var(--vscode-editor-background);
  --m-text: var(--vscode-foreground); --m-bright: var(--vscode-foreground);
  --m-dimmed: var(--vscode-descriptionForeground, var(--vscode-foreground));
  --m-border: var(--vscode-contrastBorder, var(--vscode-panel-border));
  --m-input-border: var(--vscode-contrastBorder, var(--vscode-input-border));
  --m-hover: var(--vscode-list-hoverBackground, transparent); --m-track: var(--m-border);
  --m-code: var(--vscode-textCodeBlock-background, transparent);
  --m-primary: var(--vscode-button-background); --m-primary-hover: var(--vscode-button-hoverBackground, var(--vscode-button-background));
  --m-primary-contrast: var(--vscode-button-foreground);
  --m-primary-light: transparent; --m-primary-light-color: var(--vscode-textLink-foreground);
  --m-success: var(--vscode-testing-iconPassed, var(--vscode-foreground)); --m-success-light: transparent;
  --m-warning: var(--vscode-editorWarning-foreground, var(--vscode-foreground)); --m-warning-light: transparent;
  --m-error: var(--vscode-errorForeground); --m-error-light: transparent;
  --m-shadow: none; --m-focus: var(--vscode-focusBorder);
}
`;
