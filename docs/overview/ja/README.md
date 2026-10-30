# AI-DLC ドキュメント

AI-DLC は、承認ゲートを設けて AI によるソフトウェア開発を進める手法です。
このリポジトリは Claude Code、Kiro CLI、Kiro IDE、Codex CLI、Cursor、opencode、GitHub Copilot 上でネイティブに動作します。

## クイックスタート

### 1. インストールする

macOS、Linux、WSL:

```bash
curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1 | iex
```

ネイティブインストーラーは、全ハーネスのランタイムを含め、AI-DLC に必要なものをすべてセットアップします。Bun や Node.js をインストールする必要はありません。Windows では現在のアカウント向けにインストールし、bin ディレクトリを User PATH に自動で登録します。「管理者として実行」で開いたウィンドウでは警告と確認が出るので、通常の PowerShell ウィンドウから実行してください。すでに開いていたターミナルアプリや IDE は古い PATH を保持したままなので、そこで `aidlc` を使う前にいったん終了して開き直してください。その中で新しいタブを開くだけでは足りません。永続的な PATH 変更と現在のプロセスの PATH 変更の両方を省くには [`-NoModifyPath`](guide/18-install-and-lifecycle.md#windows-powershell) を使います。

### 2. 設定する

プロジェクトのルートで実行します。

```bash
aidlc config --harness claude
aidlc doctor
```

`claude` は `kiro`、`kiro-ide`、`codex`、`cursor`、`opencode`、`copilot` に置き換えられます。
引数なしの `aidlc config` は対話形式のセットアップを開始します。

### 3. 開始する

設定したハーネスを開き、作業内容を伝えます。

```text
/aidlc 在庫管理用の REST API を作る
```

Codex CLI では `$aidlc` を使います。プロバイダーの設定、信頼の確認、プロジェクト設定の更新、最初のワークフローについては、[はじめに](guide/01-getting-started.md) を参照してください。

## ハーネスを選ぶ

| ハーネス | ガイド |
| --- | --- |
| Claude Code | [はじめに](guide/01-getting-started.md) |
| Kiro CLI | [Kiro CLI で AI-DLC を動かす](guide/harnesses/kiro-cli.md) |
| Kiro IDE | [Kiro IDE で AI-DLC を動かす](guide/harnesses/kiro-ide.md) |
| Codex CLI | [Codex CLI での AI-DLC](guide/harnesses/codex-cli.md) |
| Cursor | [Cursor での AI-DLC](guide/harnesses/cursor.md) |
| opencode | [opencode での AI-DLC](guide/harnesses/opencode.md) |
| GitHub Copilot | [GitHub Copilot での AI-DLC](guide/harnesses/copilot.md) |

## ガイドを選ぶ

| ガイド | 用途 |
| --- | --- |
| [ユーザーガイド](guide/00-introduction.md) | AI-DLC でソフトウェアを開発する |
| [オンボーディングの手引き](guide/onboarding.md) | 初めてのチーム向け。考え方の要点と、5 回の実行で進む案内付きの道筋 |
| [ワークフロープロファイル](guide/workflow-profiles.md) | Classic、Express、用途別のワークフローを選ぶ |
| [ファシリテーターガイド](guide/facilitator-guide.md) | ワークショップの運営やチームの支援: 準備チェック、復旧プレイブック、ハーネスの比較 |
| [インストールとライフサイクル](guide/18-install-and-lifecycle.md) | 更新、バージョン固定、オフライン導入、ミラーの利用、アンインストール、またはプロジェクトからの AI-DLC の削除 |
| [ハーネスエンジニアガイド](harness-engineering/00-overview.md) | ステージ、エージェント、スコープ、ルール、センサー、ナレッジを調整する |
| [開発とリリース](https://github.com/awslabs/aidlc-workflows/blob/6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a/DEVELOPERS.md) | PR の AI レビュー、preview での検証、stable 公開までを進める |
| [開発者リファレンス](reference/00-overview.md) | エンジン、フック、パッケージ化、テストスイートを変更する |

## 開発

メンテナーは `core/` と `harness/` を編集します。生成される `dist/` と `dist-release/` はローカルの出力であり、手で編集してはいけません。

開発手順は [貢献ガイド](reference/11-contributing.md)、ランタイムを追加する方法は [新しいハーネスへの移植](harness-engineering/09-porting-to-a-new-harness.md) を参照してください。
