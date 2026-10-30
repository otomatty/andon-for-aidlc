# アーティファクト用語集

本章は、各ステージの YAML フロントマターにある `produces:` と
`consumes[].artifact:` で使用される、AI-DLC アーティファクト名の正規文字列に
関する規則です。命名形式、衝突解決ポリシー、ファイルシステムのパス規約、
コマンドラインからライブレジストリを確認する方法を扱います。

レジストリ自体は**記述するものではなく導出されるもの**です。存在する正規名の
権威ある情報源は、すべてのステージファイルの `produces[]` フィールドと、各
ステージの `optional_produces[]`（ユニットごとに条件付きで書き込まれる
アーティファクト。フィールドの説明は `15-stage-definition.md` を参照）の和集合
です。そのため、条件付きで生成される名前も登録されたままとなり、生成元を
解決できます。`core/tools/aidlc-graph.ts` のヘルパーはコンパイル済み
ステージグラフを読み取り、その和集合を集合として返します。これはスコープ
（`aidlc-lib.ts` の `validScopes()`）やエージェント
（`aidlc-lib.ts` の `loadAgents()`）と同じパターンです。本章にレジストリを
列挙しないことで、並行して手管理されるリストに起きやすい乖離を防ぎます。

---

## ここでいうアーティファクト

アーティファクトとは、生成ステージが YAML フロントマター内で宣言する**正規識別子**です。
他のステージは、読み取り依存関係を宣言するために `consumes[]` で同じ識別子を参照します。
消費される識別子には必ずちょうど 1 つの生成元があります。消費されない名前は、それぞれ
自分のレコードディレクトリ配下に独立したファイルを書くステージ間で共有できます。識別子は
短いハイフン区切りの文字列であり、ファイル拡張子、フォルダ接頭辞、スラッシュは含みません。

具体例として、Scope Definition ステージのフロントマター
（`core/aidlc-common/stages/ideation/scope-definition.md`）を示します。

```yaml
slug: scope-definition
# ...
produces:
  - scope-document
  - intent-backlog
  - scope-definition-questions
consumes:
  - artifact: intent-statement
    required: true
  - artifact: feasibility-assessment
    required: false
  - artifact: constraint-register
    required: false
```

ここで `scope-document`、`intent-backlog`、`scope-definition-questions` は
`scope-definition` ステージが生成するアーティファクトです。`intent-statement`、
`feasibility-assessment`、`constraint-register` は、このステージが消費する
アーティファクトであり、別のステージが生成します（1 つ目は `intent-capture`、
残りの 2 つは `feasibility`）。

このレジストリにおいて**アーティファクトではないもの**は次のとおりです。

- **ファイルパス。** `<record>/ideation/scope-definition/scope-document.md`
  （`<record>/` はインテントのレコードディレクトリ
  `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`）はファイルシステム上の
  場所であり、正規名は `scope-document` です。後述の「ファイルシステムへの
  マッピング」を参照してください。
- **ファイル名。** ディスク上の `.md` ファイルと正規名は一致する必要が
  ありません（衝突時を除けば、通常は一致します）。
- **状態管理用ファイル。** `aidlc-state.md` と `audit/` シャードは
  `produces[]` を通じてステージが管理するのではなく、ツール
  （`aidlc-state.ts`、フックスクリプト）が管理します。レジストリには決して
  現れません。
- **実行時の値。** 「ユーザーの自由記述回答」や「ワークスペース分類
  （新規開発/既存資産あり）」のような文字列は動的なデータであり、永続する
  ステージ間アーティファクトではありません。

---

## 導出規則

1. **ステージファイルが権威を持ちます。** 各ステージの `produces:` リストは、
   そのステージが出力するすべての正規名を宣言します。`consumes:` は、その
   ステージが依存する正規文字列を指定します。
2. **レジストリは記述せず、計算します。**
   `bun dist/claude/.claude/tools/aidlc-graph.ts artifacts` を実行すると、ライブ
   レジストリが名前ごとに 1 行、アルファベット順で出力されます。このツールは
   コンパイル済み `stage-graph.json` にある全ステージの `produces[]` と
   `optional_produces[]` の和集合を取ります。
3. **本章に並行リストは置きません。** 一覧が必要な場合はツールを実行します。
   本章で正規名をレジストリ表として列挙することはありません。
4. **所属は診断機能が検証します。** `/aidlc --doctor` は「グラフ参照」
   チェック（`aidlc-utility.ts`）を実行します。すべての
   `consumes[].artifact` エントリと `requires_stage[]` の識別子は導出済み
   レジストリに解決できなければなりません。孤立した消費側は壊れた参照として
   報告されます。

33 個のステージファイルはすべて `produces:` を宣言しているため、導出結果には
レジストリ全体が含まれます。ツールは空のデータに対しても明確に定義されています。
`produces:` を持たないステージは単に何も追加しません。ただし、配布される
フレームワークではすべてのステージに値があります。

---

## 命名規則

すべての正規名は、`core/tools/aidlc-stage-schema.ts` の
`SLUG_RE` が強制する `/^[a-z][a-z0-9-]*$/` に一致しなければなりません。つまり、
次のとおりです。

- **小文字のみ。** `ScopeDocument` や `SCOPE_DOCUMENT` ではなく
  `scope-document`。
- **ファイル拡張子なし。** `scope-document.md` ではなく `scope-document`。
- **フォルダ接頭辞・スラッシュなし。**
  `ideation/scope-definition/scope-document` ではなく `scope-document`。
- **英字で開始。** `s1` は有効ですが、`1-thing` は無効です。
- **途中に使用できるのはハイフン、数字、小文字の英字のみ。** アンダースコア、
  空白、ユニコード文字は使えません。

質問アーティファクトには慣例として `<stage-slug>-questions` を用います。ユーザー
入力を収集するステージは、主な成果物と並べて `<slug>-questions` という正規名を
宣言します。これはパーサー規則ではなく慣例です。

形式は**フラットな名前空間**です。`<phase>/<stage>/<artifact>` のような階層的な
接頭辞は使いません。これは AI-DLC の他の識別子とも一致します。エージェント識別子、
スコープ名、ステージ識別子、フェーズ名はすべてフラットなハイフン区切りです。

---

## 衝突ポリシー

いずれかのステージがその名前を消費している場合、2 つのステージが `produces[]` と
`optional_produces[]` にまたがって同じ正規名を宣言しては**なりません**。ランタイムの
consume 解決には所有する生成元が 1 つ必要なため、`aidlc-graph compile` はこの曖昧さを
拒否し、エラーは生成側のすべてのファイルと消費側のステージ 1 つを名指しします。同じ
消費される概念を 2 つのステージが出力する場合は、区別できる 2 つの異なる名前を選びます。

どのステージも消費しない名前であれば、共有は有効です。出荷されている `traceability`
アーティファクトはこのパターンに従います。9 つのステージがそれぞれ自分のレコード
ディレクトリ配下に自分の `traceability.json` を書き、下流のどのステージも
`producersOf()` を通じて `traceability` を解決しません（トレーサビリティチェックは
Requirements Analysis のレコードをそのパスで読み取ります）。

現時点の例は 1 つです。`build-and-test`（構築）と
`performance-validation`（運用）は、どちらも `test-results.md` という
ファイルを書き込みます。ワイヤ上で衝突しないように、正規名は分けられています。

- `build-test-results` — `build-and-test` が出力します。このステージでは
  `build-instructions`、`build-and-test-summary`、そしてテスト戦略によって
  変わる `integration-test-instructions`、`performance-test-instructions`、
  `security-test-instructions` と対になります。後の 3 つは、このステージが
  `optional_produces` に宣言します。
- `unit-test-instructions` は `code-generation` がユニット単位で生成し、
  `build-and-test` が消費します。
- `source-manifest.json` は、`code-generation` の宣言済み成果物に対する、
  エンジン必須のユニット単位の随伴ファイルです。意図的に `produces[]` には
  **入れていません**。あのセットを変えると、進行中の成果物フィンガープリントを
  遡って無効化してしまうからです。この厳格な JSON マニフェストは、作成・変更・
  削除されたアプリケーションソースのパスを帰属させます。終端レビューの
  スタンプにはこれが必要で、そのバイト／内容の主張は `Unit Source Fingerprint`
  によって束縛されます。
- `load-test-results` — `performance-validation` が出力します。同じステージが
  すでに出力する `load-test-plan` と対になります。

両方の名前は現在、それぞれのステージの `produces:` リストに含まれています。

**ディスク上のファイル名は一致する必要がありません。** 両ステージはそれぞれの
フォルダで `test-results.md` を書き続けられます。正規名はファイル名ではなく、
ワイヤ上の識別子です。

---

## ファイルシステムへのマッピング

アーティファクトのディスク上のパスは、`(正規名) + (生成ステージ) + (ユニット単位
フラグ)` から導出できます。拡張子は既定で Markdown です。正規アーティファクト
`traceability` だけが構造化データの例外で、`traceability.json` に解決されます。
配置の形は 2 種類です。

- **ユニット単位ではないステージ（30 件中 25 件）：**
  `<record>/<phase>/<stage>/<artifact-filename>`
  例：アイデア創出の `feasibility` ステージが生成する
  `feasibility-assessment` は、
  `<record>/ideation/feasibility/feasibility-assessment.md` にあります。

- **ユニット単位の構築ステージ（30 件中 5 件）：**
  `nfr-requirements`、`nfr-design`、`functional-design`、
  `infrastructure-design`、`code-generation`。これらは構築中に
  作業単位ごとに各アーティファクトを 1 つ出力します。
  `<record>/construction/{unit-name}/<stage>/<artifact-filename>`
  例：`functional-design` が生成する `functional-spec`（機能仕様）は、
  `<record>/construction/{unit-name}/functional-design/functional-spec.md`
  にあります。

ユニット単位かどうかは、ステージフロントマターの
`for_each: unit-of-work` フィールドで宣言されます。作業単位ごとに一度実行される
5 つの構築ステージにはこれがあり、他のステージにはありません。将来的な
ヘルパーは、ステージグラフと正規名から機械的にパスを計算できます。

`aidlc-lib.ts` の `artifactFilename()` は、ディレクティブ、ユニット単位の
カバレッジ、完了ガード、レビューフィンガープリントで共有される拡張子リゾルバです。
`traceability` を除くすべてのアーティファクトは `<canonical-name>.md` に解決され、
`traceability` は `traceability.json` に解決されます。

**レビュー記録は成果物ではありません。** レビュアーを持つステージのレビュー結果（判定、指摘、レビュアー、リクエスト ID、結び付くフィンガープリント、レビュー本文）は、フレームワークが管理する記録へ保存します。ステージ全体の保存先は `<record>/.aidlc-engine/reviews/<stage>/stage/<attempt>/<iteration>.json`、Unit ごとの保存先は `<record>/.aidlc-engine/reviews/<stage>/units/<unit>/<attempt>/<iteration>.json` です。書き込めるのは `aidlc-log.ts review --verdict` だけで、`REVIEW_COMPLETED` 行がそのパスとダイジェストを記録します。同じコマンドは、レビュアーの報告の代わりにその時点でエンジンが管理する指摘リストを載せた、レビューの読みやすいコピーを、レビュー対象の成果物の隣の `<stage dir>/reviews/review-NN.md` に書きます。このコピーは人向けであり、成果物ではなく、読み戻されることもありません。ステージの `review_artifact` は、宣言済み成果物のうちレビュー対象となるものを指定します。ゲートの `**Review:**` パスと `--reject-finding` / `--reopen-finding` / `--fix-finding <artifact>#R-NN` のセレクターキーもこの成果物を指しますが、レビュアーが成果物へ書き込むことはありません。成果物末尾の `## Review` 節は、専用のレビュー記録が導入される前の形式です。移行のために読み取ることはありますが、新規には書き込みません。

**要約の確認記録も成果物ではありません。** ステージ（および Unit）の有効な要約確認は、ステージ全体では `<record>/.aidlc-engine/summary-authorization/<stage>/stage.json`、Unit ごとでは `<record>/.aidlc-engine/summary-authorization/<stage>/units/<unit>.json` に保存されます。`aidlc-log.ts answer --checkpoint summary-confirmation` が `Looks correct` の回答時に作成し、`Request changes` の回答時に削除します。記録には、受領行にも記載される `Summary Authorization Id` が含まれます。書き込み監査フックはこの記録を読み、ステージの `ARTIFACT_CREATED`／`ARTIFACT_UPDATED` 行へ同じ ID を付けます。完了処理は、その ID と現在の受領記録を照合します。これは出力でもレビュー対象でもなく、`produces[]` に列挙しません。

**コード知識ベースはスペースレベルの例外です。** リバースエンジニアリングの 9 つの
アーティファクト（`business-overview`、`architecture`、`code-structure`、
`api-documentation`、`component-inventory`、`technology-stack`、
`dependencies`、`code-quality-assessment`、`reverse-engineering-timestamp`）は、
インテントごとのレコードディレクトリ以下には解決されません。インテントではなく
リポジトリをキーとし、スペース内のすべてのインテントで共有される永続的な
リポジトリ単位のコード知識ベース
`aidlc/spaces/<space>/codekb/<repo>/` に格納されます。パスは
`resolveArtifactPath` の `isCodekb` 分岐
（`core/tools/aidlc-orchestrate.ts`）により、レコード相対規則の
外で解決されます。同じディレクトリは、読み取り専用のユーティリティ直接呼び出し
`aidlc engine workspace codekb` でも出力されます。複数のリポジトリを記録する作業では、
ステップはこれらのアーティファクトをそれぞれ一度だけ
`aidlc/spaces/<space>/codekb/{repo}/<name>.md` として示し、その `repos_note` が
`{repo}` がどのリポジトリを表すかを伝えます（`resolveArtifactPaths`）。そのため、
どの規模のワークスペースでも 1 つのステップに収まります。完了チェックとセンサーは、
引き続きすべてのリポジトリのファイルを読み取ります。

**衝突時は正規名とファイル名が異なります。** 衝突を分割した場合（上記参照）、
ディスク上のファイル名は分割前の形式（`test-results.md`）を維持できますが、正規名は
区別済みの形式になります。ファイルシステムではなく、ステージの `produces:` リストと
`aidlc engine graph artifacts` を情報源として使用してください。

---

## ライブレジストリの確認方法

```bash
aidlc engine graph artifacts
```

正規名を 1 行に 1 件、アルファベット順で出力します。

コンパイル済みグラフを読み取るため、最後のコンパイル時点の内容を一覧します。
このリリースのネイティブインストールでは 122 件の名前を出力します（出力は一部省略）。

```text
$ aidlc engine graph artifacts
accessibility-checklist
alarms
anomaly-config
api-documentation
approval-handoff-questions
...
$ aidlc engine graph artifacts | wc -l
122
```

件数を調べるには `wc -l`、絞り込みには `grep`、乖離チェックには期待するベースライン
との `diff` にパイプしてください。

---

## アーティファクトの追加または名前変更

レジストリは導出されるため、本章を編集する必要はありません。

**新しいアーティファクトを追加するには：**

1. 生成ステージの `.md` ファイルを編集し、正規名を `produces:` リストへ追加します。
2. グラフを再コンパイルします（確認するインストール済みプロジェクトで
   `aidlc engine graph compile`）。`artifacts` はステージファイルではなく、
   コンパイル済みグラフを読み取ります。
3. `aidlc engine graph artifacts` を実行し、名前が表示されることを確認します。
4. `/aidlc --doctor` を実行し、消滅した名前を参照する消費側がないことを確認します
   （「グラフ参照」チェック）。

**アーティファクト名を変更するには：**

1. 生成ステージの `produces:` エントリで名前を変更します。
2. 消費する各ステージの `consumes[].artifact` エントリでも名前を変更します。
3. 再コンパイルしてから `/aidlc --doctor` を実行すると、更新を忘れた消費側を検出します。古い名前は
   生成元不明エラーになります。

ステージグラフの CI 乖離検出（`aidlc-graph compile --check`）は、YAML ソースから
`stage-graph.json` を再生成し忘れた名前変更を検出します。

---

## 安定性

アーティファクト名の安定性ポリシーは次のとおりです。

- **名前変更**と**削除**はメジャーバージョンの変更です。
- **追加**はマイナーバージョンで提供します。

このポリシーはライブデータに対して強制可能です。タグ時点のレジストリと HEAD の
レジストリの乖離は、1 行の `diff` で確認できます。

---

## 相互参照

- `core/aidlc-common/protocols/stage-definition.md` —
  権威あるステージ形式仕様。`produces[]` / `consumes[]` を構造化フィールドとして
  定義します。
- [ステージ定義](15-stage-definition.md) — 仕様を説明する章。
- [状態機械](12-state-machine.md) — 監査イベントの並行する導出パターン。正規の
  列挙型は文書ではなく `aidlc-audit.ts` にあります。
- [ユーザーガイド — アーティファクトリファレンス](../guide/14-artifacts-reference.md)
  — ユーザー向けのアーティファクトライフサイクルとディレクトリ構成。
- `core/tools/aidlc-graph.ts` — 導出ツール
  （`artifactsRegistry()` と `artifacts` CLI サブコマンド）。
