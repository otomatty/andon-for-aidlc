import type { ConstructionWalk, StageTiming } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { parseState } from "../src/parse/state.ts";
import { PER_UNIT_STAGES } from "../src/timing/next-gate.ts";
import { constructionWalkOf, walkMatch } from "../src/timing/walk.ts";
import { expectOk } from "./paths.ts";
import { run } from "./timing-fixtures.ts";

/**
 * Issue #167: which walk a workflow's per-Unit runs were recorded under,
 * decided from the state file the way the engine decides to enter its
 * unit-major walk.
 */

/** A state file with the given runtime lines and `units-generation` row. */
function stateText(runtime: readonly string[], unitsRow: string | null): string {
  return [
    "## Project Information",
    "- **State Version**: 8",
    "## Runtime State",
    ...runtime,
    "## Stage Progress",
    "### INCEPTION PHASE",
    ...(unitsRow === null ? [] : [unitsRow]),
    "### CONSTRUCTION PHASE",
    "- [ ] functional-design — EXECUTE",
    "## Current Status",
    "- **Current Stage**: functional-design",
    "",
  ].join("\n");
}

function walkOf(runtime: readonly string[], unitsRow: string | null): ConstructionWalk {
  return constructionWalkOf(expectOk(parseState(stateText(runtime, unitsRow))).value);
}

const UNIT_MAJOR = "- **Construction Iteration**: unit-major";
const EXECUTE = "- [x] units-generation — EXECUTE";

describe("constructionWalkOf", () => {
  it("reads unit-major only when the setting is unit-major and units-generation is planned", () => {
    expect(walkOf([UNIT_MAJOR], EXECUTE)).toBe("unit-major");
  });

  it.each([
    ["no Construction Iteration line", [], EXECUTE],
    ["an explicit stage-major", ["- **Construction Iteration**: stage-major"], EXECUTE],
    ["a value that is not exactly unit-major", ["- **Construction Iteration**: Unit-Major"], EXECUTE],
    ["units-generation planned as SKIP", [UNIT_MAJOR], "- [S] units-generation — SKIP"],
    ["no units-generation row", [UNIT_MAJOR], null],
  ])("reads stage-major for %s", (_label, runtime, unitsRow) => {
    expect(walkOf(runtime, unitsRow)).toBe("stage-major");
  });

  it("reads the plan action, whatever the checkbox says", () => {
    // Not started yet, but planned: the engine enters the walk once it runs.
    expect(walkOf([UNIT_MAJOR], "- [ ] units-generation — EXECUTE")).toBe("unit-major");
  });

  it("reads a hand-built model without a Construction policy as stage-major", () => {
    expect(
      constructionWalkOf({
        project: "p",
        scope: "feature",
        depth: "practical",
        stateVersion: 8,
        phase: "CONSTRUCTION",
        currentStage: null,
        nextStage: null,
        gate: null,
        stages: [
          { slug: "units-generation", phase: "INCEPTION", execution: "EXECUTE", status: "completed" },
        ],
        done: 0,
        total: 0,
      }),
    ).toBe("stage-major");
  });
});

describe("walkMatch", () => {
  const stamped = (stage: string, walk: StageTiming["constructionWalk"]): StageTiming => ({
    ...run(stage, 60_000),
    ...(walk === undefined ? {} : { constructionWalk: walk }),
  });

  it.each([...PER_UNIT_STAGES])("sorts %s runs by the walk that recorded them", (stage) => {
    expect(walkMatch(stamped(stage, "stage-major"), "stage-major")).toBe("use");
    expect(walkMatch(stamped(stage, "unit-major"), "stage-major")).toBe("other");
    expect(walkMatch(stamped(stage, "stage-major"), "unit-major")).toBe("other");
    expect(walkMatch(stamped(stage, "unit-major"), "unit-major")).toBe("use");
    expect(walkMatch(stamped(stage, "unknown"), "unit-major")).toBe("unknown");
    expect(walkMatch(stamped(stage, "unknown"), "stage-major")).toBe("unknown");
  });

  it("takes an unstamped run as the estimated workflow's own", () => {
    expect(walkMatch(stamped("nfr-design", undefined), "stage-major")).toBe("use");
    expect(walkMatch(stamped("nfr-design", undefined), "unit-major")).toBe("use");
  });

  it("uses every run of a stage that is not per-Unit, whatever its walk", () => {
    for (const walk of ["unit-major", "stage-major", "unknown"] as const) {
      expect(walkMatch(stamped("build-and-test", walk), "stage-major")).toBe("use");
      expect(walkMatch(stamped("units-generation", walk), "unit-major")).toBe("use");
    }
  });

  it("does not filter when no walk is given", () => {
    expect(walkMatch(stamped("nfr-design", "unit-major"), undefined)).toBe("use");
    expect(walkMatch(stamped("nfr-design", "unknown"), undefined)).toBe("use");
  });
});
