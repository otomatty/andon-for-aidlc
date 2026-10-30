# AI-DLC ワークフロー図

このドキュメントには、AI-DLC（AI 主導の開発ライフサイクル）方法論を可視化するすべての Mermaid 図を収録しています。各セクションには簡単な説明とレンダリングされた図を含みます。これらの図は、エンジンおよびコンダクター（`aidlc-orchestrate.ts` + `SKILL.md`）、ステージプロトコル（`stage-protocol.md`）、ステージファイル、エージェント定義に基づいています。

> **注記:** これらの図は、関連する各リファレンス章にもインラインで埋め込まれています。このファイルはすべての図を一箇所にまとめた索引です。以下の図における `<record>/` は、アクティブな意図の記録ディレクトリ `aidlc/spaces/<space>/intents/<YYMMDD>-<label>/` を表します。
>
> - 図 1 と 7: [アーキテクチャ](01-architecture.md)
> - 図 8: [オーケストレーター](03-orchestrator.md) -- セッション管理セクション
> - 図 9: [オーケストレーター](03-orchestrator.md) -- スコープからステージへの対応付けセクション
> - 図 10: [ナレッジシステム](10-knowledge-system.md)
> - 図 11: [ステージプロトコル](04-stage-protocol.md) -- 承認ゲートセクション
> - 図 12: [オーケストレーター](03-orchestrator.md) -- 状態ファイルのスキーマセクション

---

## 1. エンドツーエンドのライフサイクル

AI-DLC 方法論は作業を五つの連続したフェーズに編成します。アイデア創出、構想策定、構築の後の境界にはそれぞれ検証チェックが入り、計画がそのステージを実行する場合に、フェーズを締めくくるステージ（承認と引き継ぎ、デリバリー計画、CI パイプライン）がそれを書きます。初期化はチェックなしで最初のフェーズへ引き継ぎます。ライフサイクル全体は五つのフェーズにまたがる 33 ステージから成り、実際に実行するステージはスコープが決定します。

```mermaid
graph LR
    subgraph INITIALIZATION["初期化（0.1〜0.3）"]
        Z1["ワークスペースの足場作成"]
        Z4["状態の初期化"]
        Z1 -.->|"3 ステージ"| Z4
    end

    subgraph IDEATION["アイデア創出（1.1〜1.7）"]
        I1["意図の収集"]
        I7["承認と引き継ぎ"]
        I1 -.->|"7 ステージ"| I7
    end

    subgraph INCEPTION["構想策定（2.1〜2.9）"]
        N1["リバースエンジニアリング"]
        N7["デリバリー計画"]
        N1 -.->|"9 ステージ"| N7
    end

    subgraph CONSTRUCTION["構築（3.1〜3.7）"]
        C1["機能設計"]
        C7["CI パイプライン"]
        C1 -.->|"記録された順序で作業ユニットごとに 3.1〜3.5、すべてのユニット完了後に一度だけ 3.6〜3.7"| C7
    end

    subgraph OPERATION["運用（4.1〜4.7）"]
        O1["デプロイメントパイプライン"]
        O7["フィードバックと最適化"]
        O1 -.->|"7 ステージ"| O7
    end

    Z4 -->|"自動進行"| I1
    I7 -->|"検証ゲート 1"| N1
    N7 -->|"検証ゲート 2"| C1
    C7 -->|"検証ゲート 3"| O1
    O7 -.->|"フィードバックループ"| I1

    style INITIALIZATION fill:#f3e5f5,stroke:#9c27b0,color:#000
    style IDEATION fill:#e8f5e9,stroke:#4caf50,color:#000
    style INCEPTION fill:#e3f2fd,stroke:#2196f3,color:#000
    style CONSTRUCTION fill:#fff3e0,stroke:#ff9800,color:#000
    style OPERATION fill:#fce4ec,stroke:#e91e63,color:#000
```

---

## 2. アイデア創出フロー

アイデア創出フェーズでは、ビジネス上の意図を収集し、実現可能性を検証し、スコープを定義し、チームを編成し、ラフモックアップを作成して、承認用のイニシアチブ概要を作成します。常時実行と付いたステージは、それを含むすべてのスコープで実行されます。スコープがどのステージを含むかは、そのスコープの計画で決まります。bugfix、refactor、infra、security-patch、classic、workshop、express はアイデア創出を実行しません。poc は意図の収集と整理だけを実行します。mvp は市場調査、チーム編成、承認と引き継ぎを除きます。フェーズチェックを書くのは承認と引き継ぎだけなので、mvp と poc はフェーズチェックなしでアイデア創出を抜けます。実線矢印は常時実行のルーティング、破線矢印は条件付きルーティングを表します。

```mermaid
flowchart TD
    S11["1.1 意図の収集と整理\n（プロダクト担当）"]
    S12["1.2 市場調査\n（プロダクト担当）"]
    S13["1.3 実現可能性と制約\n（アーキテクト）"]
    S14["1.4 スコープ定義\n（プロダクト担当）"]
    S15["1.5 チーム編成\n（デリバリー担当）"]
    S16["1.6 ラフモックアップ\n（デザイン担当）"]
    S17["1.7 承認と引き継ぎ\n（デリバリー担当）"]
    VG1{{"検証ゲート:\nアイデア創出 --> 構想策定"}}

    S11 -.->|"条件付き\n（enterprise、feature）"| S12
    S11 -.->|"mvp: 1.2 なし"| S13
    S12 -.->|条件付き| S13
    S12 -.->|"実現可能性の検証が\n不要ならスキップ"| S14
    S13 -.->|条件付き| S14
    S14 -.->|"条件付き\n（enterprise、feature）"| S15
    S14 -.->|"mvp: 1.5 なし"| S16
    S15 -.->|条件付き| S16
    S15 -.->|"UI がなければ\nスキップ"| S17
    S16 -.->|条件付き| S17
    S17 ==>|常に実行| VG1

    style S11 fill:#c8e6c9,stroke:#388e3c,color:#000
    style S14 fill:#c8e6c9,stroke:#388e3c,color:#000
    style S17 fill:#c8e6c9,stroke:#388e3c,color:#000
    style S12 fill:#fff9c4,stroke:#f9a825,color:#000
    style S13 fill:#fff9c4,stroke:#f9a825,color:#000
    style S15 fill:#fff9c4,stroke:#f9a825,color:#000
    style S16 fill:#fff9c4,stroke:#f9a825,color:#000
    style VG1 fill:#ef9a9a,stroke:#c62828,color:#000
```

---

## 3. 構想策定フロー

構想策定フェーズでは、コードベースを分析し（ブラウンフィールドプロジェクトの場合）、チームの実践を発見し、要件を引き出し、ユーザーストーリーとモックアップを作成し、アプリケーションアーキテクチャを設計し、実装ユニットに分解して、デリバリーを計画します。ステージ 2.1（リバースエンジニアリング）はパイプライン（2 リンクのチェーン）として実行され、六角形で示します。最初に開発者サブエージェントがコードを走査し、次にアーキテクトサブエージェントが結果を統合して成果物を書き出します。

```mermaid
flowchart TD
    S21{{"`**2.1 リバースエンジニアリング**<br/>    （開発者 + アーキテクト）<br/>    パイプライン: 2 リンク`"}}
    S22A["2.2 実践の発見\n（パイプライン/デプロイ担当）"]
    S22["2.3 要件分析\n（プロダクト担当）"]
    S23["2.4 ユーザーストーリー\n（プロダクト担当）"]
    S24["2.5 詳細モックアップ\n（デザイン担当）"]
    S25["2.6 ドメイン設計\n（アーキテクト）"]
    S26["2.7 ユニット生成\n（アーキテクト）"]
    S28["2.8 契約設計\n（アーキテクト）"]
    S27["2.9 デリバリー計画\n（デリバリー担当）"]
    VG2{{"検証ゲート:\n構想策定 --> 構築"}}

    BF_CHECK{"ブラウンフィールドか?\n（初期化 0.3 から）"}
    BF_CHECK -->|はい| S21
    BF_CHECK -->|"いいえ（グリーンフィールド:\nユーザーに確認）"| S22A
    S21 -.->|条件付き| S22A
    S22A -.->|条件付き| S22

    subgraph RE_DETAIL["2 リンク RE パイプライン"]
        direction LR
        DEV_SCAN["ステップ 1: 開発者による\nコード走査"]
        ARCH_SYNTH["ステップ 2: アーキテクトによる\n統合"]
        DEV_SCAN --> ARCH_SYNTH
    end

    S21 -.-> RE_DETAIL

    S22 ==>|常に実行| S23
    S22 -.->|"ユーザー向け機能が\nなければスキップ"| S25
    S23 -.->|条件付き| S24
    S23 -.->|"UI がない、または\nモックアップをスキップした場合"| S25
    S24 -.->|条件付き| S25
    S25 -.->|条件付き| S26
    S25 ==>|常に実行| S27
    S26 -.->|"マルチユニットの場合"| S28
    S26 -.->|条件付き| S27
    S28 -.->|条件付き| S27
    S27 ==>|常に実行| VG2

    style S21 fill:#bbdefb,stroke:#1565c0,color:#000
    style S22 fill:#c8e6c9,stroke:#388e3c,color:#000
    style S27 fill:#c8e6c9,stroke:#388e3c,color:#000
    style S22A fill:#fff9c4,stroke:#f9a825,color:#000
    style S23 fill:#fff9c4,stroke:#f9a825,color:#000
    style S24 fill:#fff9c4,stroke:#f9a825,color:#000
    style S25 fill:#fff9c4,stroke:#f9a825,color:#000
    style S26 fill:#fff9c4,stroke:#f9a825,color:#000
    style VG2 fill:#ef9a9a,stroke:#c62828,color:#000
    style RE_DETAIL fill:#e8eaf6,stroke:#3f51b5,color:#000
```

---

## 4. 構築フロー

次の図は、**ソースを生成する新規のソロ Unit ワークフロー**の既定を示します。unit-major・直列実行・検証済みチェックポイントです。skeleton-on の場合、DAG の最初の Unit は動作する統合スライスを形成し、後続の Unit より前に実際のエンドツーエンド検査と人間の承認を通過しなければなりません。これは従来の「最初の構築ステージのレビュー」とは異なります。設計のみ・Unit なし・既存・チーム所有の経路は記録済みの方針を維持し、stage-major を明示的に選んだ場合もそのまま有効です。実行順は `unit-of-work-dependency.md` から得られ、`bolt-plan.md` は計画のためのコンテンツです。

対象となる skeleton-off のワークフローは、構築開始時に **Continue automatically** / **Review each checkpoint** を提示します。skeleton-on では、すでに選択が記録されていない限り、実際のスケルトンのチェックポイントの後に提示します。この承認方針はスウォーム実行を選ぶものではありません。Plan Approval と有効な要約確認は引き続き人間による停止点です。要約確認が適用されるのは `directive.ceremony.summary_confirmation === "on"` の場合だけです。ビルドとテスト、および任意の CI パイプラインは、結果全体に対して一度だけ実行します。

```mermaid
flowchart TD
    START(["対象となるソース生成のソロ Unit ワークフロー"])
    NEXT["DAG 順で最初または次の Unit"]
    subgraph PER_UNIT["この Unit に適用される作業"]
        S31["3.1 機能設計 — 条件付き"]
        S32["3.2 NFR 要件 — 条件付き"]
        S33["3.3 NFR 設計 — 条件付き"]
        S34["3.4 インフラストラクチャ設計 — 条件付き"]
        PLAN{{"生成前の人間による Plan Approval"}}
        S35{{"3.5 コード生成<br/>この Unit のサブエージェント作業"}}
        S31 -.-> S32
        S32 -.-> S33
        S33 -.-> S34
        S34 --> PLAN --> S35
        S31 -.->|設計ステージをスキップ| PLAN
    end
    VERIFY["実プロジェクトでの検査<br/>スケルトンはエンドツーエンド"]
    CHECKPOINT{{"検証済みチェックポイント<br/>スケルトン: 人間の承認<br/>通常の Unit: 記録済みの完了方針"}}
    MORE{"残りの Unit があるか?"}
    BOOK["完了のみのステージ記帳"]
    S36["3.6 ビルドとテスト — 一度だけ"]
    S37["3.7 CI パイプライン — 条件付き、一度だけ"]
    VG3{{"構築から運用への検証"}}
    START --> NEXT --> PER_UNIT --> VERIFY --> CHECKPOINT --> MORE
    MORE -->|はい| NEXT
    MORE -->|いいえ| BOOK --> S36
    S36 --> S37 --> VG3
    S36 -.->|CI をスキップ| VG3
```

<!-- テキスト代替: 対象となる新規のソロワークフローでは、各 Unit に適用される設計ステージとコード生成を DAG 順に完了し、人間による Plan Approval と有効な要約確認を保ちます。動作する結果を検証し、そのチェックポイントを承認します。スケルトンでは常に人間が、通常の Unit では記録済みの方針に従って承認します。すべての Unit の後に記帳を確定し、ビルドとテストおよび任意の CI パイプラインを実行します。その他のワークフロー経路は既存の方針を維持します。 -->

---

## 5. 運用フロー

運用フェーズは、デプロイメント、環境プロビジョニング、オブザーバビリティ、インシデント対応、パフォーマンス検証、フィードバックを扱います。七つのステージはすべて条件付きです（MVP および概念実証スコープではフェーズ全体をスキップする場合があります）。すべてのステージはインラインで実行します。ステージ 4.7 は終端ステージであり、承認後にワークフローが完了するか、新しいアイデア創出サイクルを開始できます。

```mermaid
flowchart TD
    S41["4.1 デプロイメントパイプライン\n（パイプライン/デプロイ担当）"]
    S42["4.2 環境プロビジョニング\n（AWS プラットフォーム担当）"]
    S43["4.3 デプロイメント実行\n（パイプライン/デプロイ担当）"]
    S44["4.4 オブザーバビリティ設定\n（運用担当）"]
    S45["4.5 インシデント対応\n（運用担当）"]
    S46["4.6 パフォーマンス検証\n（品質担当）"]
    S47["4.7 フィードバックと最適化\n（運用担当）"]

    S41 -.->|条件付き| S42
    S42 -.->|条件付き| S43
    S43 -.->|条件付き| S44
    S44 -.->|条件付き| S45
    S45 -.->|条件付き| S46
    S46 -.->|条件付き| S47

    S47 -->|"承認"| DONE(["ワークフロー完了"])
    S47 -->|"新しいサイクルを開始"| IDEATION(["アイデア創出 1.1 に戻る"])

    style S41 fill:#fce4ec,stroke:#c62828,color:#000
    style S42 fill:#fce4ec,stroke:#c62828,color:#000
    style S43 fill:#fce4ec,stroke:#c62828,color:#000
    style S44 fill:#fce4ec,stroke:#c62828,color:#000
    style S45 fill:#fce4ec,stroke:#c62828,color:#000
    style S46 fill:#fce4ec,stroke:#c62828,color:#000
    style S47 fill:#fce4ec,stroke:#c62828,color:#000
    style DONE fill:#a5d6a7,stroke:#2e7d32,color:#000
    style IDEATION fill:#e8f5e9,stroke:#4caf50,color:#000
```

---

## 6. エージェント連携マップ

AI-DLC システムは 11 のドメイン専門エージェントを使用します。コンダクター（`SKILL.md`）はエンジンの指示に従って各エージェントを呼び出します。エージェント同士が直接呼び出し合うことはありません。エージェント間の情報は、意図の記録ディレクトリ（`aidlc/spaces/<space>/intents/<YYMMDD>-<label>/`）に格納された成果物を通じて流れます。以下の図は、運用エージェントからプロダクトエージェントへ戻るフィードバックループで終わる、エージェント間の主な情報フローを示します。

```mermaid
flowchart TD
    ORCH(["コンダクター（`SKILL.md`）"])

    PA["プロダクト担当\n（プロダクトマネージャー）"]
    DA["デザイン担当\n（UX デザイナー）"]
    DLA["デリバリー担当\n（デリバリーマネージャー）"]
    AA["アーキテクト\n（ソリューションアーキテクト）"]
    AWSA["AWS プラットフォーム担当"]
    CA["コンプライアンス担当"]
    DSA["デブセックオプス担当"]
    DEVA["開発者"]
    QA["品質担当\n（QA エンジニア）"]
    PDA["パイプライン/デプロイ担当"]
    OA["運用担当\n（SRE）"]

    ORCH -->|委譲| PA
    ORCH -->|委譲| DA
    ORCH -->|委譲| DLA
    ORCH -->|委譲| AA
    ORCH -->|委譲| AWSA
    ORCH -->|委譲| CA
    ORCH -->|委譲| DSA
    ORCH -->|委譲| DEVA
    ORCH -->|委譲| QA
    ORCH -->|委譲| PDA
    ORCH -->|委譲| OA

    PA -->|"要件、\nストーリー、スコープ"| AA
    PA -->|"意図、スコープ"| DA
    PA -->|"優先順位付きバックログ"| DLA
    AA -->|"アーキテクチャ、\nユニット仕様"| DEVA
    AA -->|"NFR の目標"| QA
    AA -->|"インフラ要件"| AWSA
    DA -->|"モックアップ、UX 仕様"| DEVA
    DEVA -->|"コード走査"| AA
    DEVA -->|"コード成果物"| QA
    QA -->|"テスト結果、\nバグレポート"| DEVA
    AWSA -->|"プロビジョニング済みインフラ"| PDA
    DSA -->|"セキュリティレビュー"| DEVA
    DSA -->|"セキュリティテスト"| QA
    PDA -->|"デプロイ済みサービス"| OA
    CA -->|"コンプライアンス制約"| AA
    DLA -->|"デリバリー計画"| DEVA
    OA ==>|"フィードバックループ:\n運用上の知見"| PA

    style ORCH fill:#e1bee7,stroke:#7b1fa2,color:#000
    style PA fill:#c8e6c9,stroke:#388e3c,color:#000
    style OA fill:#fce4ec,stroke:#c62828,color:#000
    style DEVA fill:#fff3e0,stroke:#e65100,color:#000
    style AA fill:#bbdefb,stroke:#1565c0,color:#000
```

---

## 7. 実行モデル

この実装では、ステージに四つのアクティブな実行モードを使用します。**インライン**ステージはオーケストレーターとの会話内で直接実行されます（ユーザーは対話可能です）。**サブエージェント**ステージはハーネスのサブエージェントツール（Claude Code では Task ツール）を通じて一つのエージェントへ委譲し、ステージがサポートエージェントを宣言する場合はハブ＆スポークになります。**パイプライン**ステージはエージェントを順番に連結し、各リンクが作業成果物を前進させます（同梱の例はリバースエンジニアリングです）。**モブ**ステージはサポートエージェントを回数に上限のあるラウンドで招集し、各寄稿は他の寄稿を見ずに行われます（ハーネスが複数を同時にディスパッチできる場合は並列に、できない場合は一つずつ順番に）。同梱の例はユーザーストーリーです。

```mermaid
flowchart LR
    subgraph INLINE["モード 1: インライン"]
        direction TB
        IN1["オーケストレーターが\nステージファイルを読む"]
        IN2["エージェントのペルソナと\nナレッジを読み込む"]
        IN3["会話内で直接\nステージ手順を実行"]
        IN4["ユーザーとの対話が\n可能"]
        IN5["承認ゲート\n（`AskUserQuestion`）"]
        IN1 --> IN2 --> IN3 --> IN4 --> IN5
    end

    subgraph SUBAGENT["モード 2: サブエージェント（単純）"]
        direction TB
        SA1["オーケストレーターが\nステージファイルを読む"]
        SA2["コンテキストを準備:\n成果物 + ペルソナ"]
        SA3["Task ツール呼び出し\n（subagent 種別を指定）"]
        SA4["サブエージェントが実行\n（ユーザー対話なし）"]
        SA5["構造化された要約を\nオーケストレーターへ返す"]
        SA6["オーケストレーターが\n完了と承認を提示"]
        SA1 --> SA2 --> SA3 --> SA4 --> SA5 --> SA6
    end

    subgraph TWOSTEP["モード 3: パイプライン（2 リンクの RE チェーン）"]
        direction TB
        TS1["オーケストレーターが\nリバースエンジニアリング\nステージファイルを読む"]
        TS2["Task: 開発者による\nコード走査"]
        TS3["開発者が走査結果を\n返す"]
        TS4["Task: アーキテクトによる\n統合"]
        TS5["アーキテクトが9個の\n成果物を作成"]
        TS6["オーケストレーターが\n完了と承認を提示"]
        TS1 --> TS2 --> TS3 --> TS4 --> TS5 --> TS6
    end

    subgraph MOB["モード 4: モブ（並列ラウンド）"]
        direction TB
        MB1["オーケストレーターが\nステージファイルを読む"]
        MB2["リードが成果物を\nインラインで起草"]
        MB3["並列 `Task`: すべての\nサポートエージェント、ブラインド"]
        MB4["各自が貢献ファイルを\n書き出す"]
        MB5["リードが統合;\n異議のトリアージ\n（判断 -> 人間、\n知識 -> ラウンド 2）"]
        MB6["オーケストレーターが\n完了と承認を提示"]
        MB1 --> MB2 --> MB3 --> MB4 --> MB5 --> MB6
    end

    style INLINE fill:#e8f5e9,stroke:#4caf50,color:#000
    style SUBAGENT fill:#e3f2fd,stroke:#2196f3,color:#000
    style TWOSTEP fill:#fff3e0,stroke:#ff9800,color:#000
    style MOB fill:#f3e5f5,stroke:#9c27b0,color:#000
```

---

## 8. セッション再開フロー

ユーザーが `/aidlc` を呼び出すと、オーケストレーターはアクティブな意図の `aidlc-state.md` を確認します。見つかった場合はチェックポイントから作業を続け（最初の呼び出しは `next --resume`）、利用者はいつでもやり直し、ステージへのジャンプ、新規開始を求められます。見つからない場合は最初の意図を作成します。

```mermaid
flowchart TD
    START(["/aidlc を呼び出し"])
    ARG_CHECK{"引数が\nあるか?"}
    STATUS_CHECK{"引数が\n`--status` か?"}
    STATE_EXISTS{"アクティブな意図が\n存在するか?"}

    CONTINUE["チェックポイントから\n続行:\nnext --resume"]
    OTHER["利用者がやり直し、ジャンプ、\n新規開始を求める:\nreport --result resumed"]

    STATUS_DISPLAY["読み取り専用の\n状態要約を表示"]
    SCOPE_DETECT{"既知のスコープか\n自由形式テキストか?"}
    KNOWN_SCOPE["明示されたスコープを使用"]
    FREEFORM["エージェントが\n計画を提案"]
    CONFIRM_SCOPE["ユーザーにスコープを\n確認"]
    CREATE["意図を作成:\n記録ディレクトリ、状態、\n監査を作成し最初の\nステージを開始"]

    START --> ARG_CHECK
    ARG_CHECK -->|はい| STATUS_CHECK
    ARG_CHECK -->|いいえ| STATE_EXISTS

    STATUS_CHECK -->|はい| STATUS_DISPLAY
    STATUS_CHECK -->|いいえ| STATE_EXISTS

    STATE_EXISTS -->|はい| CONTINUE
    STATE_EXISTS -->|いいえ| SCOPE_DETECT

    CONTINUE -.->|"いつでも"| OTHER
    OTHER -->|"新規開始: 確認"| CREATE

    SCOPE_DETECT -->|"既知のスコープ"| KNOWN_SCOPE --> CONFIRM_SCOPE
    SCOPE_DETECT -->|"自由形式テキスト"| FREEFORM --> CONFIRM_SCOPE
    CONFIRM_SCOPE --> CREATE

    style START fill:#e1bee7,stroke:#7b1fa2,color:#000
    style OTHER fill:#bbdefb,stroke:#1565c0,color:#000
    style CONTINUE fill:#c8e6c9,stroke:#388e3c,color:#000
    style CREATE fill:#c8e6c9,stroke:#388e3c,color:#000
```

---

## 9. スコープルーティング

> スコープルーティング表は、[オーケストレーターリファレンス -- スコープマッピング](03-orchestrator.md#スコープからステージへの対応付け) を参照してください。

---

## 10. ナレッジ読み込み順序

各ステージはナレッジを厳格な 6 ステップの順序で読み込みます。これにより、最初にガードレール、次に共有方法論、エージェント固有ナレッジ、チームカスタマイズ、最後に前ステージの成果物という優先順位が確保されます。以下のシーケンス図は、任意のステージアクティベーションにおける読み込み順序を示します。

> **注記:** ステップ 1〜5 は `stage-protocol.md` のセクション 5 で定義されるエージェントナレッジの読み込みであり、ステップ 6（前ステージの成果物）はファイル読み込みステップではなく、ランタイムにオーケストレーターが追加するコンテキストです。インラインステージと mob のインラインリードでは、このステップがリード自身のペルソナ（`lead_persona`）を運び、`inline_context_paths` がサポートペルソナの直後、共有方法論とエージェント方法論（ステップ 2〜3）の前にチームナレッジ（ステップ 4〜5）を並べ、サイズ上限はまず方法論を削ります。ディスパッチされたエージェントは以下の順序で読み込みます。

```mermaid
sequenceDiagram
    participant O as オーケストレーター
    participant G as ルール
    participant SM as 共有方法論
    participant AM as エージェント方法論
    participant TK as チームナレッジ
    participant TAK as チームのエージェントナレッジ
    participant PA as 前ステージの成果物

    O->>G: ステップ 1: `aidlc/spaces/<active-space>/memory/` を読み込む
    Note over G: `org.md` + `team.md` + `project.md` + `phases/<phase>.md`
    G-->>O: ルールを読み込み（厳密な加法性 — すべてのレイヤーが存在）

    O->>SM: ステップ 2: `.claude/knowledge/aidlc-shared/` を読み込む
    Note over SM: 共有方法論の原則
    SM-->>O: 共有ナレッジを読み込み

    O->>AM: ステップ 3: エージェント別方法論ナレッジを読み込む
    Note over AM: エージェント固有の方法論
    AM-->>O: エージェント方法論を読み込み

    O->>TK: ステップ 4: `aidlc/spaces/<active-space>/knowledge/aidlc-shared/` を読み込む
    Note over TK: チーム共有ナレッジ（存在する場合）
    TK-->>O: チームナレッジを読み込み

    O->>TAK: ステップ 5: `aidlc/spaces/<active-space>/knowledge/[agent-name]/` を読み込む
    Note over TAK: チームのエージェント固有ナレッジ（存在する場合）
    TAK-->>O: チームのエージェントナレッジを読み込み

    O->>PA: ステップ 6: 前ステージの成果物を読み込む
    Note over PA: 現在のステージ入力が要求するもの
    PA-->>O: 前ステージの成果物を読み込み

    Note over O: 完全なコンテキストでステージ実行を開始
```

---

## 11. 承認ゲートフロー

すべてのステージ（初期化の 3 ステージを除く）は承認ゲートで終わります。ゲートの監査証跡は report が所有します。質問を提示する前に `report --result awaiting-approval` が保留中のゲートを記録し（`STAGE_AWAITING_APPROVAL`）、`report --result approved|rejected` が応答を逐語で記録します（`GATE_APPROVED`/`GATE_REJECTED`）。`aidlc-log.ts decision`/`answer` は決して使いません。3 回の改訂サイクル後には、「現状のまま受け入れる」というエスケープハッチが利用可能になります。アイデア創出と構想策定のステージには、以前にスキップしたステージを追加する条件付きの第三選択肢が含まれることもあります。

```mermaid
flowchart TD
    COMPLETE["ステージ作業が完了"]
    REPORT_AWAITING["awaiting-approval を報告:\nエンジンがゲートを開き\nSTAGE_AWAITING_APPROVAL を発行"]
    ASK["AskUserQuestion:\n承認ゲート"]

    APPROVE["承認"]
    CHANGES["変更を依頼"]
    ACCEPT["現状のまま受け入れる\n（エスケープハッチ）"]
    ADD_STAGE["スキップ済みステージを追加\n（アイデア創出/構想策定のみ）"]

    REVISION_COUNT{"改訂サイクルが3回\n以上か?"}
    NOTE_2ND["2 回目の改訂後:\n次のサイクルでエスケープハッチが\n有効になることを通知"]

    REPORT_APPROVED["返答とともに approved を報告:\nエンジンが GATE_APPROVED を発行し、\n完了処理とルーティングを実行"]
    REPORT_REJECTED["フィードバックとともに rejected を報告:\nエンジンが GATE_REJECTED を発行し、\n改訂状態を記録"]
    REPORT_REVISED["revised を報告:\nエンジンがゲートを再度開く"]
    PROGRESS["進捗行を表示:\nM ステージ中 N 完了"]
    NEXT_STAGE["次のステージへ進む"]

    REVISE["ユーザーフィードバックを\nステージ成果物へ適用"]
    RE_PRESENT["完了メッセージを\n再提示"]

    ADD_EXEC["スキップ済みステージをワークフローへ挿入\n（スコープツールが変更を記録）"]

    COMPLETE --> REPORT_AWAITING --> ASK
    ASK --> APPROVE
    ASK --> CHANGES
    ASK --> ACCEPT
    ASK --> ADD_STAGE

    APPROVE --> REPORT_APPROVED --> PROGRESS --> NEXT_STAGE
    ACCEPT --> REPORT_APPROVED

    CHANGES --> REPORT_REJECTED --> REVISION_COUNT
    REVISION_COUNT -->|"< 3"| NOTE_2ND --> REVISE --> REPORT_REVISED --> RE_PRESENT --> ASK
    REVISION_COUNT -->|">= 3"| REVISE

    ADD_STAGE --> ADD_EXEC

    style COMPLETE fill:#e8f5e9,stroke:#388e3c,color:#000
    style REPORT_AWAITING fill:#e3f2fd,stroke:#1565c0,color:#000
    style ASK fill:#bbdefb,stroke:#1565c0,color:#000
    style APPROVE fill:#a5d6a7,stroke:#2e7d32,color:#000
    style CHANGES fill:#fff9c4,stroke:#f9a825,color:#000
    style REPORT_REJECTED fill:#fff3e0,stroke:#ef6c00,color:#000
    style REPORT_REVISED fill:#e3f2fd,stroke:#1565c0,color:#000
    style ACCEPT fill:#ffccbc,stroke:#bf360c,color:#000
    style ADD_STAGE fill:#e1bee7,stroke:#7b1fa2,color:#000
    style NEXT_STAGE fill:#c8e6c9,stroke:#388e3c,color:#000
```

---

## 12. 状態追跡

`aidlc-state.md` ファイルは、チェックボックス表記 `[ ]`（未開始）、`[-]`（進行中）、`[?]`（承認待ち）、`[R]`（改訂中）、`[x]`（完了）、`[S]`（スキップ済み）で各ステージを追跡します。これらの遷移はエンジンが所有します。コンダクターはチェックボックス状態を編集するのではなく、結果を報告します。この図はスキップ、やり直し、ジャンプ操作の補助フローも示します。

```mermaid
stateDiagram-v2
    [*] --> NS

    state "[ ] 未開始" as NS
    state "[-] 進行中" as IP
    state "[?] 承認待ち" as AW
    state "[R] 改訂中" as RV
    state "[x] 完了" as CO
    state "[S] スキップ済み" as SK

    NS --> IP : エンジンによるルーティング
    IP --> AW : 承認待ちを報告
    AW --> CO : 承認を報告
    AW --> RV : 却下を報告
    RV --> AW : 改訂を報告

    NS --> SK : スコープ構成
    IP --> SK : スキップを報告
    RV --> SK : スキップを報告
```

```mermaid
flowchart TD
    subgraph NORMAL["通常フロー"]
        direction LR
        NS1["[ ] 未開始"]
        IP1["[-] 進行中"]
        AW1["[?] 承認待ち"]
        CO1["[x] 完了"]
        NS1 -->|"エンジンによるルーティング"| IP1
        IP1 -->|"ゲート開放を報告"| AW1
        AW1 -->|"承認を報告"| CO1
    end

    subgraph SKIP["スキップフロー"]
        direction LR
        NS2["[ ] 未開始"]
        SK2["[S] スキップ済み"]
        NS2 -->|"スコープ構成"| SK2
    end

    subgraph REDO["やり直しフロー"]
        direction LR
        CO3["[x] 完了\nまたは [-] 進行中"]
        NS3["[ ] 未開始"]
        IP3["[-] 進行中"]
        CO3 -->|"ユーザーがやり直しを依頼\n（状態をリセット、ファイルは保持）"| NS3
        NS3 -->|"ステージを再実行"| IP3
    end

    subgraph JUMP["ジャンプフロー"]
        direction LR
        IP4["[-] 進行中\n（ステージ A）"]
        NS4["[ ] 未開始\n（ステージ B）"]
        IP4B["[-] 進行中\n（ステージ B）"]
        IP4 -->|"ユーザーがジャンプを依頼\n（スキップするステージを警告）"| NS4
        NS4 -->|"対象ステージを開始"| IP4B
    end

    style NORMAL fill:#e8f5e9,stroke:#4caf50,color:#000
    style SKIP fill:#fff9c4,stroke:#f9a825,color:#000
    style REDO fill:#e3f2fd,stroke:#2196f3,color:#000
    style JUMP fill:#fce4ec,stroke:#e91e63,color:#000
```

---

## ステージ別実行モードの一覧

このリファレンス表は、迅速に参照できるよう、各ステージを実行モードとリードエージェントに対応付けます。

| ステージ | 名称 | モード | リードエージェント |
|-------|------|------|------------|
| 0.1 | ワークスペースの足場作成 | インライン（自動進行） | オーケストレーター |
| 0.2 | ワークスペース検出 | インライン（自動進行、決定的スキャナー） | オーケストレーター |
| 0.3 | 状態の初期化 | インライン（自動進行） | オーケストレーター |
| 1.1 | 意図の収集 | インライン | プロダクト担当 |
| 1.2 | 市場調査 | インライン | プロダクト担当 |
| 1.3 | 実現可能性 | インライン | アーキテクト |
| 1.4 | スコープ定義 | インライン | プロダクト担当 |
| 1.5 | チーム編成 | インライン | デリバリー担当 |
| 1.6 | ラフモックアップ | インライン | デザイン担当 |
| 1.7 | 承認と引き継ぎ | インライン | デリバリー担当 |
| 2.1 | リバースエンジニアリング | パイプライン（2 リンク） | 開発者 + アーキテクト |
| 2.2 | 実践の発見 | サブエージェント | パイプライン/デプロイ担当 |
| 2.3 | 要件分析 | インライン | プロダクト担当 |
| 2.4 | ユーザーストーリー | モブ | プロダクト担当 |
| 2.5 | 詳細モックアップ | インライン | デザイン担当 |
| 2.6 | ドメイン設計 | インライン | アーキテクト |
| 2.7 | ユニット生成 | インライン | アーキテクト |
| 2.8 | 契約設計 | インライン | アーキテクト |
| 2.9 | デリバリー計画 | インライン | デリバリー担当 |
| 3.1 | 機能設計 | インライン | アーキテクト |
| 3.2 | NFR 要件 | インライン | アーキテクト |
| 3.3 | NFR 設計 | インライン | アーキテクト |
| 3.4 | インフラストラクチャ設計 | インライン | AWS プラットフォーム担当 |
| 3.5 | コード生成 | サブエージェント（開発者） | 開発者 |
| 3.6 | ビルドとテスト | インライン | 品質担当 |
| 3.7 | CI パイプライン | インライン | パイプライン/デプロイ担当 |
| 4.1 | デプロイメントパイプライン | インライン | パイプライン/デプロイ担当 |
| 4.2 | 環境プロビジョニング | インライン | AWS プラットフォーム担当 |
| 4.3 | デプロイメント実行 | インライン | パイプライン/デプロイ担当 |
| 4.4 | オブザーバビリティ設定 | インライン | 運用担当 |
| 4.5 | インシデント対応 | インライン | 運用担当 |
| 4.6 | パフォーマンス検証 | インライン | 品質担当 |
| 4.7 | フィードバックと最適化 | インライン | 運用担当 |
