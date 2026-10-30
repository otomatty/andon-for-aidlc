# プラグインの仕組み

> 読者: Tier 2/3（チームで入れる人、フレームワークの貢献者）。

> **パスの慣例。** 以下の `<harness-dir>/` = ハーネスの実行時ディレクトリ（`.claude` / `.codex` / `.kiro` / `.aidlc` / `.cursor`）。`plugins/<name>/` = 作成したプラグインソース。`dist/plugins/<name>/<harness>/` = `bun scripts/package.ts` が出す、gitignore した局所のホストプラグイン投影。

この章は **AIDLC プラグイン** 系の正本です。任意で、所有があり、バージョン別の寄与の集合 — 新しいステージ、エージェント、スコープ、センサー、doctor 検査、*既存コアステージへの加算変更* — をハーネス非依存の木として一度書き、各ハーネス向けに **本物のホストプラグインとして出す**。プラグインは `core/` を決して直しません。無効にしたプラグインのファイルはインストールされたまま残りますが、そのステージとスコープはグラフからフィルタされ、マージした寄与はコアステージから剥がされるので、ワークフローはコアだけの構成として走ります。系は、証明済みの編集無し継ぎ目一つ（加算で合成するフェーズルール）をどの面へも一般化し、専用インストーラではなく各ホスト自身のプラグイン機構で届けます。相互リンクは [Stage Definition](15-stage-definition.md)（プラグインが書くステージ frontmatter。`plugin` / `number` / `when` を含む）、[Engine and Skill System](17-skill-system.md)（コンポーザーが送りオーケストレータがルーティングするグラフ）、[Artifact Vocabulary](16-artifact-vocabulary.md)（名前空間規則）、執筆の通し [Authoring a Plugin](../harness-engineering/10-authoring-a-plugin.md)。

---

## 1. プラグインとは何か

プラグインは、宣言マニフェストとコア形のサブツリーを持つディレクトリ（かつ git リポジトリ）です。できることは:

- 新しいステージ（最初のコンパイルでエンジンが番号を付ける — プラグインは表示番号範囲を主張しない）、エージェント、スコープ、センサーを **足す**（スペースメモリの種への方法 / ルールは先送り。バリデータは `memory` 寄与を拒否する）。
- 寄与の継ぎ目（§6）経由で、既存コアステージを **加算で変える** — ステージが出す・消費する・検査する・指示することを豊かにし、ステージ自身は直さない。

ファーストパーティプラグイン（AIDLC チームが提供）とサードパーティプラグイン（ほかの誰でも）は **機械的に同一** です。同じ構造、同じ継ぎ目、同じ composer。違うのは出自（プラグインが住むのは誰のリポジトリか、誰がレビューしたか）と、ホストでの並び方です。AI-DLC 自身のものは共有の `aidlc-plugins` カタログ 1 つの中に `aidlc-<name>` として表示され、ほかの誰かのものはその作者の名前で、作者自身のカタログに表示されます（セクション 9）。`plugins/test-pro/` が参照フィクスチャです。

仕組みが守る **設計原則**:

- **厳格加算、上書きは決してしない。** 寄与は *足す* だけです。構造面の集合和は可換なので、独立した著者が安全です。本当の衝突は、黙った last-writer-wins ではなく、プラグイン帰属付きの compose エラーです。
- **コアは不変。** どのプラグインも `core/` ファイルを直しません。プラグインが提供するものはすべて、プラグイン自身の木にあります。
- **可逆で、無効化すると不活性。** プラグインを無効にすると、それが無いインストールへ正確に再合成します。
- **slug が識別情報。** ステージは、大事なところ（辺、ジャンプ、解決）ではどこでも slug で識別します。`number` は表示 / 順序専用なので、挿入したプラグインステージがコアを再番号付けしたり不安定にしたりしません。

## 2. なぜ導入時か、ホストプラグインとして届けるか

繰り返し出る設計の問いは、プラグインが *ビルド時* 成果物（中央で事前合成してコピー）か、*導入時* 成果物（消費者が選んだ集合の上で自分の機械で合成）かでした。仕組みは **導入時** です。広い生態系（npm、Cargo、Helm、VS Code、Nix）がすでに収束した構造上の理由が二つあります。

- **組み合わせ爆発。** N プラグインは有効部分集合を最大 2ⁿ 出します。中央ビルドはどの組み合わせも事前合成できません。事前に作る価値がある成果物は **コアだけの構成**（空集合）だけで、誰にとっても同一です。
- **遅い解決。** 正しいプラグイン集合 — と、同じステージへの 2 プラグインの寄与がどうマージするか — は、それらを選んだインストールの上でしか分かりません。

届け方は専用 AIDLC インストーラではなく、**ホスト自身のプラグイン系** です。フレームワークが対象にするどのハーネスも、すでにマニフェスト先行、git 配布のプラグインモデルを提供しています（Claude Code の `.claude-plugin/`、Codex の `.codex-plugin/`）。AIDLC プラグインは *それらの一つ* です。これが **ハイブリッド** です。ストアがあるところ（Claude、Codex、opencode、Copilot は「ストア」配置として投影）では本物のホストプラグイン、無い一つ（Kiro）ではフォルダドロップ。帰結:

- **配布インフラは走らせない。** 顧客が自分のプラグインリポジトリをホストします（git + semver タグ + `marketplace.json`）。マーケットプレイス項目 1 つが、混成フリート向けにプラグインを列挙します。
- **信頼はホストネイティブ。** 組織制限はホストの管理許可リストを使います（Claude の `strictKnownMarketplaces`、利用者が上書き不可。Codex のハッシュピン信頼）。AIDLC は信頼層を作りません。
- **composer は導入時に走り、ホストフックが引き金。** 組み合わせごとの事前構築木はありません。SessionStart フックが選んだ集合を局所で合成します。

> **セキュリティ注記 — Kiro のフォルダドロップに導入時の信頼ゲートは無い。** Claude と Codex は、フックが走る*前に*自分の信頼プロンプト（管理マーケットプレイス / ハッシュピン承認）でプラグインを仲介します。Kiro にプラグインストアは無いので、フォルダドロップ経路は実行可能なプラグインファイルを **同等のゲート無し** でコピーします。木をドロップすることが信頼の判断です。Kiro IDE 投影は、`aidlc engine plugin sync` を、または `aidlc` がインストールされていない場合は `hooks/aidlc-plugin-compose.ts` の Bun ランチャを走らせる `v1` SessionStart 登録を含みます。Kiro CLI 投影は、明示して走らせるコマンドへ合成を残します。どちらの Kiro プラグインドロップも `git clone && run` のように扱ってください。コードを走らせてよいソースからのみ入れ、ドロップが入れる差分をレビューし、動くブランチを追わずレビュー済みタグへプラグインリポジトリをピンしてください。composer 自身は加算で、`core/` を決して直しませんが、利用者のプロセス権限で実行します。

寄与の継ぎ目（§6）がこれが大事な理由です。構造的に VS Code の `contributes` + Cargo の加算 feature-union — 現場でいちばんよく合成するモデル — であり、ゲートキーピング無しで *どの* プラグインにも、ファーストパーティもサードパーティも、使えます。

## 3. プラグインの構造とマニフェスト

プラグインの木は `core/` の形を映すので、パッケージャがどのハーネスへも投影できます。一度書いてハーネス非依存です。

木は *設計した* 面として `core/` の全形を映します。✅ は現在パッケージャが投影するサブツリー、⏳ は設計済みだがまだ投影していないもの（§7）です。

```text
plugins/<name>/
  .aidlc-plugin/plugin.json              # the manifest
  stages/<phase>/<slug>.md               # ✅ NEW stages (slug identity; number is display-only)
  sensors/aidlc-<id>.md                  # ✅ NEW sensor manifests
  tools/<id>.ts                          # ✅ sensor scripts (so a sensor can run)
  tools/<plugin>-doctor.ts               # ✅ optional /aidlc --doctor checks
  contributions/<phase>/<slug>.md        # ✅ ADDITIVE modifications to core stages (§6)
  contributions/agents/<agent>.md        # ✅ PROSE fragments into core personas (§6)
  agents/<plugin>-<role>-agent.md        # ✅ NEW agents (stem == frontmatter name)
  scopes/<plugin>-<name>.md              # ✅ NEW scopes (stem == frontmatter name)
  knowledge/<agent-slug>/…               # ✅ per-agent METHODOLOGY knowledge
  tests/                                 # the plugin's own content validation (integration tier)
  memory/{org,team,project}.md           # ⏳ method/rule additions → default-space seed (§7)
  memory/phases/<phase>.md               # ⏳
```

コアのスコープファイルは `aidlc-` ファイル名接頭辞を使います。プラグインのスコープファイルはそれをプラグイン接頭辞（`<plugin>-<name>.md`）に置き換え、ファイル名ステムは frontmatter の `name` と等しいです。プラグインのエージェントファイルも同じ規則です。`<plugin>-<role>-agent.md`、frontmatter の `name` はステムと等しい。

`.aidlc-plugin/plugin.json` は **宣言** マニフェストです。トップレベルはよくあるホストプラグインマニフェストの形を映します（マーケットプレイスやホスト道具が一覧 / 版付け / 信頼できるように）。AIDLC 固有の設定は入れ子の `aidlc` ブロックに隔離します。

```jsonc
{
  "name": "test-pro",                 // == dir name; "core", "aidlc", and "aidlc-*" are reserved; kebab-case
  "version": "0.1.0",                 // semver
  "description": "…",
  "author": { "name": "AWS AIDLC" },
  "dependencies": ["core", "compliance@^1.2.0"],  // core plus at most one base plugin (§8)
  "aidlc": {
    // "marketplace": "acme-aidlc-plugins",  // a plugin someone else builds: its catalogue (section 9)
    "contributes": {                  // which subtrees this plugin ships
      "stages": "stages/", "agents": "agents/", "scopes": "scopes/",
      "sensors": "sensors/", "knowledge": "knowledge/",
      "tools": "tools/", "overlays": "contributions/"
    }
  }
}
```

決定論的な最小の作成したプラグインリポジトリを作ります。

```bash
bun <tools-dir>/aidlc-plugin-create.ts <name> [targetDir]
```

CREATE は空でない対象を拒否し、マニフェストと、名前空間付きの例ステージ、スコープ、エージェント、tests README を 1 つずつ出します。結果は直ちに妥当です。`hooks/compose.ts` は設計どおりありません。BUILD が同梱フックを注入するからです。

ビルド前に、作成したプラグインリポジトリを検証します。

```bash
bun <tools-dir>/aidlc-plugin-validate.ts <plugin-root> [--with <base-root>]
```

提供バリデータは、AIDLC プロジェクトもフレームワークチェックアウトも無しでオフラインに走ります。マニフェスト、ステージスキーマ、スコープとエージェントの識別情報、プラグイン局所の成果物衝突、`tools/` 下の事故のテスト / フィクスチャペイロード、ツールに同梱したテンプレートに対する vendored `hooks/compose.ts` を検査します。プラグインのベースだけが供給できるステージエージェントは、`--with` が作者のそのベースのチェックアウトを指名しない限り警告です。ベースを宣言しないプラグインでは、コアのものでもプラグイン自身のものでもないステージやエージェントは、`dependencies` を指名するエラーです。トップレベルの `aidlc plugin validate|build` 経路は同じ実装へ委ねます。`create|test` 経路は [RFC #723 §2e](https://github.com/awslabs/aidlc-workflows/issues/723) へ先送りのままです。

同じ外部リポジトリからホスト投影を 1 つビルドします。

```bash
bun <tools-dir>/aidlc-plugin-build.ts <plugin-root> <harness> [outDir]
```

ビルダは書く前に検証し、既定は `<plugin-root>/dist/<harness>/` です。チェックアウトパッケージャと提供ビルダは同じ emitter を呼びます。ハーネスマニフェストが正本のままです。パッケージングは投影記録を `tools/data/plugin-targets.json` へ出し、スタンドアロンビルダがオフラインで消費します。

選んだインストールを変えずに合成をテストします。

```bash
bun <tools-dir>/aidlc-plugin-test.ts <plugin-root> \
  --install <project-root> [--harness <name>] [--with <base-root>]
```

ツールは投影をビルドし、マニフェスト導出の導入ルートだけを使い捨て候補へコピーし、本物の compose フックを二度走らせ、drop 無しの最初の通過、プラグインステージとスコープを含むきれいな compose 後グラフ、バイト安定な二度目の通過を要求します。共有ハーネス葉は `--harness` が要ります。`--with` は、先にベースのチェックアウトを候補へ合成します。`--dist` はサポートされず、ツールはそれを拒否します。

寄与パスはプラグイン相対で、プラグインルートから出ていけません。トップレベルは **寛容**（未知キーを保つ。前方互換と横断ツール耐性のため）。`aidlc` ブロックは **厳格**（未知キーを拒否。執筆のタイプミスを捕える）。投影はまだディレクトリ慣例（`stages/`、`sensors/`、`tools/`、`contributions/`、`scopes/`、`agents/`、`knowledge/`）で中身を発見するので、宣言した各値は正規ディレクトリと等しくなければなりません。設定可能なルーティングは先送りです。そのサブツリーを投影できるまで、`memory` 宣言は拒否します。ステージ番号は表示専用なので、プラグインはマニフェストで番号範囲を主張しません。`overlays` は正規 `contributions/` のマニフェスト名で、コピーではなくマージが消費します。

## 4. 合成モデル

composer は `bare core + {chosen plugins}` の上を一度走り、実効インストールを書きます。引き金の仕方に関係なく **同じ composer** が走ります。

| Host | Trigger | Trust |
|------|---------|-------|
| **Claude** | SessionStart hook (fires eagerly on session spawn) | managed allowlist (`strictKnownMarketplaces`) |
| **Codex** | SessionStart hook (fires lazily on first interaction) | one-time trust prompt, content-hash-pinned |
| **Kiro CLI** | `aidlc engine plugin sync` when the binary is on PATH, or manual `bun <plugin>/hooks/compose.ts` after the folder-drop | n/a - folder-drop distribution |
| **Kiro IDE** | SessionStart hook registered by the folder-dropped projection (`.kiro/hooks/aidlc-<plugin>-compose.json`, running the launcher in the plugin's folder `.kiro/aidlc-plugins/<name>/`) | n/a - folder-drop distribution |

手順（引き金に関係なく同一）:

1. **発見と検証** — ホストが提供したインストール済みルート、マニフェスト識別情報 / 版、プロジェクト選択。そしてベースを先にする。プラグインは、それが土台とする 1 つのベースプラグインの後に合成される（§8）。
2. **新しいプリミティブをコピー** — 各プラグインの `stages` / `agents` / `scopes` / `knowledge` / `sensors` / `tools` サブツリーを対応するハーネスルートへ。`{{HARNESS_DIR}}` トークンをハーネスの実際のディレクトリへ置換。`memory` は先送りのまま（§7）。
3. **寄与をマージ** — ステージへのアクティブな寄与はすべて対象ステージのソースへ折り込む（§6）。構造面は集合和、散文フラグメントはアンカーで継ぎ込む。
4. **コンパイル** — `aidlc-graph compile` が `stage-graph.json` + `scope-grid.json` を再生成。オーケストレータは完全にそれらからルーティングするので、プラグインステージは合成された瞬間に走る。直す散文もスキルも要らない。

合成は独立オーバーレイの列ではなく N 方向マージ 1 回なので、**同じステージへ両方寄与する 2 プラグインは本当にマージされます** — 構造の追加は集合和、散文フラグメントは決定論的に並ぶ — 片方が黙ってもう片方を上書きするのではありません。実行時は合成に対して **読み取り専用** のままです。マージはすべて compose 時であり、セッションごとではありません。マージが直すのは **ステージソース**（コンパイル済み JSON ではない）なので、あとのどの `aidlc-graph compile`（例: rebuild-stage-graph フック）も **耐久** で、**冪等** です。どの SessionStart でも再実行しても新しいものは合成しません。

同じプラグインの新しい版を再合成すると、そのプラグインがインストールしたファイルのうち、インストール以降に変わっていないものが置き換わります。その証明は、`aidlc engine plugin sync` と compose フックの両方が書く、ハッシュ証明の記録 `tools/data/plugin-owned-<key>.json` です。人が変更したファイルは決して上書きしません。compose drops ログがそのファイルと手順（変更を別の場所へ移す、ファイルを外す、compose を再実行する）を示します。記録が覆わないファイル（コア、別のプラグイン、記録ができる前に合成されたコピー、局所の編集）も残し、同じように報告します。ただし、プラグインのコピーとの違いが、プラグインビルダが書くナレッジプリフライトの段落だけである場合（2.11.0 がインストール時に形を変え、記録しなかったエージェント）は例外です。それはプラグイン自身の古いコピーなので、compose が置き換えて記録します。新しい版がもう古いアンカーと order で提供しない散文フラグメントは、ステージと寄与サイドカーから外されるので、移動したフラグメントは一度だけ現れます。

エンジン再インストールはグラフコンパイルとは違います。新しい `dist/<harness>/` をコピーするとコンパイル済みグラフとコアステージソースが上書きされるので、プラグイン所有ファイルとサイドカーは残っても、グラフ項目と寄与マージは消えることがあります。エンジンアップグレードのたびに `/aidlc plugin sync` を再実行してください。compose フック付きホストは、次のセッション開始でも面を直します。doctor の **Composed plugin surface** 検査は、欠けたプラグイングラフ項目と、古い構造または散文寄与の両方を検出し、sync も同じ検査を読みます。記録された追加（構造値、フラグメントのマーカー、または同じプラグインの別のフラグメントの中に入れ子になったフラグメント）が消えたプラグインは、もう一度合成されます。マーカーはそのままで本文が変わったフラグメントは、人の編集です。それがそのプラグインの唯一の欠けであれば、sync はそれを残し、doctor はそれを指名し続けます。プラグインの別の追加が消えている場合、sync はプラグイン全体をもう一度合成し、プラグインの更新と同じく、そのフラグメントをプラグインの本文で書き直します。読めない・壊れた有効プラグインサイドカーと、欠けたステージを対象にする記録も、飛ばさずに検査を落とします。すでに合成した構造値は、出自が壊れたあと安全に帰属できないので、無効なサイドカーは在庫エンジンを刷新し、そのサイドカーを外し、それから `plugin sync` を走らせて復旧します。

## 5. 選択

プラグインは足します。インストールが選びます。プラグインを合成するとファイルがインストールへコピーされ、加算寄与がマージされますが、そのインストールの利用者に見えるのは `<harness-dir>/tools/data/harness.json` が指名したプラグインだけです。

```json
{
  "harnessDir": ".claude",
  "rulesSubdir": "rules",
  "plugins": ["aidlc", "test-pro"]
}
```

`plugins` キーは任意です。無ければ、入れたどのプラグインも有効で、既存インストールを保ち、提供コアをバイト一致にします。あるとき、一覧が有効集合です。`aidlc` は暗黙のコアプラグインです。省くとコアのステージ / スコープ / ランナーは無効になり、ファイルは入れたまま再有効化できます。例外は Initialization の 3 ステージです。ブートストラップにプラグイン識別情報は無いので、それらのステージは有効などのスコープでも常に有効です。

選択を見る・変えるには決定論ユーティリティコマンドを使います。

```bash
aidlc engine plugin select
aidlc engine plugin select test-pro
aidlc engine plugin select aidlc,test-pro
```

`select-plugins` は既知集合（`aidlc` に加え、コンパイル済みノードとスコープファイルで見つかったプラグイン名）に対して名前を検証し、ワークスペース変異ロックを持ったままです。プロジェクト面をステージングへコピーし、そこで無効寄与を剥がし、`harness.json` を書き、グラフ / 格子を再コンパイルし、ステージ / スコープランナーを再生成し、オーケストレータスキルの隣にある `tables.md` の生成表を刷新します。それからステージングを実際のプロジェクトと差分し、変わったファイル一式を `aidlc-transaction.ts` へ出します。監査追記はトランザクションのコミット済み検証器です。失敗したら、エンジンは選択、グラフ、ランナー、表、寄与、サイドカーのバイトをすべて戻します。これは古い三ファイルスナップショット慣例の置き換えです。`/aidlc --doctor` は有効プラグイン、プラグインごとの有効ステージ件数を報告し、グラフの `enabled:false` フラグが `harness.json` と食い違えば hard-fail します。

`aidlc engine plugin list` は、インストール済みと合成済みの状態の別コマンドです。プロジェクト選択を出さず、変えません。

**ベースを外したプラグインは一時停止する。** 選択は一覧全体なので、ベースプラグインを外し、それを土台とするプラグインを残した人は、そのプラグインを自分で入力したことになります。`select-plugins`（と `aidlc config project --plugins`）は一覧を入力どおりに書き、その変更時に一度だけ 1 行を伝えます。
`zeta is off. alpha builds on zeta, so alpha is paused until zeta is on again. To turn alpha off as well: /aidlc plugin select aidlc.` 一時停止中は、そのプラグインが足すものは何も走りません。オフにしたプラグインと同じく、そのステージ、スコープ、ランナーはフィルタされ、マージした寄与は剥がされます。sync はそれに手を付けず、何も言いません。この規則の所有者は一つ、`aidlc-lib.ts` の `pluginsEnabled()`（選択から一時停止中のプラグインを除いたもの。ベースはプラグインの合成スタンプから来る）で、実行時のどの読み手も doctor の選択一致検査もこれを読みます。`pluginsSelected()` は入力どおりの一覧です。`plugin list` はそのプラグインを `paused: needs zeta, which is off` と表示し、doctor は情報として列挙します。ベースをオンに戻すと、そのプラグインは次のセッション開始で戻ります（Kiro CLI と opencode では、人が `aidlc engine plugin sync --plugin-root <folder>` を走らせたとき）。それをオンにする select または `config project --plugins` が、どちらなのかを一度だけ伝えます（`aidlc-lib.ts` の `pausedLine()` の隣の `resumedLine()`、文言は `nextCompose()` から）。開いている作業を座礁させる一時停止は、どのオフ化とも同じく、プラグインとベースを指名して拒否します。`aidlc config project --plugins` 経由でも、オフにした、または一時停止したプラグインは同じようにマージした寄与を失います。どの設定刷新も、ステージした木の中で同じ規則、`aidlc-utility.ts` の `stripPluginsTurnedOff()` を走らせます。

## 5a. インストール済み一覧、合成スタンプ、同期

ホストが公開対導入の状態を持ちます。AIDLC は、そのインストール済みの状態をプロジェクト局所の合成状態と、完全にオフラインで比べます。

- Claude はスキーマ v2 の `~/.claude/plugins/installed_plugins.json` と、`~/.claude/settings.json` の `enabledPlugins` を読みます。Claude の `local` または `project` インストールは、それ自身のプロジェクト、つまり記録の `projectPath`（インストールを実行したフォルダで、サブディレクトリのこともあります）を含むプロジェクトの中でだけ数えます。ただし `project` インストールは、自身の記録を持たないクローンやワークツリーでも、その `.claude/settings.json` がプラグインを有効にしていれば数えます。Claude Code がそこでそのプラグインを読み込むからです。レジストリはあるのにその設定ファイルを読めないときは、Claude は現在のルートへフォールバックし、`plugin list` と doctor がそのファイルを要対応として示します。レジストリが無ければ設定ファイルは読みません（後述のフォールバックを参照）。
- Codex は `~/.codex/config.toml` で宣言したプラグイン ID だけを読み、その正確なキャッシュパスを `~/.codex/plugins/cache/<marketplace>/<plugin>/<version-or-local>/` の下で検査します。
- Kiro、Cursor、Copilot、OpenCode では、AI-DLC はホストのプラグイン一覧を読みません。いまのフックへ注入したプラグインルートだけを受けます。その呼び出しの外では、プロジェクトへ合成したプラグインは欠けとしてではなく、未比較（ホストのプラグイン一覧が無い）として一覧し、doctor は合成済みプラグインとその版を示して合格します。Claude と Codex も、レジストリ源が消えたときは同じフォールバックを使います。

各アダプタはホストネイティブマニフェスト一つを読みます: `.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`、`.kiro-plugin/plugin.json`（Kiro と Kiro IDE）、`.cursor-plugin/plugin.json`、Copilot の `.plugin/plugin.json`、または `.opencode-plugin/plugin.json`。インストール済みプラグインは、そのルートにプラグイン自身の `.aidlc-plugin/plugin.json` があり、その `name` がキーであるとき AI-DLC のものです。そのファイルがプラグインと一緒に運ばれるようになる前のビルド（リリース済みのすべての test-pro）は、引き続き `aidlc-<key>` のホスト名で識別されます。同じホスト一覧にある別ベンダーのプラグインは、壊れたエントリも含めて手を付けません。キーは安全で、版は semver でなければなりません。重複識別情報はすべてのソースパス付きで拒否します。どのアダプタもホームやキャッシュディレクトリを再帰走査しません。

合成のあと、AIDLC は `<harness-dir>/tools/data/plugin-compose-<key>.json` にプラグイン名、版、決定論的ソースハッシュを書きます。ハッシュは、ソートした compose 入力パスと、`{{HARNESS_DIR}}` 置換前の LF 正規化バイトを覆います。ホストラッパと生成したプロジェクト出力は除外するので、同じ版の vendored 編集とパスだけの改名が見えます。

`aidlc engine plugin list [--verbose|--json]` はホストインベントリをそれらのスタンプと比べます。既定出力のアクションは意図して三つだけです。`current`、`run: aidlc engine plugin sync`、または `needs attention: <remediation>`。プラグイン一覧の無いホストでは、合成済みプラグインは `not compared: no host plugin list` と表示され、何も必要ありません。verbose と JSON は内部理由を残します。版が違う、ソースが変わった、未合成、レガシー未スタンプ、無効、欠け、無効 / 曖昧、インベントリ利用不可、ベース待ちで保留（`dependency-unmet`。STATUS は `needs attention:` と sync が伝えた行。§8）、ベースがオフのため一時停止（`paused`、単なる状態。§5）です。2 回インストールされたプラグイン、つまり再ビルドしたものの隣にある古い `aidlc-<name>` コピーは `installed-twice` です。再ビルドしたコピーが使われ、その STATUS は古いコピーの削除コマンドを示します。

`aidlc engine plugin sync` は、有効でインストール済みプラグインすべてを、ベースを先にして（§8）、ステージしたプロジェクトで合成し、グラフとランナー面を再生成し、合成と所有の記録を書き、ステージしたプロジェクトを差分し、プロジェクトトランザクション一つを出します。期待状態検査が並行の進行中の編集を拒否し、コミット失敗はバイト、モード、スタンプ、所有記録をすべてロールバックします。ステージしたコピーはリンクを持ちません。AI-DLC 自身のフォルダへの途中やその中にあるリンク、または sync が書き込むファイルへの途中にあるリンクがあると、sync は何も変更する前に止まり、そのリンクを指名します。リンクがさらに深い場所にあるときは、それを含む AI-DLC フォルダを指名します。注入した現行ルート付きの対応ホストフックは、そのプラグインだけに同じ実装を使います。素の sync は、欠けた導入ソースの中身を決して消しません。明示 `aidlc engine plugin sync --prune-missing` は、証明済みの完全インベントリ、対話でないときの `--yes`、ハッシュ証明の所有を要求します。局所変更または未所有パスは拒否します。ターミナルでは何も尋ねません。削除するプラグインと元に戻す方法を示してから削除します。プラグインファイルの識別情報はコミットされたテキストです。改行を変換するチェックアウト（Git for Windows の `core.autocrlf`）は、sync にとっても compose フックにとっても、プラグインのファイルの変更ではありません（規則は [docs/reference/04-stage-protocol.md](04-stage-protocol.md) の「改行（Line endings）」）。

list、doctor、sync のどれも、遠隔プラグインレジストリを検査しません。公開版の発見はホストの責任のままです。

ソースツリー導入では、`plugin-sync` ユーティリティ動詞（compose フックのフォールバック前面）が、発見したプラグインルートの `hooks/compose.ts` ファイルを、環境または `--plugin-root <dir>` から走らせ、プラグインルートが設定されていなければきれいに終わります。Claude Code と Codex では `no installed plugins; nothing to sync` と、それ以外では `plugin sync` がそこで出す行とともに終わります。その行は、合成済みの各プラグインについてのコマンドを示します（`aidlc-plugin.ts` の `noPluginListLine()` と `syncCommand()`）。ルートは設定されているがどれも `hooks/compose.ts` を持たなければ、exit 1 で各ルートと理由を指名します。混成集合では飛ばした各ルートを警告し、妥当なルートを合成し、exit 0 です。

### プラグイン doctor 検査

有効プラグインは `tools/<plugin>-doctor.ts` を提供してよいです。`/aidlc --doctor` は合成したハーネス tools ディレクトリでそのスクリプトを発見し、シェル無しで Bun から直接走らせ、`AIDLC_PROJECT_DIR`、`AIDLC_HARNESS_DIR`、`AIDLC_PLUGIN_NAME` をセットします。ネイティブインストールでは、その Bun は `BUN_BE_BUN=1` 付きで走る `aidlc` バイナリであり、スクリプトはこれを継承します。そのためスクリプトが実行する `aidlc` コマンドは代わりに Bun を起動してしまいます。検査は `aidlc` を実行するのではなく Bun の API で行ってください。無効プラグインのスクリプトは使われないままです。`harness.json` に `plugins` 選択が無いとき、入れたどのプラグインも対象です。ステージまたはスコープを所有するプラグインか、合成によって `tools/data/` の下にサイドカー（`plugin-contrib-`、`plugin-owned-`、または `plugin-compose-<plugin>.json`）を残したプラグインです。したがって、センサーやオーバーレイだけを提供するプラグインも、合成されれば発見でき、選択できます。

スクリプトは JSON オブジェクト 1 つを stdout へ書きます。

```json
{
  "checks": [
    {
      "pass": false,
      "label": "required connector is installed",
      "fix": "install the connector and re-run doctor",
      "severity": "error"
    }
  ]
}
```

`severity` の既定は `error` です。落ちた error 検査は doctor を落とし、落ちた `advisory` 検査は表示とエクスポートだけで終了コードを変えません。通った検査は普通に描きます。doctor はインストール済みプラグインをコード信頼境界として扱いますが、失敗を閉じ込めます。spawn エラー、タイムアウト（既定 5 分、正整数上書きは `AIDLC_PLUGIN_DOCTOR_TIMEOUT_MS`）、非ゼロ終了、無効な JSON / 形、壊れたエントリは、doctor を落とさず有界な所見になります。出力上限はプラグインにつき検査行 50、stdout 256 KiB、label / fix 300 文字です。

コンパイル済み `stage-graph.json` はインストール済みステージ集合全体を永続します。無効ノードは `"enabled": false` を運び、有効ノードはキーを省きます。実行時ローダは無効ノードをフィルタするので、ランナー、状態行、スコープ表、オーケストレーションは選んだグラフだけを見ます。`loadStageGraphAll()` は doctor と選択道具向けに予約です。ステージ番号は全グラフから割り当てるので、プラグインを無効にしてあとで再有効化しても正確な番号を保ちます。選択フィルタはステージ、スコープ、ランナーを覆います。無効プラグインの `agents/` と `knowledge/` ファイルはディスクに残り、**かつ** 読み込み可能です（エージェント名簿とナレッジ検索は選択フィルタされない）。それらをディスパッチするステージがフィルタされるので、何かが参照しなければ使われません。

コンパイル済みスコープ格子は有効スコープ識別情報だけを含みます。無効プラグインのスコープファイルはディスクに残りますが、プラグインを再選択するまで妥当な実行時スコープではありません。frontmatter に `freeform_default: true` と書いた有効スコープは、混成のものも含むどのインストールでも、まず自由文 / 既定のフォールバックになります。そうでなく、コアが無効でプラグインスコープ所有者がちょうど一つ有効なら、フォールバックはそのプラグインのアルファベット順最初のスコープを使います。複数のプラグインスコープ所有者が有効で、コアの好ましい `classic` フォールバックが使えなければ、オーケストレータはエラーし、明示 `--scope` を求めます。

プラグインを無効にすると、自分のファイルだけでなく、コアステージへマージしたものも外れます。compose は実際に適用した構造追加（produces / sensors / `required` と任意 `conditional_on` を含む完全 consume エントリ / scopes / required_sections、対象ステージごと）と、成功して適用した各フラグメントのアンカー / order / ハッシュを、プラグインごとのサイドカー `tools/data/plugin-contrib-<key>.json` に記録します。継ぎ込んだ散文フラグメントは自分の境界マーカーも運びます。無効化時、`select-plugins` とどの設定刷新（`aidlc config project --plugins` を含む）も、それぞれのロールバックトランザクションの中で、一つの規則（`stripPluginsTurnedOff()`）を通して両方をインストール済みステージソースから剥がすので、無効または一時停止中のプラグインの寄与は有効ステージを操舵しなくなります。構造追加は一つの剥がし処理、`aidlc-plugin.ts` の `stripRecordedAdds()` を通して外れます。オフにしたプラグイン、sync が削除または更新したプラグイン、合成済みステージに対する設定刷新の検査が、これを共有します。記録した各値は、compose が書いたとおりの綴りのエントリを取り除き、それが無ければ同じ意味のエントリを一つ取り除くので、ステージが元から持っていた引用符付きの行は残ります。再有効化は次のセッション開始で寄与を戻します（compose フックを走らせない Kiro CLI と opencode では、人がプラグインのフォルダを指定して `aidlc engine plugin sync --plugin-root <folder>` を走らせたとき）。プラグインの compose が再マージし、バイト一致です。select の行がどちらなのかを伝え、保留中のプラグインの行も、一つの規則（`aidlc-plugin.ts` の `nextCompose()`）から同じく伝えます。保留の行は sync が使ったフォルダを指名し、どの記録もフォルダを伝えない select の行は `<plugin's folder>` と書きます。

compose フックと `select-plugins` は、同じ realpath キーのワークスペースロックで計画を直列化します。実際のプロジェクト変更は、そのあとトランザクションエンジンのルートロックと期待状態検査を通してコミットします。保護する幅は、インストール済みステージ編集、プラグインごとのサイドカー、選択書き、グラフ / 格子コンパイル、ランナー / 表生成、監査検証、ロールバックにまたがるので、並行プラグインフックが互いの集合和更新を失わず、無効化が compose と競合して追跡されない寄与をアクティブに残せません。

選択はコンパイル時に閉包検査されます。有効ステージは、唯一の生産ステージが無効な成果物を要求してはいけません。エラーは消費ステージ、成果物、無効な生産ステージ、それらを提供するプラグインを指名し、それらのプラグインを有効にするか消費者を無効にするよう伝えます。プラグインだけの選択が、飢えた必須入力でステージをルーティングしてしまうのを捕えます。無効ステージを指す `requires_stage` 辺はエラーでは**ありません**（依存が走らないとき順序辺は空虚です。プラグインだけのインストールがコアのあとにプラグインステージを並べるのは正当）。ただし doctor はその落ちた辺を advisory として列挙します。

`select-plugins` は、アクティブなワークフローを座礁させる変更も拒否します。走っているワークフローのスコープを所有するプラグイン、または計画内の pending EXECUTE ステージを所有するプラグインを無効にすることは、各依存を指名して拒否します（先にワークフローを完了またはアーカイブするか、プラグインを有効のままにする。park したワークフローも再開時にはそのプラグインを必要とするためです）。すでに座礁させる選択では doctor が hard-fail します。

選択がすでに存在するとき、プラグインを合成しても自動では有効になりません。compose フックはまだプラグイン自身のファイル（ステージ、スコープ、エージェント、ナレッジ、センサー、ツール。そのステージ、スコープ、ランナーは実行時フィルタされ、エージェントとナレッジは上のとおり読み込み可能なまま）をコピーし、そのプラグインを出す `select-plugins` コマンドを指名する advisory drop を記録しますが、無効のあいだコアステージソースへ寄与をマージし**ません**。マージした寄与は選択フィルタを迂回し、マージするとセッション開始のたびに無効化時の剥がしが戻るからです。選択キーが無ければ、合成したプラグインは直ちにアクティブで、元の現状を保ちます。

`bundle` は現在意図的に未使用です。語は将来のプラグイン集合概念向けに予約しています。プラグイン所有は常に `plugin:` で表します。

## 6. 寄与の継ぎ目

**寄与** は、名前付きの既存ステージを加算で変えるためにプラグインが提供するファイルです。場所は `contributions/<phase>/<slug>.md`。対象を決して直しません。

```yaml
---
target: build-and-test        # the existing core stage being enriched
plugin: test-pro
adds:                         # STRUCTURAL — set-unioned into the stage node
  produces:
    - test-pro-regression-suite            # plugin-namespaced (§8)
  consumes:
    - artifact: test-pro-testability-requirements
      required: false
  sensors:
    - coverage-threshold
  required_sections:
    - "Branch Coverage"        # declared H2 (merged into the stage; not machine-enforced yet — see §9)
fragments:                    # PROSE — spliced into the stage body
  - anchor: after-step:8
    order: 100
---

## fragment: after-step:8

### Step 8a (test-pro): Branch + coverage enrichment
…prose the agent reads, inserted after the target stage's Step 8…
```

`bundle:` は予約で未使用です。プラグイン所有には `plugin:` を書いてください。

**マージの意味:**

- **構造面** — 対象ステージのソース frontmatter へ **集合和**。可換、順に依存しない、調整していない著者をまたいで安全。*現在実装済み:* `produces`、`consumes`（成果物 + `required` + `conditional_on`、それぞれ保つ）、`sensors`、`scopes`、`requires_stage`、`required_sections`。`adds.scopes` はガードレールを二つ運びます。スコープの識別情報ファイルがすでに入っていなければならない（`scopes/<name>.md` の無い名前は全部 SKIP の幽霊として解決する）、その入れたファイルの `plugin:` frontmatter が寄与プラグインを正確に指名しなければならない — コアステージをコアまたは他プラグインのスコープの下に置くことは、もう片方の所有者が同意していない選択意味を変え、所有は名前接頭辞規則ではなくファイルの宣言所有者から来る（ダッシュ接頭辞はプラグイン名をまたいで重なる。コアスコープは `plugin:` を宣言せず、決してマージしない）。違反エントリはマージせず drop-with-log。`adds.requires_stage` は順序辺を集合和する。成り立たない辺はマージせず drop-with-log。依存は対象以外のインストール済みステージ（コア、またはすでにディスク上にあるプラグインステージ）でなければならず、コンパイラ自身の規則で対象より前にコンパイルされなければならない。完全なピン済み番号を比べ（接頭辞、それから索引）、ピン済みの行はそのステージがフェーズディレクトリを移っても番号を保ち、ピンされていないステージだけがフェーズディレクトリから接頭辞を取る。同じ compose が足すステージはピンされておらず、そのフェーズの最大値の先へ初期設定されるので、インストール済みステージが同じフェーズ内でそれを要求することはできない（プラグインステージをコアのステージより前に並べるのは RFC #1100）。同じフェーズの新しいステージ 2 つの間では、循環を閉じない限り辺は成り立つ。スコープがスキップするステージへの辺は、コア自身のスコープ横断の辺とまったく同じく、そこでは空虚である。記録された辺は、どの compose、実行時刷新、Cursor 再インストールでも再検査される。もう成り立たない辺はステージと寄与サイドカーから外され（まだ宣言されている辺は、成り立つようになれば再びマージされる）、入ってくるランタイムが自ら宣言するようになった辺はコアへ引き渡されるので、あとの無効化がコアの辺を剥がすことは決して無い。
- **散文フラグメント**（ステップ / 質問散文の `fragments`） — 宣言したアンカーでステージ本文へ継ぎ込み、`(order, plugin)` で決定論的に並べる。継ぎ込んだ各ブロックは内容ハッシュ境界で包み、アンカー / order / ハッシュは寄与サイドカーに永続するので、再合成は冪等、アップグレードしたフラグメントが以前のブロックを置き換え、散文だけのプラグインも検証できる出自を保ち、別プラグインのブロックはフック発火順に関係なく `(order, plugin)` でインターリーブする。エージェントは実行時に基底本文 + 並んだフラグメントを読む。
- **上書きは決して無い。** 寄与は足すだけです。ステージの `lead_agent` を変え、`consumes[].required` を緩め、フィールドを外し、既存ステップ散文を置き換えることはできません。上流振る舞いを *変える* 本当の必要はフレームワーク層の判断であり、プラグイン内の静かなパッチではありません。

**フラグメントアンカー:**

| Anchor | Inserts the fragment… |
|--------|------------------------|
| `after-step:<n>` | right after `### Step <n>`'s content (before the next heading) |
| `before-step:<n>` | immediately before `### Step <n>` |
| `after-questions` | not supported yet: compose drop-logs it as an unknown anchor; use `after-step:<n>` |
| `end-of-steps` | at the end of the `## Steps` block |
| `in:<Compartment>` | at the end of the named `## <Compartment>` block |
| `after-preflight` | personas: right after the delegated-knowledge preflight the packager injects |
| `end-of-body` | at the end of the authored body (before knowledge absorbed into a reviewer persona) |

**面ごと** — 上流変更の種類ごとにプラグインが使うもの。"Status" は、compose フックが現在マージするもの対、設計済みだが先送りのものを印します。

| Change | Mechanism | Status |
|--------|-----------|--------|
| Stage asks new questions | `fragments` of question prose | ✅ implemented |
| Stage produces an extra artifact | `adds.produces` + a `fragments` step that emits it | ✅ implemented |
| Stage requires new sections | `adds.required_sections` | ✅ merged (⚠️ declarative — not machine-enforced yet, §9) |
| Add a verification to a stage | `adds.sensors` (+ ship the manifest and `tools/` script) | ✅ implemented |
| Add a consume edge | `adds.consumes` | ✅ implemented |
| Add a `requires_stage` edge | `adds.requires_stage` | ✅ implemented (the dependency must compile before the target — a lower full pinned number, or an earlier phase for a stage not yet pinned; violations are dropped-with-log) |
| Put an existing stage under a plugin scope | `adds.scopes` for a core stage (own-plugin scopes only; installed identity file required); `include_stages:` on the scope for a stage of the plugin's base (section 7) | ✅ implemented |
| Inject phase policy / guardrails | ship `memory/phases/<p>.md` into the default-space seed (§7) | ⏳ deferred (not yet projected) |
| Enrich a core persona (a collaboration bullet, a mandatory anchor) | `contributions/agents/<agent>.md` with `fragments` at `in:<H2>`, `after-preflight` or `end-of-body` | ✅ implemented (prose only; `adds.*` is refused with an advisory drop) |

## 7. 方法 / ルール、エージェント、ナレッジ、スコープ、起動

この節は、新しいステージ + 寄与の継ぎ目を超えた面です。著者が誤導されないよう状態を明示します。

**方法 / ルール → メモリの種** *（⏳ 先送り）。* フレームワークのルール層はスペースごとの **memory** 木（`aidlc/spaces/<space>/memory/{org,team,project}.md`、`phases/<phase>.md`）で、`core/memory/` から初期設定します。設計は、プラグインが `memory/phases/<p>.md` を寄与し、その種へ集合和することです。パッケージャはまだプラグインの `memory/` 木を投影しないので、現在効果はありません。

**エージェント** *（✅ 投影 + 合成）。* プラグインは新しいペルソナを `agents/<plugin>-<role>-agent.md` の下へ提供し、frontmatter の `name` はファイル名ステム、`plugin: <plugin>` です。compose はコアやほかのプラグインを壊さずに `<harness>/agents/` へコピーします。同一ファイルは冪等スキップ、同じ行き先の違う中身は drop-logged です。OpenCode では、compose はさらに `mode: subagent`、`permission.task: deny`、OpenCode 妥当な model / memory frontmatter 付きのネイティブ `.opencode/agents/` 双子を出します。Kiro では、compose は `.kiro/agents/` ペルソナから未対応の `disallowedTools: Task` 行を外し、Kiro のネイティブエージェントツール設定がネスト委譲を使えないままにします。違う `disallowedTools` 値は drop-logged で、ペルソナはコピーしません。再 compose は、投影前 composer からの正確で変わっていない同じプラグインコピーのときだけ、既存ペルソナを移行します。編集済みまたは他者のファイルは no-clobber 振る舞いを保ちます。すでに合成した未対応値はその場に残り、再 compose 前に外すファイルを指名する劣化した診断を出します。

プラグインは `contributions/agents/<agent>.md`（§6）を通じて **コア** のペルソナを豊かにすることもできます。散文フラグメントだけで、`<harness>/agents/<agent>.md` の `in:<H2>`、`after-preflight`、`end-of-body` に継ぎ込み、エージェント slug の下で寄与サイドカーに記録し、無効化時にはステージのフラグメントとまったく同じく剥がします。同じフラグメントは、ハーネスがそのペルソナをディスパッチするどのファイルにも届くので、指示はどのハーネスでもエージェントに届きます。Markdown ペルソナ（エンジン名簿、そして Claude Code、Cursor、Kiro IDE ではネイティブエージェント。Kiro CLI のエージェント JSON はそこからプロンプトを読み込む）に加え、パッケージャがそこから作るハーネスネイティブの双子です。Codex のエージェント TOML の `developer_instructions` 文字列（フラグメントの本文を TOML 向けにエスケープしたもの）、OpenCode の `.opencode/agents/` と Copilot の `.github/agents/` のネイティブエージェント、そして Kiro IDE ではツール権限を除いたペルソナ（`.kiro/aidlc-common/personas/<agent>.md`。ステージがインラインで読むエージェントについて、そこでエンジン名簿が指名するファイル）です。doctor はこれらのファイルをそれぞれ検査し、刷新はそれぞれへフラグメントを再適用し、無効化と prune はそれぞれから剥がします。

Kiro CLI、Codex、OpenCode では、エンジン名簿の Markdown ペルソナは `mode: inline` にだけ使えます。ネイティブディスパッチはさらにハーネスごとのディスパッチ面が要ります。Kiro CLI では手書き agent-v1 JSON に加えコンダクターの `trustedAgents` 一覧への登録、Codex ではエージェント設定 TOML（提供の `aidlc-*-agent.toml` 形）、OpenCode ではネイティブ `.opencode/agents/` サブエージェントファイル。`kiro-ide` の行（Kiro IDE と Kiro CLI v3）は代わりに入れたエージェント Markdown 自身をディスパッチしますが、`tools:` が空でなく、`permissions.rules` が、effect が `allow`、`ask`、`deny` のいずれかである整った `capability` / `effect` / `match` エントリの空でない一覧であるときに限ります（コア自身のペルソナは 3 つとも持ちます）。空の permissions、欠けたまたは空の rules、壊れたエントリ、それ以外の effect は拒否します。だから compose は、ディスパッチトポロジ（リードとサポートの `mob`、`pipeline`、`subagent`。どのゲート付きステージでもモードに関係なく `reviewer:`）が、完全な入れたディスパッチ面の無いエージェントを指名するプラグインステージを拒否し、ステージ、エージェント、手当てを compose drops ログに記録します。Kiro CLI では JSON と `trustedAgents` 登録を独立に検査します。片方だけでもステージを拒否します。Kiro IDE では IDE 経路は `aidlc.json` を読まず、compose がプラグイン自身のエージェントにその面を自分で与えます。プラグインが提供する各エージェントへ、インストールが `.kiro/tools/data/plugin-agent.md` に保持する行（固有の役割を持たないペルソナの `tools`、`includeMcpJson`、`permissions`。そのシェル deny を含む）を足します。足すのはエージェントが宣言していない各キーで、`tools` の行はそれらの permissions と並べるときだけ足します。リードがインラインで読むために、それらの行を除いたペルソナを `.kiro/aidlc-common/personas/<agent>.md` へ書き、エージェントをディスパッチするステージは自分が書いたコピーで判定します。プラグインが提供しないエージェントは、引き続き入れた `.md` に両方のブロックを書くか、ステージを `mode: inline` に変える必要があります。Kiro CLI では同じファイルがペルソナの 2 つのプロンプト行（`tools`、`includeMcpJson`）を保持し、それはどのプラグインエージェントも受け取ります。その agent-v1 JSON と `trustedAgents` エントリは手書きのままです。これらの行は、それらを書く AI-DLC でビルドしたプラグインに届きます（compose フックはプラグインの中に入って出荷されます）。OpenCode では、ネイティブ双子発行を生き延びるプラグイン提供ペルソナ（閉じた frontmatter、投影不能な `disallowedTools` が無い）がその面として数えます。Kiro CLI と Codex の面は常に手書きなので、プラグイン自身のファイルはそれらの検査を満たしません。欠けた面を手で書いて compose を再実行するとステージを受け付けます。Markdown ペルソナは、それを使う受け付けたどのインラインステージ向けにも合成されたままです。

`agent-team` はスキーマ予約ですが実行時消費者が無いので、compose はどのハーネスでもそれを選ぶプラグインステージを、黙ってインラインとして扱わず拒否します。インストール済みステージパーサが使えなければ、Kiro / Codex / OpenCode の compose は fail-close します。明示 `mode: inline` スカラーがあり `reviewer:` が無いステージだけを受け付けます（引用スカラー形は認識する）。no-clobber アップグレードは古いフックが合成したステージを外せないので、これらのディスパッチ検査に落ちる既存ステージはディスクに残りますが、手当てを指名する劣化した health 行を出します。

**ナレッジ = 方法論のみ** *（✅ 投影 + 合成）。* プラグインはエージェントごとの方法論ナレッジを `knowledge/<agent-slug>/` へ提供し、`<harness>/knowledge/<agent-slug>/` へ合成します。領域 / スペースナレッジ（`aidlc/spaces/<space>/knowledge/`）はブートストラップ時に空の利用者実行時状態で、プラグインは提供も種まきもしません。

**スコープ** *（✅ 投影 + 合成）。* プラグインスコープの識別情報は `scopes/<plugin>-<name>.md` の下のファイル 1 本で、frontmatter の `name` はファイル名ステム、`plugin: <plugin>` です。compose は壊さずに `<harness>/scopes/` へコピーします。プラグインが書いたステージの所属は、それらのステージの `scopes:` frontmatter 経由です。プラグインスコープは、好ましいコア `classic` 既定が無効なときに自分を指名する `freeform_default: true` をセットしてよいです。有効スコープが高々一つだけ指名を主張してよく、曖昧な選択集合はグラフコンパイルが拒否します。既存コアステージへプラグインスコープを足すのは、寄与の `adds.scopes`（§6）経由です。自プラグインスコープのみ、マージ前にスコープファイルが入っていなければなりません。ベース（セクション 8）を土台とするプラグインは、ベースのステージを自分のスコープの `include_stages:` 一覧で指名して、自分のスコープで走らせます。コンパイルはそれぞれをそのスコープの列へ足し（ステージのコンパイル済み行がそのスコープを列挙する）、ステージファイルと他のどのスコープもそのままです。どのインストール済みステージも持たない include は列から外され、コンパイルを決して落としません。sync はプラグインを保留し、どのステージが欠けているかを伝えます（セクション 8）。validate は、そこにあるコアまたは自身のステージと、ベースのものではあり得ない名前（プラグインのステージ slug はその名前で始まり、compose がそれを強制する）を拒否し、ベースのものは `--with` で指定したベースのチェックアウトと照合します。

**起動（`when:`）** *（⚠️ 解析するが評価しない）。* ステージは構造化 `when:` 述語を運んでよいです。`{producer-in-plan: X}` はスキーマ検証と解析されますが、**エンジン消費者はまだ評価しません** — `aidlc-graph` が将来の家として自分を指名します。だから `when:` を運ぶステージは現在、宣言スコープの下で無条件に EXECUTE です。プラグイン自身のステージは、プラグインが選んだ集合にあるときだけ存在するので、「このプラグインはアクティブか」はすでに compose 時の事実です。

**コンポーザーの選別（`ars:`）。** 適応コンポーザーの期待値の選別は、ステージごとのコスト事前値を `tools/data/ars-priors.json` から読みます。このファイルはすべてのコアステージを指名し、それ以外は何も指名しないので、プラグインステージは以前、`aidlc-graph ars` の出力で `no-prior` 行（「選別不能」）になっていました。プラグインステージは同じ 4 つの事実を自身の frontmatter の `ars:` ブロック（`targets` と `cost`、任意で `role` と `project_types`）で宣言します。これはステージスキーマで（したがって `aidlc-plugin-validate` で）検証され、グラフノードへそのままコンパイルされ、事前値ファイルにその slug のエントリが無いときは常に `ars` サブコマンドが読みます。提供エントリが常に勝つので、コアの選別は変わりません。各選別行は `priorSource`（`shipped` | `stage` | `null`）を運びます。[Stage Definition](15-stage-definition.md) の § `ars` を参照してください。

**`plugin.json` の `aidlc.contributes`。** VALIDATE はブロックを読み、未知キーを拒否し、いま投影するどのサブツリーにも正確な正規値を要求します。BUILD と TEST は同じ所見で止まり、直接発行は出力を置き換える前にもう一度パス契約を断言します。emitter はまだ任意マニフェストパス経由ではなくディレクトリ慣例でバイトを発見します。設定可能なルーティングは先送りのままです。投影が存在するまで `memory` は拒否します。`aidlc.lock.json` 読みもありません。composer は現在ロックファイルから何も解決しません。

## 8. マルチテナントのガード

一度も調整しない独立した著者を安全に保つのは:

- **名前空間。** 寄与する成果物の論理名は `<plugin>-` 接頭辞。`core-*` は予約。プラグインのステージ、エージェント、スコープ、センサーは、選んだ集合を横断しコアに対して一意であるべきです。プリミティブファイル衝突は no-clobber で、帰属付き drop-logged（黙った影付けは無い）。唯一の例外は、プラグインがインストールして以来変わっていないプラグイン自身のファイルで、再 compose がプラグインの新しいコピーで置き換えます。
- **浅い層構造。** プラグインはコアと、高々一つのベースプラグインを土台とし、マニフェストの `dependencies` で `"<plugin>"` または `"<plugin>@<range>"`（npm の範囲文法）として指名します。ベースはコアだけを土台とするので、最長の連鎖はコア、ベース、チームプラグインです。ビルドはプラグイン自身の `.aidlc-plugin/plugin.json` をすべての投影へコピーし（ホストマニフェストはそれを運べません。Claude Code はそこにある `dependencies` キーを、有効にするホストプラグインとして読みます）、validate は 2 つ目のベース、自己依存、npm が読めない範囲を拒否します。sync はベースを先に、それからそれを土台とするプラグインを合成します。AI-DLC がベースをインストールしたり取得したりすることは決して無く、インストールされている一つの版を読みます（プラグイン一覧の無いホストでは、プロジェクトに合成された版）。ソルバーもロックファイルもありません。ベースがインストールされていない（またはまだプロジェクトに無い）、ホストで無効、範囲外、別のプラグインを土台としている、プラグインのスコープが含めるステージ（`include_stages`、セクション 7）を欠く、またはマニフェストが 2 つのベースを指名しているか読めないプラグインは、保留され、決して解決されません。sync は 1 行を一度だけ伝え、`tools/data/plugin-held-<key>.json` を書き、他のすべてのプラグインを合成して exit 0 で終わります（`--json` は `data.held` を列挙）。`plugin list` と doctor は、sync がそのプラグインを合成して記録を外すまでその行を表示します。以前に合成された保留中のプラグインはそのまま残ります。素の sync は決して削除しないからで、その行もそう伝えます。セッション開始フックは自分のプラグインだけを指名します。sync がプラグイン一覧を読む Claude Code と Codex では、フックはインストール済みのベースも先に合成するので、ホストのフック順は関係ありません。合成スタンプは `base` を記録するので、プラグイン一覧の無いホストも 1 段の規則を保ちます。マニフェストが一緒に運ばれるようになる前にビルドされた投影は、コアだけを土台とします。
- **決定論的な並び。** 唯一の非可換面（散文フラグメント）は明示 `(order, plugin)` で並び、読み込み順では決して並ばない。
- **衝突は見える。** 本当に非可換な衝突 — 同じステージの同じフラグメントアンカーで同じ order、満たせないプラグイン横断辺、重複プリミティブパス — は、オーバーレイ順で解決せず、帰属付きで落とすか拒否する。

## 9. As-built: 発行、導入、作業例

共有プラグイン emitter は、ソースルート 1 つをホストプラグイン 1 つへ投影します。`bun scripts/package.ts` は発見したファーストパーティ `plugins/<name>/` ルート向けに呼び、`aidlc-plugin-build.ts` は外部プラグインリポジトリから呼びます。各投影は `.aidlc-plugin-projection.json` を運び、置換権限を論理プラグインと正確なハーネスへ結び、加えてホストネイティブマニフェスト（`.claude-plugin/` / `.codex-plugin/` / Copilot `.plugin/` / `.kiro-plugin/` / `.opencode-plugin/` / `.cursor-plugin/`）、ほかの誰かがビルドするプラグインでは、ホストが読む場所にあるそのプラグイン自身の `marketplace.json`（ホストマニフェストの隣。Codex は `.agents/plugins/marketplace.json` だけを読む）、compose フック、プラグインの中身（完全な `number` / `plugin` / `when` frontmatter 付きステージ — スキーマはネイティブに受け付ける）。一致する妥当なマーカーの無い空でない出力は決して掃除しません。force 迂回はありません。Cursor はプラグインエージェントの compose 入力を `aidlc/agents/` の下に保ち、Cursor が自動発見するルート `agents/` の外です。compose は入れた `.cursor/agents/` 名簿へ、ハーネストークンを解決し指名モデルピンを外したネイティブコピー 1 つを投影します。compose フックは持ち運び可能な `compose.ts` 1 本（bun — GNU 固有シェル無し）で **ハーネス非依存** です。プラグインルートは `CLAUDE_PLUGIN_ROOT | PLUGIN_ROOT | AIDLC_PLUGIN_ROOT` から解決し、出したフック位置へ落ちます。プロジェクトディレクトリは `CLAUDE_PROJECT_DIR | AIDLC_PROJECT_DIR | PWD`（Codex はプロジェクトディレクトリ変数を未設定のまま — PWD がフォールバック）。ハーネス葉は `AIDLC_HARNESS_DIR` から、各ホストコマンドまたは Cursor ランチャが供給します。Cursor のランチャはさらに SessionStart `workspace_roots` を解析し、AI-DLC Cursor インストールを運ぶ唯一のルートを選び、`AIDLC_PROJECT_DIR` が一つを選ばない限り一致ルートが複数なら拒否します。新しいステージ / スコープ / エージェント / ナレッジ / センサー / ツールを壊さずにコピーし、継ぎ目を冪等にマージし（内容ハッシュ境界継ぎ込み、書く前に比較）、落とさなければならない寄与（欠けた対象、壊れたアンカー、インストール済みエンジンが受け付けないキー）をプラグインごとの `<hooksHealthDir>/plugin-compose-<key>.drops` ファイルへ記録します。コアフックが書き `/aidlc --doctor` が走査する同じスペースごとの health ディレクトリであり、セッションを落としません。このリポジトリが提供するプラグインは自身のカタログを持ちません。パッケージャは `dist/plugins/` のルートに、ホスト形式ごとに `aidlc-plugins` カタログを 1 つ書き（Claude Code の `.claude-plugin/`、Codex の `.agents/plugins/`、Copilot の `.plugin/`、Cursor の `.cursor-plugin/`。ストアの無い Kiro と、npm モジュールをインストールする opencode には無し）、各プラグインを `./<name>/<harness>` のソースとともに列挙します。リリースランタイムも同じ `plugins/` フォルダを運ぶので、人はそれを一度追加すれば、どのプラグインもインストールできます。プラグインのステージとスコープのランナーは、ハーネスのスキル発見ルート（`<harness-dir>/skills/`、Copilot の `.github/skills/`、Codex の `.agents/skills/`）に、ホストの明示呼び出し専用ガード（frontmatter の `disable-model-invocation: true`、または Codex の `agents/openai.yaml`）付きで、提供ランナーとまったく同じく置かれます。入れたテスト / フィクスチャペイロードは、合成するハーネス葉でキー付けしたハーネスごとの `plugin-compose-installed-tool-payloads-<harness>.drops` 記録で別に監査します。走査は、直したプラグイン投影にもうパスが無くてもそのハーネスのインストール済みツールツリーを歩くので、あるハーネスのきれいな compose が別ハーネスの advisory を消さず、古い compose 版がツールファイル出自を格納しなかったので、次に compose するプラグインへ帰属させずにレガシーファイルを報告します。センサーマニフェストはコピー時ガードを追加で運びます。発見は `sensors/` を平坦に走査し、`aidlc-<id>.md` に一致するベース名だけ索引するので、ほかの名前（またはサブディレクトリに入れ子）のプラグインマニフェストは合成されても発火しません。compose はそのようなマニフェストを拒否し、ファイルと必須の形を指名する劣化した drop を記録し、古い compose フックがすでに着地させたものも次の実行で同じように報告するので、誤名センサーがディスク上で黙って死にません。

ホストはプラグインをその作者の名前で表示します。このリポジトリが提供するプラグインは AI-DLC 自身のものです。パッケージャは `aidlc-plugins` カタログの中でそれらを `aidlc-<name>` と名付けます。ほかの誰かが `aidlc-plugin-build.ts` でビルドするプラグインは、マニフェストの `name` をホスト名として保ち、`aidlc.marketplace` が指名するカタログ、またはプラグインにちなんで名付けたカタログに入ります。そこでは `aidlc` と `aidlc-` で始まる名前（大文字小文字を問わない）は拒否されます。2 つ目の `aidlc-plugins` カタログは Claude Code で私たちのカタログを置き換えてしまうからです。投影にあるプラグイン自身のマニフェストがプラグイン識別情報の正です。compose はそこから `<name>` を読み（古いビルドではホストパッケージ ID `aidlc-<name>` から）、`plugin:` フィールドが違う所有ステージ、スコープ、エージェント、寄与中身を拒否します。入ってくるスコープ / エージェント名はファイルを受け付けるときに予約するので、1 プラグインツリー内の重複識別情報はコンパイル前に落ちます。構造一覧比較は引用ありと無しの YAML スカラーを正規化します。compose はさらにトランザクション全体で realpath キーのワークスペースロックを持ちます。グラフコンパイルが失敗したら、新しくコピーしたファイルと寄与書きを、リトライマーカーを書く前に復元します。

出した SessionStart コマンドは先に `PATH` 上の `aidlc` を探り、使えるときは `aidlc engine plugin sync` を走らせます。それが無ければ、フックはプロジェクト自身の `<harness-dir>/tools/aidlc-plugin.ts sync` を Bun で走らせるので、コピー経路も同じ合成記録を保ちます。そのツールが無いとき（Cursor と Kiro IDE のランチャでは、それが拒否したときも。古いプロジェクトでも合成できるように）は、直接 bun の `hooks/compose.ts` 呼び出しへ落ちます。

Cursor と Kiro はプラグインフックをプラットフォームのシェルで走らせる（Cursor: その人のシェル、Windows では PowerShell。Kiro: `/bin/sh`、Windows では cmd.exe）ので、それらのフックは `sh -c` を持ちません。Cursor の出したフックは Cursor の平らな camelCase スキーマ（`hooks.sessionStart[].command`）を使い、エントリは 2 つです。Cursor がフックの環境に置くプラグインルートとワークスペースを読む `aidlc engine plugin sync --harness-dir .cursor` と、`aidlc` の無いインストール向けの `bun ./hooks/aidlc-plugin-compose.ts .cursor` です。Cursor は各エントリを個別に起動するので、ランタイムが無い方は、もう一方を止めずに失敗します。その Bun ランチャは `Bun.which` と `process.execPath` で `aidlc` を探り、それからプロジェクト自身の sync ツールか兄弟 `compose.ts` を走らせます。Kiro ではプラグイン全体が自身のフォルダ `.kiro/aidlc-plugins/<name>/` に置かれるので、同じプロジェクトにドロップした 2 つ目のプラグインが 1 つ目に重なることは決してありません。Kiro IDE の `v1` SessionStart 登録は、`/bin/sh` でも cmd.exe でも同じように読めるコマンド 1 つです。
`aidlc engine plugin sync --harness-dir .kiro --plugin-root ./.kiro/aidlc-plugins/<name> || bun ./.kiro/aidlc-plugins/<name>/hooks/aidlc-plugin-compose.ts .kiro kiro-ide`。
Kiro はフックにプラグインルートを与えませんが、ワークスペースルートで走らせます。どちらも自分のハーネスを指名するので、Cursor や Kiro IDE の隣に Claude Code をインストールしたプロジェクトでも、正しい方へ合成されます。

**導入、ホストごと:**

```bash
# First materialize the ignored local plugin projections:
bun scripts/package.ts

# Claude Code (dist/plugins is the one aidlc-plugins catalogue; the copy
# runtime's plugins/ folder is the same. A native install keeps it at
# <install root>/plugins, refreshed on install, update, use and rollback.)
/plugin marketplace add <repo-or-path>/dist/plugins   # native: <install root>/plugins
/plugin install aidlc-<name>@aidlc-plugins        # SessionStart hook composes on next session

# Codex CLI (in a git repo)
codex plugin marketplace add <repo-or-path>/dist/plugins   # native: <install root>/plugins
codex plugin add aidlc-<name>@aidlc-plugins       # approve the one-time hook trust

# Kiro (no store — folder-drop, then run the composer explicitly).
# The drop is one copy of the projection's .kiro folder; PLUGIN_ROOT is the
# plugin's folder it lands in (it carries hooks/compose.ts + the plugin content).
cp -r dist/plugins/<name>/kiro/.kiro <project>/
PLUGIN_ROOT="<project>/.kiro/aidlc-plugins/aidlc-<name>"
AIDLC_PLUGIN_ROOT="$PLUGIN_ROOT" AIDLC_PROJECT_DIR="<project>" \
  AIDLC_HARNESS_DIR=.kiro aidlc engine plugin sync
# fallback when aidlc is not installed:
AIDLC_PLUGIN_ROOT="$PLUGIN_ROOT" AIDLC_PROJECT_DIR="<project>" \
  AIDLC_HARNESS_DIR=.kiro bun "$PLUGIN_ROOT/hooks/compose.ts"
```

それから `/aidlc plugin list`（またはターミナルでは `aidlc engine plugin list`）と `/aidlc --doctor` が、インストール済みプラグインと合成したプラグインの版とソースハッシュを比べます。選択診断は doctor に残り、スコープ付き実行（`/aidlc --scope enterprise`）は、スコープが経路に置いたところへ有効プラグインステージをルーティングします。

**作業例 — 混成フリート横断の test-pro。** プラットフォームチームは `test-pro` を一度公開します（リポジトリを検証し、`aidlc-plugin-build.ts` で対応ハーネス投影を各々ビルドし、`aidlc-plugin-test.ts` で使い捨て導入候補に対して各投影をテストし、`<plugin>--v<version>` タグを押し、生成したマーケットプレイスメタデータを公開）。Claude チームは `/plugin install`。Codex チームは `codex plugin add`（信頼を一度承認）。Kiro チームは `git pull` + 上のように composer を明示実行。どの場合も composer は test-pro の新しいステージ 2 つ **と** `build-and-test` / `nfr-requirements` / `nfr-design` / `performance-validation` への寄与をマージします。同じ拡張された 35 ステージ（コア 33 と test-pro の 2）の構成となり、doctor にも合格します。ハーネス投影 7 すべて（Claude、Codex、Cursor、Kiro CLI、Kiro IDE、opencode、GitHub Copilot）で検証済みです。

**Status.** 実装し検証済み: `number` / `name` / `plugin` / `when` / `ars` のスキーマ支援（`aidlc-stage-schema.ts`）。ステージが書くコンポーザー事前値（`ars:` をノードへコンパイルし、提供事前値ファイルが指名しない slug について `aidlc-graph ars` が読む）。ソースの `plugin` 所有情報のコンパイル側持ち越し（コアはフィールドを省く）。`harness.json` + `select-plugins` 経由の導入時選択（ステージした再生成、共有トランザクションのコミット / ロールバック、監査検証、全グラフ永続、フィルタ済み実行時読み込み、閉包検査、ランナー刈り込み、doctor 行、compose advisory drop を含む）。有界 fail-loud 実行の選択認識 `tools/<plugin>-doctor.ts` 検査。スタンドアロンオフライン執筆ツール `aidlc-plugin-create.ts`、`aidlc-plugin-validate.ts`、`aidlc-plugin-build.ts`、`aidlc-plugin-test.ts`（決定論足場、同梱 compose フックテンプレート、マニフェスト導出ハーネス対象データ、正規寄与パス検証、プラグイン / ハーネス結び出力マーカー付き）。同じツールへ委ねるトップレベル `aidlc plugin validate|build` 経路。証拠付き Claude / Codex インベントリと Kiro 現行ルートフォールバック。決定論的合成スタンプ、インストール済みと合成済みの比較器全体、トランザクション集約 sync、所有安全な明示 prune。プラグイン名前空間のステージ / スコープランナー生成。共有パッケージャ / スタンドアロン emitter（発見したどのハーネス投影も）。プラグイン `stages/`、`scopes/`、`agents/`、`knowledge/`、`sensors/`、`tools/` の投影と no-clobber compose。ハーネス非依存 compose フック（`scripts/plugin-hooks-template/compose.ts`）。再利用 `tests/harness/plugin-kit.ts` のビルド、共有 compose サブプロセス / drop 読み、委譲内容検証、ライブ呼び出しヘルパ。`produces` / `consumes` / `sensors` / `scopes`（自プラグイン、入れたファイルガード付き） / `requires_stage`（順序ガード付き、compose、刷新、Cursor 再インストールで再検査） / `required_sections` + 散文フラグメント（内容ハッシュ、冪等、順決定論）の寄与の接続点。ガードは `tests/unit/t242-plugin-state.test.ts`（インベントリフィクスチャ、ハッシュ、比較器、ロールバック、prune）、`tests/integration/t188-plugin-compose.serial.test.ts`（compose 仕組み）、`tests/integration/t224-plugin-selection.test.ts`（選択）、`tests/integration/t300-plugin-kit.test.ts`（再利用キット）、`tests/integration/t327-plugin-author-routes.test.ts`（トップレベル執筆経路）、`tests/unit/t314-plugin-validate.test.ts`（オフラインバリデータ）、`tests/unit/t315-plugin-build.test.ts`（隔離バイト一致ビルダ）、`tests/unit/t316-plugin-test.test.ts`（隔離候補 compose 層）、`tests/unit/t317-plugin-create.test.ts`（隔離ツールチェーン全体足場）、`tests/unit/t313-plugin-doctor-checks.test.ts`（doctor ランナー）、`tests/unit/t354-plugin-dependencies.test.ts`（ベースを先に、保留の行、任意の順のフック）、各プラグイン自身の `tests/`（内容。統合層へ配線）。トップレベル `aidlc plugin create|test` 経路は RFC #723 のセクション 2e へ先送りのまま。`aidlc-plugin-test --dist` はサポートされない。**先送り / まだ配線していない:** プラグイン `memory/` サブツリーの投影 / マージと設定可能な `aidlc.contributes` ルーティング。`when:` 述語評価（解析するがエンジン消費者無し）。マージした `required_sections` の機械強制（フィールドはマージ + 検証するがコンパイル済みノードへ届かず、提供 required-sections センサーは期待をテンプレートから導く — 宣言節が欠けてもステージはまだ落ちない）。`after-questions` フラグメントアンカー（`locateAnchor` にケースが無い — "unknown anchor" を drop-log。`after-step:<n>` を使う）。どのロックファイルの読み（ベースプラグインの版はインストールされているものから読む。§8）。NEW slug の初回の番号割り当ては依存辺を考慮した処理です。最初のコンパイルは各フェーズの新しいステージのバッチを自分の `requires_stage` 辺で並べ（同順位は書いた `number:` ヒント、それから slug）、その順で次の空き連続索引を割り当てます。エンジンが番号値をすべて所有します（著者は主張しないので、調整していないプラグインは衝突できない）。複数ステージプラグインの部分 DAG はファイル名に関係なく流れ順で初期設定し、すでにピンした行は JSON 値を保ちます。書いた `name:` が新しい slug の表示名を初期設定します。

## 10. 不変条件

- **コアは不変。** どのプラグインも `core/` を決して直さない。
- **加算のみ。** 寄与は足す。上書きも削除もしない。
- **無効化すると不活性。** どのプラグインも無効にすると、ワークフローはコアだけの構成として走る。プラグインのステージとスコープはフィルタされ、マージした寄与は剥がされ、プラグインのファイルは再有効化のためにインストールされたまま残る。
- **composer は一つ、ホストが引き金。** 同じコードがどこで走っても合成する。中央で事前構築する成果物はコアだけの構成だけ。
- **プラグインはホストプラグインである。** パッケージャは本物の `.claude-plugin/` / `.codex-plugin/` / Copilot `.plugin/` / `.kiro-plugin/` / `.opencode-plugin/` / `.cursor-plugin/` マニフェストを出し、ホストのネイティブコマンドで入れる。AIDLC は配布インフラを走らせない。
- **slug 識別情報、表示専用番号。** プラグインステージを挿入してもコアは再番号付けしない。
- **信頼はホストネイティブ。** 組織制限はホストの管理許可リストを使う。AIDLC は信頼層を作らない。
- **ゲートキーピング無し。** ファーストパーティとサードパーティのプラグインは機械的に平等。違うのは出自だけ。

## Cross-references

- [Authoring a Plugin](../harness-engineering/10-authoring-a-plugin.md) — 著者向けの通し（フィクスチャを端から端まで作る）。
- [Stage Definition](15-stage-definition.md) — ステージ frontmatter 契約。`plugin` / `number` / `when` / `ars` を含む。
- [Artifact Vocabulary](16-artifact-vocabulary.md) — 論理名の名前空間。
- [Engine and Skill System](17-skill-system.md) — コンポーザーが送りオーケストレータがルーティングするコンパイル済みグラフ。
- 例設定文書（`marketplace.json`、`managed-settings.json`、`aidlc.lock.json`）は [`examples/test-pro/`](examples/test-pro/)。合成タイミングの証拠と順序付きビルド履歴はこのリポジトリの git ログに残しています。
