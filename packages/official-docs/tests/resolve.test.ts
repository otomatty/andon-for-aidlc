import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectError, expectOk, workspaceRoot } from "./helpers.ts";

const stubs = vi.hoisted(() => {
  type GuardPath = typeof import("@andon/core-utils").guardPath;
  let realGuardPath: GuardPath | undefined;
  const guardPathMock = vi.fn<GuardPath>();
  return {
    guardPathMock,
    setReal(fn: GuardPath) {
      realGuardPath = fn;
      guardPathMock.mockImplementation(fn);
    },
    reset() {
      if (realGuardPath) guardPathMock.mockImplementation(realGuardPath);
    },
    real() {
      if (!realGuardPath) throw new Error("guardPath real impl not set");
      return realGuardPath;
    },
  };
});

vi.mock("@andon/core-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@andon/core-utils")>();
  stubs.setReal(actual.guardPath);
  return { ...actual, guardPath: stubs.guardPathMock };
});

const { resolvePage } = await import("../src/resolve.ts");

describe("resolvePage", () => {
  afterEach(() => {
    stubs.reset();
  });

  it("resolves an English guide page", async () => {
    const page = expectOk(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "guide/getting-started.md",
      }),
    );
    expect(page.localeRequested).toBe("en");
    expect(page.localeServed).toBe("en");
    expect(page.path).toBe("guide/getting-started.md");
    expect(page.bodyMarkdown).toContain("Getting started");
    expect(page.title).toBe("Getting started");
    expect(page.notice).toBeUndefined();
    expect(page.sourceVersion.length).toBeGreaterThan(0);
    expect(page.anchorApplied).toBe("none");
  });

  it("resolves an English reference page", async () => {
    const page = expectOk(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "reference/scopes.md",
      }),
    );
    expect(page.title).toBe("Scopes");
    expect(page.bodyMarkdown).toContain("Feature scope");
  });

  it("serves ja when the ja file exists", async () => {
    const page = expectOk(
      await resolvePage({
        workspaceRoot,
        locale: "ja",
        path: "guide/getting-started.md",
      }),
    );
    expect(page.localeRequested).toBe("ja");
    expect(page.localeServed).toBe("ja");
    expect(page.notice).toBeUndefined();
    expect(page.title).toBe("はじめに");
  });

  it("falls back to en with missing_ja notice when ja file is absent", async ({
    onTestFinished,
  }) => {
    const root = await mkdtemp(join(tmpdir(), "od-resolve-missing-ja-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "docs", "reference", "en"), { recursive: true });
    await writeFile(join(root, "docs", "reference", "en", "scopes.md"), "# Scopes\n");
    const requestedPath = "reference/scopes.md";
    const page = expectOk(
      await resolvePage({
        workspaceRoot: root,
        locale: "ja",
        path: requestedPath,
      }),
    );
    expect(page.localeRequested).toBe("ja");
    expect(page.localeServed).toBe("en");
    expect(page.notice).toBe("missing_ja");
    // Keep-path: never rewrite the public DocPath on missing_ja (BR-B2-OD-1..3).
    expect(page.path).toBe(requestedPath);
    expect(page.bodyMarkdown).toContain("Scopes");
  });

  it("returns not_found for a missing en page", async () => {
    expectError(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "guide/does-not-exist.md",
      }),
      "not_found",
    );
  });

  it("returns not_found when ja and en twins are both missing", async () => {
    expectError(
      await resolvePage({
        workspaceRoot,
        locale: "ja",
        path: "guide/does-not-exist.md",
      }),
      "not_found",
    );
  });

  it("rejects path escape with path_rejected", async () => {
    expectError(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "guide/../../../package.json",
      }),
      "path_rejected",
    );
  });

  it("rejects paths without guide|reference prefix", async () => {
    expectError(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "getting-started.md",
      }),
      "path_rejected",
    );
  });

  it("rejects invalid locale", async () => {
    expectError(
      await resolvePage({
        workspaceRoot,
        locale: "fr",
        path: "guide/getting-started.md",
      }),
      "path_rejected",
    );
  });

  it("sets anchorApplied=scrolled when the heading exists", async () => {
    const page = expectOk(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "guide/getting-started.md",
        anchor: "approval-gates",
      }),
    );
    expect(page.anchorApplied).toBe("scrolled");
  });

  it("sets anchorApplied=top when the heading is missing", async () => {
    const page = expectOk(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "guide/getting-started.md",
        anchor: "no-such-heading",
      }),
    );
    expect(page.anchorApplied).toBe("top");
  });

  it("accepts #prefixed anchors for scrolled", async () => {
    const page = expectOk(
      await resolvePage({
        workspaceRoot,
        locale: "en",
        path: "reference/scopes.md",
        anchor: "#feature-scope",
      }),
    );
    expect(page.anchorApplied).toBe("scrolled");
  });

  it("sets anchorApplied=none for empty or whitespace anchors", async () => {
    for (const anchor of ["", "   ", "\t"]) {
      const page = expectOk(
        await resolvePage({
          workspaceRoot,
          locale: "en",
          path: "guide/getting-started.md",
          anchor,
        }),
      );
      expect(page.anchorApplied).toBe("none");
    }
  });

  it("still resolves when the manifest is missing (empty sourceVersion)", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-resolve-nomanifest-"));
    await mkdir(join(root, "docs", "guide", "en"), { recursive: true });
    await writeFile(join(root, "docs", "guide", "en", "page.md"), "# Temp\n\nbody\n");
    const page = expectOk(
      await resolvePage({
        workspaceRoot: root,
        locale: "en",
        path: "guide/page.md",
      }),
    );
    expect(page.bodyMarkdown).toContain("Temp");
    // Bolt 1: missing manifest → ok + empty sourceVersion (not empty_content).
    expect(page.sourceVersion).toBe("");
  });

  it("returns path_rejected when en fallback is rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-resolve-en-reject-"));
    await mkdir(join(root, "docs", "guide", "ja"), { recursive: true });
    await mkdir(join(root, "docs", "guide", "en"), { recursive: true });
    const real = stubs.real();

    stubs.guardPathMock.mockImplementation(async (contentRoot, relFile) => {
      if (/guide[/\\]en(?:[/\\]|$)/.test(String(contentRoot))) {
        return { error: true, reason: "outside-record" };
      }
      return real(contentRoot, relFile);
    });

    expectError(
      await resolvePage({
        workspaceRoot: root,
        locale: "ja",
        path: "guide/page.md",
      }),
      "path_rejected",
    );
  });
});
