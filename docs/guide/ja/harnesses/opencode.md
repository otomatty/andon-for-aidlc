# opencode で AI-DLC を動かす

opencode ランタイムは、フレームワークのハーネス配布の一つで、オープンソースの **opencode** ハーネス（opencode.ai）向けです。決定論的なコアは一つ、ハーネスは複数。エンジン、状態機械、監査ログ、グラフ、スウォームの審判、ラーニングゲートは、どの配布でもバイト一致です。違うのはシェルだけです。ソース／開発用のディレクトリツリーは `core/` + `harness/opencode/` から `bun scripts/package.ts opencode` で、無視されるローカル `dist/opencode/` へ **生成** されます。手で編集しないでください。

ハーネス固有の案内は `.aidlc/onboarding.md` にあり、`opencode.json` の `instructions` が読み込みます。ルートの `AGENTS.md` は共通ブロックとして共有できますが、エンジンディレクトリが同じCopilotとは共存できません。

## 配置: ドットディレクトリは意図して 2 つ

opencode は `.opencode/tools/` と `.opencode/tool/` の下のすべての `*.ts` をカスタムツール定義として自動 import します。CLI 型のエンジンスクリプト（トップレベルの配送、`process.exit`）を import するとセッションが落ちます（opencode 1.17.18 で実機再現済み）。なのでこの配布は分割します。

- **`.aidlc/`** — AIDLC のエンジントリー（ツール、フック、スキル、エージェント、ナレッジ、スコープ、センサー、aidlc-common）。opencode はここを走査しません。出荷の `opencode.json` が `skills.paths: [".aidlc/skills"]` を登録するので、オーケストレータスキルと生成ランナーはそこで見つかります。
- **`.opencode/`** — ネイティブに消費される面だけ。14 体のペルソナサブエージェント（`agents/*.md`、`mode: subagent`）、`/aidlc` コマンド（`command/aidlc.md`）、フックアダプタプラグイン（`plugin/aidlc-opencode-adapter.ts`。opencode が自動発見）。コマンドは入力されるたびに、インストールされたスキルを自分の中へ出力します（`aidlc engine skill-text --harness-dir .aidlc`）。そのためエージェントはスキルを丸ごと受け取ります。opencode は自身のスキルツールで読み込んだスキルを 50 KiB で切り、残りをプロジェクト外の自分のデータフォルダの下に保存するためです。

## 前提条件

- **opencode ≥ 1.17** — この導入が頼るプラグインフック面（`tool.execute.before`、`tool.execute.after`、`chat.message`、`session.idle`、`experimental.session.compacting`、`shell.env`）と、プロジェクトローカルのスキル／エージェント発見。確認は `opencode --version`。
- **bun** は、ソース／開発用の `dist/` 投影を生成または実行するときだけです。ネイティブ導入と版付きリリースランタイムは、入れた `aidlc` 実行ファイル経由で配送します。
- **モデルプロバイダー** — プロジェクトの `opencode.json` とagent定義はモデルを固定しません。グローバル設定からプロバイダーとセッションモデルを継承します。balanced reviewerはmediumのreasoning variantだけを持ちます。

## インストール

### ネイティブチャネル（推奨）

```bash
tmp="$(mktemp -d)"
curl -fsSL \
  https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh \
  -o "$tmp/install.sh"
sh "$tmp/install.sh"
rm -rf "$tmp"
cd your-project
aidlc config
aidlc doctor
opencode
```

インストーラは、リリースのメタデータ、実行ファイル、全ハーネスのランタイムアーカイブを、公開された SHA-256 チェックサムに対して検証します。入れたランタイムに Bun、Node.js、Git は不要です。ハーネスの選択は `aidlc config` で行います。

Windows では `install.ps1` をダウンロードし、`& $installer` で実行します。アカウントの範囲、User PATH への自動登録、`-NoModifyPath` については [Windows でのインストール](../18-install-and-lifecycle.md#windows-powershell) を見てください。エアギャップのパッケージでは、Unix は `install.sh --from <release-directory> --offline`、Windows は `& $installer -From <release-directory> -Offline` です。

`aidlc config` は `.aidlc/`、`.opencode/`、ワークスペースシェル、`AGENTS.md`、管理対象の `.gitignore` ブロック、`opencode.json` 内の AI-DLC のエントリを投影します。それらのエントリはスキルと方法論ファイルを発見し、AI-DLC 自身の直接の `aidlc engine *` コマンドを確認なしで実行させ、`rm -r...` と `git push` の前には一度確認します。ほかのシェルコマンドはすべて、あなた自身の opencode 設定に従います。すでに `opencode.json` があるプロジェクトでは、そのモデル、プロバイダー、instructions、権限規則、コメントは残ります。AI-DLC は自分のエントリだけを足し、その 2 つの確認は `bash` マップの先頭に入るので、その後ろにあるあなた自身の規則が決めます。グローバルの opencode 設定では、シェル規則をマップとして書いてください（`"bash": {"*": "ask"}`）。opencode はグローバルの短縮形 `"bash": "ask"` を、このファイルを含むどのプロジェクトのマップででも置き換えてしまいます。グローバルの `"git *": "allow"` があっても、AI-DLC の `git push` の確認には一度出会います。「Allow always」で終わります。`aidlc config` と `aidlc doctor` は、グローバル設定に短縮形を見つけるとその旨を 1 行で伝えます。プロジェクトで opencode を始め、`/aidlc --doctor` を実行し、続けて `/aidlc` と作りたいものを。

### 版付きの手動コピー（代替）

特定リリースの `aidlc-copy-runtime-X.Y.Z.tar.gz` を、[Install and Lifecycle: コピー経路](../18-install-and-lifecycle.md#コピー経路) のとおりダウンロードして展開し、`RUNTIME_ROOT` を展開した `runtime/` ディレクトリにします。

1. 配布をプロジェクトへコピーします:

   ```bash
   cp -r "$RUNTIME_ROOT/opencode/.aidlc/"    your-project/.aidlc/
   cp -r "$RUNTIME_ROOT/opencode/.opencode/" your-project/.opencode/
   cp -r "$RUNTIME_ROOT/opencode/aidlc/"     your-project/aidlc/      # the workspace shell — a sibling of .aidlc/, not inside it
   ```

   コピー用ランタイムには `opencode.json` がないので、コピーがあなたのものを置き換えることはありません。手順 2 が、AI-DLC の欠かせない 3 つの部分をそこへ足します（ファイルがなければ書きます）。`skills.paths`（`.aidlc/skills` からのスキル発見）、`instructions`（`.aidlc/onboarding.md` のネイティブ導入案内と、方法論の glob `aidlc/active-memory/**/*.md` の両方。後者はアクティブなスペースの方法論をエンジンが git 無視でコピーしたもので、`/aidlc space <name>` が書き換えます）、AIDLC の bash エントリポイントと `.aidlc/tools/`・`.aidlc/hooks/` 下の編集に対する権限規則です。代わりに `opencode.jsonc` を使っているときは、手順 2 がそれらの部分をコメントを残したままそこへ足し、その横に `opencode.json` は作りません。アダプタが権限境界を強制します。対象はパッケージした木から埋め込んだエントリポイントで、連鎖・リダイレクト・展開・コマンド置換のない直接コマンド 1 つとして起動する必要があります。エンジンコードの編集は承認を聞きます。

2. プロジェクトから、コピーのセットアップを一度実行します:

   ```bash
   bun .aidlc/tools/aidlc.ts config --from "$RUNTIME_ROOT" --harness opencode
   ```

   最初のワークフローの前に、`AGENTS.md` と `.gitignore` の既存の内容のあとへ AI-DLC の行を足し、`opencode.json` へ AI-DLC のエントリを足します（なければ作ります）（クローンごとの監査シャードは意図してコミットします。カーソルとマシンローカルのランタイムは無視したままです）。

3. プロジェクトで opencode を始め、`/aidlc --doctor` を実行し、続けて `/aidlc` と作りたいものを。

opencode には、セッション開始フックが注入する文脈の経路がないので、引数なしの `/aidlc` 起動ではスキルが読み取り専用の status 探査を一度します。既存のワークフローは、`/aidlc --resume` と同じく止まったところから続きます（やり直し、ステージへのジャンプ、別のことをするための新規開始は、頼めばできます）。`/aidlc --resume` は探査を飛ばして直接続けます。

版付きランタイムはネイティブの `aidlc` コマンドを使います。Bun 形の投影が要るフレームワーク開発者は、リポジトリを clone し、`bun install --frozen-lockfile` と `bun scripts/package.ts` を実行し、無視されるローカル `dist/opencode/` 出力を使えます。

## 更新と版のずれ

`aidlc update` はマシンのランタイムを更新し、プロジェクトは書き換えません。`aidlc doctor` は、選んだエンジンと違うプロジェクトスタンプを出します。ワークフローの実行と実行の間に、更新をプレビューして適用します:

```bash
aidlc config --dry-run
aidlc config
```

config は管理対象のルートブロックとユーザー所有ファイルを残し、ローカルのフレームワーク編集を衝突として出します。`opencode.json` では、更新が変えるのは AI-DLC が書き、誰も変えていないエントリだけです。あなた自身のエントリと、あなたが編集した AI-DLC のエントリはそのまま残ります。ワークフローが開いている間の更新も、設定変更（`config models`、`flags`、`providers`）と同じように行われ、開いている仕事が続けられることを伝えます。アップグレードとロールバックは、プロジェクトを触らないので、ワークフロー中でも安全です。

## このハーネスで違うところ

- **質問は番号付きの散文選択肢で出ます**（構造化質問ウィジェットはありません）。正本は `[Answer]:` タグ付きの questions ファイルです。
- **フックはアダプタプラグインに乗ります。** opencode に hooks.json／settings のフック登録はありません。`.opencode/plugin/aidlc-opencode-adapter.ts` が opencode のプラグインフック瞬間を `.aidlc/hooks/` のコアフック本体（bun サブプロセスとして実行される）へ写します。ツール実行前のレビュアー読み取り範囲と AIDLC bash 境界、write／edit／apply_patch の監査 + センサー、bash での rebuild-stage-graph（エンジンエラーの正確なメッセージを TUI のトーストにも出します）、todowrite でのステータスライン同期、task でのサブエージェント記録、人のターンごとの存在 mint、コンパクション前の状態検証。
- **転送ループの強制は advisory です。** Stop の連携箇所は `session.idle` イベントです。反応であり、ブロックではありません。コアフックが `block` と答えると、プラグインは nudge プロンプトを注入してループを再開します（プラグインは自分が送ったパートの id で nudge を見分けるので、nudge があなたのターンとして数えられることはありません）。nudge は合成パートです。エージェントは読みますが、あなたのチャットには表示されません。Esc でターンを止めたとき、またはエージェントが実行を求めたコマンドを拒否したときは、あなたが再び書くまで nudge は続きません。会話中、または一時停止している人は、フックの対話上限で解放されます。
- **`/aidlc` は入力したとおりに表示されます。** opencode はコマンドのテンプレート全体をあなたのメッセージとして表示してしまいます。プラグインはテンプレートをエージェント向けに保ち、代わりにあなたの `/aidlc ...` の行を表示します。
- **あなたが入力したものだけがあなたの返答です。** opencode があなたのエディターで開いているファイルや選択範囲をメッセージに加えるとき（Zed のターミナル、またはエディター拡張を入れた VS Code のターミナル）、エージェントにはそれも見えますが、AI-DLC はあなたが入力したものだけをあなたの言葉として残します。
- **ペルソナはネイティブサブエージェントです**（`mode: subagent`）。コンダクターはほとんどのステージでインラインにまとい、サブエージェントステージ 2 つ（2.1 reverse-engineering、3.5 code-generation）では `task` ツールで委譲します。ネイティブの権限マップが `task` を拒否するので、委譲されたエージェントは再委譲できません。プラグイン合成は、プラグインペルソナにも同じ `.opencode/agents/` の双子を出します。
- **スペース切り替えは JSONC を残します。** `/aidlc space <name>` は `opencode.json` でも `opencode.jsonc` でも方法論グロブを更新し、コメントも末尾カンマも剥がしません。明示のペルソナメモリパスも揃えたままです。
- **Construction スウォームは task ツールの fan-out だけです**（`AIDLC_USE_SWARM=1` は目立つ no-op — Workflow ツールはありません）。
- **セッション終了の瞬間はありません** — `SESSION_ENDED` 監査イベントは出ません。コンパクション前の検証は発火します（`experimental.session.compacting`）。
- **ステータスライン／ウェルカムメッセージはありません** — `/aidlc --status` と、ゲートの進捗行を使ってください。
- **MCP サーバー**: 同梱はありません。必要なら `opencode.json` の `mcp:` の下に自分で設定してください。

## 導入の確認

```bash
aidlc doctor                               # native install
bun .aidlc/tools/aidlc-utility.ts doctor   # source/development copy
opencode run --command aidlc -- "--status"  # /aidlc --status through the harness
```

doctor の opencode 固有検査: `.opencode/plugin/` にアダプタプラグインがあること、プロジェクトルートに `opencode.json` か `opencode.jsonc` があること、`.opencode/command/aidlc.md` があること。
