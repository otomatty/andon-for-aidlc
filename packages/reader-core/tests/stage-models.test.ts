import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { StageModelsPayload } from "@andon/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStageModels } from "../src/models/read.ts";

let root: string;
let record: string;
const graph = [
  {
    slug: "code-generation",
    lead_agent: "aidlc-developer-agent",
    mode: "subagent",
    reviewer: "aidlc-reviewer-agent",
    support_agents: [],
  },
  {
    slug: "functional-design",
    lead_agent: "aidlc-developer-agent",
    mode: "inline",
    support_agents: ["aidlc-reviewer-agent"],
  },
  {
    slug: "user-stories",
    lead_agent: "aidlc-developer-agent",
    mode: "mob",
    support_agents: ["aidlc-reviewer-agent"],
  },
];
async function file(rel: string, content: string | object) {
  const target = join(root, rel);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, typeof content === "string" ? content : JSON.stringify(content));
}
async function read(): Promise<StageModelsPayload> {
  const result = await readStageModels(root, record);
  if (!("ok" in result)) throw new Error(JSON.stringify(result));
  return result.value;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "stage-models-"));
  record = join(root, "aidlc/spaces/default/intents/example");
  vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "0");
  await file(".claude/tools/data/stage-graph.json", graph);
  await file(
    ".claude/agents/aidlc-developer-agent.md",
    "---\nname: developer\nmodel: inherit\n---\n",
  );
  await file(".claude/agents/aidlc-reviewer-agent.md", "---\nmodel: sonnet\neffort: medium\n---\n");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("stage model settings", () => {
  it("separates inline session work, dispatched roles and configured reviewer aliases", async () => {
    await file(".claude/settings.json", {
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-project",
        AWS_SECRET_ACCESS_KEY: "private-value",
      },
    });
    await file(".claude/settings.local.json", {
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-local" },
    });
    const payload = await read();
    const stages = payload.harnesses[0]?.stages;
    expect(stages?.[0]?.lead.source).toBe("session");
    expect(stages?.[0]?.reviewer).toMatchObject({
      source: "agent",
      model: "sonnet",
      effort: "medium",
      projectModel: "sonnet-local",
    });
    expect(stages?.[1]?.supports[0]?.source).toBe("session");
    expect(stages?.[2]?.lead.source).toBe("session");
    expect(stages?.[2]?.supports[0]?.source).toBe("agent");
    expect(JSON.stringify(payload)).not.toContain("private-value");
  });

  it("reads arbitrary future model IDs without a model catalog, and keeps Cursor independent", async () => {
    await file(
      ".claude/agents/aidlc-developer-agent.md",
      '---\nmodel: "provider/fable-5.1" # local override\neffort: high\n---\n',
    );
    await file(".cursor/tools/data/stage-graph.json", graph);
    await file(".cursor/agents/aidlc-developer-agent.md", "---\nname: developer\n---\n");
    await file(".cursor/agents/aidlc-reviewer-agent.md", "---\nname: reviewer\n---\n");
    const payload = await read();
    expect(payload.harnesses[0]?.stages[0]?.lead).toMatchObject({
      model: "provider/fable-5.1",
      effort: "high",
      source: "agent",
    });
    expect(payload.harnesses[1]?.stages[0]?.reviewer?.source).toBe("session");
    expect(payload.harnesses[0]?.stages[1]?.lead.source).toBe("session");
  });

  it.each([
    "no frontmatter",
    "---\nmodel: |\n  sonnet\n---\n",
    "---\nmodel: sonnet\nmodel: opus\n---\n",
  ])("does not guess inheritance for malformed persona %s", async (content) => {
    await file(".claude/agents/aidlc-developer-agent.md", content);
    expect((await read()).harnesses[0]?.stages[0]?.lead.source).toBe("unavailable");
  });

  it("degrades missing personas and invalid graphs independently", async () => {
    await rm(join(root, ".claude/agents/aidlc-developer-agent.md"));
    await file(".cursor/tools/data/stage-graph.json", "not json");
    const result = await readStageModels(root, record);
    expect("ok" in result && result.value.harnesses[0]?.stages[0]?.lead.source).toBe("unavailable");
    expect("ok" in result && result.warnings).toContain(
      ".cursor/tools/data/stage-graph.json: invalid JSON",
    );
  });

  it("caps unique persona reads across both harnesses in one request", async () => {
    const names = Array.from({ length: 40 }, (_, index) => `aidlc-agent-${index}`);
    await file(
      ".claude/tools/data/stage-graph.json",
      names.map((name, index) => ({
        slug: `claude-stage-${index}`,
        lead_agent: name,
        mode: "subagent",
      })),
    );
    await file(
      ".cursor/tools/data/stage-graph.json",
      names.map((name, index) => ({
        slug: `cursor-stage-${index}`,
        lead_agent: name,
        mode: "subagent",
      })),
    );
    await Promise.all(
      names.flatMap((name) => [
        file(`.claude/agents/${name}.md`, "---\nmodel: sonnet\n---\n"),
        file(`.cursor/agents/${name}.md`, "---\nmodel: opus\n---\n"),
      ]),
    );
    const result = await readStageModels(root, record);
    expect("ok" in result && result.warnings).toContain("persona read budget exceeded");
    const leads =
      "ok" in result
        ? result.value.harnesses.flatMap((harness) => harness.stages.map((stage) => stage.lead))
        : [];
    expect(leads).toHaveLength(80);
    expect(leads.filter((lead) => lead.source === "agent")).toHaveLength(64);
    expect(leads.filter((lead) => lead.source === "unavailable")).toHaveLength(16);
    expect(leads.filter((lead) => lead.source === "agent").every((lead) => lead.model)).toBe(true);
    expect(leads.filter((lead) => lead.source === "unavailable").every((lead) => !lead.model)).toBe(
      true,
    );
  });

  it("does not spend the persona read budget on invalid agent names", async () => {
    const invalid = Array.from({ length: 64 }, (_, index) => `Invalid Agent ${index}`);
    await file(".claude/tools/data/stage-graph.json", [
      ...invalid.map((name, index) => ({
        slug: `invalid-stage-${index}`,
        lead_agent: name,
        mode: "subagent",
        reviewer: `Invalid Reviewer ${index}`,
      })),
      {
        slug: "code-generation",
        lead_agent: "aidlc-developer-agent",
        mode: "subagent",
        reviewer: "aidlc-reviewer-agent",
      },
    ]);
    const result = await readStageModels(root, record);
    const warnings = "ok" in result ? (result.warnings ?? []) : [];
    expect(warnings).not.toContain("persona read budget exceeded");
    const stages = "ok" in result ? result.value.harnesses[0]?.stages : undefined;
    const valid = stages?.find((stage) => stage.slug === "code-generation");
    expect(valid?.lead).toMatchObject({ source: "session", model: null });
    expect(valid?.reviewer).toMatchObject({
      source: "agent",
      model: "sonnet",
      effort: "medium",
    });
    expect(stages?.filter((stage) => stage.lead.source === "unavailable")).toHaveLength(64);
  });

  it("refuses persona symlinks outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "stage-models-outside-"));
    try {
      await writeFile(
        join(outside, "aidlc-developer-agent.md"),
        "---\nmodel: private-model\n---\n",
      );
      await rm(join(root, ".claude/agents"), { recursive: true });
      await symlink(
        outside,
        join(root, ".claude/agents"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const result = await readStageModels(root, record);
      expect(JSON.stringify(result)).not.toContain("private-model");
      expect("ok" in result && result.value.harnesses[0]?.stages[0]?.lead.source).toBe(
        "unavailable",
      );
    } finally {
      await rm(join(root, ".claude/agents"), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("observed usage ownership", () => {
  const bucket = (model: string) => ({
    byStage: { "code-generation": { byModel: { [model]: { tokens: { input: 10 } } } } },
  });
  const ledger = {
    schemaVersion: 3,
    ...bucket("workspace-total"),
    workflows: { "intent:example-id": bucket("fable-5.1"), "intent:other": bucket("other-model") },
  };

  beforeEach(async () => {
    await file("aidlc/spaces/default/intents/intents.json", [
      { dirName: "example", uuid: "example-id" },
    ]);
    await file("aidlc/.aidlc-sessions/usage-ledger.json", ledger);
  });

  it("uses only the selected intent, retaining unrecognized model names", async () => {
    const data = await read();
    expect(data.observed).toEqual({ "code-generation": ["fable-5.1"] });
    expect(data.harnesses[0]?.stages[0]?.lead.model).toBeNull();
  });

  it("does not reuse usage from another record or an unsupported ledger", async () => {
    const other = await readStageModels(root, join(root, "aidlc/spaces/default/intents/missing"));
    expect("ok" in other && other.value.observed).toEqual({});
    await file("aidlc/.aidlc-sessions/usage-ledger.json", { ...ledger, schemaVersion: 2 });
    expect((await read()).observed).toEqual({});
  });

  it("withholds usage when tracking is disabled, preserving settings", async () => {
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "1");
    const result = await readStageModels(root, record);
    expect(result).toMatchObject({
      ok: true,
      value: { observed: null, harnesses: [{ id: "claude" }] },
      warnings: ["usage tracking disabled; token and cost data withheld"],
    });
  });

  it("withholds usage when project settings are unreadable, without treating that as empty usage", async () => {
    const machine = await mkdtemp(join(tmpdir(), "stage-models-machine-"));
    try {
      vi.stubEnv("AIDLC_INSTALL_ROOT", machine);
      vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", undefined);
      await file("aidlc.settings.json", "not json");
      const result = await readStageModels(root, record);
      expect(result).toMatchObject({
        ok: true,
        value: { observed: null, harnesses: [{ id: "claude" }] },
      });
      expect("ok" in result && result.warnings).toEqual(
        expect.arrayContaining([
          "project usage settings unavailable; token and cost data withheld",
          "usage tracking disabled; token and cost data withheld",
        ]),
      );
      expect("ok" in result && result.value.observed).toBeNull();
    } finally {
      await rm(machine, { recursive: true, force: true });
    }
  });

  it("does not select ambiguous catalog entries", async () => {
    await file("aidlc/spaces/default/intents/intents.json", [
      { dirName: "example", uuid: "example-id" },
      { dirName: "example", uuid: "other" },
    ]);
    expect((await read()).observed).toEqual({});
  });
});

// These exercise existing records, not collection by a live model runtime.
describe("usage record validation and recovery", () => {
  const ledgerPath = "aidlc/.aidlc-sessions/usage-ledger.json";
  const recordKey = "record:default/example";
  async function usage(byModel: Record<string, unknown>) {
    await file(ledgerPath, {
      schemaVersion: 3,
      workflows: { [recordKey]: { byStage: { "code-generation": { byModel } } } },
    });
  }

  it.each(["input", "output", "cacheRead", "cacheCreate5m", "cacheCreate1h"])(
    "recognizes usage recorded only in %s without a catalog UUID",
    async (field) => {
      await usage({ "fable-5.1": { tokens: { [field]: 1 } } });
      expect((await read()).observed).toEqual({ "code-generation": ["fable-5.1"] });
    },
  );

  it("omits invalid models and empty usage, retaining all valid model IDs in stable order", async () => {
    await usage({
      "z-model": { tokens: { output: 1 } },
      "a-model": { tokens: { input: 3 } },
      unknown: { tokens: { input: 10 } },
      "": { tokens: { input: 10 } },
      "   ": { tokens: { input: 10 } },
      "bad\nmodel": { tokens: { input: 10 } },
      ["x".repeat(257)]: { tokens: { input: 10 } },
      zero: { tokens: { input: 0, output: 0 } },
      negative: { tokens: { input: -1 } },
      string: { tokens: { input: "10" } },
      missing: {},
      null: null,
    });
    expect((await read()).observed).toEqual({ "code-generation": ["a-model", "z-model"] });
  });

  it("returns no observations for a missing or interrupted file, and recovers after a complete update", async () => {
    expect((await read()).observed).toEqual({});
    await file(ledgerPath, '{"schemaVersion":3,"workflows":');
    const broken = await readStageModels(root, record);
    expect(broken).toMatchObject({ ok: true, value: { observed: {} } });
    expect("ok" in broken && broken.warnings).toContain(`${ledgerPath}: invalid JSON`);
    await usage({ "recovered-model": { tokens: { output: 1 } } });
    expect((await read()).observed).toEqual({ "code-generation": ["recovered-model"] });
  });

  it("does not share path-keyed records between spaces or stages", async () => {
    await file(ledgerPath, {
      schemaVersion: 3,
      workflows: {
        [recordKey]: {
          byStage: {
            "code-generation": { byModel: { developer: { tokens: { input: 1 } } } },
            "build-and-test": { byModel: { quality: { tokens: { output: 1 } } } },
            "../invalid": { byModel: { unrelated: { tokens: { input: 1 } } } },
          },
        },
        "record:other/example": {
          byStage: { "code-generation": { byModel: { other: { tokens: { input: 1 } } } } },
        },
      },
    });
    expect((await read()).observed).toEqual({
      "code-generation": ["developer"],
      "build-and-test": ["quality"],
    });
    const other = await readStageModels(root, join(root, "aidlc/spaces/other/intents/example"));
    expect(other).toMatchObject({
      ok: true,
      value: { observed: { "code-generation": ["other"] } },
    });
  });

  it("does not read a ledger linked outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "stage-model-ledger-outside-"));
    try {
      await writeFile(
        join(outside, "usage-ledger.json"),
        JSON.stringify({
          schemaVersion: 3,
          workflows: {
            [recordKey]: {
              byStage: {
                "code-generation": { byModel: { "private-model": { tokens: { input: 1 } } } },
              },
            },
          },
        }),
      );
      await mkdir(join(root, "aidlc"), { recursive: true });
      await symlink(
        outside,
        join(root, "aidlc/.aidlc-sessions"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const result = await readStageModels(root, record);
      expect(result).toMatchObject({ ok: true, value: { observed: {} } });
      expect(JSON.stringify(result)).not.toContain("private-model");
      expect("ok" in result && result.warnings).toContain(`${ledgerPath}: outside-record`);
    } finally {
      await rm(join(root, "aidlc/.aidlc-sessions"), { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("legacy registry model lookup", () => {
  const uuid = "019abcde-1234-7000-8000-1111deadbeef";
  beforeEach(async () => {
    record = join(root, "aidlc/spaces/default/intents/example-deadbeef");
    await file("aidlc/.aidlc-sessions/usage-ledger.json", {
      schemaVersion: 3,
      workflows: {
        [`intent:${uuid}`]: {
          byStage: { "code-generation": { byModel: { "legacy-model": { tokens: { input: 1 } } } } },
        },
      },
    });
  });

  it.each(["deadbeef", "beef"])(
    "matches a missing dirName using the UUID tail %s",
    async (tail) => {
      await file("aidlc/spaces/default/intents/intents.json", [{ slug: "example", uuid }]);
      const result = await readStageModels(
        root,
        join(root, `aidlc/spaces/default/intents/example-${tail}`),
      );
      expect(result).toMatchObject({
        ok: true,
        value: { observed: { "code-generation": ["legacy-model"] } },
      });
    },
  );

  it.each([
    { slug: "example", uuid, dirName: "renamed-record" },
    { slug: "different", uuid },
    { slug: "example", uuid: "019abcde-1234-7000-8000-1111cafebabe" },
    { slug: "example" },
  ])("does not misattribute a mismatching or malformed registry row %j", async (row) => {
    await file("aidlc/spaces/default/intents/intents.json", [row]);
    expect((await read()).observed).toEqual({});
  });

  it("refuses an ambiguous match between a legacy and a stored directory row", async () => {
    await file("aidlc/spaces/default/intents/intents.json", [
      { slug: "example", uuid },
      { dirName: "example-deadbeef", uuid: "other-id" },
    ]);
    expect((await read()).observed).toEqual({});
  });
});
