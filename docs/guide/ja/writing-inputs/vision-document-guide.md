# ビジョン文書の書き方

ビジョン文書は、**何を、誰のために、なぜ作るのか**、そして最初のリリースがどこで止まるのかを述べるものです。新しいワークフローの主な入力になります。Intent Capture、Scope Definition、Requirements Analysis がそれをもとに計画するので、それらのステージの質問は、すでに書いた内容の手早い確認になります。

始めるのに必須ではありません。`/aidlc Build a REST API for inventory management` だけでも完全な依頼です。ビジョン文書が役に立つのは、複数の人がまず目標について合意する必要があるとき、スコープが数文に収まらないとき、またはワークショップを運営していて、最初の 1 時間を質問ではなく決定に使いたいときです。

技術面の対になる文書、つまりスタック、ツール、許されないものを書くのは、[技術環境文書](technical-environment-guide.md) です。

---

## AI-DLC に渡す

文書をプロジェクトに保存し（Markdown かプレーンテキストがいちばん扱いやすい）、最初の依頼でその名前を示します:

```text
/aidlc Read ./vision.md and build what it describes
```

Codex CLI では `/aidlc` の代わりに `$aidlc` を使います。相対パスはプロジェクトのルートから解決されます。内容を `<document>` と `</document>` の間に入れて依頼に貼り付けることも、PDF や Word のファイル名を示すこともできます。それぞれの読み方と、名前が複数のファイルに一致したときに何が起きるかは、[既存ドキュメントから始める](../02-your-first-workflow.md#既存ドキュメントから始める) を見てください。

ワークフローは文書を指示ではなくデータとして扱います。それをもとに計画しますが、承認はすべて引き続きあなたが行います。Intent Capture はそれでも質問をします。文書がすでに答えている質問はすぐに確認でき、文書に書かれた未解決の問いは早い段階で取り上げられます。短いビジョン文書で、未解決の問いが倉庫ごとの在庫数についての 1 つだけだった Claude Code の実行では、Intent Capture がそのための質問を独自に追加しました（短縮し、罫線文字はプレーンテキストで表示し、ラベルが入る位置を示すために質問文の前に `[Product owner]` を加えています）:

```text
 Warehouses
 Q9. [Product owner] Do the internal tools need stock counts per warehouse, or one total per SKU?
 The vision doc leaves this open, and it changes what a "count" means for every SKU.
 > 1. One total per SKU
   2. Per warehouse per SKU
   3. One total now; per-warehouse later
   4. Not yet defined
```

---

## 短い版

ほかに何も書かないなら、次の 4 つを書いてください:

```text
1. One paragraph saying what you are building and for whom
2. The features in the first release (what is IN scope)
3. What is NOT in the first release
4. Open questions: things you already know are uncertain or undecided
```

未解決の問いは任意ですが、価値があります。Intent Capture と Requirements Analysis がそれらを早い段階で質問に変えるので、設計の途中でその穴が思わぬ形で表に出ることがなくなります。

### 既存のコードベースでの作業の場合

```text
1. Current state: one paragraph on what the system does today
2. What we are adding or changing
3. Features IN scope for this piece of work
4. Features OUT of scope for this piece of work
5. What must NOT change: components, APIs or data the new work must not touch
6. Open questions
```

いちばん大事なのは「変えてはいけないもの」です。Reverse Engineering は既存のコードを読みますが、どの部分に触れてはいけないかを知っているのはあなただけです。それを書いておけば、計画がそこへ近づかなくなります。

---

## 完全な構成

### 1. エグゼクティブサマリー（Executive Summary）

3〜5 文。このセクションだけを読んだ人でも、プロジェクトが何で、誰のためのもので、なぜ存在するのかが分かるようにします。

```markdown
## Executive Summary

[Project Name] is a [type of system or product] that lets [target users]
[core capability]. It addresses [business problem or opportunity] by
[approach or difference]. The expected outcome is [measurable result].
```

例:

```markdown
## Executive Summary

OrderFlow is a web-based order management platform that lets mid-size
retailers track inventory, process customer orders, and manage suppliers in
one place. It addresses the scattered tooling that causes fulfilment delays
and stock mismatches. The expected outcome is a 30% cut in order processing
time and no more manual stock reconciliation.
```

### 2. ビジネスの背景（Business Context）

```markdown
## Business Context

### Problem Statement
[The specific business problem. Be concrete: "orders wait two days for a
stock check" says more than "improve efficiency".]

### Business Drivers
[Why now: market pressure, a regulation, a contract, an internal need.]

### Target Users and Stakeholders
| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| [Role] | [Who they are] | [What they need from the system] |

### Business Constraints
[Budget, regulation, organisational policy, deadlines, anything that is not
negotiable.]

### Success Metrics
| Metric | Today | Target | How it is measured |
|--------|-------|--------|--------------------|
| [Metric] | [Baseline] | [Goal] | [Method] |
```

### 3. スコープ全体のビジョン（Full Scope Vision）

プロダクトが成熟したときになりうるもののすべてです。この部分は意図して志の高いものにします。作ることを約束せずに、最初のリリースがどこへ向かっているのかをワークフローが見られるようにするためです。

```markdown
## Full Scope Vision

### Product Vision Statement
[One sentence or a short paragraph: what the world looks like when the
product is fully realised.]

### Feature Areas
#### Feature Area 1: [Name]
- **Description**: [What this area covers]
- **Key capabilities**: [Capability 1], [Capability 2], [Capability 3]
- **User value**: [Why it matters to users]

### Integration Points
- [System or service]: [purpose of the integration]

### User Journeys
#### Journey 1: [Name]
1. [Step]
2. [Step]
**Outcome**: [What the user achieves]

### Growth and Roadmap (optional)
| Phase | Focus | Timeframe (if known) |
|-------|-------|----------------------|
| First release | [Core scope] | [Target] |
| Phase 2 | [Expansion] | [Target] |
```

### 4. 最初のリリース（MVP）のスコープ（First Release (MVP) Scope）

測れる価値を届ける、最小の機能の組です。ここに載っていない機能は、最初のリリースには入りません。

```markdown
## MVP Scope

### Objective
[The one thing the first release must prove or deliver, in one or two
sentences.]

### Success Criteria
- [ ] [Testable criterion]
- [ ] [Testable criterion]

### Features In Scope
| Feature | Description | Why it cannot wait |
|---------|-------------|--------------------|
| [Feature] | [Short description] | [Reason] |

### Features Out of Scope
| Feature | Why it can wait | Target phase |
|---------|-----------------|--------------|
| [Feature] | [Reason] | [Phase 2, 3 or later] |

### Journeys the First Release Supports
#### Journey 1: [Name]
1. [Step]
2. [Step]
**Outcome**: [What the user achieves]
**Simplified compared with the full vision**: [What is missing or reduced]

### Assumptions and Accepted Limits
- **Assumption**: [Statement]. **Risk if wrong**: [Consequence]
- **Accepted limit**: [What is limited on purpose, and why]

### Definition of Done
- [ ] Every in-scope feature built and tested
- [ ] [Project-specific criterion]
- [ ] [Sign-off needed]
```

### 5. リスク、依存関係、未解決の問い（Risks, Dependencies and Open Questions）

```markdown
## Risks and Dependencies

### Key Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk] | High / Medium / Low | High / Medium / Low | [Plan] |

### External Dependencies
- [Dependency]: [owner], [status]

### Open Questions
- [ ] [Question]
- [ ] [Question]
```

---

## 書き方の指針

すること:

- 具体的で、測れるように書く。「注文処理時間を 30% 短縮する」は「速くする」に勝ります。
- スコープ全体のビジョンと最初のリリースを分けておく。混ぜるとスコープが膨らみます。
- 対象外の一覧を書く。対象内の一覧と同じだけの価値があります。
- 営業資料ではなく、チームに向けて書く。
- 前提を書き、異議を唱えられるようにする。
- 誰かが実際にテストできる成功基準を示す。

しないこと:

- 「世界最高水準」「シームレス」「直感的」のような言葉を、裏付けの数字なしに使う。
- 技術や実装の詳細を並べる。それは [技術環境文書](technical-environment-guide.md) に書くものです。
- 最初のリリースのセクションを省く。どのプロジェクトにも出発点の境界が必要です。
- 読み手が業務を知っていると思い込む。当たり前に思えても、問題の記述は書いてください。

---

## 各セクションの使われ方

| セクション | ステージ | 使われ方 |
|---------|-------|----------------|
| エグゼクティブサマリー | Intent Capture & Framing | 問題、ユーザー、期待する成果 |
| ビジネスの背景 | Intent Capture & Framing、Requirements Analysis | 尋ねる質問と、要件をどこまで深く掘るか |
| スコープ全体のビジョン | Scope Definition、User Stories、Domain Design | プロダクトが向かう先。ペルソナとコンポーネント |
| 最初のリリースのスコープ | Scope Definition、Requirements Analysis | この作業の境界 |
| 対象内／対象外の機能 | Requirements Analysis、Units Generation、Code Generation | この作業で何を作るか |
| リスクと依存関係 | Feasibility & Constraints、NFR Requirements | リスクと制約の評価 |
| 未解決の問い | Intent Capture & Framing、Requirements Analysis | 明確化の質問として早い段階で尋ねる |

これらのステージのどれが実行されるかは、承認した計画によります。Express や Bugfix の計画では、そのうちの少しだけが実行されます。すべてのステージは [フェーズとステージ](../04-phases-and-stages.md) を、計画については [ワークフロープロファイル](../workflow-profiles.md) を見てください。
