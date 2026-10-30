# スコープ・深度・テスト戦略

スコープは **どのステージが実行されるか** を決めます。深度は各ステージが **どこまで詳しく書くか** を決めます。テスト戦略は **テストを何本出すか** を決めます。三つ揃って、ライフサイクルを仕事に合わせます。包括的なエンタープライズ機能から、速いバグ修正まで。

この章はルーティングの詳細です。どんなワークフローを実行するかを選ぶなら、先に [Workflow Profiles](workflow-profiles.md) を見てください。同じスコープを、利用者向けの言い方で説明しています。

---

## The 11 Core Scopes

コアは名前付きスコープを 11 個配っています。それぞれがステージ集合、既定の深度、既定の Guard Policy 値を持ちます（`enterprise` は strict。ほかは off。値が何をするか、どう設定するかは [Guard Policy](13-customization.md#guard-policy)）。プラグイン導入はスコープを足せます。導入側は `aidlc engine plugin select <names>` で、見えるプラグインスコープを狭められます。`plugins` 選択でコアを切る（`aidlc` を省く）と、コアのスコープファイルは導入されたまま残りますが、コアを再び有効にするまで実行時スコープとしては使えません。Initialization のステージは、有効なスコープならどれでも実行されます。

以下の各スコープのステージ数は、どのスコープも最初に実行する Initialization の 3 つのセットアップステージの後に実行するステージの数です。これは `/aidlc --help` が示す数であり、既存のコードでは計画のオファーと各ステージの開始が示す数です。新規プロジェクトではオファーが Reverse Engineering を除くので、それを実行するスコープでは、オファーが示す数は 1 つ少なくなります。

### enterprise

**使うとき:** 規制のあるエンタープライズ機能。監査証跡、コンプライアンスレビュー、本番級の運用が要るとき。

- **Stages:** 30 全部
- **Default depth:** Comprehensive
- **含む:** コンプライアンス、セキュリティ、運用のステージ全部

### feature

**使うとき:** 大きさに関わらず、新しい機能を 33 ステージのライフサイクルで作るとき。明示は `--scope feature` か `/aidlc-feature`。

- **Stages:** 30 全部
- **Default depth:** Standard
- **含む:** 全ステージ。成果物の詳しさは Standard

### mvp

**使うとき:** greenfield の最小実用製品。後半の運用は飛ばすが、設計と Construction は残す。

- **Stages:** 30 のうち 20
- **Default depth:** Standard
- **飛ばす:** Operation の 7 ステージ全部（デプロイパイプライン、環境の用意、デプロイ実行、可観測性、インシデント対応、性能検証、フィードバック）に加え、Ideation の Market Research、Team Formation、Approval Handoff（飛ばす 10、実行される 20）

### poc

**使うとき:** 実現性を早く確かめる。Ideation と Inception の大半を飛ばし、コードまで急ぐ。

- **Stages:** 30 のうち 5
- **Default depth:** Minimal
- **飛ばす:** Market Research、Feasibility、Team Formation、Mockups、User Stories、Operation の大半
- **Plan approval:** オフ。コード計画が書かれると、その計画を示す 1 行が表示されてコード生成が始まり、その行はいつでも計画の確認を頼めることを伝えます。作られる前に計画を見せるよう頼むことも、計画ごとに毎回尋ねるよう頼むこともできます

### bugfix

**使うとき:** 特定のバグを直す。インテント捕捉からコード生成とテストまで、細い道。

- **Stages:** 30 のうち 6
- **Default depth:** Minimal
- **含む:** Deployment Pipeline と Deployment Execution。検証した直しを出荷するため
- **飛ばす:** Market Research、Feasibility、Team Formation、Mockups、設計とアーキテクチャの大半、環境の用意、広い運用準備
- **手続き:** ステージの日誌も、修正の後の「Keep that for next time?」の質問もなく、成果物を書く前のサマリー確認もありません。センサー、すべてのステージ承認、plan approval はオンのままで、各ステージは主担当のエージェントだけで実行します。この作業で戻すには `/aidlc --learnings on`、`/aidlc --summary-confirmation on`、`/aidlc --collaborators on` を入力します

### refactor

**使うとき:** 振る舞いを変えずに、既存コードを整理または組み替える。

- **Stages:** 30 のうち 7
- **Default depth:** Minimal
- **含む:** Functional Design に加え、Deployment Pipeline と Deployment Execution
- **飛ばす:** bugfix に近い — コード分析、設計、実装、既存経路でのデプロイに絞る

### infra

**使うとき:** インフラの変更（新しい環境、CDK / CloudFormation の更新、コスト最適化）。

- **Stages:** 30 のうち 10
- **Default depth:** Standard
- **飛ばす:** ユーザー向けステージ（ストーリー、モック、ユーザーフロー）— アーキテクチャ、インフラ、デプロイに集中

### security-patch

**使うとき:** CVE や脆弱性への対応。セキュリティに効くステージを急ぐ。

- **Stages:** 30 のうち 7
- **Default depth:** Minimal
- **飛ばす:** Market Research、Team Formation、Mockups、セキュリティ以外の設計ステージ

### classic

**使うとき:** Inception と Construction を進め、各ステージで人が承認する（Construction では、作業に Unit があれば Unit ごとに承認する）v1 型の手続きを使いたいとき。条件付きステージは実行時にプロジェクトへ合わせます。Operation は予約枠として残し、ステージ定義の実行モードは変えません。コラボレーターはオフなので、各ステージはリードエージェントだけで実行します（`/aidlc --collaborators on` でサポートエージェントを加えられます）。

- **Stages:** 30 のうち 15
- **Default depth:** Standard
- **Default test strategy:** Standard
- **飛ばす:** Ideation 全体（1.1–1.7）、CI Pipeline（3.7）、Operation 全体（4.1–4.7）
- **Keywords:** なし。明示的な選択、または暗黙の既定値として使います。
- **手続き:** Walking Skeleton とサマリー確認は無効。センサーと学びの手順は有効です。レビューは各ステージで助言を一度行い、所見を承認ゲートへ出します。自律実行を明示的に選んだ場合の、マージ前の一度のレビューは維持します。

インテント単位の変更には `/aidlc --sensors on|off`、`/aidlc --learnings on|off`、`/aidlc --summary-confirmation on|off`、`/aidlc --plan-approval on|off`、`/aidlc --collaborators on|off` を使います。`AIDLC_DISABLE_SENSORS=1`、`AIDLC_DISABLE_LEARNINGS=1`、`AIDLC_DISABLE_SUMMARY_CONFIRMATION=1`、`AIDLC_DISABLE_PLAN_APPROVAL_GUARD=1`、`AIDLC_DISABLE_COLLABORATORS=1` は全体に優先して無効化します。あなただけがオフにできる plan approval を除き、承認ゲート、人間のターンの権限、監査、チームの書き込み保護は維持します。[手続きの切り替え](13-customization.md#手続きの切り替え)も参照してください。

#### Fewer stops for a workshop or small work

長い実行で停止を増やしうるのは、ステージごとの 2 つの確認、つまり修正の後の学びの質問とサマリー確認です。これらなしで計画を始めるには、依頼と一緒に両方のスイッチを入力します。そうすると、新しい作業は両方がオフの状態で作成されます。

```
/aidlc workshop --learnings off --summary-confirmation off <the work>
```

| スイッチ | 各ステージで省かれるもの | 失うもの |
|--------|-------------------------------|---------------|
| `--learnings off` | エージェントを修正したステージの承認ゲート前の "Keep that for next time?" という質問と、ステージの日誌（`memory.md`） | この作業からは `memory/project.md` にも `memory/team.md` にも何も書かれないため、次の実行はこの実行で学んだことを引き継ぎません。すでにメモリにあるプラクティスは引き続き読み込まれます |
| `--summary-confirmation off` | ステージが成果物を書く前に、回答の要約を確かめる `Looks correct` の確認 | ステージは回答からそのまま書きます。回答の読み違いは承認ゲートで成果物の中に現れ、そこで直すには修正一回分の手間がかかります |

どちらのスイッチも、ステージの質問や承認ゲートは省きません。`bugfix` と `express` は最初から両方がオフで、`classic` はサマリー確認がオフで始まります。すでに進行中の作業では、自分の言葉でどちらかを頼むか、`/aidlc --learnings off` または `/aidlc --summary-confirmation off` と入力してください。サマリー確認がオフになるのは、あなたが頼んだときだけです。

#### 進行中の classic を更新する

保存済みの工程計画は維持します。旧 classic で Operation が `EXECUTE` と記録されていれば、更新後もその工程を実行し、ルーティング、次ステージの検索、状態表示も保存済みの計画に従います。新規の classic には18ステージの構成を使います。

旧インテントに手続きの設定行がなければ、既定値は更新直後から変わります。Sensors と Learnings は `on`、Summary Confirmation は classic の既定値 `off` です。有効にするには `/aidlc --summary-confirmation on` を使うか、自分の言葉で頼んでください。保存済みの個別指定は維持され、環境変数による無効化が常に優先します。

レビュー上限も直ちに変わり、上書きしない限り、レビュアーのあるステージでは助言レビューを一度実行します。作業単位の `--review` レベルはスコープの上限を置き換えますが、ステージ自身のレビュークラスを超えることはできません。`--review adversarial` は、それを宣言しているステージで敵対的レビューを戻し、助言と宣言されたステージは助言のままです。`--review none` で下げることもできます。CI Pipeline と Operation を含む従来の構成を選ぶには、`aidlc engine scope change --scope workshop` を使います。workshop の既定テスト戦略は Minimal なので、本番用の Standard を維持する場合は `--test-strategy standard` も指定してください。

### workshop

**使うとき:** 進行付きのワークショップやトレーニングラボ。確立した Inception から Operation までのライフサイクルと、学習向けの軽いテスト下限。

- **Stages:** 30 のうち 23
- **Default depth:** Standard
- **Default test strategy:** Minimal
- **飛ばす:** Ideation のステージ全部（1.1-1.7）
- **Keywords:** `workshop`、`lab`、`training`

### express

**使うとき:** 要件からコードとテスト、条件付きのデプロイ末尾まで、いちばん軽い道。設計パスもレビュアー派遣も無し。

- **Stages:** 30 のうち 7
- **Default depth:** Minimal
- **Review cap:** なし
- **含む:** Initialization、条件付き Reverse Engineering、Requirements Analysis、Code Generation、Build and Test、条件付きの Deployment Pipeline、Deployment Execution、Observability Setup
- **飛ばす:** Ideation、設計、Units Generation、Delivery Planning、CI Pipeline、環境の用意、後半の運用ステージ
- **Plan approval:** poc と同じくオフ。各コード計画は、それを示す 1 行の後に書かれたとおりに作られ、その行はいつでも確認を頼めることを伝えます

---

## Scope Routing Table

正本は `.claude/scopes/aidlc-<name>.md`（スコープの識別情報）、プラグインのスコープファイル、各ステージの `scopes:` frontmatter（所属）です。コンパイル先は `.claude/tools/data/scope-grid.json`。コンパイル済みグリッドには、現在のプラグイン選択で有効なスコープだけが入ります。現在の表は `aidlc engine gen scope-table`（利用者向けのワークフロー／スコープの一行説明は `aidlc engine orchestrate help`）。

| Scope | EXECUTE / Total | Depth | Test Strategy | Use Case |
|-------|-----------------|-------|---------------|----------|
| `enterprise` | 33 / 33 | Comprehensive | Comprehensive | 規制のあるエンタープライズ機能。監査証跡まで |
| `feature` | 33 / 33 | Standard | Standard | 新機能のフルライフサイクル |
| `mvp` | 23 / 33 | Standard | Standard | greenfield。後半の運用は飛ばす |
| `poc` | 8 / 33 | Minimal | Minimal | 実現性を早く確かめる |
| `bugfix` | 9 / 33 | Minimal | Minimal | 特定のバグを直してデプロイ |
| `refactor` | 10 / 33 | Minimal | Minimal | 既存コードを整理してデプロイ |
| `infra` | 13 / 33 | Standard | Standard | インフラ変更 |
| `security-patch` | 10 / 33 | Minimal | Minimal | CVE 対応 |
| `classic` | 18 / 33 | Standard | Standard | v1 型の Inception と Construction。暗黙の既定値 |
| `workshop` | 26 / 33 | Standard | Minimal | 進行付きライフサイクル。学習向けのテスト |
| `express` | 10 / 33 | Minimal | Minimal | 要件から条件付きデプロイ。設計もレビュアーも無し |
| （提案） | 変動 | 変動 | 変動 | 自由文のインテントからエージェントが提案し、あなたが確認する |

スコープの手順は桁が違います。`poc` は範囲を絞った一連の処理、`feature` は Initialization の後に 30 ステージと承認ゲート 30（Reverse Engineering を飛ばす新規プロジェクトではそれぞれ 29）を実行し、Construction では 5 ステージ（設計 4 ステージと Code Generation）が作業ユニットごとに繰り返されます。スコープ確認の一行は、効く数字 — ステージ数、承認ゲート数、ユニットごとの広がり — を名前で出します。コンパイル済みグリッドとワークスペーススキャンから計算し、見積もりではありません。greenfield では Reverse Engineering が外れます。`units-generation` を飛ばすスコープは、ユニット DAG がないのでユニットごとの条項を出しません。ワークフローが始まる前に、何に同意するかが分かります。

> **プロジェクト単位の既定スコープ:** チームは `.claude/settings.json` の `AWS_AIDLC_DEFAULT_SCOPE` で、プロジェクトの既定スコープを先に置けます。[Customization § Per-Project Default Scope](13-customization.md#プロジェクト既定スコープ) を見てください。

---

## Stage-by-Scope Matrix

上のルーティング表は件数です。この行列は、配布スコープごとに **どの** ステージが実行されるかです。ワークフローを始める前に、通る道が見えます。✓ はそのスコープでステージが EXECUTE。空欄は SKIP。番号と名前は [Phases and Stages](04-phases-and-stages.md) と揃えています。

<!-- BEGIN scope-stage-matrix: derived from each stage's `scopes:` frontmatter via the compiled scope-grid.json — kept in sync by tests/unit/t244-scope-matrix-doc-sync.test.ts; do not hand-edit cells without re-checking that test -->
| # | Stage | `enterprise` | `feature` | `mvp` | `poc` | `bugfix` | `refactor` | `infra` | `security-patch` | `classic` | `workshop` | `express` |
|---|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 0.1–0.3 | Initialization (all 3 stages) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1.1 | Intent Capture & Framing | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| 1.2 | Market Research | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| 1.3 | Feasibility & Constraints | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| 1.4 | Scope Definition | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| 1.5 | Team Formation | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| 1.6 | Rough Mockups | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| 1.7 | Approval & Handoff | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| 2.1 | Reverse Engineering | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |
| 2.2 | Practices Discovery | ✓ | ✓ | ✓ |  |  |  | ✓ |  | ✓ | ✓ |  |
| 2.3 | Requirements Analysis | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2.4 | User Stories | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| 2.5 | Refined Mockups | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| 2.6 | Domain Design | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| 2.7 | Units Generation | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| 2.8 | Contract Design | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| 2.9 | Delivery Planning | ✓ | ✓ | ✓ |  |  |  |  |  | ✓ | ✓ |  |
| 3.1 | Functional Design | ✓ | ✓ | ✓ |  |  | ✓ |  |  | ✓ | ✓ |  |
| 3.2 | NFR Requirements | ✓ | ✓ | ✓ |  |  |  | ✓ | ✓ | ✓ | ✓ |  |
| 3.3 | NFR Design | ✓ | ✓ | ✓ |  |  |  | ✓ |  | ✓ | ✓ |  |
| 3.4 | Infrastructure Design | ✓ | ✓ | ✓ |  |  |  | ✓ |  | ✓ | ✓ |  |
| 3.5 | Code Generation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |
| 3.6 | Build and Test | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ | ✓ | ✓ |
| 3.7 | CI Pipeline | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ |  |
| 4.1 | Deployment Pipeline | ✓ | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| 4.2 | Environment Provisioning | ✓ | ✓ |  |  |  |  | ✓ |  |  | ✓ |  |
| 4.3 | Deployment Execution | ✓ | ✓ |  |  | ✓ | ✓ | ✓ | ✓ |  | ✓ | ✓ |
| 4.4 | Observability Setup | ✓ | ✓ |  |  |  |  | ✓ |  |  | ✓ | ✓ |
| 4.5 | Incident Response | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| 4.6 | Performance Validation | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| 4.7 | Feedback & Optimization | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |  |
| | **合計ステージ数** | **33** | **33** | **23** | **8** | **9** | **10** | **13** | **10** | **18** | **26** | **10** |
<!-- END scope-stage-matrix -->

✓ は静的な所属です。スコープの計画に入っている、という意味で、無条件に実行される、ではありません。CONDITIONAL のステージは、条件が満たなければ実行時に飛ばせます（例: Reverse Engineering は brownfield だけ）。未着手のステージは、承認したコンポーザー提案で形を変えられます（[the composer](#the-adaptive-composer)）。compose した（独自の）スコープはこの表に出ません。グリッドは配布スコープと並んで `scope-grid.json` にあります。

---

## The Agent Proposes the Plan

スコープを明示しなくても構いません。やりたいことを書けば、エージェントがあなたの言葉から計画を提案します。

```
/aidlc Build a REST API for inventory management
```

エンジンはあなたの依頼を保持し、このプロジェクトで AI-DLC が出荷しているすべての計画と一緒にエージェントへ渡します。各計画がここで何ステージ実行するか、何のための計画か、作者が計画ファイルに書いたヒント語（`scopes/aidlc-<name>.md` の `keywords:`）です。ヒントはあなたのほかの言葉と同じようにエージェントが読むもので、ツールが照合することはありません。エージェントは、あなたの説明に合う計画を提案し、それと一緒に質問が 1 つ出ます。数字はコンパイル済みグリッドからです。新規プロジェクトで `/aidlc Fix the timeout on the export endpoint` と入力すると次のようになりました。既存のコードベースでは bugfix は Reverse Engineering も実行するので、この行は 6 ステージ、承認ゲート 6 と表示します。

```text
 Plan
 I'd run the "bugfix" plan for: "Fix the timeout on the export endpoint" - 5 stages, 5 approval
 gates. Do you want me to go ahead with it, use a different plan, or tailor one to this task?
 > 1. Go ahead with the "bugfix" plan
      5 stages focused on fixing this specific bug.
   2. Use a different plan
      Pick another ready-made plan.
   3. Tailor a plan to this task
      Have a plan composed specifically for this fix.
   4. Type something.
   5. Chat about this
```

進めるなら go ahead、別の計画を使うなら use a different plan（エージェントがほかの計画をその長さとともに一覧するので、1 つ選ぶか名前を入力します）、ワークフロー開始前に進路を直すなら tailor を選びます。説明に合う既製の計画がないときは、エージェントが代わりに計画の調整を提案し（"None of the ready-made plans is an obvious fit for ..."）、その横に直接選べる計画が並びます。依頼と一緒に入力した設定（`--depth minimal`、`--learnings off`）は質問の回答に引き継がれるので、作業はそれらの設定で始まります。どの計画が提案されても、意図に合っているか確認してください。選ぶのは質問に答えるあなたです。

---

## The Adaptive Composer

計画が指定も提案もされないときに使う既定の計画は `classic` です（プロジェクトは `AWS_AIDLC_DEFAULT_SCOPE` で変更できます）。利用者が見る流れでは、エージェントが依頼を読み、既製の計画を提案するか、合うものがなければ計画の調整を提案します。あなたが答えるまで何も始まりません。compose を強制することもできます。

```
/aidlc compose "harden the deployment pipeline and add observability"
/aidlc-compose "same thing, as a typeable shortcut"
/aidlc compose --report sonar.json     # compose from a scan report
/aidlc --new-scope "..."               # force a custom plan even on a stock match
```

コンポーザーエージェントは仕事を読み、実装エントロピーの 5 成分 — インテントの曖昧さ、コードベース構造の不確かさ、検証エントロピー、リスク、未解消の前提 — を見積もり、最小で足りるワークフローを組みます。成果に必要な成果物は全部出る、いちばん薄い EXECUTE / SKIP グリッドです。構造の見積もりは、CodeKB MCP が設定され索引済みなら、そのコールグラフとコンポーネント分析に拠ります（任意の外部ツール。AI-DLC 同梱ではない）。無ければ、範囲付きワークスペーススキャン（brownfield / greenfield、言語）に落ちます。提案は短いオファーとして届きます。これがどんな種類の変更に見えるか、コンポーザーがどれだけの手続きを勧めるか、そして手順を平易な言葉で述べた 2〜3 文に続き、計画の名前、ステージ数、承認の質問を示す 1 行と、承認前に変更できる Guard Policy とスコープ設定の行が並びます。計画が残すステージが使うステージを、仕立てた計画が飛ばす場合（乗っている配布スコープが設計上外すもの以外）、オファーはそれらを示す 1 行でそのことを一度伝えます（「This plan skips Units Generation, which Contract Design, Functional Design and Code Generation use」）。頼めば、エージェントはスコア内訳（成分ごとに LOW / MED / HIGH 帯と根拠）と、EXECUTE / SKIP それぞれの理由を示します。既存のコードでは、仕立てた計画には常に Reverse Engineering が入ります。これは、もう一度スキャンする前に、以前のスキャンが残したコードマップを確認します。ただし、コンポーザーが CodeKB の根拠を持ち、それを外すことを提案する場合は除きます（下の CodeKB への接地を参照）。計画が作られると、そのスコアと根拠の取得方法は、作業の最初の監査エントリに残ります。承認、編集、却下。明示の承認まで、何も書かず、ワークフローも始まりません。計画は承認された作業にだけ適用されるので、頼まない限り compose がスコープ一覧に何かを足すことはありません。承認すると:

- 提案が配布スコープに MATCHED なら、AI-DLC はそのスコープでワークフローを直接作ります（コード水準の所見が多いスキャンレポートは、だいたいこの道で `bugfix` か `security-patch` に落ちます）。
- CUSTOM な計画なら、AI-DLC は同じターンで、いちばん近い適切な配布スコープ（walking skeleton がなく、計画の深度以外のテスト戦略を持たないもの。そのため計画はゲートで示したとおりに実行されます。新規プロジェクトでは、合うものがあれば `bugfix`、`refactor`、`security-patch` ではなく新しい作業向けのもの）の上に、計画自身のステージ変更と深度でワークフローを作り、スコープファイルは書きません。作業の状態には、コンポーザーが提案しゲートに表示された名前で `Plan: <name>` が記録され（名前がなければ `tailored plan`）、`/aidlc status` に表示されます。計画が乗っているスコープの名前はそこには出ません。CUSTOM な計画のゲートには 2 つ目の承認 **Approve and save as scope** があります。名前を尋ね（コンポーザーが候補を出します）、計画を再利用できるスコープとしても保存します。
- 後から計画を残すには、普通の言葉で頼みます（「この計画を quick-fix として保存して」）。AI-DLC は `aidlc engine scope save --name quick-fix` を実行し、実行中の作業の現在の計画を、その設定と Guard Policy ごとスコープとして書き出し、それを再利用するコマンド（`/aidlc --scope quick-fix "..."`）を示します。保存したスコープは配布スコープと同じように解決され、グラフ再コンパイルとエンジン再導入を生き延び、ハーネス間で持ち運べます（[保存したスコープの置き場所](#保存したスコープの置き場所)）。
- 画面／レポートの提案には、空でない `creationDescription` が付きます。compose 依頼に仕事の文があれば、その文そのもの。レポートだけ、または仕事文がない提案は、承認した所見／計画から導きます。同じターンの作成は、作業をそのゲートに結び付ける compose の `--request` id とともに、リテラル `--` 区切りのあと、シェル安全な argv 値 1 つとして渡します（シェルに出すときは POSIX の単引用符）。状態の Project 欄とインテントレコードの slug は、シェルメタ文字を含む説明や、フラグで始まる説明も保ちます。compose 承認は、スコープだけで説明無しでは進めません。
- ほかの作業があるのにどれも選ばれていないプロジェクト（インテントレコードがコミットされたリポジトリの新しいクローンなど）では、AI-DLC はまず、承認した計画がその作業の一部か、別の新しい作業か、その作業への変更かを尋ねます。別の新しい作業を選ぶと、承認した計画がそのステージ変更と設定のまま作られます。そこで別の配布計画を指定すると、同じ設定でその計画が始まり、承認した計画自身のステージ変更は使われません。どちらでも作業は一度だけ始まり、ゲートで伝えた「plan approval を省く」は引き続き有効です。

**ゲートでの設定:** 画面／レポートの提案は、ステージのグリッドに加えて、計画の Guard Policy と 6 つのスコープ設定（`sensors`、`learnings`、`summary_confirmation`、`plan_approval`、`collaborators`、`review_cap`）を示し、それぞれのまとまりを 1 行の理由付きで別の行に表示します。そのため compose した計画は、ステージそのものだけでなく、ステージの中の手続きも削れます。小さくてよく分かった修正なら、センサーと学びをオフにし、レビューを助言までに抑えて実行することもあります。MATCHED の提案は配布スコープの値から始まります。CUSTOM な計画はステージを自分で選びますが、手続きは compose しないときに使われるワークフローである `classic` スコープのものから始まります。Guard Policy はオフ、サマリー確認とコラボレーターはオフ、レビューは助言、センサー・学び・plan approval はオンです。コンポーザーが設定を動かすのは仕事にその理由があるときだけで（サマリー確認がオンに戻るのは仕事の曖昧さが高いときだけ）、メモリ層が strict にしていない限り Guard Policy はオフのままです。ゲートで引き上げることはできます。いずれの場合も、計画が乗る配布スコープと異なる値はこの作業にだけ適用され、新しいスコープファイルはできません。保存した計画では、それらの値が frontmatter に入ります。承認前に変更を頼めば反映されます。配布計画の Guard Policy を下げると、その値を持つ配布スコープの上の CUSTOM な計画になります。plan approval はゲートに表示された値を保つので、CUSTOM な計画は、乗っている配布スコープが尋ねずに作るものでもオンのままです。ゲートで「この作業は plan approval を省いて」と伝えると、あなたが設定したものとしてオフで作業が作られます。ほかの設定で承認ゲートがなくなることはありません。ワークフローの途中では普通の言葉で頼めば（「センサーをオフにして」「これはフルレビューにして」）、ゲートなしで実行中の作業に変更が適用されます（[手続きの切り替え](13-customization.md#手続きの切り替え)）。作業に設定したレビュー水準はスコープの上限を置き換えるので、レビューを強めてもステージは変わりません。スコープ自身の水準に設定すると、通常のレビューに戻ります。途中の compose でコンポーザーが自分から提案した設定はゲートに表示され、あなたが承認したときだけ適用されます。途中でサマリー確認をオフにするのは、あなた自身が行う変更です。普通の言葉で頼むか（「これからは looks correct の確認を省いて」）、ゲートで承認すると、エージェントがそれをオフにし、あなたの言葉と元に戻す方法を添えて 1 行で伝えます。plan approval をオフにできるのはあなただけで、自分の言葉で伝えるか `/aidlc config set plan-approval off` と入力します。コンポーザーがワークフローの途中でそれをオフにする提案をすることはありません。

**CodeKB への接地（任意）:** CodeKB は外部 MCP サーバです。コードベースの事前計算した構造分析（コールグラフ、コンポーネント一覧、パッケージ間結合）を出します。AI-DLC は同梱も必須もしません。無ければコンポーザーは、範囲付きワークスペーススキャンから構造を採点します。それが普通の道です。つなぐと、コンポーザーはそれを構造根拠の唯一の源にし、提案で引用します（`method: codekb`）。つなぎ方はハーネス次第です。Claude Code ではプロジェクトの `.mcp.json` にサーバを足す（サブエージェントはセッションの MCP を継ぐ）。Codex では `config.toml` に `mcp_servers` を足す。opencode では opencode 設定へ。Copilot CLI では `~/.copilot/mcp-config.json`、VS Code では `.vscode/mcp.json`。Kiro では `.kiro/settings/mcp.json`（または自分の `~/.kiro/settings/mcp.json`）に `"disabled": true` を付けずに足します。Kiro CLI の v2 エンジンでは、そのあと config をもう一度実行すると、コンポーザーエージェントに許可されます。v3 エンジンと Kiro IDE では、コンポーザーはそのまま使えます。CodeKB と、フレームワーク自身の "codekb" ディレクトリ（`aidlc/spaces/<space>/codekb/`）を混同しないでください。後者は Reverse Engineering ステージが書くローカル成果物ストアで、MCP サーバとは無関係です。CodeKB 根拠があると、コンポーザーは Reverse Engineering のスキップを提案することがあります。そのとき提案は、下流がそのローカルストア無しで実行されることを開示しなければならず、決めるのはゲートの人です。

**キーワードを汚さない:** 保存したスコープは `keywords: []` で出荷するので、保存した計画は、エージェントが計画を提案する段階にヒントを持ち込みません。将来のプロンプト向けにヒントを与えるのは、保存するときの明示の選択（`scope save --keywords <word,...>`。単語ごと。ほかの計画がすでに持っているヒントも保存され、計画の提案ではその両方の下に並ぶことを保存時に 1 行で伝えます）であり、副作用ではありません。

**途中の再 compose:** ワークフローの途中で `/aidlc compose` は、実行中のワークフローの PENDING ステージの形を変える提案を出します。もう要らないものは飛ばし、要ると分かった未着手ステージを戻す。コンポーザーは、完了したステージが実際に解消したことからエントロピー成分を再見積もりするので、提案する反転はどれも、スコアを動かした根拠を名前で出します（「実現性が結合の問いを片付けた — リスクは MED に再採点」）。反転が効くのは未着手で、カーソルより先のステージだけです（完了と進行中は凍結）。厳格検証するので、残るステージが必須入力を失いません。監査ロックの下、決定論的な `recompose` 動詞で着地し、`RECOMPOSED` 監査イベントが残ります。1 回の承認でステージ変更と設定の両方を扱うときは、同じ `recompose` が 1 回の書き込みで両方を適用するので、計画が中途半端に変わった状態で残ることはありません。サマリー確認のオフは専用の設定を通り、あなたが承認していれば、エージェントがその直後に適用します。Construction の最初の EXECUTE ステージは recompose で反転できません。これはルーティングの基点を守るためのもので、最初の設計ステージのレビューが動作する統合スケルトンの証明になるという意味ではありません。

動詞そのものは要りません。途中の普通の会話「ほかに削れるものは？この市場はもう分かっている」は、形を変える依頼として認識され、同じゲート、同じ `recompose` 動詞へ流れます。ステージを自分で名前したとき（「市場調査は飛ばせる？」「market-research と team-formation を落とす」）は、ゲートなしですぐに計画が変わり、返答に元に戻す方法が示されます。計画が受け付けられない変更は、それでも `recompose` が理由を示して拒否します。代わりに計画を名前で指定したとき（「これを express の計画に切り替えて」）は、`/aidlc --scope express` と同じように、ゲートなしでその場で作業がその計画に切り替わります。終わったものは終わったままで、返答は何が変わったかを伝えます。貼り付けたドキュメントの中の文は、ステージの指定として数えません。Claude 以外のハーネスでは、リテラル `/aidlc compose "<request>"` が文書上の確実な道です。

### 保存したスコープの置き場所

配布スコープはエンジンのものです。ビルドのたびにハーネスツリーへ再生成されます。compose した計画から保存したスコープは *あなたのもの* です。エンジンの何もそれを作らないので、ほかの作業と一緒に保存されます。

| | Path | Role |
|---|---|---|
| **Record** | `aidlc/scopes/<name>.md` | 永続的な正本。あなたのスコープファイルと、EXECUTE/SKIP 計画を持つ生成領域を 1 ファイルにまとめたもの。ほかの `aidlc/` ツリーと一緒にコミットします |
| **Projection** | `<harness>/scopes/aidlc-<name>.md` + `scope-grid.json` の列 | 実行時に読まれるもの。`aidlc engine graph compile` が正本から再生成します |

ここから 2 つのことが言えます。どちらも以前はうまくいきませんでした。

- **エンジンを再導入してもスコープは失われません。** ハーネスツリーを置き換えると投影は消えますが、次の `graph compile` が正本から作り直します。これは特にコピー経路で効きます。コピー経路では `scope-grid.json` は生成ファイルで、コピーし直すたびに置き換わります。
- **保存したスコープはハーネス間で持ち運べます。** 正本は共有のツール非依存の `aidlc/` ツリーにあるので、`.kiro/` や `.codex/` で作業するコラボレーターも、あなたが `.claude/` で保存したスコープを、`graph compile` を一度実行すれば解決できます。

以前のリリースで compose したスコープは、ハーネスツリーの中にだけあります。更新後の最初の `graph compile` が、一度だけその正本を書いてくれます。以降は正本が源泉です。

#### 正本の形

センチネルのコメントより上はすべて、あなたが編集してかまいません。frontmatter も本文も、自分の Markdown 見出しやコードフェンスも含みます。センチネルの間はすべて生成されたものです。この領域はファイルの **末尾** として扱ってください。本文はその上に書きます。`graph compile` がハーネスツリーへ投影するのはその部分だからです。END センチネルの *下* に追記したものも正本には残りますが（既存の正本を書き換えるものは何もありません）、ハーネスのスコープファイルには持ち込まれません。

````markdown
---
name: my-lean-feature
depth: Standard
keywords: []
---

# my-lean-feature

Whatever you want to write, including a "## Stage Grid" heading of your own.

<!-- BEGIN aidlc composed-scope-grid: generated by `aidlc engine graph compile` — reshape the plan through /aidlc compose, not by editing here -->

```json
{ "stages": { "intent-capture": "EXECUTE", "units-generation": "SKIP" } }
```

<!-- END aidlc composed-scope-grid -->
````

計画の形は、この領域を編集するのではなく `/aidlc compose` で変えてください。手で編集したグリッドはステージグラフと照合されないため、ステージに必要な入力を欠けさせることがあります。

センチネルより上の部分の編集はかまいませんが、`graph compile` がハーネスのスコープファイルを書くのは、それが **存在しない** ときだけで、編集済みのものは上書きしない点に注意してください。そのため正本の `depth` や `description` を変えたら、`<harness>/scopes/aidlc-<name>.md` を削除して再コンパイルし、投影し直します。計画自体は常に正本から読むので、影響するのは説明用のフィールドだけです。

#### 正本が読めないとき

frontmatter、`name`、生成されたグリッド領域のどれかが欠けた正本は、ファイルパスと必要な修正を示して `graph compile` と `aidlc update` を **止めます**。コミットされた作業なので、黙って飛ばすことはありません。示されたファイルを修復するか、削除してください。ハーネスの投影がまだ残っていれば、次の compile がそこから新しい正本を補います。`/aidlc --doctor` の **Composed scope durability** チェックは、グリッドの列がないスコープファイル、まだ投影されていない正本、スコープが解決できなくなった実行可能なワークフローを報告します。

---

## The 3 Depth Levels

深度は、各ステージが出す成果物の詳しさです。スコープが既定を置きますが、上書きできます。

| Depth | Artifact Detail | When to Use |
|-------|----------------|-------------|
| **Minimal** | 核だけ。短い文書、主要な判断、補助分析は最小。 | 速い直し、パッチ、概念実証 |
| **Standard** | バランス。要件は揃え、アーキテクチャ判断には根拠、テスト計画は一通り。 | 大半の機能と MVP |
| **Comprehensive** | エンタープライズまで。要件は網羅、コンプライアンスマトリクス、詳しい NFR 仕様、監査文書一式。 | 規制のある機能、エンタープライズ配備 |

### How depth affects stages

各ステージで、エージェントは現在の深度に合わせて出力を変えます。

- **Minimal:** 成果物 1〜2 ページ。主要な判断だけ。任意セクションは飛ばす
- **Standard:** 成果物は揃える。必須セクション全部。根拠は簡潔
- **Comprehensive:** 成果物を広げる。任意セクションも含む。根拠は詳しく、コンプライアンス相互参照

### Overriding depth

深度は 3 か所で変えられます。

1. **`--depth` CLI フラグ** — 起動時に上書き:
   ```
   /aidlc --depth comprehensive
   /aidlc --scope bugfix --depth standard
   /aidlc --stage code-generation --depth minimal
   ```
2. **スコープ確認のとき** - エンジンが提案した計画の確認を求めたら、確認だけでなく `--depth <level>` で返す
3. **どの承認ゲートでも** — フィードバックの一部として、別の深度を求める

エージェントは、セッションごとに一度、最初の完了メッセージで、現在の深度（各文書にどれだけの詳細を書くか）とテスト戦略（どれだけのテストを書くか）、そしてどちらもどの承認ゲートでも変更を頼めることを思い出させるよう求められています。いつでも、自分の言葉で、または `/aidlc --depth <level>` で頼めます。

---

## Specifying Scope Directly

### Explicit scope

```
/aidlc feature
/aidlc bugfix
/aidlc enterprise
```

### Scope with description

```
/aidlc bugfix Fix the login timeout issue
/aidlc poc Build a quick prototype for the search feature
```

### Override scope with utility command

```
/aidlc --scope bugfix
/aidlc --scope enterprise --stage code-generation
```

`--scope` フラグは `--stage`、`--phase`、`--depth` と組み合わせてジャンプできます。

### Override depth

```
/aidlc --depth minimal
/aidlc --scope bugfix --depth comprehensive
/aidlc --scope enterprise --depth standard --stage code-generation
```

`--depth` フラグは、スコープの既定深度を上書きします。有効な値: `minimal`、`standard`、`comprehensive`（大文字小文字は問わない）。

### Override test strategy

```
/aidlc --test-strategy minimal
/aidlc --depth standard --test-strategy minimal
```

`--test-strategy` フラグは、深度とは独立にテスト戦略を上書きします。詳しくは下の [The 3 Test Strategy Levels](#the-3-test-strategy-levels)。

---

## The 3 Test Strategy Levels

テスト戦略は **テストを何本出すか** と **どの種類を入れるか** を決めます。深度とは独立です。深度は成果物の詳しさ（文書、図、質問）、テスト戦略はテスト量だけです。分かれているので、速さの方がカバレッジより大事なとき、Standard 深度のフルワークフローに Minimal テストを載せられます。

### Minimal — Nyquist model

信号処理の Nyquist レートから借りています。信号を復元するのに必要な最小サンプリング周波数。Minimal テスト戦略は、要件をすべて検証するのに必要な最小のテストを出します。過不足なく検証します。

- **識別した要件につきテスト 1 本**（要件駆動。コンポーネント駆動ではない）
- **ハッピーパス下限:** 要件が対応していなくても、コンポーネントごとにハッピーパスのユニットテストを少なくとも 1 本
- **既定はユニットテスト。** bugfix / security-patch の狙い撃ち回帰は、欠陥を再現するいちばん狭い段が統合や E2E ならそれを使います。関係ないテスト量は Minimal のまま
- 典型的な案件で **合計およそ 5〜15 本**
- 柔軟な目安 — 安全が重要な文脈では、エージェントは超えてよい

**向く仕事:** ワークショップ、トレーニング、概念実証、速いバグ修正 — 正しさは確かめたいが、テスト一式には投資しないとき。

### Standard — per-component model

コンポーネント間の境界を検証する、バランスの取れたカバレッジ。

- **コンポーネントあたり 5〜8 本**
- **ユニット + 統合テスト**（コンポーネント間の主要な境界）
- E2E、性能、セキュリティは、NFR が明示で求めたときだけ
- **テストピラミッド比:** ユニットおよそ 75% / 統合およそ 20% / E2E およそ 5%
- 柔軟な目安

**向く仕事:** 大半の機能と MVP — 過投資せず、十分なカバレッジ。

### Comprehensive — full coverage model

テスト種類を横断した、厚いカバレッジ。

- **コンポーネントあたり 10〜15 本**
- **全種類:** ユニット + 統合 + E2E + 性能（NFR があれば）+ セキュリティ（NFR があれば）
- **テストピラミッド比** は種類をまたいで効く
- 柔軟な目安

**向く仕事:** エンタープライズ機能、規制のあるシステム、テストカバレッジの監査証跡が要るとき。

### How test strategy defaults work

コアの大半のスコープは、テスト戦略を深度から継ぎます。したがって `classic` は本番の Standard テスト下限、`express` は要件駆動の Minimal 下限です。`workshop` は学習セッション向けに、Standard 深度でも明示の Minimal 上書きを残します。いつでも `--test-strategy` で上書きできます。

### Overriding test strategy

テスト戦略は 3 か所で変えられます。

1. **`--test-strategy` CLI フラグ** — 起動時に上書き:
   ```
   /aidlc --test-strategy minimal
   /aidlc --depth standard --test-strategy minimal
   /aidlc --scope bugfix --test-strategy comprehensive
   ```
2. **ワークフローの途中** — 実行中のワークフローのテスト戦略を変える:
   ```
   /aidlc --test-strategy comprehensive
   ```
3. **どの承認ゲートでも** — フィードバックの一部として、別のテスト戦略を求める

### Common depth + test strategy combinations

| Depth | Test Strategy | Effect | When to use |
|-------|--------------|--------|-------------|
| Standard | Standard | 成果物はフル、テストはバランス | Feature、classic、そのほか本番スコープ |
| Standard | Minimal | 成果物はフル、Nyquist テスト | ワークショップ、時間を切ったセッション |
| Minimal | Minimal | 成果物は薄く、要件駆動テスト | Express、速いバグ修正、パッチ |
| Comprehensive | Comprehensive | 全部フル | 規制のあるエンタープライズ機能 |
| Comprehensive | Standard | 成果物はフル、テストはバランス | エンタープライズで、テストは現実的に |
| Minimal | Comprehensive | 成果物は薄く、テストは厚い | 確信度が要る重要なバグ修正 |

---

## Choosing the Right Scope

| Situation | Recommended Scope |
|-----------|------------------|
| 本番アプリの新機能 | `feature` |
| ゼロからの greenfield 製品 | `mvp` または `feature` |
| 方針の速い検証 | `poc` |
| 直すべき既知のバグ | `bugfix` |
| 振る舞いを変えないコード整理 | `refactor` |
| 新しい AWS 環境や CDK の変更 | `infra` |
| CVE や脆弱性への対応 | `security-patch` |
| コンプライアンスが要る規制機能 | `enterprise` |
| v1 型の Inception と Construction を少ない手続きで進める | `classic` |
| 要件からデプロイまでの軽い通し | `express` |
| AI-DLC のワークショップやトレーニングラボ | `workshop` |

迷ったら、変更の大きさで計画を選びます。小さくてよく分かっている変更なら、すべてのステージを実行する `feature` から始めるのではなく、`express`（既知のバグなら `bugfix`）から始めて、欲しいステージを 1 つ足します。

```
/aidlc express --add functional-design <the change>
/aidlc bugfix --add functional-design <what is broken>
```

`--add` はこの作業の計画にだけステージを加え、スコープの残りはそのまま保つので、Functional Design を加えた `express` も、レビュアー、センサー、学びの質問、サマリー確認、plan approval なしで実行されます。変更の前にまずコンポーネントに名前を付ける必要があるなら、代わりに `domain-design` を足してください。すでに進行中の作業では、`/aidlc --add <stage>` でまだ実行していないステージを加えられます（[CLI Commands](12-cli-commands.md) の `--skip` / `--add` を参照）。全ライフサイクルが必要な本番機能には `feature` を、Ideation と Operation を省いた v1 型の Inception と Construction には `classic` を選んでください。

---

## Next Steps

- [Phases and Stages](04-phases-and-stages.md) — 各ステージの中身
- [Agents](06-agents.md) — どのエージェントがどのスコープに入るか
- [Skills and Runner Commands](17-skills.md) — bugfix、express、feature、mvp、security-patch 向けの一語 `/aidlc-<scope>` ランナー
- [CLI Commands](12-cli-commands.md) — コマンド一覧
- [Glossary](glossary.md) — 用語
