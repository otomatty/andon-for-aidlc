# 他ハーネスで動かす

AI-DLC は、ハーネスに依存しない一つのコアを、いま使っている CLI へ向けに生成したものです。方法論 — [フェーズとステージ](../04-phases-and-stages.md)、[エージェント](../06-agents.md)、[スコープ](../05-scopes-and-depth.md)、[承認ゲート](../07-interaction-modes.md) — はどのハーネスでも同じです。違うのは *シェル* です。ゲートの出方、サブエージェントの出し方、どのセッションイベントが発火するか、設定の置き場所。各章は、そのハーネスの導入方法、前提、方法論から外れる振る舞いだけを扱います。

導入案内は、各ハーネスのネイティブな指示面に入ります:

| ハーネス | 導入案内ファイル |
|---------|-----------------|
| Claude Code | `.claude/CLAUDE.md`（完全な導入案内） |
| Kiro CLI と Kiro IDE | `.kiro/steering/aidlc-onboarding.md` |
| Codex CLI | `.codex/onboarding.md`（プロジェクトが信頼済みなら `.codex/config.toml` の `developer_instructions` からも注入） |
| Cursor | `.cursor/rules/aidlc-onboarding.mdc` |
| opencode | `.aidlc/onboarding.md` |
| GitHub Copilot | ルートの `AGENTS.md`（method import を含む完全な導入案内） |

Kiro、Kiro IDE、Codex、Cursor、opencode は、ハーネス共通のルート `AGENTS.md` ブロックを、導入済みの他のハーネスと共有します。それぞれのネイティブな設定は上のファイルに残ります。Copilot の完全なルートブロックは専有のままです。別々のハーネスが共存するには、エンジンディレクトリも別々である必要があります。

## インストールする

どのハーネスでも、推奨の初回経路はチェックサム検証付きのネイティブインストーラのあと `aidlc config` です:

```bash
tmp="$(mktemp -d)"
curl -fsSL \
  https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh \
  -o "$tmp/install.sh"
sh "$tmp/install.sh"
rm -rf "$tmp"
cd your-project
aidlc config
```

インストーラは常に、全ハーネスのランタイムを入れます。プロジェクトの面を選ぶのは `aidlc config --harness <name>` です。ホスト側の前提はそのままです。Codex は、プロジェクトのフック発見のために対象プロジェクトが Git リポジトリである必要があります。

Windows では `install.ps1` をダウンロードし、`& $installer` で起動します。アカウントの範囲、User PATH への自動登録、`-NoModifyPath` については [Windows でのインストール](../18-install-and-lifecycle.md#windows-powershell) を見てください。

使うハーネスを選んでください:

| ハーネス | 起動 | 章 |
|---------|--------|---------|
| **Claude Code** | `/aidlc` | [User Guide](../00-introduction.md) 全体で扱います（例は Claude Code）。導入方法は [導入](../01-getting-started.md)。 |
| **Kiro IDE**（≥ 1.1.70）と **Kiro CLI**（≥ 2.24.1、v3 エンジン）、セットアップでは Kiro として表示 | `/aidlc` | [Kiro IDE と Kiro CLI で AI-DLC を動かす](kiro-ide.md) — 両面で一つのディレクトリツリー: 前提（Opus 4.8）、導入、フック、Kiro で違うところ。 |
| **Kiro CLI** (≥ 2.6)、セットアップでは Kiro CLI (V2) として表示 | `/aidlc` | [Kiro CLI で AI-DLC を動かす](kiro-cli.md) — エンジンを固定しないハーネス: 前提、導入、Kiro で違うところ。Kiro CLI ≥ 2.24.1 で Kiro の v3 エンジンを使う場合は、上の Kiro を使ってください。 |
| **Codex CLI** (≥ 0.145.0) | `$aidlc` | [Codex CLI で AI-DLC を動かす](codex-cli.md) — 前提、信頼の事前シード、Bedrock 設定、git リポジトリ必須。 |
| **Cursor** | `/aidlc` | [Cursor で AI-DLC を動かす](cursor.md) — Cursor IDE と CLI で同じディレクトリツリー、ネイティブのサブエージェントとスキル、hooks.json アダプタ、Cursor で違うところ。 |
| **opencode**（1.18.29 以降、または OpenCode 2） | `/aidlc` | [opencode で AI-DLC を動かす](opencode.md) — `.aidlc/` と `.opencode/` の分割、アダプタプラグイン、opencode で違うところ。 |
| **GitHub Copilot** (CLI ≥ 1.0.74 / VS Code ≥ 1.130) | `/aidlc` | [GitHub Copilot で AI-DLC を動かす](copilot.md) — 両面で 1 回の導入、`.github/` へのマージ、フォルダ信頼、Copilot で違うところ。 |

Kiro（IDE でも CLI でも）では **Claude Opus 4.8** がいちばん安定します。**有料の Kiro プラン** が必要です。

手動コピーでは Bun を導入し、特定リリースの `aidlc-copy-runtime-X.Y.Z.tar.gz` をダウンロードして展開し、`runtime/<harness>/` ディレクトリを丸ごとコピーして、そのセットアップを一度実行します（[コピー経路](../18-install-and-lifecycle.md#コピー経路) を参照）。ネイティブの `aidlc` 実行ファイルは不要です。コピーが `.gitignore` や `AGENTS.md` を置き換えることはありません。AI-DLC は自分の行をそこへ足します。リポジトリのチェックアウトから生成済みディレクトリツリーはコピーしないでください。フレームワーク開発者は、代わりにソースチェックアウトで `bun scripts/package.ts` を実行し、無視されるローカルの `dist/` と `dist-release/` 出力を実体化できます。各ハーネス章は、手動コピーの手順を、見出し付きの代替として残しています。

`aidlc update` のあと、`aidlc doctor` でプロジェクト／ランタイムの版のずれを見て、各プロジェクトを `aidlc config` で更新してください。ワークフローが開いている間の更新も行われます。その仕事が続けられるかどうかを伝え、前のリリースへ戻すコマンドを示します。

この一覧は開いています。新しいハーネスは同じ型で章が足されます。ハーネスそのものを *作る* とき（ソース契約 — マニフェスト、フックアダプタ、`emit.ts`）は、Harness Engineer Guide の [Porting to a New Harness](../../harness-engineering/09-porting-to-a-new-harness.md) です。

どのハーネスでも方法論は同じです。まず [最初のワークフロー](../02-your-first-workflow.md) と [フェーズとステージ](../04-phases-and-stages.md) の案内から入ってください。

ワークショップを運営する、あるいはチームを支援する立場ですか。[ファシリテーターガイド](../facilitator-guide.md#各ハーネスがワークフローをどれだけ強く守らせるか) が、各ハーネスがワークフローをどれだけ強く守らせるかを比べ、準備チェックと復旧プレイブックを示しています。
