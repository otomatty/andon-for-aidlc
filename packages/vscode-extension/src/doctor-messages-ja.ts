/**
 * Local translations of the core doctor messages shipped with AI-DLC 2.8.x–2.11.2.
 * Keep templates anchored: captures are paths, commands, names, counts, or explicitly
 * marked original OS/parser details. Unknown explanations stay available verbatim.
 */
type MessageKind = "label" | "fix";
type TranslationPattern = readonly [RegExp, string];

const labels: Readonly<Record<string, string>> = {
  "Composed scope durability: no composed scopes": "構成したスコープの永続化: 対象はありません",
  "Composed scope durability: check failed": "構成したスコープの永続化: 検査に失敗しました",
  ".aidlc-engine/plan.json is present but not parseable.":
    ".aidlc-engine/plan.json は存在しますが、内容を読み取れません。",
  "Providers: harness-managed model access; no answer needed":
    "プロバイダー: 実行環境がモデルへのアクセスを管理するため、設定の回答は不要です",
  "Workspace source boundary binds: no (no reason was recorded)":
    "ワークスペースのソース識別: 失敗しました。理由の記録はありません",
  "Windows uninstall recovery: no pending continuations":
    "Windows のアンインストール復旧: 保留中の後処理はありません",
  "Update: update checks disabled by global config": "更新確認: 共通設定で無効になっています",
  "Update: update cache is invalid": "更新確認: キャッシュが不正です",
  "Update: update cache is absent": "更新確認: キャッシュがありません",
  "Update: update check unavailable while offline": "更新確認: オフラインのため確認できません",
  "Plugins: no AIDLC plugins installed":
    "プラグイン: AI-DLC プラグインはインストールされていません",
  "Plugins: composed state is current": "プラグイン: 構成は最新です",
  "Models: no installed project harness":
    "モデル: プロジェクトに実行環境がインストールされていません",
  "Models: recorded policy is expressible": "モデル: 保存されたポリシーを適用できます",
  "Instruction file: no installed project harness":
    "指示ファイル: プロジェクトに実行環境がインストールされていません",
  "Instruction file: ownership baseline unreadable - conflict":
    "指示ファイル: 管理対象の基準データを読めないため、競合しています",
  "Instruction file: block present, user content preserved; framework-owned file intact":
    "指示ファイル: 管理ブロックとユーザーの記述を保持しています。フレームワーク管理ファイルも正常です",
  "Instruction file: block present, user content preserved":
    "指示ファイル: 管理ブロックとユーザーの記述を保持しています",
  "Instruction file: framework-owned file intact":
    "指示ファイル: フレームワーク管理ファイルは正常です",
  "Runtime hook environment: no installed project harness":
    "フックの実行環境: プロジェクトに実行環境がインストールされていません",
  "Installed runtime: active version marker unavailable":
    "インストール済みランタイム: 使用するバージョンの記録を取得できません",
  "Command pointer is missing or does not select an active version":
    "コマンドの参照先がないか、使用するバージョンを選択していません",
  "Rollback target: none recorded": "ロールバック先: 記録されていません",
  "Project pin registry: no stale registrations":
    "プロジェクトの固定バージョン一覧: 古い登録はありません",
  "Native command trust: host hooks and permission entries select the installed `aidlc` command":
    "ネイティブコマンドの信頼設定: フックと実行許可はインストール済みの `aidlc` コマンドを参照しています",
  "Execution mode: source checkout (no machine runtime expected)":
    "実行モード: ソースから実行しています。マシンへのランタイムのインストールは不要です",
  "Transaction staging: no abandoned directories":
    "一時作業ディレクトリ: 放置されたディレクトリはありません",
  "Transaction recovery: no quarantined directories":
    "処理の復旧: 隔離されたディレクトリはありません",
  "Project runtime stamp is malformed": "プロジェクトのランタイム情報が不正です",
  "Hook contract: settings.json unreadable - cannot verify wired hooks":
    "フック設定: settings.json を読めないため、登録されたフックを確認できません",
  "Hook contract: settings.json wires no aidlc-*.ts hooks":
    "フック設定: settings.json に aidlc-*.ts フックが登録されていません",
  "Hooks enabled (resolved disableAllHooks is not true)":
    "フックは有効です。適用後の disableAllHooks は true ではありません",
  "Claude managed hook policy: allowManagedHooksOnly=true":
    "Claude の管理者フックポリシー: allowManagedHooksOnly=true",
  "agents/aidlc.{json,md} present (conductor wiring)":
    "agents/aidlc.{json,md} の存在確認: 進行役の設定",
  "hook trust: merge the shipped native trust-seed.toml entries into $CODEX_HOME/config.toml or run one TUI trust pass":
    "フックの信頼設定: 同梱の trust-seed.toml の項目を $CODEX_HOME/config.toml に統合するか、TUI で一度信頼を承認してください",
  "hook trust: pre-seed [hooks.state] with `bun scripts/package.ts codex trust --project <dir>` or run one TUI trust pass":
    "フックの信頼設定: `bun scripts/package.ts codex trust --project <dir>` で [hooks.state] を設定するか、TUI で一度信頼を承認してください",
  "~/.copilot/config.json absent (fine for VS Code-only installs; for the CLI, one interactive run records folder trust - hooks silently no-op untrusted)":
    "~/.copilot/config.json がありません。VS Code のみの利用では問題ありません。CLI では対話実行でフォルダーを信頼してください。未承認のフックは実行されません",
  "project folder in ~/.copilot/config.json trustedFolders (CLI hooks silently no-op without it)":
    "プロジェクトフォルダーが ~/.copilot/config.json の trustedFolders に登録されています。未登録の場合、CLI のフックは実行されません",
  "could not parse ~/.copilot/config.json to verify folder trust (CLI hooks silently no-op untrusted)":
    "~/.copilot/config.json を解析できず、フォルダーの信頼設定を確認できません。未承認の場合、CLI のフックは実行されません",
  "headless runs: set GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=1 for `copilot -p` sessions - repo hooks are off by default in prompt mode":
    "非対話実行: `copilot -p` では GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=1 を設定してください。プロンプトモードではリポジトリのフックが既定で無効です",
  "opencode.json or opencode.jsonc present (permissions + method instructions glob)":
    "opencode.json または opencode.jsonc の存在を確認しました。実行許可と手順ファイルの読み込み設定です",
  "AWS_AIDLC_DEFAULT_SCOPE (unset - no project default)":
    "AWS_AIDLC_DEFAULT_SCOPE は未設定です。プロジェクトの既定スコープはありません",
  "Plugin selection flags: harness.json agrees with stage-graph.json":
    "プラグインの選択設定: harness.json と stage-graph.json が一致しています",
  "Enabled stage compile coverage: every enabled stage file is in the full graph":
    "有効なステージのコンパイル状況: すべてのステージファイルがグラフに含まれています",
  "Composed plugin surface: all enabled plugin stages and recorded contributions are present":
    "プラグイン構成: 有効なステージと登録された追加ファイルがすべて存在します",
  "Plugin selection vs active workflows: no stranded dependencies":
    "プラグインと実行中のワークフロー: 利用できない依存関係はありません",
  "Plugin checks: discovery failed": "プラグイン診断: 診断項目を検出できませんでした",
  "Submodules: no .gitmodules at workspace root":
    "サブモジュール: ワークスペースのルートに .gitmodules はありません",
  "Submodules: .gitmodules present but no parseable submodule entries":
    "サブモジュール: .gitmodules はありますが、解析できる登録項目がありません",
  "Hook heartbeat data": "フックの実行記録",
  "Hook heartbeats: not yet fired (first workflow stage will populate)":
    "フックの実行記録: まだ実行されていません。最初のステージで記録されます",
  "Hook drops: none recorded": "フックの処理失敗: 記録はありません",
  "State matches last audit event (no drift)": "状態と最新の監査イベントが一致しています",
  "Runtime locks: none leaked": "実行時ロック: 取り残されたロックはありません",
  "state version readable": "状態ファイルのバージョンの読み取り",
  "state version current": "状態ファイルと最新バージョンの一致",
  "state version compatible": "状態ファイルのバージョンの互換性",
  "Orphan worktrees: 0 observed": "対応のない作業ツリー: 検出されていません",
  "Stale branches: 0 observed (not a git repo)":
    "古いブランチ: 検出されていません。Git リポジトリではありません",
  "Orphan state files: 0 observed": "対応のない状態ファイル: 検出されていません",
  "Orphan audit: 0 observed": "対応のない監査記録: 検出されていません",
  "Practices staleness: state file absent (informational)":
    "開発手順の確認時期: 状態ファイルがありません。参考情報です",
  "Practices staleness: never affirmed (informational)":
    "開発手順の確認時期: まだ確認されていません。参考情報です",
  "Practices staleness: timestamp unreadable": "開発手順の確認時期: 確認日時を読み取れません",
  "Cycle detection: 0 cycles": "循環依存: 検出されていません",
  "Cycle detection: graph load failed": "循環依存: グラフを読み込めませんでした",
  "Uncompiled stage files: 0 stage files missing from the compiled graph":
    "未コンパイルのステージ: グラフに含まれていないファイルはありません",
  "Duplicate producers: every consumed artifact has a single producer":
    "成果物の生成元: 使用される各成果物の生成元は一つです",
  "Keyword overlap: no conflicts": "キーワードの重複: 競合はありません",
  "Rule drift: org rules absent (informational)":
    "ルールの不一致: 組織ルールがありません。参考情報です",
  "Rule drift: no team/project rule overlaps org policy":
    "ルールの不一致: 組織ポリシーと重複するチーム・プロジェクトのルールはありません",
  "Intent registry: all rows match their record dirs":
    "作業一覧: すべての登録と記録ディレクトリが一致しています",
  "Intent registry: reconciliation check failed":
    "作業一覧: 登録とディレクトリの照合に失敗しました",
  "Providers: no installed project harness":
    "プロバイダー: プロジェクトに実行環境がインストールされていません",
  "Providers: recorded answers have no unmet actions":
    "プロバイダー: 保存された設定に未完了の作業はありません",
  "Providers: using shipped fallback; no recorded answers":
    "プロバイダー: 設定の保存がないため、同梱の既定値を使用しています",
  "Providers: could not read recorded answers": "プロバイダー: 保存された設定を読み取れません",
  "Flags: no installed project harness":
    "動作設定: プロジェクトに実行環境がインストールされていません",
  "Flags: recorded answers are active without environment drift":
    "動作設定: 保存された設定が有効です。環境変数との不一致はありません",
  "Flags: no recorded project answers": "動作設定: プロジェクト設定は保存されていません",
  "Flags: could not read recorded answers": "動作設定: 保存された設定を読み取れません",
  "Workspace siblings: no installed project harness":
    "ワークスペースの関連ディレクトリ: プロジェクトに実行環境がインストールされていません",
  "Workspace siblings: complete projection is present":
    "ワークスペースの関連ディレクトリ: 必要なファイルがすべて存在します",
  "Workspace records: not a git repo - nothing to commit":
    "ワークスペースの記録: Git リポジトリではないため、コミット対象はありません",
  "Workspace records: no uncommitted changes under aidlc/":
    "ワークスペースの記録: aidlc/ に未コミットの変更はありません",
  "runtime-graph.json is older than its authored stage inputs.":
    "runtime-graph.json が元のステージ定義より古くなっています。",
  "runtime-graph.json is missing for the active workflow.":
    "実行中のワークフローに runtime-graph.json がありません。",
  "No hook heartbeats yet (fresh install or hooks not registered).":
    "フックの実行記録がありません。新規インストール直後か、フックが未登録です。",
  ".aidlc-plan.json is present but not parseable.":
    ".aidlc-plan.json は存在しますが、解析できません。",
  "Stage graph present": "ステージグラフの存在確認",
  // 2.11.0
  "AIDLC hooks have not run in this project yet":
    "このプロジェクトでは、AIDLC のフックがまだ一度も実行されていません",
  "AI-DLC files: no installed project harness":
    "AI-DLC のファイル: プロジェクトに実行環境がインストールされていません",
  "AI-DLC files: not checked, no record of what AI-DLC wrote":
    "AI-DLC のファイル: AI-DLC が書き込んだ内容の記録がないため、確認していません",
  "AI-DLC files: unchanged since AI-DLC wrote them":
    "AI-DLC のファイル: AI-DLC が書き込んだときから変更されていません",
  "Plugins: none in this project": "プラグイン: このプロジェクトにはありません",
  "Session model: not checked (kiro-cli not found)":
    "セッションのモデル: kiro-cli が見つからないため、確認していません",
  "Session model: not checked (Kiro settings could not be read)":
    "セッションのモデル: Kiro の設定を読めないため、確認していません",
  "Session model: Kiro auto": "セッションのモデル: Kiro auto",
  "Windows launcher (Git Bash): a bare `aidlc` runs in Git Bash":
    "Windows の起動ファイル（Git Bash）: Git Bash で `aidlc` だけで実行できます",
  'settings/cli.json pins "chat.agentEngine": "v3" and "chat.defaultAgent": "aidlc" (Kiro CLI hooks run only on v3)':
    'settings/cli.json で "chat.agentEngine": "v3" と "chat.defaultAgent": "aidlc" を指定しています（Kiro CLI のフックは v3 でのみ実行されます）',
  "Copilot CLI has not trusted this folder: `copilot -p` runs skip the hooks, interactive runs ask first (VS Code does not use this list)":
    "Copilot CLI がこのフォルダーを信頼していません。`copilot -p` での実行はフックを省き、対話実行では最初に確認されます（VS Code はこの一覧を使いません）",
  "project is in a git repository (Cursor may skip project hooks outside one)":
    "プロジェクトは Git リポジトリ内にあります（リポジトリ外では Cursor がプロジェクトのフックを実行しない場合があります）",
  "Claude hook wiring differs from its legacy shipped baseline; refresh is required before flow-altering hooks can be verified":
    "Claude のフック登録が以前の出荷時の内容と異なります。進行に影響するフックを確認するには、更新が必要です",
  // 2.11.1
  "agents/aidlc.json or agents/aidlc-aidlc.md present (conductor wiring)":
    "agents/aidlc.json または agents/aidlc-aidlc.md の存在確認: 進行役の設定",
  "Stale branches: 0 observed (git is not installed)":
    "古いブランチ: 検出されていません。git がインストールされていません",
  "Kiro Workflows is off": "Kiro Workflows: オフです",
  "Kiro Workflows is on, so AI-DLC's reviews and helpers do not run in your Kiro IDE chats":
    "Kiro Workflows がオンのため、Kiro IDE のチャットでは AI-DLC のレビューと補助エージェントが動きません",
  "Kiro Workflows: Kiro's settings file has an error, so AI-DLC cannot tell whether Workflows is on":
    "Kiro Workflows: Kiro の設定ファイルに誤りがあるため、Workflows がオンかどうかを AI-DLC が判断できません",
  "Kiro terminal: Kiro runs its agent's commands in Command Prompt, where most AI-DLC steps come back with no reply and your words can get split":
    "Kiro のターミナル: Kiro はエージェントのコマンドをコマンド プロンプトで実行します。コマンド プロンプトでは AI-DLC のほとんどの手順が応答を返さず、入力した言葉が分割されることがあります",
  "Kiro terminal: PowerShell (Kiro's default)": "Kiro のターミナル: PowerShell（Kiro の既定）",
  // 2.11.2
  "Kiro CLI Workflows is off": "Kiro CLI Workflows: オフです",
  "Kiro CLI Workflows is on, so AI-DLC's reviews and helpers do not run in your Kiro CLI chats":
    "Kiro CLI Workflows がオンのため、Kiro CLI のチャットでは AI-DLC のレビューと補助エージェントが動きません",
  "This workflow was run in another clone; this clone has no hook record for it yet":
    "この作業は別のクローンで進められました。このクローンにはまだフックの記録がありません",
  "This workflow was run in other clones; this clone has no hook record for it yet":
    "この作業は他のクローンで進められました。このクローンにはまだフックの記録がありません",
  "Workspace records: no uncommitted changes under aidlc/ other than doctor's own entries in the audit log":
    "ワークスペースの記録: aidlc/ 配下に、監査ログへの doctor 自身の記録以外の未コミットの変更はありません",
};

const fixes: Readonly<Record<string, string>> = {
  // 2.11.2
  "nothing to fix in this clone: its hooks record this workflow once you carry on with it here. To check the hooks where it ran, run doctor in that clone":
    "このクローンで直すことはありません。ここで作業を続けると、このクローンのフックが記録を始めます。作業したクローンのフックを確認するには、そのクローンで doctor を実行してください",
  "nothing to fix in this clone: its hooks record this workflow once you carry on with it here. To check the hooks where it ran, run doctor in those clones":
    "このクローンで直すことはありません。ここで作業を続けると、このクローンのフックが記録を始めます。作業したクローンのフックを確認するには、それらのクローンで doctor を実行してください",
  "The resolve output is corrupt. Re-run the resolve step (`/aidlc` will recompute the plan), or remove .aidlc-engine/plan.json to force a fresh resolve.":
    "計画の解決結果が壊れています。`/aidlc` で計画を再計算するか、.aidlc-engine/plan.json を削除して計画を作り直してください。",
  "host inventory unavailable; run sync through the host SessionStart adapter":
    "実行環境のプラグイン一覧を取得できません。実行環境の SessionStart アダプターを通じて同期してください。",
  "Plan Approval decisions are refused while the source cannot be bound. Shrink or exclude the offending path, declare the real source under excluded directories in .aidlc-source-paths.json, or remove the broken symlink; then re-run the fingerprint command and re-present the plan. Last resort, human only: type `Override Plan Approval: <reason>` in chat and let the conductor run answer --override.":
    "ソースを識別できるまで Plan Approval の判断は受け付けられません。問題のパスの内容を減らすか対象から除外してください。除外ディレクトリ内のソースは .aidlc-source-paths.json に実際のパスを宣言し、壊れたシンボリックリンクは削除してください。その後、fingerprint コマンドを再実行し、計画を提示し直してください。最終手段として、人がチャットに `Override Plan Approval: <reason>` と入力し、進行役に answer --override を実行させる方法があります。",
  "finish active AI-DLC commands, then run `aidlc version` to resume cleanup":
    "実行中の AI-DLC コマンドを終了し、`aidlc version` で後処理を再開してください",
  "run `aidlc use <version>` with a complete retained version":
    "保持されている完全なバージョンを指定して `aidlc use <version>` を実行してください",
  "run a pinned command from the moved project to self-heal its registration":
    "移動先のプロジェクトから固定バージョンのコマンドを実行し、登録先を修復してください",
  "finish any active AI-DLC command, then rerun the command to trigger the safe staging sweep":
    "実行中の AI-DLC コマンドを終了してから再実行し、一時作業ディレクトリの安全な清掃を開始してください",
  "inspect each listed directory, recover any needed files, then remove the directory manually":
    "表示された各ディレクトリを確認し、必要なファイルを復旧してから手動で削除してください",
  "Install Bun, then add its install directory to the Windows User or Machine PATH, not only a shell profile.":
    "Bun をインストールし、インストール先を Windows のユーザー環境変数またはシステム環境変数の PATH に追加してください。シェルのプロファイルだけではフックから利用できません。",
  "Install Bun, then add ~/.bun/bin to the login-independent PATH the harness inherits (a file in /etc/paths.d), not only .zshrc or .bash_profile.":
    "Bun をインストールし、/etc/paths.d 内のファイルで ~/.bun/bin を PATH に追加してください。.zshrc や .bash_profile だけではフックから利用できません。",
  "Install Bun, then add ~/.bun/bin to the login-independent PATH the harness inherits (the PATH line in /etc/environment, ENV_PATH in /etc/login.defs, or a PATH= line in ~/.config/environment.d/*.conf), not only .zshrc or .bash_profile.":
    "Bun をインストールし、/etc/environment の PATH、/etc/login.defs の ENV_PATH、または ~/.config/environment.d/*.conf の PATH= 行へ ~/.bun/bin を追加してください。.zshrc や .bash_profile だけではフックから利用できません。",
  "Install Bun, then add ~/.bun/bin to the login-independent environment used by the harness, not only .zshrc or .bash_profile.":
    "Bun をインストールし、ログインに依存しない実行環境の PATH に ~/.bun/bin を追加してください。.zshrc や .bash_profile だけではフックから利用できません。",
  "Add the aidlc command directory to the Windows User or Machine PATH.":
    "aidlc コマンドのディレクトリを Windows のユーザー環境変数またはシステム環境変数の PATH に追加してください。",
  "Add ~/.local/bin to the login-independent environment used by the harness, not only an interactive shell rc file.":
    "ログインに依存しない実行環境の PATH に ~/.local/bin を追加してください。対話シェルの rc ファイルだけではフックから利用できません。",
  "Install the Cursor CLI and ensure `cursor --version` works; IDE-only installs may omit it.":
    "Cursor CLI をインストールし、`cursor --version` が実行できることを確認してください。IDE のみで利用する場合は不要です。",
  "Kiro IDE has no required separate CLI for this project surface.":
    "このプロジェクトで Kiro IDE を利用する場合、別の CLI は不要です。",
  "repair ~/.copilot/config.json as valid JSONC, then re-run doctor":
    "~/.copilot/config.json を有効な JSONC に修正し、doctor を再実行してください",
  "verify this harness's hook registration or trust configuration, then fully restart the harness before resuming the workflow":
    "実行環境のフック登録と信頼設定を確認し、実行環境を完全に再起動してからワークフローを再開してください",
  "health dir exists and the ledger shows STAGE_STARTED, but no hook has ever fired — verify hooks are registered in settings.json":
    "診断記録ディレクトリと STAGE_STARTED の記録はありますが、フックが一度も実行されていません。settings.json のフック登録を確認してください",
  "health dir exists but heartbeat files are unreadable - verify permissions and hook registration":
    "診断記録ディレクトリはありますが、実行記録を読み取れません。アクセス権とフック登録を確認してください",
  "manually set Status=Completed in aidlc-state.md or restart the workflow":
    "aidlc-state.md の Status=Completed を手動で設定するか、ワークフローを再開してください",
  "run `/aidlc --status` to review and resolve the pending approval":
    "`/aidlc --status` で保留中の承認を確認し、承認または却下してください",
  "inspect the owning checkout and candidate history; release only after a human confirms the attempt is abandoned":
    "担当者の作業ディレクトリと候補コミットの履歴を確認してください。作業の中止を人が確認してから、担当の割り当てを解除してください",
  "confirm the intent was removed or renamed, preserve any candidate commit needed for salvage, then delete the orphan refs manually":
    "作業が削除または改名されたことを確認し、復旧に必要な候補コミットを保存してから、対応のない参照を手動で削除してください",
  "if no in-flight compose gate is actually pending, delete it ('rm aidlc/.aidlc-compose-pending') or resolve the pending gate. A stale marker no longer disables the Stop hook, but it should not linger.":
    "構成計画の承認が保留中でなければ 'rm aidlc/.aidlc-compose-pending' で記録を削除してください。保留中なら承認を解決してください。古い記録は Stop フックを無効にしませんが、残さないでください。",
  "if no background subagent is actually running, delete it ('rm aidlc/.aidlc-subagent-inflight'). Stale or malformed entries never authorize the Stop hook, but the ledger should not linger.":
    "バックグラウンドのサブエージェントが動作していなければ 'rm aidlc/.aidlc-subagent-inflight' で記録を削除してください。古い記録や不正な記録が Stop フックを許可することはありませんが、残さないでください。",
  "Plugin names must be lowercase kebab-case, start with a letter, and must not use the reserved aidlc namespace.":
    "プラグイン名は英字で始まる小文字の kebab-case にし、予約済みの aidlc 名前空間を使わないでください。",
  "review this plugin-provided finding": "プラグインが報告したこの診断結果を確認してください",
  "Verify Amazon Bedrock model access in the recorded region and confirm the AWS principal has bedrock:InvokeModel permission.":
    "設定済みリージョンで Amazon Bedrock のモデルにアクセスできることと、AWS の実行主体に bedrock:InvokeModel 権限があることを確認してください。",
  "Select the intended Amazon Bedrock chat model in the Kiro IDE model picker.":
    "Kiro IDE のモデル選択から、使用する Amazon Bedrock のチャットモデルを選んでください。",
  "Configure GitHub Copilot BYOK provider environment variables for this install.":
    "この環境で利用する GitHub Copilot BYOK のプロバイダー環境変数を設定してください。",
  "Configure the provider in Cursor and select it for the active chat session.":
    "Cursor でプロバイダーを設定し、現在のチャットセッションで選択してください。",
  "Configure the selected non-Bedrock provider in the harness.":
    "選択した Bedrock 以外のプロバイダーを実行環境で設定してください。",
  "The workflow is waiting at an approval gate. Resolve it with `/aidlc` (answer the open question / approve or reject the stage), then continue.":
    "ワークフローは承認待ちです。`/aidlc` で未回答の質問に答えるか、ステージを承認または却下してから続行してください。",
  "Each declared collaborator must write its contribution file with the identity-marker first line before approval. Dispatch the missing collaborator(s) to write their contribution, then re-report.":
    "承認前に、各協力エージェントが識別情報を先頭行に含む担当成果ファイルを書く必要があります。未提出のエージェントに作成を依頼し、再度報告してください。",
  "A state write was lost after the audit event landed. Set Status=Completed in aidlc-state.md, or restart the workflow if the state is otherwise inconsistent.":
    "監査イベントの記録後に状態の保存が失われています。aidlc-state.md に Status=Completed を設定してください。ほかにも状態の不整合がある場合は、ワークフローを再開してください。",
  "If a workflow has run, verify hooks are registered in the harness wiring config.":
    "ワークフローを実行済みの場合は、実行環境の設定にフックが登録されていることを確認してください。",
  "A cold hook silently skips its side effects (audit, sensors, runtime compile). Verify the hook is wired and firing on this harness.":
    "動作していないフックでは、監査・センサー・実行時コンパイルも行われません。この実行環境でフックが登録され、実行されていることを確認してください。",
  "A hook silently half-applied something (a dropped contribution or a failed recompile). Inspect the hook's .drops file, fix the cause, and re-compose.":
    "フックの処理が一部だけ適用されています。担当成果の欠落や再コンパイルの失敗が考えられます。フックの .drops ファイルを確認し、原因を修正して構成計画を作成し直してください。",
  "The resolve output is corrupt. Re-run the resolve step (`/aidlc` will recompute the plan), or remove .aidlc-plan.json to force a fresh resolve.":
    "計画の解決結果が破損しています。`/aidlc` で計画を再計算するか、.aidlc-plan.json を削除して新しく解決し直してください。",
  '"disableAllHooks": true is enforced by enterprise managed settings — the highest-precedence layer, which a project or user setting cannot override. IT policy must remove it (or set it to false) for AI-DLC to run. If policy mandates disabled hooks, AI-DLC v2 is not compatible with this environment — its workflow engine is hook-driven.':
    '企業の管理設定で "disableAllHooks": true が強制されています。優先順位が最も高いため、プロジェクトやユーザーの設定では変更できません。AI-DLC を実行するには管理者がこの設定を削除するか false にする必要があります。AI-DLC v2 はフックで動作するため、フックを禁止する環境では利用できません。',
  "hooks from .claude/settings.json are blocked by organization policy (allowManagedHooksOnly); only the Claude Code administrator can lift it in managed-settings.json. Until then, the workflow's human-presence and summary-confirmation receipts cannot be minted; attended sessions can set AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1 and AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD=1 in the environment that launches the CLI as a temporary bypass":
    ".claude/settings.json のフックが組織ポリシー allowManagedHooksOnly で禁止されています。managed-settings.json で解除できるのは Claude Code の管理者のみです。解除まではユーザーの参加と要約確認を記録できません。人が立ち会うセッションでは、一時対応として CLI 起動環境に AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1 と AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD=1 を設定できます",
  "1. Run /hooks to check hook approval and policy state. 2. If hooks need approval, approve them and fully restart the CLI; approval does not take effect until a full restart. 3. If /hooks says hooks are restricted by policy, only your Claude Code administrator can lift allowManagedHooksOnly in managed-settings.json. Until then, for an attended session, launch the CLI with AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1 and AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD=1":
    "1. /hooks でフックの承認とポリシーを確認してください。2. 承認が必要なら承認後に CLI を完全に再起動してください。再起動まで承認は反映されません。3. ポリシーで制限されている場合、managed-settings.json の allowManagedHooksOnly を解除できるのは Claude Code の管理者のみです。解除までは人が立ち会うセッションで、AIDLC_SKIP_HUMAN_PRESENCE_GUARD=1 と AIDLC_SKIP_SUMMARY_CONFIRMATION_GUARD=1 を設定して CLI を起動できます",
  // 2.11.0
  "add --verbose to see the details, correct the named condition, then run doctor again":
    "--verbose を付けて詳細を確認し、示された状態を直してから、doctor をもう一度実行してください",
  'Set "disableAllHooks": false in this project\'s .claude/settings.local.json; it works in the same chat.':
    'このプロジェクトの .claude/settings.local.json で "disableAllHooks": false を設定してください。同じチャットのまま反映されます。',
  "Your organization's Claude Code settings block this project's hooks. Ask your Claude Code administrator to allow project hooks.":
    "組織の Claude Code の設定で、このプロジェクトのフックが禁止されています。Claude Code の管理者にプロジェクトのフックを許可するよう依頼してください。",
  "run `git init` in this project, then fully restart Cursor and trust the folder":
    "このプロジェクトで `git init` を実行し、Cursor を完全に再起動してからフォルダーを信頼してください",
  'This is expected before your first Claude Code chat in this folder. If you already started one, set "disableAllHooks": false in this project\'s .claude/settings.local.json (it works in the same chat). If you started Claude Code with a setting that turns hooks off, start it again without that setting; if AI-DLC was set up while Claude Code was open, exit Claude Code and start it again in this folder. Then run doctor again.':
    'このフォルダーで Claude Code のチャットを始める前は、この表示になります。すでに始めている場合は、このプロジェクトの .claude/settings.local.json で "disableAllHooks": false を設定してください（同じチャットのまま反映されます）。フックを無効にする設定で Claude Code を起動した場合は、その設定を外して起動し直してください。Claude Code を開いたまま AI-DLC を設定した場合は、Claude Code を終了してこのフォルダーで起動し直してください。そのあと doctor をもう一度実行してください。',
  "This is expected before your first Codex chat in this folder. If you already started one, type /hooks in Codex, press t to trust all, then press Esc, and run doctor again.":
    "このフォルダーで Codex のチャットを始める前は、この表示になります。すでに始めている場合は、Codex で /hooks と入力し、t を押してすべて信頼してから Esc を押し、doctor をもう一度実行してください。",
  'This is expected before your first Copilot chat in this folder. If you already started one, turn on Chat: Use Hooks in VS Code for this folder ("chat.useHooks": true in .vscode/settings.json; if your organization has switched it off, ask your administrator to turn it on), or in the Copilot CLI trust this folder when it asks, then send a message and run doctor again.':
    'このフォルダーで Copilot のチャットを始める前は、この表示になります。すでに始めている場合は、VS Code でこのフォルダーの Chat: Use Hooks を有効にしてください（.vscode/settings.json の "chat.useHooks": true。組織で無効にされている場合は管理者に有効化を依頼してください）。Copilot CLI では、確認されたときにこのフォルダーを信頼してください。そのあとメッセージを送り、doctor をもう一度実行してください。',
  'This is expected before your first Kiro CLI chat in this folder. If you already started one, type /agent and pick aidlc; if Kiro says agent "aidlc" needs upgrading for this agent engine, quit Kiro and start it again in this folder with: kiro-cli chat --agent-engine v2 --agent aidlc. Then run doctor again.':
    'このフォルダーで Kiro CLI のチャットを始める前は、この表示になります。すでに始めている場合は、/agent と入力して aidlc を選んでください。Kiro が agent "aidlc" needs upgrading for this agent engine と表示した場合は、Kiro を終了し、このフォルダーで kiro-cli chat --agent-engine v2 --agent aidlc を実行して起動し直してください。そのあと doctor をもう一度実行してください。',
  "This is expected before your first chat message here. If you already sent one, trust this folder in Kiro IDE: choose Trust Folder & Continue when Kiro asks whether you trust it, or select Manage on the Restricted Mode banner, then Trust. Then run Developer: Reload Window from the Command Palette (Ctrl+Shift+P, or Cmd+Shift+P on macOS), send a message and run doctor again. In Kiro CLI, quit Kiro and start `kiro-cli` again in this folder.":
    "ここで最初のメッセージを送る前は、この表示になります。すでに送っている場合は、Kiro IDE でこのフォルダーを信頼してください。信頼するかを尋ねられたら Trust Folder & Continue を選ぶか、制限モードのバナーで Manage を選んでから Trust を選びます。そのあとコマンドパレット（Ctrl+Shift+P、macOS では Cmd+Shift+P）から Developer: Reload Window を実行し、メッセージを送ってから doctor をもう一度実行してください。Kiro CLI では、Kiro を終了し、このフォルダーで `kiro-cli` を起動し直してください。",
  "Select the intended Amazon Bedrock chat model in the Kiro IDE model picker or with /model in Kiro CLI.":
    "Kiro IDE のモデル選択、または Kiro CLI の /model で、使用する Amazon Bedrock のチャットモデルを選んでください。",
};

const labelPatterns: readonly TranslationPattern[] = [
  // 2.11.2
  [
    /^(aidlc-[\w-]+\.ts) is not in this install's runtime: `([^`]+)` exits 1 without running it$/,
    "$1 はこのインストールのランタイムに含まれていません。`$2` は実行せずに終了コード 1 で終わります",
  ],
  [
    /^This workflow was run in another clone \((.+)\); this clone has no hook record for it yet$/,
    "この作業は別のクローン（$1）で進められました。このクローンにはまだフックの記録がありません",
  ],
  [
    /^This workflow was run in other clones \((.+)\); this clone has no hook record for it yet$/,
    "この作業は他のクローン（$1）で進められました。このクローンにはまだフックの記録がありません",
  ],
  [
    /^Project folder: (\d+) characters deep; Git refuses paths over (\d+) characters and AI-DLC's records add about (\d+)$/,
    "プロジェクトフォルダー: パスが $1 文字あります。Git は $2 文字を超えるパスを扱えず、AI-DLC の記録でさらに約 $3 文字増えます",
  ],
  [
    /^Project folder: (\d+) characters deep; Windows tools refuse paths over (\d+) characters and AI-DLC's records add about (\d+)$/,
    "プロジェクトフォルダー: パスが $1 文字あります。Windows のツールは $2 文字を超えるパスを扱えず、AI-DLC の記録でさらに約 $3 文字増えます",
  ],
  [
    /^Project folder: (\d+) characters deep; Copilot CLI asks before every read of a path over (\d+) characters \(copilot -p refuses it\), and AI-DLC's records add about (\d+)$/,
    "プロジェクトフォルダー: パスが $1 文字あります。Copilot CLI は $2 文字を超えるパスを読むたびに確認し（copilot -p では拒否されます）、AI-DLC の記録でさらに約 $3 文字増えます",
  ],
  // 2.11.1
  [
    /^Update: not checked yet \(run `([^`]+)` to check\)$/,
    "更新確認: まだ確認していません（`$1` で確認できます）",
  ],
  [
    /^active space method copy current \(aidlc\/active-memory\/ holds aidlc\/spaces\/([\w.-]+)\/memory\/\)$/,
    "使用中スペースの手順のコピーは最新です（aidlc/active-memory/ に aidlc/spaces/$1/memory/ を保持）",
  ],
  [
    /^active space method copy is behind aidlc\/spaces\/([\w.-]+)\/memory\/ \((.+)\); your chats read that copy$/,
    "使用中スペースの手順のコピーが aidlc/spaces/$1/memory/ より古くなっています（$2）。チャットはこのコピーを読みます",
  ],
  [
    /^Plugin marketplace: not created yet; run `([^`]+)` to create it at (.+)$/,
    "プラグインのマーケットプレイス: まだ作成されていません。`$1` を実行すると $2 に作成されます",
  ],
  [
    /^Plugin marketplace: (.+) holds files AI-DLC did not write, so updates do not refresh it: (.+)$/,
    "プラグインのマーケットプレイス: $1 に AI-DLC が書き込んでいないファイルがあるため、更新しても最新になりません: $2",
  ],
  [
    /^Plugin marketplace: (.+) lists the plugins of AI-DLC an earlier release, not (\S+)$/,
    "プラグインのマーケットプレイス: $1 には以前のリリースの AI-DLC のプラグインが載っています（使用中は $2）",
  ],
  [
    /^Plugin marketplace: (.+) lists the plugins of AI-DLC (\S+), not (\S+)$/,
    "プラグインのマーケットプレイス: $1 には AI-DLC $2 のプラグインが載っています（使用中は $3）",
  ],
  [/^Plugin marketplace: ([^;]+)$/, "プラグインのマーケットプレイス: $1"],
  [
    /^Plugins: (.+) in this project \(no host plugin list to compare versions with\)$/,
    "プラグイン: このプロジェクトには $1 があります（バージョンを比べる実行環境側のプラグイン一覧はありません）",
  ],
  [
    /^AI-DLC files: unchanged since AI-DLC wrote them, apart from (\d+) agent files? Kiro upgraded for its 3\.0 engine$/,
    "AI-DLC のファイル: AI-DLC が書き込んだときから変更されていません（Kiro が 3.0 エンジン用に更新した $1 件のエージェントファイルを除く）",
  ],
  [
    /^Your replies are not being recorded: (\d+) (?:step or approval|steps or approvals) so far and no message of yours on record$/,
    "返答が記録されていません: これまでに $1 件の手順・承認がありますが、あなたのメッセージの記録がありません",
  ],
  [
    /^Request folder: check skipped \(advisory\) - (.+)$/,
    "依頼フォルダー: 確認を省略しました（参考）- $1",
  ],
  [
    /^Workspace records: (\d+) uncommitted change\(s\) under aidlc\/ \(advisory - the shared records travel by git; commit & push so teammates get them: `git add aidlc\/ && git commit && git push`\)$/,
    "ワークスペースの記録: aidlc/ 以下に未コミットの変更が $1 件あります（参考。共有の記録は git で届きます。チームに届くよう commit と push をしてください: `git add aidlc/ && git commit && git push`）",
  ],
  [
    /^Workspace records: (\d+) uncommitted change\(s\) under aidlc\/ \(advisory - the shared records travel by git; commit & push them so teammates get them once the request folder steps below are done\)$/,
    "ワークスペースの記録: aidlc/ 以下に未コミットの変更が $1 件あります（参考。共有の記録は git で届きます。下の依頼フォルダーの手順を終えたら、チームに届くよう commit と push をしてください）",
  ],
  [
    /^Kiro terminal: (.+) could not be read as JSONC$/,
    "Kiro のターミナル: $1 を JSONC として読み込めません",
  ],
  [/^Kiro terminal: ([^,;]+)$/, "Kiro のターミナル: $1"],
  [
    /^Session model: (\S+) runs at ([\w-]+) effort, which \1 does not offer$/,
    "セッションのモデル: $1 は effort $2 で動作していますが、$1 はこの effort を提供していません",
  ],
  [
    /^Session model: (\S+) at ([\w-]+) effort, from your personal Kiro settings; the ([\w-]+) preset asks for ([\w-]+) \(`([^`]+)` applies it\)$/,
    "セッションのモデル: $1、effort は $2（Kiro の個人設定）。$3 プリセットは $4 を求めます（`$5` で適用できます）",
  ],
  [
    /^Session model: (\S+) runs at Kiro's own effort; the ([\w-]+) preset asks for ([\w-]+)$/,
    "セッションのモデル: $1 は Kiro 自身の effort で動作しています。$2 プリセットは $3 を求めます",
  ],
  // 2.11.0 (ahead of older, looser patterns for the same rows)
  [/^Hooks last fired: (.+)$/, "フックの最終実行: $1"],
  [
    /^Multi-harness install detected \(([^)]+), all on (\d+\.\d+\.\d+)\) with an active workflow - supported but untested; keep all trees at the same framework version$/,
    "実行中のワークフローに複数の実行環境があります: $1（すべて $2）。対応していますが未検証です。すべて同じフレームワークのバージョンにそろえてください",
  ],
  [
    /^Harness trees on different releases: (.+) \(the project is pinned to (\d+\.\d+\.\d+)\) - a workflow can behave differently depending on which tool runs it$/,
    "実行環境ごとにバージョンが異なります: $1（プロジェクトの固定バージョンは $2）。どのツールで実行するかによって、ワークフローの動作が変わる場合があります",
  ],
  [
    /^Harness trees on different releases: (.+) - a workflow can behave differently depending on which tool runs it$/,
    "実行環境ごとにバージョンが異なります: $1。どのツールで実行するかによって、ワークフローの動作が変わる場合があります",
  ],
  [
    /^Runtime hook PATH: (bun|aidlc) is on this shell's PATH \((.+)\) but not on the system-wide PATH$/,
    "フックの PATH: $1 はこのシェルの PATH（$2）にはありますが、システム全体の PATH にはありません",
  ],
  [
    /^Runtime hook PATH: (bun|aidlc) -> (.+) \(this project's hooks found it; last fired (.+)\)$/,
    "フックの PATH: $1 → $2。このプロジェクトのフックが見つけています（最終実行 $3）",
  ],
  [
    /^Windows uninstall recovery: (\d+) pending, (\d+) failed, and (\d+) invalid continuation\(s\)$/,
    "Windows のアンインストール復旧: 保留中 $1 件、失敗 $2 件、不正な後処理 $3 件",
  ],
  [
    /^Flow-altering AI-DLC hook (.+) differs from the shipped event, matcher, or command$/,
    "進行に影響する AI-DLC のフック $1 が、出荷時のイベント・対象・コマンドと異なります",
  ],
  [
    /^AI-DLC hook registrations in \.claude\/settings\.json differ from the shipped wiring: (.+)$/,
    ".claude/settings.json の AI-DLC のフック登録が出荷時の内容と異なります: $1",
  ],
  [
    /^Other agents in ([\w./-]+)\/agents \(advisory\): (.+) - not AI-DLC personas \(no display_name, examples, tier or plugin, and no aidlc- prefix\), so AI-DLC does not load them$/,
    "$1/agents にほかのエージェントがあります（参考）: $2。AI-DLC のペルソナではない（display_name・examples・tier・plugin がなく、aidlc- で始まらない）ため、AI-DLC は読み込みません",
  ],
  [
    /^Hook drops recorded \(advisory\): (.+) - a hook recorded something it could not report at the time and carried on; read the named \.drops file\(s\) under \.aidlc-engine\/hooks-health\/ for the detail, then delete them once investigated$/,
    "フックの未報告の記録があります（参考）: $1。フックがその場で報告できなかった内容を記録して処理を続けました。.aidlc-engine/hooks-health/ にある該当の .drops ファイルで詳細を確認し、調査が済んだら削除してください",
  ],
  [
    /^Hook failures, the latest within the last day: (.+)$/,
    "フックの失敗（最新は直近1日以内）: $1",
  ],
  [
    /^Unit claim activity baseline missing \(advisory\): ([\w., -]+) - run (\S+) --status after the next explicit fetch to establish a local observed-ref timestamp$/,
    "Unit の作業記録の基準がありません（参考）: $1。次に明示的に fetch したあと $2 --status を実行し、ローカルの確認時刻を記録してください",
  ],
  [
    /^Providers: recorded answers are from aidlc (\S+), newer than this aidlc (\S+)$/,
    "プロバイダー: 記録された回答は aidlc $1 のもので、この aidlc $2 より新しいバージョンです",
  ],
  [/^Flags: (\d+) checks? switched off$/, "フラグ: $1 件の検査が無効になっています"],
  [
    /^AI-DLC files: (\d+) changed in this project, so `([^`]+)` keeps (?:it|them) and stops \((.+)\)$/,
    "AI-DLC のファイル: このプロジェクトで $1 件が変更されているため、`$2` は変更を保持して停止します（$3）",
  ],
  [/^Kiro IDE ignore sources: none present$/, "Kiro IDE の除外設定: ありません"],
  [
    /^Kiro IDE ignore sources: none hide ([\w.-]+)\/ \((\d+) file\(s\) checked\)$/,
    "Kiro IDE の除外設定: $1/ を隠す設定はありません（$2 件のファイルを確認）",
  ],
  [
    /^Session model: (\S+), from your personal Kiro settings$/,
    "セッションのモデル: $1（Kiro の個人設定）",
  ],
  [
    /^Session model: (\S+) \(no effort setting\), from your personal Kiro settings$/,
    "セッションのモデル: $1（effort の設定なし、Kiro の個人設定）",
  ],
  [
    /^Session model: (\S+) at ([\w-]+) effort \(([\w-]+)\), from your personal Kiro settings$/,
    "セッションのモデル: $1、effort は $2（$3）、Kiro の個人設定",
  ],
  [
    /^Session model: (\S+) is not offered on your Kiro account any more; every prompt fails with "The model \.\.\. is not available"$/,
    'セッションのモデル: $1 は Kiro のアカウントで提供されなくなりました。すべてのプロンプトが "The model ... is not available" で失敗します',
  ],
  [
    /^Session model: this project's (\S+) has chat\.modelDefaults, which replaces your personal effort settings here$/,
    "セッションのモデル: このプロジェクトの $1 に chat.modelDefaults があり、ここでは個人の effort 設定が置き換えられます",
  ],
  [
    /^Agent (\S+) pins (\S+), which your Kiro account does not offer; Kiro rejects that agent with "Invalid model ID"$/,
    'エージェント $1 は $2 を指定していますが、Kiro のアカウントでは提供されていません。Kiro はこのエージェントを "Invalid model ID" で拒否します',
  ],
  [
    /^Update: You're on (\S+), newer than the latest (stable|preview) (\S+)\. To go back to (stable|preview) (\S+): aidlc update --channel \4\. To keep getting (previews|stable releases): aidlc config --channel (stable|preview)\.$/,
    "更新確認: 使用中の $1 は、$2 の最新 $3 より新しいバージョンです。$4 の $5 に戻すには aidlc update --channel $4 を、今のチャンネルを使い続けるには aidlc config --channel $7 を実行します。",
  ],
  [
    /^Update: You're on (\S+), newer than the latest (stable|preview) (\S+)\. To go back to (stable|preview) (\S+): aidlc update --channel \4\.$/,
    "更新確認: 使用中の $1 は、$2 の最新 $3 より新しいバージョンです。$4 の $5 に戻すには aidlc update --channel $4 を実行します。",
  ],
  [
    /^aidlc-state\.md shows ([\w-]+) as not started, but the audit log shows it (started|completed)\.$/,
    "aidlc-state.md では $1 が未着手ですが、監査ログでは $2 になっています。",
  ],
  [
    /^aidlc-state\.md shows (\d+) stages as not started, but the audit log shows them underway or done: (.+)\.$/,
    "aidlc-state.md では $1 件のステージが未着手ですが、監査ログでは進行中または完了しています: $2。",
  ],
  [
    /^aidlc-state\.md names ([\w-]+) as the current stage but shows it as not started\.$/,
    "aidlc-state.md では $1 が現在のステージですが、未着手と表示されています。",
  ],
  [
    /^Composed scope durability: (\d+) composed scope\(s\) recorded and projected$/,
    "構成したスコープの永続化: $1 件を記録・配置済みです",
  ],
  [
    /^Composed scope durability: (\d+) problem\(s\) - (.+)$/,
    "構成したスコープの永続化: $1 件の問題があります（詳細原文: $2）",
  ],
  [/^Providers: (\d+) warning\(s\)$/, "プロバイダー: $1 件の警告があります"],
  [
    /^(.+) shipped but not wired in \.claude\/settings\.json - AI-DLC enforcement for it is off$/,
    "$1 は同梱されていますが .claude/settings.json に未登録のため、このフックのガードは無効です",
  ],
  [
    /^Workspace source boundary binds: ([0-9a-f]{12})$/,
    "ワークスペースのソース識別: 確認できました。識別値 $1",
  ],
  [
    /^Workspace source boundary binds: no \(budget-entries at (.+): more than (\d+) directory entries\)$/,
    "ワークスペースのソース識別: $1 でディレクトリ内の項目数が上限 $2 件を超えています",
  ],
  [
    /^Workspace source boundary binds: no \(budget-directories at (.+): more than (\d+) directories\)$/,
    "ワークスペースのソース識別: $1 でディレクトリ数が上限 $2 件を超えています",
  ],
  [
    /^Workspace source boundary binds: no \(budget-symlinks at (.+): more than (\d+) symlinks\)$/,
    "ワークスペースのソース識別: $1 でシンボリックリンク数が上限 $2 件を超えています",
  ],
  [
    /^Workspace source boundary binds: no \(budget-files at (.+): more than (\d+) files\)$/,
    "ワークスペースのソース識別: $1 でファイル数が上限 $2 件を超えています",
  ],
  [
    /^Workspace source boundary binds: no \(budget-bytes at (.+): more than (\d+) bytes of source\)$/,
    "ワークスペースのソース識別: $1 でソースの容量が上限 $2 バイトを超えています",
  ],
  [
    /^Workspace source boundary binds: no \(symlink-loop at (.+): the symlink loops or its chain cannot be read\)$/,
    "ワークスペースのソース識別: $1 のシンボリックリンクが循環しているか、参照先を読み取れません",
  ],
  [
    /^Workspace source boundary binds: no \(budget-entries at (.+): the project root lists more than (\d+) entries\)$/,
    "ワークスペースのソース識別: $1 のプロジェクトルート内の項目数が上限 $2 件を超えています",
  ],
  [
    /^Workspace source boundary binds: no \(budget-entries at (.+): the multi-repo roof lists more than (\d+) entries\)$/,
    "ワークスペースのソース識別: $1 の複数リポジトリの共通ルート内の項目数が上限 $2 件を超えています",
  ],
  [
    /^Workspace source boundary binds: no \(source-only-budget at (.+): a symlinked external tree holds more than (\d+) source files or (\d+) bytes\)$/,
    "ワークスペースのソース識別: $1 からリンクされた外部ディレクトリのソースが、ファイル数 $2 件または容量 $3 バイトの上限を超えています",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the project root could not be listed: (.*)\)$/,
    "ワークスペースのソース識別: $1 のプロジェクトルートの一覧を取得できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): \.aidlc-source-paths\.json could not be read: (.*)\)$/,
    "ワークスペースのソース識別: $1 の .aidlc-source-paths.json を読み取れません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the workspace root could not be resolved: (.*)\)$/,
    "ワークスペースのソース識別: $1 のワークスペースルートの実体を特定できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the file could not be hashed\)$/,
    "ワークスペースのソース識別: $1 のファイルのハッシュを計算できません",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the directory could not be resolved: (.*)\)$/,
    "ワークスペースのソース識別: $1 のディレクトリの実体を特定できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the directory could not be listed: (.*)\)$/,
    "ワークスペースのソース識別: $1 のディレクトリの一覧を取得できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the entry could not be stat'ed: (.*)\)$/,
    "ワークスペースのソース識別: $1 の項目のファイル情報を取得できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the symlink could not be read: (.*)\)$/,
    "ワークスペースのソース識別: $1 のシンボリックリンクを読み取れません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the symlink target could not be stat'ed: (.*)\)$/,
    "ワークスペースのソース識別: $1 のシンボリックリンク先のファイル情報を取得できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(unreadable at (.+): the multi-repo roof could not be listed: (.*)\)$/,
    "ワークスペースのソース識別: $1 の複数リポジトリの共通ルートの一覧を取得できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(excluded-path at (.+): a registered source path lies under the framework shell or a hard-excluded directory\)$/,
    "ワークスペースのソース識別: 登録済みのソースパス $1 は、フレームワークのシェルまたは必ず除外されるディレクトリの配下にあります",
  ],
  [
    /^Workspace source boundary binds: no \(excluded-path at (.+): a registered source path lies under a path this worktree excludes\)$/,
    "ワークスペースのソース識別: 登録済みのソースパス $1 は、この作業ツリーで除外するパスの配下にあります",
  ],
  [
    /^Workspace source boundary binds: no \(excluded-path at (.+): a registered source path resolves into the framework shell or a hard-excluded directory\)$/,
    "ワークスペースのソース識別: 登録済みのソースパスの実体 $1 は、フレームワークのシェルまたは必ず除外されるディレクトリの配下にあります",
  ],
  [
    /^Workspace source boundary binds: no \(external-symlink at (.+): a registered source path leaves the project through a symlink and comes back inside it\)$/,
    "ワークスペースのソース識別: 登録済みのソースパス $1 は、シンボリックリンクでプロジェクト外を経由して内部に戻ります",
  ],
  [
    /^Workspace source boundary binds: no \(dangling-symlink at (.+): a registered source path resolves through a symlink whose target is missing\)$/,
    "ワークスペースのソース識別: 登録済みのソースパス $1 が経由するシンボリックリンクの参照先がありません",
  ],
  [
    /^Workspace source boundary binds: no \(symlink-loop at (.+): a registered source path could not be resolved: a symlink in it loops or cannot be read\)$/,
    "ワークスペースのソース識別: 登録済みのソースパス $1 内のシンボリックリンクが循環しているか読み取れず、実体を特定できません",
  ],
  [
    /^Workspace source boundary binds: no \(harness-shell-unresolved at (.+): the harness shell directories could not be resolved\)$/,
    "ワークスペースのソース識別: $1 の実行環境のシェルディレクトリを特定できません",
  ],
  [
    /^Workspace source boundary binds: no \(registered-sources-invalid at (.+): \.aidlc-source-paths\.json must be a regular file of at most 1 MiB, not a symlink\)$/,
    "ワークスペースのソース識別: $1 の .aidlc-source-paths.json は、シンボリックリンクではなく 1 MiB 以下の通常ファイルにしてください",
  ],
  [
    /^Workspace source boundary binds: no \(registered-sources-invalid at (.+): \.aidlc-source-paths\.json must be \{"version":1,"paths":\[<at most 10000 strings>\]\}\)$/,
    'ワークスペースのソース識別: $1 の .aidlc-source-paths.json は {"version":1,"paths":[...]} 形式で、paths に最大 10000 件の文字列を指定してください',
  ],
  [
    /^Workspace source boundary binds: no \(registered-sources-invalid at (.+): registered source path ("(?:[^"\\]|\\.)*") must be a relative path inside the project without "\." or "\.\." segments\)$/,
    'ワークスペースのソース識別: $1 に登録したソースパス $2 は、"." や ".." を含まないプロジェクト内の相対パスにしてください',
  ],
  [
    /^Workspace source boundary binds: no \(registered-sources-invalid at (.+): \.aidlc-source-paths\.json could not be parsed: (.*)\)$/,
    "ワークスペースのソース識別: $1 の .aidlc-source-paths.json を解析できません。詳細（原文）: $2",
  ],
  [
    /^Workspace source boundary binds: no \(worktree-context-unresolved at (.+): the worktree's source exclusion context could not be read\)$/,
    "ワークスペースのソース識別: $1 から作業ツリーのソース除外情報を読み取れません",
  ],
  [
    /^Workspace source boundary binds: no \(walk-failed at (.+): the file produced no listing entry\)$/,
    "ワークスペースのソース識別: $1 のファイルをソース一覧に記録できません",
  ],
  [
    /^Workspace source boundary binds: no \(walk-failed at (.+): the symlink produced no listing entry\)$/,
    "ワークスペースのソース識別: $1 のシンボリックリンクをソース一覧に記録できません",
  ],
  [
    /^Workspace source boundary binds: no \(walk-failed at (.+): the dangling symlink produced no listing entry\)$/,
    "ワークスペースのソース識別: $1 の参照先がないシンボリックリンクをソース一覧に記録できません",
  ],
  [
    /^Workspace source boundary binds: no \(walk-failed at (.+): the embedded git repository has no resolvable HEAD commit\)$/,
    "ワークスペースのソース識別: $1 の内包された Git リポジトリの HEAD コミットを特定できません",
  ],
  [
    /^Workspace source boundary binds: no \(walk-failed at (.+): the embedded repository produced no listing entry\)$/,
    "ワークスペースのソース識別: $1 の内包されたリポジトリをソース一覧に記録できません",
  ],
  [
    /^Workspace source boundary binds: no \(walk-failed at (.+): the special file produced no listing entry\)$/,
    "ワークスペースのソース識別: $1 の特殊ファイルをソース一覧に記録できません",
  ],
  [
    /^Workspace source boundary binds: no \(walk-failed at (.+): the source walk stopped without a recorded reason\)$/,
    "ワークスペースのソース識別: $1 でソースの走査が停止しました。理由の記録はありません",
  ],
  [
    /^Windows uninstall recovery: (\d+) pending and (\d+) invalid continuation\(s\): (.+)$/,
    "Windows のアンインストール復旧: 保留中 $1 件、不正な後処理 $2 件: $3",
  ],
  [/^Update: binary (\S+), latest (\S+)$/, "更新確認: 使用中 $1、最新 $2"],
  [
    /^Update: binary (\S+); update cache is stale$/,
    "更新確認: 使用中 $1。更新確認のキャッシュが古くなっています",
  ],
  [/^Update: binary (\S+) is latest$/, "更新確認: $1 は最新です"],
  [/^Plugins: (\d+) need attention$/, "プラグイン: $1 件の確認が必要です"],
  [/^Plugins: (\d+) require sync$/, "プラグイン: $1 件の同期が必要です"],
  [/^Models: (\d+) policy issue\(s\)$/, "モデル: ポリシーに $1 件の問題があります"],
  [
    /^Instruction file: hand-modified - conflict \((.+)\)$/,
    "指示ファイル: 手動変更と競合しています: $1",
  ],
  [
    /^Instruction file: block or file missing \((.+)\)$/,
    "指示ファイル: ブロックまたはファイルがありません: $1",
  ],
  [
    /^Runtime hook PATH: (bun|aidlc) -> (.+) \(non-interactive baseline\)$/,
    "フックの PATH: $1 → $2。非対話実行の環境で利用できます",
  ],
  [
    /^Runtime hook PATH: (bun|aidlc) is not required by the selected projection$/,
    "フックの PATH: 選択された実行環境では $1 は不要です",
  ],
  [
    /^Runtime hook PATH: (bun|aidlc) is interactive-only at (.+)$/,
    "フックの PATH: $1 は対話実行でのみ利用できます: $2",
  ],
  [/^Runtime hook PATH: (bun|aidlc) is missing$/, "フックの PATH: $1 が見つかりません"],
  [/^Harness CLI: (\S+) (.*) at (.+)$/, "実行環境の CLI: $1 $2、場所: $3"],
  [/^Harness CLI: none required for (\S+)$/, "実行環境の CLI: $1 では不要です"],
  [
    /^Harness CLI: (\S+) (\S+) is below (\S+)$/,
    "実行環境の CLI: $1 $2 は必要なバージョン $3 より古いです",
  ],
  [/^Harness CLI: (\S+) is missing$/, "実行環境の CLI: $1 が見つかりません"],
  [
    /^Harness CLI: optional (\S+) is not installed$/,
    "実行環境の CLI: 任意の $1 はインストールされていません",
  ],
  [/^Installed runtime: (\S+) \[([^\]]+)\]$/, "インストール済みランタイム: $1 [$2]"],
  [
    /^Installed runtime (\S+) has no harness installed$/,
    "インストール済みランタイム $1 に実行環境がありません",
  ],
  [/^Command pointer: (.+) -> (\S+)$/, "コマンドの参照先: $1 → $2"],
  [
    /^Command pointer is missing or does not select active version (\S+)$/,
    "コマンドの参照先がないか、使用するバージョン $1 を選択していません",
  ],
  [
    /^Rollback target: (\S+) is complete and eligible$/,
    "ロールバック先: $1 は完全な状態で利用できます",
  ],
  [/^Rollback target is not eligible: (".*")$/, "ロールバック先として利用できません: $1"],
  [
    /^Project pin registry: stale registrations: (.+)$/,
    "プロジェクトの固定バージョン一覧: 古い登録があります: $1",
  ],
  [
    /^Transaction staging: (\d+) abandoned path\(s\): (.+)$/,
    "一時作業ディレクトリ: $1 件が放置されています: $2",
  ],
  [
    /^Transaction recovery: (\d+) quarantined path\(s\): (.+)$/,
    "処理の復旧: $1 件が隔離されています: $2",
  ],
  [/^Project runtime stamp: (\S+) \((\S+)\)$/, "プロジェクトのランタイム情報: $1 ($2)"],
  [
    /^Project runtime stamp: (\S+); selected engine: (\S+)$/,
    "プロジェクトのランタイム情報: $1、選択中のエンジン: $2",
  ],
  [/^Project pin is malformed: (".*")$/, "プロジェクトの固定バージョンが不正です: $1"],
  [/^Project pin: (\S+) is installed$/, "プロジェクトの固定バージョン: $1 はインストール済みです"],
  [
    /^Project pin: (\S+) is not installed completely$/,
    "プロジェクトの固定バージョン: $1 のインストールが不完全です",
  ],
  [
    /^Project pin target: (\S+) resolves before engine startup$/,
    "プロジェクトの固定バージョン: エンジン起動前に $1 を解決できます",
  ],
  [
    /^Hooks DISABLED via "disableAllHooks": true in (.+) — AI-DLC cannot run \(audit, state sync, sensors, and stage-graph rebuild are all silently skipped even though the hook files are present\)$/,
    'フックが $1 の "disableAllHooks": true で無効です。AI-DLC は動作できません。フックのファイルが存在しても、監査・状態同期・センサー・ステージグラフの再構築が実行されません',
  ],
  [
    /^Multi-harness install detected \(([^)]+)\) with an active workflow - supported but untested; keep all trees at the same framework version$/,
    "実行中のワークフローに複数の実行環境があります: $1。対応していますが未検証です。すべて同じフレームワークのバージョンにそろえてください",
  ],
  [/^AWS_AIDLC_DEFAULT_SCOPE=(.+) \(valid\)$/, "AWS_AIDLC_DEFAULT_SCOPE=$1 は有効です"],
  [/^AWS_AIDLC_DEFAULT_SCOPE=(.+) \(invalid\)$/, "AWS_AIDLC_DEFAULT_SCOPE=$1 は無効です"],
  [
    /^Enabled plugins: all enabled \(no selection\); enabled stage counts: ([\w=, -]+)$/,
    "有効なプラグイン: すべて有効です。個別選択はありません。有効なステージ数: $1",
  ],
  [
    /^Enabled plugins: ([\w, -]*); enabled stage counts: ([\w=, -]+)$/,
    "有効なプラグイン: $1。有効なステージ数: $2",
  ],
  [
    /^Plugin selection flags: (\d+) disagreement\(s\)$/,
    "プラグインの選択設定: $1 件の不一致があります",
  ],
  [
    /^Enabled stage compile coverage: (\d+) enabled stage file\(s\) missing from the full graph$/,
    "有効なステージのコンパイル状況: $1 件の有効なステージがグラフにありません",
  ],
  [
    /^Enabled stage compile coverage: (\d+) uncompiled stage file\(s\) - no selection active, see the Uncompiled stage files advisory$/,
    "有効なステージのコンパイル状況: $1 件が未コンパイルです。個別選択はありません。「未コンパイルのステージ」の注意事項を確認してください",
  ],
  [
    /^Composed plugin surface: (\d+) missing composition item\(s\)$/,
    "プラグイン構成: $1 件の構成項目がありません",
  ],
  [
    /^Plugin selection vs active workflows: (\d+) stranded dependency\(ies\)$/,
    "プラグインと実行中のワークフロー: $1 件の依存関係が利用できません",
  ],
  [
    /^Selection-dropped ordering edges \(advisory\): (\d+) requires_stage edge\(s\) point at disabled stages - (.+)$/,
    "プラグイン選択による順序依存の除外: $1 件の requires_stage が無効なステージを参照しています。要確認: $2",
  ],
  [
    /^workspace shell ready \((\.[\w-]+)\/ \+ aidlc\/spaces\/default\/memory\/\)$/,
    "ワークスペースの基本構成: $1/ + aidlc/spaces/default/memory/",
  ],
  [
    /^Agent filename\/name consistency: all agent files match declared names$/,
    "エージェント名: すべてのファイル名が宣言された名前と一致しています",
  ],
  [
    /^Scope filename\/name consistency: all scope files match declared names$/,
    "スコープ名: すべてのファイル名が宣言された名前と一致しています",
  ],
  [
    /^Submodules: (\d+) declared, all initialized$/,
    "サブモジュール: 登録された $1 件はすべて初期化済みです",
  ],
  [
    /^Submodules: (\d+) declared, (\d+) uninitialized \(advisory\) \((.+)\) - run `([^`]+)` to fetch them so reverse-engineering can read the code$/,
    "サブモジュール: 登録 $1 件のうち $2 件が未初期化です: $3。`$4` で取得し、既存コードの分析で読み取れるようにしてください",
  ],
  [
    /^Hooks last fired ([\dTZ:.+ -]+), but the workflow last advanced ([\dTZ:.+ -]+)$/,
    "フックの最終実行は $1 ですが、ワークフローの最終進行は $2 です",
  ],
  [
    /^Hooks have never executed although this workflow has progressed (\d+) stages?$/,
    "ワークフローは $1 ステージ進みましたが、フックは一度も実行されていません",
  ],
  [
    /^Human-turn receipts: 0 HUMAN_TURN rows across (\d+) stage\/gate event\(s\) \(advisory\) - receipts are not being minted, so presence-gated checkpoints will refuse$/,
    "ユーザー参加の記録: $1 件のステージ・承認イベントに HUMAN_TURN がありません。参加記録が必要なチェックポイントを通過できません",
  ],
  [
    /^Hook drops \(([\w.-]+)\): (\d+) degraded of (\d+)$/,
    "フックの処理失敗 ($1): $3 件のうち $2 件が部分的に失敗しています",
  ],
  [
    /^State\/audit drift: audit has WORKFLOW_COMPLETED but state Status=(.+)$/,
    "状態と監査の不一致: 監査には WORKFLOW_COMPLETED がありますが、状態は Status=$1 です",
  ],
  [/^State Version: (\d+)$/, "状態ファイルのバージョン: $1"],
  [
    /^Approval gate pending: (.+) \(~([\dhms ]+)\); waiting for a human, not stuck\. Run \/aidlc --status to review the current gate\.$/,
    "承認待ち: $1。約 $2 経過しています。ユーザーの判断を待っています。/aidlc --status で現在の承認内容を確認してください。",
  ],
  [
    /^Unit claim stamp stale: ([\w.-]+) generation (\d+) is tombstoned or superseded$/,
    "ユニット担当の記録が古くなっています: $1 の世代 $2 は削除済みか、新しい記録で置き換えられています",
  ],
  [
    /^Unit claim activity baseline missing \(advisory\): ([\w., -]+) - run \/aidlc --status after the next explicit fetch to establish a local observed-ref timestamp$/,
    "ユニット担当の活動基準がありません: $1。次の明示的な取得後に /aidlc --status を実行し、参照を確認した日時を記録してください",
  ],
  [
    /^Unit claim activity: (\d+) claim\(s\) with no observed ref movement for (\d+)h \(([^)]+)\) - report only; inspect the team checkout and release only after a human decision$/,
    "ユニット担当の活動: $1 件で $2 時間、参照の変化がありません: $3。診断による報告のみです。チームの作業ディレクトリを確認し、人が判断してから担当を解除してください",
  ],
  [
    /^Orphan Unit claim refs: (\d+) ref\(s\) match no local intent \((.+)\)$/,
    "対応のないユニット担当の参照: $1 件にローカルの作業記録がありません: $2",
  ],
  [
    /^Stale branches: 0 \((\d+) bolt-\* observed\)$/,
    "古いブランチ: 検出されていません。bolt-* を $1 件確認しました",
  ],
  [/^Orphan audit: 0 \((\d+) reconciled\)$/, "対応のない監査記録: ありません。$1 件を照合しました"],
  [
    /^Orphan state files: 0 \((\d+) active\)$/,
    "対応のない状態ファイル: ありません。$1 件が使用中です",
  ],
  [/^Practices staleness: affirmed (\d+) days? ago$/, "開発手順の確認時期: $1 日前に確認済みです"],
  [
    /^Practices staleness: affirmed (\d+) days ago \(advisory: > (\d+) days; consider re-running practices-discovery\)$/,
    "開発手順の確認時期: $1 日前で、$2 日を超えています。practices-discovery での再確認を検討してください",
  ],
  [
    /^Practices staleness: affirmed in the future \(clock skew or hand-edited timestamp (\d+) days? ahead\)$/,
    "開発手順の確認時期: 確認日時が $1 日先になっています。時計のずれか、日時の手動変更が考えられます",
  ],
  [
    /^MERGE_DISPATCH: 0 orphan INVOKED \((\d+) bracketed\)$/,
    "MERGE_DISPATCH: 終了記録のない INVOKED はありません。$1 件の開始と終了を照合しました",
  ],
  [
    /^MERGE_DISPATCH: (\d+) orphan INVOKED \(advisory - a merge started but no matching finish was recorded within (\d+)s\)$/,
    "MERGE_DISPATCH: $1 件の INVOKED に終了記録がありません。マージ開始後 $2 秒以内に対応する終了が記録されていません",
  ],
  [/^Cycle detection: (\d+) cycle\(s\) found$/, "循環依存: $1 件を検出しました"],
  [
    /^Orphan stage files: (\d+) graph entries all have files$/,
    "ステージファイル: グラフの $1 件すべてに対応するファイルがあります",
  ],
  [
    /^Orphan stage files: (\d+) graph entries have no file on disk$/,
    "ステージファイル: グラフの $1 件に対応するファイルがありません",
  ],
  [
    /^Scope validation: (\d+) scopes valid \((\d+) advisories\)$/,
    "スコープ検証: $1 件が有効です。注意事項 $2 件",
  ],
  [
    /^Scope validation: (\d+) of (\d+) scopes have errors$/,
    "スコープ検証: $2 件のうち $1 件にエラーがあります",
  ],
  [
    /^Schema validation: (\d+)\/(\d+) stages validated$/,
    "スキーマ検証: $2 ステージのうち $1 件が正常です",
  ],
  [
    /^Schema validation: (\d+) of (\d+) stage\(s\) failed$/,
    "スキーマ検証: $2 ステージのうち $1 件が失敗しました",
  ],
  [
    /^Graph references: (\d+) artifacts \+ edges resolved$/,
    "グラフの参照: $1 件の成果物と依存関係を解決できました",
  ],
  [/^Graph references: (\d+) broken reference\(s\)$/, "グラフの参照: $1 件の参照先が不正です"],
  [/^Keyword overlap: (\d+) conflict\(s\)$/, "キーワードの重複: $1 件の競合があります"],
  [
    /^Paired sensor coverage: no sensor-bound rules \((\d+) feedforward-only\)$/,
    "ルールとセンサーの対応: センサーを必要とするルールはありません。事前指示のみ $1 件",
  ],
  [
    /^Paired sensor coverage: (\d+)\/(\d+) guardrails paired \((\d+) feedforward-only\)$/,
    "ルールとセンサーの対応: $2 件のうち $1 件が対応済みです。事前指示のみ $3 件",
  ],
  [/^Providers: (\d+) unmet item\(s\)$/, "プロバイダー: $1 件の未完了項目があります"],
  [
    /^Flags: (\d+) environment or surface override\(s\)$/,
    "動作設定: $1 件が環境変数または実行環境の設定で上書きされています",
  ],
  [/^Settings global: (.+) is valid$/, "共通設定: $1 は有効です"],
  [/^Settings project: (.+) is valid$/, "プロジェクト設定: $1 は有効です"],
  [/^Settings local: (.+) is valid$/, "ローカル設定: $1 は有効です"],
  [/^Settings global: (.+) is invalid$/, "共通設定: $1 は不正です"],
  [/^Settings project: (.+) is invalid$/, "プロジェクト設定: $1 は不正です"],
  [/^Settings local: (.+) is invalid$/, "ローカル設定: $1 は不正です"],
  [/^Settings local: (.+) is git-tracked$/, "ローカル設定: $1 が Git の追跡対象になっています"],
  [/^Settings local: (.+) is not git-tracked$/, "ローカル設定: $1 は Git の追跡対象ではありません"],
  [
    /^Workspace siblings: (\d+) required path\(s\) missing$/,
    "ワークスペースの関連ディレクトリ: $1 件の必要なパスがありません",
  ],
  [
    /^Stage "([^"]+)" has an unresolved approval gate\.$/,
    "ステージ「$1」に未解決の承認があります。",
  ],
  [
    /^Ensemble stage "([^"]+)" is missing or has malformed collaborator evidence\.$/,
    "共同作業ステージ「$1」の協力エージェントの成果記録がないか、不正です。",
  ],
  [
    /^Audit recorded WORKFLOW_COMPLETED but state Status=(.+)\.$/,
    "監査には WORKFLOW_COMPLETED がありますが、状態は Status=$1 です。",
  ],
  [
    /^Hook "([\w.-]+)" has not fired in over (\d+)h\.$/,
    "フック「$1」は $2 時間以上実行されていません。",
  ],
  [
    /^Hook "([\w.-]+)" recorded (\d+) degraded drop\(s\)\.$/,
    "フック「$1」で $2 件の部分的な処理失敗を記録しています。",
  ],
  [/^(?:all )?(\d+) checks passed$/, "$1 件の検査が正常です"],
];

const fixPatterns: readonly TranslationPattern[] = [
  // 2.11.2
  [
    /^`([^`]+ engine hook)` runs only the hooks the installed runtime ships; register a project hook in \.claude\/settings\.json with a command that runs its own file$/,
    "`$1` が実行できるのは、インストール済みのランタイムに含まれるフックだけです。プロジェクト独自のフックは、そのファイル自体を実行するコマンドで .claude/settings.json に登録してください",
  ],
  [
    /^ask the agent to turn Kiro CLI Workflows off, or run `([^`]+)` \(a Kiro CLI setting for all your projects\); then quit Kiro CLI and start `kiro-cli` again$/,
    "Kiro CLI Workflows をオフにするようエージェントに頼むか、`$1` を実行してください（すべてのプロジェクトに効く Kiro CLI の設定です）。その後、Kiro CLI を終了し、`kiro-cli` を起動し直してください",
  ],
  [
    /^move the project to a shorter folder \(for example (.+?)\)$/,
    "プロジェクトを短いフォルダー（例: $1）に移してください",
  ],
  [
    /^move the project to a shorter folder \(for example (.+?)\), or turn Git's long paths on: run (git config --global core\.longpaths true)$/,
    "プロジェクトを短いフォルダー（例: $1）に移すか、Git の長いパスを有効にしてください（$2 を実行します）",
  ],
  [
    /^move the project to a shorter folder \(for example (.+?)\), or turn Windows long paths on: set LongPathsEnabled to 1 in (\S+) as an administrator$/,
    "プロジェクトを短いフォルダー（例: $1）に移すか、Windows の長いパスを有効にしてください（管理者として $2 の LongPathsEnabled を 1 にします）",
  ],
  [
    /^move the project to a shorter folder \(for example (.+?)\), or turn long paths on: set LongPathsEnabled to 1 in (\S+) as an administrator, then run (git config --global core\.longpaths true)$/,
    "プロジェクトを短いフォルダー（例: $1）に移すか、長いパスを有効にしてください（管理者として $2 の LongPathsEnabled を 1 にしてから、$3 を実行します）",
  ],
  // 2.11.1
  [/^run `([^`]+ engine plugin sync)`$/, "`$1` を実行してください"],
  [/^run `([^`]+ --session-model \S+)`$/, "`$1` を実行してください"],
  [
    /^run `([^`]+)`, or choose one in Kiro with \/model, then \/model set-current-as-default to save it$/,
    "`$1` を実行するか、Kiro の /model でモデルを選び、/model set-current-as-default で保存してください",
  ],
  [
    /^run `([^`]+)`, or choose an effort in Kiro with \/effort$/,
    "`$1` を実行するか、Kiro の /effort で effort を選んでください",
  ],
  [
    /^correct the file, or in Kiro run Terminal: Select Default Profile from the Command Palette and choose PowerShell$/,
    "ファイルを修正するか、Kiro のコマンドパレットで Terminal: Select Default Profile を実行して PowerShell を選んでください",
  ],
  [
    /^ask the agent to set Kiro's terminal to PowerShell, or run `([^`]+)` \(a Kiro setting for all your projects\); then restart Kiro$/,
    "Kiro のターミナルを PowerShell にするようエージェントに頼むか、`$1` を実行してください（すべてのプロジェクトに効く Kiro の設定です）。その後、Kiro を再起動してください",
  ],
  [
    /^ask the agent to turn Kiro Workflows off, or run `([^`]+)` \(a Kiro setting for all your projects\); then run Developer: Reload Window from the Command Palette$/,
    "Kiro Workflows をオフにするようエージェントに頼むか、`$1` を実行してください（すべてのプロジェクトに効く Kiro の設定です）。その後、コマンドパレットから Developer: Reload Window を実行してください",
  ],
  [/^fix the error in (.+)$/, "$1 の誤りを修正してください"],
  [
    /^turn ([\w.-]+) back on under Kiro's Agent Hooks, or set "enabled": true in (.+)$/,
    'Kiro の Agent Hooks で $1 をオンに戻すか、$2 で "enabled": true にしてください',
  ],
  [
    /^turn them back on under Kiro's Agent Hooks, or set "enabled": true in their (.+)\/hooks\/ files$/,
    'Kiro の Agent Hooks でオンに戻すか、$1/hooks/ の各ファイルで "enabled": true にしてください',
  ],
  [/^move them out, then run `([^`]+)`$/, "それらを移動してから `$1` を実行してください"],
  [
    /^close Claude Code and Codex, then run `([^`]+)`$/,
    "Claude Code と Codex を閉じてから `$1` を実行してください",
  ],
  [
    /^run `([^`]+)`; it names anything that stops the refresh$/,
    "`$1` を実行してください。更新を止めているものがあれば表示されます",
  ],
  [
    /^make aidlc\/active-memory\/ writable in the project root \(it is AI-DLC's git-ignored copy; remove what is there if it is not a plain folder of files\), then run \/aidlc or `([^`]+)`$/,
    "プロジェクトのルートで aidlc/active-memory/ を書き込み可能にしてください（AI-DLC が git の対象外で保持するコピーです。通常のファイルのフォルダーでなければ、中身を削除してください）。その後、/aidlc か `$1` を実行してください",
  ],
  [
    /^do the request folder steps below first; then this row names the commit$/,
    "先に下の依頼フォルダーの手順を行ってください。その後、この行にコミットの方法が表示されます",
  ],
  [
    /^Plan approval is off for this piece of work, so the plan is built as written, without a check of the project's files\. Repair the source boundary: add the offending path to the exclude list in \.aidlc-source-paths\.json, declare real source under an excluded directory in its paths list, or remove the broken symlink; then run next\.$/,
    "この作業では計画承認がオフのため、計画はプロジェクトのファイルを確認せずにそのまま作られます。ソースの範囲を直してください: 問題のパスを .aidlc-source-paths.json の除外リストに加えるか、除外したディレクトリ内の実際のソースを paths に宣言するか、壊れたシンボリックリンクを削除してから、next を実行します。",
  ],
  [
    /^The plan question is asked as usual, and the build starts without a check of the project's files\. Repair the source boundary: add the offending path to the exclude list in \.aidlc-source-paths\.json, declare real source under an excluded directory in its paths list, or remove the broken symlink; then run next\.$/,
    "計画の確認はいつもどおり行われ、プロジェクトのファイルを確認せずにビルドが始まります。ソースの範囲を直してください: 問題のパスを .aidlc-source-paths.json の除外リストに加えるか、除外したディレクトリ内の実際のソースを paths に宣言するか、壊れたシンボリックリンクを削除してから、next を実行します。",
  ],
  [
    /^Plan Approval decisions are refused while the source cannot be bound\. Repair the source boundary: add the offending path to the exclude list in \.aidlc-source-paths\.json, declare real source under an excluded directory in its paths list, or remove the broken symlink; then run next\. Last resort, only on your own word: ask the assistant in chat to build the plan anyway, and it is recorded as your approval with no check of the project's files\.$/,
    "ソースを結び付けられない間は、計画承認の判断は拒否されます。ソースの範囲を直してください: 問題のパスを .aidlc-source-paths.json の除外リストに加えるか、除外したディレクトリ内の実際のソースを paths に宣言するか、壊れたシンボリックリンクを削除してから、next を実行します。最後の手段として、あなた自身の言葉でのみ: チャットでアシスタントに「それでも計画どおり作って」と頼むと、プロジェクトのファイルを確認しない承認として記録されます。",
  ],
  // 2.11.0
  [
    /^This is expected before your first opencode chat in this folder\. If you already started one, quit opencode and start it again with just `opencode` in (.+), then run doctor again\.$/,
    "このフォルダーで opencode のチャットを始める前は、この表示になります。すでに始めている場合は、opencode を終了し、$1 で `opencode` だけを実行して起動し直してから、doctor をもう一度実行してください。",
  ],
  [
    /^health dir exists and the ledger shows STAGE_STARTED, but no hook has ever fired: (.+)$/,
    "診断記録ディレクトリと STAGE_STARTED の記録はありますが、フックが一度も実行されていません: $1",
  ],
  [
    /^run `([^`]+) next` as its own command; it hands the current step out again, and an approval that still matches is kept$/,
    "`$1 next` を単独のコマンドとして実行してください。現在の手順をもう一度受け取り、内容が一致する承認は保持されます",
  ],
  [
    /^run `([^`]+) --status` to review and resolve the pending approval$/,
    "`$1 --status` を実行し、保留中の承認を確認して解決してください",
  ],
  [
    /^run copilot in this folder once and choose "Yes, and remember this folder for future sessions", or add (".+") to trustedFolders in (.+) yourself$/,
    'このフォルダーで copilot を一度実行して "Yes, and remember this folder for future sessions" を選ぶか、$3 の trustedFolders に $2 を自分で追加してください',
  ],
  [
    /^repair (.+) as valid JSONC, then re-run doctor$/,
    "$1 を正しい JSONC に直してから、doctor を再実行してください",
  ],
  [
    /^set "chat\.agentEngine": "v3" and "chat\.defaultAgent": "aidlc" in \.kiro\/settings\/cli\.json and keep its other keys; otherwise (.+), which replaces the whole file$/,
    '.kiro/settings/cli.json で "chat.agentEngine": "v3" と "chat.defaultAgent": "aidlc" を設定し、ほかのキーはそのまま残してください。難しい場合は $1 を実行します（ファイル全体が置き換わります）',
  ],
  [
    /^Nothing needs changing when you start (.+) from a terminal: it hands that terminal's PATH to AI-DLC's hooks\. If you start it from a desktop icon, the dock, or a service and AI-DLC's hooks do not run, add (\S+) to (.+), then restart \1\. Editing \.bashrc or \.zshrc does not change this check\.$/,
    "ターミナルから $1 を起動する場合は変更不要です。そのターミナルの PATH が AI-DLC のフックに渡されます。デスクトップのアイコン、Dock、サービスから起動して AI-DLC のフックが動かない場合は、$2 を $3 に追加し、$1 を再起動してください。.bashrc や .zshrc を編集しても、この検査結果は変わりません。",
  ],
  [
    /^AI-DLC in this project runs on Bun \(the installed aidlc command does not need it\)\. Install Bun, then add its install directory to the Windows User or Machine PATH, not only a shell profile\.$/,
    "このプロジェクトの AI-DLC は Bun で動作します（インストール済みの aidlc コマンドには不要です）。Bun をインストールし、シェルのプロファイルだけでなく、Windows のユーザーまたはシステムの PATH にもインストール先のディレクトリを追加してください。",
  ],
  [
    /^AI-DLC in this project runs on Bun \(the installed aidlc command does not need it\)\. Install Bun, then add ~\/\.bun\/bin to the PATH (.+) starts with \((.+)\), not only \.zshrc or \.bash_profile\.$/,
    "このプロジェクトの AI-DLC は Bun で動作します（インストール済みの aidlc コマンドには不要です）。Bun をインストールし、.zshrc や .bash_profile だけでなく、$1 の起動時の PATH（$2）にも ~/.bun/bin を追加してください。",
  ],
  [
    /^Add ~\/\.local\/bin to the PATH (.+) starts with \((.+)\), not only an interactive shell rc file\.$/,
    "対話シェルの設定ファイルだけでなく、$1 の起動時の PATH（$2）にも ~/.local/bin を追加してください。",
  ],
  [
    /^The workflow is waiting at an approval gate\. Resolve it with `([^`]+)` \(answer the open question \/ approve or reject the stage\), then continue\.$/,
    "ワークフローは承認ゲートで待機しています。`$1` で解決してから（未回答の質問に答えるか、ステージを承認または却下する）、続けてください。",
  ],
  [
    /^The resolve output is corrupt\. Re-run the resolve step \(`([^`]+)` will recompute the plan\), or remove \.aidlc-engine\/plan\.json to force a fresh resolve\.$/,
    "計画の解決結果が壊れています。`$1` で計画を再計算するか、.aidlc-engine/plan.json を削除して計画を作り直してください。",
  ],
  [
    /^The compiled runtime graph is out of date\. Re-run `([^`]+)`\. If it goes out of date again, AI-DLC's hooks are not running here: doctor's hooks check says what to do\.$/,
    "コンパイル済みのランタイムグラフが古くなっています。`$1` を再実行してください。再び古くなる場合は、ここで AI-DLC のフックが実行されていません。対処は doctor のフックの検査結果を確認してください。",
  ],
  [
    /^No compiled runtime graph\. Re-run `([^`]+)`\. If it goes missing again, AI-DLC's hooks are not running here: doctor's hooks check says what to do\.$/,
    "コンパイル済みのランタイムグラフがありません。`$1` を再実行してください。再びなくなる場合は、ここで AI-DLC のフックが実行されていません。対処は doctor のフックの検査結果を確認してください。",
  ],
  [
    /^aidlc-state\.md most likely missed an update after the audit was written\. Until the two agree, the workflow can refuse to finish a stage it already ran, and the status view and statusline show less progress than was made\. To fix it, edit aidlc-state\.md: (.+)\. Then continue the workflow\.$/,
    "監査ログの記録後に aidlc-state.md の更新が漏れた可能性が高いです。両者が一致するまで、実行済みのステージを完了できない場合があり、状態表示やステータス行の進捗も実際より少なく表示されます。aidlc-state.md を次のとおり編集してください: $1。そのあとワークフローを続けてください。",
  ],
  [
    /^The workflow refuses to finish ([\w-]+) while it shows as not started\. If \1 is the stage you are working on, edit aidlc-state\.md: (.+)\. Otherwise set Current Stage to the stage the workflow is actually on\.$/,
    "$1 が未着手と表示されている間、ワークフローはこのステージを完了できません。作業中のステージが $1 なら、aidlc-state.md を次のとおり編集してください: $2。そうでなければ、Current Stage を実際のステージに設定してください。",
  ],
  [
    /^remove "chat\.defaultModel" from (\S+), or run `([^`]+)` to refresh it$/,
    '$1 から "chat.defaultModel" を削除するか、`$2` を実行して更新してください',
  ],
  [/^run `([^`]+)` and choose a model$/, "`$1` を実行してモデルを選んでください"],
  [
    /^run `([^`]+)`, or choose one in Kiro with \/model$/,
    "`$1` を実行するか、Kiro の /model でモデルを選んでください",
  ],
  [
    /^run `([^`]+) --session-model (\S+)` to set it again$/,
    "`$1 --session-model $2` を実行して設定し直してください",
  ],
  [
    /^correct (.+), then set "chat\.agent\.maxRequests" to 100 or more \(AI-DLC suggests 200\); below 100, VS Code stops a long stage to ask "Continue to iterate\?" and the chat waits until someone answers$/,
    '$1 を直してから、"chat.agent.maxRequests" を 100 以上（AI-DLC の推奨は 200）に設定してください。100 未満では、VS Code が長いステージの途中で "Continue to iterate?" と尋ね、誰かが答えるまでチャットが止まります',
  ],
  [
    /^run `([^`]+)` in the project root to recreate the harness tree and workspace shell$/,
    "プロジェクトのルートで `$1` を実行し、実行環境とワークスペースの基本構成を再作成してください",
  ],
  [
    /^Run (.+) to restore the complete ([\w-]+) projection, including sibling directories\.$/,
    "`$1` を実行し、兄弟ディレクトリを含む $2 の構成全体を復元してください。",
  ],
  [/^(?:run|re-run) `([^`]+)`$/, "`$1` を実行してください"],
  [
    /^run `([^`]+)`, correct the named condition, then rerun `([^`]+)`$/,
    "`$1` を実行し、表示された問題を修正してから `$2` を再実行してください",
  ],
  [
    /^run `([^`]+)` and correct the invalid update setting$/,
    "`$1` を実行し、不正な更新設定を修正してください",
  ],
  [/^refresh the project with `([^`]+)`$/, "`$1` でプロジェクトの設定を更新してください"],
  [
    /^review the local changes, then run `([^`]+)`$/,
    "ローカルの変更内容を確認し、`$1` を実行してください",
  ],
  [
    /^run `([^`]+)` or select the machine release with `([^`]+)`$/,
    "`$1` を実行するか、`$2` でマシンの使用バージョンを選択してください",
  ],
  [
    /^run `([^`]+)` or write one strict semver$/,
    "`$1` を実行するか、厳密なセマンティックバージョンを一つ記載してください",
  ],
  [
    /^run `([^`]+)` or write one release version id$/,
    "`$1` を実行するか、リリースのバージョン ID を一つ記載してください",
  ],
  [
    /^run `([^`]+)` to restore (.+) from the installed runtime$/,
    "`$1` を実行し、インストール済みランタイムから $2 を復元してください",
  ],
  [
    /^restore (.+) from git, or re-copy `([^`]+)` from the aidlc-workflows checkout$/,
    "Git から $1 を復元するか、aidlc-workflows の作業ディレクトリから `$2` をコピーし直してください",
  ],
  [
    /^copy the workspace shell from `([^`]+)` into your project root$/,
    "`$1` からワークスペースの基本構成をプロジェクトのルートにコピーしてください",
  ],
  [/^verify file exists in (.+)$/, "$1 にファイルが存在することを確認してください"],
  [/^valid values: ([\w, -]+)$/, "有効な値: $1"],
  [/^missing files: (.+)$/, "不足しているファイル: $1"],
  [/^cycles: ([\w; >-]+)$/, "循環依存の経路: $1"],
  [
    /^Install (Claude Code|Kiro CLI|opencode) and ensure `([^`]+)` works\.$/,
    "$1 をインストールし、`$2` が実行できることを確認してください。",
  ],
  [
    /^Install or upgrade Codex CLI to (\S+) or later\.$/,
    "Codex CLI $1 以降をインストールするか、更新してください。",
  ],
  [
    /^Install @github\/copilot (\S+) or later for CLI use; VS Code-only installs may omit it\.$/,
    "CLI を利用する場合は @github/copilot $1 以降をインストールしてください。VS Code のみで利用する場合は不要です。",
  ],
  [
    /^add "(.+)" to trustedFolders in ~\/\.copilot\/config\.json \(or accept the CLI's interactive trust prompt\)$/,
    '~/.copilot/config.json の trustedFolders に "$1" を追加するか、CLI の対話画面で信頼を承認してください',
  ],
  [
    /^remove "disableAllHooks": true from (.+) \(or set it to false in a higher-precedence layer such as \.claude\/settings\.local\.json\) and restart the Claude Code session — AI-DLC's workflow engine is hook-driven and cannot advance while hooks are disabled\.$/,
    '$1 の "disableAllHooks": true を削除するか、.claude/settings.local.json などの優先する設定で false にし、Claude Code のセッションを再起動してください。AI-DLC はフックで動作するため、フックが無効な間は進行できません。',
  ],
  [
    /^remove (.+) from git tracking and keep its \.gitignore entry$/,
    "$1 を Git の追跡対象から外し、.gitignore の除外設定を維持してください",
  ],
  [/^Expected the script under (.+)\.$/, "スクリプトは $1 以下に配置してください。"],
  [
    /^Replace (.+) with a regular file contained by (.+)\.$/,
    "$1 を $2 以下にある通常のファイルで置き換えてください。",
  ],
  [/^Inspect or replace (.+)\.$/, "$1 を確認するか、置き換えてください。"],
  [/^Verify (.+) can be run with Bun\.$/, "$1 を Bun で実行できることを確認してください。"],
  [
    /^Reduce the number of checks emitted by (.+)\.$/,
    "$1 が出力する診断項目の数を減らしてください。",
  ],
  [
    /^Practices Affirmed Timestamp value "([^"]*)" is not a valid ISO 8601 datetime\. Re-run practices-discovery \(stage 2\.2\) to re-affirm\.$/,
    'Practices Affirmed Timestamp の値 "$1" は有効な ISO 8601 日時ではありません。practices-discovery (ステージ 2.2) で確認し直してください。',
  ],
  [
    /^branches ([\w., -]+) have no worktree directory and no WORKTREE_MERGED\/_DISCARDED audit row\. Delete via 'git branch -D bolt-<slug>' if abandoned\.$/,
    "ブランチ $1 に作業ツリーと WORKTREE_MERGED/_DISCARDED の監査記録がありません。放棄済みなら 'git branch -D bolt-<slug>' で削除してください。",
  ],
  [
    /^state files for ([\w., -]+) exist but slug not in Bolt Refs and no WORKTREE_DISCARDED row\. Recover via 'aidlc-worktree discard --slug <slug>' \(idempotent\)\.$/,
    "$1 の状態ファイルはありますが、Bolt Refs と WORKTREE_DISCARDED の記録がありません。'aidlc-worktree discard --slug <slug>' で復旧してください。再実行しても安全です。",
  ],
  [
    /^the checkout stamp may linger after release; preserve any useful work, then delete (.+) and re-claim explicitly$/,
    "担当解除後の作業ディレクトリに記録が残っている可能性があります。必要な作業内容を保存し、$1 を削除してから明示的に担当を取得し直してください",
  ],
  [
    /^The compiled runtime graph is out of date\. Re-run `([^`]+)`; if this recurs, the rebuild-stage-graph hook may not be firing on this harness \(check hook heartbeats\)\.$/,
    "コンパイル済みの実行時グラフが古くなっています。`$1` を再実行してください。繰り返す場合は rebuild-stage-graph フックが動作していない可能性があるため、フックの実行記録を確認してください。",
  ],
  [
    /^No compiled runtime graph\. Re-run `([^`]+)`\. If it never appears, the rebuild-stage-graph hook is not firing on this harness\.$/,
    "コンパイル済みの実行時グラフがありません。`$1` を再実行してください。生成されない場合、この実行環境で rebuild-stage-graph フックが動作していません。",
  ],
];

const checkNames: Readonly<Record<string, string>> = {
  "Plugin selection": "プラグイン選択",
  "Agent filename/name consistency": "エージェントのファイル名と宣言名の整合性",
  "Scope filename/name consistency": "スコープのファイル名と宣言名の整合性",
  "Orphan worktrees": "対応のない作業ツリー",
  "Stale branches": "古いブランチ",
  "Orphan state files": "対応のない状態ファイル",
  "Orphan audit": "対応のない監査記録",
  "Orphan stage files": "ステージファイル",
  "Scope validation": "スコープ検証",
  "Schema validation": "スキーマ検証",
  "Graph references": "グラフの参照",
  "Duplicate producers": "成果物の生成元の重複",
  "Keyword overlap": "キーワードの重複",
  "Rule drift": "ルールの不一致",
  "Paired sensor coverage": "ルールとセンサーの対応",
};

const filePurposes: Readonly<Record<string, string>> = {
  "hook shim": "フックのアダプター",
  "hook wiring": "フックの登録",
  "workspace default-agent activation": "ワークスペースの既定エージェント",
  "model/provider/sandbox config": "モデル・プロバイダー・サンドボックスの設定",
  "permission prefix rules": "コマンド接頭辞の実行許可",
  "/aidlc entry point": "/aidlc の開始点",
  "persona custom agents": "役割別のカスタムエージェント",
  "onboarding + method imports": "導入案内と手順ファイルの読み込み",
  "Shell(bun) permission pre-approval": "Shell(bun) の事前実行許可",
  "standing method rule (alwaysApply read instruction)": "常時適用する手順ルールの読み込み指示",
  "Ideation phase rule (agent-decided read instruction)":
    "構想フェーズのルール。エージェントの判断で読み込みます",
  "Inception phase rule (agent-decided read instruction)":
    "計画フェーズのルール。エージェントの判断で読み込みます",
  "Construction phase rule (agent-decided read instruction)":
    "構築フェーズのルール。エージェントの判断で読み込みます",
  "Operation phase rule (agent-decided read instruction)":
    "運用フェーズのルール。エージェントの判断で読み込みます",
};

/** What stops working when an AI-DLC hook is switched off in Kiro's Agent Hooks (2.11.1). */
const kiroHookEffects: Readonly<Record<string, string>> = {
  "the approved plan, reviewed work and AI-DLC's records are not protected":
    "承認した計画、レビュー済みの作業、AI-DLC の記録が保護されません",
  "your replies are not recorded, so approval gates cannot tell your answer from the assistant's, and /aidlc commands typed in chat are not run directly":
    "返答が記録されないため、承認ゲートがあなたの回答とアシスタントの回答を区別できず、チャットで入力した /aidlc コマンドも直接実行されません",
  "a workflow with work left is not kept moving when the assistant stops (on Kiro CLI v3; Kiro IDE only records it)":
    "作業が残っているワークフローが、アシスタントが止まったときに先へ進められません（Kiro CLI v3 の場合。Kiro IDE は記録だけします）",
  "the build is not kept to the plan you approved": "ビルドが承認した計画どおりに保たれません",
  "commands are not checked before they run": "コマンドが実行前に確認されません",
  "workflow state can change without the engine":
    "エンジンを通さずにワークフローの状態が変わる可能性があります",
  "reviewed work is not protected": "レビュー済みの作業が保護されません",
  "your first prompt starts the session instead":
    "代わりに最初のプロンプトでセッションが始まります",
  "a specialist agent's finished part is not recorded":
    "専門エージェントが終えた部分が記録されません",
  "/aidlc utility commands typed in chat go to the assistant instead of running directly":
    "チャットで入力した /aidlc のユーティリティコマンドが直接実行されず、アシスタントに渡ります",
  "files you create or update are not recorded or checked":
    "作成・更新したファイルが記録も確認もされません",
  "the Current Stage in aidlc-state.md can fall behind":
    "aidlc-state.md の Current Stage が実際より遅れることがあります",
  "the plan of remaining stages is not rebuilt after the workflow moves":
    "ワークフローが進んでも、残りのステージの計画が作り直されません",
  "the current stage and the plan of remaining stages are not kept in step after a terminal command":
    "ターミナルのコマンドのあと、現在のステージと残りのステージの計画がそろいません",
  "it no longer runs": "実行されなくなります",
};

/** Parts of the request-folder row and its steps (2.11.1). */
const requestFolderHeld: readonly TranslationPattern[] = [
  [/^(\d+) that git tracks$/, "git が追跡しているもの $1 件"],
  [/^(\d+) not ignored$/, "無視されていないもの $1 件"],
  [/^(\d+) taken out of git, not committed yet$/, "git から外したが未コミットのもの $1 件"],
];
const requestFolderSteps: Readonly<Record<string, string>> = {
  "add the line `aidlc/.aidlc-request-text/` to the project folder's .gitignore, and check no later rule of yours un-ignores it":
    "プロジェクトフォルダーの .gitignore に `aidlc/.aidlc-request-text/` の行を追加し、それより後の独自のルールで無視が解除されていないことを確認してください",
  "in the project folder, take the tracked ones out of git, keeping the files: `git rm --cached -r -f -- aidlc/.aidlc-request-text/`":
    "プロジェクトフォルダーで、追跡されているものをファイルは残したまま git から外してください: `git rm --cached -r -f -- aidlc/.aidlc-request-text/`",
  "commit and push the removal, with .gitignore if its change is not committed yet":
    "削除を commit して push してください。.gitignore の変更が未コミットなら一緒に含めます",
  "commit and push the removal and the .gitignore change":
    "削除と .gitignore の変更を commit して push してください",
  "commit and push the .gitignore change": ".gitignore の変更を commit して push してください",
};

const openCodeAsk: Readonly<Record<string, string>> = {
  "shell command": "シェルコマンド",
  "file edit": "ファイル編集",
};

function translateOpenCodeNote(value: string): string | null {
  const one =
    /^Your opencode setting (asks before|refuses) every (shell command|file edit); in this project AI-DLC's permission rules replace that short form\. To keep (?:asking|refusing), write it as (.+) in (.+)\.$/.exec(
      value,
    );
  if (one?.[2]) {
    const verb = one[1] === "asks before" ? "毎回確認する" : "毎回拒否する";
    return `opencode の設定は${openCodeAsk[one[2]]}を${verb}ようになっていますが、このプロジェクトでは AI-DLC の権限ルールがこの省略形を置き換えます。この動作を保つには、${one[4]} に ${one[3]} と書いてください。`;
  }
  const many =
    /^Your opencode settings (.+); in this project AI-DLC's permission rules replace those short forms\. To keep them, write them as (.+) in (.+)\.$/.exec(
      value,
    );
  if (!many?.[1]) return null;
  const parts: string[] = [];
  for (const part of many[1].split(" and ")) {
    const m = /^(ask before|refuse) every (shell command|file edit)$/.exec(part);
    if (!m?.[2]) return null;
    parts.push(`${openCodeAsk[m[2]]}を${m[1] === "ask before" ? "毎回確認" : "毎回拒否"}`);
  }
  return `opencode の設定は${parts.join("、")}するようになっていますが、このプロジェクトでは AI-DLC の権限ルールがこれらの省略形を置き換えます。この動作を保つには、${many[3]} に ${many[2]} と書いてください。`;
}

// 2.11.2: an update check that went stale says how long ago it ran.
function checkedAgo(age: string): string | null {
  if (age === "less than an hour ago") return "1 時間以内に確認";
  const m = /^(\d+) (day|hour)s? ago$/.exec(age);
  return m ? `${m[1]} ${m[2] === "day" ? "日" : "時間"}前に確認` : null;
}

function translateStaleUpdate(value: string): string | null {
  const known = /^Update: binary (\S+), latest known (?:(preview) )?(\S+), checked (.+)$/.exec(
    value,
  );
  if (known?.[4]) {
    const age = checkedAgo(known[4]);
    return age === null
      ? null
      : `更新確認: 使用中 ${known[1]}、前回確認した${known[2] ? " preview の" : ""}最新 ${known[3]}（${age}）`;
  }
  const newer =
    /^Update: You're on (\S+), newer than the latest known (stable|preview) (\S+), checked (.+?)\. To go back to (stable|preview): aidlc update --channel \5\.(?: To keep getting (?:previews|stable releases): aidlc config --channel (stable|preview)\.)?$/.exec(
      value,
    );
  if (!newer?.[4]) return null;
  const age = checkedAgo(newer[4]);
  if (age === null) return null;
  const keep = newer[6]
    ? `、今のチャンネルを使い続けるには aidlc config --channel ${newer[6]} を`
    : "";
  return `更新確認: 使用中の ${newer[1]} は、前回確認した ${newer[2]} の最新 ${newer[3]}（${age}）より新しいバージョンです。${newer[5]} に戻すには aidlc update --channel ${newer[5]} を${keep}実行します。`;
}

function translateOne(value: string, kind: MessageKind): string | null {
  const exact = (kind === "label" ? labels : fixes)[value];
  if (typeof exact === "string") return exact;
  for (const [pattern, translated] of kind === "label" ? labelPatterns : fixPatterns) {
    if (pattern.test(value)) return value.replace(pattern, translated);
  }
  if (kind === "fix" && value.includes(", then ")) {
    const steps = value.split(", then ").map((step) => requestFolderSteps[step]);
    if (steps.every((step) => step !== undefined)) return steps.join("。その後、");
  }
  if (kind === "label") {
    const note = translateOpenCodeNote(value);
    if (note !== null) return note;
    const update = translateStaleUpdate(value);
    if (update !== null) return update;
    const hook = /^AI-DLC hook ([\w.-]+) is switched off in Kiro's Agent Hooks: (.+)$/.exec(value);
    if (hook?.[2] && Object.hasOwn(kiroHookEffects, hook[2]))
      return `AI-DLC のフック ${hook[1]} が Kiro の Agent Hooks でオフになっています: ${kiroHookEffects[hook[2]]}`;
    const hooks = /^AI-DLC hooks switched off in Kiro's Agent Hooks: (.+)$/.exec(value);
    if (hooks?.[1]) {
      const parts: string[] = [];
      for (const part of hooks[1].split("; ")) {
        const m = /^([\w.-]+) \((.+)\)$/.exec(part);
        if (!m?.[2] || !Object.hasOwn(kiroHookEffects, m[2])) return null;
        parts.push(`${m[1]}（${kiroHookEffects[m[2]]}）`);
      }
      return `Kiro の Agent Hooks でオフになっている AI-DLC のフック: ${parts.join("、")}`;
    }
    const request =
      /^Request folder: files in aidlc\/\.aidlc-request-text\/ hold your own requests \((.+)\)$/.exec(
        value,
      );
    if (request?.[1]) {
      const parts: string[] = [];
      for (const part of request[1].split(", ")) {
        const known = requestFolderHeld.find(([pattern]) => pattern.test(part));
        if (!known) return null;
        parts.push(part.replace(known[0], known[1]));
      }
      return `依頼フォルダー: aidlc/.aidlc-request-text/ のファイルにはあなた自身の依頼が入っています（${parts.join("、")}）`;
    }
    // A paused plugin is the person's own choice and rides on the plugin row (2.11.1).
    const paused = [...value.matchAll(/; ([\w.-]+) paused: needs ([\w.@^~<>=-]+), which is off/g)];
    if (value.startsWith("Plugins: ") && paused.length > 0) {
      const rest = translateOne(
        value.replace(/; ([\w.-]+) paused: needs ([\w.@^~<>=-]+), which is off/g, ""),
        kind,
      );
      if (rest === null) return null;
      const notes = paused.map((m) => `${m[1]} は一時停止中です（必要な ${m[2]} がオフ）`);
      return `${rest}。${notes.join("。")}`;
    }
    const failedName = /^(.*): check failed$/.exec(value)?.[1];
    if (failedName && Object.hasOwn(checkNames, failedName))
      return `${checkNames[failedName]}: 検査に失敗しました`;
    const drift =
      /^(Orphan worktrees|Stale branches|Orphan state files|Orphan audit): (\d+) drift$/.exec(
        value,
      );
    if (drift?.[1]) return `${checkNames[drift[1]]}: ${drift[2]} 件の不一致があります`;
    const file = /^([\w./\\-]+\.(?:ts|json|toml|rules|md|mdc)) present(?: \((.*)\))?$/.exec(value);
    if (file && (!file[2] || Object.hasOwn(filePurposes, file[2]))) {
      return `${file[1]} の存在確認${file[2] ? `: ${filePurposes[file[2]]}` : ""}`;
    }
    // Verbose plugin details contain identifiers and status tokens, not prose.
    const plugin =
      /^(Plugins: (?:\d+ need attention|\d+ require sync|composed state is current|.+ in this project \(no host plugin list to compare versions with\))) - ([\w.-]+:[\w-]+(?:, [\w.-]+:[\w-]+)*)$/.exec(
        value,
      );
    if (plugin?.[1]) {
      const translated = translateOne(plugin[1], kind);
      if (translated) return `${translated}: ${plugin[2]}`;
    }
  }
  return null;
}

/** Return null when any part is unknown so the UI can explicitly show the original. */
export function translateDoctorText(value: string, kind: MessageKind): string | null {
  const copyChannelPrefix =
    "This project is a copy-channel projection, so its hooks run through Bun; " +
    "a native install runs them through the aidlc command instead. ";
  if (kind === "fix" && value.startsWith(copyChannelPrefix)) {
    const remedy = translateDoctorText(value.slice(copyChannelPrefix.length), kind);
    return remedy === null
      ? null
      : `このプロジェクトは手動コピーのため、フックを Bun で実行します。ネイティブ導入では aidlc コマンドで実行します。${remedy}`;
  }
  // Findings have one identifier prefix. Do not recurse through arbitrary nested
  // prefixes supplied by plugins or future, unsupported output formats.
  if (kind === "label") {
    const finding = /^(\[[\w.-]+\]) (.+)$/.exec(value);
    if (finding?.[2]) {
      const translated = translateOne(finding[2], kind);
      return translated === null ? null : `${finding[1]} ${translated}`;
    }
  }
  const direct = translateOne(value, kind);
  if (direct !== null) return direct;
  // The CLI joins independently authored remedies with semicolons and may wrap
  // them onto several lines. Only translate the whole value if every part is known.
  if (kind === "fix" && /\r?\n|; /.test(value)) {
    const parts = value.split(/(\r?\n|; )/);
    const translated: string[] = [];
    for (const [index, source] of parts.entries()) {
      if (index % 2 === 1 || source === "") {
        translated.push(source);
        continue;
      }
      const part = translateOne(source, kind);
      if (part === null) return null;
      translated.push(part);
    }
    return translated.join("");
  }
  return null;
}
