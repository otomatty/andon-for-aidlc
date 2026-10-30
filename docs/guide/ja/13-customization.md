# カスタマイズ

AI-DLC はチームのやり方に寄せられます。この章では設定の上書き、スコープ、ステージの調整、ステータスライン、ツール権限を扱います。

> **ハーネス固有の設定。** ハーネスを問わず効くカスタマイズは、スコープ、ステージ深度、ナレッジ、ルールです。一方、この章の仕組み側（`settings.json` / `settings.local.json`、ステータスラインコマンド、`$CLAUDE_PROJECT_DIR`、ツール権限ブロック）は **Claude Code 専用** です。Kiro CLI では `.kiro/settings/cli.json` とエージェント設定、Kiro IDE ではエージェント Markdown の `tools:` と `permissions.rules`。Codex は `.codex/config.toml` と Starlark ルール、Cursor は `.cursor/hooks.json` と `.cursor/cli.json`（権限のみ）、opencode はプロジェクトルートの `opencode.json`、Copilot は `.github/hooks/aidlc.json`（フック配線）と `~/.copilot/config.json`（フォルダ信頼）です。各ハーネスの面は次を見てください。
> [Running on Kiro CLI](harnesses/kiro-cli.md)、
> [Running on Kiro IDE](harnesses/kiro-ide.md)、
> [Running on Codex CLI](harnesses/codex-cli.md)、
> [AI-DLC on Cursor](harnesses/cursor.md)、
> [AI-DLC on opencode](harnesses/opencode.md)、
> [AI-DLC on GitHub Copilot](harnesses/copilot.md)。

---

## 設定の上書き（`settings.local.json`）

共有の `.claude/settings.json` はプロジェクトのもので、バージョン管理に入ります。AI-DLC は自身のフック登録とコマンドの許可エントリを更新しますが、あなたのフック、deny ルール、独自の `statusLine`、環境変数、その他の設定は保持します。何を復元し、何を保持したかは注記で説明されます。このファイルに `--force` は不要です。廃止された同梱の許可エントリは自動では削除されません。チームに影響させず、自分の環境だけ変えたいときは個人用の上書きファイルを作ります（`.claude/settings.local.json` がすでにある場合、たとえば AI-DLC のステータスラインを自分用にオンにしているためにある場合は、上書きコピーせず、そのファイルに自分のキーを追加してください）。

```bash
cp .claude/settings.local.json.example .claude/settings.local.json
```

このファイルは `.gitignore` にあるので、個人の変更はコミットされません。用途は次です。

- モデルの切り替え（別の Opus や Sonnet のモデル ID など）
- ローカル用の環境変数
- セキュリティ要件に合わせたツール権限

---

## エージェントのモデルと effort（ティア）

配布エージェントは `tier:`（`judgment` | `balanced` | `templated`）を持ち、ビルドが各ハーネスのネイティブな model / effort キーへ投影します。モデルポリシーが未記録なら、judgment と templated のエージェントはセッションのモデルと effort を継承します。balanced のレビュアーは、Claude Code では Sonnet を medium effort で使い、Codex と opencode ではセッションのモデルを継承して medium の推論設定を適用します。Kiro、Cursor、Copilot では、全ティアがセッションのモデルと effort を継承します。投影表の全体は [Agent System](../reference/05-agent-system.md) を参照してください。

初回ウィザードの既定値は `balanced` **プリセット**です。レビュアーの**ティア**とは別物で、3 グループすべての effort を medium に記録します。Kiro IDE、Cursor、Copilot では、エージェントがセッションのモデルと effort を保つため（Kiro では、そのエージェントにモデルや effort が設定されていない限り）、プリセットを記録しません。
`aidlc config models --preset balanced --project --yes` でプリセットを選びます。

| プリセット | Deciding | Reviewing | Writing up |
|--------|----------|-----------|------------|
| `thorough` | セッションの effort | `xhigh` | セッションの effort |
| `balanced` | `medium` | `medium` | `medium` |
| `minimal` | `medium` | `medium` | `low` |

プリセットが設定するのは effort だけで、モデル ID は設定しません。エージェント別の例外がグループ設定より優先し、グループ設定が出荷時のティア既定値より優先します。Kiro IDE、Cursor、Copilot はこれらのグループ単位の effort 設定を表現できません。それでも記録したポリシーは保持され、効果のないキーとして書く代わりに、未反映として報告されます。Kiro CLI は各セッションを 1 つのモデルで実行するため、そこではプリセットが対話セッション全体に 1 つの effort を設定します（`minimal` は low、`balanced` は medium、`thorough` は extra-high）。これはセッションのモデルとともに個人の Kiro 設定に保存されます。[セッションのモデルと effort](harnesses/kiro-cli.md#セッションのモデルと-effort) を参照してください。明示的なグループ設定には、引き続き Kiro CLI 側の面がありません。プロファイル、上書き、アップグレードの経路は [モデル方針](18-install-and-lifecycle.md#モデル方針) を参照してください。

**1 体だけ** effort を変えるには、`aidlc config models --agent <name> --effort <low|medium|high|xhigh|max> --project --yes` を実行します。モデルを固定するには、`--effort` の代わりに `--model <id>`（インストールで有効なモデル ID）を使うか、両方を渡します。`--effort default`（または `--model default`）はそのエージェントのその設定 1 つを取り除き、プリセットやグループが再びそのエージェントに適用されるようにします。コマンドはこれを変更の取り消しとして表示します。`--project` の代わりに `--local` を使うと、変更は自分だけに留まります。config は変更を設定ファイルに記録し、そこからそのエージェントのファイルを書き直します。config が書き込む `aidlc-*-agent` ファイルを手で編集しないでください。`aidlc config models --check` は手編集をドリフトとして報告し、次の `aidlc config` が記録済みの値に戻します。Claude Code、Codex、opencode は 1 体のエージェントにモデルと effort の両方を受け付けます（Codex は `max` を `xhigh` として、opencode は `xhigh` を `high` として実行します）。Kiro CLI はモデルを受け付け、effort はモデルと一緒の場合だけ受け付けます。Kiro IDE（および v3 エンジン上の Kiro CLI）は 1 体のエージェントにモデルと effort の両方を受け付け、そのエージェントの `.kiro/agents/aidlc-<name>-agent.md` に書き込みます（[1 つのエージェントを独自のモデルと effort で](harnesses/kiro-ide.md#1-つのエージェントを独自のモデルと-effort-で)）。そこではプリセットやグループの effort は何も変えません。Cursor と Copilot では、すべてのエージェントがセッションのモデルと effort を保ち、コマンドはそこで適用できなかったことを伝えます。ソースから独自の配布物をビルドするときに **全エージェント** を抑えたいなら、`core/memory/org.md` / `project.md` の frontmatter に `tier_cap:` を書くか、パッケージャを `AIDLC_TIER_CAP=<tier>` で実行します。どちらも `bun scripts/package.ts` のパック時ノブで、実行時の設定ではありません。

---

<a id="per-project-default-scope"></a>

## プロジェクト既定スコープ

そのプロジェクトのワークフローをいつも同じスコープで始めたいときは、`.claude/settings.json` の `env` ブロックに `AWS_AIDLC_DEFAULT_SCOPE` を置きます（同梱ファイルはすでに `classic` に設定済みで、フレームワークのハードコードされたフォールバックと同じです。ライフサイクル全体を既定で回したいなら `feature` にします）。

```json
{
  "env": {
    "AWS_AIDLC_DEFAULT_SCOPE": "feature"
  }
}
```

同梱の `env` ブロックにあるのは AI-DLC のスコープ既定値だけです。プロバイダーとモデルの設定は、引き続き Claude Code と利用者のものです。

この設定では暗黙のスコープ解決に `feature` を使います。`aidlc config flags --default-scope feature --project --yes` でプロジェクトの既定値を記録することもできます（このチェックアウトだけなら `--local`）。実際の `AWS_AIDLC_DEFAULT_SCOPE` 環境変数が記録したフラグより優先するため、同梱 settings の env エントリを変えるか削除するまでは、その値が有効です。インテントの `aidlc-state.md`（レコードディレクトリの下）ができた後は、そのスコープが正本であり、暗黙の既定値を変えても進行中のワークフローは変わりません。

**優先順位（高い順）:**

1. 明示の CLI フラグ: `/aidlc feature` や `/aidlc --scope bugfix` が勝つ。
2. 自由文に対してエージェントが提案するプラン: `/aidlc fix the login bug` は引き続き `bugfix` を提案され、`/aidlc-init "fix the login bug"` も同様。提案されたプランは、既存の確認プロンプトで上書きできる。
3. `.claude/settings.json` が与える値を含む、実際の `AWS_AIDLC_DEFAULT_SCOPE` 環境変数。
4. 記録済みの `aidlc config flags --default-scope` の値（ローカル設定が共有プロジェクト設定より優先する）。
5. `classic` — 一致しない自由文の解決と、`--scope` なしの直接の `intent-create` 呼び出しが使うフレームワークのフォールバック。説明付きで `--scope` なしの `/aidlc-init` は、代わりに `/aidlc` と同じ計画の提案を表示する。

**有効な値:** `enterprise`、`feature`、`mvp`、`poc`、`bugfix`、`refactor`、`infra`、`security-patch`、`classic`、`workshop`、`express`。無効な値は起動時に分かりやすいエラーになります。追加スコープは `.claude/scopes/aidlc-<name>.md` を置き、所属ステージの `scopes:` にタグを付けて定義できます。[Contributing: Adding a Scope](../reference/11-contributing.md#スコープの追加) を参照してください。エージェントも `.claude/agents/` に追加定義できます。[Contributing: Adding an Agent](../reference/11-contributing.md#エージェントの追加) を参照してください。

**確認:** `/aidlc --doctor` で、設定した既定スコープが有効か確認します（環境変数と記録済みの既定値は同じ検査を共有します）。同梱の値では、その詳細一覧に次が含まれます。

```text
  ok    AWS_AIDLC_DEFAULT_SCOPE=classic (valid)
```

Claude Code の外のターミナルで実行した `aidlc doctor` は `.claude/settings.json` の `env` ブロックを受け取らないため、そこでは、シェルが `AWS_AIDLC_DEFAULT_SCOPE` を設定しているか、`aidlc config flags --default-scope` で既定値が記録されている場合にだけこの行が表示されます。作業が実行されるスコープは、`/aidlc --status` の `Scope:` 行に表示されます。

なぜスコープだけで、深度やテスト戦略はないのか。各スコープが深度を宣言し、テスト戦略はスコープが上書きしない限りその深度に従います。だから `classic` は Standard/Standard、`workshop` は Standard/Minimal、`express` は Minimal/Minimal で始まります。どちらかを変えたいときは CLI で `--depth` か `--test-strategy` を渡してください。

**機微な値:** `.claude/settings.json` はバージョン管理に入ります。秘密情報、認証情報、個人の上書きはここに置かないでください。機微なものには gitignore された `.claude/settings.local.json` を使います。

---

## スコープの設定

スコープは、どのステージを、どの深度とテスト戦略で実行するかを決めます。AI-DLC は名前付きスコープを 11 用意しています。表（EXECUTE/全ステージ数、既定深度、テスト戦略、それぞれの用途）の唯一の正本は [スコープ・深度・テスト戦略 § The 11 Core Scopes](05-scopes-and-depth.md#the-11-core-scopes) です。この節では、スコープの *設定と上書き* を扱います。

### スコープの選び方

明示するか、あなたの言葉からエージェントに提案させます。

```
/aidlc enterprise       # Explicit scope
/aidlc Build a payments API  # The agent proposes a plan, or offers to tailor one
/aidlc Fix the login bug     # The agent proposes "bugfix"; you confirm
```

### 実行時の上書き

ワークフローの途中でも、いつでもスコープを変えられます。

- **どの承認ゲートでも**: 別のスコープや深度を求める
- **ユーティリティコマンド**: `/aidlc --scope enterprise` でアクティブなスコープを変える
- **ステージの取り込み**: Ideation と Inception の承認ゲートで、一度飛ばしたステージをワークフローに戻せる

---

## インテント設定

9 つのインテント設定は、順に `depth`、`test-strategy`、`review`、`guard-policy`、`sensors`、`learnings`、`summary-confirmation`、`plan-approval`、`collaborators` です。さらに 3 つのキー `guard.review-freeze`、`guard.state-transition`、`guard.reviewer-scope` で、1 件の作業についてガードを 1 つ off にしたり on に戻したりできます。`guard.plan-approval` は `plan-approval` の別名です。CLI の経路は原子的な 1 つの設定コマンド `config-change` を共有します。設定を含む入力した `/aidlc` 行は、human-turn フックが行全体を記録しますが、フックは何も適用しません。エージェントがその行についてこの設定コマンドを 1 回実行し、コマンドが行のすべての設定を 1 つのトランザクションで検証・適用します。別々の更新を連ねるのではなく、1 つのコマンドに設定をまとめてください。

```
/aidlc --depth standard --test-strategy minimal --review advisory --guard-policy relaxed --sensors off --learnings on --summary-confirmation off
/aidlc config set guard-policy strict --sensors on --learnings on
/aidlc --scope bugfix --review none --guard-policy relaxed --sensors off
```

ネイティブの同等コマンドは `aidlc engine config set <key> <value>` に残りの `--key value` フラグを続けたものです。`config get <key>` は 13 のキーすべてを受け付け、`config list`（`--json` も可）は 13 すべてを返します。Guard Policy、切り替え可能なガード、手続きについては、実効値と設定元も含みます（`guard.plan-approval` は `plan-approval` の別名で、同じ値を読みます）。

```
/aidlc config get guard-policy
/aidlc config get plan-approval
/aidlc config get summary-confirmation
/aidlc config list --json
```

入力した `config set`、`get`、`list` の要求はディスパッチ中に実行し、ターンが終わる前にコマンドの実際の出力を返します。拒否された設定はそのエラーを返します。設定が成功してもワークフローは進みません。入力した `/aidlc` 行で下げるガードも同じ設定コマンドを通り、エージェントが行ごとに 1 回実行します。フックは何も適用しません。

読み取り専用の `guard.human-presence` の参照は `on (default)` または `off (env AIDLC_SKIP_HUMAN_PRESENCE_GUARD)` を返します。これは作業ごとの設定ではなく、`config list` にも含まれません。

`config-change` が受け付けるのは、それらの設定フラグと `--intent`、`--space`、`--project-dir` のセレクターだけで、設定を 1 つ以上必要とします。例:

```bash
bun .claude/tools/aidlc-utility.ts config-change --guard-policy relaxed --sensors off --intent login-fix --space platform --project-dir /work/shop
```

入力形式の `/aidlc config set guard-policy relaxed --intent <name> --space <name>` と `/aidlc --guard-policy relaxed --intent <name> --space <name> ...` は、エージェントの設定コマンドがスイッチを適用するインテントとスペースを指定します。フラグ形式の末尾の `...` は、任意のタスク説明を表します。存在しない名前のインテントは拒否します。状態ファイルがない場合、行のすべての設定（Guard Policy、plan approval、ガードのスイッチ、手続き、collaborators、深度、テスト戦略、レビュー）は、このチャットが次に始める作業のために保持され、エージェントが 1 行でそう伝えます。作業がまだない Claude Code のチャットで `/aidlc --test-strategy minimal` と入力すると、次の結果になりました。

```text
Test strategy will be minimal for the piece of work you start now (set by you).
```

セレクターは、アクティブなカーソルを切り替えずに、状態、memory のポリシー、監査を同じインテントへ向けます。指定した値はすべて変更前に検証します。不正な値や未知のフラグは、問題のフラグを示して更新全体を拒否します。memory が強制する strict は、明示的な `relaxed` または `off` の Guard Policy 設定を、併記したすべての設定とスコープ変更とともに拒否します。明示的な strict と無関係な設定は引き続き可能です。状態の読取り、共有の適用処理、監査バッチ全体、1 回の状態書込みを 1 つのロックで扱い、監査に失敗した場合は状態を変えません。`Last Updated` は、設定元の変更を含め、保存内容が実際に変わったときだけ更新します。同じ選択を繰り返しても何もしません。

スコープ変更は同じフラグを受け付け、同じ適用処理を使います。現在と同じスコープでも、指定した設定は適用します。スコープ由来の Guard Policy は、より厳しい新しい既定値に追随します。より低い新しい既定値に追随するのは、あなたがスコープ変更を頼んだときだけで、それ以外は現在の値を保ち、出力が 1 行でそう伝えます。手続きの行は引き続き新しいスコープの既定値に追随します。明示的な上書き（`set by you` または `set by a command`）と、旧記録で存在しない行は保持します。memory は引き続き実効ポリシーを決めます。明示的なフラグは明示的な設定元を記録し、`config-change` と同じ弱化の要件に従います。新しいスコープ自身のレベルと等しいレビューレベルは `Review Override` フィールドを空文字列に戻し、ステージの宣言とそのスコープのレビュー上限が適用されます。それ以外のレベルは、この作業の上限を置き換えます。

<a id="ceremony-switches"></a>

### 手続きの切り替え

スコープは 5 つの独立した手続きの既定値を持ちます。それぞれ `on` か `off` を取ります。出荷されるスコープは、既定値に頼らず 5 つすべてを明示的に宣言するようになりました。いずれかを省いたスコープファイルは、引き続き `on` にフォールバックします。Classic は sensors、learnings、plan approval を `on`、summary confirmation を `off` にします。Bugfix は learnings と summary confirmation を `off` にし、sensors と plan approval は `on` のままです。Express は最初の 4 つを off にし、poc は plan approval も off にします。`collaborators` は on 既定の例外です。`enterprise` でだけ on、ほかのすべてのスコープでは off で出荷されるため、初回の実行は軽く、チームは意図してコラボレーターを有効に戻します。

| スコープキー | インテントのフラグ | 全体を無効化する環境変数 | off で省くもの |
|-----------|-----------------|--------------------|------------------|
| `sensors` | `/aidlc --sensors on\|off` | `AIDLC_DISABLE_SENSORS=1` | センサーの実行とそのゲート検査 |
| `learnings` | `/aidlc --learnings on\|off` | `AIDLC_DISABLE_LEARNINGS=1` | ステージの学びの読み書きの手続き |
| `summary_confirmation` | `/aidlc --summary-confirmation on\|off` | `AIDLC_DISABLE_SUMMARY_CONFIRMATION=1` | 出力前の独立した要約確認のチェックポイント |
| `plan_approval` | `/aidlc --plan-approval on\|off` | `AIDLC_DISABLE_PLAN_APPROVAL_GUARD=1` | 各コード計画をビルド前に承認するよう求める停止（[Plan approval](#plan-approval)） |
| `collaborators` | `/aidlc --collaborators on\|off` | `AIDLC_DISABLE_COLLABORATORS=1` | ステージのサポートエージェント。off ではすべてのステージをリードだけで実行する（互いに見えないスポーク、モブのラウンド、パイプラインのサポートリンクなし）。レビュアーには影響しない |

優先順位は、全体を無効化する環境変数（`1`）→ 有効なインテントのフィールド → スコープの既定値 → `on` です。無効化の環境変数は `aidlc config flags --bypass <NAME>` でも記録できます。新しいインテントは、`aidlc-state.md` の `Guard Policy` の後に `Sensors`、`Learnings`、`Summary Confirmation`、`Plan Approval`、`Collaborators` を、それぞれ `on (from scope classic)` のような設定元ラベル付きで保存します。この作業のために合成された計画では、`--status` はそのラベルを `(from the approved plan)` と表示し、状態ファイルはスコープを保持します。ラベルが `set by you` になるのは、あなたが頼んだことを記録が示すときです。つまり、自分の行にスイッチをフラグとして入力した（その横に入力した設定も含む）、自分の端末でコマンドを実行した、または自分の言葉で頼み、エージェントがその依頼をしたメッセージを設定コマンドで示した（`--message <id>`）、のいずれかです。エンジンは、そのメッセージがあなたのものであり、このチャットのもので、後の判断で使い切られていないことを証明します。あなたのメッセージ全体が監査行に載ります。それを頼んでいない返答（「looks good, carry on」）の後にエージェントが自分で実行した設定も効果は持ちますが、`set by a command` になります。要求と一緒に入力した sensors、learnings、summary confirmation（`/aidlc --learnings on build the export`）や、作業が存在する前に入力したものも、その要求で作られる作業では `set by you` になります。あなたがそのチャットで頼んだ後に、新しい作業を始めるコマンドが持つ plan approval や Guard Policy も同様です。エンジンはフラグの背後に、コマンドではなくあなたの言葉を置きます。背後にあなたのメッセージがなく、エージェントが自分で追加したフラグは、エージェントやスクリプトが実行するコマンドによるもので、`set by a command` になります。進行中の作業への変更は、どちらの場合も `CEREMONY_SET` を記録します。新しい作業を始めるコマンドのフラグは、それを記録せずに新しい状態ファイルに保存されます。進行中の作業で summary confirmation や plan approval を off にするには、あなた自身のターンが必要です。エージェントが実行すると、入力するよう求めるメッセージとともに拒否されます。フックにメッセージ本文を渡さない Kiro IDE のビルドでは入力しても効かないため、拒否のメッセージは Kiro IDE の更新を求めます（[Kiro IDE ガイド](harnesses/kiro-ide.md#kiro-で違うところ)）。`/aidlc --status` は実効値と設定元を表示します。
スコープを変えると、あなたの上書きを保ったまま、スコープ由来の設定を更新します。存在しない、または不正なフィールドは、実行を止めずにスコープの値へフォールバックします。summary confirmation を設定またはスコープの変更で on にすると、その後に実行される作業に適用されます。ゲートで待っているステージや、すでに終わった Unit の作業に、受けたことのない要約の確認が求められることはありません。

コンポーザーは compose ゲートで、これら 5 つとスコープの `review_cap` を提案し、承認前にどれでも変えられます。コンポーザーが自分から off にしないのは plan approval だけです。ゲートで「skip plan approval for this work」と言えば、作業は plan approval が off、設定元 set by you の状態で作られます。これらの値が適用されるのは、ストックの計画でもカスタムの計画でも、この作業だけです。スコープとして保存した計画は値を frontmatter に保存するため、そのスコープの新しいインテントはすべてその値で始まります。それでも無効化の環境変数は優先します。ゲートはそれが強制的に off にする `on` の値に印を付け、ワークフローの途中では、エージェントがどこで設定されているかを探さずに、そのスイッチはワークフローの外で外す必要があると 1 行で伝えます。

自らが名指す承認である plan approval を除き、これらのスイッチは承認ゲート、人間のターンによる権限、監査、チームの Unit 間書込み保護を省きません。Classic は walking-skeleton の手続きを off にし、ゲート付きの流れのレビューを advisory に抑えます。明示的な自律実行では、マージ前の 1 回のレビューが残ります。

隔離された `--single` の試行は、主インテントの手続きの上書きではなく、選択したスコープの方針を使います。そのスコープは合成のステージ開始イベントに記録され、完了まで固定されます。別のスコープでの再開は拒否します。スコープが記録されていない旧形式の隔離開始は、要約確認を維持し、このスコープ比較を行いません。

<a id="plan-approval"></a>

### 計画承認（Plan approval）

コード生成がコード計画からビルドする前に、AI-DLC はその計画の承認を求めます。この作業で尋ねるかどうかは `plan_approval` の手続きが決めます。

- **On**（express と poc 以外のすべての出荷スコープ）: 各計画を要約とパスとともに **Approve Plan**、**Request Changes**、**I'll edit the files** で示し、あなたが答えるまで何もビルドしません。
- **Off**（express と poc）: 計画が書かれると 1 行が表示され、ビルドが始まります。

  > Plan written: aidlc/spaces/default/intents/260820-checkout/construction/code-generation/code-generation-plan.md. Plan approval (you approve each code plan before it is built) is off for this piece of work (from scope poc). Starting code generation now. You can ask me to go over the plan at any time.

  監査証跡には、ビルドした計画のフィンガープリントを持つ `PLAN_APPROVAL_SKIPPED` 行が入り、質問ファイルは `[Answer]: Plan approval off` になります。あなたが承認したという記録は残りません。

**先に計画を確認する。** plan approval が off の場合、各計画を示す行は、いつでもその計画の確認を頼めることを伝え、ビルドが始まります。自分の言葉で頼めば、ビルドを待たせたままその計画が承認のために示されます。設定は off のままで、次の計画は尋ねずにビルドされます。頼んだときにすでにその計画がビルド中の場合は、そのビルドが終わってから、ビルドされたものと並べて計画が示され、あなたが答えるまでほかには何も始まりません。承認すればビルドされたものを保ちます。頼んだ変更は、その Unit の承認ゲートに戻ってきます。そこで **Request Changes** を選ぶと、あなたの言葉とともに差し戻されます。

**off にできるのはあなただけ。** 自分の言葉で伝える（「skip plan approval for this work」）とエージェントが off にします。または `/aidlc --plan-approval off` か `/aidlc config set plan-approval off` と入力すると、エージェントが設定コマンドを実行します。どちらの場合もこの作業に適用され、`CEREMONY_SET` 行を記録します。あなたの回答を待っていた計画は、その時点でビルドされます。plan approval に言及した質問や発言は何も変えません。作業が存在する前、compose ゲートやスコープ確認の時点では、あなたの言葉はその要求への回答になります。その要求から作られる作業は、plan approval が off、設定元 set by you で始まります。作業を説明する前に言った場合は、次に行う要求への回答になります。ただし、ここにほかの作業があり、代わりにそれを再開した場合は、その作業に適用され、そのことが 1 回伝えられます。ほかの要求から作られた作業はスコープの値を保ち、先に `/aidlc --plan-approval on` と入力すると、その言葉を取り消せます。エージェントが自分から off にすることも、提案することもありません。直前の判断以降にあなたの返答がない状態で実行すると、その設定コマンドは拒否されます。on にする操作（`/aidlc --plan-approval on`）は、エージェントを含めどこからでも可能で、次の計画から適用されます。`guard.plan-approval` は同じスイッチの別名です。`/aidlc config set guard.plan-approval off` は plan approval を off にし、`Guards Off` 行は書きません。

**編集された計画。** 承認後に編集された計画を再び尋ねるかどうかは、この設定ではなく Guard Policy が決めます。`strict` は再び尋ね、`relaxed` と `off` は 1 行で知らせて続行します（[Guard Policy](#guard-policy) を参照）。

**on を保つもの、全体で off にするもの。**

- memory の `## Guard Policy` セクションに `Mode: strict`（`org.md`、`team.md`、`project.md` のいずれか）があると、express と poc を含め、リポジトリの全員について plan approval を on に保ちます。off にしようとすると、そのファイルを示す一文とともに拒否され、`/aidlc --status` は `Plan Approval: on (guard policy strict (from project.md))` を表示します。
- マシン単位のスイッチ `AIDLC_DISABLE_PLAN_APPROVAL_GUARD=1` は、そのマシンのすべての作業について plan approval を off にし、memory のロックより優先します。これが有効になるのは、ハーネスがそれを付けて起動されたとき（session-start フックがそのセッションについて記録します）、`aidlc config flags --bypass AIDLC_DISABLE_PLAN_APPROVAL_GUARD` で記録されたとき、またはプロジェクトにハーネスのセッションが記録されていないとき（CI、素の CLI 実行）です。セッション内でコマンドが自分のためだけに設定した場合は、未設定として読まれます。そのようにビルドした各計画はスキップとして記録され、`Source` がそのスイッチを示します。

**スコープの変更** は新しいスコープの値に従います。feature から express へ移ると plan approval は off になり、express から feature へ移ると on になります。この作業について自分で設定した値は保たれ、memory のロックは引き続き優先します。これは Guard Policy とは異なります。Guard Policy では、より低いスコープ既定値に追随するのはあなた自身がスコープ変更を頼んだときだけで、それ以外は厳しい値が保たれます。

**チームモード。** 各 Unit の計画は、その Unit の所有者が自分のチェックアウトで承認します。plan approval が off の場合はそこで尋ねずにビルドされ、チームのマージは承認の代わりにスキップの記録を受け入れます。

**Kiro IDE。** フックにメッセージ本文を渡さない Kiro IDE のビルドは、計画の確認の要求を聞き取れません。そのため、そこではすべての計画が引き続き承認のために示され、Kiro IDE を更新すれば計画を尋ねずにビルドできることを 1 行で伝えます。

`/aidlc --status`、`/aidlc config get plan-approval`、`/aidlc config list` は、実効値とその出どころを表示します。例: `Plan Approval: off (from scope poc)`。

<a id="change-control"></a>
<a id="guard-policy"></a>

### Guard Policy

Guard Policy は `strict`、`relaxed`、`off` の 3 つの値を持つ 1 つの設定です。いま取り組んでいる作業について、フレームワークのガードがどこまで道を譲るかを決めます。扱うのは 2 つのことです。すでに承認したものが下で変わっていたときにどうするか、そして誰も頼んでいない作業に対して 5 つのガードがどれだけ強く守るかです。

**承認済みの入力が変わったとき。** レビュー済みの文書がレビュー後に編集された、または現在の要約確認なしに出力が保存された場合です。

- `strict` は承認を開き直します。変わったものを示す平易な一文とともに実行が止まり、もう一度あなたに尋ねます。あなたの確認が最新で、エージェントがその前に保存したドキュメントがまだ保存し直されていないだけで、まだ何もそれをレビューしていない場合は、エージェントがまずそれを保存し直し、それで解消しない場合にだけあなたに尋ねます。
- `relaxed` と `off` はそのまま進みます。変更は監査証跡に `CHANGE_ACCEPTED` 行として 1 回記録され、それについて 1 行が伝えられ、実行は続きます。何も削除されません。承認とその証拠は元のまま残ります。

コード計画を承認した後にほかのコードが動いた場合（`git pull`、別の Unit の着地など）は、後述の 1 つの例外を除き、どの値でも再び尋ねません。計画の承認は、計画とそのテスト指示についてのものだからです。ビルドは続き、どのファイルが動いたかが伝えられ（例: `2 files changed since this plan was approved: src/api.ts, src/db.ts. Building auth now.`）、`CHANGE_ACCEPTED` 行が記録されます。あなたが取り込んだ AI-DLC の更新はあなたの変更ではありません。そのファイルが示されることはなく、動いたのがそれだけなら、何も伝えられず記録もされず、Unit の並行ビルドもそれらのコミットを求めずに始まります。

例外は、`strict` のもとでの Unit の並行ビルドです。コード生成の開始後にプロジェクトで起きた変更のうち、Unit 自身の着地でも AI-DLC の更新でもないもの（あなたの編集やコミット、`git pull`）は、次の Unit の着地を止めます。`relaxed` と `off` では、変更を保ったまま Unit が着地し、1 行でそう伝えられます。変更が計画の承認後に起きた場合、`strict` は Unit を準備する前に計画の再承認も求め、再承認しても着地での停止は解除されません。先に進むには、変更を元に戻してエージェントに続けるよう伝えるか、この作業について Guard Policy を `relaxed` にします（`/aidlc --guard-policy relaxed`）。そうすると変更を保ったまま Unit が着地します。チームが memory で `strict` をロックしている場合、そのスイッチはファイルを示す 1 行とともに拒否されるため、そこでは変更を元に戻すのが先へ進む方法です。

**ガードがどれだけ強く守るか。** `strict` は 5 つのガードをすべて維持します。`relaxed` は計画の再承認と review freeze を下げます。`off` はその 2 つに加えて state transition と reviewer read scope を下げます。どの値も human presence と、クレーム済みチェックアウトの Unit 書込み所有権は下げません。下げたガードは、何かを通すたびに監査行を書きます。

**承認後に計画そのものが変わったとき。** 同じ Unit またはステージの対象と試行について、計画、テスト指示、Testing Contract の編集は、`relaxed` または `off` では必須の再承認なしに続行します。`strict` ではそれらの編集が承認を開き直し、編集された計画について再び尋ねます。どちらの場合も、「Your approved plan changed before the build: step 4 now says ... instead of ...」のように何が変わったかを示す 1 行が表示され、エージェントが承認した計画に戻すかどうかを尋ねます。ビルドがすでに始まっている場合は、同じ行がビルドを進めていることを伝え、代わりに承認した計画をビルドすることを提案します。はいと答えるか、どのチャットでも自分の言葉で頼めば（`/aidlc` の後でも可）、あなたが与えた計画、テスト指示、承認を元に戻し、続くビルドは承認した計画のものになります。これを決めるのは Guard Policy だけです。[plan approval](#plan-approval) の設定が決めるのは、そもそも計画について尋ねるかどうかだけです。同じインテント、対象、試行の中で Testing Posture、スコープ、テスト戦略、プロジェクト種別が変わった後の更新にも同じ規則が適用されます。必要に応じて契約と指示を更新し、ガードが下がっている間は続行します。決めるのは実効的なガード設定で、`/aidlc --status` に表示されます。計画の再確認はいつでも頼めます。

最初の Plan Approval（[plan approval](#plan-approval) が on の間）とほかのゲートは引き続き必須です。ガードが下がっていることは、編集された内容が承認されたことを意味しません。あなたの元の回答と承認の証拠は、実際に承認したものの記録として残ります。レビュアーの判定は変わらず、証拠は削除されず、エージェントがあなたの代わりに答えることもありません。

Plan Approval は AI-DLC 自身が尋ねます。計画の要約とパスを **Approve Plan**、**Request Changes**、**I'll edit the files** とともに示します。コード生成の開始以降、または前の計画の承認以降に、ワークスペースのファイルがすでに変わっている場合（計画より先に走ったエージェントや、あなた自身の編集）、要約の最後にそれらを示す 1 行が付きます: 「Already changed before you approved: src/app/page.tsx.」。それ以降に承認された計画が示すファイルはその計画自身のビルドなので一覧に載らず、AI-DLC の更新が変えた AI-DLC 自身のファイルも載りません。この作業のどのチャットからでも、あなたが選んだものを正確な言葉を添えてエージェントが記録します。「Approve, but add a test for the empty cart」は承認と指示です。エージェントがそれを計画に追加し、承認はその時点の計画を対象にします。計画を編集するか `code-generation-questions.md` に回答を書き、終わったことをエージェントに伝えることもできます。下がった plan-approval のガードが許す内容の変更について、再承認の停止を追加することはありません。

既存の委譲ワーカーは、検証済みの親インテントの現在の plan-approval 設定に従います。下げたり上げたりすると次の検査で適用されます。その設定を適用するためにワーカーを作り直す必要はありません。

#### スコープごとの既定

| スコープ | 既定 |
|-------|---------|
| enterprise | strict |
| poc, express, classic, bugfix, feature, mvp, refactor, workshop, security-patch, infra | off |

`bugfix`、`classic`、`express`、`feature`、`infra`、`mvp`、`poc`、`refactor`、`security-patch`、`workshop` は `off` で出荷されます。`classic` は暗黙の既定スコープなので、スコープを指定しない作業も `off` で始まります。`enterprise` では、`off` はあなたが求めるものです。合成された計画はスコープファイルを書きません。一致した計画は、ストックスコープの既定値か、あなたが求めたより厳しい値を持ちます。カスタム計画は、既定値がゲートで承認した値かそれより低いストックスコープ上で実行されます。スコープとして保存した計画は、その値を `guard_policy: <value>` として保存します。

インテントの作成は、計画が実行されるスコープから Guard Policy を読みます。コンダクターは `strict` または `relaxed` のときに `--guard-policy` を渡し（これで低いスコープ既定値を引き上げます）、`off` では決して渡しません。compose ゲートで一致した計画の Guard Policy を下げると、その値を持つストックスコープ上のカスタム計画になります。上げた場合、計画は一致したままです。どちらの場合も、インテントは作成時にその値を取ります。コンポーザーが進行中インテントの値を変えることはありません。

#### 設定する場所は 3 つ

1. **スコープファイル。** `scopes/aidlc-<name>.md` の `guard_policy: strict | relaxed | off` が、そのスコープの新しいインテントすべての開始値です。出荷スコープはすべてこれを宣言します。宣言しないスコープファイルは、`enterprise` 以外のすべての出荷スコープと同じく off で始まるため、strict にしたいプラグインや合成スコープは `guard_policy: strict` と書きます。
2. **memory。** `aidlc/spaces/<space>/memory/org.md`、`team.md`、`project.md` のいずれかに、1 行 `Mode: strict` だけの `## Guard Policy` セクションを置くと、リポジトリの全員について strict を保ちます。これはスコープの既定値とインテントごとの値より優先し、[plan approval](#plan-approval) を on に保ちます。明示的な `--guard-policy relaxed`、`--guard-policy off`、`/aidlc config set guard.<fence> off`、または plan approval を off にする操作は、memory ファイルを示す一文とともに拒否され、そのコマンドに併記した設定やスコープ変更も一切適用されません。ガードを `on` にする操作は引き続き可能です。`Mode: relaxed` または `Mode: off` は、値がスコープ由来のすべての作業についてポリシーを設定し（status には例えば `Guard Policy: off (from team.md)` と表示されます）、宣言している最も狭い層が優先します（`project.md`、次に `team.md`、次に `org.md`）。1 件の作業について設定した値はその作業で保たれ、いずれかの層の `Mode: strict` は引き続きすべてに優先します。空のセクションは何も変えません。それ以外の値は、ファイルと 3 つの許可値を示す検証エラーになります。
3. **インテント。** `/aidlc --guard-policy relaxed|off`、`/aidlc config set guard-policy relaxed|off`、または確認の言葉 `guard policy relaxed|off` を入力すると、エージェントが同じターンで選択中の作業に設定コマンドを実行し、それが監査行を記録します（`/aidlc --status` には `Guard Policy: relaxed (set by you)` と表示されます）。ほかのインテント設定を含む入力コマンドは、まずすべての値を検証し、同じロックのもとですべてを適用します。不正なコマンドや不正な併記設定は何も変えません。入力によるスイッチの後、コンダクターは `next` を実行し、道を譲った旨の行、または注入に対応するハーネスでは `AIDLC Guard Policy: ...` のフックコンテキストを伝えます。平易な言葉での要求（「stop asking me to re-approve when files change」「be strict about changes」）はコンダクターが実行します。求められた値で `config-change --guard-policy <strict|relaxed|off>` を実行し（直前の判断以降にあなたの返答が記録されていれば弱化します）、その出力をそのまま表示して止まります。この Kiro IDE のビルドがプロンプト本文を渡さない場合、進行中の作業は弱められません。Kiro IDE を更新するか、既定値の低いスコープで新しい作業を始めてください。スコープの変更は、スコープ由来のポリシーを自動的に引き上げることがあります。より低いスコープ既定値に追随するのは、あなたがスコープ変更を頼んだときです。それ以外のスコープ変更では、より厳しい値をそのまま残し、1 行でそう伝えます。作成時にスコープ自身の既定値を指定すると、スコープの値として記録されます。廃止済みの `Change Control: relaxed|off` フィールドだけがある場合は、値を変えずに、ポリシーの監査行も書かずに、自動的に正規化されます。

<a id="where-the-value-lives"></a>

#### 値の置き場所

解決した値は、作成時にインテントの `aidlc-state.md` へ `- **Guard Policy**: <value> (from scope <name>)` として書かれ、フラグ、入力した確認の言葉、またはコンダクターが設定コマンドで実行する平易な言葉での要求によって書き直され、値だけが読まれます。状態ファイルはインテントとともにコミットされるため、値はセッションを越えて残り、チームメイトも同じ値を見ます。進行中インテントの実効値を変える memory の編集は、次に対象の検査が走ったときに、その memory ファイルを示す `GUARD_POLICY_SET` 行として記録されます。このフィールドができる前に作られたインテントは、設定するまで `strict (not set)` のままです。ただし、memory ファイルが `relaxed` または `off` を宣言していれば、それが適用されます。不正なフィールドは、3 つの値のいずれかを指定した `/aidlc --guard-policy` で修復するまで利用できません。次のインテントは、再びスコープの既定値から始まります。

状態ファイルが `Guard Policy` と廃止済みの `Change Control` の両方を異なるポリシーの語で持っている場合（状態ファイルは git で移動するため、改名前のリリースを使うチームメイトが両方を残すことがあります）、次の `next` がどちらか一方を残し、それを唯一の行として書きます。残すのは、監査証跡が最後に設定されたと示すもの、なければあなた自身が設定したもの、なければスコープの開始値、なければより厳しいものです。`Source: command` と、両方の行を示す `Settled` フィールドを持つ `GUARD_POLICY_SET` 行を記録し、何も尋ねません。あなた自身の最後の選択を残したときは何も言いません。記録から判断できなかったときは、どちらを残したかを 1 回伝えます。例:

> This work had two settings for how closely AI-DLC checks changes, and they disagreed. The record does not say which was set last, so AI-DLC keeps the stricter one: it checks everything. You can change it any time.

それまでは status が `strict (from conflicting state lines)` を表示します。memory で strict を保持するチームは strict を保ち、2 つの行はそのまま残ります。両者が一致する場合は `Guard Policy` の行を使います。ポリシー行を書き込むと廃止済みの行が取り除かれ、設定は 1 つになります。

#### この設定の旧称は Change Control

旧表記はこのリリースではすべて引き続き使え、次のマイナーバージョンで削除されます。対象はスコープキー `change_control`、状態フィールド `Change Control`、memory の見出し `## Change Control`、フラグ `--change-control`、config キー `change-control` です。廃止済みのフラグや config キーを入力すると、新しい表記を示す 1 行が表示されます。廃止済みのスコープキーや memory の見出しは、何も言わずに読まれます。旧名が再び書かれることはありません。ポリシー行を書き込むと、それが唯一の行でも `Guard Policy` と並んでいても、廃止済みの `Change Control` 行が取り除かれます。`CHANGE_CONTROL_SET` 監査イベントは古い台帳で引き続き読めます。新しい行は `GUARD_POLICY_SET` です。

廃止済みの `Change Control: relaxed` または `Change Control: off` の行だけを持つ作業は、あなたの次のメッセージで改名されます。AI-DLC は値を保ち、行を `Guard Policy` として書き、ポリシーの監査行は書きません。その改名が起きていない場合は、すべての `/aidlc` の実行で、ディレクティブの `change_notices` に通知が載り、その表示によって行が書き換えられることはありません。例: `This work still has an old setting that lets AI-DLC skip some of its checks (it asks you to confirm less often). Do you want to keep that, or have AI-DLC check everything again? I'll ask again until you choose.` `/aidlc config set guard-policy relaxed` または `guard policy relaxed` と入力すると、エージェントの設定コマンドがその値を保って行を `Guard Policy` として書き直します。strict を求めれば、コンダクターが設定コマンドでガードを引き上げます。どちらの書込みでも通知は止まります。廃止済みの strict の行だけの場合は通知が出ず、次に何らかの Guard Policy の設定が書き込まれたときに書き直されます。

<a id="the-five-fences"></a>

### 5 つの個別ガード

ガード（fence）は、何も求めていない操作、つまりワークフローが現在実行しているどのステップも求めていない操作を拒否するガードです。3 つのガードは、1 件の作業について off にし、また on に戻せます。plan approval のガードは代わりに [plan approval](#plan-approval) の設定に従い、編集された計画を再び尋ねるかどうかは Guard Policy が決めます。human presence は鍵の保持者で、作業ごとのスイッチを持ちません。

| ガード | 拒否する操作 | 作業ごとのスイッチ | マシン全体を無効化する環境変数 |
|-------|-----------------|------------|--------------------------|
| Plan approval | 計画の承認前のコード。plan approval が off の場合は、尋ねずにビルドするとエンジンが記録する前のコード | なし。`guard.plan-approval` は [plan approval](#plan-approval) 設定の別名 | `AIDLC_DISABLE_PLAN_APPROVAL_GUARD=1`（plan approval を off にする） |
| Review freeze | レビューレシート後のレビュー済み内容の編集 | `guard.review-freeze` | `AIDLC_DISABLE_REVIEW_FREEZE_HOOK=1` |
| State transition | ワークフロー自身のものに代わる直接のライフサイクルコマンド | `guard.state-transition` | なし |
| Reviewer read scope | 委譲レビュアーによる兄弟 Unit の内容の読取り・検索 | `guard.reviewer-scope` | `AIDLC_DISABLE_REVIEWER_SCOPE_HOOK=1` |
| Human presence | 実際の人間のターンを伴わない承認や回答 | なし。鍵の保持者に帯域内のスイッチはない | `AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1` |

```
/aidlc config set guard.review-freeze off
/aidlc config set guard.review-freeze on
```

ガードやポリシーの語を下げるのは、その人の判断です。自分の言葉で頼めばエージェントが設定コマンドを実行します（「turn the guards off」のようにガード全体を off にするよう頼むと、Guard Policy が `off` になります）。または `/aidlc config set guard.<fence> off`、`/aidlc --guard-policy relaxed|off`、確認の言葉 `guard policy relaxed|off` のいずれかを、値を 1 つ選んで入力します。エージェントの設定コマンドは、入力されたスイッチを `--intent <name>` と `--space <name>` で選ばれた作業へ、これらのセレクターが省略された場合はチャットのワークフロー選択で選ばれた作業へ適用し、状態と監査行を書き込みます。注入に対応するハーネスでは `AIDLC Guard Policy: ...` をフックコンテキストとして報告します。存在しない名前のインテントは拒否します。作業が存在する前に入力した Guard Policy の `relaxed` または `off` のスイッチは、このチャットが次に始める作業のためのものです（`Guard Policy relaxed for the piece of work you start now (set by you).`）。要求と同じメッセージで入力した場合は、その要求に付きます（`Guard Policy relaxed for the work you are asking for (set by you).`）。新しい作業は作成時にそれを受け取り、代わりに開いている作業を続けると選んだ場合はそちらに適用されます。メッセージだけで開いている作業が変わることはありません。`/aidlc --guard.review-freeze off fix the parser` のようなガードのスイッチも同様に働きます（`The review freeze check is off for the work you are asking for (set by you).`）。唯一の例外は、コード計画の質問が開いていて、あなたが計画ファイルを編集していないときです。このとき、言葉と一緒に入力した設定（`/aidlc --guard-policy off approve the plan`、または選択とともに `strict`）はこの作業のためのもので、言葉はその質問へのあなたの返答になります。引用符で囲まれていない `--` の後の言葉は、引き続き新しい作業の説明です。作業が存在する前に入力した plan approval の `off`、ガードのスイッチ、そのほかのすべての設定（手続き、collaborators、深度、テスト戦略、レビュー）も同様に、このチャットが次に始める作業のために保持されます。無関係な返答は何も開きません。

CLI の設定コマンドが弱化するのは、直前の判断以降にあなたの返答が届いている場合だけで、スイッチの権限についてセッションの照会は行いません。承認と同じメッセージで頼んだ設定は、その承認に乗ります。「approve, and turn plan approval off」は 1 つのステップで off にして承認します。「Approve the plan, and run Construction on its own from here」も両方を行います。設定はどちらの順序でも、どの質問でも有効です。エージェントは、まだその返答の上にいる間なら、先にあなたの回答（承認、または要約、コード計画、Construction の質問への回答）を記録し、その後に設定を記録できます。すでに承認やほかの判断を与えたあなたのメッセージは、あなたが別のメッセージを送った後、検査がエージェントを止めた後、または次の質問が出た後には、もう設定を変えません。そのため、エージェントがあなたの以前の「Approve」をもとにあなたの検査を off にすることはできません。それ自身のメッセージで頼めば、すぐに行われます。承認のためのコード計画が書かれた後は、plan approval が off になるのは、その質問が表示された後にあなたが送ったメッセージによってだけです。それより前に頼んだ場合は、その計画について理由を示す 1 行とともに一度だけ尋ねられ、もう一度そう伝えると off になります。そのメッセージでエージェント自身の質問に答えた回答も、残りを有効なまま残します（エージェントが変更を提示したときに選んだ選択肢は、その変更の要求です）。あなたのメッセージの後に記録されたほかの判断はそれを使い切り、承認には常にそれ自身の返答が必要です。フックは Windows でも動くため、プロンプトを転送するすべてのハーネスで入力によるスイッチが使えます。すでに off のガードや、すでに `set by you` となっている同一のポリシーの語は、CLI の更新が何もしないためキーが不要です。

ガードの質問が「turn the check off for this piece of work」を提示したときは、それを選ぶだけで十分です。エージェントが代わりに off にし、スイッチが出力する行で、この作業では off であることと、いつでも on に戻せることを一度だけ伝えます。Codex ではスキルは `$aidlc` です。

スイッチの入力として数えられるもの: `/aidlc`（または `$aidlc`、`aidlc`）で始まり、フラグを先に置いたメッセージ。例: `/aidlc --guard-policy relaxed`、`/aidlc --guard-policy off --guard.state-transition off`、`/aidlc --guard-policy relaxed build the auth service`（説明はフラグの後に続き、読み取られません）。同じコマンドの頭に続く `config set guard-policy relaxed|off` または `config set guard.<fence> off` で、その後に任意でほかの設定（`--depth minimal --sensors off`）と `--intent <name>`、`--space <name>` の組が続くもの。または、それだけで入力した確認の言葉 `guard policy relaxed|off`。未知のフラグや不正な値は、それを示して行全体を拒否します。大文字小文字と末尾の句点は問いません。スイッチに言及した質問や発言はスイッチではありません。`/aidlc why was config set guard.plan-approval off suggested?` は何も変えず、説明の後に置いたフラグも同様です。

チャットからの直接の `intent create --guard-policy relaxed|off` は、値が選択したスコープの既定値より低い場合に拒否されます（`off` のスコープでの `relaxed` は引き上げなので適用されます）。作業を作成し、低い値を頼んだときにエージェントが設定コマンドを実行します。作業が存在する前、または新しい作業と一緒に入力した値は、頼んだ作業について `set by you` として記録されます。直接の `scope change --guard-policy relaxed|off` は `config-change` と同じ弱化の規則に従います。より低いスコープ既定値は、その人がスコープ変更を頼んだときに適用されます。それ以外のスコープ変更は実行中のワークフローのより厳しい値を保ち、1 行でそう伝えます。`AIDLC_UNATTENDED=1` はプロンプト時の適用を止め、CLI の弱化を拒否します。memory の strict と無人実行の検査の後、CLI の設定コマンドがその人のプロンプトなしに弱化するのは、あなたが自分の端末で入力したとき（本人の操作）か、`fenceKeyBypassed` がフィクスチャやハーネス起動時の在席バイパスを認識したときだけで、インラインの環境変数の代入では弱化しません。session-start フックは、`AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1` を付けて起動された有人のハーネスについて、`presence-bypass-<session>` スタンプを Plan Approval のランタイムディレクトリに保持します。

モデルのツールはフックを起動できず、`aidlc/.aidlc-sessions/` やどの `.aidlc-plan-approval/`、`<record>/.aidlc-engine/gate-words/` ディレクトリにも書き込めません。これは [state-transition ガード](../reference/06-hooks-and-tools.md#pretooluse-aidlc-state-transition-guardts) が強制します。

memory ファイルが Guard Policy の strict を保持している場合、`/aidlc config set guard.<fence> off` はそのファイルを示す一文とともに拒否されます。リポジトリの全員について変えるには、その `Mode: strict` の行を編集してください。ガードを `on` にする操作は引き続き可能です。

memory が保持する strict は、以前に下げたガードにも優先します。保存された `Guards Off` エントリはインテントに残りますが、`/aidlc --status` はそのガードを `Checks off:` の行から外します。そのエントリは、memory の行が strict を保持しなくなった後でのみ再び効きます。マシン全体を無効化する環境変数は引き続き優先します。

1 つを off にすると、`aidlc-state.md` に `- **Guards Off**: review-freeze (set by you)` が書かれ、`GUARD_DISABLED` 監査行が 1 つ書かれます（この行のラベルは 1 つで、行上のすべての検査があなたのものである間は `set by you`、1 つでもそうでなくなると `set by a command` です）。on に戻すとその一覧から取り除かれ、`GUARD_RESTORED` が書かれます。`on` の設定は、ポリシーで下げられたガードも引き上げ、`- **Guards On**: review-freeze (set by you)` を記録して `GUARD_RESTORED` を書きます。これらの行が示すのは切り替え可能なガードだけです（plan approval が独立した設定になる前に書かれた `plan-approval` のエントリは引き続き読まれます）。保存された human-presence のエントリは無視されます。`/aidlc --status` は、誰かが off にした各検査（この作業についてのあなた、またはこのマシンの環境）とその出どころを示す `Checks off:` の行を表示します。plan approval のガードはそこで `plan re-approval`（承認後に編集された計画の検査）として表示されます。より低い Guard Policy が off にする検査はそこには載りません。それらは、ポリシーの出どころを示す `Guard Policy:` の行に含まれます。優先順位は、マシン全体の無効化、次に memory が strict を保持していなければ作業ごとの off、次に作業ごとの on、次に Guard Policy の語、最後に既定の on です。Guard Policy の語を自分で設定すると、その向きですべての検査に及びます（各変更は `GUARD_DISABLED` または `GUARD_RESTORED` として書かれます）。`off` はこの作業で on に保っていた検査を外すので on のものは残らず、`strict` は off にしていた検査を外すので off のものは残らず、`relaxed` はどちらも外さないので、検査を on に戻すことも off にすることもありません。memory が保持する strict は引き続き優先し、その後に切り替えた個別の検査は引き続き適用されます。

reviewer-scope の設定は、委譲レビュアーの読取り／検索の境界を扱います。1 つのチーム Unit を所有するとスタンプされたチェックアウトは、引き続き別の Unit の `construction/` サブツリーに書き込めません。この所有権の境界は、Guard Policy、作業ごとのガード設定、`AIDLC_DISABLE_REVIEWER_SCOPE_HOOK` のいずれでも切り替えられません。

自分の言葉で頼めばエージェントが実行します。入力によるスイッチも同じ設定コマンドで、エージェントが最初の `next` から実行します。切り替え可能なガードのメインセッションでの拒否は、そのスイッチを示します。ガードを off にする設定コマンドを、あなたが頼んだメッセージを示さずに実行すると、次のように表示されます。

> Turning the review-freeze check off is the person's call. Run it with --message <id>, the message they asked in, when they ask for it.

plan approval を off にする CLI の設定コマンドは、次のように表示します。

> Turning plan approval off lets code generation start without the person approving the plan, so it is their call. Run it with --message <id>, the message they asked in, when they ask for it.

ポリシーを `relaxed` に変える設定コマンドを、あなたが頼んだメッセージを示さずに実行すると、次のように表示されます。

> Setting Guard Policy relaxed lowers fences, which is the person's call. Run it with --message <id>, the message they asked in, when they ask for it.

スコープの既定値より低い明示的な `relaxed` フラグ付きの作成（`enterprise` で）を、そのチャットにあなたのメッセージが記録されていない状態で実行すると、同じように表示されます。

> Setting Guard Policy relaxed lowers fences, which is the person's call. Run it with --message <id>, the message they asked in, when they ask for it.

ほかのガード名や `off` では、対応する名前や値が使われます。無人実行ではドライバー向けの案内が追加されます。memory が保持する strict は、スイッチの適用やバイパスの確認の前に拒否し、代わりに編集すべき memory ファイルを示します。human-presence の拒否はスイッチを示しません。その人の返答が記録されていないことと、すでに送った返答がどうなったか（ハーネスのフックの手順、または `/aidlc --doctor`）を伝え、もう一度返答するよう求めることはありません。

human presence は 5 つの中で最も厳しいガードです。あなたの承認をあなたのものにするのがこのガードなので、Guard Policy も作業ごとの設定もこれを下げません。下げるのは、マシン全体に設定するか `aidlc config flags --bypass` で記録した `AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1` だけで、off の間は AI-DLC がそう伝えます。`AIDLC_UNATTENDED=1` は別途、人間のターンの発行を止めるもので、このガードを下げるものではありません。

### 誰が求めたのか: 権限の連鎖

ガードが見るすべての操作は、何かが決まる前に分類されます。記録された人間のターンでカバーされるのか、ワークフロー自身の指示でカバーされるのか、どちらでもないのか。この分類は誰が作業していたかを記録するもので、その人の入力したスイッチのためにエージェントが実行する設定コマンドとは別です。

- **あなたの許可。** ワークフローが最後にエージェントへ指示を出した後にあなたが送ったメッセージ。ワークフローが次の指示を出すまで、そのターンでディスパッチされたコンダクターとエージェントを分類します。ガードやポリシーの変更を認可するものではありません。
- **ワークフローの指示。** エンジンが現在有効にしているステージ。誰が行うかにかかわらず、その指示が求める作業をカバーし、その中でまだ保留中の承認も含みます。ループが自身のステップの 1 つを飛ばすことはカバーしません。それこそガードが気付くことです。
- **どちらでもない。** 指示の外にあり、その後あなたから何もない操作。最も狭いカバー範囲で、判読できない信号はここにフォールバックします。

問題は誰が入力しているかではありません。developer エージェントはコンダクターの言葉に基づいて動き、コンダクターはあなたの言葉に基づいて動くので、権限は連鎖を下って流れます。コンダクターがエージェントをディスパッチすると、その時点で有効な権限がディスパッチにスタンプされ、エージェントはそれを継承します。エージェントが自分のために許可を作ることはできず、判読できない信号はカバー範囲を広げるのではなく狭めます。信号はフレームワークがすでに保持しているものです。ワークフローの最後の進行コマンドに対するあなたの最後のプロンプトを記録する `.aidlc-engine/` 配下のターンマーカー、アクティブディレクティブのマーカーのカウンター、実行中のエージェント台帳上のディスパッチスタンプです。

この分類がガードを下げたり、その人が入力するスイッチの代わりになったりすることはありません。その役割は証拠の記録です。下げたガードが何かを通すたびに、監査行は有効だった権限を示すので、読む人はそれが起きたときに誰が作業していたかが分かります。`strict` のもとで変わった入力は、この分類にかかわらず、対象の境界で尋ねられます。

<a id="what-you-see-when-a-guard-decides"></a>

### ガードの判断の見え方

- **道を譲る。** ガードを下げたものを示す 1 行が表示され、作業は続きます。`Continuing past the plan re-approval check because it is off for this piece of work (guard policy relaxed (set by you)). Recorded in the audit trail: dispatch of aidlc-developer-agent` `GUARD_STOOD_ASIDE` 行が 1 つ、ガード、有効だった権限、許可がどう証明されたか、操作者がメインセッションか委譲エージェントかを記録します。「本当によいですか」と聞かれることはありません。ガードはすでに off です。

  Claude Code ではフックが JSON の `systemMessage` を 1 つ出し、Claude Code はそれをフックメッセージとしてあなたに表示します。モデルはそれを見ず、`GUARD_STOOD_ASIDE` 行が記録になります。Codex、opencode、Kiro CLI では素のフック行が表示されます。Kiro IDE では表示されません。IDE がフックの出力をエージェントに渡すのはセッション開始時とプロンプト送信時だけなので、そこでの道を譲る動作は無言で、監査行が唯一の記録です。拒否は別です。フックがツール呼び出しをブロックしたときは、エージェントがその理由を見ます。行が書かれるのはインテントにすでに監査証跡がある場合だけなので、まだ台帳のない新規プロジェクトに対する Kiro IDE では、道を譲っても行も監査行も残りません。下げたガードが何を通したかを知りたい場合は、行を見たことに頼らず、インテントの `audit/` シャードの `GUARD_STOOD_ASIDE` 行を読んでください。
- **守る。** memory が Guard Policy の strict を保持していない場合、切り替え可能なガードのメインセッションでの拒否は、何が足りないかを伝え、通り抜ける方法を提示するようエージェントに指示する一文を加えます。いまこれを行うつもりなら、この作業について review-freeze の検査を off にするかを尋ね、あなたがそう言えば off にして 1 行で伝えます。memory が strict を保持している場合、拒否はスイッチを提示する代わりに memory ファイルを示します。human presence は代わりに、その人の返答が記録されていないと伝え、繰り返すよう求めることはなく、スイッチを示すこともありません。
  plan approval はスイッチを示しません。off にするのは、常にあなたの発案だけです。まだ承認していない計画や、`strict` のもとで承認後に編集された計画は、`next` を実行して尋ねます。
  委譲エージェントがスイッチの一文を見ることはありません。その拒否はメインセッションへ戻るよう案内します。
- **尋ねる。** `strict` のもとでは、何かを承認した後に変わった入力について、何が変わったかを示して 1 回尋ねます。

---

## ステージのカスタマイズ

各ステージは `.claude/aidlc-common/stages/[phase]/` の独立した `.md` です。ステージファイルが書くのは次です。

- **Metadata** — ステージ番号、フェーズ、実行モード、リード / サポートエージェント
- **Inputs** — 読む先行成果物
- **Steps** — 番号付きの実行手順
- **Outputs** — 出す成果物
- **Completion** — 承認ゲートの形

振る舞いを変えたいときはステージファイルを直接編集します。承認ゲート、質問の形、状態追跡など共通の型は、全ステージがステージプロトコルを参照します。

### 深度

各スコープに既定の深度があり、成果物の詳しさを決めます。

| 深度 | 内容 |
|-------|-------------|
| **Minimal** | 短い成果物。狙いを絞った分析。任意の内容は書かない |
| **Standard** | バランス。主と副の関心を覆う |
| **Comprehensive** | 全部。厚い分析。任意の内容も含める |

どの承認ゲートでも、別のレベルを求めて上書きできます。

---

<a id="status-line-claude-code-and-codex"></a>

## ステータスライン（Claude Code と Codex）

**Claude Code** と **Codex CLI** では、AI-DLC はターミナル下部のステータスラインに作業の現在地を表示できます。これは自分で設定したステータスラインの代わりに表示されるため、使うかどうかはあなたが選びます。初回セットアップで 1 回尋ね、いつでも切り替えられます。ほかのハーネスにステータスラインはありません。ワークフローの位置は `/aidlc --status` と、各ゲートの進捗行で示します。

Claude Code では、`mvp` プランでの実行から取ると次のように表示されます（罫線文字はプレーンテキストで示しています。右側にモデル、コンテキスト、コストが続きます）。

```text
[AIDLC] inventory-api - IDEATION [##--------] 1/4 > Feasibility -- Architect Agent
```

順に、作業、現在のフェーズ、フェーズ内進捗（バーと比率。どちらも今のフェーズ範囲）、ステージの表示名、リードエージェントです。Reverse Engineering が 10 以上のリポジトリを解析している間は、ステージ名の後に、そのうちいくつが終わったかが `> Reverse Engineering 37/190` のように続きます。作業が選ばれる前は `[AIDLC] ready` と表示されます。右側には Claude Code のモデル、続いてコンテキストウィンドウの使用量を示す `ctx:N%` が出ます。Claude の usage ledger にデータがあれば、続けて入出力のトークン数と `$<usd>` が出ます。対象はアクティブなワークフローと今のトランスクリプト / セッションだけで、以前のワークフローやセッションは入りません。`AIDLC_DISABLE_USAGE_TRACKING=1` を設定すると使用量追跡が完全に止まり、この区間も消えます。各区間の説明は [最初のワークフロー](02-your-first-workflow.md) にあります。

`$<usd>` の値は **公開の定価** から計算したローカルの見積もりで、請求額ではありません。記録されたプロバイダーが Amazon Bedrock（`CLAUDE_CODE_USE_BEDROCK=1`）の場合、Bedrock が実際に請求する額は、推論プロファイル、リージョン、サービス階層、交渉済みやサブスクリプションの価格によって変わるため、この数字は請求書と一致しないことがあります。長いワークフローのトークン量の大半はキャッシュ読込みで（割引されたキャッシュ読込み料金で課金されます）、件数と見積もりは着実に増えていきます。これは実際の使用量で、水増しではありません。新しい使用量を自分の料金で計算するには、`AIDLC_MODEL_RATES` に料金ファイルを指定します（[Rate table and overrides](../reference/06-hooks-and-tools.md#レート表と上書き) を参照）。すでに記録された合計は、計算時の料金のままです。発表中、画面共有中、録画中などで見積もりを表示したくない場合は、`AIDLC_DISABLE_USAGE_TRACKING=1` を設定してください（[トラブルシュート](15-troubleshooting.md#statusline-shows-a-cost-segment-you-dont-want-or-usage-tracking-concerns) を参照）。

### オン・オフの切り替え

- 初回セットアップ（AI-DLC がまだないプロジェクトでの `aidlc config`）で、AI-DLC は「Show AI-DLC's progress in your status line? It takes the place of your own while you work in this project.」と尋ねます。自分のステータスラインがすでにある場合の推奨回答は「No, keep mine」、ない場合は「Yes」です。
- その後いつでも: チャットで `/aidlc --statusline on` または `/aidlc --statusline off`（Codex では `$aidlc --statusline on|off`）、ターミナルで `aidlc config --statusline on|off`。何も尋ねずに、何が変わったかと元に戻す方法を 1 行で表示します。例:

  ```text
  $ aidlc config --statusline on
  AI-DLC's status line shows in this project; /aidlc --statusline off turns it off.
  ```
- 何も尋ねないセットアップ（`--yes`、CI、スクリプト、コピー経路、初めてチャットするチームメイトのクローン）は、ステータスラインを追加しません。
- このリリースより前から AI-DLC のステータスラインを表示していたプロジェクトは、尋ねられることなくそれを保ちます。それが自分のステータスラインを覆っている場合は、次の更新（またはチームメイトのクローンでの最初のチャット）で 1 回だけそう伝えます: 「AI-DLC's status line replaces yours here; /aidlc --statusline off gives yours back.」

**Claude Code: あなた自身の設定。** 選択は git が無視するあなた自身の `.claude/settings.local.json` に置かれるため、チームメイトはそれぞれ自分で選び、共有の `.claude/settings.json` は何も変わりません。回答は `aidlc.settings.local.json`（これも無視対象）に保存されるので、セットアップが再び尋ねることはありません。AI-DLC があなた自身の `~/.claude/settings.json`（または `$CLAUDE_CONFIG_DIR/settings.json`）を読むのは回答を推奨するためだけで、書き込むことはありません。チームが共有の `.claude/settings.json` に設定したステータスラインはそのまま残ります。組織の管理された Claude Code 設定がステータスラインを選んでいる場合は、何を選んでも組織のものが表示されます。

AI-DLC の値は次のとおりです。

```json
"statusLine": {
  "type": "command",
  "command": "bun \"$CLAUDE_PROJECT_DIR/.claude/tools/aidlc.ts\" engine statusline"
}
```

（ネイティブインストールでは `aidlc engine statusline`）。これは `.claude/tools/data/harness.json` で出荷され、オンにしたときだけ `.claude/settings.local.json` に入ります。

**Codex CLI: プロジェクトの設定。** Codex にはプロジェクト内の個人用設定ファイルがないため、Codex では選択はプロジェクトのものです。`on` は AI-DLC の `status_line` の行を共有の `.codex/config.toml` の `[tui]` テーブルに書き、プロジェクトで作業する全員に適用します。`off` はその 1 行を取り除きます。ファイルのほかの部分は変わらず、あなた自身の `~/.codex/config.toml` は回答を推奨するために読むだけで、書き込みません。代わりに各人が、Codex の `/statusline` で自分の Codex ステータスラインにタスク進捗を追加することもできます（AI-DLC が最新に保つのは `task-progress` の項目です）。AI-DLC が書く行は次のとおりです。

```toml
[tui]
status_line = ["model-with-reasoning", "git-branch", "task-progress", "context-used"]
```

### 表示のカスタマイズ

`.claude/hooks/aidlc-statusline.ts` を直接編集します。ステータスラインはネイティブインストールでもプロジェクトのコピーを実行します。出力形式はファイル末尾近くの `main()` です。フックは `aidlc-state.md` からフェーズ、ステージ、エージェントを読み、ステージスラッグを表示名にマップし、同じフェーズ内チェックボックス解析から unicode の進捗バーと `n/m` 比率の両方を作ります。

このファイルは AI-DLC のものなので、プロジェクトでの次の `aidlc config` は、それを置き換えずにあなたの編集で止まります。

```text
$ aidlc config --harness claude --yes
error: 1 config conflict(s): .claude/hooks/aidlc-statusline.ts (locally modified or unowned)
fix: to keep your version, move .claude/hooks/aidlc-statusline.ts somewhere else and run the same command again; to take the shipped version over it, run it again with --force.
```

`--force` で同梱版を取る前に、自分の版のコピーを残しておいてください。

---

## ツール権限

`.claude/settings.json` の `permissions.allow` は、Claude Code のツールを事前承認するので、呼び出しごとの許可プロンプトなしでワークフローが実行されます。ネイティブインストールでセットアップしたプロジェクトでは、次のように始まります（全部で 45 エントリ）。

```json
"permissions": {
  "allow": [
    "Edit(/**)",
    "Task",
    "WebSearch",
    "Bash(aidlc engine *)",
    "Bash(aidlc doctor)",
    "Bash(aidlc doctor --verbose)",
    "Bash(aidlc version)",
    "Bash(aidlc --doctor)",
    "..."
  ]
}
```

Claude Code 2.1.296 は、フォルダを信頼するかを最初に尋ねるときにこれらを挙げます（省略あり。罫線文字はプレーンテキストで示しています）。

```text
 Accessing workspace:
 /home/you/inventory-api
 ...
 ! This folder pre-approves 45 tool permissions in .claude/settings.json:
   WebSearch, Edit(/**), Bash(aidlc engine *), Bash(aidlc doctor), Bash(aidlc doctor --verbose),
 Bash(aidlc version), Bash(aidlc --doctor), Bash(aidlc --doctor --verbose), and 37 more
 These will apply without asking. Only proceed if you trust this configuration.
 Security guide
 > No, exit
   Yes, I trust this folder
```

`Edit(/**)` はプロジェクト内のどこでもファイルの作成と変更をカバーします。プロジェクト設定では、Claude Code は先頭の `/` をプロジェクトルートに固定します。プロジェクト外への書込みは、Claude Code の既定どおり確認を求めます。プロジェクト内の読取りと検索にはエントリは不要です。コピー経路が事前承認するのは AI-DLC 自身のワークフローコマンドだけで、それぞれ AI-DLC が実行するとおりの形で列挙されます。エンジンコマンド、`doctor`、`version`、`--doctor`、`status`、読み取り専用の `config <section> --show --json` と `--help` の形、そして `aidlc-*.ts` ツールです。ネイティブリリースではこれらを `Bash(aidlc engine *)` に書き換えます。`config` の変更、マシンの AI-DLC インストールを変えるコマンド（`use`、`update`、`rollback`、`uninstall`、`system`）、それらの背後のツールスクリプトはどのエントリにも一致しないため、Claude Code 自身のプロンプトで承認します。裸の `Bash` はありません。Claude Code は複合コマンドの各サブコマンドを個別に照合し、既知の安全な固定の環境変数だけを取り除くため、エンジンコマンドが事前承認のままでいられるのは、それ単体で実行したときだけです。`cd ... &&` の前置き、絶対パスの `$CLAUDE_PROJECT_DIR`、`VAR=1` の前置き、`jq` へのパイプ、`$(...)` による取り込みはすべて確認を求めます。プロジェクト固有のビルドやテストのコマンドはリストの外にあり、一度だけ確認を求めます。「Yes, and don't ask again」と答えると、そのルールが `.claude/settings.local.json` に保存されます。

### 権限の動き

- **上限ではなく事前承認**: `settings.json` の許可リストが決めるのは、確認なしで実行するものです。リストにないツールやコマンドも、Claude Code のプロンプトで承認すれば実行される
- **Claude Code のエージェントは既定でセッションのツール一式を継ぐ**。このハーネスでは `disallowedTools: Task` が入れ子のサブエージェント起動を止める
- **任意のエージェント単位の絞り込み**: frontmatter に `tools:` 許可リストを足すと狭まる。省略すれば全部を継ぐ。`tools:` を書くと継承していた MCP ツールは落ちる。残すなら完全修飾の `mcp__<server>__<tool>` も列挙する

### 権限を広げる

許可リストにツールを足すのは、追加能力が要るカスタムステージを書いたときだけにしてください。

### 権限を狭める

許可リストから外すと、使うたびに人手の承認が要ります。`Task` を外すと、委譲する 4 ステージ（2.1 Reverse Engineering パイプライン、2.2 Practices Discovery サブエージェント、2.4 User Stories モブ、3.5 Code Generation サブエージェント）が、委譲のたびに許可を聞きます。ワークスペース検出（0.2）は `aidlc-utility intent-create` の中で決定論的に実行されるので、`Task` は使いません。

---

## AI-DLC を広げる

ここまでの設定・スコープ・深度・ステージ編集は、回しているワークフローの日常チューニングです。フレームワークそのものをチーム向けに作り変えたい（ステージやエージェントを足す、スコープを定義する、常設ルールを教える、決定論的検査を配線する、ドメインナレッジを足す）のは別の仕事で、案内も別です。**[Harness Engineer Guide](../harness-engineering/00-overview.md)**。

境目はデータかコードかです。あのガイドにあるのは YAML frontmatter 付き Markdown か、フレームワークが読む JSON 設定だけで、TypeScript は触りません。拡張ごとの入り口:

| やりたいこと | 最初に見る場所 |
|--------------|----------|
| ステージの中身を変える、またはステージを足す | [Anatomy of a Stage](../harness-engineering/01-anatomy-of-a-stage.md)、[Adding a Stage](../harness-engineering/02-adding-a-stage.md) |
| エージェントを足す、または直す | [Adding an Agent](../harness-engineering/03-adding-an-agent.md) |
| スコープを定義する、または調整する | [Scopes](../harness-engineering/04-scopes.md) |
| 常設ルールを教える、またはラーニングループを回す | [Rules and the Learning Loop](../harness-engineering/05-rules-and-the-loop.md) |
| 決定論的検査（センサー）をステージに配線する | [Sensors](../harness-engineering/06-sensors.md) |
| チームのドメインナレッジを足す | [Team Knowledge](../harness-engineering/07-team-knowledge.md) |

フレームワークの *コード*（オーケストレータ、フック、CLI ツール、コンパイルパイプライン）を触るなら [Developer Reference](../reference/00-overview.md) です。

---

## ナレッジとルール

二層のナレッジと、ルール / ラーニングループの詳細は次です。

- [ナレッジ](08-knowledge.md) — チームナレッジディレクトリと方法論の参照ファイル
- [ルールとラーニングループ](09-rules-and-the-learning-loop.md) — 振る舞いルールと自己学習の流れ

---

## 次の章

- [スコープ・深度・テスト戦略](05-scopes-and-depth.md) — スコープからステージへの対応
- [エージェント](06-agents.md) — エージェントの権限と能力
- [トラブルシュート](15-troubleshooting.md) — ステータスライン、フック設定
- [用語集](glossary.md) — スコープ、深度、ガードレール、ナレッジ
