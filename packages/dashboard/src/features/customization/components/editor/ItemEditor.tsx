import type {
  CustomizationDiagnostic,
  CustomizationItem,
  CustomizationKind,
} from "@andon/shared-types";
import { type ReactNode, useId, useRef, useState } from "react";
import { isMap } from "yaml";
import { FormSelect } from "@/shared/form-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScopeDescription } from "./ScopeDescription";
import { StageDescription } from "./StageDescription";
import {
  frontmatter,
  listField,
  ruleBody,
  setJsonField,
  setRuleBody,
  setRuleHeading,
  setSourceBody,
  setSourceField,
  sourceBody,
  sourceField,
  textField,
} from "@/features/customization/utils/source-fields";
import { KIND_LABELS } from "@/features/customization/utils/kind-labels.ts";
import { isStandard } from "@/features/customization/utils/workflow-model";

type FieldSpec = {
  key: string;
  label: string;
  type?: "text" | "long" | "list" | "number";
  options?: string[];
  refs?: CustomizationKind;
  hint?: string;
};
const PHASES = ["ideation", "inception", "construction", "operation"];
const FIELDS: Partial<Record<CustomizationKind, FieldSpec[]>> = {
  stage: [
    { key: "phase", label: "フェーズ", options: ["initialization", ...PHASES] },
    { key: "execution", label: "実行方式", options: ["ALWAYS", "CONDITIONAL"] },
    {
      key: "condition",
      label: "実行条件",
      type: "long",
      hint: "条件付きで行う場合の判断基準です。",
    },
    { key: "lead_agent", label: "主担当エージェント", refs: "agent" },
    { key: "support_agents", label: "協働エージェント", type: "list", refs: "agent" },
    { key: "mode", label: "協働方式", options: ["inline", "subagent", "pipeline", "mob"] },
    { key: "requires_stage", label: "前提ステージ", type: "list", refs: "stage" },
    { key: "scopes", label: "所属スコープ", type: "list", refs: "scope" },
    { key: "produces", label: "必須成果物", type: "list", hint: "成果物名を1行に一つ記入します。" },
    { key: "optional_produces", label: "任意成果物", type: "list" },
    { key: "sensors", label: "品質チェック", type: "list", refs: "sensor" },
  ],
  scope: [
    { key: "description", label: "説明", type: "long" },
    {
      key: "depth",
      label: "設計・成果物の詳しさ",
      options: ["Minimal", "Standard", "Comprehensive"],
    },
    { key: "testStrategy", label: "テスト方針", options: ["Minimal", "Standard", "Comprehensive"] },
    { key: "review_cap", label: "レビューの上限", options: ["none", "advisory", "adversarial"] },
    { key: "guard_policy", label: "ガード方針", options: ["strict", "relaxed", "off"] },
    { key: "sensors", label: "センサー", options: ["on", "off"] },
    { key: "learnings", label: "学習の記録", options: ["on", "off"] },
    { key: "summary_confirmation", label: "要約の確認", options: ["on", "off"] },
    {
      key: "plan_approval",
      label: "計画承認",
      options: ["on", "off"],
      hint: "コード生成の計画を承認してから実装するかの既定です。",
    },
    {
      key: "collaborators",
      label: "協働エージェント",
      options: ["on", "off"],
      hint: "off では各ステージを主担当エージェントだけで進めます。",
    },
    { key: "skeleton", label: "スケルトン", options: ["on", "off"] },
    {
      key: "existing_code",
      label: "既存コードの変更",
      options: ["true", "false"],
      hint: "既存のコードを変更するスコープであることを示します。",
    },
    { key: "keywords", label: "対象キーワード", type: "list" },
    { key: "runner", label: "ランナー", options: ["true", "false"] },
    { key: "freeform_default", label: "自由記述の既定スコープ", options: ["true", "false"] },
  ],
  agent: [
    { key: "description", label: "専門性・説明", type: "long" },
    {
      key: "tier",
      label: "判断の難しさ",
      options: ["judgment", "balanced", "templated"],
      hint: "特定のモデル名とは別の設定です。",
    },
  ],
  sensor: [
    { key: "description", label: "検査内容", type: "long" },
    { key: "category", label: "分類" },
    { key: "command", label: "チェックコマンド", hint: "この画面では実行しません。" },
    {
      key: "fire_on",
      label: "実行タイミング",
      options: ["gate", "write"],
      hint: "承認ゲート、またはファイルの書き込み時に確認します。",
    },
    {
      key: "default_severity",
      label: "不合格時の扱い",
      options: ["advisory", "blocking"],
      hint: "blocking は承認ゲートで進行を止める指定です。",
    },
    { key: "matches", label: "対象ファイルのパターン" },
    { key: "timeout_seconds", label: "制限時間（秒）", type: "number" },
  ],
  "rule-file-metadata": [
    { key: "pairing", label: "対話の進め方", options: ["standard", "guided"] },
    {
      key: "status",
      label: "診断上の状態",
      options: ["active", "draft", "deprecated"],
      hint: "draft / deprecated にしてもルールの実行は無効になりません。",
    },
    { key: "stale_after", label: "見直し期限" },
  ],
};
const ADVANCED: Partial<Record<CustomizationKind, FieldSpec[]>> = {
  stage: [
    { key: "reviewer", label: "レビュー担当", refs: "agent" },
    { key: "review_artifact", label: "レビュー対象の成果物" },
    { key: "reviewer_max_iterations", label: "レビューの最大反復回数", type: "number" },
    { key: "review_class", label: "レビュー方式", options: ["adversarial", "advisory"] },
    { key: "summary_confirmation", label: "要約の確認", options: ["required", "if-present"] },
    { key: "for_each", label: "繰り返し単位" },
    { key: "workspace_requires", label: "ソースへのアクセスが必要", options: ["true", "false"] },
    { key: "inputs", label: "入力の説明", type: "long" },
    { key: "outputs", label: "出力の説明", type: "long" },
  ],
  agent: [
    { key: "tools", label: "許可するツール", type: "list" },
    {
      key: "disallowedTools",
      label: "禁止するツール",
      hint: "適用先ハーネスによって対応する項目が異なります。",
    },
  ],
};

export function TextControl({
  label,
  value,
  onChange,
  disabled,
  multiline = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          disabled={disabled}
          rows={6}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FormSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={[
          { value: "", label: "未指定" },
          ...(value && !options.some((option) => option.value === value)
            ? [{ value, label: `${value}（現在の値）` }]
            : []),
          ...options,
        ]}
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

function SourceControl({
  spec,
  item,
  items,
  onChange,
  disabled,
}: {
  spec: FieldSpec;
  item: CustomizationItem;
  items: CustomizationItem[];
  onChange: (item: CustomizationItem) => void;
  disabled: boolean;
}) {
  // Preserve readable legacy scopes instead of silently creating a conflicting second policy.
  const key =
    spec.key === "guard_policy" &&
    sourceField(item.content, "guard_policy") === undefined &&
    sourceField(item.content, "change_control") !== undefined
      ? "change_control"
      : spec.key;
  const change = (value: unknown) =>
    onChange({ ...item, content: setSourceField(item.content, key, value) });
  const options =
    spec.options?.map((value) => ({ value, label: value })) ??
    (spec.refs
      ? items
          .filter((entry) => entry.kind === spec.refs && entry.id !== item.id)
          .map((entry) => ({ value: entry.runtimeId ?? entry.id, label: entry.title }))
      : undefined);
  if (spec.type === "list")
    return (
      <FieldGroup>
        <TextControl
          label={spec.label}
          multiline
          value={listField(item.content, spec.key).join("\n")}
          onChange={(value) =>
            change(
              value
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean),
            )
          }
          disabled={disabled}
          hint={spec.hint ?? "1行に一つ指定します。"}
        />
        {options?.length ? (
          <SelectControl
            label={`${spec.label}を追加`}
            value=""
            options={options}
            disabled={disabled}
            onChange={(value) => {
              if (value) change([...new Set([...listField(item.content, spec.key), value])]);
            }}
          />
        ) : null}
      </FieldGroup>
    );
  if (options)
    return (
      <SelectControl
        label={spec.label}
        value={textField(item.content, key)}
        options={options}
        disabled={disabled}
        hint={spec.hint}
        onChange={(value) => change(value === "true" ? true : value === "false" ? false : value)}
      />
    );
  return (
    <TextControl
      label={spec.label}
      value={textField(item.content, spec.key)}
      disabled={disabled}
      multiline={spec.type === "long"}
      hint={spec.hint}
      onChange={(value) =>
        change(spec.type === "number" && /^\d+$/.test(value) ? Number(value) : value)
      }
    />
  );
}

function ConsumesEditor({
  item,
  onChange,
  disabled,
}: {
  item: CustomizationItem;
  onChange: (item: CustomizationItem) => void;
  disabled: boolean;
}) {
  const raw = sourceField(item.content, "consumes");
  const rowIds = useRef<string[]>([]);
  if (
    raw !== undefined &&
    (!Array.isArray(raw) ||
      raw.some((value) => !value || typeof value !== "object" || Array.isArray(value)))
  )
    return (
      <Alert>
        <AlertDescription>
          入力成果物の構造を読み取れません。原文の consumes を修正してください。
        </AlertDescription>
      </Alert>
    );
  const entries = Array.isArray(raw)
    ? (raw as Array<{ artifact: string; required: boolean; conditional_on?: string }>)
    : [];
  while (rowIds.current.length < entries.length) rowIds.current.push(crypto.randomUUID());
  const set = (values: typeof entries) =>
    onChange({ ...item, content: setSourceField(item.content, "consumes", values) });
  return (
    <FieldSet>
      <FieldLegend>入力成果物</FieldLegend>
      <FieldDescription>ステージが参照する成果物と必須条件を指定します。</FieldDescription>
      {entries.map((entry, index) => (
        <Card key={rowIds.current[index]}>
          <CardContent>
            <FieldGroup>
              <TextControl
                label={`入力成果物 ${index + 1}`}
                value={entry.artifact ?? ""}
                disabled={disabled}
                onChange={(artifact) =>
                  set(entries.map((value, i) => (i === index ? { ...value, artifact } : value)))
                }
              />
              <SelectControl
                label={`入力 ${index + 1} の必須指定`}
                value={String(entry.required === true)}
                options={[
                  { value: "true", label: "必須" },
                  { value: "false", label: "任意" },
                ]}
                disabled={disabled}
                onChange={(required) =>
                  set(
                    entries.map((value, i) =>
                      i === index ? { ...value, required: required === "true" } : value,
                    ),
                  )
                }
              />
              <SelectControl
                label={`入力 ${index + 1} の条件`}
                value={entry.conditional_on ?? ""}
                options={[
                  { value: "brownfield", label: "既存システム" },
                  { value: "greenfield", label: "新規開発" },
                ]}
                disabled={disabled}
                onChange={(condition) =>
                  set(
                    entries.map((value, i) =>
                      i === index
                        ? {
                            artifact: value.artifact,
                            required: value.required,
                            ...(condition ? { conditional_on: condition } : {}),
                          }
                        : value,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => set(entries.filter((_, i) => i !== index))}
              >
                この入力を除く
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      ))}
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => set([...entries, { artifact: "", required: true }])}
      >
        入力成果物を追加
      </Button>
    </FieldSet>
  );
}

function PluginFields({
  item,
  onChange,
  disabled,
}: {
  item: CustomizationItem;
  onChange: (item: CustomizationItem) => void;
  disabled: boolean;
}) {
  let source: Record<string, unknown>;
  try {
    source = JSON.parse(item.content);
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new Error("object required");
  } catch {
    return (
      <Alert>
        <AlertDescription>
          プラグイン定義のJSONを解析できません。原文を修正してください。
        </AlertDescription>
      </Alert>
    );
  }
  const update = (key: string, value: unknown) =>
    onChange({
      ...item,
      content: setJsonField(item.content, key, value),
      ...(key === "name" && typeof value === "string" ? { runtimeId: value, pluginId: value } : {}),
    });
  const dependencies = Array.isArray(source.dependencies)
    ? source.dependencies.filter((value): value is string => typeof value === "string")
    : [];
  return (
    <FieldGroup>
      {["name", "version", "description", "author"].map((key, index) => (
        <TextControl
          key={key}
          label={["プラグイン名", "バージョン", "説明", "作者"][index] ?? key}
          disabled={disabled || (key === "name" && Boolean(item.source))}
          value={typeof source[key] === "string" ? source[key] : ""}
          multiline={key === "description"}
          onChange={(value) => update(key, value)}
        />
      ))}
      <TextControl
        label="依存プラグイン"
        value={dependencies.join("\n")}
        multiline
        disabled={disabled}
        hint="1行に core または プラグイン名@^1.2.0 のように記入します。"
        onChange={(value) =>
          update(
            "dependencies",
            value
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
          )
        }
      />
    </FieldGroup>
  );
}

function StageAssignments({
  item,
  items,
  onChange,
  disabled,
}: {
  item: CustomizationItem;
  items: CustomizationItem[];
  onChange: (item: CustomizationItem) => void;
  disabled: boolean;
}) {
  const stages = items.filter(
    (value) =>
      value.kind === "stage" &&
      !isStandard(value) &&
      !value.target?.contributionTo &&
      frontmatter(value.content)?.doc.errors.length === 0,
  );
  const runtime = item.runtimeId;
  if (!runtime) return null;
  const field =
    item.kind === "sensor" ? "sensors" : item.kind === "scope" ? "scopes" : "support_agents";
  return (
    <Collapsible>
      <CollapsibleTrigger variant="disclosure">
        この設定を使うステージ（{stages.length}件から選択）
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FieldGroup className="py-4">
          {stages.map((stage) => (
            <FieldGroup key={stage.id}>
              <Field orientation="horizontal">
                <Checkbox
                  id={`assignment-${item.id}-${stage.id}`}
                  checked={listField(stage.content, field).includes(runtime)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...stage,
                      content: setSourceField(
                        stage.content,
                        field,
                        checked
                          ? [...new Set([...listField(stage.content, field), runtime])]
                          : listField(stage.content, field).filter((value) => value !== runtime),
                      ),
                    })
                  }
                />
                <FieldLabel htmlFor={`assignment-${item.id}-${stage.id}`}>
                  {stage.title}
                  {item.kind === "agent" ? " の協働担当" : ""}
                </FieldLabel>
              </Field>
              {item.kind === "agent" ? (
                <div className="flex flex-col gap-2">
                  {[
                    { key: "lead_agent", label: "主担当" },
                    { key: "reviewer", label: "レビュー担当" },
                  ].map((role) => (
                    <Field key={role.key} orientation="horizontal">
                      <Checkbox
                        id={`assignment-${role.key}-${item.id}-${stage.id}`}
                        disabled={disabled}
                        checked={textField(stage.content, role.key) === runtime}
                        onCheckedChange={(checked) =>
                          onChange({
                            ...stage,
                            content: setSourceField(
                              stage.content,
                              role.key,
                              checked ? runtime : "",
                            ),
                          })
                        }
                      />
                      <FieldLabel htmlFor={`assignment-${role.key}-${item.id}-${stage.id}`}>
                        {stage.title} の{role.label}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              ) : null}
            </FieldGroup>
          ))}
        </FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ItemEditor({
  item,
  items,
  onChange,
  onRemove,
  onOpenReference,
  disabled = false,
  diagnostics = [],
}: {
  item: CustomizationItem;
  items: CustomizationItem[];
  onChange: (item: CustomizationItem) => void;
  onRemove: () => void;
  onOpenReference?: () => void;
  disabled?: boolean;
  diagnostics?: CustomizationDiagnostic[];
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const update = (next: CustomizationItem) => {
    setError(null);
    onChange(next);
  };
  const protectedUpdate = (task: () => void) => {
    try {
      task();
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "設定を編集できませんでした。");
    }
  };
  const editable = !disabled && item.editable !== false && !isStandard(item);
  const meta = frontmatter(item.content);
  const structured = meta && !meta.doc.errors.length && isMap(meta.doc.contents);
  const runtimeKey = item.kind === "stage" ? "slug" : item.kind === "sensor" ? "id" : "name";
  const titleKey = item.kind === "agent" ? "display_name" : "name";
  const sources = FIELDS[item.kind] ?? [];
  const target = item.target ?? {};
  const pluginOptions = items
    .filter((value) => value.kind === "plugin")
    .map((value) => ({ value: value.runtimeId ?? value.pluginId ?? value.id, label: value.title }));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
          <Badge variant="outline">
            所有:
            {item.owner === "core"
              ? "標準"
              : item.owner === "plugin"
                ? "プラグイン"
                : "プロジェクト"}
          </Badge>
        </div>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>
          {item.source?.relativePath ?? "新しい項目。適用時に設定へ追加します。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {diagnostics
            .filter((value) => value.itemId === item.id)
            .map((value) => (
              <Alert
                key={`${value.code}-${value.field}-${value.message}`}
                variant={value.severity === "error" ? "destructive" : "default"}
              >
                <AlertDescription>{value.message}</AlertDescription>
              </Alert>
            ))}
          {!editable ? (
            <Alert>
              <AlertDescription>
                {isStandard(item)
                  ? "標準の設定は閲覧のみです。"
                  : disabled
                    ? "現在の設定を閲覧しています。"
                    : "この項目の原本を確認できないため編集できません。"}
              </AlertDescription>
            </Alert>
          ) : null}
          <TextControl
            label="表示名"
            value={item.title}
            disabled={!editable}
            onChange={(title) =>
              protectedUpdate(() =>
                update({
                  ...item,
                  title,
                  ...((structured && item.kind === "stage") || (structured && item.kind === "agent")
                    ? { content: setSourceField(item.content, titleKey, title) }
                    : {}),
                }),
              )
            }
          />
          {item.runtimeId !== undefined &&
          !["plugin", "knowledge", "rule-section", "rule-file-metadata"].includes(item.kind) ? (
            <TextControl
              label="識別子"
              value={item.runtimeId}
              disabled={!editable || Boolean(item.source)}
              hint={
                item.source
                  ? "既存項目の識別子は固定です。別の識別子を使う場合は新しい項目を追加してください。"
                  : "参照しているステージなども合わせて変更してください。"
              }
              onChange={(runtimeId) =>
                protectedUpdate(() =>
                  update({
                    ...item,
                    runtimeId,
                    ...(structured
                      ? { content: setSourceField(item.content, runtimeKey, runtimeId) }
                      : {}),
                  }),
                )
              }
            />
          ) : null}
          {(item.owner === "plugin" || target.knowledgeType === "plugin-markdown") &&
          item.kind !== "plugin" ? (
            <SelectControl
              label="所属プラグイン"
              value={item.pluginId ?? ""}
              options={pluginOptions}
              disabled={!editable || Boolean(item.source)}
              onChange={(pluginId) => update({ ...item, pluginId })}
            />
          ) : null}
          {item.kind === "rule-section" || item.kind === "rule-file-metadata" ? (
            <FieldGroup>
              <SelectControl
                label="ルールの適用層"
                value={target.layer ?? "project"}
                disabled={!editable}
                options={[
                  { value: "org", label: "組織" },
                  { value: "team", label: "チーム" },
                  { value: "project", label: "プロジェクト" },
                  { value: "phase", label: "フェーズ" },
                ]}
                onChange={(layer) =>
                  update({
                    ...item,
                    target: { ...target, layer: layer as "org" | "team" | "project" | "phase" },
                  })
                }
              />
              {target.layer === "phase" ? (
                <SelectControl
                  label="対象フェーズ"
                  value={target.phase ?? ""}
                  disabled={!editable}
                  options={PHASES.map((value) => ({ value, label: value }))}
                  onChange={(phase) => update({ ...item, target: { ...target, phase } })}
                />
              ) : null}
              {item.kind === "rule-section" ? (
                <TextControl
                  label="章見出し"
                  value={target.heading ?? ""}
                  disabled={!editable}
                  onChange={(heading) =>
                    update({
                      ...item,
                      target: { ...target, heading },
                      content: setRuleHeading(item.content, heading),
                    })
                  }
                />
              ) : null}
            </FieldGroup>
          ) : null}
          {item.kind === "tool" ? (
            <TextControl
              label="スクリプトのファイル名"
              value={target.filename ?? ""}
              disabled={!editable || Boolean(item.source)}
              hint="既存のファイル名を変える場合は、新しい項目を追加してください。"
              onChange={(filename) => update({ ...item, target: { ...target, filename } })}
            />
          ) : null}
          {item.kind === "knowledge" ? (
            <FieldGroup>
              <SelectControl
                label="資料の種類"
                value={target.knowledgeType ?? "team-markdown"}
                disabled={!editable || Boolean(item.binary) || Boolean(item.source)}
                options={[
                  { value: "team-markdown", label: "チームのMarkdown資料" },
                  { value: "plugin-markdown", label: "プラグインの方法論資料" },
                  { value: "document-source", label: "文書原本" },
                  { value: "document-reference", label: "DocumentKBの参照" },
                ]}
                onChange={(knowledgeType) =>
                  update({
                    ...item,
                    target: {
                      ...target,
                      knowledgeType: knowledgeType as NonNullable<
                        CustomizationItem["target"]
                      >["knowledgeType"],
                    },
                  })
                }
              />
              <TextControl
                label="ファイル名"
                value={target.filename ?? ""}
                disabled={
                  !editable ||
                  (item.owner === "plugin" && Boolean(item.source)) ||
                  target.knowledgeType === "document-reference"
                }
                onChange={(filename) => update({ ...item, target: { ...target, filename } })}
              />
              <SelectControl
                label="参照するエージェント"
                value={target.audience === "all" ? "all" : "selected"}
                options={[
                  { value: "all", label: "全エージェント" },
                  { value: "selected", label: "指定エージェント" },
                ]}
                disabled={!editable}
                onChange={(value) =>
                  update({ ...item, target: { ...target, audience: value === "all" ? "all" : [] } })
                }
              />
              {target.audience !== "all" ? (
                <TextControl
                  label="指定エージェントの識別子"
                  multiline
                  value={Array.isArray(target.audience) ? target.audience.join("\n") : ""}
                  disabled={!editable}
                  onChange={(value) =>
                    update({
                      ...item,
                      target: { ...target, audience: value.split(/\r?\n/).filter(Boolean) },
                    })
                  }
                />
              ) : null}
              {item.binary ? (
                <p>
                  {target.filename} · {Math.ceil(item.binary.bytes / 1024)}{" "}
                  KB。文書本文は原本で編集してください。
                </p>
              ) : null}
            </FieldGroup>
          ) : null}
          {item.kind === "plugin" ? (
            <PluginFields item={item} onChange={update} disabled={!editable} />
          ) : structured ? (
            sources.map((spec) => (
              <SourceControl
                key={spec.key}
                spec={spec}
                item={item}
                items={items}
                disabled={!editable}
                onChange={update}
              />
            ))
          ) : sources.length ? (
            <Alert>
              <AlertDescription>
                定義を解析できません。原文を修正するとフォームで編集できます。
              </AlertDescription>
            </Alert>
          ) : null}
          {item.kind === "stage" && structured ? (
            <ConsumesEditor item={item} onChange={update} disabled={!editable} />
          ) : null}
          {["agent", "sensor"].includes(item.kind) ? (
            <StageAssignments item={item} items={items} onChange={update} disabled={!editable} />
          ) : null}
          {item.kind === "stage" ? (
            <StageDescription
              item={item}
              disabled={!editable}
              onChange={update}
              onOpenReference={onOpenReference}
            />
          ) : item.kind === "scope" ? (
            <ScopeDescription item={item} disabled={!editable} onChange={update} />
          ) : item.kind !== "plugin" && item.kind !== "rule-file-metadata" && !item.binary ? (
            <TextControl
              label={
                item.kind === "tool"
                  ? "スクリプト本文"
                  : item.kind === "artifact-template"
                    ? "テンプレート本文"
                    : "本文・作業方針"
              }
              value={
                item.kind === "rule-section" ? ruleBody(item.content) : sourceBody(item.content)
              }
              disabled={!editable || target.knowledgeType === "document-reference"}
              multiline
              onChange={(body) =>
                update({
                  ...item,
                  content:
                    item.kind === "rule-section"
                      ? setRuleBody(item.content, target.heading ?? "", body)
                      : setSourceBody(item.content, body),
                })
              }
            />
          ) : null}
          {structured && ADVANCED[item.kind]?.length ? (
            <Collapsible>
              <CollapsibleTrigger variant="disclosure">詳細設定</CollapsibleTrigger>
              <CollapsibleContent>
                <FieldGroup className="py-4">
                  {ADVANCED[item.kind]?.map((spec) => (
                    <SourceControl
                      key={spec.key}
                      spec={spec}
                      item={item}
                      items={items}
                      onChange={update}
                      disabled={!editable}
                    />
                  ))}
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          {!item.binary ? (
            <Collapsible>
              <CollapsibleTrigger variant="disclosure">原文</CollapsibleTrigger>
              <CollapsibleContent>
                <FieldGroup className="py-4">
                  <TextControl
                    label="設定の原文"
                    value={item.content}
                    multiline
                    disabled={!editable}
                    hint="フォームが対応していない設定やコメントも、この原文に保持されます。"
                    onChange={(content) => {
                      const heading =
                        item.kind === "rule-section"
                          ? /^\uFEFF?##[ \t]+([^\r\n]+)/.exec(content)?.[1]
                          : undefined;
                      update({
                        ...item,
                        content,
                        ...(heading ? { target: { ...target, heading } } : {}),
                      });
                    }}
                  />
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={
                  !editable || (item.owner === "core" && item.originalContent === undefined)
                }
                onClick={onRemove}
              >
                {item.owner === "core" ? "標準設定へ戻す" : "削除"}
              </Button>
            </div>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
