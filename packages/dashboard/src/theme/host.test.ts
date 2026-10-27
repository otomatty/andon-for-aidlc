import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVsCodeHost,
  isVsCodeDarkBody,
  isVsCodeHighContrastBody,
  isVsCodeWebview,
  syncVsCodeTheme,
  watchVsCodeTheme,
} from "./host.ts";

describe("isVsCodeWebview", () => {
  it("is true when acquireVsCodeApi is a function", () => {
    expect(isVsCodeWebview({ acquireVsCodeApi: () => ({}) })).toBe(true);
  });

  it("is false in a plain browser window", () => {
    expect(isVsCodeWebview({})).toBe(false);
  });
});

describe("isVsCodeDarkBody", () => {
  it("reads vscode-dark / high-contrast classes", () => {
    const body = document.createElement("body");
    body.className = "vscode-light";
    expect(isVsCodeDarkBody(body)).toBe(false);

    body.className = "vscode-dark";
    expect(isVsCodeDarkBody(body)).toBe(true);

    body.className = "vscode-high-contrast";
    expect(isVsCodeDarkBody(body)).toBe(true);

    body.className = "vscode-high-contrast-light";
    expect(isVsCodeDarkBody(body)).toBe(false);
  });
});

describe("isVsCodeHighContrastBody", () => {
  it("is true for both high contrast themes only", () => {
    const body = document.createElement("body");
    body.className = "vscode-dark";
    expect(isVsCodeHighContrastBody(body)).toBe(false);

    body.className = "vscode-high-contrast";
    expect(isVsCodeHighContrastBody(body)).toBe(true);

    body.className = "vscode-high-contrast-light";
    expect(isVsCodeHighContrastBody(body)).toBe(true);
  });
});

describe("applyVsCodeHost / syncVsCodeTheme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-host");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-contrast");
    document.documentElement.classList.remove("dark");
    document.body.className = "";
  });

  it("marks high contrast themes and clears the mark again", () => {
    document.body.className = "vscode-high-contrast-light";
    syncVsCodeTheme(document.documentElement);
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    document.body.className = "vscode-dark";
    syncVsCodeTheme(document.documentElement);
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  });

  it("sets data-host and mirrors body theme onto html", () => {
    document.body.className = "vscode-dark";
    applyVsCodeHost(document.documentElement);
    expect(document.documentElement.getAttribute("data-host")).toBe("vscode");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.body.className = "vscode-light";
    syncVsCodeTheme(document.documentElement);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("watchVsCodeTheme updates when the body class changes", async () => {
    document.body.className = "vscode-light";
    const stop = watchVsCodeTheme();
    expect(document.documentElement.getAttribute("data-host")).toBe("vscode");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    document.body.className = "vscode-dark";
    await vi.waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    stop();
  });
});
