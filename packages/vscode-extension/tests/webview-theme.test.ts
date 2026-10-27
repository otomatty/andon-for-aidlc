import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { webviewThemeStyles } from "../src/webview-theme.ts";

/** The custom properties a rule of webviewThemeStyles sets, by name. */
function declarations(selector: string): Map<string, string> {
  const start = webviewThemeStyles.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`webviewThemeStyles has no rule for ${selector}`);
  const body = webviewThemeStyles.slice(start, webviewThemeStyles.indexOf("}", start));
  const out = new Map<string, string>();
  for (const match of body.matchAll(/(--m-[a-z-]+):\s*([^;]+);/g)) out.set(match[1]!, match[2]!);
  return out;
}

const PAGES = ["webview-page.ts", "setup-html.ts", "workflows-update-html.ts"];

describe("webviewThemeStyles", () => {
  it("defines every colour the setup and update pages read, for every theme", () => {
    const defined = declarations("body");
    const read = new Set<string>();
    for (const page of PAGES) {
      const source = readFileSync(new URL(`../src/${page}`, import.meta.url), "utf8");
      for (const [, name] of source.matchAll(/var\((--m-[a-z-]+)[,)]/g)) {
        read.add(name!);
        expect(defined.has(name!), `${page} reads ${name}`).toBe(true);
      }
    }
    expect(read.size).toBeGreaterThan(10);
  });

  it("takes the page, text, button and link colours from the editor theme", () => {
    const base = declarations("body");
    expect(base.get("--m-body")).toBe("var(--vscode-editor-background)");
    expect(base.get("--m-text")).toBe("var(--vscode-editor-foreground)");
    expect(base.get("--m-primary")).toBe("var(--vscode-button-background)");
    expect(base.get("--m-primary-contrast")).toBe("var(--vscode-button-foreground)");
    expect(base.get("--m-primary-light-color")).toContain("var(--vscode-textLink-foreground)");
    expect(base.get("--m-error")).toBe("var(--vscode-errorForeground)");
    expect(base.get("--m-focus")).toBe("var(--vscode-focusBorder)");
  });

  it("draws lines in the contrast border in the high contrast themes", () => {
    const contrast = declarations("body.vscode-high-contrast, body.vscode-high-contrast-light");
    expect(contrast.get("--m-border")).toMatch(/^var\(--vscode-contrastBorder,/);
    expect(contrast.get("--m-input-border")).toMatch(/^var\(--vscode-contrastBorder,/);
  });
});
