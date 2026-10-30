# Kiro CLI で AI-DLC を動かす

> [!NOTE]
> Kiro CLI では **Claude Opus 4.8** がいちばん安定します。**有料の Kiro プラン** が必要です。弱いモデルでは、コンダクターが任意のステージ段（レビュアーの通過、ラーニングの手順）を飛ばしたり、承認ゲートを急いだりすることがあります。IDE 向けの配布は [Kiro IDE で AI-DLC を動かす](kiro-ide.md) に別途あります。

> [!IMPORTANT]
> このページは `kiro` ハーネスを扱います。このハーネスは Kiro のエンジンをピンしません。対話型の `aidlc config` はこれを Kiro CLI (V2) として一覧し、Kiro CLI 2.24.1 以降を検出すると、Kiro より優先して既定にします。ただし Kiro IDE 自身のターミナルでは Kiro が先頭です。Kiro CLI 2.24.1 以降で Kiro の v3 エンジンを使うには、Kiro として一覧される `kiro-ide` ハーネスを使ってください。このハーネスはそのエンジンをピンし、Kiro IDE だけでなく Kiro CLI でも動きます。既存の `kiro` プロジェクトでは、`aidlc config --harness kiro-ide` が `.kiro/` をその場で切り替え、`aidlc/` は残します。

フレームワークのハーネスの一つです。Kiro ランタイムは、同じ AI-DLC 方法論を [Kiro CLI](https://kiro.dev/docs/cli/) で実行します。決定論的なコア — ツール、ステージファイル 33、プロトコル、ナレッジ、センサー、スコープ、ルール — はどのハーネスでもバイト共有です。違うのはシェル（スキル、エージェント設定、フック配線、起動）だけです。

固有の案内は `.kiro/steering/aidlc-onboarding.md` をconductorのresourcesから読み込みます。ルートのAGENTS.mdは共通ですが、エンジンディレクトリが一致する `kiro` と `kiro-ide` の行は1つの `.kiro/` に同居できません。

## 前提条件

- **Kiro CLI ≥ 2.6**（`kiro-cli --version`）、ログイン済み（`kiro-cli login`）
- **bun** は、ソース／開発用の `dist/` 投影を生成または実行するときだけです。ネイティブ導入と版付きリリースランタイムは自己完結です。

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
```

インストーラは、リリースのメタデータ、実行ファイル、全ハーネスのランタイムアーカイブを、公開された SHA-256 チェックサムに対して検証します。入れたランタイムに Bun、Node.js、Git は不要です。ハーネスの選択は `aidlc config` で行います。

Windows では `install.ps1` をダウンロードし、`& $installer` で実行します。アカウントの範囲、User PATH への自動登録、`-NoModifyPath` については [Windows でのインストール](../18-install-and-lifecycle.md#windows-powershell) を見てください。エアギャップのパッケージでは、Unix は `install.sh --from <release-directory> --offline`、Windows は `& $installer -From <release-directory> -Offline` です。

`aidlc config` は、最初のチャットセッションの前に Kiro シェルを投影します。それからプロジェクトルートで Kiro を始めてください:

```bash
kiro-cli chat
```

ネイティブ投影は `aidlc engine *` のエンジンコマンドと、読み取り専用および再有効化のための決まったコマンド（`aidlc doctor`、`aidlc config <section> --show --json`、および後述のセッション開始の項に挙げるもの）を許可します。`.kiro/settings/cli.json` に `chat.defaultAgent: "aidlc"` も出荷するので、エージェントフラグ無しで `/aidlc` が有効です。最初のワークフローの前に、チャットで `/aidlc --doctor` を実行してください。

### 版付きの手動コピー（代替）

特定リリースの `aidlc-copy-runtime-X.Y.Z.tar.gz` を、[Install and Lifecycle: コピー経路](../18-install-and-lifecycle.md#コピー経路) のとおりダウンロードして展開し、`RUNTIME_ROOT` を展開した `runtime/` ディレクトリにします。

```bash
mkdir -p your-project/.kiro your-project/aidlc
cp -R "$RUNTIME_ROOT/kiro/.kiro/." your-project/.kiro/
cp -R "$RUNTIME_ROOT/kiro/aidlc/." your-project/aidlc/    # the workspace shell (spaces/default/memory) — a sibling of .kiro/, not inside it
cd your-project && bun .kiro/tools/aidlc.ts config --from "$RUNTIME_ROOT" --harness kiro
```

`aidlc/` ディレクトリはワークスペースシェルです。エンジンが読む、あらかじめ組んである `aidlc/spaces/default/memory/` の方法論ツリーを同梱します。`.kiro/` の **兄弟** なので、別途コピーします（または `$RUNTIME_ROOT/kiro/` 一式をまとめてコピーします）。ないと `/aidlc --doctor` の "workspace shell ready" 検査が落ちます。

版付きランタイムはネイティブの `aidlc` コマンドを使います。Bun 形のソース投影が要るフレームワーク開発者は、リポジトリを clone し、`bun install --frozen-lockfile` と `bun scripts/package.ts` を実行し、無視されるローカル `dist/kiro/` 出力を代わりに使えます。

出荷の `.gitignore` は、ワークスペースのコミット／無視の分け方を持ちます。ユーザーごとのカーソル（`aidlc/active-space`、`aidlc/spaces/*/intents/active-intent`）とマシンローカルのランタイム（`aidlc/.aidlc-clone-id`、`runtime-graph.json`、センサーキャッシュ、`spaces/*/knowledge/.sources.local.json`）は未追跡のまま、共有の記録 — 方法論メモリ、状態、監査シャード、成果物 — は git に乗ります。最後の行、つまりコピーのセットアップが、それらの行と `AGENTS.md` の AI-DLC 部分を、ファイルの既存の内容のあとへ足します（プロジェクトにファイルがなければ作ります）。これで最初のワークフローの前に AI-DLC 規則が入ります。

そのあと、プロジェクトでセッションを始めます:

```bash
cd your-project && kiro-cli chat
```

導入は `.kiro/settings/cli.json` に `chat.defaultAgent: "aidlc"` を出荷するので、AI-DLC のコンダクターエージェントが既定で有効です。`/aidlc` はそのまま動きます。**このワークスペース設定は、グローバルに設定した既定エージェントより優先されます。** 自分の既定を残したいなら、その設定を外し、代わりに `kiro-cli chat --agent aidlc` を使ってください。

Kiro CLI は、進捗を示さないヘルパー（レビュアー、ペルソナ、Unit のビルダー）を `api.subagentTimeout` 秒で取り消します。既定は 3600 で、AI-DLC はこれを設定しません。起動しないヘルパーがステージを 1 時間止めるなら、自分の Kiro CLI 設定（`~/.kiro/settings/cli.json`。`900` で 15 分）で下げられます。出力は進捗に数えますが、沈黙は数えません。コマンドがそれより長く何も出力しないヘルパーも取り消され、コマンドはそのまま単独で走り続けます。そのため期限は、いちばん長く黙るコマンド（デプロイや、最後にしか出力しないテスト実行）より長く保ってください。

出荷のエージェントはモデルをピンしません。ピンした ID は、そのモデルが利用者の Kiro 導入で有効なときだけ解決します。チャットと、コンダクターがディスパッチするペルソナ 14 体はそれぞれ、セッションモデル、つまり Kiro 設定に保存したモデル（何も保存していなければ Kiro auto）で始まります。`/model` は今いるチャットだけを変えるので、コンダクターはそれに従いますが、ペルソナは保存したモデルで始まったままです。ペルソナも移すには、`/model set-current-as-default` で切り替えを保存するか、`aidlc config models --session-model <id>` でモデルを選んでください。

### セッションのモデルと effort

Kiro CLI は各 AI-DLC セッションを一つのモデルで実行し、エージェント単位の effort 面を持ちません。そのため AI-DLC は、セッションのモデルと effort を、プロジェクトではなくあなたの **個人の** Kiro 設定（`~/.kiro/settings/cli.json`。Kiro 自身の `/model set-current-as-default` が書くファイル）に置きます。モデルの一覧は Kiro アカウントごとに違い、チームメイトのアカウントにないプロジェクトモデルは、その人が送るすべてのプロンプトを失敗させます。プロジェクトの `chat.modelDefaults` は、プロジェクト内であなたの個人のマップ全体も置き換えてしまうので、同梱の `cli.json` はそれを持ちません。

初回セットアップの手順 2「Session model」は、あなたの Kiro アカウントが提供するモデルを Kiro の順序で、各モデルのクレジット倍率と `preview` または `internal` のタグ付きで並べます。Kiro auto（Kiro 自身の既定で、タスクごとに Kiro がモデルを選ぶ）のもとでは、AI-DLC はモデルを選ぶことを勧めます。そうすれば effort プリセットがそのモデルに効きます。プリセットは対話セッション全体に一つの effort を設定します（Kiro CLI 2.28.0 は `kiro-cli chat --no-interactive` の実行に保存した effort を適用しないので、そこでは `--effort` を渡してください）:

| プリセット | セッションの effort |
|--------|----------------|
| `minimal` | `low` |
| `balanced` | `medium` |
| `thorough` | `xhigh`（extra-high） |

その段階を持たないモデルには一つ下の段階が適用され、effort 設定を持たないモデルではモデルだけが残ります。推奨既定値が effort を埋めるのは、あなたがそのモデルに effort を保存していない場合だけです。保存済みの effort はそのまま残り、それがプリセットと違うときはセットアップが 1 行でそう伝えます。自分でプリセットを選ぶと（手順 3 または `aidlc config models` で）、あるいは `aidlc config models` でセッションモデルを選ぶと、プリセットの effort が設定されます。エージェントやグループの設定はそれに触れません。`aidlc config models` は後から同じ選択を出し（「1 session model, 2 preset」）、`aidlc config models --session-model <id>` はアカウントの一覧にあるモデルを確認なしで保存します。保存したモデルをアカウントがもう提供していないと、すべてのプロンプトが失敗するので、セットアップはそれを残さず別のモデルを尋ねます。`--dry-run` は個人の Kiro 設定の変更も表示し、何も書きません。Kiro が書き込みを拒んだときは、AI-DLC は何が保存されたかを正確に伝え、`config models` は終了コード 5（対応が必要）で終わります。`aidlc doctor` は実際の設定を検査します。モデルがまだ提供されていること、保存された effort がそのモデルの提供する段階であること（プリセットが記録され、Kiro がそのモデルの effort 段階を一覧する場合）、プロジェクトのファイルがそれを上書きしていないことです。あなたが保存した、プリセットと違う effort はあなたのものです。doctor は警告せずに、プリセットの段階とそれを適用するコマンドを示します。以前のリリースで設定したプロジェクトを更新すると、`.kiro/settings/cli.json` から AI-DLC の古い effort マップ（extra-high の `claude-opus-4.8`）を取り除き、その旨を伝えます。セッションモデルを選ぶには `aidlc config models` を実行してください。1 セッションだけ上書きするには、チャットの `/effort <level>`、または `kiro-cli chat --effort <level>`（low|medium|high|xhigh|max）を使います。Kiro IDE は `cli.json` を読みません。

## 更新と版のずれ

`aidlc update` はマシンのランタイムを更新し、プロジェクトファイルは変えません。`aidlc doctor` は、選んだエンジンと違うプロジェクトスタンプを出します。ワークフローの実行と実行の間に、更新をプレビューして適用します:

```bash
aidlc config --dry-run
aidlc config
```

config はユーザー所有の内容を残し、ローカルのフレームワーク編集を衝突として出します。ワークフローが開いている間の更新も行われ、開いている仕事が続けられることを伝えます。アップグレードとロールバックは、プロジェクトを変えないので、ワークフロー中でも安全です。

## 使い方

プロジェクトで `kiro-cli chat` を始め、`/aidlc <description>` でコンダクターを起動します。`/aidlc --status` が位置を出し、`/aidlc --config [section]` はセッション内でプロジェクト設定の変更を集めます。`/aidlc --doctor`、`--stage`、`--phase`、`--depth`、`--test-strategy` もすべて動きます。ワークスペースの移動は `/aidlc intent [name]`、`/aidlc space [name]`、`/aidlc space-create <name>` です。ステージごと（`/aidlc-domain-design`）とスコープごと（`/aidlc-feature`）のランナースキルも入っています。

status、doctor、help、version、ワークスペース移動のコマンドは、モデルがそれらをワークフローの仕事に変える前に Kiro フックが配送します。子の出力は UTF-8 としてデコードし、端末プロトコル／制御バイトは、そのプレーンテキスト中継の境界だけで取り除きます。普通の Unicode、パス、タブ、改行、エスケープに見えるリテラルはそのままです。

**セッションはプロジェクトルートから始めてください。** ネイティブ導入は、入れた `aidlc engine ...` コマンドと、次に挙げる読み取り専用および再有効化のコマンドを `aidlc ...` として書かれたとおりに実行する場合に限り、事前承認します。ソース／開発コピーが事前承認するのは、プロジェクト相対で実行する AI-DLC 自身のワークフローコマンドだけです。エンジンコマンド（`bun .kiro/tools/aidlc.ts engine ...`）、読み取り専用の `doctor`、`version`、`--version`、`--doctor`（`--verbose` の有無を問わない doctor）、`status`、`--status`、`config --help`、`config --show` と `--json` の有無を問わない `config <section> --show`、`config <section> --help`、`config flags --clear-bypass <switch> --yes` による検査の再有効化、そして AI-DLC のツールスクリプト（`bun .kiro/tools/aidlc-<tool>.ts`）です。ほかの `config` の変更（検査を無効にする操作も含む）、マシンの AI-DLC 導入を変えるコマンド（`use`、`update`、`rollback`、`uninstall`、`system`）とその背後のツールスクリプト（`aidlc-doctor.ts`、`aidlc-init.ts`、`aidlc-lifecycle.ts`、`aidlc-machine-config.ts`）、絶対パス、`KIRO_PROJECT_DIR` 展開、事前承認されていないコマンドを足す行（前置きの `cd`、別のコマンドへのパイプや `&&`）は、引き続き確認を求めます。

**それでも確認を求めるもの。** developer エージェントと `aidlc` エージェントは、プロジェクトファイルを確認なしで書きます。対象は、トップレベルの名前がドットで始まらない、プロジェクト内のあらゆるパスです。並行ビルドでは、各 Unit のチェックアウト内のその Unit 自身の記録（`.aidlc/worktrees/<unit>/aidlc/spaces/`）も確認なしで書きます。そこでのワーカーによるコードの編集は引き続き確認を求めます。`.kiro/`（`aidlc` エージェント自身の `.kiro/sensors/` ファイルを除く）、`.git/`、その他のトップレベルのドット項目への書き込みと、プロジェクト外への書き込みは、引き続き確認を求めます。プロジェクト自身のテストやビルドのコマンド（`bun test`、`npm test`、`pytest` など）、`git push`、再帰的な削除も確認を求めるので、実行前にそれぞれを確認できます。並行ビルドでは、ワーカーとレビュアーはあなたが承認したテストコマンドを AI-DLC 自身の `swarm check` 経由で実行し、これは確認を求めません。並行ビルドのワーカーやレビュアーが確認を求めると、Kiro はその要求を "tool approval pending" の枠にまとめます。そこで (f) **Approve all pending and auto-approve future subagent requests** を選ぶと、そのチャットの残りの間、後から始まるレビュアーも含めて、要求したものを再確認なしで実行できるようになります。メインチャットからの要求はこれまでどおり確認を求め、Kiro はこれについて設定を書きません。

**承認者がいないセッションは、聞かずに止まります。** 事前承認の集合の外は、対話の答えが要ります。`kiro-cli chat --no-interactive` の下では聞く相手がいないので、Kiro は `non-interactive mode (no user to approve)` でコマンドをそのまま拒否します。ACP では、クライアントが `session/request_permission` に答える必要があります。その要求を無視するクライアントは、権限失敗と見分けが付きません。`--trust-all-tools` は、`git push` や再帰的な削除も含め、すべてのコマンドを確認なしで実行します。包括的なシェルアクセスが許せる、使い捨てサンドボックスの中だけで使ってください。

**フックは、ACP 経由も含め、Kiro CLI の v2 エンジンで動きます。** この配布はフックを `.kiro/agents/aidlc.json` に登録します。Kiro CLI は、`aidlc` エージェントが有効な間、そのブロックを v2 エンジンで実行します。`kiro-cli acp` は、`kiro-cli chat` と同じく `chat.defaultAgent` からエージェントを選びます。Kiro CLI の v3 エンジンは、AI-DLC が出荷したままのファイルを実行しません。そのため、セッションが v3 で始まった場合（たとえばクライアントが `kiro-cli acp --agent-engine v3` を起動したとき）や、別のエージェントに切り替えた場合は、これらのフックはどれも動きません。フックがないと `HUMAN_TURN` の受領記録が残らないので、承認と確認はすべて拒否されます。書き込みイベントも記録されないので、レビューも拒否されます。

Kiro 自身が出すプロンプト（たとえば、新しい kiro-cli がサブエージェントの戻り後に送る `[SYSTEM] Sub-agent synthesis:` メッセージ）は、あなたのターンとして数えません。`HOST_TURN` として記録され、どの質問への回答にもなりません。あなた自身のメッセージは、文言にかかわらず数えます。どちらがどちらかは Kiro のチャット記録が示し、不明なものはあなたのものとして扱います。最初のワークフローステージのあとは、`/aidlc --doctor` がこれを "Hooks have never executed" と報告します。それより前は、AI-DLC のフックがこのプロジェクトでまだ動いていないと doctor が警告し、同じ手順を示します。v3 エンジンで再起動しても直りません。別のエージェントを選んでいるときは、`/agent` と入力して `aidlc` を選び、同じチャットで続けてください。3.0 エンジンの場合（Kiro が返答の下に `agent "aidlc" needs upgrading for this agent engine` と表示する）は、終了して、このフォルダで代わりに `kiro-cli chat --agent-engine v2 --agent aidlc` を始めてください（ACP クライアントは `kiro-cli acp --agent-engine v2` を起動します）。Kiro CLI を v3 エンジンで動かすには、代わりに [Kiro IDE](kiro-ide.md) の配布を使ってください。既存のプロジェクトでは、`aidlc config --harness kiro-ide` が `.kiro/` をその場で切り替え、`aidlc/` は残します。[Kiro CLI のフックが動かない](../15-troubleshooting.md#kiro-cli-hooks-not-running) を見てください。

### チャットがいっぱいになってきたら

Kiro はチャットがどれだけいっぱいかをあなたに表示しますが、作業中の AI-DLC にはその数値を渡しません。そこで AI-DLC は、各ターンの終わりに Kiro がそのチャットについて保存する数値を読みます（`~/.kiro/sessions/cli/<chat id>.json`、読み取りのみ）。それが 80% 以上になると、次の承認の質問または Unit チェックポイントに、チャットがどれだけいっぱいかを伝える一行が付き、一時停止して新しいチャットで続けることを提案します。決めるのはあなたの答えです。ひとりでに一時停止することはなく、その一行は一つのチャットで一度だけ出ます。

この一行が出ないのは、ステージの途中（どのみち尋ねられる質問と一緒にしか出ません）、Kiro がそのチャットの最初のターンを保存する前、このマシンに記録がないチャット、そして Kiro の更新で Kiro の数値の保存方法が変わった場合です。Kiro 自身の数値が上がっていくのが見えたら、同じことを手で行えます。

1. ステージの境界で止めます。承認し、同じ返答の中でいったんここで止めたいと伝えるか、`/aidlc park` と入力します。`/aidlc --status` は `Paused at <stage> (you stopped it); pick it back up with /aidlc --resume` と表示するようになります。
2. `/chat new` と入力して新しいチャットにします。Kiro は古いチャットを残し、`/chat resume` で戻せます。今いるチャットをリセットする `/clear` ではなく、こちらを使ってください。
3. `/aidlc --resume` と入力します。`/aidlc --status` はもう Paused と表示しません。

古いチャットで話し合ったものの、ファイルに書かなかったことは引き継がれません。だからステージの終わりが最適なタイミングです（[ワークフロー途中でのモデル変更](../11-session-management.md#ワークフロー途中でのモデル変更) を参照）。

## Kiro で違うところ

| 領域 | Claude Code | Kiro CLI |
|------|-------------|----------|
| ゲートと質問 | `AskUserQuestion` ウィジェット | 番号付きの散文選択肢（番号で返す）。正本は `[Answer]:` タグ付きの questions ファイル |
| ステータスライン | 今のステージ + モデル + コンテキスト % | ない。`/aidlc --status` と、各ゲートの進捗行を使う。いっぱいになってきたチャットについては [チャットがいっぱいになってきたら](#チャットがいっぱいになってきたら) を参照 |
| ディスパッチステージ（2.1 パイプライン、2.2 サブエージェント、2.4 モブ、3.5 サブエージェント） | `Task` ツール | Kiro の `subagent` ツール → エージェント設定（ペルソナ 14 体すべてが設定を出荷） |
| Construction スウォーム | 並行 `Task` フロア、任意の ultracode Workflow | サブエージェントの fan-out だけ。`AIDLC_USE_SWARM=1` は no-op と告知する |
| セッション監査イベント | `SESSION_STARTED/RESUMED/ENDED`、`SESSION_COMPACTED` | `SESSION_STARTED` だけ（Kiro にセッション終了／コンパクション前フックはない） |
| 転送ループの強制（Stop フック） | 対話 + ヘッドレス | 対話セッションだけ — `--no-interactive` の実行は stop-hook のブロックを守らない |
| 権限 | `settings.json` の許可リスト | ソース生成の投影: プロジェクト相対で実行する AI-DLC 自身のワークフローコマンド（エンジン、読み取り専用のディスパッチャコマンド、AI-DLC のツールスクリプト）。ネイティブと版付きリリースランタイム: `aidlc engine *`。ほかのシェルコマンドは聞く |
| ウェルカムメッセージ | セッション開始時に `settings.json` の `companyAnnouncements` から描画 | ない — Kiro にウェルカム描画の同等はない。セッション開始フックは再開文脈だけを注入する |
| MCP サーバー | 5 つ出荷（`.mcp.json`: `context7` + AWS 系 4 つ） | 同じ 5 つを `.kiro/settings/mcp.json` に出荷。既定はすべて無効。サーバーごとに `"disabled": false` を立てて有効にする。Kiro では Context7 にキーが要らない。Kiro は設定した HTTP ヘッダ値を、環境プレースホルダを展開せずそのまま送るから。AI-DLC 自身のチャットと委譲ペルソナ 14 体は、前回 config を実行した時点でこのファイルと `~/.kiro/settings/mcp.json` にあったすべてのサーバーを得る。呼び出しのたびに先にあなたに確認する。後から追加したサーバーは、config を再実行すると届く。Kiro CLI の v3 エンジンでは、ペルソナは config を実行しなくても、2 手目からそれらのファイルのすべてのサーバーを得る。 |

それ以外 — 状態機械、監査証跡、インテントのレコードディレクトリ（`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`）の下の成果物、ラーニングの手順、センサー、スコープ、深度／テスト戦略 — は同じコアを使うため、同じ動作です。ネイティブ導入は `aidlc` 経由で配送し、ソースコピーは `.kiro/tools/` の対応ツールを実行します。

プロジェクトの `aidlc/` ワークスペースはハーネス非依存です。ハーネス間の移動（または両方を並べて実行すること）は、対応はしていますが未テストです。アクティブなワークフローがある状態で衝突するハーネス導入を見つけると、`/aidlc --doctor` が警告します。

## フレームワーク開発者向け

`dist/kiro` は `core/` + `harness/kiro/` から `bun scripts/package.ts kiro` で **生成** されます（コアのコピーで `{{HARNESS_DIR}}` トークンを `.kiro` に置換し、`rules/` → `steering/` へ名前を付け替えます）。出力は無視され、ローカルです。`bun scripts/package.ts --check` は独立した一時ルートで二度ビルドし、結果をバイト比較して CI の決定論ガードとします。手で書く Kiro の面は `harness/kiro/` にあります。オーケストレータスキル（`skills/aidlc/`）、エージェント JSON（`agents/`）、フックアダプタ（`hooks/aidlc-kiro-adapter.ts`）、`settings/cli.json`、`settings/mcp.json`、`onboarding.fills.ts` — 直すのはそれら（または `core/`）であり、生成された `dist/kiro` ではありません。[Porting to a New Harness](../../harness-engineering/09-porting-to-a-new-harness.md) を見てください。ビルドは、それらのエージェント JSON のすべてのフックコマンドに `; exit $LASTEXITCODE` を付け足します（マニフェストの `hookCommandSuffix`）。Kiro CLI は Windows では PowerShell で、それ以外では bash でフックを起動し、この形はどちらでもフックの終了コード 2 を Kiro に返すので、Windows でも拒否がツール呼び出しを止めます。

Claude の双子と並んで、実機の TUI 通しテストがあります。`tests/e2e/t-tui-kiro-intent-capture.serial.test.ts` は出荷の木に対して `kiro-cli chat` をキー入力で駆動します（番号付き散文ゲートは推奨の "1" で答え、ディスク状態で終了します）。オプトインは `AIDLC_KIRO_TUI_LIVE=1` です。tmux、`kiro-cli`、ログイン済みの Kiro セッションがないときは、理由付きでスキップします。

## 次のステップ

導入と起動が済んだら、方法論の説明へ進みます。方法論はどのハーネスでも同じです。ハーネス非依存の章へ進んでください。

- [最初のワークフロー](../02-your-first-workflow.md) — 注釈付きの通し実行。
- [フェーズとステージ](../04-phases-and-stages.md) — 5 フェーズと 33 ステージ。
- [スコープ・深度・テスト戦略](../05-scopes-and-depth.md) — 作業に合う実行範囲の選び方。
- [用語集](../glossary.md) — 用語の定義。

ほかのハーネス: [Codex CLI で AI-DLC を動かす](codex-cli.md) · [Cursor で AI-DLC を動かす](cursor.md) · [ハーネス一覧](README.md)。
