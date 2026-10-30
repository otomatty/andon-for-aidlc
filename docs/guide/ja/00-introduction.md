# はじめに

> [AI-DLC ドキュメント](../README.md) の一部 · **User Guide** · [Harness Engineer Guide](../harness-engineering/00-overview.md) · [Developer Reference](../reference/00-overview.md)

## AI-DLC とは

AI-DLC（AI-Driven Development Life Cycle）は、AI を使った開発を、繰り返せて追跡できる段階に分ける方法論です。出自は [AWS の AI-DLC](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/) です。このリポジトリは、ハーネスに依存しない一つの `core/` から、現在使っている CLI ハーネスの中でそのまま動く実装です。対応は Claude Code、Kiro CLI、Kiro IDE、Codex CLI、Cursor、opencode、GitHub Copilot です。

このガイド自体はハーネス非依存です。ハーネスで違うところだけ、その章へ案内します（[他ハーネスで動かす](harnesses/README.md)）。例は注記がなければ Claude Code です。

起動はコマンド一つです。

```text
/aidlc Build a REST API for inventory management
```

あとは意図の整理から要件、設計、実装、テスト、デプロイまで、決める場面では必ず人が確認する流れで進みます。

## 考え方: 少人数のモブ、幅広い役割を担うエージェント

狭い専門家を何十人も置くと、ウォーターフォールの受け渡しが再現されます。AI-DLC は **幅広い能力を持つ 11 体のエージェント** が、複数のステージとフェーズにまたがって働きます。文脈をステージ間で持ち越すので、引き継ぎと調整が減ります。

うまく回っている人間のチームと同じです。3〜5 人のモブが機能全体を持ち、一人が一つの専門だけ、にはしません。

## オーケストレータの動き

中心は単純なループです。決定論的な **エンジン** が次を決め、**コンダクター**（`/aidlc` セッション、`SKILL.md`）が実行し、またエンジンに次を尋ねます。そのあいだフレームワークは次をします。

1. **ステージファイルを読む** — 5 フェーズ・33 ステージ。入力、手順、出力、リードエージェントが書いてある
2. **エージェントのペルソナを載せる** — アーキテクト、開発、プロダクトなど、領域の視点と知識を入れる
3. **状態と監査を持つ** — 進捗は `aidlc-state.md`、判断はインテントの `audit/` シャードに残す
4. **ステージの形に合わせて委譲する** — 集中した自律作業や複数エージェントの協働では、ハブ＆スポーク、パイプライン、モブとしてサブエージェントを出す
5. **承認ゲートを出す** — Ideation 以降の各ステージのあと、進める前に人が見て承認する（Construction では、定例のチェックポイントを止まらずに通すことも選べる）

ルーティング（次のステージ、スコープ、いつ止めるか）はエンジンの仕事です。実行の質（ステージをきちんと回す、質問の質、判断を人に出す）はコンダクターの仕事です。

ほとんどのステージは **インライン** です。コンダクターがエージェントの視点をまとって、会話の中で一緒に進めます。委譲する形を使うのは 4 ステージだけです。Practices Discovery と Code Generation は `subagent` ハブ、Reverse Engineering は `pipeline`、User Stories は `mob` です。内訳はインライン 29 / サブエージェント 2 / パイプライン 1 / モブ 1 です。サポートエージェントが加わるのはコラボレーターがオンのとき（既定でオンにするのは `enterprise` だけ）です。それ以外では、これらのステージはどれもリードエージェントだけで動き、Reverse Engineering のパイプラインは 2 段ではなく 1 段になります。全体の構造は Developer Reference の [Engine and Skill System](../reference/17-skill-system.md) です。

## このガイドの読者

AI-DLC を**使って**ソフトウェアを作る人向けです。

- **初めて** — [導入](01-getting-started.md)、続いて[ガイド付きのオンボーディング](onboarding.md)、[ワークフロープロファイル](workflow-profiles.md)、[最初のワークフロー](02-your-first-workflow.md)、[スペースとインテント](03-spaces-and-intents.md)
- **日常** — [CLI コマンド](12-cli-commands.md)、[スコープ・深度・テスト戦略](05-scopes-and-depth.md)、[トラブルシュート](15-troubleshooting.md)
- **チームリード** — チームの流儀に寄せるなら [ナレッジ](08-knowledge.md) と [ルールとラーニングループ](09-rules-and-the-learning-loop.md)

振る舞いそのものを変えたい（ステージやエージェントを足す、スコープを定義する、ルールやセンサーを書く、チームナレッジを足す。設定だけでコードは触らない）ときは [Harness Engineer Guide](../harness-engineering/00-overview.md) です。AI-DLC のコード自体を変えるときは [Developer Reference](../reference/00-overview.md) です。

## 数字

| 項目 | 値 |
| ---- | -- |
| フェーズ | 5（Initialization、Ideation、Inception、Construction、Operation） |
| ステージ | 33 |
| エージェント | 14（領域 11、レビュアー 2、コンポーザー 1） |
| スコープ | 11（enterprise から express、workshop を含む）+ あなたの言葉からエージェントが提案するプラン |
| 深度 | 3（Minimal / Standard / Comprehensive） |
| テスト戦略 | 3（Minimal / Standard / Comprehensive） |
| 監査イベントの種類 | 126 |

## 章立て

| 章 | 内容 |
| -- | ---- |
| [導入](01-getting-started.md) | 前提、インストール、最初のヘルスチェック |
| [オンボーディング: 最初の 1 週間のガイド](onboarding.md) | 全体の考え方と、初めてのチーム向けの 5 回の実行の道筋 |
| [ワークフロープロファイル](workflow-profiles.md) | Classic、Express とそのほかの選び方 |
| [最初のワークフロー](02-your-first-workflow.md) | 一通りの実行を注釈付きで |
| [ビジョン文書の書き方](writing-inputs/vision-document-guide.md)と[技術環境文書の書き方](writing-inputs/technical-environment-guide.md) | 大きめの作業やワークショップの前に書く 2 つのメモ |
| [スペースとインテント](03-spaces-and-intents.md) | 作業場所の形。スペースとインテントに仕事を分ける |
| [フェーズとステージ](04-phases-and-stages.md) | 5 フェーズ・33 ステージ |
| [スコープ・深度・テスト戦略](05-scopes-and-depth.md) | 選び方と途中変更 |
| [エージェント](06-agents.md) | 14 体の編成 |
| [エージェント詳細](agents/README.md) | 担当、ステージ、ナレッジ |
| [やり取りのモード](07-interaction-modes.md) | Guide Me / Edit File / Chat と承認ゲート |
| [ナレッジ](08-knowledge.md) | 社内標準とチーム文書の載せ方 |
| [ルールとラーニングループ](09-rules-and-the-learning-loop.md) | 訂正が継続して適用する行動規則ルール |
| [状態と監査](10-state-and-audit.md) | 進捗と判断の残し方 |
| [セッション管理](11-session-management.md) | 再開、やり直し、ジャンプ、復旧、報告スキル |
| [CLI コマンド](12-cli-commands.md) | フラグ一覧と例 |
| [カスタマイズ](13-customization.md) | 設定、スコープ、エージェントの調整 |
| [成果物リファレンス](14-artifacts-reference.md) | インテントごとのレコードディレクトリ（`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`） |
| [トラブルシュート](15-troubleshooting.md) | 症状からの切り分け |
| [実例](16-worked-examples.md) | バグ修正と機能追加の通し |
| [スキルとランナー](17-skills.md) | `/aidlc-*` と自作ランナー |
| [インストールとライフサイクル](18-install-and-lifecycle.md) | ネイティブ導入、初期化、更新、ロールバック、ピン、オフライン、アンインストール、プロジェクトからの AI-DLC の削除 |
| [複数チームの Construction とワークショップ](workshop-mode.md) | 取得、実装、固定マージバック、リリース、ワークショップ |
| [他ハーネスで動かす](harnesses/README.md) | 各ハーネスの導入と差分 |
| [用語集](glossary.md) | 用語の定義 |
