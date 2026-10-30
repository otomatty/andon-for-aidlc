import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  BundledPlugin,
  PluginInstallState,
  PluginOperation,
  PluginPrerequisite,
} from "@andon/shared-types";

/**
 * Where each bundled plugin stands in the open project, and whether the 「プラグイン」 page may
 * act. Everything here is a file read: the page asks for it every time it opens or regains
 * focus, so it never runs the CLI. docs/maintenance/plugins-page-design.md, 「状態」「前提の確認」.
 */

const HARNESS_DIR = ".claude";
const DATA = path.join(HARNESS_DIR, "tools", "data");

type Record = { version: string; sourceHash: string } | "unreadable";

export interface ProjectPluginFacts {
  /** `harness.json` `plugins`; `null` when there is no list, which enables every plugin. */
  selected: string[] | null;
  /** Install records (`plugin-compose-<name>.json`) by plugin name. */
  records: Map<string, Record>;
  /** Plugins with a pending compose retry marker. */
  retry: Set<string>;
  /** Plugins that own a stage in the compiled stage graph. */
  graphPlugins: Set<string>;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

/** Read the plugin facts of the project's Claude Code tree. Unreadable files read as absent. */
export async function readProjectPluginFacts(root: string): Promise<ProjectPluginFacts> {
  const data = path.join(root, DATA);
  let selected: string[] | null = null;
  try {
    const harness = (await readJson(path.join(data, "harness.json"))) as { plugins?: unknown };
    if (Array.isArray(harness.plugins)) selected = harness.plugins.map(String);
  } catch {
    /* No selection list. */
  }
  const records = new Map<string, Record>();
  let names: string[] = [];
  try {
    names = await readdir(data);
  } catch {
    /* No harness tree. */
  }
  for (const name of names) {
    const key = /^plugin-compose-([a-z][a-z0-9-]*)\.json$/.exec(name)?.[1];
    if (key === undefined) continue;
    try {
      const record = (await readJson(path.join(data, name))) as {
        version?: unknown;
        sourceHash?: unknown;
      };
      records.set(
        key,
        typeof record.version === "string" && typeof record.sourceHash === "string"
          ? { version: record.version, sourceHash: record.sourceHash }
          : "unreadable",
      );
    } catch {
      records.set(key, "unreadable");
    }
  }
  const retry = new Set<string>();
  for (const key of records.keys())
    if (await exists(path.join(root, "aidlc", `.plugin-compose-retry-${key}`))) retry.add(key);
  const graphPlugins = new Set<string>();
  try {
    const graph = await readJson(path.join(data, "stage-graph.json"));
    if (Array.isArray(graph))
      for (const node of graph)
        if (node !== null && typeof node === "object" && typeof node.plugin === "string")
          graphPlugins.add(node.plugin);
  } catch {
    /* No compiled graph. */
  }
  return { selected, records, retry, graphPlugins };
}

/** The state of each bundled plugin, from the project's facts and the bundled catalog. */
export function pluginStatuses(
  catalog: readonly BundledPlugin[],
  facts: ProjectPluginFacts,
): PluginInstallState[] {
  return catalog.map((plugin): PluginInstallState => {
    const record = facts.records.get(plugin.name);
    if (record === undefined)
      return { name: plugin.name, status: "not-installed", installedVersion: null };
    if (record === "unreadable")
      return {
        name: plugin.name,
        status: "attention",
        installedVersion: null,
        detail: "導入の記録を読めません。Doctor で状態を確かめてください。",
      };
    const installedVersion = record.version;
    if (facts.retry.has(plugin.name))
      return {
        name: plugin.name,
        status: "attention",
        installedVersion,
        detail: "前回の組み込みが途中で止まっています。Doctor で状態を確かめてください。",
      };
    if (record.version !== plugin.version || record.sourceHash !== plugin.sourceHash)
      return { name: plugin.name, status: "update-available", installedVersion };
    const enabled = facts.selected === null || facts.selected.includes(plugin.name);
    if (!enabled) return { name: plugin.name, status: "disabled", installedVersion };
    if (!facts.graphPlugins.has(plugin.name))
      return {
        name: plugin.name,
        status: "attention",
        installedVersion,
        detail:
          "導入の記録はありますが、ステージの構成にプラグインのステージがありません。Doctor で状態を確かめてください。",
      };
    return { name: plugin.name, status: "enabled", installedVersion };
  });
}

const FINISHED = new Set(["complete", "archived"]);

/** Intents in any space that are neither complete nor archived, as `<space>/<dirName>`. */
export async function unfinishedWorkflows(root: string): Promise<string[]> {
  const spaces = path.join(root, "aidlc", "spaces");
  let names: string[] = [];
  try {
    names = (await readdir(spaces, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const space of names) {
    let rows: unknown;
    try {
      rows = await readJson(path.join(spaces, space, "intents", "intents.json"));
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row === null || typeof row !== "object") continue;
      const { dirName, status } = row as { dirName?: unknown; status?: unknown };
      if (typeof dirName !== "string" || typeof status !== "string") continue;
      if (!FINISHED.has(status.trim().toLowerCase())) found.push(`${space}/${dirName}`);
    }
  }
  return found;
}

/** Whether the project's `.mcp.json` declares an Atlassian server, by its name or address. */
export async function hasAtlassianMcp(root: string): Promise<boolean> {
  try {
    const config = (await readJson(path.join(root, ".mcp.json"))) as { mcpServers?: unknown };
    if (config.mcpServers === null || typeof config.mcpServers !== "object") return false;
    return Object.entries(config.mcpServers).some(
      ([name, server]) => /atlassian/i.test(name) || /atlassian/i.test(JSON.stringify(server)),
    );
  } catch {
    return false;
  }
}

export interface PrerequisiteFacts {
  trusted: boolean;
  /** The version check reads `ok`: the project and this machine run the supported release. */
  gateOk: boolean;
  /** The project has a Claude Code tree. */
  claude: boolean;
  /**
   * The other tools whose AI-DLC the project also has. The bundled plugins are built for Claude
   * Code only, and the native tool addition and update refuse tools whose plugins differ.
   */
  others: string[];
  /** AI-DLC was installed with the native `aidlc` (the tree carries `aidlc-stamp.json`). */
  native: boolean;
  unfinished: string[];
  /** Another install or update is running in this extension host. */
  busy: boolean;
  atlassian: boolean;
}

/** What the page shows under 「必要なもの」, with whether each is met. */
export function pluginPrerequisites(facts: PrerequisiteFacts): PluginPrerequisite[] {
  return [
    {
      id: "trusted",
      level: "required",
      met: facts.trusted,
      label: "ワークスペースを信頼している",
      detail: facts.trusted ? "" : "VS Code でこのワークスペースを信頼すると導入できます。",
    },
    {
      id: "version-gate",
      level: "required",
      met: facts.gateOk,
      label: "AI-DLC が対応版である",
      detail: facts.gateOk
        ? ""
        : "更新画面で、プロジェクトとこのパソコンの AI-DLC を対応版にそろえてください。",
      ...(facts.gateOk ? {} : { action: "open-workflows-update" as const }),
    },
    {
      id: "claude",
      level: "required",
      met: facts.claude,
      label: "Claude Code（.claude）で AI-DLC を使っている",
      detail: facts.claude
        ? ""
        : "セットアップの「ツールを追加」で Claude Code を追加してください。",
      ...(facts.claude ? {} : { action: "open-workflows-install" as const }),
    },
    {
      id: "claude-only",
      level: "required",
      met: facts.others.length === 0,
      label: "Claude Code だけで AI-DLC を使っている",
      detail:
        facts.others.length === 0
          ? ""
          : `同梱のプラグインは Claude Code 向けだけです。ほかのツール（${facts.others.join("、")}）の AI-DLC とプラグインの構成が食い違い、以後のツールの追加や更新が止まるため、導入できません。`,
    },
    {
      id: "native",
      level: "required",
      met: facts.native,
      label: "ネイティブの aidlc で導入している",
      detail: facts.native
        ? ""
        : "手動でコピーした AI-DLC では導入できません。セットアップでネイティブの aidlc に移してください。",
      ...(facts.native ? {} : { action: "open-workflows-setup" as const }),
    },
    {
      id: "idle-workflows",
      level: "required",
      met: facts.unfinished.length === 0,
      label: "終わっていない作業がない",
      detail:
        facts.unfinished.length === 0
          ? ""
          : `いまの作業を終えてから操作してください（${facts.unfinished.join("、")}）。`,
    },
    {
      id: "idle-operation",
      level: "required",
      met: !facts.busy,
      label: "ほかの導入や更新が実行中でない",
      detail: facts.busy ? "実行中の導入や更新が終わるまで待ってください。" : "",
    },
    {
      id: "atlassian-mcp",
      level: "recommended",
      met: facts.atlassian,
      label: "Atlassian の MCP サーバーが .mcp.json にある",
      detail: facts.atlassian
        ? ""
        : "なくても導入できます。Jira のチケットは、本文を貼り付けて進められます。",
    },
    {
      id: "opus",
      level: "info",
      met: null,
      label: "Claude Code のモデルが Opus",
      detail: "テストと実装のステージは、始める前にモデルが Opus であることを確かめます。",
    },
  ];
}

/** Every required prerequisite is met and no plugin operation is running. */
export function canAct(
  prerequisites: readonly PluginPrerequisite[],
  running: PluginOperation | null,
): boolean {
  return (
    running === null &&
    prerequisites.every((item) => item.level !== "required" || item.met === true)
  );
}
