import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssRules } from "@tests/css-rules.ts";
import { describe, expect, it } from "vitest";

/**
 * jsdom never applies globals.css, so no DOM test sees the colours the VS Code
 * webview paints. This pins what makes them the editor theme's: the body, text
 * and accents read `--vscode-*`, and every step of Mantine's neutral scale,
 * which the components read directly, is rebuilt from the editor colours.
 */

const GLOBALS_CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), "globals.css");
const css = cssRules(readFileSync(GLOBALS_CSS, "utf8"));

const HOST = 'html[data-host="vscode"][data-mantine-color-scheme]';
const LIGHT = 'html[data-host="vscode"][data-mantine-color-scheme="light"]';
const DARK = 'html[data-host="vscode"][data-mantine-color-scheme="dark"]';
const CONTRAST = 'html[data-host="vscode"][data-contrast="high"][data-mantine-color-scheme]';
const STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function valueOf(selector: string, property: string): string {
  const declarations = css.get(selector);
  if (declarations === undefined) throw new Error(`globals.css has no rule for ${selector}`);
  const found = declarations.findLast((d) => d.startsWith(`${property}:`));
  if (found === undefined) throw new Error(`${selector} sets no ${property}`);
  return found.slice(property.length + 1).trim();
}

/** The share of `colour` in `color-mix(in srgb, colour N%, other)`. */
function share(value: string, colour: string): number {
  const match = value.match(new RegExp(`var\\(${colour}\\) (\\d+)%`));
  if (match === null) throw new Error(`${value} does not mix var(${colour})`);
  return Number(match[1]);
}

describe("globals.css — the VS Code webview takes the editor theme's colours", () => {
  it("paints the body, text, buttons, links and errors from the theme", () => {
    expect(valueOf(HOST, "--editor-bg")).toBe("var(--vscode-editor-background)");
    expect(valueOf(HOST, "--editor-fg")).toBe("var(--vscode-editor-foreground)");
    expect(valueOf(HOST, "--mantine-color-body")).toBe("var(--editor-bg)");
    expect(valueOf(HOST, "--mantine-color-text")).toBe("var(--editor-fg)");
    expect(valueOf(HOST, "--mantine-color-blue-filled")).toBe("var(--vscode-button-background)");
    expect(valueOf(HOST, "--mantine-primary-color-contrast")).toBe(
      "var(--vscode-button-foreground)",
    );
    expect(valueOf(HOST, "--mantine-color-anchor")).toBe("var(--vscode-textLink-foreground)");
    expect(valueOf(HOST, "--mantine-color-error")).toBe("var(--vscode-errorForeground)");
  });

  it("gives the default button the theme's input and list hover colours in high contrast", () => {
    expect(valueOf(CONTRAST, "--mantine-color-default")).toMatch(
      /^var\(--vscode-input-background,/,
    );
    expect(valueOf(CONTRAST, "--mantine-color-default-hover")).toMatch(
      /^var\(--vscode-list-hoverBackground,/,
    );
  });

  it("makes the light scheme's surface the editor background", () => {
    expect(valueOf(LIGHT, "--mantine-color-white")).toBe("var(--editor-bg)");
  });

  it.each(STEPS)("rebuilds gray-%i and dark-%i from the editor colours", (step) => {
    expect(valueOf(LIGHT, `--mantine-color-gray-${step}`)).toContain("var(--editor-bg)");
    expect(valueOf(DARK, `--mantine-color-gray-${step}`)).toContain("var(--editor-fg)");
    expect(valueOf(DARK, `--mantine-color-dark-${step}`)).toMatch(/var\(--editor-(bg|fg)\)/);
  });

  it("keeps each scale running from light to dark, as Mantine's does", () => {
    const lightGray = STEPS.map((s) =>
      share(valueOf(LIGHT, `--mantine-color-gray-${s}`), "--editor-fg"),
    );
    const darkGray = STEPS.map((s) =>
      share(valueOf(DARK, `--mantine-color-gray-${s}`), "--editor-bg"),
    );
    const dark = [1, 2, 3, 4, 5, 6].map((s) =>
      share(valueOf(DARK, `--mantine-color-dark-${s}`), "--editor-fg"),
    );
    expect(lightGray).toEqual(lightGray.toSorted((a, b) => a - b));
    expect(darkGray).toEqual(darkGray.toSorted((a, b) => a - b));
    expect(dark).toEqual(dark.toSorted((a, b) => b - a));
  });
});
