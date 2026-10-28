/**
 * はじめに copy. It follows docs/introducing/onboarding-content.md, and the
 * screenshots are the same real captures the introduction document uses, so
 * replacing a file under docs/introducing/images updates both.
 */
import workflowImage from "../../../../../../docs/introducing/images/01-workflow.jpg";
import stageImage from "../../../../../../docs/introducing/images/02-stage-guide.jpg";
import artifactImage from "../../../../../../docs/introducing/images/02b-artifact.jpg";
import documentsImage from "../../../../../../docs/introducing/images/03-documents.jpg";
import customizationImage from "../../../../../../docs/introducing/images/04-customization.jpg";
import effectivenessImage from "../../../../../../docs/introducing/images/05-effectiveness.jpg";
import pluginsImage from "../../../../../../docs/introducing/images/07-plugins.jpg";

export interface WelcomeShot {
  id: string;
  src: string;
  title: string;
  /** 見る場所 — where on the screen. */
  where: string;
  /** できること — what the reader can do there. */
  what: string;
  alt: string;
  /** Said under the image when the capture could be mistaken for live data. */
  note?: string;
}

export interface WelcomeFeature extends WelcomeShot {
  target: "docs" | "plugins" | "customization" | "effectiveness";
  summary: string;
  open: string;
}

/** Captures are 1536×960; the attributes reserve the space before they load. */
export const SHOT_WIDTH = 1536;
export const SHOT_HEIGHT = 960;

export const CAPTURED_ON = "2026年9月18日";

export const BASICS: readonly WelcomeShot[] = [
  {
    id: "workflow",
    src: workflowImage,
    title: "今どこまで進んだか、ひと目で確認",
    where:
      "左上の Space で作業スペース、その隣で案件を選ぶと、現在のステージと工程ごとの状態が並びます。",
    what: "現在のステージを開くと、フェーズや完了数、残り時間も確認できます。",
    alt: "現在のステージと、工程ごとの状態を並べたステージ一覧の画面",
    note: "完了した案件の表示例です。あなたのプロジェクトの状態ではありません。画像は Space 切り替え追加前の画面です。",
  },
  {
    id: "stage",
    src: stageImage,
    title: "次に何を確認するかがわかる",
    where: "工程を選ぶと、目的・入力・出力・担当エージェント・ゲート要求を読めます。",
    what: "「ゲート要求」を確認してから成果物を読み、AI-DLCのチャットで承認や修正の依頼を伝えます。",
    alt: "工程の目的、出力、ゲート要求を表示したステージ詳細の画面",
  },
  {
    id: "artifact",
    src: artifactImage,
    title: "AIが作った文書を、その場で読む",
    where: "工程の出力から、設計書や質問事項などの本文を開けます。",
    what: "編集したい場合は「エディタで編集」からファイルへ移動できます。",
    alt: "工程の成果物の本文をプレビューした画面",
  },
];

export const MORE: readonly WelcomeFeature[] = [
  {
    id: "documents",
    target: "docs",
    src: documentsImage,
    title: "ドキュメント",
    summary:
      "進め方や用語、AI-DLCの運用Tipsを調べられます。対応するAIツールで、文書について質問することもできます。",
    where: "右上のメニューの「ドキュメント」から開きます。",
    what: "「ページを探す」でページ名から探せます。初めてなら「はじめて読むなら」を上から順に読み、目的別のカードからページを直接開けます。見つからないときは、下の質問欄で内蔵の文書をもとにAIへ質問できます。",
    alt: "質問欄と、ワークフロー・拡張機能のドキュメントへの入口を並べたドキュメント画面",
    open: "ドキュメントを開く",
  },
  {
    id: "plugins",
    target: "plugins",
    src: pluginsImage,
    title: "プラグイン",
    summary:
      "Jira のチケットからテストを先に書いて実装まで進めるなど、目的に合った進め方を追加できます。",
    where: "右上のメニューの「プラグイン」から開きます。",
    what: "導入前に、必要な準備と、変わるステージ・成果物の図の例を確認できます。導入したプラグインは無効にすることもできます。",
    alt: "focus プラグインで変わるステージの一覧と、成果物の図の見本を表示したプラグイン画面",
    note: "画像は2026年10月15日にブラウザで表示した画面です（ほかの画像は Cursor で撮影）。導入ボタンは VS Code / Cursor の拡張の中でだけ表示します。",
    open: "プラグインを開く",
  },
  {
    id: "customization",
    target: "customization",
    src: customizationImage,
    title: "カスタマイズ",
    summary:
      "チームのルールや、実行する工程の構成を確認できます。設定の保存には対応するAI-DLC本体が必要です。",
    where: "右上のメニューの「カスタマイズ」から開きます。",
    what: "開発ルール・ナレッジ・工程・エージェント・品質チェックをフォームで編集できます。",
    alt: "スコープやステージなどの設定カテゴリを並べたカスタマイズ画面",
    open: "カスタマイズを開く",
  },
  {
    id: "effectiveness",
    target: "effectiveness",
    src: effectivenessImage,
    title: "効果測定",
    summary: "案件ごとの時間・承認待ち・差し戻し・品質チェックを比較できます。",
    where: "右上のメニューの「効果測定」から開きます。",
    what: "時間は記録からの推定で、人の実作業時間ではありません。比較の前提はガイドで確認できます。",
    alt: "完了までの時間・承認待ち・差し戻し・品質チェックを集計した効果測定画面",
    open: "効果測定を開く",
  },
];
