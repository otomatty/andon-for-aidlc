# Kiro IDE と Kiro CLI で AI-DLC を動かす

フレームワークのハーネスの一つです。この Kiro ランタイムは、同じ AI-DLC 方法論を [Kiro](https://kiro.dev/) の中で実行します。Kiro IDE 1.x と Kiro CLI v3 は一つのエージェントハーネスを動かし、同じ `.kiro/` ツリーを読みます。決定論的なコア — ツール、ステージファイル 33、プロトコル、ナレッジ、センサー、スコープ、ルール — はどのハーネスでもバイト共有です。違うのはシェル（スキル、エージェントの面、フック配線、起動）だけです。

ハーネス固有の導入案内は `.kiro/steering/aidlc-onboarding.md` にあり、その `inclusion: always` frontmatter で自動的に読み込まれます。ルートの `AGENTS.md` ブロックはハーネス共通で、導入済みの他のハーネスと共有します。ただしエンジンディレクトリは別々である必要があります（`kiro` 配布と `kiro-ide` 配布は `.kiro/` を共有できません。`kiro` を入れたプロジェクトでは、`aidlc config --harness kiro-ide` が `.kiro/` をその場でこの配布へ切り替えます）。

> [!IMPORTANT]
> **Kiro では Claude Opus 4.8 で AI-DLC を動かしてください。** コンダクターはステージごとに、質問、成果物の生成、レビュアーの通過、ラーニングの手順、承認ゲート、という複数段の手順を回します。Opus 4.8 はこの手順を最後まで追い、どのゲートでも正しく止まります。弱いモデルは任意の段（レビュアーの通過とラーニングの手順）を飛ばし、ゲートを急ぐことがあります。ワークフローを始める前に、チャットモデルを **Claude Opus 4.8** にしてください。

## 前提条件

- **Kiro IDE 1.1.70 以降**（サインイン済み）、または **Kiro CLI 2.24.1 以降**（`kiro-cli --version`、サインイン済み）。この配布を確認した最も古いビルドです。PATH 上の `kiro-cli` がそれより古いと `/aidlc --doctor` が警告します。Kiro IDE の版は読めません。
- チャットモデルに **Claude Opus 4.8** を選ぶ（上の注を見てください）
- **bun** は、ソース／開発用の `dist/` 投影を生成または実行するときだけです。ネイティブ導入と版付きリリースランタイムは自己完結です。

> [!TIP]
> ソース生成の `dist/` 導入では、IDE がフックやツールへ渡す PATH に bun がないといけません。ターミナルから開いた IDE は、そのターミナルの PATH を渡すので、そこで `bun --version` が通れば十分です。Dock やデスクトップのアイコンから開いた場合は、そうならないことがあります。フックが bun を見つけられないときは、そのようなターミナルで `bun .kiro/tools/aidlc.ts doctor` を実行してください。その `Runtime hook PATH` 行が、足すべきディレクトリと足す場所を示します。足したあとで IDE を再起動します。それまでは、そのターミナルから IDE を開いてください。

## インストール

### ネイティブチャネル（推奨）

まだ信頼していないプロジェクトフォルダで、Kiro IDE 自身のターミナルからこれらのコマンドを実行すると、Kiro はまずそのフォルダを信頼するか尋ねます。**Trust Folder & Continue** を選ぶのは、自分のプロジェクトか、中身を確認したプロジェクトだけにしてください。それ以外では **Cancel** を選びます（[初回の実行](#初回の実行) を参照）。

```bash
tmp="$(mktemp -d)"
curl -fsSL \
  https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh \
  -o "$tmp/install.sh"
sh "$tmp/install.sh"
rm -rf "$tmp"
cd your-project
aidlc config --harness kiro-ide
aidlc doctor
```

インストーラは、リリースのメタデータ、実行ファイル、全ハーネスのランタイムアーカイブを、公開された SHA-256 チェックサムに対して検証します。入れたランタイムに Bun、Node.js、Git は不要です。ハーネスの選択は `aidlc config` で行います。

Windows では `install.ps1` をダウンロードし、`& $installer` で実行します。インストール中に Kiro を開いていた場合は（Kiro 自身のターミナルでインストーラを実行した場合も含めて）、最初の `/aidlc` の前に Kiro を完全に終了してから開き直してください。Kiro は起動時の PATH を保持するので、再起動するまでは、そのフック、エージェント、ほかのターミナルは `aidlc` を見つけられません。**Developer: Reload Window** では足りません。アカウントの範囲、User PATH への自動登録、`-NoModifyPath` については [Windows でのインストール](../18-install-and-lifecycle.md#windows-powershell) を見てください。エアギャップのパッケージでは、Unix は `install.sh --from <release-directory> --offline`、Windows は `& $installer -From <release-directory> -Offline` です。

`aidlc config` は、プロジェクトを開く前に Kiro シェルを投影します。ネイティブの `aidlc engine *` 信頼付与と、後述のコピーしたプロジェクト向けに挙げる読み取り専用および再有効化のための決まったコマンドは、コンダクター（`.kiro/agents/aidlc-aidlc.md`）の権限の中に入って出荷されます。コンダクターが仕事を渡すエージェントには、どれもそれらのコマンドが拒否されます。コンダクターからも外してあるコマンドがあります。`aidlc engine config set *` はあなたの作業の設定を変え、`aidlc engine adapter *` は IDE 自身のフックが実行する入口です。また `$`、バッククォート、`>`、`<`、`&`、`@(`、`@{`、改行を含む AI-DLC コマンドは、その一つのコマンド以上のものを実行、展開、リダイレクトしうるからです。エージェントがこれらのどれかを実行するときは、Kiro IDE がまずあなたに尋ねます。以前のリリースはこれを `.vscode/settings.json` の `kiroAgent.trustedCommands` にもマージしていましたが、Kiro IDE 1.x はもうそのキーを読まないので、そのエントリは取り除いて構いません。最初のワークフローの前に、[初回の実行](#初回の実行) に従ってください。`your-project/` を Kiro IDE で開き、フォルダを信頼してウィンドウを再読み込みし、チャットパネルのエージェントピッカーで **aidlc** を選び、`/aidlc --doctor` を実行します。Kiro CLI では、代わりにプロジェクトで `kiro-cli` を実行します。`aidlc` エージェントで開きます。

### 版付きの手動コピー（代替）

特定リリースの `aidlc-copy-runtime-X.Y.Z.tar.gz` を、[Install and Lifecycle: コピー経路](../18-install-and-lifecycle.md#コピー経路) のとおりダウンロードして展開し、`RUNTIME_ROOT` を展開した `runtime/` ディレクトリにします。

```bash
mkdir -p your-project/.kiro your-project/aidlc
# Safe on fresh installs; required when upgrading from v2.5.56 or earlier.
for retired_hook in \
  audit-logger block mint runtime-compile stop sync-statusline \
  enforce-approval-gate plan-approval-guard review-freeze state-transition-guard \
  terminal-command-guard rebuild-stage-graph sync-workflow-state \
  after-shell write-audit-log terminal-command
do
  rm -f \
    "your-project/.kiro/hooks/aidlc-${retired_hook}.json" \
    "your-project/.kiro/hooks/aidlc-${retired_hook}.kiro.hook"
done
rm -f \
  your-project/.kiro/agents/aidlc.json \
  your-project/.kiro/agents/aidlc-*-agent.json \
  your-project/.kiro/hooks/aidlc-*.kiro.hook
# The copy replaces .kiro/settings/cli.json; keep the project's own first.
if [ -f your-project/.kiro/settings/cli.json ]; then
  cp your-project/.kiro/settings/cli.json your-project/cli.json.before-aidlc
fi
cp -R "$RUNTIME_ROOT/kiro-ide/.kiro/." your-project/.kiro/
cp -R "$RUNTIME_ROOT/kiro-ide/aidlc/." your-project/aidlc/     # the workspace shell (spaces/default/memory) — a sibling of .kiro/, not inside it
cd your-project && bun .kiro/tools/aidlc.ts config --from "$RUNTIME_ROOT" --harness kiro-ide
```

最初の削除ループは v2.5.57 のフック名移行です。二番目は、古い配布が出荷していた Kiro CLI 形式のエージェント JSON と、Kiro IDE 1.x が決して実行しない IDE 0.x の `.kiro.hook` 登録を消します。上書きコピーでは廃止されたファイルは消えません。コピーは `.kiro/settings/cli.json` も置き換えます。このファイルは Kiro CLI を v3 エンジンと `aidlc` エージェントに固定します。このファイルは `.kiro/` の他の部分と同じく AI-DLC が管理します。出荷版と異なるコピーがあると、`aidlc config` は上書きせずに衝突で止まり、`--force` で置き換えます。自分の Kiro CLI 設定は、代わりにユーザー単位の `~/.kiro/settings/cli.json` に置いてください。Kiro CLI はそのファイルも読み、プロジェクトのファイルが優先されるのは、それが設定するキーだけです。プロジェクトが `.kiro/settings/cli.json` に設定を持っていた場合、上のブロックはそれを `cli.json.before-aidlc` として保存するので、そちらへ移せます。どちらの削除も新規導入では no-op です。掃除のあと、`cp -R <src>/. <dst>/` の形は、`your-project/.kiro` が既にあってもなくても木の **中身** をコピーします。素の `cp -r "$RUNTIME_ROOT/kiro-ide/.kiro" your-project/.kiro` は、既存の `.kiro/` の中にもう一つ `.kiro` を入れ子にし、IDE は新しいファイルを見ません。

`aidlc/` ディレクトリはワークスペースシェルです。エンジンが読む、あらかじめ組んである `aidlc/spaces/default/memory/` の方法論ツリーを同梱します。`.kiro/` の **兄弟** なので、別途コピーします（または `$RUNTIME_ROOT/kiro-ide/` 一式をまとめてコピーします）。ないと `/aidlc --doctor` の "workspace shell ready" 検査が落ちます。

コピーしたプロジェクトでは、`aidlc` エージェントは AI-DLC のエンジンコマンド（`bun .kiro/tools/aidlc.ts engine ...`）、そのツールスクリプト、読み取り専用のコマンド（`--verbose` の有無を問わない `doctor` と `--doctor`、`version`、`--version`、`status`、`--status`、`config --help`、`config --show` と `--json` の有無を問わない `config <section> --show`、`config <section> --help`）、検査の再有効化（`config flags --clear-bypass <switch> --yes`）を、カードなしで実行します。ネイティブ導入も、同じコマンドを `aidlc ...` としてカードなしで実行します。ほかの `config` の変更（素の `config` やガイド付きセットアップも含む）、マシンの AI-DLC 導入を変えるコマンド（`use`、`update`、`rollback`、`uninstall`、`system`）、そして `$`、バッククォート、`>`、`<`、`&`、`@(`、`@{`、改行を含む AI-DLC コマンドは、先に Kiro のカードを表示します。

版付きランタイムはネイティブの `aidlc` コマンドを使います。Bun 形のソース投影が要るフレームワーク開発者は、リポジトリを clone し、`bun install --frozen-lockfile` と `bun scripts/package.ts` を実行し、無視されるローカル `dist/kiro-ide/` 出力を代わりに使えます。

出荷の `.gitignore` は、ワークスペースのコミット／無視の分け方を持ちます。ユーザーごとのカーソル（`aidlc/active-space`、`aidlc/spaces/*/intents/active-intent`）とマシンローカルのランタイム（`aidlc/.aidlc-clone-id`、`runtime-graph.json`、センサーキャッシュ、`spaces/*/knowledge/.sources.local.json`）は未追跡のまま、共有の記録 — 方法論メモリ、状態、監査シャード、成果物 — は git に乗ります。最後の行、つまりコピーのセットアップが、それらの行と `AGENTS.md` の AI-DLC 部分を、ファイルの既存の内容のあとへ足します（プロジェクトにファイルがなければ作ります）。これで最初のワークフローの前に AI-DLC 規則が入ります。

導入が出荷するものは次です:

- `.kiro/skills/aidlc/SKILL.md`: aidlc エージェントへの AI-DLC の指示。エージェントは、その隣の `question-rendering.md` と `composer.md` とともに、どのチャットでも最初の行からそれらを持っているので、あなたの依頼に応じて動く前にファイルを読むことはありません。
- `.kiro/agents/aidlc-aidlc.md` — 同じコンダクターを、ワークスペースのエージェント選択に出すもの（`aidlc-*-agent.md` の専門エージェントより前に並ぶようにこの名前にしています。Kiro はエージェントをファイル名の順に並べるので、ピッカーでも `/` メニューでも `aidlc` が最初に来ます）。`invoke_sub_agent`（Kiro IDE）または `orchestrate_subagent`（Kiro CLI）で委譲します。各ペルソナを、それ自身のツールと拒否規則のもとで実行するディスパッチツールです。
- `.kiro/agents/aidlc-*-agent.md` — 委譲ペルソナ 14 体すべて。`tools:` 付与と `permissions.rules` を持ちます。委譲された呼び出しでは、Kiro はペルソナの拒否規則を強制しますが、コマンドはコンダクターの許可のもとで実行するので、各ペルソナは、デリゲートが実行してよい AI-DLC コマンドを除いて、その許可を拒否します。デリゲートは、コマンドをどう引用しても、どう空白を入れても、ワークフローを進めること、ステージの状態を変えること、インテントやスペースを切り替えたり作ったりすることはできません。Bolt の worktree を作成、マージ、破棄、復元するのは pipeline-deploy ペルソナだけです。agent-v1 JSON は出荷しません。シェルの規則は、AI-DLC 自身のコマンドと `bun --version` を確認なしで実行し、プロジェクト自身のテストやビルドのコマンドは引き続き確認を求めます。
- `.kiro/settings/cli.json` — Kiro CLI を v3 エンジンと `aidlc` エージェントに固定します。Kiro CLI の既定の v2 エンジンは `.kiro/hooks/` の登録をどれも実行せず、フックはそれを内側から検出できません。Kiro IDE はこのファイルを読みません。`kiro-cli acp` はその `chat.defaultAgent` を読みますが、エンジンの固定は読まないので、ACP クライアントは `kiro-cli acp --agent-engine v3` を起動し、`initialize` リクエストで `clientCapabilities._meta.kiro.hooks` を `{ enabled: true, v2: true }` と宣言する必要があります。そうしないと、セッションはフックを一つも実行しません（[Kiro CLI のフックが動かない](../15-troubleshooting.md#kiro-cli-hooks-not-running) を参照）。
- `.kiro/steering/aidlc-active-memory.md`: コンダクターと委譲エージェントのために、アクティブスペースのメモリ本文を運ぶ、常に読み込まれる steering。AI-DLC がチャットごとに `aidlc/spaces/<active-space>/memory/` から書き出し、git の外に置きます。編集するのはメモリファイルで、このファイルではありません。チャットは始めたときのコピーを保つので、メモリを編集したあとは、新しいチャットを始めるまで、ステージのルールが各ステップと一緒に届きます。
- `.kiro/steering/aidlc-onboarding.md` — 常に読み込まれる、ハーネスの設定とコマンド。
- `.kiro/hooks/aidlc-*.json` — Kiro の v2 フック形式のフレームワークフック。どちらの面もセッション開始時にこれらを登録します。Kiro IDE では Agent Hooks パネルに出ます。そこで一つを off にすると、そのファイルに `"enabled": false` が書き込まれます。`/aidlc --doctor` はそれを報告し、次の AI-DLC の手順は変更ごとに一度それを伝えます。`aidlc-record-human-turn` が off の間は、承認のときに、フォルダを信頼するのではなく Agent Hooks の下でそれを on に戻すよう伝えます。AI-DLC がフックをあなたの代わりに on に戻すことはありません。IDE 0.x の `.kiro.hook` 形式はもう出荷しません。Kiro IDE 1.x はそれを決して実行しません。

## 初回の実行

Kiro IDE がフォルダのフックを実行し、その `aidlc` エージェントを読み込むのは、フォルダを信頼してウィンドウを再読み込みしたあとだけです。信頼していないフォルダは Restricted Mode で開きます。ウィンドウの上部にバナーが出て、ステータスバーに "Restricted Mode" と表示されます。それまでは AI-DLC のフックは動かず、`aidlc` エージェントはエージェントピッカーに出ず、最初の承認の質問はあなたの返答を見られません。

信頼するのは、中身を知っているフォルダだけにしてください。自分のプロジェクトか、確認したプロジェクトです。信頼すると、フォルダの `.kiro` のフックがあなたのマシンでコマンドを実行できるようになるので、他人のプロジェクトは確認が済むまで Restricted Mode のままにしてください。

Kiro はこの信頼をもっと早く求めることがあります。信頼する前にそのフォルダで Kiro IDE のターミナルを開くと（たとえばそこで `aidlc config` を実行するため）、Kiro はまず "Do you trust the authors of the files in this folder?" と尋ねます。知っているフォルダなら **Trust Folder & Continue** を選びます。手順 1 と同じように信頼され、`aidlc config` が終わったら、手順 2 から続けてウィンドウを再読み込みします。それ以外では **Cancel** を選びます。

1. `your-project/` を Kiro IDE で開きます。ウィンドウの上部に Restricted Mode のバナーが出ていて、フォルダの中身を知っているなら、バナーの **Manage** を選び、開いた Workspace Trust ページで **Trust** を選びます。
2. コマンドパレット（Ctrl+Shift+P、macOS では Cmd+Shift+P）を開き、**Developer: Reload Window** を実行します。
3. チャットパネルのエージェントピッカーで **aidlc** エージェントを選びます（[Kiro IDE のチャットで AI-DLC を始める](#kiro-ide-のチャットで-ai-dlc-を始める) を参照）。
4. チャットで `/aidlc --doctor` を実行してセットアップを確認し、`/aidlc <description>` でワークフローを始めます。

Kiro CLI では、`your-project/` で `kiro-cli` を始め、手順 4 へ進みます。

`kiro-cli` が PATH にあるときは、セットアップは Kiro CLI のセッションモデルも提案し、あなた個人の Kiro 設定（`~/.kiro/settings/cli.json`）に保存します。これは Kiro CLI の設定です。Kiro IDE は自身のモデルピッカーで選んだモデルを使います。この行でセットアップが保存するのはモデルだけで、effort は保存せず、Kiro auto より優先して勧めるモデルはありません。Enter は Kiro auto のままにし、Kiro IDE 自身のターミナルでは推奨セットアップは尋ねず、Kiro auto のもとでは各ホストがどこでモデルを選ぶかを伝えます（Customize は手順 2 で引き続き尋ねます）。後から保存するには `aidlc config models --session-model <id>` を使います。

チャットメッセージを送ったあとで doctor が "AIDLC hooks have not run in this project yet" と報告するときは、手順 1 から 3 を繰り返してください。[トラブルシュート: Kiro IDE のフックが動かない](../15-troubleshooting.md#kiro-ide-hooks-not-running) を見てください。

## 使い方

Claude Code ハーネスと同じです。`/aidlc <description>` でワークフローを始め、`/aidlc --status` が位置を出し、`/aidlc --doctor`、`--stage`、`--phase`、`--depth`、`--test-strategy`、`--config [section]` もすべて動きます。ステージごと（`/aidlc-domain-design`）とスコープごと（`/aidlc-feature`）のランナースキルも入っています。init コマンドはありません。出荷のシェルがワークスペースの足場を組み、最初の `/aidlc` で AI-DLC が最初のインテントを自動作成します。

### Kiro IDE のチャットで AI-DLC を始める

Kiro IDE は、新しいチャットをいつも自身の **Default** エージェントで始めます。`aidlc` ではありません。`.kiro/settings/cli.json` の `"chat.defaultAgent": "aidlc"` の行は Kiro CLI の設定で、`aidlc` を `kiro-cli` セッションの既定エージェントにするだけです。Kiro IDE はそのファイルを読みません。なので Kiro IDE の新しいチャットではそのたびに:

1. チャットパネルのエージェントピッカーを開き、**aidlc** を選びます（そこに並ぶ AI-DLC のエージェントの最初のもの。説明は "AI-DLC. Choose this agent in the agent picker" で始まります）。このエージェントは、AI-DLC のコマンドを確認なしで実行させ、AI-DLC が専門エージェントを呼び込めるようにします。さらに、チャットの開始時にすでに AI-DLC の指示を持っているので、最初の行に応じて動く前にファイルを読むことはありません。
2. 依頼全体を入力してから Enter を押します。たとえば `/aidlc --doctor` や `/aidlc build a to-do app` です。素の `/aidlc` も動きます。`/` メニューが開いている間に Enter を押すと、行はメニューの最初の項目、つまり `/aidlc` そのものに補完され、次の Enter でそれが送られます。
3. `/` メニューから `aidlc` を選んでも、チャットが使うエージェントは変わりません。チャットがまだ **Default** のままなら、最初の依頼に対する AI-DLC の最初の動きはそれ自身のコマンドで、Kiro はその承認を求め、その後もそれが実行する各コマンドで尋ねます。それを避けるには、先にエージェントピッカーで **aidlc** を選んでください（手順 1）。`/` メニューの `aidlc-...-agent` の項目は、ワークフロー中に AI-DLC が呼び込む専門エージェントで、自分で始めるものではありません。

`aidlc` エージェントを選んでいれば、"start an AI-DLC workflow for a to-do app" や "continue my AI-DLC workflow" のように普通の言葉で頼むこともできます。Kiro のウェルカムパネル（Spec、Plan、Bug Fix、Quick Spec）は Kiro 自身のワークフローを並べたもので、AI-DLC はそこに出ません。上のとおりチャットから始めてください。

### Supervised と Autopilot

チャットボックスの右下にある **Autopilot** スイッチ（**Settings > Agent > Agent Autonomy** にもあります）は、エージェントの操作について Kiro 自身がどれだけ承認を求めるかを決めます。ワークフローの途中を含め、いつでも変えられます。AI-DLC のどのチェックポイントで止まるかは変わりません。

- **Supervised**（スイッチ off）: ファイルを変えたターンのたびに、Kiro は **Review changes** カードを出し、**Accept** か **Reject** を選ぶまで待ちます。AI-DLC は質問、ステージ文書、計画をファイルに置くので、ワークフローでは AI-DLC 自身の質問に加えて、このカードが何度も出ます。
- **Autopilot**（スイッチ on）: ファイルの変更はカードなしで通ります。何が変わったかは、チャットの **View changes** で見られます。
- どちらのモードでも、`aidlc` エージェントがまだ許可していないコマンド（プロジェクトのテストコマンド、`git push`、再帰的な削除など）には、Kiro が **Allow** を求めます。あなた自身のコマンドには AI-DLC の規則が当たらないので、一度 **Always allow** を選べば、Kiro はリダイレクトや連結も含めてそれを覚えます。AI-DLC 自身のコマンドは、リダイレクト、連結、置換（`>`、`&&`、`$(...)`）を含むときに尋ねるので、許可された AI-DLC コマンドを別のものへ引き伸ばすことはできません。Kiro は、意図して外してある二つの AI-DLC コマンドの前にも尋ねます（[ネイティブチャネル](#ネイティブチャネル推奨) を参照）。
- Kiro CLI（その v3 エンジン）では、並行ビルドのワーカーやレビュアーが尋ねると、Kiro はその要求を "tool approval pending" の枠にまとめます。(f) **Approve all pending and auto-approve future subagent requests** を選ぶと、そのチャットの残りの間、後から始まるレビュアーも含めて、それらは尋ねたものを何でも、あなたに再び尋ねることなく実行します。メインのチャットからの要求はこれまでどおり尋ね、Kiro はこれについて設定を書きません。

どちらのモードでも、AI-DLC はそれぞれの質問、すべての承認ゲート、そして計画承認が有効なときの Code Generation の **Approve Plan** で止まり、あなたが返答を入力するのを待ちます（計画承認は express と poc を除く出荷スコープすべての既定で、切り替えはあなたが行います。[計画承認](../13-customization.md#計画承認plan-approval) を参照）。Kiro のスイッチでこれらを飛ばすことはできません。AI-DLC のフックはどちらのモードでも動きます。一つは計画が承認されるまで（計画承認が off のときは、AI-DLC が確認なしで計画を組むと記録するまで）コードの変更を拒否します。AI-DLC は、質問に対してあなたが返答を入力したあとでしか、回答や承認を受け付けません。定型の承認を飛ばす AI-DLC の設定は、Kiro の Autopilot ではなく、AI-DLC 自身の Construction の選択 **Continue automatically** です（[最初のワークフロー](../02-your-first-workflow.md#コンストラクションフェーズ-construction) を参照）。

ファイルの変更をその場で一つずつ読みたいとき（たとえば最初のワークフローや、どの変更も重要なコード）は Supervised を使ってください。クリックを大きく減らしたいときは Autopilot を使います。それでも AI-DLC のチェックポイントにはすべてチャットで答え、変更は後から見直せます。

### チャットがいっぱいになってきたら

Kiro はチャットがどれだけいっぱいかをあなたに表示しますが、作業中の AI-DLC にはその数値を渡しません。Kiro IDE と Kiro CLI の v3 エンジンは、チャットが 80% に達すると自分でチャットを要約し、それ以降エージェントはその要約をもとに作業します。AI-DLC は Kiro 自身のチャットの記録（`~/.kiro/sessions/`、読み取りのみ）を読み、Kiro がチャットを要約したあとの最初の承認の質問または Unit チェックポイントで、そのことを一行で伝え、一時停止して新しいチャットで続けることを提案します。Kiro の自動コンパクションを off にしている場合は、チャットが 80% いっぱいになった時点で同じ提案が出ます。決めるのはあなたの答えです。ひとりでに一時停止することはなく、その一行は一つのチャットで一度だけ出ます。

この一行が出ないのは、ステージの途中（どのみち尋ねられる質問と一緒にしか出ません）、このマシンに記録がないチャット、そして Kiro の更新で Kiro のチャットの記録方法が変わった場合です。Kiro IDE で一つのウィンドウに AI-DLC のチャットを二つ開いているときは、最後に始まったチャットについて伝えることがあります。いつでも同じことを手で行えます。

1. ステージの境界で止めます。承認し、同じ返答の中でいったんここで止めたいと伝えるか、`/aidlc park` と入力します。`/aidlc --status` は `Paused at <stage> (you stopped it); pick it back up with /aidlc --resume` と表示するようになります。
2. 新しいチャットを始めます。Kiro IDE では、新しいチャットを開いてエージェントピッカーで **aidlc** を選びます（新しいチャットは Kiro の Default エージェントで始まります。[Kiro IDE のチャットで AI-DLC を始める](#kiro-ide-のチャットで-ai-dlc-を始める) を参照）。Kiro CLI では `/chat new` と入力します。
3. `/aidlc --resume` と入力します。`/aidlc --status` はもう Paused と表示しません。

古いチャットで話し合ったものの、ファイルに書かなかったことは引き継がれません。だからステージの終わりが最適なタイミングです（[ワークフロー途中でのモデル変更](../11-session-management.md#ワークフロー途中でのモデル変更) を参照）。

## Kiro でのフックの動き

Kiro IDE と Kiro CLI v3 は、v2 フック JSON ファイル（`{"version":"v1","hooks":[{name,trigger,matcher,action}]}`、PascalCase のトリガー）を `.kiro/hooks/` の下で登録します（エージェント JSON の中に `hooks` ブロックを持つ `kiro` CLI 配布とは別の仕組みです）。ネイティブのフックコマンドは `aidlc engine adapter kiro-ide` 経由です。ソース／開発コピーは、投影した `aidlc-kiro-adapter.ts` シム経由です。どちらも IDE イベントを、共有コアフックが期待する形へ正規化します。Kiro のどのツールが書き込み、シェル、委譲、読み取りなのかは、アダプタの隣にある一つの表 `aidlc-kiro-tool-names.ts` で決めます。アダプタはそれを読みます。フック登録は手書きの JSON で、そのマッチャーは同じシェル、委譲、監査対象の書き込みの名前を並べます。

Kiro IDE 1.x と Kiro CLI v3 はフック文脈を **stdin の JSON** で渡します（snake_case: `{ session_id, tool_name, tool_input, tool_response }`。古い 0.12 ビルドは代わりに `USER_PROMPT` 環境変数へ camelCase 相当を載せます。アダプタは両方受けます）。以前のビルドは PostToolUse の write／shell のツール入力を空のままにしていたので、入力にパスがないときは、アダプタが書いたパスを結果テキストから復元し、監査末尾のフック（`rebuild-stage-graph`、`sync-workflow-state`）は監査証跡から実行されます。グラフ再構築の経路はシェル結果とセッション識別情報も残すので、成功した `intent-create` が呼び出したセッションに結び付きます。新しいイベントは正確な `session_id` を持ち、レガシー経路は計測した `VSCODE_IPC_HOOK`／`VSCODE_PID` 環境から安定したホストインスタンス識別情報を導き、SessionStart で保持します。新しい Stop も同様にイベントローカルの `session_id` を優先するので、インテントを作成または選択したあと、並行する別のチャットが、そのチャットの引き渡しを消費することはありません。レガシーの agentStop は保持した識別情報へ落ちます。後の 1.x ビルドは一部の PreToolUse と委譲入力を埋めます。アダプタはその欄を残します。Windows では、決定論的ユーティリティがこれらの連携箇所を使い、IDE のシェル結果輸送を避けます。送信プロンプトを出すビルドは UserPromptSubmit でユーティリティを実行し、1.0.242 のようにプロンプト欄が空のビルドは、正確な `execute_pwsh` PreToolUse コマンドへ落ちます。ユーティリティはターンにつき一度実行され、UTF-8 テキストは端末プロトコル／制御バイト無しで中継し、重複するシェル呼び出しは拒否します。新しいチャットはターンと出力状態を `session_id` ごとに持ちます。セッション識別情報のない文脈は、レガシー互換用の領域を 1 つ使います。1.0 より前の camelCase ペイロードは、同じフォールバックを `toolArgs.command` 経由で取ります。生のプロンプト本文は、より新しい世代向けの互換形式だけです。

ペイロード取得は **ペイロード依存の対象にゲート** します（`audit-and-sensors`、`log-subagent`、`plan-approval-guard`、`rebuild-stage-graph`、`review-freeze`、`state-transition-guard`、そしてそれらを実行する `guard-tool-call`、`person-message`、`after-shell` のカード）、端末コマンドの連携箇所、それに新しい `session_id` のための `session-start` と `continue-workflow`、正確な承認応答のための `record-human-turn`。空でない `USER_PROMPT` は 0.12 ビルドで直ちに消費します（stdin を開いて一度も書かないため）。それ以外はアダプタが 1.x の stdin 経路を Kiro が閉じるまで読むので、混み合ったマシンで遅れて渡されたメッセージも丸ごと記録されます。閉じない経路には 60 秒の安全上限があります。何も届かなかったときは、あなたのターンは記録されず（あなたが何も入力しなかったと記録するものはありません）、エージェントは、このチャットの最後のメッセージが AI-DLC の記録に届かなかったので、それが質問の一つへの回答だったなら、その質問をもう一度尋ねられる、と伝えるよう指示されます。ほかの対象はどちらの経路にも触れず、ゼロ遅延の道を保ちます。

| フック | トリガー（マッチャー） | 目的 |
|------|-------------------|---------|
| `aidlc-session-start` | `SessionStart` | 新しいセッションが最初のプロンプトを受け取ったときに、ワークフロー再開の文脈を注入する（両面とも。既存セッションの再開では発火しない）。Kiro IDE 1.1.14 は新しいチャットで SessionStart フックを実行しないので、代わりに `aidlc-record-human-turn` がこの仕事をする |
| `aidlc-record-human-turn` | `UserPromptSubmit` | メッセージごとにカード一枚。まず直前の書き込みやコマンドが残した作業を済ませ（下の「書き込みのあと」と「コマンドのあと」の 2 行）、次にプロンプトごとに人のターンのイベントを記録し（人の存在ゲート）、さらにプロンプト本文があるとき、コマンドを入力したチャットのために、status、doctor、help、ナビゲーションなどの端末ユーティリティをモデルより先に実行する。最後に見たチャット以外のチャット、またはまだ始まっていないチャットからのプロンプトは、`aidlc-session-start` と同じように、まずそのチャットのセッションを始めるので、そのチャットは自分の `AIDLC Runtime Session:` 行か再開の文脈を受け取る。Kiro が自分で作るプロンプト（Workflows のステップのブリーフ、ワークフローが終わったという通知）はあなたのターンとして数えない。`HOST_TURN` として記録し、セッションを始めず、質問にも答えない |
| `aidlc-continue-workflow` | `Stop` | 転送ループの監査（advisory のみ。IDE の Stop トリガーはブロックできない — 強制はコンダクター自身の Stop プロトコルに頼る） |
| `aidlc-guard-tool-call` | `PreToolUse`（読み取りを除くすべてのツール） | カード一枚。まず直前の書き込みやコマンドが残した作業を済ませ（下の「書き込みのあと」と「コマンドのあと」の行）、次に下の 4 つの検査を、同じ呼び出しに対してこの順で実行する。各検査は横に書いたツールに対してだけ動く。一つが拒否しても全検査が動き、どれか一つでも拒否すれば呼び出しは拒否され、理由はそれぞれ一度ずつ示す。読み取り（`read_file`、`list_directory`、検索）はカードなしで動く。承認に答えることも、ワークスペースを変えることもできないため。補助エージェントが答えを返す呼び出し（`subagent_response`）もカードなしで動く。検査されるのは、その答えに基づいて動く呼び出しの方 |
| `plan-approval-guard` | `aidlc-guard-tool-call` の中（読み取りを除くすべてのツール） | 引数があるときは、対象を正確に分類して Code Generation Plan Approval を強制する。シェルツールは IDE の 3 つの名前すべてで認識する。`execute_bash`、`execute_pwsh`（Windows）、`shell`。それぞれ共有ガードへ `Bash` として転送し、レガシー復旧も同じ経路。アクティブなワークフローがないときは、どのシェル呼び出しも拒否しない。`execute_pwsh` は PowerShell として扱うので、計画が承認待ちの間も、読み取り専用のコマンドレット（`Get-Content`、`Select-Object`、`ConvertFrom-Json` など）、`2>$null`、`aidlc.cmd` やインストールしたエンジンのフルパスは動く。`Out-File`、`Set-Content`、`Add-Content`、`Tee-Object`、ファイルへの `>` は動かない。引数のないレガシーペイロードでは、このフックに関する限り、計測した `fs_write`/`str_replace` の計画質問書き込みだけを許す。`review-freeze` と `state-transition-guard` がそうした書き込みを拒否するので、実際には実行されない。PostToolUse は黙る。0.12 がその出力を捨てるから。呼び出した Code Generation の `next`／最後の `continue` ディレクティブが、保護された選択能力を 1 つ持つ。復旧は、まず平易な復旧の質問へのその人の「はい」が要り、それはエージェントが記録する。別の生きている窓は開始できない。所有者 PID が落ちたあと、または IPC だけのエンドポイントが消えたあとは、代わりの窓が復旧できる。引き継ぎは、チャレンジを回す前に古い応答証拠を消す。書き込み前に途切れた窓は、PostToolUse が走らなくても復旧ラッチのまま。確定の `toolSuccess:false` か、認識できる失敗の散文なら、変更がないのでラッチを外す。不明な結果はラッチしたまま。アダプタが持つ復旧は、人への質問は残し、再発行が成功したあとに違反／窓の状態だけを消す。`UserPromptSubmit` は正確な復旧／承認ラベルを出せるが、開示も譲渡もしない。未知の変更者はフェイルクローズ。共有ファイルと監査に平文の秘密は残らない。 |
| `review-freeze` | `aidlc-guard-tool-call` の中（書き込みとシェル） | 新しい終端レビューの受領記録がステージのレビュー済み出力を覆っている間、ゲートの前に、その出力への書き込みやシェルによる変更を拒否する。書き込みツールは対象パス付きの Write/Edit として、シェルツールは Bash として、チャットのセッションと一緒に共有フックへ届く。委譲されたエージェント自身の書き込みも同じように判断する。`execute_pwsh` のコマンドは、ここでも `state-transition-guard` でも PowerShell として読む（バックスラッシュのパス、`Set-Location`）。入力を読めない呼び出し（Kiro IDE 1.1.70 や Kiro CLI 2.24.1 より古いビルドは引数なしで送ることがある）は、ワークフローの内外を問わず、`AIDLC_DISABLE_REVIEW_FREEZE_HOOK=1` でも、フックが動く前に拒否され、対応ビルドを示す行が出る。 |
| `state-transition-guard` | `aidlc-guard-tool-call` の中（書き込みとシェル） | AIDLC のフック、セッション制御、ランタイム記録、監査証跡へのツール呼び出しによる書き込みを拒否する。`aidlc-state.ts` のライフサイクル動詞の直接実行は state ツール自身が拒否し、`aidlc-orchestrate.ts report` を案内する。Kiro IDE は呼び出しに委譲エージェントの名前を付けないので、デリゲートの呼び出しにはコンダクターの規則が適用される。入力を読めない呼び出しは、`review-freeze` と同じように拒否する。 |
| `terminal-command-guard` | `aidlc-guard-tool-call` の中（`execute_bash\|execute_pwsh\|shell`） | プロンプトが空の IDE 版向けフォールバック。分類したユーティリティを一度実行し、重複する Windows シェル呼び出しを拒否する。あるチャットのターンで端末コマンドが実行されたあとは、同じターンのそのチャットのほかのシェル呼び出しも、何を実行するものであれ拒否する（ペイロードが名指すチャットについて）。そのため `/aidlc --status` のターンが次のステージを渡すことはない。Windows では、cmd.exe が分割してしまう値を持つ `aidlc` コマンドも拒否する（下の Windows の引用符の行を参照）。どのシェルでも、返答がファイルへ向かう AI-DLC エンジンコマンド（`>`、`>>`、または `Out-File`、`Set-Content`、`Add-Content`、`Tee-Object`、`tee` へのパイプ）を拒否するので、エージェントはそれを単独で実行し、Kiro が丸ごと返す結果から返答を読む。エージェントが返答を結果から外してパイプしたり取り込んだりする手順コマンド（`orchestrate next` や `continue`）（任意のプログラムへのパイプ、`$(...)`、`$x = ...`、捨てられたストリーム）は拒否しない。次のカードが、そのチャットがその手順の規則を渡されたことを忘れるので、エージェントの次の手順がそれを再び運ぶ |
| 書き込みのあと（`fs_write\|str_replace\|fs_append`） | カードなし: 次のカードが行う | 成果物の作成／更新を記録し、当たるセンサーを発火する。`aidlc-guard-tool-call` は、通した書き込みが対象とするファイルを書き留める。どのみち動く次のカード（次のガード、あなたの次のメッセージ、またはターンの終わり）が、ファイルが変わっていれば、ほかの何よりも先に、その書き込みのチャットとともにそれを記録する。ファイルを元のままにした書き込みは何も記録しない |
| `aidlc-log-subagent` | `PostToolUse` (`^(?!subagent_response$)(subagent_.+\|invoke_sub_agent\|orchestrate_subagent)$`) | デリゲートの識別情報付きで `SUBAGENT_COMPLETED` を記録する。`orchestrate_subagent` パイプラインではステージごとに 1 行。マッチャーは広く、どのデリゲート名もアダプタに届く。補助の `subagent_response` シェルは除外し、アダプタはほかのすべての入口でもそれを落とす。各デリゲートが送られたという記録（`SUBAGENT_DISPATCHED`）は、ガードのカードが呼び出しを通した時点で書く |
| コマンドのあと（`execute_bash\|execute_pwsh\|shell`） | カードなし: 次のカードが行う | 下の 2 つのフックを、この順に、コマンドごとに一度、どのみち動く次のカードがその中のほかの何よりも先に実行する。コマンドが新しい作業を作ったときは、再構築がその名前を受け取るので、それを実行したチャットがその作業に加わる |
| `rebuild-stage-graph` | コマンドのあと | ランタイムグラフを再コンパイルする（監査末尾でゲート） |
| `sync-workflow-state` | コマンドのあと | 監査の最新 `STAGE_STARTED` から `Current Stage` を進行方向にのみ同期する（IDE はパースする task ペイロードを出さない）。その開始のあとに Unit を開き直したときは、`Current Stage` を開き直しが置いた場所のままにする |

`aidlc-session-end` には **登録がありません**。Kiro の `Stop` トリガーは、どちらの面でも会話の閉じではなく、アシスタントターンの終わりごとに発火するので、登録すると同じセッションのプロンプト間に偽の `SESSION_ENDED` が付きます。Kiro が本物のセッション終了イベントを出すまで、`SESSION_ENDED` は記録されません。

これらの登録のどれかが動くたびに、Kiro は "Run Command Hook" のカードを出します。ファイル変更、コマンド、別エージェントへの引き渡しの前に一枚、そのあとはなし、読み取りや補助エージェントが答えを返すときはなし、送るメッセージごとに一枚、各ターンの終わりに一枚（そのターンの最後の書き込みやコマンドも済ませます）、補助エージェントが終わったときに一枚です。フックファイルが古いプロジェクトでは、`config` が更新するまで、書き込みのあとのカード、コマンドのあとのカード、メッセージごとの二枚目のカードが残ります。更新すると `aidlc-write-audit-log.json`、`aidlc-after-shell.json`、`aidlc-terminal-command.json` が取り除かれます。

### フックのデバッグ

フックの動きが想定と違うときは、デバッグログを付けてください。各フックが判断経路（どのゲートを通ったか、解決したパス、なぜ抜けたか）を `<record>/.aidlc-engine/hooks-health/hook-debug.log` に追記します。**既定はオフ** です。通常の実行ではログは書かれず、オーバーヘッドもありません。付け方は 2 つ。どちらでも動きます。

- **ファイルシステムのマーカー（Kiro IDE ではいちばん簡単）:** プロジェクトで `touch aidlc/.aidlc-hook-debug`（PowerShell では `New-Item -ItemType File aidlc/.aidlc-hook-debug`）。次のフック発火から効きます。IDE の再起動は不要です。`rm aidlc/.aidlc-hook-debug` でオフに戻ります。
- **環境変数:** `export AIDLC_HOOK_DEBUG=1`。フックが見るのは IDE が起動したときの環境なので、IDE を終了し、変数を export したターミナルから開き直してください。Windows では、代わりに PowerShell でユーザー変数として設定します。`[Environment]::SetEnvironmentVariable("AIDLC_HOOK_DEBUG", "1", "User")` のあと、IDE を終了して開き直します（オフにするには `"1"` の代わりに `$null` で再実行します）。

## Kiro で違うところ

| 領域 | Claude Code | Kiro IDE と Kiro CLI |
|------|-------------|----------|
| フック登録 | `settings.json` の `hooks` ブロック | `.kiro/hooks/aidlc-*.json` の v2 フックファイル（Kiro IDE 1.x、Kiro CLI v3 エンジン） |
| ゲートと質問 | `AskUserQuestion` ウィジェット | 番号付きの散文選択肢（番号で返す）。正本は `[Answer]:` タグ付きの questions ファイル |
| ステータスライン | 今のステージ + モデル + コンテキスト % | ない。`/aidlc --status` と、各ゲートの進捗行を使う。いっぱいになってきたチャットについては [チャットがいっぱいになってきたら](#チャットがいっぱいになってきたら) を参照 |
| ディスパッチステージ（2.1 パイプライン、2.2 サブエージェント、2.4 モブ、3.5 サブエージェント） | `Task` ツール | `invoke_sub_agent`（Kiro IDE）または `orchestrate_subagent`（Kiro CLI）→ Markdown ペルソナ 14 体すべて。それぞれ自身の frontmatter の `tools:` と拒否規則、およびコンダクターのコマンド許可のもとで動く |
| Construction スウォーム | 並行 `Task` フロア、任意の ultracode Workflow | サブエージェントの fan-out だけ。`AIDLC_USE_SWARM=1` は no-op と告知する |
| セッション監査イベント | `SESSION_STARTED/RESUMED/ENDED`、`SESSION_COMPACTED` | 新しいセッションが最初のプロンプトを受け取ったときの `SESSION_STARTED`、Kiro IDE ではプロンプトが以前のチャットへ戻ったときの `SESSION_RESUMED`（本物のセッション終了トリガーがないので `SESSION_ENDED` はない。コンパクション前イベントもない） |
| MCP サーバー | 5 つ出荷（`.mcp.json`: `context7` + AWS 系 4 つ） | 同梱なし。AI-DLC 自身のチャット、14 体の委譲ペルソナ、プラグインが加えるエージェントは、ワークスペースとユーザーの `.kiro/settings/mcp.json` にあるすべてのサーバーを使え、各呼び出しはまずあなたに尋ねる（Kiro CLI ではペルソナの 2 手目から）。 |
| Windows で記録されるテキスト中の引用符 | 入力したとおりに記録 | Kiro IDE はエージェントのコマンドを Windows PowerShell 5.1 で実行する。これは空の引数を落とし、値の中の二重引用符を `\"` と書かない限り取り除く。エージェントは引用符をその形で書くので、回答やフィードバックは引用符付きで記録される。`&`、`<`、`>`、`^`、パイプ記号も含む値は、代わりに内側を単一引用符にして書く。`aidlc` コマンドは cmd.exe を通して動き、cmd.exe はそれらの文字に反応してしまうから。フックは、そうした文字が引用符の外で cmd.exe に届くコマンドを拒否する。それでも質問や回答が二つに分かれて届いたときは、AI-DLC はそれを記録せず、渡し方を伝えるので、監査証跡にその一部だけが残ることはない |
| ワークフロー途中でガード、要約確認、計画承認を無効にする | 自分の言葉で頼めばエージェントが設定コマンドを実行する。またはチャットで切り替えを入力する（例: `/aidlc config set summary-confirmation off`） | 同じ。ただし、フックに空のメッセージを渡す Kiro IDE ビルド（1.0.242 など）は設定コマンドも拒否する。その場合、要約確認と計画承認については、拒否が示すターミナルコマンドを実行すると、今動いている作業も含めすべての作業で今すぐ無効になる（ネイティブ導入では `aidlc config flags --bypass AIDLC_DISABLE_SUMMARY_CONFIRMATION --local --yes` または `--bypass AIDLC_DISABLE_PLAN_APPROVAL_GUARD`。`--clear-bypass` で再び有効になる）。他のガードについては、Kiro IDE を更新して切り替えを入力する |

それ以外 — 状態機械、監査証跡、インテントごとのレコードディレクトリ（`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`）の下の成果物、ラーニングの手順、センサー、スコープ、深度／テスト戦略 — は同じコアを使うため、同じ動作です。ネイティブ導入は `aidlc` 経由で配送し、ソースコピーは `.kiro/tools/` の対応ツールを実行します。

プロジェクトの `aidlc/` ワークスペースはハーネス非依存です。ハーネス間の移動（または両方を並べて実行すること）は、対応はしていますが未テストです。アクティブなワークフローがある状態で衝突するハーネス導入を見つけると、`/aidlc --doctor` が警告します。

### Unit のレビュアーはその Unit だけを読む

Unit のレビューの間、レビュアーはその Unit のファイルと、渡された共有コントラクトだけを読むことになっています。Claude Code やほかのハーネスでは、フックがそれを守らせます。Kiro ではレビュアーの読み取りをフックが見分けられないので、代わりに Kiro がレビュアーにそれを守らせます。Unit のレビューごとに、AI-DLC はレビュアーのコピー `.kiro/agents/aidlc-scoped-review-<id>.md` を書き、そのコピーをディスパッチします。コピーの権限は、ほかのすべての Unit の `construction/` フォルダ（別の作業にある同名の Unit も含む）での読み取りを拒否します。Kiro はそうした読み取りを拒否し、それらのファイルを検索結果から外します。`cat` のようなシェルでの読み取りは対象外で、まずあなたに尋ねます。コピーはほかの Unit のファイルを開きません。その Unit の設計が統合点として名指すものでもです。レビュアーは代わりにその点を所見として記します。コピーはレビューの間、Kiro のエージェント一覧と `/` メニューに出ます。AI-DLC がディスパッチするので、選ぶ必要はありません。判定が記録されるとコピーは削除されます。AI-DLC の `.gitignore` ブロックがコミットから外します。終わらなかったレビュー（それなしで Unit を承認したもの、閉じたチャットが止めたもの）が残したコピーは削除して構いません。書くべきコピーを AI-DLC が書けないとき、または Kiro にコピーの名前のエージェントがないとき（古い Kiro ビルドは読み込まないことがあります）、AI-DLC はコピーなしの場合と同じくレビュアー自身をディスパッチし、このレビューが検査なしで動くことを 1 行で伝えます。そのとき doctor はフックのドロップを数えます。AI-DLC が書けなかったコピーは `reviewer-scope` の下に原因を名指しして数え、Kiro が読み込まなかったコピーは `kiro-adapter` の下に数え、そのファイル（`<record>/.aidlc-engine/hooks-health/kiro-adapter.drops`）がコピーを名指します。Kiro CLI 2.31.0 と Kiro IDE 1.3.0 で計測し、ワークフロー全体では Kiro CLI 2.31.1 で計測しました。並行してビルドする Unit や、レビュアー読み取り範囲の検査が off の間はコピーはありません。off になるのは、Guard Policy `off`（enterprise 以外のすべてのプランの既定）、`guard.reviewer-scope off`、`AIDLC_DISABLE_REVIEWER_SCOPE_HOOK=1` のときです。その場合レビュアーは指示だけでその Unit に留められます。そのようなプランでコピーを使うには、その作業についてレビュアー読み取り範囲の検査を on にするようチャットで頼んでください（または `/aidlc config set guard.reviewer-scope on` と入力します）。コピーは書かれたときの権限を保つので、検査を off にすると次の Unit レビューから適用されます。

### 1 つのエージェントを独自のモデルと effort で

Kiro では、AI-DLC のどのエージェントも、そのエージェントにモデルや effort が設定されていない限り、チャットのモデルと effort（Kiro IDE で選ぶモデル、または Kiro CLI のセッションモデル）で動きます。Kiro は委譲されたエージェントを独自のモデルと effort で動かせます。たとえばレビュアーを別のモデルファミリーで動かせます。

```bash
aidlc config models --agent architecture-reviewer --model gpt-5.6-terra --effort high --project --yes
```

AI-DLC はモデルと effort を `aidlc.settings.json` に記録し、そのエージェントの `.kiro/agents/aidlc-architecture-reviewer-agent.md` に `model:`（引用符付きの文字列として）と `effortLevel:` を書きます。Unit のレビュアーのコピーもそれらを保ちます。Kiro は次にそのエージェントをディスパッチするときにそれらを読みます。すでに開いているチャットでもです。モデルは Kiro が提供するもの（`kiro-cli chat --list-models`、または Kiro IDE のモデルピッカー）でなければなりません。提供されないモデルでは、そのエージェントのディスパッチが失敗することがあります。モデルが受け付けない effort はモデル自身の既定で動き、モデルを与えて effort を与えていないエージェントは、チャットの effort ではなくそのモデルの既定の effort で動きます。`--model default` と `--effort default` で再び取り除けます。プリセットやグループの effort（`--preset`、`--reviewing-effort`）は Kiro では引き続き何も変えず、セットアップはそこでプリセットを記録せず、コンダクターはチャットのモデルのままです。

AI-DLC は、出荷するエージェントファイルのモデルと effort の行（`model:`、`effortLevel:`、およびほかのツールが使う `effort:`、`variant:`、`tier:` のキー）を、Claude Code と同じように所有します。`aidlc config` は設定を持つエージェントのそれらを書くので、手ではなく `aidlc config models` で変えてください。`aidlc config models --check` は、設定と一致しない `model:` や `effortLevel:` の行（手で足したものも含む）を報告します。自分で足したエージェントファイルには触れません。

エージェントの effort はすべてのツールで共有され、モデルはツールごとに記録されるので、あるエージェントについて別のツール向けに記録した effort は Kiro でも適用されます。`aidlc config` の実行が、Kiro のエージェントファイルにそれまでと異なるモデルや effort の値を書くときは（その実行自身が変える値を除く）、そのことを 1 行で伝え、各値がどこで設定されているかを示す `aidlc config models --show --harness kiro-ide` を名指します。そのエージェントについて `--effort default`（または `--model default`）を、それがあるファイルに応じて `--project`、`--local`、`--global`（マシン設定）と、プロジェクトにほかのハーネスがあるときは `--harness kiro-ide` とともに使うと、それを取り除けます（この方法で取り除いた effort は、すべてのツールで消えます）。`effortLevel` は Kiro のドキュメントにはありません。v3 エンジンの Kiro CLI 2.31.1 と Kiro IDE 1.3.0 で計測しました。

### Kiro の Workflows 機能は AI-DLC のレビューと補助を止める

Kiro IDE の **Workflows** 機能（Settings > **Kiro Agent > Workflows: Enabled**、または **Enable Workflows** コマンド）は、作業をバックグラウンドのワークフローとして実行します。これが on の間、チャットは AI-DLC がレビューと補助に使うサブエージェントツールを失います。`aidlc` エージェントではそれらは動かず、メインのチャットが自分でその作業をします。Default エージェントではそれらはバックグラウンドで動き、チャットのターンはそれらが終わる前に終わり、それらが実行する各コマンドは **Approval needed in agent-aidlc-...** パネルで尋ね、Kiro は `/aidlc` の依頼を AI-DLC ではなく自身のワークフローへ渡すことがあります。Workflows は、あなたが on にしない限り off です。

この切り替えは、すべてのプロジェクトに対する Kiro の設定です。Kiro はそれをユーザー設定からしか読まないので、ワークスペースの `.vscode/settings.json` の値は何もしません。これが on で、このコンピューターでまだ答えていないときは、AI-DLC は off にするかを一度だけ尋ねます。`aidlc config` の間か、最初の Kiro IDE チャットでです。`aidlc config --yes` は推奨の答えを取り、off にします。はいと答えると、AI-DLC はその一つの設定だけを変えます。そのあと、開いているチャットがそれを拾うように、コマンドパレット（Ctrl+Shift+P）から **Developer: Reload Window** を実行してください。いいえと答えると on のままで、AI-DLC は二度と尋ねません。

後から変えるには、Kiro Workflows を off または on に戻すようエージェントに頼むか、次を実行します。

```bash
aidlc config trust --kiro-workflows off --yes   # or: on
```

Kiro 自身の **Disable Workflows** と **Enable Workflows** コマンドも同じことをします。`/aidlc --doctor` は、Workflows が on の間と、Kiro の設定ファイルに AI-DLC が読み進められないエラーがある間（Kiro はそこから Workflows を on と読むことがあります。次のチャットが一度伝えます。直すべきはそのファイルのエラーです）、警告を出します。

Kiro CLI には独自の Workflows 切り替えがあります（`/settings` > Features > **Workflows**。Kiro CLI の設定 `~/.kiro/settings/cli.json` の `chat.enableWorkflows`）。これが on の間、Kiro CLI は `aidlc` エージェントから両方のサブエージェントツールを取り上げるので、Kiro CLI のチャットでは AI-DLC のレビューと補助が動きません。その "Workflows: sub-agent tool" 設定でも戻りません（Kiro CLI 2.31.1 と 2.32.0 で計測）。Kiro CLI のチャットはこの切り替えをあなた自身の Kiro CLI 設定からしか読まないので、プロジェクトの `.kiro/settings/cli.json` の値では off になりません。AI-DLC はこれについても同じように、別個の答えとして尋ねます。`aidlc config` の間か、最初の Kiro CLI チャットで一度だけです。`aidlc config --yes` は推奨の答えを取り、off にします。AI-DLC は Kiro CLI 自身の `kiro-cli settings` コマンドでこれを変えます。そのあと Kiro CLI を終了し、`kiro-cli` を再び起動してください。後から変えるには、エージェントに頼むか、次を実行します。

```bash
aidlc config trust --kiro-cli-workflows off --yes   # or: on
```

`/aidlc --doctor` は、これが on の間、警告を出します。

### Windows で Kiro のターミナルが Command Prompt のとき

Kiro IDE は、エージェントのコマンドを既定のターミナルプロファイルで実行します。それが **Command Prompt** のとき、Kiro がコマンドの返答を AI-DLC に渡すのは、そのコマンドが 1 秒以内に終わったときだけです（Command Prompt にはシェル統合がないので、Kiro はコマンドを送ってから 1 秒後に結果を読み、どの実行にも終了コード -1 を表示します）。AI-DLC の手順の多くはもっと時間がかかります。そのため Command Prompt では、AI-DLC のどのコマンドもまず `AI-DLC reply: aidlc/.aidlc-sessions/replies/<id>.txt` という 1 行を出力し、返答をターミナルとそのファイルの両方に書きます。Kiro が結果をその行で切ったときは、エージェントはコマンドを再実行するのではなく、ファイルから返答を読みます（最新の 20 件の返答が、git が無視するフォルダに保たれます）。エージェントが PowerShell の流儀で単一引用符に入れて書いた値は、Command Prompt からは引用符が付いたままの複数の語として届きます。AI-DLC はそれらを一つの値につなぎ直します。それでも手順には余分なターンがかかるので、Kiro 自身も PowerShell を勧めています。

Kiro のターミナルが Command Prompt で、このコンピューターでまだ答えていないときは、AI-DLC は PowerShell に設定するかを一度だけ尋ねます。`aidlc config` の間か、最初の Kiro IDE チャットでです。`aidlc config --yes` は推奨の答えを取り、設定します。はいと答えると、AI-DLC はその一つの Kiro の設定（`terminal.integrated.defaultProfile.windows`。すべてのプロジェクトに対するもの）だけを変えます。そのあと、チャットがそれを使うように Kiro を再起動してください。いいえと答えるとそのままで、AI-DLC は二度と尋ねません。

後から設定するには、エージェントに頼むか、次を実行します。

```bash
aidlc config trust --kiro-terminal powershell --yes
```

Kiro 自身の **Terminal: Select Default Profile** コマンドも同じことをします。`/aidlc --doctor` は、Kiro のターミナルが Command Prompt の間、警告を出します。

ターミナルが Command Prompt の間、Kiro IDE のどのチャットにも、そのターミナルがどう振る舞うかと、頼まれたときに PowerShell を設定する方法が伝えられるので、どのチャットでも "set Kiro's terminal to PowerShell" を実行できます。Command Prompt のままにした場合、手順の返答が初めて失われたときに、エージェントは何が起きたかと、PowerShell ならそれを避けられることを一度伝えます。二度とは尋ねません。

### Windows でコマンドカードが "dministrator: ...powershell.exe" で終わる

Windows では、Kiro IDE のコマンドカードが `dministrator: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` のような行で、一度か二度終わることがあります。これはターミナルウィンドウのタイトルで、Kiro が出力を表示するときに先頭が切れたものです。コマンドがしたことや、AI-DLC が記録することは変わりません。

Kiro の設定に `"terminal.integrated.windowsUseConptyDll": false` を足していた場合は、それを取り除いて Kiro を再起動してください。それがあると Kiro がコマンド出力を折り返し、Code Generation が止まることがあります。

### Kiro のメモリが古い AI-DLC の助言を持っている

Kiro IDE はメモリをプロジェクトの外、ホームフォルダの下の `.kiro/memories/memories.db`（Windows では `%USERPROFILE%\.kiro\memories\memories.db`）に保存し、開いたすべてのワークスペースへ読み込むことがあります。以前の AI-DLC 実行中にエージェントが保存したメモリには、そのプロジェクトと版にしか合わず、他の場所では誤りか危険な診断や回避策が入っていることがあります。`record-human-turn` のようなフックコマンドを手で実行する、`AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1` を設定する、要約確認を無効にする、Kiro IDE を "sessionless" なハーネスと呼ぶ、といったものです。AI-DLC はエージェントに、そうした助言を決して保存せず、それに従って動かないよう指示していますが、それ以前に保存されたメモリは今も読み込まれます。

エージェントが "per my memory" と言ってこれらのどれかを提案したとき、またはすでに Kiro IDE の中にいるのに "from Kiro IDE" で再開するよう言ったときは:

1. そのメモリを無視し、`/aidlc` が今言うことに従うよう伝えてください。ガードとチェックポイントの切り替えはあなたのものです。エージェントがコマンドを示し、あなたが入力します。
2. その種の助言をするメモリだけを削除します。AI-DLC のフックコマンドを手で実行する、ガードを飛ばす変数を設定する、チェックポイントを無効にする、Kiro IDE を "sessionless" と呼ぶ、すでに Kiro IDE の中にいるのに Kiro IDE から再開するよう言う、というものです。残りは残してください。正確な Kiro IDE のメモ（たとえばステータスラインがないこと）、他の AI-DLC のメモ、`AIDLC_HOOK_DEBUG` のようなデバッグの助言も含みます（メモリの管理方法は Kiro のドキュメントを確認してください）。
3. 何かを削除する前に `memories.db` のコピーを取り、ファイルを直接編集するときは先に Kiro IDE を閉じてください。このファイルは AI-DLC のものだけでなく、Kiro のすべてのメモリを持っています。

## フレームワーク開発者向け

`dist/kiro-ide` は `core/` + `harness/kiro-ide/` から `bun scripts/package.ts kiro-ide` で **生成** されます（コアのコピーで `{{HARNESS_DIR}}` トークンを `.kiro` に置換し、`rules/` → `steering/` へ名前を付け替えます）。出力は無視され、ローカルです。`bun scripts/package.ts --check` は独立した一時ルートで二度ビルドし、結果をバイト比較して CI の決定論ガードとします。手で書く Kiro IDE の面は `harness/kiro-ide/` にあります。オーケストレータスキル（`skills/aidlc/`）、常に読み込まれるアクティブメモリの steering（`steering/`）、コンダクター Markdown（`agents/aidlc-aidlc.md`）、フックアダプタと v2 フック JSON ファイル（`hooks/`）、ペルソナのデリゲート向けシェル拒否（`delegate-shell-deny.ts`）、オンボーディングの fills — 直すのはそれら（または `core/`）であり、生成された `dist/kiro-ide` を手で直してはいけません。

このハーネスが `kiro` CLI ハーネス（`harness/kiro/`）と違うのは 4 点です。コンダクターの面は `/aidlc` スキルと Markdown の `agents/aidlc-aidlc.md` です（`settings/cli.json` はそのエージェントを Kiro CLI の既定にもします）。出荷するのは v2 フック JSON ファイルです（`kiro` ハーネスはエージェント JSON の `hooks` ブロックに頼ります）。常設ルールは、CLI のエージェント resources ではなく、常に読み込まれる steering で先読みします。共有の Kiro 投影はコアペルソナの Claude 専用 `disallowedTools` キーを外します。そのマニフェストは、両ハーネスが足す `tools:` 行に加えて、すべてのペルソナに `permissions.rules` の frontmatter を足します（ステージがインラインで読む各ペルソナは、それらを持たない形でも `.kiro/aidlc-common/personas/<agent>.md` として出荷されます。これはリードが自身のチャットで読むファイルです）。`kiro` ハーネスの agent-v1 JSON は出荷しません。[Porting to a New Harness](../../harness-engineering/09-porting-to-a-new-harness.md) を見てください。

## 次のステップ

導入と起動が済んだら、方法論の説明へ進みます。方法論はどのハーネスでも同じです。ハーネス非依存の章へ進んでください。

- [最初のワークフロー](../02-your-first-workflow.md) — 注釈付きの通し実行。
- [フェーズとステージ](../04-phases-and-stages.md) — 5 フェーズと 33 ステージ。
- [スコープ・深度・テスト戦略](../05-scopes-and-depth.md) — 作業に合う実行範囲の選び方。
- [用語集](../glossary.md) — 用語の定義。

ほかのハーネス: [Codex CLI で AI-DLC を動かす](codex-cli.md) · [Cursor で AI-DLC を動かす](cursor.md) · [ハーネス一覧](README.md)。
