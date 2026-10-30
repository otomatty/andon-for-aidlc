import { describe, expect, it } from "vitest";
import { CURRENT_STATE_VERSION, parseState, readState } from "../src/parse/state.ts";
import { expectOk, fixture, REAL_RECORD } from "./paths.ts";

describe("readState — golden snapshot (pinned copy of a State Version 8 file)", () => {
  it("parses every section of the real format", async () => {
    const { value, warnings } = expectOk(await readState(fixture("golden")));

    expect(value.stateVersion).toBe(CURRENT_STATE_VERSION);
    expect(value.project).toBe("PRDに従って実装をしてください");
    expect(value.scope).toBe("prd-implementation");
    expect(value.depth).toBe("Standard");
    expect(value.phase).toBe("CONSTRUCTION");
    expect(value.currentStage).toBe("code-generation");
    expect(value.nextStage).toBe("build-and-test");
    // The current stage's own mark — `[-]` in the snapshot, so no gate is open.
    expect(value.gate).toBe("in-progress");
    expect(value.done).toBe(17);
    expect(value.total).toBe(21);
    expect(value.unparseable).toBeUndefined();
    // G-6 agrees with the EXECUTE tally in this snapshot, so no warning.
    expect(warnings).toBeUndefined();

    // 33 checkbox rows across the five phase headings.
    expect(value.stages).toHaveLength(33);
    expect(value.stages.filter((s) => s.execution === "EXECUTE")).toHaveLength(21);
    expect(value.stages.filter((s) => s.phase === "CONSTRUCTION").map((s) => s.slug)).toEqual([
      "functional-design",
      "nfr-requirements",
      "nfr-design",
      "infrastructure-design",
      "code-generation",
      "build-and-test",
      "ci-pipeline",
    ]);
    expect(value.stages.find((s) => s.slug === "code-generation")).toEqual({
      slug: "code-generation",
      phase: "CONSTRUCTION",
      execution: "EXECUTE",
      status: "in-progress",
    });
    // `- [ ] market-research — SKIP`: an unticked box that is out of scope, so
    // it reads as skipped rather than not-started.
    expect(value.stages.find((s) => s.slug === "market-research")).toEqual({
      slug: "market-research",
      phase: "IDEATION",
      execution: "SKIP",
      status: "skipped",
    });
    expect(value.stages.every((s) => s.unparseable === undefined)).toBe(true);
  });
});

describe("readState — live record (this workspace runs the 2.6.2 engine)", () => {
  it("parses the repository's own State Version 8 record", async () => {
    const { value } = expectOk(await readState(REAL_RECORD));
    expect(value.stateVersion).toBe(CURRENT_STATE_VERSION);
    expect(value.scope).toBe("prd-implementation");
    expect(value.phase).toBe("OPERATION");
    expect(value.currentStage).toBe("performance-validation");
    expect(value.stages).toHaveLength(33);
    expect(value.stages.find((s) => s.slug === "domain-design")?.status).toBe("completed");
    expect(value.stages.find((s) => s.slug === "contract-design")).toEqual({
      slug: "contract-design",
      phase: "INCEPTION",
      execution: "SKIP",
      status: "skipped",
    });
  });
});

describe("readState — State Version 7 is no longer read", () => {
  it("refuses a v7 file as unsupported instead of browsing it", async () => {
    expect(await readState(fixture("golden-v7"))).toEqual({ unsupported: true, version: "7" });
  });
});

describe("G-2 — version gate", () => {
  it("refuses a newer State Version without attempting a parse", async () => {
    expect(await readState(fixture("unsupported-version"))).toEqual({
      unsupported: true,
      version: "9",
    });
  });

  it("refuses State Version 6 without attempting a parse", () => {
    const text = "## Project Information\n- **State Version**: 6\n";
    expect(parseState(text)).toEqual({ unsupported: true, version: "6" });
  });

  it("refuses a file with no State Version field", async () => {
    expect(await readState(fixture("no-version"))).toEqual({
      unsupported: true,
      version: "unknown",
    });
  });

  it("reports a non-numeric version verbatim", () => {
    const text = "## Project Information\n- **State Version**: seven\n";
    expect(parseState(text)).toEqual({ unsupported: true, version: "seven" });
  });

  it.each(["7.5", "7e0", "7abc"])("refuses a non-integer State Version %s", (raw) => {
    const text = `## Project Information\n- **State Version**: ${raw}\n`;
    expect(parseState(text)).toEqual({ unsupported: true, version: raw });
  });

  it("ignores a State Version that is not inside Project Information", () => {
    const text = "## Runtime State\n- **State Version**: 8\n";
    expect(parseState(text)).toEqual({ unsupported: true, version: "unknown" });
  });
});

describe("Change Control recorded in State Version 8", () => {
  const state = (row: string) =>
    `## Project Information\n- **State Version**: 8\n- **Project**: Example\n- **Scope**: mvp\n## Scope Configuration\n- **Depth**: Standard\n${row}\n## Current Status\n- **Lifecycle Phase**: INCEPTION\n`;

  it.each([
    ["strict", "strict", null],
    ["relaxed (from scope mvp)", "relaxed", "from scope mvp"],
    ["strict (from project.md)", "strict", "from project.md"],
    ["relaxed (set by you)", "relaxed", "set by you"],
    [" Strict (from scope classic) ", "strict", "from scope classic"],
    ["RELAXED(set by you)", "relaxed", "set by you"],
    ["strict (from (scope))", "strict", "from (scope)"],
    ["strict()", "strict", null],
  ])("preserves the recorded mode and source: %s", (raw, value, source) => {
    const result = expectOk(parseState(state(`- **Change Control**: ${raw}`)));
    expect(result.value.guardPolicy).toEqual({ value, source });
    expect(result.value.unparseable).toBeUndefined();
  });

  it.each(["strict", "relaxed", "off"])("reads Guard Policy %s and matching legacy names", (value) => {
    for (const row of [`- **Guard Policy**: ${value} (set by you)`, `- **Guard Policy**: ${value} (set by you)\n- **Change Control**: ${value}`]) {
      expect(expectOk(parseState(state(row))).value.guardPolicy).toEqual({value, source: "set by you"});
    }
  });
  it.each(["strict", "unknown", ""])("reports conflicting legacy value %s", (legacy) => {
    const model=expectOk(parseState(state(`- **Guard Policy**: off\n- **Change Control**: ${legacy}`))).value;
    expect(model.guardPolicy).toBeUndefined();
    expect(model.unparseable?.guardPolicy).toContain("conflicting");
  });
  it("reports an invalid modern record alongside a legacy record", () => {
    expect(expectOk(parseState(state("- **Guard Policy**: unknown\n- **Change Control**: strict"))).value.unparseable?.guardPolicy).toContain("conflicting");
  });

  it("keeps missing legacy values unrecorded", () => {
    const result = expectOk(parseState(state("")));
    expect(result.value.guardPolicy).toBeUndefined();
    expect(result.value.unparseable).toBeUndefined();
  });

  it.each(["", "   ", "automatic", "relaxed garbage", "strict (from scope"])(
    "degrades unknown value %s without inventing a policy",
    (raw) => {
      const result = expectOk(parseState(state(`- **Change Control**: ${raw}`)));
      expect(result.value.guardPolicy).toBeUndefined();
      expect(result.value.unparseable?.guardPolicy).toContain("unknown Guard Policy");
    },
  );

  it("ignores the field in a different section", () => {
    const result = expectOk(parseState(`${state("")}\n- **Change Control**: relaxed`));
    expect(result.value.guardPolicy).toBeUndefined();
  });
});

/**
 * aidlc-workflows v2.11.0 state fields: the scope-owned ceremonies
 * (aidlc-lib.ts CEREMONY_FIELDS, written `on (from scope classic)` by
 * `formatCeremony`), Project Type with its `Project Type Source`
 * (aidlc-utility.ts PROJECT_TYPE_SOURCE_FIELD) and a tailored `Plan`
 * (aidlc-lib.ts PLAN_FIELD). Each is read the engine's way: `getField`, the
 * first `- **<name>**:` line anywhere.
 */
describe("v2.11 ceremony, project type and plan fields", () => {
  const state = (info: string, config: string) =>
    `## Project Information\n- **State Version**: 8\n- **Project**: Example\n- **Scope**: express\n${info}\n## Scope Configuration\n- **Depth**: Standard\n${config}\n## Current Status\n- **Lifecycle Phase**: INCEPTION\n`;

  it("reads every ceremony with its recorded source", () => {
    const model = expectOk(
      parseState(
        state(
          "",
          [
            "- **Sensors**: on (from scope express)",
            "- **Learnings**: OFF (set by you)",
            "- **Summary Confirmation**: off (from scope express)",
            "- **Plan Approval**: off (set by a command)",
            "- **Collaborators**: on",
          ].join("\n"),
        ),
      ),
    ).value;
    expect(model.ceremonies).toEqual({
      sensors: { value: "on", source: "from scope express" },
      learnings: { value: "off", source: "set by you" },
      summaryConfirmation: { value: "off", source: "from scope express" },
      planApproval: { value: "off", source: "set by a command" },
      collaborators: { value: "on", source: null },
    });
    expect(model.unparseable).toBeUndefined();
  });

  it("leaves unrecorded ceremonies out and reports unreadable ones", () => {
    const model = expectOk(
      parseState(state("", "- **Plan Approval**: maybe\n- **Sensors**: on")),
    ).value;
    expect(model.ceremonies).toEqual({ sensors: { value: "on", source: null } });
    expect(model.unparseable?.ceremonies).toBe("unknown Plan Approval: maybe");
    const none = expectOk(parseState(state("", ""))).value;
    expect(none.ceremonies).toBeUndefined();
  });

  it("reads Project Type with the source that decided it, and a tailored plan", () => {
    const model = expectOk(
      parseState(
        state(
          "- **Project Type**: Brownfield\n- **Project Type Source**: you\n- **Plan**: tailored plan",
          "",
        ),
      ),
    ).value;
    expect(model.projectType).toEqual({ value: "Brownfield", source: "you" });
    expect(model.plan).toBe("tailored plan");
  });

  it("treats a missing source as the workspace scan and a missing plan as none", () => {
    const model = expectOk(parseState(state("- **Project Type**: Greenfield", ""))).value;
    expect(model.projectType).toEqual({ value: "Greenfield", source: null });
    expect(model.plan).toBeUndefined();
    expect(expectOk(parseState(state("", ""))).value.projectType).toBeUndefined();
  });
});

/**
 * The Construction settings decide where Construction approval gates fall
 * (timing/next-gate.ts). The engine reads each one with `getField` — the first
 * `- **<name>**: <value>` line anywhere in the file, trimmed — and compares it
 * to one exact value. The parser mirrors that so an unusual file reads the way
 * the engine reads it, not the way a section-scoped lookup would.
 */
describe("Construction gate policy", () => {
  const NONE = {
    checkpoints: false,
    unitMajor: false,
    iterationRecorded: false,
    swarm: false,
    autonomous: false,
    teamOwnership: false,
    unitEndRhythm: false,
    skeletonStanceRecorded: false,
    skeletonMayRun: false,
  };
  const state = (runtime: string, status = "") =>
    [
      "## Project Information",
      "- **State Version**: 8",
      "## Runtime State",
      runtime,
      "## Current Status",
      "- **Lifecycle Phase**: CONSTRUCTION",
      status,
    ].join("\n");

  it("reads the golden snapshot's unit-major iteration and recorded skeleton stance", async () => {
    const { value } = expectOk(await readState(fixture("golden")));
    expect(value.constructionPolicy).toEqual({
      ...NONE,
      unitMajor: true,
      iterationRecorded: true,
      skeletonStanceRecorded: true,
      skeletonMayRun: true,
    });
  });

  it("reports every flag false for a legacy file without the settings", () => {
    expect(expectOk(parseState(state(""))).value.constructionPolicy).toEqual(NONE);
  });

  it("reads each setting where the state template declares it", () => {
    const runtime = [
      "- **Construction Checkpoints**: enabled",
      "- **Construction Iteration**: unit-major",
      "- **Construction Execution**: swarm",
      "- **Unit Ownership**: team",
      "- **Unit Gate Rhythm**: unit-end",
      "- **Skeleton Stance**: off",
    ].join("\n");
    const { value } = expectOk(
      parseState(state(runtime, "- **Construction Autonomy Mode**: autonomous")),
    );
    expect(value.constructionPolicy).toEqual({
      checkpoints: true,
      unitMajor: true,
      iterationRecorded: true,
      swarm: true,
      autonomous: true,
      teamOwnership: true,
      unitEndRhythm: true,
      skeletonStanceRecorded: true,
      skeletonMayRun: false,
    });
  });

  it.each([
    ["on", true],
    ["scope-dependent", true],
    ["off", false],
    ["On", false],
  ])("reads Skeleton Stance %s as a possible walking skeleton: %s", (stance, may) => {
    const { value } = expectOk(parseState(state(`- **Skeleton Stance**: ${stance}`)));
    expect(value.constructionPolicy?.skeletonMayRun).toBe(may);
    expect(value.constructionPolicy?.skeletonStanceRecorded).toBe(true);
  });

  it("matches only the engine's exact values, after trimming", () => {
    const runtime = [
      "- **Construction Checkpoints**: Enabled",
      "- **Construction Iteration**: stage-major",
      "- **Construction Execution**: serial",
      "- **Unit Ownership**: solo",
      "- **Unit Gate Rhythm**: per-stage",
    ].join("\n");
    const { value } = expectOk(
      parseState(state(runtime, "- **Construction Autonomy Mode**: gated")),
    );
    expect(value.constructionPolicy).toEqual({ ...NONE, iterationRecorded: true });
    const padded = expectOk(
      parseState(state("- **Construction Iteration**:   unit-major  \r")),
    );
    expect(padded.value.constructionPolicy?.unitMajor).toBe(true);
  });

  it.each([
    ["- **Construction Iteration**: stage-major", true, false],
    ["- **Construction Iteration**: unit-major", true, true],
    ["", false, false],
  ])(
    "tells a recorded stage-major apart from no Construction Iteration line (%s)",
    (runtime, recorded, unitMajor) => {
      const { value } = expectOk(parseState(state(runtime)));
      expect(value.constructionPolicy?.iterationRecorded).toBe(recorded);
      expect(value.constructionPolicy?.unitMajor).toBe(unitMajor);
    },
  );

  it("uses the first line anywhere in the file, like the engine's getField", () => {
    const text = [
      state("- **Construction Autonomy Mode**: autonomous"),
      "- **Construction Autonomy Mode**: gated",
    ].join("\n");
    expect(expectOk(parseState(text)).value.constructionPolicy?.autonomous).toBe(true);
  });

  it("counts a blank Skeleton Stance line as recorded, as the engine's null check does", () => {
    const { value } = expectOk(parseState(state("- **Skeleton Stance**:")));
    expect(value.constructionPolicy?.skeletonStanceRecorded).toBe(true);
  });

  it("reads a setting above every section heading, which only the engine lookup sees", () => {
    const text = `- **Construction Checkpoints**: enabled\n${state("")}`;
    const { value } = expectOk(parseState(text));
    expect(value.constructionPolicy?.checkpoints).toBe(true);
    // Section-scoped fields are unaffected: the line belongs to no section.
    expect(value.project).toBe("");
  });
});

describe("entry-level failures", () => {
  it("reports a missing state file", async () => {
    expect(await readState(fixture("does-not-exist"))).toEqual({
      error: true,
      reason: "state-missing",
    });
  });

  it("reports a state path that is not a readable file", async () => {
    expect(await readState(fixture("state-not-a-file"))).toEqual({
      error: true,
      reason: "state-unreadable",
    });
  });
});

describe("R-RC-3 — mid-write tolerance", () => {
  it("treats a truncated file as missing fields, not a crash", async () => {
    const { value } = expectOk(await readState(fixture("truncated")));

    expect(value.project).toBe("half-written workspace");
    expect(value.depth).toBe("Standard");
    // Current Status never made it to disk.
    expect(value.phase).toBe("INITIALIZATION");
    expect(value.unparseable?.phase).toBe("missing field");
    expect(value.currentStage).toBeNull();
    expect(value.gate).toBeNull();
    // The half-written row is not a stage row yet, so it is not counted.
    expect(value.stages.map((s) => s.slug)).toEqual(["intent-capture"]);
    expect(value.done).toBe(1);
    expect(value.total).toBe(1);
  });

  it("survives an empty file", () => {
    expect(parseState("")).toEqual({ unsupported: true, version: "unknown" });
  });
});

describe("G-3/G-4/G-5 — row- and field-level degradation", () => {
  it("marks unknown marks and unknown execution words without losing the row", async () => {
    const { value, warnings } = expectOk(await readState(fixture("degraded")));

    expect(warnings).toBeUndefined();
    expect(value.stages.find((s) => s.slug === "feasibility")).toEqual({
      slug: "feasibility",
      phase: "IDEATION",
      execution: "EXECUTE",
      status: "not-started",
      unparseable: 'unknown-mark: "@"',
    });
    // An unreadable execution column degrades to SKIP so it cannot inflate the
    // G-6 EXECUTE tally.
    expect(value.stages.find((s) => s.slug === "scope-definition")).toEqual({
      slug: "scope-definition",
      phase: "IDEATION",
      execution: "SKIP",
      status: "completed",
      unparseable: "unknown-execution: PONDERING",
    });
  });

  it("drops rows under an unknown phase heading (G-4)", async () => {
    const { value } = expectOk(await readState(fixture("degraded")));
    expect(value.stages.map((s) => s.slug)).not.toContain("teleportation");
    expect(value.stages).toHaveLength(6);
  });

  it("marks an unknown Lifecycle Phase and keeps the rest of the model", async () => {
    const { value } = expectOk(await readState(fixture("degraded")));
    expect(value.unparseable?.phase).toBe("unknown phase: SPECULATION");
    expect(value.unparseable?.scope).toBe("missing field: Project Information → Scope");
    expect(value.unparseable?.depth).toBe("missing field: Scope Configuration → Depth");
    expect(value.currentStage).toBe("user-stories");
    expect(value.gate).toBe("in-progress");
  });

  it("falls back to the [x]+[S] tally when Completed is absent (G-5)", async () => {
    const { value } = expectOk(await readState(fixture("degraded")));
    // Only `[x] intent-capture — EXECUTE` counts: the tally shares G-6's
    // in-scope denominator, so out-of-scope rows never advance it.
    expect(value.done).toBe(1);
    expect(value.total).toBe(3);
  });

  it("reads an unticked out-of-scope row as skipped, not not-started", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Stage Progress",
      "### IDEATION PHASE",
      "- [ ] a — EXECUTE",
      "- [ ] b — SKIP",
      "- [-] c — SKIP",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.stages.map((s) => s.status)).toEqual(["not-started", "skipped", "in-progress"]);
    // A skipped row is not counted as done — total is the EXECUTE row alone.
    expect(value.done).toBe(0);
    expect(value.total).toBe(1);
  });

  it("never reads a degraded row as skipped", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Stage Progress",
      "### IDEATION PHASE",
      // Unknown execution: degrades to SKIP so it cannot inflate the G-6
      // EXECUTE tally — a counting guard, not a statement about the checkbox.
      "- [ ] a — PONDERING",
      // Unknown mark: falls back to not-started so the row stays countable —
      // not evidence that the box was blank.
      "- [@] b — SKIP",
      // A readable mark keeps its own meaning through the same degradation.
      "- [x] c — PONDERING",
      "- [-] d — PONDERING",
      "## Current Status",
      "- **Current Stage**: b",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.stages).toEqual([
      {
        slug: "a",
        phase: "IDEATION",
        execution: "SKIP",
        status: "not-started",
        unparseable: "unknown-execution: PONDERING",
      },
      {
        slug: "b",
        phase: "IDEATION",
        execution: "SKIP",
        status: "not-started",
        unparseable: 'unknown-mark: "@"',
      },
      {
        slug: "c",
        phase: "IDEATION",
        execution: "SKIP",
        status: "completed",
        unparseable: "unknown-execution: PONDERING",
      },
      {
        slug: "d",
        phase: "IDEATION",
        execution: "SKIP",
        status: "in-progress",
        unparseable: "unknown-execution: PONDERING",
      },
    ]);
    // The gate must not report a skip neither row actually states.
    expect(value.gate).toBe("not-started");
  });

  it("maps all six G-3 marks", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Stage Progress",
      "### IDEATION PHASE",
      "- [ ] a — EXECUTE",
      "- [-] b — EXECUTE",
      "- [?] c — EXECUTE",
      "- [R] d — EXECUTE",
      "- [x] e — EXECUTE",
      "- [S] f — EXECUTE",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.stages.map((s) => s.status)).toEqual([
      "not-started",
      "in-progress",
      "awaiting-approval",
      "revising",
      "completed",
      "skipped",
    ]);
  });

  it("reports an open gate through the current stage's mark", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Stage Progress",
      "### INCEPTION PHASE",
      "- [?] user-stories — EXECUTE",
      "## Current Status",
      "- **Lifecycle Phase**: INCEPTION",
      "- **Current Stage**: user-stories",
    ].join("\r\n"); // CRLF: the parser must be newline-agnostic (NFR-4)
    const { value } = expectOk(parseState(text));
    expect(value.gate).toBe("awaiting-approval");
    expect(value.currentStage).toBe("user-stories");
  });

  it("ignores checkbox rows outside the Stage Progress section", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Notes",
      "### IDEATION PHASE",
      "- [x] not-a-stage — EXECUTE",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.stages).toHaveLength(0);
  });

  it("ignores stage rows that appear before any phase heading", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Stage Progress",
      "- [x] orphan — EXECUTE",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.stages).toHaveLength(0);
  });

  it("treats an empty field value as absent", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "- **Project**:",
      "## Current Status",
      "- **Current Stage**:",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.project).toBe("");
    expect(value.unparseable?.project).toBe("missing field: Project Information → Project");
    expect(value.currentStage).toBeNull();
  });
});

describe("Current Stage / Next Stage 'none' sentinel (Codex PR #4 finding 1)", () => {
  it("normalizes the engine's completed-workflow sentinel to null for both fields", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Current Status",
      "- **Lifecycle Phase**: CONSTRUCTION",
      "- **Status**: Completed",
      "- **Current Stage**: none",
      "- **Next Stage**: none",
      "## Stage Progress",
      "### CONSTRUCTION PHASE",
      "- [x] a — EXECUTE",
      "- [x] b — EXECUTE",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.currentStage).toBeNull();
    expect(value.nextStage).toBeNull();
    // No stage is ever slugged "none", so the gate lookup already resolves
    // to null on its own — confirms the sentinel doesn't leak into `gate`.
    expect(value.gate).toBeNull();
  });

  it("still parses a real slug that happens to contain 'none' as a substring", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Current Status",
      "- **Current Stage**: nonexistent-stage-name",
      "## Stage Progress",
      "### IDEATION PHASE",
      "- [-] nonexistent-stage-name — EXECUTE",
    ].join("\n");
    const { value } = expectOk(parseState(text));
    expect(value.currentStage).toBe("nonexistent-stage-name");
    expect(value.gate).toBe("in-progress");
  });
});

describe("G-6 — total sourcing", () => {
  it("prefers the field and warns when it disagrees with the EXECUTE tally", async () => {
    const { value, warnings } = expectOk(await readState(fixture("total-mismatch")));

    expect(value.total).toBe(99);
    expect(warnings).toEqual(["Total Stages field (99) disagrees with the EXECUTE row count (2)"]);
    expect(value.done).toBe(1);
  });

  it("stays silent when the field agrees with the tally", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Execution Plan Summary",
      "- **Total Stages**: 1",
      "## Stage Progress",
      "### IDEATION PHASE",
      "- [x] a — EXECUTE",
      "- [ ] b — SKIP",
    ].join("\n");
    const result = parseState(text);
    expect(expectOk(result).warnings).toBeUndefined();
    expect(expectOk(result).value.total).toBe(1);
  });

  it("falls back to the tally when the field is unparseable", () => {
    const text = [
      "## Project Information",
      "- **State Version**: 8",
      "## Execution Plan Summary",
      "- **Total Stages**: many",
      "## Stage Progress",
      "### IDEATION PHASE",
      "- [x] a — EXECUTE",
    ].join("\n");
    const { value, warnings } = expectOk(parseState(text));
    expect(value.total).toBe(1);
    expect(warnings).toBeUndefined();
  });
});

/**
 * aidlc-workflows v2.11.0 `aidlc-state.ts unit start|pause|resume` mirrors the
 * open Unit into `## Runtime State` and `unit complete` removes it. Under
 * unit-major that is the only state-file field naming the step the work is on.
 */
describe("Active Unit cache", () => {
  const state = (runtime: string) =>
    [
      "## Project Information",
      "- **State Version**: 8",
      "## Runtime State",
      runtime,
      "## Current Status",
      "- **Lifecycle Phase**: CONSTRUCTION",
      "- **Current Stage**: functional-design",
      "## Stage Progress",
      "### CONSTRUCTION PHASE",
      "- [-] functional-design — EXECUTE",
      "- [ ] code-generation — EXECUTE",
    ].join("\n");

  it("reads the Unit, its own stage and its state", () => {
    const text = state(
      [
        "- **Active Unit**: u2-note-tags",
        "- **Unit Stage**: code-generation",
        "- **Unit State**: in-progress",
      ].join("\n"),
    );
    expect(expectOk(parseState(text)).value.activeUnit).toEqual({
      unit: "u2-note-tags",
      stage: "code-generation",
      state: "in-progress",
    });
  });

  it("reads a paused Unit", () => {
    const text = state(
      ["- **Active Unit**: u1", "- **Unit Stage**: functional-design", "- **Unit State**: paused"].join(
        "\n",
      ),
    );
    expect(expectOk(parseState(text)).value.activeUnit?.state).toBe("paused");
  });

  it("leaves it out between Units", () => {
    expect(expectOk(parseState(state(""))).value.activeUnit).toBeUndefined();
  });

  it.each(["../escape", "has space", "-leading", "a".repeat(65), ""])(
    "ignores a value that is not a Unit name: %j",
    (unit) => {
      const text = state(`- **Active Unit**: ${unit}\n- **Unit Stage**: code-generation`);
      expect(expectOk(parseState(text)).value.activeUnit).toBeUndefined();
    },
  );

  it("drops a Unit Stage this workflow does not have, keeping the Unit", () => {
    const text = state("- **Active Unit**: u1\n- **Unit Stage**: no-such-stage");
    expect(expectOk(parseState(text)).value.activeUnit).toEqual({
      unit: "u1",
      stage: null,
      state: "in-progress",
    });
  });

  it("reads a missing Unit State as in progress, as the engine's resume context does", () => {
    const text = state("- **Active Unit**: u1\n- **Unit Stage**: code-generation");
    expect(expectOk(parseState(text)).value.activeUnit?.state).toBe("in-progress");
  });
});
