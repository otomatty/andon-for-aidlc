# 2.8.0から2.8.1へ更新する例

[Tips一覧へ](./aidlc-workflows-tips.md)

対象: 2.8.0から2.8.1への更新・Claude Code。内容確認: 2026年9月29日。

ここは **2.8.1を明示的に選ぶ場合の例** です。現在のAndonが導入対象にしている版とは別なので、拡張機能の更新画面では表示される対象版を確認してください。

## 導入方式を確認して更新する

ネイティブCLIでは、マシンのAI-DLC本体を更新します。

```bash
aidlc update --version 2.8.1
```

プロジェクトが旧版に固定されている場合は、対象プロジェクトで固定先とClaude Code向けの設定を更新します。

```bash
aidlc config --pin 2.8.1
aidlc config --harness claude
aidlc doctor
```

本体の更新とプロジェクトの固定先の更新は別です。進行中・park中のワークフローなどを理由に設定処理が拒否された場合は、表示された条件を解消してから再実行します。状態ファイルを消して制約を回避しないでください。

ネイティブCLIを使わず配布物をコピーした構成では、同じコマンドでそのコピーまで更新されるとは限りません。導入方式を先に確認します。再起動後、チャットでも `/aidlc --version` と `/aidlc --doctor` を確認してください。

## 根拠

[2.8.1のリリース](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.8.1)、[拡張機能での更新と修復](./updating-workflows.md)。

## 関連記事

- [Claude Codeのhooksを修復する](./aidlc-tip-hooks.md)
