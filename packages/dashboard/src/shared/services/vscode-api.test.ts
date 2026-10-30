import { afterEach, describe, expect, it, vi } from "vitest";
import { editFileInIde, openFileInIde } from "@/services/docs.ts";
import { inVsCodeWebview, vsCodeApi } from "@/services/vscode-api.ts";

/**
 * The regression this file exists for: VS Code allows `acquireVsCodeApi()`
 * **once per webview** and throws on every call after the first. Three call
 * sites had grown up calling it independently, so in a real webview only
 * whichever ran first worked.
 *
 * The stub therefore enforces the once-only rule the real host enforces. A stub
 * that is happy to be acquired twice is precisely why this shipped unnoticed.
 */

function onceOnlyHost(): { acquires: () => number; posted: () => unknown[] } {
  let acquires = 0;
  const posted: unknown[] = [];
  const api = {
    postMessage: (message: unknown) => {
      posted.push(message);
    },
  };
  vi.stubGlobal("acquireVsCodeApi", () => {
    acquires += 1;
    if (acquires > 1) {
      throw new Error("An instance of the VS Code API has already been acquired");
    }
    return api;
  });
  return { acquires: () => acquires, posted: () => posted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vsCodeApi — acquired once per webview", () => {
  it("survives every caller taking a turn, in any order", () => {
    const host = onceOnlyHost();

    // The transport acquires first in a real boot; then both jump helpers run,
    // repeatedly, the way a human clicking around would drive them.
    expect(vsCodeApi()).not.toBeNull();
    expect(openFileInIde({ path: "packages/mcp-server/src/index.ts", line: 20 })).toBe(true);
    expect(editFileInIde("construction/u/s/plan.md")).toBe(true);
    expect(openFileInIde({ path: "cli.ts", line: null })).toBe(true);

    expect(host.acquires()).toBe(1);
    expect(host.posted()).toHaveLength(3);
  });

  it("sends what each caller meant through that one instance", () => {
    const host = onceOnlyHost();
    openFileInIde({ path: "packages/mcp-server/src/index.ts", line: 20 });
    editFileInIde("construction/u/s/plan.md");

    expect(host.posted()).toEqual([
      { type: "open-file", path: "packages/mcp-server/src/index.ts", line: 20 },
      {
        type: "open-file",
        path: "construction/u/s/plan.md",
        line: null,
        base: "record",
        preview: false,
      },
    ]);
  });

  it("sends beside and record base when openFileInIde options ask for them", () => {
    const host = onceOnlyHost();
    openFileInIde(
      { path: "construction/example-unit/example-stage/plan.md", line: 1 },
      { beside: true, base: "record" },
    );

    expect(host.posted()).toEqual([
      {
        type: "open-file",
        path: "construction/example-unit/example-stage/plan.md",
        line: 1,
        beside: true,
        base: "record",
      },
    ]);
  });

  it("sends preview:false and record base for editFileInIde", () => {
    const host = onceOnlyHost();
    expect(editFileInIde("construction/u/s/plan.md")).toBe(true);
    expect(host.posted()).toEqual([
      {
        type: "open-file",
        path: "construction/u/s/plan.md",
        line: null,
        base: "record",
        preview: false,
      },
    ]);
  });

  it("omits beside, base, and preview when openFileInIde options are absent or false", () => {
    const host = onceOnlyHost();
    openFileInIde({ path: "cli.ts", line: null });
    openFileInIde({ path: "other.ts", line: 5 }, { beside: false, base: "workspace" });

    expect(host.posted()).toEqual([
      { type: "open-file", path: "cli.ts", line: null },
      { type: "open-file", path: "other.ts", line: 5 },
    ]);
  });

  it("reports no host, and acquires nothing, in the browser", () => {
    expect(inVsCodeWebview()).toBe(false);
    expect(vsCodeApi()).toBeNull();
    expect(openFileInIde({ path: "cli.ts", line: 1 })).toBe(false);
    expect(editFileInIde("plan.md")).toBe(false);
  });

  it("does not acquire merely to answer whether a host exists", () => {
    const host = onceOnlyHost();
    expect(inVsCodeWebview()).toBe(true);
    expect(inVsCodeWebview()).toBe(true);
    expect(host.acquires()).toBe(0);
  });
});
