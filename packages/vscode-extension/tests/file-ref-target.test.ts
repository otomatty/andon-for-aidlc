import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileRefTarget, isInside, rankCandidates } from "../src/file-ref-target.ts";

/**
 * The trust boundary between the webview and the filesystem. The dashboard
 * already refuses these shapes, which is exactly why they are tested here:
 * this side has to hold with the dashboard's check assumed absent.
 */

const ROOT = path.resolve("/work/aidlc-guide");

describe("fileRefTarget — containment", () => {
  it.each([
    ["", "empty"],
    ["/etc/passwd", "absolute"],
    ["../../../etc/passwd", "escapes"],
    ["packages/../../secrets.json", "escapes"],
    ["packages//plan.ts", "empty segment"],
    ["packages/./plan.ts", "an interior `.` segment"],
    ["./../secrets.json", "escapes once the leading `./` is dropped"],
    ["packages\\mcp-server\\index.ts", "backslashes"],
    ["packages/*/plan.ts", "a glob would widen the literal path"],
  ])("refuses %j (%s)", (rel) => {
    expect(fileRefTarget(ROOT, rel)).toBeNull();
  });

  it("never returns a direct path outside the root", () => {
    // Belt and braces: whatever survives the filter above must still be inside.
    for (const rel of ["packages/mcp-server/src/index.ts", "a/b/c/d.ts", "docs/guides/getting-started.md"]) {
      const target = fileRefTarget(ROOT, rel);
      expect(target?.direct).not.toBeNull();
      expect(isInside(ROOT, target?.direct ?? "")).toBe(true);
    }
  });
});

describe("fileRefTarget — what gets tried literally", () => {
  it("resolves a path with a directory against the workspace root", () => {
    expect(fileRefTarget(ROOT, "packages/mcp-server/src/index.ts")).toEqual({
      direct: path.join(ROOT, "packages", "mcp-server", "src", "index.ts"),
      glob: "**/packages/mcp-server/src/index.ts",
    });
  });

  it("sends a bare basename straight to the search, not to the repo root", () => {
    // `<root>/cli.ts` exists in no repo this targets; trying it would only add
    // a stat, and a repo that *did* have one would swallow every `cli.ts`
    // citation into the wrong file.
    expect(fileRefTarget(ROOT, "cli.ts")).toEqual({ direct: null, glob: "**/cli.ts" });
  });

  it("globs a partial path so it can match at any depth", () => {
    expect(fileRefTarget(ROOT, "services/api.ts")?.glob).toBe("**/services/api.ts");
  });

  it("drops a leading `./`, agreeing with the dashboard's parser", () => {
    // Both sides normalise, so a citation never renders as a link here and
    // then warns on click. `open-doc` has stripped the same prefix all along.
    expect(fileRefTarget(ROOT, "./util/guard-path.ts")).toEqual({
      direct: path.join(ROOT, "util", "guard-path.ts"),
      glob: "**/util/guard-path.ts",
    });
  });
});

describe("rankCandidates — the root reading is offered, not assumed", () => {
  const ROOT_COPY = path.join(ROOT, "services", "api.ts");
  const DEEP_COPY = path.join(ROOT, "packages", "foo", "services", "api.ts");

  it("keeps both when a citation is a root path AND a suffix of a deeper one", () => {
    // The case that made short-circuiting wrong: opening ROOT_COPY on sight
    // would silently pick a file the artifact may not mean. Two candidates
    // reach the caller, so it prompts instead of guessing.
    expect(rankCandidates(ROOT_COPY, [ROOT_COPY, DEEP_COPY])).toEqual([ROOT_COPY, DEEP_COPY]);
  });

  it("lists the root reading first, so the likely answer is preselected", () => {
    expect(rankCandidates(ROOT_COPY, [DEEP_COPY, ROOT_COPY])[0]).toBe(ROOT_COPY);
  });

  it("counts a path once, however many sources produced it", () => {
    expect(rankCandidates(ROOT_COPY, [ROOT_COPY])).toEqual([ROOT_COPY]);
  });

  it("falls back to the search alone when there is no root reading", () => {
    expect(rankCandidates(null, [DEEP_COPY])).toEqual([DEEP_COPY]);
    expect(rankCandidates(null, [])).toEqual([]);
  });

  it("keeps a root reading the search could not see", () => {
    expect(rankCandidates(ROOT_COPY, [])).toEqual([ROOT_COPY]);
  });
});

describe("isInside", () => {
  it("rejects the root itself and anything above it", () => {
    expect(isInside(ROOT, ROOT)).toBe(false);
    expect(isInside(ROOT, path.resolve(ROOT, ".."))).toBe(false);
    expect(isInside(ROOT, path.join(ROOT, "packages"))).toBe(true);
  });
});
