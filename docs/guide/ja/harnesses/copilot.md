# GitHub Copilot で AI-DLC を動かす（CLI + VS Code）

Copilot ランタイムは、フレームワークのハーネス配布の一つで、対象は **GitHub Copilot** です。1 回の導入で Copilot の面が両方使えます。単体の Copilot CLI（`copilot`）と、VS Code の agent mode です。GitHub は両者のプロジェクト発見パスを揃えました（`.github/skills/`、`.github/agents/`、`.github/hooks/`、ルートの `AGENTS.md`）。なのでフレームワークも、両方が読むディレクトリツリーを 1 つだけ出荷します。決定論的なコアは一つ、ハーネスは複数。エンジン、状態機械、監査ログ、グラフ、スウォームの審判、ラーニングゲートは、どの配布でもバイト一致です。違うのはシェルだけです。ソース／開発用のディレクトリツリーは `core/` + `harness/copilot/` から `bun scripts/package.ts copilot` で、無視されるローカル `dist/copilot/` へ **生成** されます。手で編集しないでください。

完全な導入案内は、引き続きルートの `AGENTS.md` にあります。Copilot 固有の設定と、方法論ファイルを読み込む生きた `@`-import ブロック、続いてハーネス共通のプロジェクト案内です。Copilot の管理ルートブロックは専有のままで、共通ブロックだけを出荷するハーネスとは共有しません。プロジェクト指示をマージするときも、それらの import を残してください。

## 配置: エンジンディレクトリと .github シェル

- **`.aidlc/`** — AIDLC のエンジントリー（ツール、フック + Copilot アダプタ、エージェント、ナレッジ、スコープ、センサー、aidlc-common）。Copilot のどちらの面もここは走査しません。人が見るものはすべて `.github/` に乗ります。
- **`.github/`** — ネイティブに消費される、`aidlc` 名の出力だけ。フック配線（`hooks/aidlc.json`）、ペルソナの 14 体のカスタムエージェント（`agents/aidlc-*-agent.md`）、スキルツリー一式（`skills/aidlc*/` — オーケストレータ、ステージごとのランナー、スコープランナー、セッションスキル）。リポジトリ自身の `.github/`（workflows、templates）は触りません。導入はこれらのファイルを **マージ** します。接頭辞で衝突しません。
- **`.vscode/settings.json`**: VS Code の設定 1 つ、`chat.agent.maxRequests`。プロジェクトがそれを設定していないときだけ足します（[VS Code のリクエスト上限](#vs-code-のリクエスト上限) を参照）。コピー用ランタイムはこのファイルを含みません。

## 前提条件

- **Copilot CLI ≥ 1.0.74 かつ／または VS Code ≥ 1.130** — 確認済みの下限です。PascalCase のフック登録（両面が同じ snake_case ペイロードを渡す）、ブロックする PreToolUse の deny 経路、ブロックする Stop フック、`.github` のスキル／エージェント発見。確認は `copilot --version` / `code --version`。VS Code の agent hooks は Preview 機能で、doctor が検査するのは任意の Copilot CLI の版だけなので、`code --version` は自分で確認してください。[ファシリテーターガイド](../facilitator-guide.md#windows-での-github-copilot) に、フックが動くことを確かめる準備チェックがあります。
- **bun** は、ソース／開発用の `dist/` 投影を生成または実行するときだけです。ネイティブ導入と版付きリリースランタイムは `aidlc` を使います。
- **フォルダ信頼**: Copilot の各面は、それぞれ自分の信頼を検査します。
  - Copilot CLI がリポジトリフックを実行するのは、`trustedFolders` の一覧がカバーするフォルダ（そのフォルダ自身か、その上位のフォルダ）だけです。一覧は `COPILOT_HOME`、なければ `~/.copilot`（Windows では `%USERPROFILE%\.copilot`）の下の `config.json` にあります。対話の `copilot` 実行は、プロンプトを受け付ける前にフォルダ信頼の確認を求めます。記録するには "Yes, and remember this folder for future sessions" を選んでください。一覧がそのフォルダをカバーしていないときは、`aidlc config` が伝えます。
  - VS Code の agent mode は、この一覧を決して読みません。そのフックが動くのは、信頼されたワークスペース（VS Code の Workspace Trust）で、かつ **Chat: Use Hooks** 設定（`chat.useHooks`）が有効なときだけです。この設定は Preview 機能で、組織が無効にできます。プロジェクトがそれを設定していないとき、`aidlc config` はフォルダの `.vscode/settings.json` でそれを有効にします。フォルダの値は、無効にしたユーザー設定より優先されます。飛ばされたフックはチャットに何のメッセージも残しません。Agent Debug Logs パネルには表示されます。
  - CLI の一覧がフォルダをカバーしていないとき、`/aidlc --doctor` が警告します。doctor は VS Code の切り替えを見られませんが、あなたのメッセージに対してどのフックも動かなかったときは、AI-DLC がチャットでそう伝えます（下の「AI-DLC はフックが動かなかったことを伝えます」を参照）。
- **モデルプロバイダ** — この導入はモデルをピンしません。サインイン済みの Copilot はそのまま動きます。BYOK は GitHub 認証なしでも動きます（例: Amazon Bedrock の Anthropic 互換エンドポイント: `COPILOT_PROVIDER_BASE_URL=https://bedrock-runtime.<region>.amazonaws.com/anthropic`、`COPILOT_PROVIDER_TYPE=anthropic`、bearer トークン、そして `COPILOT_MODEL=<catalog name>` + `COPILOT_PROVIDER_WIRE_MODEL=<Bedrock model id>` — `copilot help providers` が集合を書いています）。VS Code ではモデルピッカーか Custom Endpoint プロバイダを使います。AI-DLC のどのエージェントも Copilot セッションのモデルと effort を使うので、そこで選んでください。[モデルと effort の選び方](../18-install-and-lifecycle.md#choosing-a-model-and-effort) を見てください。

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
aidlc config --harness copilot
aidlc doctor
```

### 版付きの手動コピー（代替）

特定リリースの `aidlc-copy-runtime-X.Y.Z.tar.gz` を、[Install and Lifecycle: コピー経路](../18-install-and-lifecycle.md#コピー経路) のとおりダウンロードして展開し、`RUNTIME_ROOT` を展開した `runtime/` ディレクトリにします。

1. 配布をプロジェクトへコピーします:

   ```bash
   mkdir -p your-project/.aidlc your-project/aidlc your-project/.github
   cp -R "$RUNTIME_ROOT/copilot/.aidlc/."  your-project/.aidlc/
   cp -R "$RUNTIME_ROOT/copilot/aidlc/."   your-project/aidlc/    # the workspace shell — a sibling of .aidlc/, not inside it
   cp -R "$RUNTIME_ROOT/copilot/.github/." your-project/.github/  # MERGE — everything is aidlc-prefixed, nothing of yours is overwritten
   ```

2. コピーのセットアップを一度実行します:
   `cd your-project && bun .aidlc/tools/aidlc.ts config --from "$RUNTIME_ROOT" --harness copilot`。
   `AGENTS.md`（方法論の include を含む）と `.gitignore` の既存の内容のあとへ AI-DLC の行を足します。プロジェクトにファイルがなければ作ります（クローンごとの監査シャードは意図してコミットします。カーソルとマシンローカルのランタイムは無視したままです）。これを実行しなくても、最初のチャットが始まるときに AI-DLC が足します。
   VS Code では、`.vscode/settings.json` がそのキーを設定していなければ、`"chat.agent.maxRequests": 200` も足してください（[VS Code のリクエスト上限](#vs-code-のリクエスト上限) を参照）。コピー用ランタイムはこのファイルを含まないので、コピーがあなたのファイルを置き換えることはありません。

3. フォルダを信頼します。プロジェクトで `copilot` を一度対話起動し、信頼プロンプトを受け入れる（または `~/.copilot/config.json` の `trustedFolders` にプロジェクトの絶対パスを足す）。

4. `/aidlc --doctor` を実行し、続けて `/aidlc` と作りたいものを。どちらの面でも同じです。

Bun 形の投影が要るフレームワーク開発者は、リポジトリを clone し、`bun install --frozen-lockfile` と `bun scripts/package.ts` を実行し、無視されるローカル `dist/copilot/` 出力を使えます。

## このハーネスで違うところ

- **1 回の導入で面は 2 つ。** スキル、ペルソナ、指示、フックは CLI と VS Code agent mode で同じ動きです。下の差分は明示しています。
- **ランナーは、入力したときだけ始まります。** 生成したランナー（`/aidlc-bugfix`、`/aidlc-<stage>`、`/aidlc-init` など。プラグインランナーも含む）はすべて `disable-model-invocation: true` を持つので、エージェントが自分から始めることはなく、ランナーの説明も Copilot のスキル一覧に入りません。VS Code のチャットと対話 CLI では、入力すればこれまでどおり動きます。ヘッドレスの `copilot -p "/aidlc-bugfix ..."` は、あなたの行をプレーンテキストとしてエージェントへ渡します。ルートの `AGENTS.md` が、そのランナーのファイルを読んで従うよう指示するので、ランナーはそれでも実行されます。
- **質問は番号付きの散文選択肢で出ます。** 両面ともネイティブのピッカーツールはありますが、ピッカーの答えはツール結果として返り、人の存在ガードが求める信頼できる `UserPromptSubmit` イベントを発火しません。セッションで選んだワークフローが有効な `Status: Running` のあいだ、マッチャー無しの PreToolUse ガードはそれらのピッカー呼び出しを拒否し、モデルに番号付き散文を出してターンを終えさせます。実行中のワークフローがないとき（完了や使えない状態も含む）は、ネイティブピッカーはそのままです。人が次に打つチャットメッセージが存在になります。正本は `[Answer]:` タグ付きの questions ファイルです。
- **あなたの返答として数えるのは、入力したものだけです。** エージェントがサブエージェント（レビュアー、ビルダー）へ仕事を渡すとき、VS Code と Copilot CLI はエージェントが書いたブリーフを、あなたのチャットメッセージと同じ方法でフックへ届けます。AI-DLC はそのブリーフを見分け、決してあなたのターンとして記録しません。承認を満たさず、あなたの回答や変更要求としても読まず、入力された切り替えも適用しません。あなたが入力したものは、サブエージェントの実行中も含め、これまでどおり数えられます。例外は VS Code だけで、チャットでサブエージェントが始まった直後の、そのブリーフがまだ届いていない数秒です。そのとき AI-DLC がブリーフと照合できないメッセージはそのブリーフとみなされて数えられず、それがあなたのものだった場合は、もう一度返答するよう求められます。Copilot CLI はあなたのチャットへブリーフを送らないので、そこではあなたが入力したメッセージはすべて数えられます。作業が残ったままターンが終わるときに AI-DLC がエージェントへ出す自身のメモ（"The last AI-DLC step stopped on a problem: ..." など）も、あなたのターンではありません。Copilot CLI はそれをチャットメッセージとして返しますが、AI-DLC はそれを見分け、あなたのものとして記録しません。
- **`/aidlc` を依頼と一緒に入力すると、あなたの言葉は残ります。** スラッシュ名で呼び出したスキルを、Copilot はあなたが入力した行としてではなく、あなたの言葉を埋め込んだスキル自身のテキストとして AI-DLC へ渡します。そのテキストが、インストール済みのスキルファイルにあなたの言葉を入れただけのものと完全に一致するとき、AI-DLC はその行（`/aidlc` とあなたの言葉。言葉はスキルのテキストが運ぶ箇所からそのまま取ります）を組み立て直します。そのため、エージェントの最初のコマンドにあなたの依頼が一切含まれていなくても、依頼は記録に残り、作業に届きます。そのファイルと完全には一致しないものは、Copilot が届けたとおりに記録します。
- **AI-DLC のエージェントにはステージのルールが渡され、ビルダーはあなたの計画承認を待ちます。** エージェントが VS Code の `runSubagent` ツールで AI-DLC のエージェントを始めても、CLI の `task` ツールで始めても、AI-DLC は今のステージのルールを渡します。Code Generation の間は、あなたが計画を承認するまで developer エージェントを始めません。エージェントは、どちらの面でも同じ「先に計画を承認する」拒否を受けます。
- **AI-DLC はフックが動かなかったことを伝えます。** どちらの面も、チャットに一言もなくリポジトリフックを飛ばすので（上のフォルダ信頼を参照）、AI-DLC がそれを見張ります。最初のメッセージに対してどのフックも動かなかったとき、または一度もフックが動いていないワークフローでステージが始まったときは、次の一歩は仕事をしません。VS Code では、エージェント自身がフォルダの `.vscode/settings.json` で Chat: Use Hooks を有効にし（VS Code がその編集の許可を求めます）、"Fixed. Send your next message here to carry on." と伝えます。同じチャットでの次のメッセージは、フック付きで実行されます。設定がすでに有効だった場合は、組織がそれを無効にしていると伝えます。人の存在の検査を無効にしている場合は、仕事は続き、エージェントが代わりに一度だけ伝えます。そのフォルダで最初の Copilot チャットをする前は、`/aidlc --doctor` が "AIDLC hooks have not run in this project yet" と警告し、ステージのあとは同じ手順を示して失敗します。動いたもののクラッシュしたフックは、それでもあなたの操作を通し、そのエラー行を `.aidlc-engine/hooks-health/<hook>.drops` に残します。doctor はそれを読みます。
- **フックはネイティブに強制します。** アダプタ（`.aidlc/hooks/aidlc-copilot-adapter.ts`、配線は `.github/hooks/aidlc.json`）は、コアのガードによるブロックを Copilot の `permissionDecision: deny` に変換します。レビュアーの読み取り範囲と状態遷移ガードは、実際にツール呼び出しを拒否します。SessionStart と Stop の応答は、CLI のトップレベルフィールドと、VS Code が求める `hookSpecificOutput` 封筒の両方を持ちます。
  CLI では実機確認済みです。VS Code agent mode では同じ deny／block 経路が文書化されており、アダプタは `runTerminalCommand`、`createFile`、`editFiles`、`readFile` などの文書上の名前を正規化しますが、IDE 側はまだ実機確認していません。IDE の強制は、確認が終わるまでベストエフォートと考えてください。
- **VS Code では、AI-DLC の定型コマンドは Allow の確認なしで動きます。** VS Code の agent mode は通常、ターミナルコマンドのたびに "Run command? Allow / Skip" と尋ねるので、ワークフローの各ステップがクリック待ちになります。アダプタは、AI-DLC がステージ中に実行する定型コマンドに `allow` と答えます。`next`、`continue`、`report`、`park`、読み取り専用の `next` 形、エンジンが指定するフラグ付きの `doctor`（または `--doctor`）、`--version`、`--status`、`--help`、AI-DLC 自身の検査（`engine sensor-traceability`、`sensor-required-sections`、`sensor-upstream-coverage`、`sensor-claim-sources`。どれもファイルを読みます。traceability の検査は、ステージがその表を始めるために実行したとき、記録の中のそのステージ自身のカバレッジ表も書きます）、そして AI-DLC 自身のコマンド表にあるプロジェクトコマンド（`engine log`、`engine state`、`engine runtime`、`engine learnings`、`engine testing-posture`、`engine intent list`、`engine intent add-checkout` など）です。直接、ソースディスパッチャ、コンパイル済み、ツールスクリプトのどの綴りでも同じです。コピー経路の `aidlc-utility.ts <verb>` も、`engine workspace <verb>` の綴りと同じ答えを受けます。答えるのは、次のすべてを満たすときだけです:
  - 呼び出しが VS Code のチャットセッションを伴い、AI-DLC のすべてのガードを通過し、ワークフローコマンドがこのセッションのワークフローに照合されている。
  - PowerShell、cmd、POSIX シェルのどれでも同じように読める、一つの素のコマンドである。連鎖、パイプ、末尾の `2>&1` 一つ以外のリダイレクト、前置きの環境変数代入、シェル展開がなく、それらのシェルのどれかが特別扱いする文字（`$`、バッククォート、`%`、`^`、`!`、`#`、波括弧、`@`、`\`、組版用の引用符など）を、引用符の中でも含まない。引用した語は空白、`?`、丸括弧、`;` を含んでよく、二重引用符の中ならアポストロフィも含めます。二重引用符の中のテキストは、空白を含む場合に限り `|`、`&`、`<`、`>` も含めます。たとえば `--details "Q1: A - both ends included (closed range)"` や `--options "Keep the note|Skip it"` です。引用符の外、単一引用符の中、空白のない二重引用符の中では、それらは確認を残します。素の ASCII 以外のテキスト（たとえばアクセント付きの文字）も確認を残します。VS Code のターミナルが PowerShell か cmd である Windows では、バックスラッシュは普通のパス区切りなので、`C:\work\app`、`.aidlc\tools\...`、`--project-dir 'C:\work\app'`（エンジンがプロジェクトフォルダを表示する形）のようなパスはクリックなしで動きます。確認を残すのは、閉じ引用符の直前のバックスラッシュだけです。Git Bash や WSL のターミナルでは、バックスラッシュは引き続き確認を残します。PowerShell のターミナルでは、プロジェクトフォルダ自身へのフルパスでの `cd` か `Set-Location` を一つだけ先頭に置けます。`cd C:\work\app; aidlc engine orchestrate next` は、計画が承認待ちの間も含め、`aidlc engine orchestrate next` と同じように動きます。それ以外のフォルダ（サブフォルダも含む）への `cd` は確認を残します。インストールした `aidlc` は、実行されたフォルダをプロジェクトとみなすからです。`cd` なしでコマンドを実行するか、プロジェクトフォルダ自身へ `cd` してください。
  - パスとして読めるすべての引数が、プロジェクトの中にとどまる。
  - AI-DLC に自分で実行させるコマンドを渡すオプション（`--check-cmd`）がない。
  - 素の `aidlc` が、インストールしたランチャーである。プロジェクトのルート、または `PATH` 上のフォルダに `aidlc` という名前のファイル（`aidlc.cmd` や、`PATHEXT` に並ぶ任意の拡張子のもの）があると、コマンドは確認を残します。cmd は `PATH` を探す前に作業フォルダのファイルを実行するからです。

  それ以外には AI-DLC は答えないので、VS Code の確認かあなた自身の承認設定が適用されます。エージェントがプロジェクト向けに書くコマンド（ビルド、テスト、`git` など）、マシン単位のコマンド（`update`、`uninstall`、`use`、`config`、`system ...`）、ホストが実行するフック、アダプタ、ステータスラインのエントリ、そして次の AI-DLC コマンドです。これらは、実行前に一つずつ確認できるよう確認を残します:
  - あなたの仕事を捨てる、またはマージするコマンド: `engine worktree discard`、`purge`、`merge`、`unit land`、`engine intent archive`、`engine swarm finalize`、`engine bolt abort`（`--discard` の有無を問わず。Bolt の中止にはあなたの同意が要るため）。
  - 表示されるステージ、ゲート、レビューを変えるコマンド: 最後の質問以降あなたが返答していないときの `engine recompose`（計画の変更を承認したあと、それを適用する recompose はクリックなしで動きます）、`next --skip`、`next --add`、`engine jump execute`、`engine scope change`、`engine intent create --skip`、`engine intent remove-checkout`（レビューの対象からコードを外します）、`engine config set` と `next config set`、`engine bolt set-autonomy`、その作業で状態遷移の検査が（あなたか Guard Policy によって）オフになっている間の `engine state` の状態変更（そのときは変更が実際に適用されるため）、ゲートの設定コマンド（`set-unit-gate-rhythm`、`set-construction-checkpoints`、`set-skeleton-stance`、`set-status`）。その検査がオンの間は、AI-DLC が `engine state` の状態変更そのものを拒否するので、クリックする対象はありません。`set-construction-checkpoints` と、あなたの検査（計画承認、要約確認、フェンス、Guard Policy）の一つに対する `engine config set` は、最後の決定以降にチャットでその変更を頼んでいればクリックなしで動き、検査を再び有効にする操作は常にクリックなしで動きます。
  - 進行中の仕事を切り替えるコマンド: `engine intent switch`（または `engine intent <name>`）と `engine space switch`（または `engine space <name>`）。
  - リモート経由で取得と承認を共有するチームの `unit` コマンド（`unit merge-status` を除くすべて）。
  - AI-DLC が出荷していないコードを実行する、またはインストール済みのスキルを書き換えるコマンド: `engine sensor fire`（検査が指名するものを何でも実行する）、`engine sensor-linter` と `sensor-type-check`（プロジェクトのリンターと型検査を実行する）、`engine knowledge onboard`、`sync`、`engine workspace document-input --onboard`（ハーネスが指名する文書抽出器を実行する）、`engine plugin sync`、`select`、`build`、`plugin build`、`engine gen runners` と `runner-scopes`。

  エンジンが自身の適用可否の検査によってエージェントに飛ばすことを許す条件付きステージは、クリックなしのままです。`doctor` も同じで、自分で実行したときと同じく、リリースフィードから更新確認を新しくすることがあります。クリックを飛ばしても、あなたの決定は何も記録されません。エンジンがステージの承認を記録する前に、ステージが始まって以降、かつ最後の決定以降に、あなたがチャットメッセージを送っている必要があり、それはプロンプトフックが記録します。ゲートが表示されたあとのメッセージか、エージェントがゲートへのあなたの回答として名指しするメッセージです。この検査が確かめるのはあなたがターンを取ったことであって、あなたの意図ではないので、エージェントの報告を読んでください。これは VS Code 自身の自動承認を使わないので、組織のポリシーがそれを無効にしている場所でも動きます。ただし AI-DLC の他の部分と同じく、チャットフックが有効である必要があります。Copilot CLI ではアダプタは権限の決定を返さないので、これまでどおりあなた自身の `--allow-tool` と `--deny-tool` の規則が決めます。
- **コマンド追跡は正確で、かつベストエフォートです。** AI-DLC が追うのは、単純で直接のオーケストレータ、ソースディスパッチャ、実コンパイル済みの `next`、`continue`、`report`、`park` です。末尾の `2>&1` は 1 つまで対応します。検査コマンドは `aidlc` 部分文字列からは分類しません。曖昧なラッパや、引数に生きたシェル展開（`$VAR`、グロブ、ブレース展開、先頭の `~`）を含むコマンドは、そのまま未追跡で実行されます。フックはシェルが最終的に作る argv をハッシュできないからです。直接に見える複合コマンドは拒否します。明示の `--project-dir` が今の物理プロジェクトの外なら、今のプロジェクトの調整を書く前に拒否します。
- **AI-DLC が照合できない `continue` も先へ進みます。** フックが AI-DLC コマンドの記録を見つけられない、または信頼できないとき（たとえば記録が削除されたあと、あるいはフックとターミナルでプロジェクトパスの綴りが違うとき）は、拒否せずにコマンドを実行させ、エンジンがディスクから答えます。自身の記録が一致すれば次の部分を、一致しなければ現在のステップを返します。"could not match this Copilot command" のあとにまたパート 1 が出ることはなくなりました。監査には、そうした通過ごとに `COORDINATION_STOOD_ASIDE` 行が一つ残ります。VS Code では、この形で通る定型コマンドも Allow のクリックなしで動きます。
- **継続のリプレイは、どのハーネスでもエンジンが持ちます。** Copilot も Claude、Codex、Cursor、Kiro、Kiro IDE、opencode と同じ、レコードローカルでアトミックな単回カーソルです。ネイティブのトークン検証が先に実行され、エンジンがトークン全体の SHA-256 を比べ、アクティブディレクティブのロックの下で、正確な後続を stdout の前に公開します。Copilot のセッション所有と配送証拠はそのマーカーを豊かにしますが、リプレイの所有者ではありません。欠落、破損、v1、事前共有のマーカーは、同じトランザクション内で一度復旧します。新しい `next` がカーソルをリセットします。クラッシュ、移行、ロールバック、ファイルシステムの上限は、Developer Reference の共有カーソル契約を見てください。
- **Stop は、いま配送済みの Copilot ディレクティブを保ちます。** ホストの正確な `tool_use_id`、または書き換えられたエンジン入力を通して運ばれ PostToolUse が返すアダプタ ID があれば、セッション範囲の Stop と Resume の配送を確定できます。正確な相関が取れなければ、実行は未追跡で通し、Post は推測しません。単純な新しい `next` が追跡配送を戻します。相関の喪失が恒久的な deny にはなりません。クレームを一度試みたあと、プロジェクト、状態、セッション所有の拒否は明示の deny です。別セッションが、所有者の今のトークンを未追跡の仕事として実行することはできません。ワークフローを先へ進める `report`（承認、スキップ、終えたステップ）は止まりどころではありません。エージェントはすぐに `next` を実行します（同じ返答で、ワークフローをいったんそこで止めるよう人が頼んだときは park します）。それでも止まった場合は、Stop が新しい `next` を、止めるよう頼んだ人には `park` を示すので、次のステージは同じターンで始まります。ターンをそこで終えるのは、ワークフロー完了の report と、単独のシングルステージ実行だけです。
- **レガシーの Resume と会話待ちはセッション範囲です。** Stop は、本物の会話応答がきれいに終わるのを許します。2.6.19 より前の導入が書いた Resume マーカーは所有者範囲のままです。明示の `next --resume` がそれを上書きし、直接続けます。プロンプト本文とルール内容は、調整マーカーには残りません。
- **ホスト証拠の範囲は意図して限っています。** 書き換えと運ばれた ID のエコーは、macOS の Copilot CLI 1.0.79、非対話モードで実機確認しています。VS Code の `tool_use_id`、`updatedInput`、`tool_response` 経路は、文書化された Preview 契約からカバーしていますが、ここでは実機確認していません。Copilot cloud agent は、このリリースの対応 AI-DLC 面の外です。
- **ほとんどのステージは、ルールを読み込むのに一手間増えます。** VS Code のターミナルツールがコマンドの結果を丸ごと保てるのは 20,000 文字までで、それより長い結果はファイルに保存され、チャットには最初と最後しか見えません。AI-DLC は Copilot で出すすべての指示を 19,000 バイト未満に保つので、ルールが指示と一緒に収まらないステージは先にルールを送り、モデルはステージが始まる前に、それと一緒に表示された `continue` コマンドを実行します。Construction では、各 Unit の各ステージでそうなります。ネイティブ導入では、`aidlc update` を実行した時点で、すでに進行中のワークフローにもこれが届きます。`aidlc config` による更新は不要です。`.aidlc-version` で以前のリリースにピンしたプロジェクトはそのリリースで動き続けるので、ピンしたプロジェクトでは、このリリース以降で `aidlc config --pin` を実行したときに反映されます。
- **増えた手順をクリックなしで動かす。** VS Code がターミナルコマンドのたびに許可を求める場合は、Allow の選択肢から **Configure Auto Approve...** を選び、`chat.tools.terminal.autoApprove` 設定に `"aidlc engine orchestrate": true` を足してください。すると VS Code は AI-DLC のワークフローの手順を尋ねずに実行し、他のコマンドは通常の確認を保ちます。ワンクリックの **Allow `aidlc ...` in this Session** や **Allow `aidlc ...` in this Workspace** も効きますが、`aidlc config`、`aidlc update`、`aidlc uninstall` を含む、すべての `aidlc` コマンドのクリックを飛ばします。コピーした Bun ランタイムでは手順が `bun .aidlc/tools/` で始まるので、そこでのワンクリックの選択肢はすべての `bun` コマンドを許可してしまいます。AI-DLC 自身は自動承認の設定を何も入れません。
- **フック配線は設計上マッチャー無しです。** VS Code はフックマッチャーをパースしますが **無視** します。なのでアダプタの各対象は `tool_name` で自己フィルタします。マッチャーを付けると、IDE では静かに対象が広がります。
- **レビュアーの識別情報は配送ではなく相関です。** PreToolUse ペイロードに呼び出しごとのエージェント欄はありません。アダプタは SubagentStart/SubagentStop（VS Code の `agent_type`/`agent_id` も含む）で委譲を括り、サブエージェントがちょうど 1 体だけ生きているときに識別情報を転送します。重なりが曖昧なら、その呼び出しはフェイルオープンです（レビュアーモジュールの散文境界は効いたままです）。
- **ペルソナに `model:` ピンはありません。** 二つの面でモデル値の構文が違います（CLI は frontmatter 文字列を BYOK プロバイダへそのまま転送し、IDE の表示名はそこで 400 になります）。エージェントはセッションモデルを継ぎます。このハーネスのティア投影は、型としてモデル省略です。
- **ワーカーペルソナは明示の組み込み `tools:` 許可リストを使います。** Copilot の `agent` 委譲ツールを外し、ネストした委譲を止めます。Copilot には agent 以外全部、という形がないので、委譲されたワーカーは任意の MCP ツールを継ぎません。
- **AIDLC プラグインは Copilot ネイティブの面を使います。** 合成したプラグインペルソナと、生成したステージ／スコープランナーは `.github/{agents,skills}` に落ちます。プラグイン選択はそれらのパスを再生成し、`.aidlc/skills` や `.opencode/agents` は作りません。
- **セッション終了:** VS Code は SessionEnd を文書化していないので、共有フックマニフェストは両ホストでそれを出しません。アダプタは次の SessionStart で直前セッションを、推定した出自付きで突き合わせます（codex と同じ型です）。
- **方法論の include は AGENTS.md の `@`-import に乗ります**（CLI では実機確認済み。VS Code は `@`-import 展開を文書化していますが、そちらではまだ実機確認していません）。`@` 行と `.github/agents/` のペルソナ双子は `aidlc/active-memory/` を読みます。これはアクティブスペースの方法論をエンジンが git 無視で複製したものです。`/aidlc space <name>` はブロックではなく、その複製を書き換えます。
- **ステータスラインはありません。** `/aidlc --status` と、ゲートの進捗行を使ってください。
- **Construction スウォームはサブエージェントの fan-out だけです**（`AIDLC_USE_SWARM=1` は目立つ no-op です）。
- **MCP:** 同梱はありません。サーバーを足すなら、面がここで分かれます。CLI は `~/.copilot/mcp-config.json`、VS Code は `.vscode/mcp.json` を読みます。コンダクターは使えますが、委譲されたワーカーペルソナは使えません。

## VS Code のリクエスト上限

VS Code の agent mode は、1 ターンで `chat.agent.maxRequests` 回（既定 50）のリクエストに達すると止まり、"Continue to iterate?" と尋ねます。チャットは誰かが答えるまで黙って待つので、ツール呼び出しが 50 回を簡単に超える無人の Construction ステージは、途中で止まったままになります。そのため `aidlc config --harness copilot`（初回導入と毎回の更新）は、プロジェクトの `.vscode/settings.json` に `"chat.agent.maxRequests": 200` を足します:

- プロジェクトがそのキーを設定していないときだけです。チームがすでに設定した値は、`--force` でも変えません。
- 他のキー、コメント、レイアウトには触れません（ファイルは JSONC です）。ファイルがなければ作ります。
- AI-DLC のものとして記録されるのは、AI-DLC が足した値だけです。後のリリースがこの設定の出荷をやめた場合、config がそれを取り除くのは、AI-DLC が書いた値のままであるときだけで、ファイルを取り除くのは AI-DLC がそれを作った場合だけです。`aidlc uninstall` はプロジェクトファイルを決して編集しないので、設定は残ります。
- AI-DLC がキーを足したあと、残す設定ファイルからそれを外すのはあなたの選択で、config はそれを戻しません。設定ファイルがまったくないチェックアウトには、再び足されます。

この設定はウィンドウ範囲なので、プロジェクトの値がユーザー設定より優先されます。AI-DLC の `.gitignore` ブロックは `.vscode/*` を git から外すので、値はチェックアウトごとのものです。config は実行された場所に足します。コピーしたプロジェクト（コピー経路）には、このファイルをマージする config の手順がなく、そのランタイムもファイルを出荷しないので、キーは自分で足してください。`/aidlc --doctor` は、プロジェクトの値が 100 未満のとき、未設定のとき（ユーザー設定、なければ VS Code の既定の 50 が適用されます）、数値でないとき（引用符で囲んだ数値も含む）、読めないときに警告し、書くべき行を示します。AI-DLC が足したあと、チームが残す設定ファイルからそのキーを外した場合には警告しません。

マルチルートのウィンドウは、このウィンドウ範囲の設定を、フォルダの `.vscode/settings.json` ではなく `.code-workspace` ファイルから読みます。そのため Copilot プロジェクトでは、`aidlc system workspace-sync` が生成する `aidlc.code-workspace` にも `"settings": { "chat.agent.maxRequests": 200 }` を一度だけ書きます。書くのは、まだ settings を持たないファイルだけです。ファイルの settings にすでにあるキーと値はチームのもので、取り除かれたキーも含めてそのまま残ります。workspace-sync はファイルを書き直すので、その中のコメントは残りません。そのファイルがあるときは、ワークスペースを開くたびにそれが効くファイルなので、doctor はそれも検査します。

## 確認

```bash
cd your-project
copilot -p "/aidlc --doctor" -s --allow-all-tools   # or run /aidlc --doctor in VS Code chat
```

doctor はエンジントリー、アダプタの依存すべて、ルートの `AGENTS.md`、`.github` の配線ファイル、Copilot CLI のバージョン下限、フォルダ信頼を検査します。Copilot CLI は任意です。VS Code だけの導入は `Harness CLI: optional copilot is not installed` と報告して合格します。CLI がないとき、VS Code はターミナルの PATH に "Install GitHub Copilot CLI? (y/N)" と尋ねる独自の代役 `copilot` を置くので、doctor と初回セットアップはそれを決して実行しません。そのフォルダの先にある本物の CLI を探し、なければ未導入と報告します。下限未満の CLI が入っている場合は警告で、失敗にはなりません。このハーネスの決定論的エンジンテストは `tests/unit/t248-copilot-packaging.test.ts`、`t249-copilot-adapter.test.ts`、`t250-copilot-adapter-security.test.ts`、`t-copilot-directive-budget.test.ts` です。実機の通しは `tests/e2e/t-exec-copilot-status.serial.test.ts` と `tests/e2e/t-exec-copilot-release-journey.serial.test.ts` で、`AIDLC_COPILOT_EXEC_LIVE=1` でゲートします。Full Suite は両方を Linux、macOS、Windows で実行します。
