import { useMantineColorScheme } from "@mantine/core";
import { act, render, screen } from "@tests/render.tsx";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useDispatch } from "@/store/context.tsx";
import { MantineRoot } from "./MantineRoot.tsx";

function Probe(): ReactNode {
  const { colorScheme } = useMantineColorScheme();
  const dispatch = useDispatch();
  return (
    <button type="button" onClick={() => dispatch({ type: "theme", theme: "dark" })}>
      {colorScheme}
    </button>
  );
}

function renderRoot(): void {
  render(
    <StoreProvider>
      <MantineRoot>
        <Probe />
      </MantineRoot>
    </StoreProvider>,
  );
}

describe("MantineRoot colour scheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.className = "";
  });

  it("follows the ThemeToggle state in the browser", () => {
    renderRoot();
    const probe = screen.getByRole("button");
    expect(probe.textContent).toBe("light");
    act(() => probe.click());
    expect(probe.textContent).toBe("dark");
  });

  it("follows the editor theme inside the VS Code webview, live", async () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({}));
    document.body.className = "vscode-dark";
    renderRoot();
    const probe = screen.getByRole("button");
    expect(probe.textContent).toBe("dark");

    document.body.className = "vscode-high-contrast-light";
    await vi.waitFor(() => {
      expect(probe.textContent).toBe("light");
    });
  });
});
