# ステージを追加する

ステージはワークフローグラフのノードです。消費・生成する成果物、それをリードするエージェント、そして実行方法を宣言する、作業の単位です。ステージの追加は、ハーネスエンジニアが行うもっとも構造的な変更です — 手法そのものへ新しい一歩を導入することになります。この章は、最初から最後までのレシピを辿ります。フェーズを選び、ファイルを作成し、依存エッジを配線し、グラフをコンパイルし、新しいステージが期待どおりの場所に着地することを確認します。

先に [ステージの構造](01-anatomy-of-a-stage.md) を読んでください。あちらは、このレシピが理解済みと前提するファイルフォーマット — フロントマターの契約と 3 区画の本文 — を扱っています。ここでは*作業の流れ*、すなわちフィールドごとのスキーマではなく、判断と検証の手順に集中します。網羅的な契約については、各手順で [ステージ定義](../reference/15-stage-definition.md) へリンクします。

この規律は、開発者リファレンスの [スコープを追加する](../reference/11-contributing.md#スコープの追加) と [エージェントを追加する](../reference/11-contributing.md#エージェントの追加) のレシピを映しています。番号付きの手順の一覧、そして*自動で検証されること*と*自分で確認しなければならないこと*の明確な分割です。

---

## 始める前に: 新しいステージが正しい一手か

新しいステージがその場所を得るのは、既存のどのステージも生成しない成果物を生成するとき、あるいは既存のどのステージもカバーしないかたちで成果物を消費するときです。*既存のステージが何をするか*を変えたいだけ — 手順を書き直す、リードエージェントを付け替える、センサーを付ける — なら、そのステージファイルをその場で編集してください。新しいノードは不要です。その場での編集は [ステージの構造](01-anatomy-of-a-stage.md) を参照してください。

ステージの追加は**データの作業**です。YAML フロントマターを持つ Markdown ファイルを作成し、JSON の成果物を再コンパイルします。TypeScript の変更はありません。心に留めておくべき境界が 1 つあります。グラフの*コンパイラ自体*に新しい振る舞いが必要になる場合（まだ理解しないフロントマターのキー、新しい走査の規則など）、それはハーネスの作業ではなく開発者リファレンスの関心事です。仕様が既に知っている予約キー（`on_failure`、`blocks_on`、`timeout`、`retry`）は [ステージ定義](../reference/15-stage-definition.md) に列挙されており、現時点では拒否されます。それらへ手を伸ばそうとしているなら、あなたはコードの側へ線を越えています。`when:` は事情が異なります。スキーマはそれを受け付けて検査しますが、まだ何もそれに基づいて動作しないため、`when:` を持つステージは、それが無いかのように自身の `scopes:` のもとで実行されます。

---

## 手順

### 1. どのフェーズに属するステージかを決める

ステージファイルは `core/aidlc-common/stages/<phase>/<slug>.md` に住みます。フェーズはディレクトリです。5 つあります。

```
core/aidlc-common/stages/
├── initialization/
├── ideation/
├── inception/
├── construction/
└── operation/
```

ステージがどのフェーズにあるかは、見た目の問題ではありません。コンパイル時にどの `phases/<phase>.md` のルール層が付随するかを決めます — construction フェーズのステージは construction のフェーズルールを、inception のステージは inception のルールを継承します。（initialization にフェーズルールのファイルはありません。）そのステージの作業がライフサイクルの中で実際に起きる場所へ置いてください。整理の都合のよい場所ではありません。

### 2. 必須のフロントマターを持つステージファイルを作る

選んだフェーズのディレクトリに、新しい `<slug>.md` を置きます。slug はファイル名の語幹であり、それ以外のすべての場所 — `requires_stage` のエッジ、スコープの対応、監査ログ — でのステージの同一性です。慎重に選んでください。後からの改名は波及します。

フロントマターは、グラフのエッジと実行の契約を宣言します。構造上の重みを担うフィールドは次のとおりです。

| フィールド | 何をするか |
|-------|--------------|
| `requires_stage` | 依存のエッジ — このステージの前に来なければならないステージ |
| `consumes` | このステージが読む成果物。それぞれが `required` の真偽値を持つ |
| `produces` | このステージが書く成果物（前向きのエッジ） |
| `lead_agent` | このステージを所有するペルソナ |
| `support_agents` | コンダクターがリードの後に読み込む任意の視点。パイプラインの連鎖は一意なエージェントを要求する |
| `mode` | `inline`、`subagent`、`pipeline`、`mob`、または予約済みの `agent-team` |
| `for_each` | 任意 — インスタンスが反復を駆動する成果物を名指しする |
| `summary_confirmation` | 任意 — 常にファイル裏付けの回答を集めるステージでは `required`、条件付きの質問フローでは `if-present` |
| `reviewer` / `review_artifact` | 任意の組み合わせ。レビューエージェントと、レビュー対象となる必須の Markdown `produces` エントリ。レビュー記録はその成果物に紐付きます。 |

完全な小さいステージの例として、Requirements Analysis の後に `feature` のもとでだけ実行される用語集のステップは次のようになります（このままでコンパイルできます）。

```markdown
---
slug: glossary-capture
phase: inception
execution: CONDITIONAL
condition: Execute when the requirements use domain terms the team must agree on. Skip when every term is already defined.
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
produces:
  - glossary
consumes:
  - artifact: requirements
    required: true
requires_stage:
  - requirements-analysis
sensors:
  - required-sections
scopes:
  - feature
inputs: <record>/inception/requirements-analysis/requirements.md
outputs: glossary.md (under this stage's record dir, engine-resolved)
---

# Glossary Capture

Collect the domain terms the requirements use and agree one meaning for each.

## Steps

1. Read `<record>/inception/requirements-analysis/requirements.md` and list every domain term it uses.
2. For each term, write one plain definition and the requirement IDs that use it.
3. Write `glossary.md` with `## Terms` and `## Open Terms` sections.
4. Follow stage-protocol.md for the approval gate.

## Sensors

This stage's output is a markdown artefact under `<record>/inception/glossary-capture/`.

Imports: `required-sections`.

## Learn

When `directive.protocol_modules` lists `learnings`, follow
`stage-protocol-learnings.md`: keep the diary at `directive.memory_path` while
working, and take the learnings step before the approval gate; that module says
when it asks the person anything. When the module is absent, skip both the diary
and the step.
```

本文は `## Steps` — リードエージェントが従う命令的な散文 — で始まります。続く `## Sensors` 区画が、出力先、フロントマターの正確なインポート、上流のターゲットを要約します。ステージ固有のセンサーの例外があれば保ってください。最後の `## Learn` 区画は `stage-protocol-learnings.md` §13 を指し、これは `directive.protocol_modules` に `learnings` がある場合だけで、そうでなければ日誌とステップを省きます。ステップがいつ質問するか、そして Bootstrap・単独実行・Unit ごとの反復の例外は、このモジュールが定めます。完全なフィールド表、型、制約は [フィールドリファレンス — いつ使うか](../reference/15-stage-definition.md#フィールドリファレンス--いつ使うか) を参照してください。

### 3. グラフが配置できるよう依存エッジを配線する

ここが、新しいステージが実際にワークフローへはまり込む場所です。配線を担うのは 3 つのフィールドで、互いに整合していなければなりません。

- **`requires_stage`** はエッジを符号化します。2 種類のエッジを担います。*意味的なデータ依存*（「私は成果物 X を消費し、それはステージ Y が生成する」→ `Y` を追加）と、*表示順のエッジ*（同じフェーズにあり、データ依存は無いが実行順が決まっている 2 つのステージ）です。コンパイラのアルファベット順のタイブレークに頼るのではなく、順序のエッジを明示的に書いてください。タイブレークは、あなたの明示的な配置の下にある安全網にすぎません。
- **`consumes`** は、ステージが読む成果物を列挙します。各エントリは `required` の真偽値を持ち、それは*有効な計画に対して*スコープされます。`required: true` は「生成側のステージがこのスコープで実行されるなら、この consume は満たされていなければならない」という意味であって、「生成側が常に実行される」ではありません。brownfield モードでだけ必要な consume は `conditional_on: brownfield` を取り、無条件の consume はこのフィールドを完全に省きます（`always` という値はありません）。
- **`produces`** は前向きのエッジを列挙します。下流のステージが「成果物 Z を生成するのは誰か」と尋ねると、グラフは `producersOf()` を通じて答えます — したがって `produces: [Z]` を宣言しているステージが、その上流に配線されます。消費されるすべての成果物は、`produces` と `optional_produces` を通じて、ちょうど 1 つの生成者へ解決されなければなりません。`aidlc-graph compile` は重複を拒否し、両方の生成側ファイルを名指しします。成果物名の再利用が妥当なのは、どのステージもそれを消費しない場合だけです。

この 3 つを整合させれば、コンパイラが自動的にステージを配置します。位置を決めるために `stage-graph.json` を手で編集することは決してありません。`requires_stage`、`consumes[].required`、`consumes[].conditional_on`、そして `for_each`（集約が宣言ではなく*推論*される仕組みを含む）のニュアンスは [フィールドリファレンス — いつ使うか](../reference/15-stage-definition.md#フィールドリファレンス--いつ使うか) で扱います。

### 4. ハーネスを再生成して `stage-graph.json` を再コンパイルする

`core/` に作成した YAML が正本です。パッケージャーを実行し、`dist/<harness>/` の Bun コピーと `dist-release/<harness>/` のネイティブ配布物を `core/` から生成します。どちらも Git の管理対象外のローカル出力です。新しいステージファイルを両方へコピーし、各グラフを再コンパイルします。

```bash
bun scripts/package.ts            # 全ハーネスの両配布形式を生成
bun scripts/package.ts --check    # 2回ビルドし、バイト単位で比較
```

ランタイムが読むのは、コンパイル済みの成果物 `<harness-dir>/tools/data/stage-graph.json`（インストール済みの Claude ツリーなら `.claude/tools/data/stage-graph.json`）であり、パッケージャーが呼び出すグラフコンパイラが YAML から生成します。すでにインストール済みのツリーで反復しているなら、そのツリーのグラフを直接再コンパイルできます。

```bash
aidlc engine graph compile
```

いずれにせよ、作成の流れは一方向のパイプラインです — `core/` の YAML を編集し、パッケージャー（またはインストール済みツリーに対する `compile`）を実行すると JSON が更新され、ランタイムのローダー（`loadStageGraph()`）がそのまま新しいノードを拾います。`stage-graph.json` を手で編集してはいけません。ビルド成果物であり、手作業の編集は次のコンパイルで上書きされます。完全なパイプラインの図と CI の乖離ガードは [作成フロー](../reference/15-stage-definition.md#作成フロー) にあります。

### 5. 現れることと、どのスコープで動くかを確認する

新しいノードがコンパイルされて入ったことと、どこで実行されるかを確認します。

```bash
# グラフ全体のトポロジー順 — あなたの slug が現れるはず
aidlc engine graph topo

# あなたのステージの成果物を誰が生成／消費するか
aidlc engine graph producers <artifact>
aidlc engine graph consumers <artifact>

# あるスコープの経路上のステージ — あなたのステージはこのスコープで実行されるか
aidlc engine graph scope <scope-name>

# スコープに対する依存の健全性
aidlc engine graph validate-scope <scope-name>
```

上の用語集のステージを、インストール済みの Claude Code ツリーに `.claude/aidlc-common/stages/inception/glossary-capture.md` として置き、`aidlc engine graph compile` でコンパイルすると、feature の経路にそれが含まれるようになります（抜粋）。

```text
$ aidlc engine graph scope feature
...
requirements-analysis
user-stories
refined-mockups
domain-design
units-generation
contract-design
delivery-planning
glossary-capture
functional-design
...
$ aidlc engine graph producers glossary
glossary-capture
```

これは Requirements Analysis の直後ではなく、Inception の最後に入ります。新しいステージは、そのフェーズで既にあるステージの後の、次の空き番号を取り、既存のステージが番号を振り直されることはありません。前のステージから新しいステージへのエッジは、コンパイル時に拒否されます。User Stories の `requires_stage` に `glossary-capture` を加えると、同じツリーは次のように出力します（長いダッシュは `-` で示しています）。

```text
$ aidlc engine graph compile
aidlc-graph compile: Compile invariant violated: stage "user-stories" (2.4) requires "glossary-capture" (2.10) - dependency must be lower-numbered. Fix: either renumber in stage-graph.json to match the dependency direction, or remove the offending requires_stage edge.
```

まったく新しいステージが、どのスコープでも自動的に実行されることは**ありません**。スコープのメンバーシップは、いまやステージ自身に住みます。フロントマターの `scopes:` 一覧が、それが実行されるすべてのスコープを名指しします。どのスコープも名指ししないステージは、どこでも `SKIP` です。したがってステージを追加したら、どのスコープがそれを実行すべきかを決め、ステージの `scopes:` 一覧に各スコープ名を追加してください — そして再コンパイルして、転置が `scope-grid.json` を更新するようにします — [スコープ](04-scopes.md) を参照。これは意図的な継ぎ目です。ステージ本文の作成がそれを*存在*させ、`scopes:` のタグがそれを*実行*させます。

---

## ステージを追加するとは、ステージファイルを書くこと — ランナーは任意の簡略コマンド

この章の見出しは、その拡張性の契約でもあります。**ステージを追加するとは、ステージファイルを書くことです。** 構造上、他に必要なものはありません。ステージがグラフへコンパイルされれば（上の手順 2〜4）、スキルも登録も不要で、すぐ単独で実行できます。

```bash
aidlc engine orchestrate next --stage <your-slug> --single
```

エンジンの `--single` モードは、その 1 ステージを分離して実行します。そのステージに対する `run-stage` ディレクティブを 1 つ（リードエージェント、解決された consumes/produces のパス、ルール、センサーとともに）出力し、コンダクターがそれを実行し、合成 ID のライフサイクルが監査ログへ確定されます。`next --single` はディスパッチ前に `STAGE_STARTED` を記録し、`report --single` は `STAGE_COMPLETED` を記録する前にその境界を要求します。
ディレクティブは `single: true` を運ぶため、コンダクターは設定された本文・トポロジー・レビュアー・完了検査を実行し、`report --single --stage <slug> --result completed` で 1 回だけ報告し、`done` で停止します。ワークフロー学習を実行することも、ワークフローの承認ゲートを開くこともありません。
`--single` の実行は意図的に分離されています。**主ワークフローの `Current Stage` に触れることは決してありません** — ツールは単独実行から主ワークフローを進めることを拒否します。単独実行は、そこに既にあるファイルのコピーを記録の `archive/` フォルダの下に保管したうえで、作業が文書を置く場所にステージの文書を書きます。

### ランナースキルは任意のパッケージング

出荷される実行可能なステージには、`skills/aidlc-<slug>/SKILL.md` に薄いランナースキルも付き、`/aidlc-<slug>`（たとえば `/aidlc-domain-design`）として入力できます。これらは **`--single` フラグに対する任意の簡略コマンド**であり、`next --stage <slug> --single` を駆動する約 6 行のシェルです。手書きではありません。ジェネレーターが、コンパイル済みで実行可能なステージ slug ごとに 1 つ出力するため、ランナーの集合が手作業でステージの集合から乖離することはありえません。（3 つのブートストラップ初期化ステージには、ステージごとのランナーが付きません — 単独 `--single` の意味を持たないためです。初期化フェーズ全体は、代わりに `/aidlc-init` コマンドです。`--scope` と説明を付けるとエンジンの intent-create の動きをパッケージし、`--scope` だけを付けると、まず何のための作業かを尋ね、説明だけを渡すとエンジンに新しい作業を求め、先に計画の提案を示します。）ステージを追加（または削除）したら、ランナーを再生成してください。

```bash
# コンパイル済みのステージ一覧から、すべてのランナーディレクトリを再生成
aidlc engine gen runners

# CI の乖離ガード: ランナー集合 != コンパイル済みステージ集合なら 1 で終了
aidlc engine gen runners --check
```

ランナーは **`hooks:` ブロックを持ちません** — 決定論的なスパイン（監査、センサー、実行時グラフのコンパイル、状態検証）はプロジェクト全体として `settings.json` にあるため、どのランナーもそれを無償で継承します。ランナーごとに複製すべきものはありません。またランナーは、コンダクターのペルソナを手で読み込むことも**ありません**。エンジンが、チャットへ渡す `run-stage` ディレクティブへ焼き込んで届けます。ランナーの本文は、自分が何をするかと、駆動する 1 つのコマンドを述べるだけです。

ランナースキルをすべて削除しても、すべてのステージは `/aidlc --stage <slug> --single` で実行できます — ランナーは、すでに実行可能なステージをパッケージしたものであり、ステージファイルがその定義です。作成の道筋は「ステージファイルを書く」であり、それは変わりません。

これらのランナーの背後にある規範となる契約 — エンジン、コンダクター、`run-stage` ディレクティブが、コンパイル済みステージをどう入力可能な `/aidlc-<slug>` スキルへ変えるか — は、開発者リファレンスの [スキルシステム §4（スキルとランナー）](../reference/17-skill-system.md) を参照してください。

---

## 自動で検証されること／自分で確認しなければならないこと

### 自動で検証されること

- **グラフ上の配置。** `compile` を実行すれば、ステージのエッジ（`requires_stage`、`consumes`、`produces`）がグラフへ解決されます。トポロジー順、生成者／消費者の検索、循環検出のいずれも、追加の編集なしに新しいノードを織り込みます。
- **コンパイル時のフィールド検証。** コンパイラはグラフを構築しながらフロントマターを検証します — 作成上の誤りは、実行時に静かに失敗するのではなく、`compile` で大きく失敗します。`lead_agent` や `support_agents` の値は、`loadAgents()` を通じて実際の `.claude/agents/*.md` ファイルに対して検査されます。更新すべきハードコードのエージェント列挙はありません。対応するファイルの無いエージェントを名指しするステージはコンパイルに失敗し（`lead_agent "<name>" has no matching .claude/agents/*.md`）、打ち間違いが実行時に 404 になるグラフを出荷することはできません。予約された `orchestrator` の slug（コンダクター自身。ブートストラップの初期化ステージで使われます）は例外です — エージェントファイルを持ちません。パイプラインのステージは、`lead_agent` と `support_agents` にまたがる連鎖の同一性の重複も拒否します。
- **乖離の検査。** ソースのチェックアウトでは、CI がすべてのツリーを `core/` からビルドし、`bun scripts/package.ts --check` が 2 回ビルドしてバイト単位で比較します。そのため生成ファイルが入力になることはなく、コミットし忘れるものもありません。インストール済みのツリーでは、`aidlc engine graph compile --check` は、グラフがステージファイルと一致していれば `0` で終了し、ステージが再コンパイルなしに編集されていれば `1` で終了して、``stage-graph.json is out of date. Run `aidlc engine
  graph compile` to regenerate.`` と出力します。
- **フェーズルールの付随。** ステージはディレクトリによってフェーズを宣言するため、対応する `phases/<phase>.md` のルール層がコンパイル時に付随します — そのエッジを自分で配線することはありません。

### 自分で確認しなければならないこと

- **スコープへの参加。** コンパイラはステージをグラフに置きますが、どのスコープがそれを実行するかは**決めません**。ステージ自身の `scopes:` フロントマター一覧に各スコープ名を追加し（そして再コンパイルして転置が `scope-grid.json` を更新するまで）、新しいステージはグラフに存在してもどこでも実行されません。気になる各スコープについて `aidlc engine graph scope <scope-name>` で確認してください。
- **本文の散文。** パースされるのはフロントマターだけです。`## Steps` の本文は、ステージが起動したときにリードエージェントが読みます — 他のステージファイルの構造に合わせて書いてください。パーサーが、曖昧な指示や欠けた指示を捕まえることはありません。
- **散文とエッジの整合。** `requires_stage` と `## Steps` の散文は乖離しえます — パーサーはエッジしか見ず、散文は見ません。手順に「インテントステートメントを読む」と書いてあるなら、対応する生成側のステージが実際に `requires_stage` に入っていなければなりません。歩調は手で合わせてください。
- **あなたのスコープにおける `required` の意味。** `required: true` の consume は、生成側を飛ばすスコープでは意味を失います — それは正当であってバグではありませんが、生成側が不在でもステージ本文が適切に処理することを確認するのは、あなたの仕事です（「利用できれば」というフォールバックのパターン）。
- **ドキュメント。** 新しいステージが、ドキュメントが手で列挙している数や表（ステージ数、フェーズの一覧）を変えるなら、ドキュメント方針に従い、同じ変更の中で更新してください。

---

## 境界の事例: データの作業とコードの作業

ステージファイルの作成とグラフの再コンパイルは、完全にハーネスエンジニアのデータの作業です — Markdown、YAML、JSON であり、`.ts` はありません。静かに越えてはならない線はこうです。あなたのステージを動かすために、グラフ*コンパイラ*が違う振る舞いをする必要があるなら — 認識されないフロントマターのキー、新しい種類のエッジ、新しい走査の規則 — それはデータを読むコードの変更であり、ここではなく [開発者リファレンス](../reference/15-stage-definition.md) に属します。仕様における予約キーの名前空間は、将来の構造的な拡張が場当たり的な追加ではなく予測どおりに着地するために、まさに存在します。それらのキーの消費者が出荷されるまで、スキーマはそれを拒否します。コンパイラがまだ実装していないキーが欲しくなったら、そこで止まってください — それはフレームワークの変更であり、検証の規律については [エージェントを追加する](../reference/11-contributing.md#エージェントの追加) とその兄弟の貢献レシピに従いますが、実装はコードに住みます。

---

## 次に読む

[エージェントを追加する](03-adding-an-agent.md) — 新しいステージが `lead_agent` として名指しするペルソナを作成し、それがリードまたは支援するステージへ結び付けます。
