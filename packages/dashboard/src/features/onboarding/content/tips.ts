import type { OnboardingArea } from "@aidlc-guide/shared-types";

/**
 * One short tip per screen, shown on the first visit until closed. Each links
 * to the extension guide that explains the screen in full (docs/guides).
 */
export const AREA_TIPS: Record<OnboardingArea, { text: string; guide?: string }> = {
  home: {
    text: "左上の Space で作業スペース、その隣で表示する案件を選べます。「はじめに」と「更新情報」は、右上のメニューからいつでも開けます。",
  },
  stage: {
    text: "工程の目的・成果物・ゲート要求を確認できます。承認や修正の依頼は、AI-DLCを進めているチャットで伝えてください。",
    guide: "reading-workflow.md",
  },
  docs: {
    text: "「ページを探す」でページ名から探すか、「はじめて読むなら」を上から順に読めます。目的別のカードからページを直接開けます。見つからないときは「AIに質問する」から、チャット画面で内蔵の文書をもとにAIへ質問できます。",
    guide: "asking-aidlc.md",
  },
  customization: {
    text: "開発ルール・ナレッジ・工程・エージェント・品質チェックを、フォームで編集すると自動保存します。保存には、カスタマイズに対応したAI-DLC本体が必要です。",
    guide: "customization.md",
  },
  effectiveness: {
    text: "案件ごとに、完了までの時間・承認待ち・差し戻し・品質チェックを比較できます。時間は記録からの推定で、人の実作業時間ではありません。",
    guide: "effectiveness.md",
  },
};
