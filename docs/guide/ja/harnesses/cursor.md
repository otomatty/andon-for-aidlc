# Cursor で AI-DLC を動かす

Cursor ランタイムは、フレームワークのハーネス配布の一つで、対象は [Cursor](https://cursor.com) です。1 つのディレクトリツリーが **Cursor IDE** と **Cursor CLI**（`agent`）の両方に効きます。読む `.cursor/` の発見は同じです。決定論的なコアは一つ、ハーネスは複数。エンジン、状態機械、監査ログ、グラフ、スウォームの審判、ラーニングゲートは、どの配布でもバイト一致です。違うのはシェルだけです。ソース／開発用のディレクトリツリーは `core/` + `harness/cursor/` から `bun scripts/package.ts cursor` で、無視されるローカル `dist/cursor/` へ **生成** されます。手で編集しないでください。

固有の導入案内は `.cursor/rules/aidlc-onboarding.mdc` が `alwaysApply: true` で読み込みます。ルートのAGENTS.mdはハーネス共通で、エンジンディレクトリが異なるハーネスと共有できます。手動コピー版のinstallerは単一ハーネス用で、専用の `AIDLC CURSOR` マーカーを使い、configの所有権基準を保存しません。複数ハーネスへCursorを追加する場合は `aidlc config --harness cursor` を使います。コピーinstallerはconfig管理済みのrootブロックを拒否します。

## 配置

Cursor はいまのところいちばん「ネイティブ」な移植です。標準のコア投影をそのまま消費します（`emit.ts` も、分割したドットディレクトリもありません）。配布は次です。

- **`.cursor/`** — フレームワークのディレクトリツリー。Cursor がネイティブの意味で読むサブディレクトリは一部だけです。`rules/`（常設 1 とフェーズ方法論ポインタ 4）、`agents/`（ネイティブサブエージェントとしてのペルソナ 14 体）、`skills/`（オーケストレータ、ユーティリティショートカット、生成したステージランナー）、`hooks.json` + `hooks/`（フック配線とアダプタ）、`cli.json`（権限）、`mcp.json`（MCP サーバー。足した場合）。隣のエンジンディレクトリ（`tools/`、`aidlc-common/`、`knowledge/`、`sensors/`、`scopes/`）は Cursor が直接実行しないデータで、同じディレクトリを安全に共有します。
- **`aidlc/`** — ワークスペースシェル（エンジンが読む、あらかじめ組んである `aidlc/spaces/default/memory/` の方法論ツリー）。`.cursor/` の兄弟です。
- **`AGENTS.md`** — プロジェクトルートの常設指示。Cursor が自動で読みます。

## 前提条件

- **Cursor** — IDE、または Cursor CLI（導入方法は `curl https://cursor.com/install -fsS | bash`。起動は `agent`）。どちらもこの導入の `.cursor/` 面を読みます。確認済みは cursor-agent 2026.07。フック（`.cursor/hooks.json`）とスキル（`.cursor/skills/`）は現行ラインの機能です。
- **bun** は、ソース開発、または任意の手動コピー用 `install.ts` ヘルパーのときだけです。入れたあと、ネイティブと版付きリリースランタイムは `aidlc` を起動します。
- **名前付きモデルには有料の Cursor プラン** — Free アカウントが使えるのは `Auto` だけです。ティア付きペルソナの面は **モデルピン無し** で出荷します（Cursor では全ティアが null へ投影します。モデルの可用性はプラン次第です）。どのエージェントもセッションモデルを継ぎます。ヘッドレス CLI で `--model` を渡す実行は、それを許すプランが要ります。Bedrock BYOK は IDE だけです。Pro は静的キー、Teams は IAM ロール（Cursor のモデル設定に対する文書確認であり、ここでは実機確認していません）。CLI はモデルを Cursor 自身のバックエンド経由で回します。

## インストール

### ネイティブチャネル（推奨）

[Install and Lifecycle](../18-install-and-lifecycle.md) のとおりネイティブコマンドを入れたあと:

```bash
cd your-project
aidlc config --harness cursor
aidlc doctor
```

Cursor は git リポジトリにないフォルダではプロジェクトのフックを飛ばすことがあり、フックがないとあなたの承認は記録されません。プロジェクトがまだ git リポジトリでなければ、Cursor で開く前にその中で `git init` を実行してください（Cursor がすでに開いていれば完全に再起動します）。git リポジトリがないときは、`aidlc config`、コピーインストーラ、`/aidlc --doctor` のどれもがそう伝えます。

### 版付きの手動コピー（代替）

特定リリースの `aidlc-copy-runtime-X.Y.Z.tar.gz` を、[Install and Lifecycle: コピー経路](../18-install-and-lifecycle.md#コピー経路) のとおりダウンロードして展開し、その版付き投影を入れます:

```bash
bun "$RUNTIME_ROOT/cursor/install.ts" your-project
```

インストーラはコピー全体を事前点検し、プロジェクト所有の衝突は拒否し、`.cursor/.gitignore` と既存の方法論メモリは残し、`.cursor/hooks.json` と `.cursor/cli.json` は構造マージし、既存の `AGENTS.md` と `.gitignore` には印付きの AI-DLC 節を足して置き換えません。フレームワーク所有は `.cursor/aidlc-install.json` に記録します。再実行は管理ファイルを上げつつ、`aidlc/active-space` と明示のプラグイン選択／合成状態を残し、そのスペースを変更可能なルールとペルソナポインタすべてへ再適用します。削除から戻したファイルも含みます。プラグイン合成のステージファイルが残るのは、寄与サイドカーか seam sentinel がそのステージを識別するときだけです。インストーラは残した管理パスをすべて出します。無関係なコアステージは、通常の receipt-hash 衝突／アップグレード処理へ進みます。`aidlc/` シェルは、エンジンが読むあらかじめ組んである `aidlc/spaces/default/memory/` の方法論ツリーを同梱します。ないと `/aidlc --doctor` の "workspace shell ready" 検査が落ちます。

プロジェクトを Cursor IDE で開く（またはその中で `agent` を始める）と、`/aidlc --doctor` を実行し、続けて `/aidlc` と作りたいものを。ネイティブのユーティリティショートカットは `/aidlc-status`、`/aidlc-jump --stage <slug>`（または `--phase <name>`）、`/aidlc-scope <name>` です。

## このハーネスで違うところ

- **質問は番号付きの散文選択肢で出ます**（構造化質問ウィジェットはありません）。正本は `[Answer]:` タグ付きの questions ファイルです。
- **フックは `.cursor/hooks.json` に乗ります。** AIDLC アダプタ（`.cursor/hooks/aidlc-cursor-adapter.ts`）が Cursor の camelCase フックイベント（`sessionStart`、`sessionEnd`、`beforeSubmitPrompt`、`preToolUse`、`postToolUse`、`postToolUseFailure`、`preCompact`、`stop`）を、バイト共有のコアフック本体（bun サブプロセスとして実行される）へ写します。人のターンごとの人のターン記録、ツール実行前の状態遷移・レビュアー読み取り範囲・レビュー凍結・計画承認ガード、write／edit の監査 + センサー、失敗した Task の帰属掃除、シェルでのステージグラフ再構築、コンパクション前の状態検証。**PreToolUse ガード** は Cursor の `{"permission":"allow"|"deny"}` stdout 経路で答えます（`deny` は `agent_message` を足せます）。登録は `failClosed: true` です。空の stdout は不正な JSON なので、IDE は呼び出しを止めます。壊れた入力も操作を拒否します。ないガードやクラッシュしたガードは、ほかのどのハーネスとも同じく何も拒否せず、`doctor` がそれを名指しします。Cursor はシェルツールを `Shell` と呼びます。アダプタはそれをコアフックの `Bash` へ写します。ファイルを `path` に持って `StrReplace` として届く編集は `Edit` として扱われるので、ほかの編集と同じように記録・検査されます。Cursor の第一級 `Delete` ツール（このハーネス固有 — ほかでは削除はシェル経由）は、レビュアー範囲ガードへ書き込みとして出します。ユニット範囲のレビュアーが兄弟ユニットの成果物を消せないようにするためです。シェルペイロードの入れ子 `cwd`／`working_directory` 欄は共有ガード契約へ昇格するので、相対の読み書きは Cursor が実行する場所で検査されます。
- **転送ループの強制は advisory です。** Cursor の `stop` フックは stop を拒否できないので、コアフックが `block` と答えたとき、アダプタはフォローアップの nudge を出します（opencode と同じ姿勢です）。ホストの `loop_limit` は Cursor 既定の 5 ではなく 10 で、コアの自律 no-progress 上限 8 をカバーします。本物の規律はコンダクタースキルの転送ループです。
- **バックグラウンドエージェントは脇の作業者です。** 前面のチャットでワークフローが動いている間に始めた Cursor のバックグラウンドエージェント（レビュー、テスト実行、コード変更）は、そのワークフローから外されます。セッション開始時にはワークフロー文脈の代わりに短い注記を受け取ります。ワークフローは前面のチャットのものであり、`/aidlc` や AIDLC のワークフローコマンドを実行しないこと、`aidlc/` や `.cursor/` 下の AIDLC 自身のファイル（フック、ツール、スキル、エージェント、`aidlc` ルール）を編集しないこと、という内容です。`.cursor/mcp.json` のようなあなた自身の Cursor 設定は構いませんし、読み取りと `bun .cursor/tools/aidlc.ts status` も構いません。その停止には転送の nudge が付かず、そのプロンプトが人のターンとして数えられることはなく、そのセッション終了は記録されません。何もブロックはされません。ガードは注記だけなので、それを無視したエージェントはワークフローを動かせてしまいます。どのハーネスでも 2 つ目のセッションがそうできるのと同じです。Cursor がバックグラウンドエージェントに印を付けるのは `sessionStart`、`beforeSubmitPrompt`、`sessionEnd` だけなので、アダプタはその印を会話の後の停止のために `aidlc/.aidlc-cursor-subagents/` に記録し、`sessionEnd` で消します。記録を書けないときは、エージェントは通常どおり動き、その停止には前面向けの nudge が付きます。
- **本物のセッション終了の瞬間があります**（Codex と違う）: `sessionEnd` が発火するので、`SESSION_ENDED` 監査イベントが出ます。コンパクション前の検証も発火します（`preCompact`）。
- **ペルソナはネイティブサブエージェントです。** `.cursor/agents/` のペルソナ `.md` 14 ファイルは frontmatter の `name` で発見されます。コンダクターはほとんどのステージでインラインにまとい、サブエージェントステージ 2 つ（2.1 reverse-engineering、3.5 code-generation）では `task` ツールで委譲します。ワーカーエージェントに `task` ツールは付かないので、デリゲートは再委譲できません。
- **サブエージェントの識別情報は再構成します。** Cursor はフックペイロードにサブエージェントごとの識別情報を出しません（文書上の `subagentStart`／`subagentStop` イベントは、CLI では一度も発火しません）。なのでアダプタは、保護したプロジェクトローカルのランタイム台帳 `aidlc/.aidlc-cursor-subagents/` と、独立した `aidlc/.aidlc-cursor-subagent-*.json` のアクティブ委譲証人を持ちます。トップレベルの会話は `sessionStart`／`beforeSubmitPrompt` で自分を登録します（サブエージェントの会話にはどちらのイベントも来ません）。各 Task 起動がエージェントを記録し、レビュアー読み取り範囲の強制は、トップレベルセッションとして登録されていない会話からの呼び出しに帰属します。親の次の同期 Task ディスパッチが、直前の記録を引退させてログします（Cursor CLI は Task の `postToolUse` を出しません）。本物の親をまたぐ曖昧さは、レビュアーが動作している間保守的なままです。レビュアー範囲の強制を殺せないようにするためです。委譲されたツールは台帳にもディスパッチ記録にも届きません。祖先削除や、引用していないシェルグロブ／文字クラスパス経由も含みます。主台帳がない、または読めないときに委譲証人が生きていれば、委譲エージェントの帰属を失うよりフェイルクローズします。デリゲートは普通の Shell コマンドは使えますが、汎用インタプリタと動的なコマンド評価は拒否します。Cursor ネイティブの read／search ツールを使い、実行可能な探査は親の会話に任せてください。デリゲートに渡される AI-DLC 自身のコマンド（Reverse Engineering の範囲フィンガープリントとその検査など）は、指示に書かれたとおりに、一度に一つの素のコマンドとして実行されます。これらのデリゲート制限が効くのは、その作業についてレビュアー読み取り範囲か状態遷移の検査が有効な間だけです。両方が退くと（Guard Policy off がそうします）、デリゲートはメインの会話と同じようにビルド、テスト、検索を実行し、記録を書けなくても Task は始まり、Cursor 自身の承認が適用されます。
- **生成したステージ／スコープランナーは明示だけです。** Cursor は生成ランナースキル（プラグインランナーも含む）に `disable-model-invocation: true` を付けるので、普通のコーディングプロンプトが状態を変えるワークフローショートカットを自動起動しません。
- **ユーティリティショートカットはネイティブスキルです。** `/aidlc-status`、`/aidlc-jump`、`/aidlc-scope` はスラッシュメニューの発見を良くし、エンジン経路を二つにしません。どれも `disable-model-invocation: true` を持ちます。Cursor が起動するのは、人が選んだときだけです。レガシーの `.cursor/commands/` 面は出荷しません。
- **方法論ルールは読み取り指示であり、import ではありません。** Cursor のルールは `@`-import 行を展開しません。`.cursor/rules/aidlc.mdc` は常に適用され、アクティブスペースの org／team／project ファイルを指します。`.cursor/rules/aidlc-phase-*.mdc` 4 本はエージェントが決めて、当たるときだけ対応するフェーズファイルを指します（cursor-agent で実機確認済み: フェーズを枠にしたプロンプトは一致するフェーズルールだけを載せ、無関係なプロンプトはどれも載せません）。`sessionStart` フックは別に、進行中のワークフロー文脈を注入します。ルールファイル 5 本はすべて `aidlc/active-memory/` を読みます。これはアクティブスペースの方法論をエンジンが git 無視で複製したものです。`/aidlc space <name>` はルールではなく、その複製を書き換えます。
- **Construction スウォームは task ツールの fan-out だけです**（`AIDLC_USE_SWARM=1` は目立つ no-op — Workflow ツールはありません）。
- **ステータスライン／ウェルカムメッセージはありません** — `/aidlc-status`（または `/aidlc --status`）と、ゲートの進捗行を使ってください。
- **Tab 補完はこの導入では触りません** — 設定に関係なく Cursor 自身のモデルに乗ります。
- **権限**: `.cursor/cli.json` が事前承認するのは AI-DLC 自身のワークフローコマンドだけです。エンジンコマンド、`doctor`、`version`、`status`（およびその `--doctor`、`--version`、`--status` の綴りと、`--verbose` 付きの doctor）、`config --help`、`config --show` と読み取り専用の `config <section> --show`（`--json` の有無を問わず）および `--help` 形、検査を再び有効にする操作（`config flags --clear-bypass <switch> --yes`）、そして `aidlc-*.ts` ツールです（プロジェクト単位の `cli.json` が運ぶのは権限だけ）。ネイティブ導入では、インストールした `aidlc` コマンドとして実行する同じコマンドと、`aidlc engine ...` を事前承認します。ほかのシェルコマンドは Cursor の承認設定に従います。ほかの `config` の変更（検査を無効にする操作も含む）、マシンの AI-DLC 導入を変えるコマンド（`use`、`update`、`rollback`、`uninstall`、`system`）、およびそれらの背後のツールスクリプトもそうです。
- **MCP サーバー**: 同梱はありません。必要なら `.cursor/mcp.json` の下に自分で設定してください。
- **ヘッドレスの `agent -p` 実行は承認ゲートを越えられません。** 人の存在 mint は `beforeSubmitPrompt` に乗ります。Cursor がこれを発火するのは対話の送信だけです（cursor-agent 2026.07 で確認済み）。なので print モードの実行は `HUMAN_TURN` を残さず、ゲート付きステージはその承認を設計どおり拒否します。無人のモデルが自分の仕事を承認しないためです。ヘッドレスは読み取り専用ユーティリティ（`--status`、`--doctor`、`--version`）と、自律 Construction（ゲートに人がいないので免除）に使ってください。ゲート付きワークフローは対話の Cursor セッションで実行します。これはフレームワークの存在ゲートの性質であり、Cursor の制限ではありません。どのハーネスも人のプロンプトイベントから存在を発行します。
- **セッション内の設定は対話です。** Cursor のチャットで `/aidlc --config [section]` を使い、コンダクターが選択を集めてから、正確で決定論的な config フラグを着地させます。

## 導入の確認

```bash
bun .cursor/tools/aidlc-utility.ts doctor        # all checks pass on a fresh copy in a git repository
agent -p "/aidlc --status" --output-format text --trust   # /aidlc --status through the CLI
```

doctor の Cursor 固有検査: `.cursor/hooks.json` のフック配線、`.cursor/cli.json` の AI-DLC コマンド向け権限事前承認、`.cursor/rules/aidlc.mdc` の常設ルール、フェーズルールポインタ 4 本すべて、そしてプロジェクトが git リポジトリにあるかどうか。

> **スクリプティングの罠: Cursor CLI は常に exit 0 です。** ヘッドレスの `agent -p "<prompt>" --output-format text --trust` は、実行がエラーでも exit code 0 を返すので、CI 検査は exit status ではなく出したテキストを見なければいけません。名前付きモデル（`--model`）には有料プランが要ります。無ければ `Auto` を使ってください。

## 次のステップ

導入と動作確認が済んだら、方法論の説明へ進みます。方法論はどのハーネスでも同じです。ハーネス非依存の章へ進んでください。

- [最初のワークフロー](../02-your-first-workflow.md) — 注釈付きの通し実行。
- [フェーズとステージ](../04-phases-and-stages.md) — 5 フェーズと 33 ステージ。
- [スコープ・深度・テスト戦略](../05-scopes-and-depth.md) — 作業に合う実行範囲の選び方。
- [用語集](../glossary.md) — 用語の定義。

ほかのハーネス: [opencode で AI-DLC を動かす](opencode.md) · [ハーネス一覧](README.md)。
