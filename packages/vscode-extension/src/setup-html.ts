import { findHarnessConflict, HARNESS_CONFLICTS } from "./harness-conflicts.ts";
import { HARNESS_LABELS, type HarnessId } from "./harness-detect.ts";
import { INSTALL_GUIDE_URL, SETUP_RELEASE } from "./native-setup.ts";
import { type SetupBlock, setupPhase } from "./setup-phase.ts";
import type { SetupSnapshot } from "./setup-state.ts";
import { webviewThemeStyles } from "./webview-theme.ts";

export function escapeSetupText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type SetupHtmlOptions = {
  selected: HarnessId[];
  trusted: boolean;
  nonce: string;
  extensionVersion?: string;
  /** Tools were first configured from this panel, so a partial install stays a retry. */
  creatingProject?: boolean;
  /** The "add tools" selection is open in the last step. */
  adding?: boolean;
};

type BlockedCopy = {
  headline: string;
  detail: string;
  original?: string;
  action: "update" | "recheck";
};

const esc = escapeSetupText;
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17v.01"/></svg>';
const UPDATE_HINT = "更新・修復画面で確認と修復ができます。";

const toolList = (ids: readonly HarnessId[]): string =>
  ids.map((id) => HARNESS_LABELS[id]).join("・");

/** One headline and one next action for a state this screen cannot resolve. */
export function setupBlockedCopy(state: SetupSnapshot, block: SetupBlock): BlockedCopy {
  const target = state.cli?.target ?? SETUP_RELEASE;
  if (block.kind === "cli") {
    const original = state.cli?.message;
    const requested = state.cli?.projectPin ?? state.cli?.projectVersion ?? state.version ?? target;
    const machine = state.cli?.machineVersion ?? "不明";
    const copy = (headline: string, detail: string): BlockedCopy => ({
      headline,
      detail,
      action: "update",
      ...(original ? { original } : {}),
    });
    switch (block.reason) {
      case "pin-unreadable":
        return copy(
          "固定バージョンのファイル（.aidlc-version）を読めません。",
          "ファイルの内容と権限を確認するか、更新・修復画面で直してください。",
        );
      case "version-unknown":
        return copy(
          "リポジトリ内のエンジンのバージョンを確認できません。",
          "更新・修復画面で、ツールごとの設定を確認できます。",
        );
      case "version-mismatch":
        return copy(
          "リポジトリ内のバージョンがそろっていません。",
          `更新・修復画面で、すべてのツールと固定バージョンを ${target} にそろえられます。`,
        );
      case "needs-other-cli":
        return copy(
          `このプロジェクトの CLI ${requested} は、この拡張からは入れられません。`,
          `拡張が入れられるのは ${target} です。拡張を更新するか、公式の手順で CLI ${requested} を入れてください。`,
        );
      case "engine-newer":
        return copy(
          `このマシンの既定の CLI ${machine} が、このプロジェクトより新しくなっています。`,
          `更新・修復画面で、このプロジェクトを ${target} に固定するか、既定の CLI を ${target} に戻せます。`,
        );
      case "default-newer":
        return copy(
          `このマシンの既定の CLI ${machine} が、このプロジェクトより新しくなっています。`,
          "更新・修復画面で、プロジェクトの固定バージョンを確認してください。",
        );
      default:
        return copy("このマシンの CLI を、この画面からは準備できません。", UPDATE_HINT);
    }
  }
  if (block.kind === "runtime") {
    const original = state.runtimeIssue;
    const extra = original ? { original } : {};
    if (block.issue === "git")
      return {
        headline: "Codex を使うには、このフォルダが Git リポジトリである必要があります。",
        detail: "ターミナルで git init を実行してから、もう一度確認してください。",
        action: "recheck",
        ...extra,
      };
    if (block.issue === "trust")
      return {
        headline: "ワークスペースを信頼してから、Codex の設定を確認してください。",
        detail: "信頼したあと、もう一度確認してください。",
        action: "recheck",
        ...extra,
      };
    if (block.issue === "mixed-versions")
      return {
        headline: "ツールごとの設定のバージョンがそろっていません。",
        detail: `更新・修復画面で、すべてのツールを ${target} にそろえられます。`,
        action: "update",
        ...extra,
      };
    return {
      headline: "このプロジェクトのバージョンに合う CLI を、このマシンで使えません。",
      detail: "更新・修復画面で、CLI とプロジェクトのバージョンを確認してください。",
      action: "update",
      ...extra,
    };
  }
  if (block.kind === "workflows")
    return {
      headline:
        state.workflows?.message ?? "このフォルダには、そのままでは設定できない状態があります。",
      detail: UPDATE_HINT,
      action: "update",
    };
  return {
    headline: "AI-DLC の設定の一部（aidlc/ フォルダなど）が見つかりません。",
    detail: UPDATE_HINT,
    action: "update",
  };
}

function toolOptions(
  selected: readonly HarnessId[],
  installed: readonly HarnessId[],
  trusted: boolean,
): string {
  return Object.entries(HARNESS_LABELS)
    .map(([value, label]) => {
      const id = value as HarnessId;
      const done = installed.includes(id);
      return `<label class="harness-option"><input type="checkbox" name="harness" value="${id}"${selected.includes(id) ? " checked" : ""}${!trusted || done ? " disabled" : ""}><span>${label}</span>${done ? '<span class="badge">設定済み</span>' : ""}</label>`;
    })
    .join("");
}

export function setupHtml(state: SetupSnapshot, options: SetupHtmlOptions): string {
  const { trusted, nonce } = options;
  const extensionVersion = options.extensionVersion ?? "不明";
  const installed = state.harnesses;
  const selected = [...new Set([...options.selected, ...installed])];
  const phase = setupPhase(state, trusted, selected, options.creatingProject === true);
  const cli = state.cli;
  const cliReady = cli?.setupReady ?? state.native !== null;
  const target = cli?.target ?? SETUP_RELEASE;
  const canInstall =
    state.workflows?.canInstall ?? (!state.version || state.version === SETUP_RELEASE);
  const adding = phase.name === "ready" && options.adding === true;
  const completed = state.preference?.completed === true;
  const pending = selected.filter((id) => !installed.includes(id));
  const collision = findHarnessConflict(selected);
  const installDisabled =
    !trusted || !cliReady || !canInstall || pending.length === 0 || collision !== undefined;
  const docsLink = `<a class="text-link" data-send="docs" href="${esc(INSTALL_GUIDE_URL)}">公式の手順を見る</a>`;
  const feedback = `<p id="status" role="status" aria-live="polite"></p>
<details id="log-details" hidden><summary>ログを見る</summary><pre id="log"></pre></details>`;

  const blockedBody = (block: SetupBlock): string => {
    const copy = setupBlockedCopy(state, block);
    return `<p class="lead">${esc(copy.headline)}</p>
<p class="muted">${esc(copy.detail)}</p>
<div class="actions">${
      copy.action === "recheck"
        ? '<button type="button" id="recheck" data-send="recheck">もう一度確認</button>'
        : `<button type="button" id="open-update" data-send="open-workflows-update">更新・修復画面を開く</button>${docsLink}`
    }</div>
${copy.original ? `<details class="more"><summary>詳しく見る</summary><p class="original">${esc(copy.original)}</p></details>` : ""}
${feedback}`;
  };

  const step = (
    index: number,
    title: string,
    status: "done" | "current" | "blocked" | "todo",
    body = "",
    summary = "",
  ): string => {
    if (status === "done")
      return `<li class="step done"><details><summary class="row"><span class="ic done">${CHECK_ICON}</span><span class="step-title">${title}</span><span class="sum">${esc(summary)}</span><span class="sr-only">（完了）</span></summary><div class="body">${body}</div></details></li>`;
    if (status === "todo")
      return `<li class="step todo"><div class="row"><span class="ic todo" aria-hidden="true">${index}</span><span class="step-title">${title}</span></div></li>`;
    return `<li class="step ${status}" aria-current="step"><div class="row"><span class="ic ${status === "blocked" ? "stop" : "now"}" aria-hidden="true">${status === "blocked" ? STOP_ICON : index}</span><h2 class="step-title">${title}</h2></div><div class="body">${body}</div></li>`;
  };

  // Step 1: this machine's CLI.
  const pin = cli?.projectPin ?? cli?.projectVersion ?? state.version;
  const current = cli?.effectiveVersion ?? state.native?.version ?? null;
  const confirmUpdate = cli?.confirmUpdate === true;
  const cliFacts = `<dl class="facts">
<dt>入れるバージョン</dt><dd>${esc(target)}</dd>
<dt>このフォルダで使う CLI</dt><dd>${esc(current ?? "未検出")}</dd>
<dt>固定バージョン</dt><dd>${esc(pin ?? `まだない（プロジェクトの設定で ${target} に固定）`)}</dd>
</dl>`;
  let cliStep: string;
  if (phase.name === "trust") cliStep = step(1, "このマシンの CLI", "todo");
  else if (phase.name === "cli") {
    const lead =
      confirmUpdate && pin
        ? `固定バージョン ${pin} のまま、CLI ${target} を入れます。`
        : installed.length > 0 && pin
          ? `このプロジェクトが使う CLI ${pin} を、このマシンに入れます。`
          : `このマシンに AI-DLC の CLI ${target} を入れます。`;
    cliStep = step(
      1,
      "このマシンの CLI",
      "current",
      `<p class="lead">${esc(lead)}</p>
<p class="muted">${esc(cli?.message ?? "CLI の導入に Bun / Node.js は不要です。")}</p>
<div class="actions"><button type="button" id="prepare-cli" data-send="prepare-cli">${confirmUpdate ? "CLI を更新" : "CLI をインストール"}</button></div>
<details class="more"><summary>詳しく見る</summary>${cliFacts}<p class="muted">CLI の導入に Bun / Node.js は不要です。共有するツール設定やワークフローの成果物は更新しません。</p></details>
${feedback}`,
    );
  } else if (phase.name === "blocked" && phase.step === "cli")
    cliStep = step(1, "このマシンの CLI", "blocked", blockedBody(phase.block));
  else
    cliStep = step(
      1,
      "このマシンの CLI",
      "done",
      `${cliFacts}<p class="muted">このエディターでは、新しく開くターミナルに CLI の配置先を通します。既存のターミナルは開き直してください。外部のターミナルでは、公式手順に沿って PATH を設定してください。Windows の Git Bash では <code>aidlc</code> ではなく <code>aidlc.cmd --version</code> を実行してください。コマンド プロンプトと PowerShell では <code>aidlc --version</code> で確認できます。</p>
<button type="button" class="text-link" id="cli-terminal" data-send="cli-terminal">新しいターミナルで CLI を確認</button>`,
      `CLI ${current ?? target}`,
    );

  // Step 2: the project's tools.
  const resultsList =
    '<ul id="install-results" aria-label="ツールごとの結果" aria-live="polite"></ul>';
  let projectStep: string;
  if (phase.name === "project" && phase.retry.length > 0) {
    const failed = toolList(phase.retry);
    projectStep = step(
      2,
      "プロジェクトの設定",
      "blocked",
      `<p class="lead">${esc(failed)} を設定できませんでした。</p>
${resultsList}
<div class="actions"><button type="button" id="install" data-send="install">${esc(failed)} を再試行</button><button type="button" class="text-link" id="skip-failed" data-send="skip-failed">${esc(failed)} を外して進む</button></div>
${feedback}`,
    );
  } else if (phase.name === "project")
    projectStep = step(
      2,
      "プロジェクトの設定",
      "current",
      `<p class="lead">AI-DLC を使うツールを選んでください。</p>
<p class="muted">選んだツール用の設定と aidlc/ フォルダをリポジトリに作ります。設定後は Git の変更内容を確認してください。</p>
<fieldset class="when-idle" aria-describedby="selection-note"><legend class="sr-only">AI-DLC を使うツール</legend>
<div class="harnesses">${toolOptions(selected, installed, trusted)}</div></fieldset>
<p id="selection-note" class="when-idle" role="status" aria-live="polite"></p>
<div class="actions when-idle"><button type="button" id="install" data-send="install"${installDisabled ? " disabled" : ""}>プロジェクトを設定</button></div>
${resultsList}
${feedback}`,
    );
  else if (phase.name === "blocked" && phase.step === "project")
    projectStep = step(2, "プロジェクトの設定", "blocked", blockedBody(phase.block));
  else if (installed.length > 0 && phase.name !== "trust")
    projectStep = step(
      2,
      "プロジェクトの設定",
      "done",
      `<p>リポジトリにある設定を使います：${esc(installed.map((id) => HARNESS_LABELS[id]).join("、"))}</p>
<p class="muted">AI-DLC の設定：${esc(state.version ?? "不明")}</p>`,
      toolList(installed),
    );
  else projectStep = step(2, "プロジェクトの設定", "todo");

  // Step 3: finish, add tools, optional diagnosis.
  let finishStep: string;
  if (phase.name === "ready") {
    const addPanel = canInstall
      ? `<fieldset class="add-tools" aria-describedby="selection-note"><legend>追加するツール</legend>
<div class="harnesses when-idle">${toolOptions(selected, installed, trusted)}</div>
<p class="muted when-idle">設定済みのツールはそのまま残ります。追加したあとは Git の変更内容を確認してください。</p>
<p id="selection-note" class="when-idle" role="status" aria-live="polite"></p>
<div class="actions when-idle"><button type="button" id="install" data-send="install"${installDisabled ? " disabled" : ""}>選んだツールを追加</button><button type="button" class="text-link" id="cancel-add" data-send="cancel-add">キャンセル</button></div>
${resultsList}
</fieldset>`
      : `<div class="add-tools"><p class="lead">${esc(state.workflows?.message ?? "いまの設定にはツールを追加できません。")}</p>
<div class="actions"><button type="button" id="open-update" data-send="open-workflows-update">更新・修復画面を開く</button><button type="button" class="text-link" id="cancel-add" data-send="cancel-add">キャンセル</button></div></div>`;
    finishStep = step(
      3,
      "完了",
      "current",
      `<p class="lead">${completed ? "セットアップは完了しています。" : "準備ができました。"}</p>
${adding ? "" : `<p class="muted">${completed ? "ダッシュボードから作業を続けられます。" : "完了するとダッシュボードが開きます。このフォルダでは、次から自動で開きません。"}</p>`}
${
  adding
    ? addPanel
    : `<div class="actions"><button type="button" id="finish" data-send="finish"${trusted ? "" : " disabled"}>${completed ? "ダッシュボードを開く" : "セットアップを完了"}</button><button type="button" class="text-link" id="add-tools" data-send="add-tools">ツールを追加</button><button type="button" class="text-link" id="run-doctor" data-send="run-doctor">診断を実行（任意）</button></div>
<section class="doctor" id="doctor" aria-label="診断" aria-busy="false"><div id="doctor-result" role="status" aria-live="polite"></div></section>`
}
${feedback}`,
    );
  } else finishStep = step(3, "完了", "todo");

  const trustNotice =
    phase.name === "trust"
      ? `<section class="notice" aria-labelledby="trust-title">
<p class="lead" id="trust-title">このフォルダを信頼すると、設定を始められます。</p>
<p class="muted">制限モードでは、CLI の導入とファイルの作成ができません。</p>
<div class="actions"><button type="button" id="trust" data-send="trust">ワークスペースを信頼</button></div>
${feedback}
</section>`
      : "";

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>AI-DLC のセットアップ</title>
<style nonce="${nonce}">
${webviewThemeStyles}
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--m-text); background: var(--m-body); font-family: var(--vscode-font-family, system-ui); font-size: 14px; line-height: 1.7; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 28px 36px; display: flex; flex-direction: column; gap: 22px; }
  .eyebrow { color: var(--m-dimmed); font-size: 12px; font-weight: 700; letter-spacing: .08em; }
  h1 { margin: 4px 0 0; color: var(--m-bright); font-size: clamp(24px, 4vw, 30px); font-weight: 700; line-height: 1.35; }
  p { margin: 0; }
  .muted { color: var(--m-dimmed); }
  .folder { margin-top: 4px; overflow-wrap: anywhere; color: var(--m-dimmed); }
  .folder code { padding: 1px 6px; border-radius: 4px; background: var(--m-code); color: var(--m-text); }
  .folder code, .original { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .notice { display: flex; flex-direction: column; gap: 10px; padding: 16px 20px; border-radius: 8px; background: var(--m-warning-light); }
  .notice .lead { color: var(--m-warning); font-weight: 700; }
  .steps { list-style: none; margin: 0; padding: 0; border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); box-shadow: var(--m-shadow); }
  .notice + .steps { opacity: .6; }
  .step + .step { border-top: 1px solid var(--m-border); }
  .row { display: flex; align-items: center; gap: 12px; padding: 14px 18px; }
  summary.row { cursor: pointer; list-style: none; }
  summary.row:hover { background: var(--m-hover); }
  summary.row::-webkit-details-marker { display: none; }
  .ic { width: 26px; height: 26px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; font-size: 12px; font-weight: 700; }
  .ic svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .ic.now { background: var(--m-primary); color: var(--m-primary-contrast); }
  .ic.done { background: var(--m-success-light); color: var(--m-success); }
  .ic.stop { color: var(--m-error); border: 2px solid currentColor; }
  .ic.todo { color: var(--m-dimmed); border: 1px solid var(--m-input-border); }
  .step-title { margin: 0; color: var(--m-bright); font-size: 16px; font-weight: 700; }
  .step.done .step-title { font-size: 14px; }
  .step.todo .step-title { color: var(--m-dimmed); font-weight: 500; }
  .sum { margin-left: auto; color: var(--m-dimmed); font-size: 12px; text-align: right; overflow-wrap: anywhere; }
  .body { display: flex; flex-direction: column; gap: 12px; padding: 0 18px 20px 56px; min-width: 0; }
  .lead { font-size: 15px; }
  .actions { display: flex; gap: 8px 16px; align-items: center; flex-wrap: wrap; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; font: inherit; font-weight: 600; cursor: pointer; border: 1px solid transparent; border-radius: 4px; padding: 0 18px; background: var(--m-primary); color: var(--m-primary-contrast); }
  button:hover { background: var(--m-primary-hover); }
  button:disabled, input:disabled { opacity: .55; cursor: default; }
  a.text-link, button.text-link { min-height: 0; background: transparent; color: var(--m-primary-light-color); font-weight: 500; border: 0; padding: 0; border-radius: 0; text-decoration: none; }
  a.text-link:hover, button.text-link:hover { background: transparent; text-decoration: underline; }
  button.text-link:disabled { text-decoration: none; }
  button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--m-focus); outline-offset: 2px; }
  details.more > summary, #log-details > summary, .doctor-details > summary { width: max-content; max-width: 100%; color: var(--m-primary-light-color); font-weight: 500; cursor: pointer; }
  .facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 16px; margin: 10px 0; }
  .facts dt { color: var(--m-dimmed); }
  .facts dd { margin: 0; overflow-wrap: anywhere; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .add-tools { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); }
  .add-tools legend { padding: 0 6px; color: var(--m-bright); font-weight: 700; }
  .harnesses { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 8px; }
  .harness-option { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border: 1px solid var(--m-input-border); border-radius: 4px; background: var(--m-card); cursor: pointer; }
  .harness-option:hover { background: var(--m-hover); }
  .harness-option:has(:checked) { border-color: var(--m-primary); background: var(--m-primary-light); color: var(--m-bright); font-weight: 600; }
  .harness-option input { width: 18px; height: 18px; margin: 0; accent-color: var(--m-primary); }
  .badge { margin-left: auto; color: var(--m-dimmed); font-size: 12px; }
  #selection-note { color: var(--m-dimmed); font-size: 12px; }
  #selection-note.error { color: var(--m-error); }
  #selection-note:empty, #status:empty, #install-results:empty, #doctor-result:empty { display: none; }
  main[aria-busy="true"] .when-idle { display: none; }
  #install-results { margin: 0; padding: 0; list-style: none; border: 1px solid var(--m-border); border-radius: 8px; }
  #install-results li { padding: 9px 12px; }
  #install-results li + li { border-top: 1px solid var(--m-border); }
  #install-results p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--m-dimmed); }
  .result-ok { color: var(--m-success); }
  .result-fail { color: var(--m-error); }
  #status { white-space: pre-wrap; overflow-wrap: anywhere; }
  #status.error { padding: 12px 16px; border-radius: 8px; background: var(--m-error-light); color: var(--m-error); }
  pre { max-height: 300px; overflow: auto; margin: 8px 0 0; padding: 14px; border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--m-code); font-size: 12px; }
  footer { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--m-dimmed); }
  .doctor { overflow-wrap: anywhere; }
  .doctor h3, .doctor h4 { margin: 16px 0 6px; color: var(--m-bright); font-size: 14px; }
  .doctor-tool + .doctor-tool { margin-top: 16px; padding-top: 8px; border-top: 1px solid var(--m-border); }
  .doctor-summary { font-weight: 700; white-space: pre-wrap; }
  .doctor-meta { font-size: 12px; color: var(--m-dimmed); }
  .doctor-counts, .doctor-checks { list-style: none; margin: 10px 0; padding: 0; }
  .doctor-counts { display: flex; flex-wrap: wrap; gap: 8px 20px; }
  .doctor-check { padding: 10px 0; border-top: 1px solid var(--m-border); }
  .doctor-check-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; }
  .doctor-label { flex: 1; min-width: min(180px, 100%); white-space: pre-wrap; }
  .doctor-state { font-weight: 700; }
  .doctor-ok { color: var(--m-success); }
  .doctor-warn { color: var(--m-warning); }
  .doctor-fail { color: var(--m-error); }
  .doctor-fix, .doctor-original { margin: 6px 0 0; white-space: pre-wrap; }
  .doctor-original { color: var(--m-dimmed); }
  .note { padding: 12px 16px; border-radius: 8px; background: var(--m-warning-light); }
  @media (max-width: 540px) { main { padding: 24px 16px; } .row { padding: 12px 14px; } .body { padding: 0 14px 18px; } .actions button:not(.text-link) { width: 100%; } }
</style></head><body><main aria-busy="false">
<header>
<div class="eyebrow">AIDLC GUIDE / SETUP</div>
<h1>AI-DLC のセットアップ</h1>
<p class="folder muted">設定するフォルダ：<code>${esc(state.root)}</code></p>
</header>
${trustNotice}
<ol class="steps" aria-label="セットアップの手順">
${cliStep}
${projectStep}
${finishStep}
</ol>
<footer><button type="button" class="text-link" id="update-workflows" data-send="open-workflows-update">更新・修復画面を開く</button><a class="text-link" id="docs" data-send="docs" href="${esc(INSTALL_GUIDE_URL)}">公式の手順</a><span class="muted">AIDLC Guide ${esc(extensionVersion)}</span></footer>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const harnesses = [...document.querySelectorAll('input[name="harness"]')];
const installed = ${JSON.stringify(installed)};
const initialSelection = ${JSON.stringify(selected)};
const harnessConflicts = ${JSON.stringify(HARNESS_CONFLICTS)};
const trusted = ${trusted};
const canInstall = ${canInstall};
const cliReady = ${cliReady};
const labels = ${JSON.stringify(HARNESS_LABELS)};
const status = document.getElementById('status');
const log = document.getElementById('log');
const logDetails = document.getElementById('log-details');
const doctor = document.getElementById('doctor');
const doctorResult = document.getElementById('doctor-result');
const doctorButton = document.getElementById('run-doctor');
let busy = false;
let doctorReport = null;
let doctorReports = [];
let installResults = [];
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (typeof text === 'string') node.textContent = text;
  if (className) node.className = className;
  return node;
}
function setLog(text) {
  if (!log) return;
  log.textContent = text;
  if (logDetails) logDetails.hidden = !text;
}
function setStatus(text, error) {
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('error', error === true);
}
const saved = vscode.getState();
if (saved && typeof saved.log === 'string') setLog(saved.log);
if (saved && typeof saved.status === 'string') setStatus(saved.status);
function renderDoctor(report) {
  doctorReport = report && Array.isArray(report.checks) ? report : null;
  doctorReports = [];
  if (doctor) doctor.setAttribute('aria-busy', 'false');
  if (doctorButton) doctorButton.textContent = doctorReport ? '診断を再実行' : '診断を実行（任意）';
  if (!doctorResult) return;
  doctorResult.replaceChildren();
  if (doctorReport) appendDoctorReport(doctorReport, doctorResult);
}
function renderDoctorReports(reports) {
  renderDoctor(null);
  doctorReports = Array.isArray(reports) ? reports.filter(entry => entry && Object.hasOwn(labels, entry.id) && entry.report && Array.isArray(entry.report.checks)) : [];
  if (!doctorReports.length) return;
  if (doctorButton) doctorButton.textContent = '診断を再実行';
  if (!doctorResult) return;
  doctorReports.forEach(({ id, report }) => {
    const section = element('section', '', 'doctor-tool');
    const heading = element('h3', labels[id], 'doctor-tool-heading');
    heading.id = 'doctor-tool-' + id;
    section.setAttribute('aria-labelledby', heading.id);
    section.append(heading);
    appendDoctorReport(report, section, 'doctor-original-' + id, 'h4');
    doctorResult.append(section);
  });
}
function appendDoctorReport(report, target, originalId = 'doctor-original', headingTag = 'h3') {
  const summaryClass = { ok: 'doctor-ok', warning: 'doctor-warn', failed: 'doctor-fail', unavailable: 'doctor-fail' }[report.outcome] || '';
  target.append(element('p', report.summary, 'doctor-summary ' + summaryClass));
  const details = element('details', '', 'doctor-details');
  details.append(element('summary', '詳しく見る'));
  const meta = element('p', '', 'doctor-meta');
  meta.append(element('span', '本体バージョン：' + (report.version || '未取得')));
  meta.append(element('br'));
  const date = new Date(report.executedAt);
  const time = element('time', Number.isNaN(date.getTime()) ? report.executedAt : date.toLocaleString('ja-JP'));
  if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
  meta.append(element('span', '実行日時：'), time);
  details.append(meta);
  if (report.counts) {
    const counts = element('ul', '', 'doctor-counts');
    counts.setAttribute('aria-label', '診断の集計');
    counts.append(
      element('li', '正常 ' + report.counts.passed + ' 件', 'doctor-ok'),
      element('li', '要確認 ' + report.counts.warnings + ' 件', 'doctor-warn'),
      element('li', '問題あり ' + report.counts.failed + ' 件', 'doctor-fail'),
    );
    details.append(counts);
  }
  const sections = { machine: '実行環境', project: 'プロジェクト', framework: 'AI-DLC 本体', other: 'その他' };
  const states = { ok: '正常', warn: '要確認', fail: '問題あり' };
  Object.entries(sections).forEach(([section, heading]) => {
    const checks = report.checks.filter(check => (Object.hasOwn(sections, check.section) ? check.section : 'other') === section);
    if (!checks.length) return;
    details.append(element(headingTag, heading));
    const list = element('ul', '', 'doctor-checks');
    checks.forEach(check => {
      const item = element('li', '', 'doctor-check');
      const head = element('div', '', 'doctor-check-head');
      head.append(element('span', states[check.status] || '要確認', 'doctor-state doctor-' + (Object.hasOwn(states, check.status) ? check.status : 'warn')));
      head.append(element('span', check.label, 'doctor-label'));
      item.append(head);
      if (check.translated === false) item.append(element('p', '原文：' + check.originalLabel, 'doctor-original'));
      if (check.fix) item.append(element('p', '対処方法：' + check.fix, 'doctor-fix'));
      if (check.originalFix && check.fixTranslated === false) item.append(element('p', '対処方法の原文：' + check.originalFix, 'doctor-original'));
      list.append(item);
    });
    details.append(list);
  });
  if (report.parkedAttempts && report.parkedAttempts.length) {
    const parked = element('section');
    parked.append(element('h4', '保留した試行'), element('pre', report.parkedAttempts.join('\\n')));
    details.append(parked);
  }
  if (report.unparsedOutput && report.unparsedOutput.length) {
    details.append(element('p', '形式を読み取れない出力があります。以下の原文を確認してください。', 'note'));
    const unparsed = element('details');
    unparsed.append(element('summary', '未分類の出力を見る'), element('pre', report.unparsedOutput.join('\\n')));
    details.append(unparsed);
  }
  const original = element('details');
  original.id = originalId;
  original.append(element('summary', '原文を見る'), element('pre', report.rawOutput));
  details.append(original);
  target.append(details);
}
if (saved && saved.doctorReports?.length) renderDoctorReports(saved.doctorReports);
else if (saved && saved.doctorReport) renderDoctor(saved.doctorReport);
function save() { vscode.setState({ log: log ? log.textContent : '', status: status ? status.textContent : '', doctorReport, ...(doctorReports.length ? { doctorReports } : {}) }); }
function selection() { return harnesses.length ? harnesses.filter(el => el.checked).map(el => el.value) : initialSelection; }
function updateSelection() {
  if (!harnesses.length) return;
  const selected = selection();
  const pending = selected.filter(id => !installed.includes(id));
  const combined = new Set([...installed, ...selected]);
  const collision = harnessConflicts.find(({ ids }) => ids.every(id => combined.has(id)))?.message;
  const note = document.getElementById('selection-note');
  if (note) {
    note.textContent = collision || (pending.length ? pending.length + ' 個のツールを' + (installed.length ? '追加' : '設定') + 'します。' : installed.length ? '追加するツールを選んでください。' : 'ツールを1つ以上選択してください。');
    note.classList.toggle('error', !!collision);
  }
  const install = document.getElementById('install');
  if (install) install.disabled = busy || !trusted || !cliReady || !canInstall || !pending.length || !!collision;
}
function renderInstallResults(results) {
  installResults = Array.isArray(results) ? results : [];
  const list = document.getElementById('install-results');
  if (!list) return;
  list.replaceChildren();
  const states = { configured: '設定しました', skipped: '設定済み', failed: '設定できませんでした', cancelled: '中止しました' };
  installResults.forEach(result => {
    const item = element('li');
    const ok = result.status === 'configured' || result.status === 'skipped';
    item.append(element('strong', (labels[result.id] || result.id) + '：' + (states[result.status] || '要確認'), ok ? 'result-ok' : 'result-fail'));
    if (result.message) item.append(element('p', result.message));
    list.append(item);
  });
}
function send(type) { if (type === 'docs' || !busy) vscode.postMessage({ type, harnesses: selection() }); }
document.querySelectorAll('[data-send]').forEach(control => {
  control.addEventListener('click', (event) => {
    if (control instanceof HTMLAnchorElement) event.preventDefault();
    send(control.dataset.send);
  });
});
harnesses.forEach(input => input.addEventListener('change', () => {
  updateSelection();
  send('select-harnesses');
}));
updateSelection();
window.addEventListener('message', ({ data: msg }) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'restore') {
    setLog(msg.log || '');
    setStatus(msg.text || '', msg.error);
    if (msg.log && logDetails) logDetails.open = true;
    if (msg.doctorReports?.length) renderDoctorReports(msg.doctorReports);
    else renderDoctor(msg.doctorReport);
    renderInstallResults(msg.installResults);
  }
  if (msg.type === 'busy' && busy !== (msg.value === true)) {
    busy = msg.value === true;
    document.querySelectorAll('button, input').forEach(el => {
      if (busy) { el.dataset.disabled = String(el.disabled); el.disabled = true; }
      else if (el.dataset.disabled) el.disabled = el.dataset.disabled === 'true';
    });
    document.querySelector('main').setAttribute('aria-busy', String(busy));
    updateSelection();
  }
  if (msg.type === 'install-results') renderInstallResults(msg.results);
  if (msg.type === 'doctor-running') {
    renderDoctor(null);
    if (doctor) doctor.setAttribute('aria-busy', 'true');
    if (doctorButton) doctorButton.textContent = '診断中…';
    if (doctorResult) doctorResult.replaceChildren(element('p', '診断を実行しています。', 'muted'));
  }
  if (msg.type === 'doctor-report') renderDoctor(msg.report);
  if (msg.type === 'doctor-reports') renderDoctorReports(msg.reports);
  if (msg.type === 'log') {
    setLog(((log ? log.textContent : '') + msg.text + '\\n').slice(-60000));
    if (logDetails) logDetails.open = true;
  }
  if (msg.type === 'status') setStatus(msg.text, msg.error);
  save();
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
