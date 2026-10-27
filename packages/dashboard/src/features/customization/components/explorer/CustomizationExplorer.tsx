import type {
  CustomizationDiagnostic,
  CustomizationItem,
  CustomizationKind,
} from "@aidlc-guide/shared-types";
import { type ReactNode, useState } from "react";
import { FormSelect } from "@/shared/form-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import "@/features/customization/customization-map.css";
import { ItemEditor, TextControl } from "@/features/customization/components/editor/ItemEditor";
import {
  CATEGORIES,
  type Category,
  categoryOf,
  createItem,
  KIND_LABELS,
  listField,
  setSourceField,
  textField,
} from "@/features/customization/utils/source-fields";
import {
  createOwnedPlugin,
  duplicateScope,
  isStandard,
  PHASES,
  phaseLabel,
  renameScope,
  runsStage,
  setMembership,
  stageItems,
  stageRoles,
} from "@/features/customization/utils/workflow-model";

const DESCRIPTIONS: Record<Category, string> = {
  scopes: "どのステージを走らせるかを決めます。標準スコープを複製して、自分のスコープを作れます。",
  stages: "フェーズ順に並ぶ作業の単位。スコープごとの実行ステージを確認できます。",
  agents: "担当する。ステージごとに主担当1名、協働0〜複数、レビュー担当0〜1名。",
  quality: "検査する。承認ゲートや書き込み時に自動で確認します。",
  rules: "従う。org → team → project → phase の順に積み重なり、全ステージが読みます。",
  knowledge: "参照する。担当エージェントが読む資料と文書原本。",
  plugins: "自作したスコープやステージを保存する場所。",
};
function CategoryIcon({ category }: { category: Category }) {
  const paths: Record<Category, ReactNode> = {
    scopes: (
      <>
        <path d="M4 19a10 10 0 1 1 16 0M12 3v3M4 7l2 2m14-2-2 2M2 13h3m14 0h3m-10 0 4-4" />
        <circle cx="12" cy="13" r="2" />
      </>
    ),
    stages: (
      <>
        <rect x="1" y="8" width="5" height="8" rx="1" />
        <rect x="10" y="8" width="5" height="8" rx="1" />
        <rect x="19" y="8" width="4" height="8" rx="1" />
        <path d="M6 12h4m5 0h4" />
      </>
    ),
    agents: (
      <>
        <circle cx="9" cy="7" r="4" />
        <circle cx="19" cy="9" r="3" />
        <path d="M1 22v-3a8 8 0 0 1 16 0v3m1-8a5 5 0 0 1 5 5v3" />
      </>
    ),
    quality: (
      <>
        <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z" />
        <path d="m7 12 3 3 7-7" />
      </>
    ),
    rules: <path d="M2 4h20M5 9h14M8 14h8m-5 5h2" />,
    knowledge: <path d="M12 5C8 2 4 2 1 3v16c4-1 7 0 11 2 4-2 7-3 11-2V3c-3-1-7-1-11 2v16" />,
    plugins: (
      <path d="M3 3h6a3 3 0 1 1 6 0h6v6a3 3 0 1 0 0 6v6h-6a3 3 0 1 0-6 0H3v-6a3 3 0 1 1 0-6z" />
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-7 shrink-0"
    >
      {paths[category]}
    </svg>
  );
}
function NavigationCard({
  title,
  category,
  onOpen,
  children,
  custom = false,
  changed = false,
}: {
  title: string;
  category: Category;
  onOpen: () => void;
  children: ReactNode;
  custom?: boolean;
  changed?: boolean;
}) {
  return (
    <article
      className={cn(
        "group relative cursor-pointer rounded-xl focus-within:ring-2 focus-within:ring-ring",
        custom && category !== "rules" && "border-l-4 border-l-customization-owned",
      )}
    >
      <Card variant="interactive" className="h-full">
        <CardHeader>
          <CardTitle>
            <h3 className="flex items-center gap-3 text-lg">
              <IconTile>
                <CategoryIcon category={category} />
              </IconTile>
              <a
                href={`#customization-${category}`}
                onClick={(event) => {
                  event.preventDefault();
                  onOpen();
                }}
                className="after:absolute after:inset-0 after:rounded-xl"
              >
                {title}
              </a>
              {changed ? (
                <span
                  className={
                    category === "rules" ? "text-muted-foreground" : "text-customization-changed"
                  }
                  role="img"
                  aria-label="変更済み"
                >
                  ●
                </span>
              ) : null}
            </h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </article>
  );
}
function StageStatusIcon({ custom = false, runs }: { custom?: boolean; runs: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill={runs ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
      className={cn(
        "inline-block size-3 shrink-0 align-middle",
        runs ? "text-primary" : "text-muted-foreground",
      )}
    >
      {custom ? <path d="M6 1 11 6 6 11 1 6Z" /> : <circle cx="6" cy="6" r="4.5" />}
    </svg>
  );
}
function ScopeMatrix({ items }: { items: CustomizationItem[] }) {
  const stages = stageItems(items);
  const scopes = items.filter((item) => item.kind === "scope");
  const rows = [
    ...scopes.filter((item) => !isStandard(item)),
    ...scopes.filter(
      (item) => isStandard(item) && ["bugfix", "feature"].includes(item.runtimeId ?? ""),
    ),
  ];
  return (
    <>
      <div className="customization-scope-summary flex-col gap-4">
        {rows.map((scope) => (
          <section
            key={scope.id}
            aria-label={`${scope.title} の実行ステージ`}
            className="flex min-w-0 flex-col gap-3 border-t pt-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="min-w-0 wrap-break-word font-medium">
                {scope.title}
                <span className="text-xs text-muted-foreground">
                  {isStandard(scope) ? "標準" : "◆ 自作"}
                </span>
              </h4>
              <p className="shrink-0 text-xs tabular-nums">
                {stages.filter((stage) => runsStage(stage, scope.runtimeId ?? "", items)).length} /{" "}
                {stages.length} 実行
              </p>
            </div>
            <dl className="flex flex-col gap-2 text-xs">
              {PHASES.map((phase) => {
                const phaseStages = stages.filter(
                  (stage) => textField(stage.content, "phase") === phase,
                );
                return (
                  <div key={phase} className="grid grid-cols-phase items-start gap-3">
                    <dt className="text-muted-foreground">{phaseLabel(phase)}</dt>
                    <dd className="flex min-w-0 flex-wrap justify-end gap-1">
                      {phaseStages.map((stage) => {
                        const runs = runsStage(stage, scope.runtimeId ?? "", items);
                        const description = `${stage.runtimeId} · ${runs ? "実行" : "SKIP"} · 主担当 ${textField(stage.content, "lead_agent")}`;
                        return (
                          <span
                            key={stage.id}
                            role="img"
                            aria-label={description}
                            title={description}
                            className="inline-flex h-4 shrink-0 items-center"
                          >
                            <StageStatusIcon custom={stage.owner !== "core"} runs={runs} />
                          </span>
                        );
                      })}
                      {phaseStages.length === 0 ? <span>ステージなし</span> : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
      <div className="customization-scope-table overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">スコープごとの実行ステージ</caption>
          <thead>
            <tr>
              <th className="p-2">スコープ</th>
              {PHASES.map((phase) => (
                <th key={phase} className="whitespace-nowrap p-2">
                  {phaseLabel(phase)}{" "}
                  {stages.filter((stage) => textField(stage.content, "phase") === phase).length}
                </th>
              ))}
              <th className="p-2">実行</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((scope) => (
              <tr key={scope.id} className="border-t">
                <th scope="row" className="whitespace-nowrap p-2">
                  {scope.title}{" "}
                  <span className="text-muted-foreground">
                    {isStandard(scope) ? "標準" : "◆ 自作"}
                  </span>
                  <span className="sr-only">
                    実行:{" "}
                    {stages
                      .filter((stage) => runsStage(stage, scope.runtimeId ?? "", items))
                      .map((stage) => stage.runtimeId)
                      .join("、")}
                  </span>
                </th>
                {PHASES.map((phase) => (
                  <td key={phase} className="whitespace-nowrap p-2">
                    {stages
                      .filter((stage) => textField(stage.content, "phase") === phase)
                      .map((stage) => {
                        const runs = runsStage(stage, scope.runtimeId ?? "", items);
                        return (
                          <span
                            key={stage.id}
                            aria-hidden="true"
                            title={`${stage.runtimeId} · ${runs ? "実行" : "SKIP"} · 主担当 ${textField(stage.content, "lead_agent")}`}
                            className="mr-1 inline-flex h-4 items-center align-middle"
                          >
                            <StageStatusIcon custom={stage.owner !== "core"} runs={runs} />
                          </span>
                        );
                      })}
                  </td>
                ))}
                <td className="p-2">
                  {stages.filter((stage) => runsStage(stage, scope.runtimeId ?? "", items)).length}/
                  {stages.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
export function CustomizationExplorer({
  items,
  plugin = "all",
  space,
  category,
  selected,
  changed,
  disabled,
  diagnostics,
  onCategory,
  onSelect,
  onItems,
  onRemove,
  onDocument,
}: {
  items: CustomizationItem[];
  plugin?: string;
  space: string;
  category: Category | null;
  selected?: CustomizationItem;
  changed: string[];
  disabled: boolean;
  diagnostics: CustomizationDiagnostic[];
  onCategory: (category: Category | null) => void;
  onSelect: (id: string | null) => void;
  onItems: (items: CustomizationItem[]) => void;
  onRemove: (item: CustomizationItem) => void;
  onDocument: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [creating, setCreating] = useState<CustomizationKind | null>(null);
  const [baseId, setBaseId] = useState("");
  const [name, setName] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [phase, setPhase] = useState("construction");
  const [lead, setLead] = useState("developer");
  const [requires, setRequires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const plugins = items.filter(
    (item) => item.kind === "plugin" && item.owner !== "core" && item.editable !== false,
  );
  const contextItems = items.filter(
    (item) =>
      plugin === "all" ||
      (item.kind === "plugin"
        ? (item.runtimeId ?? item.id) === plugin
        : !item.pluginId || item.pluginId === plugin || item.owner === "core"),
  );
  const scopes = items.filter((item) => item.kind === "scope");
  const stages = stageItems(items);
  const drawer = items.find((item) => item.id === drawerId);
  const categoryLabel = CATEGORIES.find((entry) => entry.id === category)?.label;
  const edit = (next: CustomizationItem) =>
    onItems(items.map((item) => (item.id === next.id ? next : item)));
  const navigate = (next: Category | null) => {
    setFilter("all");
    setSearch("");
    onCategory(next);
    onSelect(null);
  };
  const start = (kind: CustomizationKind, base?: CustomizationItem, nextPhase?: string) => {
    setError(null);
    setCreating(kind);
    setBaseId(
      base?.id ?? scopes.find((item) => item.runtimeId === "bugfix")?.id ?? scopes[0]?.id ?? "",
    );
    setName("");
    setPluginName(
      (plugins.some((item) => item.runtimeId === plugin) ? plugin : undefined) ??
        base?.pluginId ??
        (selected?.kind === "scope" ? selected.pluginId : undefined) ??
        plugins[0]?.runtimeId ??
        "my-team",
    );
    setLead(
      items.find((item) => item.kind === "agent" && item.runtimeId === "aidlc-developer-agent")
        ?.runtimeId ??
        items.find((item) => item.kind === "agent")?.runtimeId ??
        "",
    );
    setPhase(nextPhase ?? "construction");
    setRequires("");
  };
  const commitCreation = () => {
    try {
      if (!creating) return;
      const needsPlugin = ["scope", "stage", "agent", "sensor", "tool", "plugin"].includes(
        creating,
      );
      let next = items;
      if (needsPlugin && !plugins.some((plugin) => plugin.runtimeId === pluginName)) {
        if (items.some((item) => item.kind === "plugin" && item.runtimeId === pluginName))
          throw new Error("このプラグインは編集できません。");
        next = [...next, createOwnedPlugin(pluginName, space)];
      }
      let added: CustomizationItem;
      if (creating === "scope") {
        const base = scopes.find((scope) => scope.id === baseId);
        if (!base) throw new Error("ベースのスコープを選んでください。");
        const result = duplicateScope(next, base, name, pluginName, space);
        next = result.items;
        added = result.scope;
      } else if (creating === "plugin") {
        added = next.find(
          (item) => item.kind === "plugin" && item.runtimeId === pluginName,
        ) as CustomizationItem;
      } else {
        added = createItem(creating, space, needsPlugin ? pluginName : undefined);
        if (creating === "stage") {
          if (!/^[a-z][a-z0-9-]*$/.test(name))
            throw new Error("slug は英小文字で始まる英数字とハイフンで入力してください。");
          const slug = name.startsWith(`${pluginName}-`) ? name : `${pluginName}-${name}`;
          if (stages.some((stage) => stage.runtimeId === slug))
            throw new Error("同じ slug のステージがあります。");
          let content = added.content;
          for (const [key, value] of Object.entries({
            slug,
            name: slug,
            phase,
            lead_agent: lead,
            requires_stage: requires ? [requires] : [],
            scopes:
              selected?.kind === "scope" && !isStandard(selected)
                ? [selected.runtimeId]
                : scopes
                    .filter((scope) => !isStandard(scope) && scope.pluginId === pluginName)
                    .map((scope) => scope.runtimeId),
            produces: [`${slug}.md`],
          }))
            content = setSourceField(content, key, value);
          added = { ...added, title: slug, runtimeId: slug, content };
        }
        next = [...next, added];
      }
      onItems(next);
      setCreating(null);
      if (creating === "stage" && selected?.kind === "scope") setDrawerId(added.id);
      else {
        onCategory(categoryOf(added.kind));
        onSelect(added.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "作成できませんでした。");
    }
  };
  const editor = (item: CustomizationItem) => (
    <ItemEditor
      key={item.id}
      item={item}
      items={items}
      disabled={disabled}
      diagnostics={diagnostics}
      onChange={edit}
      onRemove={() => onRemove(item)}
      onOpenReference={() => setDrawerId(null)}
    />
  );
  const categoryCard = (value: Category) => {
    const entries = contextItems.filter(
      (item) => categoryOf(item.kind) === value && !item.target?.contributionTo,
    );
    return (
      <NavigationCard
        key={value}
        title={CATEGORIES.find((entry) => entry.id === value)?.label ?? value}
        category={value}
        onOpen={() => navigate(value)}
      >
        <CardDescription>{DESCRIPTIONS[value]}</CardDescription>
        <p className="text-xs">
          自作 {entries.filter((item) => item.owner !== "core").length} · 標準{" "}
          {entries.filter((item) => item.owner === "core").length}
          {value === "rules"
            ? ` · 変更 ${entries.filter((item) => changed.includes(item.id)).length} ●`
            : ""}
        </p>
        {value === "stages" ? (
          <>
            <ScopeMatrix items={contextItems} />
            <p className="text-xs text-muted-foreground">
              <span className="customization-scope-legend flex flex-wrap gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <StageStatusIcon runs /> 実行
                </span>
                <span className="inline-flex items-center gap-1">
                  <StageStatusIcon runs={false} /> SKIP
                </span>
                <span className="inline-flex items-center gap-1">
                  <StageStatusIcon custom runs /> 自作ステージ
                </span>
                <span className="inline-flex items-center gap-1">
                  <StageStatusIcon custom runs={false} /> 自作ステージのSKIP
                </span>
              </span>
              各ステージの後に承認ゲート。人が承認します。
            </p>
          </>
        ) : null}
      </NavigationCard>
    );
  };
  const visible = contextItems
    .filter(
      (item) =>
        categoryOf(item.kind) === category &&
        !item.target?.contributionTo &&
        (filter === "all" ||
          (filter === "standard" ? item.owner === "core" : item.owner !== "core")) &&
        `${item.title} ${item.runtimeId ?? ""}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => Number(a.owner === "core") - Number(b.owner === "core"));
  const groups =
    category === "stages"
      ? [...PHASES, "その他"]
      : category === "rules"
        ? ["org", "team", "project", "phase", "その他"]
        : [""];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {category ? (
        <nav
          aria-label="カスタマイズのパンくず"
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <Button variant="ghost" onClick={() => navigate(null)}>
            カスタマイズ
          </Button>
          {category ? (
            <>
              <span aria-hidden="true">›</span>
              <Button variant="ghost" onClick={() => navigate(category)}>
                {categoryLabel}
              </Button>
            </>
          ) : null}
          {selected ? (
            <>
              <span aria-hidden="true">›</span>
              <span aria-current="page">{selected.title}</span>
            </>
          ) : null}
        </nav>
      ) : null}
      {category === null ? (
        <div className="customization-map">
          {categoryCard("scopes")}
          <div className="flex h-16 items-center justify-center">
            <svg
              aria-hidden="true"
              viewBox="0 0 40 28"
              className="h-5 w-7 text-muted-foreground"
              fill="currentColor"
            >
              <path d="M2 2h36L20 26z" />
            </svg>
          </div>
          {categoryCard("stages")}
          <div className="customization-supports">
            <div className="customization-support-stem" aria-hidden="true" />
            <div className="customization-support-bus" aria-hidden="true" />
            <p className="customization-support-caption text-sm text-muted-foreground">
              ステージで使う設定
            </p>
            <div className="customization-support-grid">
              {(["agents", "quality", "rules", "knowledge"] as const).map((value) => (
                <div className="customization-support-item" key={value}>
                  {categoryCard(value)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : selected ? (
        selected.kind === "scope" ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <TextControl
                  label="スコープ名"
                  value={selected.title}
                  disabled={disabled || isStandard(selected)}
                  onChange={(title) => onItems(renameScope(items, selected, title))}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  ベース: {textField(selected.content, "baseScope") || "標準定義"} · 所有:{" "}
                  {selected.pluginId ?? "標準"} ·{" "}
                  {
                    stages.filter((stage) => runsStage(stage, selected.runtimeId ?? "", items))
                      .length
                  }{" "}
                  ステージを実行
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => start("scope", selected)}
                >
                  複製
                </Button>
                {!isStandard(selected) ? (
                  <Button variant="ghost" disabled={disabled} onClick={() => onRemove(selected)}>
                    削除
                  </Button>
                ) : null}
              </div>
            </div>
            {isStandard(selected) ? (
              <p className="text-sm text-muted-foreground">
                標準スコープは閲覧のみです。「複製」で自分のスコープにしてから編集できます。
              </p>
            ) : null}
            <Tabs key={selected.id} defaultValue="settings" className="gap-5">
              <TabsList aria-label="スコープ詳細">
                <TabsTrigger value="settings">スコープ設定</TabsTrigger>
                <TabsTrigger value="stages">実行するステージ</TabsTrigger>
              </TabsList>
              <TabsPanel value="stages" className="flex flex-col gap-5">
                <p className="text-xs text-muted-foreground">
                  Initializationは常時実行です。前提ステージがSKIPでも、そのスコープでは実行できます。
                </p>
                {PHASES.map((value) => (
                  <section key={value} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-medium">{phaseLabel(value)}</h3>
                      {value !== "initialization" && !isStandard(selected) ? (
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => start("stage", undefined, value)}
                        >
                          ＋ ステージを追加
                        </Button>
                      ) : null}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr>
                            {[
                              "実行",
                              "ステージ",
                              "主担当 / 協働 / レビュー",
                              "前提ステージ",
                              "チェック",
                            ].map((label) => (
                              <th key={label} className="p-2">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {stages
                            .filter((stage) => textField(stage.content, "phase") === value)
                            .map((stage) => (
                              <tr
                                key={stage.id}
                                className="border-t hover:bg-muted/50"
                                onClick={(event) => {
                                  if (
                                    !(event.target as Element).closest(
                                      'button,input,[role="checkbox"],label',
                                    )
                                  )
                                    setDrawerId(stage.id);
                                }}
                              >
                                <td className="p-2">
                                  <Checkbox
                                    aria-label={`${stage.runtimeId} を実行`}
                                    checked={runsStage(stage, selected.runtimeId ?? "", items)}
                                    disabled={
                                      disabled ||
                                      isStandard(selected) ||
                                      value === "initialization" ||
                                      (stage.owner !== "core" &&
                                        stage.pluginId !== selected.pluginId)
                                    }
                                    onCheckedChange={(checked) =>
                                      onItems(
                                        setMembership(items, selected, stage, Boolean(checked)),
                                      )
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <Button variant="link" onClick={() => setDrawerId(stage.id)}>
                                    {stage.owner === "core" ? "" : "◆ "}
                                    {stage.runtimeId}
                                  </Button>
                                </td>
                                <td className="p-2">{stageRoles(stage)}</td>
                                <td className="p-2">
                                  {listField(stage.content, "requires_stage").join(", ") || "なし"}
                                </td>
                                <td className="p-2">
                                  {listField(stage.content, "sensors").join(", ") || "なし"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </TabsPanel>
              <TabsPanel value="settings">{editor(selected)}</TabsPanel>
            </Tabs>
          </>
        ) : (
          editor(selected)
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-section-title font-bold">{categoryLabel}</h2>
            <div className="flex flex-wrap gap-2">
              {category === "knowledge" ? (
                <Button variant="outline" disabled={disabled} onClick={onDocument}>
                  文書を追加
                </Button>
              ) : null}
              <Button
                disabled={disabled}
                onClick={() =>
                  start(
                    CATEGORIES.find((entry) => entry.id === category)?.kinds[0] ?? "rule-section",
                  )
                }
              >
                ＋ 追加
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{DESCRIPTIONS[category]}</p>
          <Tabs value={filter} onValueChange={(value) => setFilter(String(value))}>
            <TabsList aria-label="項目の絞り込み">
              <TabsTrigger value="all">すべて</TabsTrigger>
              <TabsTrigger value="custom">自作</TabsTrigger>
              <TabsTrigger value="standard">標準</TabsTrigger>
            </TabsList>
          </Tabs>
          <Field>
            <FieldLabel htmlFor="customization-search">項目を探す</FieldLabel>
            <Input
              id="customization-search"
              placeholder="表示名・識別子"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          {!visible.length ? (
            <p className="text-sm text-muted-foreground">
              {search ? "検索に一致する項目はありません。" : "このカテゴリの設定はまだありません。"}
            </p>
          ) : null}
          {groups.map((group) => {
            const members = visible.filter((item) => {
              const value =
                category === "stages"
                  ? textField(item.content, "phase")
                  : (item.target?.layer ?? "");
              return !group || (groups.includes(value) ? value : "その他") === group;
            });
            return members.length ? (
              <section key={group} className="flex flex-col gap-3">
                {group ? (
                  <h3 className="font-medium">
                    {category === "stages" ? phaseLabel(group) : group}
                  </h3>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {members.map((item) => (
                    <NavigationCard
                      key={item.id}
                      title={item.title}
                      category={category}
                      custom={item.owner !== "core"}
                      changed={changed.includes(item.id)}
                      onOpen={() => onSelect(item.id)}
                    >
                      <p className="text-xs text-muted-foreground">
                        {item.owner === "core" ? "標準 · 閲覧のみ" : "◆ 自作"}
                        {item.pluginId ? ` · ${item.pluginId}` : ""}
                      </p>
                      <p className="line-clamp-3 text-sm">
                        {item.kind === "stage"
                          ? stageRoles(item)
                          : textField(item.content, "description") ||
                            item.target?.heading ||
                            item.runtimeId ||
                            "設定を開く"}
                      </p>
                      {item.kind === "scope" ? (
                        <p className="text-xs">
                          {
                            stages.filter((stage) => runsStage(stage, item.runtimeId ?? "", items))
                              .length
                          }{" "}
                          ステージを実行
                        </p>
                      ) : null}
                    </NavigationCard>
                  ))}
                </div>
              </section>
            ) : null;
          })}
          {category === "scopes" ? (
            <Button
              variant="dashed"
              className="h-20"
              disabled={disabled}
              onClick={() => start("scope")}
            >
              ＋ 標準スコープを複製して作る
            </Button>
          ) : null}
        </>
      )}
      <Dialog
        open={Boolean(drawer)}
        onOpenChange={(open) => {
          if (!open) setDrawerId(null);
        }}
      >
        <DialogContent size="drawer">
          <DialogHeader>
            <DialogTitle data-autofocus tabIndex={-1} className="wrap-break-word">
              {drawer?.title}
            </DialogTitle>
            <DialogDescription>ステージの設定と作業方針</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {drawer ? editor(drawer) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {creating === "scope"
                ? "スコープを複製して作る"
                : creating === "stage"
                  ? "ステージを追加"
                  : "項目を追加"}
            </DialogTitle>
            <DialogDescription>作成した設定は自動保存されます。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {creating &&
            (CATEGORIES.find((entry) => entry.id === category)?.kinds.length ?? 0) > 1 ? (
              <Field>
                <FieldLabel htmlFor="new-item-kind">種類</FieldLabel>
                <FormSelect
                  id="new-item-kind"
                  value={creating}
                  onChange={(value) => setCreating(value as CustomizationKind)}
                  options={(CATEGORIES.find((entry) => entry.id === category)?.kinds ?? []).map(
                    (kind) => ({
                      value: kind,
                      label: KIND_LABELS[kind],
                    }),
                  )}
                />
              </Field>
            ) : null}
            {["scope", "stage", "agent", "sensor", "tool", "plugin"].includes(creating ?? "") ? (
              <TextControl
                label="所有プラグイン"
                value={pluginName}
                onChange={setPluginName}
                hint="未作成の名前を指定すると、同時にプラグインを作成します。"
              />
            ) : null}
            {creating === "scope" ? (
              <Field>
                <FieldLabel htmlFor="scope-base">ベースのスコープ</FieldLabel>
                <FormSelect
                  id="scope-base"
                  value={baseId}
                  onChange={setBaseId}
                  options={scopes.map((scope) => ({ value: scope.id, label: scope.title }))}
                />
              </Field>
            ) : null}
            {creating === "scope" || creating === "stage" ? (
              <TextControl
                label={creating === "scope" ? "新しいスコープ名" : "slug"}
                value={name}
                onChange={setName}
              />
            ) : null}
            {creating === "stage" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="stage-phase">フェーズ</FieldLabel>
                  <FormSelect
                    id="stage-phase"
                    value={phase}
                    onChange={setPhase}
                    options={PHASES.filter((value) => value !== "initialization").map((value) => ({
                      value,
                      label: phaseLabel(value),
                    }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="stage-lead">担当</FieldLabel>
                  <FormSelect
                    id="stage-lead"
                    value={lead}
                    onChange={setLead}
                    options={items
                      .filter((item) => item.kind === "agent")
                      .map((item) => ({
                        value: item.runtimeId ?? item.id,
                        label: item.runtimeId ?? item.title,
                      }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="stage-requires">前提ステージ</FieldLabel>
                  <FormSelect
                    id="stage-requires"
                    value={requires}
                    onChange={setRequires}
                    options={[
                      { value: "", label: "なし" },
                      ...stages.map((stage) => ({
                        value: stage.runtimeId ?? stage.id,
                        label: stage.runtimeId ?? stage.title,
                      })),
                    ]}
                  />
                </Field>
              </>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <Button disabled={disabled} onClick={commitCreation}>
              作成
            </Button>
          </FieldGroup>
        </DialogContent>
      </Dialog>
    </div>
  );
}
