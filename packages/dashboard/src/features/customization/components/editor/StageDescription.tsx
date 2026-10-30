import { type CustomizationItem, slugifyHeading } from "@andon/shared-types";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { STAGE_NUMBERS } from "@/data/stage-numbers";
import { useFetchView } from "@/hooks/useFetchView";
import { fetchOfficialDocsPage } from "@/services/api";
import { openOfficialDocInIde } from "@/services/docs";
import { deliverDocsShellDeepLink } from "@/services/docs-shell-inject";
import { MarkdownEditor } from "./lazy-markdown-editor";
import { setSourceBody, sourceBody, textField } from "@/features/customization/utils/source-fields";
import { japaneseStageSection } from "@/features/customization/utils/stage-description";

export function StageDescription({
  item,
  disabled,
  onChange,
  onOpenReference,
}: {
  item: CustomizationItem;
  disabled: boolean;
  onChange: (item: CustomizationItem) => void;
  onOpenReference?: () => void;
}) {
  const [language, setLanguage] = useState("en");
  const number = item.owner === "core" ? STAGE_NUMBERS[item.runtimeId ?? ""] : undefined;
  const path = `reference/04-stages/${textField(item.content, "phase")}.md`;
  const view = useFetchView(
    number && language === "ja" ? () => fetchOfficialDocsPage("ja", path) : null,
    [number, language, path],
  );
  const page = view && "value" in view ? view.value : null;
  const section =
    page?.localeServed === "ja" && number ? japaneseStageSection(page.bodyMarkdown, number) : null;
  const original = (
    <Suspense fallback={<p>本文を読み込み中…</p>}>
      <MarkdownEditor
        label="本文・作業方針"
        value={sourceBody(item.content)}
        readOnly={disabled}
        onChange={(body) => onChange({ ...item, content: setSourceBody(item.content, body) })}
      />
    </Suspense>
  );
  return (
    <Tabs className="gap-3" value={language} onValueChange={(value) => setLanguage(String(value))}>
      <TabsList aria-label="ステージ本文の言語">
        <TabsTrigger value="en">英語</TabsTrigger>
        {number ? <TabsTrigger value="ja">日本語</TabsTrigger> : null}
      </TabsList>
      <TabsPanel value="en">{original}</TabsPanel>
      {number ? (
        <TabsPanel value="ja" className="flex flex-col gap-3">
          {section ? (
            <>
              <p className="text-xs text-muted-foreground">
                翻訳は同梱リファレンス（{page?.sourceVersion}）時点の説明です。
              </p>
              {section.startsWith("## Stage ") ? (
                <p className="text-sm">
                  この節は同梱リファレンスでも未翻訳のため、英語で表示しています。
                </p>
              ) : null}
              <Suspense fallback={<p>説明を読み込み中…</p>}>
                <MarkdownEditor value={section} readOnly onChange={() => {}} />
              </Suspense>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenReference?.();
                  const message = {
                    type: "open-official-doc" as const,
                    locale: "ja" as const,
                    path,
                    anchor: slugifyHeading((section.split("\n")[0] ?? "").replace(/^##\s+/, "")),
                  };
                  if (!openOfficialDocInIde(message)) deliverDocsShellDeepLink(message);
                }}
              >
                日本語リファレンスを開く
              </Button>
            </>
          ) : (
            <>
              <p role="status">
                {!view || view.kind === "loading"
                  ? "日本語の説明を読み込み中…"
                  : "日本語の説明を取得できません。英語の原文を表示しています。"}
              </p>
              {original}
            </>
          )}
        </TabsPanel>
      ) : null}
    </Tabs>
  );
}
