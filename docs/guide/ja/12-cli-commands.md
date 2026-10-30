# CLI コマンド

AI-DLC には、利用者が使うコマンドの面が 2 つあります。ハーネスのチャットコマンドは `/aidlc`（Codex では `$aidlc`）でワークフローを進めます。インストールしたネイティブの `aidlc` コマンドは、プロジェクトを初期化し、マシンのライフサイクル、診断、ライフサイクルの経路を提供します。

> **起動の接頭辞はハーネスで違います。** Claude Code、Kiro IDE、Kiro CLI、
> Cursor、opencode、GitHub Copilot では `/aidlc`。Codex CLI では `$aidlc`
> （または `/skills` → aidlc）。フラグと動きはどちらでも同じで、違うのは接頭辞だけです。
> 例は `/aidlc` で書いてあります。Codex では `$aidlc` に読み替えてください。
> [Kiro CLI](harnesses/kiro-cli.md)、
> [Kiro IDE](harnesses/kiro-ide.md)、[Codex CLI](harnesses/codex-cli.md)、
> [Cursor](harnesses/cursor.md)、[opencode](harnesses/opencode.md)、
> [GitHub Copilot](harnesses/copilot.md) のハーネス案内を見てください。

> **Cursor のショートカット。** Cursor は `/aidlc-status`、
> `/aidlc-jump --stage <slug|#>`（または `--phase <name|#>`）、
> `/aidlc-scope <name>` をネイティブスキルとしても出します。下の対応する `/aidlc`
> 形を包んだもので、エンジンは同じです。別名であり、別の状態経路ではありません。

---

## 早見表

| コマンド | 説明 |
|---------|-------------|
| `/aidlc [scope]` | スコープを明示して新しいワークフローを始める |
| `/aidlc [description]` | 新しいワークフローを始める。エージェントが説明文から計画を提案する（合うものがなければ compose を提案する） |
| `/aidlc compose "<task>"` | 適応型コンポーザーを強制する。その仕事向けの EXECUTE/SKIP 計画を提案する |
| `/aidlc compose --report <path>` | スキャン報告から compose する（所見を短い fix-and-ship 実行へ振り分ける） |
| `/aidlc --new-scope "<task>"` | 配布スコープが当たっても、コンポーザーに独自の計画を合成させる |
| `/aidlc` | 開いているワークフローを再開する。まだ作業が無ければ、エージェントが何を作りたいかを尋ねる |
| `/aidlc park` | 後のセッションや別の人のために、アクティブなワークフローを現在のステージ境界で保留する |
| `/aidlc team-board [--snapshot] [--space <name>] [--intent <name>]` | 読み取り専用の Team Construction ボード（Unit の進捗、クレーム、マージの準備状況） |
| `/aidlc intent [name]` | アクティブなスペースのインテントを一覧する（`--all` でアーカイブ済みも含む）。または既存のインテントへ切り替える |
| `/aidlc intent archive <name>` | 進行中または完了済みのインテントを、記録を削除せずに終える。`unarchive <name>` で戻す |
| `/aidlc intent add-repo <name> [--url <address>]` | どのステージでも、アクティブな作業に兄弟リポジトリを足す。まだここにないときは先にクローンする。`remove-repo <name>` で 1 つ外す（最後の 1 つは外せない） |
| `/aidlc intent set-repos <name,...>` | アクティブな作業が対象とする兄弟リポジトリを正確に設定する。`--all` は記録されたすべてのリポジトリを保つ |
| `/aidlc intent add-checkout <path>` | ハーネスのフォルダの中、またはプロジェクトの外の worktree に置かれたコードをレビューの対象にする。`remove-checkout <path>` で外す |
| `/aidlc space [name]` | スペースを列挙する。または既存スペースへ切り替える |
| `/aidlc space-create <name>` | default スペースの org ルールと、空のチーム／プロジェクトのプラクティスから始まる新しいスペースを作る |
| `/aidlc knowledge <verb>` | 自分の文書を索引し、読む（`onboard`、`sync`、`list`、`show`、`associate`、`dissociate`、`rebind`、`summarize`） |
| `/aidlc --status` | 読み取り専用の状況要約を出す |
| `/aidlc --config [section]` | 会話でプロジェクト方針を決め、正確な決定論的 config フラグで着地させる |
| `/aidlc --claim <unit> [--team <label>] [--rhythm <per-stage\|unit-end>]` | チーム所有の空き Unit を原子的にクレームし、このチェックアウトをその試行へ結ぶ |
| `/aidlc --release <unit>` | スコープ無しの main から、tombstone を公開して生きている Unit のクレームを解放する |
| `/aidlc unit adopt <unit>` | 新しいクローンで、チェックアウトした生きているクレームブランチを adopt する |
| `/aidlc unit participate` | このクローンを、ガイド付きの Unit クレームピッカーの対象にする |
| `/aidlc unit publish <unit>` | スコープ付きチェックアウトのクリーンなコミット済み候補を、クレーム ref へ CAS 公開する |
| `/aidlc unit pin <unit>` | スコープ無しの main から、完了した候補 OID を 1 つピン留めし、検証する |
| `/aidlc unit gate <unit> ...` | ピン留めした OID と世代に対するマージ判断を記録する |
| `/aidlc unit land <unit> ...` | 再開可能な git → 状態 → 監査の着地トランザクションを実行する |
| `/aidlc unit merge-status <unit>` | ローカルのピン留めマージのトランザクション台帳を読む |
| `/aidlc unit status` | 現在クレームできる、クレーム済み、依存でブロック中の Unit の集合を読む |
| `/aidlc --doctor [--check-updates]` | ヘルスチェックを実行する。明示フラグは更新メタデータを取り直す |
| `/aidlc --doctor --export` | 新しいヘルスチェックを実行し、共有用の小さくマスキングした診断報告を書く |
| `/aidlc --stage <slug\|#>` | 指定ステージへジャンプする |
| `/aidlc --stage <slug> --single` | 1 ステージだけ隔離実行する。ワークフローは進めない |
| `/aidlc --phase <name\|#>` | フェーズの先頭へジャンプする |
| `/aidlc --scope <name>` | アクティブなスコープを変える |
| `/aidlc --depth <level>` | 深度を上書きする（minimal、standard、comprehensive） |
| `/aidlc --test-strategy <level>` | テスト戦略を上書きする（minimal、standard、comprehensive） |
| `/aidlc --project-type <type>` | この作業が新しいプロジェクトか既存のコードかを伝える（greenfield、brownfield）。ワークフロー途中では再スキャンし、既存のコードなら Reverse Engineering を実行する |
| `/aidlc --review <class>` | この実行のステージレビューを設定し、スコープの上限を置き換える（adversarial、advisory、none） |
| `/aidlc --guard-policy <value>` | この作業でガードがどこまで道を譲るかを設定する（strict、relaxed、off）。`--change-control` は旧称 |
| `/aidlc --sensors <on\|off>` | このインテントで、センサーの自動実行とブロッキングセンサーの検査を設定する |
| `/aidlc --learnings <on\|off>` | このインテントで、学びの日誌と学びのゲートの手続きを設定する |
| `/aidlc --summary-confirmation <on\|off>` | このインテントで、統合サマリーの確認チェックポイントを設定する |
| `/aidlc --plan-approval <on\|off>` | このインテントで、各コード計画をビルド前に承認のため示すかを設定する（off にできるのは本人だけ） |
| `/aidlc --collaborators <on\|off>` | このインテントで、ステージがサポートエージェントを呼ぶか、リードエージェントだけで実行するかを設定する |
| `/aidlc --statusline <on\|off>` | AI-DLC の進捗をステータスラインに表示する、または自分のステータスラインに戻す（Claude Code: 自分だけ。Codex: プロジェクトの全員） |
| `/aidlc config get <key>` | アクティブなワークフロー設定を出す（`depth`、`test-strategy`、`review`、`guard-policy`、`sensors`、`learnings`、`summary-confirmation`、`plan-approval`、`collaborators`、`guard.<fence>`） |
| `/aidlc config set <key> <value> [--key value ...]` | 共有の設定コマンドでインテント設定を変える。フラグとして入力された設定や、平易な言葉で頼まれた設定は、エージェントが実行する |
| `/aidlc config set guard.<fence> <on\|off>` | この作業でガードを 1 つ off にする、またはポリシーの語を超えて on に戻す（review-freeze、state-transition、reviewer-scope。`guard.plan-approval` は `plan-approval` の別名） |
| `/aidlc config list` | アクティブなワークフロー設定 13 個をすべて一覧する（構造化出力は `--json`） |
| `/aidlc plugin select [names]` | この導入の有効プラグイン一覧を見る、またはセットする |
| `/aidlc plugin list` | 導入済みプラグインと有効状態を列挙する |
| `/aidlc plugin sync` | 導入済みプラグインルートを、現在の導入へ compose する |
| `/aidlc plugin validate [path]` | 書いたプラグインを検証する（`--with <base-root>` はベースプラグインのエージェントを検査する。構造化した所見は `--json`） |
| `/aidlc plugin build <harness> [outDir]` | ホスト向けプラグイン投影をビルドする（ソースは `--plugin-root <path>`） |
| `/aidlc --version` | フレームワークの版を出す |
| `/aidlc --help` | 使い方を出す |
| `bun .claude/tools/aidlc-utility.ts select-plugins [names]` | プラグイン選択の直接ユーティリティ形 |
| `aidlc engine worktree restore --slug <slug> [--parked <stamp>] [--raw]` | 保留した Bolt の試行から、別のチェックアウトへファイルを復元する |
| `aidlc engine worktree purge --slug <slug> [--parked <stamp> \| --older-than <days>]` | 復元したチェックアウトがなくなった後、選んだローカルの復旧 ref を削除する |

`--status`、`--doctor`、`--help`、`--version` は単独でも、ほかのフラグと並べても動きます。説明文の中では、頼んだ内容の一部として扱われます。`/aidlc add a --version flag that prints the version from package.json` はその作業を始め、AI-DLC の版は出しません。

---

## 端末の色

公開された端末コマンド 6 つ（`config`、`doctor`、`version`、`update`、`use`、`uninstall`）は、人が読む出力にだけ、控えめな色を付けます。JSON、quiet 出力、ファイル、監査記録、TTY ではないストリームは色無しのままです。

色の選択は次の優先です:

1. `--no-color` は色を止めます。
2. 環境変数 `NO_COLOR` がセットされていれば、値に関係なく色を止めます。
3. 空でない `FORCE_COLOR` が `0` 以外なら、色を付けます。
4. それ以外は、ストリームが TTY で `TERM` が `dumb` ではないときだけ色を付けます。

判定は stdout と stderr で別々です。1 コマンドだけなら `--no-color`、シェルやプロセス環境なら `NO_COLOR=1`、端末ラッパが ANSI 色に対応するのに TTY 検出を出さないときは `FORCE_COLOR=1` です。

---

## コマンドの決め方

```mermaid
flowchart TD
    START(["What do you want to do?"])

    Q1{"Start a new\nworkflow?"}
    Q2{"Check or manage\nan existing workflow?"}
    Q3{"Verify the\nproject?"}

    A1["/aidlc feature"]
    A2["/aidlc Build a payments API"]
    A3["/aidlc"]
    A4["/aidlc --status"]
    A5["/aidlc --stage code-generation"]
    A6["/aidlc --phase construction"]
    A8["/aidlc --doctor"]

    START --> Q1
    START --> Q2
    START --> Q3

    Q1 -->|"Know the scope"| A1
    Q1 -->|"Describe what you want"| A2
    Q2 -->|"Resume where I left off"| A3
    Q2 -->|"See progress"| A4
    Q2 -->|"Jump to a stage"| A5
    Q2 -->|"Jump to a phase"| A6
    Q3 -->|"Verify setup"| A8

    style START fill:#e1bee7,stroke:#7b1fa2,color:#000
```

<!-- Text fallback: 新しいワークフロー: スコープが分かっているなら /aidlc classic。やりたいことを書くなら /aidlc Build a payments API（エージェントが計画を提案。最初のインテントは自動作成）。既存ワークフロー: /aidlc（再開）、/aidlc --status（進捗）、/aidlc --stage（ステージへジャンプ）、/aidlc --phase（フェーズへジャンプ）。セットアップ確認: /aidlc --doctor（ヘルスチェック）。 -->

---

## 詳細リファレンス

### `/aidlc [scope]` — Start with explicit scope

有効なスコープの一つで、新しいワークフローを始めます。コアは名前付きスコープを 11 出荷します。プラグインは足せます。`select-plugins` は、無効にしたプラグイン／コアのスコープを実行時から隠せます。

**構文:**

```
/aidlc enterprise
/aidlc feature
/aidlc mvp
/aidlc poc
/aidlc bugfix
/aidlc refactor
/aidlc infra
/aidlc security-patch
/aidlc classic
/aidlc workshop
/aidlc express
```

**動き:** フレームワークがスコープ語を認識し、何を作るかを聞きます（答えるまで何も作られません）。そのあと、あなたの言葉を依頼として、その計画で Initialization フェーズを実行し、最初の領域ステージへ入ります。ワークフローがすでにアクティブな場合、スコープ語だけならその作業を続け、スコープ語に説明が続く場合は、その説明が新しい作業かどうかを尋ねます。スコープ語が長い説明の最初の語でもある場合（`/aidlc classic car rental website`）、それは決めつけずに読み取られます。アシスタントはどちらの意味かを判断し、一度だけ尋ねることもあるので、選んでいない計画にその語が使われることはありません。スコープ語と 1 語だけの場合（`/aidlc feature flags`、`/aidlc bugfix typo`）も同じように読み取られるので、`feature flags` はあなたの依頼のままで、`bugfix typo` はタイポについての bugfix 作業を始めます。それが計画だと示すのはコロンだけで（`/aidlc bugfix: Fix duplicate todos`）、`--scope` も同じ意味になります（`/aidlc --scope bugfix Fix duplicate todos`）。11 択すべての実務比較は [Workflow Profiles](workflow-profiles.md) を参照してください。

**例:**

```
/aidlc bugfix
> I'll use the bugfix plan. What should I work on? Tell me in your own words and I'll start it.
> The login API returns 500 when email contains a plus sign
```

---

### `/aidlc [description]` — Start from a description

作りたいことを書けば、エージェントがそれに合う計画を提案し、エンジンがその確認を求めます。

**構文:**

```
/aidlc Build a REST API for inventory management
/aidlc Fix the login timeout bug
```

**動き:** エージェントが説明文を読み、それに合う計画を提案します（バグ報告なら通常は bugfix）。エンジンはその計画名と実効の手続き（ステージ数、承認ゲート数、Unit ごとの展開。どれもコンパイル済みグリッドから）を 1 行で確認します。greenfield の作業では Reverse Engineering が外れ、Unit ごとの条項は `units-generation` が実行されて Unit DAG を作るときだけ出ます。既製の計画が合わないときは、黙った既定ではなく compose の提案が出ます（下の `/aidlc compose`）。ワークフローが始まる前に、確認するか上書きします。計画名で始まる説明は、すべての語がそのまま残ります（`/aidlc classic car rental website` はレンタカーのウェブサイトについての依頼です）。その語が計画を指すかどうかは、エージェントが読み取ります。

**例**（新しいプロジェクトの場合。既存のコードベースでは bugfix は Reverse Engineering も実行するため、行は 6 stages、6 approval gates になります）:

```
/aidlc Fix the ProfileSerializer null pointer
> I'd run the "bugfix" plan for: "Fix the ProfileSerializer null pointer" - 5 stages, 5 approval gates. Do you want me to go ahead with it, use a different plan, or tailor one to this task?
```

**シェルで運べない要求。** Windows の cmd.exe は改行でコマンドを終え、引用符の中でも `%NAME%` や `!NAME!` の組を置き換えます。さらに aidlc のランチャーは cmd.exe にもう一度読まれます。そのような文字を含む要求は、コマンドラインではなくファイル経由でエンジンに届きます（Kiro IDE では、二重引用符、`“` や `’` のような印刷用の引用符、`&`、`|`、`<`、`>`、`^` のいずれか、または末尾のバックスラッシュを含む要求も、エージェントはこの方法で送ります。Windows PowerShell や cmd.exe がそれらを変えうるためです）。エージェントはそれを `aidlc/.aidlc-request-text/request.txt` に書き、ほかのフラグとともに `aidlc engine orchestrate next --request-file aidlc/.aidlc-request-text/request.txt` を実行します。エンジンが読むのは `aidlc/.aidlc-request-text/` の直下にある通常ファイルだけで、リンクを経由せず、64 KiB までです。その言葉は書かれたとおりに使い、コマンドが進んだらファイルを削除します。

---

### `/aidlc compose` - The adaptive composer

配布スコープが当たっても、コンポーザーを強制します。使う場面は 3 つです。

```
/aidlc compose "harden the deployment pipeline and add observability"
/aidlc compose --report sonar.json
/aidlc compose            (mid-workflow: re-shape the pending stages)
```

**動き:** コンダクターがコンポーザーエージェントをディスパッチします。コンポーザーは仕事（またはスキャン報告、または実行中のワークフローの状態）を読み、読み取り専用の `detect` スキャンを実行し、実装エントロピーの 5 成分（インテントの曖昧さ、構造の不確かさ、検証エントロピー、リスク、未解消の前提。CodeKB MCP が設定されていればその分析、無ければワークスペーススキャンに基づく）を見積もり、最小で足りる EXECUTE/SKIP グリッドを、スコア内訳とすべての EXECUTE / SKIP の理由付きで提案します。ゲートで承認、編集、却下します。承認すると、配布スコープに一致した場合は AI-DLC がそのままワークフローを作ります。カスタム計画の場合は、最も近い配布スコープ（新しいプロジェクトでは、合うものがあれば新規作業向けの最も近いもの）上に、計画自身のステージ変更（`--skip` / `--add`）付きで、同じターンでワークフローを作り、スコープファイルは書きません。計画はこの作業のものです。カスタム計画のゲートは **Approve and save as scope** も提示します。これは名前を尋ね、作業が作られるときに計画を再利用可能なスコープとして残します（その保存は [`scope save`](#aidlc-engine-scope-save-keep-a-plan-as-a-scope) が行います）。後で「save this plan as <name>」と言うと、`scope save` そのものが実行されます。front / report の提案には、空でない `creationDescription` が必ず付きます。渡された場合は元の仕事文そのもの、無ければ報告／計画に根ざした説明です。仕事から始めた合成では、作成時にゲートの `--request <id>` を渡し、エンジンが元の説明を取り出します。報告から始めた合成や仕事文のない合成では、説明を `--` の後にシェル安全な引数 1 つとして、その request id とともに渡します。compose の承認は、スコープだけで説明がない状態では続行できません。進行中の提案は、`recompose` 動詞で未着手ステージの接尾辞の反転として着地します（監査ロックの下、厳格検証、`RECOMPOSED` を監査）。`--new-scope` は合成を強制します。`--report <path>` は振り分けた所見をインテントへ種まきします。`/aidlc-compose` スキルは、同じ経路の入力できるショートカットです。ワークフローの途中では、チャットで言うだけでも構いません。範囲の決まっていない依頼（「what else can we cut?」）は認識され、同じゲートと動詞へ流されるので、リテラルの `compose` は不要です。一方、ステージを名指しする依頼（「can we skip market research?」）は計画をその場で変え、元に戻す方法を示します（Claude 以外のハーネスでは、リテラルの動詞が文書化された確実な経路のままです）。

全体の流れは [Scopes and Depth - The Adaptive Composer](05-scopes-and-depth.md#the-adaptive-composer) を参照してください。

---

### `/aidlc` — Resume existing workflow

状態ファイルがあるときに引数なしで実行すると、再開します。

**構文:**

```
/aidlc
```

**動き:** `aidlc-state.md` を読み、`/aidlc --resume` と同じように保存済みのチェックポイントから続けます。別のことをしたい場合は、やり直し、ステージへのジャンプ、新規開始を伝えてください。詳細は [Session Management](11-session-management.md) を参照してください。

`/aidlc --resume` も保存済みのチェックポイントから直接続けます。その後に入力した語（`/aidlc --resume redo the scan`）は、保留中のワークフローの保留を解いたあと、`/aidlc` だけのときと同じように読まれます。明示の目標を優先させ、通常のジャンプの動きで進めたいときは `--stage <slug>` を足します。

状態ファイルが無ければ、新しいワークフローとして扱い、スコープ／説明を聞きます。

---

### Workflow Initialization — automatic

手動コピーのインストールには、足場コマンドはありません。Bun 形の `aidlc-copy-runtime-X.Y.Z.tar.gz` から来る版付きの `runtime/<harness>/` シェル（`.claude/` エンジンと `aidlc/spaces/default/memory/`）は、あらかじめ組み立てられていて、ネイティブの `aidlc` 実行ファイルを必要としません。エンジンが最初のインテントを作るのは、作りたいことを書いて、エンジンが提案した計画を確認したときです（作業の無い状態で引数無しの `/aidlc` を実行すると何を作りたいかを尋ね、スコープだけなら作業の目的を尋ねます）。作成は Initialization の 3 ステージ（Workspace Scaffold、Workspace Detection、State Init）を、決定論的なツール呼び出し 1 回で実行します。インテントのレコードディレクトリを `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` に作り（`audit/` シャードディレクトリ、スコープが実行するフェーズごとの成果物ディレクトリ、`verification/`）、空のスペース単位の `aidlc/spaces/<space>/knowledge/` ディレクトリも作り、ルールベースのワークスペーススキャンを実行し、そのインテントの `aidlc-state.md` にスコープ計画を書きます。
初期化の一連のイベント（`WORKFLOW_STARTED`、`WORKSPACE_SCAFFOLDED`、`WORKSPACE_SCANNED`、`WORKSPACE_INITIALISED`、ステージごとの `STAGE_STARTED` / `STAGE_COMPLETED`）を記録します。スコープを指定すると（`/aidlc --scope feature`）初期スコープの種になります。無ければ実際の `AWS_AIDLC_DEFAULT_SCOPE` 環境変数、次に記録済みの `aidlc config flags --default-scope` の値、最後に `classic` を解決します。最初の実行の前にチームナレッジやガードレールを足したいときは、同梱の `aidlc/spaces/default/memory/` のファイルを編集します。スペース単位の `aidlc/spaces/<space>/knowledge/` ディレクトリは最初のインテントができたときに（空で）作られ、そこからは自由形式のファイルを足します。

プロジェクトのインストールと更新の推奨経路は、ネイティブの config コマンドです。フレームワーク開発者は、gitignore された Bun 形の `dist/` 投影を、手元で `bun scripts/package.ts` から生成できます。リリース利用者はチェックアウトからコピーしないでください。

ネイティブのマシンインストールでは、ハーネスを開く前に一度 `aidlc config` を実行します。このコマンドは同じシェルを置き、更新の基準を記録します。ワークフローのインテントの作成は、最初のチャット起動でこれまでどおり自動です。

Claude Code では、歓迎メッセージはセッション開始時に `.claude/settings.json` の `companyAnnouncements` エントリから描画されます。他のハーネスは歓迎メッセージを同梱せず、作業の状況は `/aidlc --status`（Codex では `$aidlc --status`）で確認できます。

**複数リポジトリのワークスペース。** ワークスペースルートに兄弟のコードリポジトリが複数あるとき（それぞれ `.git` を持つ直下の子ディレクトリ）、作成ステップは、インテントが触るリポジトリの集合を `intents.json` の行に記録します。既定では兄弟リポジトリを **すべて自動発見** します。インテントを特定の部分集合に絞るには、作成ツールが `--repos a,b`（リポジトリディレクトリ名のカンマ区切り）を受け付けます。これはエンジンが代わりに実行する決定論的な `aidlc-utility intent-create` ステップのフラグであり、自分で入力する `/aidlc` のフラグではありません。Construction 中、各 git 操作（worktree、swarm、Bolt）はリポジトリ 1 つを対象にします。コンダクターはそれを固定するために `--repo <name>` を渡します。必要なのは、インテントが複数のリポジトリにまたがるときだけです。リポジトリが記録されていないインテントは単一リポジトリの既定（git はワークスペース／プロジェクトディレクトリで実行される）です。チーム所有の Unit は現在この単一リポジトリの既定を必要とします。兄弟リポジトリが記録された作業では、Unit を誰が作るかは尋ねられず、最初の Construction ステップがこのセッションで作ることを 1 行で伝えます。`set-unit-ownership team` は、状態を変える前に同じ行で拒否します。[Artifacts Reference](14-artifacts-reference.md) を参照してください。

---

### `/aidlc park` — ワークフローを保留

現在のステージ間の境界できれいに止め、後のセッションで、または `aidlc/` ツリーをコミットして pull した後に別の人が、ワークフローを引き継げるようにします。

**構文:**

```
/aidlc park
```

**動き:** エンジンはこの動詞を `aidlc engine orchestrate park --person-asked` へルーティングします（エンジン自身の park で、AI-DLC が事前承認するエンジンコマンドに含まれるため、エージェントは許可プロンプトなしで実行します）。これは `WORKFLOW_PARKED` を出し、状態ファイルに保留マーカーを記録し、保留したステージを報告します。ステージは進まず、何も完了扱いにはなりません。アクティブなワークフローがない場合や、ワークフローがすでに Completed の場合、保留は拒否されます。Unit スコープのチームチェックアウト（Unit スコープのスタンプを持つ Construction の worktree）では、同じコマンドが代わりにその Unit をローカルで保留します。チェックアウトローカルの Unit 保留マーカーを書き、共有のワークフロー状態には触れず、ルーティングされたコマンドを通じて `parked` ディレクティブを出します。そのチェックアウトでの次の `/aidlc` は、その Unit がそこで保留中であることを報告します。`/aidlc --resume` で再開すると、該当するマーカーを消して続行します。この動詞は単独のトークンです。長い文の中の `park` は作業の説明として扱われるため、保留は文章でコンダクターに頼むか、動詞だけを入力してください。

利用者ごとのカーソル `aidlc/spaces/<space>/intents/active-intent` は gitignore されているため、保留されたワークフローを pull したチームメイトは、`/aidlc --resume` の前に `/aidlc intent <name>` でそれを選びます。

---

### `/aidlc team-board` — チームの進行表

チーム所有の Construction の読み取り専用ビューです。Unit の進捗、観測したクレーム、ピン留めしたマージの準備状況、クレームできる Unit、ブロッカーを示します。`Unit Ownership: team` のとき `/aidlc --status` が付け加えるのと同じボードです。

**構文:**

```
/aidlc team-board
/aidlc team-board --snapshot
/aidlc team-board --space <name> --intent <name>
```

**動き:** エンジンはこの動詞を `aidlc team-board` へルーティングし、状態、キャッシュ、監査に触れずに、その出力をそのまま表示します。受け付けるのは `--snapshot`、`--space <name>`、`--intent <name>` だけで、ほかのトークンは使い方のエラーです。`Unit Ownership: team` が必要です。

---

### `/aidlc intent [name]`：一覧と切り替え

引数なしの `/aidlc intent` は、アクティブなスペースの進行中と完了済みのインテントを一覧します。構造化出力（アーカイブ済みを含む全行）には `--json` を、人向けの一覧にアーカイブ済みのインテントを含めるには `--all` を付けます。`/aidlc intent <name>` は、曖昧さのない slug または完全なレコードディレクトリ名で、利用者ごとのアクティブインテントのカーソルを既存のインテントへ切り替えます。インテントを作ったり、ワークフローを進めたりすることはありません。
`/aidlc` の後に名前だけを入力した場合（`/aidlc auth`）も、それがここにあるちょうど 1 つのインテントの名前であれば、同じようにそのインテントを選びます。切り替えの行は、それまでのインテントと、戻るためのコマンドを示します。
`intent` の後の語が動詞でも既存インテントの正確な名前でもない場合（タイプミスや、インテントにできないこと）は、動詞と最近のインテント名とともにエージェントへ渡され、エージェントが意図を読み取るか、一度だけ尋ねます。名前の後に入力したもの（依頼や、`--guard-policy relaxed` のような設定）は、まるごとエージェントへ渡され、選んだばかりのインテントに対して実行されます。

### `/aidlc intent archive <name>`：完了させない仕事を終了する

`/aidlc intent archive <name> [--reason "<text>"]` は、進行中または完了済みのインテントを `archived` 状態に移します。何も削除されません。レコードディレクトリ、その成果物、監査シャードは元の場所にそのまま残り、アーカイブ自体はそのインテントの監査証跡に `WORKFLOW_ARCHIVED` として（`--reason` を指定した場合はそれも添えて）記録されます。レジストリの行は `archived` に、状態ファイルの `Status` は `Archived` に変わり、既定の `/aidlc intent` の一覧にはその行が表示されなくなります。アーカイブしたインテントがアクティブだった場合は、利用者ごとのカーソルが解除されるため、次の `/aidlc` は終了したステージを再開する代わりに、どのインテントで作業するかを尋ねます（残りがなければ新しい作業を作ります）。

完了済みのインテントもアーカイブできます。完了した作業を既定の一覧から隠すにはこれを使います。Bolt の worktree があるインテントもアーカイブできます。出力はその worktree を示し、インテントを戻すまで worktree はディスク上にそのまま残ります。アーカイブが拒否されるのは、Unit がクレームされたチーム所有のインテントだけです。それらの Unit はまだ別のチェックアウトで作業中だからです。

`/aidlc intent unarchive <name>` はこれを元に戻します。行と `Status` は以前の値（止まったステージでの `in-flight` と `Running`、または完了した作業なら `complete` と `Completed`）に戻り、`WORKFLOW_UNARCHIVED` が記録されます。理由を記録するのは `archive` だけです。`unarchive` に渡した `--reason` は記録されず、出力がそう伝えます。カーソルは動かさないため、続けたいときは `/aidlc intent <name>` で戻したインテントへ切り替えてください。


### `/aidlc intent add-repo <name>`：進行中の作業に兄弟リポジトリを足す

作業は、作成時に触る兄弟リポジトリを記録します（その時点のワークスペースの `.git` を持つ子、または明示した `--repos`）。後になって作業が別のリポジトリも変更すると分かったら、エージェントが理由を添えて `intent add-repo <name>` を実行し、1 行で伝えます。あなたがそう伝えて、エージェントが代わりに実行することもあります。作業が読むだけのリポジトリは足されません。リポジトリが記録され、その変更は `INTENT_REPOS_CHANGED` として監査証跡に残り、次に何が起きるかを伝える 1 行が表示されます。Reverse Engineering がすでに実行されている場合、それとコード知識を読むステージは、見直すまで新しいリポジトリについて遅れていると表示されます。まだ実行されていなければ、実行時に新しいリポジトリも対象にします。リポジトリが加わる前に尋ねてほしいチームは、スペースの memory の `## Mandated` の下に 1 行でそう書きます。

リポジトリがまだワークスペースにないときは、先にほかのリポジトリの隣へクローンされます。`aidlc system workspace-sync` と同じコードと、あなた自身の git の設定を使います（自分のシェルと同じく、あなたの認証情報ヘルパーと `insteadOf` の規則が適用されます）。アドレスは、`--url` で渡したもの、なければそのリポジトリの `repos.json` のエントリ、なければ `repos.json` の `org` です。エージェントは自分から `--url` を渡すことはないので、コード検索で見つけた名前は、チームの org からしかクローンできません。クローンはステージング用のフォルダで実行され、ワークスペースのロックの下で所定の場所へ移されます。次に `repos.json` のエントリが書かれ（コメントとレイアウトは保たれます）、管理された `.gitignore` のブロックと `aidlc.code-workspace` が更新され、そのあとで初めて変更が記録されます。その行はアドレスを示し、`https://user:token@host/...` のようなアドレスのユーザー部分は `***` と表示されます。チームがコミットする `repos.json` には、認証情報を除いたアドレスが入ります。`repos.json` がないときは、ホストされた `--url`（ホスト、オーナー、名前を持つもの）が、そのオーナーを `org` とする `repos.json` を作り、その行がそう伝えます。一覧を共有するには、それをコミットしてください。ローカルのパスや別の形のアドレスは、ファイルを作らずにリポジトリを足します。クローンが失敗したときは、何も記録も変更もされず、その行が git の理由と、手で実行する `git clone` コマンドを示します。`repos.json` の org も `--url` もないときは、その行がアドレスを尋ねます。

名前は単一のフォルダ名でなければならず、すでにそこにあるフォルダは Git チェックアウト（本物の `.git` エントリを持つ）でなければなりません。リポジトリの形をしているだけのフォルダは拒否され、区切り文字を含む名前も拒否されます。このコマンドは、すでにリポジトリを記録している作業のためのものです。何も記録していない作業はワークスペースのフォルダ自体をリポジトリとして扱います（最初のリポジトリは `workspace reclassify` が記録します）。最後に記録されたリポジトリを外すことも、同じ理由で拒否されます。

締め切りはありません。Units Generation が承認されたあとでもリポジトリは足され（または外され）、それが承認済みの Unit にとって何を意味するかは、その作業の Guard Policy に従います。`strict` では、次のステップで、その変更があっても Unit がそのまま成り立つか、それとも Units Generation に戻るかを一度尋ねます。`relaxed` または `off` では、作業は承認済みの Unit のまま続いて `CHANGE_ACCEPTED` として記録され、その行は「Units Generation was approved before this change: carrying on with its Units and <name> added. You can go back to Units Generation any time.」と伝えます。新しいリポジトリを変更する Unit は、その Code Generation の計画でそれを示し、計画承認が on のところではあなたがその計画を承認します。追加した時点の新しいリポジトリのファイルは、それより前に取られたどのステージのソースの基準にも加わるので、既存のファイルがそのステージ中に行われた変更として報告されることはありません。

`/aidlc intent remove-repo <name>` は元に戻す操作です。リポジトリをこの作業から外し、そのフォルダと `repos.json` の行はそのまま残します。`repos.json` は作業ではなくワークスペースの一覧であり、その行は手でそれを外す方法を示します。Units Generation の承認後に足したリポジトリを外す場合、ほかに決めることは残りません。

### `/aidlc intent set-repos <name,...>`：作業が対象とするリポジトリを正確に伝える

多くのリポジトリがあるワークスペースでは、この作業に必要なものを伝えてください（「only orders and payments」）。エージェントが `/aidlc intent set-repos orders,payments` を実行し、作業はちょうどそれらを対象にします。各名前は `add-repo` と同じように検査され、何が変わったかと、残りは足し戻せることを 1 行で伝えます。`/aidlc intent set-repos --all` は、作業が記録しているすべてのリポジトリを保ちます。どちらの場合も、その集合は以後あなたのものになります。作業の作成時に `--repos` で名指したものと同じです。

作業が、AI-DLC がディスク上で見つけた 10 個以上のリポジトリを記録していて、あなたがそれらを一度も名指していない場合、Reverse Engineering は、どれかを読む前に、すべてを読むか一部だけを読むかを一度尋ねます。多くを読むと長い時間がかかり、多くのトークンを使うことがあるためです。あなたが名指した集合と無人実行には尋ねません。そのステップはコストを一度伝えて、すべてのリポジトリを読みます。依頼の中ですでにどのリポジトリか（すべて、または名指したもの）を伝えていた場合、エージェントは尋ねる代わりにそれを設定します。ここにクローンされていない名前は、それをクローンする `intent add-repo` コマンドとともに拒否されます。set-repos 自身がクローンすることはありません。Units Generation の承認後は、`add-repo` と同じく、変更が適用され Guard Policy に従います。

### `/aidlc intent add-checkout <path>`：別のチェックアウトに置いたコードをレビューの対象にする

AI-DLC のレビューは、プロジェクトのフォルダの中のコードを対象にします。その中に入れ子になった worktree やクローンも含みます。この作業のコードがハーネスのフォルダの中の worktree（Claude Code の `.claude/worktrees/<name>`）やプロジェクトの外の worktree に置かれていると、レビューはそれを見ません。そのため承認の質問は「AI-DLC found no source changes」と伝え、レビュー後にそこで行われた変更は気づかれません。`/aidlc intent add-checkout <path>` は、そのチェックアウトをこの作業について記録します。それ以降、レビューはそれを対象にし、レビュー後にそこで行われた変更はプロジェクト内のどこでの変更とも同じように捉えられ、承認はコードがどこで見つかったかを記録します。エージェントは、コードをそこに置くときに代わりに実行します。ソースの一覧がハーネスのフォルダの worktree の中のパスを名指す Unit は、自分でそれを記録します。

パスは worktree かクローンそのもので、プロジェクトからの相対パスか絶対パスです。`.git` エントリが必要です。表示される行はそれを `<label>@checkout` と名指します。これは、Unit のソースの一覧がプロジェクトの外のチェックアウトにあるコードを名指す形です。質問は一切せず、記録はこのマシンに留まります。チームメイトのプロジェクトのコピーはそれを受け取りません。`/aidlc intent remove-checkout <path>` で再び外します。

### `/aidlc space [name]` — List or switch spaces

引数なしの `/aidlc space` はスペースを列挙します。構造化出力は `--json` です。
`/aidlc space <name>` は利用者ごとのアクティブスペースのカーソルを切り替え、そのスペースの方法論ファイルを、ハーネスネイティブの方法論の include が読む gitignore されたコピーである `aidlc/active-memory/` に書き込みます。追跡対象のファイルは変わりません。スペースを作ったり、インテントを進めたりすることはありません。インテントと同じく、動詞でもスペースの正確な名前でもない語は、動詞とスペース名とともにエージェントへ渡され、名前の後に入力した語は、エージェントが実行するよう切り替えとともに渡されます。

### `/aidlc space-create <name>` — Create a space

新しいチームスペースを、`memory/`、`knowledge/`、`codekb/`、`intents/` の完全な形で作ります。別チームが学んだプラクティスではなく、default スペースの `org.md` とフレームワークのフェーズルールのコピーから始まり、`team.md` と `project.md` は空です。スペースは自動では切り替わりません。ワークスペースのモデル、切り替えの例、何をコミットするかは [Spaces and Intents](03-spaces-and-intents.md) を参照してください。

### `/aidlc knowledge <verb>` — Index and read your own documents

文書（PDF、Word、Markdown、プレーンテキスト）を `aidlc/spaces/<space>/knowledge/documents/` の下に好きな整理で置き、索引します。エージェントは推測せずに、それらを引用できます。

| コマンド | 動作 |
|---|---|
| `/aidlc knowledge onboard [path]` | プロジェクト内のどこにあるファイルかフォルダ 1 つを追加する（`documents/` の外にあるものは先にコピーされ、結果がその場所を伝える）。パス無しなら `documents/` 以下の、まだ索引していないファイルすべてを処理する |
| `/aidlc knowledge sync` | カタログをディスク上の実体と突き合わせる。削除された索引を組み直す |
| `/aidlc knowledge list [--json]` | カタログ — すべての文書とそれぞれの状態 |
| `/aidlc knowledge show <id>` | 文書 1 件の全レコードと、抽出した本文 |
| `/aidlc knowledge associate <id> --intent [slug]` | 文書を 1 つのインテントにスコープする |
| `/aidlc knowledge dissociate <id> --intent [slug]` | そのスコープを外す |
| `/aidlc knowledge rebind <id> --to <path>` | 原本が移動 *かつ* 変更された行を修復する |
| `/aidlc knowledge summarize <id> --text-file <path> --source-revision <sha256> [--tags <csv>]` | LLM が書いた要約（と任意のタグ）を保存する — ツール自身は本文を生成しない |

`--space <name>` は、アクティブ以外のスペースを対象にします。`onboard` は冪等です。変わっていないファイルにもう一度実行すると、2 行目を書かずに `already` と報告するので、一括処理は何度繰り返しても安全です。すでに索引したパスのファイルが **変わった** ときは `edited` と報告し、その行をその場で更新するため、1 つのパスが生きた行を 2 つ持つことはありません。結果は `fresh`、`already`、`edited` の 3 つで、読む価値があります。「出力が変わらなかった」と「何も起きなかった」は別の結果だからです。

**バッチの上限。** パス無しの `onboard` と `sync` は、新規・変更・再試行の作業に 20 文書 / 256 MiB の上限を適用します。すでに最新のカタログ行には適用しません。突き合わせ済みのカタログは、それより大きくなれます。作業バッチが上限を超えたら、対象ファイルを個別に onboard してから、もう一度 sync してください。上限に達すると何も索引しないので、拒否が中途半端に終わることはありません。32 MiB を超える単一の文書は、まったく読まずに拒否します。メッセージもそう伝えます。大きなファイルでは「拒否」と「読んでから拒否」のコストがまったく違うためです。

**スコープ。** `--intent` を省くと文書はスペース全体のものになり、どのインテントからも見えます。値なしの `--intent` はアクティブなインテントを意味し、カーソルがないときは推測せずに失敗します。`--intent <slug>` は明示的に名前を指定し、slug に一致するインテントが 0 件、または 2 件以上だと失敗します（終わったインテントの間で slug は重複し得ます。保存する関連付けは常に UUID なので、slug を変えても文書の指し先は変わりません）。終わったインテントへのスコープは、`--allow-inactive` を付けない限り拒否します。これは閉じた記録へ証拠を後から加えるためのフラグです。

**テキスト抽出** は、プロジェクトが設定した抽出器に委ねます。PDF は、設定がなければ既定の抽出器（`pdftotext`）を使います。Word（`.docx`）ファイルには組み込みの既定がありません。設定がなければカタログに載り、`unsupported_type` として引用できます。抽出器を設定した後に `sync` を実行すると、その検出タイプの変わっていない行を再試行します。**設定した** 抽出器がインストールされていない場合、文書は `extractor_unavailable` としてカタログされます。`list` に表示され、ツールをインストールして `/aidlc knowledge sync` を実行すれば直ります。同じ変わっていないパスに `onboard` を再実行すると `already` と報告し、抽出は再試行 **しません**。この状態の行を探り直すのは `sync` だけです。黙って飛ばすものはありません。

**抽出には上限があります。** PDF は 50 ページ（`pdftotext -l 50`）、抽出器の出力は 200,000 文字です。上限を超えると本文は切り詰められ、行は `truncated` を記録します。`show` は本文の上に `truncated  yes` の行を出し、`--json` のペイロードは `extraction` の中にそのフラグを持ちます。切り詰められた抽出は部分的なビューとして扱ってください。それだけから「この文書は X に触れていない」と結論するのは安全ではありません。

抽出器の探査にはそれぞれ 5 分の安全上限があり、抽出には文書あたり 15 分の上限があります。設定した抽出器の `timeoutMs` は抽出の時間上限を上書きします。抽出のタイムアウトは `extraction_failed` を記録し、文書が正常に読めたことにはなりません。これらの時間上限は、上記のバイト、ページ、出力の上限を変えません。

設定した抽出器の `argv` には、文書のパスを代入するプレースホルダである **`$IN` がちょうど 1 つ** 必要です。それがない設定は、受け付けずにツール起動時に拒否します。ファイルを一度も受け取らないプロセスは、そうでなければ自分が出力したものを、そこへ送られた *すべての* 文書の抽出本文として記録してしまい、成功した抽出に見えても実際はそうではないからです。`$IN` が 2 つ以上の場合も同じ理由で拒否します。意図が曖昧なので、安全側に倒して失敗させます。

**`remove` は意図的にありません。** 文書を消すとは、自分のファイルを消し、それから `sync` を実行することです。そのためツールは、あなたが所有するファイルに対して破壊的な動詞を持ちません。削除された原本は tombstone の行を残します。これは意図して削除したというカタログの記録で、リンクされた原本に一時的に届かないことを意味する `source_unavailable` とは別物です。

> **文書の本文はデータであり、指示ではありません。** `show` はその警告を本文と並べて出します。
> 顧客の契約書の中の命令文は、その顧客のエンジニアに向けたものです。AI-DLC のワークフローを逸らしたり、
> 許可を与えたり、コマンドを認可したりすることはありません。

`/aidlc-knowledge` スキルは同じ面で、コマンドとして入力します。

---

### `/aidlc --status` — Read-only status

現在のワークフロー進捗を、何も変えずに出します。

**構文:**

```
/aidlc --status
```

**動き:** アクティブインテントの `aidlc-state.md` を読み、次を表示します。スコープ（この作業のために合成された計画では、代わりにその `Plan:` の行）、作業が新しいプロジェクトか既存のコードか（`Project Type: existing code (you said so)`）、既存のコードについて Reverse Engineering が最後にスキャンした場合はそれが単独で実行された日時（`, scanned 2026-10-03 23:17 UTC`）、深度とその出どころ（`Depth: Standard (from scope feature)`、または `set for this piece of work`。この作業のために合成された計画では、実行先の配布スコープ由来の設定は、深度、Guard Policy、設定の各行とも `(from the approved plan)` と表示）、異なる場合はテスト戦略、現在のフェーズ、現在のステージ、計画のステージのうち完了した数（計画の提案と同じ数え方で、セットアップは含みません。飛ばしたステージは数から外して名前を示し（`Completion: 4/4 stages (100%), skipped: Deployment Pipeline`）、作業がそのステージで終わった場合、状態は `Completed (Deployment Pipeline skipped)` と表示します。保留中の作業はそのことと再開方法を示します（`Paused at Deployment Pipeline (you stopped it); pick it back up with /aidlc --resume`））、レビュアー設定とその出どころ（`Reviewers: advisory (from scope bugfix)`、またはこの作業でオフにした後は `off (set for this piece of work)`）、インテントの Guard Policy の値とその出どころ（`Guard Policy: strict (from project.md)`、`off (from scope classic)`、`strict (set by you)`、またはこのフィールドのない古いインテントでは `strict (not set)`）、あなたか環境変数のスイッチが検査を off にしたときだけ、それぞれと理由を示す `Checks off:` の行（`Checks off: state-transition (set by you)`。低い Guard Policy が off にする検査は Guard Policy の行に含まれます）、ステージ進捗の一覧、そしてこのスペースにほかに開いている作業があれば、それを示す `Also open:` の行です。その作業への切り替えを頼むこともできます（`Also open: 261003-lunch-poll (ask to switch to it)`）。不正な Guard Policy フィールドは、検証エラーと修復コマンドとともに利用不可と表示します。完了したステージの検証レシートも調べます。完了したステージの入力が承認後に変わった場合は、次のステップが使う行でそう伝え、やり直すかどうかを尋ねます（`Something Practices Discovery used changed after it finished. I'm carrying on with it as it is. Do you want me to redo Practices Discovery with the change?`、作業が既存のコードになった後は `Practices Discovery ran before the code was here. I'm carrying on with it as it is. Do you want me to redo Practices Discovery with the code?`、自分の文書だけが編集された場合は `requirements.md changed after Requirements Analysis finished. I'm carrying on with it as it is. Do you want me to redo Requirements Analysis with your change instead?`）。影響を受ける後続のステージも示します（`Also affected: ...`）。あなたのものは何も変わっていないのに AI-DLC 自身のやり方が変わった完了済みのステージは、専用の行で示され、遅れているとはみなされません（`AI-DLC now does Functional Design differently from when yours ran; your work stands, and /aidlc --stage functional-design goes back to it (the stages after it reopen too).`）。この検査は助言であり、ルーティングは変えません。読めないレシートや、レシートのない完了は表示しません。現在のステージが承認待ちのときは、いつからかを平易な時刻で示します（`waiting since 2026-10-04 12:24 UTC, about 2 minutes`）。アクティブなワークフローがなければ、進行中のワークフローはないと報告します。作業はあるのにこの会話でどれも選ばれていない場合（たとえばチームメイトのクローン）は、各作業とその状況（完了、またはいるステージ）を示し、どれかを続ける方法か新しい作業を始める方法を伝えます。

状態表示には **Sensors**、**Learnings**、**Summary Confirmation** の行も個別に出て、それぞれの実効値と設定元を示します。例: `Sensors: on (from scope classic)`、`Learnings: off (set by a command)`、`Summary Confirmation: off (set by you)`、`Summary Confirmation: off (from env AIDLC_DISABLE_SUMMARY_CONFIRMATION)`。保存された設定がない場合は現在のスコープ、次に `on (from default)` へフォールバックします。下の手続きの切り替えを参照してください。

`Unit Ownership: team` のときは、スコープ無しの main が描画するのと同じボードを、はっきりラベルを付けた **Team Construction Snapshot** として付け加えます。Unit Progress、ローカルで観測したクレーム ref（所有者、世代、push 時刻ではなく観測した動き）、ピン留めしたマージの準備状況、クレームできる Unit、ブロッカーです。スコープ付きでもスコープ無しでも、同じボードを描画します。コマンドはフェッチせず、状態、キャッシュ、監査を変更しません。明示的な `--space` と `--intent` のセレクターは、見出し、Unit DAG、クレーム、マージ台帳を、選んだ同じ識別情報に結び付けます。ボードの最後には、空いている作業や解放された作業のクレーム、ピン留めしたマージゲートの記録、`aidlc unit land` の再開といった具体的な次の操作が示されます。

---

### `/aidlc --claim <unit>` and `/aidlc unit claim <unit>` — Claim a team Unit

チーム所有、unit-major の Construction ワークフローで、空いている Unit を 1 つ原子的にクレームします。クレームのレジストリは git ref `claim/<intent-id8>/<unit>` です。コマンドは一意のクレームコミットを compare-and-swap の意味論で書き、勝った nonce を検証してから、gitignore されたチェックアウトローカルのスコープスタンプを書きます。同時にクレームした中で成功するのはちょうど 1 人です。

**構文:**

```
/aidlc --claim user-profile-api
/aidlc --claim user-profile-api --team "Alice"
/aidlc --claim user-profile-api --rhythm unit-end
/aidlc unit claim user-profile-api --team "Alice"
```

`--team` は人が読める保持者ラベルです。`--rhythm` は任意で、このクレームを `per-stage` または `unit-end` に固定します。省略すると、ワークフローで確認済みの Unit ゲートのリズムを使います。依存関係と、必要なウォーキングスケルトンが完了するまでクレームは拒否され、生きたクレームを持つチェックアウトは、スタンプされた Unit だけをルーティングします。

### `/aidlc unit adopt <unit>` — Adopt a teammate's live claim

新しいクローンで、正確なローカルのクレームブランチを fetch してチェックアウトし、次を実行します。

```bash
git fetch origin refs/heads/claim/<intent-id8>/user-profile-api:refs/heads/claim/<intent-id8>/user-profile-api
git switch claim/<intent-id8>/user-profile-api
/aidlc unit adopt user-profile-api
```

adopt は、チェックアウトしたクレームの OID とペイロード（スペース、インテント UUID、Unit、世代、nonce、結び付いた監査シャードを含む）を生きた ref と照合してから、チェックアウトローカルのスコープスタンプを書きます。以降の監査書込みはそのクレームの既存のシャードを使い続け、`publish` は同じ試行を続けます。

### `/aidlc --release <unit>` and `/aidlc unit release <unit>` — Release a claim

スコープ無しの main チェックアウトから、生きたクレームを解放します。解放は ref を削除するのではなく、世代を進める tombstone を公開します。そのため、古いスタンプを持つ試行はクレームに関わる境界で安全側に失敗し、クレームの履歴は調べられるまま残ります。

```
/aidlc --release user-profile-api
/aidlc unit release user-profile-api
/aidlc unit release user-profile-api --expect-nonce <current-claim-nonce>
```

Unit を解放して再クレームした後の解放には、`aidlc-unit.ts status` から得た `--expect-nonce` が必要です。これはコマンドを後継の試行に結び付け、出力を失った再試行がそれを tombstone にすることを防ぎます。

### `/aidlc unit participate` — Enable the guided picker

このクローン用の、gitignore された参加者マーカーを書きます。その後、スコープ無しの main で引数なしの `/aidlc` を実行すると、クレームできる行、すでにクレーム済みの行、依存関係でブロック中の行を持つ型付きの Unit ピッカーが出ます。マーカーのないファシリテーターのチェックアウトは、代わりに終端のファンアウト通知を受け取ります。

```
/aidlc unit participate
```

### `/aidlc unit publish <unit>` — Publish a completed candidate

スコープ付きのチームチェックアウトで、成果物、ソース、状態のミラー、監査シャードをコミットした後に実行します。

```bash
/aidlc unit publish user-profile-api
```

コマンドは追跡対象がクリーンな worktree を要求し、生きたクレーム ref を、クレームの履歴と実装の履歴の両方を保つ候補コミットへ CAS 更新します。

### `/aidlc unit pin <unit>` — Pin candidate evidence

スコープ無しの main から実行します。

```bash
/aidlc unit pin user-profile-api
```

ピン留めはクレーム ref を fetch し、その正確な OID／世代と新しいピントランザクション ID を記録し、成果物、Unit のレシート、チームゲート、レビュアーの判定、Plan Approval、状態、監査シャードの転送を、そのコミットから直接読みます。マージも worktree の作成もしません。クレームに結び付いたチームのシャードが運べるのは、その Unit の試行のレシートだけです。main の権限に属する行、別の Unit の記録／レシートのパス、余分なシャード、ほかのワークフロー記録のパスは拒否します。ピン留めは、候補のベースの Unit DAG、Unit の種別、有効な Unit ごとのステージ列も生きた main と比べます。Construction の契約が変わっていれば、リベースと再公開が必要です。Unit の記録ツリーの外にある製品ソースのパスは、人間のマージゲート向けの証拠に一覧されます。

### `/aidlc unit gate <unit>` — Decide the pinned merge

```bash
/aidlc unit gate user-profile-api \
  --decision approve \
  --user-input "Approve pinned candidate"
```

受け付ける判断は `approve` と `reject` です。コマンドは、ピン留め後の新しい `MERGE_DISPATCH_INVOKED` と終端のディスパッチ結果、そして型付きの人間のターンを要求します。ディスパッチの行はすべて、`--pinned-oid <oid> --attempt-generation <n> --pin-id <uuid>` を通じてピン留めの出力を運ばなければなりません。ピン留めした Unit のトランザクションは、レビュー済みの OID が直接の親のまま残るよう、マージ戦略を必要とします。ref が動いた、世代が変わった、HOLD-MERGE マーカーがある、のいずれかの場合は、承認の前に明示的な再ピン留めが必要です。

### `/aidlc unit land <unit>` — Land the pinned transaction

```bash
/aidlc unit land user-profile-api --target main
```

着地はまず現在の統合ブランチを fetch し、承認済みの証拠を、生きた Unit DAG、Unit の種別、有効な Unit ごとのステージ列と照らして再検証します。契約のずれは Git を変更する前に拒否し、リベース、再公開、再ピン留め、新しいディスパッチのブラケット、新しいマージゲートを要求します。その後、main が所有するエンジンのメタデータを保持したままピン留めした内容をマージし、Unit の行を畳み込み、転送された監査レシートを確定します。クラッシュから復旧するには、冪等なステップを個別に実行します。

内容の方針は候補と完全に一致することです。main と候補の両方が共有ファイルを変更していた場合、結果がピン留めした候補の blob と等しくない限り、きれいに通った自動マージでもコミット前に拒否します。チームのブランチを現在のターゲットへリベースし、そこで解消し、新しいピン留めのために再公開してください。

```bash
/aidlc unit land user-profile-api --step git
/aidlc unit land user-profile-api --step state
/aidlc unit land user-profile-api --step audit
/aidlc unit merge-status user-profile-api
```

クレームのレジストリが使えない間、gate と land は安全側に失敗します。`--step git` がレビュー済みのマージコミットを着地させた *後で* その正確なクレームの試行が解放された場合は、そのコミットを調べ、例外的な完了を承認します。

```bash
/aidlc unit land user-profile-api --step state \
  --accept-released-attempt \
  --user-input "I inspected the landed commit and accept completing this tombstoned attempt"
```

コマンドが受け付けるのは、直前がピン留めした OID である直近の tombstone だけです。承認は main の監査とトランザクション台帳に記録され、後継のクレームは拒否します。

### `/aidlc unit status` — Inspect Unit claims

現在の統合状態とクレームのレジストリを読み、クレームできる、クレーム済み、待機中の Unit の集合を JSON で出します。これはクレーム時／状況確認の面であり、設定した git リモートに接続することがあります。

チームモードは、統合ブランチを `project.md`、次に `team.md`、次に `org.md` の `## Way of Working` 節から読みます。統合、ベース、またはマージ先のブランチをバッククォートで示す最初の行が、ブランチ名が何であれ採用されます。どの層も示さない場合は、リモートの既定ブランチを使います。git が使えないブランチやリモートにないブランチが示されている場合は、別の層の選択で置き換えず、その出どころのファイルとともに報告します。

```
/aidlc unit status
```

---

### `/aidlc --config [section]` - In-session project configuration

ハーネスの会話を離れずに、`models`、`runtime`、`providers`、`trust`、`flags`、`project` のいずれかを設定します。節を指定しないと、コンダクターはどの節を検討したいかを尋ねます。節を指定すると、その節がすでに問題のない状態でも、必ずそこで何を変えたいかを尋ね、その節の選択肢と、変えずにおく選択肢を示します。

コンダクターは `aidlc config <section> --show --json` で現在の状態を読み（`aidlc config --show --json` はすべての節を一度に読みます）、会話で変更を尋ね、列挙できる選択にはネイティブの質問ピッカーを使います。「leave it」と言うとその節を飛ばします。受け入れた変更は、どれも正確な `aidlc config <section> <explicit value flags> --yes` コマンド 1 つで着地し、コマンドとその出力が表示されます。このエイリアスが値を作り出すことはなく、引数なしの `aidlc config --yes` を実行することもありません。

これは端末での設定作業です。変更が着地した後、または断った後、コンダクターは `next` の実行、進行、再開、ワークフローステージの実行をせずに止まります。

---

<a id="aidlc-doctor-health-check"></a>

### `/aidlc --doctor` — Health check

この実装の前提、設定、ステージグラフの整合がすべて揃っているかを検証します。問題のない報告と警告だけの報告は exit 0、失敗した検査があれば exit 1 です。報告の全文はどの場合も stdout に出るので、オーケストレータはどちらでもそれを表示できます。コアの doctor の検査は、あなたのファイルを何も変えません。ただし、各セッション開始時と同じように、アクティブなスペースのメモリーの AI-DLC 自身のコピー（`aidlc/active-memory/`、Kiro IDE ではそのステアリングのコピーも）を最新にします。そのため、最初のインテントを作る前に実行しても安全です。インテントがあると、`HEALTH_CHECKED` 監査行も記録します。プラグインの検査は、インストール済みのプラグインのコードを実行します。プラグインの作者は慣習としてそれらのスクリプトを読み取り専用に保つことを求められますが、ランタイムはその性質を強制できません。

ワークフローに問題があると、`--doctor` は未解決のゲート、古いまたは存在しないランタイムグラフ、冷えたフックなど、「進まない」原因についての構造化した所見も、Project セクションに一覧します。所見ごとに `fix:` 行の付いた `warn [<id>] <summary>` の行が 1 つずつ出ます（例: `gate-unresolved`、`runtime-graph-stale`）。ライブの報告と `--export` は 1 つの分析を共有するので、所見はどちらでも同じです。

**構文:**

```
/aidlc --doctor
```

**検査する内容:**

| Check | What it validates |
|-------|-------------------|
| Prerequisites | 自己完結のバイナリ、またはコピーインストールなら PATH 上の `bun` |
| Installed runtime | バイナリのチャネルを使うときの、アクティブなマシンの版とインストール済みのハーネス配布 |
| Project stamp | プロジェクトの配布／版を、プロジェクトを担うエンジンと比べる。リリースの `.aidlc-version` が固定する版、無ければ実行中のリリース |
| Hook presence | `settings.json` が配線するフレームワークのフックがすべて `.claude/hooks/` にある。配線されているのに存在しないフックは目立つ形で失敗する。AI-DLC のステータスラインは、あなたがオンにした場合に、あなた自身の `.claude/settings.local.json` から検査する。これは進捗を表示するだけなので、誰も配線していない `aidlc-statusline.ts` が、オフになっている強制として報告されることはない。期待する一覧を `settings.json` から取るので、そこにフックを足せば自動で検査対象になる |
| Hooks enabled (Claude Code) | Claude Code の設定層をまたいで、解決された値が `disableAllHooks: true` ではない（エンタープライズ管理ファイルとアルファベット順の `managed-settings.d/` 断片 → `.claude/settings.local.json` → `.claude/settings.json` → `~/.claude/settings.json`、最も優先度の高い定義が勝つ）。解決された `true` は存在するすべてのフックを黙って飛ばすため、目立つ形で失敗し、その層を示す |
| Project structure | `.claude/settings.json` がある（ファイルの有無だけ。中身は検証しない） |
| Kiro hooks switched off | Kiro ハーネスで、`.kiro/hooks/` にある AI-DLC のフックファイル（`aidlc-*.json`）のうち、`"enabled": false` を持つものすべて。これは Agent Hooks でフックをオフにしたときに Kiro が書く。ガードフック（`aidlc-guard-tool-call`）、返答の記録フック（`aidlc-record-human-turn`）、プロジェクトにまだ残っている古いガードファイルは、それぞれ何が保護されなくなったかを示して失敗する。それ以外の AI-DLC フックがオフなら警告 1 つになる。修正は、Kiro の Agent Hooks でそのフックをオンに戻すこと |
| Kiro IDE ignore sources | IDE のコンダクター（`.kiro/agents/aidlc-aidlc.md`）を持つ Kiro ハーネスで、git のグローバル除外ファイル（git リポジトリ内の場合）、`~/.kiro/settings/kiroignore`、プロジェクトの `.gitignore`、`.kiroignore` をそれぞれ独立に、エンジンがエージェントに `fs_read` で行わせる読取りに対して評価する。対象は、コンパイル済みグラフで `harness.json` が選ぶすべてのステージについて、ステージファイルと、コンダクターがインラインで保持するペルソナとナレッジ（Standard と Minimal の深度でのエンジン自身の一覧。ディレクティブの 8 KiB の `inline_context_paths` 上限内）、そして `stage-protocol.md` とその `stage-protocol-<name>.md` モジュール、各スキルの `SKILL.md` の横にあるファイル。`stage-definition.md` のようなコントリビューター専用のプロトコルファイルは読み込まれないため数えない。プラグインはどのように compose されたかにかかわらず数える。`SKILL.md` ファイル、IDE のコンダクターエージェント（`agents/aidlc-aidlc.md`）、`aidlc-common/conductor.md`、`tools/`、`sensors/`、`hooks/`、`scopes/`、`steering/` は `fs_read` ではなく IDE やエンジンが読み込むため数えない。その一部だけを隠すルールは、件数と影響するフレームワークのフォルダとともに報告する。`.kiro/` を隠すグローバルなソースのルールは、IDE の `fs_read` ガードがすべてのステージ、エージェント、プロトコルの読取りを拒否するようになるため、ソースと行を示して失敗する。ワークスペースのソースの一致は警告になる。それが効くのは `kiroAgent.agentIgnoreFiles` がそのファイルを指定したときだけで（既定は `.gitignore` を含み、`[]` はワークスペースのソースを無効にする）、doctor はその IDE 設定を読めないため。doctor が評価できないソース（例: `git` が PATH にない。git リポジトリではこれにより独自の `core.excludesFile` も見えなくなる。あるいはディスク上に存在するリポジトリを git が拒否する）は、合格ではなく `not evaluated` として警告する。行はソースを `~/.config/git/ignore` や `.gitignore` のような固定の名前で示し、パス、ルールの本文、git のエラー本文は示さない。別のファイルの `!.kiro/` は拒否を取り消さない |
| Workspace shell | `.claude/` と `aidlc/spaces/default/memory/` がある（同梱のシェル） |
| Active space method copy | `aidlc/active-memory/`（すべてのハーネスの include が読む、gitignore されたコピー）が、アクティブなスペースの `memory/` のファイルを保持している。各セッション開始時と同じように、検査はまずそれを書くので、差が残るのはそこに書けないファイルである（警告） |
| VS Code agent request cap | Copilot のみ。`.vscode/settings.json` が `chat.agent.maxRequests` を 100 以上に設定している。未設定（VS Code の既定の 50）、それより小さい、数値でない（引用符で囲んだ数値を含む）、読めない場合は警告する。VS Code が長いステージを止めて「Continue to iterate?」と尋ね、誰かが答えるまでチャットが待つためである。修正にはファイルに書く行が示される |
| Submodules | `.gitmodules` があれば、宣言されたサブモジュールのパスの数と未初期化の数を報告し、未初期化があれば `git submodule update --init --recursive` を示す（advisory — 失敗にはしない） |
| Env scope | `AWS_AIDLC_DEFAULT_SCOPE`（設定されていれば）が有効なスコープ名である |
| Hook heartbeats | `.aidlc-engine/hooks-health/` にフック実行のタイムスタンプがある（自分のハートビートを持たない記録では、それを作成したターンのハートビート（記録ができる直前に書かれたもの）が、最初の 5 分間は数えられる）。ハートビートがないのは、ワークフローが進む前は advisory だけ。作業が進んだ後は失敗し、最新のハートビートが最新のステージ／ゲートイベントより 5 分以上古い場合は停止として失敗し、ハーネス自身のフックを動かす手順（Claude Code では `.claude/settings.local.json` の `"disableAllHooks": false`、または組織のポリシー）を示す。ハートビートはそれを書いたフックのクローンに留まり、監査記録は git で運ばれるので、ほかのクローンの監査記録だけが進捗を示す場合（pull したチームメイトの作業）は代わりに警告になり、`This workflow was run in another clone (<machine>); this clone has no hook record for it yet` と示す。このクローンで直すものはない |
| Claude managed hook policy | Claude ハーネスのみ。既存の管理設定リゾルバー（`AIDLC_MANAGED_SETTINGS_PATH`、現行と旧来の Windows パス、macOS、Linux/WSL）とアルファベット順の `managed-settings.d/` 断片を使い、実効の `allowManagedHooksOnly` が `true` なら失敗する |
| Your replies are not being recorded | ステージ／ゲートのイベントがあるのに監査に `HUMAN_TURN` がない場合、その人の返答が記録されていない（そのため次の承認は拒否される）ことを警告し、修正としてハーネス自身のフックの手順を示す |
| Hook drops | `.aidlc-engine/hooks-health/<hook>.drops` のテレメトリ（フックがツール呼び出しを壊さないために飲み込んだ失敗の記録）を表示する。フックごとのドロップ数、最終時刻、最も多い理由、修正方法（確認してからファイルを削除する）を示す。最新の失敗が 24 時間以内のフックは、`--verbose` なしでも表示される警告になり（`Hook failures, the latest within the last day`）、すべての失敗を数える。1 日経つか、ファイルが削除されると消える。各理由は最初のコロンまで（フック自身の要約）だけを表示し、秘密は伏せ、その後の詳細はファイルに残る。それより古い失敗と、プラグインの compose フックからの `[advisory]` 行は、合格の advisory の行になる。フックの通常の判断（あなたが先に答える必要があるため Stop フックがターンを終わらせるなど）は代わりに `<hook>.trace` に書かれ、数えられない。失敗するのは `[degraded]` のドロップ（途中まで適用されたプラグインの compose）だけ |
| Workspace source boundary binds | ワークフロー状態があるときだけ。Plan Approval が計画を結び付けるのと同じワークスペースのソース走査を実行する。フィンガープリントの先頭 16 進 12 文字で合格する。失敗時は理由コードとパス（例: `budget-entries at .`、`dangling-symlink at linked/src`、`excluded-path at node_modules/pkg`）を示し、有効な設定のもとで計画の質問がどうなるかを伝え、修復の文を示す。問題のパスを `.aidlc-source-paths.json` の除外リストに加える、除外ディレクトリの下の本物のソースをその paths リストで宣言する、または壊れたシンボリックリンクを削除する、それから `next` を実行する。Guard Policy が strict で計画承認がオンの場合は、Plan Approval の判断が拒否されることを伝え、あなた自身の言葉でだけ使える最後の手段を加える。チャットでアシスタントにそれでも計画をビルドするよう頼むと、プロジェクトのファイルの検査なしに、あなたの承認として記録される。それ以外の場合は、計画の質問は通常どおり尋ねられ（計画承認がオフなら、計画は書かれたとおりにビルドされる）、プロジェクトのファイルの検査なしにビルドが始まることを伝える |
| Current step out of date | その状態の間だけ。アシスタントが作業の基にしていたステップが古くなった（チャットがコンパクトされた、またはステップが出された後にワークフロー状態が変わった）。いつ、なぜかを伝え、分かる場合はどの状態行が変わり、どの AI-DLC コマンドがそれを書いたかも示す。修正は単独のコマンドとしての `next` で、現在のステップを出し直し、まだ一致する承認は保つ（警告 — 失敗にはしない） |
| State drift | アクティブなインテントの `aidlc-state.md` が、監査の最後の `WORKFLOW_COMPLETED` と一致する |
| Pending approval | 現在のステージが通常の承認ゲートで 24 時間を超えて待っている場合、止まっているのではなく人間を待っていると判断し、`/aidlc --status` を案内する（advisory — 失敗にはしない） |
| Background subagents | `aidlc/.aidlc-subagent-inflight` の、新しい／古いセッション単位のエントリを報告する。新しいエントリは advisory。古い、または不正なエントリは、正確な削除の案内とともに失敗する。無ければ何も出さない |
| Set-aside Bolt attempts | 保存された試行の情報としての一覧。slug、スタンプ、経過日数、モード（保存した head なら `snapshot`、`branch-tip`、`legacy`。レビュー済みのソース ref だけが残るなら `evidence-only`）、復元したチェックアウトの所有、型付きの restore／purge の操作と、任意の安全な表示用コマンドまたは描画エラー（evidence-only のエントリは purge のみ）。これらのエントリは警告でも失敗でもない |
| Cycle detection | `stage-graph.json` に閉路がない |
| Orphan stage files | グラフの各 slug に、対応する `<phase>/<slug>.md` がディスク上にある |
| Uncompiled stage files | コンパイル済みグラフに slug がない、ディスク上のステージ `.md` を表示する。プラグイン所有のファイルは `plugin sync` を、それ以外の自作ステージは `aidlc-graph.ts compile` を示す（advisory、失敗にはしない） |
| Plugin selection | 有効なプラグインの一覧、プラグインごとの有効ステージ数、フルグラフの `enabled:false` フラグの一致、壊れた選択からの復旧のヒント |
| Plugin composition | オフラインでの、インストール済みと compose 済みの版／ハッシュの状態。sync または修復の対処を含む |
| Composed plugin surface | 有効なプラグイン所有のステージファイルがコンパイルされている。有効なプラグインの寄与サイドカーがすべて読めて妥当で、記録された対象ステージがすべて存在し、記録された構造の追加や散文の断片がすべて残っていて変わっていない |
| Plugin checks | 有効なプラグインについてだけ、任意の `tools/<plugin>-doctor.ts` スクリプトを実行する。エラーの所見は doctor を失敗させ、advisory の所見は終了コードを変えずに表示・エクスポートされる |
| Scope validation | 有効なすべてのスコープ（プラグイン選択後の `.claude/scopes/*.md`）が問題なくたどれる（スコープの切り詰めによる欠落の advisory は想定どおり） |
| Composed scope durability | コンポーザーが書いたスコープがすべて実在する計画に解決する。グリッドの列がないスコープファイル（すべて SKIP の空の計画として解決してしまう）、まだハーネスのツリーに投影されていない永続的な `aidlc/scopes/<name>.md` の記録、記録された `Scope` に解決できる定義がない実行可能なワークフローで失敗する。compile で原因に届く場合は、対処として `aidlc-graph.ts compile` を示す。**裏付けとなる記録がない** 列の欠落は別に報告する。compile が列を出すのは、いずれかのステージが `scopes:` frontmatter で宣言するスコープだけだからである。その行は、記録の復元、スコープのステージのタグ付けの完了、またはスコープファイルの削除を示す。記録の説明的な frontmatter と投影されたファイルは比較しない。グリッドは常に記録から来て、compile は手編集を上書きするのではなく既存のスコープファイルをそのままにするため |
| Schema validation | 各ステージの YAML frontmatter が `validateStageFrontmatter` を通る |
| Graph references | すべての `consumes[].artifact` と `requires_stage[]` の対象が解決する |
| Duplicate producers | 消費されるすべての成果物の生産者が 1 つである。複数の生産者はステージ slug とともに報告され、グラフの読み込み順で最初のものに解決する（advisory — 失敗にはしない） |
| Keyword overlap | 2 つ以上の計画が持つヒントは警告になり、その計画を示す（計画の提案は、それを各計画の下に一覧する） |
| Rule drift | 人が書いた org の方針と重なる、生きている team / project の見出しを矛盾レビューのために表示し、ライフサイクル上古くなった重複は stale-suppressed の行として別に報告する（advisory — 失敗にはしない） |
| Paired sensor coverage | 対になるセンサーを名指しするルールが、いずれかのステージが実際に発火するセンサーへ解決することを確認する（advisory — 失敗にはしない） |
| Workspace records | `aidlc/` 以下の未コミットの変更を報告し、共有の記録が 1 つのチェックアウトにだけ残らないようにする。`aidlc/.aidlc-request-text/` と、変更が doctor 自身の実行について書くエントリだけである監査ログは除く（それらしかない場合、この行は合格し、そう伝える）。git が依頼ファイルを追跡または表示している間、またはフォルダが無視していない削除済みのファイルを保持している間は、`git add aidlc/` があなたの依頼を取り込んでしまうため、コミットのコマンドを示さない（advisory — 失敗にはしない） |
| Request folder | git が `aidlc/.aidlc-request-text/` の中のファイルを見られるときだけ。それらはあなた自身の依頼を保持しているので、手順を示すが、実行はしない。フォルダがまだ無視されていなければ、プロジェクトフォルダの `.gitignore` に `aidlc/.aidlc-request-text/` の行を加える（後にある自分のルールがそれを無視対象から外していないことも確認する）。git がそれらを追跡していれば、プロジェクトフォルダで `git rm --cached -r -f -- aidlc/.aidlc-request-text/` を実行する（ファイルは残る）。そのあと、チームメイトのクローンからも消えるよう、削除と `.gitignore` の変更（更新でコミットされずに残っていることがある）をコミットして push する。まだコミットされていない削除があると、この行は残る（advisory — 失敗にはしない） |
| Declared workspace repos | `repos.json` があるとき、宣言された集合と、実行時の発見がディスク上で見る兄弟リポジトリを比べる（advisory — 失敗にはしない） |
| Workspace gitignore | `repos.json` があるとき、管理された `.gitignore` ブロックが宣言されたリポジトリの集合と一致するかを確認する（advisory — 失敗にはしない） |

**出力例:**

```
AI-DLC doctor

Machine
  warn  Runtime hook PATH: bun is on this shell's PATH (/home/user/.bun/bin/bun) but not on the system-wide PATH
        fix: Nothing needs changing when you start Claude Code from a terminal: it hands that terminal's PATH to AI-DLC's hooks. If you start it from a desktop icon, the dock, or a service and AI-DLC's hooks do not run, add /home/user/.bun/bin to the PATH line in /etc/environment, ENV_PATH in /etc/login.defs, or a PATH= line in ~/.config/environment.d/*.conf, then restart Claude Code. Editing .bashrc or .zshrc does not change this check.
  warn  Update: update check unavailable while offline
        fix: run `bun .claude/tools/aidlc.ts update --check`
  ok    4 checks passed

Project (.claude, Claude Code)
  warn  Instruction file: block or file missing (.claude/CLAUDE.md)
        fix: run `bun .claude/tools/aidlc.ts config`
  ok    43 checks passed

Framework integrity
  ok    all 12 checks passed

0 problems, 3 warnings.
Warnings are advisory - if everything works, ignore them.
Add --verbose to see every check.
```

`--verbose` を使うと、Machine、Project、グラフ、スキーマ、ステージ、スコープ、センサーの各行をすべて展開します。警告や失敗には、どれも続けて `fix:` の対処が付きます。

---

<a id="aidlc-doctor-export-write-a-diagnostic-report"></a>

### `/aidlc --doctor --export` — Write a diagnostic report

`--doctor` に `--export` を付けると、小さくマスキングした診断報告を書きます。動きのおかしいワークフローを、プロジェクトディレクトリ全体を共有せずにデバッグできます。先に **新しい** doctor を実行し（報告がキャッシュされた診断を反映することはありません）、それから報告を書きます。報告の書込みが doctor の終了コードを変えることはありません。

**構文:**

```
/aidlc --doctor --export
/aidlc --doctor --export --output <dir>
```

`--output <dir>` は出力先を上書きします。既定はプロジェクト下の `aidlc/diagnostics/` です。

**出力されるもの:** システムの `tar` があれば時刻付きの `.tar.gz`、無ければ報告ディレクトリを残し、共有前に自分で圧縮するよう案内します（新しいパッケージ依存も、専用のアーカイブ書込みもありません）。報告の中身は次です。

| File | Contents |
|------|----------|
| `report.md` | 人が読むワークフローの時系列と所見 |
| `report.json` | 機械が読む時系列、所見、要約 |
| `manifest.json` | 報告スキーマの版、AI-DLC の版、ハーネス、ハッシュしたインテント id、ファイルごとの SHA-256 チェックサム、適用したマスキング、切り詰めの通知、除外の一覧 |
| `evidence/normalized.json` | 許可リストにある正規化したフィールドだけ — 生のファイルは決して含めない |

**診断すること:** 報告は監査証跡からワークフローの **時系列**（ステージの所要時間、ゲート、改訂、空白、そして長時間／未完了／スキップのフラグ。スキップしたステージは、スキップした時刻を Completed として示す）を再構成し、よくある「進まない」原因について **決定論的な** 条件→対処のルール（LLM なし）を実行します。未解決の承認ゲート、状態／監査のずれ、古いまたは存在しないランタイムグラフ／冷えたまたは止まったフックのハートビートです。所見はライブの `--doctor` と同じ共有の `DoctorFinding` モデルから来るため、コマンドと報告が食い違うことはありません。復旧の迂回策（例: `AIDLC_DISABLE_*` 環境変数や「ワークスペースを退避する」指示）を示す対処には、自動化してはいけないという印が必ず付きます。

`DOCUMENT_INDEXED` / `DOCUMENT_UPDATED` / `DOCUMENT_REMOVED` はスペース単位の監査シャードにあります。`--doctor --export` はそのシャードを明示的に読み、アクティブなインテントのシャードと合わせます。そのため、ワークフロー開始後の文書の履歴が報告に含まれ、ワークフローの権限を扱う読み手はインテント単位のままです。`list` と `show` は、これまでどおり DocumentKB のカタログを直接読みます。

**安全。** 報告には、ワークスペースのソース、生の状態／監査／ランタイムグラフのファイル、成果物／寄与／質問／memory の本文、環境変数、コマンドの出力は含まれません。出力する文字列はすべてマスキングします。ホームディレクトリは `~`、プロジェクトルートは `<project>` になり、インテント id はハッシュされ、秘密らしい値は消されます。実パスがプロジェクトルートの外に出る入力は拒否し（シンボリックリンクの葉や親をたどってツリーの外へは出ません）、ファイルごとと合計のサイズに上限があり（切り詰めはマニフェストに記録されます）、プラットフォームが対応していればファイルは所有者専用で作ります。

**出力例:**

```
Diagnostic report created:
  aidlc/diagnostics/aidlc-diagnostic-report-20260714-153000-3f9a1c22.tar.gz

Findings:
  ERROR gate-unresolved
  WARNING runtime-graph-stale

No source files or artifact bodies were included.
```

---

### `/aidlc --stage <slug|#>` — Jump to stage

slug または番号で、指定したステージへ直接ジャンプします。

**構文:**

```
/aidlc --stage code-generation
/aidlc --stage 3.5
/aidlc --stage requirements-analysis
/aidlc --stage 2.3
```

**動き:** ワークフローがアクティブなら、目標のステージへジャンプします（間のステージは警告付きでスキップします）。ジャンプと一緒に入力した `--scope`、`--depth`、`--test-strategy`、`--guard-policy` は先に適用され、それから変更後の作業の中でジャンプします（`--review` と、`--sensors` のような手続きのスイッチは、先にそれだけで設定してください）。ワークフローがなければ `--scope` と組み合わせて、そこから始められます。

```
/aidlc --stage code-generation --scope bugfix
```

計画がスキップするステージも行き止まりではありません。それが現在のステージより後にある場合、ジャンプはまずそのステージを計画に戻し（ジャンプを理由として記録される `recompose --add`）、それからジャンプし、そのことと戻り方を 1 行で伝えます。まだワークフローがない場合、そのステージはほかのジャンプ先と同じように実行され、スコープの計画に含まれないことを 1 行で伝えます。それが現在のステージより前にある場合、または現在のステージそのものである場合は、戻るとその後のすべてのステージを再び実行することになるため、ジャンプは拒否され、計画や進捗に触れずにいまそれを実行する方法 `/aidlc --stage <slug> --single` が示されます。

---

### `/aidlc --stage <slug> --single` — Run one stage in isolation

`--single` を付けると、メインのワークフローを動かさずに 1 つのステージだけを実行します。ステージは実行され、作業がそのステージの文書を置く場所に文書を書き、止まります。ワークフローの `Current Stage` が進むことはありません（これは慣習ではなく、エンジンが強制します）。フルのライフサイクルに踏み込まずに、方法論の一部（要件分析、リバースエンジニアリングのスキャン）だけを適用したいときに使います。
作業がすでにそのステージのファイル（承認したステージ、または Unit のステップ）を持っているときは、実行の前にまずそれらのコピーを作業の記録の `archive/<time>-<stage>/` に保ち、そのフォルダとともに 1 行でそう伝えます。作業はこの実行が書いたものから続き、コピーが戻る手段になります。実行ごとに自分のコピーを保ちます。
スコープがスキップするステージも実行できます。計画に含まれないことを 1 行で伝え、計画はそのままです。
隔離実行でも、そのステージに設定されたエージェントとレビュアーは使いますが、ワークフローの学びは実行せず、ワークフローの承認も求めません。合成された完了が監査ログに記録され、コマンドはそこで止まります。
一緒に入力した `--depth` や `--test-strategy` は、その実行にだけ適用されます。ワークフローの設定はそのままです。`--review`、`--guard-policy`、`--guard.<check>` のスイッチ、手続きのスイッチ（`--sensors` など）は、`--single` と一緒では拒否されます。それらなしでステージを実行してください。

```
/aidlc --stage requirements-analysis --single
/aidlc --stage reverse-engineering --single
```

実行可能なステージはどれも、入力できる 1 語のランナー `/aidlc-<slug>` も出荷します。これは `/aidlc --stage <slug> --single` を包んだものです。ランナー一式（スコープランナー、ステージランナー、`/aidlc-init`、セッションビュー）は [Skills and Runner Commands](17-skills.md) に記載しています。

---

### `/aidlc --phase <name|#>` — Jump to phase

指定したフェーズの最初のステージへジャンプします。

**構文:**

```
/aidlc --phase construction
/aidlc --phase 3
/aidlc --phase ideation
/aidlc --phase 1
```

**動き:** `--stage` と同じですが、対象は指定したフェーズの最初のステージです。`--scope` と組み合わせられます。

---

### `/aidlc --scope <name>` — Change scope

実行中のワークフローのアクティブなスコープを変えます。

**構文:**

```
/aidlc --scope bugfix
/aidlc --scope enterprise
```

**動き:** `aidlc-state.md` のスコープ設定を更新し、どのステージを実行し、どれをスキップするかを再計算し、`SCOPE_CHANGED` 監査イベントを記録します。`--depth`、`--test-strategy`、`--review`、`--guard-policy`、`--sensors`、`--learnings`、`--summary-confirmation`、`--guard.<fence>` のスイッチと組み合わせられます。あなたが自分の言葉で頼んだ設定をエージェントが加えるときは、あなたが頼んだメッセージを名指す `--message <id>` も加え、その設定は `config set` と同じく `set by you` と表示されます。スコープ由来の Guard Policy は、より厳しい新しい既定値に自動で追随します。より低い既定値に追随するのは、あなたがスコープ変更を頼んだメッセージをエージェントが名指したとき（`--message <id>`）で、それ以外は実行中のワークフローがポリシーを保ち、出力が 1 行でそう伝えます。手続きの値は新しいスコープの既定値に追随し、人間による明示的な上書きと旧記録で存在しない行は保持します。memory の strict は引き続き実効ポリシーを決めます。明示的なフラグは人間の設定元を保ち、`config-change` と同じ弱化の規則に従います。現在のスコープを選んでも、指定した設定は同じ設定の適用処理で適用し、無意味なスコープ変更イベントは出しません。不正または未知のフラグ、あるいは認可されていない `--guard-policy relaxed` や `--guard-policy off` は、CLI の更新全体を拒否します。ステージのチェックボックスは、開いている承認（`[?]`）や改訂（`[R]`）を含め、そのまま引き継がれます。例外は、新しいスコープが承認待ちのステージをスキップする場合と、まだ始まっていない現在のステージをスキップする場合です。それらのステージは変更とともにスキップされます（`[S]`。それぞれ `STAGE_SKIPPED` 行 1 つと出力 1 行で、単独で実行するための `/aidlc --stage <slug> --single` を示します）。実行中の作業で、あなたを待っているものがない場合（ステージが単に実行中だった場合）は、エージェントは同じターンで続けます。新しいスコープがそのステージをもう実行しない場合は、新しいスコープが実行する次のステージへ進みます。承認、質問、または Unit のチェックポイントや要約があなたを待っている場合は、ターンが終わります。そのステージが新しい計画に残り、作業が Unit ごとに進んでいない場合、エージェントは作業がどこから再開するかを伝えます。同じメッセージが、新しい計画でもまだ実行されるステージであなたを待っている承認にも答えていて、作業が保留中でも Unit ごとに進んでいるのでもない場合（「approve, and switch back to the poc plan」）、エージェントは切り替えの直後にその答えを記録するので、作業は新しい計画から続きます。Practices Discovery のゲートでは、変更要求は同じように記録されますが、承認は、承認したプラクティスが保存されるのを待つため、あなたの次のメッセージを待ちます。完了した作業（`Status: Completed`）では、新しいスコープが最後のステージより後のステージを実行する場合、同じ書き込みでそのステージから作業を開き直します（`Status: Running`、そのステージは `[-]`、`STAGE_STARTED` 行 1 つ、`intents.json` の行は `in-flight` に戻る）。エージェントは同じターンでそのまま進み、切り替えの行と、新しいスコープが変えた設定を、そのステージの最初の行とともに伝えます。以前に承認したものは承認済みのままで、`doctor` は開き直した実行を、以前の完了からのずれではなく実行として読みます。最後のステージより後に何も加えない新しいスコープでは、作業は完了のままです。solo でもチームの Unit Ownership でも、進行中の Unit の作業を理由に変更が拒否されることはありません。新しいスコープが Units Generation をスキップする場合、Units Generation がすでに作った Unit は Unit ごとに続行し、新しいスコープが外すステージでの Unit の承認や Unit の作業は 1 行で示されます（例: 「The beta Unit's NFR Requirements approval is no longer part of the plan.」）。逆に、作業が Units Generation を実行せずに通り過ぎたあとで、Units Generation を実行する新しいスコープを選んでも、Unit は作られません。その Construction のステージは作業全体について一度だけ実行され、開いているゲートはその作業とともに開いたままで、Units Generation に戻ると（`/aidlc --stage units-generation`）作業が Unit に分割されます。

返答の最初の行は、新しい計画で作業が実行するステージ（完了したものと、現在のステージ以降のもの。新しい計画が現在のステージより前に加えるステージは、そこへ戻った場合にだけ実行されます）、完了した数、承認ゲートを示し、切り替え直すと残りの同じステージが戻ってくる場合には戻り方（`/aidlc --scope <old scope>`）を伝えます。作業に合わせて作った計画のあとでは、そうはなりません。続いて、変更でスキップしたステージごとに 1 行、外れた Unit の作業を示す 1 行、値が変わった設定ごとに 1 行が続きます。新しいスコープでも変わらない既定値は一覧されませんが、スコープと一緒に入力した設定は、変わったかどうかにかかわらず常に報告されます。

作業が今いるステージの要約を確認する返答の中で、そのステージを含まない計画への切り替えを入力した場合（「1. also can you switch this to the express plan?」）、エージェントはまず、確認された内容からそのステージの文書を書き、そのステージのほかのことは何もしません。そのあと切り替えは上のとおりそのステージをスキップし、新しい計画にはそれが含まれないことを伝え、後のステージはそれらの文書を読みます。確認の前、または文書が書かれたあとは、切り替えは上のとおりに進みます。

自律的な Construction（`Construction Autonomy Mode: autonomous`。その人が「Continue automatically」を選んだ状態）では、その人が頼んだスコープ変更はほかと同じように通り、残りの作業は引き続き自動で実行されます。その人の要求が記録されていない変更や、`AIDLC_UNATTENDED=1` で実行した変更は拒否され（新しい計画を承認する人がいないため）、拒否は `bun .claude/tools/aidlc-bolt.ts set-autonomy --mode gated` を示します。これは各 Bolt で承認のために止まる方式に切り替え、変更を通せるようにします。`recompose`（`/aidlc --skip` や `--add`、または承認した compose の提案）も同じ規則に従います。

まだワークフローのない新しいプロジェクトでは、`--scope <name>` は代わりにワークフローを始めます。`/aidlc <name>` とまったく同じ動きです。何を作るかとともに指定すると、指定したスコープでワークスペースを初期化し、その最初のステージからワークフローが始まります。スコープだけを指定すると、先に作業の目的を尋ねます。

---

### `/aidlc --depth <level>` — Override depth

現在の、または新しいワークフローの深度を上書きします。

**構文:**

```
/aidlc --depth minimal
/aidlc --depth standard
/aidlc --depth comprehensive
```

**動き:** ワークフローがアクティブなら、`aidlc-state.md` の Depth フィールドを更新し、`DEPTH_CHANGED` 監査イベントを記録します。`--scope` と組み合わせると、新しいスコープの既定の深度を上書きします。`--stage` または `--phase` と組み合わせると、ジャンプ先の実行文脈の深度を設定します。作業がまだ無いときにチャットで入力すると、そのチャットが次に始める作業のために保持され、エージェントがそのことを 1 行で伝えます。

**有効な値:** `minimal`、`standard`、`comprehensive`（大文字小文字は問わない）。

**例:**

```
/aidlc --depth minimal                            Change depth of active workflow
/aidlc --scope bugfix --depth comprehensive        Bugfix with comprehensive analysis
/aidlc --stage code-generation --depth minimal     Jump with minimal depth
```

---

### `/aidlc --test-strategy <level>` — Override test strategy

テスト量の戦略を、深度とは独立に上書きします。

**構文:**

```
/aidlc --test-strategy minimal
/aidlc --test-strategy standard
/aidlc --test-strategy comprehensive
```

**動き:** 指定がなければ、スコープが独自の上書きを宣言していない限り現在の深度に従います。独立に設定すると、Standard の深度（成果物はフル）と Minimal のテスト（Nyquist モデル）のような組み合わせができます。`aidlc-state.md` の `Test Strategy` フィールドを更新し、`TEST_STRATEGY_CHANGED` 監査イベントを記録します。

**有効な値:** `minimal`、`standard`、`comprehensive`（大文字小文字は問わない）。

**テスト戦略のモデル:**
- **Minimal (Nyquist):** 要件あたりテスト 1 本、ハッピーパスの下限、ユニットテストのみ（合計おおよそ 5–15）
- **Standard:** コンポーネントあたり 5–8 本、ユニット + 統合
- **Comprehensive:** コンポーネントあたり 10–15 本、すべてのテスト種別

各水準、既定の決まり方、よくある組み合わせの詳細は [Scopes, Depth, and Test Strategy](05-scopes-and-depth.md#the-3-test-strategy-levels) を参照してください。

**例:**

```
/aidlc --test-strategy minimal                         Minimal testing for active workflow
/aidlc --depth standard --test-strategy minimal        Full artifacts, minimal tests
/aidlc --scope bugfix --test-strategy comprehensive    Bugfix with thorough testing
```

---

### `/aidlc --project-type <type>` - New project or existing code

この作業が何であるかを、ワークスペースのスキャンに任せずに伝えます。

**構文:**

```
/aidlc --project-type brownfield "add the hover tooltip"   Start on existing code
/aidlc --project-type greenfield "scaffold the new service"   Start as a new project
/aidlc --project-type brownfield                            Mid-workflow: this is existing code
```

いつでも平易な言葉で伝えることもできます（「this is existing code, the frontend is in ui-repo」）。エージェントが同じコマンドを実行します。

**動き:** 開始時には、指定した種別がスキャンの判定を置き換え、言語、フレームワーク、ビルドシステムは引き続きスキャンが埋めます。ワークフローの途中では `aidlc engine workspace reclassify --project-type <type>` を実行します。これはフォルダを再びスキャンし、`Project Type` を設定し、`Project Type Source: you` を記録し、`## Workspace State` を更新します。既存のコードの場合は、作業開始後にフォルダへ追加されたリポジトリも記録し（何も記録されておらず、Construction が始まっていない場合）、新規プロジェクトとしてのスキャンが外した Reverse Engineering や、空のフォルダ向けに合成された計画が外した Reverse Engineering を戻します（`infra` のように Reverse Engineering を実行しないスコープでは外したままです）。ワークフローがすでに Reverse Engineering を過ぎている場合は、それを次に実行し、その後ワークフローは元のステージに戻ります。完了したステージは完了のままで、返答はコードが分かる前に完了していたステージを示すので、やり直すことができます。新しいプロジェクトの場合、完了していない Reverse Engineering は、承認ゲートで待っているものも含めてスキップされます。その質問はスキップとして閉じ、書いた文書は残ります。Construction が始まった後は計画はそのままで、返答は Reverse Engineering を単独で実行する方法を伝えます（いまコードをスキャンするようにも頼んだ場合は、エージェントがそれを実行します）。種別が変わると、返答の最後に元に戻す方法が示されます。`WORKSPACE_RECLASSIFIED` を記録します。

スキャンが作業を新しいプロジェクトとして設定し、Construction の前にフォルダにコードが加わった場合、`next` は既存のコードかどうかを 1 回だけ尋ねます。どちらの答えでも種別はあなたのものとして記録され、再び尋ねられることはありません。指定した種別が効くのはその作業だけで、次の作業では再びフォルダをスキャンします。

**有効な値:** `greenfield`、`brownfield`（大文字小文字は問わない）。

---

### `/aidlc --review <class>` - Set stage reviews for this run

実行ごとのレビューの上書きを設定します。アクティブなワークフローの §12a ステージレビューをどこまで重く実行するかの上限で、スコープの `review_cap` を置き換えます。

**構文:**

```
/aidlc --review adversarial
/aidlc --review advisory
/aidlc --review none
```

**動き:** レビュアーを持つステージは、frontmatter でレビュークラスを宣言します。`adversarial`（レビュアーが成果物に反論し、リードが最大 `reviewer_max_iterations` 回まで所見を直す）か `advisory`（通常フローのレビュー 1 回。承認ゲートは、エンジンが所有する所見リストからその所見を示し、あなたが振り分ける）です。ステージごとの実効クラスは、ステージの宣言を 1 つの上限で引き下げたものです。上限は、この上書きが設定されていればそれ、無ければスコープの `review_cap`（bugfix、poc、classic、workshop は `advisory` まで、express は `none` まで）です。そのため `--review advisory` は残りのすべての adversarial のループを通常フローの意思決定支援 1 回に変え、`--review none` はゲート付きのステージレビュアーのディスパッチを飛ばし、`--review adversarial` は上限のあるスコープでも各ステージ自身のクラスを実行します。スコープ自身のレベルを設定すると（例: bugfix での `--review advisory`、feature での `--review adversarial`）、代わりに上書きを解除します。スコープの上限が再び適用され、後のスコープ変更に追随します。どの上書きも、ステージの宣言より上にクラスを上げたり、ステージが宣言しないレビュアーを追加したりはしません。
上書きがない場合、classic はゲート付きの流れで、レビュアーを持つステージごとに advisory のレビューを 1 回実行し、所見を承認ゲートで示します。明示的な自律 Construction は例外で、classic のもとでも、マージ前の 1 回のレビュアーを保ちます。スコープの上限も手続きのスイッチも、そのレビューを無効にしません。
`aidlc-state.md` の `Review Override` フィールドを更新し、`REVIEW_CLASS_CHANGED` 監査イベントを記録します。ワークフロー作成時、または `--scope` と並べて指定できます。現在と同じスコープでは、レビューの上書きを捨てずに設定変更として適用します。どちらのクラスでも、後の出力の書込みが終端のレシートを無効にした場合は、次の序数で上限付きの復旧要求が 1 回許されます。

**有効な値:** `adversarial`、`advisory`、`none`（大文字小文字は問わない）。

**例:**

```
/aidlc --review advisory              Single normal-flow pass, findings at the gate
/aidlc --review none                  No gated stage reviews this run
/aidlc --review adversarial           Each stage's own review class, above any scope cap
/aidlc --review advisory              On bugfix: back to bugfix's normal reviews
```

---

<a id="workflow-configuration-one-atomic-setter"></a>

### ワークフロー設定：一度の処理でまとめて更新する

12 個のインテント設定（`guard.plan-approval` は `plan-approval` の別名なので、キーは 13 個）はすべて、1 つの CLI 設定コマンド `config-change` を共有します。
異なる設定のフラグは 1 つの原子的な CLI コマンドにまとめられます。併記する設定を、連続した別々の設定コマンドに分けないでください。
入力した弱化コマンドでは、エージェントがスイッチとそれに併記したインテント設定を 1 つのトランザクションでこの設定コマンドに渡して実行します。フックはメッセージを記録するだけです。
これはアクティブなインテントの設定であり、`aidlc config flags` によるネイティブのプロジェクト設定とは別物です。

| Config キー / スラッシュフラグ | 値 | 状態フィールド |
|-------------------------|--------|-------------|
| `depth` / `--depth` | `minimal`、`standard`、`comprehensive` | Depth |
| `test-strategy` / `--test-strategy` | `minimal`、`standard`、`comprehensive` | Test Strategy |
| `review` / `--review` | `adversarial`、`advisory`、`none` | Review Override |
| `guard-policy` / `--guard-policy` | `strict`、`relaxed`、`off` | Guard Policy |
| `sensors` / `--sensors` | `on`、`off` | Sensors |
| `learnings` / `--learnings` | `on`、`off` | Learnings |
| `summary-confirmation` / `--summary-confirmation` | `on`、`off` | Summary Confirmation |
| `plan-approval` / `--plan-approval` | `on`、`off` | Plan Approval |
| `collaborators` / `--collaborators` | `on`、`off` | Collaborators |
| `guard.plan-approval` / `--guard.plan-approval` | `on`、`off` | Plan Approval（`plan-approval` の別名） |
| `guard.review-freeze` / `--guard.review-freeze` | `on`、`off` | Guards Off / Guards On |
| `guard.state-transition` / `--guard.state-transition` | `on`、`off` | Guards Off / Guards On |
| `guard.reviewer-scope` / `--guard.reviewer-scope` | `on`、`off` | Guards Off / Guards On |

廃止済みのキー `change-control` と廃止済みのフラグ `--change-control` は、1 リリースの間は引き続き `guard-policy` に解決され、非推奨を伝える 1 行を出します。`config-change` と `scope-change` のユーティリティ経路では、1 つのコマンドで両方の表記を指定した場合、値が異なれば拒否し、一致すれば受け付けます。`orchestrate next` では、両方の値が有効なら 2 つのフラグのうち最後のものが優先します。`validate-grid` では、順序にかかわらず `--guard-policy` が `--change-control` より優先し、選ばれたフラグの最初の出現を使います。どちらのフラグもスコープのオブジェクトより優先し、オブジェクト内では文字列の `guardPolicy` が文字列の `changeControl` より優先します。

以下の各行は設定を組み合わせたものです。エージェントが実行する設定コマンドは、弱化も含めて、列挙したインテント設定をまとめて適用します。

```
/aidlc --depth minimal --review none --guard-policy relaxed --sensors off
/aidlc config set depth standard --test-strategy minimal --review advisory --guard-policy strict --sensors on --learnings on --summary-confirmation off
/aidlc --scope bugfix --guard-policy relaxed --sensors off --learnings on
```

ネイティブのディスパッチャーの形式は、`aidlc engine config set <key> <value>` にほかの設定フラグを続けたものです。端末で入力する場合は、`aidlc config set <key> <value>`、`aidlc config get <key>`、`aidlc config list` が `engine` なしで同じ動詞に届きます。どのキーも同じユーティリティコマンドへルーティングされます。最初の設定が `--<key> <value>` になり、残りのフラグはそのまま渡されます。あなたが自分の言葉で頼んだことのためにエージェントが実行するときは、それを頼んだあなたのメッセージの id である `--message <id>` を加えます。エンジンは、そのメッセージがあなたのものであること、このチャットを通じて届いたこと、その後の判断によって使い切られていないこと（その同じメッセージが行った 1 つの承認や回答は、それを有効なまま残します）を確かめます。すると設定は `set by you` と表示され、off にした設定は、その監査行にあなたのメッセージ全体を `Person Reply` として残します。確かめられないメッセージは拒否され、拒否がその理由を伝えます。`--message` がない場合、設定が `set by you` と表示されるのは、あなたがそれを自分の行で入力したか、自分の端末でコマンドを実行したときだけで、それ以外は `set by a command` と表示されます（どちらでも適用はされます）。弱化（検査の off、計画承認や要約確認の off、Guard Policy の `relaxed` や `off`）は、代わりに拒否されます。`--person-words '<words>'` と `--person-words-file <file>` は引き続き受け付けますが、何も証明しません。エンジンはその言葉をエージェント自身のテキスト（`Conductor Summary`）として残し、設定は `set by a command` と表示されます。

```bash
aidlc engine config set guard-policy relaxed --sensors off --intent login-fix --space platform
bun .claude/tools/aidlc-utility.ts config-change --depth minimal --review none --guard-policy relaxed --sensors off --intent login-fix --space platform --project-dir /work/shop
```

`config-change` が受け付けるのは、13 個の設定フラグ（と廃止済みの `--change-control` の表記）、`--message`、`--person-words` または `--person-words-file`（引き続き受け付けますが、何も証明せず、エージェント自身のテキストとして残ります）、そして `--intent`、`--space`、`--project-dir` のセレクターだけです。設定は 1 つ以上必要です。セレクターは状態ファイル、memory のポリシー、監査シャードを同じ対象に固定します。intent／space のセレクターを省くと、アクティブなワークフローの選択を使います。アクティブなインテントやスペースは切り替えません。スコープも変える場合は、`config-change --scope` ではなく `scope-change`（`/aidlc --scope` の経路）を使います。

入力による弱化スイッチでは、`/aidlc config set guard-policy relaxed --intent <name> --space <name>` と `/aidlc --guard-policy relaxed --intent <name> --space <name> ...` のどちらでも、エージェントの設定コマンドがそれを適用する作業を指定します。
フラグ形式の末尾の `...` は、任意のタスク説明を表します。
セレクターを省くとセッションのワークフロー選択を使います。存在しない名前のインテントは拒否します。作業が選ばれていない場合、設定コマンドは、そのチャットが次に取り上げる、または始める作業のために設定を保持します。既存の作業を選ぶと（選択の質問、`/aidlc intent <name>`、またはその 1 つの作業に着地するスペースの切り替え）、そこに適用し、作業を示す行の後に一度だけそう伝えます。
設定コマンドは、認識したすべての併記インテント設定を変更前に検証します。不正なコマンド、未知のフラグ、値の欠落、不正な併記の値は何も変えず、CLI の経路が通常の検証エラーを報告します。

CLI は状態を変更する前に、すべてのフラグと値を検証します。不正な値と未知のフラグはその更新全体を拒否し、未知のフラグはエラーで名指しされます。明示的な `--guard-policy relaxed` または `--guard-policy off` が memory 層の `Mode: strict` によって拒否された場合、併記した設定やスコープ変更は一切適用されません。エラーは編集すべき memory ファイルを示します。明示的な strict と無関係な設定は引き続き可能です。対象の状態の読取り、すべての設定の適用、監査バッチの追記、1 回の状態書込みを 1 つのロックで扱います。監査に失敗した場合、状態は変わりません。変更と出力は表のキーの順に従います。`Last Updated` は保存された状態が変わったときだけ更新します。すでに保存された選択を繰り返しても何もしませんが、スコープ由来の値を明示的な上書きに変えた場合は、値が同じでもその設定元を記録します。

`config get` は表のすべてのキーを受け付け、`config list` は 13 個すべてをその順に返します。Guard Policy、ガード、手続きの読取りには、status と同じく実効値と設定元が含まれます。

```
/aidlc config get guard-policy
/aidlc config get plan-approval
/aidlc config get summary-confirmation
/aidlc config list
/aidlc config list --json
```

読み取り専用の `guard.human-presence` の参照は `on (default)` または `off (env AIDLC_SKIP_HUMAN_PRESENCE_GUARD)` を返します。これは作業ごとの設定ではなく、`config list` にも含まれません。

ネイティブの読取りの同等コマンドは `aidlc engine config get <key>` と `aidlc engine config list` です。`aidlc engine config --help` はすべての config の動詞を一覧します。以下の節では、この同じ設定コマンドが管理する Guard Policy、ガード、手続きの方針を説明します。

#### `/aidlc --guard-policy <value>` — ガード方針

インテントの Guard Policy の値を設定します。目の前の作業について、フレームワークのガードがどこまで道を譲るかです。決めるのは 2 つのことです。人間がすでに承認または確認したものが下で変わっていたとき（コード計画の承認後にソースファイルが動いた、レビュー済みの文書がレビュー後に編集された、現在の要約確認なしに出力が保存された）にどうするか、そして実行中のワークフローのどのステップも求めていない操作に対して、5 つのガードのどれを維持するかです。

**構文:**

```
/aidlc --guard-policy strict
/aidlc --guard-policy relaxed
/aidlc --guard-policy off
```

**動き:** 入力が変わったとき、`strict` は承認を開き直します。変わったものを示す平易な文とともに実行が止まり、もう一度承認を求めます。`relaxed` と `off` は変更を `CHANGE_ACCEPTED` 監査行として 1 回記録し、1 行で伝えて続行します。コード計画を承認した後にコードが動いた場合は例外で、その 1 行と記録とともにビルドが続き、`strict` のもとで再び尋ねるのは、計画やそのテスト指示の編集だけです。`strict` のもとで Unit を並行してビルドする場合は、あなたの変更（編集、コミット、`git pull`）についても再び尋ねる唯一のケースで、それを元に戻すか `relaxed` を設定するまで、次の Unit の取り込みを止めます（[Guard Policy](13-customization.md#guard-policy) を参照）。ガードについては、`strict` は 5 つすべてを維持し、`relaxed` は `plan-approval`（計画の再承認。編集された計画を再び尋ねない）と `review-freeze` を下げ、`off` はその 2 つに加えて `state-transition` と `reviewer-scope` を下げます。`human-presence` がポリシーの語で下がることはありません。

チャットから `guard-policy relaxed` や `guard-policy off` を設定するのは、その人の操作です。その人が `/aidlc --guard-policy relaxed`（その値なら `off`）を入力すると、コンダクターの最初の `next` が設定コマンドを示し、コンダクターは同じターンでそれを実行します。設定コマンドは状態の行と監査行を書き、チャットで頼まれたとおりに何が変わったかを伝えます。フックはメッセージを記録するだけです。
平易な言葉で頼まれた場合、コンダクターは求められた値で `config-change --guard-policy <strict|relaxed|off>` を実行し（直前の判断以降にその人の返答が記録されていれば弱化します）、その出力をそのまま表示して止まります。
この Kiro IDE のビルドがプロンプト本文を渡さないとハーネスが伝えている場合は、そのビルドでは進行中の作業を弱められないと伝えます（そのアダプターは弱化の設定コマンドも拒否します）。Kiro IDE を更新するか、既定値の低いスコープで新しい作業を始めてください。
config 形式でもフラグ先頭の形式でも、`--intent <name>` と `--space <name>` が作業を選びます。セレクターを省くと、フックペイロードのセッションのワークフロー選択を使います。
存在しない名前のインテントは拒否します。作業が存在する前に入力した Guard Policy の `relaxed` または `off` のスイッチは、このチャットが次に始める作業のために保持されます: `Guard Policy relaxed for the piece of work you start now (set by you).`
取り上げられるほかの作業がある場合は、そのチャットが次に取り上げる、または始める作業に付きます（`... for the work you pick up or start next (set by you).`）。後の `strict` は、それより前に入力で off にした検査を取り消します。
要求と一緒に入力すると、その要求に付きます（`Guard Policy relaxed for the work you are asking for (set by you).`）。新しい作業は作成時にそれを受け取り、開いている作業を続ける場合はそちらに適用されます。メッセージだけで開いている作業が変わることはありません。`off` の形式では `relaxed` の代わりに `off` と示されます。
ガードのスイッチ（`guard.<fence> off`）も同様に働きます。作業が存在する前なら `The review freeze check is off for the piece of work you start now (set by you).`、要求と一緒に入力したなら `The review freeze check is off for the work you are asking for (set by you).` です。唯一の例外は、コード計画の質問が開いていて、その人が計画ファイルを編集していないときです。このとき、言葉と一緒に入力した設定はこの作業のためのもので、言葉はその質問への返答になります（`/aidlc --guard-policy off approve the plan`）。引用符で囲まれていない `--` の後の言葉は、引き続き新しい作業の説明です。
フックは Windows でも動くため、プロンプトを転送するすべてのハーネスで、設定コマンド側のセッション照会なしに入力によるスイッチが使えます。
無関係な返答は何も開かず、`AIDLC_UNATTENDED=1` はプロンプト時の適用を止め、CLI の弱化を拒否します。
スコープの既定値は確認なしに適用されます。
すでに off のガードや、すでに `set by you` となっている同一のポリシーの語は、CLI の更新が何もしないためキーが不要です。
memory の strict と無人実行の検査の後、CLI の設定コマンドがその人のプロンプトなしに弱化するのは 2 つの場合だけです。あなたが自分の端末で入力した場合（両端が端末で、コマンドにチャットの識別情報がなく、エージェントのために端末を開くホストの印もない）で、これは本人の操作です。または `fenceKeyBypassed` がフィクスチャやハーネス起動時の在席バイパスを認識した場合で、インラインの環境変数の代入では認識しません。
session-start フックは、`AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1` を付けて起動された有人のハーネスについて、`presence-bypass-<session>` スタンプを Plan Approval のランタイムディレクトリに保持します。
モデルのツールはフックを起動できず、`aidlc/.aidlc-sessions/` やどの `.aidlc-plan-approval/`、`<record>/.aidlc-engine/gate-words/` ディレクトリにも書き込めません。これは [state-transition ガード](../reference/06-hooks-and-tools.md#pretooluse-aidlc-state-transition-guardts) が強制します。
memory が保持する strict は最初に拒否し、ポリシーの語と以前に下げたガードの両方に優先します。マシン全体の無効化スイッチが優先しない限り、`/aidlc --status` はそれを `on (guard policy strict (from <layer>.md))` と表示します。

入力による `config set` の弱化スイッチは、`config set <key> <value>` の後に、任意でほかの設定フラグ（`--depth minimal --sensors off`）と `--intent <name>` と `--space <name>` の組が続くものを受け付けます。未知のフラグや不正な値があると、それを示してコマンド全体を拒否します。[Customization](13-customization.md#the-five-fences) を参照してください。
Codex では `$aidlc` を使い、その拒否は `/aidlc` の代わりに `$aidlc` を示します。

その人が頼んだメッセージ（`--message <id>`）なしで、ポリシーを `relaxed` に変える設定コマンドを実行すると、次のように拒否します。

> Setting Guard Policy relaxed lowers fences, which is the person's call. Run it with --message <id>, the message they asked in, when they ask for it.

直接の `scope change --guard-policy relaxed|off` も同じ規則を使います。チャットからの直接の `intent create --guard-policy relaxed|off` は、その人がこのチャットでそれを頼んでいれば、進行中の作業での設定コマンドと同じように実行されます。その人のメッセージがその根拠であり、新しい作業は、フラグがその人自身の入力した行にあれば（またはその人の端末が実行していれば）`Guard Policy: <value> (set by you)` を、エージェントが加えたものなら `(set by a command)` を記録します。作業が存在する前は、そのメッセージはフックが届いたとおりに保持したものです。作業が存在すると、直前の判断以降のその人のターンです。その人が自分の端末で実行するコマンドは、それ自体が根拠になります。作業が存在する前、または新しい作業と同じメッセージでその人が入力した Guard Policy の `relaxed` または `off` は、このチャットが次に始める作業のために保持され、その要求への回答になります。そのための `intent create --request <id>` は、フラグの有無にかかわらず `Guard Policy: <value> (set by you)` を記録し、開いている作業は自分のポリシーを保ちます。作成時にスコープ自身の既定値を指定すると、追加の確認なしにスコープの値として記録されます。実行中のワークフローが既定値の低いスコープへ移る場合、その人がスコープ変更を頼んだときはその値を取り、そうでなければより厳しいポリシーを保ち、1 行でそう伝えます。このチャットにその人のメッセージが記録されていない場合、作成は次のように拒否します。

> Setting Guard Policy relaxed lowers fences, which is the person's call. Run it with --message <id>, the message they asked in, when they ask for it.

`off` の拒否では `relaxed` の代わりに `off` を使います。無人実行では、ドライバー向けの案内も受け取ります。その人がガードの復旧の `lower-fence` の選択肢を選ぶと、エージェントが代わりに `config set guard.<fence> off` を実行し、何が変わったかを 1 行で伝えます。その人が入力する必要はありません。

compose による作成は、計画が実行されるスコープから Guard Policy を読み、スコープファイルは書きません。一致した計画は、ストックスコープの既定値か、あなたが求めたより厳しい値を保ちます。カスタム計画は、既定値が承認した値かそれより低いストックスコープ上で実行されます。
コンダクターは `strict` または `relaxed` のときに `--guard-policy` を渡し（これで低いスコープ既定値を引き上げます）、`off` では決して渡しません。compose ゲートで一致した計画をストックの既定値より下げると、コンポーザーはそれを編集として扱います。提案はその値を持つストックスコープ上のカスタム計画になり、そこからインテントが作られます。既定値より上げた場合、計画は一致したままです。後であなたが入力することは何も残りません。コンポーザーが進行中インテントの値を変えることはありません。

どの値もゲートを取り除きません。コンダクターは引き続きすべての承認の質問をしなければならず、下がったガードがその文章上の義務を強制することはありません。レビュアーの判定は決して変わらず、証拠は削除されず、エージェントが人間の代わりに答えることもありません。下がったガードを通過するたびに `GUARD_STOOD_ASIDE` 行が 1 つ書かれます。その 1 行の通知がどう届くかはハーネスによります。[Customization](13-customization.md#what-you-see-when-a-guard-decides) を参照してください。

共有の `config-change --guard-policy <value>` 設定コマンドは、入力によるスイッチや平易な言葉での要求に対してエージェントが実行するもので（human-turn フックはメッセージを記録するだけです）、`aidlc-state.md` の `Guard Policy` の行を `<value> (set by you)`（その人が頼んだことを示す記録がなければ `(set by a command)`）に書き直し、監査バッチに `GUARD_POLICY_SET` 行を加えます。
ポリシーの行を書き込むと、廃止済みの `Change Control` の行が取り除かれ、`Guard Policy` だけが残ります。
両方の行が異なるポリシーの語で存在する場合、memory が strict を保持していなければ、次の `next` がそのどちらかを残すまで、status は `strict (from conflicting state lines)` を表示します（[値の置き場所](13-customization.md#where-the-value-lives) を参照）。
両者が一致する場合は `Guard Policy` の行が使われ、次のポリシーの書込みで廃止済みの行が取り除かれます。廃止済みの relaxed または off の行だけを持つ記録は、あなたの次のメッセージで名前が変わります。値は保たれて `Guard Policy` として書かれ、ポリシーの監査行は出ません。それが起きていない場合は、すべての `/aidlc` の実行に通知が付きます。`/aidlc config set guard-policy relaxed` は値を保ち、`/aidlc config set guard-policy strict` はガードを引き上げ、どちらでも通知は止まります。
この通知の表示によって行が書き換えられることはなく、廃止済みの strict の行だけの場合は通知が出ません。値はインテントとともにコミットされ、セッションを越えて残り、チームメイトにも見えます。同じ設定コマンドが不正な行を修復し、古い本文を記録します。「stop asking me to re-approve when files change」のような通常のチャットでのポリシーの要求は、コンダクターが実行します。求められた値で設定コマンドを実行し、直前の判断以降にあなたの返答が記録されていれば弱化します。
入力によるスイッチ（たとえば `/aidlc --guard-policy relaxed`）は同じ設定コマンドで、コンダクターが最初の `next` から実行します。
設定とスコープの変更では、行の `Old Value` は memory による実効値ではなく、以前に保存されたインテントの値です（不正なら生の本文、行がなければ `strict`）。対象のチェックポイントでの観測は、引き続き実効の旧／新の値を記録します。
この行を持たない古いインテントは、設定されるまで strict のままです。新しいインテントはスコープの既定値から、または memory 層の `Mode: relaxed` か `Mode: off` が設定されていればそこから始まります。memory 層の `## Guard Policy` セクションが `Mode: strict` を示す場合、明示的な `relaxed` または `off` は、指定したほかの設定を含めてコマンド全体を拒否し、そのファイルを示します。全員について緩めるには、そこにある memory の行を編集してください。明示的な strict の設定は引き続き可能です。作成時には、スコープとともにフラグを指定できます（`/aidlc --scope poc --guard-policy strict "..."`）。

廃止済みのフラグ `--change-control` と廃止済みの config キー `change-control` は、1 リリースの間は引き続き解決され、次のマイナーバージョンで削除されることを示す非推奨の 1 行を出します。`config-change` と `scope-change` の経路では、1 つのコマンドで両方の表記を渡した場合、値が異なれば拒否し、一致すれば受け付けます。`orchestrate next` では 2 つのうち最後のものが優先します。

**有効な値:** `strict`、`relaxed`、`off`。

**例:**

```
/aidlc --guard-policy relaxed        Record and announce input changes, keep going
/aidlc --guard-policy strict         Approve again whenever an approved input changes
/aidlc --guard-policy off            Lower the four lowerable fences too (each pass-through logged)
```

#### `/aidlc config set guard.<fence> <on|off>` — 個別ガード

ポリシーの語に触れずに、目の前の作業についてガードを 1 つ off にし、ポリシーの語がそれを下げている場合でも on に戻します。作業ごとのスイッチは `review-freeze`、`state-transition`、`reviewer-scope` の 3 つです。`guard.plan-approval` は `plan-approval` 設定の別名なので（[Plan approval](#aidlc-plan-approval-plan-approval) を参照）、`Guards Off` のエントリは書きません。human presence は鍵の保持者で、作業ごとのスイッチを持ちません。

**構文:**

```
/aidlc config set guard.review-freeze off
/aidlc config set guard.review-freeze on
```

**動き:** ガードを off にすると、`aidlc-state.md` に `- **Guards Off**: <comma list> (set by you)` が書かれ、`Guard`、`Scope`、`Source` を持つ `GUARD_DISABLED` 監査行が 1 つ書かれます。on に戻すとその一覧から取り除かれ、`GUARD_RESTORED` が書かれます。`on` の設定は、ポリシーで下げられたガードを引き上げ、`- **Guards On**: <comma list> (set by you)` に記録し、同じフィールドを持つ `GUARD_RESTORED` を書きます。Guard Policy の語を自分で設定すると、それに反する行をクリアし（同じコマンドが指定したガードを除く）、変わったガードごとに同じ行を書きます。`off` は `Guards On` を、`strict` は `Guards Off` をクリアし、`relaxed` はどちらもクリアしません。その後の個別ガードのスイッチは引き続き適用されます。すでに有効な設定を繰り返しても何もせず、そう伝えます。ポリシーで下げられたガードを `on` にするのは、何もしない操作ではありません。どちらの状態の行も human presence を受け付けず、保存された human-presence のエントリは無視されます。
`/aidlc --status` は、あなたか環境変数のスイッチが off にした各ガードとその理由を示す `Checks off:` の行を表示します。低い Guard Policy が off にするものは、ポリシーの出どころを示す `Guard Policy:` の行に含まれます。優先順位は、環境変数による無効化、次に memory が strict を保持していなければ作業ごとの off、次に作業ごとの on、次に Guard Policy の語、最後に既定の on です。5 つのうち 4 つには無効化の環境変数がありますが、`state-transition` にはないため、ポリシーの語とこのスイッチだけがそれを制御します。

チャットから `guard.<fence> off` を設定するには、その人が `/aidlc config set guard.<fence> off` または `/aidlc --guard.<fence> off` を入力します。エージェントが同じターンでその設定コマンドを実行し、設定コマンドが監査行を記録して、何が変わったかを伝えます。
自分の言葉で頼むか、ガードの `lower-fence` の選択肢を選んでも同じです。エージェントがそのガードの設定コマンドを実行し、何が変わったかを 1 行で伝えます。
どちらの形式も `--intent <name>` と `--space <name>` を受け付けます。セレクターを省くと、フックペイロードのセッションのワークフロー選択を使います。
存在しない名前のインテントは拒否します。まだ状態ファイルがない場合、スイッチはこのチャットが次に始める作業のために保持されます。要求と一緒に入力すると（`/aidlc --guard.<fence> off <description>`）、その要求に付き、開いている作業を変えることはありません。
CLI の設定コマンドがガードを下げるのは、直前の判断以降に人のターンが記録されている場合です（空の台帳は数えません）。すでに off のガードは何もせず、キーも不要です。
フックは Windows でも動くため、プロンプトを転送するすべてのハーネスが、設定コマンド側のセッション照会なしに入力によるスイッチに対応します。
`AIDLC_UNATTENDED=1` はプロンプト時の適用を止め、CLI の弱化を拒否します。
memory の strict と無人実行の検査の後、その人のプロンプトなしに CLI の弱化を許すのは、フィクスチャやハーネス起動時の在席バイパスを通じた `fenceKeyBypassed` だけです。インラインの環境変数の代入ではそれは成立しません。
memory が保持する strict は最初に拒否し、以前に下げたガードに優先します。マシン全体の無効化スイッチが優先しない限り、`/aidlc --status` はそれを `on (guard policy strict (from <layer>.md))` と表示します。保存された `Guards Off` のエントリは残り、memory の行が strict を保持しなくなった後でのみ再び効きます。

エージェントがあなたに代わって、あなたが頼んだメッセージを名指さずに review-freeze のガードを off にする設定コマンドを実行すると、次のように拒否します。

> Turning the review-freeze check off is the person's call. Run it with --message <id>, the message they asked in, when they ask for it.

ほかのガードの拒否では、そのガードの名前に置き換わります。無人実行では、ドライバー向けの案内も受け取ります。あなたが自分の端末で入力した同じコマンドは、その理由で拒否されることはありません。本人の操作なので実行され、1 行で伝えられ（「The review freeze check (it stops edits to work you already approved) is off for this piece of work, set by you. You can turn it back on any time.」）、set by you として記録されます。エディターが自身のエージェントのために開く端末（VS Code の Copilot、Kiro IDE、Cursor）はあなたの端末ではありません。そこでの拒否は「To turn the review-freeze check off, ask for it in your Kiro chat.」のように、あなたのツールを名指しします。このコマンドは、ポリシーの語が維持しているものを含め、切り替え可能な 3 つのガードを制御します。切り替え可能なガードのメインセッションでの拒否はこのコマンドを示します。human-presence の拒否はスイッチを示しません。この作業でプロンプトフックが動いている間（そのハートビートが新しい間）は、その人がまだ答えていないことを伝え、エージェントはターンを終えます。その人に伝えることはありません。それ以外の場合は、その人がすでに送った返答がどうなったかを伝えます。その人が操作した後にだけフックを実行するハーネスでは、フックを有効にする手順を伝えます。それ以外では、その人向けに 1 行で「Your answer didn't reach AI-DLC. Please give it once more. If it happens again, type /aidlc --doctor.」と伝えます。`/agent` で選んだ別のエージェントに入力した返答が記録されない Kiro CLI では、その行は「Your answer didn't reach AI-DLC. Type /agent and pick aidlc, then give it once more.」になります。Kiro がエージェント「aidlc」の 3.0 エンジン向けのアップグレードが必要だと伝える場合、その行は「Your answer didn't reach AI-DLC. Quit Kiro and start it again in this folder with: kiro-cli chat --agent-engine v2 --agent aidlc, then give it once more.」になります。エージェントは、その人のために検査を off にすると申し出てはならないと指示されています。

その人の返答の後にエージェントが記録した質問に対する `log answer` は記録されます。ほかの回答がすでにその返答を使って記録していない限り、その返答に基づいて記録されるので、その人が再び尋ねられることはありません。

human presence を下げるのは `AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1` だけで、マシン全体に設定するか `aidlc config flags --bypass` で記録します（その場合 AI-DLC は off であることを伝えます）。`AIDLC_UNATTENDED=1` は別途、人間のターンの発行を止めるもので、ガードを下げるものではありません。`guard.human-presence` を設定しようとすると、更新全体を非ゼロの終了コードと次のメッセージで拒否します。
`Human presence cannot be switched off: it is how AIDLC knows an approval or an answer came from a real person, so reply in the chat yourself. For a supervised session where nobody can reply, launch the CLI with AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1 set.`

**有効な値:** `on`、`off`。

<a id="aidlc-sensors-learnings-summary-confirmation-ceremony-controls"></a>

#### `/aidlc --sensors`、`--learnings`、`--summary-confirmation`：手続きの切り替え

アクティブなインテントについて、この 3 つの独立した方針を `on` または `off` に設定します。

```
/aidlc --sensors off
/aidlc --learnings on
/aidlc --summary-confirmation off
```

| フラグ / config キー | 状態とステータスの行 | `off` で省くもの |
|-------------------|----------------------|------------------|
| `--sensors` / `sensors` | Sensors | センサーの自動ディスパッチとブロッキングセンサーの検査。診断用の明示的な `sensor fire` は引き続き使える |
| `--learnings` / `learnings` | Learnings | 学びの日誌と学びのゲートの手続き |
| `--summary-confirmation` / `summary-confirmation` | Summary Confirmation | ステージの frontmatter が宣言する統合サマリーの `Looks correct` チェックポイントだけ。intent-capture の Assumption Confirmation は、必須の質問やステージ承認と同じく、別の人間の判断として残る |

**既定値と優先順位:** `1` に設定された無効化の環境変数は、その方針を強制的に `off` にします。それ以外では、インテントごとの明示的な設定が優先し、次に現在のスコープの既定値、スコープに設定がなければ `on` です。要するに **環境変数 → インテントごと → スコープ → on** です。出荷されるスコープはすべて 3 つを明示的に宣言します。classic は sensors と learnings を `on`、summary confirmation を `off` に、bugfix は sensors を `on`、learnings と summary confirmation を `off` に、express は 3 つすべてを `off` に、残りの 8 つは 3 つすべてを `on` にします。キーを省いたスコープファイルは引き続き `on` にフォールバックします。新しいインテントはスコープの既定値を、たとえば Sensors なら `on (from scope classic)` のように保存します。
スコープを変えると、スコープ由来の値は新しい既定値へ移り、明示的な値（`set by you` または `set by a command`）は保持されます。これらのフィールドを持たない古いインテントは、スコープ、次に `on` から解決します。
スコープの選択と一緒に明示した手続きのフラグは、スコープ由来の既定値ではなく、明示的な上書きを書きます。
これらのフラグは互いに組み合わせられ、深度、テスト戦略、レビュー、Guard Policy、ガードのスイッチとも、スコープ変更の有無にかかわらず 1 つの設定トランザクションにまとめられます。
隔離された `--single` の実行は、合成のステージ開始イベントに記録された、選択したスコープの方針を完了まで使います。メインのインテントの手続きの上書きは継承しません。開いている隔離の試行を別のスコープで再開することはできません。試行を完了させるか、記録されたスコープで再開してください。
スコープが記録されていない旧形式の隔離開始は、要約確認を維持し、このスコープ比較を行いません。

明示的な手続きの設定は、対応する状態の行に `<value> (set by a command)` を書きます。設定コマンドがその人の入力したスイッチを適用した場合や、その人がチャットで頼んだことを実行してエージェントがその人が頼んだメッセージを名指した場合（`config set <key> <value> --message <id>`。たとえば「lead agent only from here」のあと。エンジンはそれがこのチャットからのその人のメッセージであることを証明します）は `<value> (set by you)` です。そして共有の監査バッチに、`Key`、`Old`、`New`、`Source`、さらにその人が off を頼んだ場合は `Person Reply`（その人のメッセージ全体）と `Message Id` を持つ `CEREMONY_SET` 行を加えます。
`Old` は以前に保存された値（不正なら生の本文、行がなければスコープの既定値）で、環境変数の無効化スイッチで強制的に off にされた値ではありません。
監査のキーは `sensors`、`learnings`、`summary_confirmation` です。コマンドは `Source: command` を、その人が入力したスイッチは `Source: you` を記録します。
その人自身の選択を繰り返すコマンドは何もせず、`set by you` を保ちます。`intent-create --learnings off` のような作成時のフラグも `set by a command` を記録します。ただし、その人がチャットで要求と一緒にその設定を入力した場合（`/aidlc --learnings off <request>`、または作業が存在する前）は `set by you` を記録します。保存された上書きはインテントとともにコミットされ、セッションを越えて残ります。環境変数の無効化スイッチは、その保存された選択を上書きせずに優先します。手続きを off にしても、フックのアンインストールや削除、必須のステージゲートの削除、明示的に自律 Construction を選んだときに使うマージ前の 1 回のレビュアーの無効化は行いません。

summary confirmation を off にすると、その人の `Looks correct` チェックポイントがなくなるため、ガードの規則に従います。その人が `/aidlc config set summary-confirmation off` または `/aidlc --summary-confirmation off` を入力し、エージェントがその設定コマンドを実行します。説明の横に置いた場合（`/aidlc --summary-confirmation off build the export`）、フラグは新しい作業のものとなってその作成に付くため、すでに進行中の作業はチェックポイントを保ちます。その人が自分の言葉で頼んだ場合は、エージェントが設定コマンド（`config set`、`config-change`、`scope-change`）を実行します。その人が頼んだメッセージを名指さずに実行すると、次のように拒否します。

> Turning summary confirmation off skips the person's `Looks correct` check before a stage writes its output, so it is their call. Run it with --message <id>, the message they asked in, when they ask for it.

明示的な選択としてすでに保存された off は何もしません。スコープ由来の off（例: `off (from scope classic)`）でも、明示的なものとして保存すると後のスコープ変更より長く残るため、その人が必要です。`on` にすること、スコープ自身の既定値、作成時のフラグには、入力によるターンは不要です。コンポーザーが off にすることを提案した場合は、その人がそれを含む計画を承認した時点でその人のものとなり、コンダクターが自ら設定コマンドを実行します。ガードと同様に、`AIDLC_UNATTENDED=1` は変更を拒否し、その人なしに許可するのはフィクスチャやハーネス起動時の在席バイパスだけです。

設定コマンドは、深度、テスト戦略、レビュー、Guard Policy、ガードのスイッチと並べて、この同じ 3 つのキーを公開します。例えば次は、3 つの手続きと Guard Policy をまとめて設定します。

```
/aidlc config set guard-policy relaxed --sensors off --learnings on --summary-confirmation off
```

**環境変数による無効化スイッチ:**

| 環境変数 | 値が正確に `1` のとき `off` に強制する方針 |
|----------|---------------------------------------------------|
| `AIDLC_DISABLE_SENSORS` | Sensors |
| `AIDLC_DISABLE_LEARNINGS` | Learnings |
| `AIDLC_DISABLE_SUMMARY_CONFIRMATION` | Summary Confirmation |
| `AIDLC_DISABLE_PLAN_APPROVAL_GUARD` | Plan Approval（memory の Guard Policy strict のロックよりも優先） |

ほかの値では方針を強制的に off にしません。これらのスイッチは、ネイティブの config のバイパスの仕組みで明示的に記録することもできます。

```bash
aidlc config flags --bypass AIDLC_DISABLE_SENSORS --local --yes
aidlc config flags --bypass AIDLC_DISABLE_LEARNINGS --local --yes
aidlc config flags --bypass AIDLC_DISABLE_SUMMARY_CONFIRMATION --local --yes
aidlc config flags --show
```

記録したスイッチをプロジェクトで共有するには、`--local` の代わりに `--project` を使います。実際の環境変数は記録した config フラグより優先します。
スイッチを記録またはクリアしても変わるのはその設定ファイル（と、どう設定されたかについての AI-DLC の gitignore されたメモ `aidlc/.aidlc-sessions/recorded-switches.json`）だけで、ハーネスのファイルは更新しません。そのため、ワークフローの実行中でも使え、再起動なしに次の検査がそれを読みます。AI-DLC が管理する `.gitignore` ブロックにはすでに `aidlc.settings.local.json` が載っています。それより前のインストールでは、最初の `--local` の記録が、`.gitignore` を編集する代わりにクローン自身の `.git/info/exclude` でそのファイルを git から外します。どちらの設定ファイルもあなたのコードとは数えないため、Code Generation の途中で記録してもステージの完了は妨げられません。
コマンドは何も尋ねず（`--yes` は任意）、複数のハーネスを持つプロジェクトでも `--harness` は不要で、何を記録またはクリアしたかを、それを元に戻すコマンドとともに表示します。`--local`、`--project`、`--global` のいずれも指定しないと、`--bypass` は自分の `aidlc.settings.local.json` に記録され、自分の端末で入力した `--clear-bypass` はそのスイッチを記録しているすべてのファイルからクリアします。エージェントがチャットから実行した場合、同じクリアは設定コマンドと同じように検査を on に戻します（下記）。あなた自身のエントリはクリアされ、プロジェクトの共有の `aidlc.settings.json` とこのマシンのファイルは示されるだけで、変更されることはありません。いずれかのファイルが記録している間、スイッチは on です。無人実行（`AIDLC_UNATTENDED=1`）は、頼む人がいないため `--bypass` を記録しません。`--clear-bypass` は常に実行されます。エージェントがチャットで実行する場合、あなたから検査を取り上げる 9 つ（下記）のいずれかの `--bypass` は、検査を off にするすべての設定コマンドが従う規則により、あなたが頼んだときだけ記録されます。エージェントがあなたが頼んだメッセージを `--message <id>` で名指し、エンジンがそれを証明します。作業が存在する前も同じです。それ以外の場合は何も記録せず、それがあなたの判断であることを伝えます。たとえば「Turning the human presence check off is the person's call. Run it with --message <id>, the message they asked in, when they ask for it.」です。ほかのフラグも変えるコマンドも設定の変更であり、部分ごとに 1 行を出して同じように実行されます。ほかのリリースのファイルを取り込むコマンド（`--download`、または別のリリースに固定されたプロジェクトが先に必要とする更新）も同様です。

スイッチは、どのように設定されたか（このコマンド、端末、ファイルの編集）にかかわらず、記録された時点で有効になります。あなたから検査を取り上げる 9 つ（plan approval、review freeze、reviewer read scope、human presence、summary confirmation とその検査、ステージ出力の検査、改訂の安全網、パイプラインの引き継ぎの検査）は、常に伝えられます。エージェントが伝える次のステップには、その検査の名前、何のためのものか、いつからか、どう設定されたか、on に戻すかの提案を示す 1 行が付きます。例:

> The review freeze check (it stops edits to work you already approved) is off for this project since 10:42, because you said: "turn the review freeze check off for this project". Do you want it back on?

自分で検査を off にした直後は、決めたばかりのことを尋ねる代わりに、その行は戻し方を伝えます: 「You can turn it back on any time.」より広い場所で何かが変わる場合は、続けてその場所を一度だけ提案します。この作業の後には「Do you want it off for the whole project instead?」、このプロジェクトの後には「Do you want it off for this whole machine instead?」です。そこですでに off の検査を頼むと、そのことを同じ提案とともに伝えます。このマシン、プロジェクトのスイッチを持たない検査、Guard Policy には、より広い行き先がないため何も尋ねず、自分の端末で実行したコマンドにも何も尋ねません。この作業についての切り替えのあとも、あなたが自分でその作業の要約確認と学びのステップを off に保っている間は、何も尋ねません。これは、エージェントが「do not ask me anything」を記録する方法です。どちらかを on に戻すと、提案が戻ってきます。

エンジンがそれをチャットでのあなたのメッセージに結び付けられない場合、その行は検査が off であることと、いつからかだけを伝えます。検査が off の間は、新しいチャットのたびに同じ行で始まり（セッション開始時の文脈を表示しない opencode を除く）、`config flags --show` と doctor の Flags の行（警告で、doctor の終了コードは変えません）がそれを一覧します。その提案に自分の言葉で答えればエージェントがコマンドを実行します。環境変数がまだ検査を off にしていれば、コマンドがそう伝えます。チャットでの「はい」は、プロジェクトの共有の `aidlc.settings.json` やこのマシンの設定ファイルを決して変えません。そのため、どちらかがスイッチを記録している間は、その行は尋ねる代わりにそれを示して終わります。たとえば「The project's shared settings in aidlc.settings.json keep it off for everyone on this project. Changing that file changes it.」です。`--show` と doctor の行は、実行された場所でそれを行うコマンドを示します。自分の端末ではファイルを指定しないクリアを、それ以外（IDE のターミナルを含む）では、スイッチを記録しているファイルごとに `--local`、`--project`、`--global` を付けたクリアを 1 つずつ示します。スイッチはクリアされたが、開いている作業が自身の理由（スコープや Guard Policy）で検査を off に保っている場合、その行はそう伝え、その作業についても on にするかを提案します。例:

> The review freeze check (it stops edits to work you already approved) switch is cleared for this project, but it stays off for this piece of work: guard policy off (set by you). Do you want it on for this piece of work too?

逆に、スイッチがまだ検査を off にしている間に、この作業について検査を on に戻すと、そのためのあなた自身の `aidlc.settings.local.json` のエントリがクリアされ、その設定自身の行の代わりにその行がそう伝えます。例:

> The review freeze check (it stops edits to work you already approved) is back on: aidlc.settings.local.json had kept it off for this project, and that entry is cleared.

プロジェクトの共有の `aidlc.settings.json` とこのマシンの設定ファイルは、その要求からは変更されません。その行はファイルを示し、そのファイルを変えれば変わることを伝えます。例:

> The project's shared settings in aidlc.settings.json keep the review freeze check (it stops edits to work you already approved) off for everyone on this project. Changing that file changes it.

自分の端末では、その行は代わりにそれをクリアするコマンドを示し、エディターや CLI がその変数付きで起動された場合は、それなしで起動するよう伝えます。sensors と learnings も同じように表示され、チャットからのエージェントによるこのプロジェクトの `config flags --clear-bypass` も同様です。共有ファイルやこのマシンのファイルの変更を頼むと、エージェントは `--project` または `--global` でそこからクリアします。

`config get` は、スイッチがどこで検査を off にしているかを示します。設定ファイルが記録している場合は `off (AIDLC_DISABLE_REVIEW_FREEZE_HOOK in aidlc.settings.local.json)`、エディターや CLI がその変数付きで起動された場合は `off (env AIDLC_DISABLE_REVIEW_FREEZE_HOOK)` です。plan approval のロックアウト中は、直前の判断以降にあなたが発言していれば（無人実行からは決して通りません）エージェント自身の `config flags --bypass` が通り、`--clear-bypass` は常に通ります。

<a id="aidlc-plan-approval-plan-approval"></a>

#### `/aidlc --plan-approval` — 計画承認

アクティブなインテントについて、コード生成がビルドする前に各コード計画を承認のために示すかどうかを設定します。

```
/aidlc --plan-approval off
/aidlc config set plan-approval on
```

| フラグ / config キー | 状態とステータスの行 | `off` で省くもの |
|-------------------|----------------------|------------------|
| `--plan-approval` / `plan-approval`（`guard.plan-approval` も） | Plan Approval | Plan Approval の質問。計画が書かれると、その人はそれを示す 1 行を聞き、ビルドが始まる。`PLAN_APPROVAL_SKIPPED` 行がビルドしたフィンガープリントを記録する |

express と poc はこれを off で、ほかのすべての出荷スコープは on で出荷します。
優先順位はほかの手続きと同じですが、1 つ追加があります。memory の `## Guard Policy` セクションが `Mode: strict` を保持していると、スコープやインテントが off と言っていても on に保ちます。そして `AIDLC_DISABLE_PLAN_APPROVAL_GUARD=1` はマシン上でそれを off にし、その memory のロックより優先します。この変数が有効になるのは、ハーネスのセッションがそれ付きで始まったとき、`config flags --bypass` で記録されたとき、またはプロジェクトにハーネスのセッションが記録されていないときだけです。セッション内の 1 つのコマンドにインラインで設定した場合は無視されます。その場合、status は例えば `Plan Approval: on (guard policy strict (from project.md))`、セッションがそれ付きで始まった場合は `Plan Approval: off (from env AIDLC_DISABLE_PLAN_APPROVAL_GUARD)`、`config flags --bypass` が記録した場合は `Plan Approval: off (from AIDLC_DISABLE_PLAN_APPROVAL_GUARD in aidlc.settings.local.json)` と表示します。

これはその人の判断です。その人が `/aidlc --plan-approval off` または `/aidlc config set plan-approval off` を入力する（エージェントが設定コマンドを実行します）か、自分の言葉で伝える（「skip plan approval for this work」）と、エージェントが設定コマンドを実行します。その人が頼んだメッセージを名指さずに設定コマンドを実行すると、次のように拒否します。

> Turning plan approval off lets code generation start without the person approving the plan, so it is their call. Run it with --message <id>, the message they asked in, when they ask for it.

memory が strict を保持している場合、拒否は代わりに memory ファイルを示します。作業が存在する前（compose ゲートやスコープ確認の時点）に言った場合、その人の言葉はその要求への回答になります。そのための `intent create --request <id>` は、フラグの有無にかかわらず `Plan Approval: off (set by you)` を記録し、そのチャットでの次の作成は、何を作るかにかかわらずその言葉を使い切ります。そのようなターンのないフラグや、別の要求を名指すか何も名指さない作成は、拒否されるかスコープの値を保ちます。`on` にするのに入力によるターンは不要です。スコープ変更は、スコープ由来の値をどちらの向きにも新しいスコープの既定値へ移し、このインテントについて設定した値は保ちます。
`guard.plan-approval` は同じ設定を指すため、`/aidlc config set guard.plan-approval off` は `Guards Off` のエントリではなく `Plan Approval` の行を書きます。off の間に計画の確認を頼むと、設定を変えずにその計画 1 つを承認のために示します。全体の動きは [Plan approval](13-customization.md#plan-approval) を参照してください。

---

### `/aidlc --statusline <on|off>` - AI-DLC's status line

Claude Code と Codex CLI で、ターミナル下部のステータスラインに AI-DLC の進捗を表示する、または自分で設定したステータスラインに戻します。`aidlc config --statusline <on|off>` を実行し、何も尋ねず、何が変わったかと戻し方を伝える 1 行を表示します。作業の状態は何も動きません。

- **Claude Code:** あなた自身の選択です。AI-DLC のステータスラインは、あなた自身の `.claude/settings.local.json`（git が無視する）に入る、またはそこから出るので、チームメイトには影響しません。そのファイルにあるあなたのステータスラインは、AI-DLC のものをオフにすると戻ります。
- **Codex CLI:** プロジェクトの選択です。Codex にはプロジェクト内の個人用設定ファイルがないためです。共有の `.codex/config.toml` にある AI-DLC の `status_line` 行だけを追加または削除し、これはプロジェクトで作業する全員に効きます。各自は代わりに Codex の `/statusline` で自分のステータスラインにタスク進捗を加えられます。

初回セットアップも同じ質問を一度だけ尋ねます。何も尋ねないセットアップはステータスラインを追加しません。[ステータスライン](13-customization.md#status-line-claude-code-and-codex) を参照してください。

```
/aidlc --statusline off
aidlc config --statusline on
```

ほかのハーネスでは、そのツールにステータスラインがないことと、`/aidlc --status` で作業の状況を確認できることを伝えます。

---

### `/aidlc --version` — Framework version

フレームワークの版（`aidlc <X.Y.Z>`）を出して終了します。読み取り専用で、ワークフローなしで動き、再開を促すことはありません。

**構文:**

```
/aidlc --version
```

---

### `/aidlc --help` — Usage information

使えるコマンドとフラグの要約を出します。

**構文:**

```
/aidlc --help
```

---

## 決定論的 CLI ツール

ネイティブのディスパッチャーは、利用者の操作向けに安定した公開経路を提供します。版付きのリリースランタイムはその経路を使います。手元で生成したソース投影は、同じ操作をハーネスディレクトリの下の Bun/TypeScript ツールで実装します。公開経路のない内部処理には、直接のツール呼び出しが引き続き役立ちます。以下に経路が記載されている場合は `aidlc` を優先してください。

### 以前の質問と監査タイムラインを読む

エージェントはこれらのコマンドで、以前の回答とタイムラインを読みます。ワークフローを調べるために実行することもできますが、すべての `aidlc engine` の経路と同じく、これはハーネスの機構であり、自分のスクリプトのための安定したインターフェースではありません。

```bash
aidlc engine log answers --stage requirements-analysis
aidlc engine audit history
```

`log answers` は、対になった回答、開いている質問、まれな曖昧な回答（前に質問がないもの、または 2 つの書き手が同じ 1 秒で並んだもの）を持つ JSON を返します。1 つの返答は、それが答えたメニューについて記録されたすべての質問を閉じます。`audit history` は、イベントと自由形式のメモの JSON タイムラインを返します。

シェルが解釈する文字（`$`、バッククォート、引用符、`%`、`&`、`|`、`<`、`>`、`^`、`!`、改行）を含む回答は、コマンドラインではなくファイル経由で `log answer` に届きます。エージェントはそれを `<record>/.aidlc-engine/answer-text/answer.txt` に書き、`--details-file .aidlc-engine/answer-text/answer.txt` を渡します。同じファイルをプロジェクトフォルダから、またはフルパスで指定しても読まれます。エンジンはそのフォルダだけを、リンクを経由せず、64 KiB まで読み、読んだらファイルを削除します。`log decision` は同じように `--decision-file` で質問を受け取り、`learnings surface` は `--correction-file` で訂正を受け取ります。

通常の `log answer` には、まだどの判断にも使われていない、このチャットでのその人の返答が必要です。質問が記録される前に送られたものでも、後に送られたものでも構いません。それがどの質問に答えているかは、エージェントの読み取りです。選択肢のある質問では、`--details` はエージェントが返答から読み取った選択肢で、フックがその人の言葉を保持していない場合や、返答が複数の質問に答えている場合は、その人の返答そのものです。回答の行は、そうした返答それぞれの言葉（Person Reply）を保ちます。ただし、以前の回答がすでに記録した返答は、それが最新で、かつ質問がそれより前に記録された場合を除いて保ちません。さらに最新の返答を名指し（Message Id）、複数あるときはそのすべてを古い順に名指します（Message Ids）。エンジンがチャットを名指せないときは、返答したチャットが 1 つなら id だけを保ち、複数ならどちらも保たず、いずれの場合も回答を記録します。`log decision --message <id>` と `log answer --message <id>` は、代わりに 1 つのメッセージを名指します。たとえば、エンジンの別の質問が開いている間に送られたメッセージです。エンジンは、その記録が存在し、このチャットを通じて届いたか別のチャットでこの作業について送られたものであり、後の承認や判断で使われていないことを確かめ、その言葉は何も読みません。id はエンジンからエージェントへのテキストで、その人に示されることはありません。
対応付けの規則、順序、フィルターは [Hooks and Tools](../reference/06-hooks-and-tools.md#read-only-audit-commands) を参照してください。

### `aidlc engine bolt set-autonomy` — Constructionの承認

Construction 中に、自動で続けるか、チェックポイントごとに確認するかを明示的に頼みます。コンダクターは **Continue automatically** を `autonomous`、**Review each checkpoint** を `gated` として記録します。

```bash
aidlc engine bolt set-autonomy --mode autonomous --message <id>
aidlc engine bolt set-autonomy --mode gated
```

どちらも `Construction Autonomy Mode` を更新し、`AUTONOMY_MODE_SET` を出します。自律を許可するには、それを選んだその人のメッセージの id である `--message <id>` が必要で、許可はそのメッセージを使い切ります。同じメッセージ内の承認（「approve the plan, and run Construction on its own from here」）、またはそのメッセージでエージェント自身の質問に答えた回答は、それを有効なまま残します。取消にはメッセージは不要です。新しいチェックポイント方式のワークフローは、skeleton-off では Construction の開始時に、skeleton-on では最初の動作する統合 Unit がスケルトンのチェックポイントを通過した後に、この選択を提示します。記録済みの選択は再び尋ねず、必要に応じた変更は引き続き有効です。

自律が制御するのは通常の完了の承認です。計画承認がオンの間、すべての Unit には引き続き Plan Approval が必要で（オフの場合、各 Unit の計画は 1 行を伝えた後にビルドされ、スキップとして記録されます）、検証コマンドの選択とスケルトンのチェックポイントの承認には常に人間が必要です。生成前の要約確認に人間が必要なのは `directive.ceremony.summary_confirmation === "on"` のときだけです。失敗すると停止します。`Construction Checkpoints` を持たない既存のワークフローは、旧来の最初のステージと後のステージの承認を維持し、チーム所有の Unit のゲートは独自の方針を維持します。

### チェックポイント検証のタイムアウト

`aidlc engine bolt checkpoint --unit <unit> --kind unit --action verify` は、承認されたプロジェクトの検査を、既定の上限 30 分で実行します。より長い検査には `--timeout-ms 3600000`（1 時間）を加えます。値は 1 から 2,147,483,647 ミリ秒までの整数でなければならず、`--action verify` と一緒の場合だけ受け付けます。証拠の更新のための再試行を含め、各実行がその予算を使います。

タイムアウトすると、失敗した検証を記録する前に、所有するプロセスグループ（POSIX）またはプロセスツリー（Windows）を終了させ、終了を確認できない場合は後片付けが不完全であることを報告します。POSIX では、SIGINT、SIGTERM、SIGHUP で検証を止めると、そのシグナルを所有するグループへ転送します。それを無視するプロセスは、短い猶予期間のあとに kill されます。後片付けには最大 4 秒かかることがあります。所有する POSIX グループの中の監視プロセスは、転送できない SIGKILL で検証プロセスが kill された場合にも、そのグループを終了させます。中断された検証プロセスが合格の証明を記録することはできません。強制終了は、開始した証明を未完了かつ未検証のまま残します。独立して切り離された POSIX プロセスは、そのグループの外です。

<a id="construction-order-and-execution"></a>

### Constructionの順序と実行方式

Unit の分解をスコープに含む、ソースを生成する新しいソロの Unit ワークフローは、`Construction Checkpoints: enabled`、`Construction Iteration: unit-major`、`Construction Execution: serial` を記録します。1 つの Unit が適用対象の設計ステージと Code Generation を通り終えてから、次の Unit に進みます。設計のみのワークフローと Unit のないワークフローは従来のステージの流れを維持し、チーム所有の Unit は独自のゲートのリズムを維持します。既存のワークフローと明示的な反復の選択は保持されます。swarm 実行を明示的に選ぶには、先に stage-major を選びます。

```bash
aidlc engine state set-construction-iteration stage-major
aidlc engine state set-construction-execution swarm
```

既存のワークフローを検証済みのチェックポイントに切り替えるには、できれば Unit の作業が始まる前に `aidlc engine state set-construction-checkpoints enabled` を使います。`disabled` は旧来のチェックポイントの流れを維持します。これらの型付きの設定コマンドはランタイムの設定を更新します。汎用の `state set` は `Construction Checkpoints`、`Construction Execution`、`Construction Iteration`、`Construction Verification Command` を拒否するため、それぞれ `set-construction-checkpoints`、`set-construction-execution`、`set-construction-iteration`、レシートに結び付いた `set-construction-verification-command` を使ってください。
Construction 中は、これらのどれでも自分の言葉で変えられます（「turn checkpoints off」「from here on, build one unit at a time」「run the Units in parallel」）。エージェントはそのターンのうちに、先に質問することなく変更し、何が変わったかと元に戻せることを 1 行で伝えます。例: 「Construction checkpoints (a stop after each Unit for you to check and approve it) are off for this work now (they were on). You can switch back any time.」 変更は、あなたの言葉とともに `CONSTRUCTION_POLICY_SET` として記録されます。
設定コマンドが変更を行うのは、エージェントがあなたが頼んだメッセージを名指した場合（`<value> --message <id>`。`config set` と同じように証明されます）か、エージェントが変更を提案したときにあなたがその変更を選んだ場合だけなので、エージェントが自分からこれらを変えることはできず、無人実行がこれらを変えることもありません。先に別の変更が必要な変更（並列の Unit には stage-major とチェックポイントの on が必要）は両方を行い、両方を伝えます。

ステージの途中で `unit-major` に切り替えたり、チェックポイントを on にしたりしても、すでに完了した Unit は保たれます。`/aidlc` はまだ作業が残っている次の Unit から続け、変更は `CONSTRUCTION_POLICY_SET` として記録されます。逆方向、つまりチェックポイントを off にした `stage-major` へ移る場合（反復を元に戻す、または stage-major のままチェックポイントを off にする）も、それらは保たれます。切り替えの前に開き直した Unit（後ろへのジャンプ、Redo、チェックポイントの Request Changes）は、引き続きやり直しを受け、完了したらそれを保ちます。

並行ビルドの準備をした後に直列へ切り替えても（たとえば並行の開始が止まった後の「build them one at a time instead」）、承認した計画は保たれます。各 Unit は、新しい計画の質問なしに、プロジェクト自体の中でその計画からビルドされます。そのビルドが準備した worktree はその場に残り、その Bolt は閉じたものとして記録されます。

実行方式は承認とは別です。swarm は、ガイド付き（`gated`）と自動（`autonomous`）のどちらの完了でも動きます。unit-major は直列のままで、矛盾する swarm の設定を拒否します。unit-major に戻す前に `aidlc engine state set-construction-execution serial` を実行してください。既存の明示的な選択は保持してください。実行方式のフィールドを持たないワークフローは、旧来の自律方針に基づく swarm のルーティングを維持します。

実在する空でない Unit DAG と、ソースを生成するステージを含むチェックポイント対応のソロ作業では、skeleton-on は、stage-major を選んでいても、後続の Unit より前に、最初の DAG Unit を最小の動作する統合スライスとして必ずビルドします。最初の設計ステージのレビューだけでは、動作するスケルトンの証明になりません。すでに承認されたインラインの Unit は、後の swarm のバッチから除外されます。

<a id="aidlc-engine-swarm-prepare-prepare-a-reproducible-batch"></a>

### `aidlc engine swarm prepare` — 再現可能なバッチ

保護された Code Generation の最初の prepare の前に、すでに承認された親のアプリケーションソースをコミットし、選択したベースから再現できるようにします。これには、並列バッチに切り替える前の、承認済みのインラインのスケルトンのソースも含みます。Git が無視していて追跡していないファイル（`.env` やログなど）は、`.aidlc-source-paths.json` でソースとして登録していない限り、これに含まれません。それらはその場に残り、Unit の worktree には、ほかのどの Git チェックアウトとも同じく、それらがありません。この規則は、旧来の自律方式と新しいチェックポイント方式のワークフローの両方に適用されます。自律の許可が自動コミットを認可することはありません。

```bash
aidlc engine swarm prepare --batch <N> --units "<exact emitted Units>"
```

ツールは子の worktree を作る前に、すべての Unit について読み取り専用のソース／承認の事前確認を行います。ソースが未コミットなら、コミットして再試行する指示を返し、その拒否によって子が残ることはありません。明示的な認可がある場合にだけコミットし、現在の承認の証拠で再試行してください。アプリケーションのソースや計画が変わった場合は、必要な Plan Approval を提示し直してください。この要件が対象とするのはアプリケーションのソースであり、無関係なフレームワークの記録やほかのファイルを一括でコミットすることではありません。

<a id="construction-verification-command-record-human-authorization"></a>

### 検証コマンドの許可と記録

チェックポイント対応の作業では、Delivery Planning がプロジェクトのスキャンから `bun test`、`pytest`、`make check` のような実際のプロジェクトの検査を提案します。構造化された **Approve** / **Request Changes** の質問は **Use this command to verify each completed Unit?** と尋ねます。コマンドを示す前に、ハーネスのファイル書込みツール（Write/edit）で UTF-8 テキストとして `<record>/verification-command.txt` に書きます。シェルの `echo` や heredoc は決して使いません。リポジトリ由来のコマンド文字列をシェルの行に埋め込んではいけません。シェルの置換が承認前に実行されるおそれがあるためです。レコード相対のパスだけを渡します。コマンドは自分が実行されているセッションを自分で見つけます。

```bash
aidlc engine log decision --stage "<directive.stage>" --checkpoint verification-command --command-file verification-command.txt --decision "Use this command to verify each completed Unit?" --options "Approve,Request Changes"
```
`decision` ツールの JSON 出力の `command` フィールドから、正規化されたコマンド全体をそのまま質問のコードスパンに写します。要約、接頭辞、ダイジェストで省略したり置き換えたりしてはいけません。コマンド内のバッククォートを保てるだけの長さのコードスパンの区切りを使います。人間は `<record>/verification-command.txt` を開いて見ることもできます。

人間の **Approve** / **Request Changes** の返答を、そのチャットで、またはそれが最新の質問である間は新しいチャットで待ちます。レシートを認可するのは **Approve** だけです。無関係な返答、**Request Changes**、別の質問への返答は認可しません。人間が選んでいない限り `--details "Approve"` を書いてはいけません。その後でのみ、次を実行します。

```bash
aidlc engine log answer --stage "<directive.stage>" --checkpoint verification-command --command-file verification-command.txt --details "Approve"
aidlc engine state set-construction-verification-command --command-file verification-command.txt
```

これらは `aidlc-log` の decision/answer のチェックポイント形式です。どちらも同じ `--stage`、`--checkpoint verification-command`、正規化されたコマンドを必要とします。それぞれ自分が実行されているセッションを見つけ、`--session <id>` がそれを上書きするのは、どのセッションか判断できないと報告したときだけです。それぞれ `--command-file <path>` と `--command` のちょうど一方を受け付け、両方またはどちらもない場合は拒否します。コンダクターのシェル呼び出しにはファイル形式を使ってください。直接の引数が安全なのは、シェルの補間なしに渡す場合だけです。ファイルは作業の記録の中にある通常ファイルで、記録から（`verification-command.txt`）、プロジェクトフォルダから（`aidlc/spaces/<space>/intents/<intent>/verification-command.txt`、スラッシュはどちら向きでも可）、またはフルパスで指定します。記録の外の名前、`..` の部分、経路上のシンボリックリンクは拒否され、ファイルは 16 KiB 以下です。ファイルは UTF-8 としてデコードされ、直接の引数とまったく同じように正規化されます。
前後の空白は、記録、ハッシュ、実行の前に取り除かれます。結果のコマンドは、空白でなく、1024 文字以内の 1 行でなければなりません。ツールは制御文字（改行、CR、タブ、NUL を含む）と、表示を偽る文字（ゼロ幅や双方向制御を含む Unicode の書式文字、行／段落区切り、ノーブレークスペース（U+00A0））を拒否します。複数行の検査はスクリプトにまとめ、その呼び出しを記録してください。
`decision` は `Checkpoint: Construction Verification Command` と `Command SHA-256` を持つ `DECISION_RECORDED` を記録します。その JSON 出力には、`challengeId` と `challengeFile` と並んで、正規化されたコマンド全体の `command` と `command_sha256` が含まれます。`answer` も `command_sha256` を出します。`answer` は、一致する保留中の decision と、その人がそのコマンドとセッションの現在のチャレンジに返答したという human-turn フックの記録を必要とします。`AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1` でも同じです。`--details` はエージェントがその人の返答から読み取った選択を示し、レシートはその人の正確な言葉を持ちます。後の `HUMAN_TURN` だけでは不十分です。新しい decision を記録すると、そのセッションの以前のチャレンジと返答が置き換わります。成功した answer は、両方を消費する前に監査イベントを追記します。追記に失敗した場合、同じ返答は再試行できます。古い、一致しない、すでに消費された返答は拒否します。
承認する返答（エージェントがその人の返答を読んで `--details "Approve"` を渡します。単なる数字や別の語は、どの選択も示さないものとして拒否されます）は、ツールが所有する `VERIFICATION_COMMAND_RECORDED` レシートを出します。変更を求める返答は `QUESTION_ANSWERED` だけを記録し、状態を設定せずに別のコマンドを提案することを意味します。どちらも選ばない返答は、尋ねるべき 1 つの追加の質問とともに拒否します。レシートは、ステージ、チェックポイント、セッション、その正規化されたコマンドの SHA-256、`Command Label` としての正規化されたコマンド全体（決して切り詰めない）、人間の正確な選択を持ちます。
`aidlc-audit append` はこの予約されたレシートを作れません。

型付きの設定コマンドは `--command-file <path>`（同じ方法で指定）か 1 つの位置引数のコマンドを受け付け、両方は受け付けません。最新の現在のワークフローの承認レシートがそのダイジェストに一致する場合にだけ、`aidlc-state.md` の `## Runtime State` の下に `- **Construction Verification Command**: <cmd>` を書きます。その JSON 出力には、`command_label`（正規化されたコマンド全体）と `command_sha256` が含まれます。追加の人間のターンは求めません。実行を認可するのは状態フィールドではなくレシートです。検証も同じ結び付きを確認します。古いワークフローや隔離されたステージのレシートはそれを認可せず、別のコマンドに対する後のレシートは以前のものに取って代わります。一致するレシートのないフィールドや、一致するフィールドのないレシートは、認可になりません。このフィールドを直接、または汎用の `state set` で書かないでください。

記録されたコマンドは、このインテントのすべての Unit／バッチのチェックポイントで再利用されます。選択と後の変更には、自律的な完了のもとでも、常にこの decision/answer/設定コマンドの流れが必要です。実行できる検査がまだない場合（greenfield）、人間は Delivery Planning の間に先送りできます。フィールドは未設定のままにし、最初のチェックポイントが尋ねます。仮のコマンドを作ったり自動承認したりしてはいけません。

<a id="aidlc-engine-bolt-checkpoint-verify-and-approve-a-completed-unit"></a>

### `aidlc engine bolt checkpoint` — Unitの検証と判断

エンジンが Unit とチェックポイントの種類（`unit` または `skeleton`）を示します。本体、レビュー、レシートはすでに存在するので、作り直すのではなくチェックポイントに従います。
Unit のコードや文書がレビュー後に変わった場合、チェックポイントの `rereview` が 1 つの再確認の要求を示し、エージェントは検証の前にそれを実行します。これが起きるのは Guard Policy が `strict` のときです。`relaxed` と `off` では代わりに変更が受け入れられ、承認済みの Unit は承認されたままで、`verify` はその 1 行を `change_notices` として返します。レビューが off の場合も同じで、次の Unit の `verify`、または Construction ステージ自身の検査がその行を返します。Unit 自身のレビューが完了していない場合（まだ判定がない、またはパスが残っている NOT-READY）、`rereview` は `unfinished` を持ち、それを完了させる要求を示します。その人がその Unit をそのまま承認するよう言った場合は、`verify` に `--over-unfinished-review --message <id>` を付けます。`<id>` はその人がそう言ったメッセージです。Guard Policy が `off`、`relaxed`、またはこの作業に設定された `strict` で、そのメッセージが証明され、レビューが求められていた場合、Unit は検証され、その人の言葉がその承認になります（`review_not_finished.approved_in_words`: `approve` はそれ以上何も尋ねません）。ステージのゲートと同じく、レビューが完了していないこととともに記録されます。そのレビューの判定が後から届いた場合は記録され、Unit は承認されたままです。チームでロックされた `strict` では、その人に尋ねることなく、先にレビューが完了します。再試行したレビューがそれでも完全なレビューを書かなかったときにコンダクターが記録する NOT-READY のフォールバックでレビューが終わった Unit は、1 回尋ねられ（`review_not_finished.question`）、同じように承認されます。見送る選択肢はありません。この Unit の作業の今回の実行で一度も求められていない Unit のレビュー（後ろへのジャンプや開き直しの後は、それ以前のレビューは数えません）は、どの Guard Policy でも必須です。`rereview` は `first` を持ち、その実行の最初の要求を示します。

```bash
aidlc engine bolt checkpoint --action status --unit "<Unit>" --kind <unit|skeleton>
aidlc engine bolt checkpoint --action verify --unit "<unit>" --kind <unit|skeleton>
aidlc engine bolt checkpoint --action verify --unit "<unit>" --kind <unit|skeleton> --over-unfinished-review --message <id>
```

検証は、記録された、人間が認可した `Construction Verification Command` を実行し、現在の成果物、ソース、試行に結び付いた証明を保存します。コマンドの引数は受け付けません。`construction_checkpoint.command_authorized` が false なら `verify` を実行せず、[記録済みコマンドの流れ](#construction-verification-command-record-human-authorization) を完了してから、`next` を再実行してください。スケルトンのコマンドは、統合スライスをエンドツーエンドで証明し、通常の Unit の動作結果を確認しなければなりません。承認には現在の検証済みの証明が必要です。人間への承認の質問には「Verified with `<full command>` (exit 0)」を示し、現在のツール出力の `verification_command` 全体を省略せずにコードスパンへ写します。この表示ラベルは接頭辞ではなく、正規化されたコマンド全体です。`verify` が `verified: true` を報告し、現在のチェックポイントが `ready: true` になった後でのみ `ask` を実行します。準備ができていない、または検証されていないチェックポイントは拒否します。**Approve** / **Request Changes** を示す前に、現在の Unit、種類、フィンガープリント、検証の証明 ID、認可されたコマンドのダイジェストについての 1 回限りの質問を開きます。各 `checkpoint` のアクションは、自分が実行されているセッションを自分で見つけます。`--session <id>` がそれを上書きするのは、どのセッションか判断できないと報告したときだけです。

```bash
aidlc engine bolt checkpoint --action ask --unit "<unit>" --kind <unit|skeleton>
```

`ask` が `earlier_reply` を返す場合、その人は Unit のレビューの実行中に、そのセッションですでに答えています。レビューが求められた後、ほかの質問（学びの質問など）が尋ねられる前に入力されたその人の言葉が、この質問への返答です。
それを読み、質問を示さずに、その人が選んだアクションを実行します。何も答えていない場合は、以下のとおり質問を示して待ちます。`ask` が `left_out`（その人が Unit のビルドから外すよう頼んだもの）を返す場合は、質問の直前にそれを伝えます。例: 「Left out of this build: AC2.1.1 and AC2.2.1.」
その人が持ち込んだファイルのうち Unit のビルドが変更または削除したもの `changed_files` も、戻し方とともに同様に伝えます: 「The build changed README.md, a file you had before this work started. To put it back, run `git checkout HEAD -- README.md`.」
ステージのレビューのパスを使い切り、レビュー済みの作業が最後のレビューの後に変わった場合の `check_offer` も同様です: 「Do you want me to have the new approach checked before you decide?」

このチェックポイントの質問に対する人間の **Approve** / **Request Changes** の返答を、そのチャットまたは新しいチャットで待ちます。新しいチャットに自身の質問がない場合、その返答は、別のチャットが尋ねたチェックポイントの質問が最新の質問としてまだ開いている間、その質問のために保持されます。それが認可するのは一致するアクションだけです。無関係な返答、エージェント自身の言葉、別の質問への返答は認可しません。人間が選んでいない `--user-input` を渡してはいけません。その人が選んだアクションだけを実行します。

```bash
# Only after the human chose Approve:
aidlc engine bolt checkpoint --action approve --unit "<unit>" --kind <unit|skeleton> --user-input 'Approve'
# Only after the human chose Request Changes and supplied feedback:
aidlc engine bolt checkpoint --action reject --unit "<unit>" --kind <unit|skeleton> --user-input 'Request Changes' --reason '<human feedback>'
```

その人が判断の中で、レビューの所見を直すよう頼んだり、所見を却下したりしたときは、ステージのゲートと同じく、所見ごとに 1 回、承認には `--fix-finding "<review-artifact>#R-NN"` を、却下には `--reject-finding "<review-artifact>#R-NN=<their reason>"` を加えます（レビュアーが直したと印を付けたものの、その人が直っていないと言う所見には `--reopen-finding`）。

その人がエンジンの別の質問が画面にある間に答えた場合（その人の言葉はそちら、たとえば新しい作業の提案に属します）、その返答はチェックポイントのために保持されません。拒否がそのメッセージを示し、approve や reject に `--message <id>` を付けると、それをその人の返答として記録します。アクションは返答を消費します。`verify` を再実行すると、このインテントについて、どのセッションのものであっても、開いているチェックポイントの質問と取得したチェックポイントの返答がすべて撤回されます。新しい検証が `verified: true` を報告した後でのみ、再び尋ねてください。古い証明への返答は、フィンガープリントとコマンドが変わっていなくても、新しい証明を承認できません。`human_required: false` の検証済みの通常の Unit は、`--user-input` なしで承認され、`ask` も不要です。人間による却下には、常に上記の検証済みの質問と回答の流れが必要です。スケルトンには常に人間が必要です。欠けている、または古い証拠は `errors` で説明されます。必要に応じて人間に相談しながら、示されたレビュー／レシートを修復してください。検証を作り出したり、チェックポイントの承認の質問を早く開いたりしてはいけません。検証、承認、却下の後は `next` を再実行し、1 つの Unit のチェックポイントを Code Generation ステージ全体の承認として報告してはいけません。
検証器は証明ファイルと並んで、ツールが所有する `CHECKPOINT_VERIFICATION_RECORDED` レシートを記録し、承認にはそのレシートが必要です。手書きの証明ファイルで Unit を検証することはできません。証明ファイルがまったくないチェックアウト（新しいクローン、別のマシン）では、そのレシートが、証拠が変わっていないすでに承認済みの Unit の証明の代わりになるため、何も再実行されません。

1 つのセッションで開ける保護された質問は 1 つだけです。保護された質問は 1 つずつ尋ね、ほかのことをする前に回答を待ってください。

バージョン 4 の証明と CLI の JSON は、`command_sha256` と `command_label` の正規化されたコマンド全体に加えて、終了ステータス、取得した stdout/stderr 全体のバイト数と SHA-256 ダイジェスト、`stdout_tail` と `stderr_tail` の各ストリームの最後の 2 KiB を保持します。末尾は、先頭の不完全なマルチバイト列を取り除いてから UTF-8 としてデコードし、改行とタブ以外の制御文字は U+FFFD に置き換えます。出力全体は保持しません。検査はそれをメモリではなく一時ファイルに書くため、長時間実行されるテストスイートの出力が、合格した検査を失敗させることはありません。
実行中に Unit のファイルを変える検査（フォーマッター、ジェネレーター）は、そのときのファイルに対してもう一度実行されます。再び変えた場合、証明の `error` は、ファイルをそのまま残す検査を使うよう伝えます。プロジェクトの検査コマンドは秘密を出力してはいけません。これらの診断用の末尾は秘密を伏せていないためです。承認は `GATE_APPROVED` の `Verification Command SHA-256` を証明の `command_sha256` に結び付けます。以前の認可済みコマンドのもとで承認された Unit は、その人が新しいコマンドを承認しても承認を保ちます。新しいコマンドはまだ承認されていない Unit を検証し、設定コマンドは `notice` として `Using <command> from here on.` の行を返します。
失敗の説明には末尾を使ってください。さらに診断が必要な場合は、新しく選んだコマンドではなく、同じ認可済みのプロジェクトの検査を使ってください。バージョン 1〜3 の証明はアップグレード後に未検証として扱われます。承認の前に、記録されたコマンドを認可し、`checkpoint --action verify` を再び実行してください。

### `aidlc engine swarm check` / `finalize` — worktreeの検証

どちらのコマンドも、Construction Checkpoints の有無にかかわらず、準備した各 Unit の worktree で、インテントの記録された、人間が認可した Construction Verification Command を実行します。

```bash
aidlc engine swarm check <Unit> [--test-file <protected spec>] [--show-output]
aidlc engine swarm finalize --batch <N> --units "<all Units>" --claimed "<converged Units>"
```

`--check-cmd` は、チェックポイントの有無にかかわらず任意です。指定した場合、その正規化されたダイジェストが認可されたコマンドと一致しなければなりません。認可がない場合は実行を拒否します。合格するコマンドで代用するのではなく、[記録済みコマンドの流れ](#construction-verification-command-record-human-authorization) と `set-construction-verification-command` を完了してください。ワークフローがなければ、どちらのコマンドも拒否します。`check --show-output` は、実行中のコマンド自身の出力を stderr に送ります。stdout には判定の 1 行が残ります。並行ビルドでは、各ワーカーのブリーフと各レビュアーのレビュー依頼（`test_command`）が、プロジェクトのメインフォルダから実行する `check <Unit> --show-output` を示すので、あなたが承認したテストは AI-DLC 自身のコマンドを通して実行されます。`check` は助言用です。`finalize` はコマンドを再実行し、クレームされた各 Unit をマージする前にレビューの証拠を検証します。`finalize` を再実行すると、このインテントについて、どのセッションのものであっても、開いているチェックポイントの質問と取得したチェックポイントの返答がすべて撤回されます。新しい検証、ソースの取り込み、`ready: true` のバッチの状態の後でのみ、再び尋ねてください。検証済みのネイティブの合格だけが、認可された `Command SHA-256` とともに `SWARM_UNIT_CONVERGED` を受け取ります（以前のリリースの行にはそれがないことがあります）。`next` の前に、ネイティブの worktree のマージでそのソースを取り込みます。
バッチのビルド中にその人がメインのチェックアウトに加えた編集は、Guard Policy が strict のもとではそのマージを止めます（拒否はステップを示します。編集を元に戻してマージを再実行するか、保つなら `guard policy relaxed` と言います）。relaxed や off のもとでは編集は保たれ、`CHANGE_ACCEPTED`（`swarm-batch`）として 1 回記録され、マージは `note:` の行を 1 つ出します。ステージの完了時に、最後のマージの後で加えられた編集についても同じです。

### `aidlc engine bolt swarm-checkpoint` — バッチの判断

swarm のバッチが落ち着いた後、別のバッチが始まる前に、エンジンが `swarm_checkpoint` を返すことがあります。そのバッチ番号と Unit の一覧をそのまま使います。

```bash
aidlc engine bolt swarm-checkpoint --action status --batch <N> --units "<comma-separated Units>"
```

status が `ready: true` を報告した後でのみ、`swarm-checkpoint --action ask` を実行します。準備のできていないバッチは拒否します。**Approve** / **Request Changes** を示す前に、現在のバッチ、正確な Unit の集合、フィンガープリント、Unit ごとの `Command SHA-256` の集合についての 1 回限りの質問を開きます。`checkpoint` と同じく自分のセッションを見つけ、`--session <id>` は上書きにすぎません。

```bash
aidlc engine bolt swarm-checkpoint --action ask --batch <N> --units "<Units>"
```
承認の質問には「Verified with `<full command>` (exit 0)」を示します。検証コマンドのツール出力から、正規化された `command` 全体を省略せずにコードスパンへ写し、バッククォートはより長い区切りで保ちます。

このチェックポイントの質問に対する人間の **Approve** / **Request Changes** の返答を、そのチャットまたは新しいチャットで待ちます。新しいチャットに自身の質問がない場合、その返答は、別のチャットが尋ねたチェックポイントの質問が最新の質問としてまだ開いている間、その質問のために保持されます。それが認可するのは一致するアクションだけです。無関係な返答、エージェント自身の言葉、別の質問への返答は認可しません。人間が選んでいない `--user-input` を渡してはいけません。その人が選んだアクションだけを実行します。

```bash
# Only after the human chose Approve:
aidlc engine bolt swarm-checkpoint --action approve --batch <N> --units "<Units>" --user-input 'Approve'
# Only after the human chose Request Changes and supplied feedback:
aidlc engine bolt swarm-checkpoint --action reject --batch <N> --units "<Units>" --user-input 'Request Changes' --reason '<human feedback>'
```

所見のフラグ（`--fix-finding`、`--reject-finding`、`--reopen-finding`）は、Unit のチェックポイントと同じように動きます。バッチの却下は、それらを各 Unit の行に記録します。

アクションは返答を消費します。変わったチェックポイントには新しい質問と回答が必要です。Unit のチェックポイントと同じく、`--message <id>` は、エンジンの別の質問が画面にある間にその人が送った返答を記録します。`finalize` を再実行すると、このインテントについて、どのセッションのものであっても、開いているチェックポイントの質問と取得した返答がすべて撤回されます。新しい検証とソースの取り込みの後、`ready: true` を確認して再び尋ねてください。`finalize` の前に取得した返答は、新しい証拠を承認できません。自動完了は、`human_required: false` のとき `--user-input` を省き、`ask` も不要です。人間による却下には、常にこの準備のできた質問と回答の流れが必要です。準備ができているかどうかは、完了したバッチの現在の証拠から決まります。これには、各 Unit のネイティブの `Command SHA-256` が現在の認可された Construction Verification Command と一致することが含まれます。バッチの承認もそのダイジェストに結び付きます。すでに承認されたバッチはその人が新しいコマンドを承認しても承認を保ち、まだ承認されていないバッチはそれによる新しい検証が必要で、ダイジェストを持たない古いネイティブのレシートは新しい検証が必要です。バッチのクレームしたファイルや出力が検査後に変わった場合、Guard Policy が strict なら `changed_after_check: true` で準備未完了となり、`ask` はその人に Request Changes だけを提示します。relaxed や off では変更は保たれ、`CHANGE_ACCEPTED`（`swarm-batch`）として 1 回記録され、`ask` / `approve` はその行を `notices` に返します。バッチ全体を作り直したり合格を作り出したりするのではなく、`errors` を解決してください。承認や却下の後は `next` を再実行します。バッチの承認はステージ全体の承認ではありません。後の completion-only のステージディレクティブは、本体、レビュアー、人間への学び／承認の質問をもう一巡することなく、記録を整えます。

Request Changes の後、`resume_existing: true` を持つ `invoke-swarm` ディレクティブは、同じバッチと正確な Unit の集合を使います。却下によって以前の承認が無効になった場合は、準備の前にその改訂について新しい Plan Approval を得てください。

```bash
aidlc engine swarm prepare --resume-existing --batch <N> --units "<exact emitted Units>"
```

worktree が残っていれば、ツールはそのソースを保ち、古いメタデータを退避します。ネイティブのソースの取り込みがそれを削除していた場合、ツールはその取り込みの証拠を検証した後、すでに取り込まれた親のソースから新しい子を作れます。どちらの経路も、却下による改訂とその実際の承認の証拠を保持します。同じインテント、対象、試行について承認があれば、準備の再試行に追加の回答は不要です。`testing-posture verify` が `execution_allowed: true`（exit 0）を返せば、`ok: false` のときでも、下げたガードのもとで承認後の継続が許可されます。この許可が古い試行の承認を復活させることはありません。その証拠のない子の欠落は拒否します。マージされた子がすべて残っていると想定したり、拒否された再開を通常の prepare で置き換えたりしないでください。承認された開始点と異なるソースは、作業を再開する前に整合させ、承認を得る必要があります。

<a id="grouped-code-generation-plan-approval"></a>

### コード生成の計画をまとめて承認

swarm のバッチの複数の Unit の計画が同時に揃うと、`next` はそれらを 1 つの質問で尋ねます。各 Unit の要約と計画のパス、そして **Approve all**、**Request Changes**、**I'll edit the files** です。その人は自分の言葉で答え、エージェントはその人が選んだものを `aidlc engine log answer --stage code-generation --checkpoint plan-approval --details "Approve Plan"`（または `'Request Changes: <what they asked>'`、`"I'll edit the files"`）で記録します。一部の Unit には `--units "<unit>,<unit>"` を付け、残りを記録します。「approve all」はすべての Unit を承認し、Unit を名指しする変更（「change billing: use Stripe」）はその Unit だけをその言葉とともに差し戻し、残りを承認します。質問ボックスでの「Approve all」の選択は、選んだ時点で記録されます。入力された「Approve all」は、ほかの返答と同じくエージェントが記録するものです。すべての Unit は、それぞれの計画に結び付いた独自の承認記録を引き続き受け取ります。旧来の記録済みバッチのコマンド（`aidlc engine log decision|answer --stage code-generation --checkpoint plan-approval --batch-file <manifest>`）は、更新前に始まったまとめての承認を完了できるようにするためだけに残っています。エンジンの質問が開いている間は、「Plan Approval is asked by the engine now. Run next, show the person the question it returns, and end the turn.」と拒否します。

承認された Unit の一部が取り込まれた後も、`next` が保留中の集合を絞り込む間、残りの準備済みのワーカーは元の承認を保ちます。`testing-posture verify` が `execution_allowed: true`（exit 0）を報告すれば、`ok: false` が編集された内容は承認されていないと正しく報告している場合も含め、既存の worktree を続けてください。その継続では、`reason` が新しい承認なしに続けるよう伝え、`approval_reason` が古くなった結び付きの詳しい理由を持ちますが、実行は妨げません。既存のワーカーは、後の弱化や引き上げを含め、検証済みの親インテントの現在の plan-approval のガードを使います。
部分的なバッチでは、追加の承認の回答も新しい `prepare` も不要です。これは、チェックポイントの改訂が準備された後にも当てはまります。中断した改訂の準備は、既存の現在の承認で再試行できます。準備が成功すると、以降の `next` のディレクティブから改訂の準備の合図が取り除かれます。最初の承認の後、同じ対象と試行についての計画、テスト指示、Testing Contract の編集は、Guard Policy が `relaxed` または `off` なら再承認なしに続きます。
`strict` では編集された計画について再び尋ねます。新しい試行には引き続き独自の承認が必要です。元の承認の証拠は保ち、編集された内容を承認済みとは記述しないでください。
人間の Retry がワーカーを明示的に破棄した場合、そのネイティブの破棄は、作り直しのためにコミットされた承認済みのベースラインを保持できます。代わりのワーカーは、バッチのほかのメンバーが続いている間やすでに取り込まれた後でも、同じ承認を保てます。ディレクトリの欠落や無関係な古い破棄の記録は、この復旧を認可しません。
質問がどう示されても、Unit ごとの承認は必須のままです。
[Construction Execution](../reference/03-orchestrator.md#構築実行) を参照してください。

<a id="aidlc-engine-worktree-restore-recover-files-from-a-set-aside-attempt"></a>

### `aidlc engine worktree restore` — 保留したファイルを復元

メインのプロジェクトのチェックアウトから実行します。

```bash
aidlc engine worktree restore --slug <slug> [--parked <stamp>] [--raw] [--repo <name|.>] [--intent <intent>] [--space <space>]
```

これは、`worktree discard` または認可された `bolt abort --discard` が保存したファイルを復元します。`--parked` がなければ、選択したインテントの Bolt の最新の保存済み `/head` を選び、指定すればその正確なスタンプを選びます。スタンプは UTC の `YYYYMMDDTHHMMSSZ` に任意の数値の衝突回避の接尾辞 `-N` が付いたもので、最新の選択では数値として順序付けます（`-10` は `-2` の後）。1 つのリポジトリにだけ存在する正確なスタンプは、一般的な slug の曖昧さより先にそのリポジトリを選びます。
それでも選択が曖昧な場合、`--repo <name>` は既存の兄弟の Git リポジトリを、`--repo .` はプロジェクトルートを選びます。復旧は、同じ slug の `WORKTREE_CREATED` または `WORKTREE_DISCARDED` 監査の `Repo` フィールドに記録された有効な Git リポジトリを、それらの兄弟の名前がシンボリックリンクであっても受け入れます。フレームワークは、試行の worktree や保留を記録したまさにその場所で復旧できます。この受け入れは slug 単位で、ほかの slug の記録がこの slug のリポジトリの集合を広げることはありません。現在または過去のインテントのリポジトリ一覧に含まれるだけでは、シンボリックリンクは受け入れられません。インテントの一覧の候補と、記録されていない発見済みの兄弟は、正規化したパスが正規化したワークスペースルートの直下にある、実在する直下の子ディレクトリでなければなりません（`isWorkspaceRepoDir`）。同じ slug の監査の来歴を持たない任意のパスやシンボリックリンクの別名は拒否します。restore と purge は、このセレクターを現在のインテントのリポジトリ一覧とは独立に解決します。これは、稼働中の worktree の create/discard コマンドのセレクターを変えません。ワークスペースの文脈を解決する必要があれば `--intent` / `--space` を使ってください。どちらの復旧コマンドも、選択や変更の前に未知のフラグと重複したフラグを拒否します。`--raw` は値を取らない restore 専用のフラグで、purge は受け付けません。

人間が試行の復旧を頼むと、コンダクターはコマンド文字列ではなく、成功した discard や abort が保存した `restore_operation` を使います。この型付きの `EngineInvocation` は、スタンプが分かっていれば、経路 `worktree` と引数 `["restore", "--slug", slug, "--parked", stamp, "--repo", repo ?? ".", "--intent", recordDirName, "--space", space]` を持ちます。`aidlc engine worktree <args...>`（インストールされた `aidlc engine worktree` の経路）を呼び出し、列挙された各引数をそのまま別々の argv 引数として渡します。引数をシェルコマンドへ連結したり、slug だけの選択を作り直したりしてはいけません。リポジトリのセレクターは常にあります。兄弟の名前か、ルートなら `.` です。最後のセレクターは、アクティブなインテントが変わった後でも、所有するインテントを固定します。返された引数はすべて保ってください。

`restore_hint` は、その操作から `renderEngineInvocation` が描画する任意の人間向けの表示テキストで、ネイティブ／ソースの選択、ハーネスディレクトリの検証、シェル安全な引数の引用を伴います。描画が例外を投げた場合（例えば不正なハーネスディレクトリ）、ヒントは省かれ、`restore_hint_error` が理由を持ちます。操作は引き続き使えます。復元の提案は、描画されたヒントの有無ではなく `restore_operation` に基づいて行ってください。ヒントはコンダクターの実行入力ではなく、それがないことは evidence-only の試行であることを意味しません。これは abort の引数、ガードの受け入れ、人間の同意の要件を何も変えません。
`worktree discard` は `parked_ref` と `parked_commit` を保持し、`parked_stamp`、`parked_mode`（`snapshot`、`branch-tip`、`evidence-only`）、`parked_repo`（プロジェクトルートなら `null`、それ以外は兄弟の名前）を加えます。
`bolt abort` は `reason: "aborted"` を保持し、指定した `--reason` の本文を追加の `abort_reason` フィールドに返します。常に `parked_ref` を含み、何も保留しなかった場合は `null` です。`null` でない `parked_ref` の場合だけ、`parked_stamp`、`parked_mode`、`parked_repo` を加えます。レビューの証拠だけが残った場合、discard は `parked_mode: "evidence-only"` と `parked_commit: "-"` を報告します。abort は 4 つの記述フィールドを保ちますが、`restore_operation`、`restore_hint`、`restore_hint_error`、`parked_excludes` を省きます。

`snapshot` では、abort は `parked_excludes: ["ignored files", "eol/text=auto normalization"]` を報告します。`branch-tip` では `["uncommitted files (no working tree existed)"]` を報告します。保てたのはコミット済みの作業だけだからです。保存された名前空間は分かっているがその discard の記述子が利用できない場合、フォールバックは、スタンプが厳密に解析できるときだけ `parked_ref` から `parked_stamp` を導き、そうでなければ `null` を報告します。
`parked_mode` と `parked_repo` は `null` にし、`restore_operation`、`restore_hint`、`restore_hint_error`、`parked_excludes` を省きます。保存されたモードもリポジトリも分からないためです。代わりに `recovery_hint` が、保留した試行とその正確な restore コマンドを一覧するために doctor を実行するよう人間に求めます。このヒントは平易な案内で、実行可能な操作ではありません。
このフォールバックは、どのファイルが保存されたかを確立せず、復元の提案を正当化しません。名前空間が保存されなかった場合（`--discard` なしの場合を含む）、`parked_ref` は `null` で、`parked_stamp`、`parked_mode`、`parked_repo`、`restore_operation`、`restore_hint`、`restore_hint_error`、`parked_excludes`、`recovery_hint` はありません。

restore は、ブランチ `restore/bolt-<id8>_<slug>-<stamp>` 上に `.aidlc/restored/bolt-<id8>_<slug>-<stamp>` を作ります。稼働中の `.aidlc/worktrees/bolt-<id8>_<slug>` のチェックアウトや `bolt-<id8>_<slug>` ブランチに触れたり、中断したライフサイクルを再開したり、レビューの権限を復活させたりすることはありません。復元先のパスやブランチがすでに存在する場合は、上書きせずに拒否します。`/head` のない evidence-only の復旧 ref を選ぶと、`--raw` を付けても拒否します。

```text
no restorable files were parked for <slug> <stamp>; only review evidence was kept
```

旧来の restore は記録された名前を保ち、選択したインテントの正確な `WORKTREE_DISCARDED` の `Parked ref` の来歴を必要とします。[Bolt identity](https://github.com/awslabs/aidlc-workflows/blob/6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a/core/knowledge/aidlc-shared/worktree-info-schema.md#bolt-identity) を参照してください。

| 選択 | 動き |
|-----------|----------|
| 値なしの `--raw` | マーカーと旧来の分類を上書きし、保存された blob をバイト単位でそのまま書く。`restore_mode` は `raw-requested` |
| `/snapshot` マーカー | 保存された作業ツリーの blob をバイト単位でそのまま書く。`restore_mode` は `snapshot` |
| `/branch-tip` マーカー | フィルターとエンコーディング変換を含む、Git の通常のチェックアウトを使う。`restore_mode` は `branch-tip` |
| マーカーなし（旧来） | ツールが作成したスナップショットのコミットの識別情報を認識する。`legacy-snapshot` には生のバイトを、`legacy-branch-tip` には通常のチェックアウトを使う |

選択は表の順に従います。生の書き出しは smudge/process フィルターと `working-tree-encoding` を迂回します。以前の `eol/text=auto` の正規化を元に戻したり、無視された未追跡ファイルを復元したりはしません。生のまま復元したパスは、自身のフィルターのもとで変更済みに見えることがあります。実行モードは保たれます。シンボリックリンクは `core.symlinks` に従います。生の submodule の gitlink は空のディレクトリになり、復元された submodule のチェックアウトにはなりません。必須のチェックアウトフィルターが失敗すると、通常の restore は失敗します。`--raw` で再試行する前に、残っている復元のチェックアウトとその復元のブランチを明示的に削除してください。失敗した生の restore は途中のチェックアウトをその場に残し、そのパスを報告します。

成功時の JSON は、`restored: true`、`slug`、`parked_ref`、`worktree_path`、`branch`、`reviewed_source_refs`、`raw_bytes`、`restore_mode` を含みます。
`reviewed_source_refs` は保持された復旧の証拠を数えるもので、再び有効になった ref ではありません。`materialized` は `raw_bytes` が `true` のときだけ現れ、submodule の gitlink を除いた通常ファイルとシンボリックリンクを数えます。返された `worktree_path` を開き、必要なファイルを確認またはコピーしてください。

Bun ベースのコピーインストールでは、`aidlc engine worktree` を `bun .claude/tools/aidlc-worktree.ts` に置き換え、`.claude` をお使いのハーネスのディレクトリに置き換えます。復旧の手順は [ファイルを取り戻す](15-troubleshooting.md#a-bolt-attempt-was-set-aside-getting-the-files-back)、スナップショットの契約は [State Machine](../reference/12-state-machine.md) を参照してください。

<a id="aidlc-engine-worktree-purge-remove-recovery-refs"></a>

### `aidlc engine worktree purge` — 保存参照の破棄

```bash
aidlc engine worktree purge --slug <slug> [--parked <stamp> | --older-than <days>] [--repo <name|.>] [--intent <intent>] [--space <space>]
```

purge は、スナップショット／branch-tip のマーカーとレビュー済みのソース ref を含むローカルの復旧 ref を、現在の値と照合して削除します。セレクターがなければ、選択したインテントの Bolt の保存されたスタンプをすべて削除します。`--parked <stamp>` は正確なスタンプを 1 つ選びます。`--older-than <days>` は小数を含む負でない有限の日数を受け付け、その閾値より厳密に古いスタンプだけを選びます。経過日数はスタンプの UTC の `YYYYMMDDTHHMMSSZ` の部分から計算し、衝突回避の接尾辞 `-N` は無視します。コミットの日時は影響しません。`--parked` と `--older-than` は組み合わせられません。
共有の厳密な暦の解析器は、ありえない日付や時刻を正規化せずに拒否します。`--older-than` では、解析できないスタンプは残り、`skipped_unparseable` に現れます。閾値ちょうどの試行も残ります。正確なスタンプの指定やすべてのスタンプの purge では、解析できないスタンプも削除できます。

選択した試行に復元されたチェックアウトがある間は、別の場所へ移動したチェックアウトも含めて、purge は拒否します。先にそのチェックアウトを明示的に削除してください。稼働中の Bolt のチェックアウトやブランチを削除することはありません。成功時の JSON は `{purged: <number-of-refs>, slug, stamps: [...], skipped_unparseable: [...]}` で、数は試行ではなく ref の数です。`skipped_unparseable` は常にあり、`--older-than` が解析できないスタンプを飛ばしたとき以外は空です。
restore と purge は監査イベントを追加しません。

`/aidlc --doctor` と `aidlc doctor` は、保存された `/head` のエントリや実際のレビュー済みのソース ref がある場合、通常と verbose の両方の出力で **Parked attempts** の情報セクションを表示します。各エントリは、slug、正確なスタンプ、経過日数、モード（`snapshot`、`branch-tip`、`legacy`、`evidence-only`）、正規化された復元済みチェックアウトの有無、型付きの復旧の操作を含みます。JSON では、すべてのエントリが `purge_operation` を持ち、復元可能なエントリだけが `restore_operation` を持ちます。それぞれは経路 `worktree` を持つ `EngineInvocation` で、引数は `purge` または `restore` で始まり、その後に `["--slug", slug, "--parked", stamp, "--repo", repo ?? ".", "--intent", recordDirName, "--space", space]` が続きます。
コンダクターは、各引数をそのまま argv としてその経路を呼び出し、シェルのために文字列を連結することはありません。任意の `restore_command` と `purge_command` は、人間に表示するためだけの安全な描画です。描画が例外を投げた場合、対応するコマンドは省かれ、操作は残ったまま `restore_command_error` または `purge_command_error` が理由を説明します。evidence-only のエントリは、purge の操作とそのコマンドまたはエラーのフィールドだけを持ちます。doctor は、上で説明したのと同じ slug 単位の復旧リポジトリの候補集合を使います。移動したチェックアウトは doctor で復元済みとして表示されないことがありますが、purge は引き続きその Git の登録を確認します。
名前空間付きの試行は、インテントのレジストリの UUID を通じて所有者を解決します。旧来の試行は、所有者の監査に正確な discard の `Parked ref` を必要とします。所有者が不明または曖昧なものと、帰属できない旧来の保留は省かれます。
doctor は同じ厳密なスタンプの解析器を使います。ありえない日付や時刻は、JSON では `age_days: null`、人が読む出力では `unknown` になります。
これらのエントリは警告や失敗を出しません。ネイティブのコマンドなしで purge を実行するときは、restore について記載したコピーインストールの接頭辞を使ってください。

### `aidlc engine workspace codekb` - resolve the code knowledge directory

公開の読み取り専用の照会を使います。

```bash
aidlc engine workspace codekb --repo <repo>
```

アクティブなスペースの決定論的な `aidlc/spaces/<space>/codekb/<repo>/` のパスを出します。`--json` を付けると `{space, repo, dir}` です。この照会は何も書かず、ディレクトリも作らず、監査イベントも出しません。Reverse Engineering ステージの文章も同じ経路を呼ぶので、パスを手で組み立てることはありません。

### `aidlc-utility codekb-snapshot` - bind a scan to source and store generations

これは **直接のユーティリティ呼び出し** であり、`/aidlc codekb-snapshot` コマンドではありません。

```bash
bun .claude/tools/aidlc-utility.ts codekb-snapshot \
  --repo <repo> --paths src/payments/,src/catalog/ --json
```

リバースエンジニアリングのスキャンの直前に、このコマンドは共有の CodeKB の世代全体と、スキャンが調べるパスのソースのフィンガープリントを取得します。ソースのトークンには、使えるときは Git の作業ツリーのフィンガープリントを、Git の外ではバイト単位で正確なツリーのフォールバックを使います。指定した各パスの下では、どちらも `.csproj`、`.fsproj`、`.vbproj` ファイルの横にある .NET の `bin/`、`obj/`、`out/` を除外し、フォールバックは `node_modules/` のような依存関係やキャッシュのディレクトリと、`.DS_Store` のようなツールの副産物のファイルも飛ばします。そのため、スキャン中の `dotnet build` がそれを無効にすることはありません。`--paths` で指定したパスは常に読みます。ワークスペースルートがリポジトリのルートの場合、どちらも `codekb-scope-diff`（下記）と同じく AI-DLC 自身のファイルを除外します。スペース＋リポジトリのロックが、2 つの値が並行する公開をまたがないようにします。返される `store_generation`、`source_fingerprint`、`paths` は `codekb-publish` の入力です。`head_commit` は、ナレッジベースの Run Record が示すコミットです（Git の外、または最初のコミットより前では `unknown`）。

### `aidlc-utility codekb-publish` - guarded all-artifact publication

これは **直接のユーティリティ呼び出し** であり、`/aidlc codekb-publish` コマンドではありません。

```bash
bun .claude/tools/aidlc-utility.ts codekb-publish \
  --repo <repo> \
  --staged <record>/.aidlc-engine/codekb-stage-<repo>/ \
  --paths src/payments/,src/catalog/ \
  --expect-store <generation> \
  --expect-source <fingerprint> \
  --json
```

ステージしたディレクトリには、CodeKB の成果物がちょうど 9 つ含まれていなければなりません。公開は同じスペース＋リポジトリのロックを取得し、スナップショットの 2 つの値を再確認し、タイムスタンプの最終的なスコープのフィンガープリントを検証し、ロールバックとクラッシュ復旧付きで候補全体を共有ストアへ入れ替えます。並行する CodeKB の公開は `CODEKB_STORE_CHANGED` を返して何も公開せず、最後の書き手が勝つ上書きではなく、新たな再マージを必要とします。Guard Policy が strict のもとでのソースの動きは `CODEKB_SOURCE_CHANGED`（または `CODEKB_CANDIDATE_STALE`）を返し、新しいスキャンまで何も公開しません。`relaxed` や `off` のもとでは、スキャンは取得したとおりに公開され、コードを再びスキャンするかを尋ねる 1 行（`--json` では `change_notices`）が付きます。

公開に成功すると、ユーティリティはステージしたディレクトリを 1 回の操作で脇へ改名し、9 つのファイルそれぞれを公開したばかりのバイト列と照合してすぐに削除し、最後に空になったディレクトリを再帰なしで削除します。JSON の結果は `"staged_removed": true` を報告します。読んだ後に何かが変わっていた場合や削除に失敗した場合、ユーティリティは削除したファイルをその公開したバイト列から作り直してディレクトリを元どおりに戻し（その間にステージのパスが作り直されていた場合は、改名したコピーをその横に残し）、`"staged_removed": false` を報告し、残したディレクトリを stderr で示します。

### `aidlc-utility codekb-scope-diff` - check the code knowledge base before a rerun

これは **直接のユーティリティ呼び出し** であり、`/aidlc codekb-scope-diff` コマンドではありません。

```bash
bun .claude/tools/aidlc-utility.ts codekb-scope-diff --repo <repo>
bun .claude/tools/aidlc-utility.ts codekb-scope-diff --repo <repo> --compare <timestamp.md>
bun .claude/tools/aidlc-utility.ts codekb-scope-diff --repo <repo> --mint --paths src/payments/,src/billing/
bun .claude/tools/aidlc-utility.ts codekb-scope-diff --repo <repo> --check <timestamp.md>
```

リバースエンジニアリングの再実行のガードです。codekb のストアはスペース単位で、インテントの間で共有されます。完全な再スキャンはそれを置き換え、焦点を絞ったスキャンは新しい知識を累積的にマージするため、ステージはまず次を確認します。

- **Status モード**（既定）は、ストアの `reverse-engineering-timestamp.md` の Scope of Analysis ブロックを読み、分析したパスについて内容のフィンガープリントを再計算します。判定: `NO_STORE`（最初のスキャン）、`CURRENT`（分析したパスは変わっていない — 再利用は安全）、`STALE`（分析したパスが変わった）、`UNVERIFIED`（計算できるフィンガープリントがない — 例: git の作業ツリーではない）、`UNKNOWN_SCOPE`（ストアがスコープの追跡より前のもの）、`SCANNED`（ステージの今回の実行がすでにリポジトリをスキャンし、ストアを公開した。ステージが最後に始まった、ジャンプされた、または変更を求められたとき以降、そのリンクの連鎖全体が記録にある。再利用するものも再スキャンするものもない）。
- **Compare モード**（`--compare <incoming timestamp.md>`）は、入ってくる実行のスコープがストアのスコープを覆うかを答えます。`COVERS`、または `NARROWER` と、もはや深い網羅として主張されない正確なパスとコンポーネントです。`COVERS` は焦点を絞ったマージの安全網で、マージしたスコープがストアの検証済みの網羅を保ったことを意味します。`kind: full` のスコープはリポジトリのルート（`./`）を含まなければならず、`NARROWER` の警告なしに完全なストアを覆えるのは、別の完全なスコープだけです。古いまたは未検証の焦点を絞ったマージでは、以前の文章は保たれ、検証できない分析済みのパスは `shallow.paths` へ降格します。
- **Mint モード**（`--mint --paths <a,b,...>`）は、アーキテクトが統合時にスコープのブロックへ貼るフィンガープリントを出します（git の作業ツリーの外、または pathspec が不正な場合は `unknown`）。
- **Check モード**（`--check <timestamp.md>`）は、ステージした候補のような公開用に書かれたタイムスタンプを読み、`VALID` とそのスコープのブロックが記録する内容、そのフィンガープリントが現在のソースと一致するか（`current`、`stale`、`unknown`）を出すか、解析器の理由とともに `INVALID` を出します。ストアは不要なので、最初のスキャンでも公開前に候補を確認できます。

構造化された形には `--json` を付けます。使い方のエラーを除き、常に判定を出力に含めて exit 0 で終わります。何も書かず、監査イベントも記録しません。ただし 1 つ例外があります。比較したファイルが、アクティブなインテントのレコードの `inception/reverse-engineering/` にある、比較したリポジトリについてのステージ自身の `scope-draft-<repo>.md` である場合、compare は判定にかかわらずそれを削除し、そう伝えます（「The scope draft has been removed.」、または `--json` では `"draft_removed": true`）。フィンガープリントは、分析したパスに限った一時インデックスに対する `git write-tree` で、その横に一時的なオブジェクトストアを置きます。リポジトリ自身の `.git` には何も書き込まないため、ハーネスのサンドボックスが `.git` を読み取り専用にしている場所でも動き、オブジェクトを残しません。
ワークスペースルートがリポジトリのルートの場合、スキャンが決して読まない AI-DLC 自身のファイルを除外します。`aidlc/` ワークスペース、ハーネスのディレクトリ（`.claude/`、`.kiro/`、`.codex/`、`.cursor/`、`.opencode/`、`.aidlc/`）、`.github/` と `.agents/` の下にある `aidlc` という名前のエージェント、フック、スキル、生成されたステージランナー、インストールされたハーネスの投影が書き込むすべてのルートのファイル（`.gitignore`、`AGENTS.md`、`.mcp.json`、`.vscode/settings.json`、`opencode.json`、Cursor の `install.ts` など）、そして `aidlc.settings.json` と `aidlc.settings.local.json` です。そのため、AI-DLC の更新、設定の変更、インストールのコミットではストアは `CURRENT` のままで、`STALE` にするのはプロジェクト自身のファイルの変更だけです。codekb／状態の成果物が書かれても自分を無効にすることなく、ソースの作業ツリーの内容を追跡します。履歴を書き換える rebase や squash に惑わされず、編集を元に戻すと元のフィンガープリントに戻ります。

### `aidlc-utility detect` - read-only workspace scan

`bun .claude/tools/aidlc-utility.ts detect --json` は、ワークスペースのスキャン（プロジェクト種別、言語、フレームワーク、ビルドシステム、宣言された git サブモジュールとその初期化状態の `submodules` 配列）に加え、解決したスコープのディレクトリとスコープグリッドのパス、そして `proposalPath` を出します。`proposalPath` は、`validate-grid` が確認する前にコンポーザーがグリッドを書く、プロジェクト相対のファイル（`aidlc/spaces/<space>/intents/.aidlc-engine/composer-proposal.json`。git では無視される）です。純粋な読取りです。コンポーザーは、現在のハーネスでスコープのデータがどこにあるかを知るためにこれを実行します。

### `aidlc engine workspace reclassify` - new project or existing code

`aidlc engine workspace reclassify --project-type <greenfield|brownfield> [--intent <slug>] [--space <name>] [--message <id>] [--then-rerun]` は、ワークフロー途中の `/aidlc --project-type` と、「このフォルダにコードが入った」という質問への回答の背後にあるコマンドです。フォルダを再びスキャンし、ロックした 1 回の書込みで種別をその人のものとして記録します。監査には先に `WORKSPACE_RECLASSIFIED` として記録します。`next` が表示するステップは、エージェントが種別を伝えたその人のメッセージの id で埋める `--message <id>` を、名指せるメッセージの id と時刻とともに示します。エンジンは `config set` と同じようにそのメッセージを証明し、監査行はそれを `Message Id` として、その言葉を `Person Reply` として記録します。言葉のファイルは書きません。ワークフロー自体を動かすことはありません。現在のステージの後ろに Reverse Engineering を戻した場合、次の `next` がそれを実行するやり直しのジャンプを示します。完了またはアーカイブされた作業では、種別を記録し、計画はそのままにします。返答はワークフローを続ける `done` ディレクティブです（同じ要求がさらに頼んでいた場合に使う `--then-rerun` では、同じ `next` を再び実行する `print`）。あなたが聞く内容は、エージェントが話す次のステップとともに伝えられます。新しい種別と見つかったもの、コードが入る前に実行されたステージとそのやり直し方、そして種別が変わった場合は元に戻し方です。次にコードを文書化することは、やり直しのジャンプが実行されるときにそれ自身が伝えます（「Once you approve the code's documentation, we're back at Practices Discovery.」）。そのため、同じ発言で Reverse Engineering のスキップを頼んだ場合、それが伝えられることはありません。

<a id="aidlc-workspace-sync-clone-and-reconcile-the-declared-repo-set"></a>

### `aidlc-workspace-sync` - clone and reconcile the declared repo set

これは **直接のツール呼び出し** であり、`/aidlc workspace-sync` コマンドではありません。ワークスペースルートの任意の `repos.json` マニフェストに対して、複数リポジトリのワークスペースを突き合わせます（[Declaring the repo set](03-spaces-and-intents.md#リポジトリ集合を宣言する任意のマニフェスト) を参照）。

```bash
aidlc system workspace-sync [--force]
```

突き合わせはワークスペースのロックで直列化します。ロックの生きた所有者が経過時間で刈り取られることはありません。その後、クローンと生成ファイルをステージする前に、読み取り専用の事前確認を実行します。生成物は、置き換えないリンクと、同じファイルシステム上の元に戻せる改名でインストールします。ステージ中に `.gitignore` や `aidlc.code-workspace` が変わった場合、または計画を読んだ後に `repos.json` が変わった場合、sync は古い状態を適用したり編集を上書きしたりせずに中止します。置き換えに成功した以前の生成ファイルは、確認できるよう、無視される `.aidlc-workspace-sync-recovery-*` ディレクトリの下に残ります。途中で止まった実行が残したステージング用の `.aidlc-workspace-sync-txn-*` フォルダも無視され、削除して構いません。ツールは、`repos.json` に宣言されているがディスクにないリポジトリをクローンし、ワークスペースの `.gitignore` の管理ブロックをリポジトリごとに 1 行の `/{name}/`（と、ツール自身の 2 つのフォルダのパターン）に書き直し、ルートと各子リポジトリを列挙する VSCode のマルチルートファイル `aidlc.code-workspace` を書きます。Copilot のプロジェクトでは、そのファイルは VS Code のエージェントのリクエスト上限 `"settings": { "chat.agent.maxRequests": 200 }` も持ちます。これは settings がまだないファイルに 1 回だけ追加され、その settings にすでにあるキーと値は保たれます（ファイルは書き直されるため、中のコメントは保たれません）。宣言された `branch` は、新しいクローンでチェックアウトされます。すでにディスクにあるリポジトリは、再クローンも切り替えもしません。そこでの不一致は advisory のままです。

孤立したチェックアウト（ディスクにはあるが `repos.json` にない）は実行を止めます。`--force` を渡し、ツールがローカルだけの状態がないことを証明できる場合にだけ、アクティブな兄弟の集合から外します。その証明は、設定可能な status の既定値を上書きし、未追跡と無視されたファイルとディレクトリ（空のディレクトリを含む）、隠れたインデックスの状態、stash、ref と reflog、到達できない Git オブジェクト、リンクされた worktree、submodule、LFS のオブジェクトストアを含みます。キャッシュされたリモート追跡 ref を信用せずに実際の各リモートに問い合わせ、一致するオブジェクトグラフを隔離した探査領域へ fetch するので、宣伝されているが提供できない OID が削除を認可することはありません。ストレージやオブジェクトの alternates がそのチェックアウトに依存するローカルのリモートは、復旧手段として数えられません。

生きたリモートの証明の後、チェックアウトはトランザクションの隔離領域へ移り、ローカルと生きたリモートの完全な証明をもう一度受けます。隔離したコピーは再帰的に削除されず、無視される `.aidlc-workspace-sync-recovery-*` ディレクトリの下に保持されます。そのため、すでにディレクトリを開いているプロセスが、証明と後片付けの間の遅い書込みを失うことはありません。保持されたチェックアウトと生成ファイルのバックアップを確認し、不要になったら復旧ディレクトリを手で削除してください。不確かなものはすべて、手動のレビューのために止めます。終了コード: `0` は完全に同期、`1` はブロックまたはエラー（生きたパスは変わらない）、`2` は同期したが advisory の警告が残る（例: 既存のチェックアウトのブランチの不一致）。

マニフェストは任意で、ディスクを上書きすることはありません。インテントの作成は、実際に存在する兄弟リポジトリをこれまでどおり自動発見するため、このツールは宣言された集合を再現して整えるだけです。`--doctor` はこれについて 3 つの advisory の行（未コミットの `aidlc/` の記録、`repos.json` とディスクのずれ、古い管理された `.gitignore` ブロック）を持ちます。すべての advisory の行と同じく、doctor の終了コードは変えません。

### Plugin state

`/aidlc plugin list` は、インストールされたプラグインの名前と、それぞれが有効かどうかを出します。`/aidlc plugin select [names]` が公開コマンドです。`select-plugins` はその直接のユーティリティ形式で、`/aidlc select-plugins` コマンドではありません。`bun .claude/tools/aidlc-utility.ts select-plugins` は、現在の選択（`plugins` キーがなければ `all enabled (no selection)`）と、既知のプラグイン名を出します。設定するにはカンマ区切りの一覧を渡します。

```bash
bun .claude/tools/aidlc-utility.ts select-plugins test-pro
bun .claude/tools/aidlc-utility.ts select-plugins aidlc,test-pro
```

複数のハーネスをインストールしたプロジェクトでは、下の `plugin sync` と同じく、`--harness-dir <dir>` が変更するインストールを示します（`aidlc engine plugin select aidlc --harness-dir .kiro`）。付けなければ、ネイティブの `aidlc` は最初のもの（あれば `.claude`）を変更します。

コマンドは名前を検証し、`.claude/tools/data/harness.json` を書き、新しく無効にしたプラグインのマージ済みの寄与をコアのステージソースから取り除き（構造の追加は compose が書いたサイドカーで、差し込んだ文章はその番兵マーカーで。再び有効にすると次のセッション開始時に、Kiro CLI と opencode ではプラグインのフォルダを指定して `aidlc engine plugin sync --plugin-root <folder>` を実行したときに戻ります）、無効なノードを `enabled:false` にしたフルグラフを再コンパイルし、ステージとスコープのランナーを刈り込み／再生成し、生成されたスコープとステージの表（オーケストレータスキルの隣にある `tables.md`）を、1 つのトランザクションで更新します。`aidlc` はコアです。省くと、常に有効な Initialization ステージを除くコアの面が無効になります。アクティブなワークフローを立ち往生させる変更（そのスコープ、または計画内の未着手の EXECUTE ステージが、新しい選択で無効になるプラグインの所有）は、依存関係をそれぞれ示して拒否します。先にワークフローを完了またはアーカイブするか（保留したワークフローも再開時にそのプラグインを必要とします）、プラグインを有効のままにしてください。ベースのプラグインを外し、その上に作られたプラグインを残すと、そのプラグインは一時停止します。一覧は入力どおりに書かれ、そのプラグインもオフにするコマンドとともに、そのことを 1 行で一度だけ伝えます。ベースがオフの間、そのプラグインが加えるものは何も実行されず、`plugin list` はそれを `paused` と表示し、ベースをオンに戻すと次のセッション開始時に（Kiro CLI と opencode では、プラグインのフォルダを指定して `aidlc engine plugin sync --plugin-root <folder>` を実行したときに）戻ります。ベースをオンにする select は、どれが戻るかを一度だけ伝えます。

`/aidlc plugin sync`（`aidlc engine plugin sync`）は、ホストのプラグインの一覧から、インストールされたプラグインの compose フックを実行し、終わると `plugin sync complete: <n> plugin(s)` を表示します。何度実行しても安全です。ベースのプラグインを先に compose し、次にその上に作られたプラグインを compose します（プラグインはコアと、マニフェストの `dependencies` で示す最大 1 つのベースの上に作られます）。ベースの上に compose できないプラグイン（インストールされていない、プラグインの版の範囲外、別のプラグインの上に作られている、ベースを 2 つ示している）は保留されます。sync はその理由を complete の行の後に 1 行で一度だけ伝え、ほかのプラグインはすべて compose して exit 0 で終わり、`--json` はそれを `data.held` に一覧します。`aidlc engine plugin list` と doctor は、sync がそれを compose するまでその行を保ちます。以前に compose した保留中のプラグインはそのまま残ります。2 回インストールされたプラグイン（古い `aidlc-<name>` のコピーが作り直したものの横にある）は作り直したものから compose され、sync は実行のたびに古いコピーの削除コマンドを示す 1 行を表示し、`--json` では `data.superseded` に一覧します。セッション開始フックが自分のプラグインだけを示すホストでは、フックはそのプラグインのインストール済みのベースを先に compose します。不正なエントリを含む一覧や、`hooks/compose.ts` のないプラグインのルートは、sync 全体を拒否して何が問題かを示すので、中途半端に compose されることはありません。`--plugin-root <dir>` は、`AIDLC_PLUGIN_ROOT` と同じく、compose するインストール済みのプラグインを示します。Kiro IDE のフォルダ配置のフックは、プラグイン自身のフォルダ `./.kiro/aidlc-plugins/<name>` を渡します。`--harness-dir <dir>` は、`AIDLC_HARNESS_DIR` と同じく、compose 先のハーネスのフォルダを示します。これは複数のハーネスをインストールしたプロジェクト向けです。Kiro CLI、Kiro IDE、Cursor、Copilot、opencode はインストールしたプラグインの一覧を持たないため、そこでプラグインのフォルダなしに sync しても何も compose されず、プロジェクトで compose された各プラグインのコマンドを示します。

```text
$ aidlc engine plugin sync
aidlc engine plugin: Nothing synced: this tool keeps no list of your plugins, so name each one's folder: `aidlc engine plugin sync --plugin-root <test-pro's folder>`.
```

プロジェクトで別のハーネスが先に来る場合（たとえば `.kiro` の横に `.claude` フォルダがある場合）、ネイティブの `aidlc` はそちらに compose するので、コマンドはハーネスも示します: `aidlc engine plugin sync --harness-dir .kiro --plugin-root <test-pro's folder>`。

そこで sync するよう案内するすべての行（この行、変更したファイルを理由に拒否された sync、doctor の composed-surface と uncompiled-stage の修正）は、同じコマンドを示し、その行がプラグインの実際のフォルダを知っていればそれを使います。Claude Code がプラグインのレジストリ（`~/.claude/plugins/installed_plugins.json`）を持つ前のネイティブの Claude Code プロジェクトでは、`host inventory unavailable; run sync through an installed plugin's host hook` と伝えます。
エンジンを再インストールまたはアップグレードするたびに再実行してください。新しい `dist/<harness>/` をコピーすると、同梱のグラフとコアのステージソースが戻るため、以前に compose したプラグインのグラフのエントリと寄与のマージをもう一度適用する必要があります。プラグインの SessionStart フックを持つホスト（Claude、Codex、Cursor、Kiro IDE）は、次のセッション開始時にも自己修復します。Kiro CLI では明示的な sync が必要です。

`/aidlc plugin validate [path]` と `/aidlc plugin build <harness> [outDir]` は、同梱のスタンドアロンのオーサリングツールをトップレベルの CLI から公開します。検証の既定はカレントディレクトリです。ビルドもプラグインのルートの既定はカレントディレクトリで、別の場所から呼び出すときは `--plugin-root <path>` を渡します。どちらも `--json` を受け付けます。ベースの上に作られたプラグインの検証には、そのベースの自分のチェックアウトである `--with <base-root>` を渡します。そうすると、ベースのエージェントが主導するステージは、未確認として報告されるのではなく確認されます。

### `aidlc-utility recompose` - in-flight plan flips

`aidlc engine recompose [--skip <slug,...>] [--add <slug,...>] [--sensors <on|off>] [--learnings <on|off>] [--summary-confirmation <on|off>] [--collaborators <on|off>] [--review <adversarial|advisory|none>] [--message <id>] [--reason <text>]` は、生きた状態ファイル上で、PENDING かつカーソルより先にあるステージの計画の接尾辞を反転します。どちらのフラグもカンマ区切りの一覧を受け付け、繰り返し指定できます。すべての出現が累積され、重複した slug は 1 回として数えます。反転を少なくとも 1 つ指定し、一覧が空のフラグは省いてください。値のないフラグ、空白の値、空の CSV の要素、未知のフラグ、余分な位置引数は使い方のエラーで、反転は一切適用されません。設定のフラグは、反転と一緒に承認された設定を運びます。それらは同じ状態の書込みで適用され、`RECOMPOSED` の後に `CEREMONY_SET` や `REVIEW_CLASS_CHANGED` の行が続くため、1 回の承認で計画が中途半端に変わることはありません。`--message <id>` でそれらを承認したその人のメッセージを名指すと、エンジンがそのメッセージを証明した時点で、`config set` と同じく設定は `set by you` と表示されます。設定だけの変更は `config set` を通します。`--reason <text>` は、計画が変わった理由を `RECOMPOSED` の行に記録します。ジャンプがスキップしたステージを計画に戻すとき、エンジンがこれを渡します。

```bash
# Equivalent ways to skip both stages after approval:
aidlc engine recompose --skip market-research --skip team-formation
aidlc engine recompose --skip=market-research,team-formation

# Add both pending stages back:
aidlc engine recompose --add market-research --add team-formation
```

`mvp` の計画を実行中で Feasibility が進行中の作業では、Rough Mockups だけをスキップすることは、Refined Mockups がその出力を必要とするため拒否されます。両方をスキップすると通り、戻すと元に戻ります。

```text
$ aidlc engine recompose --skip rough-mockups
{"error":"Recompose rejected by the strict validator:\n  - Stage \"refined-mockups\" requires artifact \"wireframes\" whose producer(s) [rough-mockups] are not on the \"recomposed mvp\" path. Strict (recompose) mode rejects a starved required input.\n  - Stage \"refined-mockups\" requires artifact \"user-flow\" whose producer(s) [rough-mockups] are not on the \"recomposed mvp\" path. Strict (recompose) mode rejects a starved required input.\nTo make the change, also add a stage that produces what is missing, or also skip the stage that needs it."}
$ aidlc engine recompose --skip rough-mockups,refined-mockups
Recomposed: 2 skipped (rough-mockups, refined-mockups), 0 added (none)
Stages in scope: 20
Completed: 4/20
$ aidlc engine recompose --add rough-mockups,refined-mockups
Recomposed: 0 skipped (none), 2 added (rough-mockups, refined-mockups)
Stages in scope: 22
Completed: 4/22
```

監査ロックの下で実行され、残るステージから必須の入力を奪う反転を拒否します。ただし `/aidlc --skip` で名指ししたスキップは例外で、その後はそれを読むステージがあるものから実行されます（完了／進行中のステージ、カーソルより後ろのステージの反転（例外は Construction が始まる前の Reverse Engineering で、`next` がまだそれを実行しに戻る間はスキップでき、既存のコードでは戻すことができます。計画がスキップするステージを、その後の何も始まっていない間に作業がちょうど通り過ぎた場合も例外で、たとえば Requirements Analysis が承認された直後の User Stories は戻すことができ、`next` がそれを実行しに戻ります）、Construction の最初の EXECUTE ステージ（保護されたステージのルーティングの基点）をどちらかの方向に動かす反転、Status が Running でないワークフローへの recompose、そして自律的な Construction のもとで、あなたの要求が記録されていない recompose や `AIDLC_UNATTENDED=1` で実行した recompose も拒否します。その拒否は、各 Bolt で承認のために止まる方式へ切り替える `aidlc-bolt.ts set-autonomy --mode gated` を示します）。そして導出される状態フィールドを組み直し、`RECOMPOSED` を出します。ステージに対する各拒否は、代わりにできることを示します。そのステージへ、またはその先へジャンプする、`/aidlc --stage <slug> --single` で単独で実行する、欠けている入力に関わるステージを追加またはスキップする、それを実行またはスキップするスコープに変える、です。直接入力するものではなく、`/aidlc --skip <slug>`、`/aidlc --add <slug>`、スキップしたステージへのジャンプ、ワークフロー途中の `/aidlc compose` を通じて使われます。`/aidlc compose` の質問で承認した変更（そのマーカー `aidlc/.aidlc-compose-pending` がまだディスクにあり、新しい場合）では、出力の最後にエージェント向けの行がもう 1 つ付きます。マーカーを削除して `next` を実行するよう伝えるもので、あなたの作業は同じターンで続きます。

この作業がスキップしたステージを、AI-DLC が示す元に戻す方法で、または後から自分の言葉で戻すことも拒否されません。そのステージは、スキップの前に計画にあったとおりに判断されます。

その場でスキップしたステージ（スキップしたときに始まっていたので、スキップとして表示されるもの）は、`/aidlc --add <slug>` や自分の言葉でもう一度加えると計画に戻り、次に実行されます。対象は、Construction が始まっていない間の既存のコードでの Reverse Engineering（その後、作業はあなたがいたステージに戻ります）と、作業がその後のステージに入ったばかりの間のほかのステージです。作業がそれより先へ進んだ後は、加える操作は、ステージを単独で実行する方法 `/aidlc --stage <slug> --single` とともに拒否されます。

<a id="aidlc-engine-scope-save-keep-a-plan-as-a-scope"></a>

### `aidlc engine scope save` - keep a plan as a scope

`aidlc engine scope save --name <name> [--keywords <word,...>] [--intent <slug>] [--space <name>]` は、選択した作業の現在の計画を再利用可能なスコープとして保存します。計画が実行するステージ、深度、Guard Policy、5 つの手続きの設定（sensors、learnings、summary confirmation、plan approval、collaborators）、レビューのレベルを永続的な記録 `aidlc/scopes/<name>.md` に書き、コンパイルするので、このハーネスではすぐに `/aidlc --scope <name>` が使えます。別のハーネスは次の `graph compile` でそれを取り込みます。実行中の作業はそのままです。別の計画がすでに持つヒントは、その計画を示す 1 行とともに、頼まれたとおりに保存されます。「save this plan as quick-fix」と言ったときに、コンダクターがこれを実行します。compose ゲートで **Approve and save as scope** を選ぶと、作業の作成の一部として同じ保存が実行されます（`--save-as`）。キーワードも伝えていた場合は、代わりに作成の直後に実行されます。

たとえば、`mvp` の計画を実行中の作業では次のとおりです。

```text
$ aidlc engine scope save --name quick-fix
Saved as scope quick-fix (20 stages, sensors on, learnings on, summary confirmation on, reviews adversarial).
Next time: /aidlc --scope quick-fix "<what to build>"
```

名前は小文字の英字、数字、単一のハイフンからなり、英字で始まり、40 文字以内で、既存のスコープの名前であってはいけません。`--keywords` を付けると、要求の言葉からスコープを推定できるようになります。各キーワードは英字、数字、ハイフンからなる 1 語で、`validate-grid --keywords` と同じく、ほかのスコープが主張するキーワードと照合されます。付けなければスコープは `keywords: []` で出荷され、名前でだけ解決されます。greenfield の実行でのリバースエンジニアリングのスキップは保存されないため、そのスコープは既存のコードベースでは引き続きリバースエンジニアリングを行います。`SCOPE_SAVED` を出します。サブエージェントは実行できません。

### Creating a workflow with its own stage changes (`--skip` / `--add`)

`next --scope <scope> --skip <slug,...> --add <slug,...> -- "<description>"` は、この作業のためだけにステージを外したり加えたりして、`<scope>` 上にワークフローを作ります。コンダクターはカスタムの合成計画のためにこれらを渡し、あなたが入力することもできます。計画を名指さない依頼と一緒に入力した場合、それらは計画の質問でのあなたのものになります。Go ahead は提案された計画をそれらとともに作り、その一覧から選んだ別の計画も同様です（計画がすでに外しているステージや、すでに実行するステージは、その計画では変更の対象から外れます）。Tailor a plan はそれらをコンポーザーに渡すので、示される計画はそれらを含みます。各 slug はステージを指していなければなりません。初期化のステージ、両方の一覧にあるステージ、スコープがすでに行う変更（スコープがスキップするステージの `--skip`）は、何かが作られる前に拒否します。作業の状態は `Plan: <name>` を記録し（`--plan-name <name>`。コンダクターはコンポーザーが提案した名前とともにこれを渡します。小文字の英字、数字、ハイフン。付けなければ `tailored plan`）、スコープファイルは書かれません。コンダクターが **Approve and save as scope** のために渡す `--save-as <name>` を付けると、作成はその計画をその名前のスコープとしても保存します。その保存は [`scope save`](#aidlc-engine-scope-save-keep-a-plan-as-a-scope) が行います。使われている名前や、スコープの名前にできない名前は、何かが作られる前に拒否されます。実行中のワークフローでは、`/aidlc --skip <slug,...>` と `/aidlc --add <slug,...>` が `recompose` を通じて残りのステージをすぐに変え、承認の質問はありません（ステージを名指ししたのはあなたです）。何が変わったかと戻し方を 1 行で伝えます。同じコマンドで入力したスコープや設定が先に適用されます。名指ししたステージがすでに始まっている場合（進行中、変更を頼んだ後の改訂中、または自身の承認の質問で待機中）は、ステージの種類にかかわらずその場でスキップされ、作業は続きます。それが計画の最後のステージだった場合は作業が終わります（戻し方は、`/aidlc --stage <slug> --single` で単独で実行することです）。開いているゲートで同じメッセージに入力した承認も記録されるので、両方が一度ずつ起きます（複数のステージを示した質問では、「skip Functional Design and approve the rest」はスキップしなかったものをまとめて承認します）。Construction が Unit を 1 つずつ実行している間は、Unit がいるステップを、あなたの言葉に従って、その Unit だけ、またはここからすべての Unit についてスキップします（Unit を名指さないスキップは、ここからすべての Unit についてです）。1 つの Unit についての戻し方は `/aidlc --stage <slug> --unit <unit>` で、コードのステップをスキップした Unit にはチェックポイントがありません。Unit の歩みの後のステップ、または Build and Test のようなその後のステージは、すべての Unit について計画から外れます。加えたステージを作業がちょうど通り過ぎたところで、その後の何も始まっていない場合（「Approve, and add User Stories next」で承認が先に記録された場合）、そのステージは戻されて次に実行されます。加える操作が先に来た場合と同じです。計画が受け入れられない反転は、代わりにできることとともに拒否します。

スキップの後、その 1 行が示す元に戻す方法は、変更が名指した最も早いステージを作業が過ぎるまで（加えたステージなら、そのステージが始まるまで）、または計画にその後のものがない場合は作業が完了するまで有効で、その行はどちらかを伝えます。Construction が Unit を 1 つずつ実行している間、すべての Unit について計画から外した Unit の歩みのステップは、歩みの後の最初のステージが始まるまで有効です。作業はすべての Unit が終わるまで歩みに留まるためです。作業がまだ実行すべき Reverse Engineering は、最初の Construction ステージが始まるまで有効です。その後は、スキップしたステージは `/aidlc --stage <slug> --single` で単独で実行します。直前のステージの開いているゲートで入力したスキップは、その方法だけを示します。そのゲートを承認すると（同じ返答で普通そうします）、作業はすぐにそれを過ぎるためです。

`--depth` と `--test-strategy` は、正確に `minimal`、`standard`、`comprehensive` のいずれかを取ります。`next` はコマンドを示す前に、それ以外の値を拒否します。

### `aidlc-graph ars` - deterministic ARS scoring

`bun .claude/tools/aidlc-graph.ts ars --iae <s> --csu <s> --ve <s> --r <s> --ua <s> [--completed <csv>] [--project-type <t>] [--method <codekb|fallback>]` は、適応型コンポーザーの Autonomy Risk Score の算術を計算します。帯のラベル付きの重み付き合成値、成分ごとの LOW/MED/HIGH の帯、同梱のコストの事前分布に対するステージごとの期待値のふるい分け、グリッドの差分数による最も近いストックスコープ、markdown として事前に描画した 2 つのゲートの表です。重み、帯の境界、ステージのコストの事前分布、EV の閾値といったすべての定数は `tools/data/ars-priors.json` から読むため、同じ 5 つのスコアは常に同じ数値になります。コンポーザーは証拠から成分を採点し、掛け算をする代わりにこの出力を写します。ファイルが名前を挙げていないプラグインのステージは、それ自身の `ars:` frontmatter ブロックからふるい分けられるか（両方ある場合はファイルが優先）、`no-prior` の行になります。各行の `priorSource` がそのどちらかを示します（`shipped`、`stage`、`null`）。`--completed`（カンマ区切りの slug）は、すでに EXECUTE として実行されたステージを導出されるグリッドに残します。`--project-type brownfield|greenfield` は、コンパイルされた `condition:` がもう一方の種類のプロジェクトに制限するステージ（現在は brownfield 専用の Reverse Engineering）をふるい落とします。Reverse Engineering は、CSU ではなくプロジェクトの種別で決まります。既存のコードでは実行され、`--project-type` がない場合も実行されます（作成時に新しいプロジェクトからは外されます）。そしてステージ自身が、再びスキャンする前に、以前のスキャンが残したコードマップを確認します。`--method` は、コンポーザーの構造的な証拠の出所を示します。カスタム計画の合成の間、5 つのスコアと方法は保持され、計画の作成時にその最初の監査エントリ（`WORKFLOW_STARTED`: `ARS Scores`、`ARS Method`）に書かれます。`codekb` か `fallback` 以外は exit 1 です。JSON の結果は stdout に出ます。範囲外のスコア、未知のステージ slug、事前分布のスキーマ違反では exit 1 で、黙ったフォールバックはありません。合成値はゲートで人間が見るための **助言** の指標で、決定論的なルーティングがこれに基づくことはありません。

```bash
bun .claude/tools/aidlc-graph.ts ars --iae 0.55 --csu 0.75 --ve 0.65 --r 0.50 --ua 0.55
bun .claude/tools/aidlc-graph.ts ars --iae 0.30 --csu 0.80 --ve 0.40 --r 0.20 --ua 0.10 \
  --project-type greenfield --completed intent-capture,scope-definition
```

### `aidlc-graph validate-grid` - arbitrary-grid dependency check

`bun .claude/tools/aidlc-graph.ts validate-grid [--proposal <path>] [--strict] [--project-type <t>] [--keywords <csv>] [--guard-policy <strict|relaxed|off>] [--report] [--matched <stock-scope> | --custom]` は、任意の `{"<stage>": "EXECUTE"|"SKIP"}` の JSON グリッドを検証します。`--proposal` がなければ、コンポーザーの提案ファイル、つまり `detect --json` が出す `proposalPath` を読みます。提案はコンパイル済みのすべてのステージをちょうど 1 回ずつ名指ししなければなりません。欠けたステージ、未知のステージ、不正なアクションはエラーです。緩いモードは `validate-scope` と同じ扱いです（経路外の必須の生産者は advisory）。`--strict` はそれを強く拒否します（recompose の姿勢）。`--keywords` は、付与する各キーワードを、既存のスコープがすでに持つキーワードと照合します。共有されているものは、もう一方の計画を示す advisory になり（`The hint "bug" is also bugfix's; the plan proposal lists it under both.`）、グリッドは引き続き検証を通ります（コンポーザーは、キーワードを付与するときゲートの前にこれを実行し、`scope save --keywords` はヒントを保存して同じ行を表示します）。`--guard-policy`（または `stages` の横の `guardPolicy` メンバー。廃止済みの `--change-control` フラグと `changeControl` メンバーも引き続き解決される）は、コンポーザーが提案した Guard Policy の値を確認します。`strict`、`relaxed`、`off` 以外はエラーで、memory 層の `Mode: strict` のもとでの `relaxed` や `off` の提案はそのファイルを示して拒否され、受け入れた値は `guard_policy` と `change_control` の両方として返されます。`stages` の横の `scopeSettings` メンバーは、コンポーザーの 6 つのスコープ設定を確認します。正確に `sensors`、`learnings`、`summary_confirmation`、`plan_approval`、`collaborators`（それぞれ `on` か `off`）と `review_cap`（`adversarial`、`advisory`、`none`）を名指ししなければならず、未知のキー、欠けたキー、それ以外の語はエラーです。受け入れた値は `scope_settings` として返され、`summary.off` はそれらが off にするものを一覧します。`--matched <stock-scope>` または `--custom` は、front/report の提案についてのコンポーザーの経路を示します。どちらも `scopeSettings` と Guard Policy を必要とします。どちらの経路もスコープファイルは書きません。`--matched` は、そのストックスコープと異なるグリッドと、その既定値より低い Guard Policy を拒否します（より厳しい値は作成時に適用されるものです）。ほかの設定はどれが異なっても構いませんが、計画が実行されるスコープで plan approval がオンの場合に、それをオフにすることはできません（オフにするのは、ゲートで自分の言葉で伝えたその人だけです）。合格すると `routing`、`matched_scope`、`creation_settings`（作成時にこの作業へ適用される型付きの変更。例: `{"learnings": "off", "review": "adversarial"}`）を返します。`--custom` は計画が実行されるストックスコープを選びます。Guard Policy の既定値が提案の値以下の（`strict` ならどれでもよい）、ゲートが示さないものを何も加えない（ウォーキングスケルトンなし、計画の深度以外のテスト戦略なし）最も近いものです。`--project-type greenfield` では、条件を満たすものがあれば、`existing_code: true` と印の付いたスコープ（`bugfix`、`refactor`、`security-patch` は印付きで出荷）よりも新しい作業向けのものを優先します。合格すると `routing`、`base_scope`、`plan_changes`（そのスコープのグリッドを計画に変える `skip` と `add` のステージの一覧）、そのスコープに対する `creation_settings`、そして提案の `depth` メンバーがそのスコープのものと異なる場合は `creation_depth` を返します。`depth` メンバー（`minimal`、`standard`、`comprehensive`）を必要とし、どのストックスコープの既定値も同じかそれ以下にならない Guard Policy と、初期化のステージをスキップする計画を拒否します。front の compose の間、合格した `--matched` や `--custom` の実行は、compose のステップが開いた要求のためにその計画を、その `creation_depth`、`creation_settings`、そのスコープの既定値より上の Guard Policy とともに保持します。そのため、カスタム計画を承認すると、ゲートが示したステージ、深度、設定が作られます。`--matched` なしのすべての実行は、`custom_start` も返します。カスタム計画が始まる `guard_policy` と `scope_settings` で、計画がどのストックスコープ上で実行されるかにかかわらず `classic` スコープのものです（`classic` が有効なスコープでない場合は省かれます）。このマシンで無効化スイッチ（`AIDLC_DISABLE_*`。設定または記録されたもの）が強制的に off にする `on` の手続きにも advisory が付きます。スコープは `on` を保存しますが、その手続きは実行されないためです。結果は `nearest_stock` も持ちます。グラフ／プラグインが作成したすべてのストックスコープを、提案からのグリッドの距離で並べたものです（`{scope, diff, differs}` の昇順。コンポーザーが作成したスコープは除外）。そのため、一致かカスタムかというコンポーザーの判定は、LLM による数え直しではなく検証器の数値になります。`--report` は、コードの所見の報告のためのコンポーザーの実行です。このとき `nearest_stock` は `bugfix` と `security-patch` だけを並べ、`--custom` はその 2 つからベースを選び、それ以外のスコープでの `--matched` はエラーになります。そのため、報告が、たまたまグリッドが近い、より軽いスコープ（レビュアーも plan approval もない `express` など）に着地することはありません。その人が報告のスコープを自分で指定した場合、コンポーザーは `--report` なしで実行するので、その人の選択が保たれます。

`summary` は計画が実行するステージと承認ゲートを数えます。その `shown` の数（Initialization の後のステージ）が、その人が読むすべての行で使われる数です。`--project-type greenfield` では、新しいプロジェクトで作成時にスキップされる Reverse Engineering を除外するため、計画の提案が示す数は作成時に表示される数と同じになります。合格した `--custom` の実行は、計画自身の変更によって、計画が残すステージが、計画が実行されるストックスコープでは欠けない必須の入力を欠く場合に、`skipped_inputs` を加えます。スキップした各ステージを名前で、それが作るものを使うステージとともに示し（`[{"stage": "Units Generation", "used_by": ["Contract Design", "Functional Design", "Code Generation"]}]`）、計画の提案はそれを 1 行で一度だけ伝えます。ストックスコープ自身の作られない入力は、advisory のままです。

### `aidlc-sensor` — inspect and fire Sensors

センサーは、ステージ出力への `Write` や `Edit` のたびに実行される決定論的な検査です（[Rules and the Learning Loop](09-rules-and-the-learning-loop.md) とリファレンスの [Sensor System](../reference/07-sensor-system.md) を参照）。PostToolUse フックが代わりにそれらを発火します。このツールでは、一覧、説明、手動での発火ができます。

Sensors の手続きが `off` の場合、フックによる自動のディスパッチとブロッキングセンサーのゲートの検査は飛ばされます。フックはインストールされたままで、明示的な `fire` はここで説明する診断を引き続き実行します。

| サブコマンド | 動作 |
|------------|--------------|
| `list` | フレームワークのすべてのセンサー（`id`、`kind`、`description`）をアルファベット順に出す |
| `describe <id>` | センサー 1 つの完全なマニフェスト（コマンド、既定の重大度、`matches` の glob、タイムアウト）を出す |
| `fire <id> --stage <slug> --output-path <path>` | ファイルに対してセンサーを実行し、`SENSOR_FIRED` 行とその対になる結果の行を出す |

手動の発火は `SENSOR_FIRED` 監査行を出し、続いて終端の行をちょうど 1 つ出します。`SENSOR_PASSED`、`SENSOR_FAILED`、`SENSOR_COULD_NOT_RUN`（検査のスクリプトがクラッシュした、起動できなかった、または判定を出さなかった）、`SENSOR_BUDGET_OVERRIDE` のいずれかで、その後に簡潔な JSON の判定の行が続きます。失敗すると、`<record>/.aidlc-engine/sensors/<stage>/`（インテントのレコードディレクトリ内）に詳細ファイルを書きます。fire コマンドは、センサーの結果がどうであっても exit 0 で終わります。Sensors が `on` の場合、ゲートへの入場は別途 `blocking` の結び付きを強制し、検証済みの合格を要求します。所見、使えないツール、実行できなかった検査、ディスパッチャーのエラー、不正な判定、タイムアウトはどれもそれを止めます。対話的な上書きは、別途記録される `Fix findings` / `Override blocking sensors` の判断と、それに続く人間が裏付けた正確な回答、そして `--override-blocking-sensors --user-input "Override blocking sensors"` を使った再試行です。自律モードでは上書きできません。書込みで発火した結果は advisory のままです。フレームワークに同梱される 6 つのセンサーは、`claim-sources`、`required-sections`、`upstream-coverage`、`traceability`、`linter`、`type-check` です。

```
bun .claude/tools/aidlc-sensor.ts list
bun .claude/tools/aidlc-sensor.ts describe required-sections
bun .claude/tools/aidlc-sensor.ts fire required-sections \
  --stage requirements-analysis \
  --output-path aidlc/spaces/default/intents/<YYMMDD>-<label>/inception/requirements-analysis/requirements.md
```

### `aidlc-learnings` — the learning-gate tool

第 13 節の学びのステップの決定論的な半分です。ステージの完了メッセージの後、その承認の質問の前に、そのステージであなたがエージェントを訂正していた場合、オーケストレータはこれを使って、各訂正についての質問を出し、あなたが残すもの（と、質問なしで残すよう頼んだメモ）を保存します。通常これを直接呼ぶことはありません（オーケストレータが自身の質問の前後で両方のステップを動かします）。ここに載せているのは、これが出す監査行の意味が分かるようにするためです。質問は [Rules and the Learning Loop](09-rules-and-the-learning-loop.md) で示しています。

Learnings の手続きが `off` の場合、ワークフローはこれらのステップを自動で呼ぶ代わりに、日誌と学びのゲートを省きます。

| サブコマンド | 動作 |
|------------|--------------|
| `surface --slug <stage-slug> [--correction <your change> \| --correction-file <file>]...` | エージェントがあなたの言葉から読み取った訂正ごとに、質問「You asked me to <it>. Keep that for next time?」を `Yes, for this project`、`Yes, for the team`、`No` とともに出し（訂正がなければ質問はない）、選択を書き込む `selections_file`（作業ごとに 1 つ、その記録の中）を示す。ステージの `memory.md` 日誌は数えるだけで、提示はしない。読み取り専用 |
| `persist --slug <stage-slug> --selections-json <selections_file>` | 確認した学び（確認した学びはプラクティスになる）を `aidlc/spaces/<active-space>/memory/project.md` / `team.md` に書き（センサーに結び付く学びの場合は、プロジェクト層のセンサーの足場を作って結び付け）、`RULE_LEARNED` / `SENSOR_PROPOSED` を出す。読むのは、選択自身の作業について `surface` が示した `selections_file` だけで、それ以外のパスは拒否する |

確認した学びは、現在のワークフローの次の該当するステージから（ルールファイルは各ステージの配信の前に読み直されます）、そしてそれ以降のすべてのワークフローでエージェントに届きます。新しいセンサーは次のステージグラフのコンパイルで結び付きます。

`surface` は、マシンローカルのファイル `runtime-graph.json` がコンパイルされていればそこから日誌の場所を見つけ、されていなければ同じパスを自分で導きます。後者はワークフローの最初のゲートでの通常の状態で、新しいクローンも同じです。その場合、グラフを組み直す `aidlc engine runtime compile` を示す注記を stderr に出します。stdout の出力には影響しません。

### `aidlc-runtime` — read the runtime graph

ランタイムグラフ（インテントのレコードディレクトリの `runtime-graph.json`）は、このワークフローで実際に起きたことのデータプレーンの記録です。どのステージが実行されたか、各 `memory.md` 日誌がどれだけ埋まったか、どのセンサーが発火し、それぞれ何を返したか。構造的な `stage-graph.json` の実行時の写しです。フレームワークはステージの遷移のたびにそれを再コンパイルします。このツールでは、コンパイルの起動と、1 つのステージの行の読取りができます。

| サブコマンド | 動作 |
|------------|--------------|
| `compile` | `audit/` シャードとステージごとの `memory.md` ファイルをたどり、`runtime-graph.json` を書き直す。遷移のたびにフックが自動で発火する |
| `read <stage-slug>` | `runtime-graph.json` から 1 つのステージの行（時刻、エージェント、memory の内訳、センサーの発火、結果）を出す |
| `summary [--json]` | グラフ全体についての決定論的な集計 — ステージ／フェーズの結果の集計、memory のエントリ数、センサーの 5 状態の集計、得られた学び、ワークフローの所要時間を出す。読み取り専用のセッションスキルが読むデータ源 |

```
bun .claude/tools/aidlc-runtime.ts read requirements-analysis
```

`runtime-graph.json` は gitignore されます。成果物の形は [Artifacts Reference](14-artifacts-reference.md)、完全なスキーマはリファレンスの章 [Runtime Graph](../reference/13-runtime-graph.md) を参照してください。

### `aidlc attest` — コミット来歴

「このコミットの変更を所有するのはどのレビュー済みの作業単位か、そしてコミットされた内容はレビュアーが承認したものとまだ一致しているか」に答えます。帰属は、コミットされた内容だけから導かれます。`audit/` シャードにあるレビューのレシートと、コミットされた `reviewed-source-*.tsv` の証拠ファイルを、チェックアウトではなく git のツリーから読みます。そのため、通常の手動の `git commit` でも、どのクローンでも、フックもコミットメッセージの trailer も push された ref もなしに動き、同じコミットは常に同じように解決されます。

| サブコマンド | 動作 |
|------------|--------------|
| `resolve [<commit>]` | 読み取り専用。コミットの first-parent の差分（既定は `HEAD`）をレビュー済みの単位に帰属させ、変更された各パスを分類する: `verified`（コミットされた内容がレビューされた内容と等しい）、`drifted`（レビュー済みだがその後編集された）、`unattested`（どの単位も主張しない）、`unverifiable`（証拠が欠けている、改ざんされている、または gitignore されたローカルのスナップショットにしかない — 安全側に失敗）、`indeterminate`（レシートが曖昧 — 安全側に失敗）、`excluded`（フレームワークのシェル／記録のパス — 範囲のベースのツリーですでに確立されたハーネスのシェルで、変更が導入したマニフェストや、チェックアウトにだけインストールされたシェルではない）。JSON の報告を stdout に出す。`--commit <rev>` は位置引数のフラグ形式として受け付ける |
| `resolve --diff <base>..<head>` | 任意の範囲について同じ分類を行う（`...` はマージベースを使い、マージリクエストの意味論に合わせる） |
| `resolve … --fail-on drifted,unattested,unverifiable,indeterminate` | いずれかのパスが指定した状態のどれかに一致すれば exit 3 — ゲートの形式。4 つの任意の部分集合を受け付ける。**検証されていないパスを通すつもりでない限り 4 つすべてを指定する** — `unverifiable` を省くと、レビューされた内容を何も確認できなかったパスを通してしまう |
| `resolve … --record-ref <ref>` | テスト対象のコミットではなく `<ref>` のツリーからレシートと証拠を読む。変更が書き込めない ref（保護されたブランチ、記録専用の ref）を指定すれば、変更が自分の承認を用意することを防げる |
| `resolve … --require-trust <level>` | 報告自身の根拠が `informational` \| `reproducible` \| `independent` \| `signed` に達しなければ exit 3（`signed` は、判定が依拠するすべての入力 — 依拠した各レシートの監査シャードと、それが選ぶ証拠ファイル — が署名付きのコミットで届いたことを意味する）。すべての報告は、どれに達したかとその理由を示す `trust` オブジェクトを持つ |
| `anchor [--commit <rev>]` | そのコミットがレビュー済みの主張を取り込んだことを記録する `SOURCE_COMMITTED` 監査行を追記する。付加情報にすぎない — `resolve` はアンカーを決して読まないので、アンカーのない手動のコミットは何も失わない。既定では明示的に実行する。`AIDLC_SESSION_ANCHOR=1` を設定すると、セッション開始時に最近のコミットも走査する |
| `anchor --reconcile [--max-commits <n>]` | first-parent の履歴（既定 100 コミット）を走査し、帰属できるコミットのアンカーを補う。すでにアンカーのあるコミットと swarm でマージされたコミットは飛ばし、帰属できないものは報告する |

```
# Gate a branch: three-dot (merge-base) range, all four failable statuses,
# receipts read from a ref the branch cannot write
bun .claude/tools/aidlc-attest.ts resolve --diff origin/main...HEAD \
  --record-ref origin/aidlc-records --require-trust independent \
  --fail-on drifted,unattested,unverifiable,indeterminate
```

この手順の成否を分ける細部が 3 つあります。`...`（3 ドット）を使ってください。`origin/main..HEAD` は *先端* 同士の差分を取るため、分岐点の後で `origin/main` に入ったものがこのブランチの変更として現れ、誤って失敗します。十分な履歴を取得してください。浅いチェックアウト（`actions/checkout` の既定は深さ 1）には境界の親コミットがなく、`resolve` はツリー全体を黙って分類するのではなくエラーとして報告します。`fetch-depth: 0` を設定してください。そして、*報告* しているのか *強制* しているのかを意図して決めてください。`--record-ref` がなければ、自分のレシートを書く変更は自分自身を検証できます。報告はそれを示しますが（`trust.level: reproducible`）、防ぎはしません。2 つの trust のフラグを外せば、正直な情報としての報告になります。

どちらの動詞も `--repo <name>`（複数リポジトリのインテント）、`--space <name>`、`--intent <dir>` を受け付け、もう一方の動詞のフラグは無視せずに拒否します。脅威モデル、信頼の段階、状態の意味論は、リファレンスの章 [Commit Provenance](../reference/20-commit-provenance.md) を参照してください。

### Session skills — report on a workflow

読み取り専用のスキル 3 つが、`aidlc engine runtime summary` の報告を読みやすい出力に包んで表示します。コマンドのように入力します。

| スキル | 動作 |
|-------|--------------|
| `/aidlc-session-cost` | 決定論的なコスト表示（所要時間、ステージの結果、memory、センサー、学び）。端末のみ |
| `/aidlc-replay` | 非同期のレビュー向けの、読みやすいセッションの物語。端末のみ |
| `/aidlc-outcomes-pack` | チーム向けの引き継ぎ文書。`OUTCOMES.md` を書く |

3 つとも読み取り専用で、ステージを進めず、監査も出さず、すべての数値を `aidlc engine runtime summary --json` から取ります。ハーネスがスキルをスラッシュコマンドとして出さない場合（`/aidlc-session-cost` が無効と報告される場合）は、そのコマンドを直接実行してください。同じコスト表示が得られます。全体の流れは [Session Management § Session Skills](11-session-management.md#セッションスキル) を参照してください。

---

## 環境変数

AI-DLC は以下のすべての変数を、ホストのツールが AI-DLC を実行する環境から読みます。あなたのシェル、ホスト自身の設定（`.claude/settings.json` の `env` ブロックなど）、またはエンジンが自身の子プロセスに渡す値です。プロジェクトの `.env` ファイルは AI-DLC の設定ではありません。インストールされたエンジンはそれを決して読まないため、クローンしたリポジトリがそれを同梱して AI-DLC の動きを変えることはできません。

### `AWS_AIDLC_DEFAULT_SCOPE`

プロジェクトの暗黙のスコープをあらかじめ設定します。リゾルバーは、実際の環境変数（`.claude/settings.json` の `env` ブロックが与える値を含む）、次に記録済みの `aidlc config flags --default-scope` の値、最後に `classic` を読みます。

**構文（`.claude/settings.json` 内）:**

```json
{
  "env": {
    "AWS_AIDLC_DEFAULT_SCOPE": "classic"
  }
}
```

**有効な値:** `enterprise`、`feature`、`mvp`、`poc`、`bugfix`、`refactor`、`infra`、`security-patch`、`classic`、`workshop`、`express`。

**優先順位:** 明示の CLI フラグ > エージェントが提案してあなたが確認した計画 > 実際の `AWS_AIDLC_DEFAULT_SCOPE` 環境変数 > 記録済みの default-scope フラグ > `classic`。共有の既定値は `aidlc config flags --default-scope feature --project --yes` で、このチェックアウトだけなら `--local` で記録します。同梱の settings の env エントリを含む実際の環境変数の値は、どちらの記録よりも優先します。

**効く範囲:** ワークフローの初期化時だけです。インテントの `aidlc-state.md` ができた後は、状態ファイルが正本です。全体の流れは [Customization § Per-Project Default Scope](13-customization.md#プロジェクト既定スコープ) を参照してください。

### 手続きの無効化スイッチ

`AIDLC_DISABLE_SENSORS`、`AIDLC_DISABLE_LEARNINGS`、`AIDLC_DISABLE_SUMMARY_CONFIRMATION` は、正確に `1` に設定すると、それぞれ対応する手続きを `off` に強制します。状態ファイルを書き換えずに、インテントごとの設定とスコープの設定を上書きします。優先順位、既定値、記録できる `aidlc config flags --bypass` の形式は [手続きの切り替え](#aidlc-sensors-learnings-summary-confirmation-ceremony-controls) を参照してください。

---

## 次の章

- [Skills and Runner Commands](17-skills.md) — 入力できる `/aidlc-<scope>` と `/aidlc-<stage>` のランナー、`--single` がすること
- [Session Management](11-session-management.md) — 再開、やり直し、ステージジャンプの詳細
- [Scopes, Depth, and Test Strategy](05-scopes-and-depth.md) — スコープの定義、ステージの対応、テスト戦略の水準
- [Troubleshooting](15-troubleshooting.md) — コマンドの動きが想定と違うとき
- [Glossary](glossary.md) — command、utility command、scope の定義
