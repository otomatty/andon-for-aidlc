/**
 * The colours of the extension's own HTML webviews (setup, update), drawn like
 * the dashboard's (globals.css): from the editor theme the user has chosen,
 * which VS Code hands the page as `--vscode-*` variables, with the theme's kind
 * on <body> as a class. Surfaces and lines are steps between the editor
 * background and foreground, at the distances of Mantine's light and dark
 * palettes; buttons, links, focus and errors take the theme's own colours. The
 * success and warning colours stay Mantine's, as the dashboard's status colours
 * do. The high contrast themes draw lines in the contrast border and no tints.
 */
export const webviewThemeStyles = `
body {
  --m-body: var(--vscode-editor-background); --m-text: var(--vscode-editor-foreground);
  --m-card: var(--m-body); --m-bright: var(--m-text);
  --m-dimmed: var(--vscode-descriptionForeground, var(--m-text));
  --m-border: color-mix(in srgb, var(--m-text) 11%, var(--m-body));
  --m-input-border: color-mix(in srgb, var(--m-text) 17%, var(--m-body));
  --m-hover: color-mix(in srgb, var(--m-text) 3%, var(--m-body));
  --m-track: color-mix(in srgb, var(--m-text) 8%, var(--m-body));
  --m-code: color-mix(in srgb, var(--m-text) 5%, var(--m-body));
  --m-primary: var(--vscode-button-background); --m-primary-hover: var(--vscode-button-hoverBackground, var(--m-primary));
  --m-primary-contrast: var(--vscode-button-foreground); --m-primary-border: var(--vscode-button-border, transparent);
  --m-primary-light: color-mix(in srgb, var(--vscode-textLink-foreground) 12%, var(--m-body));
  --m-primary-light-color: color-mix(in srgb, var(--vscode-textLink-foreground) 80%, var(--m-text));
  --m-success: #1e7d34; --m-success-light: rgba(64, 192, 87, .1);
  --m-warning: #8a5a00; --m-warning-light: rgba(250, 176, 5, .15);
  --m-error: var(--vscode-errorForeground); --m-error-light: color-mix(in srgb, var(--m-error) 12%, var(--m-body));
  --m-shadow: 0 1px 3px rgba(0, 0, 0, .05), 0 1px 2px rgba(0, 0, 0, .1);
  --m-focus: var(--vscode-focusBorder);
}
body.vscode-dark {
  --m-card: color-mix(in srgb, var(--m-text) 6%, var(--m-body));
  --m-border: color-mix(in srgb, var(--m-text) 18%, var(--m-body));
  --m-input-border: color-mix(in srgb, var(--m-text) 18%, var(--m-body));
  --m-hover: color-mix(in srgb, var(--m-text) 14%, var(--m-body));
  --m-track: color-mix(in srgb, var(--m-text) 18%, var(--m-body));
  --m-code: color-mix(in srgb, var(--m-text) 6%, var(--m-body));
  --m-success: #69db7c; --m-success-light: rgba(64, 192, 87, .15);
  --m-warning: #ffd43b; --m-warning-light: rgba(250, 176, 5, .15);
  --m-shadow: none;
}
body.vscode-high-contrast, body.vscode-high-contrast-light {
  --m-card: var(--m-body);
  --m-border: var(--vscode-contrastBorder, var(--vscode-panel-border));
  --m-input-border: var(--vscode-contrastBorder, var(--vscode-input-border));
  --m-hover: var(--vscode-list-hoverBackground, transparent); --m-track: var(--m-border);
  --m-code: var(--vscode-textCodeBlock-background, transparent);
  --m-primary-light: transparent;
  --m-success: var(--vscode-testing-iconPassed, var(--m-text)); --m-success-light: transparent;
  --m-warning: var(--vscode-editorWarning-foreground, var(--m-text)); --m-warning-light: transparent;
  --m-error-light: transparent;
  --m-shadow: none;
}
`;
