import type { CustomizationKind } from "@andon/shared-types";

/** Kept apart from the source-field editors so the chat can name kinds without their parsers. */
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
