import {
  type DocsQaToolStatus,
  type VersionGate,
  versionGateRollbackGuide,
  type WorkflowsManagementState,
} from "@aidlc-guide/shared-types";
import type { CliManagementState } from "./cli-management.ts";
import { doctorFixFor } from "./doctor-fixes.ts";
import type { NativeDoctorReport } from "./doctor-output.ts";
import { HARNESS_LABELS, type HarnessId } from "./harness-detect.ts";
import { INSTALL_GUIDE_URL } from "./native-setup.ts";
import { sharedFilesFor } from "./shared-file-changes.ts";
import type { UpdateProblem } from "./workflows-conflicts.ts";
import {
  chosenAction,
  defaultAction,
  diffHunks,
  diffLines,
  isAiAction,
  type RepairChoices,
  type RepairGroup,
  type RepairItem,
  type RepairReview,
} from "./workflows-repair-plan.ts";
import {
  compareToTarget,
  shownProjectVersion,
  type UpdatePhase,
  updatePhase,
} from "./workflows-update-phase.ts";
import { escapeHtml as esc, stepItem, webviewPageStyles } from "./webview-page.ts";
import { webviewThemeStyles } from "./webview-theme.ts";

/** The check that runs before a project update, as far as this panel has got with it. */
export type UpdateCheck =
  | { state: "pending" }
  | { state: "checking" }
  | { state: "ok"; message: string }
  | { state: "problems"; problems: UpdateProblem[]; items: RepairItem[]; message: string }
  | { state: "failed"; message: string };

/** What the panel is doing now: the buttons wait, and the open step says so. */
export type UpdateActivity = {
  text: string;
  /** "中止" stops it (a check, a repair and the update that follows a repair). */
  cancellable: boolean;
};

/** A change to shared files this panel made, to be committed. */
export type UpdateChange = {
  kind: "update" | "pin";
  files: string[];
  commitMessage: string;
};

export type UpdateView = {
  gate: VersionGate;
  workflows: WorkflowsManagementState;
  cli: CliManagementState;
  check: UpdateCheck;
  /** The AI tools the last check found for a repair; null before any check. */
  repairTools: { tools: DocsQaToolStatus[]; message?: string } | null;
  change: UpdateChange | null;
  activity: UpdateActivity | null;
  /** How the last action ended; shown in the step it belongs to. */
  outcome: { text: string; error: boolean } | null;
  /** Per-tool lines from the last update or Doctor run. */
  toolResults: { id: string; message: string }[];
  /** The workspace's version files, as the version check reads them. */
  records?: readonly (string | null)[];
  extensionVersion?: string;
  /** What the person picked for the files that need a decision, by path. */
  choices?: RepairChoices;
  /** AI-written changes waiting for the person's approval. */
  review?: readonly RepairReview[] | null;
  /** What an AI said about a file when asked, by path. */
  explanations?: Readonly<Record<string, { text: string; error: boolean }>>;
  /** The last Doctor report of each tool. */
  doctorReports?: readonly { id: HarnessId; report: NativeDoctorReport }[];
};

type Tone = "warning" | "success" | "error" | "info";

const ICONS: Record<Tone, string> = {
  warning:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  success: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  error:
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
};

/** Long change lists stay readable; the rest are counted. */
const FILE_GROUPS_SHOWN = 12;

const labelOf = (id: string): string => HARNESS_LABELS[id as HarnessId] ?? id;
const toolList = (workflows: WorkflowsManagementState): string =>
  workflows.tools.map((tool) => tool.label).join("・");

/** The one-line state at the top of the screen. */
function statusCopy(
  phase: UpdatePhase,
  view: UpdateView,
): { tone: Tone; title: string; sub: string } {
  const { gate, cli } = view;
  const target = gate.target;
  switch (phase.name) {
    case "update":
      if (phase.reason === "older")
        return {
          tone: "warning",
          title: `プロジェクトを ${target} に更新してください`,
          sub: "更新するまで、AIDLC Guide のワークフロー表示は使えません。",
        };
      if (phase.reason === "retry")
        return {
          tone: "warning",
          title: "前回の更新が終わっていません",
          sub: `もう一度更新すると、すべてのツールを ${target} にそろえます。`,
        };
      if (phase.reason === "unpinned")
        return {
          tone: "info",
          title: "このプロジェクトはバージョンを固定していません",
          sub: `更新すると .aidlc-version を作り、${target} に固定します。`,
        };
      return {
        tone: "info",
        title: `プロジェクトを ${target} にそろえられます`,
        sub: view.workflows.message,
      };
    case "commit":
      return {
        tone: "success",
        title: phase.change === "pin" ? `${target} に固定しました` : `${target} に更新しました`,
        sub: "最後に、変わったファイルをコミットしてチームに共有してください。",
      };
    case "install":
      return phase.register
        ? {
            tone: "warning",
            title: `この PC に ${target} を登録してください`,
            sub: cli.targetInstalled
              ? `${target} は入っていますが、このプロジェクト用にまだ登録されていません。`
              : `このプロジェクトは ${target} に固定されています。この PC に入れて登録すると使えます。`,
          }
        : {
            tone: "warning",
            title: `この PC に ${target} を入れてください`,
            sub: `プロジェクトは ${target} です。この PC も同じバージョンにすると使えます。`,
          };
    case "pin":
      return {
        tone: "warning",
        title: `このプロジェクトを ${target} に固定してください`,
        sub: `この PC の既定 ${cli.machineVersion ?? "（不明）"} は、Guide の対応版より新しいバージョンです。`,
      };
    case "newer": {
      const version = shownProjectVersion(gate, view.workflows, view.records) ?? "（不明）";
      return {
        tone: "warning",
        title: "AIDLC Guide を更新してください",
        sub: version.includes("-preview")
          ? `このプロジェクトはプレビュー版 ${version} を使っています。この Guide が対応するのは安定版の ${target} です。`
          : `このプロジェクトの ${version} は、この Guide が対応する ${target} より新しいバージョンです。`,
      };
    }
    case "unknown":
      return { tone: "error", title: "バージョンを確認できません", sub: gate.message };
    case "setup":
      return {
        tone: "info",
        title: "このプロジェクトには AI-DLC が設定されていません",
        sub: "セットアップで、使うツールを選んで設定します。",
      };
    case "blocked":
      return { tone: "warning", title: "この画面からは対応できません", sub: phase.message };
    case "ok":
      return {
        tone: "success",
        title: "最新です",
        sub: gate.native
          ? `この PC とプロジェクトは、Guide の対応版 ${target} です。`
          : `このプロジェクトは、Guide の対応版 ${target} です。`,
      };
  }
}

type Mark = { text: string; tone: Tone } | null;

function compareMark(version: string | null, target: string): Mark {
  const order = compareToTarget(version, target);
  if (order === 0) return { text: "対応版", tone: "success" };
  if (order === -1) return { text: "古い", tone: "warning" };
  if (order === 1) return { text: "新しい", tone: "warning" };
  return null;
}

/** この PC / このプロジェクト / Guide の対応版, each marked against the target. */
function versionsHtml(phase: UpdatePhase, view: UpdateView): string {
  const { gate, cli, workflows } = view;
  const target = gate.target;
  // A native project runs the engine this PC resolves for it. A copied one runs
  // its own files, so the PC's default is only shown, never marked against the target.
  const pc = gate.native ? gate.engine : cli.machineVersion;
  const pcMark: Mark =
    phase.name === "install" && phase.register
      ? { text: "未登録", tone: "warning" }
      : pc === null
        ? { text: "未導入", tone: phase.name === "ok" ? "info" : "warning" }
        : gate.native
          ? compareMark(pc, target)
          : null;
  const unreadable = phase.name === "unknown" || phase.name === "setup";
  const project = unreadable ? null : shownProjectVersion(gate, workflows, view.records);
  const projectMark: Mark =
    phase.name === "unknown"
      ? { text: "確認できません", tone: "error" }
      : phase.name === "setup"
        ? { text: "未設定", tone: "info" }
        : phase.name === "commit"
          ? { text: "未コミット", tone: "info" }
          : phase.name === "pin" || (phase.name === "update" && phase.reason === "unpinned")
            ? { text: "固定なし", tone: phase.name === "pin" ? "warning" : "info" }
            : compareMark(project, target);
  const cell = (label: string, value: string | null, mark: Mark) =>
    `<div><dt>${esc(label)}</dt><dd><span class="ver">${esc(value ?? "—")}</span>${mark ? `<span class="badge tone-${mark.tone}">${esc(mark.text)}</span>` : ""}</dd></div>`;
  return `<dl class="versions">${cell("この PC", pc, pcMark)}${cell("このプロジェクト", project, projectMark)}${cell("Guide の対応版", target, null)}</dl>`;
}

function outcomeHtml(view: UpdateView): string {
  const outcome = view.outcome;
  if (!outcome || !outcome.text) return "";
  return outcome.error
    ? `<p class="outcome error" role="alert">${esc(outcome.text)}</p>`
    : `<p class="outcome" role="status">${esc(outcome.text)}</p>`;
}

function toolResultsHtml(view: UpdateView): string {
  return `<ul id="tool-results" aria-label="ツールごとの結果">${view.toolResults
    .map((result) => `<li>${esc(`${labelOf(result.id)}：${result.message}`)}</li>`)
    .join("")}</ul>`;
}

function activityHtml(view: UpdateView): string {
  const activity = view.activity;
  if (!activity) return "";
  return `<p class="lead" role="status">${esc(activity.text)}</p>
<p class="muted small" id="progress"></p>
${activity.cancellable ? '<div class="actions"><button type="button" class="text-link" id="cancel-repair" data-send="cancel-repair">中止</button></div>' : ""}`;
}

/** Group a change list by top-level folder: one line per tool tree, then the root files. */
function fileGroups(files: readonly string[]): { name: string; count: number }[] {
  const groups = new Map<string, number>();
  for (const file of files) {
    const slash = file.indexOf("/");
    const name = slash > 0 && slash < file.length - 1 ? file.slice(0, slash + 1) : file;
    groups.set(name, (groups.get(name) ?? 0) + 1);
  }
  return [...groups].map(([name, count]) => ({ name, count }));
}

function changeHtml(change: UpdateChange): string {
  const groups = fileGroups(change.files);
  const shown = groups.slice(0, FILE_GROUPS_SHOWN);
  const more = groups.length - shown.length;
  const list =
    groups.length === 0
      ? '<p class="lead">変わったファイルを Git で確認できませんでした。git status で確認してください。</p>'
      : `<p class="lead">リポジトリの次のファイルが変わりました。</p>
<ul class="files" id="shared-files" aria-label="変わったファイル">${shown
          .map(
            (group) =>
              `<li><code>${esc(group.name)}</code>${group.count > 1 ? `<span class="muted small">${group.count} 件</span>` : ""}</li>`,
          )
          .join("")}${more > 0 ? `<li class="muted small">ほか ${more} 件</li>` : ""}</ul>`;
  return `${list}
<div class="commit"><span class="muted small">コミットメッセージ</span><pre id="commit-message">${esc(change.commitMessage)}</pre></div>
<div class="actions"><button type="button" id="copy-commit" data-send="copy-commit">コミットメッセージをコピー</button><button type="button" class="text-link" id="open-scm" data-send="open-scm">ソース管理を開く</button><button type="button" class="text-link" id="open-dashboard" data-send="open-dashboard">AIDLC Guide を開く</button></div>
<p class="muted">チームのメンバーは pull すると、AIDLC Guide の案内で同じバージョンにそろえられます。</p>`;
}

const AI_LABELS: Record<string, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
};

/** The AI the page offers: a choice when several are available, otherwise the one, or why none. */
function repairToolHtml(view: UpdateView): { field: string; tool: string; ready: boolean } {
  const probe = view.repairTools;
  if (!probe)
    return {
      field:
        '<p class="muted small">利用できる AI を確認できていません。もう一度確認してください。</p>',
      tool: "",
      ready: false,
    };
  const available = probe.tools.filter((tool) => tool.available);
  const first = available[0];
  if (probe.message || !first)
    return {
      field: `<p class="muted small">${esc(probe.message ?? "AI を使えません。Claude Code、Cursor、GitHub Copilot CLI のいずれかを導入・ログインしてから、もう一度確認すると、AI での修正と説明を使えます。")}</p>`,
      tool: "",
      ready: false,
    };
  if (available.length === 1)
    return {
      field: `<p>使う AI：${esc(first.label)}（自動で選択）</p>`,
      tool: first.tool,
      ready: true,
    };
  return {
    field: `<div class="field"><label for="repair-tool">使う AI</label><select id="repair-tool" aria-describedby="repair-consent">${probe.tools
      .map(
        (tool) =>
          `<option value="${tool.available ? esc(tool.tool) : ""}"${tool.available ? "" : " disabled"}>${esc(tool.available ? tool.label : `${tool.label}：${tool.detail ?? "利用できません"}`)}</option>`,
      )
      .join("")}</select></div>`,
    tool: first.tool,
    ready: true,
  };
}

const GROUPS: readonly { key: RepairGroup; badge: string; tone: Tone; note: string }[] = [
  { key: "auto", badge: "自動で直します", tone: "success", note: "AI は使いません" },
  { key: "confirm", badge: "確認してください", tone: "warning", note: "おすすめを選んであります" },
  { key: "ai", badge: "AI が直します", tone: "info", note: "反映する前に差分を見せます" },
  {
    key: "manual",
    badge: "手で直してください",
    tone: "error",
    note: "直したら再チェックしてください",
  },
];

/** Where an item shows: one only an unavailable AI could fix is the person's to fix. */
const shownGroup = (item: RepairItem, aiReady: boolean): RepairGroup =>
  item.group !== "manual" && chosenAction(item, {}, aiReady) === null ? "manual" : item.group;

function itemHtml(
  item: RepairItem,
  index: number,
  view: UpdateView,
  ai: { ready: boolean; tool: string },
): string {
  const choices = view.choices ?? {};
  const head = `<div class="problem-head"><code>${esc(item.path)}</code><span class="muted small">${esc(item.harnesses.map(labelOf).join("・"))}</span>${
    item.path === "設定全体" || item.kind === "not-file"
      ? ""
      : `<button type="button" class="text-link" data-send="problem-file" data-path="${esc(item.path)}">ファイルを開く</button>`
  }${ai.ready ? `<button type="button" class="text-link" data-send="explain" data-path="${esc(item.path)}" data-tool="${esc(ai.tool)}">AI に聞く</button>` : ""}</div>`;
  const picked = chosenAction(item, choices, ai.ready);
  const recommended = defaultAction(item, ai.ready);
  let action = "";
  if (item.group === "confirm" && item.options.length > 1)
    action = `<fieldset class="opts"><legend class="sr-only">${esc(item.path)} の直し方</legend>${item.options
      .map((option) => {
        const off = isAiAction(option.action) && !ai.ready;
        return `<label><input type="radio" name="choice-${index}" value="${esc(option.action)}" data-path="${esc(item.path)}"${picked === option.action ? " checked" : ""}${off ? " disabled" : ""}><span>${esc(option.label)}${option.action === recommended ? '<span class="rec">おすすめ</span>' : ""}${off ? '<span class="muted small">（AI を使えません）</span>' : ""}</span></label>`;
      })
      .join("")}</fieldset>`;
  else if (item.group === "confirm" && item.options[0] && picked)
    action = `<p class="plan-action">${esc(item.options[0].label)}</p>`;
  const blocked =
    item.group !== "manual" && shownGroup(item, ai.ready) === "manual"
      ? '<p class="muted small">AI を使えないため、手で直してから再チェックしてください。</p>'
      : "";
  const note = item.note ? `<p class="item-note" role="note">${esc(item.note)}</p>` : "";
  const said = view.explanations?.[item.path];
  const explanation = said
    ? said.error
      ? `<p class="outcome error">${esc(said.text)}</p>`
      : `<div class="ai-note"><p class="muted small">AI の説明（参考）</p><p>${esc(said.text)}</p></div>`
    : "";
  const raw = `<details class="more raw"><summary>原文</summary><div class="more-body"><p class="muted small">${esc(item.detail)}</p>${item.remediation ? `<p class="muted small">${esc(item.remediation)}</p>` : ""}</div></details>`;
  return `<div class="fix-item">${head}<p>${esc(item.guidance)}</p><p class="plan">${esc(item.plan)}</p>${action}${blocked}${note}${explanation}${raw}</div>`;
}

/** The files the check refused, sorted by what fixes them, with the one button that fixes them all. */
function problemsHtml(view: UpdateView, items: readonly RepairItem[]): string {
  const target = view.workflows.target;
  const tool = repairToolHtml(view);
  const ai = { ready: tool.ready, tool: tool.tool };
  const hand = items.filter((item) => shownGroup(item, ai.ready) === "manual");
  const fixable = items.length - hand.length;
  const groups = GROUPS.map((group) => {
    const members = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => shownGroup(item, ai.ready) === group.key);
    if (members.length === 0) return "";
    return `<div class="fix-group tone-${group.tone}" data-group="${group.key}"><div class="fix-head"><span class="badge tone-${group.tone}">${group.badge}</span><strong>${members.length} 件</strong><span class="muted small">${group.note}</span></div>${members
      .map(({ item, index }) => itemHtml(item, index, view, ai))
      .join("")}</div>`;
  }).join("");
  const lead = hand.length
    ? `手で直す必要がある ${hand.length} 件を直してから、再チェックしてください。${fixable ? `残りの ${fixable} 件は、そのあとボタン 1 つで直せます。` : ""}`
    : `このままでは更新できない設定が ${items.length} 件あります。下の内容で直してから、そのまま更新します。`;
  if (view.activity) return `<p class="lead">${esc(lead)}</p>${groups}${activityHtml(view)}`;
  const aiOffered = items.some(
    (item) => item.group === "ai" || item.options.some((option) => isAiAction(option.action)),
  );
  const aiUsed = items.some((item) => {
    const action = chosenAction(item, view.choices ?? {}, ai.ready);
    return action !== null && isAiAction(action);
  });
  const field = ai.ready || aiOffered ? tool.field : "";
  const consent = ai.ready
    ? '<p class="muted small" id="repair-consent">「AI に聞く」では問題の説明だけを、AI で直すときはそのファイルの内容だけを、選んだ AI に送ります。CLI のログインと利用枠を使います。</p>'
    : "";
  const primary = hand.length
    ? '<button type="button" id="diagnose" data-send="diagnose">直したので再チェック</button>'
    : `<button type="button" id="repair" data-send="repair" data-tool="${esc(ai.tool)}">${esc(`${items.length} 件を直して ${target} に更新`)}</button><button type="button" class="text-link" id="diagnose" data-send="diagnose">自分で直して再チェック</button>`;
  const safety = hand.length
    ? ""
    : `<p class="muted small">直す前に、変わるファイルをバックアップします。直した結果はまず作業用コピーで確かめ、すべてのツールで競合がなくなってからプロジェクトに反映します。${aiUsed ? "AI が直したファイルは、反映する前に差分を見せます。" : ""}</p>`;
  return `<p class="lead">${esc(lead)}</p>
${groups}
${field}
${outcomeHtml(view)}
<div class="actions">${primary}<button type="button" class="text-link" id="copy-diagnosis" data-send="copy-diagnosis">診断情報をコピー</button></div>
${safety}${consent}`;
}

/** Rows of a diff with a little context; long diffs are cut. */
const DIFF_ROWS_SHOWN = 300;

function diffHtml(before: string, after: string): string {
  const hunks = diffHunks(diffLines(before, after));
  if (hunks.length === 0)
    return '<pre class="diff"><span class="gap">変更はありません</span></pre>';
  const shown = hunks.slice(0, DIFF_ROWS_SHOWN);
  const rows = shown
    .map((row) =>
      row === null
        ? '<span class="gap">…</span>'
        : `<span class="${row.kind}"><span class="ln">${row.kind === "add" ? "" : (row.old ?? "")}</span><span class="ln">${row.kind === "del" ? "" : (row.new ?? "")}</span><span class="sign">${row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}</span>${esc(row.text)}</span>`,
    )
    .join("");
  const more = hunks.length - shown.length;
  return `<pre class="diff" aria-label="変更の差分">${rows}${more > 0 ? `<span class="gap">ほか ${more} 行</span>` : ""}</pre>`;
}

/** The AI-written changes, each as a diff with the AI's words and the Guide's checks. */
function reviewHtml(view: UpdateView, reviews: readonly RepairReview[], total: number): string {
  const target = view.workflows.target;
  const blocks = reviews
    .map(
      (review) =>
        `<div class="review"><div class="problem-head"><code>${esc(review.path)}</code><span class="muted small">${esc(AI_LABELS[review.tool] ?? review.tool)} の修正案${review.action === "ai-merge" ? "（更新の後のファイル）" : ""}</span></div>
${diffHtml(review.before, review.after)}
${review.summary ? `<div class="ai-note"><p class="muted small">AI の説明</p><p>${esc(review.summary)}</p></div>` : ""}
<ul class="checks" aria-label="Guide による確認">${review.checks
          .map(
            (check) =>
              `<li class="${check.ok ? "ok" : "warn"}"><span aria-hidden="true">${check.ok ? "✓" : "!"}</span><span>${esc(check.text)}</span></li>`,
          )
          .join("")}</ul></div>`,
    )
    .join("");
  const lead = `作業用コピーで ${total} 件を直し、すべてのツールで更新できることを確かめました。AI が直した ${reviews.length} 件を確認してください。まだプロジェクトには反映していません。`;
  if (view.activity) return `<p class="lead">${esc(lead)}</p>${blocks}${activityHtml(view)}`;
  return `<p class="lead">${esc(lead)}</p>
${blocks}
${outcomeHtml(view)}
<div class="actions"><button type="button" id="approve" data-send="approve">${esc(`この内容で ${target} に更新`)}</button><button type="button" class="text-link" id="discard-review" data-send="discard-review">この修正を使わない</button></div>
<p class="muted small">反映する前に、変わるファイルをバックアップします。</p>`;
}

/** What Doctor found per tool, with the fixes the Guide can run itself. */
function doctorHtml(view: UpdateView): string {
  const groups = (view.doctorReports ?? []).flatMap(({ id, report }) => {
    const rows = report.checks
      .map((check, index) => ({ check, index }))
      .filter(({ check }) => check.status !== "ok");
    if (rows.length === 0 && (report.outcome === "ok" || report.outcome === "warning")) return [];
    return [
      `<div class="doctor-group"><p><strong>${esc(labelOf(id))}</strong>：${esc(report.summary)}</p>${
        rows.length
          ? `<ul>${rows
              .map(({ check, index }) => {
                const fix = doctorFixFor(check);
                const original =
                  !check.translated || check.fixTranslated === false
                    ? `<details class="more raw"><summary>原文</summary><div class="more-body"><p class="muted small">${esc(check.originalLabel)}</p>${check.originalFix ? `<p class="muted small">${esc(check.originalFix)}</p>` : ""}</div></details>`
                    : "";
                return `<li><div class="problem-head"><span class="badge tone-${check.status === "fail" ? "error" : "warning"}">${check.status === "fail" ? "問題あり" : "要確認"}</span><span>${esc(check.label)}</span></div>${check.fix ? `<p class="muted small">対処：${esc(check.fix)}</p>` : ""}${fix ? `<div class="actions"><button type="button" class="secondary" data-send="doctor-fix" data-harness="${esc(id)}" data-index="${index}">${esc(fix.label)}</button></div>` : ""}${original}</li>`;
              })
              .join("")}</ul>`
          : ""
      }</div>`,
    ];
  });
  return groups.length
    ? `<div class="doctor" aria-label="Doctor の結果"><p><strong>Doctor が見つけた項目</strong></p>${groups.join("")}</div>`
    : "";
}

function updateSteps(phase: Extract<UpdatePhase, { name: "update" }>, view: UpdateView): string {
  const { workflows, cli, check } = view;
  const target = workflows.target;
  const title = `プロジェクトを ${target} に更新`;
  const checkStep =
    check.state === "ok"
      ? stepItem(
          1,
          "更新前のチェック",
          "done",
          `<p>${esc(check.message)}</p><div class="actions"><button type="button" class="text-link" id="diagnose" data-send="diagnose">もう一度確認</button></div>`,
          "問題なし",
        )
      : check.state === "problems"
        ? view.review?.length
          ? stepItem(
              1,
              "AI が直した内容の確認",
              "current",
              reviewHtml(view, view.review, check.items.length),
            )
          : stepItem(1, "更新前のチェック", "blocked", problemsHtml(view, check.items))
        : stepItem(
            1,
            "更新前のチェック",
            "todo",
            "",
            check.state === "checking"
              ? "確認しています…"
              : check.state === "failed"
                ? "確認できませんでした"
                : "更新の前に確認します",
          );
  let updateStep: string;
  if (check.state === "problems") updateStep = stepItem(2, title, "todo");
  else if (view.activity)
    updateStep = stepItem(2, title, "current", `${activityHtml(view)}${toolResultsHtml(view)}`);
  else {
    const tools = toolList(workflows);
    const lead =
      phase.reason === "unpinned"
        ? `.aidlc-version を作り、このプロジェクトを ${target} に固定します。`
        : phase.reason === "retry"
          ? `止まった更新をやり直し、${tools} の設定を ${target} にそろえます。`
          : `${tools} の設定を ${target} にそろえます。`;
    const runtime =
      cli.targetInstalled && cli.launcherReady ? "" : `この PC にも ${target} を入れます。`;
    const failed =
      check.state === "failed"
        ? `<div class="note"><p>更新前のチェックを完了できませんでした：${esc(check.message)}</p><p>このまま更新するか、<button type="button" class="text-link" id="diagnose" data-send="diagnose">もう一度確認</button>してください。</p></div>`
        : "";
    const shared = sharedFilesFor(workflows.tools.map((tool) => tool.id as HarnessId));
    updateStep = stepItem(
      2,
      title,
      "current",
      `<p class="lead">${esc(lead)}</p>
<p class="muted">進行中のワークフローと成果物はそのまま残ります。${esc(runtime)}</p>
${failed}
${outcomeHtml(view)}
${toolResultsHtml(view)}
${doctorHtml(view)}
<div class="actions"><button type="button" id="apply" data-send="apply">${esc(title)}</button></div>
<details class="more"><summary>変わるファイル</summary><p class="muted small">ツールと版によって、次のファイルが変わります。更新後に、実際に変わったファイルを表示します。</p><ul class="files" id="shared-files-note">${shared.map((file) => `<li><code>${esc(file)}</code></li>`).join("")}</ul></details>`,
    );
  }
  return `${checkStep}${updateStep}${stepItem(3, "コミットして共有", "todo")}`;
}

function commitSteps(phase: Extract<UpdatePhase, { name: "commit" }>, view: UpdateView): string {
  const target = view.gate.target;
  const commit = view.change ? changeHtml(view.change) : "";
  const outcome = outcomeHtml(view);
  if (phase.change === "pin")
    return `${stepItem(1, `このプロジェクトを ${target} に固定`, "done", outcome, ".aidlc-version")}${stepItem(2, "コミットして共有", "current", commit)}`;
  const check = view.check;
  const checked =
    check.state === "ok" || check.state === "failed" ? `<p>${esc(check.message)}</p>` : "";
  const summary =
    check.state === "ok" ? "問題なし" : check.state === "failed" ? "確認できませんでした" : "";
  return `${stepItem(1, "更新前のチェック", "done", checked, summary)}${stepItem(2, `プロジェクトを ${target} に更新`, "done", `${outcome}${toolResultsHtml(view)}${doctorHtml(view)}`, toolList(view.workflows))}${stepItem(3, "コミットして共有", "current", commit)}`;
}

function installSteps(phase: Extract<UpdatePhase, { name: "install" }>, view: UpdateView): string {
  const target = view.gate.target;
  const title = phase.register ? "この PC に登録" : `この PC に ${target} を導入`;
  const body = view.activity
    ? activityHtml(view)
    : `<p class="lead">${esc(phase.register ? `この PC で、このプロジェクトの ${target} を使えるようにします。` : `この PC に AI-DLC ${target} を入れます。`)}</p>
<p class="muted">${esc(phase.register ? "この PC の既定バージョンとリポジトリのファイルは変わりません。" : `この PC の既定も ${target} になります。リポジトリのファイルは変わりません。`)}</p>
${outcomeHtml(view)}
<div class="actions"><button type="button" id="update-cli" data-send="update-cli">${esc(title)}</button></div>`;
  return `${stepItem(1, title, "current", body)}${stepItem(2, "完了", "todo")}`;
}

function pinSteps(view: UpdateView): string {
  const target = view.gate.target;
  const title = `このプロジェクトを ${target} に固定`;
  const body = view.activity
    ? activityHtml(view)
    : `<p class="lead">${esc(`このプロジェクトだけ ${target} で動かします。`)}</p>
<p class="muted"><code>.aidlc-version</code> を作ります。${esc(`この PC の既定 ${view.cli.machineVersion ?? ""} はそのままです。`)}</p>
${outcomeHtml(view)}
<div class="actions"><button type="button" id="pin-project" data-send="pin-project">${esc(title)}</button></div>
<div class="alt"><span class="muted small">固定しない場合（ほかのプロジェクトにも効きます）</span><button type="button" class="text-link" id="use-target" data-send="use-target">${esc(`この PC の既定を ${target} に戻す`)}</button></div>`;
  return `${stepItem(1, title, "current", body)}${stepItem(2, "コミットして共有", "todo")}`;
}

function newerCard(view: UpdateView): string {
  const target = view.gate.target;
  const version = shownProjectVersion(view.gate, view.workflows, view.records) ?? "";
  const guide = versionGateRollbackGuide(view.gate);
  const rollback = guide
    ? `<details class="more" id="rollback"><summary>${esc(guide.heading)}</summary><div class="more-body">${guide.lines.map((line) => `<p>${esc(line)}</p>`).join("")}${
        guide.commands.length > 0
          ? `<pre id="rollback-commands">${esc(guide.commands.join("\n"))}</pre><div class="actions"><button type="button" class="secondary" id="copy-rollback" data-send="copy-rollback">コマンドをコピー</button></div>`
          : ""
      }</div></details>`
    : "";
  return `<section class="card" aria-labelledby="action-title">
<h2 class="step-title" id="action-title">AIDLC Guide を更新</h2>
<p class="lead">${esc(version.includes("-preview") ? `安定版に対応した AIDLC Guide を待つか、プロジェクトを ${target} に戻してください。` : `新しい AIDLC Guide が ${version} に対応していれば、そのまま使えます。`)}</p>
<div class="actions"><button type="button" id="extension-update" data-send="extension-update">AIDLC Guide を更新</button></div>
${rollback}
</section>`;
}

function unknownCard(phase: Extract<UpdatePhase, { name: "unknown" }>, view: UpdateView): string {
  if (!phase.doctor)
    return `<section class="card" aria-labelledby="action-title">
<h2 class="step-title" id="action-title">直してから再確認</h2>
<p class="lead">上の案内に沿ってファイルを直してから、状態を再確認してください。</p>
<div class="actions"><button type="button" id="recheck" data-send="refresh">状態を再確認</button></div>
</section>`;
  return `<section class="card" aria-labelledby="action-title">
<h2 class="step-title" id="action-title">Doctor で診断</h2>
${
  view.activity
    ? activityHtml(view)
    : `<p class="lead">Doctor で、どこに問題があるかを調べます。</p>
${outcomeHtml(view)}
<div class="actions"><button type="button" id="doctor" data-send="doctor">Doctor で診断</button></div>`
}
${toolResultsHtml(view)}
${doctorHtml(view)}
</section>`;
}

function okCard(view: UpdateView): string {
  const doctor = view.workflows.tools.length > 0;
  return `<section class="card" aria-label="操作">
<div class="actions"><button type="button" id="open-dashboard" data-send="open-dashboard">AIDLC Guide を開く</button><button type="button" class="text-link" id="install" data-send="install">ツールを追加</button>${doctor ? '<button type="button" class="text-link" id="doctor" data-send="doctor">Doctor で診断</button>' : ""}<button type="button" class="text-link" id="extension-update" data-send="extension-update">拡張機能の更新を確認</button></div>
${activityHtml(view)}
${view.activity ? "" : outcomeHtml(view)}
${toolResultsHtml(view)}
${doctorHtml(view)}
</section>`;
}

function actionHtml(phase: UpdatePhase, view: UpdateView): string {
  const steps = (items: string) => `<ol class="steps" aria-label="更新の手順">${items}</ol>`;
  switch (phase.name) {
    case "update":
      return steps(updateSteps(phase, view));
    case "commit":
      return steps(commitSteps(phase, view));
    case "install":
      return steps(installSteps(phase, view));
    case "pin":
      return steps(pinSteps(view));
    case "newer":
      return newerCard(view);
    case "unknown":
      return unknownCard(phase, view);
    case "setup":
      return `<section class="card" aria-labelledby="action-title">
<h2 class="step-title" id="action-title">セットアップ</h2>
<p class="lead">使うツールを選んで、このプロジェクトに AI-DLC を設定します。</p>
<div class="actions"><button type="button" id="setup" data-send="setup">セットアップを開く</button></div>
</section>`;
    case "blocked":
      return `<section class="card" aria-labelledby="action-title">
<h2 class="step-title" id="action-title">公式の手順で確認</h2>
<p class="lead">公式の手順で、バージョンと設定を確認してください。</p>
<div class="actions"><button type="button" id="open-docs" data-send="docs">公式の手順を見る</button></div>
</section>`;
    case "ok":
      return okCard(view);
  }
}

/** Tool versions, the pin and the run log: the facts behind the status, folded away. */
function detailsHtml(phase: UpdatePhase, view: UpdateView): string {
  const { workflows, cli } = view;
  const updating = phase.name === "update";
  const table =
    workflows.tools.length === 0
      ? '<p class="muted">設定済みのツールはありません。</p>'
      : `<table><caption class="sr-only">設定済みのツール</caption><thead><tr><th scope="col">ツール</th><th scope="col">現在</th>${updating ? '<th scope="col">更新後</th>' : ""}</tr></thead><tbody id="tools">${workflows.tools
          .map(
            (tool) =>
              `<tr><th scope="row">${esc(tool.label)}</th><td>${esc(tool.version ?? "確認が必要")}</td>${updating ? `<td>${esc(workflows.target)}</td>` : ""}</tr>`,
          )
          .join("")}</tbody></table>`;
  return `<details class="more-info" id="more-info"><summary><span>詳しく見る</span><span class="muted small">ツールごとのバージョン・実行ログ</span></summary>
<div class="more-body">
${table}
<dl class="facts"><dt>固定バージョン（.aidlc-version）</dt><dd id="project-pin">${esc(workflows.projectPin ?? "なし")}</dd><dt>この PC の既定</dt><dd>${esc(cli.machineVersion ?? "未導入")}</dd></dl>
<h3>実行ログ</h3>
<pre id="log"></pre>
</div>
</details>`;
}

const UPDATE_STYLES = `
  .status { border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); box-shadow: var(--m-shadow); overflow: hidden; }
  .status-head { display: flex; align-items: flex-start; gap: 14px; padding: 16px 20px; background: var(--tone-bg); }
  .status-head svg { flex: 0 0 auto; width: 22px; height: 22px; margin-top: 2px; fill: none; stroke: var(--tone); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .status-title { color: var(--m-bright); font-size: 17px; font-weight: 700; }
  .tone-warning { --tone: var(--m-warning); --tone-bg: var(--m-warning-light); }
  .tone-success { --tone: var(--m-success); --tone-bg: var(--m-success-light); }
  .tone-error { --tone: var(--m-error); --tone-bg: var(--m-error-light); }
  .tone-info { --tone: var(--m-primary-light-color); --tone-bg: var(--m-primary-light); }
  .versions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); margin: 0; border-top: 1px solid var(--m-border); }
  .versions > div { display: flex; flex-direction: column; gap: 2px; padding: 10px 20px; box-shadow: -1px 0 0 var(--m-border), 0 -1px 0 var(--m-border); }
  .versions dt { color: var(--m-dimmed); font-size: 12px; font-weight: 600; }
  .versions dd { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  .ver { color: var(--m-bright); font-family: var(--vscode-editor-font-family, monospace); font-size: 16px; font-weight: 700; }
  .badge { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 1000px; background: var(--tone-bg); color: var(--tone); font-size: 11px; font-weight: 700; line-height: 1; white-space: nowrap; }
  .card { display: flex; flex-direction: column; gap: 12px; padding: 20px; border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); box-shadow: var(--m-shadow); }
  .small { font-size: 12px; }
  code { padding: 1px 6px; border-radius: 4px; background: var(--m-code); color: var(--m-bright); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; overflow-wrap: anywhere; }
  button.secondary { background: transparent; color: var(--m-text); border-color: var(--m-input-border); }
  button.secondary:hover { background: var(--m-hover); }
  .files { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 8px 0; list-style: none; border: 1px solid var(--m-border); border-radius: 8px; }
  .files li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 2px 14px; }
  .commit { display: flex; flex-direction: column; gap: 4px; }
  .commit pre { margin: 0; color: var(--m-bright); }
  .problem-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
  .fix-group { display: flex; flex-direction: column; border: 1px solid var(--m-border); border-radius: 8px; overflow: hidden; overflow-wrap: anywhere; }
  .fix-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 10px 14px; background: var(--tone-bg); }
  .fix-head strong { color: var(--m-bright); }
  .fix-item { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-top: 1px solid var(--m-border); min-width: 0; }
  .fix-item .plan { color: var(--m-bright); }
  .plan-action { font-weight: 600; }
  .item-note { padding: 6px 10px; border-radius: 4px; background: var(--m-warning-light); color: var(--m-text); }
  .opts { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; border: 0; min-width: 0; }
  .opts label { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
  .opts input { margin-top: 6px; accent-color: var(--m-primary); }
  .rec { margin-left: 8px; color: var(--m-success); font-size: 12px; font-weight: 700; }
  .ai-note { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-left: 3px solid var(--m-primary-light-color); border-radius: 0 6px 6px 0; background: var(--m-primary-light); }
  details.raw > summary { color: var(--m-dimmed); font-size: 12px; }
  .review { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--m-border); border-radius: 8px; min-width: 0; overflow-wrap: anywhere; }
  pre.diff { margin: 0; padding: 8px 0; max-height: 360px; white-space: pre; overflow: auto; font-family: var(--vscode-editor-font-family, monospace); }
  pre.diff > span { display: block; padding: 0 12px 0 0; min-width: max-content; }
  pre.diff .del { background: var(--m-error-light); color: var(--m-error); }
  pre.diff .add { background: var(--m-success-light); color: var(--m-success); }
  pre.diff .gap { padding-left: 12px; color: var(--m-dimmed); }
  pre.diff .ln { display: inline-block; width: 3.5em; padding-right: 6px; text-align: right; color: var(--m-dimmed); user-select: none; }
  pre.diff .sign { display: inline-block; width: 1.5em; user-select: none; }
  .checks { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
  .checks li { display: flex; gap: 6px; }
  .checks li.ok > span:first-child { color: var(--m-success); font-weight: 700; }
  .checks li.warn { color: var(--m-warning); }
  .checks li.warn > span:first-child { font-weight: 700; }
  .doctor { display: flex; flex-direction: column; gap: 8px; }
  .doctor-group { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--m-border); border-radius: 8px; overflow-wrap: anywhere; }
  .doctor-group ul { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .field { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; }
  select { box-sizing: border-box; min-width: 0; max-width: 100%; min-height: 36px; padding: 0 10px; border: 1px solid var(--m-input-border); border-radius: 4px; background: var(--m-card); color: var(--m-text); font: inherit; }
  .note { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; border-radius: 8px; background: var(--m-warning-light); }
  .outcome { white-space: pre-wrap; overflow-wrap: anywhere; }
  .outcome.error { padding: 12px 16px; border-radius: 8px; background: var(--m-error-light); color: var(--m-error); }
  #tool-results { margin: 0; padding: 0; list-style: none; overflow-wrap: anywhere; }
  #tool-results:empty, #progress:empty { display: none; }
  .alt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding-top: 12px; border-top: 1px solid var(--m-border); }
  .more-body { display: flex; flex-direction: column; gap: 12px; padding-top: 8px; }
  .more-info { border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); }
  .more-info > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; padding: 12px 16px; color: var(--m-bright); font-weight: 600; cursor: pointer; list-style: none; }
  .more-info > summary::-webkit-details-marker { display: none; }
  .more-info > summary::after { content: "▾"; margin-left: auto; color: var(--m-dimmed); }
  .more-info[open] > summary::after { content: "▴"; }
  .status-head:focus { outline: none; }
  .status-head:focus-visible { outline: 2px solid var(--m-focus); outline-offset: -2px; }
  .more-info > .more-body { padding: 0 16px 16px; }
  .more-info pre { margin: 0; }
  h3 { margin: 0; color: var(--m-bright); font-size: 14px; }
  table { width: 100%; border: 1px solid var(--m-border); border-radius: 8px; border-collapse: separate; border-spacing: 0; overflow: hidden; }
  th, td { padding: 8px 14px; border-bottom: 1px solid var(--m-border); text-align: left; }
  thead th { color: var(--m-bright); font-weight: 700; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  tbody th { font-weight: 600; }
  tbody td { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; }
  .facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 16px; margin: 0; }
  .facts dt { color: var(--m-dimmed); }
  .facts dd { margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 540px) { .status-head, .versions > div { padding-left: 14px; padding-right: 14px; } .card { padding: 16px; } .field { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
`;

/** Render the nonce-protected update page for one state; the host redraws it as the state moves. */
export function workflowsUpdateHtml(view: UpdateView, nonce: string): string {
  const phase = updatePhase(view.gate, view.workflows, view.cli, view.change?.kind ?? null);
  const status = statusCopy(phase, view);
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>AI-DLC の更新</title>
<style nonce="${nonce}">
${webviewThemeStyles}
${webviewPageStyles}
${UPDATE_STYLES}
</style></head><body><main aria-busy="${view.activity ? "true" : "false"}" data-phase="${phase.name}">
<header>
<div class="eyebrow">AIDLC GUIDE / UPDATE</div>
<h1>AI-DLC の更新</h1>
<p class="folder muted">対象プロジェクト：<code>${esc(view.workflows.root)}</code></p>
</header>
<section class="status tone-${status.tone}" aria-label="現在の状態">
<div class="status-head" role="status" id="status" tabindex="-1"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[status.tone]}</svg><div><p class="status-title">${esc(status.title)}</p><p>${esc(status.sub)}</p></div></div>
${versionsHtml(phase, view)}
</section>
${actionHtml(phase, view)}
${detailsHtml(phase, view)}
<footer><button type="button" class="text-link" id="refresh" data-send="refresh">状態を再確認</button><a class="text-link" id="docs" data-send="docs" href="${esc(INSTALL_GUIDE_URL)}">公式の手順</a><span class="muted">AIDLC Guide ${esc(view.extensionVersion ?? "不明")}</span></footer>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const main = document.querySelector('main');
const log = document.getElementById('log');
const progress = document.getElementById('progress');
const toolSelect = document.getElementById('repair-tool');
// What still works while an action runs: stopping it, links and copies.
const idle = ['docs', 'cancel-repair', 'copy-commit', 'copy-rollback', 'copy-diagnosis', 'open-scm', 'problem-file'];
// What starts an action; the host redraws the page when it ends.
const runs = ['apply', 'update-cli', 'pin-project', 'use-target', 'doctor', 'diagnose', 'repair', 'refresh', 'approve', 'discard-review', 'explain', 'doctor-fix'];
function lock() {
  main.setAttribute('aria-busy', 'true');
  document.querySelectorAll('[data-send], #repair-tool, input[name^="choice-"]').forEach(control => {
    if (idle.includes(control.dataset.send) || !('disabled' in control) || control.dataset.locked) return;
    control.dataset.locked = String(control.disabled);
    control.disabled = true;
  });
}
// The host ended an action without redrawing the page: give back what lock() took.
function unlock() {
  main.setAttribute('aria-busy', 'false');
  document.querySelectorAll('[data-locked]').forEach(control => {
    control.disabled = control.dataset.locked === 'true';
    delete control.dataset.locked;
  });
}
if (main.getAttribute('aria-busy') === 'true') lock();
const saved = typeof vscode.getState === 'function' ? vscode.getState() : null;
if (toolSelect && saved && [...toolSelect.options].some(option => option.value === saved.tool && !option.disabled)) toolSelect.value = saved.tool;
if (toolSelect) toolSelect.addEventListener('change', () => {
  if (typeof vscode.setState === 'function') vscode.setState({ tool: toolSelect.value });
});
document.querySelectorAll('[data-send]').forEach(control => control.addEventListener('click', event => {
  if (control instanceof HTMLAnchorElement) event.preventDefault();
  const type = control.dataset.send;
  const message = { type };
  if (control.dataset.index !== undefined) message.index = Number(control.dataset.index);
  if (control.dataset.path !== undefined) message.path = control.dataset.path;
  if (control.dataset.harness !== undefined) message.harness = control.dataset.harness;
  if (type === 'repair' || type === 'explain') message.tool = toolSelect ? toolSelect.value : control.dataset.tool || '';
  if (runs.includes(type)) lock();
  vscode.postMessage(message);
}));
// A pick is remembered by the host; the page is not drawn again for it.
document.querySelectorAll('input[name^="choice-"]').forEach(input => input.addEventListener('change', () => {
  if (input.checked) vscode.postMessage({ type: 'choose', path: input.dataset.path, action: input.value });
}));
window.addEventListener('message', ({ data: msg }) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'restore' && log) log.textContent = typeof msg.log === 'string' ? msg.log : '';
  if (msg.type === 'log') {
    if (log) log.textContent = (log.textContent + msg.line + '\\n').slice(-60000);
    const lines = String(msg.line).split('\\n').map(line => line.trim()).filter(Boolean);
    if (progress && lines.length) progress.textContent = lines[lines.length - 1];
  }
  if (msg.type === 'results') {
    const list = document.getElementById('tool-results');
    if (list) list.replaceChildren(...msg.results.map(result => {
      const item = document.createElement('li');
      item.textContent = result.label + '：' + result.message;
      return item;
    }));
  }
  if (msg.type === 'unlock') unlock();
  if (msg.type === 'focus') {
    const target = document.getElementById(msg.id);
    if (target) { target.scrollIntoView({ block: 'center' }); target.focus(); }
  }
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
