# Andonの紹介資料

社内のConfluenceやチーム向け案内に使う本文と、拡張のオンボーディング用文案です。

| ファイル                                                     | 用途                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [andon-introduction.md](./andon-introduction.md) | 社内向けの紹介本文。実画面7枚、機能説明、導入手順、最初に試す操作を掲載 |
| [onboarding-content.md](./onboarding-content.md)             | 「はじめに」ページの文案・画像の使い方・表示条件。拡張に実装済み        |
| [images/](./images/)                                         | 本文とオンボーディングで共用する実画面のWebP                            |

## Confluenceへの掲載

1. `andon-introduction.md` を掲載用の本文として使います。Markdownを取り込める社内ツールがある場合は、その方法で取り込みます。通常のエディターを使う場合は、Markdownのプレビューから本文をコピーし、見出し・表・箇条書きの整形を確認してください。
2. `images/` の7枚を掲載先ページに添付し、本文の図1〜図7の位置に挿入します。ローカルの相対パス `./images/...` は、本文を貼り付けるだけではConfluenceの添付画像にはなりません。画像は拡張に同梱するため、軽いWebPにしています。掲載先でWebPを表示できない場合は、PNGに変換して添付してください。
3. 図の説明文を画像の直下に残し、拡大して文字を読めることを確認します。代替テキストにはMarkdownの画像説明を使えます。
4. 社内のVSIX配布先や問い合わせ先が決まっていれば、導入手順の直前または末尾に追記します。
5. 掲載日を実際に公開する日付に合わせ、本文のリンクと画像をプレビューで確認します。

Confluence Cloudでは画像をページへドラッグ＆ドロップするか、画像・ファイルの挿入から追加できます。詳細は[Atlassianの画像挿入ガイド](https://support.atlassian.com/confluence-cloud/docs/display-files-and-images/)を参照してください。Data Centerや社内拡張を利用する環境では、その環境の挿入方法を使ってください。

この資料の作成時点では、Confluenceへの投稿や添付ファイルのアップロードは行っていません。

## 短い紹介文

> Andonは、AI-DLCの現在地・成果物・進め方をVS Code / Cursor内で確認できる拡張機能です。工程ごとの確認事項を読み、AIが作った文書を開き、内蔵ドキュメントで手順を調べられます。チーム向けの設定や、案件ごとの実行記録の振り返りにも利用できます。まずは一つの案件で、現在地と成果物を確認してみてください。

## 撮影記録

- 撮影日：2026年10月30日
- 実行環境：Linux 上の Chromium（Playwright）。
- 画面の大きさ：幅 960×高さ 600、拡大率 1.6（画像は 1536×960）。
- 表示方法：Dashboard を VS Code / Cursor の拡張の中と同じ表示にしています。
  - 拡張の webview と同じやり取りを、このリポジトリに向けて起動した `api-core` へ中継します。
  - これで、拡張の中だけで出る表示（成果物のプレビュー、「エディタで編集」、プラグインの導入ボタンなど）が出ます。
  - 配色は、VS Code 標準の Light Modern テーマの値を `--vscode-*` 変数に設定しています。
  - 文字は Inter と Noto Sans JP、等幅は JetBrains Mono を `--vscode-font-family`・`--vscode-editor-font-family` に設定しています（撮影環境の Linux に VS Code の既定フォントがないため）。
- 表示対象：Andon自身の開発案件 `260720-aidlc-guide-prd` と同一スペースの記録。
- バージョン確認：撮影した環境には aidlc のエンジンがないため、撮影用のサーバーでは確認を外しています。
- プラグインの状態：拡張が送る状態は、`packages/vscode-extension/src/plugins-state.ts` の `pluginPrerequisites` で「Claude Code だけで AI-DLC を使い、focus は未導入」の場合を作っています。
- セットアップ：`packages/vscode-extension/src/setup-html.ts` の `setupHtml` で「既存プロジェクトに参加し、このマシンにはまだ CLI がない」場合を描画しています。
- 画像：スクリーンショットの PNG を可逆圧縮の WebP に変換。画面の合成・文字の差し替えはしていません。
- 操作：閲覧のみ。質問の送信、設定の編集、インストール・更新、プラグインの導入、ワークフローの承認は行っていません。

| 図  | 画像                    | 撮影した操作・状態                                                        |
| --- | ----------------------- | ------------------------------------------------------------------------- |
| 1   | `01-workflow.webp`      | ステージ一覧で Ideation を開く。完了案件を表示                            |
| 2   | `02-stage-guide.webp`   | ステージ一覧 → `intent-capture`。目的・入力・出力を表示                   |
| 3   | `02b-artifact.webp`     | 同工程の出力 `intent-statement` を開き、プレビューまでスクロール          |
| 4   | `03-documents.webp`     | 右上メニュー → ドキュメント。トップページ                                 |
| 5   | `04-customization.webp` | 右上メニュー → カスタマイズ。対応エンジンが必要という案内を含む           |
| 6   | `05-effectiveness.webp` | 右上メニュー → 効果測定。同一スペースの6案件のうち、State Version 8 の3案件を集計 |
| 7   | `06-setup.webp`         | `Andon: Setup`。既存プロジェクトへの参加画面で「詳しく見る」を開く |

`07-plugins.webp` は「はじめに」の「プラグイン」だけで使います。右上メニュー → プラグイン → focus の詳細を開き、導入状態と「何が変わるか」を表示しています。

撮り直したときは同じファイル名で置き換え、この記録と `packages/dashboard/src/features/onboarding/content/welcome.ts` の撮影日 `CAPTURED_ON`・`note` を直してください。

本文は、撮影画面と `packages/dashboard/src/shell/Header.tsx`、`packages/vscode-extension/src/setup-html.ts`、`docs/guides/customization.md`、`docs/guides/effectiveness.md`、`docs/guides/asking-aidlc.md` を照合しています。

## 画像を更新するとき

同じファイル名で差し替えると本文とオンボーディング文案の参照を維持できます。新しい画像のラベルと説明文が一致するか確認し、掲載日・表示データの注記も更新してください。

撮影には紹介可能な案件を使い、チャット本文・認証情報・無関係なプロジェクトを写さないようにします。画像に数値を載せる場合は、実行記録の例なのか、比較条件をそろえて評価した結果なのかを明記します。
