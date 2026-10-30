# コントリビューション

## 概要

この実装への貢献を歓迎します。本ガイドでは前提条件、開発ワークフロー、テスト、変更の提出方法を説明します。

> **パス規約。** 以下の `<record>/` は生成済みインテントのレコードディレクトリ、
> `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` を指します。インテントごとの状態、監査
> シャード、ナレッジ、成果物がここにあります。

## 前提条件

- **Claude Code** -- ネイティブインストール（推奨、自動更新）: macOS / Linux / WSL では `curl -fsSL https://claude.ai/install.sh | bash`、Windows PowerShell では `irm https://claude.ai/install.ps1 | iex`。または `brew install --cask claude-code`。（[Claude Code のドキュメント](https://code.claude.com/docs/en/quickstart) を参照）
- **bun** -- ビルド、パッケージ生成、テスト、作成した TypeScript ソースの直接実行、ローカル生成した `dist/<harness>/` の利用に必須です。ネイティブリリースのランタイムは、インストール済みの `aidlc` コマンドを使います。`curl -fsSL https://bun.sh/install | bash` でインストールします。Windows では `powershell -c "irm bun.sh/install.ps1 | iex"` を使います。
- **timeout**（GNU coreutils）-- テストスイートの LLM テストのタイムアウト（L2/L3）に必須です。Linux には標準で入っています。macOS: `brew install coreutils` のあと gnubin を PATH に追加します: `export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"`（`~/.zshenv` または `~/.zshrc`）。
- **Bash** -- POSIX 互換ラッパー（`tests/run-tests.sh`）用の任意依存です。主テストランナーは `bun tests/run-tests.ts` です。実行時、配布フックはどれも Bash を必要としません。
- **Bedrock アクセス** -- ライブ統合テストと e2e テスト（L2/L3）の実行に必須です。L1 プロトコルテストには不要です。

クローン後、パッケージャー、型検査、テストで使う、バージョン固定済みの開発依存関係をインストールします。

```bash
bun install --frozen-lockfile
```

## リポジトリ構成

```
core/                # Hand-authored, harness-neutral source (tools, stages, agents, rules, knowledge, hooks)
harness/<name>/      # Per-harness authored surfaces; claude/, kiro/, kiro-ide/, codex/, opencode/, copilot/
scripts/package.ts   # The build: materializes ignored local projections (`--check` builds twice and compares)
scripts/build-binaries.ts # Release-only compiled CLI artifacts in ignored build/binaries/ after package --check
dist/<harness>/      # GENERATED + ignored: dist/claude/, dist/kiro/, dist/kiro-ide/, dist/codex/, dist/opencode/, dist/copilot/ — never hand-edit or commit
tests/               # All-TypeScript test suite (t*.test.ts, run via bun)
docs/                # Documentation
  guide/             # User guide (how to use AI-DLC)
  harness-engineering/  # Harness engineer guide (configure AI-DLC without code)
  reference/         # Developer reference (how it works internally)
```

全体アーキテクチャは [アーキテクチャ](01-architecture.md) を参照してください。

## 開発ワークフロー

1. **フォークしてブランチ**を `main`（統合ブランチ、PR の提出先）から切り、`bun install --frozen-lockfile` を実行する
2. **アーキテクチャを読む** -- [アーキテクチャ](01-architecture.md) が実行モデル、エージェント委譲、フックシステムを説明します
3. **エントリポイントを理解する** -- 決定的エンジン `core/tools/aidlc-orchestrate.ts`（サブコマンドは `next`、`continue`、`report`、`park`、`team-board`、`wait` のちょうど 6 つ。`continue` は内部のステアリング転送用、`team-board` は Team Construction の読み取り専用クエリ、`wait` はディスパッチした作業を上限付きで読み取り専用で待つもの）がルーティングを担当し、コンダクター `harness/claude/skills/aidlc/SKILL.md` はその指示に従う薄い転送ループです。規範となるエンジン / ディレクティブ / コンダクター / スウォーム契約は [スキルシステム](17-skill-system.md) を参照
4. **変更する** -- ハーネス非依存ソースは `core/`（ツール、ステージ、エージェント、フック、ルール、ナレッジ）、ハーネス固有の内容は `harness/<name>/`（オーケストレータースキル、設定）を編集する。その後 `bun scripts/package.ts` で、Git 管理対象外の `dist/` と `dist-release/` をローカル生成する。どちらも手編集やコミットはしない。`package.ts --check` は既存の生成ツリーを使わず、独立した一時ディレクトリに全配布ツリーを 2 回生成し、バイト単位で比較する
5. **テスト** -- 提出前に `bun tests/run-tests.ts` を実行
6. **提出** -- `main` 向けに PR を開く

リリース用バイナリは `dist/` に含まれず、パッケージャーも生成しません。`bun scripts/package.ts --check` が通った後、ホスト用は `bun scripts/build-binaries.ts`、リリース全対象は `--all-targets` を付けてビルドします。スクリプトは各実行ファイルを `build/binaries/<target>/` に置き、その対象の `runtime/<harness>/` に完全な配布ツリーを用意し、`build/binaries/build-results-<target>.json` を書き出します。ビルドホストで実行できる対象は、`PATH` に `bun` がない状態で、センサー、グラフコンパイル、検証、生成内容の検査、プラグインの選択／合成、オーケストレーション、通常 Bolt と自律スウォームの合成、パッケージ済みランタイムの不変性、フック、ステータスライン、アダプター、明示的なプロジェクトルーティング、doctor JSON、init の dry-run、バージョン／プラグイン一覧、Unix 補完、パッケージ検証を実行します。クロスビルドの成果物は内容検査を受け、`UNVERIFIED` と明示されます。ホスト上で実行した成果物は `VERIFIED` になります。
用意した `runtime/<harness>/` は読み取り専用の代替ランタイムです。変更を行うコマンドは、インストール済みプロジェクトのハーネスを対象にする必要があります。ゲートが 1 つでも失敗するとビルドは失敗します。

対象バイナリが揃うと、`bun scripts/package-release.ts` がローカルの投影を再生成・検証し、`dist/` を帯域外の手動コピー用 `aidlc-copy-runtime-X.Y.Z.tar.gz` とその `.sha256` サイドカーに、`dist-release/` をマニフェスト記載の `aidlc-runtime-X.Y.Z.tar.gz` にパッケージし、`version.json`、`checksums.txt`、`install.sh`、`install.ps1` を出力します。対象ごとの `runtime/` ディレクトリはスモークゲート用のステージングです。リリースのデータアーカイブは、それらのサイドカーからコピーするのではなく、新たに生成した投影から再ビルドします。
`--require-release-matrix` は 7 つの対象すべてと、各バイナリに対応する検証記録を要求します。生成されるフラットなディレクトリが、インストーラーと `release packaging tooling` が消費する契約です。

リリースワークフローは、意図的に候補を保持する設計です。検証とインストーラーの lint を先に実行し、対象ごとのネイティブジョブでバイナリと証拠を作ります。`package-release.ts` は 1 回だけ実行して `release-candidate` を作成します。ステージングジョブは署名をせずにチェックサムを取ってアップロードし、Unix／Windows のライフサイクルジョブは同じバイト列を使います。`publish` は候補を再検証して証明を付け、エクスポートしたバンドルを加え、全資産を検査して 1 つの `attested-release` 成果物をアップロードします。`release` はタグとチェックサムを再確認し、`GITHUB_TOKEN` でこのリポジトリに GitHub Release を作成して、アップロード済み資産の一覧を検証します。候補の再ビルド、再パッケージ、差し替えは決して行いません。

stable リリースは、選んだ公開済みプレビューのソースコミットを昇格させます。`promote-release.yml` を `main` 上で、プレビュータグ、stable の版、リリースノート、そして任意で貢献者の一覧を指定して実行します。入力なしで実行すると、利用できるプレビューを一覧します。用意されるタグには、版メタデータと固定された公開制御を持つ子コミットが 1 つ含まれます。`release.yml` はその関係を検証し、stable の成果物をビルドします。CI や Full Suite を繰り返さずに、パッケージングとネイティブ／インストーラー／ライフサイクル／アップグレードの検査を実行します。プレビューの結果と失敗はプレビューのリリースページに残り、昇格記録はその警告の行を保持し、stable のページはそのプレビューへリンクします。公開後は、メタデータだけのブランチと PR リンクが、現在の `main` に版を記録します。[リリース手順](../../DEVELOPERS.md#4-promote-a-preview-to-production) を参照してください。
分離された `.github/workflows/preview-release.yml` ワークフローは、`main` からのプレビュービルドを定期実行または手動ディスパッチし、契約の検査とリリース資産の検証でゲートし、ネイティブの義務と上限付きのライブスイートを実行し（決定的な層は PR／マージの CI に残ります）、`AIDLC_BUILD_VERSION` を埋め込み、決して「latest」にならない注釈付きタグのプレリリースを公開します。定期実行と手動実行は `release-preview` のワークフロー同時実行制御を共有します。後の各実行はリリースを読み直し、最新の公開済みプレビューがすでに同じソースコミット、またはそれを含むより新しいコミットを使っていれば公開をスキップします。その場合も検査と Full Suite は実行されます。同じ UTC 日付に `main` が再び進むと、プランナーは次の未使用の `.N` カウンターを割り当てます。下書きと孤立タグはその ID を予約するため、再試行もそれらを飛び越して進みます。Full Suite の失敗はプレビューの公開を止めません。プレビューのノートの末尾に Full Suite の失敗報告が付きます。別立ての Full Suite の実行は、Preview Release ワークフローを失敗させずに、失敗の状態を保持します。

stable と preview の公開は、それぞれ `release` と `preview` の環境を使い、互いに独立して直列化します。同日中のカウンター割り当てを含む信頼の設計の全体は、[サプライチェーンセキュリティ](19-supply-chain-security.md) を参照してください。

## Markdown の構造

ブロックの可視性、コンテナ、リンク参照定義、主張の分割には、`core/tools/aidlc-markdown.ts` の `markdownBlocks` を使います。これは組み込みの `Bun.markdown` レンダラーに支えられており、その `visibleMarkdownLines` 投影は、利用側固有の可視性オプションを保持します。Markdown の依存関係、手作りのブロックスキャナー、参照定義の文法を追加してはなりません。
`Bun.markdown.render` によるレビュー権限の描画は、意図的に別の経路です。そのセキュリティ境界をブロックアダプターへ統合しないでください。アダプターがレンダラーからソース行をどう復元するかは、[Markdown の構造](01-architecture.md#markdown-の構造) を参照してください。

## 新しいツールコードの置き場所

`core/tools/aidlc-lib.ts` には新しいコードを加えません。新しい関数、型、定数は、`core/tools/` 配下のその領域のモジュール（既存の `aidlc-<area>.ts`、または新しいもの）に置き、`aidlc-lib.ts` には決して置きません。コードは 1 領域ずつ、バイト単位でそのまま `aidlc-lib.ts` から移され、1 行の `export ... from` を通じて引き続きそこからインポートできるようにします。そのため、`aidlc-lib.ts` をインポートしているものは何も変わりません。そこから切り出したモジュールが `aidlc-lib.ts` をインポートすることは決してありません。`tests/unit/t-aidlc-lib-only-shrinks.test.ts` は、`aidlc-lib.ts` が宣言する名前のうち `tests/fixtures/aidlc-lib-declarations.txt` にないものがある場合と、`aidlc-lib.ts` がインポートするモジュールのうちそれを逆にインポートするものがある場合（この規則より前からそうしていたものはテストに列挙されています）に失敗します。移動ではその一覧から自身の名前を削除し、`biome.json` にあるそのファイルのサイズ上限を下げます。どちらも引き上げることは決してありません。

## テスト

スイートはすべて TypeScript（`t*.test.ts`、`bun` で実行）で、4 レベル — `smoke`、`unit`、`integration`、`e2e` — に分かれ、3 層ピラミッドに対応します（smoke + unit = L1 プロトコル、integration = L2 ステージ、e2e = L3 受入）。バージョン固定済みの開発依存関係を入れた後、L1 は外部サービスなしでローカル実行できます。ライブ統合と e2e のファイルは `claude` CLI ツール（と Bedrock 資格情報）を必要とし、無い場合はきれいにスキップします。

**クイックリファレンス:**

```bash
# L1 Protocol -- runs in seconds, no dependencies
bun tests/run-tests.ts

# L2 Stage -- CI pipeline (requires claude CLI tool)
bun tests/run-tests.ts --ci

# L3 Acceptance -- explicit local full acceptance (requires claude CLI tool)
bun tests/run-tests.ts --release

# POSIX compatibility wrapper
bash tests/run-tests.sh --ci

# Individual levels
bash tests/run-tests.sh --smoke        # File structure validation
bash tests/run-tests.sh --unit         # Hook behavior, stage content
bash tests/run-tests.sh --integration  # Cross-component and stage/CLI tests
bash tests/run-tests.sh --e2e          # Workflow, worktree, and terminal journeys
```

テスト戦略、スタブ、新規テストの追加方法の全体は [テスト](09-testing.md) を参照してください。

## ディスパッチャールートの変更

`core/tools/aidlc.ts` は、公開、非公開、ホスト専用コマンドのルートレジストリです。新しいルートは、意図せず動作を継承しないよう、すべてのポリシーを宣言します。

1. `projectRequirement`、`outputModes`、`visibility`、`networkPolicy`、`mutationScope` を設定する。
2. `pinPolicy` を明示的に選ぶ。マシンのライフサイクル／管理には `active`、稼働中バイナリの診断と修復には `inspect`、プロジェクトのエンジン動作には `pinned` を使う。
3. 既存のツールへルートを割り当てるか、`TOOLS` にツールを追加する。フック、ステータスライン、アダプター、下位の委譲先は、公開エイリアスではなくルート専用エントリーを使う。
4. `tests/unit/t230-dispatcher-routes.test.ts` にルートとポリシーの検証を追加する。必要に応じてグローバルフラグの順序、コンパイル版と開発版の一致も確認する。
5. 本文からコマンドを呼ぶ場合は `{{INVOKE}}` または `{{TOOL_PREFIX}}` を使い、コピー版とネイティブ版を区別する。ローカルの両チャネルを再生成し、パッケージの決定性検査を実行する。
6. `mutationScope` と `networkPolicy` は正直に宣言する。これらは、VS Code が Allow プロンプトなしでコマンドを実行するかどうかも決める。Copilot アダプターは、`mutationScope` が `none` または `project` で、`networkPolicy` が `forbidden` の `engine` または `public` ルートについて、すべてのガードを通過した後、VS Code で `allow` と応答する。フック、アダプター、ステータスラインのルートは決して対象にならない。マシンを変更する、またはネットワークに到達するルートは、その人自身の承認を保つ。その人の作業や git 履歴を削除・上書き・マージする動詞（たとえば `worktree discard`、`unit land`）、その人に見えるステージ、ゲート、レビューを変える動詞（たとえば `jump execute`。`recompose` は、最後のゲート以降にその人が返答するまでの間だけプロンプトを保つ）、アクティブなインテントやスペースを切り替える動詞、その人の同意を必要とする動詞（たとえば `bolt abort`）、リモートに到達する動詞、AI-DLC が出荷していないコードを実行する動詞（たとえば、設定された抽出器を実行する `knowledge onboard`）は、実行前にその人がプロンプトを見られるよう、`harness/copilot/hooks/aidlc-copilot-adapter.ts` の `keepsPrompt` にも追加しなければならない。AI-DLC に実行させるコマンドやスクリプトを渡すオプションは、同じファイルの `CALLER_RUNS` に属する。プロジェクト外のパスとして読める引数は、すでにプロンプトを保つ。

## インストール処理への変更操作の追加

init、ライフサイクル、バージョン固定、プラグイン管理でプロジェクトやマシンを変更する処理は、`core/tools/aidlc-transaction.ts` を使います。ルート相対で重複しない操作から `TransactionPlan` を組み立て、コピー／ツリー操作には宛先の `expected` 状態とソースハッシュを含めます。意味に関わる検査は、トランザクションが成功して戻った後ではなく、`validateCandidates` または `validateCommitted` に置きます。コミット後のバリデーターの失敗もトランザクションに含まれ、ロールバックされます。

公開前に障害注入テストを追加します。必要に応じ、ステージング、スナップショット、コミット、コミット後検証の前後で失敗させ、すべてのバイトとモードが元に戻ること、ロックが解放されること、ロールバックが完了しない場合に復旧用の証拠が名前付きで残ることを確認します。エンジンの参考例は `t243-install-mechanism.test.ts`、プロジェクト変更の例は `t224-plugin-selection.test.ts` と `t242-plugin-state.test.ts` です。

## ユーティリティハンドラの追加

> **監査イベントを追加する前に**、[状態機械](12-state-machine.md) を読んでください。その章は分類体系の全イベント、出力元、「同一コミット規則」を列挙します — コードと章の表を同じ PR で更新しないと、ドリフトテストが失敗します。

ユーティリティハンドラは次の 2 種類です。

### 決定的ハンドラ（推奨）
LLM 推論が不要なハンドラ向け（テキスト表示、ファイルの読み取り／整形、前提条件チェック、ディレクトリ作成）:
1. `core/tools/aidlc-utility.ts` にサブコマンドを追加する
2. 意味に対応するディスパッチャーの名詞／動詞を登録し、SKILL.md から `aidlc engine <noun> <verb>`（または公開ルート）で呼び出す
3. タスク追跡は不要 -- スクリプトは 1 秒未満で終わる
4. 監査ログはスクリプト内で `aidlc-audit.ts` の `appendAuditEntry` または `appendAuditEntries` 経由で処理する（`**Event**:` マークダウンブロックを手書きしない）。複数の設定を変更する処理は、呼び出し側が保持する 1 つのロックを使い、1 回の状態書き込みの前に監査バッチ全体を追記する。
5. `aidlc-utility` の usage 文字列に動詞を追加する。生成された SKILL.md の領域を描画するハンドラなら、対応する `--check` ガードも本章に文書化する

コマンドが出力する文字列で、そのコマンド自身のコマンドラインを繰り返してはなりません。VS Code の端末ツールは、実行したコマンドを繰り返す行までのコマンド出力を捨てるため、「rerun `aidlc doctor`」と書いた doctor の修正行は、チャットエージェントに空のまま届いていました。再実行は言葉で示します（「run doctor again」）。`tests/harness/vscode-output-trim.ts` が、回帰テスト用にこの規則をモデル化しています。

`--help`、`--version`、`--status`、`--doctor` ハンドラが参考実装です。`--doctor` は `--export`（任意の `--output <dir>` 付き）も受け付けます。これは診断を改めて実行したうえで、秘匿情報を除去した小さな診断レポートを書き出します。共有の `DoctorFinding` モデルとレポート組み立てロジックは `core/tools/aidlc-doctor-bundle.ts` にあるため、ライブレポートとエクスポートされたレポートは同じ 1 組の検出結果から生成されます。

インテント設定のハンドラは、単一の変更経路を共有します。

| ディスパッチャールート | ユーティリティハンドラ | 契約 |
|------------------|-----------------|----------|
| `aidlc engine config get <key>` | `config-get` | `depth`、`test-strategy`、`review`、`guard-policy`、`sensors`、`learnings`、`summary-confirmation`、`collaborators`、または 4 つの `guard.<fence>` キーのいずれかを読む。廃止されたキー `change-control` は `guard-policy` に解決される |
| `aidlc engine config list [--json]` | `config-list` | 13 個の設定すべてをこの順に読む。Guard Policy、フェンス、儀式の値には実効値の出所が含まれる |
| `aidlc engine config set <key> <value> [--key value ...]` | `config-change --<key> <value> ...` | 与えられた設定フラグをすべて 1 つのトランザクションで適用する。どのキーもこのルートを使う |
| `aidlc engine scope change --scope <name> [--key value ...] [--message <id>]` | `scope-change --scope <name> ...` | スコープを再計画し、同じ 12 個の設定のいずれかを同じトランザクションで適用する。要求したスコープがすでに現在のスコープである場合も含む |

`config-change` は 12 個の設定フラグと `--message`（およびそれ以前の `--person-words` の形。これは何も証明しません）、`--intent`、`--space`、`--project-dir` だけを受理し、最低 1 つの設定が必要です。未知のフラグは名前を示して拒否し、どの変更よりも前にすべての値を検証します。共有のユーティリティ applier は、候補の内容、`AuditEntryInput[]`、出力行を正規のキー順で返し、書き込みはしません。どちらの変更ハンドラも、状態の読み取り、適用、呼び出し側保持ロックモードでの `appendAuditEntries`、1 回の状態書き込みにわたって 1 つの `withAuditLock` を保持します。Guard Policy の値が動く場合は、どの書き込みよりも前に `assertChangeControlLedgerWritable` を呼びます。メモリ層の `Mode: strict` は、明示的な `--guard-policy relaxed` や `--guard-policy off` を、併記の設定やスコープ変更を含めてコマンド全体で拒否します。
スコープ変更は、スコープが所有する Guard Policy を自動で引き上げることがあります。より低い既定値が新しいスコープに従うのは、その人がスコープ変更を求めた場合だけです。それ以外の場合は現在の保存値が残り、出力がその旨を 1 行で伝えます。実効値は引き続きメモリが制御します。

状態とイベントの契約を保ちます。`review adversarial` は空の `Review Override` を保存します。明示的な Guard Policy と儀式の値は、`settingTheirs` がその背後に本人を見つけた場合（型付きのスイッチ、本人の端末、またはエージェントが `--message <id>` で名指し、`proveMessage` が証明した本人のメッセージ）は `(set by you)`、それ以外は `(set by a command)` を使い、継承されたスコープの既定値はスコープの出所を保持します。スコープ変更は、明示的な上書きと、存在しない旧来の Guard Policy／儀式の行を保持します。実際に保存されたフィールドや出所の変更だけが設定イベントを生み、`Last Updated` を更新します。ユーティリティの applier は `GUARD_POLICY_SET`、`CEREMONY_SET`、フェンス切り替えの `GUARD_DISABLED`/`GUARD_RESTORED` のエントリを直接組み立てます。統制されたチェックポイントがメモリのポリシーの実効的な変更を観測した場合、`aidlc-lib.ts` は引き続き `appendGuardPolicySetRow` を使います。別々のセッターのラッパーを追加したり、複合した依頼を複数のディスパッチャー呼び出しへ分割したりしてはなりません。

新しい設定は、素の `setField` ではなく名前付きのライターで行を書きます。そのため、以前のリリースの記録はその場で移行されます。Guard Policy のライターは `setGuardPolicyLine` で、残っている `Change Control` の行を 2 行目を足さずに改名します。`setGuardsOffLine` は、フェンスが初めて切り替えられたときに、その下へ `Guards Off` の行を挿入します。廃止されたキー、フラグ、見出し、状態フィールドは、1 リリースの間だけ読まれ、書かれることは決してありません。廃止された FLAG と CONFIG KEY の経路は `noteGuardPolicyRename` を呼ぶため、それを入力した呼び出し側には、プロセスごとにちょうど 1 行の非推奨の注意が表示されます。廃止された状態フィールド、メモリの見出し、スコープのフロントマターのキーは何も言わずに読まれます。以前のリリースが書いた記録を読んでいる人は、古い綴りを選んだわけではないからです。

`codekb-path`、`codekb-snapshot`、`codekb-publish`、`codekb-scope-diff` の各ハンドラは**直接ユーティリティ動詞**です。ステージ本文は `/aidlc <verb>` ではなく `bun <harness-dir>/tools/aidlc-utility.ts <verb>` を呼びます（`codekb-path` はディスパッチャーの `aidlc engine workspace codekb` からも呼び出せます）。
`codekb-path` は読み取り専用で、`codekb-scope-diff` も、`--compare` がアクティブなインテント記録の `inception/reverse-engineering/` からそのリポジトリ自身の `scope-draft-<repo>.md` を削除することを除けば読み取り専用です。`codekb-snapshot` は、ソース／ストアの世代を返す前に、中断された直前の CodeKB ディレクトリ入れ替えを復旧することがあります。`codekb-publish` は共有ストアへ書き込む唯一の動詞で、9 ファイルそろった候補を検証し、スペース + リポジトリ単位の compare-and-swap ロックの下でコミットします。いずれも監査イベントを出さず、SKILL.md のタスク追跡も駆動しません。

`project-description` と `document-input` も、同じ読み取り専用の直接ユーティリティの形をとります。これらを消費する両ステージは、まず `project-description` を呼びます。マーカー付きの記録は、その `project-description.json` の文字列を正確にデコードしなければならず、マーカーのない 2.6.115 以前の記録は、明示的に従来の `Project` 状態フィールドへフォールバックします。`bun <harness-dir>/tools/aidlc-utility.ts document-input` を呼ぶのは、選択したパスをネイティブのファイル書き込みツールで、アクティブな記録の固定された `.aidlc-engine/document-input-path` 転送先へ書いた後です。顧客が選んだパスのバイト列がシェルコマンドへ入ることは決してありません。ハンドラはプロジェクトルートからパスを解決し、含まれるファイルの同一性を記録し、読み取り前に、開いたディスクリプタがそれと一致することを要求します。親ディレクトリの差し替え、リダイレクト、非対応の入力は拒否されます。そのパスに何も無い場合は、`git ls-files --cached --others --exclude-standard`（リポジトリの外でだけ、`.git`、`node_modules`、隠しフォルダー、入れ子のリポジトリを飛ばす走査）でその名前を持つプロジェクトの通常ファイルを列挙します。照合するのは隠しフォルダーの外の文書ファイルだけで、シンボリックリンクや、秘密情報らしいファイル名・フォルダー名を含むパスを提示することは決してありません。一致が 1 つならそれを読み、複数なら番号で選べるよう一致を返します。リポジトリ内で git が失敗した場合や、走査が上限に達した場合は、何も選ばずにパスを尋ねます。`project-description` は貼り付けられた文書をその人の指示から切り分けるため、どのステージも自分で切り分けることはありません。読み取りに成功した場合は、DocumentKB と同じインラインの「信頼できないパス」「信頼できない内容」の注意書きを出力します。`document-input --onboard` は書き込みを行う唯一の形です。PDF や Word ファイルについては、読み取ったバイト列をアクティブなスペースの `knowledge/documents/` へコピーし（`link()` で公開するステージングファイルのため、既存のファイルが置き換えられることはありません）、ナレッジツールの `onboard` と `showDocument` をプロセス内で呼び出します。git で無視されているソース、または git が確認できないソースは、`--include-ignored` が渡されない限り `ask` を 1 つ返して何もコピーしません。ステージがこれを付けるのは、その人が同意した後だけです。この形は抽出器を実行するため、Copilot アダプターはこの形に対して Allow プロンプトを保ちます。

### LLM 駆動ハンドラ
エージェント推論が有用なハンドラ向け（ファイルシステム走査、意思決定）:
1. **タスク追跡** -- セッションが `TaskCreate` と `TaskUpdate`（またはハーネスのスキルがそれらを対応付ける plan や todo のツール）を提供する場合、論理ステップごとに `TaskCreate` でタスクを作り、作業の進行に合わせて `TaskUpdate`（`in_progress` -> `completed`）で遷移させる。Claude Code のタスクサイドバーを駆動します。それらのツールが無い場合、この手順は何も言わずに飛ばされます。
2. **ステータスライン更新** -- アクティブなインテントの `aidlc-state.md` がある場合、実行中ユーティリティを表すよう一時的に `Current Stage` を設定し（例: `running health check`）、完了時に元の値へ戻す。`aidlc-statusline.ts` フックが端末ステータスバー用にこのフィールドを読みます。
3. **監査ログ** -- 意味に対応するネイティブディスパッチャールートを呼ぶ。背後のハンドラーが内部で `appendAuditEntry` を呼び出す。LLM 本文から `**Event**:` マークダウンブロックを手書きしない — [状態機械: 禁止パターン](12-state-machine.md) を参照。

`intent-create` ハンドラは完全に決定的です。3 つの初期化ステージ（workspace-scaffold、workspace-detection、state-init）は単一の `aidlc-utility intent-create` 呼び出し内で実行されます。ウェルカムメッセージはセッション開始時に `settings.json` の `companyAnnouncements` 経由で表示され、ステージではありません。

## スコープの追加

スコープは、ファイル（その識別）とステージごとの所属タグとして著述します。識別は `core/scopes/aidlc-<name>.md` に、所属は `core/aidlc-common/stages/` 配下の各ステージフロントマターの `scopes:` リストにあります。`init`、`scope-change`、`resolve-env-scope`、`doctor`、状態ツール一式の検証ロジックは、実行時に `.claude/scopes/*.md` から `core/tools/aidlc-lib.ts` の `validScopes()` 経由で有効スコープ一覧を導出します。EXECUTE/SKIP グリッドはステージごとの `scopes:` リストの転置で、`tools/data/scope-grid.json` にコンパイルされます。スコープ追加に TypeScript の編集は不要です。

### 手順

1. **`core/scopes/aidlc-hotfix.md` を作成** — スコープの識別。フロントマター:
   - `name`（必須）: スコープ名。ファイル名ステムと一致すること。
   - `depth`（必須）: `Minimal` | `Standard` | `Comprehensive`。
   - `keywords`（任意）: `/aidlc <freeform text>` に対してエージェントがプランを提案するときに読むヒント語。ツールはこれを照合しない。フラットな文字列リストはブロック形式（`- item`）とフロー形式（`[item, item]`）を使える。空リストはヒントを持たない。[エージェントがプランを提案する](../guide/05-scopes-and-depth.md#the-agent-proposes-the-plan) を参照。
   - `description`（任意）: `/aidlc --help` と、オーケストレータスキルの隣にある `tables.md` のコンパイル済みスコープ表に出る一行要約。
   - `testStrategy`（任意）: 深さに依存しないテスト戦略の上書き。既定は深さに合わせる。
   - `review_cap`（任意）: `adversarial` | `advisory` | `none`。そのスコープでのステージレビューの上限。省略時はスコープによる引き下げなし。ステージ宣言の強度を下げることはできるが、引き上げることはできない。自律スウォームのレビューは対象外。
   - `runner`（任意）: `true` を設定すると、既定で生成されるランナー集合にそのスコープが含まれる。
   - `existing_code`（任意）: `true` | `false`。省略時は false。`true` は、すでに存在するコードを変更するスコープ（`bugfix`、`refactor`、`security-patch`）を示す。新しいプロジェクトのカスタム計画は、合う別のスコープがあればそちらで実行され、新しいプロジェクトとしてスキャンされるフォルダーでの作成では、そのスコープの Reverse Engineering を外す際にその旨を注記する。ローダーはそれ以外の値を拒否する。
   - `freeform_default`（任意）: `true` を設定すると、優先されるコア既定（`classic`）が有効でないときにこのスコープが指名される。主張できるのは有効なスコープのうち最大 1 つで、曖昧なプラグイン選択の組み合わせはグラフコンパイルが拒否する。明示的な `AWS_AIDLC_DEFAULT_SCOPE` の未知の値は引き続き検証エラーになる。
   - `guard_policy`（任意）: `strict` | `relaxed` | `off`。そのスコープで作る新しいインテントが始まるときの Guard Policy の既定値。人間が何かを承認または確認した後に入力が変わったときにどうなるか（strict は承認を開き直し、relaxed と off は変更を一度記録して続行する）と、どの権限のフェンスを保つか（strict は何も下げない。relaxed は `plan-approval` と `review-freeze` を下げる。off はその 2 つに加えて `state-transition` と `reviewer-scope` を下げる。`human-presence` はこの指定で下がることは決してない）を決める。省略時は off で、`enterprise` を除くすべての配布スコープの既定である。`skeleton` と同様に検証する（ローダーはファイル名と 3 つの値を示す）。メモリ層の `## Guard Policy` にある `Mode: strict` は、どのスコープ既定値よりも優先される。その `Mode: relaxed` や `Mode: off` もスコープ既定値を置き換える。`change_control` は廃止された綴りで、1 リリースの間だけ読まれる。両方のキーを異なる値で指定すると拒否される。
   - `sensors`（任意）: `on` | `off`。省略時は on。センサーの実行とセンサーのゲート検査を制御する。インテントごとのフラグ: `/aidlc --sensors on|off`。全体の停止スイッチ: `AIDLC_DISABLE_SENSORS=1`。
   - `learnings`（任意）: `on` | `off`。省略時は on。ステージの学習の儀式を制御する。インテントごとのフラグ: `/aidlc --learnings on|off`。全体の停止スイッチ: `AIDLC_DISABLE_LEARNINGS=1`。
   - `summary_confirmation`（任意）: `on` | `off`。省略時は on。ステージの承認ではなく、出力前の別の要約確認を制御する。インテントごとのフラグ: `/aidlc --summary-confirmation on|off`。全体の停止スイッチ: `AIDLC_DISABLE_SUMMARY_CONFIRMATION=1`。スコープの値は、ステージ側の `required` | `if-present` の宣言とは別物である。

   儀式のキーは on/off 以外の値を拒否します。解決順は、全体の停止スイッチ（`1`）→ 有効なインテントの状態行 → スコープの既定値 → on です。すべての配布スコープは 3 つすべてを明示的に宣言しています。classic はセンサーと学習を有効にして要約確認を無効にし、bugfix はセンサーを有効にして学習と要約確認を無効にし、express は 3 つすべてを無効にし、残りの 8 つは 3 つすべてを有効にします。停止スイッチは `aidlc config flags --bypass <NAME>` で記録できます。

   本文は意図の散文 — 「なぜこれらのステージ、なぜあれをスキップするか」。`validScopes()` は `.claude/scopes/*.md` の存在から導出するため、ファイルが置かれた瞬間にスコープは有効です。編集後に `/aidlc --doctor` を実行して構造問題を検出してください。

   ```yaml
   ---
   name: hotfix
   depth: Minimal
   keywords:
     - hotfix
     - urgent
   description: Urgent production fix
   runner: true
   ---

   # hotfix scope

   Lean path for the urgent production patch — regression test and deploy, nothing else.
   ```

2. **所属ステージにタグ付け** — `hotfix` 下で実行すべき各ステージ（`core/aidlc-common/stages/<phase>/` 配下）のフロントマター `scopes:` リストに `hotfix` を追加する。タグ付けしないステージはそのスコープで `SKIP`。初期化ステージ 3 つ（`workspace-scaffold`、`workspace-detection`、`state-init`）には必ず含める — 常に実行されます。

3. **再コンパイル + スコープ表の再生成** — `aidlc engine graph compile` が `scopes:` タグを `tools/data/scope-grid.json` へ転置する。次に `aidlc engine gen scope-table` が、オーケストレータスキルの隣にある `tables.md` のコンパイル済みスコープ表用の正規 Markdown 領域を表示する。`<!-- BEGIN: compiled ... -->` / `<!-- END: compiled ... -->` マーカー間の領域は生成されたままに保ち、その後 `aidlc engine graph compile --check` と `aidlc engine gen scope-table --check` を実行して終了コード 0（ドリフトなし）を確認する。

4. **スコープ解決を検証** - `bun core/tools/aidlc-utility.ts intent-create --scope hotfix --project-dir /tmp/scope-smoke` が成功し、`Scope: hotfix` 付きの状態ファイルを生成すること。

5. **`doctor` が環境既定として受け入れることを検証** — `AWS_AIDLC_DEFAULT_SCOPE=hotfix aidlc doctor` がその環境変数を有効と報告すること。

6. **プランのヒントが読みやすいか確認する**（`keywords` がある場合） - エンジンはもうこれを照合しない。エージェントがプラン提案の手順でこれを読む（`next "<a request your plan is for>" --project-dir /tmp/scope-smoke` が、すべてのプランをそのヒントとともに表示する）。自分のプランの行が、そのプランの用途を平易な言葉で述べていることを確かめる。

7. **計画の一致を検証**（任意だが推奨） — `AIDLC_GRAPH_RESOLVE=1 aidlc engine graph resolve hotfix --stdout` がそのスコープの計画を出力するので、EXECUTE 集合がタグ付けと一致するか目視する。

8. **スコープ対応ドキュメントを更新** — `docs/guide/05-scopes-and-depth.md`（スコープ全体リファレンス。Stage-by-Scope Matrix を含み、そのセルはコンパイル済み `scope-grid.json` に対して `tests/unit/t244-scope-matrix-doc-sync.test.ts` でドリフトガードされています）、`docs/guide/13-customization.md`（有効値一覧とスコープ表）、`docs/reference/03-orchestrator.md`（スコープからステージへの対応）はいずれもスコープを明示列挙しています。本章末尾のドキュメント方針どおり、同じ PR で更新する。

9. **スコープルーティングのワークフローテストを追加** — 既存スコープと異なる振る舞い（新しいフェーズスキップパターン、新しい深さの組み合わせ）がある場合、`tests/e2e/t53.test.ts`（sdk スコープルーティング）または `tests/e2e/t-tui-t50-bugfix-scope.serial.test.ts`（tui スコープ通し実行）をモデルにしたルーティング旅程テストを追加する。

### 自動で検証されること

- `.claude/scopes/aidlc-hotfix.md` が置かれた瞬間に `validScopes().has("hotfix")` が `true` を返す — すべての検証箇所がこのヘルパーを使います。
- エラーメッセージはコード変更なしで新しいスコープをアルファベット順に列挙します。
- `/aidlc --doctor` は `AWS_AIDLC_DEFAULT_SCOPE=hotfix` を有効として扱います。
- 進行中ワークフローでの `aidlc-utility scope-change --scope hotfix` は新しいスコープを受け入れます。
- 転置ドリフトガード: ステージの `scopes:` タグを編集して `scope-grid.json` を再コンパイルしないと、`aidlc-graph compile --check` がビルドを失敗させます。`tables.md` のコンパイル済みスコープ表にも独自の `--check` ドリフトガード（t67）があります。
- 自由形式 `/aidlc <text>` のプラン提案の手順は、各スコープを、その `.claude/scopes/*.md` フロントマターにある `keywords` のヒントとともに一覧します。エージェントはそれを読んでプランを提案します。カスタムスコープは、インストールされた時点でその一覧に現れます（SKILL.md の変更は不要）。ユーザーは提案を飛ばすため `--scope hotfix` を明示指定できます。

### 自動では検証されないこと

- 誤字のあるスコープ名の `scopes:` タグでもコンパイルは通る — 誰も参照しないグリッド列ができるだけで、そのステージは実スコープから黙って落ちます。ガードレールは `/aidlc --doctor` とスコープ単位テストです。
- ステージスキップ意味論（`PHASE_SKIPPED` イベント）。`tests/integration/t39.test.ts` は既知の 9 スコープ名をスコープ単位ループにハードコードしており、そのリストを拡張するまで新スコープは行使されません。同じ PR でそのループに新スコープを追加してください。

## ステージの追加

ステージは YAML フロントマター付き Markdown ファイルとして `core/aidlc-common/stages/<phase>/<slug>.md` に著述します。コンパイラはフロントマターを `tools/data/stage-graph.json` に読み込み、ランナージェネレーターはコンパイル済みステージ一覧から、コアステージ向けに入力可能な `/aidlc-<slug>` スキルを出力します（プラグイン所有のステージは、プラグインプレフィックス付きスラッグをそのまま使います）。拡張契約は「ステージを足すにはステージファイルを書く」です — エンジンはコンパイル済みグラフでルーティングするため、登録のためのエンジン編集は不要です。（フィールド全体リファレンスと 3 区画本文形式はハーネスエンジニアガイドの [ステージの解剖](../harness-engineering/01-anatomy-of-a-stage.md) と [ステージの追加](../harness-engineering/02-adding-a-stage.md) にあり、スキーマは [ステージ定義](15-stage-definition.md) です。）

### 手順

1. **ステージファイルを書く** - `core/aidlc-common/stages/<phase>/<slug>.md` を作成。フロントマターは `slug`、`phase`、`execution`/`condition`、`lead_agent` と任意の `support_agents`（エージェントスラッグ）、`mode`（`inline`、`subagent`、`pipeline`、`mob` のいずれか。`agent-team` は予約済みで未実装）、`consumes` / `produces`（成果物語彙名）、ユニットごとに条件付きでのみ書く成果物用の `optional_produces`（ユニット単位カバレッジから除外）、`requires_stage`（順序エッジ）、`scopes:` 所属リスト、束縛する任意の `sensors:`、ユニットごとに反復するなら `for_each`、（ユニット単位ステージでは）各ユニットの種別へ `produces` 成果物を絞り込む任意の `produces_kinds` マップを宣言します。本文はステージの 3 区画を持ちます。フィールド契約の全体は [ステージ定義](15-stage-definition.md) を参照。

2. **グラフを再コンパイル** — `aidlc engine graph compile` が新しいフロントマターを `tools/data/stage-graph.json` に読み、`scopes:` タグを `tools/data/scope-grid.json` へ転置します。`aidlc engine graph compile --check` で終了コード 0（ドリフトなし）を確認。その後、`aidlc engine gen stage-table` と `aidlc engine gen scope-table` で `skills/aidlc/tables.md` にある生成された表のミラーを更新し、`aidlc engine gen stage-table --check` と `scope-table --check` の両方が終了コード 0 で終わることを確認する。ステージは直後に `aidlc engine orchestrate next --stage <slug> --single` で実行可能です。

3. **ランナーを再生成** — `aidlc engine gen runners` が実行可能なコンパイル済みステージごとに `/aidlc-<slug>` ランナースキルを出すので、新ステージは手著述なしで入力可能コマンドを得ます。`aidlc engine gen runners --check` でディスク上のランナー集合がコンパイル済みステージ集合と一致することを確認（ドリフトガード。ブートストラップ初期化ステージは設計上除外）。

4. **ステージのルーティングを検証** — そのステージを含むスコープのワークフローで `aidlc engine orchestrate next` を駆動し、エンジンが解決済み `lead_agent`、ゲート、`consumes`、`produces` 付きでスラッグを名指しする `run-stage` ディレクティブを出すことを確認。

5. **スコープ対応・ステージ対応ドキュメントを更新** — 新ステージはステージ数とスコープごとの計画を変えます。`docs/guide/05-scopes-and-depth.md`（Stage-by-Scope Matrix。セルは `tests/unit/t244-scope-matrix-doc-sync.test.ts` でドリフトガードされています）、`docs/reference/16-artifact-vocabulary.md`（初期化以外のステージ数）、ハーネスエンジニアガイドのステージ章、計画を列挙するスコープリファレンスを更新。本章末尾のドキュメント方針どおり、同じ PR で行う。

6. **テストを追加しカバレッジを更新** — ステージの振る舞いに対する `t*.test.ts` を著述する（スイートは発見ベースなので、適切なレベルディレクトリにファイルを置くだけでよく、レジストリ行の追加は不要）。次に `bun tests/gen-coverage-registry.ts --check --base origin/main` がクリーンであることを確認する。これが失敗するのは、main がカバーしていたユニットがその主張を失った場合だけで、再生成やコミットが必要なカバレッジファイルはありません。ステージランナードリフトガード `tests/unit/t129-stage-runner-drift.test.ts` は生成ランナー集合がコンパイル済みステージ集合と等しいことを検証し、`tests/integration/t55-test-suite-drift.test.ts` は古いパスとマーカーを掃引します。

### 自動で検証されること

- **グラフ配置。** `compile` するとステージのエッジ（`requires_stage`、`consumes`、`produces`）が解決・順序付けされ、ディスク上の `stage-graph.json` がフロントマターからずれると `compile --check` がビルドを失敗させます。
- **生成されたステージ表。** オーケストレータスキルの隣にある `tables.md` のステージグラフ表はコンパイル済み `stage-graph.json` から描画され、生成領域がずれると `aidlc-utility stage-table --check` が失敗します（t32）。
- **スキーマ + 参照。** `aidlc-graph.ts compile` は `aidlc-stage-schema.ts` 経由で各ステージのフロントマターを検証し、`/aidlc --doctor` は `validateStageFrontmatter` に加え、すべての `lead_agent` / `support_agents` / `consumes` スラッグが解決する「グラフ参照」検査を再実行します。
- **ランナー一致。** `aidlc-runner-gen.ts check`（と `t129`）は、コンパイル済みステージにランナーが無い、または消えたステージにランナーが残っている場合に失敗します。

### 自動では検証されないこと

- **コンパイラが認識しない新しいフロントマターキー。** スキーマ未実装のキーが欲しければフレームワーク変更です。データを読むコードを編集するため、このレシピではなくエンジン／コンパイルパイプライン経路に従います。[ステージ定義](15-stage-definition.md) の予約キー名前空間は、将来の構造拡張が予測どおり着地するためのものです。
- **ドキュメント上の列挙。** `docs/` 全体のステージ数やスコープごとの計画表は手メンテです。同じ PR で更新してください（下記ドキュメント方針を参照）。

## エージェントの追加

エージェントメタデータ（表示名、ナレッジファイル例）は `core/agents/` 配下の各エージェント `.md` フロントマターから読みます。`core/tools/aidlc-lib.ts` の `loadAgents()` ヘルパーがそのディレクトリのすべてのペルソナ `.md` ファイル（`aidlc-*` という名前のもの、または `display_name`、`examples`、`tier`、`plugin` を持つもの）を発見し、ステータスラインフックが消費するメタデータマップ（表示名の描画）を導出します。エージェント追加に TypeScript の編集は不要です。

### 手順

1. **エージェントファイルを作成** — 必須フロントマター付きで新しい `core/agents/<slug>-agent.md` を置く:

   ```yaml
   ---
   name: <slug>-agent
   display_name: <Human-Readable Name>
   examples:
     - example-knowledge-file-one.md
     - example-knowledge-file-two.md
   description: >
     One-paragraph description of the agent's responsibilities and which stages it leads or supports.
   disallowedTools: Task
   tier: judgment
   ---
   ```

   `name` フィールドはファイル名ステムと完全一致すること。`display_name` はステータスラインが使う人向けラベル。`examples` はエージェント→例表に文書化された推奨ナレッジファイル名の一覧 — ユーザーへの提案であり、実行時に読み込まれずディスクにも書きません。`tier`（`judgment` | `balanced` | `templated`）はパッケージャが各ハーネスのモデル／工数キーへ投影する著述ダイヤルです — コアフロントマターに生の `model:`/`effort:` を書かないこと（[エージェントシステム](05-agent-system.md) を参照）。

2. **エージェントが発見されることを検証** — `bun -e "import { loadAgents } from 'core/tools/aidlc-lib.ts'; console.log(loadAgents().find(a => a.slug === '<slug>-agent'));"` が新しいエージェントのメタデータを表示すること。

3. **インテント生成がスペースナレッジディレクトリを作ることを検証** - `bun core/tools/aidlc-utility.ts intent-create --scope poc --project-dir /tmp/agent-smoke` が空のスペースレベル `aidlc/knowledge/` ディレクトリ（スペースの `intents/` と同階層）を作成すること。生成はエージェント別サブディレクトリや README をシードしません - チームは内容があるときに自分で `aidlc/knowledge/<slug>-agent/` を作ります。

4. **ステータスライン描画を検証** — `Active Agent: <slug>-agent` 付きの状態ファイルを用意してステータスラインフックを呼び出すと、出力の `--` 区切り後に表示名が含まれること。

5. **エージェントをステージへ配線** — ステージを主導または支援すべき新エージェントは、`core/aidlc-common/stages/<phase>/` 配下のステージ `.md` フロントマターの `lead_agent` / `support_agents` フィールドに名前を書く。次に `aidlc engine graph compile`（ドリフトガードとして `compile --check`）を実行し、そのフロントマターから `tools/data/stage-graph.json` を再生成する。`stage-graph.json` を手編集しない — コンパイル成果物であり、次の `compile` が手修正を上書きします。これは発見とは別です — `loadAgents()` がエージェントを可視化し、ステージフロントマター（グラフへコンパイル）がそれをアクティブにします。

### 自動で検証されること

- `loadAgents()` は次の呼び出しで `.claude/agents/` 内の新しいペルソナ `.md` ファイルを発見する — コード編集は不要。ペルソナとは、`aidlc-*` という名前のファイル、またはフロントマターに `display_name`、`examples`、`tier`、`plugin` を持つファイルのこと。そこにあるそれ以外のファイルはホスト自身のエージェントであり、そのままにされる。
- パーサーはペルソナの `name` または `display_name` が欠けると、ファイル名、欠落フィールド、そして（`aidlc-*` という名前でないファイルでは）それをペルソナにしたキーを示して例外を投げる。
- エージェントはスラッグのアルファベット順で返るため、どのプラットフォームでも `readdirSync` 順は同じ出力になる。
- インテント生成は空のスペースレベル `aidlc/knowledge/` ディレクトリを作る（エージェント別サブディレクトリや README はシードしない）。
- ステータスライン描画は同じメタデータ源から表示名を導出する。
- `tests/unit/t61.test.ts` はフィクスチャエージェントに対し 5 つの性質すべてをエンドツーエンドで検証する。

### 自動では検証されないこと

- **ステージグラフへの参加**。ステージフロントマターは `lead_agent` / `support_agents` でエージェントをスラッグ参照し、`aidlc-graph.ts compile` がそれを `stage-graph.json` へ運びます。どのステージフロントマターにも名前を書かずにエージェントを追加すると、存在しても実行されません。ステージグラフスキーマ検証（`core/tools/aidlc-stage-schema.ts`）は配線済みです。`aidlc-graph.ts compile` が各ステージのフロントマターを検証し（`compile --check` が CI ドリフトガード）、`/aidlc --doctor` は同じ `validateStageFrontmatter` に加え、すべての `lead_agent` / `support_agents` スラッグが解決する「グラフ参照」検査を再実行します。
- **ナレッジファイルの存在**。`examples` はエージェント→例表に文書化された推奨ファイル名の一覧であり、作成も検証もしません。実体はユーザーがスペースレベルナレッジディレクトリ `aidlc/knowledge/<agent>/` に置きます。
- **エージェントを列挙するドキュメント表**。`docs/reference/05-agent-system.md:119-131` のフェーズ参加マトリクスと、`core/knowledge/aidlc-shared/knowledge-readme-template.md:16-29` のエージェント→例表は手メンテです。エージェント追加と同じ PR で更新してください（下記ドキュメント方針を参照）。
- **`.claude/agents/<new-agent>.md` 本文**。パースされるのはフロントマターだけです。本文（主要責務、コラボレーション、任意のメモリフォーカス、主要原則）は有効化時にエージェント自身が読む — 既存のエージェントファイルと同じ構造で書いてください。

## ドキュメント方針

ファイル、ディレクトリ、コマンド、フラグを追加・削除・改名するときは:

1. `docs/` と `README.md` を grep して古い参照を探す
2. 同じコミットですべての参照を更新する

## 承認の根拠に関する方針

Plan Approval、レビュー、ゲート、Unit ライフサイクルの受領記録は、内容とステージの試行に結び付きます。質問を出したディレクティブの ID や、イベントの並び順に結び付くことは決してありません。Plan Approval を保持するのはコンダクターではなくエンジンです。`next` は質問を公開して何を尋ねたかを記録しますが、回答を記録することは決してありません。回答はその人の返答からだけ記録されます。human-turn フックが正確な選択を記録し、コンダクターの `log answer --checkpoint plan-approval` が読み取った選択を記録します。後者が受け付けられるのは、質問が表示されてから返答があった後だけです。いずれの場合も、エンジンは回答が記録された時点の計画ファイルのフィンガープリントを取ります。その流れで、ほかにコンダクターが実行するコマンドが Plan Approval の回答、受領記録、フィンガープリントのタグを書くことはありません。この 2 原則は [`12-state-machine.md`](12-state-machine.md#承認証跡の不変条件) に定義されています。提出前に次を確認してください。

1. フィンガープリント、epoch、受領記録の識別情報に入力を追加する変更か。その入力が検出する、人間に見える変更を明示する。人間の操作で変わらないもの（`next` の再実行、プローブ、ステータス照会、マーカーの書き直し、メタデータ更新）は識別情報へ含めず、来歴として記録する。
2. クエリ経路に書き込みをさせる変更か。`next` はディレクティブを公開し、Plan Approval については質問を公開するが、回答を公開することは決してない。受領記録を公開するのは、plan approval がオフのときのスキップ済みの記録としてだけである（その権限は回答ではなく設定にある）。停止フックのプローブ、経路確認、`--status`、`--doctor`、`team-board` は、承認の根拠となる状態を決して書かない。エンジンの観測処理では、さらに永続書き込みの基本操作に型付きの防壁があり、意図しない書き込みは何も言わずにではなく明示的に失敗する。
3. ガードに証拠を削除させる変更か。ガードができるのは拒否だけである。拒否を表すために受領記録、チャレンジ、マーカーを消すことはなく、記録済みのものを取り下げられるのは、人間の明示的な判断だけである。
4. `aidlc-state.md` にフィールドを追加する変更か。新しいフィールドは既定でアクティブなディレクティブに結び付く。状態ダイジェストから除外する場合は、そのフィールドをキャッシュに分類する意図的な判断であり、項目 1 と同じ説明が必要になる。

## 変更の提出

1. 何が変わりなぜかを明確に書いた PR を `main` 向けに開く
2. L1 テストが通ることを確認: `bash tests/run-tests.sh`
3. フック変更の場合: `bash tests/run-tests.sh --unit` を実行
4. 統合テストの場合: `bash tests/run-tests.sh --integration` を実行（`claude` CLI ツールが必要）
5. 変更がファイル、コマンド、フラグに影響するならドキュメントを更新する（上記ドキュメント方針を参照）
6. フィンガープリント、epoch、受領記録の識別情報に入力を追加する場合は、その入力が検出する、人間に見える変更を明示する（上記の承認の根拠に関する方針を参照）
