import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRealpathUses, scanSources } from "./check-canonical-paths.ts";

describe("findRealpathUses", () => {
  it("flags named imports of either resolver and namespace access", () => {
    const source = [
      'import { lstat, realpath } from "node:fs/promises";',
      'import { existsSync, realpathSync as resolve } from "node:fs";',
      'import {\n  readFileSync,\n  realpathSync,\n} from "fs";',
      'import { realpath as walk } from "fs/promises";',
      "const a = fs.realpathSync(root);",
      "const b = await fsp.realpath(root);",
      'const c = require("node:fs").realpathSync.native(root);',
    ].join("\n");
    expect(findRealpathUses(source, "x.ts").map(({ line, found }) => [line, found])).toEqual([
      [1, "realpath"],
      [2, "realpathSync"],
      [5, "realpathSync"],
      [7, "realpath"],
      [8, ".realpathSync"],
      [9, ".realpath"],
      [10, ".realpathSync"],
    ]);
  });

  it("leaves prose, other modules and the shared resolver alone", () => {
    const source = [
      "// re-checked against `realpath` so a link cannot escape",
      " * compare realpaths of both sides",
      'import { canonicalPath, canonicalPathSync } from "@andon/core-utils";',
      'import { realpath } from "./my-own-realpath.ts";',
      "const root = await canonicalPath(workspace);",
    ].join("\n");
    expect(findRealpathUses(source, "x.ts")).toEqual([]);
  });
});

describe("scanSources", () => {
  it("finds nothing outside the allowed files in this repository", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(scanSources(root)).toEqual([]);
  });
});
