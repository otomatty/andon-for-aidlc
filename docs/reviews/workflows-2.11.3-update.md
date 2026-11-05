# aidlc-workflows 2.11.3 更新記録

対象は[公式リリース v2.11.3](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.11.3)（2026-11-04）、タグが指すコミット `a8721be3631e6a254cf524ea57e5932aa56b4149`。比較元は manifest の公式 v2.11.2 `10a9bc9d85395a601de2624cf5bdd35292c10db4`。差分は 96 コミット・418 ファイル。文書の差分は[同期差分](official-docs-diff-2.11.3.md)を参照。

毎日の同期ジョブ（aidlc-workflows-update、実行 41959729009、2026-11-05）は文書とシェルを用意したが、3 OS とも Doctor の検査で止まった。診断の依存ソースが 65 ファイル変わり、未訳の表示が 1 件あった（`Hooks DISABLED via "disableAllHooks": true in ... - AI-DLC cannot run ...`。長いダッシュが ` - ` になった）。PR は作っていない。今回は公式タグの独立 checkout から配布物を生成し（`bun install --frozen-lockfile --ignore-scripts`、`bun scripts/package.ts claude|cursor`）、手元で同期した。

## 変更内容と互換性

- State Version **8**・基本 **33 ステージ**・**14 エージェント**は維持。版を揃える前の `check-workflows-drift` は blocking 0、findings 5（導入先・Doctor 対応版・AGENTS・README・版表記）。
- 英語文書・Claude / Cursor シェル・manifest・README・AGENTS・bridge・agent map・`WORKFLOWS_TARGET_VERSION`・`.aidlc-version` を 2.11.3 に揃えた。シェル同期は 285 ファイルを書き（Claude 142、Cursor 143）、削除は 0、維持は 14。新しいエンジンファイルは `aidlc-record-core.ts`（`aidlc-lib.ts` から約 2,400 行を移した）、`aidlc-git.ts`、`aidlc-questions.ts`、`aidlc-native-launcher.ts`、`aidlc-swarm-source.ts`、`aidlc-unit-landing.ts`、`aidlc-sensor-record.ts`、`aidlc-kiro-chat-record.ts`、`hooks/system-install.ts`。
- シェルのローカルパッチ: audit の Windows 追記修正（O_APPEND の位置指定）は 2.11.3 でも未修正のため、`.claude/tools/aidlc-audit.ts` と `.cursor/tools/aidlc-audit.ts` へ再適用した。Cursor adapter の PR #43 パッチ（進行中の作業がないときはガードを走らせない）も再適用した。2.11.3 の adapter の変更（`shellActiveText`、括弧などを含むリポジトリ名への拒否を狭めたこと）は、パッチの位置と重ならない。`scripts/workflows-shell-overrides.json` のハッシュを更新。
- 実装に使ったエージェント（Cursor CLI）は、このリポジトリ自身の AI-DLC の Cursor フックを起動する。adapter のパッチを戻す前は、state-transition ガードが導入済みの強制ファイルへの編集を拒否した。そのため、パッチを当てた 3 ファイルは、記録済みのパッチを `patch` で適用して作った（オフセットのみで、全ハンクが当たった）。Cursor の session-start フックは `AGENTS.md` の管理ブロックも書き換えた。書き換えたブロックは残した。公式 2.11.3 と一致し、文言は「wait for the person ... no resume menu」である。同じフックが `.gitignore` の AI-DLC ブロックに足した Cursor 専用の行は戻した。Claude 側のブロックは公式と同じである。`.mcp.json` は変更なし（Andon 自身のサーバー項目だけ）。
- `packageManager` を `bun@1.4.4` に上げ、上流の CI と揃えた。この引き上げでは lockfile は変わっていない。Bun 1.4.4 は CVE-2026-111497（Brotli デコーダ。実際に悪用されている）を修正する。
- bridge-map の説明: Approval & Handoff と Feedback & Optimization のゲートは Approve / Request Changes だけを出す。Code Generation は、計画の手順に印を付けても計画の承認を聞き直さず、ATDD の Acceptance Red は失敗した出力を記録する。Build and Test は、頼まれていないシステムパッケージの導入を、実行の前に確認する。
- **reader**（reader-core。上流 2.11.3 と宣言ごとに比較した。対象は aidlc-lib / record-core、audit、orchestrate、construction-checkpoints、jump、guard-switch、version、channel、session-start、plan-approval-ask、log、usage、install-paths、runtime-paths、recorded-switches）:
  - F1（修正）: チームの Unit をクレームしたチェックアウトは、監査ログ全体を `<record>/.aidlc-engine/audit/<shard>.md` に書き、一部の行だけを追跡対象の `audit/<shard>.md` へ写す。Andon は両方を読み、両方にある行は一度だけ読む（上流の `copiedAuditBlocks` と同じ規則）。ローカルのフォルダーも監視する。
  - F2（変更なし。判断による）: 2.11.3 は、ゲートのセンサー実行が判定を返さないとき、`SENSOR_FIRED` の後に `SENSOR_COULD_NOT_RUN` を記録する。Andon はその発火を証跡不足として数える。意味は一致する。
  - 変更は要らない。新しい監査イベント（`QUESTION_ASKED`、`QUESTION_SHOWN`、`SYSTEM_INSTALL_BLOCKED`、`SYSTEM_INSTALL_ALLOWED`、`MAIN_CHECKOUT_CHANGE_ALLOWED`）は汎用の解析で読める。再開の行には `Gate Scope` と `Attempt Generation` が加わる。`Stages to Execute` の行は、新しい `2.3 (requirements-analysis)` の形を取る。Andon はその欄を読まない。状態ファイルのステージ行は長いダッシュのままである。Claude desktop の worktree フックも、変更は要らない。
  - 変わっていないことを確認した。ソース指紋の計算と除外（「git で無視した未追跡ファイル」の規則が当たるのは `aidlc-swarm-source.ts` の swarm 一覧の比較であり、指紋の走査には当たらない）、CRLF の扱い、`.aidlc-source-paths.json`、`source-checkouts.json`、Guard Policy の解決、State の項目と ceremony の行、Unit DAG の解析と unit の種類、ゲートの計算、レビュー記録の JSON と判定の語彙（`aidlc-review-records.ts` は変更なし）、`intents.json` / active intent / spaces、channel・設定・usage・pins、ステージの frontmatter と scope ファイル、質問ファイルと plan-approval の選択肢。

### 上流と一致させていない点

- 承認後に成果物が補正された場合（`STAGE_OUTPUT_AMENDED`）、上流は新しい受領で承認を保つが、Andon の strict のレビュー判定は現在の成果物とレビュー時の指紋を比べるため表示しない。
- 変更なしで指摘を却下して同じレビューのゲートに戻る場合（再入行の `Review Kept`）、上流はレビューを保つが、Andon は従来どおり差し戻しで判定を消す。
- 競合マーカーを含む `intents.json` は、2.11.2 までと同じく判定を保留する。
- 上流の `copiedAuditBlocks` のうち、同期ツールが写した shard の競合コピーをまとめる部分は再現していない。

## Doctor

毎日の同期が止まった未訳は、フックを無効にした表示である。文言は `Hooks DISABLED via "disableAllHooks": true in ... - AI-DLC cannot run ...` で、長いダッシュは ` - ` になっている。

新しい診断の日本語訳を追加した（フックを無効にした表示の両方の形、Kiro CLI の設定が `kiro-cli --v3` を名指しする表示、`kiro-cli --v2 --agent aidlc` による Kiro CLI の初回チャットの対処、2.11.2 と 2.11.3 の Kiro IDE の初回チャットの対処、`Kiro ignore sources:` の接頭辞、opencode 1.18.29 の導入の対処）。既存の訳は残した。

翻訳キーとパターン 442 件を、2.11.2 と 2.11.3 のソースに対して古いアンカーで走査した。上流の文言が変わっていたのは 3 件で、いずれも訳で覆っている。

契約として `core/tools` 115 ファイルのソース指紋を登録した（2.11.2 から 57 ファイルが変化し、8 ファイルが新規）。[CI 実行 42033219711](https://github.com/otomatty/andon-for-aidlc/actions/runs/42033219711)（doctor-record）で 3 OS × 9 ケース、計 27 ケースを採取・検査・登録した（`951760c`）。採取の脚が登録前に出した失敗は「recorded capture missing」だけで、設計どおりである。`check:workflows-compatibility` と Doctor の証拠テストは成功した。

## 文書

- 英語は 45 ページを更新し、新規 1 ページ（`overview/releases/2.11.3.md`）を追加した。同期が「削除」と報告したリポジトリ所有の 3 ページ（`guide/getting-started.md`、`overview/release-highlights.md`、`reference/scopes.md`）は、これまでのリリースと同じである。
- 日本語は、2.11.3 で英語が変わった全ページを差分と照合して更新した（7 回に分けた）。日本語の更新履歴 `overview/ja/releases/2.11.3.md`、改善点ガイド（英語・日本語）、リポジトリ所有の getting-started と scopes（英語・日本語）の版表記、what's-new の項目 `workflows-2-11-3` を加えた。
- 各ページで、見出しの段ごとの数・表の行数・コードフェンス数・コードブロックの中身を英語と照合した。
- `official-docs.translations.json`（人間の翻訳承認）は変更していない。

## 検証

- `VITEST_MAX_WORKERS=4 bun run check`: lint・整形・型（ルート・dashboard・vscode-extension）・文書索引・plugins・プラグインカタログ・互換性（ピンした版のメタデータと Doctor の証拠が一致）・coverage（277 ファイル・4,996 件成功・1 件 skip。文 90.74%、分岐 85.39%、関数 91.39%、行 92.96%）・監査 shard・`bun audit`（651 パッケージを検査し、脆弱性なし）まで成功。
- 最初の全体 check が失敗したのは `bun audit` である。GHSA-g3hv-75wg-m249（minimatch 7.0.0 以上 11.0.1 未満、moderate）が `@vscode/vsce > minimatch@10.2.6` 経由で出た。vsce 4.1.0（最新）は `^10.2.6` を要求する。ルートの `overrides` に `"minimatch": "^11.0.4"` を足して直した（lockfile は minimatch 11.0.4 と `@isaacs/nonrecursive-glob-match` 1.0.3）。override の前後で作った VSIX は 712 ファイルで、中身は同じである。
- 更新後の `check-workflows-drift --upstream`（公式 v2.11.3 の checkout）は findings 0、blocking 0。`check-bundled-shells` は「bundled shells match the official source, including the reviewed Cursor override」。
- reader-core と api-core のテストは 64 ファイル・1,446 件成功。変更したファイルのカバレッジは、audit/local-record.ts の分岐が 100%、audit/events.ts が 98.25%、effectiveness/read.ts が 93.75%、tree/review-records.ts が 85.71%、watch/watcher.ts が 90.48%。残る未カバーの分岐は、以前からの経路である。
- Doctor の翻訳・出力・対処と Cursor adapter のテストは 144 件成功。採取物を登録したあと、Doctor の証拠テスト（`scripts/doctor-candidate`、`scripts/doctor-evidence`）は 39 件成功。
- 見出し・表の行・コードフェンス・コードブロックの中身を 2.11.3 の英語と照合した。2.11.2 の時点から新たに違ったのは、リポジトリ所有の `overview/ja/release-highlights.md` である（日本語の要約は表を使い、2.11.3 の節で 13 行増えた）。英語が変わった箇所では、2.11.2 の時点で日本語が訳していたコードブロック（図）も更新した（guide の 04-phases-and-stages の 6、08-knowledge の 2、reference の図の 5）。アンカー検査の未解決は、作業前の 84 件から 85 件になった。増えた 1 件は、英語ページと同じ相対リンク（`../guide/18-install-and-lifecycle.md#automation`）で、アンカーはある。
- 成果物 map: 成果物 125、英語 125 / 日本語 125 が説明済み、表の行順 71/71 一致。日本語のステージページの更新では変わっていない。
- `bun run package:extension`: 成功（712 ファイル、10.55 MB）。2.11.3 の更新履歴（日英）と日本語 112 ページを含み、`aidlc/` の実行状態、`.env`、ローカル設定を含まないことを確認。

VS Code／Cursor の実拡張ホストでの操作（バージョン確認画面、更新後のプロジェクト更新）は未検証。
