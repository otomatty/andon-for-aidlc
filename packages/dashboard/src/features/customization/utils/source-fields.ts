import type { CustomizationItem, CustomizationKind } from "@andon/shared-types";
import { applyEdits, modify } from "jsonc-parser";
import { isMap, parseDocument, stringify } from "yaml";

export const CATEGORIES = [
  { id: "rules", label: "開発ルール", kinds: ["rule-section", "rule-file-metadata"] },
  { id: "knowledge", label: "ナレッジ", kinds: ["knowledge"] },
  { id: "scopes", label: "スコープ", kinds: ["scope"] },
  { id: "stages", label: "ステージ", kinds: ["stage", "artifact-template"] },
  { id: "agents", label: "エージェント", kinds: ["agent"] },
  { id: "quality", label: "品質チェック", kinds: ["sensor", "tool"] },
  { id: "plugins", label: "プラグイン", kinds: ["plugin"] },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];
export const KIND_LABELS: Record<CustomizationKind, string> = {
  "rule-section": "ルールの章",
  "rule-file-metadata": "ルールファイル設定",
  knowledge: "資料",
  stage: "ステージ",
  scope: "スコープ",
  agent: "エージェント",
  sensor: "品質チェック",
  tool: "チェックスクリプト",
  plugin: "プラグイン",
  "artifact-template": "成果物テンプレート",
};
export const categoryOf = (kind: CustomizationKind): Category =>
  CATEGORIES.find((category) => (category.kinds as readonly string[]).includes(kind))?.id ??
  "rules";

export function itemLocation(item: CustomizationItem): string {
  const layer = item.target?.layer;
  if (layer)
    return layer === "phase"
      ? `フェーズ:${item.target?.phase ?? "未指定"}`
      : { org: "組織", team: "チーム", project: "プロジェクト" }[layer];
  return item.pluginId
    ? `プラグイン:${item.pluginId}`
    : item.owner === "core"
      ? "標準"
      : (item.spaceId ?? "");
}

export function setRuleHeading(content: string, heading: string): string {
  const line = /^(\uFEFF?)##[ \t]+[^\r\n]*/.exec(content);
  if (line) return `${line[1]}## ${heading}${content.slice(line[0].length)}`;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  return `## ${heading}${newline}${newline}${content}`;
}

export function ruleBody(content: string): string {
  return content.replace(/^\uFEFF?##[ \t]+[^\r\n]*(?:\r?\n|$)/, "");
}

export function setRuleBody(content: string, heading: string, body: string): string {
  const source = setRuleHeading(content, heading);
  const prefix = /^\uFEFF?##[ \t]+[^\r\n]*(?:\r?\n|$)/.exec(source)?.[0] ?? "";
  return prefix + (prefix.endsWith("\n") ? "" : "\n") + body;
}

export function frontmatter(content: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)^---[^\S\r\n]*(?:\r?\n|$)/m.exec(content);
  if (match?.index !== 0) return null;
  const start = content.indexOf("\n") + 1;
  const text = match[1] ?? "";
  const doc = parseDocument(text);
  return { start, end: start + text.length, bodyStart: match[0].length, text, doc };
}

/** JSON value edits preserve unrelated properties, ordering and source whitespace. */
export function setJsonField(content: string, key: string, value: unknown): string {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("プラグイン定義はJSONオブジェクトにしてください。");
  return applyEdits(content, modify(content, [key], value, {}));
}

export function sourceField(content: string, key: string): unknown {
  const source = frontmatter(content);
  if (!source || source.doc.errors.length) return undefined;
  return source.doc.toJS()?.[key];
}

/** Replace only the requested YAML pair. Other bytes, including comments, survive. */
export function setSourceField(
  content: string,
  key: string,
  value: unknown,
  format: "inline" | "block" = "inline",
): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw new Error("不正な設定項目です。");
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const encoded =
    format === "block"
      ? stringify({ [key]: value }, { collectionStyle: "block" })
          .trimEnd()
          .replaceAll("\n", newline)
      : `${key}: ${JSON.stringify(value)}`;
  const source = frontmatter(content);
  if (!source) return `---${newline}${encoded}${newline}---${newline}${content}`;
  if (source.doc.errors.length || !isMap(source.doc.contents))
    throw new Error("設定の先頭部分を解析できません。「原文」を修正してください。");
  const pair = source.doc.contents.items.find((pair) => String(pair.key) === key);
  if (!pair) return content.slice(0, source.end) + encoded + newline + content.slice(source.end);
  const keyRange = (pair.key as { range?: number[] })?.range;
  const valueRange = (pair.value as { range?: number[] })?.range;
  if (!keyRange) throw new Error("この項目は原文で編集してください。");
  const start = source.start + (keyRange[0] ?? 0);
  const tail = source.text.slice(keyRange[1]);
  const emptyValue = !valueRange || valueRange[0] === valueRange[1];
  const valueEnd =
    source.start +
    (emptyValue ? (keyRange[1] ?? 0) + (tail.startsWith(":") ? 1 : 0) : (valueRange[1] ?? 0));
  // Range ends at the YAML value, preserving any trailing inline comment.
  const suffix = /\r?\n$/.test(content.slice(start, valueEnd)) ? newline : "";
  return content.slice(0, start) + encoded + suffix + content.slice(valueEnd);
}

export function sourceBody(content: string): string {
  const source = frontmatter(content);
  return source ? content.slice(source.bodyStart) : content;
}
export function setSourceBody(content: string, body: string): string {
  const source = frontmatter(content);
  return source ? content.slice(0, source.bodyStart) + body : body;
}
export function textField(content: string, key: string): string {
  const value = sourceField(content, key);
  return value === undefined || value === null ? "" : String(value);
}
export function listField(content: string, key: string): string[] {
  const value = sourceField(content, key);
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function createItem(
  kind: CustomizationKind,
  spaceId: string,
  pluginId?: string,
): CustomizationItem {
  const id = crypto.randomUUID();
  const name = `${pluginId && !["rule-section", "rule-file-metadata", "knowledge", "plugin"].includes(kind) ? `${pluginId}-` : ""}custom-${id.slice(0, 8)}`;
  const common = {
    id,
    kind,
    title: `新しい${KIND_LABELS[kind]}`,
    owner:
      kind === "rule-section" ||
      kind === "rule-file-metadata" ||
      kind === "knowledge" ||
      kind === "artifact-template"
        ? ("project" as const)
        : ("plugin" as const),
    spaceId,
  };
  if (kind === "rule-section")
    return {
      ...common,
      content: "## 新しい開発方針\n\n",
      target: { layer: "project", heading: "新しい開発方針" },
    };
  if (kind === "rule-file-metadata")
    return { ...common, content: "---\nstatus: active\n---\n", target: { layer: "project" } };
  if (kind === "knowledge")
    return {
      ...common,
      content: "",
      target: { knowledgeType: "team-markdown", audience: "all", filename: `${name}.md` },
    };
  if (kind === "plugin")
    return {
      ...common,
      runtimeId: name,
      pluginId: name,
      content: JSON.stringify(
        {
          name,
          version: "0.1.0",
          description: "",
          dependencies: ["core"],
          aidlc: { contributes: {} },
        },
        null,
        2,
      ),
    };
  const fields: Record<string, unknown> =
    kind === "stage"
      ? {
          slug: name,
          name: common.title,
          phase: "construction",
          execution: "ALWAYS",
          condition: "",
          lead_agent: "",
          support_agents: [],
          mode: "inline",
          produces: [],
          consumes: [],
          requires_stage: [],
          scopes: [],
          sensors: [],
        }
      : kind === "scope"
        ? {
            name,
            description: "",
            depth: "Standard",
            testStrategy: "Standard",
            review_cap: "advisory",
          }
        : kind === "agent"
          ? { name, display_name: common.title, description: "", tier: "balanced" }
          : kind === "sensor"
            ? {
                id: name,
                kind: "deterministic",
                description: "",
                category: "code-quality",
                command: "",
                fire_on: "gate",
                default_severity: "advisory",
                matches: "**/*.md",
                timeout_seconds: 30,
              }
            : {};
  const content = Object.keys(fields).length
    ? `---\n${Object.entries(fields)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join("\n")}\n---\n\n`
    : "";
  return { ...common, runtimeId: name, ...(pluginId ? { pluginId } : {}), content };
}
