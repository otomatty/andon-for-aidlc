# エージェントシステム

この章では、エージェントの構成、設定、フレームワークとの接続、追加・変更方法を説明します。

利用者が見るエージェントの説明は [User Guide — Agents](../guide/06-agents.md) です。

---

## エージェントの構造

各エージェントのソースは `core/agents/` の直下の `.md` ファイルです。YAML frontmatter のあとに Markdown 本文。パッケージャはそれらのペルソナを各ハーネスのエージェント設定へ投影します。コンダクターは生成したファイルを読み、インラインの仕事または委譲実行を枠付けます。

### Frontmatter 契約

作成するコアエージェントファイルはどれも YAML frontmatter で始まります。次は同梱のアーキテクトエージェントのもので、`core/agents/aidlc-architect-agent.md` からの引用です。

```yaml
---
name: aidlc-architect-agent
display_name: Architect Agent
examples:
  - tech-stack.md
  - infrastructure-preferences.md
description: >
  Solutions architect responsible for domain design, contract design, NFR patterns, and component decomposition.
  Leads Feasibility, Domain Design, Units Generation, Contract Design, Functional Design, NFR Requirements, and NFR Design stages,
  and serves as the dispatched last link of the Reverse Engineering pipeline.
disallowedTools: Task
tier: judgment
---
```

| フィールド | 必須 | 説明 |
|-------|----------|-------------|
| `name` | はい | エージェント識別子。ファイル名と一致しなければならない |
| `display_name` | はい | ペルソナの人間向けの名前。ステータスラインに表示される。エージェントローダーは、`name` が無い場合と同じく、これが無い AI-DLC エージェントファイルを拒否する |
| `examples` | いいえ | エージェントのチームフォルダ向けに提案するナレッジファイル名。レビュアー 2 つとコンポーザーは持たない |
| `description` | はい | 役割の短い要約 |
| `tools` | いいえ | 任意の許可リスト。省略するとセッションのツール一式を継承する。列挙するとエージェントを狭め、`mcp__<server>__<tool>` id も列挙しない限り継承した MCP ツールは落ちる |
| `disallowedTools` | 作成するコアでは必須 | `Task` を含まなければならない — 委譲するのはコンダクターだけ。ハーネスが違うネイティブツール方針面を使うとき、パッケージャはこの Claude 方言キーを外すか翻訳する |
| `tier` | はい | `judgment`、`balanced`、または `templated`。**作成時に指定する**設定。パッケージャが各ハーネスのネイティブモデル / effort キーへ投影する（後述の Agent Tiers）。生の `model:` / `effort:` はソースの frontmatter に決して現れない — gitignore 対象のローカル `dist/<harness>/` 木とバージョン別のリリース実行時の投影 **出力** |

Kiro IDE はこのコア契約を違って投影します。`disallowedTools` を外し、`tools: ["read", "write", "shell"]` を足し、能力範囲の `permissions.rules` を足します。`tools:` から `subagent` を省くことが、IDE のネイティブ語彙で同じネスト委譲無しの制約を運びます。

### Markdown 本文の区画

frontmatter の下、Markdown 本文は次を定義します。

| 区画 | 目的 |
|---------|---------|
| **Core Responsibilities** | エージェントがすること |
| **Collaboration** | 受け取る相手 / 一緒に働く相手 / 渡す相手 |
| **Memory Focus** | 関係するとき参照するエージェント固有のメモリ話題 |
| **Key Principles** | エージェントの振る舞い指針 |

---

## 共有設定

作成する14 エージェント は共通の設定基準を共有します。Claude Code ではどれも `tools:` 許可リストを宣言しないので、どのエージェントも **セッションのツール一式** と供給された MCP ツールを継ぎ、同梱の拒否は `disallowedTools: Task` です。ほかのハーネスはその意図をネイティブ設定へ投影します。Kiro エージェント Markdown は `disallowedTools` を省き、Kiro CLI 委譲 JSON は `tools` から `subagent` を省き、Kiro IDE 委譲の `tools:` 付与も委譲を外します。

### Claude Code セッションのツール一式

どの Claude Code エージェントも組み込みツールを継承します。含むもの:

| ツール | 目的 |
|------|---------|
| Read | ファイルシステムからファイルを読む |
| Edit | ファイル内の正確な文字列置換 |
| Write | ファイルシステムへファイルを書く |
| Glob | 速いファイルパターン一致 |
| Grep | ripgrep による内容検索 |
| AskUserQuestion | 対話の利用者プロンプト（メインスレッドのステージのみ） |

### 共通で禁じる Claude Code ツール

| ツール | 理由 |
|------|--------|
| Task | エージェントは委譲された働き手として動きます。Task 呼び出しをするのは SKILL.md コンダクターだけです。Claude は `disallowedTools: Task` を強制し、ほかのハーネスはネイティブの拒否 / 許可リスト相当を使います。 |

### 各ペルソナが行使すると期待されるツール

Claude Code では、すべてのエージェントが継承により Bash と WebSearch を使えます。表は方法論がステージ仕事でそれらを使うと **期待する** ペルソナを記録し、エージェントごとの付与ではありません。Claude ペルソナを本当に制限するには、任意の `tools:` 許可リストを足します（`mcp__<server>__<tool>` id も列挙しない限り継承した MCP は落ちます）。

| ツール | 行使すると期待される対象 |
|------|---------------------|
| Bash | aidlc-aws-platform-agent、aidlc-devsecops-agent、aidlc-developer-agent、aidlc-quality-agent、aidlc-pipeline-deploy-agent、aidlc-operations-agent |
| WebSearch | aidlc-product-agent、aidlc-design-agent、aidlc-compliance-agent |

### エージェントティア

各エージェントのソースで指定する設定は `tier:` です。ペルソナがする仕事の **種類** を指名し、パッケージャ（`bun scripts/package.ts`）が各ハーネスのネイティブモデル / effort 形へ投影します。

| ティア | エージェント | 意味 |
|------|--------|---------|
| `judgment` | architect、aws-platform、compliance、composer、design、developer、devsecops、product、quality | 曖昧さの下の多制約推論。出力は下流へ波及。ダウングレードせず、セッションのモデルとeffortを継承する |
| `balanced` | architecture-reviewer、product-lead | レビュアー形の仕事 — 明示した基準に対する新しい入力。Claude CodeではSonnet・medium effort、Codexとopencodeではセッションモデルを継承しmedium effortを指定 |
| `templated` | delivery、operations、pipeline-deploy | 主にパターン追従の出力。方法論はすでにナレッジにある（デリバリー計画、CI/CD YAML、ランブック）。ティアは Writing up のモデルダイヤルグループのままだが、同梱基準はセッションのモデルと effort を継承する |

モデル方針が未記録の場合のハーネスごとの投影（`core/tools/aidlc-tiers.ts` が正本）:

| ティア | Claude Code（.md frontmatter） | Codex CLI（.toml） | Kiro CLI エージェント JSON / Kiro IDE `.md` | Kiro CLI cli.json `chat.modelDefaults` | opencode（.md frontmatter） | Copilot（.md frontmatter） | Cursor（.md frontmatter） |
|------|-------------------------------|-------------------|--------------------------------------|-------------------------------------|-----------------------------|-----------------------------|--------------------------|
| `judgment` | `model: inherit`、`effort:` 行無し | `model` / `model_reasoning_effort` キー無し（config.toml セッション既定が効く） | フィールド省略（スキーマフォールバック: 利用者の既定モデル） | ティア項目無し | `model:` / `variant:` キー無し（opencode.json セッション既定が効く） | 省略（セッションモデルを継承する） | `model:` 省略（セッションモデルを継承する） |
| `balanced` | `model: sonnet`、`effort: medium` | `model`は省略（セッションモデルを継承）、`model_reasoning_effort = "medium"` | フィールド省略（下記） | ティア項目無し | `model:`は省略（セッションモデルを継承）、`variant: medium` | 省略（セッションモデルを継承する） | `model:` 省略（下記） |
| `templated` | `model: inherit`、`effort:` 行無し | `model` / `model_reasoning_effort` キー無し（config.toml セッション既定が効く） | フィールド省略（下記） | ティア項目無し | `model:` / `variant:` キー無し（opencode.json セッション既定が効く） | 省略（セッションモデルを継承する） | `model:` 省略（下記） |

表の背後の要点:

- **省略が継承の仕組みです。** Claude Code では `effort:` キーが無いエージェント .md はセッション effort を継ぎ、ピンした `effort:` は両方向でセッションを上書きします（ピンは上限であり下限ではない）— モデル方針が未記録なら、省略が judgment と templated の既定です。Codex では `model` の無いロール TOML は、同梱の `.codex/config.toml` のセッション既定値で起動します（codex-cli 0.139.0 と 0.142.5 で実環境で検証。現行の doctor 推奨最小は、コンパクション直後のセッション再読み込みに対応するために 0.145.0）。Kiro ではエージェント v1 スキーマが無い `"model"` フォールバックを文書化します。「指定しなければ既定モデルを使う」（`/model` の残った好み）。
- **プリセットはティアとは別の、明示的なグループ effort 方針です。** ウィザード既定の `balanced` は Deciding・Reviewing・Writing up をすべて medium、`minimal` は前二者を medium、Writing up を low にします。`thorough` は Reviewing を xhigh、他をセッション継承にします。モデル ID は設定しません。エージェント単位の例外、グループ設定、出荷時のティア表の順で優先します。Kiro IDE、Cursor、Copilot ではグループ effort を表現できない旨を報告するので、ウィザードはそこではプリセットを記録しません。Kiro CLI ではプリセットは 1 つのセッション effort であり、セッションモデルとともに本人の個人用 Kiro 設定に保存されます（[セッションのモデルと effort](../guide/harnesses/kiro-cli.md#セッションのモデルと-effort)）。[モデル方針](../guide/18-install-and-lifecycle.md#モデル方針)も参照してください。
- **Kiro はモデルを決してピンしません。** 同梱の Kiro モデル ID は、そのモデルが利用者のインストールで有効なときだけ解決します。ほかのモデルで走るセッションはどの委譲起動も `Invalid model ID` で落とし、Kiro は Claude 方言のティア別名（`opus` / `sonnet`）を 明示的に拒否します — だからどの環境でも安全に固定できる値はありません。どの Kiro ティアもだから `"model"`（と `.md` frontmatter の `model:` 行）を省きます。全エージェントがセッションモデルを継承します。`TIER_PROJECTIONS` の kiro スロットと `kiroModelDefaults()` 仕組みは将来のために残しますが、現在は使いません。各インストールで解決可能な固定方法が導入された場合に備えたものです。本人がエージェントごとに行うピンは別物です。本人は自分のインストールが提供するモデルを指名します。kiro-ide の行では、`aidlc config models --agent` がそのエージェントの `.md` に `model:`（引用符付き文字列）と `effortLevel:` を書き込みます（`core/tools/aidlc-model-policy.ts` の `applyModelPolicyToProjection`）。v3 エンジン上の Kiro CLI と Kiro IDE は、委譲したエージェントを両方の値で実行します。
- **旧来の Kiro CLI の行にエージェントごとの effort 面はありません。** kiro-cli はエージェント JSON のどの effort 風キーでも fail-close するので、モデルごとの effort 既定は `settings/cli.json` の `chat.modelDefaults[<modelId>].output_config.effort` にしか乗れません。どのティアもモデルをピンしないので、同梱の `cli.json` は `chat.modelDefaults` を持ちません。プロジェクトのマップは本人の個人用マップを丸ごと置き換えてしまうため、セッションのモデルと effort は本人の個人用 Kiro 設定に置かれ、`aidlc config` が書き込みます（`core/tools/aidlc-kiro-session.ts` を参照）。そのファイルは CLI 専用です。Kiro IDE は cli.json を完全に無視し、拡張埋め込みのモデルごとの既定（または利用者の `/effort` セッション状態）を適用します。
- **Cursor もモデルを決してピンしません。** Cursor のモデル可用性はプラン依存です（Free アカウントは指名モデルを全部落とし、`Auto` しか走れない）。ピンしたエージェントモデルは下位プランのインストールを硬く失敗させます。どの Cursor ティアもだから `.md` frontmatter の `model:` 行を省きます（Cursor にエージェントごとの effort キーはありません。effort はモデル id 接尾辞に乗ります）。全エージェントがセッションモデルを継承します。`TIER_PROJECTIONS` の cursor スロットはモデルのみ、休眠です。プラン非依存のピン仕組みが現れたときのためです。

### ティアの上限（投影の上書き）

プロジェクトは、どのエージェントファイルも直さずに、パック時に低いティア投影を選べます。これは分類の上限であり、templated 基準が継承するようになってからは保証されたコスト上限ではありません。

- **残る設定:** スペースメモリ層ファイル（`core/memory/org.md` → `team.md` → `project.md`、最後の書き手が勝つ — プロジェクトは org 上限を下げても上げてもよい）の YAML frontmatter の `tier_cap:` キー。例: `tier_cap: balanced` はどのハーネスの投影でも `judgment` を測定したレビュアー基準へ写します。`templated` 上限は高いティアを継承する Writing up 投影へ写します。目標が明示の低コスト方針なら `aidlc config models` を使ってください。
- **起動ごとの上書き:** `AIDLC_TIER_CAP` 環境変数は、パッケージャ実行 1 回についてメモリ層に勝ちます（`AIDLC_TIER_CAP=templated bun scripts/package.ts`）。memory の上限 が効いているあいだ一度 UNCAPPED でビルドするには、最上ティアへセットします — `AIDLC_TIER_CAP=judgment` — メモリ層に勝ち、何も締めません（空値は未セットであり、uncapped ではありません）。

2 つの設定は範囲が違います。memory の上限 はリポジトリと一緒に共有されるので、write と `--check` の両方に効き、一時チェックビルド 2 つは同じリポジトリ定義の cap を使います。環境変数は一度きりの write 設定で、`--check` の下では無視されます。CI の迷った `AIDLC_TIER_CAP` が決定論の測定を変えてはいけません。パッケージャは無視したとき通知を印字し、cap 付きのどの write 実行でもアクティブな cap とソースを指名します。

代わりに **1 エージェント** の設定だけを変更するには、そのモデルと effort を例外として記録します: `aidlc config models --agent <name> --model <id> --effort <value> --project --yes`。config はそれを投影したエージェントファイルに書き込みます。そのファイルを手で編集すると `aidlc config models --check` がドリフトとして報告し、次の `aidlc config` が記録した値に戻します。

---

## エージェント比較マトリクス

次の 2 列の `Yes` は継承したツールの期待使用であり、アクセス付与ではありません。

| エージェント | Bash 期待使用 | WebSearch 期待使用 | ティア | リードステージ | 支援ステージ | 合計 |
|-------|-------------------|------------------------|------|-------------|----------------|-------|
| aidlc-product-agent | No | Yes | judgment | 5 | 3 | 8 |
| aidlc-design-agent | No | Yes | judgment | 2 | 2 | 4 |
| aidlc-delivery-agent | No | No | templated | 3 | 2 | 5 |
| aidlc-architect-agent | No | No | judgment | 7 | 3 | 10 |
| aidlc-aws-platform-agent | Yes | No | judgment | 2 | 5 | 7 |
| aidlc-compliance-agent | No | Yes | judgment | 0 | 4 | 4 |
| aidlc-devsecops-agent | Yes | No | judgment | 0 | 5 | 5 |
| aidlc-developer-agent | Yes | No | judgment | 2 | 4 | 6 |
| aidlc-quality-agent | Yes | No | judgment | 2 | 3 | 5 |
| aidlc-pipeline-deploy-agent | Yes | No | templated | 4 | 0 | 4 |
| aidlc-operations-agent | Yes | No | templated | 3 | 0 | 3 |

**観察:**
- aidlc-architect-agent が最も多くのステージに関与します（3 フェーズ横断で 10 ステージ）。
- 14 エージェント 全体では、9 が `judgment` ティア、3 が継承する `templated` ティア、`balanced` レビュアー 2 つだけが Claude Code、Codex、opencode で下がります。Kiro、Cursor、Copilot では全ティアがセッションのモデルと effort を継承します。上のマトリクスは領域の専門家 11 をカバーします。
- aidlc-compliance-agent は純粋に助言として動きます（支援 4、リードステージ無し）。
- 11 のうち 6 が CLI やりとりに Bash を使うと期待されます。
- 3 エージェントが調査タスクに WebSearch を使うと期待されます。

---

## フェーズ参加

| エージェント | Init (0) | Ideation (1) | Inception (2) | Construction (3) | Operation (4) |
|-------|----------|--------------|---------------|-------------------|---------------|
| aidlc-product-agent | -- | L（intent-capture、market-research、scope-definition）、S（rough-mockups、approval-handoff） | L（requirements-analysis、user-stories）、S（refined-mockups） | -- | -- |
| aidlc-design-agent | -- | L（rough-mockups） | L（refined-mockups）、S（user-stories、domain-design） | -- | -- |
| aidlc-delivery-agent | -- | L（team-formation、approval-handoff）、S（scope-definition） | L（delivery-planning）、S（units-generation） | -- | -- |
| aidlc-architect-agent | -- | L（feasibility）、S（intent-capture） | L（domain-design、units-generation、contract-design）、S（reverse-engineering、delivery-planning） | L（functional-design、nfr-requirements、nfr-design） | -- |
| aidlc-aws-platform-agent | -- | S（feasibility） | S（domain-design、contract-design） | L（infrastructure-design）、S（nfr-design） | L（environment-provisioning）、S（feedback-optimization） |
| aidlc-compliance-agent | -- | S（feasibility） | -- | S（nfr-requirements、infrastructure-design） | S（environment-provisioning） |
| aidlc-devsecops-agent | -- | -- | S（practices-discovery） | S（nfr-requirements、infrastructure-design、build-and-test） | S（environment-provisioning） |
| aidlc-developer-agent | -- | -- | L（reverse-engineering）、S（practices-discovery、user-stories） | L（code-generation）、S（functional-design） | S（deployment-execution） |
| aidlc-quality-agent | -- | -- | S（practices-discovery、user-stories） | L（build-and-test）、S（nfr-requirements） | L（performance-validation） |
| aidlc-pipeline-deploy-agent | -- | -- | L（practices-discovery） | L（ci-pipeline） | L（deployment-pipeline、deployment-execution） |
| aidlc-operations-agent | -- | -- | -- | -- | L（observability-setup、incident-response、feedback-optimization） |

L = Lead、S = Support

---

## エージェントの足し方

エージェントの表示名と例ナレッジファイルは、各エージェントの `.md` frontmatter の `display_name` と `examples` フィールドが正本です。TypeScript の編集は要りません。レシピ全体（必須 frontmatter フィールド、検証手順、自動検査の対象）は [Contributing: Adding an Agent](11-contributing.md#エージェントの追加) です。手順の短い要約:

1. 必須 frontmatter で `core/agents/{name}-agent.md` を作る: `name`、`display_name`、`description`、`disallowedTools`（`Task` を含む）、`tier`。エージェントに提案するナレッジファイルがあれば `examples` も加える。コア frontmatter に生の `model:` / `effort:` を書いてはいけない — それらは投影出力です（上の Agent Tiers）。任意の `tools:` 許可リストは継承したツール一式を狭めます。省略するとセッションのツール一式を継承します。`core/tools/aidlc-lib.ts` の `loadAgents()` は次の起動でファイルを発見します。
   インストール先のエージェントディレクトリ（`.claude/agents/`、`.kiro/agents/`、`.cursor/agents/` など）はホストと共有され、ホストもそこから自身のサブエージェントを読みます。`loadAgents()` は、ファイル名が `aidlc-` で始まるか、frontmatter に `display_name`、`examples`、`tier`、`plugin` のいずれかを持つファイルを AI-DLC のペルソナとして扱い、そうしたファイルには `name` と `display_name` を必須とします。それ以外のファイルはホストのものです。AI-DLC はそれを読み込まず、ステージの `lead_agent` に指名できず、ディスパッチされたときにもステージのルールを付けません。`aidlc doctor --verbose` はそれらのファイルを助言として一覧します。
2. ナレッジファイルを `core/knowledge/{name}-agent/` に足す
3. 参加するステージファイル（`core/aidlc-common/stages/`）へエージェントを足す — 各ステージの frontmatter で `lead_agent` / `support_agents` をセット。コンパイル済み `tools/data/stage-graph.json` はその frontmatter から `bun scripts/package.ts` が **生成** します。生成出力を手で直さないでください。
4. `bun scripts/package.ts` でgitignore 対象のローカル配布物を実体化し、`--check` を走らせて二度ビルドし決定論的出力を検証する
5. 手で保つナレッジ表へエージェントと例の行を足す（エージェントのチームナレッジフォルダは `aidlc/spaces/<space>/knowledge/{name}-agent/`。チームが中身を持つときに作る。エンジンは足場を作らない）
6. テストを更新する: ファイル存在のスモークテスト、ステージ・エージェント相互参照の機能テスト
7. このファイルと [reference/agents/](agents/) の文書を更新する

## エージェントの直し方

- **ツールを変える**: frontmatter の `tools:` 許可リストを足すまたは直してエージェントを狭める。省略するとセッションのツール一式を継承する。`tools:` 一覧は、`mcp__<server>__<tool>` id も列挙しない限り継承した MCP ツールを落とします。
- **ティアを変える**: `tier:` を `judgment`、`balanced`、または `templated` に直し、再生成（`bun scripts/package.ts`）。インストール先プロジェクトの **1 エージェント** に特定モデルを強制するには、代わりに `aidlc config models --agent <name> --model <id> --project --yes` を実行します（Claude Code は別名、完全 id、`inherit` を受け入れます）。投影したエージェントファイルへの手編集は、次の `aidlc config` で元に戻されます。
- **振る舞いを変える**: Markdown 本文の区画（責任、原則）を直す。
- **ステージ割り当てを変える**: 関係するステージファイル（`core/aidlc-common/stages/`）の `lead_agent` / `support_agents` を直し、`bun scripts/package.ts` で再生成する — コンパイル済みステージグラフはステージ frontmatter から導かれ、手では直しません。

---

## 関連

- [Architecture](01-architecture.md) — エージェント層を含む 5 層モデル
- [Knowledge System](10-knowledge-system.md) — ナレッジの読み込み順
- [Agents Technical Reference](agents/) — エージェントごとの技術詳細
- [Stage Protocol](04-stage-protocol.md) — エージェントペルソナの読み込み規則
