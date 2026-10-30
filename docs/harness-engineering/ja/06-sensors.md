# センサー

センサーは、一致する書き込み時、またはステージの承認ゲートで自動的に発火する、決定論的な検査です。ルールがエージェントの読む散文であるのに対し（[ルールと学習ループ](05-rules-and-the-loop.md)）、センサーは実際に走るコードです — ルールのフィードフォワードに対する、制御ループのフィードバック側です。ルールは「ユーザーストーリーは Given/When/Then に従う」と述べ、センサーは、エージェントがいま書いたファイルに必要な見出しが存在することを、バイト単位で検証します。

この章は、ハーネスエンジニアがセンサーに対して実際に行う作業を語ります。出荷される 6 つを理解し、新しいマニフェストを作成し、それを実行すべきステージへ結び付けます。フィールドごとの完全な契約は、開発者リファレンスの [センサーシステム](../reference/07-sensor-system.md) にあります — この章は、スキーマ上の判断ごとにそれを繰り返すのではなく、そちらを指します。

---

## センサーとは何か

センサーのマニフェストは、YAML フロントマターを持つ Markdown ファイルで、`core/sensors/` の下に置きます。フロントマターは純粋な**能力の記述子**です — その検査が何であり、どう呼び出すかを述べます。どのステージがそれを使うかについては、何も述べません。その結び付けはステージ側にあり、それがこの章の中心的な考え方であり、マニフェストとステージが疎結合のままでいられる理由です。

3 つの性質が実行時の振る舞いを定めます。何かを作成する前に、いずれも内面化しておく価値があります。

- **`fire_on: write` は作成中に走ります。** `PostToolUse` フックが、Write または Edit の後に、一致する各センサーを実行します。`fire_on` を省略した場合の既定です。
- **`fire_on: gate` は成果物ごとに 1 回走ります。** `gate-start` が状態のトランザクションを開く直前に、状態ツールが、宣言された既存の各成果物パスについてゲート結合の各センサーを 1 回発火させます（ステージの出力全体を読む `upstream-coverage` と `claim-sources` は、出力フォルダごとに 1 回）。リバースエンジニアリングでは、そのファイルが各リポジトリのコードナレッジベースのフォルダごとに繰り返されるため、`required-sections` と `upstream-coverage` はステージにつき 1 回、すべてのリポジトリのファイルを対象に発火し、失敗したファイルはそのリポジトリ付きで名指しされます（`service-007/dependencies.md`）。Construction の自律のもとでエンジンが自ら承認するゲートでは、blocking のセンサーだけが発火します。そこには advisory の証拠を読む者がいないからです。センサーのディスパッチャーが監査ロックを取るため、このディスパッチはトランザクションの外に留まります。
- **advisory のゲート検査は、ゲートの前にも 1 回走ります。** ステージの文書が書かれて引き渡されるとき、その試行で最初の引き渡し（レビューの依頼、またはレビューが先に文書を受け取らなかった場合はゲートを開く報告）が、それらの文書に対して advisory のゲート検査を発火させます。いずれかが指摘を報告すると、引き渡しは何も記録せず、指摘と同じコマンドを名指しするステップとしてエージェントへ戻ります。エージェントは自分の担当分を直してそのコマンドを再実行し、処理は先へ進みます。そのため、レビューは整えられた文書を見ることになり、すべての検査をもう一度発火させるゲートは、残ったものだけを名指しします。blocking の検査はゲートでだけ走ります。本人が求めるレビュー、分離された `--single` の実行、スウォームのワーカーのチェックアウトで作られた Unit、エンジンが自ら承認するゲートは、このステップを省きます（`aidlc-state.ts` の `completionChecksStep`）。
- **重大度がゲートの強制を制御します。** `advisory` の結果は記録され、ゲートは開きます。`blocking` のバインディングは検証済みの合格を要求します。指摘、ツールの利用不可、スクリプト／ディスパッチャーのエラー、不正な判定、タイムアウトは、ゲートへの進入を止めます。オーバーライドは、裸のフラグではなく別途記録される人間の判断であり、自律モードでは禁止です。オーバーライドが成功すると、ID、任意の詳細パス、理由が `STAGE_AWAITING_APPROVAL` に記録されます。本リリースでブロッキングの強制が適用されるのは `fire_on: gate` だけです。書き込み発火のセンサーも `blocking` を宣言できますが、その結果は助言のままです。

発火のたびに、インテントの `audit/` シャードへ 1 行が残ります。イベント名は — ログを grep するときは大文字小文字が重要です — センサー開始時が **`SENSOR_FIRED`**、通過時が **`SENSOR_PASSED`**、抜けを見つけたときが **`SENSOR_FAILED`**、スクリプトがクラッシュしたか開始できなかったときが **`SENSOR_COULD_NOT_RUN`** です。失敗した行は、`<record>/.aidlc-engine/sensors/<stage-slug>/`（インテントの記録ディレクトリ内）の詳細ファイルへリンクし、そこには具体的な抜け — 欠けている見出し、参照されていない上流の成果物、lint のエラー — が名指しされます。実行中にこれがどう見えるかのユーザー向けの案内は、ユーザーガイドの [ルールと学習ループ](../guide/09-rules-and-the-learning-loop.md) にあります。

---

## 出荷される 6 つのセンサー

`.claude/sensors/` の下に、いずれも `aidlc-` を接頭辞とする 6 つのマニフェストが出荷されます。

| マニフェスト | ディスパッチ | 何を検査するか |
|----------|----------|--------|
| `aidlc-claim-sources.md` | ゲート | Intent Capture のすべての主張が解決可能なソースタグを持つこと。登録された説明・スコープ・メモリの値が権威ある入力と一致すること。保持された仮定が、人間の明示的な確認と厳密に一致すること |
| `aidlc-required-sections.md` | ゲート | チームのテンプレートが適用される場合、出力がそのテンプレートの `##` 見出しを持つこと。テンプレートが無ければ何も要求されない。失敗時は、何が欠けているかを 1 文で伝える |
| `aidlc-upstream-coverage.md` | ゲート | ステージの成果物（集合として評価）が、そのステージが必須と宣言している（`required: true`）か `cited: true` と印を付けた各上流成果物を、slug・wikilink・生成側ステージのディレクトリパスのいずれかで参照していること |
| `aidlc-traceability.md` | ゲート: `**/traceability.json` | 安定した上流 ID、ステータス、決定論的なターゲット、導出されたビジネスルールの孤立を検証する |
| `aidlc-linter.md` | 書き込み: `.ts` / `.js` | 設定済みの linter（既定は ESLint）をラップする |
| `aidlc-type-check.md` | 書き込み: `.ts` / `.tsx` | 設定済みの型チェッカー（既定は `tsc`）をラップする |

6 つすべてが `matches:` のグロブでゲートされます（詳細は後述）。来歴の検査と 2 つの文書形状の検査は成果物ツリーへスコープされ（出荷マニフェストは `**/{aidlc-docs,intents}/**` を持ちます — インテントごとの記録ツリーであり、`aidlc-docs/` の側は移行前のプロジェクトのために残されています）、traceability は `**/traceability.json` へ、2 つのコード品質の検査はそれぞれの言語のグロブ（`**/*.{ts,js}`、`**/*.{ts,tsx}`）へスコープされます。2 つの文書形状の検査は 3 つ目の `codekb` の側を加え、リバースエンジニアリングが書くスペースレベルの CodeKB にも届くようにしています。自分のものを作成する前に、`aidlc-required-sections.md` を最初から最後まで読んでください — 6 つのうちもっとも小さく、フロントマターと散文の本文という全体の形を示しています。

---

## 結び付けの仕組み: プル型の作成

マニフェストは**ステージを対象指定するフィールドを持ちません**。`applies_to:` はありません — フレームワークが意図的に取り除きました。ステージは、自分のフロントマターでセンサーを名指しすることで、自分の出力に対して何が発火するかを決めます。

```yaml
# core/aidlc-common/stages/construction/ci-pipeline.md (frontmatter, other keys left out)
---
...
sensors:
  - required-sections
  - upstream-coverage
  - linter
  - type-check
...
---
```

これが**プル型の作成**であり、ハーネスモデルにおける他のあらゆる結び付けと同じ方向です。消費者（ステージ）が能力（センサー）を名指しするのであって、その逆ではありません。`sensors:` の一覧は裸の ID を持ちます — `aidlc-linter` ではなく `linter` です。ID はマニフェストのフロントマターの `id:` フィールドと一致し、それは `aidlc-` の接頭辞を取り除いたファイル名の語幹と等しいからです。

見返りは、参照の局所性です。ステージファイルを開けば、そのステージが走るときにどの検査が発火するかが正確に見えます — このステージを対象にすると主張しているものを探して、すべてのマニフェストを走査する必要はありません。同じ `sensors:` 区画は [ステージの構造](01-anatomy-of-a-stage.md) でステージ側から説明されています。ここではセンサー側から見ています。

グラフのコンパイル時、解決器は `.claude/sensors/` を辿り、すべてのマニフェストを ID で索引し、各ステージについて宣言された各インポートを引きます。ID に対応するマニフェストが無ければ、ステージ実行時に静かに失敗するのではなく、コンパイル時に大きく例外を投げます。ステージがどのセンサーをインポートするかはそのグラフノードへ焼き込まれ、各マニフェストの `matches` も同様に焼き込まれます。書き込みフックは、センサーを発火させるかどうかの判断にこの `matches` を使います。ディスパッチャーはセンサーが発火するたびにマニフェストを読み直すので、変更した `command` や `timeout_seconds` は次の発火から適用されます。一方、変更した `matches` と新しいインポートは次のコンパイルを待ちます。振る舞いを予測可能にするため、センサーを編集したら必ず再コンパイルしてください。ネイティブインストールでは、出荷される 6 つのセンサーのワーカーは ID で選ばれるため、出荷マニフェストの `command` を編集しても実行されるものは変わりません。別の検査には独自の ID が必要です。解決器の完全な仕組みは [ステージはどうセンサーをインポートするか](../reference/07-sensor-system.md#ステージがセンサーを取り込む仕方) にあります。

---

## 新しいセンサーを作成する

センサーの追加は 2 回の書き込みです。マニフェスト、そして結び付けです。

**1. `core/sensors/aidlc-<id>.md` にマニフェストを置く。** ファイル名の語幹（`aidlc-` の接頭辞を除く）が、フロントマターの `id:` と一致していなければなりません。フロントマターは短く、必須が 5 フィールド、任意がいくつかです。

| フィールド | 必須 | 何か |
|-------|----------|------------|
| `id` | はい | ケバブケース。`aidlc-` を除いたファイル名の語幹と等しい |
| `kind` | はい | 現時点で受け付ける値は `deterministic` のみ |
| `command` | はい | ディスパッチャーが実行する、正規の呼び出しの接頭部 |
| `default_severity` | はい | `advisory` または `blocking`。blocking が強制されるのはゲートディスパッチのみ |
| `description` | はい | 1 行の人間向け説明 |
| `category` | いいえ | 自由形式のラベル（出荷マニフェストは `document-shape`、`code-quality` を使用） |
| `fire_on` | いいえ | `write` または `gate`。既定は `write` |
| `matches` | いいえ | 書き込みパスのフィルター。ゲートディスパッチでは、グロブを省略するとすべての宣言済み成果物を受け入れる |

`command:` は完全な argv ではなく、**接頭部**です。ディスパッチャーが発火時に実行時の文脈を付け加えます。常に `--stage <slug>`、続いてマニフェストの `input_schema` が宣言するファイルのフラグです。`file_path` キーを宣言するセンサー（`linter` や `type-check` などのコード系センサー）には `--file-path <path>` が、それ以外のキーを宣言するセンサー（文書系センサー）には `--output-path <path>` が渡されます。追加するコード系センサーは `input_schema:` の下に `file_path` を宣言しなければなりません。宣言しないと、そのスクリプトは `--output-path` を受け取ります。したがってマニフェストは純粋な能力の記述子のままで、発火ごとのフラグを符号化することはありません。ディスパッチャーが組み立てる正確な呼び出しは [`command:` の呼び出し契約](../reference/07-sensor-system.md#command-起動契約) に文書化されています。完全なスキーマ — `input_schema`、`output_schema`、`timeout_seconds`、未知キーに対する前方互換の方針 — は [センサーマニフェストのスキーマ](../reference/07-sensor-system.md#センサーマニフェストのスキーマ) を参照してください。

**2. ステージの `sensors:` 一覧に ID を追加して結び付ける。** ディレクトリに置かれただけのマニフェストは、どこかのステージがインポートするまで何もしません。検査を発火させたいステージを開き、そのフロントマターの `sensors:` 一覧に裸の ID を追加すれば、次のコンパイルで結び付けが有効になります。複数のステージでセンサーを走らせるには、それぞれに ID を追加します — 厳密加算であり、考慮すべき上書きの層はありません。あるステージでセンサーの発火を止めるには、そのステージから ID を取り除きます。マニフェストは変わりません。変わるのはインポート一覧だけです。

`aidlc-` のファイル名接頭辞は、独自のものを含むすべてのセンサーで必須です — コンパイルの解決器（`aidlc-graph.ts` の `loadSensors`）は `SENSOR_FILE_REGEX = /^aidlc-([a-z][a-z0-9-]*)\.md$/` でマニフェストを発見し、接頭辞の無いファイルを静かに飛ばすため、発見されずステージにも結び付きません。センサーは `core/sensors/aidlc-<id>.md` と名付け、`id: <id>` を設定してください。ファイル名と ID の規則は、接頭辞の後の語幹に適用されます。

### 完全な例

文書にまだ TBD が残っているあいだ失敗するゲートセンサーです。マニフェストは、センサーフォルダの `aidlc-no-tbd.md` です。

```markdown
---
id: no-tbd
kind: deterministic
command: bun .claude/tools/aidlc-sensor-no-tbd.ts
default_severity: advisory
description: The document has no TBD left in it
category: document-shape
fire_on: gate
matches: "**/intents/**"
input_schema:
  output_path: string
  stage_slug: string
output_schema:
  pass: boolean
  findings: string[]
  findings_count: number
timeout_seconds: 60
---

# no-tbd

Fails when a stage output still says TBD, listing each line that does.
```

そしてそのワーカーは、ツールフォルダの `aidlc-sensor-no-tbd.ts` です。ワーカーは `main(argv)` を export し（ネイティブエンジンはファイルを import してそれを呼びます。最終行は Bun の下でそれを実行します）、`--output-path` の後のパスを読み、`pass`、その指摘、`findings_count` を持つ JSON を 1 行出力します。`findings_count` は監査行が記録する数で、これが無いと行は 0 と記録します。ワーカーは何を見つけても終了コード 0 で終わります。

```ts
// no-tbd sensor: print {"pass", "findings", "findings_count"} for the file after --output-path.
import { readFileSync } from "node:fs";

export function main(argv: string[]): void {
  const file = argv[argv.indexOf("--output-path") + 1];
  const lines = readFileSync(file, "utf-8").split("\n");
  const findings = lines.flatMap((line, i) => (/\bTBD\b/.test(line) ? [`line ${i + 1}: ${line.trim()}`] : []));
  console.log(JSON.stringify({ pass: findings.length === 0, findings, findings_count: findings.length }));
}

if (import.meta.main) main(process.argv.slice(2));
```

`no-tbd` をステージの `sensors:` 一覧に追加し、再コンパイルします。インストール済みの Claude Code のツリー（2 つのファイルを `.claude/sensors/` と `.claude/tools/` に置き、[ステージを追加する](02-adding-a-stage.md) の glossary ステージに結び付けたもの）では、エンジンはそれを次のように記述します。

```text
$ aidlc engine sensor describe no-tbd
id: no-tbd
kind: deterministic
command: bun .claude/tools/aidlc-sensor-no-tbd.ts
default_severity: advisory
description: The document has no TBD left in it
category: document-shape
matches: **/intents/**
timeout_seconds: 60
path: .claude/sensors/aidlc-no-tbd.md
```

そして TBD の行を持つファイルに対して手で発火させます（`fire` は 1 行を出力します）。

```text
$ aidlc engine sensor fire no-tbd --stage glossary-capture --output-path aidlc/spaces/default/intents/261013-lab/inception/glossary-capture/glossary.md
{"fire_id":"cd665332","sensor_id":"no-tbd","stage":"glossary-capture","output_path":"aidlc/spaces/default/intents/261013-lab/inception/glossary-capture/glossary.md","result":"failed","detail_path":"aidlc/spaces/default/intents/.aidlc-engine/sensors/glossary-capture/no-tbd-cd665332.md"}
```

詳細ファイルには、ワーカーが出力した指摘が並びます（その JSON ブロックは、ここではフェンスを外して示しています）。

```text
## Findings

{
  "pass": false,
  "findings": [
    "line 6: - Reorder level: TBD"
  ],
  "findings_count": 1
}
```

そして監査シャードには失敗の行が入ります。

```text
## Sensor Failed
...
**Event**: SENSOR_FAILED
**Fire id**: cd665332
**Sensor ID**: no-tbd
**Stage slug**: glossary-capture
**Output path**: aidlc/spaces/default/intents/261013-lab/inception/glossary-capture/glossary.md
**Detail path**: aidlc/spaces/default/intents/.aidlc-engine/sensors/glossary-capture/no-tbd-cd665332.md
**Findings count**: 1
```

その行を直すと、次の発火は `"result":"passed"` を報告し、以前の詳細ファイルは削除されます。0 以外で終了したワーカーは、`"note":"script-error: exit-1"` のような注記付きで `"result":"could-not-run"` として記録され、ゲートはその検査を実行できなかったことを伝えます。

---

## 判断: `fire_on`、`matches`、`default_severity`

マニフェストの大半は機械的です。実際の作成上の判断を担うのは 2 つのフィールドです。

**`fire_on` — 有用な検査の境界はどこか。** 繰り返し検査することに意味がある、速く漸進的なフィードバックには `write` を使います。最終的なステージ出力に対して一度だけ走るべき、成果物全体や複数ファイルにまたがる検査には `gate` を使います。省略は `write` を意味します。

**`matches` — どんな形のファイルを解析すべきか。** `fire_on: write` では、このグロブが発火のフィルターであり、事実上必須です。書き込まれたパスが一致したときにだけフックが発火し、`matches` を持たないエントリは決して発火しません。`fire_on: gate` では、状態ツールが宣言された既存の各成果物へ同じ能力の検査を適用し、一致するファイルだけをディスパッチします。`matches` を省略すればすべてを受け入れます。コード品質のセンサーはコードのグロブを設定し（`aidlc-linter.md` は `**/*.{ts,js}`、`aidlc-type-check.md` は `**/*.{ts,tsx}`）、コードの書き込みでだけ発火して散文には静かなままです。文書形状のセンサーは成果物ツリーへスコープされ、ステージが書く任意の Markdown 成果物で発火します。検査が意味を持つファイルの形を決め、それを覆うもっとも狭いグロブを書いてください。空の `matches: ""` はパース時に拒否されます。書き込み発火のセンサーは形を名指ししなければならず、ゲート発火のセンサーは、宣言されたすべての成果物を受け入れるためにこのフィールドを省略できます。完全な振る舞いは [`matches` フィルター](../reference/07-sensor-system.md#matches-フィルタ) にあります。

**`default_severity` — 信号か強制か。** `advisory` は結果を記録して続行します。`blocking` は、ディスパッチャーが検証済みの合格を返さない限り、ゲート発火のセンサーを止めます。指摘、評価の実行不能、不正な出力、タイムアウトは、いずれも拒否します。作業者は問題を直すか、記録された 2 択のプロンプトから `Override blocking sensors` を明示的に選び、そのフラグと正確な `--user-input` を付けて再試行できます。自律モードでオーバーライドはできません。書き込み発火センサーの blocking はスキーマ上は受け付けられますが、本リリースでは助言のままです。方針は [`default_severity`](../reference/07-sensor-system.md#default_severity) にあります。

---

## 学習ループがセンサーをインストールしてくれるとき

センサーを常に手で作成するわけではありません。§13 の学習ゲートは、ワークフロー中にセンサーの提案を確認したときに 1 つインストールできます — あるステージの出力に決定論的な検査を発火させるべきだと判断し、ゲートでそれにチェックを入れると、フレームワークが、あなたが手で行うのと同じ 2 回の書き込みでインストールします。あなたのプロジェクトの `.claude/sensors/aidlc-<id>.md` に**プロジェクト層**のマニフェストの雛形を作り（出荷されるフレームワーク配布物には決して書きません）、発端となったステージの `sensors:` インポート一覧へ新しい ID をアトミックに追記します。このゲートで確認された経路は **`SENSOR_PROPOSED`** の監査行を発行するため、結び付けが静かにインストールされることは決してありません。ループとその `SENSOR_PROPOSED` の行は [ルールと学習ループ](05-rules-and-the-loop.md) で扱います。ユーザー向けの一通りの流れは、ユーザーガイドの [ルールと学習ループ](../guide/09-rules-and-the-learning-loop.md) にあります。

この章の手による作成の経路と、ループがインストールする経路は、同じ成果物 — マニフェストとインポート一覧のエントリ — を生みます。違いは誰が始めるかです。ファイルを直接編集するあなたか、ワークフローの途中であなたが行った訂正を捕まえたゲートかです。

---

## 次に読む

[チームナレッジ](07-team-knowledge.md) — エージェントが作業前に読み込む領域の文脈を与えます。ハーネスエンジニアが形づくる、最後のデータの面です。
