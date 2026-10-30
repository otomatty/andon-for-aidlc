# アーキテクチャ

> **出典**: エンジンとコンダクター（`.claude/tools/aidlc-orchestrate.ts` と `.claude/skills/aidlc/SKILL.md`）およびその周辺ファイルから導出。

## 概要

AI-DLC はハイブリッド実行モデルを採用します。いくつかのステージはインラインで実行され（コンダクターがエージェントペルソナを読み込み、会話内で直接実行する）、別のステージは Claude Code のタスクツール経由でサブエージェントへ委譲されます。インラインステージはユーザーとの対話（質問、確認、承認）を支えます。サブエージェントステージは自律的に実行され、構造化サマリーを返します。

```mermaid
graph LR
    subgraph INITIALIZATION["初期化 (0.1-0.3)"]
        Z1["ワークスペーススキャフォールド"]
        Z4["状態初期化"]
        Z1 -.->|"3 ステージ"| Z4
    end

    subgraph IDEATION["アイデエーション (1.1-1.7)"]
        I1["インテント取得"]
        I7["承認とハンドオフ"]
        I1 -.->|"7 ステージ"| I7
    end

    subgraph INCEPTION["インセプション (2.1-2.9)"]
        N1["リバースエンジニアリング"]
        N7["デリバリープランニング"]
        N1 -.->|"9 ステージ"| N7
    end

    subgraph CONSTRUCTION["コンストラクション (3.1-3.7)"]
        C1["機能設計"]
        C7["CI パイプライン"]
        C1 -.->|"ユニットごとに 5 ステージ、その後 2 ステージを 1 回"| C7
    end

    subgraph OPERATION["オペレーション (4.1-4.7)"]
        O1["デプロイメントパイプライン"]
        O7["フィードバックと最適化"]
        O1 -.->|"7 ステージ"| O7
    end

    Z4 -->|"自動進行"| I1
    I7 -->|"検証ゲート 1"| N1
    N7 -->|"検証ゲート 2"| C1
    C7 -->|"検証ゲート 3"| O1
    O7 -.->|"フィードバックループ"| I1

    style INITIALIZATION fill:#f3e5f5,stroke:#9c27b0,color:#000
    style IDEATION fill:#e8f5e9,stroke:#4caf50,color:#000
    style INCEPTION fill:#e3f2fd,stroke:#2196f3,color:#000
    style CONSTRUCTION fill:#fff3e0,stroke:#ff9800,color:#000
    style OPERATION fill:#fce4ec,stroke:#e91e63,color:#000
```

## 5 層

**ルール**（スペースのメモリ層 `aidlc/spaces/<active-space>/memory/`。`rules/aidlc.md` の @-import スタブ経由で読み込まれる） -- org、team、project、フェーズの各ルールファイルです。フレームワークの作業慣行・テスト・デプロイ・コードスタイルの既定値、Guard Policy セクション、ガードレールのセクション（`## Forbidden`, `## Mandated`, `## Corrections`）を含みます。自己学習型であり、確認された人間の修正はプラクティスとしてそこへ書き込まれます。

**エージェント**（`agents/*.md`） -- 14 個のフラットなエージェントファイルです。11 のドメイン専門家ペルソナ、2 つのレビュー専用エージェント、そして適応ワークフローのコンポーザーからなります。各ファイルがロール、責務、コラボレーションパターン、ツール、関連するメモリの焦点を定義します。著述されたコアのペルソナは `disallowedTools: Task` を持ちます。パッケージャーは、対応しているハーネスではそのネイティブな拒否をそのまま保ち、対応していないハーネスには「入れ子の委譲を許さない」という同じ境界をそのハーネスのツールポリシーへ投影します。Kiro のエージェント Markdown はこの未対応キーを省略し、Kiro CLI のエージェント JSON と Kiro IDE の `tools:` 許可では、委譲先から `subagent` ツールを除外します。

**ナレッジ**（`knowledge/`） -- 2 層の方法論リファレンスです。
- `aidlc-shared/` -- 原則、検証、ブラウンフィールド保護策、**監査イベント分類体系**（正準イベントレジストリ）、状態テンプレート
- `aidlc-<agent>-agent/` -- エージェントごとの方法論ファイル（アーキテクチャパターン、テスト戦略など）

**スキル**（`skills/aidlc/`） -- オーケストレーターのエントリポイント（`SKILL.md`。ワークフロー計画を合成するときだけ読む `composer.md` の付属文書を含む）、静的／回復／ガバナンスの各プロトコルファイルに加えて `aidlc-common/protocols/` 配下の条件付きで読み込まれるレビュアー／アンサンブル／構築／スウォーム／学びの 5 モジュール、そして `aidlc-common/stages/` 配下の 5 つのフェーズディレクトリ（`initialization/`, `ideation/`, `inception/`, `construction/`, `operation/`）にまたがる 33 個のステージファイルです。

**フック**（`hooks/`） -- 監査出力（書き込み・編集後のツール使用時）、セッションライフサイクル（開始・終了）、状態同期（タスク更新後のツール使用時）、状態検証（圧縮前）、サブエージェント追跡（停止時）、ステータスライン描画のためのフレームワークフックです。フレームワークファイルはすべて `aidlc-*.ts` という接頭辞を持ちます。

## 設定レイヤー

> **対象読者**: 新しい関心事（ルール、方法論の一片、センサー束縛、ドメインナレッジの事実）をどこへ置くべきか判断するコントリビューター。
> **正本としての位置付け**: これはルーティング原理です。コードとこの節が食い違う場合は、この節が正であり、コードの分類が誤っています。

このリポジトリの設定は、1 つではなく**2 つの直交軸**に沿って分割されます。

### 軸 1 -- 誰が著述するか?

- **フレームワーク著述** -- AI-DLC 配布物に同梱されます。すべてのプロジェクトで内容は同じです。フレームワークのリリース時に更新されます。ユーザーが自分のワークスペースで編集することはありません。
- **チーム著述** -- 人間が書くものです（または、このワークスペースで動くステージが書き、その後に人間が確認したもの）。このプロジェクト固有であり、このワークスペース内ではワークフローをまたいで永続します。編集可能です。

### 軸 2 -- いつ消費されるか?

- **継続的に読み込まれる（ハーネス設定）** -- セッション開始時に読まれ、このワークスペースで走るあらゆるワークフローのすべてのステージで利用可能です。`.claude/` 配下にあります。
- **ワークフロー単位の成果物** -- 特定ステージが出力として生成し、後続ステージが入力として読むものです。インテントの記録ディレクトリ（`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`。以下では `<record>/` と表記）に置かれます。ワークフローの実行ごとに再生成されます。

### 4 つの象限

2 つの軸を掛け合わせると 4 つの象限になります。3 つは使われ、1 つは意図的に空です。

|  | フレームワーク著述 | チーム著述 |
|---|---|---|
| **継続的に読み込まれる**（ハーネス設定） | `.claude/skills/`, `.claude/agents/`, `.claude/knowledge/`, `aidlc/spaces/<active-space>/memory/org.md`, `aidlc/spaces/<active-space>/memory/phases/*.md`, `.claude/scopes/`, `.claude/tools/data/scope-grid.json`, `.claude/tools/data/stage-graph.json` | `aidlc/spaces/<active-space>/memory/team.md`, `aidlc/spaces/<active-space>/memory/project.md` |
| **ワークフロー単位の成果物** | *(設計上空)* | `<record>/aidlc-state.md`, `<record>/audit/*.md`（クローンごとの分割記録）, `<record>/<phase>/<stage>/*.md`, `.aidlc/worktrees/bolt-<id8>_<slug>/` |

フレームワークはワークフロー単位の成果物を生成しません。そうした出力は配布物とともに出荷しなければならず、その時点でそれはワークフロー出力ではなくフレームワーク著述のハーネス設定になるからです。この空セルは欠落ではなく、ルーティング規則の特徴です。

> **フレームワーク著述 = 上流から届くもの。プロジェクト内では不変として扱います。** これはバージョン管理やファイルシステムで強制されるわけではありません。`.claude/` は編集可能な領域であり、`org.md` や `phases/*.md` をその気になれば編集できます。ただし慣例は、フレームワーク既定値を直接書き換えるのではなく、`team.md` / `project.md`（右側のセル）に自分たちのプラクティスを追加することです。そうすればレビュー時に追加内容が可視化され、フレームワークのアップグレードもきれいに通り、同じフレームワークバージョンを共有する複数プロジェクト間のドリフトも防げます。

### 新しい関心事を配置するための境界テスト

新しい関心事が来たとき、配置先は次の 2 つの問いで決まります。

1. **すべてのプロジェクトで同じ内容か、それともプロジェクト固有か?** フレームワーク著述かチーム著述か。
2. **毎セッション、エージェントコンテキストへ読み込まれるか、それとも特定ステージだけが読むか?** ハーネス設定かワークフロー単位の成果物か。

具体例:

- *「常に既定ブランチへスカッシュマージする」* -- プロジェクト固有です（ほかのチームはリベースを使う）し、継続的に読み込まれます（コンダクターは毎回のボルトマージでそれを読みます）。置き場所は `aidlc/spaces/<active-space>/memory/team.md` です。
- *「サービスレイヤーでは常に成功値またはエラー値を返し、例外は絶対に投げない」* -- プロジェクト固有で、継続的に読み込まれます（エージェントが毎回のコード生成で読みます）。置き場所は `aidlc/spaces/<active-space>/memory/project.md` です。
- *「推奨ブランチ戦略はトランクベース開発である」* -- すべてのプロジェクトで同じ内容（フレームワークの見解）であり、継続的に読み込まれます（デリバリープランニングで読まれます）。置き場所は `aidlc/spaces/<active-space>/memory/org.md` です。
- *「一般的な 5 つのブランチ戦略とそのトレードオフ」* -- すべてのプロジェクトで同じ内容（フレームワークリファレンス）であり、継続的に読み込まれます（分岐戦略を発見するときにパイプラインデプロイ担当エージェントが読みます）。置き場所は `.claude/knowledge/aidlc-pipeline-deploy-agent/branching-strategies.md` です。
- *「この実行の要求分析」* -- プロジェクト固有で、ワークフロー単位です（各実行が新しい分析を生みます）。置き場所は `<record>/inception/requirements-analysis/` です。
- *「コンストラクション途中にpayments Unitをホストするワークツリーの状態」* -- プロジェクト固有で、ワークフロー単位です（スウォームモードのボルトごとに再生成されます）。置き場所はそのワークツリー側の記録ディレクトリのコピー、`.aidlc/worktrees/bolt-7c31e9a0_payments/<record>/aidlc-state.md` です。[Bolt の識別子](https://github.com/awslabs/aidlc-workflows/blob/6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a/core/knowledge/aidlc-shared/worktree-info-schema.md#bolt-identity) は、Unit の claim と同じインテント UUID の接尾辞を使います。

### ハーネス設定（上段）の下位分類

上段はさらに**内容の形**で分割されます。

- **フレームワークのハーネスメカニクス** → メタデータ / JSON。ワークフロー順序、ステージ定義、成果物生成、ゲート意味論。ツールが決定論的に読みます。配置先は `.claude/skills/`, `.claude/tools/data/` です。
- **フレームワークのドメインリファレンス** → `.claude/knowledge/aidlc-<agent>-agent/` 配下のエージェント KB 散文。各ドメインにおける選択肢のメニュー（5 つのブランチ戦略、デプロイメントパターン、テスト方法論）。必要になった時に所有エージェントが読みます。
- **フレームワークの方法論既定値** → `aidlc/spaces/<active-space>/memory/org.md` にある散文。チームが別の確認をしない限りフレームワークが推奨する内容です。チームの声で書かれます（チームが自分たちのプラクティスを追加するまでは、組織層の既定値がそのままチームの声になるため）。
- **チームのプラクティス** → `aidlc/spaces/<active-space>/memory/team.md` にある散文。チームが選んだやり方、つまり「これが私たちの働き方」です。プラクティス発見の確認ゲートによって内容が入ります。エージェントは意思決定点で読みます（デリバリープランニングはブランチ戦略を読み、コンダクターは `SKILL.md` のウォーキングスケルトン方針を読みます）。
- **プロジェクトオーバーライド** → `aidlc/spaces/<active-space>/memory/project.md` にある散文。チーム層と組織層の既定値と並んで読み込まれる、プロジェクト固有の修正です。適用されるすべての層は加算的であり、独自の解決方法を宣言するフィールドはそれぞれのリゾルバーを使います（`tier_cap` ではプロジェクトがチームと組織より優先します）。これもプラクティス発見の確認ゲートによって内容が入ります。
- **ガードレール**（`## Forbidden`, `## Mandated`, `## Corrections` セクション） -- `org.md`, `team.md`, `project.md` に存在します。エージェント向けの是正ルール、つまり `ALWAYS X`, `NEVER Y` です。継続的にエージェントコンテキストへ読み込まれます。

### `.claude/` 直下へ置いてはいけないもの

設定のように見えても、そうではないケースが 2 つあります。

- **永続的なリポジトリ分析出力。** リバースエンジニアリングの 9 つのブラウンフィールド成果物（`code-structure.md`, `architecture.md` など）は、1 つのリポジトリに対する最新の走査を記述するものです。`.claude/` やインテントの記録ではなく、`aidlc/spaces/<active-space>/codekb/<repo>/` に置かれます。リバースエンジニアリングは該当する各ワークフローで再実行され、そのリポジトリ単位の共有ナレッジを更新します。
- **実行状態。** `aidlc-state.md` ファイルは、ワークフロー単位の現在時点の真実です。`.claude/` ではなくインテントの記録ディレクトリに属します。`audit/` の分割記録も同様です。

### 行をまたぐ昇格 -- プラクティス発見の例外

ほとんどのステージは 1 行だけに書き込みます。少数のステージは両方の行に書き込みますが、その行またぎ書き込みはチームの確認によってゲートされます。**これを行う唯一のステージがプラクティス発見（インセプション 2.2）です。** その出力は次のとおりです。

- `<record>/inception/practices-discovery/team-practices.md` -- ワークフロー単位の監査証跡（下段）。
- 確認後、内容はスペースメモリ層へコピーされます。`aidlc/spaces/<active-space>/memory/team.md` と `memory/project.md` の両方、つまりチーム著述のハーネス設定（右上セル）です。

監査証跡側のコピーは、この実行で何が確認されたかを証明します。スペースメモリ側のコピーは、今後のすべてのワークフローで読み込まれるチームの常設設定になります。

このパターン（走査 → 下書き → 確認 → 公開）は、構造としてはリバースエンジニアリングに一致します。違いは**結果**です。リバースエンジニアリングの確認は単に「この走査は正確だ」を意味しますが、プラクティス発見の確認は「フレームワークがこの文言を私たちの常設設定へ書き込み、今後のすべてのワークフローで読み込んでよい」を意味します。

この確認ゲートがなければ、フレームワークがチームの口を勝手に借りることになります。しかもその言葉はワークフローをまたいで永続します。ゲートがあることで、最終的には常にチーム自身がそれを書いたことになります。

このパターンはまれであり、意図的であるべきです。使ってよいのは次の 3 条件がすべて真のときだけです。
1. そのステージの出力が、チーム、プロジェクト、またはワークスペースに関する構成的真実である。
2. その真実が、この実行の下流ステージだけでなく、今後のすべてのワークフロー実行へ影響すべきである。
3. チームがその真実の著述者になる意思を持ち、単にフレームワークに書かせるのではなく、ゲートでレビューして承認する。

3 条件のどれか 1 つでも偽なら、既定はワークフロー単位専用です。

### 参照先

- [エージェントシステム](05-agent-system.md) -- エージェントファイル構造（左上セルのメカニクス）。
- [ナレッジシステム](10-knowledge-system.md) -- `knowledge/` の 2 層構造。
- [ステージ定義](15-stage-definition.md) -- ステージメタデータ仕様（ハーネスメカニクスのフォーマット）。
- [ステージプロトコル](04-stage-protocol.md) -- ステージごとの実行規則。

## 実行モデル

**インラインステージ** -- コンダクターは、ペルソナの枠組みとして先導エージェントのフラットファイル（例: `agents/aidlc-architect-agent.md`）と `knowledge/[agent]/` 内のナレッジを読み、そのうえで会話内でステージを直接実行します。これにより、質問、曖昧さの解消、承認前の成果物反復といったリアルタイムのユーザー対話が可能になります。

29 のステージがインライン実行です。これには 3 つすべての初期化ステージ（ワークスペーススキャフォールド、ワークスペース検出、状態初期化 — すべて `aidlc-utility intent-create` 内で決定論的に実行）、すべてのアイデエーションステージ、6 つのインセプションステージ（要件分析、精緻化モックアップ、ドメイン設計、ユニット生成、契約設計、デリバリープランニング）、6 つのコンストラクションステージ（機能設計、非機能要件、非機能設計、インフラ設計、ビルドとテスト、CI パイプライン）、およびすべてのオペレーションステージが含まれます。注記として、ビルドとテスト（3.6）は各ユニットごとではなく、すべてのユニット完了後に 1 回だけ実行されます。

**サブエージェントステージ** -- コンダクターはコンテキスト（先行成果物、プロジェクト記述、ワークスペースの所見）を準備し、Claude Code のタスクツールのサブエージェントへ委譲します。サブエージェントは自律実行し、構造化サマリーを返します。これは、実行中のユーザー対話なしで、集中した独立作業に向くステージで使われます。サブエージェント呼び出しが失敗した場合、コンダクターはコンテキストを減らしたプロンプトで 1 回再試行し、それでもだめならフォールバックとしてインライン実行か保留して再訪をユーザーへ提示します。

ディスパッチ実行を使うステージは 4 つです。リバースエンジニアリング（2.1、`mode: pipeline` — 開発者の走査の後にアーキテクトが統合と書き込みを行う）、プラクティス発見（2.2、`mode: subagent` — パイプラインデプロイのリードが下書きし、互いに見えない品質 / 開発者 / DevSecOps のスポークが検査し、人間インタビューを経てリードが統合する）、ユーザーストーリー（2.4、`mode: mob` — プロダクトリードの下書きにデザイン / 開発者 / 品質のコントリビューションラウンドが続く）、コード生成（3.5、ビルドには集中した開発者サブエージェント。人の承認前の計画ステップはインラインでコンダクター自身のコンテキストで実行され、ステップがその旨を伝える）です。collaborators が off のとき（`enterprise` 以外のすべての出荷スコープ）、最初の 3 つはリードエージェントだけで実行します。トポロジー全体は 29 インライン / 2 サブエージェント / 1 パイプライン / 1 モブです。ワークスペース検出（0.2）はサブエージェントではなく、`aidlc-utility intent-create` の内部で決定論的に実行されます。

```mermaid
flowchart LR
    subgraph INLINE["モード 1: インライン"]
        direction TB
        IN1["コンダクターが\nステージファイルを読む"]
        IN2["エージェントペルソナ\n+ ナレッジを読み込む"]
        IN3["会話内で\nステージ手順を直接実行"]
        IN4["ユーザー対話が\n利用可能"]
        IN5["承認ゲート\n(AskUserQuestion)"]
        IN1 --> IN2 --> IN3 --> IN4 --> IN5
    end

    subgraph SUBAGENT["モード 2: サブエージェント（単純）"]
        direction TB
        SA1["コンダクターが\nステージファイルを読む"]
        SA2["コンテキスト準備:\n成果物 + ペルソナ"]
        SA3["Task ツール呼び出し\n(subagent_type を指定)"]
        SA4["サブエージェントが実行\n(ユーザー対話なし)"]
        SA5["構造化サマリーを\nコンダクターへ返す"]
        SA6["コンダクターが\n完了 + 承認を提示"]
        SA1 --> SA2 --> SA3 --> SA4 --> SA5 --> SA6
    end

    subgraph TWOSTEP["モード 3: パイプライン（2 リンク RE チェーン）"]
        direction TB
        TS1["コンダクターが\nリバースエンジニアリングのステージファイルを読む"]
        TS2["Task: aidlc-developer-agent\nコード走査"]
        TS3["開発者が\n走査結果を返す"]
        TS4["Task: aidlc-architect-agent\n統合"]
        TS5["アーキテクトが\n9 個の成果物を生成"]
        TS6["コンダクターが\n完了 + 承認を提示"]
        TS1 --> TS2 --> TS3 --> TS4 --> TS5 --> TS6
    end

    style INLINE fill:#e8f5e9,stroke:#4caf50,color:#000
    style SUBAGENT fill:#e3f2fd,stroke:#2196f3,color:#000
    style TWOSTEP fill:#fff3e0,stroke:#ff9800,color:#000
```

### コンダクターのインラインステージ実行

```mermaid
sequenceDiagram
    participant O as コンダクター
    participant S as ステージファイル
    participant A as エージェントペルソナ
    participant U as ユーザー
    participant ST as 状態ファイル

    O->>S: ステージファイルを読み込む
    O->>A: 先導エージェントのペルソナ + ナレッジを読み込む
    O->>O: ステージ手順を実行する
    O->>U: 質問を提示する（3 モード）
    U-->>O: 回答を返す
    O->>O: 成果物を生成する
    O->>O: 監査シャードに記録する
    O->>U: 完了 + 承認ゲートを提示する
    U-->>O: 承認 / 変更依頼
    O->>ST: 承認を報告する（エンジンが `[x]` を付けてルーティングする）
    O->>O: 次のステージへ進む
```

### コンダクターのサブエージェント委譲

```mermaid
sequenceDiagram
    participant O as コンダクター
    participant T as タスクツール
    participant SA as サブエージェント
    participant U as ユーザー

    O->>O: ステージファイルを読み、コンテキストを準備する
    O->>T: サブエージェントを起動する（種別 + プロンプト + コンテキスト）
    T->>SA: 自律実行する
    SA->>SA: ファイルを読み、成果物を生成する
    SA-->>T: 構造化サマリーを返す
    T-->>O: 生成ファイル + 判断を含むサマリー
    O->>O: サマリーを検証し、問題点と懸念事項を確認する
    O->>U: 完了 + 承認ゲートを提示する
    U-->>O: 承認 / 変更依頼
    O->>O: 結果を報告する（エンジンが完了させ先へ進める）
```

## ソース対ディストリビューション（1 つのコア、複数のハーネス）

このフレームワークは**1 回だけ著述し、ハーネスごとに生成**されます。現在は Claude Code、Kiro CLI、Kiro IDE、Codex CLI、Cursor、opencode、GitHub Copilot、そしてそれを移植できるあらゆる CLI が対象です。
人手で著述するソースはハーネス中立な `core/` と、CLI ごとの薄い `harness/<name>/`
設定から成り、`bun scripts/package.ts` が Git 管理対象外のローカルな
`dist/<harness>/` ツリーを生成します。

```
core/                  # hand-authored, harness-neutral (tools, aidlc-common,
                       #   agents, rules, scopes, sensors, knowledge, hooks,
                       #   3 session skills); prose uses the {{HARNESS_DIR}} token
harness/<name>/        # per-CLI surface: manifest.ts + orchestrator skill +
                       #   harness files (+ emit.ts for codex)
scripts/package.ts     # the build: copy core (token→.claude/.kiro/.codex) +
                       #   harness, compile the graph, generate runners, emit;
                       #   writes both channels; `--check` builds twice and compares
scripts/package-sources.ts # content fingerprint of the build's inputs, recorded
                       #   per harness in dist/.package-sources.json; tools that
                       #   read dist/ (the coverage generator) refuse a stale tree
scripts/build-binaries.ts # release-only binary compiler + smoke gate, writing
                       #   per-target executable + runtime/<harness>/ bundles
                       #   under ignored build/binaries/
dist/<harness>/        # GENERATED + ignored: claude/.claude, kiro/.kiro,
                       #   kiro-ide/.kiro, codex/{.codex,.agents},
                       #   opencode/{.aidlc,.opencode}, copilot/{.aidlc,.github} — never hand-edited
```

`core/` の `.ts` は変換なしでバイトコピーされます。ランタイムの `harnessDir()` という継ぎ目
（`core/tools/aidlc-lib.ts`）は、ハードコードした一覧ではなくツール自身のパスから出荷済みレイアウトを
実行時に導出するため、新しいハーネスを追加してもここへの編集は不要です。またマニフェスト名とルールディレクトリの名前変更は、
ツリーごとに生成される `tools/data/harness.json` に格納されて出荷され、ランタイムのパス解決はその名前を使って共有エンジンディレクトリを区別し、`rulesSubdir()` の継ぎ目がその名前変更を読みます。
1 セットのツールソースがすべてのハーネスで動きます。詳しくは
[新しいハーネスへの移植](../harness-engineering/09-porting-to-a-new-harness.md) を参照してください。

`dist/` と `dist-release/` は同じソースから生成するローカルのツリーで、どちらも Git 管理対象外です。`dist/` の開発用チャネルは生成された TypeScript ディスパッチャーを Bun で実行します。`dist-release/` のリリース用チャネルは、フック、生成コマンド、アダプター、ホストの信頼設定をネイティブ `aidlc` ディスパッチャーへ接続します。ホストの信頼シードなど、ネイティブ専用のルート統合はリリース用にだけ追加します。`package.ts --check` は独立した一時ディレクトリで全ツリーを 2 回生成し、バイト単位で比較します。CI、テスト、バイナリビルド、リリースパッケージ作成は、これらを使う前に再生成します。

### Markdown の構造

`core/tools/aidlc-markdown.ts` の `markdownBlocks` は、可視性、コンテナ、リンク参照定義、主張の分割、確認のパースのための唯一の Markdown ブロック解釈器です。Bun と各ネイティブ `aidlc` バイナリに組み込まれた CommonMark/GFM レンダラー `Bun.markdown` を基盤にしているので、パーサーをインストールしたり同梱したりすることはありません。`Bun.markdown` はソース上の位置ではなくレンダリングした要素を報告するので、アダプターは各行の、ブロック構造を変えられない桁にプローブ語を挿入し、レンダリングした HTML をバイト単位で同一に保つプローブだけを残して、各プローブがどこにレンダリングされたか（そのブロック、コンテナ、インラインコードや生 HTML の有無）を読みます。リンク参照定義も同じ方法で位置を特定します。`visibleMarkdownLines` は別のスキャナーではなくこの構造の射影であり、その利用側のオプションは既存の生ソースと不可視境界の契約を保ちます。種別 1〜7 の生 HTML ブロックが、Markdown の見出し、回答、制御タグを供給することはありません。

アダプターは、レンダラーが見出しを隠したりコードを露出したりする `Bun.markdown` の 4 つのずれ（1.3.14 から少なくとも 1.4.2 まで確認）を補正します。

- 空のタスク項目（`- [x]` など）が次の行を、見出しであっても飲み込むので、GFM のタスクリストをオフにしてレンダリングします。
- 見出し、フェンス、HTML ブロックを始める行は GFM の表を終わらせるので、アダプターはその行を表の行としてではなく、挿入した空行のあとでレンダリングします。
- フェンス付きブロックを開いた引用やリスト項目の外にあるフェンス行は新しいフェンスを始めるので、アダプターは挿入した HTML コメント行で先にコンテナを終わらせます。
- 段落テキストの下に 4 桁以上インデントしたタグは段落の続きになる（そのインデントを許す HTML ブロックの開始はない）ので、アダプターはその行の最後のインデント桁をノーブレークスペースに置き換えてレンダリングします。

挿入した行や置き換えた行はアダプターのレンダリングの中にだけ存在し、すべての位置は引き続きソースを指します。マークアップの外に文字も数字もない行にもプローブを入れ、すべてのコードスパンにもプローブを入れます。プローブ語はソースにもそのレンダリングにも決して現れないので、文字参照でそれを綴ることはできません。プローブがレンダリングを変え続ける文書は決まった回数のレンダリング内で分類し、位置を特定できない行は `unknown` のままにします。

行を読み誤ったり位置を特定できなかったりした場合に、2 つの利用側はフェイルクローズします。要約のダイジェストは、除外する `Assumption Confirmation` セクションを、トップレベルの `## Q<n>`（先頭の絵文字の装飾の有無を問わない）または `## Requested Changes Feedback` の見出しとして綴られた行で終わらせます。アダプターがその行を生 HTML やコードとして読んだ場合でも同じなので、隠れた見出しは確認済みの内容を広げることしかできません。claim-sources センサーは、アダプターが位置を特定できなかった空でない行を、それ自体で 1 つの主張として読みます。

Markdown の振る舞いは、ツールを実行する Bun に従います。ネイティブリリースに組み込まれた Bun か、コピー形式の利用者がインストールした Bun です（`Bun.markdown` には Bun 1.3.8 以降が必要で、それがなければアダプターは明確に拒否します）。レビュー権限の検査（`renderedReviewAuthority`）は同じレンダラーを直接呼び出し、意図的に別のコード経路になっています。

### 生成物の識別情報と所有権

各ハーネスの `tools/data/` には、役割の異なる 4 つのメタデータ契約があります。

- `harness.json` は実行時設定です。配布名、製品名、次の操作の文言、ハーネスとルールのディレクトリ、プラグイン選択、および任意の `runtime`、`providers`、`trust`、`project` レコードなど、変更可能なプロジェクト設定を保持します。モデルポリシーとフラグはここには保持しません。それらは `aidlc.settings.json`（プロジェクト）、`aidlc.settings.local.json`（このチェックアウト）、マシンの設定ファイルに置かれ、まだ `models` や `flags` を持つ `harness.json` は、それらを削除して `aidlc config` を実行するよう伝える 1 行とともに拒否されます。
- `agent-tiers.json` は `core/agents/*.md` のフロントマターから生成するエージェント名とティアの対応表です。実行時のモデルポリシーは、エージェント一覧をコードに固定せず、このファイルを読みます。
- `aidlc-stamp.json` は変更しない生成物の識別情報です。スキーマ、フレームワークのバージョン、配布名、ハーネスディレクトリを記録します。
- `aidlc-projection.json` は全出力を網羅するインストール定義です。すべての最上位出力を、フレームワーク管理ディレクトリかルート統合に分類します。ルート統合には型付きの統合ポリシーを 1 つ指定します。`managed-block`、`json-map`、`json-array`、`whole-file`、`jsonc-settings`（エディターの JSONC 設定ファイルをキー単位で編集します。出荷するキーは存在しないときだけ追加し、他のすべてのキーとコメントを保ち、コピー形式のランタイムからは除外します）、`json-entries`（`opencode.json` のようなチームの JSON ファイルに対して、同じことをどの深さでも行います。AI-DLC の値と配列の文字列は存在しないときに追加し、変更されていない間だけ追従または削除します。その部分は root-blocks に含めて出荷し、コピー形式のランタイムはこのファイルを除外します）のいずれかです。2.10.0 のインストールは、知らないポリシーを名指しする定義を持つリリースを拒否するので、それ以降に追加したポリシー（`jsonc-settings`、`json-entries`）は `whole-file` として書き、本来のポリシーを `extendedPolicy` に入れ、すべての読み手がそれを元に戻します（`core/tools/aidlc-distribution.ts` の `writtenRootIntegration` と `readRootIntegrations`。`tests/unit/t-previous-release-validates-runtime.test.ts` は、すべてのランタイムツリーに対して 2.10.0 自身の検査を実行します）。任意の統合や旧コピーの正確なハッシュもここに宣言します。未分類の最上位項目があると、パッケージ作成または読み込みは失敗します。

`aidlc config` は計画を作る前に stamp とインストール定義を検証します。インストール先には、5 つ目のファイル `aidlc-manifest.json` をプロジェクト固有の基準として書き込みます。内容は upstream バージョン、各ファイルのハッシュ、Claude設定とCodexテーブルの出荷時エントリのハッシュ、ルートへの追加内容、任意の統合の選択モードです。更新時はこの基準を使い、変更されていない管理ファイルを更新し、ローカルの変更を保護し、ルート統合をマージし、廃止した管理対象を削除します。ネイティブ定義に記録したコピー用ハッシュと一致する、未変更の旧コピーインストールは引き継げます。未知の内容をフレームワーク所有と推測することはありません。ハーネスディレクトリの下にあるプロジェクト自身のファイル（チームのスキル、合成したスコープ、プラグインのサイドカー）は、コンパイルのために一時配置しますが記録はせず、マニフェストはそのことを `shippedOnly` で示します。この印のないマニフェストはそのようなファイルを記録している可能性があるので、更新時は、そこに記録されたファイルのうちリリースが出荷しないものを保持し、記録だけをやめます。

### モデルポリシーの反映

`aidlc config models` は既存の公開コマンド `config` の一機能です。第 7 の公開コマンドではありません。ポリシーはハーネスのメタデータではなく、共有の設定階層に置きます。

- マシンのインストールルートにある `aidlc.settings.json`
- プロジェクトルートにある `aidlc.settings.json`
- プロジェクトルートにある `aidlc.settings.local.json`

この順に末端の項目ごとにマージし、最後に環境変数の上書きを適用します。local ファイルは個人用で Git 管理対象外、project ファイルはチーム共有です。

```json
{
  "schemaVersion": 1,
  "models": {
    "schemaVersion": 1,
    "preset": "thorough",
    "groups": {
      "reviewing": { "effort": "xhigh" }
    },
    "agents": {
      "architect": {
        "effort": "xhigh",
        "model": { "claude": "provider/raw-id" }
      }
    },
    "profiles": {
      "my-profile": {
        "groups": {
          "reviewing": { "effort": "medium" }
        }
      }
    }
  },
  "flags": {
    "schemaVersion": 1,
    "swarm": true
  }
}
```

解決順は、エージェントごとの例外、グループ設定、出荷時のティア既定値、セッションからの継承です。出荷時の既定値には共有のティア変換モジュールと有効なティア上限の解決器を使い、モデル表を複製しません。Claude と Cursor の Markdown、Codex の TOML、opencode の Markdown、Kiro のエージェント JSON と `chat.modelDefaults` は、パッケージ生成と config 更新で同じ書き込み処理を使います。

更新時は、解決した設定階層を未変更の一時生成物へ渡し、`planManagedFiles` がハッシュを計算する前にモデルとフラグの設定を反映します。ポリシーのキーを `harness.json` へコピーしません。そのため、後から通常の `aidlc config` を実行してもポリシーを再適用できます。管理対象のエージェントファイルを手で変更していた場合は、通常の更新競合として扱います。

対応しないポリシーは明示します。ハーネスが表現できる設定を報告し、近い値に丸める場合も強度を下げる方向だけに制限します。選んだハーネスが無視するキーは書かず、実際のプロバイダーへの接続検証も行わず、ステージファイル経由でモデルポリシーを指定することもありません。

### ランタイム、プロバイダー、信頼設定の診断

`core/tools/aidlc-config-diagnostics.ts` は、`aidlc config runtime`、`aidlc config providers`、`aidlc config trust` と対応する doctor 項目の共有実装です。各機能はスキーマバージョン付きの回答レコードを `harness.json` に保存します。ランタイムローダーはこれらの任意の兄弟キーを無視します。

ランタイム診断はログインシェルに依存しないフック用 PATH（Windows の Machine と User の `Path`、macOS の `getconf PATH` と `/etc/paths`・`/etc/paths.d`、Linux の `getconf PATH` と `/etc/environment` の `PATH` 行・`/etc/login.defs` の `ENV_PATH`・`environment.d`）を求め、インストール済みフックが必要とするコマンドだけを解決し、選択されたハーネス CLI を調べます。保存した絶対パスは診断の証拠です。フックのコマンドを書き換えるものではありません。ホストの許可リストと Codex の信頼ハッシュは、元のコマンド接頭辞に結び付きます。doctor のランタイムの項目は、プロジェクトのフックのハートビートも読みます。現在のシェルの PATH 上にしか見つからないコマンドも、それらのフックが直近 10 分以内に動いていれば（古くなく、最後の `session-start` より新しい `session-end` のハートビートがない）、そのコマンドを通じて動いたとみなして合格にします。

プロバイダーの検出は、ローカルの AWS 環境変数、プロファイル、認証情報、ロール、SSO キャッシュだけを読みます。Bedrock のリージョンとプロファイルの回答は、管理ファイルのハッシュ計算前に一時生成物へ反映します。Claude では AWS MCP のエンドポイントとメタデータも同じリージョンへ変更します。Codex のモデルと effort のキーは変更しません。OpenCode のプロバイダー設定はユーザーが提案を承認した場合だけ書き込みます。手順案内のみを行うハーネスでは、機能しない設定キーを書かず確認済みであることを記録します。

オフラインでは検証できないプロバイダー操作は、小さな保留操作一覧として保存します。config と doctor は操作 ID から説明文を生成し、レコードには ID と pending/done だけを保持します。

信頼設定の診断は既存のホスト設定を読みます。Codex はユーザー設定内のプロジェクト固有シード一式、Kiro IDE はインストール済みの trusted command、Copilot は Copilot CLI の `trustedFolders`、各ハーネスは必要な兄弟ディレクトリを確認します。config trust は信頼シードや許可ルールの生成処理を呼ばず、Copilot CLI の `config.json` にも決して書き込みません。本人を CLI 自身の信頼の確認へ案内します。Kiro IDE では、Kiro の Workflows スイッチ（`kiroAgent.workflows.enabled`、ユーザー設定のみ）も読みます。これはチャットからサブエージェントツールを取り上げるものです。`core/tools/aidlc-kiro-ide-workflows.ts` は、本人の回答（`--kiro-workflows`、setup、`config --yes`、またはセッション開始時のマシンごとに 1 回のチャットでの問い合わせ）に応じてその 1 つの JSONC キーを変更し、その回答をインストールルートの `kiro-ide-workflows` マーカーに保持します。JSONC として読めない設定ファイルは、off ではなく不明として報告され（trust、setup、doctor）、セッション開始はエラーごとに 1 回チャットに伝え、ファイルのパスとフィンガープリントを `kiro-ide-settings-error-told` マーカーに保持します。Kiro CLI 自身の Workflows スイッチ（`chat.enableWorkflows`）も、空のフォルダーで `kiro-cli settings` を通じて（`aidlc-kiro-session.ts` が所有する転送経路）読み、本人の回答（`--kiro-cli-workflows`、setup、`config --yes`、または Kiro CLI のチャットのセッション開始時の問い合わせ）に応じて同じ方法で設定し、その回答を別の `kiro-cli-workflows` マーカーに保持します。Windows では Kiro の既定のターミナルプロファイル（`terminal.integrated.defaultProfile.windows`）も読みます。コマンドプロンプトでは、エージェントの AI-DLC コマンドが本人の言葉を分割してしまい、すべてのコマンドが終了コード -1 を報告するため、`core/tools/aidlc-kiro-ide-terminal.ts` が同じ種類の回答（`--kiro-terminal powershell`）に応じてそれを PowerShell に設定し、`kiro-ide-terminal` マーカーに保持します。そのターミナル（TERM_PROGRAM=kiro で、チャットのフックが記録したシェル）では、各ツールのエントリが `AI-DLC reply:` のポインター行の背後で子プロセスとしてツールを実行し、返答を `aidlc/.aidlc-sessions/replies/` の下に保持します。また、cmd.exe が引数に残した一重引用符の組を結合し直します。エンジンは返答を fd 1 へ直接書き込み、Kiro はコマンドを送ってから 1 秒後にターミナルを読むためです。

dry-run 以外の config トランザクションが成功すると、インストール済み内容に対して軽量な適用後診断を行います。ランタイム診断は非対話 PATH 上で実際のフックが必要とするバイナリだけを解決し、ハーネス CLI のバージョン検査は省きます。信頼設定はホスト設定を読み、プロバイダーは記録済みの保留操作だけを読みます。通常出力と quiet 出力には必要な機能別の後続操作を表示し、JSON には構造化した `outstandingActions` 配列を返します。トランザクションは成功しているため、終了コードは 0 です。

doctor は `tools/data/aidlc-manifest.json` から指示ファイルの診断項目を作ります。managed-block ではマーカーが正しい順序で 1 組あり、ブロックのハッシュが記録と一致することを確認します。フレームワーク所有の whole-file 指示ファイルは、ファイル全体の記録済みハッシュと比較します。正常・欠落・ローカル変更を区別し、複数ハーネスのプロジェクトでは呼び出し元のハーネスを選びます。

### フラグとプロジェクトの選択

`aidlc config flags` はスキーマバージョン付きの `flags` レコードを、対象が指す設定ファイルに保存します。`--project` は `aidlc.settings.json` に、`--local` は `aidlc.settings.local.json` に、`--global` はマシンの設定ファイルに書き込みます。`resolveProjectFlag` が、これらの層に対して環境変数を優先する共通の参照処理を提供します。既存のツールとフックは環境変数の動作を保ち、変数がない場合だけレコードの値を使います。コンダクターが管理する swarm の選択も同じ優先順位です。

flags レコードには既定スコープ、swarm、フックのデバッグ、センサーのタイムアウト、文書化された固定のバイパス環境変数群を含めます。スコープ検証はインストール済みのフロントマターを読みます。Claude の設定生成では `AWS_AIDLC_DEFAULT_SCOPE` も更新します。これを行わないと、出荷時のセッション環境変数がレコードより優先されるためです。

`aidlc config project` は MCP と補完設定の回答を、スキーマバージョン付きの `project` レコードへ保存します。プラグイン選択は従来どおり最上位の `plugins` 配列に置きます。インストール済みプラグインはグラフ、スコープ、プラグインの sidecar データから検出します。ワークフローが開いている間にプロジェクトの選択を変更した場合も、他の更新と同じように実行し、その出力が開いている作業と、以前の選択に戻すコマンドを示します。

MCP への同意は同じトランザクション中と後続の通常更新で、Claude の同意管理対象 `.mcp.json` に対するルート統合モードへ渡します。MCP 診断は Claude の配置を仮定せず、ホストごとに分類します。Kiro の設定ファイルは常に出荷されるため、`defaults` は存在を確認し、`none` は手順の案内だけを行います。現在 MCP ファイルを持たないハーネスでは、修復不能な差分を発生させず回答を記録します。補完の回答からは、ネイティブ用またはコピー用の正確な手順を生成します。config がシェルのプロファイルなどマシン単位のファイルへ書くことはありません。

更新時は 3 つのレコードを未変更の一時 `harness.json` にマージし、プロバイダーの書き込み処理がホスト設定を変更してから `planManagedFiles` がハッシュを計算します。後続の通常の `aidlc config` でも回答が再適用され、reset すると変更前の出荷時既定値へ戻ります。

### ディスパッチャーのルートポリシー

`core/tools/aidlc.ts` は両チャネルのルート一覧であり、コンパイル済みバイナリの入口です。各ルートはプロジェクト要件、出力モード、ネットワークポリシー、変更範囲、公開範囲、および次のいずれかの pin ポリシーを宣言します。

- `active` はマシンのライフサイクル操作や管理コマンドを現在有効なバイナリで実行します。
- `inspect` も有効なバイナリを使い、`doctor`、`init`、`use` が壊れたプロジェクトの pin を診断・修復できるようにします。
- `pinned` はプロジェクトのエンジン用です。有効な `.aidlc-version` があれば、プロジェクトデータを読む前に保持済みのその版へ 1 回だけ再実行します。指定版が欠落または不完全なら、インストールコマンドを示して拒否します。

ディスパッチャーは解決したルートポリシーを `AIDLC_ROUTE_*` 環境変数で委譲先へ渡します。リリース取得とトランザクションエンジンがネットワークと変更範囲を制御します。セッション単位の fingerprint キャッシュにより、pin の検証を弱めず保持版の完全検査の繰り返しを避けます。

### 共有トランザクションエンジン

インストール機構の変更処理は `core/tools/aidlc-transaction.ts` を使います。計画はルート相対で重複しない `write`、`copy`、`tree`、`remove`、`symlink` 操作の集合で、操作先の期待状態を持ちます。コピー元には内容のハッシュも付けます。変更前に、範囲外パス、シンボリックリンク経由の参照、特殊ファイル、ファイルシステム境界越え、コピー元の変化、対象の重複を拒否し、ルートロックの保持中にも検証を繰り返します。

候補を一時配置して fsync してから実体へ書き込み、現在の対象をスナップショット化し、rename を境にコミットします。候補とコミット済み内容の検証器により、呼び出し元は固有の不変条件を確認できます。一時配置、コミット、検証、監査のいずれかが失敗すると、コミットしたパスを逆順で復元します。ロールバックに失敗した場合は復旧情報を残し、次のトランザクションが放置された一時配置を削除せず隔離します。プロジェクトの初期化・更新、マシンのライフサイクル、project pin、プラグイン選択・同期は、すべてこのエンジン用の計画を作ります。

ルートロックはハードリンクによる公開を優先し、ハードリンクが使えないときは所有者を刻印したディレクトリへ自動でフォールバックします。どちらも `.aidlc-transaction.lock` を使うので、生存しているレガシーのファイル所有者はディレクトリのフォールバックも引き続きブロックします。レシートで管理する `withAuditLock` ヘルパーは、正規化したルートをキーとする専用のローカルゲートを一時ディレクトリに用意し、トランザクションの実行（取得、古い所有者の回復、所有権を確認した解放を含む）を囲みます。回復は、PID が死んでいるか、いまは後から起動したプロセスが動いている所有者をいなくなったものとして扱います。どちらのロック形式も保持者のプロセス世代（ゲートの回収処理も比較する OS の起動記録）を記録し、それを記録していないリリースのロックは、生存プロセスがロックの書き込みより 2 秒以上あとに起動したかどうかで判断します。各回復は stderr に 1 行を出力します。ディレクトリの回復には、ホスト／起動の識別子の一致も必要です。完了しなかったディレクトリの刻印（所有者ファイルがない、空である、またはパースできない）は、そのフォルダーがワークフローロックの刻印なしの猶予期間（既定で 5 秒）を過ぎるとクリアされ、不明、他所、無効なディレクトリの所有者は、手動の診断のために保持します。

この調停の契約が対象にするのは、1 つのホスト上で継続して稼働する 1 つのマウントにおいて、共通のローカル一時ディレクトリ（Unix では `TMPDIR`）、正規化したルート、PID 名前空間を持つ協調プロセスです。ホスト間や独立したマウント間の分散ロックは提供しません。ゲートをローカルへ移してもデータの契約は変わりません。ワークフローへの追記とファイル記述子の同一性は一貫していなければならず、トランザクションの公開は引き続き、ファイルシステムが提供するアトミックなファイル置換とディレクトリの rename に依存します。コピーして削除する rename のフォールバックは追加しません。

`assertTransactionFilesystem` は、排他的な作成、通常ファイルの `fsync`、変更可能な追記と読み戻しとファイル記述子の同一性、ファイル／ディレクトリの rename、Unix の `chmod`、トランザクションとランタイムのワークフローロックを検査します。初回実行のウィザードと、ディレクトリのフォールバックを使うトランザクションがこれを呼び出します。ディレクトリの `fsync` 非対応は許容します。検査が成功しても、クラッシュ時の永続性や rename のアトミック性は確立できず、模擬した障害でドライバーを認定することもできません。Mountpoint のディレクトリ rename／変更可能なファイルの非対応と、s3fs の非アトミックな rename は、完全なトランザクション契約の対象外のままです。[ストレージ互換性の一覧](../guide/18-install-and-lifecycle.md#トランザクションと復旧) を参照してください。

### リリースの組み立てと来歴

`scripts/build-binaries.ts` は配布ツリーを再生成し、`dist-release/claude/.claude/tools/aidlc.ts` からディスパッチャーをコンパイルします。各対象バイナリの隣に全ネイティブランタイムを配置してスモーク検証し、`build-results-<target>.json` を書きます。ホストで実行できる成果物は、ネイティブ実行と最終配置に対する検証一式を通った場合だけ `VERIFIED` になります。クロスビルド成果物は `inspection-only` の証拠を伴う `UNVERIFIED` として明示します。

`scripts/package-release.ts` はローカルの配布ツリーを再生成し、2 回のビルドで決定性を検証します。ビルド結果のレコードを検証し、リリースモードでは 7 対象すべてが揃っていることも確認します。各 `dist-release/<harness>/` と Bun 用 `aidlc-copy-runtime-X.Y.Z.tar.gz` をアーカイブ化し、フラットな `version.json`、`checksums.txt`、両インストーラー、バイナリを出力します。一時公開ジョブは候補を再検証し、署名せずアップロードします。Unix と Windows のライフサイクルジョブは、そのチェックサムを検証してテストします。`update-from-previous` ジョブは、Linux、macOS、Windows で、直前の安定版リリースをそれ自身のインストーラーでインストールし、本人の作業がゲートで待っている状態ですべてのハーネスのプロジェクトを準備し、候補へ `aidlc update` を実行して、各プロジェクトのフック、`aidlc config --yes` による更新、doctor がまだ動くこと、そして本人が何も聞き直されずにそのゲートから作業を再開できることを確認します。そのコピー側の経路は、直前のリリースのコピー形式ランタイムからコピーされたプロジェクトに対して同じことを行い、それらは自身の `config --from` で更新します。これに失敗すると安定版リリースは公開されず、プレビュー版は注記に警告を付けて公開されます。`publish` は同じ候補を取得・再検証して証明を付け、書き出した `aidlc-release.intoto.jsonl` バンドルを追加し、全ファイル一覧を検証して、1 つの `attested-release` ワークフロー成果物をアップロードします。`release` はタグとチェックサムを再確認し、このリポジトリの `GITHUB_TOKEN` で GitHub Release を作り、公開済みの全ファイルを検証します。バンドルは独立した信頼経路なので、`version.json` と `checksums.txt` には含めません。このパイプラインでは、将来予定の npm チャネルは実装していません。[サプライチェーンセキュリティ](19-supply-chain-security.md) を参照してください。

## ディレクトリ構造

ソースから生成する Claude 配布ツリー（`dist/claude/.claude/`。`core/` + `harness/claude/` から生成。リリースアーカイブではネイティブ版を `runtime/claude/.claude/` に配置）:

```
dist/claude/.claude/
+-- CLAUDE.md
+-- settings.json
+-- hooks/
|   +-- aidlc-continue-workflow.ts
|   +-- aidlc-deliver-stage-rules.ts
|   +-- aidlc-fold-usage.ts
|   +-- aidlc-log-subagent.ts
|   +-- aidlc-plan-approval-guard.ts
|   +-- aidlc-rebuild-stage-graph.ts
|   +-- aidlc-record-human-turn.ts
|   +-- aidlc-review-freeze.ts
|   +-- aidlc-reviewer-scope.ts
|   +-- aidlc-run-sensors.ts
|   +-- aidlc-session-end.ts
|   +-- aidlc-session-start.ts
|   +-- aidlc-state-transition-guard.ts
|   +-- aidlc-statusline.ts
|   +-- aidlc-sync-workflow-state.ts
|   +-- aidlc-validate-state.ts
|   +-- aidlc-write-audit-log.ts
|   +-- review-freeze-command.ts, runtime-integrity.ts   # helpers the hooks import
+-- rules/
|   +-- aidlc.md                  # @-import stub -> ../../aidlc/active-memory/ (the engine's git-ignored copy of the active space's memory)
+-- agents/
|   +-- aidlc-product-agent.md
|   +-- aidlc-design-agent.md
|   +-- aidlc-delivery-agent.md
|   +-- aidlc-architect-agent.md
|   +-- aidlc-aws-platform-agent.md
|   +-- aidlc-compliance-agent.md
|   +-- aidlc-devsecops-agent.md
|   +-- aidlc-developer-agent.md
|   +-- aidlc-quality-agent.md
|   +-- aidlc-pipeline-deploy-agent.md
|   +-- aidlc-operations-agent.md
+-- knowledge/
|   +-- aidlc-shared/
|   |   +-- adding-a-repo.md
|   |   +-- ai-dlc-principles.md
|   |   +-- verification.md
|   |   +-- brownfield.md
|   |   +-- audit-format.md
|   |   +-- state-template.md
|   |   +-- knowledge-readme-template.md
|   +-- aidlc-product-agent/
|   |   +-- requirements-guide.md
|   |   +-- product-guide.md
|   |   +-- functional-design-guide.md
|   |   +-- requirements-elicitation.md
|   |   +-- prioritization-frameworks.md
|   |   +-- user-story-patterns.md
|   |   +-- market-research-methods.md
|   |   +-- corner-checklist.md
|   +-- aidlc-architect-agent/
|   |   +-- architecture-guide.md
|   |   +-- nfr-design-guide.md
|   |   +-- ddd-patterns.md
|   |   +-- architecture-patterns.md
|   |   +-- nfr-design-patterns.md
|   |   +-- adr-template.md
|   +-- aidlc-developer-agent/
|   |   +-- code-analysis-guide.md
|   |   +-- code-generation-guide.md
|   |   +-- code-generation-patterns.md
|   |   +-- api-design-guide.md
|   |   +-- data-modelling-patterns.md
|   |   +-- re-artifacts.md
|   +-- [... 8 more agent knowledge dirs]
+-- skills/
|   +-- aidlc/
|   |   +-- SKILL.md
|   |   +-- composer.md
|   |   +-- question-rendering.md
|   +-- [... runner and session skills]
+-- aidlc-common/
    +-- conductor.md
    +-- protocols/
    |   +-- stage-definition.md
    |   +-- stage-protocol.md
    |   +-- stage-protocol-recovery.md
    |   +-- stage-protocol-governance.md
    |   +-- stage-protocol-reviewer.md
    |   +-- stage-protocol-reviewer-unit.md
    |   +-- stage-protocol-reviewer-repair.md
    |   +-- stage-protocol-ensemble.md
    |   +-- stage-protocol-collaborators.md
    |   +-- stage-protocol-construction.md
    |   +-- stage-protocol-checkpoint.md
    |   +-- stage-protocol-loopback.md
    |   +-- stage-protocol-wave.md
    |   +-- stage-protocol-swarm.md
    |   +-- stage-protocol-learnings.md
    |   +-- stage-protocol-summary.md
    |   +-- stage-protocol-sensors.md
    +-- stages/
        +-- initialization/
        |   +-- workspace-scaffold.md
        |   +-- workspace-detection.md
        |   +-- state-init.md
        +-- ideation/
        |   +-- intent-capture.md
        |   +-- market-research.md
        |   +-- feasibility.md
        |   +-- scope-definition.md
        |   +-- team-formation.md
        |   +-- rough-mockups.md
        |   +-- approval-handoff.md
        +-- inception/
        |   +-- reverse-engineering.md
        |   +-- practices-discovery.md
        |   +-- requirements-analysis.md
        |   +-- user-stories.md
        |   +-- refined-mockups.md
        |   +-- domain-design.md
        |   +-- units-generation.md
        |   +-- contract-design.md
        |   +-- delivery-planning.md
        +-- construction/
        |   +-- functional-design.md
        |   +-- nfr-requirements.md
        |   +-- nfr-design.md
        |   +-- infrastructure-design.md
        |   +-- code-generation.md
        |   +-- build-and-test.md
        |   +-- ci-pipeline.md
        +-- operation/
            +-- deployment-pipeline.md
            +-- environment-provisioning.md
            +-- deployment-execution.md
            +-- observability-setup.md
            +-- incident-response.md
            +-- performance-validation.md
            +-- feedback-optimization.md
```

### ワークスペース: スペースとインテント

上のツリーは**エンジン**であり、ハーネス固有で、ユーザーが閲覧するものではありません。
エンジンが**実行時に読み書きする**ものはすべて、プロジェクトルートの別個の中立ディレクトリ
`aidlc/` に置かれ、2 段コンテナとして整理されます。
**スペース → インテント** です（利用者向けの導入はユーザーガイドの
[スペースとインテント](../guide/03-spaces-and-intents.md) を参照。この節は
エンジンが解決対象とするデータモデルです）。

```
aidlc/                                    # neutral, harness-independent, committed to git
+-- active-space                          # cursor: active space name (gitignored, per-user)
+-- spaces/
    +-- default/                          # one space per team; "default" is auto-resolved
        +-- memory/                        # the method — org.md/team.md/project.md, phases/, templates/
        +-- knowledge/                     # space-level domain knowledge (free-form)
        +-- codekb/<repo>/                 # per-repo code knowledge base
        +-- intents/
            +-- active-intent              # cursor: active intent record dir (gitignored, per-user)
            +-- intents.json               # the registry: [{ uuid, slug, dirName, scope, repos, status }]
            +-- <YYMMDD>-<label>/          # one record dir per intent (date-prefixed, short kebab label; UUIDv7 carries identity in intents.json)
                +-- aidlc-state.md          # per-intent workflow state
                +-- audit/<host>-<clone>.md # per-clone audit shards (glob-and-merge by timestamp)
                +-- <phase>/<stage>/*.md    # artifacts + the per-stage memory.md diary
```

**解決。** ワークフローのアイデンティティは、ライブラリ内の単一のチョークポイントで、
`in-process sessionId > AIDLC_SESSION_OVERRIDE > the chat the host
names in the agent's shell (CODEX_THREAD_ID; CLAUDE_CODE_SESSION_ID while its
CLAUDE_PID process is alive; KIRO_SESSION_ID) > PID ancestry > none` という優先順位で
解決されます。フックペイロードのアイデンティティはインプロセスの選択肢を使い、これが
正式な情報源です。
ホストまたはフックペイロードがチャットを名指しするときは、プロセスの祖先はまったく辿りません。
その答えが結果を変えることはあり得ないためです。
そこで得られたどの ID も、バインディングを読む前に `resolveChat` を通ります。ヘルパーの ID は、
アダプターが書いた `<id>.helper-of` 記録を通じてそのルートのチャットへ対応付けられます（Codex の
エージェントとレビュースレッド、Kiro CLI の委譲、Copilot のサブエージェント）。バインディングの
ないチャットは、SessionStart が新しいチャットに適用するのと同じ規則（`classifyFirstContact`）で
最初の接触時に結び付けられるため、エンジンがコマンドの中で初めて出会ったチャットは、そのとき
選択した作業にとどまります。セッションのアイデンティティをまったく持たないプロセスだけが、
共有カーソルを直接読みます。
不正な環境変数値は無視されます。祖先関係と食い違う有効な環境上書きは、
バインディングやワークフロー記録のパスが導出される前に、型付きの拒否を投げます。
明示的なセレクターと、その結果生じるマシンローカルなセッションバインディングが、
共有される 2 つの利用者ごとカーソルより優先されます。

- **スペース** -- 優先順位は `explicit arg > session binding > aidlc/active-space
  cursor > "default"` です
  （`DEFAULT_SPACE` と解決器 `activeSpace()` は
  `core/tools/aidlc-locks.ts` にあります）。`listSpaces()` はディスク上に何もなくても常に `default` を報告します
  （`core/tools/aidlc-lib.ts`）。
- **インテント** -- 優先順位は `explicit arg > session binding >
  aidlc/spaces/<space>/intents/active-intent` カーソル（それが `aidlc-state.md` を保持する
  実在の記録を指す場合）`> lone-intent > null` です。`null` のインテントは
  「まだ記録が存在しない」を意味し、オーケストレーターが最初のインテントを自動作成する合図になります。

**参加。** 解決は記録を名指ししますが、この会話がその記録へ書き込んだり、その記録に止められたりしてよいかどうかは決めません。それを決めるのは `workflowParticipation()` で、マシンローカルな証拠だけから判断します。証拠は、`source` が選択を記録しているバインディング（`create`、`migration`、`switch`、`space-switch-cursor`、`cursor`、`stamp`）、またはその記録を名指しする `active-intent` カーソルです。さらに、保存された source として信頼するのではなく呼び出しのたびに確認し直すものとして、検証済みの委譲されたワークツリー、このワークツリー自身のメタデータ（作成元リポジトリの git common dir と照合します）、そのインテントについてこのマシンで claim した Unit があります。コマンドの出力でしか見えない作成は、記録の gitignore 対象のエンジンディレクトリに intent create の 1 回限りのレシートがあれば `create` として数えます。再開時、バインディングのないセッションは自身の UUID の刻印に従い、その記録を `stamp` として結び付けます。刻印されるのは参加したセッションだけです。選択なしに結び付けるライター（`observed-create`、`space-switch-lone`）は刻印を消すからです。コミット済みの記録が 1 つだけあることや、カーソルが別の記録を名指ししている source なしのバインディングは証拠になりません。そのため、AI-DLC のワークツリーメタデータを持たない素の `git worktree` は、インテントを明示的に選びます。フックは呼び出しごとに一度分類し、ペイロードのセッションを固定するので、その書き込みも同じ選択を使います。選択されたワークフローの外にある会話は、そこへ何も書き込まず、そのゲートにも止められません。一方、ランタイムの完全性、ライフサイクルコマンドの直接の拒否、claim したチェックアウトの書き込み範囲は引き続き適用されます。エンジンはそのような会話を、アクティブなインテントがないものとして扱います（`next` はどのインテントで作業するかを尋ね、`continue`、`report`、`park` は、エージェント向けの手順を示して拒否します。作業を一覧し、依頼が対象とするものを選び、同じコマンドをもう一度実行する、という手順です）。兄弟だけのワークツリーの委譲メタデータが不正または古いために参加を判断できないときは、ワークフローを選択しません。フックは何も書き込まず、レビュアーの読み取り範囲はフェイルオープンし、ゲートは退かないので Plan Approval は変更を拒否し、エンジンは修復すべきファイル（`.aidlc/worktree-meta.json`）か、作業すべき親チェックアウトを示して拒否します。

セッションバインディングは
`aidlc/.aidlc-sessions/<safe-session-id>.binding.json` に置かれます。生成された（spawn された）ツールは、
`aidlc/.aidlc-sessions/pids/<pid>` の最も近い生存エントリーを通じて
自分のセッションを発見します。どちらのストアも gitignore 対象のベストエフォートであり、
カーソルはライトスルーのフォールバックとして残ります。エンジンは、解決したアイデンティティを
`AIDLC_SESSION_OVERRIDE` を通じて子ツールへ渡します。この環境変数は、ハーネスプロセスに
設定された場合、ヘッドレス自動化のための継ぎ目にもなります。

SessionStart は、訪れた各 PID の以前のセッションを、識別子が検証されるまで `sessionId` が null の記録で失効させます。POSIX ではその障壁を照会の前に書きます。Windows は先に親子関係を検査します。検証済みの、子より新しいか同時刻の親は、その PID 記録を変えずに拒否します（GC 中も同じです）。検査ができない場合も、Windows は既知の親スロットを失効させて停止し、未検証のセッションを公開しません。したがって、失敗したりタイムアウトしたりした更新は、プロセスの検査が回復したときに以前のセッションを復活させることはできません。明示的なペイロードの識別子、環境の識別子、共有カーソルへのフォールバックは引き続き適用されます。後で成功した SessionStart が null の記録を置き換えます。

Codex アダプターはさらに、検証済みのペイロードアイデンティティをすべての POSIX Bash
コマンドとコアフックの子プロセスへピン留めするため、サンドボックス化された macOS は
`ps` の祖先関係に依存しません。Windows x64/arm64 の祖先の照会は、安定した `OpenProcess` ハンドルを使い、`NtQueryInformationProcess(ProcessBasicInformation)`、`GetProcessTimes`、待機時間 0 のプロセスオブジェクトの生存検査を行います。ネイティブの 48 バイト構造体の戻り長と PID を検証し、どの経路でもプロセスハンドルを閉じます。作成時刻は PID のレシートに精度を失わず保存します。各親は子より前に生成されていなければならないので、再利用された親の PID が、より新しいプロセスへの照会に加わることはありません。検証済みの Windows の作成時刻を持たないレシートは、セッションの所有権を確立しません。照会の失敗、曖昧な親子関係、2 秒／64 階層の上限の使い切りでは、祖先のセッションを返しません。null の障壁と否定キャッシュは既存の振る舞いを保ちます。Linux は各段で `/proc` を読みます。macOS は辿るたびに 1 回の `ps` 呼び出しでプロセス表全体（pid、親、`lstart`）を読み、各段をそこから辿ります。記録される開始時刻は、pid ごとの照会が出力する文字列です。1 つのプロセスはその表を最大 1 秒（否定キャッシュの期間）再利用し、SessionStart の書き込みがそれを消去します。上限はどの OS でも同じで、終わらない辿り（応答しない `ps`）を区切るだけです。辿りは答えが得られた時点で終わり、アイドル状態のマシンでは数ミリ秒で済みます。負荷の高いマシンでも、チャットを見失うことなく最後まで辿ります。

複数の Kiro IDE のチャットや opencode のセッションは、依然として 1 つのプロセスを共有することがあり、プロセスの祖先ではそれらの会話を区別できません。AI-DLC の opencode プラグインは、各シェルコマンドにそのチャットを `AIDLC_SESSION_OVERRIDE` として渡します（opencode の `shell.env` フック）。また、ファイル書き込みの監査とセンサー、そして To-Do リストの同期を、チャットのセッション ID とともに転送します。祖先を照会できないか曖昧な場合、生成されたツールは、ペイロードを持つフックかハーネスのプロセスが `AIDLC_SESSION_OVERRIDE` を与えない限り、共有カーソルの動作を使います。

プロジェクトを認識するパスヘルパーも同じ選択の階段で解決します。明示的なセレクター、
次にセッションバインディング、最後のフォールバックとして共有カーソルの順です。
解決済みの `intent:null` を受け取ったヘルパーは、素のスペースルートを選ぶ際に、
その選択されたスペースを保持します。
`/aidlc space <name>` でスペースを切り替えると、
切り替え先スペースの `memory/` のファイルが `aidlc/active-memory/` にも書き込まれます。これは、
各ハーネス固有のルール取り込み（上で述べた Claude の `@` による取り込み用スタブ、
Kiro CLI のリソース、Cursor のルール、opencode の `instructions` グロブ、Copilot の `AGENTS.md` `@` 取り込み。
Kiro IDE のステアリングファイルはテキストそのものを持ち、Codex には取り込みがなく、エンジンが各ステップに
ルールを渡します）が読む、git 管理対象外のコピーです。追跡対象のファイルは変わらないので、
コミット済みツリーが無駄に書き換わることはなく、チームメイトはそれぞれ自分のスペースを保ちます。
SessionStart は解決済みのセッションスペースのコピーを書き込みますが、このコピーはチェックアウト
全体で 1 つのサーフェスのままです。つまり、ワークフローの選択はスペースをまたいで
セッションに束縛される一方、複数スペースへのアンビエントなメソッド配信が同時に起きると
依然として競合し得ます。

**コミット対象と無視設定。** `aidlc/` はチームで作業を共有するためチェックインされます。
その分割（`harness/claude/dot-gitignore`）は次のとおりです。2 つのカーソル
（`active-space`, `active-intent`）、クローンごとのランタイム（`.aidlc-clone-id`,
`.aidlc-sessions/`）、アクティブなスペースの方法論のエンジンによるコピー
（`active-memory/`）、派生状態（`runtime-graph.json`、記録配下の `.aidlc-*`）
は **無視対象**です。一方で、方法論（`memory/**`）、ナレッジ（`knowledge/**`,
`codekb/**`）、`intents.json` レジストリ、各記録の `aidlc-state.md`、`audit/`
の分割記録、成果物は **コミット対象**です。監査はクローンごとの分割記録
（`audit/<host>-<clone>.md`）としてコミットされます。これはバージョン管理が同時追記を
マージしなくて済むようにするためで、意図的に `merge=union` 属性はありません。
名前の 2 つの部分はどちらも `.aidlc-clone-id`（トークンと、それを発行したときに記録したホスト）から取るので、マシンの名前が変わったり、フォルダを別のマシンへコピーしたりしても、クローンは 1 つの分割記録を保ちます。同じ最初の行で始まる分割記録のファイルは、1 つのファイルのコピー（同期ツールの競合コピー、手作業のコピー）です。読み手は、それらが共有する行を一度だけ読みます（`core/tools/aidlc-lib.ts` の `copiedAuditBlocks`）。

## 主要な設計判断

1. **ハイブリッド実行モデル（インライン + ディスパッチトポロジー）** -- ユーザー対話（質問、曖昧さの解消、承認反復）が必要なステージは、コンダクターが会話へ直接アクセスできるインラインで走ります。集中した自律作業（コード走査、コード生成）や本物のマルチエージェント協働（モブ）を行うステージは、ステージの `mode` トポロジーに従ってサブエージェントへディスパッチされます。純サブエージェントモデルではステージ途中のユーザー対話が不可能になり、純インラインモデルでは集中したエージェント特化や独立した視点の利点を活かせません。

2. **インラインステージ向けエージェントペルソナ** -- インラインステージでは、コンダクターはサブエージェントへ委譲する代わりに、視点付けのためにエージェントのフラットファイルをコンテキストとして読み込みます。これにより、ドメイン専門家としてのフレーミング（ドメイン設計中にコンダクターがアーキテクトのように考える）という利点を得つつ、サブエージェントへのコンテキスト転送コストやユーザー対話喪失を避けられます。

3. **2 リンクのリバースエンジニアリングパイプライン** -- リバースエンジニアリング（`mode: pipeline`）では、まずコード走査のための開発者サブエージェント、次に統合と成果物書き込みのためのアーキテクトサブエージェントを使います。コンダクターがバスとなり（Claude Code ではサブエージェントがサブエージェントを起動できません）、開発者のコード走査結果をアーキテクトへ渡します。これはチェーントポロジーが設計どおりに機能している姿です。

4. **`aidlc-state.md` による状態追跡** -- 単一の Markdown 状態ファイルが、ステージ完了状況、現在ステータス、ワークスペース文脈、スコープ設定、実行計画、ランタイム状態（改訂回数と、receiptに結び付く`Construction Verification Command`を含むConstruction設定）を追跡します。ステージは結果をオーケストレーションエンジンへ報告します。エンジンの内部状態遷移がこのファイルを更新し、ライフサイクル監査行を出力し、原子的にルーティングします。ステージの散文がライフサイクルのチェックボックスを直接編集することは決してありません。圧縮前フックが、コンテキスト圧縮の前に状態ファイル構造を検証します。ステージレベルのタスク ID は状態ファイルへ保存せず、実行時に `TaskList` から解決されます（`"Inception - Requirements Analysis"` のような件名で照合）。これはコンテキスト圧縮後でも実際のタスクシステム状態を反映するため、より堅牢です。

5. **共有契約としてのステージプロトコル** — 33 ステージが stage-protocol.md を読み、承認ゲート・3 つの質問モード・完了メッセージ・状態追跡を共有します。Recovery と governance は条件付きです。reviewer・ensemble・Construction・swarm・§13 learnings の 5 モジュールは directive.protocol_modules で選択します。learnings が日誌と学びの手続きを所有し、指定がなければどちらも実施しません。

6. **2 層ナレッジアーキテクチャ** -- 方法論ナレッジはフレームワーク同梱の `knowledge/` に出荷されます（共有原則 + エージェント別方法論）。ユーザー管理のチームナレッジは、スペースレベルの `aidlc/spaces/<space>/knowledge/`（そのスペースの `intents/` の兄弟）に置かれ、エンジンが空で作成し、チームが中身を入れます。これにより、フレームワークのアップグレードとチームのカスタマイズが分離されます。

7. **フラットなエージェントファイル** -- 各エージェントは `agents/` 内の単一 `.md` ファイルです（`agent.md` + `knowledge/` を持つサブディレクトリではありません）。これにより構造が単純になり、エージェントが見つけやすくなります。方法論ナレッジは `knowledge/[agent]/` に分離して置かれます。

8. **スコープ駆動の適応深度** -- 11 個の命名済みスコープ（エンタープライズ、機能、MVP、概念実証、バグ修正、リファクタリング、インフラ、セキュリティパッチ、クラシック、ワークショップ、エクスプレス）と、エージェントが自由記述の言葉から提案する計画が、どのステージをどの深さで実行するかを決めます。各スコープは `.claude/scopes/aidlc-<name>.md` ファイル（アイデンティティ）であり、所属は各ステージのメタデータ `scopes:` タグです。これはコンパイル時に EXECUTE/SKIP グリッド（`.claude/tools/data/scope-grid.json`、正本）へ転置され、オーケストレータースキルの隣にある `tables.md` 内のサマリーテーブルにもコンパイルされます（参考用）。計画提案のステップは、各スコープ `.md` メタデータの `keywords` をヒントとしてエージェントに渡します。それらを照合するツールはありません。ユーザーはどの承認ゲートでも上書きできます。

9. **ルールは方法論にとどめ、リファレンスにしない** -- アクティブなスペースメモリ層（`aidlc/spaces/<active-space>/memory/`。`.claude/rules/aidlc.md` の `@` による取り込み用スタブ経由で読み込まれる）は、フレームワークの作業上の既定値とガードレールを保持します。それ以外（検証、ブラウンフィールド保護策、監査フォーマット、適応パターン）は `knowledge/aidlc-shared/` か、静的／条件付きのプロトコルファイルに置きます。ルールは常に読み込まれるため、これにより AI-DLC 以外の会話でコンテキスト膨張を防げます。

10. **自己学習ループ** -- 人間がエージェントの振る舞いを修正すると、その修正は永続的なルールになり得ます。§13 の学習儀式（ツールが主体。`aidlc-learnings.ts` が候補を提示して永続化し、ユーザーが確認する）は、確認済み学習を各プラクティスとしてアクティブなスペースメモリ層へ書き込みます。既定では `aidlc/spaces/<active-space>/memory/project.md`、ワンクリックで `memory/team.md` へ昇格もできます。これは進行中のワークフローの次のステージの配信から適用されます。あるいはセンサーをスキャフォールドし、それは次のステージグラフのコンパイルでバインドされます。詳細は [ルールシステム](08-rule-system.md) を参照してください。

11. **フェーズ境界検証** -- トレーサビリティチェックは、アイデエーション、インセプション、コンストラクションの終わりに実行され（初期化→アイデエーションの遷移にはありません）、そのフェーズの最後のステージが `<record>/verification/` に書き込みます。これにより、要件から設計へのリンク欠落、孤立した成果物、不整合を、下流ステージが不完全な基盤の上に積み上がる前に捕捉します。

12. **フックベースの監査ロギング** -- 書き込み・編集操作に対するツール使用後フックが、成果物の作成と変更をインテントの `audit/` 分割記録へ自動記録します。圧縮前フックはコンテキスト圧縮前に状態ファイル構造を検証します。サブエージェント停止フックはサブエージェント完了を記録します。126イベントの分類体系（`knowledge/aidlc-shared/audit-format.md` で定義。[状態機械](12-state-machine.md) にイベント発生元レジストリの説明あり）により事後分析が可能です。主要イベントには `STAGE_STARTED`, `STAGE_COMPLETED`, `DECISION_RECORDED`, `SCOPE_CHANGED`, `RULE_LEARNED` があります。

13. **ネストした委譲なし** -- コンダクター（`SKILL.md`）がすべてのエージェントタスク呼び出しを行います。エージェント同士が互いを呼び出したり、サブエージェントを起動したりはしません。これにより、委譲グラフがフラットでデバッグしやすく保たれます。

14. **セッション再開** -- 新しいセッションで素の `/aidlc` を実行すると、チェックポイントから作業を続けます。本人は、現在ステージのやり直し、特定ステージへのジャンプ、新規開始（並行する新しいインテント）を求めることができます。これにより、ユーザーは状態ファイルを手編集せずに、ワークフローの進行を細かく制御できます。

15. **ステージ / フェーズジャンプコマンド** -- `--stage <slug|#>` と `--phase <name|#>` は、特定のステージまたはフェーズへ直接ジャンプします。`--scope <scope>` はワークフロースコープを設定または上書きします。前方ジャンプは中間ステージを `[S]`（スキップ済み）としてマークします。単独の unit-major の Construction では、進行中の手順へのジャンプはそのまま続行するだけで、ある Unit が作業を終えたあとの、より後の Unit 単位の手順へのジャンプは進行中の Unit だけを先へ進め、それ以外の前方ジャンプは何をスキップするか、何をやり直すかを示します。後方ジャンプは下流ステージを `[ ]` に戻して対象から前方再生します。相互に組み合わせ可能です。

## ディレクトリ構造: テスト

```
tests/
+-- run-tests.ts              # Native Bun test runner (all levels, flag-selectable)
+-- run-tests.sh              # POSIX compatibility wrapper for run-tests.ts
+-- gen-coverage-registry.ts  # Builds the coverage registry fresh from covers: headers; --check --base is CI's ratchet
+-- .coverage-registry.json   # Local only (gitignored): the registry a plain generator run writes
+-- README.md                 # Discoverable suite index + quick reference
+-- lib/
|   +-- bun-junit-to-meta.ts  # Bun JUnit -> runner metadata glue
+-- harness/                  # Shared TS helpers: fixtures, sdk-drive, tui-drive, windows/
+-- fixtures/                 # State files, stub projects, RE artifacts
+-- hooks/
|   +-- pre-commit            # Git hook: runs the default levels (smoke + unit + integration)
+-- smoke/                    # Level: structural validation (no LLM, seconds)
+-- unit/                     # Unit, process, and workflow contracts (no LLM)
+-- integration/              # Level: cross-component contracts + live stage/CLI utilities
+-- e2e/                      # Level: full lifecycle, worktree, rendered terminal journeys
```

あらゆるテストは `bun` で走る `t*.test.ts` ファイルであり、シェルテスト
ファイルはありません。4 つのディレクトリが、このスイートの 4 レベルを構成します。

## テスト

このプロジェクトのテストスイートは**完全に TypeScript** 製で（`.sh` テストファイルは 0）、
`smoke`, `unit`, `integration`, `e2e` の 4 レベルに整理されています。これは
古典的な 3 層ピラミッド（スモーク + ユニット = L1 プロトコル、統合 =
L2 ステージ、エンドツーエンド = L3 受け入れ）に対応します。すべて TS であることで、スイートは
構造上クロスプラットフォームになります。つまり、同じファイルが主要なデスクトップ・サーバー OS とネイティブ
Windows で同一に動きます。テストはファイル存在確認からレンダリング済みターミナルの
一連の操作まであらゆるものを検証し、フック、エージェント、ステージ、設定への変更が
リグレッションを持ち込まないことを保証します。

### テストレベル

| レベル | ディレクトリ | 対象 |
|-------|-----------|----------------|
| **スモーク** (L1) | `tests/smoke/` | ファイル存在、エージェント / ステージ / プロトコル構造、`SKILL.md` グラフ整合性、`settings.json` スキーマ。欠落ファイルや誤命名ファイルを捕捉する高速な構造チェックです。LLM は使いません。 |
| **ユニット** (L1) | `tests/unit/` | フック、CLI ツール、ステージ / エージェントのメタデータ、ナレッジインベントリ、オーケストレーションエンジンの契約。この実行ティアには現在、ユニット、プロセス／アダプター、決定論的なワークフローのテストが含まれます。このディレクトリは、単一コンポーネントの隔離や低コストを意味しません。LLM は使いません。 |
| **統合** (L2) | `tests/integration/` | コンポーネント横断契約（スコープからステージへの対応、ステージとエージェントのクロスチェック、プロトコル準拠、監査 / ランタイムグラフのエンドツーエンド）と、`claude` CLI または SDK を通して駆動される実行中のステージ / CLI ユーティリティ。`claude` がなければ実行中のファイルはきれいにスキップされます。 |
| **E2E** (L3) | `tests/e2e/` | フルライフサイクルとワークツリープリミティブ、さらに実際のユーザー質問ゲートへ答えるとディスク状態が進むことを証明するレンダリング済みターミナル（`tui-drive.ts`）の一連の操作。実行中の一連の操作には `claude` + Bedrock 認証情報が必要で、`AIDLC_TUI_LIVE=1` の後ろにゲートされています。 |

完全なテスト戦略、網羅率レジストリ、テスト追加方法については [テスト](09-testing.md) を参照してください。

## 参照先

- [オーケストレーター](03-orchestrator.md) -- `SKILL.md` の詳細
- [ステージプロトコル](04-stage-protocol.md) -- 振る舞い契約
- [エージェントシステム](05-agent-system.md) -- エージェント構造と設定
- [フックとツール](06-hooks-and-tools.md) -- フック実装
- [ナレッジシステム](10-knowledge-system.md) -- 2 層アーキテクチャ
- [図版集](diagrams.md) -- すべての Mermaid 図を 1 か所に集約
