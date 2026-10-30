# スペースとインテント

[最初のワークフロー](02-your-first-workflow.md) では、1 回の実行を最初から最後まで追いました。実際の仕事は、そう一列にはなりません。機能を進めている途中に緊急のバグが入り、別チームが同じリポジトリを共有する、というのが普通です。この章では、AI-DLC が **一つの場所** — *ワークスペース* — に **複数** の仕事をどう置くか、そしてそこを動く二つの概念、**スペース** と **インテント** を説明します。

**インテント** は仕事 1 件（ライフサイクルの 1 回の実行）を表し、**スペース** はチームのインテント、ナレッジ、プラクティスをまとめる場所です。ほとんどの人は `default` という一つのスペースだけで動き、スペースを意識しません。インテントを始めて、切り替えるだけです。この章の残りは、その動きと、ものがどこに置かれるかです。

---

## 一つのワークスペースを、いまの仕事で分ける

`aidlc config` を実行すると、選んだエンジンがハーネス自身のディレクトリ（Claude Code は `.claude/`、Kiro は `.kiro/`、Codex は `.codex/`、Cursor は `.cursor/`、opencode と GitHub Copilot は `.aidlc/`）と、そのハーネス自身が読むフォルダ（Codex は `.agents/skills/`、opencode は `.opencode/`、GitHub Copilot は `.github/`）に投影されます。レイアウトのうちハーネスで違うのは、そこだけです。以降、AI-DLC が作るものはすべて、プロジェクトルートの中立な `aidlc/` に置かれます。並びは *どのハーネスで走らせたか* ではなく *いま何をやっているか* です。見るのは `aidlc/` で、エンジンのディレクトリを開く必要はありません。

次は、チームが二つ、進行中のインテントがいくつかある、完成したワークスペースです（エンジンディレクトリは `.claude/` で書いてあります。Kiro や Codex では `.kiro/` や `.codex/` と読み替えてください）。上から下へ読んでください。この章の頭の中の地図になります:

```
my-project/
│
├── .claude/                      THE ENGINE — tools, hooks, skills, agents.
│                                 (or .kiro/ / .codex/ — the one harness-specific dir)
│                                 You never browse this; it just runs /aidlc.
│
├── aidlc/                        EVERYTHING AI-DLC — neutral, browsable, committed to git
│   ├── active-space              ← cursor: which space you're in (gitignored, per-user)
│   └── spaces/
│       ├── default/              ★ the only space most people ever see
│       │   ├── memory/           THE METHOD — how this team works (committed)
│       │   │   ├── org.md          framework defaults
│       │   │   ├── team.md         your team's practices  (adds to org)
│       │   │   ├── project.md      project-specific practices (adds to org and team)
│       │   │   ├── phases/         phase-scoped rules
│       │   │   └── templates/      your output-format overrides, one per artifact
│       │   │
│       │   ├── knowledge/        DOMAIN KNOWLEDGE — standards an agent reads (committed)
│       │   │   │                   free-form; empty until you add files
│       │   │   ├── documents/      YOUR ORIGINALS — PDFs, Word, Markdown (you own this)
│       │   │   │                     nest them however you like; never reorganised
│       │   │   └── documentkb/     THE CATALOG — derived from documents/ (tool-owned)
│       │   │       ├── index.json     every indexed document, with its state
│       │   │       └── <doc-id>/      metadata.json + extracted content.md
│       │   ├── codekb/           CODE KNOWLEDGE — what each repo is (committed, per-repo)
│       │   │   └── <repo>/          architecture, component inventory, freshness marker
│       │   │
│       │   └── intents/          THE RECORD — one subdir per piece of work
│       │       ├── active-intent   ← cursor: which intent is current (gitignored)
│       │       ├── intents.json    the registry: every intent + its scope/repos/status
│       │       ├── 260620-inventory-api/        ✓ a completed intent
│       │       └── 260624-export-bug/           ◷ an in-flight intent
│       │           ├── aidlc-state.md             where this intent is in the lifecycle
│       │           ├── audit/                     the decision trail
│       │           └── inception/requirements-analysis/requirements.md   …artifacts
│       │
│       └── payments-team/        another SPACE (another team) — identical shape
│           └── memory/  knowledge/  codekb/  intents/
│
├── repo-a/                       YOUR CODE REPOS live as siblings (each its own git)
└── repo-b/                       an intent can span more than one
```

このツリーは、コードリポジトリが複数あるプロジェクトを示しています。リポジトリが一つのプロジェクトも同じで、リポジトリそのものがワークスペースになります（[`aidlc/` の置き場所](#aidlc-の置き場所)）。

このディレクトリツリーから抜き出すべきは三つです。それが全体の考え方です:

- **`aidlc/spaces/<space>/`** は、一つのチームが完結した世界です。方法論（`memory/`）、ナレッジ、コードナレッジ、全インテントの記録。`spaces/default/` は最初からあり、一人開発者や単一チームなら、それより先は見ません。
- **`intents/<YYMMDD>-<label>/`** は仕事 1 件です。[最初のワークフロー](02-your-first-workflow.md) が埋めていった、実行ごとのレコードです。`<YYMMDD>` は短い UTC 日付なので、レコードは時系列に並びます。`<label>` は人が読める短い名前です。同一性そのものはディレクトリ名ではなく、レジストリの UUIDv7 が持つので、同日同ラベルのインテントも別物のままです。
- **カーソルは二つ** — `active-space` と `active-intent` が、*いまどこにいるか* を記録します。利用者ごと（gitignore）なので、二人のチームメイトが別のインテントに同時にいても、共有ファイルを奪い合いません。

> **古い版からのアップグレード?** 以前のリリースは、プロジェクトルートの平坦なディレクトリにワークフローを一つだけ置き、新しい実行が上書きしていました。ワークスペースモデルは、上のインテントごとのレコードディレクトリに置き換えるので、複数の仕事を並べても、一方が他方を潰しません。

---

## インテント — 仕事 1 件につき 1 つ

**インテント** は、AI-DLC ライフサイクルの 1 回の実行で、一つの作業にスコープされます。どのインテントも、スペースの `intents.json` レジストリに 1 行持ちます — `{uuid, slug, dirName, scope, repos, status}` — そしてその実行の状態、監査証跡、成果物を抱える **レコードディレクトリ** を持ちます。衝突しない正式な同一性は `uuid`（UUIDv7）です。`dirName` は、人が読むレコードディレクトリ名をそのまま残します。手で編集して末尾のカンマ、コメント、BOM が残っても、すべての行として読まれます。何も読めない一覧が上書きされることはありません。次の新しい作業は、そのバイト列を新しい一覧の隣に `intents.json.unreadable-<UTC time>` として残し、そのことが一度伝えられます。

行の `status` はインテントのライフサイクルを表します。作成時は `in-flight`、対象となる最後のゲートを閉じると `complete`、完了させない仕事を終了したり、完了した仕事を隠したりするために `/aidlc intent archive <name>` を実行すると `archived` になります。アーカイブしても何も削除されません。レコードディレクトリ、監査証跡、Bolt の worktree はそのまま残り、通常の一覧から非表示になるだけで、`/aidlc intent list --all` では表示できます。`/aidlc intent unarchive <name>` で、進行中または完了の元の状態へ戻せます。

インテントを作る専用コマンドはありません。仕事を初めて書いたとき、エージェントがそのための計画を提案します:

```
/aidlc Build a REST API for inventory management
```

計画を確認すると、AI-DLC はインテントとそのレコードディレクトリ（[はじめに](01-getting-started.md) の実行では `aidlc/spaces/default/intents/261013-inventory-rest-api/`）を作り、それをアクティブなインテントにして、前の章と同じように最初のステージを始めます。

### 二つ目の仕事を始める

ワークスペースが効くのはここです。機能の途中で、無関係なバグに手が要るとします。アーカイブも init コマンドも不要です。新しい仕事を書くだけです:

```
/aidlc Fix the timeout on the export endpoint
```

すでにインテントがアクティブなとき、AI-DLC はこれが *いまの機能の続き* ではなく *新しく、無関係な* 仕事かもしれないと見て、一つ目の横に二つ目のインテントを始める前に **確認します**:

```text
 New request
 Work is already in progress on: "Build a REST API for inventory management". You said: "Fix the
 timeout on the export endpoint". What should I do?
 > 1. Part of the active work
      Continue the current workflow
   2. Separate new piece of work
      Set it up alongside the current one as "bugfix" work (6 stages, 6 approval gates) without changing it
   3. Reshape the active work
      Change how the remaining plan is shaped
   4. Type something.
   5. Chat about this
```

- **2** を選ぶと、AI-DLC はそのオプションが示す計画とその大きさで、一つ目の隣に二つ目のインテントを作ります（ここではエージェントが `bugfix` を提案しました）。オプションが計画を示さない場合は、次に新しい仕事の計画を選びます。その実行でエージェントはこう言いました。「I've set up the export timeout fix as a separate piece of work using the bug-fix plan, and it's waiting at Requirements Analysis. Your inventory API work is unchanged at the feasibility stage.」一つ目のインテントのレコードディレクトリ、状態、進捗は、置いた場所にそのまま残ります。
- **1** を選ぶと、AI-DLC はメッセージをアクティブなインテントの一部として扱います。
- **3** を選ぶと、AI-DLC はアクティブなインテントの残りの計画をどう組み直すかを、あなたと一緒に考えます。

仕事を続けることだけを自分の言葉で伝えた場合（`/aidlc carry on`、"proceed"、"keep going"）は何も聞かず、AI-DLC はその言葉を読んでアクティブな仕事を続けます。プロジェクトに仕事があるのにまだどれも選ばれていない場合は、どれを再開するかを聞きます。言葉で仕事を名指しすれば（`/aidlc continue auth`）、その仕事を選んで、すぐに続けます。

新しい仕事と一緒に入力した設定は、あなたが選んだ仕事に適用されます。`/aidlc --depth minimal --learnings off Fix the timeout on the export endpoint` でも同じ質問が出ます。**2** を選ぶと新しいインテントがその深度と learnings オフで始まり、**1** か **3** を選ぶとそれらはアクティブなインテントに適用されます（**3** の場合は計画を組み直す前に）。この方法で下げた Guard Policy も選んだ仕事に適用され、AI-DLC がそのことを一度伝えます。チームが Guard Policy を strict に保っている場合、新しいインテントは strict で作られます。先に計画を指定した場合（`/aidlc bugfix Fix the timeout`）も同じ質問が出て、その計画が提案されます。計画の名前が自分の最初の単語でもある場合（`classic car rental website`）は、アシスタントがどちらの意味かを読み取り、一度だけ尋ねることがあります。そのため、選んでいない計画にあなたの単語が使われてしまうことはありません。アクティブなインテントと異なるスコープを説明付きで入力した場合（`/aidlc --scope express "add a health endpoint"`）も同様で、このときは新しい仕事が先頭に来ます。**1** を選ぶと説明が新しい express の仕事として始まり、アクティブなインテントはそのまま残ります。**2** を選ぶとアクティブなインテントが express に変わります。説明のない `--scope`（`/aidlc --scope express`）は、聞かずにアクティブなインテントのスコープを変えます。ほかの計画の名前だけを入力した場合（`/aidlc workshop`）は、その計画での新しい仕事を意味することも、アクティブなインテントをその計画へ移すことを意味することもあります。アシスタントはどちらの意味かを読み取り、判断できないときは一度だけ尋ねます。その計画での新しい仕事は、何かが始まる前に、その仕事の目的を尋ねます。

AI-DLC が二つ目のインテントを、聞かずに作ることはありません。ゲートへの返答や要件の訂正など、いまの仕事の続きなら、アクティブなインテントに留まります。提案が出るのは、仕事が明らかに別物のときだけです。

### インテントを切り替える

スペース内のインテントを一覧し、名前（slug）で切り替えます。同じ実行で、エクスポートの修正がアクティブなときです:

```text
> /aidlc intent
Intents in space "default":
  261013-inventory-rest-api  [in-flight]
* 261013-export-timeout-fix  [in-flight]

> /aidlc intent inventory-rest-api
Now working on inventory-rest-api. You were on export-timeout-fix: /aidlc intent export-timeout-fix goes back.
```

`*` はアクティブなインテントを示します。

切り替えは、呼び出したセッションの紐づけを更新し、`active-intent` カーソルへ書き通します。そのセッションの次の `/aidlc` は、止まった場所からインテントを再開します。同じステージ、同じ状態、同じ監査証跡です。インテントはいくつでも同時に抱え、自由に行き来できます。それぞれ独立した実行です。

> 引数なしの `/aidlc intent` は読み取り専用で、一覧するだけです。機械可読にするなら `--json` を付けます。フラグの全体は [CLI コマンド](12-cli-commands.md) です。

### 一つのチェックアウトでの並行セッション

実行中のセッションは、マシンローカルの紐づけを `aidlc/.aidlc-sessions/<session-id>.binding.json` に持ちます。紐づけはそのセッションのスペースとインテントを記録するので、別のターミナルや IDE ウィンドウが共有カーソルを動かしても、このセッションのワークフローは黙って動きません。

紐づけには、そのインテントがどう選ばれたかも記録されます。レコードが見つかることと、それに参加することは同じではありません。チームメイトのインテントのレコードはコミットされていても自分の `active-intent` カーソルはない新しいクローンでは、唯一のレコードは解決されますが、どのセッションもまだ参加していません。最初の `/aidlc` はどのインテントで作業するかを聞き、セッションが `/aidlc intent <slug>` を実行する（または自分のインテントを作る）か、このマシンがそのレコードを選ぶ（別のチャットや端末から、`active-intent` カーソルがそれを名指しする）まで、AI-DLC のフックはそのレコードに触れません。後者の場合、チャットは次のターンで、選択の後に開いたチャットと同じように、何も言わずにそれに参加します。参加していないチャットで入力したものも、インテントのレコードの外にある、そのチャット自身のメッセージ記録に保持されます。以前の版で紐づけられたセッションは、カーソルが同じレコードを指していればそのインテントで作業を続け、そうでなければそのインテントへの紐づけ直しを提案されます。以前の版がスタンプだけを付けて紐づけなかったセッションは、再開時にそのスタンプに従うので、アップグレードをまたいで開いたままのチャットは自分のインテントを続けます。AI-DLC の worktree コマンドを使わずに作った素の `git worktree` にもローカルの手がかりがないため、同じく `/aidlc intent <slug>` でインテントを選びます。このマシンで取得した Unit は、その Unit のインテントへの参加として数えます。Unit 参加者マーカーはチェックアウト全体のもので、インテントを名指ししないため、特定のレコードへの参加には数えません。

セッションの同一性は、次の順で決まります:

1. フックに渡されたホストのセッション id
2. ハーネスプロセスから継いだ、有効な `AIDLC_SESSION_OVERRIDE`。または、AI-DLC の opencode プラグインが、実行中のチャットについて各シェルコマンドに渡すもの（opencode の `shell.env` フック）。これにより、一つの opencode ウィンドウの二つのチャットが、それぞれ自分の仕事に作用します。
3. ホストがエージェント自身のシェルで名指しするチャット: Codex の `CODEX_THREAD_ID`、`CLAUDE_PID` が名指しするプロセスが生きている間の Claude Code の `CLAUDE_CODE_SESSION_ID`、または Kiro CLI の `KIRO_SESSION_ID`。チャットが終わった後も開いたままのシェルは変数を持ち続けるため、Claude Code の id はそのチャットのプロセスが生きている間だけ読みます。死んだ pid や pid がない場合は読みません。Kiro CLI はシェルに pid を置かないので、その id は Codex と同じく単独で扱います。ほかのハーネスは、そこでチャットを名指ししません。
4. 最も近い、実行中の祖先 PIDのエントリ
5. セッション識別情報なし

こうして見つかったすべての id と、すべてのフック payload のセッション id は、チャットや作業の記録を読む前に、一つの入口を通ります。ヘルパー自身の id（起動された Codex のエージェントやレビュースレッド、Kiro CLI の委任、Copilot のサブエージェントのもの）は、それが属するチャットに対応付けられます。アダプタは、両方が現れる最初のフック payload からその組を書き留めます。これはエンジンが自力では知りえない唯一の事実です。次にそのチャットの紐づけを読み、まだ紐づけのないチャット（ホストがそのチャットで SessionStart を一度も実行しなかった場合や、チャットを開いた後にフックをインストールした場合）は、最初の接触時に、SessionStart が新しいチャットに適用するのと同じ規則で紐づけます。このマシンが参加していれば共有カーソルが名指しする仕事へ、そうでなければどのレコードにも紐づけず、何も言いません。以後、チャットはその仕事に留まります。別のウィンドウで入力した切り替えはカーソルを動かし、チャットは動かしません。ここにある唯一のレコードがまだ選ばれていなかったためにどのレコードにも紐づかなかったチャットは、入るたびに読み直されます。カーソルがレコードを名指しした時点で、同じように何も言わずにその仕事に参加します。セッションの同一性をまったく持たないコマンド（あなた自身の端末）は、カーソルに従い続けます。

同一性が分かったその後の優先は、明示のスペース／インテントセレクタ、そのセッションの紐づけ、共有の `active-space` と `active-intent` カーソル、既存の「インテントが一つだけ」「空のワークスペース」フォールバック、の順です。

ヘッドレスの自動化では、`AIDLC_SESSION_OVERRIDE` は個別のツールコマンドではなく、ハーネスのプロセスに付けます。起動されたツールは同じ同一性を継ぎます。その上書きが PID 祖先から見つかったセッションと食い違うと、AI-DLC はどちらのワークフローにも書く前に拒否し、所有している会話か、インテント／スペースの切り替え動詞で結び直すよう案内します。`AIDLC_SESSION_OVERRIDE_SOURCE=payload` は、同じ利用者の内部契約であり、認証されたセキュリティ境界ではありません。両方の変数を意図して付けると、許可されたセッション切り替えとして扱います。

カーソルは、書き通しの互換状態のままです。紐づけがない古い環境や未対応環境は、以前とまったく同じ動きです。

セッション紐づけは、スペースをまたいだワークフロー選択を隔離します。一方、ハーネスネイティブの方法論 include は、チェックアウト全体で一つの面のままです。どの include も、アクティブなスペースの memory ファイルの gitignore されたコピー一つ、`aidlc/active-memory/` を読み、SessionStart とスペース切り替え動詞が選んだスペースについてそれを書きます。そのため、別スペースで同時に実行されるセッションが、ハーネスが次に渡す環境ルールのスペースを上書きし合えます。この段階が支えるのは、一つのスペース内での並行インテントです。複数スペースへの環境方法論の同時配送は、まだこれからです。

スペースの切り替えは、追跡対象のファイルを何も変えません。include はチームメイト全員で同じで、`aidlc config` がほかの出荷ファイルと同じように更新します。以前のリリースの切り替えが include を別のスペースへ向けていたインストールも、次の更新で出荷ファイルに戻り、衝突は起きません。

Codex アダプタは、検証済みのフック payload セッションをすべてのコアフックの子に固定し、Codex は実行するすべてのコマンドにセッションを `CODEX_THREAD_ID` として渡します（0.145.0 以降。AI-DLC がサポートする最低版です。フックには渡されません）。そのためツールはそこから id を読み、すべてのコマンドはエージェントが書いた言葉のまま残ります。macOS サンドボックスが `ps` を拒んでも Codex のワークフロー選択は弱まらず、出荷される `.codex/rules/default.rules` の接頭辞はエージェントが実行するものと一致します。Windows x64とarm64では、ネイティブのプロセスハンドル、生成時刻、親PIDから所有セッションを特定します。上限は Linux や macOS と同じ 2 秒・64祖先です。再利用されたPIDや検証できない祖先からセッションを選びません。一つのプロセスを共有するハーネスも、チャットを区別できません。Kiro IDE のマルチチャットが該当します。マルチセッションの opencode では、シェルコマンドはそのチャットを運びます（項目 2）。ファイル書き込みの監査行とセンサー、To-Do リストの同期も同様です。payload 付きフックの子は payload のセッションに従います。その親がないツールは、祖先が取れなければ共有カーソルに落ちます。ただしハーネスプロセスに有効な `AIDLC_SESSION_OVERRIDE` がある場合を除きます。

既知の制限: プロセスを共有するハーネスでは、フックの書き込みとインテント／スペース切り替え動詞は、従来の v2 共有カーソルと `.current-session` の動きのままです。そのため、あるチャットが別チャットの移動やフックの帰属に影響できます。それらの経路のセッション単位の隔離は、まだこれからです。例外は、Kiro IDE のチャットに入力したインテント／スペースの切り替えです。どちらの形（`/aidlc intent switch <name>` または `/aidlc intent <name>`。`space` も同様）でも、プロンプトフックがそのチャットのセッションで実行するため、紐づくのはそのチャットだけです。

---

## スペース — チームにつき 1 つ

**スペース** は、一つのチームが完結した世界です。独自の `memory/`（方法論）、`knowledge/`、`codekb/`、`intents/` を持ちます。この章でここまで起きたことは、すべて `default` という一つのスペースの中です。自動で作られます。**一人開発者や単一チームなら、話はここで終わりです。スペースに名前を付けることはなく、そのまま動きます。**

スペースが要るのは、**複数チームが一つのプロジェクトを共有** し、それぞれが自分の方法論、ナレッジ、記録を、衝突せずに持ちたいときです。チームを足すのは純粋に追加です。同じ形の `spaces/<name>/` が `default/` の隣に現れます。動くものも、移行するものもありません。

作る、一覧する、切り替えるは、インテントの動詞とちょうど同じ形です:

```
/aidlc space                      List all spaces
/aidlc space create payments-team Create a new space, starting from the default space's org rules
/aidlc space switch payments-team Switch the active space to "payments-team"
```

作ると、何を用意したかが表示されます:

```text
> /aidlc space create payments-team
Space created: payments-team
  memory/org.md (copied from default), team.md, project.md, phases/, templates/, codekb/, knowledge/
Switch to it with /aidlc space payments-team.
```

短い `/aidlc space-create <name>` と、引数だけの `/aidlc space <name>` も使えます。

作ったばかりのスペースは、default スペースの `aidlc/spaces/default/memory/org.md` のコピー（チームがそこに加えた変更も含む）、フレームワーク自身のフェーズルール、空の `team.md` / `project.md` プラクティスファイルから始まります。新しいチームは、他チームのプラクティスを継がず、自分のものを積みます。`knowledge/` と `codekb/` も空です。コピーは一度だけ作られ、その後に default スペースの `org.md` を変えても新しいスペースには届きません。何が共有され、何が共有されないかは [引き継がれるもの、引き継がれないもの](#引き継がれるもの引き継がれないもの) にまとめてあります。

スペースを切り替えると、カーソルに続いて自動で二つが動きます:

1. **AI-DLC 自身のリゾルバ** — 次に始めるインテントも、エージェントが載せるプラクティスとナレッジも、切り替えた先のスペースから来ます。
2. **ハーネスがコンテキストに載せるルール** — 切り替えは、新しいスペースの `memory/` ファイルを `aidlc/active-memory/` に書きます。これはハーネスネイティブのルール include（Claude の `@`-import、Kiro CLI の resources、Cursor の rules、opencode の instructions、Copilot の `AGENTS.md`。Kiro IDE の steering ファイルは本文そのものを持ち、Codex ではエンジンが各ステップにルールを渡します）が読む、gitignore されたコピーです。次のターンは、そのチームの方法論で動きます。

追跡対象のファイルは変わらないので、切り替えがコミット済みのツリーを揺らすことはなく、pull したチームメイトがあなたのスペースを拾うこともありません。コピーはセッションローカルではなくチェックアウト全体なので、ワークフロー記録の選択は紐づいたままでも、別スペースの同時セッションは環境方法論の配送で競合できます。

### いまどのスペースにいるか

Claude Code で AI-DLC のステータスラインがオンのとき、その行はいま取り組んでいる仕事から始まり、スペースが二つ以上あるとその前にスペースが付いて、ずっと見える「いまここ」になります。シェルのプロンプトがカレントディレクトリを出すのと同じです（バーと区切りの点はプレーンテキストで示し、行はウィンドウの端で切れています）:

```text
[AIDLC] default - inventory-rest-api - IDEATION [##--------] 1/4 > Feasibility -- Architect Age...
```

単一チームで `default` しかないときは、スペースの名前自体が出ません。どのハーネスでも、`/aidlc space` と `/aidlc intent` がいまの場所を `*` 付きで一覧します。

---

## `aidlc/` の置き場所

**`aidlc/` は `aidlc config` がインストールするフォルダに置かれ、そのフォルダがワークスペースです。** それは `aidlc config` を実行したフォルダ、または `--project-dir` で指定したフォルダです。AI-DLC は git ルートを上方向へ探しません。サブフォルダにインストールすると、そのサブフォルダが独自のハーネスフォルダと独自の `aidlc/` を持ち、スペースとインテントも独自のものになります。ハーネスも同じフォルダで開いてください。

ほとんどのチームは、二つのレイアウトのどちらかで足ります。

### リポジトリが一つ、またはモノレポ

```
inventory-api/        ← run `aidlc config` here; this is the git repo
├── .claude/          the harness files (committed)
├── aidlc/            rules, knowledge, and the record of each piece of work (committed)
├── .gitignore        AI-DLC adds its own marked block
└── src/              your code
```

すべてがコードと一緒に、同じリポジトリ、同じプルリクエストで動きます。モノレポも同じレイアウトです。リポジトリのルートで `aidlc config` を実行すれば、すべてのパッケージが一つの `aidlc/` を共有します。このレイアウトの仕事はリポジトリを記録しないので、生成されたコードと git 操作はフォルダ自体に留まります。ただし、リポジトリの直下に独自の `.git` を持つフォルダ（初期化されたサブモジュールや入れ子のリポジトリ）がない場合に限ります。ある場合、AI-DLC は次のレイアウトと同じように、それらのフォルダをリポジトリとして扱います。代わりに一つのパッケージのサブフォルダにインストールすると、そのパッケージは別の `aidlc/` と独自の記録を持ちます。git は分かれません。git はサブフォルダからリポジトリを解決するので、ブランチと worktree は引き続きリポジトリ全体のものです。複数のチームがリポジトリを共有するなら、チームごとのスペース（上のスペースを参照）のほうが合っています。サブフォルダへのインストールは、パッケージが本当に独立したプロジェクトである場合だけにしてください。

### 一つの `aidlc/` の隣に複数のリポジトリ

```
my-project/           ← run `aidlc config` here
├── .claude/          the harness files
├── aidlc/            records for work that spans the repos
├── repos.json        optional: the repos to clone (see below)
├── .gitignore
├── checkout-api/     its own git repo
└── checkout-web/     its own git repo
```

コードリポジトリは、`aidlc/` の隣にある、独自の `.git` を持つフォルダです。AI-DLC はそれらを自分で見つけます（[一つのインテントに複数リポジトリ](#一つのインテントに複数リポジトリ)）。仕事の記録はリポジトリごとではなく `aidlc/` に一度だけ置かれるので、両方のリポジトリに触れる変更でも、要件も監査証跡も一組です。

それらを入れるフォルダは git リポジトリである必要はなく、AI-DLC がリポジトリにすることもありません。`.git` もプロジェクトファイルも持たないので、`aidlc config` がそのフォルダの確認を求めることがあります（スクリプトでは `--project-dir` を渡します）。`aidlc/` にとっての意味は次のとおりです:

- **自分だけ:** 何もする必要はありません。`aidlc/` は追跡されずにディスクに残ります。
- **チーム:** フォルダで `git init` を実行し、それを小さな独自のワークスペースリポジトリとして push します。コードリポジトリは独自のリモートを持つ別のリポジトリのままで、ワークスペースリポジトリはそれらを追跡してはならないので、先に除外しておきます。`repos.json` に列挙したリポジトリについては [`aidlc-workspace-sync`](12-cli-commands.md#aidlc-workspace-sync---clone-and-reconcile-the-declared-repo-set) ツールがやってくれます。それ以外は、それぞれ ignore の行を追加します。そのあと `git status` を実行し、それが列挙するもの（`aidlc config` が書いたもののうち git が無視しないものすべてと、`repos.json`）をコミットします。正確なファイルはハーネスで違うので、パスを手で選ばないでください。チームメイトはワークスペースリポジトリを clone し、同期ツールを実行してその隣にコードリポジトリを clone します。
- **Codex CLI と Cursor:** Codex は git リポジトリの中でしかフックを見つけず、Cursor はリポジトリの外ではフックを飛ばすことがある（[はじめに](01-getting-started.md)）ので、どの方法で共有する場合でも、フォルダで `git init` を実行してください。

### どのレイアウトにするか

| 状況 | 使うもの |
|---|---|
| コードが一つのリポジトリにある | リポジトリ一つ: その中にインストールする |
| 一つの仕事が複数のリポジトリを変える | 一つの `aidlc/` の隣に複数のリポジトリ |
| 複数のチームが同じリポジトリを共有する | ワークスペース一つと、チームごとのスペース（上のスペースを参照） |
| 無関係なプロジェクト | それぞれに別のフォルダと `aidlc/`。記録、ルール、ナレッジは共有されず、両方に届くのはマシン全体の設定とアクティブなリリースだけ（[引き継がれるもの](#引き継がれるもの引き継がれないもの)） |

各レイアウトで何をコミットするかは [コミットするもの、しないもの](#コミットするものしないもの) にあります。

---

## 一つのインテントに複数リポジトリ

インテントは、リポジトリ一つに限りません。コードリポジトリはワークスペースのフォルダの中で `aidlc/` の隣にあり（どれかの中に入れ子ではない）、インテントは必要な数だけまたげます。

リポジトリ集合は **インテント作成時** に取ります。追加の入力はありません。既定では、AI-DLC が兄弟リポジトリを全部自動発見します（ワークスペースルートの直下の子で、自分の `.git` を持つもの）。集合はインテントの `intents.json` 行に残ります。Construction では、各 git 操作が正しいリポジトリに自動で基準点を打ちます。

各リポジトリは、あなたが付けたとおりのフォルダ名で記録されます。スペース、アクセント記号、アポストロフィ、ほかの文字も使えます（`my lib`、`C# lib`、アクセント記号を含む名前）。いくつかの文字は AI-DLC が頼りにしているものを壊すため、名前にそれを含むフォルダは作業から外され、最初のステップがどのフォルダをなぜ外したかを伝えます。`<` `>` `:` `"` `|` `?` `*`（Windows はフォルダ名に使えません）、`&` `^` `%`（Windows での AI-DLC のコマンド）、`(` `)` `[` `]` `{` `}` `;` `$` とバッククォート（Cursor での AI-DLC のコマンド）、カンマ（リポジトリ名の区切り）、`!` と一緒に使われたアポストロフィ（Windows の PowerShell と Git Bash で両方を同じに読ませる引用の仕方はありません）、`-` である名前や `--` で始まる名前、`@checkout` で終わる名前、スペースで始まるか終わる名前です。

```
my-project/
├── aidlc/          # AI-DLC's records
├── checkout-api/   # repo-a   ┐ both auto-discovered as siblings;
└── checkout-web/   # repo-b   ┘ an intent here can touch either or both
```

リポジトリを記録しないインテントは、普通の単一リポジトリの場合です。レコードディレクトリの詳細は [成果物リファレンス](14-artifacts-reference.md)、用語は用語集の [複数リポジトリインテント](glossary.md) です。

### リポジトリ集合を宣言する（任意のマニフェスト）

自動発見は、兄弟リポジトリがすでに clone されていることが前提です。共有ワークスペースを新しくチェックアウトしただけでは揃っていないので、チームメイトはどのリポジトリをどこへ clone するかを知る必要があります。任意の `repos.json` マニフェストをワークスペースルートに置くと、その想定集合が残り、コマンド一つで再現できます:

```json
{
  "org": "your-github-org",
  "repos": [
    { "name": "checkout-api", "branch": "main" },
    { "name": "checkout-web" }
  ]
}
```

`org` は既定の clone 先です（`url` がないエントリは `git@github.com:<org>/<name>.git` から clone します。上書きするならエントリに `url` を付けます）。`branch` は新規 clone のチェックアウト先で、すでにディスクにあるリポジトリに対しては助言の期待値です。省略すると、そのリポジトリ自身の既定を使います。リポジトリ名は、ワークスペースの直下にある 1 つのフォルダの名前で、発見されるフォルダが持てる文字（上記）を使えます。このファイルを読んで欠けたリポジトリを clone し、gitignore ブロックを保ち、VSCode のマルチルートワークスペースを生成する `aidlc-workspace-sync` ツールは、[CLI コマンド](12-cli-commands.md#aidlc-workspace-sync---clone-and-reconcile-the-declared-repo-set) にあります。

[`/aidlc intent add-repo <name>`](12-cli-commands.md#aidlc-intent-add-repo-name進行中の作業に兄弟リポジトリを足す) もこのファイルに書き込みます。作業に必要なのに誰もここに clone していないリポジトリは、そのエントリから clone されます。エントリのないリポジトリは `org`（または指定したアドレス）から clone され、エントリが追加されます。ファイルのコメントとレイアウトは保たれます。まだ `repos.json` がない場合、ホストされた `--url`（ホスト、所有者、名前）は、`org` をその所有者とする `repos.json` を作ります。チームと一覧を共有するには、それをコミットしてください。ここに書かれるアドレスに資格情報が残ることはありません。

マニフェストは便利さであり、第二の正本ではありません。**実行時はディスクが勝ちます**。インテント作成は、実際にいる兄弟を自動発見するので、宣言の有無にかかわらず、clone された瞬間からリポジトリは使えます。宣言されていても clone されていないリポジトリは、集合に入りません。マニフェストが動かすのは同期ツールと、宣言集合とディスクがずれたときに印を付ける助言の `--doctor` 行だけです。（この「ワークスペースマニフェスト」は、ハーネスの `manifest.ts` とは無関係です。そちらはパッケージング用のファイルです。）

---

## 引き継がれるもの、引き継がれないもの

AI-DLC が知っていることはすべてファイルにあるので、共有はフォルダに従います。スペースは境界、ワークスペースも境界で、人やマシンの間でファイルを運ぶのは git です。

| 何 | スペース内のインテント間 | スペース間 | プロジェクト間（別々の `aidlc/` フォルダ） |
|---|---|---|---|
| ルール: `org.md`、`team.md`、`project.md`、`phases/` | 共有。各ステージは現在のファイルを読む | 新しいスペースは、default スペースの `org.md` とフレームワークのフェーズルールのコピーを一度だけ受け取る。`team.md` と `project.md` は空から始まる。その後は何も流れない | ファイルをコピーするか、テンプレートリポジトリ（下記）から始める |
| 残した学び | アクティブなスペースの `project.md` に入る。昇格すれば `team.md` | 共有されない。スペースごとに持つ | 欲しい行をコピーする |
| あなたの文書（`knowledge/`） | 共有。`associate` は文書の一覧にインテントを加え、繰り返し使える。インテントのない文書はスペース全体のもの | 共有されない。スペースごとに独自のフォルダを持つ | `onboard` はファイルをコピーして取り込み、プロジェクト外のパスは拒否するので、ファイルを相手のプロジェクトへコピーする |
| コードナレッジ（`codekb/`） | 共有、リポジトリごと。最新のスキャンは選択によって再利用できる | 共有されない。別のスペースはスキャンし直す | 各プロジェクトが自分でスキャンする。同じリポジトリのチームメイトのクローンはスキャンを再利用できる |
| 保存したスコープ（`aidlc/scopes/`） | 共有 | ワークスペース内のすべてのスペースで共有 | ファイルをコピーする |
| 出力形式の上書き（`memory/templates/`） | 共有 | スペースごと。新しいスペースにはコピーされない | ファイルをコピーする |
| 追加したエージェント（ハーネスフォルダ内） | 共有 | すべてのスペースで共有 | ファイルをコピーする |
| リポジトリ一覧（`repos.json`） | ワークスペースに一つ | ワークスペースに一つ | プロジェクトごと |
| モデルとフラグのポリシー | 共有 | 共有 | マシンの設定ファイルで一度設定し、マシン上のすべてのプロジェクトに適用される。プロジェクト自身の `aidlc.settings.json` が値ごとに上書きするが、バイパスはファイル間で積み上がる（[階層](18-install-and-lifecycle.md)）。モデルと effort のポリシーは Cursor と GitHub Copilot には適用されず、そこではどのエージェントもツールで選んだモデルを使う。Kiro IDE では、一つのエージェント自身のモデルと effort だけが適用され、プリセットやグループの effort は適用されない。 |
| Kiro CLI のセッションモデルと、プリセットが設定する effort | 共有 | 共有 | 個人の Kiro 設定に保存されるので、すべての Kiro CLI プロジェクトがそれを使う。エージェントやグループのポリシーの変更はそうならない |
| 更新、オフライン、ミラー、CA バンドルの設定 | 共有 | 共有 | マシンのみ。プロジェクトのファイルでは設定できない |
| Kiro IDE の Workflows スイッチと、Windows ではその既定のターミナル | 共有 | 共有 | プロジェクトの外、Kiro のユーザー設定に保持される。セットアップが一度尋ね（`aidlc config --yes` は推奨の回答を取る）、依頼があれば `aidlc config trust` が変更する。その IDE で開くすべてのプロジェクトに適用される |
| Kiro CLI の Workflows スイッチ | 共有 | 共有 | プロジェクトの外、自分の Kiro CLI 設定に保持される。Kiro IDE のプロジェクトでは、セットアップが一度尋ね、その回答は Kiro IDE のものとは別に保持される（`aidlc config --yes` は推奨の回答を取る）。依頼があれば `aidlc config trust --kiro-cli-workflows off|on --yes` が変更する。Kiro CLI を実行するすべてのプロジェクトに適用される |
| AI-DLC のリリース自体 | 共有 | 共有 | リリースを固定していない（`.aidlc-version` がない）ネイティブのプロジェクトはマシンでアクティブなリリースを実行するので、`aidlc update` はそうしたすべてのプロジェクトのリリースを変える（そのプロジェクト自身のファイルは次の `aidlc config` で追いつく）。コピーしたプロジェクトは、自分のコピーしたリリースを実行する |

これらのマシン全体の設定、IDE の選択、アクティブなリリースを除けば、AI-DLC の中で二つのプロジェクトを結び付けるものはありません。チームメイトはリポジトリを pull して共有ファイルを受け取り、[コミットするもの、しないもの](#コミットするものしないもの) にある利用者ごとのファイルは決して移動しません。

### 多くのプロジェクトのための標準

多くのプロジェクトに同じ出発点のルールを与えるには、組織がどこでも使いたい `org.md`、`team.md`、ナレッジファイルを含む `aidlc/` を持つテンプレートリポジトリを用意します。新しいプロジェクトはそのコピーから始め、自分の `project.md` を加えます。変更を展開するには、テンプレートを変え、ほかの変更と同じように、プルリクエストで各プロジェクトへ取り込みます。

新しいリリースをプロジェクトに上書きコピーして更新すると、そのコピーは default スペースの `org.md` と `phases/` のルールを出荷時のものに置き換え、`team.md` と `project.md` は残します。コミットする前に git の差分を確認してください（[コピー経路](18-install-and-lifecycle.md#コピー経路)）。ネイティブの `aidlc config` による更新は、すべてのスペースの memory ファイルを残します（[プロジェクトの設定と更新](18-install-and-lifecycle.md#プロジェクトの設定と更新)）。

---

## コミットするもの、しないもの

`aidlc/` は git に入れるので、チームは仕事を **共有** します。方法論、インテントのレジストリ、各インテントの状態、監査証跡、成果物が、リポジトリと一緒に動きます。意図して **gitignore** するのは、次の二種類です:

| gitignore（利用者ごと、マシンローカル） | 理由 |
|---|---|
| `aidlc/active-space`、`…/intents/active-intent` | カーソル — 「いまどこにいるか」。コミットすると、利用者ごとの移動が共有リポジトリの状態になり、チームメイトがインテント作成とカーソル切り替えで衝突します。 |
| `.../intents/<id>/runtime-graph.json`、`.aidlc-*`、`aidlc/.aidlc-sessions/`、`aidlc/.aidlc-active-space-*.tmp` | 派生した、マシンローカルの実行時状態。セッションごとの紐づけと PID 祖先のエントリを含む。 |
| `aidlc/.aidlc-request-text/` | エンジンが読むためにエージェントがファイルに書いた依頼。コマンドが進めば削除される。進まなかったときに残ったものはあなたの言葉であり、共有する仕事ではない。 |
| `…/knowledge/documentkb/.journal/` | 進行中の文書トランザクションごとのディレクトリ。一時的でクローンごと。ジャーナルをコミットすると、並行する `sync` のたびにマージ衝突します。 |
| `…/knowledge/.sources.local.json` | *このマシン* が、リポジトリ外にある文書を見つける場所。パスは定義上マシン固有なので、コミットすると全員のチェックアウトが壊れます。現在このようなリンクを作るコマンドはない（`onboard` はファイルを `documents/` にコピーする）ので、通常このファイルを目にすることはありません。 |

スペースのほかはすべてコミットします。`memory/**`、`knowledge/**`、`codekb/**`、`intents.json`、各レコードの `aidlc-state.md`、`audit/` シャード、成果物です。目安はこれです。**カーソルと実行時の作業用はローカル、共有する仕事はコミットする。**

pull、rebase、stash pop によって、レコードの `aidlc-state.md` に git のコンフリクトが残った場合（2 つのクローンが同じ作業を進めた場合）、次のステップはあなた自身の側から続け、git のマーカーなしでレコードを書き戻します。もう一方の側がどこにいるかと、代わりにそちらを取る git コマンドを一度伝えます。ファイルを add するまで、git はそのファイルをコンフリクトとして表示します。

`knowledge/documents/` と `knowledge/documentkb/` はどちらもコミットしますが、所有者が違い、その違いが設計そのものです。`documents/` は原本です。追加、移動、削除は利用者がし、フレームワークは並べ替えません。`documentkb/` はツールが導出するカタログで、ワークスペースロックの下でトランザクション書き込みされます。**インデックス** は再構築できます。`documentkb/index.json` だけ消して `/aidlc knowledge sync` すれば、残っている文書ごとの `metadata.json` から、tombstone も含めて作り直します。`documentkb/` ツリーごと消すのは別の、復旧できない操作です。すべての `metadata.json` も消えるので、document id と tombstone が失われます。その後の `sync` は、残った原本を新しい id の新しい行として再オンボードします。`documentkb/` を手で直すのが近道ではなく誤りなのも、そのためです。次の `sync` が、`documents/` の実際の中身へ戻します。

---

## 次に読む

- [フェーズとステージ](04-phases-and-stages.md) — 1 インテントの実行の中身
- [ナレッジ](08-knowledge.md) — チームの標準をスペースの `knowledge/` に載せる
- [ルールとラーニングループ](09-rules-and-the-learning-loop.md) — スペースの `memory/` 方法論の書き方と学び方
- [成果物リファレンス](14-artifacts-reference.md) — インテントごとのレコードディレクトリの詳細
- [CLI コマンド](12-cli-commands.md) — `space` / `intent` 動詞の全体
- [用語集](glossary.md) — Space、Intent、Record dir、Multi-repo intent の定義
```
