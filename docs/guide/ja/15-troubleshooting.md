# トラブルシュート

この章では、よくある不具合とその対処を、症状ごとにまとめます。

> **ハーネスについての注。** 下の症状と直し方は **Claude Code** 向けに書いています（フックのファイル名、`settings.json` ブロック、コンパクションの動き）。決定論的なコア（状態、監査、エンジン）はどのハーネスでも同じに動きますが、シェル側の面は違います。ほかのハーネスはフックと設定をそれぞれのやり方で配線します（[他ハーネスで動かす](harnesses/README.md) を参照）。直し方が `.claude/` のパスや Claude の仕組みを指しているときは、使っているハーネスの設定ディレクトリに同等のものがあります。

---

<a id="quick-fix-table"></a>

## まず試すこと

| 症状 | まず試すこと |
|---------|-----------|
| 監査エントリが出ない | `aidlc doctor` を実行する。コピーインストールなら、フックの PATH に `bun` があるかも確認する |
| Windows: 監査やほかの記録で、`—` が `â€”`、`→` が `â†’` と表示される | ファイルは UTF-8 で、Windows PowerShell 5.1 がそれを ANSI として読んだ。`Get-Content -Encoding UTF8` で読むか、PowerShell 7 を使う。その読み取りから書き直したファイルには誤った文字が残るため、記録は `Copy-Item` かエクスプローラーでコピーし、実行の共有には `/aidlc --doctor --export` を使う |
| ファイルを手で編集した。エージェントは受け入れるか | はい。編集してから **done** と言う（またはそのまま続ける）。完了したステージへの編集はそのまま使われるが、承認し直されはしない。承認を受けるには `/aidlc --stage <name>` で戻る。これはそのステージと以降のすべてのステージを開き直す。それぞれのケースは [ファイルを自分で編集する](07-interaction-modes.md#ファイルを自分で編集する) を参照 |
| Claude のフックがポリシーで制限されている | Claude Code の管理者に、管理された `allowManagedHooksOnly` を外してもらう。プロジェクト設定では上書きできない |
| Cursor: 承認が記録されない | プロジェクトが git リポジトリの中になければ、そこで `git init` を実行し、Cursor を完全に再起動してフォルダを信頼する（[git リポジトリの外にある Cursor プロジェクト](#cursor-project-outside-a-git-repository) を参照） |
| Kiro IDE: `deny fs_read matching ".kiro/"` | `/aidlc --doctor` を実行し、示された ignore ファイルから `.kiro/` のルールを外す（[Kiro IDE の読取り拒否](#kiro-ide-read-denials) を参照） |
| Kiro IDE: AI-DLC のレビューや補助が動かない、チャットに **Approval needed in agent-aidlc-...** のパネルが出る、または `/aidlc` が Kiro のワークフローに渡される | Kiro の Workflows 機能が on になっている。エージェントに off にするよう頼むか、`aidlc config trust --kiro-workflows off --yes` を実行し、その後 **Developer: Reload Window** を実行する（[Kiro の Workflows 機能](harnesses/kiro-ide.md#kiro-の-workflows-機能は-ai-dlc-のレビューと補助を止める) を参照） |
| Kiro CLI: AI-DLC のレビューや補助が動かず、エージェントが作業を渡すツールがないと言う | Kiro CLI の Workflows 機能が on になっている。エージェントに off にするよう頼むか、`aidlc config trust --kiro-cli-workflows off --yes` を実行し、その後 Kiro CLI を終了して `kiro-cli` を再び起動する（[Kiro の Workflows 機能](harnesses/kiro-ide.md#kiro-の-workflows-機能は-ai-dlc-のレビューと補助を止める) を参照） |
| Windows の Kiro IDE: コマンドの結果が `AI-DLC reply:` の行で終わり、手順に余分なターンがかかる、またはすべてのコマンドが終了コード -1 を示す | Kiro の端末が Command Prompt になっている。エージェントに PowerShell にするよう頼むか、`aidlc config trust --kiro-terminal powershell --yes` を実行し、その後 Kiro を再起動する（[Kiro の端末としての Command Prompt](harnesses/kiro-ide.md#windows-で-kiro-のターミナルが-command-prompt-のとき) を参照） |
| Kiro IDE: エージェントが「my memory」を持ち出し、検査の迂回やフックの手動実行を提案する | 無視し、その Kiro のメモリを削除する（[Kiro のメモリが古い AI-DLC の助言を持ち越す](harnesses/kiro-ide.md#kiro-のメモリが古い-ai-dlc-の助言を持っている) を参照） |
| 状態ファイルが壊れている | `/aidlc --doctor` を実行し、状態テンプレートと見比べる |
| 承認ゲートで止まる | 応答を入力する。飛ばすなら `/aidlc --stage <target>` |
| Kiro IDE: AI-DLC 自身のコマンドは動くのに、エージェントが実行したビルド、テスト、探査のコマンドが `Exit Code: -1` を示す | Kiro はそれを実行していない。あなたの許可を待っているか、あなたが断った。Kiro のプロンプトで **Allow**（または **Always allow**）を選ぶか、どう進めるかをエージェントに伝える |
| Kiro IDE: 承認の質問への返答が見られない、またはコマンドが終了コード -1 で戻る | Kiro がこのフォルダを信頼するか尋ねたら **Trust Folder & Continue** を選ぶ（または Restricted Mode のバナーで **Manage**、次に **Trust** を選ぶ）。その後コマンドパレットから **Developer: Reload Window** を実行し、続けるよう伝える。次のメッセージもまだ記録されない場合は、`/aidlc --doctor` が理由を示す。Kiro CLI では、終了してそのフォルダで `kiro-cli` を再び起動する（[Kiro IDE のフックが動かない](#kiro-ide-hooks-not-running) を参照） |
| Kiro IDE: 承認で回答が記録されなかったと言われ、Agent Hooks の下の `aidlc-record-human-turn` が示される、または次の AI-DLC の手順で、Kiro の Agent Hooks で AI-DLC のフックが off になっていると言われる | Agent Hooks のパネルでそのフックを off にしている。AI-DLC があなたの代わりにそれを on に戻すことはない。そこで on に戻す（[Agent Hooks で off にした Kiro のフック](#a-kiro-hook-switched-off-under-agent-hooks) を参照） |
| Kiro CLI（または Kiro の ACP クライアント）: すべての承認で人の返答が届いていないと言われ、再起動しても直らない | エンジンが配布と一致していない。`kiro` には Kiro CLI の v2 エンジン、`kiro-ide` には v3 が必要（[Kiro CLI のフックが動かない](#kiro-cli-hooks-not-running) を参照） |
| セッション途中でコンテキストがコンパクトされた | `/aidlc` でチェックポイントから再開する |
| 監査ログが大きすぎる | そのままにしておく。長いプロジェクトの監査ファイルは設計上大きくなり、エンジンはそれを読んで、あなたが何を承認し何を終えたかを知る（[監査ログが大きくなりすぎる](#audit-log-growing-too-large) を参照） |
| フックがハングしたように見える | `/aidlc --doctor` でロックの所有を診断する。[ロックファイルが残る](#lock-files-left-behind) を参照 |
| ステータスラインが "ready" と出る | `aidlc-state.md` に `**Lifecycle Phase**` フィールドがあるか確認する |
| ステータスラインが出ない | on にしたときだけ表示される: `/aidlc --statusline on`（Claude Code と Codex）。その後 `aidlc doctor` を実行する。コピーインストールなら、PATH に `bun` があるか確認する |
| サブエージェントがタイムアウトした | `/aidlc` で再試行するか、ステージをインラインで実行する |
| `A program is watching the project folder (most likely a dev server or a test watcher still running)`（Windows） | 開発サーバー（Vite）や実行したままのテストウォッチャーなど、プロジェクトのすべてのフォルダを監視するプログラムが、AI-DLC が作業記録のロックフォルダを移動するのを妨げるため、各ステップが約 10 秒待つ。そのプログラムを止める（`npm run dev` を止めても `npm` だけが止まり、サーバーは動き続けることがある。タスクマネージャーか `taskkill /T /PID <pid>` で閉じる）と、次のステップは通常どおり進む。アシスタント、またはアシスタントが送り出したエージェントが会話の中でそのプログラムを起動した場合（たとえばアプリを確認するため）は、アシスタントがそれを止め、作業は続く。この行が表示されるのは、どちらも起動していない場合か、止めてもフォルダが解放されなかった場合だけ。Guard Policy が strict の場合、それが止まるまでビルドの書き込みは拒否される。 |
| Windows: `aidlc/` の下のファイルについて git が `Filename too long` と言う、またはレビューや質問のファイルを書けない | プロジェクトのフォルダが深すぎる。長いパスを有効にしていないと、Windows のツールと Git は 260 文字を超えるパスを拒否し、AI-DLC の記録はプロジェクトのフォルダの深い場所に置かれる。`aidlc config` がそのことを 1 行で伝え、`aidlc doctor` は、フォルダの深さと記録が加える長さを示す `Project folder` の行を表示する。プロジェクトを短いフォルダ（例えば `C:\src\<name>`）へ移すか、長いパスを有効にする。管理者として PowerShell で `New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force` を実行し、その後 `git config --global core.longpaths true` を実行する。AI-DLC はこの 2 つの設定を読み、両方が on なら何も言わない。それらの設定、フォルダ、git の設定を変えることはない。Copilot CLI は、この 2 つの設定に関係なく、260 文字を超えるパスを読むたびに尋ねる（`copilot -p` は拒否する）ため、Copilot CLI では短いフォルダにしない限りそれらの質問はなくならず、どちらの場合もこの行が表示される。 |
| ワークフローが止まる / おかしい。助けが要る | `/aidlc --doctor --export` を実行し、できた `.tar.gz` を共有する（マスキング済み。成果物は入らない） |
| Bolt の試行が保留された | 保存された abort の結果の `restore_operation` を、その正確な argv で呼び出すようアシスタントに頼む。ヒントは表示専用。evidence-only の試行には、復元できる保存ファイルがない。[保留した Bolt のファイルを取り戻す](#a-bolt-attempt-was-set-aside-getting-the-files-back) を参照 |

---

<a id="native-install-channel"></a>

## ネイティブ導入チャネル

| 症状またはエラー | 対処 |
|------------------|------------|
| `Checksum mismatch for <asset>.` または `<asset>: checksum mismatch` | 止める。ダウンロードしたディレクトリは再利用しない。同じリリースから、リリースの成果物一式と `checksums.txt` を取得し直す。 |
| `install.sh` の後に `command not found: aidlc` | インストーラーが示した bin ディレクトリを `PATH` に足し（通常は `export PATH="$HOME/.local/bin:$PATH"`）、新しいシェルを開いて `aidlc doctor` を実行する。 |
| `install.ps1` の後に `aidlc` が認識されない | 既定のインストールは、PowerShell を実行したアカウントの User PATH に登録する。インストール中にすでに開いていた端末アプリや IDE（Kiro、VS Code、Cursor）は、起動時の PATH を保ち続ける。完全に終了してから開き直す。その中で新しいタブを開いたり Reload Window を実行したりするだけでは足りない。[`-NoModifyPath`](18-install-and-lifecycle.md#windows-powershell) を使った場合は、表示された直接のコマンド（通常は `& "$env:LOCALAPPDATA\aidlc\bin\aidlc.cmd" config`）を使うか、そのスイッチなしでインストーラーを再実行して PATH を登録する。 |
| `aidlc` が PowerShell や CMD では動くが、Git Bash（または別の MSYS シェル）では動かない | それらのシェルは Unix の `execvp` の規則でコマンドを解決し、`PATHEXT` を無視するため、素の `aidlc` では `aidlc.cmd` が見つからない。インストーラーは、これらのシェルで素の名前が解決できるよう、まさにそのために bin ディレクトリ（通常は `%LOCALAPPDATA%\aidlc\bin`）の `aidlc.cmd` の横に拡張子のない `aidlc` ランチャーを書く。それがなければ、インストーラーを再実行するか、（`aidlc` がすでに解決できる PowerShell や CMD から）`aidlc use <version>` を実行して書き直す。Windows で `/hooks` には登録済みと表示されるのに一度も発火しないフックの原因として知られているものの 1 つがこれで、フックのシェルが `aidlc` を解決できない。`aidlc doctor` は、取るべき手順を示す `Windows launcher (Git Bash)` の失敗の行として表示する。**AI-DLC が書いたものではない `aidlc` という名前のファイル（例えば以前に手作りした転送用ファイル）がすでにその bin ディレクトリにある場合、インストーラー、`aidlc update`、`aidlc use` は端末で一度だけ置き換えるかを尋ね、あなたのファイルを `aidlc.bak-<time>` として横に残す。`--yes`（インストーラーでは `-Yes`）は「はい」と答える。端末も `--yes` もなければ、ファイルはそのままにして、脇へ移すよう伝える。そこにある `aidlc` という名前のディレクトリは決して置き換えない。削除するか名前を変えてから、インストーラーか `aidlc use <version>` を再実行する。** |
| `This PowerShell window is running as administrator` | 最も安全にインストールするには、N と答え、PowerShell を通常どおり（「管理者として実行」ではなく）開き、インストーラーを再び実行する。それでも管理者として続けるには y と答えるか、インストーラーに `-Yes` を渡す。`aidlc uninstall` は何も尋ねず、同じ警告を出して進むため、最も安全にアンインストールするには通常の PowerShell ウィンドウから実行する。AI-DLC は利用者単位で、管理者権限を必要としない。Windows Server の組み込みの Administrator や、UAC の昇格のないほかのセッションでは警告は出ない。 |
| Windows のインストールが PATH の競合を報告する | ファイルはインストールされているが、永続的な PATH が別のコマンドを選んでいる。`config` には表示された完全なコマンドのパスを使うか、報告された競合を解消する。終了コードは 0 だが、JSON は `status: "warning"` と `data.ready: false` を報告する。 |
| Windows のインストールが PATH を設定できなかったと報告する | ファイルはインストールされているが、PATH の手順が終了コード 1 で失敗した。表示された復旧の指示に従うか、`-NoModifyPath` 付きで再実行して直接のコマンドを使う。JSON は `data.installed: true` と `data.ready: false` を報告する。 |
| Windows のアンインストール後に User PATH のエントリが残る | アンインストールが削除するのは、`windows-path.json` を通じて所有しているエントリだけ。以前からあったエントリや、その所有の記録がないインストールでは、User PATH は変わらない。[アンインストール](18-install-and-lifecycle.md#uninstall) を参照。 |
| アンインストール後にファイルが残る | アンインストールは個別に検証したファイルを削除し、ディレクトリは空の場合にだけ削除する。一覧にない、または変更されたファイルは保持して報告する。古いインストールで所有の一覧がないファイルも含む。報告されたパスを確認すること。`--purge` も無関係な内容は削除しない。 |
| `--offline requires --from <release-directory>` | オフラインモードは決してネットワークのリリースにフォールバックしない。リリースの成果物一式を運び、そのディレクトリを `--from` / `-From` で渡す。インストーラーがそれを検証する。 |
| `aidlc.cmd` が終了コード 4 で終わる、または Windows のアクティブなポインターが不正 | ランチャーは、使えなかったファイル（アクティブな版のマーカー、アクティブなコマンドの対象、アクティブな実行ファイル）を示す `aidlc:` の行を 1 つ出し、続いて `Rerun the AI-DLC installer (install.ps1) to repair the aidlc command.` を出す。以前のリリースから `aidlc update` した後は、何も表示せずに終了コード 4 で終わるそのリリースのランチャーが、`aidlc doctor` と `aidlc uninstall` 以外の次の `aidlc` コマンドが置き換えるまで残る。その 1 つのコマンドは古いランチャーを通じて実行され、空白を含む値を別々の語に分割する。それが残っている間、`aidlc doctor` は `Windows launcher` の行を表示する。AI-DLC がそれを置き換えられない場合（例えばインストール後に `aidlc.cmd` や `aidlc-shim.ps1` が変更された）、その行は理由と直す手順を示す。古いランチャーがどのコマンドも始まる前に終了コード 4 で終わる場合は、インストーラーを再実行する。`%LOCALAPPDATA%\aidlc\active-executable` を編集しない。検証済みの同じインストーラーを再実行するか、動作する保持された実行ファイルから `aidlc use <version>` を使う。PowerShell がランチャーを `ConstrainedLanguage` モードで実行すると示す行は、アプリケーション制御のポリシー（AppLocker または WDAC）がそれをブロックしていることを意味する。管理者に `aidlc-shim.ps1` を許可してもらうか、`%LOCALAPPDATA%\aidlc\versions\<version>\aidlc.exe` を直接実行する。 |
| `aidlc-shim.ps1 cannot be loaded` または `is not digitally signed` | グループポリシーの実行ポリシーが、`aidlc.cmd` が渡す `-ExecutionPolicy Bypass` を上書きするため、PowerShell は実行前にランチャーを拒否する。`Get-ExecutionPolicy -List` を実行し、`Undefined` 以外の `MachinePolicy` または `UserPolicy` の行があればそれが原因。管理者にスクリプトを許可してもらうか、`%LOCALAPPDATA%\aidlc\versions\<version>\aidlc.exe` を直接実行する。 |
| `pending Windows uninstall`、または Windows のアンインストールの復旧の失敗 | 実行中の AI-DLC のコマンドを閉じ、`aidlc doctor` を実行する。保留中の後片付けは次のコマンドで再開する。doctor が失敗した後片付けを報告した場合は、示された理由を解決し、doctor が表示する完全なパスで `aidlc uninstall` を再び実行する（PATH のエントリがすでにないかもしれないため、通常は `& "$env:LOCALAPPDATA\aidlc\bin\aidlc.cmd" uninstall`。元の実行で使った場合は `--purge` を付ける）。ファイルを削除する前に失敗した後片付けはディスクから改めて計画され、始まっていたものは再開する。そのコマンドがもう動かない場合は、インストーラーを再び実行する。インストーラーは先に保留中の後片付けを再試行するため、2 回実行が必要なことがある。結び付いたファイル計画のない古い、または改変されたジャーナルは拒否される。一時ジャーナル、後片付けのスクリプト、マシンのフェンス、残っているファイルは調査のために残しておく。 |
| `the last AI-DLC uninstall is still finishing` | Windows は `aidlc uninstall` の終了後に AI-DLC のファイルを削除する。導入済みのバージョンが 1 つか 2 つなら 1 分未満で、それより多い場合や遅いマシンではもっとかかる。何も変更されていない。その行が示すときにインストーラーを再び実行する。終わらずに止まった後片付けは、始まってから 10 分後に、doctor 以外の最初の AI-DLC コマンドがもう一度始める。 |
| Alpine が `libstdc++.so.6` または `libgcc_s.so.1` がないと報告する | Bun と Node.js の musl ビルドが必要とするのと同じランタイム依存関係を `apk add libgcc libstdc++` でインストールし、インストーラーかコマンドを再実行する。完全に静的な Bun の musl コンパイル対象は現在ない。インストーラーはこの対処を報告するが、パッケージはインストールしない。 |
| ハーネスがすでに自身のモデルアクセスを持っているのに、`Providers` が `no recorded answers` とともに `[needs]` を示す | Kiro CLI と Kiro IDE では、モデルアクセスは Kiro に付いてくるため、行は `[ok]` を示し、`aidlc config providers` は何も尋ねない。GitHub Copilot と Cursor では、セッションがモデルアクセスを持ってくるため、回答なしで行は `[ok]` を示す。自分の Amazon Bedrock のアクセスを使う場合にだけ `aidlc config providers` を実行する（Cursor では Bedrock のキーを受け付けるのは IDE だけで、CLI は常に Cursor のバックエンドを使う）。それ以外のハーネスでは、この行は本物。`amazon-bedrock` と答えるか、`keep current`（`--provider current`）を選んで、ハーネスにすでに設定されているプロバイダーを保持・記録する。`--provider other --acknowledge` は、自分で設定した別のプロバイダーを記録する。 |
| `Models` が `no recorded policy` とともに `[needs]` を示す | ポリシーがなければ、ほとんどのエージェントはセッションのモデルと effort を継承するため、effort が高いセッションではそれらも高い effort で動く。エージェントの effort を設定するにはプリセットを記録するか（`aidlc config models --preset balanced --project --yes`）、継承を続けるならそのままにする。Kiro CLI ではプリセットが対話セッション全体に 1 つの effort を設定する。`aidlc config models` がセッションのモデルを選び、その effort とともに個人の Kiro 設定に保存し、Kiro の中では `/model` と `/effort` でそれらを変える（[セッションのモデルと effort](harnesses/kiro-cli.md#セッションのモデルと-effort) を参照）。GitHub Copilot、Cursor、Kiro IDE では、プリセットがそこでは何も変えないため、行は `[ok]` を示し、代わりにホストを示す。モデルと effort はホストで選ぶ（Kiro では、`aidlc config models --agent` で 1 つのエージェント自身のモデルと effort を設定できる）。[モデルと effort の選び方](18-install-and-lifecycle.md#choosing-a-model-and-effort) を参照。 |
| `aidlc doctor` で `workspace shell ready` が失敗し、`aidlc config` を再実行しても直らない | 対話的な再実行は既存の投影を使い、欠けた `aidlc/spaces/default/memory/` を作り直すことはない。シェルが不完全な間は `Workspace` の行を報告し、直す節を提示しない。その行が示すコマンドを実行する。ネイティブのインストールでは `aidlc config --harness <name>` で、インストール済みのランタイムから更新し、ワークスペースのシェルを作り直す。`aidlc-copy-runtime-X.Y.Z.tar.gz` の `runtime/<name>/` ルートやチェックアウトの `dist/<name>/` ツリーからコピーした、Bun を呼び出す投影には、更新元となるインストール済みのランタイムがないため、そのコマンドには `--download` も付く。これはプロジェクトのリリースの `aidlc-copy-runtime-<version>.tar.gz` を取得して検証する。プロジェクトのフックをネイティブのコマンドに切り替えてしまうため、ネイティブの `aidlc-runtime-X.Y.Z.tar.gz` や `dist-release/` のバイト列は決して使わない。 |
| `aidlc config` がリリースが必要だと言う: `this project is pinned to <version>`、`needs the <version> release files`、`is missing aidlc/spaces/default/memory/`、`no longer has the MCP server list` | プロジェクトが、このマシンにないリリースのファイルを必要としている。チームメイトの新しいピン、追加しているハーネス、または失ったファイル。`fix:` の行を実行する。それはあなたのコマンドに `--download` を付けたもので、まさにそのリリースを取得し、チェックサムと（`gh` がインストールされていれば）リリースの attestation を検証し、コマンドを完了する。ネイティブでは、`aidlc config --pin` と同じく、固定されたリリースをインストールして登録する。コピーしたプロジェクトでは `aidlc-copy-runtime-<version>.tar.gz` をダウンロードする。端末では代わりに config が尋ねる。すでにインストールされている固定のリリースは、尋ねずに使われる。ネットワークアクセスがなければ `offline:` の行に従う。示されたファイルを別の場所で取得し、`--from` で渡すか、ネイティブなら `aidlc config --pin <version> --offline --from <release directory>`。`--release-base-url` と `--ca-bundle` はミラーを選ぶ。チェックサムや attestation の失敗では、何も変えずに止まる。 |
| コピーのチャネルでインストールしていないプロジェクトで `aidlc doctor` が Bun を求める | コピーのチャネルの投影は Bun でフックを実行し、ネイティブのインストールは `aidlc` コマンドで実行する。対処は、プロジェクトがどちらのチャネルかを示す。Bun を不要にするには、ネイティブのリリースのインストーラーで入れ直し、`aidlc config --harness <name>` を再実行する。 |
| `aidlc doctor` で `Harness trees on different releases` | プロジェクトのハーネスのツリーが異なるリリースからインストールされたため、ワークフローがツールごとに異なる動きをすることがある。行が示すコマンドを実行する。固定されたプロジェクトのツリーはピンに揃えられる。ネイティブでは、エンジンのリリース（またはピン）にないツリーごとに `aidlc config --harness <name>`。固定されたコピーのプロジェクトでは `bun <harness-dir>/tools/aidlc.ts config --harness <name> --download`。ピンがなければ、最も新しいツリーの `aidlc-copy-runtime-<version>.tar.gz` を使った `bun <harness-dir>/tools/aidlc.ts config --harness <name> --from <file>` で、どの config の実行も記録していないツリーには先に `--download` で 1 回更新する。開いている作業は更新をまたいで続くため、終わるのを待つ必要はない。 |
| `config plan changed after approval` | `aidlc config --dry-run --json` を再実行し、`data.actions` を確認して、新しい `data.planToken` を、まったく同じソースと振る舞いのオプションで適用する。 |
| `aidlc config` の `locally modified` または `managed block was locally modified` | `aidlc config --dry-run --json` を実行し、`data.actions` を確認する。`--force` は、基準が所有するフレームワークのバイト列や管理ブロックを置き換える場合にだけ使う。無関係なルートの内容を認可することは決してない。`.claude/settings.json` はエントリ単位でマージされるため `--force` は不要。更新は AI-DLC のフックとコマンドの許可エントリを戻し、あなたのフック、deny ルール、独自のステータスライン、環境変数、その他の設定は保ち、何を戻したかを注記で伝える。廃止された同梱の許可エントリは自動では削除されない。`.codex/config.toml` も同じくエントリ単位でマージされる。更新は AI-DLC 自身のキーだけを変え、あなたのキー、テーブル、コメントはそのまま保ち、AI-DLC のキーのうちあなたが変えた値も保つ。リリースが別の値を出荷している場合は注記が出る。 |
| `aidlc doctor` で `AI-DLC files: N changed in this project` | それらの AI-DLC のファイルはこのプロジェクトで編集されているため、`aidlc config` はそれらを保ち、何かを更新する前に止まる。自分の版を保つには、示されたファイルを別の場所へ移してから `aidlc config` を実行する。同梱の版で上書きするには `aidlc config --force` を実行する。違いが改行コードだけのファイル（Windows のチェックアウトは LF を CRLF に変える）は数えない。 |
| `cannot coexist in one project` | 2 つ目のハーネスがエンジンのディレクトリ（`opencode` / `copilot` は `.aidlc` を使う）または専有の管理ブロック（Copilot の `AGENTS.md`）を共有している。別々のエンジンのディレクトリを選び、専有のブロックを避ける。`kiro` と `kiro-ide` も `.kiro` を共有するが、`aidlc config --harness kiro-ide`（または `--harness kiro`）はインストール済みの一方をその場でもう一方に切り替える。[プロジェクトに複数のハーネスを置く](18-install-and-lifecycle.md) を参照。中立の `AGENTS.md` ブロックは Kiro CLI、Kiro IDE、Codex、Cursor、OpenCode の間で共有され、`.gitignore` は同梱のエントリを結合する。 |
| `cannot switch .kiro from <row> to <row>: installed <row> has no ownership baseline`、`has an ownership baseline recorded before it listed only shipped files`、`has an unusable ownership baseline` | インストール済みの行がどの `.kiro/` ファイルを所有するかを記録した使えるものがないため、切り替えるとそのファイルが残されてしまう。何も変えない。表示された手順に従う。壊れた `.kiro/tools/data/aidlc-manifest.json` を脇へ移し（手順がその完全なパスを示す）、表示された `config --harness <installed row>` を実行してから、もう一度切り替えを実行する。 |
| `switching .kiro to kiro-ide lets Kiro run hook files AI-DLC does not own` | Kiro は、v3 エンジンと Kiro IDE で、すべての `.kiro/hooks/*.json` ファイルを実行する。示されたファイルを確認し、端末でプロンプトに答えるか、表示された `--dry-run` を実行し、それが表示する `--plan-token` で切り替えを適用する。`config plan changed after approval` や `hook files AI-DLC does not own changed after this switch was planned` は、確認の後に集合が変わったことを意味する。もう一度確認する。 |
| `cannot switch .kiro to kiro-ide: .kiro/hooks is a link or a file, not a directory`、または `Kiro would run hooks through entries that are not regular files in .kiro/hooks` | `.kiro/hooks` をファイルを持つ本物のディレクトリにする。または一覧された各フックのエントリ（リンク、ディレクトリ、その他のファイルでないもの）を通常ファイルに置き換えるか、`.kiro/hooks` の外へ移す。その後もう一度切り替えを実行する。 |
| `predates shared onboarding` | 示されたインストール済みのハーネスが、選択したリリースより古い（または有効な記録済みの版がない）ため、そのブロックが共有されていない。プレビュー版は、同じベースの版を持つ安定版より前に並ぶ。中立の `AGENTS.md` ブロックを共有する別のハーネスを追加する前に、`aidlc config --harness <name>` でそれを更新してみる。これは古い兄弟のためのヒントで、その後も拒否される場合、そのブロックは専有で、1 つのプロジェクトに共存できない。Copilot のブロックは更新後も専有のまま。現在の専有ブロックは代わりに `cannot coexist in one project` を報告する。`--force` はこの互換性の検査を迂回しない。 |
| `refusing to refresh <harness> from a release whose AGENTS.md is not shared` | 別のインストール済みのハーネスが中立のルートのブロックを共有しているが、選択した更新元がそれを共有と宣言していない。`AGENTS.md` を共有と宣言するリリースを使う。`--force` はこのガードを迂回せず、プロジェクトのファイルは変わらない。 |
| `shared block is owned by <harness> from a different release` | 共有の `AGENTS.md` ブロックが、選択したリリースではなく、示された兄弟の基準と一致している。エラーの更新順序に従う。選択したハーネスを兄弟と同じリリースから更新するか、先に兄弟を選択したリリースから更新する。拒否された更新でプロジェクトのファイルは変わらない。 |
| `multiple project harnesses are present; pass one --harness <name>` | 複数のハーネスを持つプロジェクトでのすべての `aidlc config` は、`--harness <name>` で対象を指定しなければならない。例外はバイパスの記録またはクリア（ほかに何も変えない `aidlc config flags --bypass <NAME>` または `--clear-bypass <NAME>`）で、これはプロジェクトに属し、ハーネスを必要としない。 |
| `.gitignore` が `preserve (owned by <harness>)` を示す（`aidlc config --dry-run --json` では `action: "preserve"`、`detail: "owned by <harness>"`） | このフォールバックは、所有するハーネスが `tools/data/root-blocks/` のないリリースでインストールされた場合に出る。`aidlc config --harness <owner>` でそれを更新すると、その後は両方のハーネスが 1 つの結合したブロックに収束する。 |
| `managed block has no ownership baseline` | そのブロックは、もう存在しない、または基準のないインストール（例えば削除されたハーネスのツリー）が書いたもの。`aidlc config --dry-run --json` を確認してから、`--force` で現在の同梱のブロック（共有の `.gitignore` では結合したエントリ）に置き換える。 |
| `has no readable projection descriptor` または `has lost its projection descriptor and ownership baseline` | 別のハーネスを追加する前に、示されたインストール済みのハーネスを `aidlc config --harness <name>` で修復する。共同所有のブロックでは、更新元がブロックを共有と宣言し、現在のブロックを兄弟の基準と一致したまま変えない場合、その兄弟の記述子がなくても同じリリースからの更新は許される。これにより、両方の欠けた記述子を 1 つのハーネスずつ修復できる。それ以外の場合、`co-owns AGENTS.md` の拒否では、先に示された兄弟の記述子を戻す必要がある。`--force` はこのガードを迂回できない。記述子と基準の両方を失ったスタンプ付きの兄弟（`aidlc-stamp.json` がある）は、和集合でない管理ブロックを変える更新を `has lost its projection descriptor and ownership baseline` でブロックする。先にその兄弟を戻す。現在のブロックを変えない同じリリースからの更新は引き続き許されるが、`--force` でブロックを変える更新を許すことはできない。スタンプがなく、共同所有の基準の証拠もない旧来のツリーは、引き続き 1 つのハーネスずつ取り込める。 |
| `is missing its shipped block copy` | 示されたハーネスのインストールが `tools/data/root-blocks/<marker>` を失っている。`aidlc config --harness <name>` を実行してそれを戻し、更新を再実行する。`--force` はそのハーネスのエントリなしでブロックを書く。 |
| 通常の `aidlc config` のリリースの更新で `unowned whole file` | 更新の前に、既存のファイルを手で移すかマージする。OpenCode の `opencode.json` はもうここでは止まらない。config はあなたのファイルに AI-DLC のエントリを追加し、それ以外はすべて保つ。 |
| `opencode.json` が `<key> must be a JSON object` または `must be a JSON array` で config を止める | AI-DLC は `skills.paths`、`instructions`、`permission` に自身のエントリを追加する。そのいずれかが別の形（例えば `"permission": "ask"`）の場合、config は何も変えない。マップかリストとして書き（`"permission": { "bash": "ask" }`）、config を再実行する。 |
| `<file> is not valid UTF-8; convert its encoding before config` | 示されたルートファイル（`.gitignore` や `AGENTS.md` など）をバックアップし、内容を保ったまま現在のエンコーディングから UTF-8 に変換してから、config を再実行する。デコードで情報が失われる場合、AI-DLC は元のバイト列に触れない。 |
| `managed markers are missing, duplicated, or malformed` | 示されたルートファイルを直し、一致する `BEGIN AI-DLC` / `END AI-DLC` の組をちょうど 1 つにするか、壊れた AI-DLC のブロックを削除して `aidlc config` を再実行する。 |
| `project runtime <version> is incompatible with selected engine <version>` | `aidlc use <version>` で互換な版をインストールして選ぶか、`aidlc config` で意図してプロジェクトを更新する。 |
| `this project requires <version>, which is not installed completely` | `aidlc config --pin <version>` で、厳密な semver の正確なピンをインストールまたは再インストールする。ディスパッチャーはアクティブなマシンの版にフォールバックせず、安全側に失敗する。`aidlc config --unpin` は、チームがプロジェクトの固定をやめるつもりのときだけ使う。 |
| `.aidlc-version must contain one release version id` | コミットされたピンのファイルが、1 つのリリース id 以外のもの（余分なテキストや紛れ込んだコマンドなど）を持っている。`aidlc config` とディスパッチャーは、その内容を表示せずに拒否する。ファイルを意図したリリース id（例えば `2.10.0`）に直すか、`aidlc config --unpin` を実行してプロジェクトの固定をやめる。 |
| AI-DLC を頼んだときに `AI-DLC can't run in <folder>. Start the session from your project's folder.` | セッションが、ホームフォルダのような、AI-DLC のマシンのインストールやコマンドのディレクトリを持つフォルダ、またはその中のフォルダで始まった。AI-DLC はそこでは動かないため、フックは道を譲り、そのフォルダでのほかの作業は通常どおり続く。AI-DLC を使うには、プロジェクトのフォルダからセッションを始める。 |
| 更新が中断され、`aidlc version` がまだ前のリリースを示す | これは安全に戻された状態で、古いコマンドがアクティブのまま。`aidlc doctor` を実行してから、同じ `aidlc update --version <version>` のコマンドを再実行する。 |
| `another AI-DLC mutation holds .../.aidlc-transaction.lock`、ロックについての `cannot verify`、または `belongs to another host or boot` | アクティブな所有者に終わらせる。そうでなければ [トランザクションのロックの所有](#transaction-lock-ownership) に従う。 |
| `an earlier AI-DLC command stopped before it finished, so its lock was cleared` | 実行したコマンドについてすることはない。以前のコマンドは完了していないので、まだ必要なら再実行する。 |
| `another AI-DLC command is still changing this machine's install, so this ran on aidlc <version> without waiting for it to finish` | することはない。固定されたプロジェクトのコマンドやフックが、更新、アンインストール、その他のマシンの変更を最大 30 秒待ってから、それでも固定のリリースで実行された。ほかの `aidlc` コマンドが動いていないのに繰り返す場合は、[トランザクションのロックの所有](#transaction-lock-ownership) に従う。 |
| config 中の `EMLINK`（`too many links`）、`Cannot create an AI-DLC transaction lock`、または `Cannot use the filesystem at ...` | ハードリンクには自動のフォールバックがある。ほかのファイルシステムの要件は引き続き適用される。[config がハードリンクのエラーで失敗する](#config-fails-with-a-hard-link-error) を参照。 |
| `existing aidlc is managed by Homebrew` / `Nix`、または行き先のコマンドが `not owned by the AI-DLC installer` | 報告された所有者を通じてアップグレードする。別のネイティブのインストールを保つには、空の利用者所有のディレクトリを `AIDLC_BIN_DIR` に明示的に設定する。このリリース自身は Homebrew や Nix のパッケージを出荷せず、所有が混在したコマンドを置き換えることは決してない。 |
| `update cache is invalid`、またはマシンの設定が拒否される | `aidlc system config global list` を実行する。修復または削除するのは、示された `%LOCALAPPDATA%\aidlc\aidlc.settings.json`（Windows）または `${XDG_DATA_HOME:-$HOME/.local/share}/aidlc/aidlc.settings.json`（macOS/Linux）だけ。未知のキーと保存された認証情報は拒否される。 |
| `HTTPS_PROXY must use HTTP or HTTPS`、またはリリースの URL が拒否される | 認証情報、クエリ、フラグメントのない HTTP(S) のプロキシ URL と、HTTPS のリリースのミラーを使う。ネイティブのクライアントが読むのは `HTTPS_PROXY` と `NO_PROXY` で、`HTTP_PROXY` ではない。エラーでは秘密らしい URL の部分を伏せる。 |
| 企業の CA の内側でダウンロードが失敗する | `--ca-bundle <absolute-path>` を渡すか、`AIDLC_CA_BUNDLE` を設定する。独自の CA を指定した場合、Windows のブートストラップは `curl.exe` を必要とする。 |
| プラグインのコマンドで `host inventory unavailable` | 現在のプラグインのルートを注入するホストのセッションから sync を実行するか、Claude/Codex のホストのレジストリを戻す。欠けた、または不正な一覧が、内容を刈り込んでよい証拠として扱われることは決してない。 |
| `Nothing synced: this tool keeps no list of your plugins` | Kiro CLI、Kiro IDE、Cursor、Copilot、opencode にはプラグインの一覧がない。その行が示すコマンドを、各プラグインのフォルダを `--plugin-root` の後に付けて実行する。 |
| `cannot sync <plugin>` または `cannot prune <plugin>: owned path changed since composition` | プラグインが追加したファイルを編集している。編集を保つには、そのファイルを別の場所へ移してから、その行が示すコマンド（同じ `aidlc engine plugin sync`。プラグインの一覧がないホストではプラグインのフォルダ付き。または `sync --prune-missing`）を再び実行する。sync はプラグイン自身の版を戻す。`--yes` は所有のハッシュを上書きしない。 |
| `aidlc system versions prune`、`uninstall`、またはプラグインの prune が `--yes` を求める | コマンドが対話的な標準入力なしで実行されている。一覧された削除内容を確認してから、`--yes` 付きで再実行する。完全性による拒否は迂回できない。端末ではこれらのコマンドは何も尋ねず、削除するものを表示してから実行する。 |
| `aidlc setup` が未知、または npm のインストールが使えない | それらのチャネルは計画中で、出荷されていない。リリースのインストーラーと `aidlc config` を使う。提案のトランスクリプトを使えるコマンドとして扱わない。 |

ネイティブの `aidlc doctor` はさらに、アクティブなコマンドのポインター、ロールバックの可否、保持されたピンの完全性、古いピンの登録、放棄されたトランザクションのステージ、プロジェクトの版のずれ、バイナリのチャネルのホストのフックと permission/trust のエントリがネイティブのコマンドを一貫して選んでいるかも確認します。

<a id="config-warns-about-an-ignore-rule-hiding-committed-records"></a>

### config がコミットされた記録を隠す ignore ルールについて警告する

Git リポジトリでは、config は、自分の ignore ルールのどれかが、コミットして共有するための記録を隠していないかを確認します。`aidlc/` のようなルールは隠してしまうため、config は完了しますが、最後に `<file>:<line>` と隠される記録のパス（`memory/**`、`codekb/**`、`intents.json`、`aidlc-state.md`、`audit/*.md`）を示す注記が付きます。新しいものはチームメイトに届きませんが、git がすでに追跡しているファイルは引き続きコミットされます。初回のセットアップと `--quiet` でも表示されます。
それが意図したものでなければ、無関係な ignore を保ったまま、示されたルールを狭めてください。個人の作業領域を Git から外すルールのような意図したルールは、そのままで構いません。Git の外、または Git の実行ファイルがない場合、確認は行いません。

<a id="config-fails-with-a-hard-link-error"></a>

### config がハードリンクのエラーで失敗する

`aidlc config` はまずハードリンクによるトランザクションのロックを試みます。マウントが `EMLINK`、`ENOTSUP`、`EOPNOTSUPP`、`ENOSYS`、`EPERM` でそれを拒否すると、config は自動的に同じ `.aidlc-transaction.lock` のパスでディレクトリのロックを試みます。フラグは不要で、config がロックなしの書込みで進むことは決してありません。

初回のウィザードは、セットアップの選択肢を示す前に必要なファイルシステムの操作を探査し、その後一時的な探査用ファイルを削除します。探査が失敗すると、何も書かずにセットアップを止めます。探査自体を削除できなかった場合、セットアップはそれを示し、ほかには何も書いていないと伝えます。人向けの出力は失敗と修正方法を示し、`--quiet` は修正方法を出し、`--json` は構造化した失敗を返します。探査が合格しても、原子性やクラッシュへの耐久性を保証することはできません。機能とサポートの表は [トランザクションと復旧](18-install-and-lifecycle.md#transactions-and-recovery) を参照してください。
S3 のマウント名やハードリンクのエラーだけでは、そのドライバー、版、オプションは特定できません。

互換性のないマウントでは、プロジェクトを EC2 の EBS ボリューム上の ext4 や XFS のような互換性のあるローカルのストレージへ移すかクローンし、そこで `aidlc config` を再実行してください。作業中のプロジェクトは S3 のマウントの外に置きます。後でアップロードするのは別の公開であり、複数ファイルの原子的な保証はありません。同じマウントへの別名やシンボリックリンクは、その機能を変えません。`--force`、`--from`、ロックの削除のどれも、欠けたファイルシステムの意味論を補いません。

<a id="transaction-lock-ownership"></a>

### トランザクションのロックの所有

再試行する前に、生きている init／ライフサイクルの所有者に終わらせてください。次の AI-DLC のコマンドは、所有者が止まったロックを解除し、そのことを 1 行で伝えます。所有者が止まったとみなされるのは、その PID が終了しているとき、またはシステムがその後その PID を後のプロセスに与えたとき（Windows は PID をすぐに再利用します）です。後のプロセスとは、開始の記録がロックが記録したものと異なるもの、または何も記録しなかったリリースのロックでは、ロックが書かれた後に始まったものです。ディレクトリのロックは、記録されたホスト／ブートの識別情報が一致することも必要です。所有者のスタンプが書き終わっていないディレクトリのロック（`owner.json` がない、空である、または JSON として読める前に途切れている）は、ロックを取る途中で止まったコマンドが残すもので、数秒経てば、次のコマンドが同じように解除します。読み取れても、外部のホストを示す、有効な所有者を示さない、または生きているプロセスを示すスタンプは保持され、検証できないスタンプも同様です。このホストに PID がないことは、外部の所有者が止まった証拠になりません。

手動で診断する場合は、エラー、ロック、示されたステージ／復旧のパスを保存してください。`.aidlc-transaction.lock/owner.json`（旧来のファイルのロックではロックファイル自体）を調べ、運用者とともに所有者のプロセス、ホスト／ブート、マウントの履歴を確かめてください。すべての参加者が、同じローカルの一時ディレクトリ（Unix では `TMPDIR`）と PID の名前空間を共有している必要があります。修正の作業の前に書き手を止め、所有が不確かな間は証拠を保持してください。再試行を進めるためにプロジェクトのロックやそのローカルの調整用ゲートをむやみに削除しないでください。

---

<a id="hooks-not-firing"></a>

## フックが動かない

**症状**: ファイルを書いた後にインテントの `audit/` シャードにエントリが現れない、またはサブエージェントの完了のログがない。

<a id="native-runtime-versus-source-generated-bun-projection"></a>

### ネイティブランタイムと、ソースから生成した Bun 投影

ソース／開発用の `dist/` 投影は、17 本の TypeScript のフックを `bun` で実行します。ネイティブのインストールと版付きのリリースランタイムは、同じフックを `aidlc` を通じて実行します。ソースから生成したインストールが非対話の PATH で Bun を見つけられないと、そのフックは発火しません。

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows
npm install -g bun
# or: powershell -c "irm bun.sh/install.ps1 | iex"

# Verify
bun --version
```

ソースから生成した `dist/` のインストールでは、ハーネスがフックに渡す PATH に `bun` がなければなりません。端末から起動したハーネスはその端末の PATH をフックに渡すため、そこで `bun --version` が動けば十分です。Dock、デスクトップのアイコン、サービスから起動したハーネスにはその PATH が渡りません。そのフックが動かない場合は、`bun --version` が動く端末を開き、そこで `bun <harness-dir>/tools/aidlc.ts doctor`（例: `bun .kiro/tools/aidlc.ts doctor`）を実行してください。その `Runtime hook PATH` の行が、追加すべきディレクトリと追加先を示します。その後ハーネスを再起動してください。それまでは、その端末から起動してください。ネイティブの Windows PowerShell では、`npm install -g bun` が設定するシステムの PATH のエントリで十分です。

<a id="kiro-ide-hooks-not-running"></a>

### Kiro IDE のフックが動かない

Kiro IDE があるフォルダのフックを実行するのは、そのフォルダでのコマンドの実行を許可し、ウィンドウを再読み込みした後だけです。許可するまで、エージェントが実行するすべてのコマンドは出力なしで終了コード -1 で戻るため、AI-DLC のメッセージは何も表示できません。エージェント自身があなたに手順を伝えます。Kiro がフォルダを開いた後で信頼した場合、コマンドは動きますが、再読み込みするまでフックはまだ動きません。そのとき AI-DLC は作業の前に止まり、エージェントが同じ手順を示します。プロジェクトでの最初のチャットのメッセージより前は、doctor が「AIDLC hooks have not run in this project yet」と警告します。これは想定どおりです。

内容を知っているフォルダ（自分のプロジェクト、または確認したもの）だけを信頼してください。信頼すると、そのフォルダの `.kiro` のフックがあなたのマシンでコマンドを実行できるようになるためです（[最初の実行](harnesses/kiro-ide.md#初回の実行) を参照）。

1. Kiro がこのフォルダを信頼するか尋ねたら **Trust Folder & Continue** を選びます。代わりにウィンドウの上部に Restricted Mode のバナーが表示されている場合は、そこで **Manage**、次に **Trust** を選びます。
2. コマンドパレット（Ctrl+Shift+P、macOS では Cmd+Shift+P）を開き、**Developer: Reload Window** を実行します。信頼は再読み込みの後に有効になります。
3. チャットで続けるよう伝えます。次のメッセージもまだ記録されない場合は、`/aidlc --doctor` が理由を示します。

<a id="kiro-cli-hooks-not-running"></a>

### Kiro CLI のフックが動かない

Kiro CLI の v2 と v3 のエンジンは、異なるフックの登録を読みます。エンジンがインストールした AI-DLC の配布と一致しないと、フックは 1 つも動きません。その場合、すべての承認と確認で人の返答が届いていないと言われ、レビューは出力の書込みが記録されていないと言い、最初のワークフローのステージの後は doctor が「Hooks have never executed」と報告します。同じエンジンで再起動しても何も変わりません。

- **`kiro` 配布**（`.kiro/agents/aidlc.json`）: フックは Kiro CLI の v2 エンジンで、`aidlc` エージェントがアクティブなときに動きます。v3 は AI-DLC が出荷するとおりのファイルを実行しません。別のエージェントを選んでいる場合は、`/agent` と入力して `aidlc` を選び、同じチャットで続けてください。Kiro が返答の下に `agent "aidlc" needs upgrading for this agent engine` と表示する場合、セッションは 3.0 のエンジンです。Kiro を終了し、このフォルダで `kiro-cli chat --agent-engine v2 --agent aidlc` で再び起動してください。ACP クライアントからは `kiro-cli acp --agent-engine v2` を起動します。
- **`kiro-ide` 配布**（`.kiro/hooks/aidlc-*.json`）: フックは Kiro CLI の v3 エンジンでだけ動きます。`kiro-cli chat` は `.kiro/settings/cli.json` の v3 の固定を読みますが、`kiro-cli acp` は読まないため、ACP クライアントは `kiro-cli acp --agent-engine v3` を起動しなければなりません。さらに、その `initialize` リクエストで `clientCapabilities._meta.kiro.hooks` を `{ enabled: true, v2: true }` と宣言しなければなりません。両方の値がなければ、v3 はフックを実行しません。

これらの動きは Kiro CLI 2.21.1 で計測したもので、後の Kiro CLI では変わることがあります。切り替えた後、メッセージを送って `/aidlc --doctor` を実行してください。`kiro` 配布では、あなたのメッセージが最初のハートビートを残すため、それ以降 doctor はフックを確認します。それまでは、このプロジェクトでまだフックが動いていないと警告します。

<a id="github-copilot-hooks-not-running"></a>

### GitHub Copilot のフックが動かない

VS Code がプロジェクトのフックを実行するのは、**Chat: Use Hooks** 設定（`chat.useHooks`）が on の信頼されたワークスペースだけで、組織がその設定を off にすることがあります。プロジェクトがそれを設定していない場合、`aidlc config` はフォルダの `.vscode/settings.json` でそれを on にし、フォルダの値は off の利用者設定より優先します。Copilot CLI は信頼したフォルダでだけフックを実行します。どちらもフックを飛ばすときにチャットで何も言わないため、AI-DLC が伝えます。あなたのメッセージに対してフックが 1 つも動かなかった場合、エージェントが自分でフォルダの設定を on にし、1 行を表示します。同じチャットで次のメッセージを送ってください。新しいチャットや再読み込みは不要です。フォルダでの最初の Copilot のチャットの前は、doctor が「AIDLC hooks have not run in this project yet」と警告します。チャットが始まるまでは想定どおりです。

1. VS Code では、最初にフォルダの作成者を信頼するか尋ねられるので、信頼します。組織が Chat: Use Hooks を off にしている場合、それを on に戻せるのは管理者だけです。
2. Copilot CLI では、尋ねられたらフォルダを信頼します。ヘッドレスの `copilot -p` の実行は決して尋ねません。一度そのフォルダで `copilot` を起動し、"Yes, and remember this folder for future sessions" を選んでください。

フォルダの信頼の詳細は [GitHub Copilot](harnesses/copilot.md) を参照してください。

<a id="codex-cli-hooks-not-trusted"></a>

### Codex CLI のフックが信頼されていない

Codex がプロジェクトのフックを実行するのは、その `/hooks` 画面でフックを信頼した後だけで、フックが変わると再び尋ねます。Codex で `/hooks` と入力し、`t` を押してすべてを信頼し、Esc を押して、同じチャットで続けてください。Codex の外からこれを代わりに行うことはできません。

<a id="opencode-plugin-not-loaded"></a>

### opencode のプラグインが読み込まれない

opencode が AI-DLC のプラグインを読み込むのは、プロジェクトのフォルダで素のまま起動したときだけです。`--pure` の下でもサブフォルダからでもいけません。opencode を終了し、プロジェクトのフォルダで `opencode` だけで再び起動してから、`/aidlc` と入力して続けてください。エージェントがこの手順であなたの依頼を止めた場合は、代わりにエージェントが示した `/aidlc --request <id>` の行を入力してください。その依頼が一度だけ続行されます。

<a id="claude-code-or-codex-started-in-a-folder-inside-the-project"></a>

### プロジェクト内のフォルダで Claude Code や Codex を起動した

どちらのツールも、`src/` のようなプロジェクト内のフォルダから `/aidlc`（Codex では `$aidlc`）を提供しますが、AI-DLC のフックが動くのは、ツールをプロジェクトのフォルダ自体で起動したときだけです。Claude Code はそこではプロジェクトのフックを 1 つも実行せず、Codex はそのフォルダからフックを実行しますが、そこではフックが起動できません。どの設定も `/hooks` の信頼も、これを変えません。チャットについてのツール自身の記録が、そのようなフォルダで起動されたことを示す場合、エージェントは何も変えずに 1 行を示します。ツールを終了し、プロジェクトのフォルダで再び起動して、示された `/aidlc --request <id>` の行を入力してください。あなたの依頼が一度だけ続行されます。doctor も同じ手順を示します。チャットがどこで始まったかを知るため、AI-DLC はその記録を読み、その中のほかのものは読みません。Claude Code では設定フォルダ（`CLAUDE_CONFIG_DIR`、無ければ `~/.claude`）の `sessions/<pid>.json`、Codex ではホーム（`CODEX_HOME`、無ければ `~/.codex`）の `sessions/` の下にあるチャットのファイルの最初の行です。そのような記録がない場合は、フックが動いていないときの通常の手順に従います。

<a id="claude-managed-policy-blocks-project-hooks"></a>

### Claude の管理ポリシーがプロジェクトのフックを止めている

`/hooks` がフックはポリシーで制限されていると報告し、設定済みのフックがゼロと表示する場合は、`/aidlc --doctor` を実行してください。Claude Code では、doctor は macOS では `/Library/Application Support/ClaudeCode/managed-settings.json`、Linux/WSL では `/etc/claude-code/managed-settings.json`、Windows では `%ProgramFiles%\ClaudeCode\managed-settings.json` とその後に旧来の `%PROGRAMDATA%\ClaudeCode\` の場所を読みます。各候補には、兄弟の `managed-settings.d/` ディレクトリの下にあるアルファベット順の JSON の断片も含まれます。実効のトップレベルの `allowManagedHooksOnly: true` は、`.claude/settings.json` が宣言するすべてのプロジェクトのフックを止めます。管理ファイルが別の場所にある場合は `AIDLC_MANAGED_SETTINGS_PATH` を設定してください。その兄弟の断片のディレクトリも自動で含まれます。

この管理設定を外せるのは Claude Code の管理者だけです。プロジェクトのフックを許可するよう頼んでください。

<a id="cursor-project-outside-a-git-repository"></a>

### git リポジトリの外にある Cursor プロジェクト

Cursor が同じ計画の承認を何度も求める、または選択が記録されなかったと言う場合は、`/aidlc --doctor` を実行してください。Cursor は git リポジトリの中にないフォルダではプロジェクトのフックを飛ばすことがあり、フックがなければ承認は記録されません。doctor が「project is in a git repository」で失敗した場合は、プロジェクトで `git init` を実行し、Cursor を完全に再起動して、尋ねられたらフォルダを信頼してください。`aidlc config --harness cursor` とコピーのインストーラーも、git リポジトリの外にプロジェクトをセットアップするときに同じ助言を表示します。

<a id="reviewer-tool-calls-refused-this-review-cannot-open"></a>

### レビュアーのツール呼び出しが拒否される（"This review cannot open ..."）

Unit ごとの Construction のレビュー中、reviewer-scope フックは、ディスパッチされたレビュアーのツール呼び出しのうち、兄弟の Unit の `construction/` のパスに届くものを拒否します（stage-protocol-reviewer-unit.md の読取り範囲）。拒否は現在の Unit を示し、レビュアーを渡されたファイルとその Unit 自身のパスへ導きます。拒否のたびに `REVIEWER_SCOPE_BLOCKED` 監査行が記録されます。自分のソースツリーに AI-DLC の Unit と無関係な `construction/` ディレクトリがある（そのため正当なレビュアーの読取りが拒否されている）場合、`/aidlc config set guard.reviewer-scope off` は、取り組んでいる作業についてレビュアーの読取り範囲の検査だけを下げます（`GUARD_DISABLED` 監査行として記録され、次の作業では on に戻ります）。`AIDLC_DISABLE_REVIEWER_SCOPE_HOOK=1` は、その読取り範囲の強制をマシン全体で無効にします。どちらでも、文章上の範囲は引き続き適用されます。どちらの設定も、クレームしたチームのチェックアウトが別の Unit の `construction/` サブツリーに書き込むことは許しません。チャットでの一般的な依頼では読取り範囲の検査は下がりません。上のスイッチを入力すれば、エージェントがその設定コマンドを実行します。スコープの変更だけで実行中のポリシーが下がることはありません。レビューが進行していないのにレビュアーが拒否される場合は、古いディスパッチの記録です。`/aidlc --doctor` のフックのドロップのカウンター（`reviewer-scope.drops`）を確認し、`<record>/.aidlc-engine/reviewer-dispatch.json` があれば削除してください（6 時間より古い記録は無視され、自動で掃除されます）。

`grep latency construction/U03-scoring/nfr.md | grep endpoint` のような通常のフィルターは許可されます。2 つ目の `grep` はパイプで渡されたテキストを検索するためです。パイプがあっても、ファイルを走査するコマンドは免除されません。再帰的な `grep`、`rg --files`、`rg -f -` は、引き続き範囲内の検索ルート、または `rg` なら現在の Unit に限った glob が必要です。`-f` で渡すパターンファイルも範囲内でなければなりません。パスのないコマンドが `.` にフォールバックして拒否された場合、メッセージはそのルートが暗黙のものであることを示します。

<a id="sensors-are-not-firing"></a>

### センサーが動かない

`/aidlc --status` の **Sensors** の行を確認してください。`classic` スコープの既定は Sensors on です。インテントの上書きや無効化のスイッチが Sensors を off にしている場合、書込み時の自動検査、ゲート開始時の検査、改訂の検査、承認時の改訂の安全網の検査は実行されません。`/aidlc --sensors on` でアクティブなインテントを再び有効にできます。`AIDLC_DISABLE_SENSORS=1` はそのインテントの設定より優先します。自動検査を再び許可するには、それ（と記録されたプロジェクトのバイパス）を解除してください。自動のセンサーが off でも、すべてのフックはインストールされたままで、明示的な `aidlc engine sensor fire` は診断用に引き続き使えます。

<a id="statusline-shows-a-cost-segment-you-dont-want-or-usage-tracking-concerns"></a>

### ステータスラインに出したくないコスト区間が出る（または使用量追跡が気になる）

Claude Code では、ステージごとのトークン使用量とコストの追跡が既定で on です。fold-usage フックがトランスクリプトの使用量を gitignore されたローカルの台帳（`aidlc/.aidlc-sessions/usage-ledger.json`）に記録し、ステータスラインが `↑<in> ↓<out> $<usd>` を付け加え、完了の監査イベントにコストの集計が載ります。どこにも何も送信されません（メトリクスの送信は別途 `AIDLC_METRICS_ENDPOINT` によるオプトインです）。ローカルの追跡をすべて止めるには `AIDLC_DISABLE_USAGE_TRACKING=1` を設定します。台帳は更新を止め、ステータスラインの区間は消え、完了イベントに集計のフィールドは付きません。既存の台帳はディスクに残ります。履歴も消したい場合は手で削除してください。フラグを外すと追跡が再開します。

**`$<usd>` の数値はローカルの見積もりで、請求額ではありません。** 同梱の料金表の **公開の定価** から計算しています（[Rate table and overrides](../reference/06-hooks-and-tools.md#レート表と上書き) を参照）。記録されたプロバイダーが Amazon Bedrock（`CLAUDE_CODE_USE_BEDROCK=1`）の場合、Bedrock が実際に請求する額は、推論プロファイル、リージョン、サービス階層、交渉済みやサブスクリプションの価格によって変わるため、見積もりは請求書と一致しないことがあります。長いワークフローのトークン量の大半はキャッシュ読込みで（割引されたキャッシュ読込み料金で課金されます）、件数と見積もりは着実に増えていきます。これは実際の使用量で、水増しではありません。この数値は個人の目安として扱ってください。

**見積もりを自分の料金で計算するには**、同梱の `.claude/tools/data/model-rates.json` と同じ形の料金ファイル（100 万トークンあたりの USD、モデルの版ごとに 1 つのキーなので、`opus-5-5` と `opus-5` は別の行）を `AIDLC_MODEL_RATES` に設定します。一部だけのファイルは、名指ししたモデルだけを変え、それ以外は同梱の既定値のままです。料金は使用量の記録時に適用されるため、変更はその時点以降のターンの計算に効きます。すでに台帳にある合計は、記録時の料金のままです。

**発表中、画面共有中、録画中などで見積もりを表示したくない場合は、コストの区間を off にします。** gitignore された `.claude/settings.local.json` に無効化のスイッチを追加します（トークン／コストの区間を消すだけで、ワークフローには影響しません）。

```json
{
  "env": {
    "AIDLC_DISABLE_USAGE_TRACKING": "1"
  }
}
```

<a id="hook-not-configured"></a>

### フックが設定されていない

フックはハーネスのネイティブの設定にプロジェクト全体で登録されます。Claude では、`.claude/settings.json` に想定どおりの `hooks` のイベントがあることを確認してください。ネイティブのプロジェクトでは、アクティブなワークフローを終えてから `aidlc config --harness claude` を実行して同梱の登録を戻します。あなた自身のフックのエントリは保たれます。コピーのチャネルのプロジェクトでは、代わりに `bun .claude/tools/aidlc.ts config --harness claude --from <the runtime/claude root you copied from>` を使います。
`--force` は不要です。登録を戻したときは注記が伝えます。
フローを変えるタイプの登録のイベント、マッチャー、コマンドが変わった場合や、同梱のフックがもう配線されていない場合、doctor は失敗します。ほかの AI-DLC の登録のずれは警告になります。あなた自身の追加のフックは、ずれの警告を出しません。チームがそのファイルで設定したステータスラインは保たれます。AI-DLC 自身のステータスラインはそこには同梱されません。各自が `/aidlc --statusline on` で自分のために on にします。
手動のコピーでは、同じ版の `runtime/<harness>/` のアーカイブからハーネスのルート全体を置き換えます（コピーが `.gitignore` や `AGENTS.md` を置き換えることはありません）。フックのコマンドを 1 つだけ修正しないでください。手動のアーカイブは Bun 形で、ネイティブの `aidlc` 実行ファイルを必要としません。

<a id="hooks-disabled-globally-disableallhooks"></a>

### フックが全体で無効（`disableAllHooks`）

Claude Code は、どの設定層の `"disableAllHooks": true` にも従います。エンタープライズの管理設定、`.claude/settings.local.json`、`.claude/settings.json`、`~/.claude/settings.json`（`CLAUDE_CONFIG_DIR` が設定されていればその下の `settings.json`）です。設定されていると、ファイルが存在して正しく配線されていても **すべての** フックが黙って飛ばされるため、ワークフローはあなたの返答を記録できません。`/aidlc --doctor` はこれを検出し、問題の層を示す **Hooks enabled** の行で失敗します。Claude Code の層の優先順位に従うため、優先度の高い `false` は低い `true` を抑えます。あなたのメッセージに対してフックが 1 つも動かなかった場合、エージェントは作業の前に自分で以下の変更を行い、Claude Code は先にあなたに尋ねます。

- 問題の層が **プロジェクトまたは利用者のファイル** なら、このプロジェクトの `.claude/settings.local.json` で `"disableAllHooks": false` を設定します。そのファイルはプロジェクトと利用者のファイルより優先するため、利用者の設定を変えずに、そのいずれでの無効化も覆い、同じチャットで効きます。再起動も `/hooks` も不要です。
- **エンタープライズの管理設定**（最も優先度の高い層）なら、プロジェクトや利用者のファイルでは上書きできません。Claude Code の管理者に、プロジェクトのフックを許可するよう頼んでください。
- **フックを off にする設定付きで Claude Code を起動した**（例: `--settings '{"disableAllHooks": true}'`）場合も、プロジェクトのファイルでは上書きできず、doctor にも見えません。その設定なしで Claude Code を再び起動してください。
- **Claude Code がすでにこのフォルダで開いている間に AI-DLC をセットアップした** 場合、そのセッションはフックを読み込んでいません（ネイティブのインストールではフックが `aidlc` を呼びますが、開いているセッションはまだそれを見つけられません）。Claude Code を終了してこのフォルダで再び起動し、エージェントが示した行を入力してください。`/aidlc --request <id>` は止めた依頼を一度だけ続行し、`/aidlc` だけなら作業が今ある所から続行します。

検査が読むのは、ディスク上の管理設定の **ファイル**（Linux では `/etc/claude-code/managed-settings.json`、macOS では `/Library/Application Support/ClaudeCode/managed-settings.json`、現在の Windows では `%ProgramFiles%\ClaudeCode\managed-settings.json` — `%PROGRAMDATA%\ClaudeCode\` は旧来の副次的な場所）と、兄弟の `managed-settings.d/` ディレクトリのアルファベット順の JSON ファイルです。Claude Code が対応するほかの管理チャネル（MDM、Windows のレジストリ、リモート／サーバー管理のソース）は **調べません**。そのため、合格の行は、検査が読めたどの設定ファイルでも解決された値が `true` ではないことを意味し、それらのチャネルが問題ないことを保証するものではありません。管理ファイルが標準でないパスにある場合は、`AIDLC_MANAGED_SETTINGS_PATH=/path/to/managed-settings.json` で検査をそこへ向けてください。そのファイルの横の断片も含まれます。

<a id="a-kiro-hook-switched-off-under-agent-hooks"></a>

### Agent Hooks で off にした Kiro のフック

Kiro では、Agent Hooks のパネルでどのプロジェクトのフックも off にでき、そのとき Kiro は `.kiro/hooks/` にあるそのフックのファイルに `"enabled": false` を書き込みます。フックはほかに何の兆候もなく動かなくなります。`/aidlc --doctor` は、すべての AI-DLC のフックのファイルでこのフラグを読みます。`aidlc-guard-tool-call` が off だと、承認済みの計画、レビュー済みの作業、AI-DLC の記録は保護されません。`aidlc-record-human-turn` が off だと、あなたの返答が記録されないため、承認は見えない回答を待ち続け、チャットで入力した `/aidlc` コマンドも直接は実行されません。どちらも、そのフックを示す行で失敗します。`aidlc-continue-workflow` も同じで、これは Kiro が Stop フックにブロックさせる場所（Kiro CLI v3。Kiro IDE は記録するだけ）でワークフローを進め続けます。ほかの AI-DLC のフックが off の場合は、何が失われるかを伝える警告になります。Kiro の Agent Hooks でフックを on に戻すか、doctor が示すファイルで `"enabled": true` を設定してください。次の AI-DLC の手順も、変更のたびに一度、作業の前の 1 行で同じことを伝えます。また `aidlc-record-human-turn` が off の間は、承認はフォルダを信頼するようにではなく、Agent Hooks で on に戻すように伝えます。フックをあなたの代わりに on に戻すものはありません。

---

<a id="kiro-ide-read-denials"></a>

## Kiro IDE の読取り拒否

<a id="kiro-ide-denies-every-read-under-kiro-rule-deny-fs_read-matching"></a>

### Kiro IDE が .kiro/ 以下の読取りをすべて拒否する（"Rule: deny fs_read matching"）

**症状**: すべてのステージ、エージェント、プロトコルの読取りが拒否され、ワークフローが止まる。

```text
Tool call denied by user's permissions. Rule: deny fs_read matching ".kiro/" Source: ~/.config/git/ignore
```

[Kiro IDE は](https://kiro.dev/docs/kiroignore/) git のグローバルな除外ファイル（git リポジトリ内の場合）と `~/.kiro/settings/kiroignore` に自動で従います。ワークスペースの ignore ファイルが適用されるのは、IDE の `kiroAgent.agentIgnoreFiles` 設定がそれを指定したときだけです（既定は `.gitignore` を含み、`[]` はワークスペースのソースを無効にします）。
Kiro IDE は各 ignore ファイルを個別に評価します。`git check-ignore` がそのパスは無視されないと報告する場合でも、プロジェクトの `!.kiro/` の否定はグローバルな `.kiro/` のルールを取り消しません。`permissions.yaml` の `fs_read` の許可でも拒否は **解除されません**。[Kiro はスコープをまたいで deny を優先します](https://kiro.dev/docs/permissions/)。

`/aidlc --doctor` を実行してください。IDE のインストール（`.kiro/agents/aidlc-aidlc.md` がある）では、問題のソースを次のように報告します。

```text
Kiro IDE ignore sources: <source>:<line> hides .kiro/
```

doctor は、エンジン自身の一覧から、エンジンがエージェントに `fs_read` で行わせる読取りを検査します。コンパイル済みのステージグラフで `harness.json` が選ぶすべてのステージについて、ステージファイルと、コンダクターがインラインで保持するペルソナとナレッジ（Standard と Minimal の深度で、ディレクティブの 8 KiB の `inline_context_paths` 上限内）、そして `stage-protocol.md` とその `stage-protocol-<name>.md` モジュール、各スキルの `SKILL.md` の横にあるファイルです。
プラグインは、どのように compose されたかにかかわらず数えます。`stage-definition.md` のようなコントリビューター専用のプロトコルファイルは読み込まれません。`SKILL.md` ファイル、IDE のコンダクターエージェント（`agents/aidlc-aidlc.md`）、`aidlc-common/conductor.md`、`tools/`、`sensors/`、`hooks/`、`scopes/`、`steering/` は、`fs_read` ではなく IDE やエンジンが読み込むため数えません。その一部だけを隠すルールは、件数と影響するフレームワークのフォルダとともに報告されます。例: `hides 11 of 110 framework files (.kiro/agents/)`。

グローバルなソースの一致は doctor を失敗させます。プロジェクトの `.gitignore` と `.kiroignore` の一致は、それらのワークスペースのファイルが適用されるかどうかを決める IDE の設定を doctor が読めないため、代わりに警告になります。

`<source>` は固定の名前です。`~/.config/git/ignore`（または `$XDG_CONFIG_HOME/git/ignore`）、`core.excludesFile`（そのパスは `git config --get core.excludesFile` で確認）、`~/.kiro/settings/kiroignore`、`.gitignore`、`.kiroignore` のいずれかです。doctor の出力はエージェントが読むため、doctor は ignore ファイルのパス、そのルール、git のエラーの本文を決して表示しません。

doctor が評価できないソースは `not evaluated` として警告し、その `fix:` の行が進め方を示します。

- **`git is not available`**: `git` を PATH に入れて doctor を再実行します。それまでは、示されたファイルを手で確認してください。git のグローバルな除外ファイルは、git が読む `core.excludesFile` で、最も具体的なものが先です。環境のコマンドスコープの設定（`GIT_CONFIG_COUNT` と `GIT_CONFIG_KEY_<n>`、`GIT_CONFIG_VALUE_<n>`、または `GIT_CONFIG_PARAMETERS`）、リポジトリの設定（`.git/config` と `.git/config.worktree`。`.git` がファイルであるリンクされた worktree やサブモジュールでは、その `gitdir:` の行が示す git ディレクトリと、その git ディレクトリの `commondir` ファイルが示すディレクトリ）、グローバルな git の設定（`~/.gitconfig`、`$XDG_CONFIG_HOME/git/config` または `~/.config/git/config`、または `GIT_CONFIG_GLOBAL` が示すファイル）、そしてシステムの gitconfig（`GIT_CONFIG_SYSTEM` が示すファイル、無ければ `/etc/gitconfig` や Git for Windows のインストール下の `etc/gitconfig` のような git のインストールのシステムファイル。`GIT_CONFIG_NOSYSTEM` が true の場合は飛ばす）です。各ファイルの `include.path` と、該当する `includeIf.<condition>.path` のエントリを再帰的にたどってください。どれも設定していない場合、ファイルは `$XDG_CONFIG_HOME/git/ignore`、`XDG_CONFIG_HOME` が未設定なら `~/.config/git/ignore` です。
- **`git rev-parse exit <n>`** または **`git config exit <n>`**: ディスク上にリポジトリがあるのに、git がこのプロジェクトを拒否しています。プロジェクトで `git status` を実行して理由を確認してください。所有者が疑わしい場合は、git が表示する `git config --global --add safe.directory` のコマンドを実行します。その間に、プロジェクトの外（例えばホームディレクトリ）で `git config --get core.excludesFile` を実行して git のグローバルな除外ファイルを見つけ（出力がなければ `$XDG_CONFIG_HOME/git/ignore`、`XDG_CONFIG_HOME` が未設定なら `~/.config/git/ignore`）、それを確認してください。
- **それ以外の理由**（`did not finish` となった git のコマンド、つまりタイムアウトなど）: 示されたファイルを手で確認してください。git のグローバルな除外ファイルは、`git config --get core.excludesFile` が表示するものです。

シェルで `GIT_CONFIG` が設定されている場合は、`git config --get core.excludesFile` を実行する前にそれを外してください。例えば `env -u GIT_CONFIG git config --get core.excludesFile` です（PowerShell では先に `Remove-Item Env:GIT_CONFIG` を実行）。`GIT_CONFIG` は `git config` だけを別のファイルに向けるため、そうしないとコマンドは git が適用しないファイルを示してしまいます。doctor も同じようにそれを外します。

示された行のルールを削除するか狭めてから、`/aidlc --doctor` を再実行してください。リポジトリごとの個人的な ignore は、そのリポジトリの `.git/info/exclude` に置いてください。git はそれに従い、Kiro はそれを ignore のソースとして扱いません。別のファイルでの否定や permissions の許可は、問題のルールを直すことの代わりにはなりません。

---

<a id="state-file-issues"></a>

## 状態ファイルの問題

**症状**: オーケストレータが状態の壊れを報告する、またはワークフローの動きがおかしい。

<a id="state-file-missing"></a>

### 状態ファイルがない

状態ファイルは、Initialization の間、または `/aidlc` にスコープを渡したときに作られます。

- `/aidlc --status` を実行し、アクティブなワークフローがないことを確認する
- `/aidlc` または `/aidlc <scope>` を実行し、新しいワークフローを始める

<a id="state-file-corrupted"></a>

### 状態ファイルが壊れている

`validate-state.ts` フックは、コンパクションのたびに必須のセクション 2 つ、`## Stage Progress` と `## Current Status` を確認します。修復の手順:

1. `/aidlc --doctor` を実行し、報告された状態、グラフ、フックの問題に対処する
2. 生成された Stage Progress の行が古い場合は、状態の再同期を担うエンジンの経路を再実行する。`/aidlc` でワークフローを開始または再開するか、`/aidlc --scope <scope>` でスコープを変え、コンパイル済みのグラフとスコープのグリッドを適用し直す
3. `.claude/knowledge/aidlc-shared/state-template.md` は、セクションとフィールドの契約としてだけ使う。テンプレートからステージの行を手で復元しない
4. 記録を修復できない場合は、`/aidlc intent archive <name>` で終了し（`aidlc/spaces/<space>/intents/` の下のレコードディレクトリは保持される）、`/aidlc` を実行して新しく始める

---

<a id="dispatched-stage-timeouts"></a>

## ディスパッチステージのタイムアウト

**症状**: ディスパッチするステージ（Reverse Engineering、Practices Discovery、User Stories、Code Generation）がエラーや途中で切れた出力を返す。

<a id="what-happens"></a>

### 何が起きるか

フレームワークは組み込みの再試行の手順に従います。

1. **自動の再試行**（コンテキストを減らしたプロンプトで）
2. **再試行も失敗した場合**、選択肢は 2 つ:
   - **インラインで実行する** — メインの会話でステージを直接実行する（サブエージェントの境界なし）
   - **飛ばして後で戻る** — ステージを未完了として印を付け、後で戻る

<a id="manual-recovery"></a>

### 手動の復旧

`/aidlc` を再実行します。`[-]`（進行中）の状態を検出し、そのステージを続けます。最初からやり直すには redo と伝えます。何が失敗したかは、`audit/` シャードのエラーのエントリを確認してください。

---

<a id="approval-gate-stuck"></a>

## 承認ゲートで止まる

**症状**: ワークフローが承認ゲートであなたの応答を待っている。

<a id="how-to-proceed"></a>

### 進め方

プロンプトが出たら応答を入力します。選択肢は次です。

- **Approve** — 次のステージへ進む
- **Request Changes** — 改訂のためのフィードバックを出す

Kiro IDE で、すでに返答したのにワークフローがまだ待っている場合は、[Kiro IDE のフックが動かない](#kiro-ide-hooks-not-running) を参照してください。Kiro CLI では、[Kiro CLI のフックが動かない](#kiro-cli-hooks-not-running) を参照してください。

<a id="revision-loop-escape-hatch"></a>

### 改訂ループの抜け道

同じステージで改訂を 3 周すると、3 つ目の選択肢 **Accept as-is** が出ます。現在の版をアーカイブして先へ進みます。AI-DLC はこの回数を作業の記録に保持するため、中断して再開しても、新しいチャットで続けても、この選択肢は引き続き表示されます。

<a id="skipping-a-stage"></a>

### ステージを飛ばす

`/aidlc --stage <target>` で別のステージへ飛びます。間のステージは、状態ファイルで `[S]`（スキップ）になります。

<a id="a-reviewed-document-needs-another-change"></a>

### レビュー済みの文書をまた変えたい

最終レビューがすでにその文書を覆っている場合、レビューが別の内容を黙って認証しないよう、直接の編集は止められます。

- ステージがアクティブ、または承認待ちの間は、変更を説明して **Request Changes** を選ぶ。判断はゲートが開く前でも記録できる。
- ステージが `[R]` の間は、`/aidlc --stage <slug>` でやり直す。
- ステージが `[x]` になった後は、レビュー済みのソースの状態を戻すか、`/aidlc --stage <slug>` で戻ってやり直す。

ワークスペースのソースだけが変わり、1 回の復旧レビューがまだ使える場合は、古い Review セクションを置き換える前に、その復旧の要求を始めてください。古い状態が続く間、保留中の要求は、そのステージまたは Unit への書込みだけを一時的に許可します。レビュー済みのワークスペースのソースを戻す、判定を記録する、別のセッションを開始または再開する、のいずれかで凍結は再び有効になります。出力文書のバイト列を戻しても、監査に記録された成果物の古さは消えません。セッションを再起動した後は、Review セクションを置き換える前に、同じ保留中の要求を再試行してください。一致する判定が記録されるまで、ゲートは閉じたままです。

<a id="a-directory-source-manifest-is-refused-because-it-contains-ignored-output"></a>

### 無視された出力を含むため、ディレクトリのソースマニフェストが拒否される

**症状**: ビルドの後、`src/` のようなディレクトリの主張が
`contains ignored application source "src/main.js.map"` と答える。

Git の ignore ルールだけでは、ファイルはレビューのソース境界から外れません。
その境界の外の生成された出力については、その正確なパス（またはその出力ディレクトリ）を、
リポジトリのルートの `.aidlc-source-paths.json` の `exclude` に追加してください。
例えば `{"version":1,"exclude":["src/main.js.map"]}` です。その後、レビューを再試行します。
ディレクトリの主張は、その横のソースを引き続き覆えます。登録された `paths` の
エントリは `exclude` より優先し、まだ境界の中にあるほかの無視されたファイルについては
拒否が残ります。正確なファイルの主張は、引き続き受け入れ可能なソースを示さなければなりません。
除外しても、無視された出力がレビューの証拠になるわけではありません。

<a id="an-exact-source-manifest-file-is-refused-because-git-ignores-it"></a>

### Git が無視しているため、ソースマニフェストの正確なファイルが拒否される

**症状**: `source-manifest.json` にすでに載っている正確なファイルが
`is ignored by Git and cannot be source-review evidence` と答える。

無視された正確なファイルが受け入れられるのは、HEAD がすでにそれを追跡しているときか、
ソースとして明示的に登録されているときです。Git のインデックスに追加するだけ（強制追加を含む）や、
jj だけで追跡しても、HEAD に含まれることにはなりません。
レビュー対象のソースとするファイルについては、`{"version":1,"paths":["src/runtime.js"]}`
のような登録を、そのソースリポジトリのルートの `.aidlc-source-paths.json` にマージしてから、
レビューを再試行してください。既存のエントリは残します。
登録されたパスは `exclude` より優先します。
`node_modules/` やセンサーのキャッシュのように、AI-DLC が決してソースとして扱わないフォルダの
下のファイルは登録できません。代わりに、その正確な主張を外してください。

ソースではない出力については、正確な主張を外してください。ソースとして登録するのではなく、
レジストリの `exclude` リストを使って出力をソース境界の外に置きます。`/` で終わる
ディレクトリの主張には、無視された子孫についての別の検査があります。正確なファイルの
受け入れは、その検査を変えません。

<a id="code-generation-cannot-complete-because-files-changed-that-no-unit-covers"></a>

### どの Unit も覆っていないファイルが変わったため、Code Generation を完了できない

**症状**: Code Generation を承認すると、"N changes made during Code
Generation that no Unit's review covers (...)" と答える。

ステージの間に、どの Unit のソースマニフェストにも載っていない何かがワークスペースで
変わりました。その行は 3 つの通り道を示し、アシスタントは当てはまるものを選びます。
変更を行った Unit がそのパスを載せて、もう一度レビューを受ける。誰も意図しなかった変更は
元に戻す。ソースではないパス（リポジトリの中に書かれたツールのキャッシュ、ビルドの出力、
このプロジェクトのコードではない入れ子のリポジトリ）は、`.aidlc-source-paths.json` の
`exclude` の下に名前を挙げてソースの検査から外す（記録されたリポジトリや記録された
チェックアウトでは、それ自身のフォルダにあるファイル）。除外はすぐに効き、それ以上のレビューは
要りません。その行を削除すればパスは戻ります。プロジェクトの `.gitignore` がすでに無視している
パスは決して数えません。このフォルダで開いているほかの作業が自分の Unit のソースマニフェストに
載せているファイル（ここで自分の作業をビルドしている 2 つ目のチャット）や、それが載せている
フォルダの下にあるものも数えません。それはほかの作業の変更で、その作業自身の検査が扱います。
終えるつもりのない作業をアーカイブすると（`/aidlc intent archive <name>`）、その主張は
終わります。Guard Policy が relaxed または off の場合は、変更は保たれ、代わりに一度だけ伝えられます。

Unit のない計画では、同じ変更に対して "the project source changed after <reviewer> reviewed it"
（または、1 回の復旧レビューを使った後は "changed again after the one recovery review"）と答え、
その後に何が変わったかと、ソースではないパスについての同じ通り道が続きます。そこでも除外は
すぐに効き、それ以上のレビューは要りません。

<a id="plan-approval-asked-twice-for-the-same-plan"></a>

### 同じ計画で Plan Approval を二度尋ねられる

**症状**: すでに承認した計画について、Code Generation が Plan Approval の質問を再び出す。

Plan Approval は、計画、ユニットテストの指示、Testing Contract の内容、対象、現在のステージの試行に結び付きます。`/aidlc` の再実行、セッションの再起動やコンテキストのコンパクション、Stop フックの探査、`/aidlc --status` では開き直され **ません**。計画のチェックボックスを付けても開き直されず、レビューの記録が計画に触れることもありません。

同じ対象と試行について、計画、テスト指示、Testing Contract の編集が承認を開き直すのは、Guard Policy が `strict` のときだけです。`relaxed` や `off` では、更新された内容で作業が続き、元の承認の記録はそのまま残ります。あなたがその編集を承認したとは主張しません。`/aidlc --status` の `Guard Policy:` の行が実効の設定を示します。計画の再確認はいつでも頼めます。

コード生成が計画についてまったく尋ねずに始まる場合、この作業では plan approval が off です。status はその出どころを示します。例: `Plan Approval: off (from scope poc)`。各計画を示す行は、いつでもその計画の確認を頼めることを伝えます。すべての計画について尋ねるよう頼むこともできます。[Plan approval](13-customization.md#plan-approval) を参照してください。

Testing Posture、スコープ、テスト戦略、プロジェクト種別の変更も、同じインテント、対象、試行の中では同じ規則に従います。必要に応じて現在の契約と指示を更新してください。ガードが下がっていれば、それらの入力が変わったというだけの理由で再び承認を求めることなく、実行を続けられます。

再び尋ねられた場合は、何が変わったかと、どの規則が当てはまるかを確認してください。

- plan-approval のガードが on の間の、計画の内容や埋め込まれた Testing Contract（タスクのマーカーのチェックや、レビューの記録が存在する前に記録されたレビューが残した終端の `## Review` セクションを除く）
- ユニットテストの指示の内容、そのどの 1 バイトでも。指示は developer に全文渡されるためバイト単位で一致して結び付き、承認後に追加したセクションは、plan-approval のガードが on なら承認を開き直す
- plan-approval のガードが on の間の、Testing Posture、スコープ、テスト戦略、プロジェクト種別
- アクティブなインテント、Unit、ステージの対象
- ステージの試行: 後ろへのジャンプ、Request Changes、ゲートの却下、ワークフローの再開

質問は何についてのものかを示します。承認後にほかのコードが動いた場合（`git pull`、別の Unit の着地）は再び尋ねません。ビルドは続き、どのファイルが動いたかが伝えられます。例外は、`strict` の下で Unit を並列にビルドする場合です。承認した後の変更（あなたの編集やコミット、`git pull`）があると、Unit の準備の前に再び尋ね、あなたがそれを元に戻すか Guard Policy を `relaxed` にするまで、次の Unit の着地を止めます（[Guard Policy](13-customization.md#guard-policy) を参照）。回答とビルドの間に起きること、つまり長いチャットのコンテキストのコンパクション、作業の保留と再開、先に出た別の質問も同様です。先にもう一度見たい場合は、それらの直後も含めて「review the plan」と言ってください。それ以上ビルドする前に、計画が再び承認のために示されます。

<a id="plan-approval-is-not-recorded"></a>

### Plan Approval が記録されない

**症状**: Plan Approval の質問に答えたのに、AI-DLC がそれを再び示す。

回答は、この作業のどのチャットからでも、自分の言葉で（「1」「approve」「looks good」「rename the handler」）数えられます。エージェントはあなたがした選択を、あなたの言葉を添えて記録します。質問が戻ってくるのは、エージェントが選択を記録できなかったときだけで、最も多いのは、質問が示される前に返答が届いた場合や、ハーネスがそれを AI-DLC に渡さなかったチャットの場合です。示された質問に答えてください。何度も戻ってくる場合は `/aidlc --doctor` を実行してください。プロンプトのフックが動かないハーネスは、どの返答も記録できません。質問が待っている間に長いチャットがコンテキストをコンパクトしても質問は開いたままなので、あなたの回答は引き続き数えられます。

プロジェクトのファイルをすべては読めない、またはワークスペースのソースを結び付けられない（ループするリンク、読むには大きすぎるツリー、プロジェクトの外のソースパス）と AI-DLC が言う場合、どうなるかは設定によります。Guard Policy が strict で plan approval が on なら、ビルドが何から始まるかを示せるものがないため、計画はまだ承認できません。それ以外では、計画の質問はいつもどおり尋ねられ（plan approval が off なら、計画は書かれたとおりにビルドされます）、ビルドはプロジェクトのファイルの検査なしで始まり、そう伝える 1 行が示されます。ファイルを検査させるには、メッセージが示すソースの境界を修復し（問題のパスを `.aidlc-source-paths.json` の除外リストに追加する。形は `{"version":1,"exclude":["<path>"]}` です。除外ディレクトリの下の本物のソースをその paths リストで宣言する、壊れたシンボリックリンクを削除する）、`/aidlc`（Codex では `$aidlc`）を実行してください。`/aidlc --doctor` には、失敗したパスを示し、これらのどれがあなたに当てはまるかを伝える「Workspace source boundary binds」の検査があります。

プロジェクトの中に置いた有効な Git のチェックアウトは、リンクされた worktree を含め、オブジェクトストアを jj と共有できます。jj が作ったパックから Git が読めるコミットについて、古い AI-DLC のインストールが "no resolvable HEAD commit" と報告する場合は、AI-DLC を更新し、プロジェクトのインストールを更新してください。リポジトリの再パックや jj の設定変更は不要です。本当に存在しない、または読めない HEAD オブジェクトは、引き続き修復が必要です。

計画の Testing Contract が拒否された場合、メッセージは 3 つの原因のうちの 1 つを示します。ブロックがない、有効な JSON でない、描画後に変わった、のいずれかです。修復は 3 つとも同じで、`render` を再実行し、`## Testing Contract` セクション全体を置き換えます。ブロックが変わったのは、たいていシェルのコマンドがファイルを書き直して文字を再エンコードした場合です（例えば PowerShell の `Set-Content`）。成果物はファイル編集ツールで編集します。あなた自身の編集がブロックを壊した場合は、アシスタントが修復し、編集された計画をビルドするかを 1 回尋ねます。

**旧来の Kiro IDE のウィンドウ。** 入力したテキストを AI-DLC に渡さない Kiro IDE のビルドは、ピッカーだけで、旧来の記録済みの判断と回答のステップを通じて計画を承認します。そこでは回答はそれが与えられたチャットのセッションに結び付きます。プロジェクトのファイルを検査できないときでも、それを選ぶか、そう言うことで、とにかく計画をビルドするようアシスタントに頼めます。それはファイルの検査なしのあなたの承認として記録されます。Kiro IDE を更新すれば、どのチャットからでも自分の言葉で答えたり、ファイルを編集したりできます。

---

<a id="a-bolt-attempt-was-set-aside-getting-the-files-back"></a>

## 保留したBoltのファイルを取り戻す

試行のレビュー済みのファイルが再び変わり、許される 1 回の再レビューがすでに使われている場合、復旧はその試行を保留することがあります。復旧の abort の `--discard` は、古いチェックアウトとブランチを削除する前に、追跡対象のファイルと無視されていない未追跡ファイル（チェックアウトがすでにない場合は残っているブランチの先端）とレビュー済みのソース ref をローカルの Git に保存し、新しい試行を始められるようにします。
`--discard` なしの通常の Abort はチェックアウトをその場に残し、`parked_ref: null` を返し、`parked_stamp`、`parked_mode`、`parked_repo`、`restore_operation`、`restore_hint`、`restore_hint_error`、`parked_excludes` はありません。
discard の後、アシスタントはなぜ試行を保留したかを伝え、表示用のヒントを描画できたかどうかにかかわらず、`restore_operation` がある場合にだけ復元を提案します。
成功した abort はどれも `reason: "aborted"` を保持し、指定した `--reason` の本文を追加の `abort_reason` フィールドに返します。試行が保留された場合、結果には保存された記述子が含まれます。`parked_ref`、`parked_stamp`、`parked_mode`（`snapshot`、`branch-tip`、`evidence-only`）、`parked_repo`（プロジェクトルートなら `null`、それ以外は兄弟のリポジトリの名前）です。

ファイルが保存されていれば、復元を頼んでください。アシスタントは保存された結果の `restore_operation` を使います。スタンプが分かっていれば、経路 `worktree`、引数 `["restore", "--slug", slug, "--parked", stamp, "--repo", repo ?? ".", "--intent", recordDirName, "--space", space]` です。最後のセレクターは所有するインテントを固定します。アシスタントは、インストールされた `{{INVOKE}} engine worktree <args...>` の経路を、列挙された各引数をそのまま別々の argv 引数として呼び出し、シェルコマンドへ連結することはありません。`restore_hint` は人間向けの表示テキストにすぎず、アシスタントの実行の入力ではありません。メインのプロジェクトのチェックアウトから実行する同等の手動のコマンドは次のとおりです。

```bash
aidlc engine worktree restore --slug <slug> --parked <stamp> --repo <name|.> --intent <record-dir-name> --space <space>
```

操作には、兄弟のリポジトリなら `--repo <name>`、ルートなら `--repo .` が常に含まれます。任意の表示用のヒントは、選択したシェル向けに安全に描画されます。ネイティブのインストールでは上の接頭辞を使い、Bun ベースのコピーインストールでは、ハーネスのディレクトリに置き換えて `bun .claude/tools/aidlc-worktree.ts` を使います。安全な描画が失敗した場合（例えばハーネスのディレクトリが不正なため）、結果は `restore_hint` を省き、理由とともに `restore_hint_error` を示します。型付きの操作は引き続き使えます。これは証拠だけが保存されたことを意味せず、復元の提案を取り下げるものでもありません。

操作の正確なスタンプ、リポジトリ、所有するインテントのセレクターを省かないでください。`--parked` がなければ、restore は最新の保存された head を選びます。手動で呼び出す場合、1 つのリポジトリにだけ存在する正確なスタンプは、一般的な slug の曖昧さより先にそのリポジトリを選びます。それでも選択が曖昧なら、doctor の正確な操作を、`--repo <name>` か、プロジェクトルートなら `--repo .` とともに使ってください。

保存された名前空間は分かっているがその discard の記述子が使えない場合、フォールバックは `parked_ref` を保持し、スタンプが厳密に解析できるときだけその名前空間から `parked_stamp` を導きます。そうでなければ `parked_stamp` は `null` です。
リポジトリ、保存されたモード、最新の試行の選択を推測する代わりに、`parked_mode: null` と `parked_repo: null` を報告し、`restore_operation`、`restore_hint`、`restore_hint_error`、`parked_excludes` を省きます。
代わりに `recovery_hint` が、保留した試行とその正確な restore コマンドを一覧するために doctor を実行するよう求めます。このヒントは平易な案内で、実行可能な操作ではありません。アシスタントは、フォールバックだけを根拠に、どのファイルが保存されたかを主張したり、復元を提案したりしてはいけません。名前空間が保存されなかった場合、`parked_ref` は `null` で、`parked_stamp`、`parked_mode`、`parked_repo`、`restore_operation`、`restore_hint`、`restore_hint_error`、`parked_excludes`、`recovery_hint` はありません。

レビューの証拠だけが残った場合、discard は `parked_mode: "evidence-only"` と `parked_commit: "-"` を報告します。abort は ref、スタンプ、モード、リポジトリを保ちますが、`restore_operation`、`restore_hint`、`restore_hint_error`、`parked_excludes` を省きます。アシスタントは「Nothing of its working files remained to save; only its review evidence was kept.」と伝え、復元は提案しません。その試行を restore で選ぶと、`--raw` を付けても `no restorable files were parked for <slug> <stamp>; only review evidence was kept` で拒否します。

復元に成功したら、返された `worktree_path` を開いてください。通常は `.aidlc/restored/bolt-<id8>_<slug>-<stamp>` です（アップグレード前の試行では記録された旧来の名前）。これは新しい稼働中の試行とは別物です。ファイルを復元しても、古い試行が再開したり、そのレビューが現在のものになったりはしません。
これはローカルの復旧で、リモートのバックアップではありません。古いチェックアウトがすでになかった場合は、残っているブランチの先端とレビューの証拠だけを保存できました。ブランチもなかった場合は、レビューの証拠だけが残り得ます。

**制限は `parked_mode` によります。** スナップショットは `parked_excludes: ["ignored files", "eol/text=auto normalization"]` を報告します。無視された未追跡ファイルは保存されず（追跡対象のファイルは含まれます）、保存中に正規化が改行コードを変えることがあります。正規化されたバイト列は、`--raw` を使っても戻せません。ブランチの先端は代わりに `["uncommitted files (no working tree existed)"]` を報告し、アシスタントは「I kept its committed work; there were no uncommitted files to save.」と伝えます。
スナップショットは保存された blob を直接復元し、ブランチの先端は `--raw` を付けない限り通常のチェックアウトの変換を使います。
フィルターの失敗と生の復旧の詳細は、[restore コマンドのリファレンス](12-cli-commands.md#aidlc-engine-worktree-restore-recover-files-from-a-set-aside-attempt) を参照してください。

保存された試行を見つけるには `/aidlc --doctor`（または `aidlc doctor`）を実行してください。その情報としての **Parked attempts** セクションは、slug、スタンプ、経過日数、モード、復元済みチェックアウトの有無、そして正確な `--parked <stamp>` と明示的な `--repo <name>` または `--repo .` の引数に、所有する `--intent` と `--space` のセレクターが続く型付きの復旧の操作を一覧します。JSON のすべてのエントリは `purge_operation` を持ち、復元可能なエントリだけが `restore_operation` を持ちます。それぞれ経路 `worktree` と、シェルのコマンド文字列ではなく argv としてそのまま渡す引数を持ちます。
任意の `restore_command` と `purge_command` は人間向けの安全な表示テキストです。描画が失敗した場合、対応するコマンドは省かれ、操作は残したまま `restore_command_error` または `purge_command_error` が理由を説明します。evidence-only のエントリは、purge の操作とそのコマンドまたはエラーのフィールドだけを持ちます。ありえない日付や時刻は、JSON では `age_days: null`、人が読む出力では `unknown` になります。保存された試行は警告でも失敗でもありません。

doctor は、名前空間付きの試行をインテントのレジストリの UUID を通じて、旧来の試行を正確な `WORKTREE_DISCARDED` の `Parked ref` の来歴を通じて解決します。所有者が不明または曖昧なものと、帰属できない旧来の保留は一覧されません。
不要になったら、先に復元したチェックアウトを削除してから、次を実行します。

```bash
aidlc engine worktree purge --slug <slug> --parked <stamp> --repo <name|.> --intent <record-dir-name> --space <space>
aidlc engine worktree purge --slug <slug> --older-than 30 --repo <name|.> --intent <record-dir-name> --space <space>
```

どちらのスタンプのセレクターもない purge は、選択したインテントの Bolt の保存されたスタンプをすべて削除します。
`--older-than` は負でない有限の日数を受け付け、`-N` の接尾辞を無視して、UTC のスタンプの時刻がそれより厳密に古いものを選びます。厳密な暦の解析器は、ありえない日付や時刻を正規化せずに拒否します。経過日数で絞り込む purge は、解析できないスタンプを残し、それらを `skipped_unparseable` で報告します。この JSON 配列は常にあり、それ以外では空です。正確なスタンプの指定やすべてのスタンプの purge では、解析できないスタンプも削除できます。`--older-than` は `--parked` と組み合わせられません。選択した復元済みのチェックアウトが存在する間は、移動していても purge は拒否し、稼働中の Bolt のチェックアウトを削除することはありません。コピーインストールでは同じ Bun のツールの接頭辞を使ってください。[purge のリファレンス](12-cli-commands.md#aidlc-engine-worktree-purge-remove-recovery-refs) を参照してください。

restore と purge は、選択や変更の前に、未知のフラグや重複したフラグを拒否します。コマンドのリファレンスにあるフラグだけを使ってください。復旧のセレクターと doctor は、プロジェクトルート（`.`）と、同じ slug の `WORKTREE_CREATED` または `WORKTREE_DISCARDED` 監査の `Repo` フィールドに記録された有効な Git リポジトリを、それらの兄弟の名前がシンボリックリンクであっても受け入れます。フレームワークは、試行の worktree や保留を記録したまさにその場所で復旧できます。この受け入れは slug 単位で、ほかの slug の記録がこの slug のリポジトリの集合を広げることはありません。現在または過去のインテントのリポジトリ一覧に含まれるだけでは、シンボリックリンクは受け入れられません。
インテントの一覧の候補と、記録されていない発見済みの兄弟は、正規化したパスが正規化したワークスペースルートの直下にある、実在する直下の子ディレクトリでなければなりません（`isWorkspaceRepoDir`）。同じ slug の監査の来歴を持たない任意のパスやシンボリックリンクの別名は拒否されます。これらの復旧のセレクターは、稼働中の create/discard コマンドや、必要な人間の同意を変えません。

---

<a id="context-compaction"></a>

## コンテキストのコンパクション

**症状**: Claude Code がそれまでの会話のコンテキストを要約した。セッションが最近の議論を「忘れた」ように感じることがある。

<a id="what-is-preserved"></a>

### 残るもの

レコードディレクトリのすべての成果物、`aidlc-state.md`、`audit/` シャードはディスクに残ります。失われるのは、メモリ上の会話のコンテキストと、まだファイルに書いていない途中の作業だけです。

<a id="how-to-recover"></a>

### 復旧の仕方

コンパクションの後に `/aidlc` を実行します。フレームワークは次を行います。

1. `aidlc-state.md` を読み、ワークフローの位置を読み込む
2. 作業が止まったところから続ける

進行していたステージをもう一度行わせるには、「redo this stage」と言ってください。

<a id="the-build-stops-after-a-compaction"></a>

### コンパクションの後にビルドが止まる

**症状**（GitHub Copilot）: コード計画を承認し、ビルドが始まったが、チャットがコンパクトされた後、アシスタントが試みるビルドのステップがすべて拒否される。

あなたの承認、ワークフローの状態、すでに書かれたすべてのファイルは保たれています。チャットから失われたのは、アシスタントがまだファイルに書いていなかったものだけです。コンパクションの後、アシスタントは何かをビルドする前に、自分のステップをもう一度読まなければなりません。単独のコマンドとして `next` を実行すると、承認済みのビルドを再びあなたに尋ねることなく、そのまま返します。その `next` が実行されるまで、`/aidlc --doctor` はステップが古くなっていることを、時刻と理由（チャットがコンパクトされた、またはステップが出された後にワークフローの状態が変わった。分かる場合は何が変わったかを示す）とともに表示します。

---

<a id="audit-log-growing-too-large"></a>

## 監査ログが大きくなりすぎる

**症状**: 長いプロジェクトで、このクローンの監査シャードが数千行になった。

長いプロジェクトのシャードは設計上大きくなります。そのままにしておいてください。エンジンは `audit/` のすべてのシャードを読んで、どのステージをあなたが承認し、どの Unit を完了したかを知ります。そのため、シャードを `audit/` の外へ移すと、その作業は未完了と数えられ、エンジンが再びそれを割り当てます。（PreToolUse ガードは、エージェントのファイルやシェルのツールによる `audit/` への書込みを拒否します。）

<a id="git-considerations"></a>

### git について

`audit/` シャードはコミット対象です（gitignore されません）。[コミットするものと Gitignore に入れるもの](14-artifacts-reference.md#コミットするものと-gitignore-に入れるもの) を参照してください。各クローンは自分の `<host>-<clone>.md` シャードを書くため、並行する追記がマージの衝突を起こすことはありません。

<a id="moved-copied-or-synced-projects"></a>

### 移動、コピー、同期したプロジェクト

`aidlc/.aidlc-clone-id` は、このクローンのトークンと、最初に使われたホスト名を記録します。そのため、マシンの名前が変わったり、フォルダが別のノート PC にコピーまたは同期されたりしても、シャードの名前は変わらず、作業は 1 つのシャードで続きます。新しい `git clone` は独自のトークンとシャードを持ちます。1 つのフォルダの 2 つのコピーは 1 つのクローンなので、2 人（または 2 台のノート PC）が同時に作業する場合は、それぞれに独自の `git clone` を用意してください。同期ツールが `<host>-<clone> 2.md` のような競合コピーを残した場合、AI-DLC はそれが元と共有する行を 1 回だけ読むため、完了した作業は引き続き数えられ、そのコピーはそのままで構いません。チームの Unit 所有では、Unit の着地は、そのコピーを含め、想定していないファイルがあれば引き続き止まります。そのファイルを示します（`Unit landing requires a clean source worktree; commit or stash: ...`）。

以前のリリースのときからそのようなコピーがプロジェクトにあり、作業を続けていた場合、コピーがあった間に完了した Unit が、アップグレード後にもう一度割り当てられることがあります（コピーができる前に完了した Unit は再び数えられます）。何も削除されません。Unit のファイルはまだそこにあるため、ほとんどのステージでは、もう一度完了させても記録されるだけです。Code Generation の Unit は、計画の承認をもう一度求め、ブランチにすでにあるコードから再びビルドすることがあります。これは 1 回だけ起き、繰り返しません。予定されている後続の対応で、それも解消されます。

狭いケースが 1 つあります。自身の worktree でビルドされ、アップグレードした時点で完了していたがまだマージされていなかった Code Generation の Unit です。再びビルドすると `Worktree directory already exists` または `resume requires the completed, merged prior Bolt` で止まります。`aidlc engine worktree discard --slug <unit>` を実行してください。その worktree を削除する前に以前の試行のファイルを保留し、次の `/aidlc` が Unit を再びビルドします。`aidlc engine worktree restore --slug <unit>` で、いつでも以前のファイルを別のチェックアウトへ戻せます。

---

<a id="lock-files-left-behind"></a>

## ロックファイルが残る

**症状**: フックが少しハングしてからスキップする。その後の監査エントリが書かれない。

監査のフックは、並行する書込みを防ぐため、`mkdir` ベースのロック（`lib.ts` 経由）を使います。フックが中断されると、ロックのディレクトリが残ることがあります。ロックファイルはシステムの一時ディレクトリ（`os.tmpdir()` — 通常、macOS/Linux では `/tmp/`、Windows では `%TEMP%`）に作られます。

<a id="finding-stale-locks"></a>

### 古いロックの探し方

```bash
# macOS / Linux
ls -la /tmp/.aidlc-*

# Windows (PowerShell)
Get-ChildItem $env:TEMP -Filter ".aidlc-*"
```

ロックのディレクトリは、システムの一時ディレクトリ内で `.aidlc-audit-<hash>.lock` と `.aidlc-subagent-<hash>.lock` という名前です。

<a id="clearing-stale-locks"></a>

### 古いロックの消し方

まず `/aidlc --doctor` を実行してください。自動で解除するのは、終了したことを証明できる世代、生成の世代がもう一致しない再利用された PID、所有者のスタンプが書き終わっていない（ない、空である、または途切れている）古いロックだけです。一致する、または不明な生きた世代、有効な所有者を示さないスタンプ、読めないスタンプは報告しますが、削除しません。

手動で後片付けをする前に、影響を受けるロックを使っている AI-DLC のプロセスをすべて止め、所有とプロジェクトが静止していることを確かめ、診断の証拠を保存してください。調べるのは示されたロックだけにし、ロックのディレクトリを一括で削除しないでください。ロックと、所有者のスタンプ付きの `.reap` の復旧ゲートは一時的なもので、必要に応じて作り直されます。`.gate-mutex` ファイルは永続的な advisory-lock の基点で、一時ディレクトリに空のまま残ることがあります。空のファイルは古い所有者の証拠ではありません。プロジェクトのトランザクションのロックは、[上の所有の確認](#transaction-lock-ownership) を使います。

---

<a id="statusline-issues"></a>

## ステータスラインの問題

<a id="shows-ready-when-workflow-is-active"></a>

### ワークフローが動いているのに "ready" と出る

ステータスラインは `aidlc-state.md` の `**Lifecycle Phase**` フィールドを読みます。そのフィールドがないか空なら、`[AIDLC] ready` にフォールバックします。

**直し方:** `/aidlc --doctor` を実行して状態ファイルの健全性を確認します。`## Current Status` セクションに `**Lifecycle Phase**` のエントリがあることを確認します。

<a id="shows-stale-data"></a>

### 古いデータが出る

想定どおりの動きです。ステータスラインが更新されるのは次に状態ファイルが書かれたときで、通常はステージの遷移のときです。

<a id="not-appearing-at-all"></a>

### そもそも出ない

1. AI-DLC のステータスラインは、セットアップで選んだか on にしたときだけ表示される。
   `/aidlc --statusline on`（Codex では `$aidlc --statusline on`）を実行する。Claude
   Code では、それはあなた自身の `.claude/settings.local.json` に入る。組織の管理設定が
   選ぶステータスラインは引き続き優先する。
2. `aidlc doctor` を実行し、報告されたネイティブのコマンドやホストの配線を修復する。
3. コピーインストールでは、ホストのプロセスの PATH に Bun があることを確認する。
4. 状態ファイルがなければ、`[AIDLC] ready` が想定どおりの出力。

---

<a id="using-doctor"></a>

## `--doctor` の使い方

ユーティリティコマンド `--doctor` はセットアップを検証します。何かおかしいと思ったら実行してください。

```
/aidlc --doctor
```

検査するのは次です。前提（`bun`）、フックの有無（`settings.json` が配線するフレームワークのフックがすべて `.claude/hooks/` に存在しなければならず、配線されているのに存在しないフックは目立つ形で失敗する。AI-DLC 以外の有効な独自 `statusLine` は、配線されていない `aidlc-statusline.ts` を意図的に対象外にする）、フックが全体で無効でないこと（Claude Code のどの設定層でも、解決された `disableAllHooks: true` は目立つ形で失敗する）、管理されたプロジェクトのフックのポリシー（`allowManagedHooksOnly: true`）、プロジェクト構造（`settings.json`）、ワークスペースのシェルの準備（`.claude/` と `aidlc/spaces/default/memory/`）、状態／監査の一貫性（ワークフローの Status と記録された `WORKFLOW_COMPLETED`、そして各 Stage Progress のチェックボックスと、監査が現在の試行について記録したステージの開始と完了。監査が開始済みと示しているのにチェックボックスがまだ `[ ]` のステージは、ワークフローがそれを完了させるのを拒否する原因になり、警告は変えるべき正確な行を示す。チームの Unit 所有では、Unit ごとの Construction のチェックボックスは Unit Progress から導かれるため比較しない）、フックのハートビート、グラフの健全性（閉路がない、グラフの各エントリにファイルがある）、**Composed plugin surface**（有効なプラグインのステージがコンパイルされている、寄与のサイドカーと対象が妥当、記録された構造の追加と散文の断片が残っていて変わっていない）、選択を考慮したプラグイン作成の検査、11 のスコープすべてのスコープ検証、**Composed scope durability**（コンポーザーが作成したすべてのスコープが実在する計画に解決する。グリッドの列がないスコープファイル、まだ投影されていない永続的な `aidlc/scopes/<name>.md` の記録、解決できないスコープを示す実行可能なワークフローはすべて失敗し、compile で原因に届く場合は対処として `graph compile` を示す。compile が列を出すのはいずれかのステージが宣言するスコープだけなので、裏付けとなる記録のない列の欠落は別に報告する）、ステージのスキーマとグラフの参照、スコープ間のキーワードの重複です。合格する advisory の行には、グラフの読み込み順では生産者が曖昧な消費成果物についての **Duplicate producers**、**Rule drift**（ライフサイクル上古くなった重複は stale-suppressed として別に報告）、**Paired sensor coverage**、`HUMAN_TURN` のないステージ／ゲートの台帳、24 時間を超えて人間を待っている承認ゲート、プラグインの advisory の検査、未コミットのワークスペースの記録、新しい進行中の compose／バックグラウンドのサブエージェントの状態、そして `repos.json` がある場合は宣言されたリポジトリと管理された `.gitignore` のずれが含まれます。24 時間より古い compose のマーカーや、2 時間より古いバックグラウンドのサブエージェントのエントリは、正確な `rm aidlc/.aidlc-*` の対処とともに失敗します。doctor はどちらの面も削除しません。**Hook drops** は条件付きです。黙って劣化したフック（例えば寄与を適用できなかったプラグインの compose や、失敗した再コンパイル）は、重大度のタグ付きの行を `<hooks-health>/<hook>.drops` に記録します。`[degraded]` のドロップは doctor を **失敗** させます（そのため CI のゲートが中途半端に適用されたプラグインを捕まえます）。それ以外のドロップは、各フックの最も多い理由（それぞれ最初のコロンまで。詳細はファイルに残る）を示す合格の行で、そのフックの最新の失敗が 24 時間以内の間は `Hook failures, the latest within the last day` の警告に上がります（1 日経つか、ファイルを削除すると消えます。`[advisory]` の行がそれを上げることはありません）。あなたが先に答える必要があるため Stop フックがターンを終わらせるといった、フックの通常の判断は `<hook>.trace` に書かれ、数えられません。プラグインの compose フックは実行のたびにその drops ファイルを書き直すため、原因を直して compose し直すと自然に消えます。問題のない報告と警告だけの報告は exit 0、失敗した検査があれば exit 1 です。`--verbose` がない限り、健全な行は節ごとにまとめられ、警告と失敗はすべて表示されたままです。報告はどちらの場合も stdout に出ます。コアの検査は **読み取り専用** です。インテントがまだない新しいシェルでは何も作らないため、最初のインテントを作る前に実行しても安全です。プラグインの検査は、慣習として読み取り専用であることが求められるインストール済みのプラグインのコードを実行しますが、ランタイムはその性質を強制できません。インテントがあると、doctor は `HEALTH_CHECKED`（と `GUARDRAIL_LOADED`）監査行を記録します。

Kiro IDE では、`.kiro/` を隠すルールについて各 ignore のソースも個別に確認し、ファイルと行を示します。グローバルなソースの一致は失敗し、ワークスペースのソースの一致は、それが適用されるかを `kiroAgent.agentIgnoreFiles` が決めるため警告になります。[Kiro IDE の読取り拒否](#kiro-ide-read-denials) を参照してください。Cursor 以外のすべてのハーネスでは、プロジェクトで AI-DLC のフックが 1 つも動いていない場合、「AIDLC hooks have not run in this project yet」とも警告します。最初のチャットのメッセージの前は想定どおりです。その後は、その修正があなたのツールの手順を示します（例えば [Kiro IDE のフックが動かない](#kiro-ide-hooks-not-running) や [GitHub Copilot のフックが動かない](#github-copilot-hooks-not-running) を参照）。Kiro CLI では、フックが一度も動いていないワークフローは、そのフックが必要とするエンジンとともに「Hooks have never executed」で失敗します。[Kiro CLI のフックが動かない](#kiro-cli-hooks-not-running) を参照してください。

未コミットの記録の行の横にある **Workspace record visibility** の advisory は、config の後に追加された利用者の ignore ルールを捕まえます。ルールのファイル、行、隠されているコミット対象の記録のパスを示します。個々の記録を強制的に追加するのではなく、ルールを狭めてください。この警告は doctor の終了コードを変えません。記録が見えている場合、Git リポジトリの外の場合、Git が使えない場合は、この行はありません。

Claude Code では、doctor はマシンが管理する `managed-settings.json` とアルファベット順の `managed-settings.d/` の断片も読みます。実効の `allowManagedHooksOnly` の値が `true` なら、組織のポリシーがプロジェクトの `.claude/settings.json` が宣言するすべてのフックを止めています。そのポリシーを外せるのは Claude Code の管理者だけです。そのポリシーが設定されておらず、ワークフローが進んだ後もハートビートがない場合は、このプロジェクトの `.claude/settings.local.json` で `"disableAllHooks": false` を設定してください。同じチャットで効きます。
ワークフローに問題があると、`--doctor` は **Workflow diagnosis** セクションも出し、構造化した所見（未解決のゲート、古いまたは存在しないランタイムグラフ、冷えたフックなど、「進まない」原因）を一覧します。`--doctor --export` が報告に書くのと同じ分析です。

各検査が何を検証し、失敗をどう直すかの全体は [CLI コマンド](12-cli-commands.md#aidlc-doctor-health-check) を参照してください。

---

<a id="sharing-a-diagnostic-report"></a>

## 診断レポートを共有する

ワークフローが止まる、またはおかしい（開かないゲート、進まないステージ、承認した報告が繰り返し拒否される）ときに、メンテナーに見てもらいたい場合は、次を実行します。

```
/aidlc --doctor --export
```

これは新しい `--doctor` を実行した後、小さく **マスキングした** 診断報告を `aidlc/diagnostics/` に書きます（`--output <dir>` で上書き）。システムの `tar` があれば時刻付きの `.tar.gz` にまとめ、無ければ報告ディレクトリを残して自分で圧縮するよう伝えます。そのアーカイブ（またはディレクトリ）を共有してください。診断とマスキングした証拠が入り、**あなたの成果物は入りません**。ワークスペースのソース、生の状態／監査／ランタイムグラフのファイル、成果物／寄与／質問／memory の本文は含まれません。パスは正規化され、インテント id はハッシュされ、秘密らしい値は消されます。

報告は監査証跡からワークフローの時系列を再構成し、決定論的な条件→対処のルールを実行します。捕まえることの多い原因は次の 2 つです。

- **未解決の承認ゲート** — ゲートが一度も解決していないステージは、「進まない」の最も多い原因です。
- **古いまたは存在しないランタイムグラフ / 冷えたフック** — 作成された入力より古い（または存在しない）ランタイムグラフや、インテントに記録された最新のステージまたは承認のステップより 1 日以上前に最後に発火したフックは、実行されなかった再コンパイルを指しています。チャットを開くこと、プロンプト、doctor 自身の監査行は作業として数えないので、誰も作業していないインテントが冷えたフックを持つように読まれることはありません。

報告の中の `report.md` は、すべての所見を対処とともに一覧します。復旧の迂回策（`AIDLC_DISABLE_*` 環境変数など）を示す対処には、自動化してはいけないという印が付きます。報告の中身全体と安全モデルは [CLI コマンド](12-cli-commands.md#aidlc-doctor-export-write-a-diagnostic-report) を参照してください。

---

<a id="next-steps"></a>

## 次の章

- [状態と監査](10-state-and-audit.md) — 状態ファイルの構造
- [セッション管理](11-session-management.md) — コンパクションの後に続ける
- [CLI コマンド](12-cli-commands.md) — `--doctor`、`--status`、`--stage` の使い方
- [用語集](glossary.md): コンパクション、フック
