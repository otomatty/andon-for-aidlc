import { ArrowRight, BookOpen, PanelsTopLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { type DocsCategory, WORKFLOW_TIPS_INDEX } from "@/features/docs/utils/docs-navigation.ts";

const CATEGORIES = [
  {
    id: "workflow",
    title: "ワークフロー",
    description: "aidlc-workflows の公式ドキュメント、更新履歴、運用Tips",
    icon: BookOpen,
    topics: [
      "AI-DLC の概要とユーザーガイド",
      "ハーネスの設定・カスタマイズ",
      "開発者リファレンス・RFC",
      "更新のハイライト・バージョンごとの変更点",
      "hooks・進行の調整・UnitとBoltの運用Tips",
    ],
    action: "ワークフローのドキュメントを探す",
  },
  {
    id: "extension",
    title: "拡張機能",
    description: "AIDLC Guide の導入と日々の操作",
    icon: PanelsTopLeft,
    topics: [
      "インストールと初期設定",
      "Dashboard・成果物の読み方",
      "ドキュメントの設定とチーム共有",
    ],
    action: "拡張機能のドキュメントを探す",
  },
] as const;

export function DocsHome({
  onOpenCategory,
  onOpenGuide,
  questionPanel,
}: {
  onOpenCategory: (category: DocsCategory) => void;
  onOpenGuide: (name: string) => void;
  questionPanel?: ReactNode;
}): ReactNode {
  return (
    <section
      className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
      aria-labelledby="docs-home-title"
      data-testid="docs-home"
    >
      <header className="flex max-w-2xl flex-col gap-3">
        <h1 id="docs-home-title" className="text-page-title font-bold">
          ドキュメント
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          aidlc-workflows の公式情報や運用Tips、AIDLC Guide 拡張機能の使い方をまとめています。
          調べたい内容に合わせて、ドキュメントを選んでください。
        </p>
      </header>

      {questionPanel}
      <div className="grid gap-4 md:grid-cols-2">
        {CATEGORIES.map(({ id, title, description, icon: Icon, topics, action }) => (
          <Card key={id} size="lg">
            <CardHeader className="gap-3">
              <CardTitle className="flex items-center gap-3">
                <IconTile>
                  <Icon />
                </IconTile>
                <h2>{title}</h2>
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="flex list-disc flex-col gap-2 pl-4 text-sm leading-relaxed text-muted-foreground">
                {topics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" onClick={() => onOpenCategory(id)}>
                {action}
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      <section className="flex flex-col items-start gap-3" aria-labelledby="docs-tips-title">
        <h2 id="docs-tips-title" className="text-section-title font-bold">
          aidlc-workflows Tips
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          project.mdの読み込み、composeの調整、hooksの復旧、Boltの進め方を記事ごとに読めます。
          一覧から調べたいテーマを選んでください。
        </p>
        <Button variant="outline" onClick={() => onOpenGuide(WORKFLOW_TIPS_INDEX)}>
          Tips一覧を開く
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      </section>
    </section>
  );
}
