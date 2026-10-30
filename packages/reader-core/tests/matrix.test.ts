import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MatrixCell } from "@andon/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readState } from "../src/parse/state.ts";
import { buildMatrix, buildMatrixForUnit } from "../src/tree/matrix.ts";
import { expectOk, fixture, REAL_RECORD } from "./paths.ts";

const STAGES = ["functional-design", "code-generation"];
const SOURCE_RECORD = fixture("record");
let RECORD: string;

beforeAll(async () => {
  RECORD = await mkdtemp(path.join(tmpdir(), "guide-matrix-"));
  // Shared fixtures also exercise unreadable audit shards. Legacy verdict
  // scanning requires a readable audit snapshot; preserve the other failures.
  await cp(SOURCE_RECORD, RECORD, {
    recursive: true,
    filter: (source) => source !== path.join(SOURCE_RECORD, "audit", "unreadable-shard.md"),
  });
});
afterAll(async () => {
  await rm(RECORD, { recursive: true, force: true });
});

function cell(cells: MatrixCell[], unit: string, stage: string): MatrixCell {
  const found = cells.find((c) => c.unit === unit && c.stage === stage);
  if (found === undefined) throw new Error(`no cell for ${unit}/${stage}`);
  return found;
}

describe("buildMatrix", () => {
  it("withholds legacy verdicts when any shared audit shard is unreadable", async () => {
    const { value } = expectOk(await buildMatrix(SOURCE_RECORD, STAGES));
    expect(value.cells.every((entry) => entry.verdict === null)).toBe(true);
    expect(cell(value.cells, "unit-alpha", "functional-design").files).toContain("review.md");
  });

  it("excludes directories named after a construction stage (BR-RC-4)", async () => {
    const { value } = expectOk(await buildMatrix(RECORD, STAGES));
    // construction/functional-design/ is a cross-stage diary, not a unit.
    expect(value.units).toEqual(["unit-alpha", "unit-beta", "unit-delta", "unit-gamma"]);
    expect(value.stages).toEqual(STAGES);
    expect(value.cells).toHaveLength(8);
  });

  it("lists only markdown artifacts, by name", async () => {
    const { value } = expectOk(await buildMatrix(RECORD, STAGES));
    // functional-design/ holds two .md files plus a notes.txt.
    expect(cell(value.cells, "unit-alpha", "functional-design").files).toEqual([
      "business-rules.md",
      "review.md",
    ]);
    expect(cell(value.cells, "unit-alpha", "code-generation").files).toEqual(["plan.md"]);
  });

  it("takes the verdict of the last artifact by name", async () => {
    const { value } = expectOk(await buildMatrix(RECORD, STAGES));
    // business-rules.md says NOT-READY, review.md (later by name) says READY.
    expect(cell(value.cells, "unit-alpha", "functional-design").verdict).toBe("READY");
    expect(cell(value.cells, "unit-beta", "functional-design").verdict).toBe("NOT-READY");
  });

  it("reports no verdict when the artifacts carry none", async () => {
    const { value } = expectOk(await buildMatrix(RECORD, STAGES));
    expect(cell(value.cells, "unit-alpha", "code-generation").verdict).toBeNull();
  });

  it("keeps walking backwards when the last artifact carries no verdict", async () => {
    const { value } = expectOk(await buildMatrix(RECORD, STAGES));
    // z-notes.md has none; a-design.md does.
    expect(cell(value.cells, "unit-delta", "code-generation")).toEqual({
      unit: "unit-delta",
      stage: "code-generation",
      files: ["a-design.md", "z-notes.md"],
      verdict: "READY",
    });
  });

  it("treats an absent stage directory as an empty cell, not an error", async () => {
    const { value } = expectOk(await buildMatrix(RECORD, STAGES));
    expect(cell(value.cells, "unit-beta", "code-generation")).toEqual({
      unit: "unit-beta",
      stage: "code-generation",
      files: [],
      verdict: null,
    });
  });

  it("degrades a single unreadable cell and leaves its neighbours healthy (mode 4)", async () => {
    const { value } = expectOk(await buildMatrix(RECORD, STAGES));
    const broken = cell(value.cells, "unit-gamma", "code-generation");
    expect(broken.error).toBeDefined();
    expect(broken.files).toEqual([]);
    expect(cell(value.cells, "unit-gamma", "functional-design")).toEqual({
      unit: "unit-gamma",
      stage: "functional-design",
      files: ["design.md"],
      verdict: "READY",
      error: undefined,
    });
  });

  it("returns an empty matrix when construction/ does not exist yet", async () => {
    const { value } = expectOk(await buildMatrix(fixture("golden"), STAGES));
    expect(value).toEqual({ units: [], stages: STAGES, cells: [] });
  });

  it("returns units in a stable sorted order (R-RC-5)", async () => {
    const first = expectOk(await buildMatrix(RECORD, STAGES)).value;
    const second = expectOk(await buildMatrix(RECORD, STAGES)).value;
    expect(first).toEqual(second);
    expect([...first.units].sort()).toEqual(first.units);
  });
});

describe("buildMatrixForUnit", () => {
  it("returns exactly one row without scanning the other units (P-RC-2b)", async () => {
    const { value } = expectOk(await buildMatrixForUnit(RECORD, "unit-alpha", STAGES));
    expect(value.map((c) => c.stage)).toEqual(STAGES);
    expect(value.every((c) => c.unit === "unit-alpha")).toBe(true);
  });

  it("matches the same unit's rows from the full scan", async () => {
    const full = expectOk(await buildMatrix(RECORD, STAGES)).value;
    const { value } = expectOk(await buildMatrixForUnit(RECORD, "unit-beta", STAGES));
    expect(value).toEqual(full.cells.filter((c) => c.unit === "unit-beta"));
  });

  it("returns empty cells for a unit that does not exist", async () => {
    const { value } = expectOk(await buildMatrixForUnit(RECORD, "unit-nope", STAGES));
    expect(value).toEqual([
      { unit: "unit-nope", stage: "functional-design", files: [], verdict: null },
      { unit: "unit-nope", stage: "code-generation", files: [], verdict: null },
    ]);
  });
});

describe("buildMatrix — live record", () => {
  it("reads the workspace's own v8 state and scans construction dirs by slug", async () => {
    const { value: workflow } = expectOk(await readState(REAL_RECORD));
    expect(workflow.stateVersion).toBe(8);

    const slugs = ["functional-design", "code-generation"];
    const { value } = expectOk(await buildMatrix(REAL_RECORD, slugs));

    expect(value.units).toContain("reader-core");
    for (const slug of slugs) expect(value.units).not.toContain(slug);
    expect(value.cells).toHaveLength(value.units.length * slugs.length);
    expect(cell(value.cells, "reader-core", "functional-design").verdict).toBe("READY");
  });
});
