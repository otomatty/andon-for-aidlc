import { render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpacePicker } from "./SpacePicker.tsx";
import { StoreProvider } from "@/store/context.tsx";
import type { AppState } from "@/store/state.ts";

afterEach(() => vi.unstubAllGlobals());

function setup(preloaded: Partial<AppState> = {}, canSwitch = true) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return Response.json({
        ok: true,
        value: { space: "team-b", selected: null, all: [], active: null },
      });
    if (url === "/api/spaces")
      return Response.json({
        ok: true,
        value: {
          active: "default",
          spaces: ["default", "team-b"],
          canSwitch,
          harnesses: canSwitch
            ? [
                { id: ".cursor", label: "Cursor" },
                { id: ".claude", label: "Claude Code" },
              ]
            : [],
        },
      });
    return Response.json({ error: true, reason: "no-active-intent" });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <StoreProvider
      preloaded={{
        intents: {
          kind: "success",
          value: { space: "default", selected: null, all: [], active: null },
        },
        ...preloaded,
      }}
    >
      <SpacePicker />
    </StoreProvider>,
  );
  return fetchMock;
}

describe("SpacePicker", () => {
  it("requires a tool choice and sends the expected current space", async () => {
    const fetchMock = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Space: default" }));
    await user.click(await screen.findByRole("combobox", { name: "切り替え先" }));
    await user.click(await screen.findByRole("option", { name: "team-b" }));
    expect((screen.getByRole("button", { name: "切り替える" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("combobox", { name: "使用するツール" }));
    await user.click(await screen.findByRole("option", { name: "Cursor" }));
    await user.click(screen.getByRole("button", { name: "切り替える" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/switch-space",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ space: "team-b", expectedSpace: "default", harness: ".cursor" }),
        }),
      ),
    );
  });

  it("blocks switching while a customization draft is unsaved", async () => {
    const fetchMock = setup({ spaceSwitchBlocked: true });
    await userEvent.click(screen.getByRole("button", { name: "Space: default" }));
    expect(await screen.findByText(/カスタマイズの保存/)).toBeDefined();
    expect((screen.getByRole("button", { name: "切り替える" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("keeps the current space visible when switching is unavailable", async () => {
    setup({}, false);
    await userEvent.click(screen.getByRole("button", { name: "Space: default" }));
    expect(await screen.findByText(/信頼済みのワークスペース/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "切り替える" })).toBeNull();
  });
});
