import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BundledPlugin } from "@andon/shared-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canAct,
  hasAtlassianMcp,
  pluginPrerequisites,
  pluginStatuses,
  type PrerequisiteFacts,
  readProjectPluginFacts,
  unfinishedWorkflows,
} from "../src/plugins-state.ts";

const HASH = `sha256:${"a".repeat(64)}`;
const focus = { name: "focus", version: "0.1.0", sourceHash: HASH } as BundledPlugin;

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "plugins-state-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(relative: string, content: unknown): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
}

const DATA = ".claude/tools/data";
function installed(version = "0.1.0", sourceHash = HASH): void {
  write(`${DATA}/plugin-compose-focus.json`, { schemaVersion: 1, name: "focus", version, sourceHash });
  write(`${DATA}/stage-graph.json`, [{ slug: "focus-test", plugin: "focus" }]);
}

describe("pluginStatuses", () => {
  it("reads not-installed, enabled, disabled and update-available from the project", async () => {
    write(`${DATA}/harness.json`, { name: "claude" });
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))).toEqual([
      { name: "focus", status: "not-installed", installedVersion: null },
    ]);

    installed();
    // No selection list: every composed plugin is enabled.
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))[0]?.status).toBe("enabled");

    write(`${DATA}/harness.json`, { name: "claude", plugins: ["aidlc", "focus"] });
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))[0]?.status).toBe("enabled");

    write(`${DATA}/harness.json`, { name: "claude", plugins: ["aidlc"] });
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))[0]).toEqual({
      name: "focus",
      status: "disabled",
      installedVersion: "0.1.0",
    });

    installed("0.0.9");
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))[0]).toMatchObject({
      status: "update-available",
      installedVersion: "0.0.9",
    });
    installed("0.1.0", `sha256:${"b".repeat(64)}`);
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))[0]?.status).toBe(
      "update-available",
    );
  });

  it("flags a plugin the engine did not finish composing", async () => {
    installed();
    write(`${DATA}/stage-graph.json`, [{ slug: "requirements-analysis" }]);
    const [state] = pluginStatuses([focus], await readProjectPluginFacts(root));
    expect(state?.status).toBe("attention");
    expect(state?.detail).toContain("ステージ");

    installed();
    write("aidlc/.plugin-compose-retry-focus", "");
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))[0]?.status).toBe("attention");
  });

  it("treats an unreadable install record as needing attention, not as installed", async () => {
    write(`${DATA}/plugin-compose-focus.json`, "{");
    expect(pluginStatuses([focus], await readProjectPluginFacts(root))[0]?.status).toBe("attention");
  });
});

describe("unfinishedWorkflows", () => {
  it("lists intents that are neither complete nor archived, in every space", async () => {
    write("aidlc/spaces/default/intents/intents.json", [
      { dirName: "260101-a", status: "complete" },
      { dirName: "260102-b", status: "in-progress" },
      { dirName: "260103-c", status: "Archived" },
    ]);
    write("aidlc/spaces/team/intents/intents.json", [{ dirName: "260104-d", status: "paused" }]);
    expect(await unfinishedWorkflows(root)).toEqual(["default/260102-b", "team/260104-d"]);
  });

  it("finds none in a project without records, or with an unreadable registry", async () => {
    expect(await unfinishedWorkflows(root)).toEqual([]);
    write("aidlc/spaces/default/intents/intents.json", "not json");
    expect(await unfinishedWorkflows(root)).toEqual([]);
  });
});

describe("hasAtlassianMcp", () => {
  it("looks for an Atlassian server in the project's .mcp.json", async () => {
    expect(await hasAtlassianMcp(root)).toBe(false);
    write(".mcp.json", { mcpServers: { context7: { type: "http", url: "https://x" } } });
    expect(await hasAtlassianMcp(root)).toBe(false);
    write(".mcp.json", {
      mcpServers: { jira: { type: "sse", url: "https://mcp.atlassian.com/v1/sse" } },
    });
    expect(await hasAtlassianMcp(root)).toBe(true);
    write(".mcp.json", { mcpServers: { atlassian: { command: "npx" } } });
    expect(await hasAtlassianMcp(root)).toBe(true);
    write(".mcp.json", "{");
    expect(await hasAtlassianMcp(root)).toBe(false);
  });
});

describe("pluginPrerequisites", () => {
  const ready: PrerequisiteFacts = {
    trusted: true,
    gateOk: true,
    claude: true,
    others: [],
    native: true,
    unfinished: [],
    busy: false,
    atlassian: false,
  };

  it("allows acting only when every required prerequisite is met", () => {
    const prerequisites = pluginPrerequisites(ready);
    expect(canAct(prerequisites, null)).toBe(true);
    // Recommended and informational items never block.
    expect(prerequisites.find((item) => item.id === "atlassian-mcp")).toMatchObject({
      level: "recommended",
      met: false,
    });
    expect(prerequisites.find((item) => item.id === "opus")).toMatchObject({ level: "info", met: null });
    expect(canAct(prerequisites, { action: "install", name: "focus" })).toBe(false);
  });

  it.each([
    ["trusted", { trusted: false }],
    ["version-gate", { gateOk: false }],
    ["claude", { claude: false }],
    ["native", { native: false }],
    ["claude-only", { others: ["Cursor"] }],
    ["idle-workflows", { unfinished: ["default/260102-b"] }],
    ["idle-operation", { busy: true }],
  ] as const)("blocks on %s, and says where to fix it", (id, change) => {
    const prerequisites = pluginPrerequisites({ ...ready, ...change });
    const item = prerequisites.find((entry) => entry.id === id);
    expect(item).toMatchObject({ level: "required", met: false });
    expect(item?.detail).not.toBe("");
    expect(canAct(prerequisites, null)).toBe(false);
  });

  it("names the unfinished work and points to the right screens", () => {
    const prerequisites = pluginPrerequisites({
      ...ready,
      unfinished: ["default/260102-b"],
      claude: false,
      gateOk: false,
    });
    expect(prerequisites.find((item) => item.id === "idle-workflows")?.detail).toContain(
      "default/260102-b",
    );
    expect(prerequisites.find((item) => item.id === "claude")?.action).toBe("open-workflows-install");
    expect(
      pluginPrerequisites({ ...ready, others: ["Cursor"] }).find((item) => item.id === "claude-only")
        ?.detail,
    ).toContain("Cursor");
    expect(prerequisites.find((item) => item.id === "version-gate")?.action).toBe(
      "open-workflows-update",
    );
  });
});
