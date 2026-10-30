import { describe, expect, it } from "vitest";
import { foldDiff, lineDiff } from "./line-diff.ts";

describe("line diff", () => {
  it("marks added, removed and kept lines in order", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "B" },
      { type: "same", text: "c" },
      { type: "add", text: "d" },
    ]);
  });

  it("treats a new or removed file as all additions or removals", () => {
    expect(lineDiff("", "x\ny")).toEqual([
      { type: "add", text: "x" },
      { type: "add", text: "y" },
    ]);
    expect(lineDiff("x", "")).toEqual([{ type: "remove", text: "x" }]);
  });

  it("ignores line-ending differences", () => {
    expect(lineDiff("a\r\nb\r\n", "a\nb\n")).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
    ]);
  });

  it("gives up on texts too large to compare", () => {
    const many = (prefix: string) =>
      Array.from({ length: 2100 }, (_, index) => `${prefix}${index}`).join("\n");
    expect(lineDiff(many("a"), many("b"))).toBeNull();
  });

  it("folds unchanged lines away from changes", () => {
    const before = Array.from({ length: 20 }, (_, index) => `l${index}`).join("\n");
    const after = before.replace("l10", "L10");
    const rows = foldDiff(lineDiff(before, after) ?? [], 2);
    expect(rows[0]).toEqual({ type: "skip", count: 8 });
    expect(rows.filter((row) => row.type !== "skip")).toHaveLength(6);
    expect(rows.at(-1)).toEqual({ type: "skip", count: 7 });
  });
});
