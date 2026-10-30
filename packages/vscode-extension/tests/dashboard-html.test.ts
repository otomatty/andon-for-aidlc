import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext, Webview } from "vscode";

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));

import { loadDashboardHtml } from "../src/dashboard-html.ts";

let extensionPath: string;

beforeEach(async () => {
  extensionPath = await mkdtemp(path.join(tmpdir(), "dashboard-html-"));
  await mkdir(path.join(extensionPath, "media", "dashboard"), { recursive: true });
  await writeFile(
    path.join(extensionPath, "media", "dashboard", "index.html"),
    '<html><head><script src="./assets/index.js"></script></head></html>',
  );
});

afterEach(async () => {
  await rm(extensionPath, { recursive: true, force: true });
});

const webview = {
  cspSource: "vscode-resource:",
  asWebviewUri: (uri: { fsPath: string }) => `webview:${uri.fsPath}`,
} as unknown as Webview;

describe("loadDashboardHtml", () => {
  it("rewrites asset URLs and allows no media sources", async () => {
    const html = await loadDashboardHtml(webview, { extensionPath } as ExtensionContext);
    expect(html).toContain(`src="webview:${path.join(extensionPath, "media", "dashboard", "assets", "index.js")}"`);
    const csp = /content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(csp).not.toContain("media-src");
    expect(csp).toContain("default-src 'none'");
  });
});
