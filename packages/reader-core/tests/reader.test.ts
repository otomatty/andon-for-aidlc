import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReader } from "../src/index.ts";
import { expectOk, fixture, REPO_ROOT } from "./paths.ts";

const RECORD = fixture("record");

/** A reader pinned to a fixture record, bypassing cursor resolution. */
function readerOn(recordDir: string): ReturnType<typeof createReader> {
  return createReader(REPO_ROOT, { recordDir });
}

/** A temporary workspace with a real cursor chain. */
async function seedWorkspace(options: {
  intents: string[];
  cursor?: string;
}): Promise<{ root: string; intentsDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "reader-"));
  const intentsDir = path.join(root, "aidlc", "spaces", "default", "intents");
  for (const intent of options.intents) {
    await mkdir(path.join(intentsDir, intent), { recursive: true });
  }
  await mkdir(intentsDir, { recursive: true });
  if (options.cursor !== undefined) {
    await writeFile(path.join(intentsDir, "active-intent"), `${options.cursor}\n`);
  }
  return { root, intentsDir };
}

describe("createReader — happy path over the fixture record", () => {
  const reader = readerOn(RECORD);

  it("getWorkflow parses the record's state", async () => {
    const { value } = expectOk(await reader.getWorkflow());
    expect(value.project).toBe("fixture record");
    expect(value.currentStage).toBe("functional-design");
    expect(value.gate).toBe("awaiting-approval");
  });

  it("getMatrix sources the exclusion set from the state, not a hardcoded list", async () => {
    const { value } = expectOk(await reader.getMatrix());
    // CONSTRUCTION rows in the fixture state are functional-design + code-generation.
    expect(value.stages).toEqual(["functional-design", "code-generation"]);
    expect(value.units).toEqual(["unit-alpha", "unit-beta", "unit-delta", "unit-gamma"]);
  });

  it("getAuditEvents returns the merged timeline", async () => {
    const { value } = expectOk(await reader.getAuditEvents(2));
    expect(value.map((e) => e.event)).toEqual(["STAGE_COMPLETED", "GATE_OPENED"]);
  });

  it("getNextStep names the next incomplete in-scope stage and what it asks for", async () => {
    const { value } = expectOk(await reader.getNextStep());
    expect(value.nextStage).toBe("code-generation");
    expect(value.requirement).toContain("code-generation");
  });

  it("getTimings scopes runs and warnings to the pinned record alone", async () => {
    const now = Date.parse("2026-07-20T12:10:00Z");
    const { value, warnings } = expectOk(await reader.getTimings(now));

    // The fixture's audit shards derive exactly one run: feasibility, still
    // open (no STAGE_COMPLETED closes it).
    expect(value.intent).toBe(path.basename(RECORD));
    expect(value.timings).toHaveLength(1);
    expect(value.timings[0]).toMatchObject({
      stage: "feasibility",
      endedAt: null,
      // One shard is unreadable, so a numeric work total would be misleading.
      activeMs: null,
      breakdown: null,
      quality: { status: "incomplete", sampleEligible: false },
    });

    // Regression pin for the pinned-recordDir double-count bug: when the
    // sample pool is the same read as `timings` (recordDir pinned), its
    // warnings must not be merged in twice.
    expect(warnings).toEqual([
      "audit shard skipped: unreadable-shard.md (not-a-file)",
      "STAGE_COMPLETED without STAGE_STARTED: intent-capture",
    ]);

    // The only run is still open, so it contributes no sample to the
    // estimate (BR: open runs are in progress, not evidence) — every estimate
    // falls back to "none".
    //
    // The current stage is `functional-design`, but the fixture's only run is
    // for `feasibility` — `functional-design` has no run at all in this
    // record, so elapsed/remaining are unknown (`null`), not a phantom 0
    // (regression pin for whole-branch review finding 1).
    // The payload names the stage it was reconciled against, so a consumer
    // holding a later workflow read can tell stale from current without
    // reverse-engineering it from `isCurrent` (issue #10).
    expect(value.currentStage).toBe("functional-design");

    const current = value.stageViews.find((view) => view.isCurrent);
    expect(current).toMatchObject({
      stage: "functional-design",
      elapsedActiveMs: null,
      remainingMs: null,
      sampleCount: 0,
      basis: "none",
      currentAttempt: null,
      history: [],
      countsTowardRemaining: true,
    });
    // There is one view per state-file row and no more: `feasibility` owns
    // the fixture's open run but has no row here, so it stays in the raw
    // `timings` list and never becomes a stage the workflow claims to have.
    expect(value.stageViews.map((view) => view.stage)).toEqual([
      "intent-capture",
      "market-research",
      "functional-design",
      "code-generation",
    ]);
    expect(value.timings.some((timing) => timing.stage === "feasibility")).toBe(true);
    expect(value.remaining).toMatchObject({ totalRemainingMs: null, lowConfidence: true });
    expect(value.policy?.algorithmVersion).toBe("session-gap-v2");
    expect(value.estimateCoverage).toEqual(value.remaining.estimateCoverage);
    // The fixture's current stage sits at its open gate (`[?]`): the next
    // approval is now, whatever the unknown remainders say.
    expect(value.nextGate).toMatchObject({
      kind: "open",
      stage: "functional-design",
      remainingMs: 0,
      stages: [],
    });
  });

  it("getTimings places the next gate using the state's Construction settings", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "reader-gate-"));
    try {
      await writeFile(
        path.join(dir, "aidlc-state.md"),
        [
          "## Project Information",
          "- **Project**: gate",
          "- **Scope**: feature",
          "- **State Version**: 8",
          "## Scope Configuration",
          "- **Depth**: Standard",
          "## Runtime State",
          "- **Construction Iteration**: unit-major",
          "## Stage Progress",
          "### INCEPTION PHASE",
          "- [x] units-generation — EXECUTE",
          "### CONSTRUCTION PHASE",
          "- [ ] functional-design — EXECUTE",
          "- [ ] code-generation — EXECUTE",
          "- [ ] build-and-test — EXECUTE",
          "## Current Status",
          "- **Lifecycle Phase**: CONSTRUCTION",
          "- **Current Stage**: functional-design",
        ].join("\n"),
      );
      const { value } = expectOk(await readerOn(dir).getTimings(Date.parse("2026-07-20T12:00:00Z")));
      // Unit-major holds the per-Unit gates until every Unit has finished both
      // per-Unit stages; build-and-test's own gate comes after that.
      expect(value.nextGate).toMatchObject({
        kind: "block",
        stage: "functional-design",
        stages: ["functional-design", "code-generation"],
        planApproval: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // v2.11.0 resolvePlanApprovalSetting: the intent's Plan Approval line, held on
  // by a memory layer's Guard Policy strict.
  it.each([
    ["recorded on", "- **Plan Approval**: on (from scope feature)", null, true],
    ["recorded off", "- **Plan Approval**: off (from scope express)", null, false],
    ["unrecorded", "", null, true],
    ["unrecorded in a scope that turns it off", "- **Scope**: express", null, false],
    ["off but held by strict memory", "- **Plan Approval**: off (set by you)", "strict", true],
    ["off with relaxed memory", "- **Plan Approval**: off (set by you)", "relaxed", false],
    ["off with unreadable memory", "- **Plan Approval**: off (set by you)", "unknown", true],
  ])("getTimings notes the plan approval only when it is on: %s", async (_, line, memory, expected) => {
    const root = await mkdtemp(path.join(tmpdir(), "reader-plan-"));
    const dir = path.join(root, "aidlc", "spaces", "default", "intents", "plan");
    try {
      await mkdir(dir, { recursive: true });
      if (memory !== null) {
        await mkdir(path.join(root, "aidlc", "spaces", "default", "memory"), { recursive: true });
        await writeFile(
          path.join(root, "aidlc", "spaces", "default", "memory", "team.md"),
          `## Guard Policy\nMode: ${memory}\n`,
        );
      }
      await writeFile(
        path.join(dir, "aidlc-state.md"),
        [
          "## Project Information",
          "- **Project**: plan",
          line.startsWith("- **Scope**") ? line : "- **Scope**: feature",
          "- **State Version**: 8",
          "## Scope Configuration",
          "- **Depth**: Standard",
          line.startsWith("- **Scope**") ? "" : line,
          "## Stage Progress",
          "### CONSTRUCTION PHASE",
          "- [x] functional-design — EXECUTE",
          "- [-] code-generation — EXECUTE",
          "## Current Status",
          "- **Lifecycle Phase**: CONSTRUCTION",
          "- **Current Stage**: code-generation",
        ].join("\n"),
      );
      const { value } = expectOk(await readerOn(dir).getTimings(Date.parse("2026-07-20T12:00:00Z")));
      expect(value.nextGate?.planApproval).toBe(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("getTimings carries each Unit's progress from the DAG and the Unit receipts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "reader-unit-walk-"));
    try {
      await writeFile(
        path.join(dir, "aidlc-state.md"),
        [
          "## Project Information",
          "- **Project**: units",
          "- **Scope**: feature",
          "- **State Version**: 8",
          "## Scope Configuration",
          "- **Depth**: Standard",
          "## Runtime State",
          "- **Construction Iteration**: unit-major",
          "- **Active Unit**: beta",
          "- **Unit Stage**: code-generation",
          "- **Unit State**: in-progress",
          "## Stage Progress",
          "### INCEPTION PHASE",
          "- [x] units-generation — EXECUTE",
          "### CONSTRUCTION PHASE",
          "- [-] functional-design — EXECUTE",
          "- [ ] code-generation — EXECUTE",
          "- [ ] build-and-test — EXECUTE",
          "## Current Status",
          "- **Lifecycle Phase**: CONSTRUCTION",
          "- **Current Stage**: functional-design",
        ].join("\n"),
      );
      const now = Date.parse("2026-07-20T12:00:00Z");
      // No DAG yet: nothing to walk.
      expect(expectOk(await readerOn(dir).getTimings(now)).value.unitWalk).toBeNull();

      const dagDir = path.join(dir, "inception", "units-generation");
      await mkdir(dagDir, { recursive: true });
      await writeFile(
        path.join(dagDir, "unit-of-work-dependency.md"),
        "```yaml\nunits:\n  - name: beta\n    depends_on: [alpha]\n  - name: alpha\n    depends_on: []\n```\n",
      );
      await mkdir(path.join(dir, "audit"));
      const row = (at: string, event: string, unit: string, stage: string) =>
        [`## ${event}`, `**Timestamp**: ${at}`, `**Event**: ${event}`, `**Unit**: ${unit}`, `**Stage**: ${stage}`, "", "---", ""].join("\n");
      await writeFile(
        path.join(dir, "audit", "a-clone.md"),
        [
          row("2026-07-20T10:00:00Z", "UNIT_COMPLETED", "alpha", "functional-design"),
          row("2026-07-20T11:00:00Z", "UNIT_COMPLETED", "beta", "functional-design"),
          [
            "## SWARM_UNIT_CONVERGED",
            "**Timestamp**: 2026-07-20T11:30:00Z",
            "**Event**: SWARM_UNIT_CONVERGED",
            "**Unit name**: alpha",
            "**Stage**: code-generation",
            "**Run floor**: unstarted#0",
            "",
            "---",
            "",
          ].join("\n"),
        ].join("\n"),
      );
      const walk = expectOk(await readerOn(dir).getTimings(now)).value.unitWalk;
      expect(walk?.stages).toEqual(["functional-design", "code-generation"]);
      expect(walk?.units.map((u) => [u.unit, u.status, u.steps.map((s) => s.status)])).toEqual([
        ["alpha", "completed", ["completed", "completed"]],
        ["beta", "in-progress", ["completed", "in-progress"]],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("getTimings keeps an autonomous walking skeleton's checkpoint until the audit log approves it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "reader-skeleton-"));
    try {
      await writeFile(
        path.join(dir, "aidlc-state.md"),
        [
          "## Project Information",
          "- **Project**: skeleton",
          "- **Scope**: feature",
          "- **State Version**: 8",
          "## Scope Configuration",
          "- **Depth**: Standard",
          "## Runtime State",
          "- **Construction Iteration**: unit-major",
          "- **Construction Checkpoints**: enabled",
          "- **Construction Autonomy Mode**: autonomous",
          "- **Skeleton Stance**: on",
          "## Stage Progress",
          "### INCEPTION PHASE",
          "- [x] units-generation — EXECUTE",
          "### CONSTRUCTION PHASE",
          "- [ ] functional-design — EXECUTE",
          "- [ ] code-generation — EXECUTE",
          "- [ ] build-and-test — EXECUTE",
          "### OPERATION PHASE",
          "- [ ] deployment-pipeline — EXECUTE",
          "## Current Status",
          "- **Lifecycle Phase**: CONSTRUCTION",
          "- **Current Stage**: functional-design",
        ].join("\n"),
      );
      const reader = readerOn(dir);
      const now = Date.parse("2026-07-20T12:00:00Z");
      expect(expectOk(await reader.getTimings(now)).value.nextGate).toMatchObject({
        kind: "unit",
        stage: "code-generation",
      });

      await mkdir(path.join(dir, "audit"));
      await writeFile(
        path.join(dir, "audit", "a-clone.md"),
        [
          "## Construction checkpoint",
          "**Timestamp**: 2026-07-20T11:00:00Z",
          "**Event**: GATE_APPROVED",
          "**Unit**: unit-alpha",
          "**Stage**: code-generation",
          "**Gate Scope**: unit-end",
          "**Checkpoint**: walking-skeleton",
          "",
          "---",
          "",
        ].join("\n"),
      );
      // The remaining Units' checkpoints and the late gates are automatic now.
      expect(expectOk(await reader.getTimings(now)).value.nextGate).toMatchObject({
        kind: "stage",
        stage: "deployment-pipeline",
        autoApproved: ["functional-design", "code-generation", "build-and-test"],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a resolver recordDir still samples every intent in the space", async () => {
    const root = fixture("workspace");
    const record = fixture("record");
    const now = Date.parse("2026-07-26T00:00:00Z");
    const pinned = expectOk(await createReader(root, { recordDir: record }).getTimings(now));
    const resolving = expectOk(
      await createReader(root, {
        recordDir: async () => ({ ok: true as const, value: record }),
      }).getTimings(now),
    );
    expect(pinned.warnings ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/beta-intent:/)]),
    );
    expect(resolving.warnings ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/beta-intent:/)]),
    );
  });

  it("readArtifact returns the body of a file inside the record", async () => {
    const { value } = expectOk(
      await reader.readArtifact("construction/unit-beta/functional-design/design.md"),
    );
    expect(value).toContain("unit-beta");
  });
});

describe("createReader — State Version 7 is unsupported", () => {
  const reader = readerOn(fixture("golden-v7"));

  it("answers every derived read with the explicit unsupported state", async () => {
    const unsupported = { unsupported: true, version: "7" };
    expect(await reader.getWorkflow()).toEqual(unsupported);
    expect(await reader.getNextStep()).toEqual(unsupported);
    expect(await reader.getMatrix()).toEqual(unsupported);
  });
});

describe("createReader — getNextStep edge cases", () => {
  it("skips completed and out-of-scope stages", async () => {
    const { value } = expectOk(await readerOn(fixture("golden")).getNextStep());
    expect(value.nextStage).toBe("build-and-test");
  });

  it("describes what an open gate asks of the human", async () => {
    const { value } = expectOk(await readerOn(fixture("record")).getNextStep());
    expect(value.requirement).toContain("未着手");
  });

  it("distinguishes an in-progress and a revising next stage", async () => {
    const write = async (mark: string): Promise<string> => {
      const root = await mkdtemp(path.join(tmpdir(), "nextstep-"));
      await writeFile(
        path.join(root, "aidlc-state.md"),
        [
          "## Project Information",
          "- **State Version**: 8",
          "## Stage Progress",
          "### CONSTRUCTION PHASE",
          "- [x] functional-design — EXECUTE",
          `- [${mark}] code-generation — EXECUTE`,
          "## Current Status",
          "- **Current Stage**: functional-design",
          "",
        ].join("\n"),
      );
      const { value } = expectOk(await readerOn(root).getNextStep());
      await rm(root, { recursive: true, force: true });
      return value.requirement;
    };

    expect(await write("-")).toContain("実行中");
    expect(await write("R")).toContain("差し戻し");
    expect(await write("?")).toContain("承認ゲートが開いています");
  });

  it("returns null once no in-scope stage is left", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "done-"));
    await writeFile(
      path.join(root, "aidlc-state.md"),
      [
        "## Project Information",
        "- **State Version**: 8",
        "## Stage Progress",
        "### OPERATION PHASE",
        "- [x] performance-validation — EXECUTE",
        "## Current Status",
        "- **Current Stage**: performance-validation",
        "",
      ].join("\n"),
    );

    const { value } = expectOk(await readerOn(root).getNextStep());
    expect(value.nextStage).toBeNull();
    expect(value.requirement).toContain("ワークフロー完了");
    await rm(root, { recursive: true, force: true });
  });
});

describe("US-15 — the five failure modes", () => {
  it("mode 1: no active intent — every record-dependent method says so", async () => {
    // >1 records + no cursor → engine activeIntent() is null (not lone-intent).
    const { root } = await seedWorkspace({ intents: ["a-intent", "b-intent"] });
    const reader = createReader(root);
    const expected = { error: true, reason: "no-active-intent" };

    expect(await reader.getWorkflow()).toEqual(expected);
    expect(await reader.getMatrix()).toEqual(expected);
    expect(await reader.getAuditEvents(5)).toEqual(expected);
    expect(await reader.getNextStep()).toEqual(expected);
    expect(await reader.readArtifact("aidlc-state.md")).toEqual(expected);
    // getIntents is the one that still works — it is how the UI recovers.
    expect(expectOk(await reader.getIntents()).value.all).toEqual(["a-intent", "b-intent"]);
    expect(expectOk(await reader.getIntents()).value.active).toBeNull();

    await rm(root, { recursive: true, force: true });
  });

  it("mode 2: multiple intents are always enumerated", async () => {
    const { root } = await seedWorkspace({ intents: ["b-intent", "a-intent"], cursor: "a-intent" });
    const { value } = expectOk(await createReader(root).getIntents());
    expect(value.all).toEqual(["a-intent", "b-intent"]);
    expect(value.active).toBe("a-intent");
    await rm(root, { recursive: true, force: true });
  });

  it("mode 3: unparseable state — unsupported version is explicit, not a guess", async () => {
    expect(await readerOn(fixture("unsupported-version")).getWorkflow()).toEqual({
      unsupported: true,
      version: "9",
    });
    expect(await readerOn(fixture("unsupported-version")).getMatrix()).toEqual({
      unsupported: true,
      version: "9",
    });
    expect(await readerOn(fixture("does-not-exist")).getWorkflow()).toEqual({
      error: true,
      reason: "state-missing",
    });
  });

  it("mode 4: one broken cell, every other cell healthy", async () => {
    const { value } = expectOk(await readerOn(RECORD).getMatrix());
    const broken = value.cells.filter((c) => c.error !== undefined);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.unit).toBe("unit-gamma");
    expect(value.cells.filter((c) => c.error === undefined)).toHaveLength(7);
  });

  it("mode 5: an unreadable audit shard is a warning, not a failure", async () => {
    const result = expectOk(await readerOn(RECORD).getAuditEvents(10));
    expect(result.value.length).toBe(4);
    expect(result.warnings?.[0]).toContain("unreadable-shard.md");
  });
});

describe("readArtifact — boundary (S-RC-2)", () => {
  const reader = readerOn(RECORD);

  it("rejects traversal", async () => {
    expect(await reader.readArtifact("../../../package.json")).toEqual({
      error: true,
      reason: "outside-record",
    });
  });

  it("rejects an absolute path outside the record", async () => {
    expect(await reader.readArtifact(path.join(REPO_ROOT, "package.json"))).toEqual({
      error: true,
      reason: "outside-record",
    });
  });

  it("reports a missing artifact distinctly from a rejected one", async () => {
    expect(await reader.readArtifact("construction/unit-beta/nope.md")).toEqual({
      error: true,
      reason: "artifact-not-found",
    });
  });

  it("rejects an oversized artifact before loading it (S-RC-4)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "oversize-"));
    // Just over the 10MB bound; the state file gets the same treatment.
    const oversized = "x".repeat(10 * 1024 * 1024 + 1);
    await writeFile(path.join(root, "aidlc-state.md"), oversized);

    const big = readerOn(root);
    expect(await big.readArtifact("aidlc-state.md")).toEqual({
      error: true,
      reason: "file-too-large",
    });
    expect(await big.getWorkflow()).toEqual({ error: true, reason: "file-too-large" });

    await rm(root, { recursive: true, force: true });
  });
});

describe("createReader — contract", () => {
  it("re-resolves the record on every call, so an intent switch is visible", async () => {
    const { root, intentsDir } = await seedWorkspace({
      intents: ["intent-one", "intent-two"],
      cursor: "intent-one",
    });
    const state = (project: string) =>
      ["## Project Information", `- **Project**: ${project}`, "- **State Version**: 8", ""].join(
        "\n",
      );
    await writeFile(path.join(intentsDir, "intent-one", "aidlc-state.md"), state("one"));
    await writeFile(path.join(intentsDir, "intent-two", "aidlc-state.md"), state("two"));

    const reader = createReader(root);
    expect(expectOk(await reader.getWorkflow()).value.project).toBe("one");

    await writeFile(path.join(intentsDir, "active-intent"), "intent-two\n");
    expect(expectOk(await reader.getWorkflow()).value.project).toBe("two");

    await rm(root, { recursive: true, force: true });
  });

  it("never throws, whatever the record looks like (R-RC-1)", async () => {
    const candidates = [
      fixture("record"),
      fixture("golden"),
      fixture("truncated"),
      fixture("degraded"),
      fixture("no-version"),
      fixture("state-not-a-file"),
      fixture("does-not-exist"),
      path.join(path.sep, "definitely", "not", "a", "record"),
    ];

    for (const recordDir of candidates) {
      const reader = readerOn(recordDir);
      for (const result of [
        await reader.getWorkflow(),
        await reader.getMatrix(),
        await reader.getAuditEvents(5),
        await reader.getIntents(),
        await reader.getNextStep(),
        await reader.readArtifact("anything.md"),
        await reader.readArtifact("../escape.md"),
      ]) {
        expect("ok" in result || "error" in result || "unsupported" in result).toBe(true);
      }
    }
  });

  it("does not touch the filesystem at construction time (P-RC-7)", () => {
    expect(() => createReader(path.join(path.sep, "nope"))).not.toThrow();
  });

  it("watch resolves the record lazily and disposal is safe before it resolves", async () => {
    const { root, intentsDir } = await seedWorkspace({
      intents: ["intent-one"],
      cursor: "intent-one",
    });
    await mkdir(path.join(intentsDir, "intent-one", "construction"), { recursive: true });

    const dispose = createReader(root).watch(() => {
      throw new Error("must not fire");
    });
    dispose();
    await new Promise((r) => setTimeout(r, 100));

    await rm(root, { recursive: true, force: true });
  });

  it("watch is a no-op when there is no active intent", async () => {
    const { root } = await seedWorkspace({ intents: ["a-intent"] });
    const dispose = createReader(root).watch(() => {
      throw new Error("must not fire");
    });
    await new Promise((r) => setTimeout(r, 100));
    dispose();
    await rm(root, { recursive: true, force: true });
  });
});
