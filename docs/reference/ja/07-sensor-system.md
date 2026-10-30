# センサーシステム

この章の具体的な `dist/claude/` パスは、`bun scripts/package.ts` が実体化するgitignore 対象のローカル生成物を指します。インストール先プロジェクトは `.claude/` の下の同じ相対パスを使います。

> 読者: Tier 2/3（チームで入れる人、フレームワークの貢献者）。

この章は AI-DLC センサーマニフェストの **スキーマリファレンス** です。ステージの出力への書き込みで発火する決定論的な検査です。センサーは制御ループのフィードバック側、ルールはフィードフォワード側です（次の章 [Rule System](08-rule-system.md)）。[Plane Architecture](02-plane-architecture.md) は両方を、コンパイルが各ステージノードへ解決するコントロールプレーン入力として枠付けます。

この章はマニフェストの *ファイル形式* をカバーします。センサーマニフェストの内容、ステージがセンサーを取り込む仕方、同梱の 6 つのマニフェストの設定。ワークフロー中にセンサーがどう発火するかの利用者向けの説明は、User Guide の [Rules and the Learning Loop](../guide/09-rules-and-the-learning-loop.md) です。

> **パスの慣例。** 以下の `<record>/` = アクティブなインテントのレコードディレクトリ、`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`（コンパクトな UTC 日付接頭辞 + 短い kebab-case ラベル。レコードディレクトリが時系列で並ぶ。正準 id は `intents.json` レジストリ行に保存した UUIDv7）。文書形センサー 2 つの同梱マニフェストの `matches` glob は、まだレガシーの成果物木パスを運びます（スキーマを文書化する箇所でそのまま引用）。

実行時の振る舞いは [Stage Protocol](04-stage-protocol.md) です。ステージ定義のファイル形式に関する対応する説明は [Stage Definition](15-stage-definition.md) です。

---

## マニフェストの場所とファイル名

センサーマニフェストは次に配置します。

```
dist/claude/.claude/sensors/aidlc-<id>.md
```

フレームワーク同梱のマニフェストはどれも `aidlc-` ファイル名接頭辞を運びます（より広いフレームワークファイル慣習に合わせる）。frontmatter の `id:` フィールドは、`aidlc-` 接頭辞を外し `.md` 接尾辞を剥いだファイル名ステムと一致しなければなりません。

| ファイル名 | 必須の `id:` |
|---|---|
| `aidlc-required-sections.md` | `required-sections` |
| `aidlc-linter.md` | `linter` |

ファイル名と id の規則は `tests/unit/t86-sensor-manifest-schema.test.ts` が強制します。`aidlc-` 接頭辞は **カスタムの利用者が提供するものも含め、どのセンサーにも必須** です。コンパイルリゾルバは `SENSOR_FILE_REGEX = /^aidlc-([a-z][a-z0-9-]*)\.md$/`（`aidlc-graph.ts` の `loadSensors`）でマニフェストを発見するので、接頭辞が無いファイルは黙って飛ばされ、ステージに決して結びません。カスタムセンサーは `aidlc-<id>.md` と名付け、`id: <id>` をセットします。

---

## センサーマニフェストのスキーマ

どのマニフェストも YAML frontmatter と本文付きの Markdown です。frontmatter は構造契約 — 純粋な能力記述子 — で、本文は検査を説明する文章です。マニフェストは *センサーが何か* を言い、どのステージが使うかは言いません。関係はステージ側にあり、ステージの frontmatter `sensors:` フィールド経由です（後述の [ステージがセンサーを取り込む仕方](#ステージがセンサーを取り込む仕方)）。

同梱の `required-sections` マニフェストです（ネイティブインストールにあるとおり）。

```markdown
---
id: required-sections
kind: deterministic
command: aidlc engine sensor-required-sections
default_severity: advisory
fire_on: gate
description: Checks at the gate that stage output contains the required H2 headings
category: document-shape
matches: "**/{aidlc-docs,intents,codekb}/**"
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  h2_count: integer
  headings: string[]
  findings_count: integer
  edge_block: string
  template: string
  template_expected: string[]
  template_missing: string[]
  config_warning: string
  message: string
timeout_seconds: 300
---

# required-sections sensor

With no template for the output, no heading is required: the stage's prose
shapes the file, so the check passes and still reports the output's `##`
headings. When a template applies (below), its `##` headings are required.
```

フィールドの行にコメントを書かないでください。パーサはトップレベルのフィールドの値のあとにある `# ...` を値の一部として読むので、`id: demo-check   # required` は id を `demo-check   # required` にしてしまい、マニフェストの読み込みが失敗します。エンジンはマニフェストをどう読むかを表示できます。次は同梱の `linter` です。

```text
$ aidlc engine sensor describe linter
id: linter
kind: deterministic
command: aidlc engine sensor-linter
default_severity: advisory
description: Wraps the project's configured linter (eslint by default for v0.5.0); fires on TS/JS code outputs
category: code-quality
matches: **/*.{ts,js}
timeout_seconds: 1200
path: .claude/sensors/aidlc-linter.md
```

| フィールド | 必須 | 型 | 注 |
|---|---|---|---|
| `id` | はい | kebab-case 文字列 | `aidlc-` 接頭辞を外したファイル名ステム。ルールファイルの `pairing:` フィールドから相互参照（[Rule System](08-rule-system.md)） |
| `kind` | はい | enum | 現在受け入れるのは `deterministic` のみ。それ以外の値はパース時に拒まれる。[`kind` enum](#kind-enum) |
| `command` | はい | 文字列 | 正準起動接頭辞。同梱センサーは `aidlc engine sensor-required-sections` のようなネイティブ委譲を使う。カスタムセンサーは `bun .claude/tools/aidlc-sensor-<id>.ts` のように自分の TypeScript ワーカーを指名する。ディスパッチャは `.ts` のファイル名（または `sensor-<id>` 委譲）を取り、インストール済みの tools フォルダからそのファイルを実行する。ネイティブインストールでは、ファイル名は `aidlc-sensor-<id>.ts` で、`export function main(argv)` しなければならない。センサーディスパッチャは `--stage <slug>` に加え、`input_schema` が選ぶパスフラグを足す。`file_path` を宣言していれば `--file-path <path>`、そうでなければ `--output-path <path>`。[`command:` 起動契約](#command-起動契約) |
| `default_severity` | はい | enum | `advisory` または `blocking`。blocking の強制は `fire_on: gate`。write 発火の blocking 宣言はこのリリースでは advisory のまま |
| `description` | はい | 文字列 | 人間向けの 1 行の説明 |
| `category` | 任意 | 文字列 | 自由形式の説明ラベル（同梱マニフェストは `document-provenance`、`document-shape`、`code-quality` を使う。閉じた enum ではない） |
| `fire_on` | 任意 | enum | `write` または `gate`。既定は `write` |
| `matches` | 任意 | glob 文字列 | ディスパッチ時に消費する能力フィルタ。[`matches` filter](#matches-フィルタ) |
| `input_schema` | 任意 | オブジェクト | 起動契約。ブロックマッピングまたは 1 行のフローマッピングで書く。ディスパッチャはそのキーを読んでパスフラグを選ぶ。`file_path` を宣言すると `--file-path`、ほかのキーなら `--output-path`。キーを宣言しないマニフェストは同梱時のルーティングのまま（`--file-path` は `linter` と `type-check` だけ）。値は型のヒントで、まだ何も読まない。将来の LLM ディスパッチがテンプレート契約として使う。一部の同梱センサーが受け取る追加フラグ（`--consumes`、`--deliverables`、テンプレートのフラグ）は、これらのキーではなく今もセンサー id で選ぶ |
| `output_schema` | 任意 | オブジェクト | 現在は advisory。将来の LLM ディスパッチがパース契約として使う |
| `timeout_seconds` | 任意 | int | 発火ごとの実経過時間の上限。省略時は 1,200 秒 |

---

## `kind` enum

`kind` フィールドはディスパッチ仕組みを宣言します。スキーマが現在受け付ける値は 1 つだけです。

- `deterministic` - ディスパッチャは発火ごとのフラグを付けてマニフェストのワーカーを実行する。ワーカーは真偽値の `pass`（加えて `findings` と、監査行が記録する数である `findings_count`）を持つ JSON を stdout に 1 行印字し、検査の合否にかかわらず終了 0 する。失敗の詳細ファイルはディスパッチャが書く。終了 127 は `tool-unavailable` 注付きの合格として記録される。起動できないワーカー、それ以外の非ゼロ終了、または真偽値の `pass` が無い出力は、`script-error` 注付きの `SENSOR_COULD_NOT_RUN` として記録され、合格としては決して記録されない（ゲートが何を言うか、blocking のゲート結びがそれをどう扱うかは [`default_severity`](#default_severity) を参照）。

`llm` を含め、ほかの `kind` はパース時に拒まれます（「other kinds reserved for future releases」）。

`kind` の未知の値（`deterministic` 以外）はパース時に落とされます。前方互換は *未知キー* に効きます（[Forward-compat policy](#前方互換方針)）。既知キーの未知値には効きません。

---

<a id="how-stages-import-sensors"></a>

## ステージがセンサーを取り込む仕方

ステージ側からの取り込み: 各ステージの frontmatter が使うセンサーを宣言します。コンパイルリゾルバは宣言した各 id をマニフェストレジストリで引き、コンパイル済みグラフノードへ `sensors_applicable` 配列を焼き込みます。執筆の向きは参照の局所性です。ステージファイルを開くと、ステージが実行されるときどの検査が発火するかが正確に見えます。

```yaml
# dist/claude/.claude/aidlc-common/stages/construction/ci-pipeline.md
---
slug: ci-pipeline
phase: construction
# ...
requires_stage: [...]
sensors:
  - required-sections
  - upstream-coverage
  - linter
  - type-check
inputs: ...
outputs: ...
---
```

`sensors:` は裸の id の一覧です。id は各マニフェストの frontmatter `id:` フィールドと一致し、それは（ファイル名↔id 契約どおり）`aidlc-` 接頭辞を外したファイル名ステムです。コンパイルリゾルバは:

1. `dist/claude/.claude/sensors/` を歩き、どの `aidlc-<id>.md` マニフェストもパースする。
2. 解決時の O(1) 参照のためにマニフェストを id で索引する。
3. 各ステージについて、宣言した取り込み id をそれぞれ引き、未知なら投げる（実行時に黙って無視せず、コンパイル時に明示的に失敗）。
4. `fire_on`、`default_severity`、`category`、`matches` を解決した `sensors_applicable[]` 項目へコピーする。
5. ステージごとの解決配列を正準 `data/stage-graph.json` へ出す（FIELD_ORDER ピン: `rules_in_context` のあと）。

実行時の PostToolUse フック、`gate-start`、`revise` は、何が発火するかを決めるためにグラフノードから `sensors_applicable` を読みます。どれもそのためにマニフェストを開き直しません。ディスパッチャが発火のたびにマニフェストを読み直すのは、`command`、`input_schema`、`timeout_seconds` と、パスに対する自身の `matches` の再検査のためだけです。グラフがコピーしたもの（`fire_on`、`default_severity`、`category`、フックの `matches` フィルタ）と新しい取り込みは、次のコンパイルを待ちます。ネイティブインストールでは、同梱の 6 つのセンサーは id で同梱ワーカーを実行するので、その `command` を編集しても何も変わりません。センサーを編集したら必ず再コンパイルしてください。

### ステージごとのセンサーマトリクス（フレームワーク33 ステージ）

| ステージ | `sensors:` |
|---|---|
| 初期化 3（workspace-scaffold、workspace-detection、state-init） | `[]`（決定論のセットアップ、エージェントが書いた markdown 無し） |
| `intent-capture` | `[claim-sources, required-sections, upstream-coverage]`（`claim-sources` は見えるインライン出自、正本のソース登録値、人の明示確認した仮定をステージの成果物横断で検査） |
| ほかの ideation 6、ほかの inception 6、operation markdown 7 | `[required-sections, upstream-coverage]` |
| `user-stories`、`domain-design`、`units-generation` | `[required-sections, upstream-coverage, traceability]` |
| `build-and-test` | `[required-sections, upstream-coverage, type-check]`（linter は意図して省略 — ビルドが正準 lint を走る） |
| `ci-pipeline` | `[required-sections, upstream-coverage, linter, type-check]` |
| Unit ごとの construction 設計 4（`functional-design`、`infrastructure-design`、`nfr-design`、`nfr-requirements`） | `[required-sections, upstream-coverage, linter, type-check, traceability]` |
| `code-generation` | `[required-sections, traceability]`（`linter` と `type-check` は取り込まない。どのファイル書き込みでも走っていたのに、その結果を読むものが無かったため） |

`traceability` はゲートで（`fire_on: gate`）、各ステージの完成した表に対して走ります。Requirements Analysis は自身の `traceability.json` 用の検査を取り込みません。そこには `requirements.md` が定義する FR と NFR の ID を書かれたとおりに記録し（`ids`。それぞれ `kind` と、下位要件なら `of` を持つ）、以降のどの検査もそこから ID を取ります。記録が欠けているか正確でない場合、各表の要件は、記録以前と同じく、表が列挙するものに、FR と NFR のパターンが `requirements.md` に見つける ID を加えたものになります。後続のステージは `engine sensor-traceability --stage <slug> --output-path <table> --write-upstream` で表を始めます。これは検査が求める上流 ID をすべて、それぞれ `GAP` 行付きで足し、欠けているものが無ければ何も書きません。

フォークはステージの `sensors:` 一覧を直接直してステージを寄せます。結びは寄せるものの隣にあります。マニフェストは純粋な能力記述子です。ステージ指定のフィールドは持ちません（`applies_to:` は無し — ステージ側からの取り込みが外しました）。厳格加算のランタイムが効きます。フォークがステージにセンサーを欲しいなら取り込み、欲しくないなら省略します。推論する上書き層はありません。

---

<a id="matches-filter"></a>

## `matches` フィルタ

`matches` はマニフェスト上の任意のトップレベル能力記述子です。センサーが分析できるファイルの glob 形を宣言します — *「このセンサーはこの glob に一致するファイルを分析する」* — コンパイル時のリゾルバではなく、ディスパッチ時に消費されます。

| マニフェスト | `matches` |
|---|---|
| `aidlc-claim-sources.md` | `**/{aidlc-docs,intents}/**` |
| `aidlc-required-sections.md` | `**/{aidlc-docs,intents,codekb}/**` |
| `aidlc-upstream-coverage.md` | `**/{aidlc-docs,intents,codekb}/**` |
| `aidlc-traceability.md` | `**/traceability.json` |
| `aidlc-linter.md` | `**/*.{ts,js}` |
| `aidlc-type-check.md` | `**/*.{ts,tsx}` |

`fire_on: write` では、`matches` は発火フィルタです。フックは書かれているパスを glob と比べ、glob が無い項目は決して発火しません。`fire_on: gate` では、`gate-start` と `revise` が存在する宣言済み成果物を全部列挙し、各センサーの `matches` 能力の外のパスを飛ばし、一致するパスだけをディスパッチします。省略した glob はどの成果物も受け入れます。ステージの出力全体を読む `upstream-coverage` と `claim-sources` は、出力フォルダごとに一度、質問ファイルでもタイムスタンプファイルでもない最初の成果物でディスパッチします。コードナレッジベースのステージ（Reverse Engineering）では、`required-sections` と `upstream-coverage`（`PATH_SET_SENSOR_IDS`、`aidlc-graph.ts`）はステージに対して一度ディスパッチします。発火は最初に一致したパスを名指しし、一致するすべてのパスを `--paths-stdin json` のあとに stdin で受け取り、センサーは各ファイル（またはフォルダ）を単独のときと同じように評価し、失敗した発火の `SENSOR_FAILED` 行は失敗したファイルを `Failed outputs` フィールドに列挙し、ゲートの検査行はそれを読んで `<repo>/<file>` を名指しします。blocking の結びは、発火が対象とするすべてのパスを、発火前にフィンガープリントを取ったバイトに保ちます。1 ファイルに対する呼び出しは stdin を決して読みません。Construction の自律モードでエンジンが自ら承認するゲートは、blocking のセンサーだけをディスパッチします（そこには advisory の証跡を読む人がいないため）。同梱 6 つはどれも glob を宣言します。コンパイルリゾルバはそれを `sensors_applicable[]` へコピーします。

空文字列（`matches: ""`）はパース時に捨てられるので、glob を省略したのと同じに働きます。write 発火のセンサーは glob を宣言すべきです。gate 発火のセンサーは、宣言済み成果物全部を分析するために省略してよいです。

### ルールとセンサーの相互参照

ルールファイルはセンサーへフィードフォワードするために `pairing: aidlc-required-sections`（`aidlc-` 接頭辞付き）を使います。センサーマニフェストの `id:` は `required-sections`（接頭辞無し）です。doctor のカバレッジ検査は、マニフェスト `id` と合わせる前にルールの `pairing:` 値から `aidlc-` 接頭辞を剥いで正規化します。

---

## `default_severity`

`advisory` の結果は監査行を出しますが、ステージゲートを止めません。ゲートの前に、advisory のゲート検査は、ステージの文書が引き渡されるときに一度走ります（`aidlc-state.ts` の `completionChecksStep`）。引き渡しとは、レビュー依頼（`aidlc-log.ts review`。状態ツールの `completion-checks` コマンドを通じ、これは `{"held":false}` または `{"held":true,"message":...}` を印字する）、または試行の中でレビューが求められなかった場合は、ゲートを開くか改訂後に再表示する報告です。試行の最初のそうした引き渡し（`reviewAttemptWindow` が読む下限）は、必須の出力がすべて存在した時点で、スコープの宣言済み出力（1 つの Unit のもの。行に `Unit` が付く）に対して advisory の検査を発火します。ただし、その（検査、出力）の組のどれにも下限以降の `SENSOR_FIRED` 行が無い場合です（パスは正準形で比べる）。発火が所見を報告すると、引き渡しは何も記録せず、`print` を返します。そこには各所見に対するゲート自身の文、詳細ファイル、同じコマンドが入ります。注付きの合格は何も止めません。その人が求めたレビュー（`--person-asked`）、`--retry-pending` または `--single` の依頼、その人の Override の選択、スウォームワーカーのチェックアウト、エンジンが自ら承認するゲートは止められません。ゲートが開くか再表示されるとき、オーケストレータの応答は、その `narration` の中で、ステージが作ったものの後の行に、宣言済み出力での最新の結果が失敗である検査ごとに 1 文を運びます（`aidlc-state.ts` の `failedCheckNotices`。最大 3 文と件数）。エージェントはそれを承認の質問とともにその人へ伝えます。変更の行は、変わったものを示すままです。続いて 1 行で、件数にかかわらず、走れなかった検査（スクリプトがクラッシュしたか起動しなかった）を名指しします。対象は宣言済み出力か、ステージが書いてまだ残っているファイル（`type-check` のような write 発火の検査）です。走れなかった検査や、注付きで記録された合格（ツール利用不可）は何も評価しておらず、以前の失敗を消しません。Unit 自身のゲートは、その Unit の出力と書き込みだけを名指しします。センサーがオフのときは何も言われません。`blocking` のゲートに結び付いたセンサーは、検証済みの合格でのみ進みます。報告された所見、ディスパッチャの終了 / 起動 / タイムアウト失敗、壊れたまたは不一致の判定、`SENSOR_BUDGET_OVERRIDE`、`SENSOR_COULD_NOT_RUN`、注を運ぶ `SENSOR_PASSED` 行は、ゲートが開く前に `gate-start`、`revise`、または承認時の回復した改訂再入場を止めます。

運用者は所見を直して再試行するか、別の明示オーバーライド判断ができます。コンダクターは `Fix findings,Override blocking sensors` を出す `DECISION_RECORDED` を記録し、新しい人のターンを待ち、正確な `QUESTION_ANSWERED` を記録し、それから `--override-blocking-sensors --user-input "Override blocking sensors"` でゲート報告を再試行します。その選択が有効な間（それ以降ステージで何も尋ねられず、答えられず、差し戻されず、ゲートがまだ開いていない間）、`next` はステージの代わりに同じ報告を名指しします。自律モード、チームの Unit ゲート、単独のウォークが先に済ませるべき Unit の手順は除きます。裸のフラグ、出していない / 言い換えた選択、人間の応答に裏付けられたレシートが無いこと、自律モードは拒まれます。記録された回答は、その選択肢をラベルか、提示した一覧での番号で名指しします。Fix findings は Request Changes と同じように新しい試行を始めます。レビューされた出力は修正のために開かれ、再試行する報告には新しいレビューが要ります。各 Unit のレビューがそれぞれ独立している場合（unit-major の作業、Construction のチェックポイント、チーム所有の Unit）、それは Unit 付きで記録された選択ならその Unit、そうでなければ、失敗した blocking の検査が最新の結果で出力を名指しした Unit だけです。どの Unit の出力も名指ししなかった検査や、stage-major の作業では、すべての Unit がやり直しになります。成功したオーバーライドはセンサー id、任意の詳細パス、評価理由を `STAGE_AWAITING_APPROVAL` に記録します。すでに開いたゲートの再検証は `Revalidated: true` の新しい行を出し、認可レシートを再利用可能のまま残さず消費します。このリリースでは、write 発火のセンサーは `blocking` を宣言できますが、PostToolUse ディスパッチは advisory のままです。

---

## `fire_on`

`write` が既定で、増分の PostToolUse フィードバックを保ちます。`gate` は、`gate-start` が最初のゲートを開く直前、改訂仕事のあと `revise` がゲートに再入場する前、承認時の改訂バックストップが回復した再入場をする前に、存在する宣言済み成果物ごとに一度（`upstream-coverage` と `claim-sources` は出力フォルダごとに一度、Reverse Engineering での `required-sections` と `upstream-coverage` はステージに対して一度）発火します。誰もゲートに答えないとき（Construction の自律モードでエンジンが自ら承認するとき）は、blocking のセンサーだけが発火します。そこには advisory の証跡を読む人がいないためです。ディスパッチは状態トランザクションの外です。`aidlc-sensor.ts fire` が `SENSOR_FIRED` と終端行の両方の周りで監査ロックを取るからです。blocking ディスパッチは評価前に一致する各成果物をフィンガープリントし、各センサーのあとそれを検査し、状態トランザクション内でもう一度検査します。変わったバイトはゲート入場を拒み、再試行で評価しなければなりません。

ディスパッチャは終端行のあとコンパクトな JSON 判定を 1 つ印字します。`fire_id`、`sensor_id`、`stage`、`output_path`、`result`、`detail_path`、任意の `note`。ゲート強制は判定の識別情報を検証し、注無しの `passed` 結果以外を、blocking 結びの不合格として扱います。明示の `--artifacts` パスと発見した成果物は正準に解決され、ステージの正準 produce ディレクトリ内に残らなければなりません。絶対パス、走査、シンボリックリンク脱出はセンサーをリダイレクトできません。

`failed` 結果は、その所見を `detail_path` に書きます。これはステージのセンサーディレクトリの下に新しく作る `<sensor-id>-<fire-id>.md` ファイルです。あとの注無しの `passed` 結果は、同じ出力についてのそのセンサーの以前のレポートだけを消します。ステージのほかの出力のレポートはそのまま残ります。あとの結果が注付きの合格や予算オーバーライドの場合も、何も評価していないのでレポートは残ります。以前の `SENSOR_FAILED` 行は、削除後も `Detail path` を保ちます。記録はファイルではなく監査行です。

---

## `command:` 起動契約

マニフェストの `command:` は **正準起動接頭辞** であり、完全な argv ではありません。同梱センサーはそれぞれ自分のセンサーごとのスクリプトを指名します。ディスパッチャ（`aidlc-sensor.ts`）は発火時に実行時文脈を足します。いつも `--stage <stage-slug>`、それからマニフェストの `input_schema` が宣言するファイルフラグです。コードセンサーは `file_path` を宣言して `--file-path <file>` を受け取り、文書センサーはほかのキー（`output_path`、`stage_slug`）を宣言して `--output-path <file>` を受け取ります:

```
<command> --stage <stage-slug> --output-path <file-being-written>   # document sensor
<command> --stage <stage-slug> --file-path   <file-being-written>   # code sensor
```

`input_schema` のキーを宣言しないマニフェストは元のルーティングのままで、`--file-path` を受け取るのは `linter` と `type-check` だけです。したがって、フォークやプラグインが追加するコードセンサーはこのキーを宣言しなければなりません。宣言しないと、そのスクリプトは `--output-path` を受け取ります:

```yaml
input_schema:
  file_path: string
```

だから次のマニフェスト:

```yaml
command: aidlc engine sensor-required-sections
```

は、少なくとも `--stage <slug> --output-path <file>` を足してディスパッチされます（加えて、`required-sections` が id によって受け取るテンプレートのフラグ）。H2 見出しが 1 つだけのインテントステートメントに対して手で発火すると:

```text
$ aidlc engine sensor fire required-sections --stage intent-capture --output-path aidlc/spaces/default/intents/261013-tagged-notes/ideation/intent-capture/intent-statement.md
{"fire_id":"f00255f3","sensor_id":"required-sections","stage":"intent-capture","output_path":"aidlc/spaces/default/intents/261013-tagged-notes/ideation/intent-capture/intent-statement.md","result":"failed","detail_path":"aidlc/spaces/default/intents/261013-tagged-notes/.aidlc-engine/sensors/intent-capture/required-sections-f00255f3.md"}
```

詳細ファイルの所見です（その JSON ブロックを、フェンスを外して示しています）。

```text
## Findings

{
  "pass": false,
  "h2_count": 1,
  "headings": [
    "## Problem Statement"
  ],
  "findings_count": 1
}
```

マニフェストは発火ごとのフラグを符号化しません。ディスパッチャが足します。マニフェストは純粋な能力記述子のままです。

---

## ゲート儀式の引き渡し（surface stdout / selections-file in）

§13 ラーニングゲートはツールが処理を担当します。決定論ツール（`aidlc-learnings.ts`）とコンダクター（実行中の `/aidlc` セッション）の往復は 2 段階で、あいだにナレッジ手順と判断手順があります。

1. **`surface`（stdout）。** コンダクターがこれを走らせるのは、その人がステージの中でコンダクターを訂正したか、次回のために何かを残すよう求めたときだけです（それを読み取るのはコンダクターのナレッジです）。`aidlc engine learnings surface --slug <stage-slug> --correction '<their change>'`（訂正ごとに `--correction` を 1 つ。シェルが読む文字を含む訂正には、レコードの回答テキストフォルダにある `--correction-file`）は、構造化した JSON を印字します。`candidates[]`（訂正ごとに 1 つ。それぞれ `id`、`correction`、`default_scope: "project"` を運ぶ）と `questions[]` です。後者はそれぞれについて、「You asked me to <correction>. Keep that for next time?」と、正確な選択肢 `Yes, for this project`、`Yes, for the team`、`No`、そしてその `question_kind` を持ちます。`--correction` が無ければ質問は印字しません。ステージの `memory.md` 日誌は数えられ（`memory_entries_total`）、提示されることは決してありません。AskUserQuestion フィールド名は無し。純粋な領域データ。
2. **コンダクターがそれらの質問を尋ねる（判断はその人のもの）。** 各質問はそれぞれ独立した質問です。尋ねるのはその人の選択だけです。コンダクターはその人の訂正からプラクティスの行を書き、合う見出しへ自分で経路します。その人が残すよう求めたメモについては尋ねません。
3. **入場衝突検査（ナレッジ → オーケストレータ LLM。どの選択が persist に届くかをゲート）。** 残した各学びについて、コンダクターは提案した日付付き項目 1 つを `org.md` の一致する `## <section>` と比べます（§5 入場ゲートの一行変種）。矛盾があると、コンダクターは衝突する org の文をインラインで提示し、利用者は直す / 飛ばす / エスカレートします（判断 → 利用者。利用者上書きの道は無し）。衝突が無い、または利用者がエスカレートした選択だけが進みます。センサーマニフェストに org 見出しの類似は無く、検査を飛ばします。
4. **`persist`（selections-file in）。** コンダクターは残した選択を、`surface` が返す `selections_file` のパス、つまり `<record>/.aidlc-engine/learnings/<slug>-selections.json`、インテントのレコードが無ければ `aidlc/spaces/<space>/intents/.aidlc-engine/learnings/<slug>-selections.json`（どちらも gitignore）へ書き、`aidlc engine learnings persist --slug <slug> --selections-json <selections_file>` を呼びます。ツールは決定論のライターです。衝突を判断せず、読むのはそのファイルだけです（ほかの場所にある selections-file や、リンク経由でたどり着いたものは拒むので、1 つのプロジェクトの 2 つのチャットが互いの選択を保存することはありません）。各学びをプラクティスとして `aidlc/spaces/<surface-time-space>/memory/{project,team}.md` へ経路し、センサー選択については2 ファイルへの書き込み（マニフェスト + 元ステージの `sensors:` frontmatter）を 1 つの `withAuditLock` 内で行い、それから `RULE_LEARNED` / `SENSOR_PROPOSED` を出します。

selections-file は再実行の成果物です。落ちた persist は人に再プロンプトせず同じ JSON を再実行します（書いた行ごとの `<!-- cid:<intent-slug>:<slug>:<content-hash> -->` マーカー経由の内容存在冪等 — 位置候補 id ではなく、学び自身のテキストの完全 SHA-256 ハッシュ）。selections-file は候補が提示されたときに一度結んだ `space` / `intent` も運びます。`persist` はそれらを使い、現在のアクティブインテントカーソル自身を再解決しません。書く前に、このスペースと非 null のインテントレコードがまだ存在すること、要求した slug が提示されたときの `stage_slug` と一致することを検証します。

---

## 新規作成するマニフェストの既定

センサー提案がゲートで確認されると、ゲート儀式ツールは新しい **プロジェクト層** マニフェストを `<project>/.claude/sensors/aidlc-<id>.md` に作成します。同梱のフレームワーク配布には決してしません（プロジェクトごとのラーニングループがフレームワークを変えてはいけない。フレームワーク配布パスは落とされる）。フィールドは選択が与え、ツールはそれを与えられたとおりに書きます。

| フィールド | 書かれ方 | 注 |
|---|---|---|
| `id`、`kind`、`command`、`default_severity`、`description`、`matches` | 選択の文字列 | 6 つすべてが必須。1 つでも欠けた選択は `persist` が拒む。マニフェストはスキーマにも合格しなければならない。`kind: deterministic` で、`command` は tools フォルダのワーカーを指名する。ネイティブインストールでは `bun .claude/tools/aidlc-sensor-<id>.ts` という名前 |
| `category` | 選択にあれば書かれる | |
| `timeout_seconds` | 指定されれば書かれる | ディスパッチャのフォールバックは `1200` 秒 |
| `fire_on` | 書かれない | そのため足場で作ったセンサーは write 発火（既定）になる |
| `input_schema`、`output_schema` | 書かれない | `input_schema` のキーが無いので、カスタムセンサーは `--output-path` を受け取る |

マニフェストを作成したあと、ゲート儀式ツールは — 同じ `withAuditLock` トランザクション内で — 新しい id を元ステージの `sensors:` frontmatter 一覧に足します（ステージ側からの取り込みの2 ファイルへの書き込み）。センサーは次のワークフローがコンパイルするとき完全に結ばれます。これが許される唯一のステージ frontmatter 編集です。取り込み一覧を伸ばします（形は不変、中身は不変ではない）。`## Steps` / `## Sensors` / `## Learn` 本文は決して直しません。

同梱の 6 つのマニフェストは、発火ごとの上限を明示します。`claim-sources`、`required-sections`、`upstream-coverage`、`traceability` は `timeout_seconds: 300`、`linter` と `type-check` は `1200` です。ディスパッチャのフォールバックは、5 分の通常と 15 分の複合の [ランタイムのバックストップ](06-hooks-and-tools.md#runtime-and-native-hook-budgets) の合計です。ESLint の probe / config / lint の各サブプロセスは 5 分、TypeScript の probe は 5 分でコンパイルは 15 分です。発火ごとの上限は、入れ子のコマンドを含むセンサープロセス全体を縛ります。マニフェストに明示した、より短い値が引き続き優先されます。

write フックは、各ディスパッチャのサブプロセスに既定で 30 分を与えます。`AIDLC_SENSOR_TIMEOUT_MS`（またはプロジェクト / ユーザーの `sensorTimeoutMs` 設定）がこの外側の許容時間を上書きします。外側の上限がもっと短いと、ディスパッチャが終端のセンサー行を出す前に中断されることがあり、フックは doctor 向けに取りこぼしを記録します。センサー自身の発火ごとの上限に達すると `SENSOR_BUDGET_OVERRIDE` になります。入れ子の lint / compile 実行が完了しなければ走れなかった（could-not-run）経路に、probe が使えなければツール利用不可の経路に従います。どちらも blocking ゲートの検証済み合格にはなりません。ゲートのディスパッチは別に `AIDLC_GATE_SENSOR_DISPATCH_TIMEOUT_MS` を受け付けます。未設定なら、センサーの発火ごとの上限を超える外側のタイムアウトは加えません。

---

<a id="forward-compat-policy"></a>

## 前方互換方針

センサーマニフェストの消費者（コンパイル、ディスパッチャ、ゲート儀式の足場、doctor）は **未知のマニフェストキー** を許さなければなりません。将来のリリースが任意の `cool_new_field:` を足しても、古い消費者はマニフェストをパースし、フィールドを無視し、続けます。これにより、フォークやアップグレード前のワークスペースを壊さずにスキーマの加算進化ができます。

前方互換は既知キーの未知値には効きません。上の [`kind` enum](#kind-enum) どおり、`kind` の未知値はパース時に落とされます。同じ原則がほかの enum 形フィールド（`default_severity`、`fire_on`）にも効きます。

---

## 将来のリリース向け予約

センサー能力のいくつかはスキーマに予約されていますが、まだアクティブではありません。着地するときフィールド形が安定するようにです。

- **`kind: llm` ディスパッチ** - LLM 評価センサー。スキーマはパース時に `deterministic` 以外の `kind` を落とします。
- **書き込み時 blocking** - write 発火マニフェストで `blocking` は受け入れますが、このリリースで強制されるのは gate 発火の失敗だけです。パーサはこの組み合わせを落としません。

## 次

- **ルール** — 制御ループのフィードフォワード側は `pairing:` フィールド経由でこれらのセンサーと対になります。[Rule System](08-rule-system.md)。
- **利用者が見るラーニングループ** — センサー提案がゲートでどう提示され確認されるか、確認した提案が新しいマニフェストをどう足場にするか。User Guide の [Rules and the Learning Loop](../guide/09-rules-and-the-learning-loop.md)。
- **コンパイル境界** — `sensors_applicable` がワークフロー開始時に一度解決され、発火時にグラフノードから読み取られる仕組み。[Plane Architecture](02-plane-architecture.md)。

上のスキーマと `dist/claude/.claude/sensors/` の同梱の 6 つのマニフェストが動く例です。
