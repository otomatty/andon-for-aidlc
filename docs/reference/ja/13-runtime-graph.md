# ランタイムグラフ

> 対象読者: レベル 2/3（チーム導入者、フレームワーク貢献者）。

本章では、ワークフロー単位の `runtime-graph.json` アーティファクトを説明します。
これは、各承認ゲートで `aidlc-runtime.ts compile` によって監査ログから
実体化される `stage-graph.json` のデータプレーン上のミラーです。このアーティファクトを
必要とするコントロールプレーンとデータプレーンの分離については
[プレーンアーキテクチャ](02-plane-architecture.md)を、コンパイルを起動する遷移を持つ
ライフサイクルについては[状態機械](12-state-machine.md)を参照してください。

---

## 1. 概要

`stage-graph.json` は構造上の真実です。すべてのステージ定義と、
すべての `requires_stage` / `produces` / `consumes` エッジを保持します。
ワークフロー実行の間で安定しています。

`runtime-graph.json` は実行上の真実です。*現在の*ワークフローについて、開始済み・
承認済みのステージ、各ステージのメモリーファイルの内容、発火したセンサーを記録します。
ワークフローごとに 1 ファイルで、`<record>/runtime-graph.json` にあります。
`<record>/` は意図のレコードディレクトリ、すなわち
`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` です。その行は
`RuntimeStage` レコード（`aidlc-runtime.ts`）で、`stage-graph.json` の `GraphStage`
（`aidlc-graph.ts`）とは別の形状です。両者はステージ識別子で結び付けられます。

これは、コンシューマー（`aidlc-lib.ts` の `resolveBoltDag` 経由で読むエンジンのユニットバッチ、
ユニット計画ファイルがないときのステータスラインと `/aidlc --status`、`aidlc-learnings.ts` における
`learnings surface` の `memory_path` 参照、`aidlc-doctor-bundle.ts` における診断ツールのグラフ診断、
そして `runtime summary`）が、
問い合わせのたびに監査ログを再走査する代わりに、単一の実体化ビューを読めるようにするために
存在します。

---

## 2. スキーマ

以下の TS インターフェースは固定された契約です。変更するには、同じ PR で
すべてのコンシューマーを更新する必要があります。

```ts
interface RuntimeGraph {
  workflow_id: string;            // ISO timestamp from LATEST WORKFLOW_STARTED audit row (so a re-created intent identifies the live workflow, not a dead one)
  scope: string;                  // from aidlc-state.md "Scope" field (or the latest WORKFLOW_STARTED row's Scope when the state has none)
  started_at: string;             // ISO 8601, same row as workflow_id
  stages: RuntimeStage[];         // chronological order by started_at
  bolt_dag?: BoltDag;             // present only when units-generation's unit-of-work-dependency.md carries a valid (well-formed, acyclic) fenced edge block; absent/malformed/cyclic blocks omit the node
}

interface BoltDag {
  units: { name: string; depends_on: string[]; kind?: string }[]; // verbatim from the authored edge block; new names use lowercase kebab-case, while safe legacy single-segment names beginning with a digit or containing uppercase letters, underscores, or dots remain accepted (the swarm derives a separate internal Bolt slug); kind (service|spec|ui|packaging|library) present only when the edge block tags the unit
  batches: string[][];            // topological levels; each level = units whose deps are all satisfied by prior levels; level entries sorted lexicographically (deterministic)
}

interface RuntimeStage {
  stage_slug: string;
  started_at: string | null;      // ISO from STAGE_STARTED; null when `instances` is present
  completed_at: string | null;    // ISO from STAGE_COMPLETED; null when pending OR when `instances` is present
  agent: string | null;           // lead_agent; null when `instances` is present
  memory_path: string;            // <record>/<phase>/<stage>/memory.md (parent stage path even on instance-bearing rows)
  memory_entries: number | null;  // null = no memory.md file OR `instances` is present; else parseMemoryHeadings.total
  memory_breakdown: {             // null when memory_entries is null
    interpretations: number;
    deviations: number;
    tradeoffs: number;
    open_questions: number;
  } | null;
  sensor_firings: SensorFiring[]; // SENSOR_FIRED rows in the stage window, paired to their terminal row by Fire id
  outcome: "approved" | "failed" | "pending";
  learnings_captured: {           // null on pending rows; on approved single-instance rows, RULE_LEARNED + SENSOR_PROPOSED rows in the window counted by Source
    from_orchestrator: number;
    from_user_addition: number;
  } | null;
  instances?: BoltInstance[];     // present only when a Construction stage's window holds STATE_FORKED rows for at least two distinct Bolt slugs
}

interface BoltInstance {
  bolt: string;
  worktree: string;
  started_at: string;
  completed_at: string | null;
  memory_path: string;
  memory_entries: number | null;
  memory_breakdown: { interpretations: number; deviations: number; tradeoffs: number; open_questions: number; } | null;
  sensor_firings: SensorFiring[];
  outcome: "approved" | "failed" | "pending";
}

interface SensorFiring {
  id: string;
  fire_id: string;                // 8-hex correlator (four random bytes) the sensor dispatcher stamps on every row of one fire
  result: "passed" | "failed" | "could-not-run" | "budget-override" | "incomplete"; // the dispatcher's four terminal rows, plus incomplete for a FIRED row with no terminal (in a still-open window, only once the newest stage-start or sensor row is 60 s past it)
  ts: string;                     // FIRED row's timestamp
  detail_path?: string;
}
```

`instances` が存在する場合、ステージ行の単一インスタンス用フィールド
（`started_at`、`completed_at`、`agent`、`memory_entries`、`memory_breakdown`）は
NULL です。`started_at` と `completed_at` は代わりに各インスタンスに格納されます。
`memory_entries` と `memory_breakdown` はインスタンス上でも null のままです
（コンパイルはボルトごとのメモリーファイルを読みません）。ステージ行のフィールドと
インスタンス配列のフィールドが同時に存在することはありません。

### ボルト / ユニット依存 DAG（`bolt_dag`）

省略可能な `bolt_dag` ノードは、エンジンが並列ビルドバッチを算出するために読む、
機械可読なユニット依存グラフです。スウォームのファンアウトにおいては「DAG が許可」
となります。さらに、記録済みのステージ主体（stage-major）ウォークにおける省略可能な
`directive.wave` のエンジン入力でもあります。ウェーブを出力する前に、エンジンはこの
キャッシュを作成済みの依存関係成果物に照らして検証し、自己修復されたメモリ上の
バッチと種別（kind）を使って、ビルド状態・完了受領記録・対になったレビュー・
ユニットメモリのパスを含む、すべてのユニット単位エントリを解決します。
コンダクターはそのディレクティブだけを消費し、このキャッシュノードを読むことも、
兄弟ユニットのパスを再構成することもありません。ソースは、ユニット生成（2.7）が人間可読な説明文と並べて
`unit-of-work-dependency.md` に記載する、**フェンスで囲まれた `yaml` の
`units:` エッジブロック**です。

```yaml
units:
  - name: auth
    kind: service
    depends_on: []
  - name: api
    depends_on: [auth]
```

各ユニットには、そのユニットが何であるかを示す、省略可能な `kind`
（`service | spec | ui | packaging | library`）を指定できます。これはそのまま
`bolt_dag.units[].kind` に入り、ユニット単位で構築設計を絞り込む処理を
駆動します（[ステージ定義](15-stage-definition.md)の `produces_kinds` を参照）。
ステージが生成するアーティファクトは、各ユニットの種別に該当するものに絞り込まれます。
タグなしのユニットには `kind` キーがなく、設計アーティファクトの完全なマトリクスを維持します。
無効な種別値はブロック全体を `malformed`（後述）にするため、誤った絞り込みが行われる前に
2.7 ゲートで明示的に失敗します。

`compile` は、モデル呼び出しを伴わない純粋なデータ解析で、*その構造化ブロック*を
`units`（そのままのエッジ）と `batches`（トポロジカルレベル）に解析します。
各バッチは依存関係がすべて先行バッチで満たされるユニットの集合です。そのためバッチ内の
ユニットには相互依存がなく、並列実行できます。レベル内の項目は出力前に辞書順に
ソートされるため、記述順にかかわらずノードは決定的です。

アーティファクトがない場合（この場合は何も出力しません）、またはアーティファクトはあるが
エッジブロックがない・不正（名前の重複、宙ぶらりんの依存・自己依存、解析不能）・循環している場合、
ノードは**完全に省略**されます。後者の場合、`compile` は理由を示す診断を標準エラー出力に書き込み、誤っているが形式上は有効な DAG を出力する
代わりに、エンベロープから `bolt_dag` を除外します。これらの失敗は、同じブロックを検証して
`edge_block: ok | absent | malformed | cyclic` を報告する `required-sections` センサーにより、
2.7 ゲートで上流へ通知されます。エンジンは 2.7 のレビュー依頼の前と 2.7 ゲートが開く前にも
同じブロックを読み、読めないあいだは、エラーの代わりに欠陥とブロックの形をエージェントに渡します。
承認後にブロックが壊れた場合も、Construction の `next` は同じ修復手順でエージェントに対して止まり、
人に対してエラーで止まることはありません。エッジを構造化データとして（一度だけ、2.7 承認ゲートの
背後で行うナレッジ作業として）記述することで、フックから起動された `compile` は再実行時にも
バイト単位で同一になります。コンパイルパスにはモデルが存在しません。オーケストレーションエンジンは、
キャッシュされた `bolt_dag` を `unit-of-work-dependency.md` に照らして検証し、ノードがない場合や
その記述済み成果物と食い違う場合に読み取り側でユニット単位の反復を自己修復しますが、
グラフファイル自体は次回のコンパイルでのみ修復されます。

---

## 3. コンパイルライフサイクル

コンパイルは、遷移クラスの監査イベントが出力されるたびにツール使用後のシェルフック
（`.claude/hooks/aidlc-rebuild-stage-graph.ts`）から起動されます。このフックは
コンダクターからのすべてのシェルツール呼び出しで発火します。以下のコンパイル用フィルターの前に、
エンジンの `error` ディレクティブのメッセージを人へ中継し、新しい意図をそのセッションに結び付けます
（[フックとツール](06-hooks-and-tools.md#posttooluse-rebuild-stage-graphts) を参照）。
どちらもコンパイルには影響しません。そのあと低コストに絞り込みます。

1. **コマンドフィルター**（`aidlc-lib.ts` の `classifyRuntimeCompileCommand`）:
   `state`、`jump`、`bolt`、`unit`、`utility` の各ツール、`orchestrate report`、
   そして意味的な単発ルート（`aidlc status`、`doctor`、`version`、`help`、`scope change`、
   `config set`、`recompose`、`report`）だけが早期終了を通過します。runtime ルートは拒否されます
   （再帰防止）。`aidlc-log.ts` は冗長なステージ内イベントのみを出力し、
   `aidlc-worktree.ts` は WORKTREE_* イベントのみを出力します。
2. **監査の存在ガード** — 意図の `audit/` シャードがまだ存在しない場合は終了します。
3. **ハートビート** — 診断ツールによる無応答フック検知のため、
   `<record>/.aidlc-engine/hooks-health/rebuild-stage-graph.last` を書き込みます。
4. **末尾 3 ブロックの読み取り**: アクティブな意図のすべての `audit/` シャードを 1 つの
   バッファに統合し、それを `\n---\n` で分割して、最後の 3 エントリを取得します。
5. **イベントクラスフィルター**: 次のパターンを
   `**Event**: (GATE_APPROVED|STAGE_STARTED|STAGE_AWAITING_APPROVAL|AUDIT_MERGED|UNIT_MERGED|WORKFLOW_COMPLETED)`
   3 ブロックのいずれかと照合します。一致しなければ終了します。
6. **ディスパッチ** — `aidlc engine runtime compile ...`。

`WORKFLOW_COMPLETED` が遷移セットに含まれるため、最終ステージの承認でコンパイルが
起動します。`aidlc-state.ts` の `handleCompleteWorkflow` は
STAGE_COMPLETED + PHASE_COMPLETED + PHASE_VERIFIED + WORKFLOW_COMPLETED の 4 つの
監査行を出力し、このうち最後の 3 行は PHASE_COMPLETED + PHASE_VERIFIED +
WORKFLOW_COMPLETED です。（承認パスでは、承認処理がすでに STAGE_COMPLETED を出力済み
であり、実行の前に `GATE_APPROVED` があるため、最終ステージの承認ではいずれにせよ
1 回のシェル呼び出しで 5 行が追加されます。）正規表現に `WORKFLOW_COMPLETED` がなければ、
ランタイムグラフが最終ステージを承認済みとして記録することはありません。

コンパイル自体は完全な監査ログを走査します（そのため結果は遷移の増分ではなく
イベントソーシングされます）。同じステージ識別子の `STAGE_STARTED` と次の `STAGE_COMPLETED` を
対応付け、`aidlc-lib.ts` の `parseMemoryHeadings()` を介して各ステージのメモリーファイルを
読み取り、`withAuditLock` 内の `writeFileAtomic` によりアーティファクトをアトミックに書き込みます。

### 最初のコンパイルより前の空白期間

`init`、`intent create`、`orchestrate next` は遷移クラスのコマンドではありません。そのため、
これらのコマンドしか実行していない新しいワークフローには、最初のゲートを報告する時点でも
`runtime-graph.json` がまだありません。一般的な経路では、このファイルは最初のゲート付き
ステージでの `orchestrate report --result awaiting-approval` で初めて現れます。それより前に
`aidlc status`、`config set`、またはコピーチャネルのユーティリティ `intent-create` ルートが
たまたま実行されればもっと早くコンパイルされますが、最初のゲートでもファイルが存在しない
可能性は残ります（MAY）。消費側はファイルの存在を前提にできません。ファイルは gitignore 対象で
機械ローカルなので、新しいクローン、`git clean`、フックによるコンパイルの 1 回の取りこぼしでも、
ワークフローの途中に同じ穴が生じます。したがって消費側は、ファイルの欠落を通常の状態として扱い、
再計算または縮退しなければならず、失敗してはなりません。`learnings surface` は読み取る唯一の
フィールド（`memory_path`。コンパイルとまったく同じ方法で導出します）を何も出力せずに再計算するので、
ステージプロトコルの第 13 節の儀式は最初のゲートでも実行されます。
一方、不正な（MALFORMED）ファイルや、`memory_path` を持たずに存在する行は別です。
それは破損であり、失敗します。

---

## 4. 結果の列挙値と時系列ペアリング

結果の値は `"approved" | "failed" | "pending"` の 3 種類です。

- **承認済み** — `STAGE_STARTED@T1` が、後続の `STAGE_COMPLETED@T2` と
  対応付けられた状態です。行の `completed_at` は `T2` です。
- **保留中** — `STAGE_STARTED@T1` に対して、そのステージ識別子の後続する
  `STAGE_COMPLETED` がない状態です。行の `completed_at` は `null` です。
- **失敗** — `instances[]` の親ステージ集約からのみ出力されます
  （単一インスタンスのステージは `"approved" | "pending"` のままです）。
  構築ステージの `instances[]` が空でない場合、親の `outcome` は
  そのインスタンスの集約です。すべて承認済みなら承認済み、1 つでも失敗なら
  失敗、それ以外（失敗なしで保留中がある場合）は保留中です。
  単一インスタンスのステージは `failed` を出力しません。基礎となる `BOLT_FAILED`
  イベントは、インスタンスを持つパスの外では構築ステージのスコープを
  持たないためです。

再ジャンプの扱い: `/aidlc --stage <slug>` は、すでに完了済みのステージ識別子に対して
`STAGE_STARTED` を再出力します。監査ログは
`STAGE_STARTED@T1, STAGE_COMPLETED@T2, STAGE_STARTED@T3` を保持します。
ペアリング規則では `STARTED@T1` と `COMPLETED@T2` が対応し、承認済みになりますが、
そのステージ識別子の**最新の** `STAGE_STARTED` が以前の行をすべて上書きします。識別子ごとに
1 行で、最新の STARTED が優先されます。したがって、結果は
`started_at: T3, completed_at: null` の保留中行です。

単一ステージの除外: `--single` によるステージランナーの実行は、合成された
`**Workflow**: single-stage:<slug>` ID の下に `STAGE_STARTED` / `STAGE_COMPLETED` の
ペアを記録します（監査専用。`aidlc-orchestrate.ts` の `handleSingleReport` を参照）。
ペアリングでは、`Workflow` フィールドが `single-stage:` で始まるすべての `STAGE_*` 行を
除外します。これらの行はメインワークフローに属さないため、メインの `runtime-graph.json`
で行を作成・完了することはなく、`summary` の数を増やすこともありません。
メインワークフローの `STAGE_*` 行には `Workflow` フィールドがありません。フィールドが
ない行は保持されます。同じ除外は `aidlc-state.ts` の `hasStageAuditEvent` における重複排除
チェックにも適用されます。よって、単一実行の `STAGE_COMPLETED` によって、同じステージ識別子に対する
メインワークフロー自身の完了イベント出力が抑制されることはありません。

---

## 5. MEMORY_EMPTY の意味

`MEMORY_EMPTY` 監査行は、ステージ行が以下の**すべて**を満たす場合にコンパイルから
出力されます（唯一の出力元。`audit-format.md` のイベントレジストリの Learning Loop 節が
`tools/aidlc-runtime.ts compile` を挙げています）。

- `outcome === "approved"`（保留中行は出力しません。後述を参照）
- `memory_entries === 0`（ファイルが存在し、標準の 4 つの §13 見出しの下の
  エントリがゼロ）

エントリがゼロの保留中行は出力**しません**。まだ実行中のステージは、コンダクターが
まだメモリーファイルに書いていないため、正当にエントリがゼロである場合があります。実行中に
MEMORY_EMPTY を出力すると、実際に記録を省略したことを表さないノイズが生まれます。
シグナルは「エントリゼロで承認済みのステージ」であり、ステージが承認されていることが前提です。

### 冪等性 — (ステージ識別子, ゲート完了) ごとに厳密に 1 回

同じ監査ログに対する再コンパイルでは、`runtime-graph.json` 自体はバイト単位で
等価です。MEMORY_EMPTY の出力にはさらに強い保証があります。
**`(stage_slug, completed_at)` タプルごとに MEMORY_EMPTY 行は最大 1 行です**。

ロックされたセクション内で、コンパイルは意図の `audit/` シャードを再読み込みし、エントリゼロで
承認済みの各ステージ識別子に既存の MEMORY_EMPTY 行がないか走査します。以前のいずれかの行の
タイムスタンプがこの識別子の `completed_at` 以降なら、出力を抑制します。つまり次のとおりです。

- エントリゼロでステージが承認された後の最初のコンパイルは、1 行の MEMORY_EMPTY を
  出力します。
- 同じワークフロー中の以後のコンパイルは、そのステージ識別子に対して再出力**しません**。
- `--stage <slug>` による再ジャンプと再承認では、新しい `STAGE_COMPLETED`
  （より後の `completed_at`）が生成されます。再承認時にもステージが空なら、以前の行の
  タイムスタンプは新しい完了時刻より前になるため、新たな MEMORY_EMPTY 行が出力されます。

ロックされたセクション内で MEMORY_EMPTY が出力された後、アーティファクトの書き込みに
失敗した場合、監査ログにはランタイムグラフが作成されなかったステージの N 個の
MEMORY_EMPTY 行が残ります。次のコンパイルは抑制走査でそれらの行を検出して再出力を
スキップし、その後アーティファクトが作成されます。重複した出力も、実体のない
アーティファクトも発生しません。

---

## 6. メモリーファイル欠落時の規則

メモリーファイルが存在しない（記録が一度も作成されなかった）ステージは、件数が null になり、
MEMORY_EMPTY 行も出力されません。

- `memory_entries: null`、`memory_breakdown: null`、MEMORY_EMPTY を出力しない。
- 両フィールドは常に一緒に変化します。判別基準は
  「`parseMemoryHeadings` は実行されたか」です。メモリーファイルが存在する場合
  （ゼロバイトでも）は実行済みでキーは数値になり、メモリーファイルがない場合は両方とも
  `null` です。

---

## 7. 回復ソース

`runtime-graph.json` と意図の `audit/` シャードはイベントソーシングのペアを構成します。
シャードは追記専用のイベントログ、`runtime-graph.json` は最後の遷移クラスの出力時に
取得された実体化スナップショットで、各コンパイルはログ全体からそれを再導出します。

人が読む順番で、回復ソースは 5 つあります。

1. **アーティファクトツリー**（`<record>/<phase>/<stage>/`）— 何が生成されたか。
2. **`memory.md`**（`<record>/<phase>/<stage>/memory.md`）— コンダクターが記録することを
   選んだ内容。
3. **`audit/` シャード** — 正式なイベントログ。実際に何が起きたか。
4. **`aidlc-state.md`**: アクティブなステージのカーソル。
5. **`runtime-graph.json`** — 実体化ビュー。監査ログの再走査より高速に問い合わせられますが、
   常に監査ログから再導出できます。

### 保留中行の鮮度に関する注意

保留中行の `memory_entries` と `memory_breakdown` は、最後のコンパイル時点で
スナップショット化されています。ステージが実行中で、最後にコンパイルが起動した後に
コンダクターがさらにエントリを書き込んだ場合、スナップショットは遅れています。
回復時のコンシューマーは回復時点で `memory.md` を再解析しなければなりません。
保留中行のスナップショット化された数を信頼しては**いけません**。

`aidlc-state.ts resume`（`handleResume`）は `runtime-graph.json` を読みません。
`aidlc-state.md` のカーソルフィールド（現在のステージ、フェーズ、ステータス、スコープ、エージェント、
次のステージ、ゲートの状態、設定されていればユニットのチェックポイント）を報告し、監査ログの末尾から
後にステージの活動がない `SESSION_COMPACTED` 行を走査します。

### 並列ボルトの実行途中の回復

`aidlc-runtime.ts fragment-fork`（`aidlc-bolt start --worktree` から呼ばれます）は、
メインの `runtime-graph.json` をボルトの作業ツリーへバイトコピーし（メインにない場合は
空のグラフをそこに書き込みます）、`fragment-merge`（`aidlc-bolt complete --merge` から
呼ばれます）はそれを削除します。どちらも監査行を出力しません。コンパイルは、構築フェーズの
ステージのウィンドウに少なくとも 2 つの異なるボルト識別子の `STATE_FORKED` 行がある場合に
`BoltInstance[]` を投入します。ライフサイクルの全体は第 11 節にあります。

作業ツリーのフラグメントの内容を読むコンシューマーはありません。`fragment-merge` はそれを
ハッシュして削除し、スウォームの回復はそれを再開用アーカイブへ移し、`resume` は
`aidlc-state.md` と監査ログの末尾（前述）から報告し、メインのマージ後の
`runtime-graph.json` はメインの監査シャードから再構築されます。

---

## 8. CLI インターフェース

```bash
# Walk audit + memory.md, write runtime-graph.json (invoked by hook).
aidlc engine runtime compile

# Print one stage row from runtime-graph.json (debug/test surface).
aidlc engine runtime read <stage-slug>

# Print deterministic aggregates over runtime-graph.json: stage/phase
# outcome tallies, memory-entry counts by category, sensor 5-state
# tallies, learnings captured, and workflow duration. Read-only; the
# session skills (session-cost, replay, outcomes-pack) consume the
# --json shape so every number they render comes from here, not from
# LLM-side counting.
aidlc engine runtime summary [--json]

# Byte-copy main runtime-graph.json into a Bolt's worktree fragment
# (one-shot; called by `aidlc-bolt start --worktree`). No audit emit —
# the fragment lifecycle rides on STATE_FORKED + AUDIT_FORKED.
aidlc engine runtime fragment-fork --slug <kebab-slug>

# Remove the worktree fragment (idempotent; called by
# `aidlc-bolt complete --merge`). No audit emit — the fragment
# lifecycle rides on STATE_MERGED + AUDIT_MERGED. Main's runtime-graph
# is rebuilt event-source by the post-Bash compile hook on AUDIT_MERGED.
aidlc engine runtime fragment-merge --slug <kebab-slug>
```

すべてのサブコマンドは、標準のカレントディレクトリベースの解決を上書きする
`--project-dir <path>` を受け付けます。

通常の運用ではコンパイルはフック駆動です。テストとデバッグのために手動呼び出しも
用意されています。

---

## 9. なぜフック駆動で、LLM ツール結合ではないのか

以前の計画改訂版では、`handleApprove`／`handleAdvance`／`handleComplete --merge` 内に、
`spawnSibling(..., "aidlc-runtime.ts compile", ...)` を挿入することを提案していました。この方法は、
[プレーンアーキテクチャ](02-plane-architecture.md)に記載された根幹の原則に反します。

> 決定性が必要な場所ではツールを使います。知識が必要な場所では LLM / エージェントを使います。
> 判断が必要な場所では人を使います。

ランタイムグラフのコンパイルは、特定のセッションの外部から観測可能でなければならない
データプレーンの基盤です。LLM が呼び出すツールに結合すると、LLM の呼び出し漏れが
決定性の保証を壊します。人が承認をクリックした後にコンダクターが
`{{INVOKE}} engine orchestrate report --stage <slug> --result approved --user-input "Approve"` を呼び出し忘れると、
監査行は追加されず、コンパイルも起動しません。ランタイムグラフは静かに遅延し、
回復基盤は破損します。

ツール使用後の Bash フックは、LLM が次に何をするかにかかわらず、コンダクターが実際に
コマンドを呼び出したときに発火します。監査を出力する非公開のディスパッチャールート
（`aidlc engine state ...`、`jump ...`、`bolt ...`、`utility ...`と`orchestrate report ...`）が決定性を支えます。

---

## 10. ハーネスのディスパッチ

コンパイルフックは Claude Code のフックではなく、コアのフックです。Claude Code は
`settings.json` でこれを PostToolUse の Bash フックとして登録します。Codex、Copilot、Cursor、
Kiro CLI、Kiro IDE、opencode のアダプターは、各自のシェルのツール使用後イベントを同じ
`aidlc-rebuild-stage-graph.ts` へ転送します。Kiro IDE はシェルコマンドを提示しないため、
そのアダプターは `source: "ide-audit-sync"` を送り、フックはコマンドフィルターを飛ばして
監査ログの末尾でゲートし、`runtime-graph.json` がすべての監査シャード以上に新しい場合は
コンパイルを飛ばします。

---

## 11. フラグメントのライフサイクル

ボルトごとのランタイムグラフフラグメントファイルは、メインの場所をミラーする
`<worktree>/<record>/runtime-graph.json` にあり、Git の無視対象です。
そのライフサイクルは次のとおりです。

1. **ボルト開始時に分岐。** `aidlc-bolt start --worktree --slug <slug>` は、
   状態分岐と監査分岐の後に `aidlc-runtime fragment-fork --slug <slug>` へ委譲します。
   単一読み取りプロトコルでは、`readFileSync` で 1 回だけバッファに読み込み、そのバッファを
   `writeFileSync` でフラグメントパスへ書き込み、同じバッファを標準出力エンベロープ用に
   ハッシュします。これは、分岐の途中でメインを書き換える並行コンパイルとのバイトコピー /
   ハッシュ競合を防ぎます。メインに `runtime-graph.json` がまだない場合、フラグメントは
   作業ツリーの状態カーソルを基点とする空のグラフです。
2. **ボルトの存続中に更新。** シェル実行後のコンパイルフックは、作業ツリー内の遷移を含む
   遷移クラスの監査出力ごとに発火します。各発火で、作業ツリーの監査ビューから作業ツリーの
   `runtime-graph.json`（フラグメント）を再コンパイルします。このフラグメントには、この
   ボルトの監査分岐時点でアクティブだった兄弟の `instances[]` が投入されることがあります。
   作業ツリーの監査は分岐時点のスナップショットであるため、後から開始した兄弟は
   フラグメントには現れません。
3. **ボルト完了時にマージ（ソロ／スウォーム経路）。** `aidlc-bolt complete --merge --slug <slug>` は、
   状態統合と監査統合の後に `aidlc-runtime fragment-merge --slug <slug>` へ委譲します。
   この処理は標準出力による可観測性のためフラグメントをハッシュし、`unlinkSync` で
   削除して JSON エンベロープを出力します。親のシェル呼び出しが戻ると、コンパイルフックは
   メインで再発火し、マージ直後のステージ識別子に対する `instances[]` が投入されたメインの
   ランタイムグラフを再構築します。
4. **多層防御としての削除。** `aidlc-worktree merge` と `aidlc-worktree discard` はどちらも
   `git worktree remove` を呼び出し、結果としてフラグメントも削除されます。フラグメント統合の
   明示的な削除と暗黙的なクリーンアップの組み合わせは、状態統合と `git worktree remove`
   が状態側ですでに組になっている方法を踏襲した、多層防御パターンです。
5. **失敗モード。** `fragment-fork` の失敗（作業ツリー不在、フラグメントがすでに存在、
   バイトコピーの IO エラー、プロセス起動タイムアウト）では、診断ツールによる原因帰属のため
   `aidlc-bolt` が `Reason: fragment-fork-*` フィールドを持つ `BOLT_FAILED` を出力します
   （IO / ガードエラーは `fragment-fork-failed`、プロセスへの SIGTERM は
   `fragment-fork-timeout`）。状態分岐と監査分岐はロールバック**されません**。
   それぞれがすでに自身の監査行を出力しているためです。監査統合がすでに反映された後の
   フラグメント統合の失敗では、`BOLT_COMPLETED → STATE_MERGED → AUDIT_MERGED → BOLT_FAILED (Reason: fragment-merge-*)`
   の順という通常とは異なる部分成功の監査シグネチャが生成されます（IO / ガードエラーは
   `fragment-merge-failed`、プロセスへの SIGTERM は
   `fragment-merge-timeout`）。フラグメントファイルは、暗黙的な `git worktree remove` の
   クリーンアップまで残存します。以後メインに対するコンパイルでは整合したランタイムグラフが
   生成されます。この位置の BOLT_FAILED は、集約における STATE_MERGED 優先の順序がボルトの
   コンテンツがすでにメインへ伝播済みであることを反映するため、インスタンスを `"approved"` と
   評価します。ここでの BOLT_FAILED は回復テレメトリーであり、接続点を記録するもので、
   コンテンツ自体は無傷のままです。

---

## 次のステップ

- **データプレーンをこのように構造化する理由** — `runtime-graph.json` を第 2 の
  真実のソースではなく `stage-graph.json` のミラーにする、コントロールプレーン /
  データプレーンの分離です。[プレーンアーキテクチャ](02-plane-architecture.md)を参照してください。
- **コンパイルを起動するライフサイクル** — 監査出力がコンパイルフックを駆動する、
  ワークフロー / フェーズ / ステージの遷移です。[状態機械](12-state-machine.md)を参照してください。
- **このグラフの派生元となる監査ログ** — 126イベントの分類と出力元レジストリです。
  [状態機械](12-state-machine.md)およびユーザーガイドの
  [状態と監査証跡](../guide/10-state-and-audit.md)を参照してください。
