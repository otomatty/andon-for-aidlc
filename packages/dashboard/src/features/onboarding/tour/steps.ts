import type { WorkflowModel } from "@andon/shared-types";

/**
 * An element the tour points at, matched by exact attribute value so a stage
 * slug from the workflow is never spliced into a CSS selector. These are UI
 * contracts: TourOverlay.test.tsx fails when one stops resolving.
 */
export interface TourAnchor {
  attr: "data-testid" | "data-onboarding";
  value: string;
}

export type TourRoute = { name: "home" } | { name: "stage"; slug: string } | null;

export interface TourStep {
  id: "intent" | "now" | "rail" | "gate" | "outputs" | "menu";
  title: string;
  body: string;
  anchor: TourAnchor;
  /** Where the step happens. `null` keeps the current page. */
  route: TourRoute;
}

const HOME: TourRoute = { name: "home" };

/** The stage to explain: the current one, else the first executed, else any. */
function tourStage(workflow: WorkflowModel): string | null {
  if (workflow.currentStage !== null) return workflow.currentStage;
  const executed = workflow.stages.find((stage) => stage.execution === "EXECUTE");
  return executed?.slug ?? workflow.stages[0]?.slug ?? null;
}

/** The steps for this workflow, from choosing the intent to finding help again. */
export function buildTourSteps(workflow: WorkflowModel | null): TourStep[] {
  const intent: TourStep = {
    id: "intent",
    title: "表示する作業を選ぶ",
    body: "ここで表示するインテント（作業）を切り替えます。切り替えても、AI-DLCの進行状況は変わりません。",
    anchor: { attr: "data-testid", value: "intent-picker-trigger" },
    route: HOME,
  };
  const menu: TourStep = {
    id: "menu",
    title: "困ったときはメニューから",
    body: "ドキュメント・プラグイン・カスタマイズ・効果測定のほか、「はじめに」と「更新情報」もここから開けます。",
    anchor: { attr: "data-testid", value: "header-menu-trigger" },
    route: null,
  };
  if (workflow === null) return [intent, menu];

  const now: TourStep = {
    id: "now",
    title: "いまの工程を知る",
    body: "AI-DLCが進めている工程と、その状態（進行中・承認待ちなど）を表示します。開くと、フェーズや完了数、残り時間も確認できます。",
    anchor: { attr: "data-testid", value: "now-toggle" },
    route: HOME,
  };
  const slug = tourStage(workflow);
  if (slug === null) return [intent, now, menu];

  const stage: TourRoute = { name: "stage", slug };
  return [
    intent,
    now,
    {
      id: "rail",
      title: "工程の一覧",
      body: "実行する工程が順に並びます。状態は記号と文字で示します。工程を選ぶと、その説明と成果物を開けます。",
      anchor: { attr: "data-testid", value: `stage-rail-item-${slug}` },
      route: HOME,
    },
    {
      id: "gate",
      title: "承認で確認すること",
      body: "「ゲート要求」は、この工程の承認で確かめる内容です。確認したら、承認や修正の依頼をAI-DLCのチャットで伝えます。",
      anchor: { attr: "data-onboarding", value: "gate-requirement" },
      route: stage,
    },
    {
      id: "outputs",
      title: "AIが作る成果物",
      body: "この工程で作られる文書の一覧です。作成済みの文書は、この画面の下部や名前のリンクから本文を読めます。",
      anchor: { attr: "data-onboarding", value: "stage-outputs" },
      route: stage,
    },
    menu,
  ];
}

/**
 * The first matching element that is on screen. Home content stays mounted
 * but parked (`data-parked`) while another page is open; it does not count.
 */
export function findAnchor(anchor: TourAnchor, root: ParentNode = document): Element | null {
  for (const element of root.querySelectorAll(`[${anchor.attr}]`)) {
    if (element.getAttribute(anchor.attr) !== anchor.value) continue;
    if (element.closest("[data-parked]") !== null) continue;
    return element;
  }
  return null;
}
