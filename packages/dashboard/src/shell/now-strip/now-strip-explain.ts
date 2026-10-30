import {
  CEREMONY_KEYS,
  type CeremonyKey,
  formatTimingDuration,
  type NextGateEstimate,
  type Phase,
  type StageStatus,
  type StageView,
  type WorkflowModel,
} from "@andon/shared-types";
import { STATUS_PRESENTATION } from "@/shared/ui/StatusChip.tsx";

/** Content for a Now-strip HoverCard: definition + current value + short bullets. */
export interface FieldExplain {
  definition: string;
  current: string;
  bullets: readonly string[];
}

const PHASE_MEANING: Record<Phase, string> = {
  INITIALIZATION: "ワークスペースと最初のインテントを用意する立ち上げ段階です。",
  IDEATION: "何を作るか・なぜ作るかを固める構想段階です。",
  INCEPTION: "要件・設計・計画に落とし込む準備段階です。",
  CONSTRUCTION: "ユニット単位で設計・実装・検証を進める構築段階です。",
  OPERATION: "出荷後の性能・運用・改善を扱う運用段階です。",
};

const DEPTH_MEANING: Record<string, string> = {
  minimal: "成果物を最小限に抑えた深さです。すばやく進める用途向け。",
  standard: "標準的な成果物の深さです。多くのスコープの既定値。",
  comprehensive: "網羅的な成果物を求める深さです。重い検証や文書化向け。",
};

function depthKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function explainPhase(phase: Phase): FieldExplain {
  return {
    definition: "ライフサイクル上の大区分です。ステージはこのフェーズの下に並びます。",
    current: PHASE_MEANING[phase],
    bullets: [
      "順に INITIALIZATION → IDEATION → INCEPTION → CONSTRUCTION → OPERATION",
      "Now strip の値は aidlc-state.md の Lifecycle Phase",
      "フェーズを跨ぐ進行はエンジン（/aidlc）が担当",
    ],
  };
}

export function explainStage(currentStage: string | null): FieldExplain {
  return {
    definition: "ワークフローグラフ上の作業単位です。1ステージが成果物・質問・ゲートを持ちます。",
    current:
      currentStage === null
        ? "現在ステージはありません（未開始、またはワークフロー完了）。"
        : `いまの作業点は「${currentStage}」です。ここで求められる承認や記入が進みます。`,
    bullets: [
      "Stage rail で前後のステージ一覧を確認できる",
      "クリックでそのステージの解説・成果物へ進める",
      "進行・SKIP の判定は選択中スコープに従う",
    ],
  };
}

export function explainScope(scope: string): FieldExplain {
  return {
    definition: "どのステージを EXECUTE / SKIP するかを決める実行プランの名前です。",
    current: `選択中は「${scope}」。.claude/scopes/ の定義に従い in-scope ステージが決まります。`,
    bullets: [
      "例: mvp / feature / prd-implementation / enterprise",
      "変更は /aidlc --scope <name>（承認ゲートあり）",
      "スコープが Stage rail の並びと完了分母を決める",
    ],
  };
}

export function explainDepth(depth: string): FieldExplain {
  const key = depthKey(depth);
  return {
    definition: "各ステージで求める成果物の詳しさ（深さ）です。",
    current: DEPTH_MEANING[key] ?? `いまの Depth は「${depth}」です。`,
    bullets: [
      "取りうる値: Minimal / Standard / Comprehensive",
      "スコープの既定値を /aidlc --depth で上書きできる",
      "Test Strategy とは別（テスト量は別フィールド）",
    ],
  };
}

export function explainGuardPolicy(workflow: WorkflowModel): FieldExplain {
  const setting = workflow.guardPolicy;
  return {
    definition:
      "承認後の変更とエージェントへのガードの扱いです。ここには状態ファイルの記録を表示します。旧名はChange Controlです。",
    current: workflow.unparseable?.guardPolicy
      ? "記録された値を解析できません。"
      : setting
        ? `${setting.value}${setting.source ? `（設定元: ${setting.source}）` : "（設定元の記録なし）"}`
        : "未記録です。旧形式で未記録の場合、エンジンの既定はstrictです。",
    bullets: [
      "strictは変更後の再確認を求めます。relaxedは変更を監査に残し、計画承認とレビュー中の変更防止ガードを緩めます。",
      "offは状態遷移とレビュアーの読取り範囲のガードも緩めます。人間の承認ゲートとUnitの所有権は維持します。",
      "上位のmemory設定がstrictを要求する場合、実行時はその設定が優先されます。",
      "この表示は承認方針を変更しません。",
    ],
  };
}

const CEREMONY_LABEL: Readonly<Record<CeremonyKey, string>> = {
  sensors: "センサー",
  learnings: "学習",
  summaryConfirmation: "要約確認",
  planApproval: "計画承認",
  collaborators: "協働エージェント",
};

/** One line for the strip: every ceremony in the engine's order. */
export function ceremonyText(workflow: WorkflowModel): string {
  return CEREMONY_KEYS.map(
    (key) => `${CEREMONY_LABEL[key]} ${workflow.ceremonies?.[key]?.value ?? "未記録"}`,
  ).join("・");
}

/** aidlc-workflows v2.11.0 scope-owned ceremonies, as the state file records them. */
export function explainCeremonies(workflow: WorkflowModel): FieldExplain {
  const recorded = CEREMONY_KEYS.flatMap((key) => {
    const setting = workflow.ceremonies?.[key];
    return setting
      ? [
          `${CEREMONY_LABEL[key]}: ${setting.value}${setting.source ? `（設定元: ${setting.source}）` : "（設定元の記録なし）"}`,
        ]
      : [];
  });
  const unreadable = workflow.unparseable?.ceremonies
    ? `解析できない行があります（${workflow.unparseable.ceremonies}）。`
    : "";
  return {
    definition:
      "スコープごとに既定値がある進め方の設定（センサー・学習・要約確認・計画承認・協働エージェント）です。ここには状態ファイルの記録を表示します。",
    current:
      unreadable +
      (recorded.length === 0
        ? "記録がありません。記録がない設定はスコープの既定値で動きます。"
        : `${recorded.join("、")}。`),
    bullets: [
      "変更は /aidlc に --sensors・--learnings・--summary-confirmation・--plan-approval・--collaborators と on / off を付けて行います",
      "計画承認が off でも、memory の Guard Policy が strict ならコード生成前の計画承認は残ります",
      "マシン側のスイッチ（環境変数・設定ファイル）で、実行時に off になる場合があります",
      "この表示は設定を変更しません。",
    ],
  };
}

function projectTypeSource(source: string | null): string {
  if (source === null || source === "workspace scan") return "ワークスペースの走査";
  return source === "you" ? "あなたが指定" : source;
}

/** One line for the strip: Project Type, who decided it, and a tailored plan. */
export function projectTypeText(workflow: WorkflowModel): string {
  const type = workflow.projectType
    ? `${workflow.projectType.value}（${projectTypeSource(workflow.projectType.source)}）`
    : "未記録";
  return workflow.plan ? `${type}・プラン ${workflow.plan}` : type;
}

export function explainProjectType(workflow: WorkflowModel): FieldExplain {
  const type = workflow.projectType
    ? `${workflow.projectType.value}（${projectTypeSource(workflow.projectType.source)}）`
    : "未記録です";
  return {
    definition:
      "新しいプロジェクト（Greenfield）か既存のコード（Brownfield）かの区別です。Reverse Engineering を行うかどうかに影響します。",
    current:
      workflow.plan === undefined
        ? `${type}${workflow.projectType ? "" : "。"}`
        : `${type}。このワークに合わせたプラン「${workflow.plan}」で進みます。`,
    bullets: [
      "既定ではワークスペースの走査結果から決まります",
      "/aidlc --project-type で指定した値は、その後の走査で上書きされません",
      "プランは composer がこのワーク向けに組んだステージ構成の名前です",
    ],
  };
}

export function explainGate(gate: StageStatus | null): FieldExplain {
  if (gate === null) {
    return {
      definition: "人間の承認が必要な止まり所です。ゲート中は次ステージへ進みません。",
      current: "ゲート状態はありません（現在ステージなし、または未適用）。",
      bullets: [
        "典型は awaiting approval（承認待ち）",
        "承認・差し戻しは aidlc-workflows 本体側の操作",
        "この Dashboard は状態の可視化が主目的",
      ],
    };
  }
  const { label } = STATUS_PRESENTATION[gate];
  return {
    definition: "人間の承認が必要な止まり所です。ゲート中は次ステージへ進みません。",
    current: `現在ステージの状態は「${label}」です。`,
    bullets: [
      "awaiting approval = 成果物を確認して承認する番",
      "revising = 差し戻し後の再作業中",
      "承認操作は /aidlc セッション側（Andon は読み取り中心）",
    ],
  };
}

export function explainDone(done: number, total: number): FieldExplain {
  return {
    definition: "スコープ内ステージの進捗カウントです（完了数 / 総数）。",
    current:
      total === 0
        ? "総数が 0 です（スコープまたは state を確認してください）。"
        : `${done} / ${total} — 完了（と SKIP 計上）が ${done}、分母は in-scope 総数 ${total}。`,
    bullets: [
      "分母は aidlc-state.md の Total Stages（なければ EXECUTE 行数）",
      "分子は Completed、または [x] と [S] の合計",
      "残りは Stage rail の未完了・進行中として見える",
    ],
  };
}

function explainElapsed(elapsedActiveMs: number | null): FieldExplain {
  return {
    definition:
      "監査ログから算出した作業時間です。対応付けられる承認待ち・中断を分け、設定されたしきい値を超えるログ空白を除外します。",
    current:
      elapsedActiveMs === null
        ? "まだ所要時間を算出できていません（実行中のステージがないか、監査ログを読めていません）。"
        : `観測済みの区間から算出した作業時間は ${formatTimingDuration(elapsedActiveMs)} です。`,
    bullets: [
      "最後の記録から現在までは作業に加えず、次の観測を待ちます",
      "短い休憩とログを出さない作業は区別できません",
      "ログを出さない処理も、設定されたしきい値を超えると長い空白として除外されます",
    ],
  };
}

function explainRemaining(remainingMs: number | null): FieldExplain {
  return {
    definition: "過去の作業時間の中央値から、今回の観測済み作業を引いた残りです。",
    current:
      remainingMs === null
        ? "実績がないか、今回の作業時間が不明のため算出できません。"
        : `残り約 ${formatTimingDuration(remainingMs)} の作業量です。`,
    bullets: [
      "完了時刻ではなく作業量です — いつ終わるかは着手のタイミング次第です",
      "実績が1件のみの場合は前回の値そのものです",
      "実績のないステージは同じフェーズの中央値で代用します",
      "同じフェーズにも実績がなければ、ワークスペース全体の中央値で代用します",
    ],
  };
}

function workBeforeGate(remainingMs: number | null): string {
  return remainingMs === null
    ? "それまでの作業量は推定できません。"
    : `それまでの残り作業は約 ${formatTimingDuration(remainingMs)} です。`;
}

function currentNextGate(nextGate: NextGateEstimate | null): string {
  if (nextGate === null) return "時間集計がまだないため算出できません。";
  const { stage, remainingMs } = nextGate;
  switch (nextGate.kind) {
    case "open":
      return `「${stage}」の承認ゲートが開いています。成果物を確認して承認または差し戻しを返してください。`;
    case "stage":
      return `「${stage}」の作業が終わると承認を求められます。${workBeforeGate(remainingMs)}`;
    case "block": {
      const together = nextGate.approvesTogether ?? [];
      const asked =
        together.length >= 2
          ? `「${together[0]}」から「${together.at(-1)}」までの ${together.length} ステージを 1 回の承認でまとめて求められます。`
          : `「${stage}」から順に承認を求められます。`;
      return `Unit ごとに Construction の作業を進め、すべての Unit が終わると${asked}${workBeforeGate(remainingMs)}`;
    }
    case "unit":
      return `現在の Unit の作業が「${stage}」まで終わると、Unit 単位の承認を求められます。${workBeforeGate(remainingMs)}この値は残りの Unit すべての作業を含むため、Unit が複数ある場合は承認がこの値より早く来ます。`;
    case "none":
      return remainingMs === 0
        ? "残りのステージに承認ゲートはありません。"
        : `完了まで承認ゲートはありません。${remainingMs === null ? "完了までの作業量は推定できません。" : `完了までの残り作業は約 ${formatTimingDuration(remainingMs)} です。`}`;
  }
}

export function explainNextGate(nextGate: NextGateEstimate | null): FieldExplain {
  const bullets = [
    "完了時刻ではなく作業量です。承認待ち、休憩、ステージ内の質問への回答は含みません",
    "承認ゲートの位置は aidlc-state.md の Construction 設定（自律モード、Unit 単位の反復、チェックポイント）と、監査ログにある walking skeleton の承認記録から判断します",
  ];
  if (nextGate !== null && nextGate.autoApproved.length > 0) {
    bullets.push(`承認なしで進むステージ: ${nextGate.autoApproved.join("、")}`);
  }
  if (nextGate?.planApproval) {
    bullets.push(
      "code-generation では、コード生成の前に Unit ごとの計画承認があります。この値は計画承認を区切りにしていません",
    );
  }
  // Only a partial sum needs the note: with no sum, `current` already says so.
  if (nextGate !== null && nextGate.remainingMs !== null && nextGate.estimateCoverage.unknown > 0) {
    bullets.push(`推定できない ${nextGate.estimateCoverage.unknown} 工程は合計に含みません`);
  }
  return {
    definition:
      "次に人の承認が必要になるまでの推定作業時間です。現在のステージから、承認ゲートのあるステージまでの残りを足し合わせます。",
    current: currentNextGate(nextGate),
    bullets,
  };
}

/**
 * @param current the reconciled view of `workflow.currentStage` (issue #9),
 *   already freshness-gated by the caller — `null` when there is no current
 *   stage or the timings payload still describes a different one.
 * @param nextGate the next approval gate, freshness-gated the same way.
 */
export function explainNowFields(
  workflow: WorkflowModel,
  current: StageView | null,
  nextGate: NextGateEstimate | null = null,
): {
  phase: FieldExplain;
  stage: FieldExplain;
  scope: FieldExplain;
  depth: FieldExplain;
  guardPolicy: FieldExplain;
  ceremonies: FieldExplain;
  projectType: FieldExplain;
  gate: FieldExplain;
  done: FieldExplain;
  elapsed: FieldExplain;
  remaining: FieldExplain;
  nextGate: FieldExplain;
} {
  return {
    phase: explainPhase(workflow.phase),
    stage: explainStage(workflow.currentStage),
    scope: explainScope(workflow.scope),
    depth: explainDepth(workflow.depth),
    guardPolicy: explainGuardPolicy(workflow),
    ceremonies: explainCeremonies(workflow),
    projectType: explainProjectType(workflow),
    gate: explainGate(workflow.gate),
    done: explainDone(workflow.done, workflow.total),
    elapsed: explainElapsed(current?.elapsedActiveMs ?? null),
    remaining: explainRemaining(current?.remainingMs ?? null),
    nextGate: explainNextGate(nextGate),
  };
}
