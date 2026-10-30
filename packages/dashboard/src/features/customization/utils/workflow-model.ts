import type { CustomizationDiagnostic, CustomizationItem } from "@andon/shared-types";
import { STAGE_NUMBERS } from "@/data/stage-numbers";
import { createItem, listField, setSourceField, sourceField, textField } from "./source-fields";

export const PHASES = ["initialization", "ideation", "inception", "construction", "operation"];
export const phaseLabel = (phase: string) => phase.charAt(0).toUpperCase() + phase.slice(1);
export const isStandard = (item: CustomizationItem) =>
  item.owner === "core" && ["scope", "stage", "agent", "sensor"].includes(item.kind);
export const stageItems = (items: CustomizationItem[]) =>
  items
    .filter((item) => item.kind === "stage" && !item.target?.contributionTo)
    .sort((a, b) => {
      const phase =
        PHASES.indexOf(textField(a.content, "phase")) -
        PHASES.indexOf(textField(b.content, "phase"));
      return (
        phase ||
        (STAGE_NUMBERS[a.runtimeId ?? ""] ?? "9").localeCompare(
          STAGE_NUMBERS[b.runtimeId ?? ""] ?? "9",
          undefined,
          { numeric: true },
        )
      );
    });
export function contributionScopes(item: CustomizationItem): string[] {
  const adds = sourceField(item.content, "adds") as { scopes?: unknown } | undefined;
  return Array.isArray(adds?.scopes)
    ? adds.scopes.filter((value): value is string => typeof value === "string")
    : [];
}
export function runsStage(
  stage: CustomizationItem,
  scope: string,
  items: CustomizationItem[],
): boolean {
  return (
    textField(stage.content, "phase") === "initialization" ||
    listField(stage.content, "scopes").includes(scope) ||
    items.some(
      (item) =>
        item.target?.contributionTo === stage.runtimeId && contributionScopes(item).includes(scope),
    )
  );
}
export function stageRoles(stage: CustomizationItem): string {
  return `主担当 ${textField(stage.content, "lead_agent") || "未指定"} · 協働 ${listField(stage.content, "support_agents").length} · レビュー ${textField(stage.content, "reviewer") || "なし"}`;
}
export function setMembership(
  items: CustomizationItem[],
  scope: CustomizationItem,
  stage: CustomizationItem,
  enabled: boolean,
): CustomizationItem[] {
  if (
    isStandard(scope) ||
    !scope.runtimeId ||
    !scope.pluginId ||
    textField(stage.content, "phase") === "initialization"
  )
    return items;
  const name = scope.runtimeId;
  if (stage.owner !== "core") {
    if (stage.pluginId !== scope.pluginId)
      throw new Error("別のプラグインのステージは変更できません。");
    return items.map((item) =>
      item.id === stage.id
        ? {
            ...item,
            content: setSourceField(
              item.content,
              "scopes",
              enabled
                ? [...new Set([...listField(item.content, "scopes"), name])]
                : listField(item.content, "scopes").filter((value) => value !== name),
            ),
          }
        : item,
    );
  }
  const contribution = items.find(
    (item) => item.target?.contributionTo === stage.runtimeId && item.pluginId === scope.pluginId,
  );
  if (contribution) {
    const scopes = enabled
      ? [...new Set([...contributionScopes(contribution), name])]
      : contributionScopes(contribution).filter((value) => value !== name);
    const adds = sourceField(contribution.content, "adds") ?? {};
    if (typeof adds !== "object" || Array.isArray(adds))
      throw new Error("ステージ追加設定の adds はオブジェクトにしてください。");
    if (
      !scopes.length &&
      Object.keys(adds).every((key) => key === "scopes") &&
      !sourceField(contribution.content, "fragments")
    )
      return items.filter((item) => item.id !== contribution.id);
    return items.map((item) =>
      item.id === contribution.id
        ? {
            ...item,
            content: setSourceField(
              setSourceField(item.content, "plugin", scope.pluginId),
              "adds",
              { ...adds, scopes },
              "block",
            ),
          }
        : item,
    );
  }
  if (!enabled) return items;
  const addition: CustomizationItem = {
    id: crypto.randomUUID(),
    kind: "stage",
    owner: "plugin",
    pluginId: scope.pluginId,
    spaceId: scope.spaceId,
    runtimeId: `${scope.pluginId}-include-${stage.runtimeId}`,
    title: `ステージ ${stage.runtimeId} を ${name} に含める`,
    target: { contributionTo: stage.runtimeId, phase: textField(stage.content, "phase") },
    content: setSourceField(
      `---\ntarget: ${JSON.stringify(stage.runtimeId)}\nplugin: ${JSON.stringify(scope.pluginId)}\n---\n`,
      "adds",
      { scopes: [name] },
      "block",
    ),
  };
  return [...items, addition];
}
export function createOwnedPlugin(name: string, space: string): CustomizationItem {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || name === "core")
    throw new Error(
      "プラグイン名は英小文字で始まる英数字とハイフンで入力してください。core は使えません。",
    );
  const item = createItem("plugin", space);
  return {
    ...item,
    title: name,
    runtimeId: name,
    pluginId: name,
    content: JSON.stringify(
      {
        name,
        version: "0.1.0",
        description: "プロジェクトの自作設定",
        dependencies: ["core"],
        aidlc: {
          contributes: {
            stages: "stages/",
            scopes: "scopes/",
            overlays: "contributions/",
            agents: "agents/",
            sensors: "sensors/",
          },
        },
      },
      null,
      2,
    ),
  };
}
export function duplicateScope(
  items: CustomizationItem[],
  base: CustomizationItem,
  name: string,
  pluginId: string,
  space: string,
): { items: CustomizationItem[]; scope: CustomizationItem } {
  const prefix = `${pluginId}-`;
  const localName = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  const runtimeId = `${prefix}${localName}`;
  if (!/^[a-z][a-z0-9-]*$/.test(localName))
    throw new Error("スコープ名は英小文字で始まる英数字とハイフンで入力してください。");
  if (items.some((item) => item.kind === "scope" && item.runtimeId === runtimeId))
    throw new Error("同じ名前のスコープがあります。");
  const scope = {
    ...createItem("scope", space, pluginId),
    runtimeId,
    title: name,
    content: setSourceField(
      setSourceField(setSourceField(base.content, "name", runtimeId), "plugin", pluginId),
      "baseScope",
      base.runtimeId ?? base.title,
    ),
  };
  let next = [...items, scope];
  for (const stage of stageItems(items))
    if (runsStage(stage, base.runtimeId ?? "", items))
      next = setMembership(next, scope, stage, true);
  return { items: next, scope };
}
export function removeScope(
  items: CustomizationItem[],
  scope: CustomizationItem,
): CustomizationItem[] {
  if (isStandard(scope)) return items;
  let next = items;
  for (const stage of stageItems(items))
    if (runsStage(stage, scope.runtimeId ?? "", next))
      next = setMembership(next, scope, stage, false);
  return next.filter((item) => item.id !== scope.id);
}
export function renameScope(
  items: CustomizationItem[],
  scope: CustomizationItem,
  title: string,
): CustomizationItem[] {
  // The display name is independent of the stable identifier used by contributions.
  return items.map((item) =>
    item.id === scope.id && !isStandard(item) ? { ...item, title } : item,
  );
}

export function stageDiagnostics(items: CustomizationItem[]): CustomizationDiagnostic[] {
  const stages = stageItems(items);
  const bySlug = new Map(stages.map((stage) => [stage.runtimeId, stage]));
  const diagnostics: CustomizationDiagnostic[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (stage: CustomizationItem) => {
    if (active.has(stage.id)) {
      diagnostics.push({
        severity: "error",
        code: "stage-cycle",
        itemId: stage.id,
        message: `${stage.runtimeId}: 前提ステージが循環しています。`,
      });
      return;
    }
    if (visited.has(stage.id)) return;
    active.add(stage.id);
    for (const slug of listField(stage.content, "requires_stage")) {
      const prerequisite = bySlug.get(slug);
      if (prerequisite) visit(prerequisite);
      else
        diagnostics.push({
          severity: "error",
          code: "missing-stage",
          itemId: stage.id,
          message: `${stage.runtimeId}: 前提ステージ ${slug} が存在しません。`,
        });
    }
    active.delete(stage.id);
    visited.add(stage.id);
  };
  stages.forEach(visit);
  return diagnostics;
}
