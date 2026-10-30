# 実践例

AI-DLC が実際にどう動くかを示す 2 つの完全な実例を載せます。1 つはバグ修正、もう 1 つは機能開発です。どちらもコマンド呼び出し、ステージ進行、承認ゲート、成果物出力を示します。

> **ハーネスに関する注記。** これらの実行記録は **Claude Code** で取得しました。そのため `/aidlc` や、`Task` 呼び出しで委譲されるサブエージェントステージなど、Claude Code の操作面がそのまま出ています。ステージの流れ、ゲート、成果物はどのハーネスでも同一で、違うのは委譲の仕組みだけです（Kiro は `subagent` ツール、Codex は `spawn_agent` サブエージェントを使います）。[他のハーネスでの実行](harnesses/README.md) を参照してください。

---

## バグ修正の実例

この例では、ユーザープロフィール API のヌルポインター例外を修正します。**bugfix** スコープは、Minimal の深さで 9 ステージ（初期化 3 + 分野別 6）を実行します。

### 呼び出し

```
/aidlc bugfix
```

コンダクターは、何を直したいかを尋ねます。

> **What would you like to build?**

あなたは次のように答えます。

> ユーザープロフィール API は、`display_name` フィールドが `null` のとき HTTP 500 を返します。`GET /api/v1/users/:id/profile` エンドポイントは `ProfileSerializer.serialize()` 内で NullPointerException を起こします。これは、`display_name` が必須になる前に作成されたユーザープロフィールの約 12% に影響します。

### 実行されるステージ

| # | ステージ | フェーズ | リードエージェント | モード |
|---|-------|-------|------------|------|
| 0.1 | ワークスペース足場作成 | 初期化 | オーケストレーター | インライン（自動で先へ進む） |
| 0.2 | ワークスペース検出 | 初期化 | オーケストレーター | インライン（自動で先へ進む） |
| 0.3 | 状態初期化 | 初期化 | オーケストレーター | インライン（自動で先へ進む） |
| 2.1 | リバースエンジニアリング | 構想 | aidlc-developer-agent + aidlc-architect-agent | パイプライン |
| 2.3 | 要件分析 | 構想 | aidlc-product-agent | インライン |
| 3.5 | コード生成 | 構築 | aidlc-developer-agent | サブエージェント |
| 3.6 | ビルドとテスト | 構築 | aidlc-quality-agent | インライン |
| 4.1 | デプロイパイプライン | 運用 | aidlc-pipeline-deploy-agent | インライン |
| 4.3 | デプロイ実行 | 運用 | aidlc-pipeline-deploy-agent + aidlc-developer-agent | インライン |

### 初期化（ステージ 0.1〜0.3）— 自動進行

3 つの初期化ステージは、利用者の操作なしで 1 秒未満の単一かつ決定論的なツール呼び出し（`aidlc-utility intent-create`）として実行されます。

- **0.1 ワークスペース足場作成** — 最初のインテントを自動作成し、その記録ディレクトリを `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` に作成する（以下では `<record>/` と表記）。`<YYMMDD>` は記録が時系列で並ぶようにする短い UTC 日付接頭辞。`<label>` はコンダクターが要求内容から抽出した短いケバブケースの要約。正規 ID は UUIDv7 で、`intents.json` のレジストリ行に保持される
- **0.2 ワークスペース検出** — ルールベース走査が Java 17、Spring Boot 3.2、Maven、既存プロジェクトを特定する
- **0.3 状態初期化** — `aidlc-state.md` を、スコープ `bugfix`、深さ `Minimal`、実行対象の分野別ステージを含む状態で初期化する

> この作業用に bugfix ワークフローを準備しています: 6 ステージ、承認ゲート 6 個。

### ステージ 2.1 — リバースエンジニアリング

2 リンクのパイプラインがコードベースを走査します。最初に aidlc-developer-agent がコードを走査し、その後 aidlc-architect-agent が統合して成果物を書き込みます。このリポジトリ向けの 9 個の永続成果物を `aidlc/spaces/default/codekb/user-service/` に生成します。

| 成果物 | 内容 |
|----------|----------|
| `business-overview.md` | 利用者サービス — プロフィール、設定、認証トークン |
| `architecture.md` | Spring Boot モノリス、3 層設計 |
| `code-structure.md` | 6 パッケージ: コントローラー、サービス、モデル、リポジトリ、シリアライザー、設定 |
| `api-documentation.md` | `/api/v1/users/` 配下の 8 個の REST エンドポイント |
| `component-inventory.md` | コントローラー、サービス、リポジトリ、シリアライザーの一覧 |
| `technology-stack.md` | Java 17、Spring Boot 3.2、PostgreSQL 15、Jackson 2.15 |
| `dependencies.md` | Maven 依存関係ツリー、サードパーティーライブラリ、バージョン制約 |
| `code-quality-assessment.md` | テストカバレッジ 62%、基本的な CI |
| `reverse-engineering-timestamp.md` | 走査の実行時刻と対象コミット |

**承認ゲート:**

```
Reverse Engineering complete. How would you like to proceed?
- Approve        -> Continue to Requirements Analysis
- Request Changes -> Provide revision feedback
```

あなたは **Approve** を選択します。

### ステージ 2.3 — 要件分析

aidlc-product-agent のペルソナが読み込まれ、`<record>/inception/requirements-analysis/requirements-analysis-questions.md` に確認質問を作成します。

```markdown
## Q1. [Product owner] Bug Severity Classification
How severe is this bug for your users?
A. Critical — causes data loss or security exposure
B. High — blocks a core workflow for affected users
C. Medium — degraded experience but workaround exists
D. Low — cosmetic or minor inconvenience
X. Other (please specify)

[Answer]:
```

コンダクターは対話方式を提示します。

```
How would you like to answer these questions?
- Guide me        -> Walk through each question interactively
- I'll edit the file -> Fill in answers directly
- Chat            -> Discuss freely
```

利用者は **Guide me** を選び、`Q1 = High`、`Q2 = Username as fallback`、`Q3 = Handle null gracefully (no migration)` と回答します。

コンダクターは `requirements.md` を生成し、3 つの機能要件（null 処理、シリアライザー修正、代替ロジック）と 1 つの非機能要件（応答時間に退行がないこと）を記述します。

**承認ゲート:** あなたは **Approve** を選択します。

### ステージ 3.5 — コード生成

コンダクターはコード生成計画を作成し、その後 aidlc-developer-agent のサブエージェントへ委譲します。

**計画:**
1. `ProfileSerializer.serialize()` を修正し、`null` の `display_name` を処理できるようにする
2. `null` / `non-null` の両ケースに対する単体テストを追加する
3. `ProfileService.getProfile()` の防御的検査を修正する
4. API エンドポイントに対する結合テストを追加する

利用者は計画を承認します。サブエージェントは 4 つの手順をすべて実装します。

- **変更**: `ProfileSerializer.java`（利用者名の代替を含む `null` 安全な実装）
- **変更**: `ProfileService.java`（防御的な `null` 処理）
- **作成**: `ProfileSerializerTest.java`（2 つの単体テスト）
- **作成**: `ProfileControllerIntegrationTest.java`（2 つの結合テスト）

**承認ゲート:** あなたは **Approve** を選択します。

### ステージ 3.6 — ビルドとテスト

aidlc-quality-agent がビルドとテストを実行します。

```
mvn clean compile        # BUILD SUCCESS
mvn test                 # 89 tests, 0 failures
mvn verify               # Integration tests pass
```

結果は `<record>/construction/build-and-test/test-results.md` に記録されます。89 テスト成功、失敗 0、網羅率は 62% から 64% へ上がります。

**承認ゲート:** あなたは **Approve** を選びます。

### ステージ 4.1 と 4.3 — デプロイ

デプロイパイプラインは既存のデリバリー設定を確認し、デプロイ戦略、CD 設定、ロールバック手順書を記録します。このバグ修正は既存のターゲット環境を使うため、環境プロビジョニングはスキップされたままです。

承認後、デプロイ実行がテスト済み成果物をそのパイプライン経由でデプロイし、スモークテストと健全性確認を実行し、デプロイログを記録します。あなたが最後のゲートを承認すると、ワークフローは完了します。

### 最終状態

```
aidlc/spaces/default/
  codekb/
    user-service/             # 9 space-level RE artifacts
  intents/260624-null-display-fix/
    aidlc-state.md            # All 9 stages marked [x]
    audit/                    # Full decision trail (per-clone shards)
    inception/
      requirements-analysis/ # requirements.md + questions
    construction/
      bugfix-null-display-name/
        code-generation/     # plan + summary
      build-and-test/        # instructions + test results
    operation/
      deployment-pipeline/   # CD config + strategy + rollback runbook
      deployment-execution/  # deployment log + smoke tests + health checks
```

アプリケーションコードはワークスペースルートに出ます。
- `ProfileSerializer.java`（変更）
- `ProfileService.java`（変更）
- `ProfileSerializerTest.java`（新規作成）
- `ProfileControllerIntegrationTest.java`（新規作成）

### 主な観察点

1. **各分野別ステージに承認ゲートがある** — すべての判断を利用者が制御する
2. **Minimal の深さ** — 成果物は短く対象が絞られ、修正内容の定義に必要な質問だけが出る
3. **サブエージェントへの委譲** — リバースエンジニアリングとコード生成のような重い作業は、利用者が承認している間に子プロセスで実行される
4. **完全な監査証跡** — すべての判断が ISO 形式の時刻付きで記録される
5. **セッション再開** — 途中で中断しても `/aidlc` が進行中状態を検出する

---

## feature の実例

この例では、タスク管理アプリケーション向けの通知サービスを構築します。**feature** スコープは Standard の深さで 33 ステージすべてを実行します。この実例では、全フェーズにまたがる主要ステージを抜粋します。この例はコラボレーターをオン（`/aidlc --collaborators on`）にして実行するため、以下の構想フェーズのアンサンブルは全メンバーを示します。feature スコープの出荷時設定はオフで、その場合これらのステージはリードエージェントだけで実行されます。

### 呼び出し

```
/aidlc feature
```

> **What would you like to build?**

> タスク管理アプリケーション向けの通知サービス。タスクが割り当てられたとき、期日が近づいたとき、コメントが投稿されたときに、利用者がアプリ内通知と任意のメールダイジェストを受け取れるようにしたい。利用者ごとの通知設定にも対応したい。

### 初期化（ステージ 0.1〜0.3）— 自動進行

3 つの初期化ステージは `aidlc-utility intent-create` 内で自動実行されます。ワークスペース検出は、TypeScript、Node.js 20、Express、PostgreSQL、既存のタスク / 利用者サービスを持つ既存プロジェクトを特定します。

> この作業用に feature ワークフローを準備しています: 30 ステージ、承認ゲート 30 個。Construction では 5 ステージが作業単位ごとに繰り返されます。

### アイデア創出フェーズ（ステージ 1.1〜1.7）

**ステージ 1.1 — 意図の取り込み**（aidlc-product-agent）

aidlc-product-agent はまず許可されたソースの全体を `intent-capture-questions.md` に記録し、そのうえで課題、対象利用者、ステークホルダー、意思決定権限、コミュニケーションニーズ、スコープについて質問します。

```markdown
## Sources

- [desc] Initial description: "A notification service for our task management app..."
- [scope] Workflow-selected scope: `feature`.

## Q1. [Product owner] Which notification channels are in scope?
A. In-app only
B. In-app + email
C. In-app + email + push
D. In-app + email + push + SMS
X. Other

[Answer]: B. In-app + email
```

生成される成果物では、各主張がこのレジスターまたは確認済みの回答に紐付いたままになります。

```markdown
## Target Customer

Task-management users receiving assignment, due-date, or comment events. [desc]

## Notification Channels

In-app notifications and optional email digests are in scope. [Q1]

## Assumptions & Open Questions

None.
```

ステークホルダーマップも同じタグを `Source` 列で使用します。裏付けのない内容は、フォローアップとして質問されるか、`## Assumptions & Open Questions` の下に残ります。保持された仮定（assumption）には利用者の明示的な受け入れが必要で、受け入れ後も仮定としてのラベルが維持されます。その後、通常の承認ゲートの前に aidlc-product-lead-agent がソース接地をレビューします。

**ステージ 1.4 — スコープ定義**（aidlc-product-agent）

スコープ境界を定義します。対象内は 3 種類の起点、利用者設定、メールダイジェストです。対象外はプッシュ通知、SMS、リアルタイム WebSocket です。`scope-document.md` と、優先順位付き項目を含む `intent-backlog.md` を生成します。

**ステージ 1.7 — 承認と引き継ぎ**（aidlc-delivery-agent）

アイデア創出の全出力を集約した取り組み概要をまとめます。フェーズ境界検証により、インテントからスコープまでの追跡可能性を確認します。

> 進捗: 30 ステージ中 7 ステージ完了。次: リバースエンジニアリング。

### インセプションフェーズ（ステージ 2.1〜2.9）

**ステージ 2.1 — リバースエンジニアリング**（パイプライン）

既存コードベースを 2 リンクで走査します。9 個の成果物をリポジトリのスペースレベルストア `aidlc/spaces/<active-space>/codekb/<repo>/` に書き込み、通知サービスが連携すべき既存サービス構造、データベーススキーマ、API パターンを特定します。

**ステージ 2.2 — プラクティス発見**（aidlc-pipeline-deploy-agent）

これはサブエージェントのハブアンドスポークです。aidlc-pipeline-deploy-agent がリバースエンジニアリングの証拠から下書きを作り、次に aidlc-quality-agent、aidlc-developer-agent、aidlc-devsecops-agent が互いのコントリビューションを見ずに、その下書きを並列で検査します。人間インタビューで証拠の欠落とポリシー判断を解決した後、リードが 3 つすべてのコントリビューションを `team-practices.md`、`discovered-rules.md`、`evidence.md` へ統合します。ゲートは **Approve** / **Request Changes** を提示します。Approve 後、`practices-promote` が `aidlc/spaces/<active-space>/memory/team.md` と `project.md` を書き込み、続いて確認済みタイムスタンプと対応する `PRACTICES_AFFIRMED` レシートを原子的に記録します。コンダクターがステージの承認を報告するのはその後だけです。昇格が欠落、陳腐化、または失敗した場合、ゲートは開いたまま、ステージは未完了のままになります。

**ステージ 2.3 — 要件分析**（aidlc-product-agent）

12 個の機能要件（通知起点、設定 CRUD、メール描画、ダイジェスト予定設定）と 5 個の非機能要件（配信遅延 < 5 秒、メール再試行、設定保存）を生成します。質問は境界事例にも踏み込みます。メール配信に失敗したらどうするか、ダイジェストをどの頻度で実行するか、などです。

**ステージ 2.4 — ユーザーストーリー**（モブ）

まず aidlc-product-agent がペルソナとストーリーの下書きを作ります。次に aidlc-design-agent、aidlc-developer-agent、aidlc-quality-agent が、互いに見えないコラボレーターとしてその下書きを検査し、それぞれがアイデンティティ付きのコントリビューションファイルを書きます。リードの aidlc-product-agent が 3 つすべてのコントリビューションを `personas.md` と `stories.md` へ統合したうえで、**Approve** / **Request Changes** ゲートを提示します。

**ステージ 2.6 — ドメイン設計**（aidlc-architect-agent）

aidlc-architect-agent が通知サービスのアーキテクチャを設計します。

- **コンポーネント**: `NotificationService`、`PreferenceService`、`EmailRenderer`、`DigestScheduler`。それぞれに振る舞い、依存先／依存元、所有するエンティティを付与します
- **エンティティ所有**: `NotificationService` が Notification と NotificationEvent を所有し、`PreferenceService` が Preference を所有します
- **根拠**: イベント駆動の起点パターン（ポーリングではなく）、メールキューに SQS（直接送信ではなく）を Rationale セクションに記録します

統合された `components.md`（`yaml` フェンス付きカタログと Mermaid 図、サマリー、所有関係、根拠の各表）と、ADR ログである `decisions.md` を生成します。

**ステージ 2.7 — 作業ユニット生成**（aidlc-architect-agent）

3 つの作業ユニットへ分解します。

1. **`notification-core`** — イベントハンドラー、通知保存、アプリ内配信
2. **`notification-preferences`** — 通知設定 CRUD API、既定の設定
3. **`notification-email`** — メールレンダラー、SQS 統合、ダイジェスト予定処理

`unit-of-work.md` と `unit-of-work-dependency.md` を生成します。順序はnotification-core、notification-preferences、notification-emailです。メール処理は設定参照APIに依存します。

**ステージ 2.8 — 契約設計**（aidlc-architect-agent）

システムが連携し合う 3 つのユニットに分割されるため、契約設計はユニット間の境界を形式化します。対象は、`notification-core` が呼び出し元へ公開する内部イベント契約と、`notification-email` が `notification-preferences` から利用する設定参照の契約です。境界ごとに 1 行を持ち、各行にインラインの仕様ブロックを含む `contract-summary.md` を生成します。

**ステージ 2.9 — デリバリー計画**（aidlc-delivery-agent）

計画のみです。Bolt 1 は `notification-core` を出荷する想定です（ワーキングスケルトンとして、イベントハンドラー処理がエンドツーエンドで通ることを証明します）。Bolt 2 では `notification-preferences` と `notification-email` を一緒に出荷する想定です。Bolt ごとの完了定義は `bolt-plan.md` に記録し、WSJF 風の根拠は `risk-and-sequencing-rationale.md`、外部 SES / SQS 依存は `external-dependency-map.md` に記録します。構築エンジンはこの計画を実行順として消費しません — 実行時のバッチは引き続き 2.7 の DAG から決まります。フェーズ境界検証により要件とアーキテクチャの整合を確認します。

この例では、プロジェクトの検査は `bun run verify:notifications` です。イベントを送信し、保存とアプリ内配信を検証します。コンダクターは提案するコマンドをファイル書込みツールで`<record>/verification-command.txt` に書き込み、続いて検証コマンドの判断を開きます。`decision`ツールの JSON 出力から正規化された `command` 全体をそのまま質問のコードスパンへ写します。「Use this command to verify each completed Unit?`bun run verify:notifications`」。コマンドが省略されることはなく、人間は`<record>/verification-command.txt` を開いて確認することもできます。正規化されたコマンドは、空白でない 1 行で 1024 文字以内でなければなりません。制御文字と表示を偽る文字（ゼロ幅や双方向制御を含む Unicode の書式文字、行／段落区切り、ノーブレークスペース U+00A0）は拒否します。あなたが **Approve** を選びます（そのチャットで、またはそれが最新の質問である間は新しいチャットで）。その正確な回答を記録した後でのみ、型付きの設定コマンドがこのコマンドをインテントのチェックポイント用に認可します。

> 進捗: 30 ステージ中 16 ステージ完了。次: Functional Design。

### 構築フェーズ（ステージ 3.1〜3.7）

この新規のソース生成ソロワークフローは、**unit-major・直列チェックポイントの既定**の対象になります。2.9 の Bolt 計画は計画上の内容のままで、エンジンは `unit-of-work-dependency.md` から Unit を順にたどります。

**最初の Unit: notification-core — 動作する統合スライス**

コンダクターは、後続のどちらの Unit を始めるよりも前に、notification-core について適用対象の設計ステージと Code Generation を実行します。Functional Design は Notification と NotificationEvent のエンティティ、重複排除、流量制限を扱い、NFR とインフラの作業は該当する範囲で最初のスライスを扱います。生成の前に、あなたが要約を確認し、その Code Generation 計画を承認します。続いてこの Unit はイベントハンドラー、通知リポジトリ、アプリ内配信エンドポイントを生成します。この例ではソース 3 ファイルとテスト 4 ファイルです。

必要なレビューと完了レシートの後、コンダクターは記録済みのコマンドで検証を実行します。

```bash
aidlc engine bolt checkpoint --action verify --unit "notification-core" --kind skeleton
```

より長いプロジェクトチェックでは、`--action verify` に `--timeout-ms 3600000`（1 時間）を加えます。既定は 30 分で、値は 2,147,483,647 ミリ秒以下の正の整数でなければなりません。タイムアウトすると、所有するプロセスグループ/ツリーを終了させて、失敗した検証を記録します。終了を確認できない場合は、クリーンアップが不完全であることを報告します。[タイムアウトの契約](../reference/12-state-machine.md#construction-チェックポイント検証のタイムアウト) を参照してください。

`verify` が `verified: true` を報告し、現在のチェックポイントが `ready: true` になった後でのみ、コンダクターはセッションに結び付いた承認の質問を開きます。

```bash
aidlc engine bolt checkpoint --action ask --unit "notification-core" --kind skeleton
```

「Verified with `bun run verify:notifications` (exit 0). Approve this completed notification-core?」を **Approve** / **Request Changes** とともに提示し、待機します。コードスパンには要約ではなく、記録済みのコマンド全文が表示されます。あなたが **Approve** を選びます。承認を認可するのは、このチェックポイントの質問に対する、まさにその返答だけです。そのチャットで、またはそれが最新の質問である間は新しいチャットで返答できます。無関係な返答、エージェント自身の言葉、別の質問への返答は認可しません。コンダクターはあなたが返答したチャットで実際に選んだものを記録し、あなたが選んでいない `--user-input` を渡すことはありません。

```bash
aidlc engine bolt checkpoint --action approve --unit "notification-core" --kind skeleton --user-input 'Approve'
```

それ以前の Functional Design のレビューだけでは、統合が動作したことは確立できず、その回答でこのチェックポイントを認可することもできません。`verify` を再実行すると、このインテントについて、どのセッションのものであっても、開いているチェックポイントの質問と取得済みの返答が撤回されます。コマンドと成果物が変わっていなくても、コンダクターは再検証し、`verified: true` の後でもう一度尋ねなければなりません。swarm のバッチでは同じ規則が `finalize` に適用されます。新たな検証とソースの取り込みの後、`ready: true` を確認してから再度尋ねます。

自律性の選択がまだ記録されていなければ、ワークフローは次を提示します。

```
How should I continue building the remaining work?
  ▸ Continue automatically
  ▸ Review each checkpoint
```

あなたは **Continue automatically** を選びます。コンダクターは `autonomous` を記録し、直列のまま続行します。この承認の選択で swarm 実行が有効になることはありません。

**残りの Unit: notification-preferences、次に notification-email**

各 Unit は、次の Unit が始まる前に、それぞれ適用対象の設計ステージ、有効な要約確認、Plan Approval、コード、検査、レビューを経ます。

- **notification-preferences** — 設定エンティティ、既定値、チャネル切り替え、CRUD API、リポジトリ、検証。ソース 2 ファイルとテスト 3 ファイル。
- **notification-email** — 承認済みの設定参照契約を使う配信ルール、レンダラー、SQS コンシューマー、ダイジェストの cron ジョブ。ソース 4 ファイルとテスト 5 ファイル。

コンダクターは、記録済みの許可のもとで、検証済みの通常の Unit チェックポイントを `ask` や `--user-input` なしで自動承認できます。Plan Approval と検証コマンドの選択は引き続きあなたを待ちます。`directive.ceremony.summary_confirmation === "on"` のときの要約確認も同様です。すべての Unit が承認されると、completion-only のステージディレクティブが、ステージ本体やレビュアーの作業をもう一巡することなく記録を整えます。

**失敗した場合の見え方。** notification-email の検査が SES モックを構築できずに失敗した場合、ワークフローは停止して失敗を説明します。すでに完了した preferences の Unit は完了のままです。必要な修復計画の承認は引き続き人間の判断です。自動完了の許可が、失敗した検査の検証として扱われることはありません。

**ステージ 3.6 — ビルドとテスト**（aidlc-quality-agent。全ユニット完了後に 1 回だけ実行）

ビルド手順を生成し、3 つの作業ユニット全体で完全なテスト一式を実行します。47 テスト成功、失敗 0、網羅率 78% です。

**ステージ 3.7 — CI パイプライン**（aidlc-pipeline-deploy-agent）

リント、ビルド、テスト、セキュリティ走査の各ステージを持つ CI パイプラインを設定します。品質ゲートは網羅率 >= 75%、重大な脆弱性なしです。

> 進捗: 30 ステージ中 23 ステージ完了。次: デプロイパイプライン。

### 運用フェーズ（ステージ 4.1〜4.7）

**ステージ 4.1 — デプロイパイプライン** — 健全性確認ゲートを持つブルーグリーンデプロイ戦略

**ステージ 4.2 — 環境プロビジョニング** — SQS キュー、SES 設定、通知保存用 DynamoDB テーブル

**ステージ 4.4 — 可観測性セットアップ** — 通知配信遅延、メール送信率、デッドレターキュー深度の CloudWatch ダッシュボード。配信失敗用アラームも設定

**ステージ 4.7 — フィードバックと最適化** — SLO 目標（アプリ内配信 99.9%、30 秒以内のメール配信 99%）、コスト分析、フィードバックループ文書

### バグ修正との主な違い

| 観点 | バグ修正 | 機能開発 |
|--------|--------|---------|
| 実行ステージ数 | 9 | 33 |
| 深さ | Minimal | Standard |
| フェーズ | 初期化 + 構想 + 構築 + 運用 | 5 フェーズすべて |
| 作業ユニット数 | Unit DAGなし、ステージ単位 | 3 |
| 構築の実行順 | 従来のステージ単位 | unit-major・直列checkpoint。2.9はデリバリーを計画 |
| 条件付きステージ | 多くがスキップ | 多くが実行される |
| 承認ゲート | 通常のステージ承認 | 検証済みスケルトンを人間が承認。通常完了は方針に従い、Plan Approval・検証コマンド・有効な要約確認は人間が判断 |

---

## 次のステップ

- [スコープ、深さ、テスト戦略](05-scopes-and-depth.md) — スコープが実行ステージをどう決めるか
- [ステージの実行方法](04-phases-and-stages.md) — ステージ手順の詳細
- [エージェント](06-agents.md) — エージェントのペルソナと責務
- [成果物リファレンス](14-artifacts-reference.md) — 完全な成果物ディレクトリツリー
