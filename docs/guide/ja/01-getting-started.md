# はじめに

このページでは、何もない状態から最初のステージ承認までを案内します。AI-DLC をインストールし、`aidlc config` でプロジェクトを設定し、`aidlc doctor` で確認してから、Claude Code で `/aidlc` を実行して最初の承認まで進めます。以下の画面はすべて、新しいホームフォルダでの実際の実行から取ったもので、省略した箇所はそう明記しています。サンプルでは、`X.Y.Z` はインストールしたリリース、`/home/you` はホームフォルダを表し、Claude Code の罫線などの描画文字（枠、矢印、チェック）はプレーンテキストで示すか省いています。ほかのツールではいくつかの手順が異なり、[ほかのツールの場合](#ほかのツールの場合)に挙げています。

## 始める前に

- **インストールしてサインイン済みのハーネス。** このページでは Claude Code を使います。3 つのツールについては、AI-DLC が動作する最も古いバージョンを確認し、あなたのバージョンがそれより古いときは `aidlc doctor` が知らせます。

  | ツール | 最も古いバージョン |
  | --- | --- |
  | Codex CLI | 0.145.0 |
  | GitHub Copilot CLI | 1.0.74（VS Code だけのインストールには CLI が含まれない場合があります） |
  | Kiro CLI | `kiro` 行は 2.6.0、`kiro-ide` 行は 2.24.1 |

- **Codex CLI と Cursor には Git。** Codex CLI はプロジェクトのフックを Git リポジトリの中でしか見つけず、Cursor はリポジトリの外ではフックを飛ばすことがあるため、新しいフォルダでは `aidlc config` の前に `git init` を実行してください。
- **ほかには何も要りません。** ネイティブインストーラーが AI-DLC の実行に必要なものをすべて持ち込むので、Bun や Node.js は不要です。

## 1. AI-DLC をインストールする

macOS、Linux、WSL:

```bash
curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1 | iex
```

インストーラーは、ネイティブの `aidlc` コマンドと各ハーネスのランタイムという、AI-DLC に必要なものをすべてセットアップします。Bun や Node.js をインストールする必要はありません。ネイティブインストールはフックとコマンドを `aidlc` 経由で実行し、`bun` を呼び出しません。Windows では現在のアカウント向けにインストールし、bin ディレクトリを永続的なユーザー PATH に登録したうえで、実行中の PowerShell プロセスにも反映します。通常の PowerShell ウィンドウから実行してください。「管理者として実行」で開いたウィンドウでは、管理者としてのインストールは安全性が下がるため、警告と確認が表示されます。すでに開いていたターミナルアプリや IDE（Kiro、VS Code、Cursor）は起動時の PATH を保持したままなので、そこで `aidlc` を使う前にいったん終了して開き直してください。その中で新しいタブを開くだけでは足りません。PATH の変更を両方とも行わない場合は [`-NoModifyPath`](18-install-and-lifecycle.md#windows-powershell) を使い、表示された直接実行のコマンドを使います。macOS、Linux、WSL で `aidlc` が見つからない場合は、インストーラーが表示した PATH の設定を適用してください。

macOS と Linux では、`~/.local/bin` がすでに PATH にある場合、次のように終わります。

```text
PASS installed AI-DLC X.Y.Z with all harness runtimes
Plugin marketplace for Claude Code and Codex: /home/you/.local/share/aidlc/plugins (add it once; updates keep it current)
Next: aidlc config
```

PATH にない場合は次のようになります。

```text
PASS installed AI-DLC X.Y.Z with all harness runtimes
Plugin marketplace for Claude Code and Codex: /home/you/.local/share/aidlc/plugins (add it once; updates keep it current)
Add AI-DLC to PATH for this shell:
  export PATH="/home/you/.local/bin:$PATH"
Then run: aidlc config
```

表示された `export` の行を実行し（残しておくにはシェルの起動ファイルに追加します）、コマンドを確認します。

```text
$ aidlc version
aidlc X.Y.Z (runtime X.Y.Z)
```

これらの行の前に、ダウンロードはリリースファイルごとに `Downloaded <file>` の行を 1 行ずつ表示します。最近の GitHub CLI がないマシンでは、
`WARN GitHub CLI attestation verification is unavailable; continuing with SHA-256 release checksums.`
も表示されます。SHA-256 の検査は常に実行され、GitHub CLI は署名付き来歴の検査を加えます（[リリースの認証](18-install-and-lifecycle.md#release-authentication)）。Windows では、インストーラー自身の結果は `Installed AI-DLC X.Y.Z` で始まり、後の画面のパスは `.claude\` のように Windows の区切り文字を使います。プラグインマーケットプレイスの行は AI-DLC 自身のプラグイン向けです。そのパスを Claude Code か Codex で一度追加するか（[プラグイン](18-install-and-lifecycle.md#plugins)）、使わないなら飛ばしてください。

プロジェクトのファイルを自分で管理したい場合や、ネイティブ実行ファイルをインストールできない場合はどうでしょうか。Bun が必要になるのは、この手動コピー方式だけです。[Bun](https://bun.sh/) を導入し、[リリース](https://github.com/awslabs/aidlc-workflows/releases/latest)から `aidlc-copy-runtime-X.Y.Z.tar.gz` を取得し、`runtime/<harness>/` ディレクトリ全体をプロジェクトへコピーして、[コピー経路](18-install-and-lifecycle.md#copy-channel)のとおり、その中のセットアップを一度実行してください。コピーで `.gitignore` や `AGENTS.md` が置き換えられることはなく、AI-DLC は自分の行を追記します。この手動コピー方式にネイティブの `aidlc` コマンドは不要です。

## 2. プロジェクトを設定する

プロジェクトのフォルダで `aidlc config` を実行します。AI-DLC は上位へ git のルートを探しにいかないので、このフォルダが `aidlc/` の置かれる場所になります。複数のリポジトリがある場合は [`aidlc/` の置き場所](03-spaces-and-intents.md#aidlc-の置き場所)を参照してください。この実行では新しい空のフォルダを使います。

```text
$ mkdir inventory-api && cd inventory-api && git init -q
$ aidlc config

  AI-DLC setup - first run in this project.

  Checked your machine and this repo:

    Harness    Claude Code detected  (2.1.296 on your PATH)
    Project    git repo, no AI-DLC files yet
    AWS        credentials not found
    Runtime    aidlc on this shell's PATH only: start Claude Code from a terminal

  Set up AI-DLC for Claude Code with recommended defaults?

    1. Yes, use recommended defaults   MCP servers on, all plugins, current model provider
                                       preserved
                                       Records balanced (default): medium project agent effort for
                                       deciding, reviewing, and writing up; your session
                                       (conductor) effort stays unchanged.
    2. No, customize step by step      harness, provider, preset, plugins, MCP, record layer
    3. Exit, nothing written

  Choice [1]:
```

答えるまで何も書き込まれません。確認した内容は次のとおりです。

- **Harness**: PATH で見つかったツールで、これを設定の対象にします。複数あれば、まずどれにするかを尋ねます。1 つもなければ、[ハーネスをインストールする前に設定する](#ハーネスをインストールする前に設定する)を参照してください。
- **Project**: ここが Git リポジトリかどうか、AI-DLC がすでにここに設定されているかどうか。設定済みのプロジェクトでは、`aidlc config` はこれらの質問をする代わりに、置かれているものを確認します（[プロジェクトの設定と更新](18-install-and-lifecycle.md#configure-or-refresh-a-project)）。
- **AWS**: AWS の認証情報が見つかったかどうか。これが関係するのは、モデルプロバイダーに Amazon Bedrock を選ぶ場合だけです。
- **Runtime**: AI-DLC のフックが `aidlc` コマンドを見つけられるかどうか。ターミナルから起動した Claude Code はそのターミナルの PATH をフックに渡すので、シェルの PATH に `aidlc` があれば足ります。そのためこの行は、ターミナルから起動するよう伝えます。ここで数えた PATH の修正は、セットアップの最後に表示されます。代わりにデスクトップのアイコンから Claude Code を起動する場合は、手順 4 で `aidlc doctor` が何を追加すればよいかを伝えます。

推奨の既定値にするには Enter を押します。記録される内容は次のとおりです。

- **MCP servers on**: 5 つの[配布サーバー](#mcp-サーバーの任意設定)を載せた `.mcp.json`。
- **All plugins**: インストール済みのプラグインをすべて有効にします。
- **Current model provider preserved**: AI-DLC はプロバイダーの設定を書かないので、Claude Code はすでに使っているプロバイダーとログインをそのまま使います。
- **balanced プリセット**: `aidlc.settings.json` に、AI-DLC 自身のエージェントが使う effort を記録します。あなた自身のチャットはモデルと effort をそのまま保ちます（[モデルと effort の選び方](18-install-and-lifecycle.md#choosing-a-model-and-effort)）。

続いて、Claude Code のステータスラインについてもう 1 つ尋ねます。

```text
  Show AI-DLC's progress in your status line? It takes the place of your own while you work in this
  project.

    1. Yes  (recommended)
    2. No, keep mine

  Choice [1]:

  AI-DLC's status line shows in this project; /aidlc --statusline off turns it off.

  Writing project files ... done  (.claude/ and aidlc/, 316 files)
  Recording model preset ... done  (aidlc.settings.json in this project)
  Setup complete. Start your first workflow:

    claude                         open Claude Code in this repo
    /aidlc "what you want built"  describe your first intent
```

この回答は `.claude/settings.local.json` と `aidlc.settings.local.json` に入ります。どちらもあなただけのファイルです（どちらも git 管理外）。

### 代わりにカスタマイズする

選択肢 2 は 6 つの手順を順に進みます。Enter を押すと毎回 `[default]` を選びます。この実行では、プロバイダーで Amazon Bedrock を選んだ以外は、すべて既定値のままにしました。

```text
  Customize setup - 6 steps, Enter accepts the [default].

  Step 1 of 6 - Harness
  Detected on this machine: Claude Code.

    1. Claude Code     (detected, default)
    2. Codex CLI
    3. GitHub Copilot
    4. Cursor
    5. Kiro CLI (V2)
    6. Kiro            Kiro IDE and Kiro CLI on its v3 engine
    7. opencode
  Harness [1]:
  Using Claude Code.

  Step 2 of 6 - Model provider
  No AWS credentials were detected.
    1. keep current     inherit the provider already configured in the harness (default)
    2. amazon-bedrock   write the AWS region and profile to settings.local.json, just for you
  Provider [1]: 2
  AWS region [us-east-1]:
  AWS profile [default credential chain]:
  Using amazon-bedrock in us-east-1 with the default credential chain.

  Step 3 of 6 - Model effort preset
    1. balanced    medium effort for deciding, reviewing, and writing up (recommended, default)
    2. thorough    session effort for deciding and writing up, extra-high reviewing
    3. minimal     medium deciding and reviewing, low writing up
    4. unchanged   records no preset and keeps existing settings; new projects use shipped defaults
                   where agents inherit your session's model and effort
  Preset [1]:
  Using the balanced preset.

  Step 4 of 6 - Plugins
    1. all installed   (default)
    2. none optional   core AI-DLC only
    3. choose          comma-separated installed names
  Plugins [1]:
  Using all installed plugins.

  Step 5 of 6 - MCP servers
    1. on
    2. off
  MCP [1]:
  MCP servers on.

  Step 6 of 6 - Where to record the model preset
    1. this project, committed     aidlc.settings.json - shared with your team  (default)
    2. this project, just for you  aidlc.settings.local.json - gitignored
    3. this machine                every project you set up here
  Preset in [1]:
  Recording the model preset in this project, committed.

  Your choices - Enter to apply, or a number to change:
    1. Harness      Claude Code
    2. Provider     amazon-bedrock, us-east-1, default credential chain
    3. Preset       balanced
    4. Plugins      all installed
    5. MCP          on
    6. Preset in    this project, committed
  Apply? [Y/n]:
```

各手順が書き込むもの:

| 手順 | 書き込むもの |
| --- | --- |
| 1. Harness | どのツールのファイルを設定するか（Claude Code なら `.claude/`）。 |
| 2. Model provider | `keep current` は何も書きません。`amazon-bedrock` は `CLAUDE_CODE_USE_BEDROCK` と `AWS_REGION`（プロファイルを指定した場合はそれも）を、共有の `.claude/settings.json` ではなく、自分用の `.claude/settings.local.json`（git が無視します）の `env` ブロックに追加します。プロジェクトに残る回答の記録には、プロファイルは保存されません。 |
| 3. Model effort preset | 手順 6 で選んだファイルにプリセット名を書きます。`unchanged` は何も記録しません。 |
| 4. Plugins | インストール済みのどのプラグインを有効にするか。 |
| 5. MCP servers | 配布サーバーを載せた `.mcp.json`、またはなし。 |
| 6. Where to record the preset | `aidlc.settings.json`（コミットする）、`aidlc.settings.local.json`（git 管理外）、またはすべてのプロジェクトに効くこのマシンの設定。 |

`Apply?` には、変更したい手順の番号を入れるとその回答を変えられ、`n` を入れると何も書かずに止まります。ステータスラインの質問の後、Bedrock では、あなたにしかできない手順が 1 つ残ります。

```text
  One thing needs you - it can't be done automatically:

    Verify Amazon Bedrock model access in the recorded region and confirm the AWS principal has
    bedrock:InvokeModel permission.
    fix: aidlc config providers --check
```

### 質問なしで設定する

スクリプト、CI、プロンプトのないターミナルではウィザードは出ません。すべてのハーネスのランタイムがインストールされているので、自分のハーネスを指定します。`--yes` は確認を済ませるもので、MCP サーバーをオンにはしません（オンにするには `--mcp defaults` を加えます）。

```text
$ aidlc config --harness claude --mcp defaults --yes
configured /home/you/ci-demo for Claude Code X.Y.Z; next: open Claude Code in this project (if it is already open in this folder, exit it and start it again) and run `/aidlc --doctor`
```

Kiro IDE では、`--yes` は、そこでセットアップが尋ねるすべてのプロジェクト向けの Kiro 設定に関する質問にも推奨の回答を選びます。Kiro IDE と Kiro CLI で Kiro の Workflows 機能をオフにし（オンの間は AI-DLC のレビューとヘルパーが動きません）、Windows で Kiro のターミナルがコマンドプロンプトのときは PowerShell に設定します。Workflows をオンに戻すには、
`aidlc config trust --harness kiro-ide --kiro-workflows on --yes`（Kiro IDE）または
`aidlc config trust --harness kiro-ide --kiro-cli-workflows on --yes`（Kiro CLI）を実行します。

`--harness` がないと、何も書き込む前に止まります。

```text
$ aidlc config < /dev/null
error: multiple harnesses are installed; pass --harness <claude|codex|copilot|cursor|kiro|kiro-ide|opencode>
fix: aidlc config --harness <name>
```

書き込む前に config が何をするかを見るには、プレビューします。ターミナルではハーネスと MCP の選択を尋ね、それ以外ではハーネスを指定します。

```text
$ aidlc config --harness claude --dry-run
config plan for /home/you/ci-demo: create=330 update=0 merge=0 preserve=1 remove=0 conflict=0
```

質問なしのセットアップはモデルプリセットを記録しないので、AI-DLC のエージェントは配布時の既定値を使います。どの質問にも対応するフラグがあります。[Config のオプション](18-install-and-lifecycle.md#config-options)と `aidlc config <section> --help` を参照してください。

### ハーネスをインストールする前に設定する

対応するツールが PATH に 1 つもないとき、ウィザードはまず、既定値なしで、どれを設定するかを尋ねます。

```text
  No supported harness CLI was detected. Choose one to configure:

    1. Claude Code
    2. Codex CLI
    3. GitHub Copilot
    4. Cursor
    5. Kiro CLI (V2)
    6. Kiro            Kiro IDE and Kiro CLI on its v3 engine
    7. opencode
  Harness [1-7]:

  That's not one of the choices - enter 1, 2, ... or 7.
  Harness [1-7]: 1
  Using Claude Code.
```

残りは同じで、`detected` の代わりに `Claude Code selected` と表示されます。

## 3. config がプロジェクトに残したもの

```text
$ git status --short
?? .claude/
?? .gitignore
?? .mcp.json
?? aidlc.settings.json
?? aidlc/
```

| パス | 内容 | コミットするか |
| --- | --- | --- |
| `.claude/` | Claude Code 用の AI-DLC ファイル。`/aidlc` スキル、エージェント、ステージ、フック、ツール、`settings.json`（フック、権限、ウェルカムメッセージ） | する |
| `aidlc/` | AI-DLC の記録。`aidlc/spaces/default/memory/` にルール（フレームワークの既定値と、チームやプロジェクト独自のもの）があり、作業ごとの記録もここに作られます | する |
| `.gitignore` | AI-DLC 専用の印付きブロック。既存のファイルがあればそこに追加されます | する |
| `.mcp.json` | MCP サーバー（選んだ場合） | する |
| `aidlc.settings.json` | モデルプリセット | する |
| `aidlc.settings.local.json`、`.claude/settings.local.json` | あなた自身の選択（ここではステータスライン） | しない。git 管理外 |

チームが同じセットアップを得られるよう、最初の 5 つをコミットします。
`git add .claude aidlc .gitignore .mcp.json aidlc.settings.json && git commit -m "Set up AI-DLC"`。
インストール済みのリリースからファイルを更新するには、いつでも `aidlc config` をもう一度実行します。あなたが編集したものは保たれます（[プロジェクトの設定と更新](18-install-and-lifecycle.md#configure-or-refresh-a-project)）。

## 4. 確認する

ここでは対処方法の行を 1 つ短くしています。

```text
$ aidlc doctor
AI-DLC doctor

Machine
  warn  Runtime hook PATH: aidlc is on this shell's PATH (/home/you/.local/bin/aidlc) but not on the system-wide PATH
        fix: Nothing needs changing when you start Claude Code from a terminal: it hands that terminal's PATH to AI-DLC's hooks. If you start it from a desktop icon, the dock, or a service and AI-DLC's hooks do not run, add /home/you/.local/bin to the PATH line in /etc/environment, ENV_PATH in /etc/login.defs, or a PATH= line in ~/.config/environment.d/*.conf, then restart Claude Code. Editing .bashrc or .zshrc does not change this check.
  ok    9 checks passed

Project (.claude, Claude Code)
  warn  AIDLC hooks have not run in this project yet
        fix: This is expected before your first Claude Code chat in this folder. ...
  warn  Workspace records: 8 uncommitted change(s) under aidlc/ (advisory - the shared records travel by git; commit & push so teammates get them: `git add aidlc/ && git commit && git push`)
        fix: add --verbose to see the details, correct the named condition, then run doctor again
  ok    49 checks passed

Framework integrity
  ok    all 12 checks passed

0 problems, 3 warnings.
Warnings are advisory - if everything works, ignore them.
Add --verbose to see every check.
```

新しいプロジェクトでは、この 3 つの警告は想定どおりです。1 つ目が関係するのはデスクトップのアイコンから Claude Code を起動する場合だけで、2 つ目は最初のチャットの後に、3 つ目はコミットの後に消えます。`fail` の行は本当の問題で、対処方法が付いてきます。Claude Code の中では、`/aidlc --doctor` が同じ確認を実行します。

## 5. Claude Code での最初の実行

プロジェクトで Claude Code を起動します。

```text
$ claude
```

新しいフォルダで初めて起動すると、Claude Code はそのフォルダを信頼するかを尋ね、AI-DLC の設定が確認なしで実行を許すコマンドを一覧します。

```text
 Accessing workspace:

 /home/you/inventory-api

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a
 well-known open source project, or work from your team). If not, take a moment to review what's in
 this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 ! This folder pre-approves 45 tool permissions in .claude/settings.json:
   WebSearch, Edit(/**), Bash(aidlc engine *), Bash(aidlc doctor), Bash(aidlc doctor --verbose),
 Bash(aidlc version), Bash(aidlc --doctor), Bash(aidlc --doctor --verbose), and 37 more
 These will apply without asking. Only proceed if you trust this configuration.

 > No, exit
   Yes, I trust this folder
```

自分のプロジェクトなら **Yes, I trust this folder** を選びます。MCP サーバーがオンなら、Claude Code は続いて `.mcp.json` の 5 つのサーバーのどれを有効にするかを尋ねます。認証情報を持っているものを有効にするか、Esc を押してすべて飛ばしてください。どちらでも AI-DLC は動きます。

起動時、Claude Code は AI-DLC のウェルカムメッセージを表示します。AI-DLC の見出しの下に "Run `/aidlc` to start or resume a workflow. Describe what to build and AI-DLC proposes a plan for you to confirm." と表示し、続いてフェーズ、ステージ、スコープ（既製の計画）と、それぞれが実行するステージを一覧します。最初の起動では、Claude Code が代わりに自身のお知らせを表示して `1 more notice hidden` と示すことがあります。ウェルカムメッセージはその後の起動で表示されます。

では、作りたいものを説明します。

```text
> /aidlc Build a REST API for inventory management
```

エージェントはあなたの言葉を読み、計画、つまりこの種の作業向けの既製のステージ一式を提案します。ここでは `mvp` を選びました。あなたの言葉では別の計画になるかもしれません。

```text
 Plan
 I'd run the "mvp" plan for: "Build a REST API for inventory management" - 19 stages, 19 approval
 gates, 5 stages repeat per unit of work in Construction. Do you want me to go ahead with it, use
 a different plan, or tailor one to this task?
 > 1. Go ahead with the "mvp" plan
      19 stages: skips operations and ships the core API.
   2. Use a different plan
      Pick another ready-made plan (e.g. classic, feature, express, poc).
   3. Tailor a plan to this task
      Have a plan composed specifically for this work.
   4. Type something.
   5. Chat about this
```

Go ahead を選ぶと作業が始まります。**Use a different plan** はほかの計画をその長さとともに一覧するので、1 つ選ぶか名前を入力します。

```text
 Plan
 Which plan would you like for the inventory REST API?
 > 1. classic (14 stages)
      V1-style ceremony through Inception and Construction - the implicit default.
   2. feature (29 stages)
      Full lifecycle for new features, practical depth.
   3. express (6 stages)
      Lightest run: requirements to deploy, no design pass, no reviewers.
   4. poc (4 stages)
      Prove feasibility fast.
   5. Type something.
   6. Chat about this
```

この実行ではそこで "mvp after all" と入力し、`mvp` で進めました。
各計画は[ワークフロープロファイル](workflow-profiles.md)で説明しています。**Tailor** を選ぶと、エージェントがあなたの言葉から独自の計画を提案します。

どの質問にも **Type something**（自分の回答）と **Chat about this** があります。以下の画面では、ステージの最初の質問を除き、この 2 つを省いています。

続いて AI-DLC はこの作業の記録を作り、最初のステージである Intent Capture を始めます。最初の質問は、ステージの質問にどう答えたいかです。

```text
 Answer mode
 I've created 8 questions at
 aidlc/spaces/default/intents/261013-inventory-rest-api/ideation/intent-capture/intent-capture-questions.md.
 How would you like to answer them?
 > 1. Guide me
      Walk through each question interactively here
   2. I'll edit the file
      Fill in the answers in the file directly
   3. Chat
      Discuss freely; I'll extract the decisions from the conversation
```

選ぶのは一度だけです。後のステージは同じ回答を使い、そのことを 1 行で伝えます（"Answering the way you chose earlier: Guide me. Say if you'd rather edit the file or chat."）。**Guide me** では、質問が数問ずつ出ます。各質問には選択肢が付き、その文の前には、ふだん誰が答えるかが示されます（この画面は AI-DLC がそのラベルを表示する前に取得したもので、ラベルが入る位置を示すために `[Product owner]` を加えています）。一番上の行に質問が並び、最後の質問の後、**Submit** で回答を確認でき、**Submit answers** で送信します。

```text
 < [ ] Q1 Problem  [ ] Q2 Users  [ ] Q3 Success  [ ] Q4 Trigger  Submit >
 Q1. [Product owner] What business problem should the inventory API solve first? (If it's not
 defined yet, pick "Type something" and say so.)
 > 1. Stock counts drift
      A. We don't know accurately what stock we have (counts drift, spreadsheets go stale)
   2. Stock-outs / overstock
      B. Levels aren't visible in time to reorder
   3. Shared source of truth
      C. Other systems (shop, ordering, warehouse tools) need one reliable source of stock data
   4. Multi-location tracking
      D. Tracking stock across several locations is manual and error-prone
   5. Type something.
   6. Chat about this
```

矢印キーと Enter で選択肢を選ぶか、**Type something** を選んで自分の言葉で答えます。"Select all that apply" とある質問では複数選べます。すべての質問に答えると、エージェントは何かを書く前に回答を読み上げ、一度確認を求めます。

```text
 Confirm
 - Problem: other systems need one shared, reliable source of stock data (Q1)
 - Callers: internal staff tools and an online store / ordering system (Q2)
 - Success: at least one real consumer system integrated and using the API in daily work (Q3)
 - Trigger: a new business or product line that needs inventory tracking from day one (Q4)
 - Stakeholders: just you; you decide scope and priority; no progress reporting needed (Q5-Q7)
 - Out of the first version: supplier purchasing / automatic reorder, and any user interface (API
 only) (Q8)

 Does this all look correct before I generate the artifact?
 > 1. Looks correct
      Generate the artifact from these answers
   2. Request changes
      Revise one or more answers before generation
```

それからステージの文書を書きます。回答で決まらなかった前提に基づく部分があるときは、それを前提のまま残すか、質問に変えるかを尋ねます。レビュアーエージェントが主要な文書を読みます。途中でエージェントを修正していれば、ここでその修正を次回のために残すかどうかを尋ねます。何も修正していないので、次は承認です。

そして最初の承認です（省略あり: 出典チェックの行、レビューファイルのパス、3 つの所見のうち 2 つを省いています）。

```text
Intent Capture & Framing is ready for your review. It produced intent-statement.md,
stakeholder-map.md and intent-capture-questions.md (8 questions, all answered), in
aidlc/spaces/default/intents/261013-inventory-rest-api/ideation/intent-capture/.

Stage: Intent Capture & Framing
Review outcome: Concerns remain for your decision.

| ID   | Severity | Where                                      | Status |
|------|----------|--------------------------------------------|--------|
| R-01 | Minor    | intent-statement.md > Initial Scope Signal | New    |
| R-02 | Minor    | intent-statement.md > Initiative Trigger   | New    |
| R-03 | Minor    | intent-statement.md > Success Metrics      | New    |

> R-03 Finding: The table carries a single, binary success metric ("at least one real consumer
  system integrated and uses the API in daily work") with no accuracy, timeliness, or
  adoption-breadth dimension, ...
> R-03 Required action: Human should confirm at the gate that a single integration-adoption
  metric is sufficient, or ask a follow-up to add a data-accuracy or reliability metric before
  inception begins.

Approve accepts the open review findings R-01 (...), R-02 (...) and R-03 (The table carries a
single, binary success metric ("at least one real...) as risk; you can also approve and ask for
one to be fixed, or reject one as not applying, saying why.

Decision options:
- Approve - continue.
- Request Changes - return to the listed artifacts so the required actions can be addressed.

Review: aidlc/spaces/default/intents/261013-inventory-rest-api/ideation/intent-capture/

The two wording points (R-01, R-02) are things I added that you didn't confirm, and they're easy
to remove. R-03 is your call: one success measure is enough, or you may want to add one for stock
accuracy. After you approve, the next step is Feasibility & Constraints.

 Approval
 Intent Capture & Framing complete. How would you like to proceed?
 > 1. Approve
      Continue to Feasibility & Constraints
   2. Request Changes
      Provide revision feedback
```

文書は示されたフォルダにあります。判断する前に開いてください。**Approve** は先へ進み、未解決の所見を受け入れます。**Request Changes** はそれらに対処するためにステージを差し戻します（何を変えるか、または追加の質問をしてほしいかを伝えます）。この実行では承認しました。

```text
Progress: 1 of 19 stages done. Next: Feasibility & Constraints.
Now working on Feasibility & Constraints, wearing the architect hat.
```

この作業の記録には、いま次のものが入っています（主なファイルに絞っています）。

```text
aidlc/spaces/default/intents/261013-inventory-rest-api/
  aidlc-state.md                 where the work stands
  audit/                         every question, answer and approval, as it happened
  project-description.json       your request, word for word
  ideation/intent-capture/       intent-statement.md, stakeholder-map.md,
                                 intent-capture-questions.md, reviews/review-01.md
  ideation/feasibility/          the next stage, under way
```

ここからは、各ステージが同じリズムで進みます。質問、文書、レビュー、あなたの承認です。そのリズムの各部分は[最初のワークフロー](02-your-first-workflow.md)で説明し、実行全体は[実践例](16-worked-examples.md)で追っています。

## ほかのツールの場合

手順はどこでも同じです。異なるのは次の点です。

| ハーネス | 設定値 | 起動 | 呼び出し |
| --- | --- | --- | --- |
| Claude Code | `claude` | `claude` | `/aidlc` |
| Kiro（Kiro IDE、v3 の Kiro CLI） | `kiro-ide` | プロジェクトを開き、チャットパネルのエージェント選択で **aidlc** を選ぶか、プロジェクトで `kiro-cli` を実行する | `/aidlc` |
| Kiro CLI (V2) | `kiro` | `kiro-cli chat` | `/aidlc` |
| Codex CLI | `codex` | `codex` | `$aidlc` |
| Cursor | `cursor` | Cursor を開く、または `agent` を実行する | `/aidlc` |
| opencode | `opencode` | `opencode` | `/aidlc` |
| GitHub Copilot CLI / VS Code | `copilot` | Copilot CLI または VS Code | `/aidlc` |

config の後は、config がツールごとに示す 1 つの手順を済ませます。

| ハーネス | 主な操作 |
| --- | --- |
| Claude Code | このフォルダで Claude Code をすでに開いている場合は、終了して起動し直す |
| Kiro（Kiro IDE、v3 の Kiro CLI） | 設定済みプロジェクトを開き、チャットパネルのエージェント選択で **aidlc** を選ぶか、プロジェクトで `kiro-cli` を起動する |
| Kiro CLI (V2) | `kiro-cli chat` を起動。プロジェクトが AI-DLC エージェントを選択する |
| Codex CLI | フックの信頼確認を承認するか、生成された trust seed を適用 |
| Cursor | 設定済みプロジェクトを開く、または `agent` を起動 |
| opencode | プロジェクト内で `opencode` を起動 |
| GitHub Copilot | プロジェクトフォルダを信頼する |

ウェルカムメッセージは Claude Code だけのものです。AI-DLC は Claude Code では独自のステータスラインを描画します。Codex では、セットアップが Codex 組み込みのステータスラインを提案し、AI-DLC がタスクの進捗を最新に保ちます。Kiro CLI 2.24.1 以降の v3 エンジンには、それを固定する `kiro-ide` を使います。`kiro` は Kiro CLI (V2) です（既存の `kiro` プロジェクトの切り替え方は [Kiro CLI](harnesses/kiro-cli.md) を参照）。

Kiro IDE では、フォルダを信頼してウィンドウを再読み込みするまで、エージェント選択に **aidlc** エージェントは表示されません。Restricted Mode のバナーが出ている場合は、バナーの **Manage**、続いて **Trust** を選び、**Developer: Reload Window** を実行します（[初回の実行](harnesses/kiro-ide.md#初回の実行)を参照）。まだ信頼していないフォルダで Kiro IDE 自身のターミナルを使うと、Kiro はまずそのフォルダを信頼するかを尋ねます。信頼するとそのフォルダの `.kiro` フックがあなたのマシンでコマンドを実行できるようになるため、**Trust Folder & Continue** を選ぶのは自分のプロジェクトか確認済みのプロジェクトだけにしてください。

残りは[他ハーネスで動かす](harnesses/README.md)の下にある各ツールの章で扱います。

<a id="aws-bedrock-setup"></a>

## AWS Bedrock セットアップ

Claude Code、Codex、opencodeの配布物は、利用者が設定したプロバイダーを維持します。Amazon Bedrockは明示的に選択するオプションです。

### プロバイダーを固定しない既定設定

AI-DLCのプロジェクト設定は、プロバイダー、認証、モデル、コンテキストを変更しません。balancedのレビュアーは推論強度を指定する場合がありますが、プロバイダー固有のモデルを固定しません。

### Bedrockを使う場合

上のカスタマイズしたセットアップの手順 2 で `amazon-bedrock` を選ぶか、後から `aidlc config providers` で選びます。そのうえで次を行います。

1. Amazon Bedrockのモデルカタログで、設定するAnthropicモデルを利用可能にします。
2. `aws configure` や `aws sso login --profile <profile>` でAWS SDKの標準認証情報を用意します。
3. 対象モデルを利用できるリージョンを選びます。
4. `aidlc config providers --check` を実行して、まだ残っている作業を確認します。

認証情報と個人用の上書きは、共有する `.claude/settings.json` には含めません。`.claude/settings.local.json` またはAWSの標準認証情報ファイルに置きます。

現在の設定を維持するには `aidlc config providers` で `keep current` を選ぶか、`--provider current` を指定します。別のプロバイダーを明示的に記録する場合は `aidlc config providers --provider other --yes` を実行します。AI-DLCが管理していた古いBedrockの上書き設定を共有ファイルから除去し、手動設定を保留として記録します。対象プロバイダーで認証した後、`aidlc config providers --acknowledge --yes` で完了を記録します。[Claude Codeの認証ガイド](https://code.claude.com/docs/en/authentication)も参照してください。

IAM、モデルアクセス、SSO、リージョン別の問題は、[Claude Code on Amazon Bedrock](https://community.aws/content/2tXkZKrZzlrlu0KfH8gST5Dkppq/claude-code-on-amazon-bedrock-quick-setup-guide)と[Amazon Bedrock ドキュメント](https://docs.aws.amazon.com/bedrock/)を参照してください。

<a id="mcp-servers-optional"></a>

## MCP サーバーの任意設定

推奨の既定値では、Claude Code プロジェクトで配布済みの MCP サーバーがオンになります。質問なしのセットアップでは `--mcp defaults` で追加します。

```bash
aidlc config --harness claude --mcp defaults
```

追加しない場合は `--mcp none` を使います。コピー経路でのインストールは MCP 設定なしで始まるので、追加するには `bun .claude/tools/aidlc.ts config project --harness claude --mcp defaults --yes` を実行します。既定の構成は以下です。

| サーバー | 用途 | 認証情報 |
| --- | --- | --- |
| `context7` | ライブラリ・SDK の文書 | `CONTEXT7_API_KEY` |
| `aws-mcp` | AWS API へのアクセス | AWS 認証情報チェーン |
| `aws-pricing` | AWS 料金の照会 | AWS 認証情報チェーン |
| `aws-iac` | Infrastructure as Code のツール | AWS 認証情報チェーン |
| `aws-serverless` | サーバーレス開発用ツール | AWS 認証情報チェーン |

4つの AWS サーバーには `uvx` が必要です。いずれも標準の AWS 認証情報チェーンを使います。

Claude セッションの各エージェントは利用可能な MCP サーバーを引き継ぎます。認証情報がなければ対象サーバーは利用できませんが、それだけでワークフローが停止することはありません。コミットする `.mcp.json` に秘密情報を置かないでください。

## 更新

`aidlc update` はマシン側のランタイムを更新します。設定済みプロジェクトは書き換えません。各プロジェクトを更新してください。開いている作業はそのまま続けられます。

```bash
aidlc update
cd /path/to/your-project
aidlc doctor
aidlc config
```

`config` はプロジェクト所有の内容を保持します。ワークフローが開いている間の更新も実行され、その作業がそのまま続けられるかどうかを表示します。プラグインを使うプロジェクトは、エンジンの更新後に `/aidlc plugin sync` を実行してください。

版の選択、プロジェクトの pin、オフライン導入、ミラー、カスタム CA、リリース認証、自動化、アンインストールは[インストールとライフサイクル](18-install-and-lifecycle.md)を参照してください。

## トラブルシューティング

まず診断を実行します。

```bash
aidlc doctor
```

フック、プロバイダー接続、承認ゲート、古い状態、診断は[トラブルシューティング](15-troubleshooting.md)を、ツール固有の問題は対応する[ツール別ガイド](harnesses/README.md)を確認してください。

## 次のステップ

- [オンボーディング: 最初の 1 週間のガイド](onboarding.md): 全体の考え方と、初めてのチーム向けのガイド付き 5 回の実行の道筋
- [ワークフロープロファイル](workflow-profiles.md): 作業に合う工程を選ぶ
- [最初のワークフロー](02-your-first-workflow.md): 実行の各部分の意味
- [スペースとインテント](03-spaces-and-intents.md): プロジェクトの状態を理解する
- [対話モード](07-interaction-modes.md): 質問とゲートを使う
- [インストールとライフサイクル](18-install-and-lifecycle.md): ネイティブランタイムを管理する
