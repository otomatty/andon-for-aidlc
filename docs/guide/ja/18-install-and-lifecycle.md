# インストールとライフサイクル

ネイティブのリリースチャネルは、`aidlc` コマンドと 1 つ以上のハーネスランタイムをインストールします。その後 `aidlc config` が、そのローカルのランタイムからプロジェクトを作成または更新します。インストールしたコマンドと config の経路に Bun や Node.js は不要です。GitHub CLI（`gh`）は任意です。対応する版があれば署名付きの attestation の検証が加わり、ない、または古い版でもインストールは止まりません。

この章では、このリリースで使えるネイティブのインストールのライフサイクルを説明します。計画中の `aidlc setup` の体験、npm パッケージ、パッケージマネージャーの formula はまだ使えません。手動コピーの利用者は Bun をインストールし、`aidlc-copy-runtime-X.Y.Z.tar.gz` から、版付きの Bun を呼び出すランタイムを取得します。ネイティブの `aidlc` コマンドは不要です。

<a id="install"></a>

## インストール

リリースの成果物の対象は次です。

- macOS x64 と arm64
- Linux x64 と arm64。glibc と musl のビルドあり
- Windows x64

ネイティブのインストールは利用者単位です。Unix のインストーラーは root を拒否し、`sudo` は不要です。`USER` のないコンテナイメージ、CI のコンテナジョブ、セットアップスクリプトが root で動くクラウドのエージェントのサンドボックスのように、root が唯一の利用者である環境では、`--allow-root` を渡して（または `AIDLC_ALLOW_ROOT=1` を設定して）root 自身の `$HOME` の下にインストールします。このオプトインでも、`sudo` のもと（`SUDO_USER` が設定されている）、`$HOME` が未設定か root の所有でない場合（シンボリックリンクのホームは辿ります）、`AIDLC_BIN_DIR` や `AIDLC_INSTALL_ROOT` が root のホームの外を指す場合は拒否されます。そのため、通常のアカウントからの `sudo sh install.sh` は引き続き失敗し、root のインストールがシステム全体に及ぶことはありません。`--allow-root` より前のリリースは root として自身をアンインストールできません。それをインストールすること、または `aidlc use`、`update`、`rollback` で root としてアクティブにすることは、後で削除する方法を示す警告とともに進みます。その方法は、そのリリース自身の `aidlc update` の後に `aidlc uninstall --allow-root` を実行することです。`aidlc uninstall` も同じ `--allow-root` のオプトインを同じ制限で受け付けます。Windows のインストールは、PowerShell を実行しているアカウントが対象です。通常の PowerShell ウィンドウから実行してください。UAC のもとで「管理者として実行」で開いたウィンドウでは、同じアカウントで動く別のプログラムが、昇格したインストーラーが実行するファイルに干渉できるため管理者としてのインストールは安全性が低いと警告され、確認を求められます。`-Yes` はプロンプトなしで確認します。`-Yes` なしの非対話の実行（`-Json` と `-Quiet` を含む）は、その案内とともに止まります。`aidlc uninstall` も同じ警告を出しますが、何も尋ねません。端末では何かを削除する前に警告を表示し、`--yes` では警告が結果に含まれます。Windows Server の組み込みの Administrator のように、UAC の昇格なしにすでに完全な管理者トークンを持つセッションでは、警告は出ません。別のアカウントの資格情報で PowerShell を実行すると、そのアカウントにインストールされます。全利用者向けのモードはありません。

Alpine Linux の musl の成果物は、Bun 自身のランタイムの契約に従います。Bun の musl ビルドは、Node.js と同じく、システムの `libgcc` と `libstdc++` パッケージを必要とします。完全に静的な Bun の musl のコンパイル対象は、現在使える対象ではなく、上流で追跡中の機能です。インストーラーやバイナリを実行する前に、前提をインストールしてください。

```sh
apk add libgcc libstdc++
```

この前提は、x64 と arm64 の両方の Alpine のシステムに適用されます。システムパッケージのインストールには管理者権限が必要なことがありますが、AI-DLC のインストール自体は対象の利用者として実行されます。インストーラーは対応するローダーの失敗を検出し、上のコマンドを表示します。`apk` を実行したり、システムパッケージをインストールしたりすることはありません。上流の Bun の追跡には `oven-sh/bun#15829` と `oven-sh/bun#29681` があります。

インストーラーには、すべてのハーネスランタイム（`claude`、`codex`、`copilot`、`cursor`、`kiro`、`kiro-ide`、`opencode`）がまとめて含まれます。

```bash
tmp="$(mktemp -d)"
curl -fsSL \
  https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh \
  -o "$tmp/install.sh"
sh "$tmp/install.sh"
rm -rf "$tmp"
```

<a id="macos-and-linux"></a>

### macOS と Linux

```bash
tmp="$(mktemp -d)"
curl -fsSL \
  https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh \
  -o "$tmp/install.sh"
sh "$tmp/install.sh"
rm -rf "$tmp"
export PATH="$HOME/.local/bin:$PATH"
```

オンラインの実行には `curl` か `wget` が必要で、どの実行にも `sha256sum` か `shasum` が必要です。GitHub CLI は任意で、リリースが必要とする attestation のフラグに対応している場合にだけ使われます。
版は `${XDG_DATA_HOME:-$HOME/.local/share}/aidlc/versions/` の下にインストールされ、既定では、アクティブな版を実行する小さなランチャーである `$HOME/.local/bin/aidlc` が書かれます。AI-DLC 自身のプラグインのカタログは版の横の `${XDG_DATA_HOME:-$HOME/.local/share}/aidlc/plugins/` に置かれ、インストーラーがその完全なパスを表示します（[プラグイン](#plugins) を参照）。

インストーラーは、`--profile <absolute-path-under-$HOME>` を明示しない限り、シェルの起動ファイルを編集しません。そのオプションは `BEGIN AI-DLC:PATH` ブロックを 1 つトランザクションで書くか更新し、ファイルの残りは保ちます。プロファイルは AI-DLC のインストールやコマンドのルートの中に置けません。既存のマーカーは一意で、行全体が正確に一致し、begin が end より前になければなりません。不正なマーカーの配置は、プロファイルを変えずに拒否します。

<a id="windows-powershell"></a>

### Windows PowerShell

```powershell
$download = Join-Path $env:TEMP "aidlc-install-$PID"
New-Item -ItemType Directory -Force $download | Out-Null
$installer = Join-Path $download install.ps1
Invoke-WebRequest `
  -Uri https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1 `
  -OutFile $installer
& $installer
Remove-Item -Recurse -Force $download
```

Windows は版を `%LOCALAPPDATA%\aidlc\versions\` の下にインストールし、安定した `%LOCALAPPDATA%\aidlc\bin\aidlc.cmd` のシムを保ち、AI-DLC 自身のプラグインのカタログを `%LOCALAPPDATA%\aidlc\plugins\` に置きます。検証とインストールに成功すると、インストーラーはその bin ディレクトリを現在のアカウントの永続的な User PATH に登録します。既存のエントリは保ち、再実行で重複させません。現在の PowerShell のプロセスも更新し、環境の変更を Windows に通知するため、その後に起動したプログラムは `aidlc` を見つけられます。すでに開いていた端末アプリや IDE（Kiro、VS Code、Cursor）は、起動時の PATH を保ちます。そこで `aidlc` や AI-DLC のフックを使う前に、完全に終了してから開き直してください。その中で新しいタブを開いたり Reload Window を実行したりするだけでは足りません。
Machine PATH を変えたり、PowerShell のプロファイルを編集したりはしません。

成功時の人向けの出力は、`Installed`、版、アカウント、インストールしたコマンドのパスで始まります。次に、プロジェクトのディレクトリから `aidlc config` を実行します。インストーラーが PATH のエントリを追加した場合は、すでに開いていた端末アプリや IDE を終了して開き直すようにも伝えます。

インストーラーは、User PATH のエントリを追加した場合にだけ、インストールのルートの下に `windows-path.json` を書きます。この所有の記録は `-NoModifyPath` を含む再実行をまたいで残るため、後でアンインストールがそのエントリを削除できます。すでにあったエントリは所有を主張しません。`aidlc uninstall` と `aidlc uninstall --purge` のどちらも、以前からあったエントリと後の無関係な PATH の変更は保ちながら、記録されたエントリを削除します。

永続的な PATH で別の `aidlc` コマンドが優先される場合、結果はそれを示し、インストールしたコマンドの完全なパスを示します。その PATH の競合を解消するか、インストールしたコマンドを直接呼び出してください。PATH の登録に失敗した場合、インストーラーは、ファイルはインストールされたが PATH の設定がまだ必要であることを、復旧の指示と終了コード 1 とともに報告します。

**永続的な PATH と現在のプロセスの PATH の両方の変更** を省くには、上の `& $installer` を `& $installer -NoModifyPath` に置き換えます。インストーラーは、PATH を登録せずに実行する直接のコマンドを表示します。既定の場所では次のとおりです。

```powershell
& "$env:LOCALAPPDATA\aidlc\bin\aidlc.cmd" config
```

インストールの場所を変えた場合は、表示されたコマンドのパスを使ってください。PATH の自動登録を有効にするには、`-NoModifyPath` なしでインストーラーを再実行します。このスイッチは、以前の登録を取り消したり、その所有の記録を消したりはしません。

PowerShell のインストーラーのパラメーターはネイティブの名前を使います。例: `-Version`、`-From`、`-Offline`、`-ReleaseBaseUrl`、`-CaBundle`、`-NoModifyPath`、`-Yes`、`-Quiet`、`-Json`、`-NoColor`。

版付きのリリースの URL からダウンロードしたインストーラーは、プレビューを含め、既定でそのリリースを選びます。`latest/download` のインストーラーは、引き続き最新の安定版を選びます。明示的な `--version` / `-Version` の選択は同梱の既定に優先し、`--from` / `-From` はローカルのリリースのマニフェストから版を読みます。

<a id="automation"></a>

### 自動化

インストールはハーネスについて尋ねません。人による実行でも非対話の実行でも、同じバイナリとすべてのハーネスランタイムをインストールします。

一時的または隔離された Windows のインストールでは、`-NoModifyPath` を渡し、報告された `aidlc.cmd` のパスを直接呼び出してください。一時的な bin ディレクトリを User PATH と現在のプロセスから外しておけます。

PowerShell の `-Json` は、`schemaVersion: 1`、`ok`、`code`、`status`、`message` を持つ結果を 1 つ出します。ファイルがインストールされた後は、`data` に次が含まれます。

| フィールド | 意味 |
|-------|---------|
| `installed` | `true`。その後の PATH の手順が失敗した場合も含む |
| `ready` | 推奨のコマンドがすぐ使えるかどうか。PATH の競合や失敗では `false` |
| `version`、`account`、`installRoot`、`command` | インストールした版、Windows のアカウント、インストールのルート、コマンドの完全なパス |
| `path.scope` | `"user"` |
| `path.status` | `"updated"`、`"unchanged"`、`"skipped"`、`"conflict"`、`"failed"` のいずれか |
| `path.changed` | この実行が永続的な User PATH を変えたかどうか |
| `path.owned` | この実行がインストーラーの所有を確認したかどうか。`-NoModifyPath` で以前の記録が評価されないままの場合は `null` |
| `nextSteps` | プロジェクトの設定や PATH の復旧を含む指示の配列 |

登録の成功や、一致する既存の PATH では、通常 `status: "ok"` と終了コード 0 を使います。Windows がほかのアプリケーションに通知できない場合、結果は `status: "warning"` と `data.ready: true` を使い、条件付きでサインアウトの指示を含みます。永続的なコマンドの競合は、`status: "warning"`、終了コード 0、`data.ready: false` を使います。自動化では終了コードだけでなく、準備ができているかも確認してください。`-NoModifyPath` は `status: "ok"`、`path.status: "skipped"`、`data.ready: true` を使い、`nextSteps` に直接のコマンドを含みます。インストール後の PATH の失敗は、`status: "failed"`、終了コード 1、`data.installed: true`、`data.ready: false` を使います。

<a id="installer-options"></a>

### インストーラーのオプション

| Unix | PowerShell | 意味 |
|------|------------|---------|
| `--version <version>` | `-Version <version>` | 最新ではなく、正確なリリースを 1 つインストールする。安定版の `x.y.z` か、プレビューの `x.y.z-preview.YYYYMMDD.N` の id |
| `--from <dir>` | `-From <dir>` | 階層のないリリースの集合をローカルから読み、オフラインモードを含意する |
| `--offline` | `-Offline` | ネットワークへのアクセスを禁じる。`--from` / `-From` が必要 |
| `--release-base-url <url>` | `-ReleaseBaseUrl <url>` | 互換性のあるリリースのミラーを使う |
| `--ca-bundle <absolute-path>` | `-CaBundle <absolute-path>` | 独自の CA バンドルを使う |
| `--profile <absolute-path>` | なし | Unix の PATH ブロックをトランザクションで追加する |
| なし | `-NoModifyPath` | 永続的な User PATH と現在のプロセスの PATH の変更を省き、直接のコマンドを表示する |
| `--allow-root`（または `AIDLC_ALLOW_ROOT=1`） | なし | root が唯一の利用者である環境（コンテナ、CI のジョブ、エージェントのサンドボックス）で root としてインストールする。`sudo` のもと、`$HOME` が未設定か root の所有でない場合、`AIDLC_BIN_DIR` や `AIDLC_INSTALL_ROOT` が root のホームの外にある場合は引き続き拒否する。`--allow-root` より前のリリースは root として自身をアンインストールできないため、警告とともにインストールされる |
| `--yes` | `-Yes` | 自動化モード。完全性の検査は迂回しない。Windows では、AI-DLC が書いたのではない bin ディレクトリの `aidlc` も置き換え、そのファイルをバックアップとして残す |
| `--quiet` | `-Quiet` | 進捗を抑え、結果を 1 行出す |
| `--json` | `-Json` | 進捗を抑え、スキーマの版付きの JSON の結果を 1 つ出す |
| `--no-color` | `-NoColor` | 色の出力を止める |
| `--help` | 公開していない | Unix のインストーラーの使い方を出す |

`AIDLC_RELEASE_BASE_URL` と `AIDLC_CA_BUNDLE` はインストーラーの既定値を与え、明示的なオプションが優先します。`AIDLC_RELEASE_REPOSITORY` は、既定のダウンロードに使う GitHub のリポジトリと、来歴の検証が信頼するリポジトリの両方を選びます。既定は `awslabs/aidlc-workflows` です。
`AIDLC_RELEASE_WORKFLOW` は、信頼する署名者のワークフローを上書きします。既定では、インストーラーは安定版には `<AIDLC_RELEASE_REPOSITORY>/.github/workflows/release.yml` を、プレビュー版には `<AIDLC_RELEASE_REPOSITORY>/.github/workflows/preview-release.yml` を選びます。ワークフローのパスが異なるフォークやミラーでは、そのリリースのベース URL と一緒に上書きを明示してください。ダウンロードの URL だけを変えても、来歴の信頼の根は変わりません。`AIDLC_GH_BIN` は、両方のインストーラーが使う GitHub CLI の実行ファイルを明示的に選びます。その実行ファイルがない、または `--signer-workflow`、`--source-ref`、`--source-digest` に対応していない場合、来歴の検証は飛ばされ、チェックサムの検証は必須のままです。

フォークのリリースに GitHub App や追加のリポジトリは不要です。タグのワークフローは、短命の `GITHUB_TOKEN` で同じリポジトリに公開します。最後のジョブは `release` 環境を使い、公開の前にレビュアーの承認を求められます。

`AIDLC_INSTALL_ROOT` と `AIDLC_BIN_DIR` は、マシンとコマンドの場所を上書きします。Unix ではそれらのパスは絶対パスでなければなりません。Windows では、`-NoModifyPath` が設定されていない限り、選んだ bin ディレクトリが現在のアカウントの User PATH に登録されます。PowerShell のインストーラーは `AIDLC_OFFLINE=1` にも従います。Unix のインストーラーは、明示的な `--offline` か `--from` の指定が必要です。

<a id="release-authentication"></a>

### リリースの認証

インストーラーは次を行います。

1. `version.json`、`checksums.txt`、`aidlc-release.intoto.jsonl` をダウンロードするか読む。
2. 対応する GitHub CLI がある場合、GitHub CLI の既定のホストが GitHub Enterprise のホストであっても、`github.com` 上のリポジトリと署名者のワークフローに対して `checksums.txt` の attestation を検証する。
3. `version.json` の SHA-256 を検証し、その版の id とソースの識別情報を読み、リリースのバイナリをダウンロードまたは実行する前に、明示した版の不一致を拒否する。
4. `sourceRef` が、安定版では `refs/tags/v<version>`、プレビューでは `refs/heads/main` と等しいことを要求し、来歴の検証が使える場合は、その ref と認証された `sourceDigest` に対して attestation を再検証する。
5. 選んだバイナリとハーネスのアーカイブを、SHA-256 と宣言されたバイト長で検証する。
6. 検証済みのバイナリに、リリースの検証とトランザクションによるインストールを任せる。

ブートストラップのスクリプト自体を実行前に認証するには、現在の GitHub CLI を使います。`github.com/` のリポジトリの接頭辞と `--hostname github.com` により、`gh` の既定が GitHub Enterprise のホストでも、これらのコマンドは github.com に向かいます。

```bash
tmp="$(mktemp -d)"
tag="$(gh release view --repo github.com/awslabs/aidlc-workflows --json tagName --jq .tagName)"
gh release download "$tag" --repo github.com/awslabs/aidlc-workflows --dir "$tmp" \
  --pattern install.sh --pattern aidlc-release.intoto.jsonl
gh attestation verify "$tmp/install.sh" \
  --bundle "$tmp/aidlc-release.intoto.jsonl" \
  --repo awslabs/aidlc-workflows \
  --signer-workflow awslabs/aidlc-workflows/.github/workflows/release.yml \
  --hostname github.com \
  --source-ref "refs/tags/$tag"
sh "$tmp/install.sh" --version "${tag#v}"
rm -rf "$tmp"
```

メタデータは 1 MiB まで、個々のリリースの成果物は 1 GiB までです。成果物の名前にパスは含められません。アーカイブの展開は、リンク、特殊ファイル、パストラバーサル、絶対パス、重複したエントリ、過大な展開を拒否します。

リリースのワークフローは候補を 1 回だけ組み立てます。ステージングと Unix/Windows のライフサイクルのジョブは `checksums.txt` を検証し、署名の権限なしでそのバイト列をテストします。本物の attestation はそれらのテストの後に作られるため、ジョブ内だけの検証用のフィクスチャを追加します。フィクスチャがアップロードされることはありません。
`publish` は候補を再検証し、attestation を作り、`aidlc-release.intoto.jsonl` を書き出し、成果物の一覧全体を検証し、ワークフローの成果物を 1 つアップロードします。`release` はタグとチェックサムを再確認し、`GITHUB_TOKEN` でこのリポジトリに GitHub Release を作り、ローカルとリモートの成果物の一覧を比べます。バンドルは `version.json` と `checksums.txt` の外に置かれます。それらのファイルはインストールできる成果物を対象にし、バンドルは独自の Sigstore の信頼の経路です。
オンラインの転送は TLS を強制し、すべてのインストールは SHA-256 を強制します。対応する GitHub CLI の版は、署名付きの来歴の検証を加えます。OS のコード署名と公証はリリースに含まれません。[Supply-Chain Security](../reference/19-supply-chain-security.md) を参照してください。

インストーラーは、所有が混在した既存のコマンドを拒否します。既存の Homebrew や Nix のコマンドも、置き換えずにそちらに譲ります。このプロジェクトはそれらのパッケージマネージャーのチャネルをまだ出荷していません。所有しているマネージャーを使うか、空の `AIDLC_BIN_DIR` を明示的に選んでください。

<a id="configure-or-refresh-a-project"></a>

## プロジェクトの設定と更新

ハーネスを開く前に config を実行します。[はじめに](01-getting-started.md#2-プロジェクトを設定する) は、最初のセットアップの各画面を示しています。

```bash
cd your-project
aidlc config --harness claude --dry-run
aidlc config
aidlc doctor
```

`aidlc config` はトランザクションとして処理し、このマシンにすでにあるリリースから動きます。プロジェクトが必要とするリリースをダウンロードするのは、プロンプトで同意したか `--download` を渡した場合だけです。選んだハーネスのツリー、`aidlc/` ワークスペースのシェル、ルートの統合、投影のスタンプ、所有の基準を作ります。ワークフローのインテントは作りません。

すべてのハーネスランタイムがインストールされているため、端末の外では、最初のセットアップやプレビューは `--harness <name>` でハーネスを指定します。端末では、config は検出した 1 つのハーネスを使うか、どれにするかを尋ねます。プロジェクトに複数のハーネスがある場合、そのうち 1 つを設定、プレビュー、更新するコマンドは `--harness <name>` でそれを指定します。唯一の例外は、ほかに何も変えずに `aidlc config flags --bypass` や `--clear-bypass` でバイパスを記録またはクリアする場合です。バイパスは 1 つのハーネスではなくプロジェクトに属します。どのハーネスが共存でき、それぞれの同梱の `.gitignore` のエントリがどう結合されるかは、[ルート統合と所有](#root-integrations-and-ownership) を参照してください。

あるリリースから 1 つのハーネスを書いた実行は、別のリリースにあるほかのインストール済みのハーネスをすべて示し、開いている作業の有無にかかわらず、それを書いたばかりのリリースに揃える 1 つのコマンドを添えます。

```
  Kiro CLI (.kiro) is still on 2.9.0. To bring it to 2.10.0: `aidlc config --harness kiro`.
```

`--from` に渡したファイルがそのハーネスを含んでいれば、コマンドはそれを再利用します。そうでなければ、コピーしたプロジェクトの行は、先にそのリリースのコピーのランタイムのファイルを取得するよう伝えます。すでにインストールされたコピーのハーネスに対する `--download` は、すでに持っているリリースを取得するためです。ネイティブのプロジェクトの行は、そのリリースをインストールする `aidlc config --pin` を示します。

足場の作成や更新に成功した後、config は軽いインストール結果の確認を実行します。確認するのは、非対話のフックの PATH、ホストの信頼ファイル、記録されたプロバイダーの対応だけです。ハーネスの CLI を起動したり、プロバイダーに接続したりはしません。トランザクションは引き続き exit 0 で終わります。TTY でない人向けの出力は、残っているすべての項目と、正確な `aidlc config runtime`、`aidlc config trust`、`aidlc config providers --check` の続きを示します。2 つの項目には、それを行う AI-DLC のコマンドがないため、その行は代わりに本人の手順を示します。Codex 自身のフックの信頼（Codex で `/hooks` と入力し、`t` を押してすべてを信頼し、Esc を押す）と、Kiro IDE でエラーのある設定ファイル（示されたファイルのエラーを直す。その `command` である `config trust --check` は結果を確認するだけです）です。JSON には `data.outstandingActions` が含まれ、そのような項目はその `step` も持ちます。quiet の出力は、問題がなければ 1 行のままで、続きが必要な場合は残っている対応の行を 1 行、そしてコミットされた記録を隠す ignore ルールごとに `Warning:` の行を 1 行追加します。

人が使う TTY では、引数なしの初回の実行（フラグなしの `aidlc config`。`--harness`、`--dry-run`、`--yes`、`--json` のようなフラグはウィザードを省きます）は質問ではなく検出から始まります。`PATH` 上のインストール済みのハーネスの CLI、プロジェクトの状態、ローカルの AWS の資格情報とリージョン、非対話のフックのランタイムです。検出したハーネスが 1 つなら、ウィザードはそれを示し、3 つの選択肢を提示します。推奨の既定値、6 ステップのカスタマイズ、何も書かずに終了です。複数のハーネスを検出した場合は、先に番号付きのハーネスのピッカーが出ます。ハーネスを検出しなかった場合は、既定のない完全なピッカーが出ます。2.24.1 以降の Kiro CLI は、両方の Kiro ハーネスとして数えられます。ピッカーは `kiro` を Kiro CLI (V2) として示します。これはエンジンを固定せず、Kiro CLI の v2 エンジン向けに作られています。`kiro-ide` は Kiro として示し、Kiro IDE と v3 エンジンの Kiro CLI 向けです。2 つのうち Kiro CLI (V2) が先に来るため、それより前に検出したハーネスが一覧の先頭にある場合や、セットアップがハーネスのエディター自身の端末で動く場合（そのハーネスが先頭に来ます）を除き、Enter でそれが選ばれます。

セットアップの選択肢を示す前に、ウィザードは一時的なファイルとディレクトリを使ってプロジェクトのファイルシステムを探査し、その後それらを削除します。確認するのは、トランザクションのロック、排他的なファイルの作成、通常ファイルの `fsync`、可変の追記と読み返し、記述子とパスの同一性、改名によるファイルの置き換え、ディレクトリの改名、Unix の `chmod`、ランタイムのワークフローのロックの調整です。ディレクトリの `fsync` に対応していないことは許容されます。これらの確認は使えない操作を検出するもので、成功しても原子性やクラッシュへの耐久性は保証できません。探査が失敗すると、ストレージについての対処とともに、何も書かずにセットアップが止まります（削除できない探査がある場合は代わりにそれを示します）。[config がハードリンクのエラーで失敗する](15-troubleshooting.md#config-fails-with-a-hard-link-error) を参照してください。

推奨の既定値は、ハーネスの現在のモデルプロバイダーを保ちます。カスタマイズは、Harness、Model provider、Model effort preset、Plugins、MCP servers、モデルのプリセットの設定層を順に進みます。プロバイダーのステップは、現在のプロバイダーを保つ選択肢を 1 番目、Amazon Bedrock を 2 番目に提示します。`kiro` の行では、ステップ 2 は代わりに Session model です。Kiro のアカウントのモデルを一覧し、選んだモデルをプリセットのセッションの effort とともに、すべての AI-DLC のステップの後、最後に個人の Kiro の設定に保存します。Kiro が auto のときは、推奨の既定値はそのモデルの質問を 1 つだけ尋ねます。[セッションのモデルと effort](harnesses/kiro-cli.md#セッションのモデルと-effort) を参照してください。`kiro-ide` の行については [初回の実行](harnesses/kiro-ide.md#初回の実行) を参照してください。
その完全なピッカーを除き、番号付きのプロンプトにはどれも括弧付きの既定値があり、不正な入力はその場で尋ね直され、各回答は復唱されます。回答の確認の表では、Enter で適用し、ステップ番号で編集できます。その最後のゲートの前にファイルは書かれません。適用の後、実行した内容の報告がプロジェクトのファイルとモデルのプリセットの設定層を示し、本当にブロックしている対応が続き、その後ウィザードがハーネスの正確な起動方法と最初のワークフローのコマンドを表示します。

ステップ 3 は 4 つ目の選択肢 `unchanged` も提示します。これはプリセットを記録せず、既存のモデルの設定を保ちます。モデルのポリシーのないプロジェクトは同梱の既定値を使います。`balanced` が引き続き推奨の既定ですが、Kiro IDE、Cursor、GitHub Copilot は例外です。そこではすべてのエージェントがセッションのモデルと effort を使うため、セットアップは `unchanged` を推奨して既定とし、再実行時の一覧は Models をホストのセッションを示して `[ok]` と表示します。

既存のプロジェクトでの再実行は、Harnesses、Models、Runtime、Flags、Project、Providers、Trust、Workspace の 8 行の一覧を保ちます。行は小文字の `[ok]` か `[needs]` です。既定が yes の 1 つのゲートが、Models、Runtime、Providers、Trust の所見だけを順に扱います。Workspace は報告されるだけで、扱われません。欠けた `aidlc/spaces/default/memory/` のシェルは、質問ではなく明示的な `aidlc config --harness <name>` の更新で修復します。シェルが不完全な間はゲートはまったく提示されません。その節は欠けたディレクトリで失敗するか、何もしない回答では何も作り直さないためです。最後の一覧は作り直しのコマンドを先頭に示します。`aidlc-copy-runtime-X.Y.Z.tar.gz` の `runtime/<name>/` ルートやチェックアウトの `dist/<name>/` ツリーからコピーした、Bun を呼び出す投影には、更新元となるインストール済みのランタイムがないため、そのコマンドには `--download` も付きます。これはプロジェクトのリリースのコピーのランタイムを取得して検証します。ネイティブのインストールは、それなしでインストール済みのランタイムから更新します。欠けた `aidlc/` のルートは 1 回だけ数えます。Trust の節自身の `workspace-root-missing` の問題は Workspace の行にまとめられます。Providers の行は、独自のモデルアクセスを提供する Kiro CLI と Kiro IDE、そして回答がなければセッション自身のモデルアクセスを意味する GitHub Copilot と Cursor では、記録された回答なしで `[ok]` を示します（例: `model access comes with your GitHub Copilot session`）。自分の Amazon Bedrock を使う場合は、そこで `aidlc config providers` がそれを記録します（Cursor では Bedrock のキーを受け付けるのは IDE だけです）。GitHub Copilot、Cursor、Kiro IDE では、Models の行は `[ok]` を示し、ホストを示します。例: `every agent uses your GitHub Copilot session's model and effort`。それらのホストではプリセットは何も変えないため（Kiro では、1 つのエージェント自身のモデルと effort だけが適用されます）、尋ねるポリシーはなく、記録されたものはそこでは適用されないと示されます。[モデルと effort の選び方](#choosing-a-model-and-effort) を参照してください。
Runtime はすぐに必要な対応を先頭に示し、診断には `aidlc config runtime --show` を案内します。最後の一覧は、ラベルからコマンドへの簡潔な一覧です。節を指定したコマンド、TTY でない実行、`--dry-run`、`--json`、`--quiet` は決定論的な出力を保ち、対話的なウィザードを描画することはありません。

<a id="config-options"></a>

### Config のオプション

| オプション | 意味 |
|--------|---------|
| `--project-dir <path>` | カレントディレクトリではなく、このプロジェクトを対象にする |
| `--harness <name>` | インストール済みのハーネスランタイムを選ぶ |
| `--from <dir-or-tgz>` | インストール済みのランタイムではなく、ローカルのリリースのファイルを使う。`aidlc-copy-runtime-X.Y.Z.tar.gz`（横にある `.sha256` と照合する）、その展開した `runtime/` フォルダ、または 1 つの投影のディレクトリやアーカイブ |
| `--download` | このマシンにない場合、プロジェクトが必要とするリリースを取得して検証し、コマンドを完了する。dry run の計画トークンを適用するときにも再び必要 |
| `--mcp defaults\|none` | Claude の任意の同梱 MCP のエントリを追加するか省く |
| `--dry-run` | 対象のディレクトリを作らず、バイトも変えずに、完全な計画を計算する |
| `--plan-token <token>` | JSON の dry run から承認した正確な計画だけを適用する |
| `--show` | 何も変えずに設定を表示する。節を指定しなければすべての節を順に（`aidlc config --show`。`--json` は節をキーにした 1 つのオブジェクトを出し、各値はその節の `--show --json` が出すもの）、節を指定すればその節だけ |
| `--force` | その方針が許す範囲で、ローカルで変更されたフレームワーク所有のファイルと管理ブロックを置き換える |
| `--yes` | 認識できない対象のディレクトリや節の変更を確認する。MCP への同意を含意することも、節の回答を選ぶこともない |
| `--json` | 件数、操作、`data.notes`、`data.planToken` を持つ結果のオブジェクトを 1 つ出す |
| `--quiet` | 要約か対処の行を 1 行出す |
| `--no-color` | 色の出力を止める |

`--project-dir`、`--json`、`--quiet`、`--no-color`、`--yes`、`--offline`、`--verbose` は AI-DLC 自身のオプションです。`aidlc config --project-dir /work/shop` や `aidlc doctor --json` のように、実行するコマンドと一緒に置いてください。たまたまそのどれかに見えるあなた自身の言葉は、あなたの言葉のままです。そのため `/aidlc add a --project-dir flag to the CLI` は、入力したすべての言葉を保ったまま、その作業を依頼します。

<a id="model-policy"></a>

### モデル方針

`aidlc config models` は、選んだ設定層（`--project` なら `aidlc.settings.json`）にモデルのポリシーを記録し、通常の config の計画、確認、トランザクションを通して適用します。モデルプロバイダーに接続することはありません。Kiro CLI では、セッションのモデルを選ぶと、アカウントのモデルの一覧とそのモデルの effort の水準を Kiro CLI に尋ねます。`--yes` では、そうするのは `--session-model` だけです。

公開のグループは次です。

| グループ | エージェント | 出荷時のティア |
|-------|--------|--------------|
| Deciding | 設計、実装、プロダクト、セキュリティ、品質の 9 エージェント | judgment |
| Reviewing | product lead と architecture reviewer | balanced |
| Writing up | delivery、pipeline and deploy、operations | templated |

ポリシーはエージェントごとに、この順で解決します。

1. エージェントごとの例外
2. 直接、またはプリセットを通じて設定したグループの設定
3. 出荷時のティアの既定値
4. セッションの継承

固定は両方向に効きます。固定したエージェントは、後でセッションがより大きなモデルに移っても固定のままです。フレームワークが自分からエージェントをセッションより上げることはありません。ポリシーが記録されていなければ、Deciding と Writing up は継承し、計測した reviewing のティアの基準だけが一段下げて出荷されます。初回のウィザードの既定の選択は `balanced` プリセットを記録し、3 つのグループすべてを medium の effort にします。Kiro IDE、Cursor、GitHub Copilot ではプリセットを記録しません。

```bash
aidlc config models --show
aidlc config models --reviewing-effort xhigh --project --yes
aidlc config models --agent architect --effort xhigh --model provider/raw-id --project --yes
aidlc config models --check
aidlc config models --reset --project --yes
aidlc config models --session-model claude-opus-4.8   # Kiro CLI: your personal session model
```

変更は、何が変わったか、それを元に戻すコマンド、誰がそれを取り込むか（さらにまだ残っているセットアップの手順）で終わります。`--json` と `--quiet` の出力は変わりません。

`--show --json` は、すべてのエージェントの実効のモデル、effort、出どころを出します。`--check` はその CI 向けの逆で、記録されたポリシーがハーネスの面に完全に反映されていなければ非ゼロで終了します。プリセットが何も変えない Kiro IDE、Cursor、GitHub Copilot では、書き込めない記録された effort は `aidlc doctor` と同じくセッションに任され、確認を失敗させません。セッションがすべてのエージェントのモデルと effort を決める Cursor と GitHub Copilot では、問題のない確認は、記録されたポリシーが反映されたと言う代わりに、`aidlc doctor` と同じくその旨を伝えます。

モデルとフラグのポリシーは、葉ごとに次の階層で解決します。

1. ティアとプリセットの表の出荷時の既定値
2. マシン `${AIDLC_INSTALL_ROOT:-~/.local/share/aidlc}/aidlc.settings.json`
3. プロジェクト `aidlc.settings.json`
4. 個人 `aidlc.settings.local.json`
5. 環境変数

バイパスは上書きではなく足し合わされます。3 つのファイルのどれかが記録している間、スイッチは on です。

プロジェクトのファイルはコミットされるチームのポリシーです。ローカルのファイルは個人用です。AI-DLC が管理する `.gitignore` ブロックがそれを載せており、`.gitignore` がそれより前のインストールでは、それを作る config のコマンドが代わりにクローン自身の `.git/info/exclude` に追加します。どちらのファイルもチームのコードとは数えません。変更には `--project`、`--local`、`--global` のちょうど 1 つが必要です。例外はバイパスで、層を指定しない `--bypass` はローカルのファイルに記録し、層を指定しない `--clear-bypass` は、自分の端末で入力した場合、それを記録しているすべてのファイルからクリアします（チャットからエージェントが実行した場合はローカルのファイルだけをクリアし、まだそのチェックを off にしているプロジェクトやマシンのファイルを示します）。対話的なウィザードは層を尋ね、リポジトリの中ではプロジェクトのポリシーを推奨します。認識したプロジェクトの外ではマシンの層だけが有効なので、`--global` が推定されます。`--show` は、各実効値に勝った出どころのラベルを付けます。

3 つのファイルはすべて 1 つの厳格なスキーマを使います。未知のキーは安全側に失敗し、`offline` や `release-base-url` のような更新／リリースのキーはマシン専用です。エディターは生成された `<harness>/tools/data/aidlc-settings.schema.json` を参照できます。既定値の設定ファイルは書きません。

effort だけを指定する変更不可のプリセットが 3 つ出荷されます。

| プリセット | Deciding | Reviewing | Writing up |
|--------|----------|-----------|------------|
| `thorough` | セッションの effort | `xhigh` | セッションの effort |
| `balanced`（ウィザードの既定） | `medium` | `medium` | `medium` |
| `minimal` | `medium` | `medium` | `low` |

プリセットがモデル ID を設定することはありません。明示的なグループの設定とエージェントごとの例外は、プリセットの effort を上書きできます。各セッションを 1 つのモデルで実行する Kiro CLI では、各プリセットは代わりにセッションの 1 つの effort になります。`minimal` は low、`balanced` は medium、`thorough` は xhigh、またはそのモデルの 1 段下の水準です（[セッションのモデルと effort](harnesses/kiro-cli.md#セッションのモデルと-effort)）。

アップグレード時、`preset: balanced` や `preset: minimal` を記録したインストールは、次に投影が再生成されたときにこれらの effort を取り込みます。`aidlc update` の後は、各プロジェクトで `aidlc config --yes` を実行して記録されたポリシーを適用し直すか（開いている作業はそのまま続きます）、`aidlc config models --preset balanced --project --yes`（必要に応じて `minimal` に置き換え）で明示的に選んでください。update が変えるのはマシンのランタイムだけです。doctor と `aidlc config models --check` は、変更を適用せずに問題を報告します。モデルのポリシーを記録していないインストールは出荷時のティアの既定値を保ち、影響を受けません。

プリセットや既存のプロファイルから、プロジェクトのプロファイルを導きます。

```bash
aidlc config models --from thorough --reviewing-effort medium \
  --save-as my-profile --project --yes
```

プリセットとプロファイルが持つのはグループの effort だけです。生のモデル ID が許されるのは、エージェントごとの例外だけです。`--yes` は変更を確認しますが、ポリシーを選ぶことはありません。決め手となるフラグがなければ、TTY ではモデルのポリシーのウィザードが開き、TTY でない実行は使い方の案内とともに失敗します。

ハーネスが受け取るのは、読める設定だけです。Codex は `max` の effort を `xhigh` に抑えます。opencode は `xhigh` を `high` に抑えます。Kiro CLI では、プリセットは対話セッション全体に 1 つの effort を設定し、セッションのモデルとともに個人の Kiro の設定に保存されます（[セッションのモデルと effort](harnesses/kiro-cli.md#セッションのモデルと-effort)）。明示的なグループの設定には Kiro の面がなく、エージェントごとのモデルの例外は、プロジェクトの `chat.modelDefaults` を通じて effort を運び、そのプロジェクトでは個人の effort の対応表を置き換えます。モデルなしで Kiro CLI に設定した effort はほかのツールのために保持され、コマンドはそれを 1 行で伝えます。
Kiro IDE、Cursor、GitHub Copilot にはプリセットやグループの effort の面がないため、そこではセットアップはプリセットを記録しません。Kiro では、`aidlc config models --agent` で引き続き 1 つのエージェント自身のモデルと effort を設定できます（[1 つのエージェントを独自のモデルと effort で](harnesses/kiro-ide.md#1-つのエージェントを独自のモデルと-effort-で)）。Cursor と Copilot では、それでも設定したモデルや effort は、それを適用するツールを使うチームメイトのために保持され、効果のないキーは書かず、コマンドはこのツールがそれ自身のモデルピッカーで選んだモデルを使うことを 1 行で伝えます。その 3 つでは、すべてのエージェントがセッションのモデルと effort を使います（Kiro では、そのエージェントにモデルや effort が設定されていない限り）。セットアップの確認と `aidlc doctor` はポリシーを尋ねる代わりにそう伝え、doctor が警告するのは、そのハーネスについて名前で記録されたエージェントのモデルだけです。

モデルのポリシーはエージェント単位です。ステージファイルがモデルや effort のキーを持つことはなく、ステージの重大度は引き続きスコープが持ちます。

<a id="choosing-a-model-and-effort"></a>

### モデルと effort の選び方

AI-DLC は、能力の高い推論モデルで最もよく動きます。推奨のモデルは Claude Opus 4.8 です。モデルと effort をどこで設定するかはハーネスによります。

- **GitHub Copilot、Cursor、Kiro IDE:** ホストで、セッション全体について設定します。すべてのエージェントは `/aidlc` を実行するチャットのモデルと effort を使い、AI-DLC が記録するものはそれを変えません。例外は Kiro で、`aidlc config models --agent` が 1 つのエージェント自身のモデルと effort を設定します（[1 つのエージェントを独自のモデルと effort で](harnesses/kiro-ide.md#1-つのエージェントを独自のモデルと-effort-で)）。手で `model:` 行を書くのではなく、そこで設定してください。手で書いた行は `aidlc config models --check` がずれとして報告します。Copilot では、CLI と VS Code がモデル名を異なる方法で読むため、エージェントの `.md` ファイルの `model:` による固定は移植できません。
- **Claude Code、Codex CLI、opencode:** セッションのモデルと effort が、コンダクターと継承するすべてのエージェントを動かします。`aidlc config models` は、エージェントの effort（`balanced` プリセットはそれらを medium にします）とエージェントごとの例外を設定できます。
- **Kiro CLI:** セッションのモデルとその 1 つの effort です。`aidlc config models` はそれらを個人の Kiro の設定に保存し（プリセットが effort を設定します。`minimal` は low、`balanced` は medium、`thorough` は extra-high）、Kiro の中では `/model` と `/effort` でそれらを変えます。`/model` による切り替えがコンダクターのディスパッチするエージェントに届くのは、`/model set-current-as-default` で保存してからです。推奨のセットアップは、あなたのモデルについてすでに保存した effort を保ちます。Kiro IDE の行では、セットアップは Kiro CLI のセッションのモデルだけを保存します。[セッションのモデルと effort](harnesses/kiro-cli.md#セッションのモデルと-effort) を参照してください。

組織が Claude Sonnet のような中位のモデルだけを提供し、Opus がない場合は次のようにします。

- **セッションは medium の effort で始めます。** ワークフローは多くのターンを実行し、effort が高いとモデルはそのすべてでより長く考えるため、high や最大の effort では実行全体がはるかに遅く、高価になります。medium は、エージェントを設定できるハーネスで `balanced` プリセットがエージェントに与えるものです。
- **effort を上げるのは、それが必要なステージだけにし、** 例えば難しい Unit の Code Generation の後で再び下げます。GitHub Copilot、Cursor、Kiro IDE、Kiro CLI では、それはセッションの effort です（Kiro IDE では、developer エージェントに effort が設定されていない限り）。Claude Code、Codex CLI、opencode では、Code Generation は developer エージェントで実行され、それがセッションに従うのは、プリセットや effort がそれについて記録されていない間だけです。そうでなければその effort は記録されたものなので、上げるにはそれを記録します。例: `aidlc config models --agent developer --effort high --project --yes`。これはワークフローが開いている間も使えます。config は developer エージェントのファイルを書き直し、ハーネスは次にそのエージェントを起動するときにそれを使います（Claude Code はエージェントの次の起動時に使い、すでに実行中のステップは起動時のものを保ちます）。コマンドは、元に戻すためのコマンドを表示します（1 つのエージェントの設定なら `--effort default` で、その設定だけを取り除きます）。
- **モデルや effort はステージの合間に、新しいチャットで変えます。** [ワークフロー途中でのモデル変更](11-session-management.md#ワークフロー途中でのモデル変更) を参照してください。

ワークショップを運営しますか。[ファシリテーターガイド](facilitator-guide.md) は、準備状況の確認と、各実行を小さく保つ方法を扱っています。

<a id="in-session-alias"></a>

### セッション内の別名

`/aidlc --config [section]` は、これらと同じ config の節の会話による別名です。コンダクターは尋ねる前に現在の JSON の状態を読み、あなたが望む変更だけを集め、受け入れた各節を正確な `aidlc config <section> <explicit value flags> --yes` コマンド 1 つで着地させます。節を変えずにおけば、コマンドは実行されません。着地または辞退の後、別名は止まります。ワークフローの作業を進めたり再開したりすることはありません。

<a id="runtime-diagnostics"></a>

### ランタイム診断

`aidlc config runtime` は、プロジェクトのフックが実際に使う環境を確認します。Linux では、`getconf PATH` に加えて、`/etc/environment` の `PATH` の行、`/etc/login.defs` の `ENV_PATH`、`environment.d` から非対話の基準を導きます。macOS では、`getconf PATH` に加えて `/etc/paths` と `/etc/paths.d` を使います。Windows では、シェルのプロファイルを読み込まずに User と Machine の PATH を読みます。その後、インストールされたフックのバイト列が必要とするコマンド（コピーの投影なら `bun`、ネイティブの投影なら `aidlc`）を解決し、選んだハーネスの CLI を確認します。

```bash
aidlc config runtime --show
aidlc config runtime --check
aidlc config runtime --record-paths --yes
aidlc config runtime --reset --yes
```

`--record-paths` は、解決した答えを `harness.json` に記録します。フックのコマンドは書き直しません。ホストの権限ルールと Codex のフックの信頼は、素の `bun` や `aidlc` のコマンドの接頭辞に結び付くため、それを絶対パスに置き換えると既存の信頼の契約が無効になります。コマンドが対話専用、または存在しない場合、この節は代わりにプラットフォームごとの PATH の指示を出します。

`/aidlc --doctor` は、同じ探査を `Runtime hook PATH` の行として表示します。コマンドが現在のシェルの PATH にしかないが、このプロジェクトのフックが発火している（`.aidlc-engine/hooks-health/` の下に、それ以降終了していない起動から、過去 10 分以内の古くないハートビートがある）場合、その行は合格となり、最後に発火した時刻を示します。ハーネスは明らかにその PATH をフックに渡しているからです。そうでなければ警告し、コマンドが見つかったディレクトリを示し、端末から起動したハーネスは変更不要であることと、`.bashrc` や `.zshrc` を編集してもこの確認は変わらないことを伝えます。

ハーネスの CLI の確認は、対応するハーネスについて `claude`、`kiro-cli >= 2.6.0`、`codex >= 0.145.0`、`opencode` を必要とします。Copilot CLI と Cursor の `agent` CLI は、それらのインストールが VS Code や IDE だけで動かされることがあるため advisory です。
`kiro-ide` 配布は別の CLI を必要としません。そこでは `kiro-cli` は任意で、端末から AI-DLC を実行する場合にだけ必要で、ある場合は 2.24.1 に対して確認されます。

<a id="provider-diagnostics"></a>

### プロバイダ診断

`aidlc config providers` は、このプロジェクトのインストールについてのプロバイダーの回答を記録します。ハーネスにすでに設定されているプロバイダーを保つのが既定の回答です。Amazon Bedrock は明示的なオプトインです。Kiro CLI と Kiro IDE は、モデルアクセスが Kiro に付いてくるため尋ねられません。手動で設定したプロバイダーのための `other` も引き続き使え、確認のリマインダーが付きます。

```bash
aidlc config providers --provider current --yes
aidlc config providers --provider amazon-bedrock \
  --region us-east-1 --profile default --yes
aidlc config providers --show --json
aidlc config providers --check
aidlc config providers --mark-done bedrock-model-access --yes
aidlc config providers --reset --yes
```

`--region`、`--profile`、`--opencode-default` が適用されるのは、記録された、または選んだプロバイダーが `amazon-bedrock` の場合だけです。

資格情報の検出はオフラインだけです。AWS の環境変数、`~/.aws/config`、`~/.aws/credentials`、ロールとコンテナの資格情報の変数、AWS SSO のキャッシュを調べます。STS、Bedrock、モデルのエンドポイント、その他のネットワークサービスを呼ぶことは決してありません。

記録された Bedrock の回答は、通常のステージした config のトランザクションを通じて適用されます。

| ハーネス | 記録された回答の適用 |
|---------|-----------------------------|
| Claude Code | Bedrock を有効にし、あなた自身の `.claude/settings.local.json`（git が無視する。プロファイルは `harness.json` に記録しない）に `AWS_REGION` と任意の `AWS_PROFILE` を書く。`.mcp.json` の AWS MCP の URL と `AWS_REGION` のメタデータも同じリージョンに保つ |
| Codex CLI | 選択を記録し、プロバイダー、資格情報、モデルを `~/.codex/config.toml` に保つよう利用者に指示する |
| Kiro CLI | プロバイダーの回答なし。モデルアクセスは Kiro に付いてくる |
| Kiro IDE | プロバイダーの回答なし。モデルアクセスは Kiro に付いてくる |
| opencode | `provider.amazon-bedrock.options.region/profile` を `opencode.json` に書くことを提案する。`--opencode-default yes|no` が回答を記録する |
| GitHub Copilot | 手動の BYOK の環境設定の確認を記録する |
| Cursor | 手動のプロバイダーとモデルピッカーの設定の確認を記録する |

Bedrock のモデルアクセスと IAM の権限の検証はオフラインでは自動化できません。そのため、記録は名前付きの保留中の対応を持ちます。`--show` はそれらを一覧し、`--check` は保留中の間は非ゼロのままで、`--mark-done <id>` が完了を記録します。Codex のプロバイダーの設定は、実効の利用者の設定と代わりの資格情報の経路をオフラインでは解決できないため、完了後も明示的に自己申告のままです。`--check` は、設定を検証済みと記述する代わりに、その警告とともに成功を返します。
`--provider current` はハーネスに設定されたプロバイダーを保ち、Claude、Codex、opencode のプロジェクトのファイルから、AI-DLC が同梱の既定値や以前の記録に帰属できる Bedrock の値だけを削除します。カスタマイズされた Claude のモデルの別名は保たれます。カスタマイズされた旧来の Codex の Bedrock のブロックも保たれます。それがまだそのプロバイダーを指している場合、`--check` は設定に問題がないとは言わず、警告を報告します。`--provider other` は手動で設定した Bedrock 以外のプロバイダーを記録し、`--acknowledge` が指定されるまでその設定を保留中と報告します。`--reset` は、Claude、Codex、opencode のプロジェクトのファイルから、旧来の AI-DLC の Bedrock の既定値と完全に一致するものや、以前に記録された回答のために書かれた値を削除します。証明できない値は保たれます。Claude Code では、`--provider current`、`--provider other`、`--reset` は、あなたの `.claude/settings.local.json` から Bedrock のスイッチとリージョンも取り除きます。そこにある `AWS_PROFILE` は残り、コマンドがそのことを伝えます。

Claude Code では、Bedrock の回答は一人ひとりのものです。チームメイトのクローンはプロジェクトの記録を持ちますが、あなたの設定は何も持たないので、`aidlc config providers --check` と doctor は、Bedrock が記録されているもののその人には on になっていないことを、その人に一度警告します。以前のリリースで設定したプロジェクトは、誰かが `aidlc config providers` に答え直すまで、回答を共有の `.claude/settings.json` に保ちます。答え直すと回答はその人自身のファイルへ移り、そのことが伝えられます。プロジェクトの更新や AI-DLC の更新では、そのまま残ります。

質問は目の前のハーネスに合わせた言葉で示されるため、各インストールは実際にそのハーネスに存在する 2 つの経路を提示します。

| ハーネス | `amazon-bedrock` が記録するもの |
|---------|--------------------------|
| Claude Code | あなた自身の `settings.local.json` の AWS のリージョンとプロファイル、そしてある場合は `.mcp.json` の AWS MCP のリージョン |
| Codex CLI | プロジェクトの記録の AWS のリージョンとプロファイル。その後 `$CODEX_HOME/config.toml` での利用者単位のプロバイダーの設定を案内する |
| OpenCode | AWS のリージョンとプロファイル。それらを `opencode.json` に書くことを提案する |
| GitHub Copilot | Copilot の BYOK のプロバイダーの変数を自分で設定したこと |
| Cursor | Cursor でプロバイダーを自分で設定したこと |

Kiro CLI と Kiro IDE は独自のモデルアクセスを提供するため、AI-DLC はそれらのモデルプロバイダーを設定しません。`aidlc config providers` は、モデルアクセスが Kiro に付いてくると伝えて何も尋ねません。`kiro-cli` を読めない場合は Kiro IDE の初回のウィザードも同様で、Kiro CLI と、読める `kiro-cli` がある Kiro IDE では、そのステップ 2 が代わりに Kiro CLI のセッションのモデルを選びます。プロバイダーのフラグは拒否され、Providers の行は旧来の記録にかかわらず `[ok]` を示します。
`aidlc config providers --reset --yes` は、以前のビルドが残した記録をクリアします。以前のビルドの `builtin` の記録は引き続き読み込まれ、保留中の対応なしにハーネスの管理として読まれます。旧来の Kiro の Bedrock の記録も、その保留中の対応を含めて無視され、そこから何も書かれません。`.kiro/settings/mcp.json` の `aws-mcp` のリージョンは通常の MCP の設定で、モデルプロバイダーの回答ではありません。そのファイルが持つリージョンは、以前のビルドの Bedrock の回答が書いたものでもあなたが書いたものでも、更新をまたいで保たれ、`--reset` もそのファイルには触れません。

それ以外のすべてのハーネスは、現在のプロバイダーを保つか、Amazon Bedrock にオプトインするかを尋ねます。AWS の資格情報が検出された場合も含め、現在のプロバイダーを保つのが既定です。Copilot と Cursor は、それぞれの BYOK やプロバイダーの設定を通じて Bedrock に到達し、AI-DLC はそれを自分で行うのではなく、保留中の対応として追跡します。

Kiro では、`--check` は回答が不要だと伝え、旧来の記録があってもゼロで終了します。回答のない GitHub Copilot と Cursor では、`--check` と `doctor` は、モデルアクセスがセッションに付いてくるため回答が不要だと伝え、`--check` は自分の Amazon Bedrock のアクセスを記録するコマンドを示します。それ以外の記録のない節では、検証済みの回答を報告する代わりにその状態を示し、同梱のフォールバックのバイト列が引き続き有効なため、やはりゼロで終了します。

これらのハーネスでは、`keep current` が最初の回答で既定です。`amazon-bedrock` は 2 番目の回答です。記録された回答で節に入り直すと、それは保たれます。Bedrock は明示的に置き換えない限りリージョンとプロファイルを保ち、`other` は保留中の手動設定の対応を保ちます。保留中の対応は、引き続き `--mark-done` で完了できます。

<a id="trust-diagnostics"></a>

### 信頼診断

`aidlc config trust` は、ホストネイティブの信頼を読み、検証します。信頼のシード、権限ルール、IDE の設定を再生成することはありません。プロジェクトの外に書き込むのは、Kiro IDE と Kiro CLI の Workflows スイッチと、Windows での Kiro IDE の既定の端末だけで、それも求めた場合に限ります。

```bash
aidlc config trust --show
aidlc config trust --check
aidlc config trust --acknowledge --yes
aidlc config trust --reset --yes
aidlc config trust --kiro-workflows off --yes   # Kiro IDE; or: on
aidlc config trust --kiro-cli-workflows off --yes   # Kiro CLI; or: on
aidlc config trust --kiro-terminal powershell --yes   # Kiro IDE on Windows
```

Kiro IDE では、`--show` と `--check` は Kiro の Workflows スイッチも読みます（Kiro のユーザー設定の `kiroAgent.workflows.enabled` なので、すべてのプロジェクトに及びます。これが on の間、AI-DLC のレビューとヘルパーは動きません）。`--kiro-workflows off|on` はその 1 つのキーだけを変え、ファイルのほかのバイトはすべて保ちます。Workflows が on で、このコンピューターでまだ回答していない間は、セットアップが 1 回尋ね、`aidlc config --yes` はそれを off にします。回答は AI-DLC のインストールフォルダの `kiro-ide-workflows` に保持されるため、ほかのプロジェクトが再び尋ねることはありません。その設定ファイルに AI-DLC が読み進められないエラーがある場合、Kiro は Workflows を on と読むことがあるため、`--show` は読めなかったと伝え、`--check` とセットアップはファイルが再び読めるまで（以前の回答にかかわらず）警告し、次の Kiro IDE のチャットが 1 回伝えます。そのファイルのエラーを直してください。同じ Kiro の行で、`--show` と `--check` は Kiro CLI 自身の Workflows スイッチ（Kiro CLI の設定の `chat.enableWorkflows`。`kiro-cli settings` を通じて読みます）も読みます。これは Kiro CLI のチャットで同じツールを取り上げます。`--kiro-cli-workflows off|on` はそれを Kiro CLI を通じて設定し、その回答は Kiro IDE のものとは別に `kiro-cli-workflows` に保持されます。応答する Kiro CLI がない場合は表示されません。[Kiro の Workflows 機能は AI-DLC のレビューと補助を止める](harnesses/kiro-ide.md#kiro-の-workflows-機能は-ai-dlc-のレビューと補助を止める) を参照してください。

Windows では、Kiro IDE はエージェントのコマンドを既定の端末プロファイル（Kiro のユーザー設定の `terminal.integrated.defaultProfile.windows`）で実行します。それがコマンドプロンプト（Kiro はコマンドが 1 秒以内に終わった場合にだけその返答を表示するため、AI-DLC の返答のほとんどが空で返ってきます）で、このコンピューターでまだ回答していない間は、セットアップが PowerShell にするかを 1 回尋ね、`aidlc config --yes` がそれを設定し、`--kiro-terminal powershell` は単独でそれを設定します（すでに PowerShell ならそう伝えます）。どれもその 1 つのキーだけを変え、ファイルのほかのバイトはすべて保ち、回答は AI-DLC のインストールフォルダの `kiro-ide-terminal` に保持されます。[Windows で Kiro のターミナルが Command Prompt のとき](harnesses/kiro-ide.md#windows-で-kiro-のターミナルが-command-prompt-のとき) を参照してください。

Codex では、この確認は `$CODEX_HOME/config.toml` にプロジェクト固有の信頼のシードのエントリの完全な集合があることを要求します。対応する修正は 2 つです。TUI の `Trust all and continue` を 1 回通すか、`<PROJECT_DIR>` を置き換えて完全なシードをマージするかです。それまで、Codex のフックは 1 つも発火しません。
`--dangerously-bypass-hook-trust` は信頼されていないフックを発火させず、2 つ目のシードの集合を追記すると不正な TOML になります。

`kiro-ide` 配布では、信頼はコンダクターの `permissions`（`.kiro/agents/aidlc-aidlc.md`）に含めて出荷されるため、確認はそこに何も追加しません。Kiro IDE 1.x は `.vscode/settings.json` の `kiroAgent.trustedCommands` をもう読みません。`--show` は、選んだハーネスの信頼と許可リストのファイルを一覧します。

Copilot では、確認は Copilot CLI の `trustedFolders`（`COPILOT_HOME` の下、なければ Windows では `%USERPROFILE%\.copilot`、それ以外では `~/.copilot` の `config.json`）を読み、それがプロジェクトを覆っていなければ警告します。プロジェクトより上のフォルダも数えます。VS Code はその一覧を決して読みません。そのフックには信頼されたワークスペースと on の Chat: Use Hooks 設定が必要で、AI-DLC からはそれが見えないため、Trust の行はそれらを示します。CLI がプロジェクトを信頼していない場合、`aidlc config trust`（とセットアップの手順）がその方法を伝えます。プロジェクトで一度 `copilot` を実行し、「Yes, and remember this folder for future sessions」を選びます。フォルダを信頼するとそのコードが実行できるようになるため、AI-DLC が CLI の `config.json` を自分で編集することは決してありません。

信頼の確認は、コピーのインストールでよく漏れるプロジェクトの兄弟も検証します。すべてのハーネスの `aidlc/`、Codex の `.agents/`、opencode と Copilot の `.aidlc/` エンジンです。

doctor は、インストールされた指示ファイルを config の所有の基準に対しても分類します。損なわれていない管理ブロックは `block present, user content preserved` と報告します。ブロックやファイルがなければ `aidlc config` を実行するよう伝えます。手で変更された管理ブロックや、フレームワーク所有のファイル全体は競合と報告します。オンボーディングの `# AI-DLC` の見出しの位置に書かれた行は競合ではありません。それはプロジェクト自身のものです（下記参照）。複数のハーネスのツリーがある場合、行は呼び出したハーネスに従います。

<a id="project-flags"></a>

### プロジェクトフラグ

`aidlc config flags` は、既定のスコープ、swarm モード、フックのデバッグ、センサーのタイムアウト、質問の保持期間、明示的なガードのバイパスや手続きの無効化スイッチについて、プロジェクトの回答を記録します。

```bash
aidlc config flags --default-scope <installed-scope> \
  --swarm on --hook-debug off --sensor-timeout-ms 90000 \
  --question-retention-days 30 --project --yes
aidlc config flags --bypass AIDLC_SKIP_ARTIFACT_GUARD --local --yes
aidlc config flags --show
aidlc config flags --check
aidlc config flags --reset --project --yes
```

実際の環境変数が常に優先します。既存のツールとフックは、まず環境を読み、変数がない場合にローカル、プロジェクト、マシンの設定を解決します。これにより、CI や一時的なシェルの export でもスクリプトで扱えます。

`--question-retention-days <days|unlimited>` は、回答されなかった質問について、AI-DLC が要求のコピーをどれだけ保持するかを制御します。正の整数が記録されない限り、既定は無期限です。値を設定すると、その日数より古いコピーは、次に AI-DLC が作業を行うときに削除され（status、help、その他の照会は何も削除しません）、期限切れの質問に回答すると拒否されます。`unlimited` を渡すと、ほかのフラグを変えずに、選んだ設定層からその値を削除します。
`AIDLC_QUESTION_RETENTION_DAYS` が対応する環境変数による上書きです。

既定のスコープの名前は、インストールされたスコープファイルから読みます。この節は組み込みのスコープ名で分岐しないため、スコープの改名やプラグインのスコープはデータのままです。Claude Code では、config は `.claude/settings.json` のステージした `AWS_AIDLC_DEFAULT_SCOPE` の値も書き直します。そうしないと、同梱のセッションの環境が、より優先度の低い記録を覆い隠してしまうためです。

記録できるバイパスの集合には、文書化された復旧と手続きのスイッチが含まれます。

- `AIDLC_SKIP_ARTIFACT_GUARD`
- `AIDLC_SKIP_HUMAN_PRESENCE_GUARD`
- `AIDLC_SKIP_REVISION_BACKSTOP`
- `AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD`
- `AIDLC_DISABLE_ENSEMBLE_EVIDENCE`
- `AIDLC_DISABLE_PLAN_APPROVAL_GUARD`
- `AIDLC_DISABLE_REVIEWER_SCOPE_HOOK`
- `AIDLC_DISABLE_REVIEW_FREEZE_HOOK`
- `AIDLC_DISABLE_USAGE_TRACKING`
- `AIDLC_DISABLE_SENSORS` — センサーの実行とセンサーのゲートの検査を無効にする
- `AIDLC_DISABLE_LEARNINGS` — ステージの学びの手続きを無効にする
- `AIDLC_DISABLE_SUMMARY_CONFIRMATION` — 独立した要約確認のチェックポイントを無効にする。ステージの承認は無効にしない

ウィザードがバイパスを提示することはありません。それには明示的な `--bypass <name>` が必要です。`--show` は、有効なすべてのバイパスとそれがガードを弱める結果を表示します。
1 つを記録またはクリアすると、変わったものだけを、それを元に戻すコマンドと、切り替えた検査についての行（さらにまだ残っているセットアップの手順）とともに表示します。`--json` と `--quiet` の出力は変わりません。
使用量の追跡、センサー、学びを除くすべてのバイパスは、その人から検査を取り上げるため、それが on の間、AI-DLC はそれを 1 行で伝えます。次のステップで、すべてのチャットの開始時に（セッション開始時の文脈を表示しない opencode を除く）、`--show` で、そして doctor の Flags の行で伝えます。その行は、検査、いつからか、どう設定されたか、それを on に戻す `--clear-bypass` のコマンドを示します（[CLI コマンド](12-cli-commands.md) の「環境変数による無効化スイッチ」を参照）。

これらのうち 4 つは、マシン全体についてガードを off にします。問題が 1 つのマシンではなく 1 件の作業である場合、`/aidlc config set guard.<fence> off` は、その作業についてだけ 1 つのガードを下げ、それを記録し、次の作業では元に戻します。[Guard Policy](13-customization.md#guard-policy) と [5 つの個別ガード](13-customization.md#the-five-fences) を参照してください。

<a id="project-choices"></a>

### プロジェクトの選択

`aidlc config project` は、インストールされたプラグインの選択、MCP への同意、シェルの補完についての回答を記録します。

```bash
aidlc config project --plugins aidlc,test-pro --mcp none \
  --completions zsh --yes
aidlc config project --show --json
aidlc config project --check
aidlc config project --reset --yes
```

コピーのチャネルの投影では、`config project` は、プロジェクトがすでに持っているリリースのプロジェクト自身のファイルから、プラグイン、MCP、補完の選択を適用するため、ダウンロードは不要です。MCP を再び on にすると、ハーネスのフォルダが保持する同梱のサーバーの一覧を読みます。リリースが必要になるのは、プロジェクトが別のリリースに固定されている場合か、その一覧がハーネスのフォルダにない場合だけで、そのときは端末で尋ね、スクリプトでは `--download` を付けます。
`--from <path>` は代わりにダウンロードしたファイル、つまり `aidlc-copy-runtime-X.Y.Z.tar.gz`、その展開した `runtime/` フォルダ、または 1 つのハーネスのルートを使います。`.mcp.json` に自分で追加したサーバーが記録されたり削除されたりすることはありません。

プラグインの名前は、インストールされたグラフ、スコープ、プラグインのサイドカーから見つけます。ハードコードはしません。選択は引き続き `harness.json` の既存のトップレベルの `plugins` 配列を使うため、グラフとランナーの再生成は、プラグインの compose と同じ選択の継ぎ目を使います。ワークフローが開いている間のプロジェクトの変更は、ほかの更新と同じように実行され（「更新の安全」を参照）、何が変わったかを、1 つのコマンドで言える場合は以前の選択に戻すコマンドとともに伝えます。開いている作業が必要とするプラグインを off にすると、その作業を示します。プラグインが再び on になれば、その作業は続きます。同じコマンドに `--dry-run` を付けると、プロジェクトや設定のファイルを変えずにその計画を下見できます。

MCP への同意は `defaults` か `none` のままです。以前の同意のない非対話のプロジェクトの変更は `none` を記録します。ただし、`.mcp.json` がすでに同梱のサーバーを同梱のまま持っている場合は、`defaults` を記録し、そこにあるサーバーを保ち、何も追加しません。`--yes` は変更を確認するだけで、MCP のエントリを追加することはありません。

Claude Code では、`.mcp.json` が同意によって管理される面です。`--check` は `defaults` と `none` の両方を検証し、その後の素の config の更新が回答を適用し直します。Kiro CLI は常に `.kiro/settings/mcp.json` を出荷します。`defaults` はそのファイルとその 5 つの同梱のサーバーで満たされ、`none` は指示だけの好みで、フレームワーク所有のファイルは削除しません。現在の Codex、opencode、Copilot、Kiro IDE、Cursor の配布は MCP の面を出荷しないため、それらの記録された回答は情報にすぎず、`--check` を恒常的に失敗させることはありません。`--show` は、MCP のファイルがある場合は常に実際のファイルを示します。

補完は指示だけで、マシンにファイルを書きません。ネイティブのインストールは次のようなコマンドを表示します。

```bash
eval "$(aidlc system completions bash)"
```

コピーのチャネルのインストールは、対応する Bun の呼び出しを表示します。例:

```bash
eval "$(bun .claude/tools/aidlc.ts system completions bash)"
```

Fish は `... completions fish | source`、PowerShell は `... completions powershell | Out-String | Invoke-Expression` を使います。

既存のプロジェクトのスタンプは、更新のハーネスを固定します。新しい対話的なプロジェクトはハーネスを尋ね、非対話の実行には `--harness` が必要です。`.aidlc-version` がある場合、config は、その正確な版で、一致するプロジェクトのハーネスを持つソースを要求します。

config が認識するのは、`.git`、`package.json`、`Cargo.toml`、`go.mod`、`pyproject.toml` を含むディレクトリか、すでに AI-DLC のハーネスのツリーが設定されているディレクトリです。それらの形の外では、対話モードは確認を求め、非対話モードは `--project-dir` を必要とします。

Claude の任意の MCP の統合は、TTY がないときの既定が `none` です。以前の選択がない場合、人が使う TTY では尋ねられます。`--yes` と `--json` は MCP への同意を与えません。確実な自動化では `--project-dir`、`--harness`、`--mcp defaults|none` を明示します。JSON は出力を制御しますが、それだけでは TTY のプロンプトを止めません。

スクリプトで正確に承認するには、次のようにします。

```bash
token=$(
  aidlc config --project-dir "$PWD" --harness claude --mcp none \
    --dry-run --json | jq -r .data.planToken
)
aidlc config --project-dir "$PWD" --harness claude --mcp none \
  --plan-token "$token" --json
```

両方の呼び出しで、ソースと振る舞いのオプションを同じにしてください。下見の後にソースのバイト列、オプション、プロジェクトの状態が変わるとトークンが変わり、適用は安全側に失敗します。

<a id="refresh-safety"></a>

### 更新の安全

作業が開いている間に実行した `aidlc config` は、保留したワークフローも含め、拒否されずに実行されます。設定の変更（`config models`、`flags`、`runtime`、`providers`、`trust`）はプロジェクト自身のファイルを読み、リリースを取り込みません。それぞれ何が変わったかと、1 つのコマンドで以前の値に戻せる場合はそのコマンドを表示します。モデルやフラグの変更は、それを取り込む開いているワークフローも示します。バイパス、フックのデバッグ、センサーのタイムアウト、質問の保持期間は再起動なしにすぐ適用されます。モデルと swarm は次のステップから適用されます（すでに実行中のステップは開始時のものを保ちます）。ただし Kiro CLI では、実行中のセッションは開始時のものを保つため、モデルや effort の変更は次の Kiro CLI のセッションから適用されます。既定のスコープは新しい作業にだけ適用され、保存したモデルのプロファイルは `--from` で読み込むまで何も変えません。runtime、providers、trust の回答は、ワークフローについての行を表示しません。

リリースのファイルを取り込む更新（素の `aidlc config`、`--from`、`--download`、`config project`、または固定されたプロジェクトが先に必要とする更新）も実行され、そう伝えます。

```
  Updated. Your open work (default/add-login) carries on.
```

新しいリリースが、すでに終えたステージを以前とは違う方法で行い、あなたのものが何も変わっていない場合、あなたの作業はそのまま有効で、やり直しを求められることはありません。そのステージが以前は必要なかった文書を今は必要とする場合は、次のステップがそれを 1 回伝えます。例えば "AI-DLC now does Functional Design differently from when yours ran; your work stands, and `/aidlc --stage functional-design` goes back to it (the stages after it reopen too)." です。そうでなければ伝えられず、`/aidlc --status` がその行を示します。あなた自身の作業への変更は、通常どおりの質問を保ちます。

ファイルが別のリリースから来た場合、次の行が戻し方を伝えます。

```
  To go back: `aidlc config --pin 2.9.0 --yes` (this pins the version for everyone on the project; `aidlc config --unpin` removes the pin).
```

すでに固定されているプロジェクトでは、`--pin` の部分だけを示します。コピーしたプロジェクトでは、その行は代わりに以前のリリースのファイルを示します。`aidlc-copy-runtime-2.9.0.tar.gz` とその `.sha256` を 1 つのフォルダに取得し、`bun .claude/tools/aidlc.ts config --from <that file> --yes` を実行します。開いている作業の横に追加したハーネスは、指定したファイルから来て、その行は追加したフォルダを示します（`Added .codex. Your open work (...) carries on.`）。ハーネスを削除するコマンドはないため、元に戻す行はありません。

更新が保つもの:

- 同梱の投影にない、すべてのワークスペースの記録、監査シャード、ナレッジ、その他のプロジェクトのファイル
- プロジェクト所有の種である、既存の `aidlc/active-space` とスペースの memory ファイル
- 可変の `tools/data/harness.json` にある、識別情報以外の兄弟のキーすべて。プラグインの選択と将来の方針の記録を含む
- プラグインが compose したファイルと記録されたステージの寄与。その後、グラフ、ランナー、スコープ、コンパイル済みの表の面を再生成する
- 上流が書いたオーケストレータの文章。そのコンパイル済みのステージとスコープの領域は、保ったプロジェクトの compose から組み直す
- AI-DLC が管理するフォルダの中にホストのツールが自分でインストールするもの。例えば opencode が最初の起動時に `.opencode/` の下に書く `package.json`、`.gitignore`、`node_modules/`（リンクを含む）。config がこれらをコピーしたり、所有したり、削除したりすることは決してない
- Kiro CLI が 3.0 エンジンのためにアップグレードした `.kiro/agents` のエージェントファイル（Kiro は置き換えた各ファイルをその横に `.json.bak`、次に `.json.bak.1` と続けて残す）。更新はそれらを Kiro が残したとおりに保ち、そのことを 1 行で伝え、リリースの残りを取り込む。`aidlc config --harness kiro --force` はリリースの版を取り込み、Kiro は次に 3.0 エンジンで起動したときにそれらを再びアップグレードする。リリースがそのようなファイルの許可する内容を変える場合（Kiro がアップグレード元にしたファイルにあった allow のエントリを落とすか、deny のエントリを加える場合）、更新は自分でリリースの版を戻す。ただし、Kiro が次の 3.0 の起動時に自分で再びそれをアップグレードすること（その自動アップグレードが on であること。3.0 での Kiro の最初の起動時に **Enable auto-upgrade** が保存するとおり、あなた自身の Kiro の設定で `chat.enableAutoAgentUpgrade` が true）、そのファイルが AI-DLC がそこに書いたものであること、Kiro のコピーがほかのフィールドを保っていることが条件である。そうでなければ Kiro のコピーを保ち、そのファイルがまだ古いリリースが許可していたものを許可していることと、`--force` でリリースの版を取り込めることを 1 行で伝える

`aidlc/` の下では、インストールと更新がコピーするのはそれらの種だけです。クローンの識別情報、セッション、エンジンの健全性、その他のマシンごとの状態は、インストール済みのランタイムからコピーされることも、インストールの基準に記録されることもありません。

ローカルで変更されたフレームワーク所有のファイルは、以前の基準に対して競合します。`--force` は、手で書いたオーケストレータの文章へのローカルの編集を含め、それらのファイルを更新された候補で置き換えます。無関係なプロジェクトの内容の所有は主張しません。改行コードだけの違いはローカルの変更ではありません。Git はチェックアウト時にそれを書き換えるため（Git for Windows は既定で LF のファイルを CRLF でチェックアウトします）、設定済みのプロジェクトのクローン、ブランチの切り替え、stash pop、新しい worktree は競合なしに更新されます。`aidlc doctor` は、更新が拒否するファイルを `AI-DLC files` の行で示します。

1 行だけ例外があります。Claude Code の `.claude/CLAUDE.md` と、Copilot の `AGENTS.md` の AI-DLC の部分は、`# AI-DLC` の見出しで始まります（以前のリリースはそこに `# Project Name <!-- Replace with your project name -->` を出荷していました）。変更が見出しの位置に書かれた 1 行だけの場合、更新はその行を保って残りを更新し、競合にはなりません。それ以外の変更は上記のとおり競合します。プロジェクトの名前、メモ、ルールは、どのツールも読む `aidlc/spaces/<space>/memory/project.md` に置いてください。

新しいリリースがもう出荷しない、変更されていないフレームワークのファイルは削除され、config はそれぞれを示します。更新は `Removed N files that are no longer part of AI-DLC <version>:` とその一覧を表示し、`--dry-run` は同じ一覧を `Will remove` として表示します。1 つのフォルダの複数のファイルは 1 行で表示されます。削除したファイルをすべて git が追跡している場合、config は 1 つを取り戻すための `git restore <path>` も示します。後の更新は、取り戻したファイルに触れません。JSON ではこれらの操作は `detail: "no longer shipped"` を持ちます。

`.claude/settings.json` はプロジェクトのものです。AI-DLC はファイル全体を所有するのではなく、エントリを提供します。プロバイダー、スコープ、モデルの回答に伴うものを含め、リリースの更新はそれらのエントリを所有の競合なしにマージし、`--force` でもこれは変わりません。

Claude では、更新は AI-DLC のフックの登録を同梱のイベント、マッチャー、コマンドに戻し、その後にあなた自身のフックのグループを追加します。同梱の `permissions.allow` のエントリを先頭に置き、あなたの追加の許可のエントリ、`deny`、`ask`、その他の権限のキーを保ちます。廃止された同梱の許可のエントリは自動では削除されません。チームがそこに設定したステータスラインは保たれます。AI-DLC 自身の `statusLine` はもうこのファイルでは出荷されません。更新はそれを取り除き、それを持っていた各クローンは、その人自身の `.claude/settings.local.json` にそれを保ちます（その人自身のステータスラインを覆う場合は 1 回伝えます）。それ以外では、誰かが `--statusline on` で有効にしたときだけ現れます。`companyAnnouncements` は、存在しないか、まだ同梱の基準と一致している場合に更新され、そうでなければあなたの値が保たれます。同梱のものを取り込むには、どちらの独自のキーも削除して更新してください。環境変数とその他のトップレベルの設定（`disableAllHooks` を含む）は、記録されたプロバイダーやプロジェクトの回答に帰属する値を除き、あなたのもののままです。

`.codex/config.toml` もプロジェクトのものです。AI-DLC はその設定をキーごとに提供します。`developer_instructions`、`sandbox_mode`、`suppress_unstable_features_warning`、`tool_output_token_limit`、そして `[shell_environment_policy]`、`[sandbox_workspace_write]`、`[agents]`、`[features]`、`[tools]` の表で出荷するキーです。AI-DLC の `[tui]` の `status_line` はプロジェクトの選択（`--statusline on|off`）です。更新がそれを出荷したり、廃止したり、変えたりすることは決してありません。プロバイダー、スコープ、モデルの回答に伴うものを含め、更新はそれらのキーだけを変え、ほかのすべてのバイトを保ちます。あなた自身のキー（AI-DLC の表の中のものも）、あなた自身の表（`[agents.<role>]` や `[mcp_servers.<name>]` など）、コメント、順序、表記です。誰も変えていない AI-DLC の値はリリースの値を取り、あなたが変えた値はあなたのもののままで、リリースが別の値を出荷する場合は注記が出ます（それを取り込むにはキーを削除して更新します）。削除された AI-DLC のキーは、注記とともに戻ります。以前のリリースが出荷した `AIDLC_RULES_DIR` の値は、切り替えがどのスペースに残していたものでも空にされ、その表の中のあなた自身のキーは保たれます。そこにあるあなた自身のフォルダはあなたのもののままです。すでに独自の `.codex/config.toml` を持つプロジェクトは、最初のインストールでもそれを保ち、AI-DLC がその設定を追加します。更新が安全にマージできないファイル（解析できない、または AI-DLC の表の名前を別のもの、例えば表の配列に使っている）は引き続き競合を報告します。その場合 `--force` は、無関係なプロジェクト所有のフィールドを保ちながら AI-DLC の表を戻します。明示的な `--from` は、プロジェクトのコピーの代わりにそのソースを選びます。

人向けの出力は、`.claude/settings.json` や `.codex/config.toml` の AI-DLC のエントリを戻したり追加したりしたとき、そしてそのうちの 1 つについてのあなた自身の値（独自の Claude のアナウンス、または Codex のキー）を、このリリースが別の値を出荷しているのに保ったときに `Note:` を表示します。JSON の出力は同じメッセージを `data.notes` で公開します。それらを戻すには、引数なしの対話的なセットアップではなく、`aidlc config --harness claude` や `aidlc config --harness codex` を使ってください。コピーのチャネルのプロジェクトでは、`--from <the runtime/<harness> root you copied from>` も渡します。

`opencode.json` はチームのものです。config はそれに AI-DLC のエントリを追加し、ほかのすべてのキー、値、コメント、行を保ちます。プロバイダーの回答は、AI-DLC が書いたエントリだけを編集します。

<a id="root-integrations-and-ownership"></a>

### ルート統合と所有

| 面 | ハーネス | 方針 |
|---------|-----------|--------|
| `.gitignore` | すべて | インストールされたハーネスの同梱のエントリの和集合を含む、印付きの AI-DLC のブロックを 1 つ所有する。その外のすべてのバイトを保つ |
| `.mcp.json` / `mcpServers` | Claude | 同意され、基準が所有するエントリだけを追加または削除する。利用者のキーと上書きを保つ |
| `.kiro/settings/mcp.json` / `mcpServers` | Kiro CLI | `.mcp.json` と同じくサーバーごとに扱う。あなたが変えていない AI-DLC のサーバーだけリリースに追従する。あなたが追加したサーバーと、あなたが有効にした同梱のサーバーは保つ。セットアップの時点でプロジェクトがすでに持っていたファイルは拒否せずにマージする |
| `AGENTS.md` | Kiro CLI、Kiro IDE、Codex、Cursor、OpenCode、Copilot | 印付きのブロックを 1 つ。ハーネスに依存せず共有される（`shared: "identical"`）。例外は Copilot で、そのブロックは `@` の import を持つ。プロジェクトの指示を保つ |
| `opencode.json` | OpenCode | `json-entries`: AI-DLC のエントリ（`$schema`、その `skills.paths` と `instructions` の文字列、その `permission` のルール）を存在しない場合にだけ追加し、チーム自身のコマンドについてのルール（`rm -r...` と `git push` の前の確認）は対応表の先頭に追加して、その後のチームのルールが引き続き決めるようにする。チームのモデル、プロバイダー、独自の指示とルール、コメント、レイアウトを保つ。AI-DLC が書いたものを記録し、まだその値を持つエントリだけを追従または廃止する。以前のリリースで AI-DLC がまるごと書いたファイルは取り込む。コピーのランタイムはこのファイルを含めない。そのセットアップ（またはセットアップが一度も実行されなかった場合は最初のセッション）が AI-DLC の部分を追加する |
| `.vscode/settings.json` | Copilot | `jsonc-settings`: プロジェクトが設定していない場合にだけ `chat.agent.maxRequests`（200）を追加する。ほかの人が設定した値、ほかのキー、コメントは決して変えない。AI-DLC が追加したものだけを記録し、廃止するときは AI-DLC が書いた値を持っている間だけ削除する。一度追加した後、チームが保持しているファイルからそのキーを取り除いた場合は、再び追加しない。コピーのランタイムはこのファイルを含めない |

**プロジェクトに複数のハーネスを置く。** エンジンのディレクトリが異なり、専有の管理ブロックを共有しない場合、ハーネスは共存できます。`AGENTS.md` は、Kiro CLI、Kiro IDE、Codex、Cursor、OpenCode の間で中立かつバイト単位で同一（`shared: "identical"`）なので、それらのうちエンジンのディレクトリが異なるものは共存できます。Codex のハーネス固有のオンボーディングは、プロジェクトが信頼されている場合、プロジェクトの `.codex/config.toml` の `developer_instructions` を通じて注入され、`.codex/onboarding.md` がその読めるコピーです。
Claude Code はどのハーネスとも共存できます。Copilot の `AGENTS.md` は専有のままです。そのブロックを出荷する別のハーネスと組み合わせると、どちらを先にインストールしたかにかかわらず `cannot coexist in one project` で拒否されます。
Kiro CLI と Kiro IDE は引き続き `.kiro/` を共有し、OpenCode と Copilot は `.aidlc/` を共有するため、それらの組は共存できません。Kiro CLI と Kiro IDE は代わりに互いを置き換えられます。どちらか一方を持つプロジェクトで、`aidlc config --harness kiro-ide`（または `--harness kiro`）は `.kiro/` をその場でもう一方に切り替えます。この切り替えは、インストール済みの行の所有の基準から計画される更新です。その行だけが出荷したファイルを削除し、`aidlc/` を保ち、置き換えまたは削除することになるローカルで変更されたファイルを競合として報告し、ほかの更新と同じく、作業が開いている間でも実行されます。
`kiro-ide` への切り替えは、AI-DLC が所有しないすべての `.kiro/hooks/*.json` ファイルを示します。Kiro はそれらを、切り替えが `.kiro/settings/cli.json` で固定する v3 エンジンと Kiro IDE で実行します。そのようなファイルがある場合、切り替えはそのファイルの集合そのものをあなたが承認した場合にだけ適用されます。端末でプロンプトに答えるか、`--dry-run` で切り替えを実行してファイルを確認し、その dry run が表示する `--plan-token` で適用してください。その確認の後にフックのファイルが追加、削除、改名、変更されると切り替えは止まります。切り替えがトランザクションのロックを取る前や、ファイルをコミットしている間に現れたものも含み、その場合は切り替えをロールバックします。`.kiro/hooks` がリンクやファイルの場合（その下の何かを読む前）、または AI-DLC が所有しないフックのエントリがリンクや通常ファイル以外のものの場合、切り替えはそれをたどらずに拒否します。切り替えにはその基準（`.kiro/tools/data/aidlc-manifest.json`）が必要です。それがなければ、先に `aidlc config --harness <installed>` でインストール済みの行を更新してください。AI-DLC がそこに出荷するファイルだけを一覧するようになる前に記録された基準も同様で、更新がそれを最新にします。切り替えが壊れたものを変えることは決してありません。自分で脇へ移し（表示される手順がその完全なパスを示します）、それからその更新を実行してください。信頼の確認をクリアする切り替えは、それを再び記録する `config trust --harness <row>` のコマンドを示します。`--harness` なしで `--from` で渡したリリースが行を切り替えることはありません。OpenCode と Copilot はこの方法では切り替えられません。ルートのブロックが共有されていない古いインストール済みのハーネスについては、`predates shared onboarding` のエラーが、先に `aidlc config --harness <name>` で更新することを提案します。これは古い兄弟のためのヒントで、更新すれば共存できるという約束ではありません。その後も拒否される場合、その兄弟のブロックは専有です。Copilot のブロックは更新後も専有のままです。
別のインストール済みのハーネスが `AGENTS.md` を共有している間は、それをもう共有と宣言しない更新元も拒否されます: `refusing to refresh <harness> from a release whose AGENTS.md is not shared`。ブロックを共有と宣言するリリースを使ってください。`--force` はこのガードを迂回できません。
別のリリースの兄弟が所有する共有の `AGENTS.md` のブロックは、後回しにした更新ではなく競合です。エラーは更新の順序を示します。選んだハーネスを兄弟と同じリリースから更新するか、先に兄弟を選んだリリースから更新してください。
Cursor の手動コピーのインストーラーは単一ハーネス用です（専用の `AIDLC CURSOR` のマーカーがあり、`aidlc config` の所有の基準がない）。複数のハーネスを持つプロジェクトでは、代わりに `aidlc config --harness cursor` で Cursor を追加しなければなりません。

`.gitignore` は `shared: "union"` を宣言するため、`aidlc config` はインストールされたすべてのハーネスの同梱のエントリを結合したブロックを 1 つ書きます。追加のエントリは `# <harness> harness` の下に現れます。
ハーネスを追加すると、その兄弟の同梱のブロックのコピーが使える場合、兄弟が所有する変更されていないブロックを結合します（`merge (combined with <harness>)`）。そのコピーのない古いインストールは、更新されるまで所有を保ちます。各ハーネスは、次の config の呼び出しで同じ結合したブロックのハッシュを記録します。
複数のハーネスがあると、すべての `aidlc config` の呼び出しに `--harness <name>` が必要になります。例外は、バイパスだけを記録またはクリアする場合です。

`aidlc doctor` は、各ハーネスのツリーが `tools/data/aidlc-stamp.json` に記録するリリースを比べます。異なる場合は `Harness trees on different releases` と警告し、各ツリーのリリースを示し、ほかを揃えるコマンドを示します。固定されたプロジェクトのツリーは、config がすべてのツリーをピンに更新するのと同じく、ピンに揃えられます。コピーしたプロジェクトでは `bun <harness-dir>/tools/aidlc.ts config --harness <name> --download` です。ピンがない場合、ネイティブではエンジンのリリースにないツリーごとに `aidlc config --harness <name>` です。コピーしたプロジェクトでは各ツリーが自身のリリースで動くため、ほかは最も新しいツリーのリリースから、その `aidlc-copy-runtime-<version>.tar.gz` を `--from` で渡して更新します。どの config の実行も記録していないツリーは、先に自身のリリースで `--download` の更新を 1 回受けます。開いている作業は更新をまたいで続くため、それが終わるのを待つ必要はありません。

AI-DLC の `.gitignore` の行は、その独自のエントリだけです。以前のリリースは、汎用のテンプレート（ログ、`node_modules`、`dist`、エディターのファイル）もそのブロックの先頭に置いていました。アップグレード後の最初の更新は、それらの行をファイルのあなたの部分、AI-DLC の部分の上に残し、そのことを 1 回伝えます。そのため、それらが無視していたものが git に見えるようになることはありません。config が一度も実行されていないコピーも、最初のチャットが始まるとき、または作業が最初に作られるときに、コピー自身の `tools/data/root-blocks/` から同じ AI-DLC のブロックと `AGENTS.md` のブロックを受け取ります。config は後で、リリースが出荷したものと完全に一致するブロックを自分のものとして扱います。`opencode.json` の opencode のエントリも、同じタイミングで同じフォルダから届きます。

過去の同梱の投影にあった既知の印のないファイルと JSON のエントリは、記録された正確な SHA-256 の署名が一致する場合にだけ取り込まれます。それ以外の印のない内容は、AI-DLC について何が書かれていてもチームのものです。config はその内容を先頭部分として保ち、新しい管理ブロックを追記します。改名や削除は不要です。有効な UTF-8 でないルートのファイル（`.gitignore`、`AGENTS.md`、その他 AI-DLC がマージするファイル）はそのまま残され、config が安全にマージできるようになるには、エンコーディングの変換が必要です。

Git リポジトリの中では、config は `--dry-run` の間も含め、利用者所有のルールがコミットされたワークフローの記録を隠していないかも確認します。`aidlc/` のようなルールは隠してしまいます。config は完了しますが、新しい記録がチームメイトに届かないため、最後にルールのファイル、行、隠される記録のパス（`memory/**`、`codekb/**`、`intents.json`、`aidlc-state.md`、`audit/*.md`）を示す注記が付きます。git がすでに追跡しているファイルは引き続きコミットされます。初回のセットアップと `--quiet` の出力も同じ所見を示します。ルールはあなたのものなので、config がそれを書き換えたり拒否したりすることはありません。隠すことが意図したものでなければ、狭めてください。Git が使えない場合やプロジェクトが Git リポジトリでない場合、この確認は飛ばされます。

`/aidlc --doctor` は、未コミットの記録の確認の横でこの確認を繰り返します。config が成功した後に ignore ルールが追加された場合、その **Workspace record visibility** の advisory が同じルールと隠されたパスを示します。この警告は doctor の終了コードを変えず、隠された記録がない場合や Git がプロジェクトを確認できない場合は表示されません。

`--force` は、変更された、基準が所有する管理ブロックや、管理されたハーネスのファイルを置き換えられます。`opencode.json` のチーム自身のエントリを含む、利用者所有の JSON の値を上書きすることはできません。不正な JSON、不正または重複したマーカー、通常ファイルでない対象、完全性を証明できない廃止済みの所有内容は、強い競合です。

計画されたすべてのパスは、1 つの操作を受け取ります。

| 操作 | 意味 |
|--------|---------|
| `create` | 存在しないフレームワークのパスを追加する |
| `update` | フレームワーク所有のバイト列を更新する |
| `merge` | 管理ブロック、JSON の対応表、JSON の配列を整合させる |
| `preserve` | 現在の、またはプロジェクト所有のバイト列を保つ |
| `remove` | 以前に基準が所有し、上流で廃止された内容を削除する |
| `conflict` | 所有や完全性を証明できないため拒否する |

config が成功すると、ホストごとの次の手順を表示します。

| ハーネス | 次の手順 |
|---------|-----------|
| Claude Code | このプロジェクトで Claude Code を開き（すでにこのフォルダで開いている場合は終了してから再び起動し）、`/aidlc --doctor` を実行する |
| Kiro CLI | `kiro-cli chat` を実行し、次に `/aidlc --doctor` を実行する |
| Kiro IDE | Kiro IDE でこのプロジェクトを開く。ウィンドウの上部に Restricted Mode のバナーが表示されていて、このフォルダの内容を知っている場合は、そこで Manage、次に Trust を選ぶ。コマンドパレット（Ctrl+Shift+P、macOS では Cmd+Shift+P）から `Developer: Reload Window` を実行し、チャットパネルのエージェントピッカーで aidlc エージェントを選び、`/aidlc --doctor` を実行する（Kiro CLI では、代わりにプロジェクトで `kiro-cli` を起動して `/aidlc --doctor` を実行する） |
| Codex CLI | `codex` を実行し（フックについて尋ねられたら Trust all and continue を選ぶ）、次に `$aidlc --doctor` を実行する |
| OpenCode | `opencode` を実行し、次に `/aidlc --doctor` を実行する |

<a id="update-and-version-selection"></a>

## 更新と版の選択

| コマンド | 公開のオプションと動き |
|---------|-----------------------------|
| `aidlc update` | マシンのチャネルの最新のリリースを、すべてのハーネスの完全なランタイムとともにインストールし、原子的に有効にする。`--version <version>`、`--channel <stable\|preview>`、`--from <release-dir>`、`--release-base-url <url>`、`--release-api-url <url>`、`--ca-bundle <path>`、`--offline`、`--dry-run` を受け付ける。 |
| `aidlc update --check` | インストールせずに、チャネルの更新のメタデータを更新する。チャネルに実行中のものより新しいリリースがあれば 5、最新なら 0（チャネルの最新より新しいリリースを実行中なら最新とみなす）、利用できない／オフラインなら 3、確認が無効なら 1 を返す。 |
| `aidlc use <version>` | 保持されていなければ正確な安定版またはプレビュー版をインストールし、プロジェクトのファイルを変えずに、それをマシンのアクティブな版にする。 |
| `aidlc config --channel [stable\|preview]` | マシンのリリースのチャネルを設定する。値がなければそれを表示する。 |
| `aidlc config --pin <version>` | 必要なら正確な版をインストールして検証し、その後 `.aidlc-version` を原子的に書き、マシンローカルの解決先を記録し、マシンのアクティブなポインターを変えずにプロジェクトのピンを登録する。 |
| `aidlc config --unpin` | `.aidlc-version`、そのマシンローカルの解決先、そのレジストリのエントリを削除する。 |
| `aidlc config --statusline <on\|off>` | AI-DLC の進捗をステータスラインに表示するか、取り除き、そのことを 1 行で伝える。Claude Code: あなた自身の `.claude/settings.local.json`。Codex: プロジェクトの全員に効く共有の `.codex/config.toml`。両方がインストールされている場合は `--harness <claude\|codex>` で一方を選ぶ。 |
| `aidlc config ... --download` | このマシンにない場合、どの config のコマンドにも、プロジェクトが必要とするリリースを取得させる。固定されたリリース、なければそのファイルがすでに持っているリリース。ネイティブでは、`--pin` と同じくそのリリースをインストールして登録する。コピーしたプロジェクトでは `aidlc-copy-runtime-X.Y.Z.tar.gz` をダウンロードする。チェックサムと、`gh` がインストールされていればリリースの attestation を検証してから、コマンドを完了する。`--release-base-url` と `--ca-bundle` はミラーを選ぶ。端末では代わりに config が尋ねる。スクリプトにはフラグが必要。 |

人向けのライフサイクルの出力は、完了した事実をそれぞれ述べます。update は、旧から新への版の確認、検証済みのダウンロード、原子的な切り替え、保持した以前の版、刈り込んだ保護されていないリリース、プロジェクトの更新の案内を報告します。
何もしない場合は `You're on the latest version of aidlc (<version>).` と伝えます。`--dry-run` は `Would update aidlc from <old> to <new>.`、何も変わらない場合は `You're on the latest version of aidlc (<version>); nothing to update.` と伝えます。プレビューのチャネルでは、更新の行は `preview releases` と `latest preview version` と言います。素の `aidlc update` が、実行中のものより古いリリースをインストールすることは決してありません。安定版を追い、より新しいプレビューを実行しているマシンでは、何も変えずに `You're on <preview>, newer than the latest stable <x.y.z>, so there's nothing to update.` と伝え、続いて安定版に戻る方法（`aidlc update --channel stable`）とプレビューを受け取り続ける方法（`aidlc config --channel preview`）を示します。より新しい安定版が出荷されると、そちらに移ります。マシンが追うチャネルへの、もう一方のチャネルのリリースからの更新は `Switched release channel from <a> to <b>.` を追加します。1 回の実行だけもう一方のチャネルへ移る更新（`--channel`、`--version`、`--from`）は、マシンがそのチャネルを追っていることを、同じ 2 つの進め方とともに伝えます。`aidlc use` は `Now using` と `Already using` を区別し、uninstall はどのマシンの状態を削除または保持したかを正確に述べます。JSON と quiet のメッセージは、安定した機械向けの契約を保ちます。update の JSON は `channel` を持ち、切り替え時は `channelSwitch` も持ちます。

update は、アクティブなポインターを変える前に候補をダウンロードし、完全に検証します。失敗した更新は、以前の一貫したインストールを自動的に戻します。成功した更新は、以前のアクティブな版と登録されたすべてのプロジェクトのピンを保持し、その後、より古い保護されていない版を自動的に刈り込みます。別個のロールバックや、保持した版を管理するコマンドはありません。戻るには [以前の版に戻す](#go-back-to-an-earlier-version) を参照してください。

<a id="go-back-to-an-earlier-version"></a>

## 以前の版に戻す

このマシンを以前のリリースに戻すには、`aidlc use <version>` を実行します。例えば `aidlc use 2.10.0` です。マシンがそのリリースを持っていなければダウンロードし、その後 `Now using aidlc 2.10.0 (was 2.11.0; retained locally, no project changes).` と伝えます。ピンのないすべてのプロジェクトは、これで 2.10.0 で動きます。プロジェクトのファイルも 2.10.0 にするには、そのプロジェクトで `aidlc config` を実行してください。`aidlc use 2.11.0` で再び先へ進みます。

1 つのプロジェクトを、そこで作業する全員について戻すには、ピンを付けてから更新します。

```bash
aidlc config --pin 2.10.0 --yes
aidlc config --yes
git add .aidlc-version
```

ピンはプロジェクトを 2.10.0 に切り替え、更新はそのファイルをそのリリースにして、2.10.0 が出荷しないファイルを一覧します。`aidlc config --unpin` で、プロジェクトは再びマシンに従います（[プロジェクトのピンと CI](#project-pins-and-ci)）。

2.8.0 より前のリリースにはネイティブのリリースがないため、`aidlc use` と `aidlc config --pin` はそれを選べず、`No published native release is available yet` で止まります。コピーしたプロジェクトは、以前のリリースの `aidlc-copy-runtime-X.Y.Z.tar.gz`（2.9.0 から公開）で戻ります。[更新の安全](#refresh-safety) に示すとおりです。

<a id="release-channels"></a>

## リリースチャネル

`main` は共有の開発ブランチです。**stable** チャネルは、選んだコミットを `vX.Y.Z` のタグ付きの GitHub リリースとして公開します。**preview** チャネルでは、次の安定版の前に `main` の変更を試せます。これは「latest」と印が付くことのない GitHub のプレリリースです。ソースの版と changelog のエントリは、リリースの準備の間に更新されます。

予定実行と手動の実行は、直列化した 1 つの公開のキューを共有します。最新の公開済みプレビューからソースが変わっていない場合、またはより新しいプレビューがすでにそれを含んでいる場合（再試行やキュー待ちの古い実行）、その実行は公開を飛ばします。その確認と夜間のテストは引き続き実行され、プレビューは公開されません。同じ UTC の日付に `main` が複数回進んだ場合、変更のあった各ソースは、次のビルドのカウンターで新しいプレビューを公開できます。

夜間のテストが失敗しても、プレビューは公開されます。その場合、リリースノートは警告で始まり、Full Suite の失敗の報告（失敗したジョブと失敗したテスト）で終わります。プレビューに頼る前に確認してください。

プレビューの id は `<x.y.(z+1)>-preview.<YYYYMMDD>.<N>` です。ソースツリーの現在の安定版の次の patch、計画の間に選んだ UTC のビルドの日付、再試行のカウンター（最初は `1`）です。ワークフローは、ソースの版を編集せずにプレビューの版を計算します。失敗した試行が残したドラフトとタグは id を予約します。同じ日付の再試行や別の変更のあったソースは、それらの使用済みの id を越えて `N` を進めます。

安定版の id は正確に `x.y.z` のままで、版が出てくるどこでも（インストーラーのフラグ、`use`、ピン、`.aidlc-version`、保持した版のディレクトリ）ほかのものは受け付けません。id は `x.y.z` で数値順に並びます。ベースが同じ場合、安定版のリリースはそこから作ったどのプレビューよりも上に並び、プレビューはビルドの日付、次にカウンターで並びます。プレビューの成果物の中では、`aidlc version`、`version.json`、doctor のバンドルはどれもプレビューの id を報告します。ソースツリーが変更されることはありません。

```bash
aidlc config --channel preview   # follow the preview stream
aidlc update                     # newest published preview
aidlc update --check             # 5 when a newer preview exists
aidlc config --channel stable    # back to the stable stream
aidlc update --channel stable    # newest stable now, reported as a channel switch
```

チャネルはマシンローカルです。`aidlc config --channel` は、インストールのルートの下の、更新のキャッシュと `pins.json` の横に `channel` のマーカーを書きます（マーカーがなければ `stable`）。`aidlc uninstall` はそれをほかのマシンの設定とともに保持し、`--purge` は削除します。`aidlc update --channel <c>` は 1 回の実行についてマーカーを上書きします。`--version` と `--from` は、チャネルにかかわらず正確なリリースを選びます。安定版の発見は変わりません（`latest/download` のリダイレクト）。プレビューの発見は、リリースのベース URL の背後にあるリポジトリのリリースを GitHub API で一覧し、プレビューの版の id で最新の公開済みプレリリースを残し、正確な版の経路でそれをインストールします。公開されたリリースのないドラフトとタグは無視されます。
`github.com` のベース URL では API のエンドポイントを導きます。ほかのホストでは `--release-api-url <url>` か `AIDLC_RELEASE_API_URL` を設定してください。
API の失敗、レート制限、公開されたプレビューのないリポジトリは、利用できない（exit 3）と報告されます。クライアントが安定版のリリースにフォールバックすることはありません。更新のキャッシュは更新したチャネルを記録するため、キャッシュしたプレビューの結果が安定版の確認に答えることも、その逆もありません。

戻すには `aidlc config --channel stable` です。その後、素の `aidlc update` は、実行中のプレビューより新しい安定版のリリースを待ちます。いますぐ戻すには `aidlc update --channel stable` を実行します。これは id がプレビューより下に並ぶ場合でも最新の安定版をインストールし、チャネルの切り替えを報告します。プレビューの保持は、すべてのリリースが持つ保護（アクティブ、ロールバック、使用中、固定）に加えた有限の範囲です。更新の後、完全な最新のプレビュー 2 つが残り、独自の保護を持たないそれより古いプレビューはすべて刈り込まれます。安定版の保持は変わりません。

版の刈り込みも、記録されたファイルの一覧と空のディレクトリの後片付けを使います。選んだ版に所有されていない、または変更されたパスがある場合、刈り込みは拒否され、ファイルは確認のために残されます。

プロジェクトのピンは、引き続きマシンのチャネルより優先します。`aidlc config --pin <id>` と `.aidlc-version` はプレビューの id を受け付け、固定されたプロジェクトは、マシンが何を追っていても、その正確な保持された版へディスパッチします。

プレビューは、プロジェクトの状態のスキーマの変更を含め、その時点の `main` です。状態のスキーマを上げるプレビューは、安定版のビルドが理解しないプロジェクトの状態を書き、コードはビルドより新しい状態を開くことを拒否します。安定版のリリースが同じスキーマを出荷するまで、そのプロジェクトを安定版に戻すことはできません。プレビューのチャネルは、作り直せるプロジェクトで使うか、プロジェクトを固定してください。

<a id="project-pins-and-ci"></a>

## プロジェクトのピンと CI

```bash
aidlc config --pin 2.10.0
git add .aidlc-version
```

`aidlc config --pin <version>` は、必要ならその版をインストールして検証し、`.aidlc-version` を書き、gitignore された `aidlc/.aidlc-sessions/` のランタイムのディレクトリの下にバイナリの絶対パスの対象を記録し、マシンローカルの `pins.json` に実際のプロジェクトのパスを登録します。
レジストリの読取りは、ファイルシステムの別名（macOS の `/var` と `/private/var` を含む）を正規化し、JSON の出力は正規化したプロジェクトのパスを報告します。同じ版の同等なキーは 1 つにまとまります。矛盾する同等のものは、`config --pin` か `config --unpin` がそのプロジェクトのすべての別名を整合させるまで、安全側に失敗します。

コミットするのは `.aidlc-version` だけです。安定した `aidlc` のランチャーは、完全性を確認したアクティブなバイナリを起動し、そのディスパッチャーが、固定された完全なバイナリとランタイムを選ぶ前に検証します。存在しない、不正な、改ざんされた、または利用できない対象は、`aidlc config --pin <version>` の対処とともに安全側に失敗し、`aidlc doctor` も同じ状態を報告します。マシンのライフサイクルのコマンドはアクティブなバイナリを使います。`doctor`、`config`、`use` が壊れたピンの背後に閉じ込められることはありません。チームメイトがこのマシンにないリリースへのピンをコミットした場合、プロジェクトでの config のコマンドがそれを示し、`--download`（または端末での yes）が、`config --pin` と同じくそれをインストールして登録してから、コマンドを完了します。
インストール済みの固定のリリースは尋ねずに使われ、それに遅れているファイルは先に更新されます。

ピンはプロジェクトを担うエンジンをすぐに切り替えますが、プロジェクト自身のファイルは、次の `aidlc config` まで最後に更新した版のままです。`config --pin` と `config --unpin` は、作業が開いている間も含め、頼まれたとおりに実行されます。プロジェクトのファイルが、いま追っている版とは別の版にある場合（または版が記録される前のリリースにある場合）、返答は「Run `aidlc config` to finish updating this project.」で終わります。

新しいクローンや CI のランナーは、config の前にコミットされた版をインストールします。

```bash
version=$(cat .aidlc-version)
tag="v$version"
tmp="$(mktemp -d)"
gh release download "$tag" --repo github.com/awslabs/aidlc-workflows --dir "$tmp" \
  --pattern install.sh --pattern aidlc-release.intoto.jsonl
gh attestation verify "$tmp/install.sh" \
  --bundle "$tmp/aidlc-release.intoto.jsonl" \
  --repo awslabs/aidlc-workflows \
  --signer-workflow awslabs/aidlc-workflows/.github/workflows/release.yml \
  --hostname github.com \
  --source-ref "refs/tags/$tag"
sh "$tmp/install.sh" --version "$version" --quiet --yes
rm -rf "$tmp"
aidlc config --pin "$version" --project-dir "$PWD" --quiet
aidlc config --project-dir "$PWD" --harness claude --mcp none --quiet
aidlc doctor --project-dir "$PWD" --quiet
```

root で動き、root が唯一の利用者である CI のコンテナジョブやエージェントのサンドボックスでは、インストーラーの行に `--allow-root` を加えます。固定する版は `--allow-root` を出荷するリリースでなければなりません。このレシピはそのタグ自身の `install.sh` を実行し、古いものはそのフラグを未知の引数として拒否します。

```bash
sh "$tmp/install.sh" --version "$version" --quiet --yes --allow-root
```

<a id="harness-selection"></a>

## ハーネスの選択

ハーネスの選択は `aidlc config --harness <name>` の役割です。マシン単位のハーネスの管理は公開のコマンドではありません。

<a id="offline-packages"></a>

## オフラインパッケージ

リリースの成果物の集合がオフラインパッケージです。バイナリ、ランタイム、インストーラー、`version.json`、`checksums.txt` と並んで `aidlc-release.intoto.jsonl` を含みます。接続されたマシンで完全なリリースを 1 つダウンロードし、そのディレクトリを変えずに移してください。バンドルがないか、`checksums.txt` を認証できない場合、ローカルのインストールは安全側に失敗します。

```bash
gh release download v2.5.45 --repo github.com/awslabs/aidlc-workflows --dir ./aidlc-offline
```

接続されていないマシンでインストールします。

```bash
bash ./aidlc-offline/install.sh \
  --from ./aidlc-offline --offline
```

```powershell
& .\aidlc-offline\install.ps1 `
  -From .\aidlc-offline -Offline
```

ネイティブのコマンドでは、`--offline`、`AIDLC_OFFLINE=1`、またはグローバルの `offline=true` が、リリースのソケットを防ぎます。その場合、`--from` のないネットワークの操作は、変更の前に失敗します。config、doctor、version、uninstall は、いずれにしてもローカルです。

<a id="mirrors-proxies-cas-and-update-settings"></a>

## ミラー、プロキシ、CA、更新設定

リリースの設定は、明示的なオプション、環境、マシンの設定、既定値の順に解決します。

| 設定 | 環境 | マシンの設定 |
|---------|-------------|----------------|
| オフライン | `AIDLC_OFFLINE=1`（`0` はネットワークを明示的に有効にする） | `aidlc system config global set offline on` |
| ミラー | `AIDLC_RELEASE_BASE_URL` | `aidlc system config global set release-base-url <url>` |
| プレビューのリリースの API | `AIDLC_RELEASE_API_URL`（または `aidlc update --release-api-url <url>`） | `github.com` ではミラーから導く。マシンの設定のキーではない |
| CA バンドル | `AIDLC_CA_BUNDLE` | `aidlc system config global set ca-bundle <absolute-path>` |

マシンの 4 つのキーを管理します。

```bash
aidlc system config global list
aidlc system config global get update-check
aidlc system config global set update-check off
aidlc system config global set offline on
aidlc system config global set release-base-url https://mirror.example/releases
aidlc system config global set ca-bundle /absolute/path/corporate-ca.pem
aidlc system config global clear ca-bundle
```

キーは `update-check`、`offline`、`release-base-url`、`ca-bundle` です。
真偽値は `true|false`、`on|off`、`1|0`、`yes|no` を受け付けます。
`aidlc config <get|set|clear|list> ... --global` は同等です。

ミラーのベース URL は、ローカルのテスト用のループバックの HTTP を除き、HTTPS を使わなければならず、認証情報、クエリ、フラグメントを含められません。ネイティブのライフサイクルのクライアントは、最大 5 回までリダイレクトをたどります。リダイレクト先の URL はクエリを含められますが、引き続き認証情報やフラグメントは含められません。そのエラーは、URL の認証情報、クエリ、フラグメントを伏せます。

ネイティブのリリースのクライアントは `HTTPS_PROXY` / `https_proxy` と `NO_PROXY` / `no_proxy` に従います。プロキシの URL は HTTP か HTTPS を使わなければなりません。`HTTP_PROXY` は読みません。ブートストラップのスクリプトは、プロキシの振る舞いを `curl`、`wget`、`Invoke-WebRequest` に任せます。Windows では、独自の CA バンドルには `curl.exe` が必要です。

引数なしのヘルプと管理用の一覧は、決してネットワークを更新しません。有効なキャッシュ済みの更新の通知を表示することはあります。人が使う対話的な `aidlc doctor` と、端末の有無にかかわらず `aidlc doctor --export` は、古いまたは存在しないメタデータを 750 ms 以内に更新することがあります。それ以外の TTY でない実行、`--json`、`--quiet` の doctor は、`--check-updates` を明示しない限りキャッシュだけを使います。24 時間より前の確認から読んだ doctor の更新の行は、その版を既知の最新版として示し、どれくらい前に確認したかを伝えます。
`doctor --check-updates` と `update --check` は、メタデータに 5 分の安全上限を使います。プレビューの発見とメタデータのダウンロードは同じ期限を共有し、プレビューのリリースを探してもタイムアウトはやり直しになりません。
更新の確認は 84 文字以内の版の識別子を受け付け、各数値の成分は安全な整数（9,007,199,254,740,991 以下）でなければなりません。リリースのメタデータや既存のキャッシュにある不正な識別子は、通知を表示する前に拒否されます。
キャッシュは 24 時間で期限切れになります。失敗した更新や、同じチャネルでインストール済みのバイナリより古いメタデータは、有効なキャッシュを置き換えません。
成功した更新は、以前にキャッシュされた未来の版を訂正できます。キャッシュは助言にすぎず、信頼できる最小の版を確立するものではありません。
`update-check=off` は明示的な更新も無効にしますが、明示的な `aidlc update` は妨げません。
更新の確認（doctor の更新と `aidlc update --check`）は、`version.json` と `checksums.txt` をダウンロードし、マニフェストのチェックサムを検証しますが、`aidlc-release.intoto.jsonl` のダウンロードも検証もしません。これは与えられたチェックサムに対する完全性を確認するもので、リリースの出所を認証するものではありません。
すべてのインストールの経路（`aidlc update`、`aidlc use`、`aidlc config --pin`、`--from`）は来歴のバンドルを必要とし、有効にする前にチェックサムを検証します。対応する GitHub CLI がある場合、インストールは署名付きの来歴も検証し、検証の失敗を拒否します。

<a id="plugins"></a>

## プラグイン

AI-DLC 自身のプラグイン（test-pro とそれに続くもの）は 1 つの `aidlc-plugins` カタログを共有し、ネイティブのインストールはそれをリリースをまたいで 1 つのパスに保ちます。Linux と macOS では `${XDG_DATA_HOME:-$HOME/.local/share}/aidlc/plugins/`、Windows では `%LOCALAPPDATA%\aidlc\plugins\` です。インストーラーはインストール後にその完全なパスを表示し、`aidlc doctor --verbose` は Machine の下にそれを示します。ツールに 1 回追加してください。

```bash
/plugin marketplace add <path>          # Claude Code
codex plugin marketplace add <path>     # Codex CLI
```

インストール、`aidlc update`、`aidlc use <version>`、`aidlc rollback` は、アクティブにするリリースからカタログを更新します。まるごと書いてから入れ替えるため、ツールがその半分だけを読むことはありません。更新の後、ツール自身のマーケットプレイスの更新（Claude Code では `/plugin marketplace update aidlc-plugins`）が、同じパスから新しいプラグインの版を読みます。フォルダを置き換えられない場合も、コマンドは成功し、フォルダは以前のカタログを保ち、理由と対処を 1 行で伝えます。Windows で、プログラムがその中のファイルを保持しているかもしれない場合は、Claude Code と Codex を閉じて `aidlc use <version>` を実行してください。ディスクの空き不足のようなほかの原因では、それを直してから実行してください。あなたが自分でフォルダに置いたファイルが置き換えられることは決してなく、その行がそれを示します。以前のリリースの `aidlc update` でこのリリースへ更新したマシンは、次の `aidlc use <version>` か更新でフォルダを受け取ります。ソースのチェックアウトの `dist/plugins/` と、コピーのランタイムの `plugins/` は、コピーのチャネルにとって同じカタログです。

`aidlc doctor` は、インストール済みと compose 済みのプラグインの状態を報告します。プラグインの変更はプロジェクトの設定で、`aidlc config` を通じて収束します。別の公開のプラグインのコマンドはありません。

<a id="output-automation-and-exit-codes"></a>

## 出力、自動化、終了コード

公開のコマンドは、経路のレジストリが宣言する場合、人向け、`--quiet`、`--json` の出力に対応します。`--json` は、`ok`、`code`、`status`、`message`、そしてある場合はコマンド固有の `data` を持つ、スキーマの版付きの結果を出します。`--quiet` は成功の行か対処の行を 1 行出します。ダウンロードの進捗は人向けのモードにだけ表示されます。

ネイティブの診断の形式は `aidlc doctor [--project-dir <path>] [--verbose] [--json|--quiet] [--check-updates] [--release-base-url <url>] [--ca-bundle <path>] [--offline]` です。`--export` はマスキングした診断のバンドルを書き、`--output <directory>` がその既定のプロジェクトの場所を上書きします。export の出力は、選んだライブの報告のモードに追加されるものです。人向けの出力は、Machine、Project、Framework integrity の検査をまとめます。どの節も警告／失敗の行は表示したまま、健全な行は既定でまとめます。`--verbose` はすべての検査を展開します。警告は advisory で exit 0、失敗した検査があれば exit 1 です。

`--no-color` と `NO_COLOR` は ANSI の出力を止めます。`--project-dir <path>` は、シェルのディレクトリを変えずにプロジェクトの文脈を選びます。`uninstall` のような破壊的な操作は、TTY では何も尋ねず、削除するものと保つものを表示してから実行します。TTY がなければ `--yes` が必要です。`--yes` が、所有、完全性、アクティブなワークフロー、リリースの認証による拒否を迂回することは決してありません。ただし Windows では例外が 1 つあります。手作りの Git Bash の転送用ファイルのような、AI-DLC が書いたのではない bin ディレクトリの `aidlc` です。`aidlc use`、`aidlc update`、インストーラーは、端末で一度だけそれを置き換えるかを尋ねます。`--yes` は「はい」と答え、そのファイルは `aidlc.bak-<time>` として横に残されます。

| コード | 意味 |
|------|---------|
| 0 | 成功 |
| 1 | 運用上の失敗 |
| 2 | 使い方、またはマシンの設定が不正 |
| 3 | 必要なネットワークの結果、または保持されたランタイムが利用できない |
| 4 | 完全性または所有による拒否 |
| 5 | 確認が完了し、対応が必要。利用可能な更新など |

<a id="help-and-completions"></a>

## ヘルプと補完

`aidlc --help` は、ちょうど 6 つの公開のコマンドを表示します。各公開のコマンドには、副作用のないコマンドのヘルプもあります。`config`、`doctor`、`version`、`update`、`use`、`uninstall` について `aidlc <command> --help`（または `-h`）です。config の水準のヘルプは 6 つの方針の節をすべて示し、`aidlc config <section> --help` は節ごとのヘルプを保ちます。`aidlc help --all` は隠された `engine` と `system` の名前空間を表示し、その完全な一覧として `aidlc engine --help` / `aidlc system --help` を案内します。
インストーラーは、公開の経路のレジストリから生成した Bash、Zsh、Fish、PowerShell のファイルを、利用者単位の AI-DLC のデータのルートの `completions/` ディレクトリの下に置きます。補完を生成する公開の動詞はありません。

<a id="transactions-and-recovery"></a>

## トランザクションと復旧

プロジェクトとマシンの変更は、行き先のファイルシステムでステージし、候補を検証し、改名の境界を通じてコミットします。ファイルシステムは引き続き、一貫したファイルの同一性と追記の振る舞い、原子的なファイルの置き換えとディレクトリの改名、排他的な作成、意味のある通常ファイルの `fsync` に責任を持ちます。AI-DLC は改名のためのコピーと削除のフォールバックを追加しません。計画した状態に対して検出した並行の変更は、新しいバイト列を上書きせずに中止します。放棄された所有者専用のステージは、ロックと所有の確認の後にだけ掃除します。
ディレクトリの `fsync` に対応していないことは許容されるため、コマンドが成功しただけでは、クラッシュ後のメタデータの耐久性を約束できません。

トランザクションのロックはハードリンクを優先し、自動的に所有者のスタンプ付きのディレクトリにフォールバックします。どちらも `.aidlc-transaction.lock` を占め、生きている旧来のファイルの所有者との排他を保ちます。ローカルの一時ディレクトリにある専用の所有者のスタンプ付きのゲートが、トランザクションと所有の変更を直列化します。
これが対応するのは、同じ正規化したプロジェクトのパス、ローカルの一時ディレクトリ（Unix では `TMPDIR`）、PID の名前空間を共有する、**1 つのホストで連続して動作する 1 つのマウント** 上の協調するプロセスだけです。同じバケットにアクセスしていても、ホストや独立したマウントをまたいだ分散ロックではありません。

初回の探査は早めの機能の確認です。ディレクトリのロックによるトランザクションも、変更を適用する前に探査します。どちらも検証や実際のロックの取得の代わりにはならず、呼び出しが成功しても原子的な改名やクラッシュへの耐久性は証明できません。
互換性はドライバーとその実際の意味論によります。

| ストレージ | 互換性の境界 |
| --- | --- |
| EC2 の EBS ボリュームを含む、ローカルの ext4 や XFS | 必要なファイルシステムの操作に適したプロジェクトのストレージ。 |
| ハードリンクのない POSIX 風のマウント | 残りの要件がすべて満たされれば、上の単一のマウントの範囲内で、config とトランザクションはディレクトリのロックで動作できる。 |
| Mountpoint for Amazon S3 | ディレクトリの改名と一般的な可変ファイルの更新が使えないため、完全なワークフローは引き続き互換性がない。S3 Express の単一ファイルの改名でもそれらの制限は取り除かれない。[Mountpoint filesystem semantics](https://github.com/awslabs/mountpoint-s3/blob/5e400f788f8cbca028f3314d84ef2df2c7fcf536/doc/SEMANTICS.md) を参照。 |
| s3fs-fuse | 改名はコピーしてから削除する方式で、原子的ではない。探査が合格しても、クラッシュに安全な一般的な AI-DLC のトランザクションへの対応は確立されない。[s3fs limitations](https://github.com/s3fs-fuse/s3fs-fuse/blob/fc5778fe83b533a9beed9383f3ce99de76207ef9/README.md#L153-L163) を参照。 |

このフォールバックが取り除くのは、トランザクションのロックのハードリンクの要件です。別の操作は、生成ファイルを公開するときのワークスペースの同期を含め、引き続きハードリンクを必要とすることがあります。上流の意味論やシミュレーションした失敗は、特定の S3 のマウントの実地の検証ではありません。マウントがこれらの要件を満たせない場合は、互換性のあるローカル／EBS のプロジェクトのストレージを使ってください。[ファイルシステムのトラブルシュート](15-troubleshooting.md#config-fails-with-a-hard-link-error) を参照してください。
外部の、または不完全なロックの所有者については、手動の復旧の前に [トランザクションのロックの所有](15-troubleshooting.md#transaction-lock-ownership) に従ってください。

中断したコミットのロールバックを安全に完了できない場合、証拠はマシンのインストールのルートまたはプロジェクトのルートの下の、名前付きの `.aidlc-recovery-*` の隔離領域に保持されます。`aidlc doctor` がそれを報告します。必要なファイルを回収し、AI-DLC の変更が実行中でないことを確かめてから、一覧されたディレクトリだけを手で削除してください。自動のステージの後片付けが隔離領域を削除することは決してありません。

Windows のアンインストールは、実行中の実行ファイルが自分のコマンドのシムを削除できないため、復旧できる継続を使います。後のコマンドは、まだ実行中のものがない限り、ほかの作業の前に有効な保留中の継続を再開します。結果を記録せずに止まったワーカーは、最大 3 回まで再開されます。

後片付けが失敗すると、失敗したステップと理由を記録し、`aidlc doctor` が両方を報告します。失敗した後片付けがほかのコマンドによって再起動されることはなく、それらのコマンドは動き続けますが、アンインストールが完了するまでマシンの変更はブロックされたままです。報告された問題を解決し、`aidlc uninstall` を再び実行してください（元の実行で使った場合は `--purge` 付きで）。

- まだ何も削除されていなければ、失敗した計画は破棄され、アンインストールはディスク上のファイルから改めて計画します。そのため、確認の後に編集されたファイルは保たれます。
- 削除が始まっていた場合は、同じ計画が再開します。その後に編集されたファイルは保たれます。

`aidlc` コマンド自体（`aidlc.cmd`、そのシム、アクティブな版のポインター、アクティブな `aidlc.exe`）は、ほかのすべてのファイルと User PATH のエントリの後、最後に削除されます。そのため、後片付けが失敗しても再試行するためのコマンドが残ります。PATH のエントリがすでにないかもしれないため、`aidlc doctor` が表示する完全なパスでそのコマンドを実行してください（既定では `& "$env:LOCALAPPDATA\aidlc\bin\aidlc.cmd" uninstall`）。失敗がそれらの最後のファイルを削除している間に起き、コマンドがもう動かない場合は、インストーラーを再び実行してください。インストーラーは先に保留中の後片付けを再試行するため、2 回実行が必要なことがあります。

<a id="copy-channel"></a>

## コピー経路

対応する手動コピーの中身は、版付きの `aidlc-copy-runtime-X.Y.Z.tar.gz` のリリースの成果物です。正確なリリースを 1 つダウンロードして展開し、ハーネスのツリー、`aidlc/` ワークスペースのシェル、ハーネスが必要とするプロジェクトのルートのファイルが揃うよう、`runtime/<harness>/` のルート全体をコピーしてください。コピーのランタイムは、Copilot の `.vscode/settings.json` のような、チームのエディターが所有するファイルを含めないため、コピーでそれらが置き換えられることはありません。[Copilot ガイド](harnesses/copilot.md#vs-code-のリクエスト上限) が、自分で追加する 1 つの設定を示しています。`.gitignore` と `AGENTS.md` も含めません。AI-DLC は、すでにある内容の後に自分の行を追加するか、プロジェクトにそれらがなければ作成します。opencode の `opencode.json` も同じく含めません。コピーのセットアップが AI-DLC のエントリをあなたのファイルに追加し、ほかはすべて保つか、ファイルがなければ書きます。Claude Code の `.mcp.json` も含めないため、コピーは `aidlc config` の既定と同じく MCP のサーバーなしで始まります。同梱のサーバーを on にするには、`bun .claude/tools/aidlc.ts config project --harness claude --mcp defaults --yes` を実行してください。チームの memory のファイル（Practices Discovery が確認したプラクティスを記録する `aidlc/spaces/default/memory/team.md` と、プロジェクトのルールと学びが入る `project.md`）と、選んだスペース（`aidlc/active-space`）も含めません。そのため、新しいリリースや 2 つ目のハーネスをプロジェクトの上にコピーしても、それらは保たれます。新しいコピーでは、最初に作業を始めたときに、AI-DLC が同梱のコピーから 2 つの memory のファイルを作ります。前提となるランタイムは Bun で、ネイティブの `aidlc` 実行ファイルは不要です。Markdown の解析（要約確認、Plan Approval のタグ、claim-sources センサー）は Bun 組み込みの `Bun.markdown` の描画を使うため、Bun 1.3.8 以降が必要で、インストールされた Bun の描画に従います。

```bash
tag=vX.Y.Z
tmp="$(mktemp -d)"
runtime_asset="aidlc-copy-runtime-${tag#v}.tar.gz"
runtime_checksum="${runtime_asset}.sha256"
source_repo="${AIDLC_RELEASE_REPOSITORY:-awslabs/aidlc-workflows}"
release_workflow="${AIDLC_RELEASE_WORKFLOW:-$source_repo/.github/workflows/release.yml}"
gh release download "$tag" --repo "github.com/$source_repo" --dir "$tmp" \
  --pattern "$runtime_asset" \
  --pattern "$runtime_checksum" \
  --pattern aidlc-release.intoto.jsonl
gh attestation verify "$tmp/$runtime_asset" \
  --bundle "$tmp/aidlc-release.intoto.jsonl" \
  --repo "$source_repo" \
  --signer-workflow "$release_workflow" \
  --hostname github.com \
  --source-ref "refs/tags/$tag"
(cd "$tmp" && sha256sum -c "$runtime_checksum")
tar -xzf "$tmp/$runtime_asset" -C "$tmp"
RUNTIME_ROOT="$tmp/runtime"
cp -R "$RUNTIME_ROOT/claude/." your-project/
cd your-project && bun .claude/tools/aidlc.ts config --from "$RUNTIME_ROOT" --harness claude
```

最後の行はコピー自身のセットアップで、展開したランタイムから 1 回実行します。最初のチャットの前に AI-DLC の行を `.gitignore` と `AGENTS.md` に追加し、セットアップの残りを確認します。これを実行しなければ、AI-DLC は最初のチャットが始まるとき、遅くとも作業を始めるときにそれらを追加します。

その後、コピーしたプロジェクトは自分でリリースを取得します。config のコマンドがプロジェクトにないファイル（チームメイトの新しいピン、追加するハーネス、または復元したファイル）を必要とする場合、端末で尋ねるか、スクリプトでは `--download` を受け付けて、その正確な `aidlc-copy-runtime-X.Y.Z.tar.gz` をダウンロードし、その `.sha256` と、`gh` がインストールされていればリリースの attestation を検証し、コマンドを完了します。ネットワークアクセスがなければ、エラーの `offline:` の行が、別の場所で取得して `--from` で渡すファイルを示します。

更新（`--from` か `--download` を付けた `config`）がプロジェクト自身のツールより新しいリリースからファイルを取り込む場合、そのリリース自身の config が入力どおりにコマンドを実行し、`Note:` の行が、どのリリースのツールがそれを実行したかを示します。同じか古いリリースは、プロジェクト自身のツールが更新します。

このアーカイブは、`dist/` の下に新たに再生成した Bun の投影から組み立てられます。その生成されたフックとツールは、含まれている TypeScript を Bun で呼び出します。ネイティブのインストーラーとライフサイクルのコマンドは、代わりに `dist-release/` から組み立てた `aidlc-runtime-X.Y.Z.tar.gz` を使います。利用者が通常それを直接ダウンロードすることはありません。

コピーのアーカイブは、既存の 2.8.x のネイティブのクライアントが引き続きリリースのメタデータを解析して自己更新できるよう、`version.json` と `checksums.txt` の外に置かれます。版付きの `.sha256` のサイドカーがバイト列を直接認証し、リリースの来歴は両方のファイルを対象にします。

コピーのインストールでは、プロジェクト内の AI-DLC のファイルはあなたが実行するコードです。そのフックは Bun でそれらを実行し、GitHub Copilot 以外のすべてのハーネスでは、出荷する設定がエージェントによるそれらの呼び出しを事前承認します。各ハーネスのガイドが、その事前承認の振る舞いを説明しています。そのため、プロジェクトのフォルダを信頼することは、それらのファイルを信頼することを意味します。プロジェクトを変更できる人は誰でも、それらのフックと事前承認されたコマンドが実行するものを変えられます。

ネイティブの実行ファイルが許される場合は、`aidlc config` を優先してください。ネイティブのランタイムをトランザクションでインストールし、後の更新のために所有を記録します。

フレームワークの開発者は、代わりにソースをクローンし、依存関係をインストールし、無視されるローカルの出力を実体化できます。

```bash
bun install --frozen-lockfile
bun scripts/package.ts
```

これにより、Bun を呼び出す `dist/<harness>/`、ネイティブの `dist-release/<harness>/`、プラグインの投影がローカルに作られます。生成されたどちらのルートもコミットしません。直接の `bun .../tools/*.ts` の呼び出しは、ソース／開発とデバッグのための仕組みのままで、2 つ目のネイティブのライフサイクルのインターフェースではありません。

<a id="remove-ai-dlc-from-a-project"></a>

## プロジェクトから AI-DLC を取り除く

一つのプロジェクトから AI-DLC を取り除くコマンドはありません。`aidlc uninstall` はマシンのインストールを、このマシンのすべてのプロジェクトについて取り除き、プロジェクトのファイルには触れません。以下の手順は、プロジェクトを AI-DLC が加えられる前の状態に戻します。AI-DLC とフォルダやファイルを共有している、あなた自身のハーネスのファイルと設定（以前からあった `.kiro/`、あなた自身の `.claude/settings.json` のエントリ、`AGENTS.md` のあなたの部分）は保ちます。先に、そのプロジェクトで開いているハーネスを閉じてください。

<a id="1-keep-your-records"></a>

### 1. 記録を保つ

プロジェクトがピン留めされている（`.aidlc-version` ファイルがある）場合は、AI-DLC がまだインストールされている間に、先にピンを外してください。`aidlc config --unpin`、コピーしたプロジェクトでは `bun <harness folder>/tools/aidlc.ts config --unpin` です。これはマシンのピンの記録も消します。ファイルを削除するだけでは、それは消えません。

Claude Code では、AI-DLC がまだインストールされている間に、AI-DLC のステータスラインも off にしてください。`aidlc config --statusline off`、コピーしたプロジェクトでは `bun .claude/tools/aidlc.ts config --statusline off` です。AI-DLC のステータスラインがあなた自身のものを置き換えていた場合、あなたのものを元に戻すのはこの手順だけです。AI-DLC はそれを `aidlc.settings.local.json` に保持しており、そのファイルは下で削除するからです。

`aidlc/` にはあなたの作業が入っています。各インテントの状態、成果物、監査証跡、そしてスペースの memory と knowledge です。削除する前にアーカイブしてください。POSIX シェルでは次のとおりです。

```bash
tar -czf aidlc-records.tar.gz aidlc && rm -rf aidlc
```

PowerShell では次のとおりです（Windows 10 以降は `tar` を含みます）。

```powershell
tar -czf aidlc-records.tar.gz aidlc; if ($?) { Remove-Item -Recurse -Force aidlc }
```

次のものもあれば削除してください。`aidlc.settings.json`、`aidlc.settings.local.json`、そして config が `.git/info/exclude` に追加したかもしれない `aidlc.settings.local.json` の行です。

<a id="2-delete-ai-dlcs-own-files"></a>

### 2. AI-DLC 自身のファイルを削除する

`aidlc config` は、インストールしたものを `<harness folder>/tools/data/aidlc-manifest.json` に記録します。すべてのファイルとその SHA-256、そして自分の部分を追加した共有ファイルです。このスクリプトはその記録を読み、記録に載っているファイルのうち、内容がまだ一致するものだけを削除します。違いが改行コードだけのファイル（CRLF のチェックアウト）は、変更なしと数えます。あなたが変更したファイルは残して一覧に出し、記録に載っていないファイルは、AI-DLC が動作中に生成するいくつかを除いて決して削除せず、自分が空にしたフォルダだけを取り除きます。プロジェクトを含むフォルダに、プロジェクトのフォルダの中ではなくその隣に、`remove-aidlc.cjs` として保存してください。

```js
// Usage, from the project root: node <path to>/remove-aidlc.cjs <harness folder>   (Bun works too)
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const dir = process.argv[2];
const manifestPath = path.join(dir, "tools", "data", "aidlc-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.shippedOnly !== true) {
  console.log(`${manifestPath} predates the shipped-files-only record. Refresh it first with aidlc config --harness <harness>, then run this again.`);
  process.exit(1);
}
const sha = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
// A file whose only difference is its line endings (a CRLF checkout) is unchanged.
const unchanged = (file, hash) => {
  const bytes = fs.readFileSync(file);
  const lf = bytes.toString("latin1").replaceAll("\r\n", "\n");
  return [bytes, Buffer.from(lf, "latin1"), Buffer.from(lf.replaceAll("\n", "\r\n"), "latin1")].some((form) => sha(form) === hash);
};
const roots = manifest.rootContributions ?? {};
const shared = new Set([...Object.keys(manifest.entries ?? {}), ...Object.keys(roots)]);
const owned = Object.entries(manifest.files).filter(([file]) => !shared.has(file));
for (const [file, part] of Object.entries(roots)) if (part.policy === "whole-file") owned.push([file, part.hash]);
const removed = [];
for (const [file, hash] of owned) {
  if (!fs.existsSync(file)) continue;
  if (unchanged(file, hash)) { fs.rmSync(file); removed.push(file); }
  else console.log(`kept, changed since install: ${file}`);
}
// Files AI-DLC generates while it runs, which the record does not list.
for (const file of ["harness.json", "scope-grid.json", "stage-graph.json"].map((name) => path.join(dir, "tools", "data", name))
  .concat(path.join(dir, "steering", "aidlc-active-memory.md"), manifestPath)) {
  if (fs.existsSync(file)) { fs.rmSync(file); removed.push(file); }
}
// Remove only the folders this emptied, never one that holds anything else.
for (const file of removed) {
  for (let folder = path.dirname(file); folder !== "." && folder !== path.dirname(folder); folder = path.dirname(folder)) {
    try { fs.rmdirSync(folder); } catch { break; }
  }
}
for (const file of shared) if (fs.existsSync(file)) console.log(`edit by hand: ${file}`);
```

Node.js か Bun で、プロジェクトのルートから、プロジェクト内のハーネスのフォルダごとに一度実行します。同じコマンドが POSIX シェルでも PowerShell でも動きます。

| ハーネス | 実行 |
|---------|-----|
| Claude Code | `node ../remove-aidlc.cjs .claude` |
| Kiro CLI、Kiro IDE | `node ../remove-aidlc.cjs .kiro` |
| Codex CLI | `node ../remove-aidlc.cjs .codex` |
| Cursor | `node ../remove-aidlc.cjs .cursor` |
| OpenCode、GitHub Copilot | `node ../remove-aidlc.cjs .aidlc` |

スクリプトが、記録は shipped-files-only の記録より前のものだと伝えた場合は、以前のリリースがその記録を書いています。先に `aidlc config --harness <name>` で更新し（コピーしたプロジェクトでは `bun <harness folder>/tools/aidlc.ts config --harness <name>`）、それからスクリプトを再び実行してください。スクリプトが残したファイルはどれも見直してください。それはあなたが編集した AI-DLC のファイルなので、その編集をまだ残したい場合にだけ保ってください。

<a id="3-take-ai-dlcs-part-out-of-shared-files"></a>

### 3. 共有ファイルから AI-DLC の部分を取り除く

スクリプトは、まだ AI-DLC の部分を持っている共有ファイルをそれぞれ一覧に出します。AI-DLC が加えられる前のプロジェクトが git にあるなら、そのコミットからそれらを復元するのがいちばん早い方法です。たとえば `git checkout <commit> -- .gitignore AGENTS.md .claude/settings.json` です。これはその後にあなたがそれらに加えた変更も元に戻すので、コミットする前に `git diff --cached` を確認してください。そうでなければ、AI-DLC の部分を手で取り除きます。値を取り除くのは、それがまだ AI-DLC が書いたものを持っている場合だけにしてください。チームが変えた値はあなたのものなので、保ってください。

| ファイル | 取り除くもの |
|------|--------|
| `.gitignore` | `# BEGIN AI-DLC:gitignore` から `# END AI-DLC:gitignore` までの行と、その上の空行。複数のハーネスがこの一つのブロックを共有する。 |
| `AGENTS.md` | `<!-- BEGIN AI-DLC:agents -->` から `<!-- END AI-DLC:agents -->` までの行と、その上の空行。 |
| `.claude/settings.json` | `companyAnnouncements`（チームが独自に設定したものでない限り）。コマンドが `aidlc` を実行する `statusLine`。コマンドが `aidlc` を実行するすべてのフックグループ（`aidlc engine hook ...`、コピーしたプロジェクトでは `bun "$CLAUDE_PROJECT_DIR/.claude/tools/aidlc.ts" engine hook ...`）。`aidlc` を名指す `permissions.allow` のエントリと、自分で追加したのでない限り `Edit(/**)`、`Task`、`WebSearch`。`AIDLC_` か `AWS_AIDLC_` で始まる `env` のキーと、`aidlc config providers` で選んだプロバイダーのキー。 |
| `.claude/settings.local.json` | コマンドが `aidlc` を実行する `statusLine`。AI-DLC のステータスラインは、on にするとここに入る。手順 1 の `--statusline off` がそれを取り除く。 |
| `.mcp.json`（Claude Code）、`.kiro/settings/mcp.json`（Kiro CLI） | AI-DLC が出荷する MCP サーバー（`context7`、`aws-mcp`、`aws-pricing`、`aws-iac`、`aws-serverless`）。自分で設定したものは除く。Kiro CLI は既定でそれらを off の状態で受け取る。Claude Code は、`aidlc config` が端末で尋ねたときに yes と答えるか、`config project --mcp defaults` で on にしたときに受け取る。 |
| `.codex/config.toml` | `developer_instructions`、`sandbox_mode`、`suppress_unstable_features_warning`、`tool_output_token_limit`。`[shell_environment_policy]`（`AIDLC_RULES_DIR` を持つ `set`）、`[sandbox_workspace_write]`（`network_access`）、`[agents]`（`max_depth`）、`[features]`（`default_mode_request_user_input`）、`[tools]`（`experimental_request_user_input`）、`[tui]`（`status_line`）の中の AI-DLC のキー。それらの直上の `#` コメント。そして空になったそれらのテーブル。自分で設定したキーは、それらのテーブルの中のものも保つ。 |
| `opencode.json`（または `opencode.jsonc`） | あなたのものでない限り `$schema`。`skills.paths` の `.aidlc/skills`。`.aidlc/` と `aidlc/` の下の `instructions` のエントリ。そして AI-DLC の `permission` の規則。つまり `.aidlc/` を名指すもの、`bash` の下の `"aidlc engine *": "allow"`（ネイティブ導入）、`rm -r*` と `git push *` の前の確認、以前のリリースが `edit` と `bash` の下に追加した `"*"` の規則。ただし、同じ規則を自分で書いた場合は除く。 |
| `.vscode/settings.json`（Copilot） | `chat.agent.maxRequests`（`200`）と `chat.useHooks`（`true`）。自分で設定した場合は除く。 |

あなたのものが何も残っていないファイルは削除してください。AI-DLC が作ったものです。Cursor のルートの `install.ts` と、AI-DLC がプロジェクトのルートに書いたほかのファイル全体は、手順 2 のスクリプトが削除します。Codex は、プロジェクトのフックに対する信頼をプロジェクトの外、`$CODEX_HOME/config.toml`（既定では `~/.codex/config.toml`）に保持します。Codex にそれを忘れさせたい場合は、そこにあるプロジェクトのエントリを取り除いてください。

<a id="4-check"></a>

### 4. 確認する

`git status` には、AI-DLC のファイルが削除され、共有ファイルが以前の内容に戻ったことが表示されます。手順 3 の各共有ファイルを `AI-DLC` と `aidlc` で検索しても、AI-DLC のものは何も見つからないはずです。

```bash
grep -n "AI-DLC\|aidlc" .gitignore AGENTS.md
```

```powershell
Select-String -Path .gitignore, AGENTS.md -Pattern 'AI-DLC|aidlc'
```

`aidlc-copy-runtime-X.Y.Z.tar.gz` からコピーしたプロジェクトは、そのセットアップのコマンドを実行したときにマニフェストを受け取ります（[コピー経路](#copy-channel) を参照）。そのコマンドを一度も実行していなければ、マニフェストはありません。コピーした `runtime/<harness>/` フォルダとバイト単位で同一のファイルを削除し、それから手順 3 と 4 に従ってください。コピーは、プロジェクトがすでに持っていた同名のファイル（あなた自身の `.claude/settings.json` など）も置き換えます。それらは git かバックアップから復元してください。

<a id="uninstall"></a>

## アンインストール

`aidlc uninstall` はマシンのインストールを取り除きます。一つのプロジェクトから AI-DLC を取り除くには、[プロジェクトから AI-DLC を取り除く](#remove-ai-dlc-from-a-project) を参照してください。

```bash
aidlc uninstall
aidlc uninstall --purge --yes
```

アンインストールは、インストーラーが所有するファイルの明示的な一覧を使い、削除する前にその内容を確認します。インストールや版のディレクトリを再帰的に削除することはありません。ディレクトリは空の場合にだけ削除され、プロジェクトのツリー、一覧にないファイル、変更されたファイル、リンクの先は保たれます。結果は、AI-DLC がインストールしたものではない、またはインストール後に変更されたために残した各パスを、1 回ずつ一覧します。

新しいインストールは、版ごとの完全な `installed-files.json` の一覧を記録し、そのハッシュは `version.json` に保存されます。古いインストールは、ある場合は検証済みのランタイムの一覧に加えて、そのリリースが横に展開したプラグインのフォルダ（リリースのビルドが書いた印を持つ）を使います。所有の証拠のないほかのファイルは保たれます。プラグインのカタログ自身の記録は、最後の更新が書いたファイルを一覧します。それらは削除され、あなたがそのフォルダに置いたほかのものは保たれます。シェルの補完は、AI-DLC のリリースが描画するものと完全に一致する場合に AI-DLC のものと数えます。そのため、以前のリリースがこのリリースへ更新する間に書いた補完は削除され、編集されたものは保たれます。
`--purge` がなければ、マシンの設定、更新のキャッシュ、ピンの登録、既定のハーネスも保たれます。`--purge` は、それらの既知のマシンの記録を削除の対象に選びます。無関係なファイルへ削除を広げることはありません。

Windows では、どちらの形式も、インストールのルートの `windows-path.json` に記録された User PATH のエントリを削除します。インストールの前からあったエントリと、その後の無関係な変更は保たれます。所有の記録のないインストールは User PATH に触れません。後のインストーラーの実行での `-NoModifyPath` は以前の記録を保つため、そのエントリはアンインストールで引き続き削除されます。

端末では、アンインストールは削除するものと保つものを伝えてから進みます。端末がなければ `--yes` が必要です。ファイルシステム、ホーム、共有システム、プロジェクトのルートや、root 所有、パッケージマネージャー所有、所有が混在したコマンドは拒否します。`--allow-root` で行った root のインストールは、`aidlc uninstall --allow-root`（または `AIDLC_ALLOW_ROOT=1`）で削除します。このオプトインは、`sudo` のもとと、`$HOME` が root の所有でない場合は拒否されます。Windows では、後片付けを予定する前に、結び付いたファイルの一覧と期待するチェックサムを記録します。ワーカーはパスとハッシュを再確認し、リパースポイントを拒否し、実行中のコマンドが終了した後にファイルを個別に削除します。`aidlc` コマンドが見つからなくなれば、アンインストールは完了です。中断した継続は、検証済みのファイルの計画がある場合にだけ再開できます。そのような計画のない古いジャーナルは拒否され、調査のために残されます。失敗した後片付けがどう報告され、再試行されるかは [トランザクションと復旧](#transactions-and-recovery) を参照してください。
