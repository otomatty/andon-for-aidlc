import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  CustomizationCatalog,
  CustomizationItem,
  CustomizationKind,
} from "@andon/shared-types";
import { digest, identifier, MAX_ITEM_BYTES } from "./model.ts";

const scalar = (source: string, key: string): string =>
  new RegExp(`^${key}:\\s*["']?([^\\r\\n"']+)`, "m").exec(source)?.[1]?.trim() ?? "";

async function textFile(root: string, relative: string): Promise<string | null> {
  let current = root;
  try {
    for (const segment of relative.split("/")) {
      current = path.join(current, segment);
      if ((await lstat(current)).isSymbolicLink()) return null;
    }
    const info = await lstat(current);
    if (!info.isFile() || info.size > MAX_ITEM_BYTES) return null;
    return await readFile(current, "utf8");
  } catch {
    return null;
  }
}

async function files(root: string, directory: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  try {
    const folder = path.join(root, directory);
    if ((await lstat(folder)).isSymbolicLink()) return [];
    const entries = await readdir(folder, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || entry.name === "node_modules" || entry.name.startsWith("."))
        continue;
      const rel = `${directory}/${entry.name}`;
      if (entry.isDirectory()) result.push(...(await files(root, rel, depth + 1)));
      else if (entry.isFile() && /\.(md|json|ts|js|py|sh)$/.test(entry.name)) result.push(rel);
      if (result.length > 500) break;
    }
    return result.slice(0, 500);
  } catch {
    return [];
  }
}

/** Read-only compatibility catalog: allows inspection and in-memory editing before engine upgrade. */
export async function readCompatibilityCatalog(
  root: string,
  requestedSpace?: string,
): Promise<CustomizationCatalog> {
  const active = (await textFile(root, "aidlc/active-space"))?.trim();
  const spaceId =
    requestedSpace && identifier(requestedSpace)
      ? requestedSpace
      : active && identifier(active)
        ? active
        : "default";
  let spaces: string[] = [];
  try {
    spaces = (await readdir(path.join(root, "aidlc/spaces"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && identifier(entry.name))
      .map((entry) => entry.name);
  } catch {
    /* No workflow is required. */
  }
  if (!spaces.includes(spaceId)) spaces.push(spaceId);
  const items: CustomizationItem[] = [];
  const add = (
    kind: CustomizationKind,
    relative: string,
    content: string,
    extra: Partial<CustomizationItem> = {},
  ) => {
    items.push({
      id: `${kind}:${digest(relative).slice(0, 24)}`,
      kind,
      title: scalar(content, "display_name") || scalar(content, "name") || path.basename(relative),
      owner: "project",
      content,
      source: { relativePath: relative, hash: digest(content) },
      editable: true,
      ...extra,
    });
  };
  const memory = `aidlc/spaces/${spaceId}/memory`;
  for (const file of [
    "org.md",
    "team.md",
    "project.md",
    ...["ideation", "inception", "construction", "operation"].map((phase) => `phases/${phase}.md`),
  ]) {
    const relative = `${memory}/${file}`;
    const source = await textFile(root, relative);
    if (source === null) continue;
    const layer: "phase" | "org" | "team" | "project" = file.startsWith("phases/")
      ? "phase"
      : (file.slice(0, -3) as "org" | "team" | "project");
    const phase = layer === "phase" ? path.basename(file, ".md") : undefined;
    const target = { layer, ...(phase ? { phase } : {}) };
    const frontmatter = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---/.exec(source)?.[0];
    if (frontmatter)
      add("rule-file-metadata", relative, frontmatter, {
        title: `${file} メタデータ`,
        spaceId,
        target,
      });
    const headings = [...source.matchAll(/^## ([^\r\n]+).*$/gm)];
    for (let index = 0; index < headings.length; index++) {
      const match = headings[index];
      if (!match || match.index === undefined) continue;
      const heading = match[1] ?? "";
      add(
        "rule-section",
        relative,
        source.slice(match.index, headings[index + 1]?.index ?? source.length),
        {
          id: `rule-section:${digest(`${relative}:${heading}:${index}`).slice(0, 24)}`,
          title: heading,
          spaceId,
          target: { ...target, heading },
          editable: headings.filter((h) => h[1] === heading).length === 1,
        },
      );
    }
  }
  for (const relative of await files(root, `${memory}/templates`)) {
    const source = await textFile(root, relative);
    if (source !== null)
      add("artifact-template", relative, source, {
        spaceId,
        runtimeId: path.basename(relative, ".md"),
      });
  }
  const knowledgeRoot = `aidlc/spaces/${spaceId}/knowledge`;
  for (const relative of await files(root, knowledgeRoot)) {
    if (relative.includes("/documentkb/") || relative.includes("/documents/")) continue;
    const source = await textFile(root, relative);
    const agent = relative.slice(knowledgeRoot.length + 1).split("/")[0];
    if (source !== null)
      add("knowledge", relative, source, {
        spaceId,
        target: {
          knowledgeType: "team-markdown",
          audience: agent === "aidlc-shared" ? "all" : [agent ?? ""],
          filename: path.basename(relative),
        },
      });
  }
  let engineVersion = "unknown";
  let installed = false;
  for (const harness of [".claude", ".cursor", ".codex", ".aidlc"]) {
    const version = await textFile(root, `${harness}/tools/aidlc-version.ts`);
    if (!version) continue;
    installed = true;
    engineVersion = /AIDLC_VERSION\s*=\s*["']([^"']+)/.exec(version)?.[1] ?? "unknown";
    for (const [folder, kind] of [
      ["aidlc-common/stages", "stage"],
      ["skills/aidlc", "stage"],
      ["scopes", "scope"],
      ["agents", "agent"],
      ["sensors", "sensor"],
    ] as const) {
      for (const relative of await files(root, `${harness}/${folder}`)) {
        const source = await textFile(root, relative);
        if (source === null || (kind === "stage" && !/^slug:/m.test(source))) continue;
        if (
          kind === "stage" &&
          items.some((item) => item.kind === "stage" && item.runtimeId === scalar(source, "slug"))
        )
          continue;
        add(kind, relative, source, {
          owner: "core",
          editable: false,
          ...(kind === "stage" ? { title: scalar(source, "slug") } : {}),
          runtimeId:
            scalar(source, kind === "stage" ? "slug" : kind === "sensor" ? "id" : "name") ||
            path.basename(relative, ".md"),
        });
      }
    }
    break;
  }
  for (const relative of await files(root, "plugins")) {
    const segments = relative.split("/");
    const pluginId = segments[1];
    const folder = segments[2];
    if (!pluginId || !folder) continue;
    const kinds: Record<string, CustomizationKind> = {
      stages: "stage",
      contributions: "stage",
      scopes: "scope",
      agents: "agent",
      sensors: "sensor",
      tools: "tool",
      knowledge: "knowledge",
    };
    const kind = kinds[folder];
    if (!kind) continue;
    const source = await textFile(root, relative);
    if (source !== null)
      add(kind, relative, source, {
        owner: "plugin",
        pluginId,
        runtimeId:
          (folder === "contributions"
            ? `${pluginId}-include-${scalar(source, "target")}`
            : scalar(source, kind === "stage" ? "slug" : kind === "sensor" ? "id" : "name")) ||
          path.basename(relative, path.extname(relative)),
        ...(folder === "contributions"
          ? { target: { contributionTo: scalar(source, "target"), phase: segments[3] } }
          : {}),
        ...(kind === "knowledge"
          ? {
              target: {
                knowledgeType: "plugin-markdown" as const,
                filename: path.basename(relative),
              },
            }
          : {}),
      });
  }
  try {
    for (const entry of await readdir(path.join(root, "plugins"), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const relative = `plugins/${entry.name}/.aidlc-plugin/plugin.json`;
      const source = await textFile(root, relative);
      if (source !== null)
        add("plugin", relative, source, {
          owner: "plugin",
          pluginId: entry.name,
          runtimeId: entry.name,
          title: entry.name,
        });
    }
  } catch {
    /* No plugin source. */
  }
  const reason = installed
    ? "設定の保存にはカスタマイズに対応するエンジンが必要です。"
    : "設定ページからaidlc-workflowsを導入してください。";
  return {
    workspaceName: path.basename(root),
    spaceId,
    spaces: spaces.sort(),
    engineVersion,
    configurationRevision: digest(JSON.stringify(items)),
    capabilities: {
      available: installed,
      engineVersion,
      protocolVersion: 0,
      canApply: false,
      canExportPlugin: false,
      canRecover: false,
      reason,
    },
    items,
    diagnostics: [{ severity: "warning", code: "engine-capability-missing", message: reason }],
  };
}
