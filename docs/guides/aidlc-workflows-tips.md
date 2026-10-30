# aidlc-workflows Tips一覧

Claude CodeでAI-DLCを進めるときの疑問を、テーマごとの記事にまとめました。Andon独自の運用ガイドです。各記事に対象バージョン・確認日・根拠を記載しています。

2.8.1・2.10.0・2.11.0・2.11.1では承認や実行順序が異なる場合があります。チャットの `/aidlc --version` と `/aidlc --status` で、対象プロジェクトのバージョンとアクティブなintentを確認してから、該当する記事を読んでください。

## 調べたいことから探す

- [ルール・進行](#ルール進行)
- [hooks・環境設定](#hooks環境設定)
- [更新](#更新)
- [Unit・Bolt](#unitbolt)

## ルール・進行

### project.mdはいつ読み込まれる？

会話とステージ指示への読み込み、編集先、実行中の変更を確認します。

[「project.mdはいつ読み込まれる？」を読む](./aidlc-tip-project-rules.md)

### ステージが完了せず進まない

停止の原因を調べ、復旧やステージ移動の手順を確認します。

[「ステージが完了せず進まない」を読む](./aidlc-tip-stage-recovery.md)

### composeで省略された非機能要件を含めたい

非機能要件を計画に追加する依頼と、進行中の再構成の制約を確認します。

[「composeで省略された非機能要件を含めたい」を読む](./aidlc-tip-compose-nfr.md)

## hooks・環境設定

### Claude Codeのhooksを修復する

hooksの登録、設定、PATH、組織ポリシーを順に確認します。

[「Claude Codeのhooksを修復する」を読む](./aidlc-tip-hooks.md)

### AIDLC_SKIP_HUMAN_PRESENCE_GUARDとは？

一時回避の意味、起動方法、通常の検証へ戻す手順を確認します。

[「AIDLC_SKIP_HUMAN_PRESENCE_GUARDとは？」を読む](./aidlc-tip-human-presence-guard.md)

### /clear後も環境変数は残る？

環境変数を設定した場所による保持範囲と、解除方法を確認します。

[「/clear後も環境変数は残る？」を読む](./aidlc-tip-environment-clear.md)

## 更新

### 2.8.0から2.8.1へ更新する例

ネイティブCLI本体と、プロジェクトの固定バージョンを更新します。

[「2.8.0から2.8.1へ更新する例」を読む](./aidlc-tip-update-2-8-1.md)

## Unit・Bolt

### solo・Unit・Boltの関係

担当方式、作業単位、提供単位と、1 Unit＝1 Boltの作業を整理します。

[「solo・Unit・Boltの関係」を読む](./aidlc-tip-solo-unit-bolt.md)

### 5 Boltのstage-majorとunit-major

5 Boltの進み方を図解し、実行順序と承認位置の違いを確認します。

[「5 Boltのstage-majorとunit-major」を読む](./aidlc-tip-construction-order.md)

### 進行中にunit-majorからstage-majorへ変更する

進行中の実行順序の変更方法と、完了済みUnitの扱い、バージョンごとの違いを説明します。

[「進行中にunit-majorからstage-majorへ変更する」を読む](./aidlc-tip-switch-iteration.md)
