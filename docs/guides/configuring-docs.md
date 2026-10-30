# 設定ファイルでプロジェクトリンクを足す

> 対象: 右上のメニューにチームの wiki や設計書へのリンクを並べたい人  
> 関連: [Dashboard で現在地と成果物を読む](./reading-workflow.md)

## このガイドでできるようになること

`andon.config.json` に、右上のメニューの「プロジェクトリンク」へ出すリンクを書く。

ステージ詳細の **Open in Docs** は、常に同梱の公式ドキュメントを開きます。開き先を Confluence などへ差し替える設定（`stageDocs` / `docsBaseUrl`）は 2026-10 に廃止しました。古い設定ファイルに残っていても無視され、警告も出ません。

## 設定ファイル

ワークスペースルートの [`andon.config.json`](../../andon.config.json)。

| キー           | 用途                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| `docsRepoPath` | excerpt（docs 抜粋）を読むルート。相対パスは **config ファイルの場所** 基準 |
| `projectLinks` | 右上のメニューに出す追加リンク `{ "label", "target" }[]`                    |

config はプロセス起動時に一度読まれます。変更後は拡張を Reload してください。

## 例

```json
{
  "docsRepoPath": ".",
  "projectLinks": [
    { "label": "チーム wiki", "target": "https://confluence.example.com/wiki/spaces/AIDLC/overview" },
    { "label": "PRD", "target": "docs/prd/PRD.md" }
  ]
}
```

`target` は `http(s)://…` の URL か、ワークスペースからの相対パスです。`javascript:` や `file:` などほかの形式はリンクになりません。

## 確認手順

1. config を保存する
2. IDE で Reload Window を実行する
3. 右上のメニューを開き、「プロジェクトリンク」に項目が並ぶことを確かめる

## うまくいかないとき

| 症状               | 確認すること                                                      |
| ------------------ | ----------------------------------------------------------------- |
| リンクが出ない     | `label` と `target` がどちらも文字列か。`target` の形式は正しいか |
| 古いリンクのまま   | Reload したか。別ワークスペースの config を見ていないか           |
| excerpt だけ出ない | `docsRepoPath` がディレクトリとして存在するか                     |
