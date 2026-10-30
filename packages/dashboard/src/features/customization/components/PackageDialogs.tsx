import type {
  CustomizationImportPlan,
  CustomizationImportSelection,
  CustomizationItem,
} from "@andon/shared-types";
import { useState } from "react";
import { FormSelect } from "@/shared/form-select";
import type { ExportSelection } from "@/features/customization/types.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { TextControl } from "@/features/customization/components/editor/ItemEditor";
import { KIND_LABELS } from "@/features/customization/utils/kind-labels.ts";
import { itemLocation } from "@/features/customization/utils/source-fields";

export function ImportDialog({
  plan,
  items,
  stale,
  busy,
  error,
  onClose,
  onAdopt,
}: {
  plan: CustomizationImportPlan | null;
  items: CustomizationItem[];
  stale: boolean;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onAdopt: (selections: CustomizationImportSelection[]) => void;
}) {
  const [selections, setSelections] = useState<Record<string, string | null>>({});
  return (
    <Dialog
      open={plan !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>取り込む項目を選ぶ</DialogTitle>
          <DialogDescription>
            選んだ項目を取り込み、自動保存します。未選択の項目と、それ以外の編集は保持します。
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {stale ? (
          <Alert>
            <AlertDescription>
              入力が変わりました。閉じて同じファイルを読み込み直してください。
            </AlertDescription>
          </Alert>
        ) : null}
        <FieldSet>
          <FieldLegend>読み込み項目</FieldLegend>
          {plan?.entries.map((entry) => (
            <FieldGroup key={entry.sourceId}>
              <Field orientation="horizontal">
                <Checkbox
                  id={`import-${entry.sourceId}`}
                  checked={Object.hasOwn(selections, entry.sourceId)}
                  onCheckedChange={(checked) =>
                    setSelections((current) => {
                      const next = { ...current };
                      if (checked) next[entry.sourceId] = entry.matchId;
                      else delete next[entry.sourceId];
                      return next;
                    })
                  }
                />
                <FieldLabel htmlFor={`import-${entry.sourceId}`}>
                  {entry.item.title} · {itemLocation(entry.item)} · {KIND_LABELS[entry.item.kind]}
                </FieldLabel>
              </Field>
              {Object.hasOwn(selections, entry.sourceId) ? (
                <Field>
                  <FieldLabel htmlFor={`target-${entry.sourceId}`}>取り込み先</FieldLabel>
                  <FormSelect
                    id={`target-${entry.sourceId}`}
                    value={selections[entry.sourceId] ?? ""}
                    onChange={(value) =>
                      setSelections((current) => ({
                        ...current,
                        [entry.sourceId]: value || null,
                      }))
                    }
                    options={[
                      { value: "", label: "新しい項目として追加" },
                      ...items
                        .filter(
                          (item) =>
                            item.kind === entry.item.kind &&
                            (item.kind !== "knowledge" ||
                              item.target?.knowledgeType === entry.item.target?.knowledgeType),
                        )
                        .map((item) => ({
                          value: item.id,
                          label: `${item.title} · ${itemLocation(item)} を置き換える`,
                        })),
                    ]}
                  />
                </Field>
              ) : null}
              <Collapsible>
                <CollapsibleTrigger variant="disclosure">内容を見る</CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="whitespace-pre-wrap wrap-break-word text-xs">
                    {entry.item.content}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </FieldGroup>
          ))}
        </FieldSet>
        {plan?.diagnostics.map((entry) => (
          <p key={`${entry.code}-${entry.itemId}-${entry.field}-${entry.message}`}>
            {entry.message}
          </p>
        ))}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
          <Button
            disabled={stale || busy || !Object.keys(selections).length}
            onClick={() =>
              onAdopt(
                Object.entries(selections).map(([sourceId, targetId]) => ({ sourceId, targetId })),
              )
            }
          >
            選んだ項目を取り込む
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { ExportSelection } from "@/features/customization/types.ts";
export function ExportDialog({
  open,
  items,
  busy,
  error,
  onClose,
  onExport,
}: {
  open: boolean;
  items: CustomizationItem[];
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onExport: (selection: ExportSelection) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<"guide" | "plugin">("guide");
  const [name, setName] = useState("team-customization");
  const [version, setVersion] = useState("0.1.0");
  const [confirmed, setConfirmed] = useState(false);
  const [harnesses, setHarnesses] = useState(["claude", "cursor"]);
  const unsupported = items.filter(
    (item) =>
      selected.includes(item.id) &&
      (item.kind === "rule-section" ||
        item.kind === "rule-file-metadata" ||
        item.owner === "core" ||
        (item.kind === "knowledge" && item.target?.knowledgeType !== "plugin-markdown")),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>設定を書き出す</DialogTitle>
          <DialogDescription>
            選択した設定を配布用ファイルにします。書き出しても現在のプロジェクトには適用されません。
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="export-format">配布形式</FieldLabel>
            <FormSelect
              id="export-format"
              value={format}
              onChange={(value) => {
                setFormat(value as typeof format);
                setConfirmed(false);
              }}
              options={[
                { value: "guide", label: "Andon用の設定ファイル" },
                { value: "plugin", label: "標準プラグイン（ZIP）" },
              ]}
            />
          </Field>
          <TextControl label="配布名" value={name} onChange={setName} />
          <TextControl label="配布バージョン" value={version} onChange={setVersion} />
          <FieldSet>
            <FieldLegend>書き出す項目</FieldLegend>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(items.map((item) => item.id));
                  setConfirmed(false);
                }}
              >
                すべて選択
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                選択を解除
              </Button>
            </div>
            {items.map((item) => (
              <Field key={item.id} orientation="horizontal">
                <Checkbox
                  id={`export-${item.id}`}
                  checked={selected.includes(item.id)}
                  onCheckedChange={(checked) => {
                    setSelected((value) =>
                      checked ? [...value, item.id] : value.filter((id) => id !== item.id),
                    );
                    setConfirmed(false);
                  }}
                />
                <FieldLabel htmlFor={`export-${item.id}`}>
                  {item.title} · {itemLocation(item)} · {KIND_LABELS[item.kind]}
                </FieldLabel>
              </Field>
            ))}
          </FieldSet>
          {format === "plugin" ? (
            <>
              <FieldSet>
                <FieldLegend>配布先のツール</FieldLegend>
                {["claude", "cursor", "codex", "kiro", "kiro-ide", "opencode", "copilot"].map(
                  (harness) => (
                    <Field key={harness} orientation="horizontal">
                      <Checkbox
                        id={`export-harness-${harness}`}
                        checked={harnesses.includes(harness)}
                        onCheckedChange={(checked) =>
                          setHarnesses((value) =>
                            checked ? [...value, harness] : value.filter((id) => id !== harness),
                          )
                        }
                      />
                      <FieldLabel htmlFor={`export-harness-${harness}`}>{harness}</FieldLabel>
                    </Field>
                  ),
                )}
              </FieldSet>
              {unsupported.length ? (
                <Alert>
                  <AlertDescription>
                    <p>標準プラグインに含められない可能性がある項目：</p>
                    <ul>
                      {unsupported.map((item) => (
                        <li key={item.id}>{item.title}</li>
                      ))}
                    </ul>
                    <Field orientation="horizontal">
                      <Checkbox
                        id="export-omissions"
                        checked={confirmed}
                        onCheckedChange={setConfirmed}
                      />
                      <FieldLabel htmlFor="export-omissions">
                        非対応項目を除いた内容で書き出す
                      </FieldLabel>
                    </Field>
                    <p>依存関係を含む最終判定は書き出し時に行います。</p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              閉じる
            </Button>
            <Button
              disabled={
                busy ||
                !selected.length ||
                !name.trim() ||
                !version.trim() ||
                (format === "plugin" &&
                  (!harnesses.length || (unsupported.length > 0 && !confirmed)))
              }
              onClick={() =>
                onExport({
                  format,
                  itemIds: selected,
                  name,
                  version,
                  excludeUnsupported: confirmed,
                  harnesses,
                })
              }
            >
              {busy ? "書き出しています…" : "ファイルを書き出す"}
            </Button>
          </div>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
