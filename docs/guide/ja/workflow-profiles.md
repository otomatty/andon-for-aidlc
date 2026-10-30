# ワークフロープロファイル

AI-DLC は、すべてのタスクを同じライフサイクルに押し込めません。よくある作業の
種類に合わせた **ワークフロープロファイル** をひと揃い同梱しています。フル機能
開発、素早いバグ修正、インフラ変更、軽量な Express 実行、その他です。

エンジンはワークフロープロファイルを **スコープ** と呼びます。この 2 つの用語は、
同じ選択を異なる視点から言い表したものです。

- **ワークフロープロファイル** は利用者から見た体験です。どんな種類の作業をして
  いるのか、どれだけの手続きが必要なのかを表します。
- **スコープ** は `aidlc-state.md` に保存されるエンジンの設定です。そのワーク
  フローで使う正確なステージ経路、深度、テスト戦略、レビュー上限、手続きの切り替えを表します。

プロファイルは `/aidlc <profile>` で明示的に選ぶか、作業内容を説明して AI-DLC に
提案させます。アシスタントはあなたの説明を読んで、それに合うプロファイルを提案するか、
合うものがなければ適応コンポーザーを提案します。何かが始まる前に、あなたが経路を
確認します。明示的に名前を指定したプロファイルは、指定したとおりに使われます。
後ろに作るものを続ければ開始してそのステージ数とゲート数を表示し、名前だけなら
まず作業の目的を尋ねます。

## クイックチューザー

| ワークフロープロファイル | 向いている作業 | ステージ | 深度 | テスト戦略 | 開始コマンド |
|------------------|----------|--------|-------|---------------|------------|
| **Classic** | v1 型の Inception と Construction。Build and Test で完了 | 15 / 30 | Standard | Standard | `/aidlc classic` |
| **Express** | 要件からコードとテストまでの最も軽い経路 | 7 / 30 | Minimal | Minimal | `/aidlc express` |
| **Feature** | 完全なライフサイクルで作る本番機能 | 30 / 30 | Standard | Standard | `/aidlc feature` |
| **Enterprise** | 完全な追跡可能性を要する規制対象・高保証の作業 | 30 / 30 | Comprehensive | Comprehensive | `/aidlc enterprise` |
| **MVP** | 運用フェーズを含まない、実際の最初のプロダクト増分 | 20 / 30 | Standard | Standard | `/aidlc mvp` |
| **Proof of concept** | 最小限の実装経路で実現可能性を確かめる | 5 / 30 | Minimal | Minimal | `/aidlc poc` |
| **Bugfix** | 既知の不具合に対する的を絞った修正とリグレッションテスト | 6 / 30 | Minimal | Minimal | `/aidlc bugfix` |
| **Refactor** | プロダクトの挙動を変えずに既存コードを改善する | 7 / 30 | Minimal | Minimal | `/aidlc refactor` |
| **Infrastructure** | 環境、IaC、デプロイ基盤、コスト関連の作業 | 10 / 30 | Standard | Standard | `/aidlc infra` |
| **Security patch** | CVE 対応や範囲を絞った脆弱性対応 | 7 / 30 | Minimal | Minimal | `/aidlc security-patch` |
| **Workshop** | ファシリテーター主導のトレーニングや共同デリバリーのセッション | 23 / 30 | Standard | Minimal | `/aidlc workshop` |

ステージ数は静的な経路を表します。どのプロファイルも最初に実行する Initialization の
3 つのセットアップステージの後のステージを数えたもので、計画のオファーが示す数です。条件付きと記されたステージは、条件が当てはまら
なければ自らスキップされることがあります（グリーンフィールドのプロジェクトにおける
リバースエンジニアリングなど）。プロファイルごとの正確なステージ構成は
[ステージ×スコープ・マトリクス](05-scopes-and-depth.md#stage-by-scope-matrix)
を参照してください。

## `classic`

**Classic を選ぶとき:** v1 型の手続きで進めたい場合です。Inception では各ステージで人が一度承認し、Construction は Unit ごとに構築します。そこでは各 Unit のコード計画と、**Review each checkpoint** を選んだ場合はそのチェックポイントを承認します（Unit の設計ステージには独自の停止がありません。チームが所有する Unit は、ステージごとまたは Unit の終わりの独自のゲートを保ちます）。Ideation を省き、Operation は予約枠として残します。ステージで定義された実行モードとサポートエージェントは変わりません。

Classic は、利用者と `AWS_AIDLC_DEFAULT_SCOPE` のどちらも別のプロファイルを指定しない場合の暗黙の既定値です。対話で詳細なタスクを説明すると、作成前に適応コンポーズが提案される場合があります。成果物とテストは Standard です。Walking Skeleton とサマリー確認は無効、センサーと学びの手順は有効です。レビューは各ステージで助言を一度実行し、所見を承認ゲートに表示します。明示的な自律実行ではマージ前の一度のレビューを維持します。Guard Policy の既定値は off です。指示外の操作に対して、計画の再承認、review freeze、state transition、reviewer read scope のガードは道を譲り、そのたびに `GUARD_STOOD_ASIDE` 行を記録します。Plan Approval は引き続きエンジンが尋ねます。人間のターンによる権限と監査は維持します。

`/aidlc --sensors on|off`、`/aidlc --learnings on|off`、`/aidlc --summary-confirmation on|off`、`/aidlc --plan-approval on|off` でインテント単位にスコープの設定を上書きできます（plan approval を off にできるのはあなただけです）。`AIDLC_DISABLE_SENSORS=1`、`AIDLC_DISABLE_LEARNINGS=1`、`AIDLC_DISABLE_SUMMARY_CONFIRMATION=1`、`AIDLC_DISABLE_PLAN_APPROVAL_GUARD=1` は、インテントが on でも対応する手続きを無効にします。

問題自体がまだ不明確で、市場調査、実現可能性分析、明示的なスコープ探索が有効な
場合には Classic を選ばないでください。その場合は Feature か Enterprise を選びます。

## `express`

**Express を選ぶとき:** 要件がすでに理解されており、要件・実装・テスト、そして
任意のデプロイ末尾までを、サポートされている最短経路で通したい場合です。

Express はアイデア創出、設計パス、作業単位への分解、デリバリー計画、CI パイプライン
を省略します。ステージレビュアーのディスパッチを無効にし、Minimal の成果物と要件
駆動のテストを使います。リバースエンジニアリングとデプロイのステージは条件付きの
ままです。

Express はセンサー、学び、サマリー確認も off にします。インテントごとに [`/aidlc --sensors on|off`](12-cli-commands.md#aidlc-sensors-learnings-summary-confirmation-ceremony-controls)、
[`/aidlc --learnings on|off`](12-cli-commands.md#aidlc-sensors-learnings-summary-confirmation-ceremony-controls)、
[`/aidlc --summary-confirmation on|off`](12-cli-commands.md#aidlc-sensors-learnings-summary-confirmation-ceremony-controls) で上書きできます。

Express の [Guard Policy](13-customization.md#guard-policy) の既定値は off です。指示外の作業に対して plan
approval、review freeze、state transition、reviewer read scope のガードは道を譲り、そのたびに
`GUARD_STOOD_ASIDE` 行を記録します。human presence は on のままです。1 つのインテントで引き上げるには
`/aidlc --guard-policy strict` または `relaxed` と入力します。

曖昧な作業、チーム横断の作業、規制対象の作業、アーキテクチャ比重の高い作業では
Express を選ばないでください。その速さは、それらの判断面を意図的に取り除くことで
得られています。

## `feature`

**Feature を選ぶとき:** 本番機能を作っており、完全なライフサイクルを実務的な深さで
回したい場合です。

Feature はセットアップの後の 30 ステージすべてを Standard の深度で実行し、意図の発見から設計、実装、
デプロイ、フィードバックまでを通します。Enterprise ほど重い文書化の下限を課さずに、
未知のものを洗い出す機会を最も広く与えます。

## `enterprise`

**Enterprise を選ぶとき:** 規制対象、高リスク、監査が重視される作業、あるいは
形式的なコンプライアンスと運用上の証跡が必要な場合です。

Enterprise はセットアップの後の 30 ステージすべてを Comprehensive の深度で実行します。市場、
コンプライアンス、セキュリティ、設計、オブザーバビリティ、インシデント対応、
パフォーマンスの作業を残します。文書化されていない判断のコストが、追加の手続きの
コストを上回るためです。

## `mvp`

**MVP を選ぶとき:** アイデアが可能かどうかを試すのではなく、実際の最初のプロダクト
増分を出荷する場合です。

MVP はインセプションとコンストラクションの設計・実装経路を Standard の深度で完全に
保ちます。アイデア創出の一部の手続きを削り、運用フェーズを省略します。プロダクトに
本番運用と完全なフィードバックのライフサイクルが必要になったら、Feature か
Enterprise へ移ってください。

## `poc`

**Proof of Concept を選ぶとき:** 主たる問いが「そのアプローチが成り立つか」である
場合です。

PoC は 5 ステージを Minimal の深度で使います。プロダクト、設計、運用の手続きの多くを
省き、要件・コード・テストへ素早く到達します。PoC は後の判断のための証拠であり、
本番対応可否を判断するプロファイルではありません。

## `bugfix`

**Bugfix を選ぶとき:** 不具合が特定されており、望む結果が検証を伴う的を絞った修正で
ある場合です。

Bugfix は 6 ステージを Minimal の深度で使います。ワークスペースの理解、要件、
コード生成、ビルドとテスト、そしてデプロイの経路は残し、発見、広範な設計、無関係な
運用の作業は落とします。

Bugfix は学びとサマリー確認も off にするため、日誌を残すステージも、修正の後に「Keep that for next time?」と尋ねるステージもありません。
センサー、ステージ承認、plan approval は on のままです。

## `refactor`

**Refactor を選ぶとき:** 挙動は安定させたまま、内部構造、保守性、技術的負債を改善
する場合です。

Refactor は 7 ステージを Minimal の深度で使います。既存コードの理解、内部変更の
定義、その実装、挙動が退行していないことの証明、そして検証済みの結果をデプロイまで
運ぶことを重視します。利用者から見える挙動が変わる作業なら、代わりに Feature を
使ってください。

## `infra`

**Infrastructure を選ぶとき:** 成果物が環境、IaC の変更、デプロイ基盤、プラット
フォーム機能、コスト最適化である場合です。

Infrastructure は 10 ステージを Standard の深度で使います。利用者向けプロダクトの
手続きを取り除き、要件、非機能要件、インフラ設計、CI/CD、デプロイ、オブザーバビリティ
に集中します。

## `security-patch`

**Security Patch を選ぶとき:** 既知の CVE、脆弱性、範囲の狭いセキュリティ不具合へ
対応する場合です。

Security Patch は 7 ステージを Minimal の深度で使います。セキュリティに関わる要件、
検証、実装、デプロイの経路を保ちつつ、無関係なプロダクトの手続きを避けます。的を
絞ったパッチではなく、より広いセキュリティ／コンプライアンスのプログラムであれば
Enterprise を使ってください。

## `workshop`

**Workshop を選ぶとき:** ファシリテーターがトレーニングラボや調整された共同セッション
を主導する場合です。

Workshop は、演習をファシリテーターが用意するためアイデア創出を省略し、その後は
インセプションから運用までのライフサイクルを Standard の深度で実行します。教育の
セッションを止めないよう、テスト戦略は意図的に Minimal を使い、通常のレビューは
助言 1 回に制限します。複数参加者での進め方は [ワークショップモード](workshop-mode.md)
にあります。

## AI-DLC に選ばせる・コンポーズさせる

プロファイルを覚える必要はありません。作業内容を説明してください。

```
/aidlc Fix the login timeout bug
/aidlc Build a regulated payment approval service
/aidlc Create a lightweight prototype for the new search flow
```

説明した内容に標準プロファイルが合う場合、アシスタントはそれを提案し、そのステージ数と
ゲート数を確認用に表示します。内容が濃い作業や曖昧な作業では、適応コンポーザーを使う提案が
出ます。コンポーザーはあつらえのステージ経路を提案し、作成前に承認を待ちます。

次のようにしてその経路を強制できます。

```
/aidlc compose "harden the deployment pipeline and add observability"
```

## Constructionの承認と実行

Unit のソースを生成する新規のソロワークフローは、既定で 1 度に 1 つの Unit を直列に構築し、
検証済みの完了チェックポイントを使います。これには Unit への分解と、Unit ごとにソースを生成する
ステージが含まれていることが必要です。設計のみの作業や、Express のように Unit への分解を省く
プロファイルは、従来のステージの流れを維持します。チーム所有の Unit ゲートは独自の方針を維持
します。既存のワークフローと明示的な反復の選択は、新しい既定値によって変換されません。

skeleton-on の場合、最初の Unit は最小の動作する統合スライスとして計画されます。その Unit の
適用対象の設計作業と Code Generation が完了し、実際の統合検査が通過し、あなたがスケルトンを
承認してから後続の Unit が始まります。最初の設計文書は動作するスケルトンではありません。
skeleton-off では Construction の開始時に、skeleton-on ではスケルトンのチェックポイントの後に、
**Continue automatically** / **Review each checkpoint** を提示します。記録済みの選択は繰り返し
尋ねられず、Construction 中に自律性を明示的に許可または取り消せます。

承認方針と実行方式は別のものです。対象となる Code Generation のバッチをファンアウトするには、
stage-major の順序と swarm 実行を明示的に選びます。ガイド付きと自動のバッチ完了の両方に対応
しています。unit-major は直列のままです。すべての Unit の Plan Approval、検証コマンドの選択、
生成前の要約確認には、引き続きあなたの回答が必要です。対象となる swarm の計画は、個別のレシートを
保ったまま 1 回の **Approve Plans** の提示にまとめられます。人間が認可して記録した検証コマンドを
すべての Unit／バッチのチェックポイントで再利用し、変更するには新しい人間のレシートが必要です。
失敗した場合は引き続き停止します。新しいチェックポイント／実行のフィールドがない既存の
ワークフローは、記録済みの反復と従来の動作を維持します。[Construction のコマンド](12-cli-commands.md#construction-order-and-execution)
を参照してください。

## 関連する制御

ワークフロープロファイルは経路と既定値を決めます。次の項目は独立して調整できます。

- **深度**: `--depth minimal|standard|comprehensive`。
- **テスト戦略**: `--test-strategy minimal|standard|comprehensive`。
- **レビュー上限**: `--review adversarial|advisory|none`。実効クラスは、ステージ
  自身が宣言したクラスを、この実行単位の上限が設定されていればそれで、なければ
  プロファイルの上限で引き下げたものです。どちらの上限もステージを宣言以上に
  引き上げることはできず、実行単位の上限を設定するとプロファイルの上限に置き換わります。

これらの上書きは、あるプロファイルを別のプロファイルに変えるものではなく、選択した
プロファイルを調整するものです。規範的なルーティング表と上書きの意味論は
[スコープ、深度、テスト戦略](05-scopes-and-depth.md) を参照してください。
