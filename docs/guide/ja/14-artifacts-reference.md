# 成果物リファレンス

AI-DLC の各ワークフローは、**インテント記録ディレクトリ**の下に成果物を生成します。
`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`（`<space>` は既定以外のスペースを使わない限り `default`、`<YYMMDD>-<label>` はインテントのディレクトリ名で、以下では `<record>/` と表記します）。この章は、そのディレクトリ構造、成果物ごとの説明、ライフサイクル、Git 方針の完全リファレンスです。

---

## ディレクトリツリー

これは成果物が置かれ得る場所の全体像であり、新しい記録の初期状態ではありません。
インテント作成時に作られるのは、スコープが実行するフェーズごとに 1 つのフォルダ
（および `verification/`）だけです。残りは作業の進行に応じて現れ、ステージ単位の
フォルダはそのステージが最初に書き込んだときに作られます。

エンジン内部ファイルは `.aidlc-engine/` に集約します。更新前の監査行は、記録された旧パスのレビューを引き続き検証します。センサー所見とサマリー確認は、対応する新ディレクトリがない間だけ旧保存先を読みます。新規書き込みと、一時・導出ファイルの再生成は `.aidlc-engine/` を使います。

```
aidlc/spaces/<space>/intents/<YYMMDD>-<label>/   # one record dir per intent
  aidlc-state.md                    # Workflow state (commit)
  project-description.json          # Your first request, exactly as given (commit)
  audit/                            # Audit trail — per-clone shards (commit)
    <host>-<clone>.md               # this clone's shard; readers glob + merge by timestamp
  .aidlc-engine/                    # エンジン内部状態（gitignore）
    sensors/                       # センサー所見と型検査キャッシュ
    reviews/                       # ダイジェスト付きレビュー記録・下書き
    summary-authorization/         # 有効なサマリー確認
    source-review/                 # ローカルのレビュー済みソース
    hooks-health/                  # フックの稼働記録と失敗カウンター
    plan.json                      # 導出したスコープ計画
    state-writes.json              # doctor 用の最近の状態書込み
    stop-hook/                     # 無進捗ガードのカウンター
    human-turn                     # 直近の人間の入力
    engine-touch                   # 直近のエンジン進行
    turn-end                       # ターンを終えた直近のステップ（人が返答するまで）
    reviewer-dispatch.json         # 有効な Unit レビュアー範囲
    document-input-path            # 文書入力の受け渡し
    active-directive.json           # 一時的な実行カーソル
    active-directive.lock/          # カーソルの排他制御
    guard-refusals/                 # 繰り返す拒否のカウンター
    steering-token-key             # 継続トークンのローカル署名鍵
    codekb-stage-<repo>/            # CodeKB の一時候補
  runtime-graph.json                # Execution telemetry view (gitignore)

  verification/                     # Phase boundary checks (commit)
    phase-check-ideation.md         # written by Approval and Handoff
    phase-check-inception.md        # written by Delivery Planning
    phase-check-construction.md     # written by CI Pipeline

  initialization/                   # Phase 0: stays empty (state and audit only)

  ideation/                         # Phase 1 artifacts
    intent-capture/
    market-research/                (conditional)
    feasibility/                    (conditional)
    scope-definition/
    team-formation/                 (conditional)
    rough-mockups/                  (conditional)
    approval-handoff/

  inception/                        # Phase 2 artifacts
    practices-discovery/            (conditional)
    requirements-analysis/
    user-stories/                   (conditional)
    refined-mockups/                (conditional)
    domain-design/             (conditional)
    units-generation/
    contract-design/           (conditional)
    delivery-planning/

  construction/                     # Phase 3 artifacts
    {unit-name}/                    (per unit of work, repeated)
      functional-design/            (conditional)
      nfr-requirements/             (conditional)
      nfr-design/                   (conditional)
      infrastructure-design/        (conditional)
      code-generation/
    build-and-test/
    ci-pipeline/                    (conditional)

  operation/                        # Phase 4 artifacts
    deployment-pipeline/            (conditional)
    environment-provisioning/       (conditional)
    deployment-execution/           (conditional)
    observability-setup/            (conditional)
    incident-response/              (conditional)
    performance-validation/         (conditional)
    feedback-optimization/          (conditional)

  archive/                          (created on-demand)
    {ISO-date}-{stage-name}/
```

ステージフォルダの中には、そのステージの成果物、質問ファイル、Learnings が on のときの `memory.md` 日誌、そして `reviews/review-NN.md` があります。`reviews/review-NN.md` はそのステージの各レビューの読みやすいコピーで、判定が出た順に番号が付きます。`mvp` 計画で意図の取り込みを終え、実現可能性評価を始めた時点で、ある記録は次のとおりでした（取得したもので、`.aidlc-engine/` は省いています）。

```text
aidlc/spaces/default/intents/261013-inventory-api/
  aidlc-state.md
  project-description.json
  runtime-graph.json
  audit/
    <host>-<clone>.md
  construction/
  ideation/
    feasibility/
      feasibility-questions.md
      memory.md
    intent-capture/
      intent-capture-questions.md
      intent-statement.md
      memory.md
      reviews/
        review-01.md
      stakeholder-map.md
  inception/
  initialization/
  verification/
```

**リバースエンジニアリングの 9 つの成果物は、記録ディレクトリの中にはありません。** これら（`architecture.md`、`code-structure.md`、`technology-stack.md`、…）は 1 段上のスペースレベルのリポジトリ別 CodeKB、つまり `aidlc/spaces/<space>/codekb/<repo>/` に置かれます。インテントごとのコピーではなく、リポジトリごとに 1 つのストアです。プロジェクトフォルダ自体がリポジトリの場合、`<repo>` はフォルダ名（リンクされた git worktree ではメインチェックアウトの名前）から始まり、英字、数字、`.`、`_`、`-` 以外の各文字はハイフンに置き換えられます（`portal app` は `portal-app` になります。フォルダ自体の名前はそのままです）。この名前はそのままストアに残ります。プロジェクトフォルダを移動・改名・コピーしても同じストアを読み続けます。例外は、どのインテントも自分のリポジトリとして記録していないストアが 2 つ以上あるスペースです。その場合は現在のフォルダ名を使い、次のステップで完了済みステージの結果がずれていると警告することがあります。適用対象の各ブラウンフィールドインテントでは、ステージがまずストアの記録済みスコープとワーキングツリーのフィンガープリントを検査します。カバレッジがインテントに合致する検証済みで最新のストアは、人間の選択で再利用できます。そうでなければ、完全な再スキャンがこれら 9 ファイルを置き換えます。焦点スキャンの場合は、新たに解析した領域を 9 ファイルへマージし、その領域の外にある従来の記述は保持します。検証済みで最新のカバレッジは和集合として累積し、古い・検証できない従来の深いカバレッジは記述としては残したうえで浅い扱いへ降格します（`reverse-engineering-timestamp.md` が最後のスキャンの実行時刻とカバレッジを記録します）。スキャン前のソース／ストア世代と、全成果物をロックしたうえでの公開により、ソースの変更が最新と誤ってラベル付けされることも、同時に走った焦点スキャンが互いを静かに上書きすることも防ぎます。したがってインテントは、自身の記録ディレクトリが作られた時点のスキャンではなく、そのリポジトリの最新スキャンを読みます。日誌が有効な場合に記録ディレクトリが受け取るのは、ステージ自身の `memory.md` 日誌だけです（エンジンが run-stage ディレクティブを発行するときに作成。下記の**ステージごとのメモリ日誌**を参照）。そのため、記録ディレクトリに `inception/reverse-engineering/` ディレクトリが現れることはありますが、そこにあるのは日誌だけです。codekb への書き込みは `codekb > <repo> > <name>` のパンくず付きで監査記録されるため、インテント単位のトレイルにも、何がいつ変わったかは残ります。

**チームナレッジは記録ディレクトリの中にはありません。** 1 段上のスペース階層、つまり `aidlc/spaces/<space>/knowledge/`（`intents/` と同階層）に置かれます。これにより、1 つのインテントに閉じ込められず、スペース内のすべてのインテントをまたいで蓄積されます。エンジンは空の状態で作成し、チームは任意の `aidlc-shared/` とエージェントごとのサブディレクトリの下へ自由形式ファイルを追加します。[ナレッジ](08-knowledge.md) を参照してください。

**ステージごとのメモリ日誌。** Learnings が on のステージでは、成果物と同じ場所にコミット対象の `memory.md` も保持されます（例: `<record>/inception/requirements-analysis/memory.md`）。これはそのステージの観察日誌であり、エンジンが run-stage ディレクティブを発行するときに雛形から作成し、進行中はオーケストレーターが、エージェントの推論についてのそのステージの記録として更新します。その中身が、残すべきものとしてあなたに提示されることはありません。手動では編集しません。あなたが行った修正を残す学習ループについては [ルールと学習ループ](09-rules-and-the-learning-loop.md) を参照してください。

**コードは記録ディレクトリではなく同階層のリポジトリにあります。** `aidlc/` ツリーが保持するのは方法論、状態、監査情報、成果物だけで、アプリケーションコードは含みません。生成コードはワークスペースの**コードリポジトリ**へ出力されます。一般的な単一リポジトリではプロジェクトディレクトリ自体、複数リポジトリのワークスペースではワークスペースルート直下にある同階層のリポジトリディレクトリ（それぞれが個別の `.git` を持つ）です。インテントは作成時に対象リポジトリを `intents.json` 行内の `repos: [...]` に記録します。自動検出でも、`--repos a,b` で限定した場合でも同様です。構築フェーズでは各 Git 操作をそのうち 1 つのリポジトリに固定します。記録済みの `repos` がないインテントは単一リポジトリの既定ケースです。[CLI コマンド](12-cli-commands.md) を参照してください。

---

## 成果物ライフサイクル

成果物は、作成から下流ステージでの利用まで、予測可能なライフサイクルをたどります。

```mermaid
flowchart LR
    CREATE["ステージが\n成果物を作成"]
    REVIEW["承認ゲートで\nレビュー"]
    COMMIT["バージョン管理へ\nコミット"]
    CONSUME["下流ステージが\n消費"]
    VERIFY["フェーズ境界で\n検証"]

    CREATE --> REVIEW --> COMMIT --> CONSUME --> VERIFY

    style CREATE fill:#e3f2fd,stroke:#2196f3,color:#000
    style REVIEW fill:#fff3e0,stroke:#ff9800,color:#000
    style VERIFY fill:#fce4ec,stroke:#e91e63,color:#000
```

<!-- テキスト代替: ステージが成果物を作成し、承認ゲートでレビューされ、バージョン管理へコミットされ、下流ステージで消費され、フェーズ境界で検証されます。 -->

1. **作成される** — 主担当エージェントがステージ実行中に成果物を生成し、インテントの記録ディレクトリ内の適切なサブディレクトリへ書き込む（上記のスペースレベルの例外あり: リバースエンジニアリングはリポジトリ別 codekb ストアへ、チームナレッジは `knowledge/` へ書く）
2. **レビューされる** — 承認ゲートで成果物を確認し、承認または修正依頼を行う
3. **コミットされる** — 承認後、成果物はバージョン管理に載せる準備が整う（以下の Git 方針を参照）
4. **利用される** — 下流ステージがその成果物を入力として読む（後述の入力表を参照）
5. **検証される** — フェーズ境界検証により、そのフェーズ内のすべての成果物で追跡可能性が確認される

---

## フェーズ別の成果物

### 初期化（ステージ 0.1〜0.3）

| ステージ | 残すもの | 補足 |
|-------|-----------|-------|
| 0.1 ワークスペース足場作成 | 記録ディレクトリ（計画が実行するフェーズごとに 1 つのフォルダと `verification/`）、およびスペースの `knowledge/` | 決定論的（`aidlc-utility intent-create` 内で実行） |
| 0.2 ワークスペース検出 | `aidlc-state.md` の `Project Type` と `Workspace State` の根拠となる走査、および `WORKSPACE_SCANNED` 監査行 | 決定論的なルールベース走査 |
| 0.3 状態初期化 | 完全な `aidlc-state.md` | 決定論的 |

3 つのどれも独自の文書を書かないため、`initialization/` は空のままです。

歓迎メッセージは `settings.json` の `companyAnnouncements` 経由でセッション開始時に表示されます。ステージではなく、成果物も生成しません。

### アイデア創出（ステージ 1.1〜1.7）

| ステージ | 主要成果物 | 条件 |
|-------|--------------|-----------|
| 1.1 意図の取り込み | `intent-capture-questions.md`（ソース台帳と確認済みの回答）、`intent-statement.md`、`stakeholder-map.md`（インラインのソースタグと必須の前提セクション） | 常に実行 |
| 1.2 市場調査 | `competitive-analysis.md`、`build-vs-buy.md` | 条件付き |
| 1.3 実現可能性評価 | `feasibility-assessment.md`、`constraint-register.md`、`raid-log.md` | 条件付き |
| 1.4 スコープ定義 | `scope-document.md`、`intent-backlog.md` | 常に実行 |
| 1.5 チーム編成 | `team-assessment.md`、`mob-composition.md` | 条件付き |
| 1.6 粗いモックアップ | `wireframes.md`、`user-flow.md` | 条件付き |
| 1.7 承認と引き継ぎ | `initiative-brief.md`、`decision-log.md` | 常に実行 |

### 構想（ステージ 2.1〜2.9）

| ステージ | 主要成果物 | 条件 |
|-------|--------------|-----------|
| 2.1 リバースエンジニアリング | `architecture.md`、`code-structure.md`、`technology-stack.md` を含む 9 ファイル（スペースレベルの `aidlc/spaces/<active-space>/codekb/<repo>/` へ書き込み — リポジトリごとに 1 つの共有ストア。検証済みで最新なら再利用され、完全な再スキャンで置換され、焦点スキャンでは累積的に拡張される。インテント記録に入るのは、有効な場合のステージの `memory.md` 日誌のみ） | 既存システムのみ |
| 2.2 プラクティス発見 | `team-practices.md`、`discovered-rules.md`、`evidence.md`、`practices-discovery-timestamp.md`、および quality / developer / devsecops の各コントリビューションファイル（承認後に `aidlc/spaces/<active-space>/memory/team.md` と `project.md` へ昇格） | 条件付き |
| 2.3 要件分析 | `requirements.md` | 常に実行 |
| 2.4 ユーザーストーリー | `stories.md`、`personas.md` | ユーザー向け機能 |
| 2.5 詳細モックアップ | `mockups.md`、`interaction-spec.md`、`accessibility-checklist.md` | UI プロジェクト |
| 2.6 ドメイン設計 | `components.md`（統合されたコンポーネントカタログ）、`decisions.md`（ADR ログ） | 新規コンポーネントが必要なとき |
| 2.7 作業ユニット生成 | `unit-of-work.md`、`unit-of-work-dependency.md`、`unit-of-work-story-map.md` | 常に実行 |
| 2.8 契約設計 | `contract-summary.md`（ユニット間の契約と、公開 API または外部 API） | 複数ユニット、またはシステム外から使われる API を持つユニット |
| 2.9 デリバリー計画 | `bolt-plan.md`、`team-allocation.md`、`risk-and-sequencing-rationale.md`、`external-dependency-map.md` | 常に実行 |

### 構築（ステージ 3.1〜3.7）

ステージ 3.1〜3.5 は作業ユニットごとに繰り返されます。成果物は `construction/{unit-name}/{stage-name}/` に配置されます。ステージ 3.6〜3.7 はすべての作業ユニット完了後に 1 回だけ実行します。

4 つの設計ステージ（3.1〜3.4）は、各作業ユニットの**種類**に応じて成果物を絞り込みます（2.7 の依存関係ブロックで `service`、`spec`、`ui`、`packaging`、`library` としてタグ付けします）。`spec` の作業ユニットには拡張性文書が不要で、`packaging` の作業ユニットには機能仕様が不要です。種類が付いていない作業ユニットには、以下の完全な対応表が適用されます。各種類に適用する成果物はステージのフロントマターデータ（`produces_kinds`。詳細は [ステージ定義](../reference/15-stage-definition.md)）で決まります。あるステージの成果物がどれも適用されない作業ユニットは、そのステージでファイルを生成せずに完了します。

| ステージ | 主要成果物 | 条件 |
|-------|--------------|-----------|
| 3.1 機能設計 | `entities.md`、`rules.md`、`functional-spec.md` | 計画に従い、作業ユニットごと（種類ごと） |
| 3.2 非機能要件 | `security-requirements.md`、`performance-requirements.md` | 計画に従い、作業ユニットごと（種類ごと） |
| 3.2 非機能要件 | `observability-requirements.md` | 計画に従い、サービスユニットのみ |
| 3.3 非機能設計 | `security-design.md`、`performance-design.md` | 計画に従い、作業ユニットごと（種類ごと） |
| 3.3 非機能設計 | `observability-design.md` | 計画に従い、サービスユニットのみ |
| 3.4 インフラ設計 | `infrastructure-specification.md`、`monitoring-design.md`、`cicd-pipeline.md` | 計画に従い、作業ユニットごと（種類ごと） |
| 3.5 コード生成 | `code-generation-plan.md`、`code-generation-questions.md`、`unit-test-instructions.md`、`code-summary.md`、`traceability.json`、およびエンジン必須の `source-manifest.json`（コードはワークスペースルートに出る） | 常に実行、作業ユニットごと |
| 3.6 ビルドとテスト | `build-instructions.md`、`test-results.md` | 常に実行、全作業ユニット完了後 |
| 3.7 CI パイプライン | `ci-config.md`、`quality-gates.md` | 条件付き、全作業ユニット完了後 |

### 運用（ステージ 4.1〜4.7）

| ステージ | 主要成果物 | 条件 |
|-------|--------------|-----------|
| 4.1 デプロイパイプライン | `cd-config.md`、`deployment-strategy.md`、`rollback-runbook.md` | 条件付き |
| 4.2 環境プロビジョニング | `environment-inventory.md`、`validation-report.md` | 条件付き |
| 4.3 デプロイ実行 | `deployment-log.md`、`smoke-test-results.md` | 条件付き |
| 4.4 可観測性セットアップ | `dashboards.md`、`alarms.md`、`slo-config.md` | 条件付き |
| 4.5 インシデント対応 | `runbooks.md`、`incident-plan.md`、`escalation-matrix.md` | 条件付き |
| 4.6 性能検証 | `load-test-plan.md`、`nfr-validation-matrix.md` | 条件付き |
| 4.7 フィードバックと最適化 | `slo-report.md`、`cost-analysis.md`、`feedback-loop.md` | 条件付き |

---

## 質問ファイル

利用者の入力を集める各ステージは、同じ場所に `{stage-name}-questions.md` という質問ファイルを生成します。質問は文字付き選択肢（A〜E。質問ボックスに 4 つまで表示する Claude Code では A〜D）と必須の `X. Other (please specify)` を使い、回答記録には `[Answer]:` タグを使います。エージェントが作成するファイルでは、通常の質問の見出しに、ふだんそれに答える人が示されます（`## Q3. [Developer] ...`）。各人の質問は、別の人の回答を待つ必要がない限りまとめて置かれます。あとから追加された質問は末尾に置かれます。確認、変更依頼、承認のセクションにはラベルが付きません。既存のファイルは質問をそのまま保ちます。ただし、ステージを最初からやり直すよう求めた場合は、新しいファイルに置き換わります。

各ステージでは、回答方法を選べます。

| モード | 仕組み |
|------|-------------|
| **対話形式（Guide me）** | エージェントがここで質問をまとめて尋ねる（Claude Code では一度に最大 4 問を表示） |
| **ファイル編集（I'll edit the file）** | 質問ファイルを直接編集し、終わったことをエージェントに伝える |
| **チャット（Chat）** | 自由形式で会話する。決定事項は抽出されてファイルへ書き込まれる |

以後のステージは選んだ方式を引き継ぎ、ステージの途中で切り替えることもできます。質問ファイルが常に正本です。[対話モード](07-interaction-modes.md) を参照してください。

---

## コミットするものと Gitignore に入れるもの

配布済みの `.gitignore` にはこの分割が定義されています。共有する方法論、レジストリ、状態、監査情報、成果物はコミットし、利用者ごとのセッション位置、自分の設定、端末固有の派生状態は Git 管理外にします。

| コミットする | Gitignore に入れる |
|--------|-----------|
| `aidlc-state.md` | `aidlc/active-space`、`intents/active-intent`（利用者ごとの現在位置） |
| `audit/*.md`（クローンごとのシャード） | `.aidlc-engine/`（フレームワークの状態） |
| すべてのステージ成果物 | `runtime-graph.json`（監査シャードから再生成できる） |
| `verification/` のフェーズ検査結果 | `aidlc/.aidlc-clone-id`（このクローンのシャード名を決めるため、端末固有である必要がある） |
| スペース単位の `aidlc/spaces/<space>/knowledge/` チームナレッジファイル | `aidlc/.aidlc-sessions/`（セッションごとの UUID スタンプ、ワークフローの紐付け、PID 系譜の対応表） |
| ステージごとの `memory.md` 日誌、スペースの `memory/` 層 | `.aidlc-engine/hooks-health/`、`.aidlc-engine/sensors/`（生存確認、助言用の指摘） |
| レビューされた各ステージの `reviews/` コピー | `.claude/settings.local.json`、`aidlc.settings.local.json`（自分の設定） |
| | `aidlc/active-memory/`（アクティブなスペースの `memory/` をエンジンがコピーしたもので、各ハーネスの include が読む。セッション開始時とスペース切り替え時に書かれるので、切り替えで追跡対象のファイルは変わらない。コピーされた各ファイルは編集すべきファイルを示すコメントで始まり、コピー側で行った編集は次の更新で置き換えられる） |
| | `aidlc/.aidlc-request-text/`（エンジンが読むためにエージェントがファイルへ書いた依頼。コマンドが進んだら削除され、進まなかった場合は残る） |

---

## 入力と依存関係

各ステージは、前段ステージの成果物を入力として読みます。主要な依存関係の連鎖は次のとおりです。

- **意図の取り込み**の成果物は、市場調査、実現可能性評価、スコープ定義、粗いモックアップへ流れる
- **要件分析**の成果物は、ユーザーストーリー、ドメイン設計、すべての構築ステージへ流れる
- **ドメイン設計**と**作業ユニット生成**の成果物は、作業ユニットごとのすべての構築ステージへ流れる
- **すべての構築成果物**は、ビルドとテスト、CI パイプラインへ流れる
- **インフラ設計**の成果物は、運用ステージへ流れる

各ステージ自身の入力は、開発者リファレンスのフェーズ別ページに一覧があります: [初期化](../reference/04-stages/initialization.md)、[アイデア創出](../reference/04-stages/ideation.md)、[構想](../reference/04-stages/inception.md)、[構築](../reference/04-stages/construction.md)、[運用](../reference/04-stages/operation.md)。

---

## フェーズ境界検証

3 つのステージが、追跡可能性のチェックでそれぞれのフェーズを締めくくり、その結果を `verification/` に書きます。そのステージを飛ばす計画では、そのフェーズのチェックは作られません（たとえば `mvp` は承認と引き継ぎを飛ばします）。

| チェックファイル | 書くステージ | 検証内容 |
|-----------|-----------|-------------------|
| `phase-check-ideation.md` | 1.7 承認と引き継ぎ | インテント、スコープ、インテントバックログの整合性 |
| `phase-check-inception.md` | 2.9 デリバリー計画 | 要件、ストーリー、アーキテクチャの整合性 |
| `phase-check-construction.md` | 3.7 CI パイプライン | すべての作業ユニットがビルド / テスト済みで、CI が設定済み |

---

## 次のステップ

- [状態追跡と監査証跡](10-state-and-audit.md) — 状態ファイルと監査証跡の詳細
- [ステージの実行方法](04-phases-and-stages.md) — ステージ実行と成果物生成
- [用語集](glossary.md) — 成果物、フェーズ境界検証、質問ファイルの定義
