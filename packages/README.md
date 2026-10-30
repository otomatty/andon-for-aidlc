# packages/ — 構造規約（置き場マップ）

このワークスペースのコーディング規約のうち、「どこに書くか」を定める部分。
lint は oxlint（`.oxlintrc.json`）、format は oxfmt（`.oxfmtrc.json`）、テスト・カバレッジ床は
`vitest.config.ts`、チーム実践は `aidlc/spaces/default/memory/` が正とする。
ここに書くのは**単一定義の置き場**だけ — 同じ知識を2箇所に書きそうになったら、
この表の置き場へ移してから参照する。

## パッケージと依存方向

```text
shared-types ← core-utils ← reader-core ← api-core ← dashboard-server / vscode-extension / mcp-server
                    ↑            ↑            ↑
                docs-bridge ─────┘       dashboard (wire 越しにのみ接続; reader-core を import しない)
```

- **shared-types** — wire 契約: 型 + 依存ゼロの wire 定数・純粋プレゼンタ
  （`CURRENT_STATE_VERSION` / `CONSTRUCTION_DIRNAME` / `artifactPath` /
  `formatDuration` / `CURRENT_ATTEMPT_STATUSES` / `timingsMatchStage` /
  `currentStageView` / `stageViewMatches` / `StandardReason` /
  `slugifyHeading` / `normalizeAnchor`）。全サーフェスが
  バイト単位で一致すべき値はここ以外に書かない。
  アンカー slug は deep link を**書く**側（docs-bridge / official-docs）と
  **照合する**側（dashboard の Shell）が同一結果を出す必要があるため、
  各サーフェスにコピーを置かず必ずここから import する。
  状態ファイルと監査ログの照合結果は `StageView` 1型に集約する（issue #9）—
  サーフェスは鮮度を見るだけで、「どの区間が今の試行か」を再導出しない。
  鮮度判定は `TimingsPayload.currentStage`（ペイロード自身のスナップショット）
  と手元の workflow 読み取りの比較1点に集約する（issue #10）— dashboard は
  `store/select-timing.ts` で一度だけ適用し、store を持たない VS Code status bar
  が `currentStageView` を直接呼ぶ。行単位の鮮度だけが `stageViewMatches`。
- **core-utils** — 読み取り境界プリミティブ（`guardPath` / `withResult` /
  `readBounded`）。**パス封じ込めの実装は `guardPath` ただ1つ** — インラインの
  `path.relative` チェックを新設しない。
- **reader-core** — 純データ層。React / MCP SDK / HTTP・WS を import しない
  （構造テストで強制）。State Version 知識は `parse/` のみ。
- **docs-bridge** — slug/用語/agent メタデータ → docs の単一オーナー
  （`bridge-map.json` / `agent-map.json` / `parsePersonaMarkdown`）。
- **api-core** — トランスポート非依存のハンドラ＋hub。HTTP ステータス写像・
  `UNKNOWN_ROUTE` はここ。
  **POST 経路表は `handlers/post.ts` の1枚だけ**（`routePost` = postMessage /
  `handlePost` = HTTP）。1エントリが両トランスポートを持つため、片方のホスト
  にだけ生える経路を書けない。ホストは経路名を自前で列挙せず、`null` 応答に
  対して自分のステータス（404 / 405）を決めるだけにする。

## 個別規約

- **エラー reason**: 新しい reason は `StandardReason`（shared-types）に追加する。
  各サーフェスの文言マップは `Record<StandardReason, string>` で型付けされて
  いるため、追加すると文言を書くまでコンパイルが落ちる（それが仕様）。
- **手動同期コピーの禁止**: 「Keep in sync」コメント付きの複製を作らない。
  生成元から import する（例: `dashboard/src/data/stage-numbers.ts` は
  `.claude/tools/data/stage-graph.json` から導出）か、shared-types へ昇格する。
- **Webview 由来のパス**: vscode-extension では必ず
  `file-ref-target.ts` の `normalizeWebviewPath` / `docTarget` / `fileRefTarget`
  を通す。webview は信頼できない呼び出し元であり、生の `path.resolve` に
  渡さない。
- **dashboard の fetch**: エンドポイント fetcher は `services/api.ts` の
  `getResult<T>` を使う1行定義。パネル内ローカルの取得は `useFetchView` +
  `deriveViewState` に載せ、手書きの loading/error state 機械を新設しない。
- **パネル UI**: サイドパネルのクローム（FocusScope / 閉じるボタン / フォーカス
  復元）は `components/PanelShell.tsx`。
- **命名**: コンポーネントは PascalCase.tsx、フックは use*.ts、それ以外の
  モジュールは kebab-case.ts。
- **テストの置き場**: パッケージのテストは `packages/<pkg>/tests/` に集約する
  （実装への併置はしない）。`scripts/` だけは例外で `*.test.ts` を実装の隣に
  置く — 対象が1ファイル1目的のスクリプトで、`tests/` を作ると往復が増えるため。
- **パッケージ README**: 単体で配布・起動されるパッケージ（
  `mcp-server`）だけが個別 README を持つ。それ以外の概観はこのファイルに集約し、
  同じ説明を各パッケージへ複製しない。
- **ライブワークスペース依存のテスト**: このリポジトリ自身の `aidlc/` 記録を読む
  テストは `scripts/live-intent.ts` が選出する記録を使う。CI 側で
  `AIDLC_ACTIVE_INTENT` を注入しない — ゲート（`bun run check`）は自分の前提を
  自分で満たす。
- **export は消費されるものだけ**: ファイル内でしか使わないシンボルを
  export しない（公開面 = 監査面）。
