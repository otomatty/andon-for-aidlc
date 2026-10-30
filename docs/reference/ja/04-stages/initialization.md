# 初期化フェーズのステージ（0.1–0.3）

## フェーズ概要

初期化フェーズは、AI-DLC ワークフローの五フェーズの最初です。ステージ 0.1 から 0.3 を走り、**インテントを作り**、レコードディレクトリを `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`（以下 `<record>/`）に作成します。状態ファイル、スコープ内フェーズごとのディレクトリ 1 つ、ワークスペースの分類、ルーティング設定付きです。別の初期構成コマンドはありません。ワークスペースの共通構成は、インストール済み、またはバージョン別の `runtime/<harness>/` 投影にあらかじめ同梱されます。エンジンがインテントを作るのは、本人が何を作るかを述べて、エンジンが提案した計画を選んだとき、またはスコープを説明付きで指名したとき（`/aidlc --scope <name> "<description>"` または `/aidlc <name> "<description>"`）です。作業の無いプロジェクトで引数無しの `/aidlc` を実行すると、何を作るかを尋ねます。

このフェーズの 3 ステージはどのスコープでも走ります。条件付きステージはありません。どのステージも承認ゲート無しで自動進行します。

Claude Code では、歓迎メッセージはセッション開始時に `.claude/settings.json` の `companyAnnouncements` 項目経由で描かれます。他のハーネスは歓迎メッセージを同梱しません。ステージではありません。ステージファイルも、監査イベントも、チェックボックスもありません。

3 ステージはすべて、1 回の決定論的な呼び出し、つまり作業の開始時にエンジンが指名する作成コマンドの中で走り、1 秒未満で完了します。ネイティブインストールの空のプロジェクトでは次のとおりです:

```text
$ aidlc engine intent create --scope feature --arguments "A notes app where I can tag notes and search them" --label "tagged notes"
Intent created: 261013-tagged-notes (space: default)
State initialized: feature scope, 32 stages, Standard depth
Project type: Greenfield
Languages: Unknown
Frameworks: Unknown
Build System: Unknown
First post-init stage: intent-capture (IDEATION)
```

レコードディレクトリの名前は作成日とラベルです（`<YYMMDD>-<label>`）。説明の全文は `<record>/project-description.json` に保存されます。

## スコープ駆動のステージ包含

| スコープ | 含まれるステージ |
|-------|----------------|
| enterprise | 全部 0.1–0.3 |
| feature | 全部 0.1–0.3 |
| mvp | 全部 0.1–0.3 |
| poc | 全部 0.1–0.3 |
| bugfix | 全部 0.1–0.3 |
| refactor | 全部 0.1–0.3 |
| infra | 全部 0.1–0.3 |
| security-patch | 全部 0.1–0.3 |
| classic | 全部 0.1–0.3 |
| workshop | 全部 0.1–0.3 |
| express | 全部 0.1–0.3 |

## ステージ要約

| Slug | # | ステージ名 | 条件 | リードエージェント | Mode |
|------|---|------------|-----------|------------|------|
| workspace-scaffold | 0.1 | Workspace Scaffold | ALWAYS | (orchestrator) | auto-proceed |
| workspace-detection | 0.2 | Workspace Detection | ALWAYS | (orchestrator) | auto-proceed |
| state-init | 0.3 | State Initialization | ALWAYS | (orchestrator) | auto-proceed |

---

## ステージ 0.1 — Workspace Scaffold

| フィールド | 値 |
|-------|-------|
| Stage # | 0.1 |
| Slug | workspace-scaffold |
| Phase | Initialization |
| Lead Agent | (orchestrator) |
| support_agents    | — |
| Execution | ALWAYS |
| Mode | Auto-proceed（承認ゲート無し） |

### 手順
1. 必要なら `<record>/` ディレクトリを作る
2. スコープが実行する各フェーズの成果物ディレクトリと、`<record>/verification/` を作る
3. 空のスペース単位 `aidlc/spaces/<space>/knowledge/` ディレクトリ（自由形式。エージェントごとのサブディレクトリも README も無し）と、空の CodeKB 親ディレクトリ `aidlc/spaces/<space>/codekb/` を作る（その中のリポジトリのフォルダは、Reverse Engineering が書いたときに現れる）
4. インテントの `audit/` シャードを作り、初期化フェーズの `WORKFLOW_STARTED` と `PHASE_STARTED` を記録する
5. `STAGE_STARTED`、`WORKSPACE_SCAFFOLDED`、`STAGE_COMPLETED` を記録する

### 入力
- 無し（入口）

### 出力
- スコープが実行するフェーズごとの成果物ディレクトリ 1 つ: `<record>/initialization/`、および EXECUTE ステージを少なくとも 1 つ持つ `ideation/`、`inception/`、`construction/`、`operation/` のそれぞれ。スコープが外すフェーズはディレクトリを得ません（bugfix レコードに `ideation/` は無い）。ステージごとのサブディレクトリはここでは作りません。ステージのディレクトリは、最初に成果物を書いたときに現れます
- `<record>/verification/`（どのスコープでも作る）
- 空のスペース単位 `aidlc/spaces/<space>/knowledge/` ディレクトリと `aidlc/spaces/<space>/codekb/` 親ディレクトリ（スペースの `intents/` の隣）
- インテントの `audit/` シャード（そのヘッダ、ワークフローとフェーズの開始行、足場の行）

### 注
- 冪等 — すでに存在するディレクトリとファイルは飛ばす
- `aidlc-utility intent-create` の中で走る。LLM 経由ではない

---

## ステージ 0.2 — Workspace Detection

| フィールド | 値 |
|-------|-------|
| Stage # | 0.2 |
| Slug | workspace-detection |
| Phase | Initialization |
| Lead Agent | (orchestrator — 決定論的な規則ベースのスキャナ) |
| support_agents    | — |
| Execution | ALWAYS |
| Mode | Auto-proceed（承認ゲート無し） |

### 手順
1. プロジェクトフォルダ直下のソースファイルと、既知のソースフォルダ（`src/`、`app/`、`lib/`、`pages/`、`components/`、`tests/`）の中の 6 レベルまでのソースファイルを数え、トップのマニフェストとフレームワークの信号を読む。トップに既存コードを示すものが何も無いときは、コンテナフォルダの中のプロジェクトを探す。同じ信号で 3 レベル下までフォルダを歩き、コードを持つ最初のフォルダでその枝を止める。隠しフォルダ、下記の除外フォルダ、既知のソースフォルダ、サンプルや文書のような名前のフォルダ（`doc`/`docs`、`example`/`examples`、`sample`/`samples`、`demo`/`demos`、`reference`、`testdata`、`fixtures`、`templates`、`scripts`、`aidlc`）は飛ばす。`apps/wordbook/` にあるプロジェクトは、グリーンフィールドと分類されずにこの方法で見つかる
2. 拡張子ごとにファイルを数え、第一 / 第二言語を決める。AI-DLC がプロジェクトへ丸ごと書き込んだファイル（Cursor のルートの `install.ts` など）は数えない。インストール済みの各ハーネスは、それらを `<harness directory>/tools/data/aidlc-projection.json` に列挙している
3. 既知の設定ファイル名でフレームワークを検出する（Next.js、Vite、Angular、Nuxt、Remix、Gatsby、Astro、Svelte、NestJS）。React は `package.json` の依存経由、Django は `manage.py` 経由、Rails はそれを名指しする `Gemfile` 経由、Spring Boot はそれを名指しする `pom.xml` 経由
4. マニフェスト + ロックファイルでビルドシステムを検出する（npm/yarn/pnpm/bun/poetry/uv/hatch/python/setuptools/pip/cargo/go/maven/gradle/composer/bundler）
5. あれば `.gitmodules` を読み、宣言したサブモジュールパスを初期化について探る
6. `stages/initialization/workspace-detection.md` の規則でグリーンフィールド対ブラウンフィールドを分類する
7. `STAGE_STARTED` + `WORKSPACE_SCANNED` + `STAGE_COMPLETED` イベントを追記する

### 入力
- プロジェクトのファイルシステム（読み取り専用スキャン）

### 出力
- ワークスペースの分類（グリーンフィールド / ブラウンフィールド）
- 技術スタック（言語、フレームワーク、ビルドシステム）
- スキャン結果を捉える `WORKSPACE_SCANNED` 監査イベント。コードがプロジェクトフォルダ下の `apps/wordbook/` にあるプロジェクトでは次のとおりです:

```text
## Workspace Scanned
**Timestamp**: 2026-10-13T12:59:58Z
**Event**: WORKSPACE_SCANNED
**Project Type**: Brownfield
**Languages**: TypeScript
**Frameworks**: React
**Build System**: npm (package.json)
**Nested Root**: apps/wordbook
**Details**: Deterministic rule-based scan
```

### 注
- `aidlc-utility intent-create` 内の決定論スキャナとして走る。LLM サブエージェントディスパッチは無し
- シンボリックリンクは辿らない（`lstatSync` によるサイクル保護）
- `.claude/`、`.kiro/`、`.codex/`、`.opencode/`、`.aidlc/`、`.cursor/`、`node_modules/`、`.git/`、`dist/`、`build/`、`.next/`、`target/`、`vendor/` の中のファイルは決して数えない。`aidlc/` ツリーも数えない（トップレベルの集計はプロジェクトフォルダ自身のファイルだけを読み、コンテナの探索は `aidlc/` を飛ばす）
- `devDependencies` だけの `package.json` はツール / 足場として扱い、それだけではブラウンフィールド分類にしない
- パースできる `.gitmodules` にサブモジュールパス項目が少なくとも 1 つあることはブラウンフィールド信号です（サブモジュールディレクトリが未初期化でも、リポジトリメタデータがコードを宣言する）。サブモジュールパスが未初期化のとき、スキャンは警告し `git submodule update --init --recursive` を指名します。`WORKSPACE_SCANNED` イベント（`Submodules` フィールド + `Details` の手当て）と作成 stdout に提示するので、コンダクターが中継できます。言語はスキャンどおりです
- スキャンより本人の言葉が優先される: `intent-create --project-type <greenfield|brownfield>` は `Project Type` を設定し、`Project Type Source: you` を書く（指定がなければ `workspace scan`）。あとから `workspace reclassify --project-type <t>` は再スキャンし、その種別を本人のものとして記録する。また、スキャンがグリーンフィールドとして設定した作業に Construction より前にコードが加わると、`next` が一度だけ尋ねる（[CLI ガイド](../../guide/12-cli-commands.md) の `/aidlc --project-type` を参照）

---

## ステージ 0.3 — State Initialization

| フィールド | 値 |
|-------|-------|
| Stage # | 0.3 |
| Slug | state-init |
| Phase | Initialization |
| Lead Agent | (orchestrator) |
| support_agents    | — |
| Execution | ALWAYS |
| Mode | Auto-proceed（承認ゲート無し） |

### 手順
1. 状態ファイルを組み立てる（そのフィールドは `.claude/knowledge/aidlc-shared/state-template.md` に文書化されている。ツールはコードから書く）
2. スコープ写像 + 深度 + テスト戦略を適用する
3. グリーンフィールドでは `reverse-engineering` を SKIP にする
4. 初期化後の最初のステージを `[-]` にした完全な `<record>/aidlc-state.md` を書く
5. `STAGE_STARTED`、`WORKSPACE_INITIALISED`、`STAGE_COMPLETED` を記録し、続いて計画が実行する最初のフェーズへの引き継ぎとして `PHASE_COMPLETED`、`PHASE_VERIFIED`、`PHASE_STARTED` と、その最初のステージの `STAGE_STARTED` を記録する

### 入力
- workspace-detection からのワークスペースの分類（同じツール呼び出し）
- スコープ: 作成コマンドが持つ `--scope`（本人が選んだ計画）。それ無しで手動実行したときは、環境変数または AI-DLC 設定の `AWS_AIDLC_DEFAULT_SCOPE`、それも無ければ `classic`
- 渡されていれば深度 / テスト戦略の上書き
- コンパイル済み `tools/data/stage-graph.json` と `tools/data/scope-grid.json`

### 出力
- `<record>/aidlc-state.md`（全項目を設定済み）
- `WORKSPACE_INITIALISED` 監査イベント

### 注
- 初期化後の最初のステージは、計画が実行するステージのうちステージ順で最初のものです。グリーンフィールドでは reverse-engineering が SKIP になります。Ideation を実行するスコープは既存コードでも intent-capture から始まり、reverse-engineering はあとの Inception で実行されます。同梱のスコープでは次のとおりです:

| スコープ | グリーンフィールドの開始ステージ | ブラウンフィールドの開始ステージ |
|-------|----------------------|----------------------|
| enterprise, feature, mvp, poc | intent-capture | intent-capture |
| bugfix, express, refactor, security-patch | requirements-analysis | reverse-engineering |
| classic, workshop | practices-discovery | reverse-engineering |
| infra | practices-discovery | practices-discovery |

npm プロジェクトがすでにあるフォルダでの bugfix では次のとおりです:

```text
$ aidlc engine intent create --scope bugfix --arguments "Prices with an odd number of cents round the wrong way" --label "price rounding"
Intent created: 261013-price-rounding (space: default)
State initialized: bugfix scope, 9 stages, Minimal depth
Project type: Brownfield
Languages: TypeScript
Frameworks: Unknown
Build System: npm (package.json)
First post-init stage: reverse-engineering (INCEPTION)
```

- `/aidlc-init --scope <name> <description>`（明示の作成包装）から起動したときは、オーケストレータはこのステージのあと止まる。`/aidlc-init --scope <name>` だけのときは、先に作業の目的を尋ねる。説明だけを渡した `/aidlc-init` は、先に計画の提案を示し、そのあとは `/aidlc` と同じように続ける
- 作成が `/aidlc`（作業の説明と本人が選んだ計画、または説明付きで指名したスコープ）から来たときは、コンダクターはそのあと `next` をもう一度実行し、同じチャットのまま初期化後の最初のステージへ続く

---

## 再初期化

再 init フラグはありません。作成はインテントごとに一度走ります。ワークスペースの共通構成自体はあらかじめ同梱され、再構成されません。既存インテントの上の 2 回目の `/aidlc` は再初期化せず再開します。やり直すには、`/aidlc intent archive <name>` で作業を脇へ置き、`/aidlc "<what to build>"` で新しい作業を述べます。新しい作業は自分の `<record>/` を得ます。アーカイブしても、古いレコードとその監査証跡はディスクに残ります（1 行目の矢印は、ここでは `->` で示しています）:

```text
$ aidlc engine intent archive tagged-notes --reason "starting over with a smaller first step"
Archived intent -> 261013-tagged-notes (space: default). Its record and audit trail stay on disk; /aidlc intent list --all shows it and /aidlc intent unarchive 261013-tagged-notes brings it back.
$ aidlc engine intent list --all
Intents in space "default":
  261013-tagged-notes  [archived]

(no active intent - switch with /aidlc intent <name>)
```

## 注

- 3 ステージとも自動進行 — 初期化フェーズに承認ゲートは無い
- 作成ツールは `Current Stage`、状態チェックボックス、監査の行を、同じ呼び出しの中で自ら書きます
- コンダクターは初期化のライフサイクル状態を直接直しません
- 初期化から計画が実行する最初のフェーズへの引き継ぎに統治境界検査はありません。作成は、背後に検査の無いまま `PHASE_COMPLETED`、`PHASE_VERIFIED`、`PHASE_STARTED` の行を書きます

## 関連

- [Architecture](../01-architecture.md) — 実行モデルの概要
- [Orchestrator](../03-orchestrator.md) — ルーティングの論理
- [Stage Protocol](../04-stage-protocol.md) — 状態追跡の規則
- [Ideation Stages](ideation.md) — 次のフェーズ
