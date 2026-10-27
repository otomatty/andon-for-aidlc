import { render, screen } from "@tests/render.tsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/shell/ThemeToggle.tsx";
import { StoreProvider } from "@/store/context.tsx";

describe("ThemeToggle in VS Code webview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-host");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
    document.body.className = "";
  });

  it("hides the toggle and follows the editor theme", () => {
    document.body.className = "vscode-dark";
    vi.stubGlobal("acquireVsCodeApi", () => ({}));

    render(
      <StoreProvider>
        <ThemeToggle />
      </StoreProvider>,
    );

    expect(screen.queryByTestId("theme-toggle")).toBeNull();
    expect(document.documentElement.getAttribute("data-host")).toBe("vscode");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
