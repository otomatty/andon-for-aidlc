# スコープ

## Classic scope（2.11.2）

新規 Classic は 18 / 33 ステージで、Inception から Build and Test までを実行します。Ideation・CI Pipeline・Operation は除外し、既存の記録済みグラフは維持します。深度・テストは Standard、レビューは advisory 1 回、Sensors / Learnings / Plan Approval は on、Skeleton / Summary Confirmation / Collaborators は off、Guard Policy は off です。Inception では各ステージで1回承認します。Construction を Unit ごとに進める場合は、各 Unit のコード計画と、「Review each checkpoint」ではそのチェックポイントを承認し、チームで担当する Unit は自分のゲートを保ちます。従来の 26 ステージは workshop で選べます。

AIDLC ワークフローのスコープの参照ページです（英語スナップショットの日本語訳）。

詳しくはユーザーガイドの [スコープと深度](../guide/05-scopes-and-depth.md) を参照してください。

## Feature scope

Feature スコープは、Initialization から Operation までの全 33 ステージを含み、既定の深度は Standard です。
