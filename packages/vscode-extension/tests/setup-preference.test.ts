import type { ExtensionContext } from "vscode";
import { describe, expect, it, vi } from "vitest";

const detected = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../src/harness-detect.ts", () => ({
  detectHarnesses: () => ({
    harnesses: detected.ids.map((id) => ({ id, label: id })),
    aidlcDirCollision: false,
  }),
}));

import { chatTools, type SetupPreference, setupStateKey } from "../src/setup-preference.ts";

function context(preference?: Partial<SetupPreference>): ExtensionContext {
  const get = vi.fn((key: string) => (key === setupStateKey("/ws") ? preference : undefined));
  return { workspaceState: { get } } as unknown as ExtensionContext;
}

describe("AI chat tools", () => {
  it("offers only the tools chosen in Setup that the chat supports", () => {
    detected.ids = ["claude", "kiro"];
    expect(chatTools(context({ harnesses: ["claude", "kiro"] }), "/ws")).toEqual(["claude"]);
  });

  it("adds tools configured in the project after Setup, as Setup itself shows them", () => {
    detected.ids = ["claude", "copilot"];
    expect(chatTools(context({ harnesses: ["claude"] }), "/ws")).toEqual(["claude", "copilot"]);
  });

  it("reads the older single-tool preference", () => {
    detected.ids = [];
    expect(chatTools(context({ harness: "cursor" }), "/ws")).toEqual(["cursor"]);
  });

  it("offers nothing when only tools the chat cannot use are chosen", () => {
    detected.ids = ["kiro"];
    expect(chatTools(context({ harnesses: ["kiro"] }), "/ws")).toEqual([]);
  });

  it("offers every tool before any choice is known", () => {
    detected.ids = [];
    expect(chatTools(context(), "/ws")).toEqual(["claude", "cursor", "copilot"]);
  });
});
