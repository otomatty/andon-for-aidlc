import type { CustomizationItem } from "@andon/shared-types";
import { Suspense, useState } from "react";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownEditor } from "./lazy-markdown-editor";
import { japaneseScopeDescription } from "@/features/customization/utils/scope-description";
import { setSourceBody, sourceBody } from "@/features/customization/utils/source-fields";

export function ScopeDescription({
  item,
  disabled,
  onChange,
}: {
  item: CustomizationItem;
  disabled: boolean;
  onChange: (item: CustomizationItem) => void;
}) {
  const translation = japaneseScopeDescription(item);
  const [language, setLanguage] = useState("ja");
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
  if (!translation)
    return (
      <>
        {item.owner === "core" ? (
          <p className="text-sm text-muted-foreground">
            この本文に対応する日本語の説明がないため、原文を表示しています。
          </p>
        ) : null}
        {original}
      </>
    );
  return (
    <Tabs value={language} onValueChange={(value) => setLanguage(String(value))} className="gap-3">
      <TabsList aria-label="スコープ本文の言語">
        <TabsTrigger value="ja">日本語</TabsTrigger>
        <TabsTrigger value="en">英語</TabsTrigger>
      </TabsList>
      <TabsPanel value="ja">
        <Suspense fallback={<p>説明を読み込み中…</p>}>
          <MarkdownEditor value={translation} readOnly onChange={() => {}} />
        </Suspense>
      </TabsPanel>
      <TabsPanel value="en">{original}</TabsPanel>
    </Tabs>
  );
}
