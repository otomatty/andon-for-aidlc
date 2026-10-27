import { describe, expect, it } from "vitest";
import {
  chosenAction,
  commonLines,
  defaultAction,
  diffHunks,
  diffLines,
  handFixes,
  type RepairItem,
} from "../src/workflows-repair-plan.ts";

const item = (over: Partial<RepairItem>): RepairItem => ({
  path: "a.md",
  harnesses: ["claude"],
  kind: "ownership",
  group: "confirm",
  guidance: "",
  plan: "",
  options: [],
  detail: "",
  ...over,
});
const custom = item({
  options: [
    { action: "ai-merge", label: "AI" },
    { action: "replace", label: "置き換え" },
  ],
});

describe("what the one button does to each file", () => {
  it("recommends the first option the person can use", () => {
    expect(defaultAction(custom, true)).toBe("ai-merge");
    expect(defaultAction(custom, false)).toBe("replace");
    expect(defaultAction(item({ options: [{ action: "ai-merge", label: "AI" }] }), false)).toBeNull();
  });
  it("takes a valid pick, and the recommendation otherwise", () => {
    expect(chosenAction(custom, { "a.md": "replace" }, true)).toBe("replace");
    expect(chosenAction(custom, { "a.md": "delete" }, true)).toBe("ai-merge");
    expect(chosenAction(custom, { "a.md": "ai-merge" }, false)).toBe("replace");
    expect(chosenAction(custom, {}, true)).toBe("ai-merge");
  });
  it("needs an AI for AI items and the person for manual ones", () => {
    const ai = item({ group: "ai", options: [{ action: "ai-json", label: "AI" }] });
    const auto = item({ group: "auto", options: [{ action: "regenerate", label: "作り直す" }] });
    const manual = item({ group: "manual", path: "b.md" });
    expect(chosenAction(ai, {}, true)).toBe("ai-json");
    expect(chosenAction(ai, {}, false)).toBeNull();
    expect(chosenAction(auto, {}, false)).toBe("regenerate");
    expect(chosenAction(manual, {}, true)).toBeNull();
    expect(handFixes([ai, auto, manual], false).map((entry) => entry.group)).toEqual([
      "ai",
      "manual",
    ]);
    expect(handFixes([ai, auto, manual], true)).toEqual([manual]);
  });
});

describe("diffs of AI changes", () => {
  it("numbers removed, added and kept lines", () => {
    expect(diffLines("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "same", text: "a", old: 1, new: 1 },
      { kind: "del", text: "b", old: 2 },
      { kind: "add", text: "B", new: 2 },
      { kind: "same", text: "c", old: 3, new: 3 },
      { kind: "add", text: "d", new: 4 },
    ]);
    expect(diffLines("same", "same").every((row) => row.kind === "same")).toBe(true);
  });
  it("keeps a little context around each change and marks what it skips", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
    const after = before.replace("line 2", "LINE 2").replace("line 17", "LINE 17");
    const hunks = diffHunks(diffLines(before, after), 1);
    expect(hunks.map((row) => (row === null ? "…" : `${row.kind}:${row.text}`))).toEqual([
      "same:line 1",
      "del:line 2",
      "add:LINE 2",
      "same:line 3",
      "…",
      "same:line 16",
      "del:line 17",
      "add:LINE 17",
      "same:line 18",
    ]);
    expect(diffHunks(diffLines("x", "x"))).toEqual([]);
  });
});

describe("large texts", () => {
  it("pairs the shared start and end of a long file without a full table", () => {
    const lines = Array.from({ length: 30_000 }, () => "");
    const changed = [...lines];
    changed[15_000] = "fixed";
    const started = performance.now();
    expect(commonLines(lines, changed)).toHaveLength(29_999);
    const rows = diffHunks(diffLines(lines.join("\n"), changed.join("\n")));
    expect(rows.filter((row) => row !== null && row.kind !== "same")).toHaveLength(2);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
  it("treats a middle too large to compare as changed, never as kept", () => {
    const base = Array.from({ length: 2_500 }, (_, index) => `a${index}`);
    const other = [...base].reverse();
    expect(commonLines(base, other)).toEqual([]);
    const diff = diffLines(base.join("\n"), other.join("\n"));
    expect(diff.filter((row) => row.kind === "del")).toHaveLength(2_500);
    expect(diff.filter((row) => row.kind === "add")).toHaveLength(2_500);
    expect(diff.some((row) => row.kind === "same")).toBe(false);
  });
  it("still finds the longest common lines in a middle it can compare", () => {
    // "a" and "b" tie; either keeps four lines, and the earlier line of the second text wins.
    expect(commonLines(["x", "a", "b", "c", "y"], ["x", "b", "a", "c", "y"])).toEqual([
      [0, 0],
      [2, 1],
      [3, 3],
      [4, 4],
    ]);
  });
});
