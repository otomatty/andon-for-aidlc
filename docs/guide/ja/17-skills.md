# スキルとランナーコマンド

**AI-DLC はコマンドの一式です。** `/aidlc` オーケストレータのほかに、打つだけの 1 語ランナーがあります。スコープごと、ステージごと、セットアップ用です。オーケストレータがすでに出している切り口への近道なので、全部 `/aidlc` から届きますし、フラグを省略して欲しい入り口を打つこともできます。

> **ハーネスについての注。** この章の面は Claude Code です。スキルは `.claude/skills/` にあり、ピッカーから先頭 `/` で打ちます。Kiro は同じランナー一式を `.kiro/skills/`（こちらも `/`）に出します。Codex は `.agents/skills/` で、打ち方は `$`（`$aidlc-bugfix`）です。ランナーの *集合* と各コマンドの中身はハーネスを問わず同じで、違うのはディレクトリと接頭辞だけです。[他ハーネスで動かす](harnesses/README.md)。

---

## スキルは多く、エンジンは一つ

この実装が出荷するコマンドは、すべて `.claude/skills/` のスキルです。駆動する決定論的エンジンは同じで、違うのは起動前に何を焼き込むかだけです。

- **`/aidlc`** — フルのオーケストレータ。フラグは焼き込まない。やりたいことを書くと、エージェントがそのためのプランを提案し、あなたが確認すると、プランの全ステージを完了まで回す。いちばんよく使う入り口。
- **スコープランナー** — `/aidlc-bugfix`、`/aidlc-express`、`/aidlc-feature`、`/aidlc-mvp`、`/aidlc-security-patch`。同じフルワークフローで、スコープは固定、提案するプランはない。
- **ステージランナー** — `/aidlc-domain-design`、`/aidlc-code-generation`、ほか 28。1 ステージだけを隔離実行し、メインのワークフローは触らない。プラグイン所有のステージは、プラグイン接頭辞付きの裸のコマンド名（例: `/test-pro-integration`）。
- **`/aidlc-init`** — 作業を始める。`--scope <name>` と説明を付けると、インテントを 1 ステップで作成し（Initialization フェーズ全体を実行し）、そこで止まる。`--scope <name>` だけなら、まだ何も作らない。作業の目的を尋ね、その答えで作業を始める。説明だけを渡すと、まず `/aidlc` と同じ計画の提案を表示し、その後は `/aidlc` と同様に続行する。`/aidlc` と違い、スコープ名で始まる説明（「feature flags for billing」など）も説明として読む。進行中の作業はそのまま残し、新しい作業はその横で始まる。
- **セッションスキル** — `/aidlc-session-cost`、`/aidlc-replay`、`/aidlc-outcomes-pack`。ワークフローの読み取り専用ビュー。[セッション管理](11-session-management.md)。
- **`/aidlc-compose`** — 適応コンポーザ。タスクを読み、それに合うステージを提案し、承認後はそれを独自のプランとして実行する。`/aidlc compose` と同じ。[The Adaptive Composer](05-scopes-and-depth.md#the-adaptive-composer)。
- **`/aidlc-knowledge`** — DocumentKB。チーム自身の文書（PDF、Word、Markdown、プレーンテキスト）を、エージェントが引用できるスペース単位カタログに載せる。セッションスキルと同じくスタンドアロンだが読み書きあり。カタログを変え、文書監査イベントを出す（ワークフロー状態は触らない）。面は `/aidlc knowledge <verb>` と同じ。動詞は [CLI コマンド](12-cli-commands.md)。

ランナーがすることは、すべて `/aidlc` にフラグを付けて届きます。ランナーは包装です。`/aidlc-bugfix` と打ち、`/` メニューに見えるのは使い勝手だけで、それ以上ではありません。ランナーを全部消してもショートカットが無くなるだけで、能力は `/aidlc` のフラグから残ります。

生成されたランナーは、ホストが許す限り**明示起動専用**です。Claude Code、Cursor、GitHub Copilot（VS Code と CLI）では各ランナーが `disable-model-invocation: true` を持ちます（Codex では `agents/openai.yaml` の `allow_implicit_invocation: false`）。そのため、エージェントが自分からランナーを起動することはなく、ランナーの説明はモデルが毎ターン読むスキル一覧に入りません。ランナーは入力して起動します。ヘッドレスの `copilot -p "/aidlc-bugfix ..."` でもランナーは動きます。Copilot は入力された行をテキストとしてエージェントへ渡し、同梱の `AGENTS.md` がそのランナーのファイルを読むようエージェントに指示するからです。Kiro CLI、Kiro IDE、opencode にはこの設定がないため、そこではエージェントが自分でランナーを起動することがあります。`/aidlc` はランナーではなく、エージェントからも引き続き使えます。

---

## スコープランナー — 問題の種類ごとの名前付き入り口

スコープランナーは、スコープを 1 つ固定したフルワークフローです。作業の種類が分かっていて、プランの提案を飛ばしたいときに使います。

```
/aidlc-bugfix          Fix a specific bug
/aidlc-express         Lightest run: requirements to deploy, no design pass, no reviewers
/aidlc-feature         Full lifecycle for new features, practical depth
/aidlc-mvp             Skip operations, ship the core
/aidlc-security-patch  CVE response
```

それぞれ、オーケストレータに `--scope` を渡すのと同じです。

```
/aidlc-bugfix          ==  /aidlc --scope bugfix
/aidlc-express         ==  /aidlc --scope express
/aidlc-feature         ==  /aidlc --scope feature
```

説明文とフラグはそのまま通せます。`/aidlc` に渡すのと同じです。

```
/aidlc-bugfix The profile API returns 500 when display_name is null
/aidlc-feature --status
```

**ランナーが出荷されるコアスコープは 5 つ** — スコープファイルで `runner: true` の、よく使うものです。フレームワークのスコープは全部で 11（[スコープ・深度・テスト戦略](05-scopes-and-depth.md)）。残り — `enterprise`、`poc`、`infra`、`refactor`、`classic`、`workshop` — はいつもオーケストレータから届きます。プラグイン所有のスコープも `runner: true` にでき、ランナーはプラグイン接頭辞付きの裸のスコープ名です（例: `/test-pro-validation`）。

```
/aidlc --scope enterprise
/aidlc --scope poc
```

ワークフローが始まったらスコープは `aidlc-state.md` に固定されるので、同じランナーを再実行すると再開になり、最初からではありません。別スコープで回すなら `/aidlc --scope <name>` です。

---

## ステージランナー — 1 ステージだけ回し、ワークフローは触らない

ステージランナーは **1 ステージを隔離実行** します。そのステージの設定済みエージェントとレビュアーを使い、合成の完了を記録し、ワークフローの学びも承認ゲートも無しで止まります。メインワークフローの `Current Stage` は進めません。隔離はツール自身が強制します。

```
/aidlc-domain-design
/aidlc-code-generation
/aidlc-requirements-analysis
/aidlc-reverse-engineering
```

それぞれ `/aidlc --stage <slug> --single` の包装です。

```
/aidlc-code-generation    ==  /aidlc --stage code-generation --single
```

### 使うとき

- **ワークフローにコミットせず、方法論の一部だけ使う。** 問題の requirements analysis は欲しいが、ライフサイクル全体を回す準備はない。`/aidlc-requirements-analysis` を実行し、成果物を得て止まる。
- **自分がオーケストレータ。** 順序は人手で決め、フレームワークには目の前の 1 ステージだけ回してほしい。人が運転し、フレームワークは方法論を 1 ステージ分出す。
- **メインワークフローが別の位置で止まっているあいだに、1 ステージだけ隔離再実行する。** この実行はワークフローを動かさない。すでにあるファイルのコピーを保存したうえで、作業がドキュメントを置いている場所にそのステージのドキュメントを書く。

### 安全な理由

`--single` の不変条件はツールが強制します。`next --single` は作業の前に隔離開始を記録し、`report --single` が閉じられるのは同じ合成試行だけで、開始無しの直接完了は拒否します。どちらもメインワークフローの `Current Stage` は書きません。ランナーがメインのポインタを進めようとしたら、エンジンはエラーを返します。作業のレコードにそのステージのファイルがすでにある場合、`next --single` は実行を始める前に、それらをそのレコードの `archive/<time>-<stage>/` にコピーし、そのフォルダを 1 行で示します。

ブートストラップの **initialization** ステージ 3 つにステージランナーはありません。インテントの半分を作っても単体では意味がないからです。Initialization フェーズ全体を 1 コマンドにまとめてあります。

```
/aidlc-init --scope <name> <description>   create the intent in one step, then stop
/aidlc-init --scope <name>                 ask what the work is for, then start it
/aidlc-init <description>                  plan offer first, then continue (a leading scope name is part of the description)
```

---

## ランナー系統の一覧

| 系統 | 例 | すること | オーケストレータでの同等 |
|------|----|----------|--------------------------|
| オーケストレータ | `/aidlc` | フルワークフロー、提案されたプランをあなたが確認 | - |
| スコープランナー | `/aidlc-bugfix`、`/aidlc-express`、`/aidlc-feature`、`/aidlc-mvp`、`/aidlc-security-patch` | フルワークフロー、スコープ固定、確認するプランなし | `/aidlc --scope <name>` |
| ステージランナー | `/aidlc-domain-design`、`/aidlc-code-generation`、...（全 30） | 1 ステージ隔離。ワークフローは進めない | `/aidlc --stage <slug> --single` |
| Init ラッパ | `/aidlc-init` | 作業を始める。`--scope` と説明付きなら 1 ステップで作成、`--scope` だけなら先に目的を尋ねる、説明だけなら先に計画の提案 | `/aidlc --scope <name>`、または新しいワークスペースでの `/aidlc <description>`（先頭がスコープ名の場合を除く） |
| セッションビュー | `/aidlc-session-cost`、`/aidlc-replay`、`/aidlc-outcomes-pack` | 読み取り専用のワークフロー報告 | [セッション管理](11-session-management.md) |
| コンポーザ | `/aidlc-compose` | タスク向けに作ったプランを提案し、承認後に実行する | `/aidlc compose` |
| 文書ナレッジ | `/aidlc-knowledge` | チーム自身の文書を索引し読む（スペース単位 DocumentKB） | `/aidlc knowledge <verb>` |

ライフサイクルで走らせられるステージには、ステージランナーが 1 つずつあります。一式を見るならスキルディレクトリを列挙します。`aidlc config` で Claude Code 向けにセットアップしたプロジェクトでは次のとおりです（短縮しています）。

```text
$ ls .claude/skills/
aidlc
aidlc-approval-handoff
aidlc-bugfix
aidlc-build-and-test
aidlc-ci-pipeline
aidlc-code-generation
aidlc-compose
...
aidlc-session-cost
aidlc-team-formation
aidlc-units-generation
aidlc-user-stories
```

全部で 42 項目です。`/aidlc`、30 のステージランナー、5 のスコープランナー、`/aidlc-init`、`/aidlc-compose`、`/aidlc-knowledge`、3 つのセッションスキルです。

---

## 自作ランナー — ステージファイルを書く

フレームワークをカスタマイズするときに大事なのはこれです。**ランナーは手で書きません。** コンパイル済みステージグラフとスコープファイルから生成されます。

ステージランナーを足すには、ステージを足します。ステージファイルを書き、グラフを再コンパイルし、再生成します。

```bash
aidlc engine gen runners
```

ジェネレータはコンパイル済みステージ一覧（正本）を読み、走らせられるステージごとにランナーシェルを出します。新しいステージの `/aidlc-<your-stage>` は自動で現れます。ランナーファイルを手で書く必要も、ボイラープレートをコピーする必要もありません。スコープランナーも同じで、frontmatter が `runner: true` のスコープが対象です。`scopes --all` はスコープファイル全部のランナーを出します。

```bash
aidlc engine gen runner-scopes      # generate scope-runners
```

ランナー一式は手保守ではなく導出なので、覆うステージとスコープからずれません。ディスク上の集合が正本から外れた瞬間に、CI が 2 つの検査で失敗します。

```bash
aidlc engine gen runners --check             # stage-runner drift
aidlc engine gen runner-scopes --check       # scope-runner drift
```

ずれがないプロジェクトでは、ステージランナーの検査は次を出力します。

```text
$ aidlc engine gen runners --check
stage-runner set is in sync with the compiled stage graph (30 runners).
```

グラフにステージを足してランナーを再生成していない、または消えたステージの孤児ランナーが残っていると、差分付きで大きく失敗します。作者の仕事はステージファイルを足して再生成することだけです。ランナーは結果として付き、ジェネレータが維持します。

ステージファイルの書き方は [カスタマイズ](13-customization.md) と [フェーズとステージ](04-phases-and-stages.md)。エンジン、ディレクティブ契約、ランナーシェルが裏で `next` / `report` をどう回すかは、リファレンスの [Skill System](../reference/17-skill-system.md) です。

---

## 早見

```
# Full workflow
/aidlc                              propose a plan, run everything
/aidlc --scope enterprise           any of the 11 scopes

# Scope-runners (the 5 high-traffic doors)
/aidlc-bugfix · /aidlc-express · /aidlc-feature · /aidlc-mvp · /aidlc-security-patch

# One stage, isolated (never advances your workflow)
/aidlc-code-generation              == /aidlc --stage code-generation --single

# Start a piece of work (Initialization phase)
/aidlc-init --scope <name> <desc>   create it in one step, then stop
/aidlc-init --scope <name>          ask what the work is for, then start it
/aidlc-init <description>           plan offer first, then continue

# Add your own: write a stage/scope file, then
aidlc engine gen runners
aidlc engine gen runner-scopes
```

あわせて: [CLI コマンド](12-cli-commands.md) · [スコープ・深度・テスト戦略](05-scopes-and-depth.md) · [カスタマイズ](13-customization.md)
