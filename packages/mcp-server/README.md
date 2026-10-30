# @andon/mcp-server

AI-DLC ワークスペースを **読取専用** で公開する MCP stdio サーバ。Claude Code が
セッション開始時に spawn し、7つのツールを提供する。内蔵文書の検索は intent 未作成でも利用できる。

書込 API は持たない。`node:fs` の write 系 import は oxlint の
`no-restricted-imports`（`.oxlintrc.json`）で `src` 配下に対して禁止されている（BR-MS-1 / S-MS-1）。
トランスポートは stdio のみで、ネットワーク listen は行わない（S-MS-3）。

## ツール

| ツール                | いつ使うか                                                                  | 入力                                              |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| `aidlc_docs_search`   | AI-DLC の質問に回答する前に関連する節を探す                                 | `query`、任意の `locale` / `limit` / `max_tokens` |
| `aidlc_docs_read`     | 検索した節の原文と引用元を読む                                              | `id`、任意の `cursor` / `mode` / `max_tokens`     |
| `aidlc_status`        | 現在のワークフロー位置（フェーズ / ステージ / ゲート / 進捗）を知りたいとき | なし                                              |
| `aidlc_next_steps`    | 次のステージ名と、そこで人間に求められることを知りたいとき                  | なし                                              |
| `aidlc_read_artifact` | 成果物ファイルの本文を読みたいとき                                          | `path`（記録ディレクトリからの相対）              |

状態・次の一手・成果物の3ツールの応答は日本語テキスト + 構造化 JSON の2ブロック（BR-MS-6）。
ステージの解説や用語は、文書ツール（`aidlc_docs_search` / `aidlc_docs_read`）で同梱ドキュメントの原文を引く。

新しい文書ツールは、本文を重複させない単一の JSON テキストを返す。サーバーの instructions と参照用 Skill が、AI-DLC の質問では検索・原文取得を行い、回答に `source` の文書名・節・バージョン・リンクを表示するよう指示する。詳細は [文書への質問ガイド](../../docs/guides/asking-aidlc.md)。

VSIX は `dist/aidlc-mcp.mjs`、`dist/aidlc-docs.mjs` と `media/official-docs` を同梱する。検索はこの配布先を起点に解決し、利用者の cwd にある `docs/` には依存しない。拡張の Register MCP は両ホストの設定と参照用 Skill を登録する。

### 失敗の伝え方

データ側の失敗（インテント未作成 / 未対応 State Version / ファイル未発見 /
記録ディレクトリ外 / サイズ超過）は **すべて通常応答**で理由を返す。MCP の
`isError` になるのは**入力スキーマ違反のみ**（BR-MS-3）。AI が理由を読んで次の
行動を選べることが、このサーバの設計上の価値。

## `.mcp.json` への登録

プロジェクトルート（`.claude/` と同階層）の `.mcp.json` に、以下を追加する。

```json
{
  "mcpServers": {
    "andon": {
      "command": "bun",
      "args": ["run", "packages/mcp-server/src/index.ts"]
    }
  }
}
```

既に `mcpServers` がある場合は `"andon"` エントリだけを既存オブジェクトに
足す。登録後に Claude Code を再起動すると `/mcp` に `andon` が現れる。

### cwd について

Claude Code は MCP サーバをプロジェクトルートを cwd として spawn する。本サーバは
その cwd を workspaceRoot として `aidlc/spaces/<active-space>/intents/active-intent`
を解決するため、**別のワークスペースを対象にしたい場合は `cwd` を明示する**。

```json
{
  "mcpServers": {
    "andon": {
      "command": "bun",
      "args": ["run", "/abs/path/to/andon-for-aidlc/packages/mcp-server/src/index.ts"],
      "cwd": "/abs/path/to/target-workspace"
    }
  }
}
```

Windows（Git Bash / PowerShell いずれも）では `command` は `bun` のままでよい。
パスは `/` 区切りで書ける。

### 動作確認

```
bun run packages/mcp-server/src/index.ts
```

JSON-RPC を待ち受けたまま常駐すれば起動成功。ワークスペースが未初期化でも
**起動は成功し**、状態取得は「アクティブなインテントがありません」を返す。
文書検索・原文取得はそのまま利用できる。stdout は JSON-RPC 専用チャネルなので、
ログはすべて stderr に出る。

## 制約

- 状態読み取りの対応 State Version は **7 / 8**。それ以外は「解析不可」と明示して返す（C-T3 / NFR-6）。文書検索は状態ファイルに依存しない。
- `read_artifact` はアクティブなインテントの記録ディレクトリ配下のみ。`../` traversal・
  記録外の絶対パス・シンボリックリンク脱出は reader-core の `guardPath` で拒否する
  （サーバ前段 + reader 内部の二重呼出 — BR-MS-2）。
- ワークフロー読み取りはインテントを切り替えれば次の呼出から追従する（R-MS-4）。文書索引はファイル変更時に読み直し、取得する原文は毎回ハッシュを照合する。
