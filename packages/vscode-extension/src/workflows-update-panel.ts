import { randomBytes } from "node:crypto";
import path from "node:path";
import { type HarnessId, inspectVersionGate } from "@aidlc-guide/reader-core";
import {
  VERSION_GATE_ACTIONS,
  type VersionGate,
  type VersionGateAction,
  versionGateActionLabel,
  versionGateRollbackGuide,
  WORKFLOWS_TARGET_VERSION,
  type WorkflowsManagementState,
} from "@aidlc-guide/shared-types";
import { commands, type ExtensionContext, env, Uri, ViewColumn, window, workspace } from "vscode";
import { configureCliEnvironment } from "./cli-environment.ts";
import {
  CLI_PIN_CONFIRM_ACTION,
  CLI_UPDATE_CONFIRM_ACTION,
  CLI_USE_TARGET_CONFIRM_ACTION,
  type CliManagementResult,
  cliPinConfirmMessage,
  cliRegistersPin,
  cliUpdateConfirmMessage,
  cliUseTargetConfirmMessage,
  inspectCliManagement,
  pinProjectCli,
  prepareProjectCli,
  updateMachineCli,
  useTargetCli,
} from "./cli-management.ts";
import { HARNESS_LABELS } from "./harness-detect.ts";
import { INSTALL_GUIDE_URL, readNativeInstall } from "./native-setup.ts";
import { escapeSetupText as esc } from "./setup-html.ts";
import {
  changedSince,
  gitStatusSnapshot,
  pinCommitMessage,
  sharedFilesFor,
  updateCommitMessage,
} from "./shared-file-changes.ts";
import type { UpdateProblem } from "./workflows-conflicts.ts";
import { diagnoseInstalledWorkflows } from "./workflows-diagnose.ts";
import { inspectWorkflowsManagement, workflowsEngineCanApply } from "./workflows-management.ts";
import type {
  NativeWorkflowsUpdateResult,
  WorkflowsToolUpdateResult,
} from "./workflows-native-update.ts";
import { workflowsRepairKey } from "./workflows-operation.ts";
import {
  type LocalPatch,
  probeRepairTools,
  REPAIR_TOOLS,
  reapplyLocalPatches,
  repairWorkflows,
} from "./workflows-repair.ts";
import { repairPath } from "./workflows-repair-files.ts";
import { repairHtml, repairScript, repairStyles } from "./workflows-repair-html.ts";
import { webviewThemeStyles } from "./webview-theme.ts";
import { updateInstalledWorkflows } from "./workflows-update.ts";
import { UPDATE_WORKFLOWS_COMMAND } from "./workflows-version.ts";

/** Where the version-check screen's action lands in this panel. */
const GATE_FOCUS: Readonly<Partial<Record<VersionGateAction, string>>> = {
  "update-project": "apply",
  "install-engine": "update-cli",
  "pin-project": "pin-project",
  doctor: "doctor",
};

const CLI_UPDATE_LABEL = "CLI を更新";
const CLI_REGISTER_LABEL = "このマシンに登録";

/** Long lists stay readable; the rest are counted. */
const SHARED_FILES_SHOWN = 30;

const isOpenFolder = (root: string): boolean =>
  workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === root) ?? false;

/** Render the nonce-protected update page; diagnostics are inserted as text by its client. */
export function workflowsUpdateHtml(
  state: WorkflowsManagementState,
  nonce: string,
  cli: ReturnType<typeof inspectCliManagement>,
  gate: VersionGate | null = null,
): string {
  const blocked = gate !== null && gate.status !== "ok";
  const register = cliRegistersPin(cli);
  const shared = sharedFilesFor(state.tools.map((tool) => tool.id as HarnessId));
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>AI-DLC の更新</title>
<style nonce="${nonce}">
${webviewThemeStyles}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family, system-ui); font-size: 14px; color: var(--m-text); background: var(--m-body); line-height: 1.7; padding: 24px; }
main { max-width: 860px; margin: auto; }
h1 { margin: 8px 0 4px; color: var(--m-bright); font-size: 30px; font-weight: 700; line-height: 1.35; }
section { margin: 20px 0; padding: 20px 24px; border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); box-shadow: var(--m-shadow); }
section#gate { border: 0; background: var(--m-warning-light); box-shadow: none; }
section#gate h2 { color: var(--m-warning); font-size: 16px; }
h2 { margin-top: 0; color: var(--m-bright); font-size: 20px; font-weight: 700; }
h3 { color: var(--m-bright); font-size: 15px; font-weight: 700; }
a.text-link, button.text-link { min-height: 0; background: transparent; color: var(--m-primary-light-color); font-weight: 500; border: 0; padding: 0; border-radius: 0; text-decoration: none; }
a.text-link, button.text-link { display: inline-block; margin: 12px 16px 0 0; }
a.text-link:hover, button.text-link:hover { background: transparent; text-decoration: underline; }
button.text-link:disabled { text-decoration: none; }
table { width: 100%; border: 1px solid var(--m-border); border-radius: 8px; border-collapse: separate; border-spacing: 0; overflow: hidden; }
caption { padding: 0 0 6px; color: var(--m-dimmed); font-size: 12px; text-align: left; }
th, td { text-align: left; padding: 10px 16px; border-bottom: 1px solid var(--m-border); }
thead th { color: var(--m-bright); font-weight: 700; }
tbody tr:nth-child(odd) { background: var(--m-hover); }
tbody tr:last-child td { border-bottom: 0; }
tbody td:first-child { font-weight: 600; }
tbody td + td { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; font: inherit; font-weight: 600; margin: 12px 8px 0 0; padding: 0 18px; cursor: pointer; color: var(--m-primary-contrast); background: var(--m-primary); border: 0; border-radius: 4px; }
button:hover { background: var(--m-primary-hover); }
button:disabled { opacity: .55; cursor: default; } button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--m-focus); outline-offset: 2px; }
.cli-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px; }
.cli-actions button { margin-right: 0; }
.cli-actions #cli-result { margin: 12px 0 0; flex: 1 1 16rem; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 4px; background: var(--m-code); padding: 12px; }
code { overflow-wrap: anywhere; padding: 1px 6px; border-radius: 4px; background: var(--m-code); font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; }
pre code { padding: 0; background: transparent; }
#results { padding-left: 20px; }
main > details { margin-top: 20px; border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); }
main > details > summary { padding: 12px 16px; }
main > details > pre { margin: 0 16px 16px; }
${repairStyles}
</style></head><body><main>
<h1>AI-DLC の更新</h1>
<p>対象プロジェクト：<code>${esc(state.root)}</code></p>
<p>このマシンの CLI と、Git で共有するプロジェクトのエンジンをそれぞれ更新できます。</p>
<section id="gate" role="status" aria-labelledby="gate-heading"${blocked ? "" : " hidden"}>
<h2 id="gate-heading">AIDLC Guide を使うには更新が必要です</h2>
<p id="gate-message">${esc(gate?.message ?? "")}</p>
<div id="gate-rollback" hidden>
<h3 id="gate-rollback-heading"></h3>
<div id="gate-rollback-lines"></div>
<pre id="gate-rollback-commands" hidden></pre>
<button type="button" id="copy-rollback" hidden>コマンドをコピー</button>
</div>
<button type="button" id="open-dashboard" hidden>AIDLC Guide を開く</button>
</section>
<section id="cli-section" aria-labelledby="cli-heading" aria-busy="false">
<h2 id="cli-heading">このマシンの AI-DLC CLI</h2>
<p>このマシンの CLI と実行用ランタイムを更新します。リポジトリのファイルは変更しません。</p>
<p>マシンの既定バージョン：<strong id="cli-current">${esc(cli.machineVersion ?? "未インストール")}</strong> ／ 実行環境の対象バージョン：<strong>${esc(cli.target)}</strong></p>
<p>プロジェクトの固定バージョン：<code id="project-pin">${esc(state.projectPin ?? "指定なし")}</code>。固定バージョンがあるプロジェクトは、そのバージョンを引き続き使用します。</p>
<p id="cli-state" role="status">${esc(register || cli.engineNewer ? cli.message : cli.updateMessage)}</p>
<div class="cli-actions">
<button id="pin-project"${cli.engineNewer ? "" : " hidden"}>${esc(versionGateActionLabel("pin-project", cli.target))}</button>
<button type="button" class="text-link" id="use-target"${cli.engineNewer ? "" : " hidden"}>この PC の既定を ${esc(cli.target)} に戻す</button>
<button id="update-cli"${cli.canUpdate || register ? "" : " disabled"}${cli.engineNewer ? " hidden" : ""}>${register ? CLI_REGISTER_LABEL : CLI_UPDATE_LABEL}</button>
<p id="cli-result" role="status" aria-live="polite"></p>
</div>
</section>
<section aria-labelledby="project-heading">
<h2 id="project-heading">プロジェクトのエンジン</h2>
<p>設定済みのすべてのツールのエンジン・設定と <code>.aidlc-version</code> を ${esc(state.target)} に揃えます。変更内容は Git の差分で確認し、チームに共有してください。</p>
<p>チーム・プロジェクトの設定とワークフローの成果物は保持します。進行中の作業があっても実行でき、更新後もそのまま続けられます。</p>
<p id="shared-files-note">リポジトリで共有する次のファイルが変わる可能性があります（どれが変わるかはツールと版によります）：${shared.map((file) => `<code>${esc(file)}</code>`).join("、")}。更新後に、実際に変わったファイルとコミットメッセージを表示します。</p>
<table><caption>更新対象のツール</caption><thead><tr><th scope="col">ツール</th><th scope="col">現在</th><th scope="col">更新後</th></tr></thead><tbody id="tools">${state.tools.map((tool) => `<tr><td>${esc(tool.label)}</td><td>${esc(tool.version ?? "確認が必要")}</td><td>${esc(state.target)}</td></tr>`).join("")}</tbody></table>
<p id="state" role="status">${esc(state.message)}</p>
<p id="runtime-required"${workflowsEngineCanApply(state) && (!cli.targetInstalled || !cli.launcherReady) ? "" : " hidden"}>先に「CLI を更新」で ${esc(state.target)} の実行環境を準備してください。</p>
<button id="apply"${workflowsEngineCanApply(state) && cli.targetInstalled && cli.launcherReady ? "" : " disabled"}>プロジェクトのエンジンを更新</button>
<button type="button" class="text-link" id="doctor"${state.tools.length > 0 ? "" : " disabled"}>Doctor を再実行</button>
<button type="button" class="text-link" id="install">利用するツールを追加</button>
<ul id="results" aria-label="ツールごとの更新結果" aria-live="polite"></ul>
<p id="result" role="status"></p>
<div id="shared-changes" hidden>
<h3>リポジトリで変わったファイル</h3>
<ul id="shared-files"></ul>
<p id="shared-files-more" hidden></p>
<p>次のメッセージでコミットし、チームに共有してください。チームのメンバーは pull した後、AIDLC Guide の案内に従えば揃えられます。</p>
<pre id="commit-message"></pre>
<button type="button" id="copy-commit">コミットメッセージをコピー</button>
</div>
${repairHtml}
</section>
<section aria-labelledby="extension-heading"><h2 id="extension-heading">AIDLC Guide 拡張機能</h2>
<p>新しい AI-DLC のバージョンに対応した拡張機能を確認します。</p><button type="button" class="text-link" id="extension-update">拡張機能の更新を確認</button></section>
<button type="button" class="text-link" id="refresh">状態を再確認</button><button type="button" class="text-link" id="setup">セットアップを開く</button><a class="text-link" id="docs" href="${esc(INSTALL_GUIDE_URL)}">公式手順を開く</a>
<details><summary>実行ログ</summary><pre id="log"></pre></details>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let busy = false;
let busyScope = '';
function engineCanApply(next) {
  return !!next.engineBumpNeeded;
}
let canUpdate = ${workflowsEngineCanApply(state)};
let cliCanUpdate = ${cli.canUpdate || register};
let engineNewer = ${cli.engineNewer};
let targetInstalled = ${cli.targetInstalled && cli.launcherReady};
let hasTools = ${state.tools.length > 0};
const apply = document.getElementById('apply');
const cliResult = document.getElementById('cli-result');
function setCliProgress(text) { cliResult.textContent = text; }
function buttons() {
  apply.disabled = busy || !canUpdate || !targetInstalled;
  document.getElementById('update-cli').disabled = busy || !cliCanUpdate;
  document.getElementById('update-cli').hidden = engineNewer;
  for (const id of ['pin-project', 'use-target']) {
    document.getElementById(id).hidden = !engineNewer;
    document.getElementById(id).disabled = busy || !engineNewer;
  }
  document.getElementById('doctor').disabled = busy || !hasTools;
  for (const id of ['refresh', 'install', 'setup', 'extension-update']) document.getElementById(id).disabled = busy;
  document.getElementById('runtime-required').hidden = !canUpdate || targetInstalled;
  document.getElementById('cli-section').setAttribute('aria-busy', String(busy && busyScope === 'cli'));
  repairButtons();
}
for (const id of ['apply', 'update-cli', 'pin-project', 'use-target', 'doctor']) document.getElementById(id).addEventListener('click', () => {
  if (id === 'apply' && (!canUpdate || !targetInstalled)) return;
  busy = true;
  busyScope = id === 'apply' || id === 'doctor' ? 'project' : 'cli';
  if (busyScope === 'cli') setCliProgress(id === 'update-cli' ? '更新中…' : '処理中…');
  buttons();
  vscode.postMessage({ type: id });
});
for (const id of ['refresh', 'install', 'setup', 'extension-update', 'docs']) document.getElementById(id).addEventListener('click', (event) => {
  if (event.currentTarget instanceof HTMLAnchorElement) event.preventDefault();
  vscode.postMessage({ type: id });
});
document.getElementById('copy-commit').addEventListener('click', () => vscode.postMessage({ type: 'copy-commit' }));
document.getElementById('copy-rollback').addEventListener('click', () => vscode.postMessage({ type: 'copy-rollback' }));
document.getElementById('open-dashboard').addEventListener('click', () => vscode.postMessage({ type: 'open-dashboard' }));
window.addEventListener('message', ({ data: msg }) => {
  if (msg.type === 'gate') {
    const section = document.getElementById('gate');
    if (msg.gate === null) { section.hidden = true; return; }
    section.hidden = false;
    const ok = msg.gate.status === 'ok';
    document.getElementById('gate-heading').textContent = ok ? 'バージョンが揃いました' : 'AIDLC Guide を使うには更新が必要です';
    document.getElementById('gate-message').textContent = ok ? 'AIDLC Guide のすべての機能を使えます。' : msg.gate.message;
    document.getElementById('open-dashboard').hidden = !ok;
    const rollback = ok ? null : msg.rollback;
    document.getElementById('gate-rollback').hidden = !rollback;
    document.getElementById('gate-rollback-heading').textContent = rollback ? rollback.heading : '';
    document.getElementById('gate-rollback-lines').replaceChildren(...(rollback ? rollback.lines : []).map(line => {
      const item = document.createElement('p'); item.textContent = line; return item;
    }));
    const commands = rollback ? rollback.commands : [];
    document.getElementById('gate-rollback-commands').textContent = commands.join('\\n');
    document.getElementById('gate-rollback-commands').hidden = commands.length === 0;
    document.getElementById('copy-rollback').hidden = commands.length === 0;
  }
  if (msg.type === 'focus') {
    const target = document.getElementById(msg.id);
    if (target) { target.scrollIntoView({ block: 'center' }); target.focus(); }
  }
  if (msg.type === 'shared-changes') {
    const block = document.getElementById('shared-changes');
    block.hidden = false;
    const items = msg.files.length > 0 ? msg.files : ['Git で変更を確認できませんでした。差分は git status で確認してください。'];
    document.getElementById('shared-files').replaceChildren(...items.map(file => {
      const item = document.createElement('li'); item.textContent = file; return item;
    }));
    const more = document.getElementById('shared-files-more');
    more.hidden = !(msg.more > 0);
    more.textContent = msg.more > 0 ? 'ほか ' + msg.more + ' 件' : '';
    document.getElementById('commit-message').textContent = msg.commitMessage;
  }
  if (msg.type === 'log') {
    document.getElementById('log').textContent += msg.line + '\\n';
    if (busyScope === 'cli') {
      const lines = String(msg.line).split('\\n').map(line => line.trim()).filter(Boolean);
      setCliProgress(lines[lines.length - 1] || '更新中…');
    }
  }
  if (msg.type === 'state') {
    canUpdate = engineCanApply(msg.state);
    hasTools = msg.state.tools.length > 0;
    document.getElementById('state').textContent = msg.state.message;
    document.getElementById('project-pin').textContent = msg.state.projectPin || '指定なし';
    const rows = msg.state.tools.map(tool => {
      const row = document.createElement('tr');
      for (const value of [tool.label, tool.version || '確認が必要', msg.state.target]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      return row;
    });
    document.getElementById('tools').replaceChildren(...rows); buttons();
  }
  if (msg.type === 'cli-state') {
    const wasInstalled = targetInstalled;
    cliCanUpdate = msg.state.canUpdate || msg.register;
    engineNewer = !!msg.state.engineNewer;
    targetInstalled = msg.state.targetInstalled && msg.state.launcherReady;
    document.getElementById('cli-current').textContent = msg.state.machineVersion || '未インストール';
    document.getElementById('cli-state').textContent = msg.register || engineNewer ? msg.state.message : msg.state.updateMessage;
    document.getElementById('update-cli').textContent = msg.register ? ${JSON.stringify(CLI_REGISTER_LABEL)} : ${JSON.stringify(CLI_UPDATE_LABEL)};
    buttons();
    if (!wasInstalled && targetInstalled) vscode.postMessage({ type: 'ready' });
  }
  if (msg.type === 'results') document.getElementById('results').replaceChildren(...msg.results.map(result => {
    const item = document.createElement('li'); item.textContent = result.label + '：' + result.message; return item;
  }));
  if (msg.type === 'done') {
    busy = false;
    busyScope = '';
    document.getElementById(msg.scope === 'cli' ? 'cli-result' : 'result').textContent = msg.message;
    buttons();
  }
  if (msg.type === 'reset') {
    document.getElementById('log').textContent = '';
    if (msg.scope === 'cli') setCliProgress('更新中…');
    else document.getElementById('result').textContent = '';
  }
});
${repairScript}
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}

export function workflowsUpdateMessage(
  result: NativeWorkflowsUpdateResult,
  entries: WorkflowsToolUpdateResult[],
): string {
  const message = workflowsUpdateBaseMessage(result, entries);
  if (result.recovery === "failed")
    return `${message} 以前のバージョンへの復元にも失敗しました。現在の .aidlc-version と CLI のバージョンを実行ログ・公式手順で確認し、復元してから再実行してください。`;
  if (result.recovery === "restored")
    return `${message} 更新前のバージョンへの復元を確認しました。`;
  return message;
}

function workflowsUpdateBaseMessage(
  result: NativeWorkflowsUpdateResult,
  entries: WorkflowsToolUpdateResult[],
): string {
  if (result.ok)
    return "プロジェクトのエンジン・固定バージョンの更新と Doctor の確認が完了しました。Git の差分を確認して共有してください。";
  if (result.reason === "doctor")
    return "設定反映済み・診断未完了です。実行ログの診断内容を確認し、対処後に「Doctor を再実行」を選んでください。";
  if (result.reason === "runtime-required")
    return "プロジェクトの更新は未実行です。先に「CLI を更新」で必要な実行環境を準備してください。";
  if (result.reason === "previous-runtime-required")
    return "更新前に停止しました。失敗時に以前の固定バージョンへ戻すための実行環境がありません。実行ログに示された旧固定バージョンの CLI を公式手順で復元してから再実行してください。プロジェクトの設定は変更していません。";
  if (result.reason === "pin-failed")
    return "プロジェクトの固定バージョンの設定に失敗しました。ツールのエンジンは未更新です。実行ログと .aidlc-version を確認してください。";
  if (result.reason === "preflight")
    return "更新前の確認で停止しました。ツールのエンジンは未更新です。下の問題と実行ログを確認し、対処後に更新を再実行してください。";
  if (result.reason === "busy")
    return "別のインストールまたは更新が実行中です。処理が終わってから再実行してください。";
  if (result.reason === "verification" || result.reason === "runtime-verification")
    return "ファイル更新後のバージョン確認に失敗しました。適用済みの範囲と実行ログを確認し、状態を再確認してください。";
  const applied = entries.filter((entry) => entry.status === "completed").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;
  const pending = entries.filter((entry) => entry.status === "pending").length;
  return `更新は完了していません。設定反映済み ${applied} 件、失敗 ${failed} 件、未実行 ${pending} 件。失敗した処理にも変更が残っている場合があります。ツールごとの結果と実行ログ、Git の差分を確認してから再実行してください。`;
}

export function cliUpdateMessage(result: CliManagementResult): string {
  if (result.ok) return result.message;
  const stages = {
    preflight: "更新前の確認",
    install: "CLI の導入",
    activate: "CLI の切り替え",
    register: "固定バージョンの登録",
    verify: "更新後の検証",
    restore: "既定バージョンの復元",
    complete: "完了確認",
  };
  const applied = result.applied
    ? "マシンに変更が残っている場合があります。"
    : "変更は未適用です。";
  const recovery =
    result.recovery === "restored"
      ? "以前の既定バージョンに戻しました。"
      : result.recovery === "failed"
        ? "既定バージョンの復元にも失敗しました。"
        : "";
  return `${stages[result.stage]}で停止しました。${result.message} ${applied}${recovery} ${result.nextAction}`;
}

/** Bind update and repair actions to the selected trusted workspace, never a webview-supplied root. */
export async function openWorkflowsUpdatePanel(
  context: ExtensionContext,
  workspaceRoot: string,
  focus?: VersionGateAction,
): Promise<void> {
  if (!workspace.isTrusted || !isOpenFolder(workspaceRoot)) {
    void window.showErrorMessage("更新対象のワークスペースを開き、信頼してから実行してください。");
    return;
  }
  const repairKey = workflowsRepairKey(workspaceRoot);
  const needsRepair = () => context.workspaceState.get<boolean>(repairKey) === true;
  const inspect = () => inspectWorkflowsManagement(workspaceRoot, needsRepair());
  const panel = window.createWebviewPanel(
    "aidlcGuide.updateWorkflows",
    "AI-DLC の更新",
    ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const gateOf = () => inspectVersionGate(workspaceRoot, WORKFLOWS_TARGET_VERSION);
  panel.webview.html = workflowsUpdateHtml(
    inspect(),
    randomBytes(18).toString("hex"),
    inspectCliManagement(workspaceRoot),
    gateOf(),
  );
  // Doctor needs a detected tool; a file-only problem is fixed by hand and then re-checked.
  const focusId =
    focus === undefined
      ? undefined
      : focus === "doctor" && inspect().tools.length === 0
        ? "refresh"
        : GATE_FOCUS[focus];
  let disposed = false;
  let busy = false;
  let validFolder = true;
  const cancellation = new AbortController();
  const folderSubscription = workspace.onDidChangeWorkspaceFolders?.(() => {
    if (!isOpenFolder(workspaceRoot)) {
      validFolder = false;
      panel.dispose();
    }
  });
  // Closing the UI cancels forward work but still permits rollback in an open, trusted folder.
  const canRestore = () => validFolder && workspace.isTrusted && isOpenFolder(workspaceRoot);
  const isCurrent = () => !disposed && canRestore();
  const send = (message: unknown) => {
    if (!disposed) void panel.webview.postMessage(message);
  };
  const refresh = () => {
    if (!isCurrent()) return;
    send({ type: "state", state: inspect() });
    const cliState = inspectCliManagement(workspaceRoot);
    send({ type: "cli-state", state: cliState, register: cliRegistersPin(cliState) });
    const gate = gateOf();
    // Once the versions match, say so; a workspace that was never blocked shows nothing.
    send({
      type: "gate",
      gate: gate.status === "ok" && focus === undefined ? null : gate,
      rollback: versionGateRollbackGuide(gate),
    });
  };
  const results = new Map<string, WorkflowsToolUpdateResult>();
  // What "copy" puts on the clipboard: the last change this panel made to shared files.
  let commitMessage = updateCommitMessage(WORKFLOWS_TARGET_VERSION);
  let problems: UpdateProblem[] = [];
  let initialCheckStarted = false;
  let repairCancellation: AbortController | undefined;
  const showProblems = (entries: UpdateProblem[], message?: string) => {
    problems = entries;
    send({
      type: "problems",
      problems: entries.map((p) => ({ ...p, label: HARNESS_LABELS[p.harness] })),
      message,
    });
  };
  const applyUpdate = async (signal = cancellation.signal, patches: LocalPatch[] = []) => {
    results.clear();
    send({ type: "reset" });
    send({ type: "results", results: [] });
    const before = await gitStatusSnapshot(workspaceRoot, signal);
    try {
      const result = await updateInstalledWorkflows({
        workspaceRoot,
        isCurrent,
        canRestore,
        signal,
        needsRepair: needsRepair(),
        setNeedsRepair: async (value) => {
          await context.workspaceState.update(repairKey, value);
        },
        log: (line) => send({ type: "log", line }),
        onHarnessResult: (entry) => {
          results.set(entry.id, entry);
          send({
            type: "results",
            results: [...results.values()].map((item) => ({
              ...item,
              label: HARNESS_LABELS[item.id],
            })),
          });
        },
      });
      if (result.problems) showProblems(result.problems);
      else if (result.ok) showProblems([], "すべての問題を解消し、更新が完了しました。");
      let patchMessage = "";
      if (patches.length && result.ok) {
        const { applied, skipped } = reapplyLocalPatches(workspaceRoot, patches);
        if (applied.length)
          patchMessage += ` 独自パッチを当て直しました: ${applied.join(", ")}。次回の更新でも同じ手順で当て直します。`;
        if (skipped.length)
          patchMessage += ` 更新後のファイルが想定した公式版と異なるため、独自パッチを当て直していません: ${skipped.join(", ")}。修正前のファイルはバックアップにあります。`;
      } else if (patches.length)
        patchMessage = ` 更新が完了していないため、独自パッチを当て直していません: ${patches.map((p) => p.path).join(", ")}。修正前のファイルはバックアップにあります。`;
      send({
        type: "done",
        message: workflowsUpdateMessage(result, [...results.values()]) + patchMessage,
      });
      if (result.ok) {
        const after = await gitStatusSnapshot(workspaceRoot);
        const files = before === null || after === null ? [] : changedSince(before, after);
        commitMessage = updateCommitMessage(WORKFLOWS_TARGET_VERSION);
        send({
          type: "shared-changes",
          files: files.slice(0, SHARED_FILES_SHOWN),
          more: Math.max(0, files.length - SHARED_FILES_SHOWN),
          commitMessage,
        });
      }
    } catch (cause) {
      const pending = patches.length
        ? ` 更新が完了していないため、独自パッチを当て直していません: ${patches.map((p) => p.path).join(", ")}。修正前のファイルはバックアップにあります。`
        : "";
      send({
        type: "done",
        message: `更新に失敗しました：${cause instanceof Error ? cause.message : String(cause)}${pending}`,
      });
    }
  };
  panel.onDidDispose(() => {
    disposed = true;
    cancellation.abort();
    repairCancellation?.abort();
    folderSubscription?.dispose();
  });
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!message || typeof message !== "object" || !isCurrent()) return;
    let { type } = message as { type?: unknown };
    if (type === "cancel-repair") {
      repairCancellation?.abort();
      return;
    }
    if (type === "docs") {
      await env.openExternal(Uri.parse(INSTALL_GUIDE_URL));
      return;
    }
    if (type === "copy-commit") {
      await env.clipboard.writeText(commitMessage);
      void window.showInformationMessage("コミットメッセージをコピーしました。");
      return;
    }
    if (type === "copy-rollback") {
      const guide = versionGateRollbackGuide(gateOf());
      if (!guide || guide.commands.length === 0) return;
      await env.clipboard.writeText(guide.commands.join("\n"));
      void window.showInformationMessage("コマンドをコピーしました。");
      return;
    }
    if (type === "open-dashboard") {
      void commands.executeCommand("aidlc-guide.open");
      return;
    }
    if (busy) return;
    if (type === "ready" || type === "refresh") {
      refresh();
      if (type === "ready" && focusId !== undefined) send({ type: "focus", id: focusId });
      const cliState = inspectCliManagement(workspaceRoot);
      if (
        (type === "ready" && initialCheckStarted) ||
        !inspect().canUpdate ||
        !cliState.targetInstalled ||
        !cliState.launcherReady
      )
        return;
      initialCheckStarted = true;
      type = "diagnose";
    }
    if (type === "copy-diagnosis") {
      await env.clipboard.writeText(
        JSON.stringify({ target: WORKFLOWS_TARGET_VERSION, problems }, null, 2),
      );
      return;
    }
    if (type === "problem-file") {
      const index = (message as { index?: unknown }).index;
      if (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        !problems[index] ||
        problems[index].path === "設定全体"
      )
        return;
      try {
        const document = await workspace.openTextDocument(
          Uri.file(repairPath(workspaceRoot, problems[index].path)),
        );
        await window.showTextDocument(document, { preview: true });
      } catch {
        void window.showErrorMessage("対象ファイルを開けません。診断情報を確認してください。");
      }
      return;
    }
    if (type === "diagnose" || type === "repair") {
      busy = true;
      repairCancellation = new AbortController();
      try {
        const tool = (message as { tool?: unknown }).tool;
        if (type === "repair" && !REPAIR_TOOLS.some((candidate) => candidate === tool))
          throw new Error("修正に使うハーネスを選択してください。");
        if (type === "repair") await context.workspaceState.update(repairKey, true);
        const signal = AbortSignal.any([cancellation.signal, repairCancellation.signal]);
        const options = {
          root: workspaceRoot,
          backupParent: path.join(context.globalStorageUri.fsPath, "update-backups"),
          signal,
          isCurrent,
          log: (line: string) => send({ type: "log", line }),
          ...(type === "repair" ? { tool: tool as (typeof REPAIR_TOOLS)[number] } : {}),
        };
        if (type === "diagnose") send({ type: "repair-checking" });
        const [diagnosis, capabilities] = await Promise.allSettled([
          repairWorkflows(options),
          type === "diagnose" ? probeRepairTools(signal) : Promise.resolve(null),
        ]);
        if (!isCurrent()) return;
        if (type === "diagnose") {
          send(
            capabilities.status === "fulfilled"
              ? { type: "repair-tools", tools: capabilities.value }
              : {
                  type: "repair-tools",
                  tools: [],
                  message: "AI の検出に失敗しました。詳細欄から再診断してください。",
                },
          );
        }
        if (diagnosis.status === "rejected") throw diagnosis.reason;
        const result = diagnosis.value;
        showProblems(result.problems, result.message);
        const continuing = type === "repair" && result.problems.length === 0 && !signal.aborted;
        send({
          type: "repair-done",
          message: result.message + (result.backup ? ` バックアップ: ${result.backup}` : ""),
          continuing,
        });
        if (continuing) await applyUpdate(signal, result.patches);
      } catch (error) {
        send({
          type: "repair-done",
          failed: true,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        busy = false;
        repairCancellation = undefined;
        refresh();
      }
      return;
    }
    if (type === "install") {
      await commands.executeCommand("aidlc-guide.installWorkflows", workspaceRoot);
      return;
    }
    if (type === "setup") {
      await commands.executeCommand("aidlc-guide.setup", workspaceRoot);
      return;
    }
    if (type === "extension-update") {
      await commands.executeCommand("aidlc-guide.checkUpdate");
      return;
    }
    if (type === "pin-project" || type === "use-target") {
      busy = true;
      const scope = "cli";
      send({ type: "reset", scope });
      try {
        const cliState = inspectCliManagement(workspaceRoot);
        const machine = cliState.machineVersion;
        if (!cliState.engineNewer || machine === null) {
          send({ type: "done", scope, message: "状況が変わりました。状態を再確認してください。" });
          return;
        }
        const pin = type === "pin-project";
        const choice = await window.showWarningMessage(
          pin
            ? cliPinConfirmMessage(machine, cliState.target)
            : cliUseTargetConfirmMessage(machine, cliState.target),
          { modal: true },
          pin ? CLI_PIN_CONFIRM_ACTION : CLI_USE_TARGET_CONFIRM_ACTION,
        );
        if (!isCurrent()) return;
        if (choice !== (pin ? CLI_PIN_CONFIRM_ACTION : CLI_USE_TARGET_CONFIRM_ACTION)) {
          send({ type: "done", scope, message: "中止しました。" });
          return;
        }
        const before = pin ? await gitStatusSnapshot(workspaceRoot, cancellation.signal) : null;
        const result = await (pin ? pinProjectCli : useTargetCli)({
          workspaceRoot,
          isCurrent,
          signal: cancellation.signal,
          log: (line) => send({ type: "log", line }),
        });
        const runtime = result.ok && isCurrent() ? readNativeInstall() : null;
        if (runtime) configureCliEnvironment(context, runtime);
        send({ type: "done", scope, message: cliUpdateMessage(result) });
        if (pin && result.ok) {
          const after = await gitStatusSnapshot(workspaceRoot);
          const files = before === null || after === null ? [] : changedSince(before, after);
          commitMessage = pinCommitMessage(WORKFLOWS_TARGET_VERSION);
          send({
            type: "shared-changes",
            files: files.slice(0, SHARED_FILES_SHOWN),
            more: Math.max(0, files.length - SHARED_FILES_SHOWN),
            commitMessage,
          });
        }
      } catch (cause) {
        send({
          type: "done",
          scope,
          message: `処理の完了を確認できません。状態を再確認してください：${cause instanceof Error ? cause.message : String(cause)}`,
        });
      } finally {
        busy = false;
        refresh();
      }
      return;
    }
    if (type === "update-cli" || type === "doctor") {
      busy = true;
      const scope = type === "update-cli" ? "cli" : "project";
      send({ type: "reset", scope });
      try {
        if (type === "update-cli") {
          const cliState = inspectCliManagement(workspaceRoot);
          const pinned = cliState.projectPin ?? cliState.projectVersion;
          // A fresh clone registers its existing pin; the machine default stays as it is.
          const register = cliRegistersPin(cliState);
          if (!register && cliState.confirmUpdate && pinned) {
            const choice = await window.showWarningMessage(
              cliUpdateConfirmMessage(pinned, cliState.target),
              { modal: true },
              CLI_UPDATE_CONFIRM_ACTION,
            );
            if (!isCurrent()) return;
            if (choice !== CLI_UPDATE_CONFIRM_ACTION) {
              send({ type: "done", scope, message: "CLI の更新を中止しました。" });
              return;
            }
            const latest = inspectCliManagement(workspaceRoot);
            const latestPin = latest.projectPin ?? latest.projectVersion;
            if (latest.confirmUpdate !== true || latestPin !== pinned) {
              send({
                type: "done",
                scope,
                message: "固定バージョンが変わったため、CLI の更新を中止しました。",
              });
              return;
            }
          }
          const result = await (register ? prepareProjectCli : updateMachineCli)({
            workspaceRoot,
            isCurrent,
            signal: cancellation.signal,
            log: (line) => send({ type: "log", line }),
          });
          const runtime = result.ok && isCurrent() ? readNativeInstall() : null;
          if (runtime) configureCliEnvironment(context, runtime);
          send({ type: "done", scope, message: cliUpdateMessage(result) });
        } else {
          results.clear();
          send({ type: "results", results: [] });
          const result = await diagnoseInstalledWorkflows({
            workspaceRoot,
            isCurrent,
            signal: cancellation.signal,
            log: (line) => send({ type: "log", line }),
            setNeedsRepair: async (value) => {
              await context.workspaceState.update(repairKey, value);
            },
            onHarnessResult: (entry) => {
              results.set(entry.id, entry);
              send({
                type: "results",
                results: [...results.values()].map((item) => ({
                  ...item,
                  label: HARNESS_LABELS[item.id],
                })),
              });
            },
          });
          send({ type: "done", scope, message: result.message });
        }
      } catch (cause) {
        send({
          type: "done",
          scope,
          message: `処理の完了を確認できません。状態を再確認してください：${cause instanceof Error ? cause.message : String(cause)}`,
        });
      } finally {
        busy = false;
        refresh();
      }
      return;
    }
    if (type !== "apply") return;
    busy = true;
    try {
      await applyUpdate();
    } finally {
      busy = false;
      refresh();
    }
  });
}

const promptJobs = new Map<string, { job: Promise<void>; isCurrent: () => boolean }>();
export async function maybePromptWorkflowsUpdate(
  context: ExtensionContext,
  workspaceRoot: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  const previous = promptJobs.get(workspaceRoot);
  if (previous?.isCurrent()) return previous.job;
  const job = promptOnce(context, workspaceRoot, isCurrent);
  promptJobs.set(workspaceRoot, { job, isCurrent });
  try {
    await job;
  } finally {
    if (promptJobs.get(workspaceRoot)?.job === job) promptJobs.delete(workspaceRoot);
  }
}

/** Run the one action the version check asks for (docs/maintenance/version-gate-design.md). */
export async function runVersionGateAction(
  context: ExtensionContext,
  root: string,
  action: VersionGateAction,
): Promise<void> {
  if (action === "update-guide") await commands.executeCommand("aidlc-guide.checkUpdate");
  else if (action === "setup") await commands.executeCommand("aidlc-guide.setup", root);
  else await openWorkflowsUpdatePanel(context, root, action);
}

async function promptOnce(
  context: ExtensionContext,
  root: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent() || !workspace.isTrusted || !isOpenFolder(root)) return;
  const gate = inspectVersionGate(root, WORKFLOWS_TARGET_VERSION);
  // A project without aidlc is setup's job; the dashboard says so when opened.
  if (gate.status !== "ok" && gate.status !== "not-installed") {
    const action = VERSION_GATE_ACTIONS[gate.status];
    const label = versionGateActionLabel(action, WORKFLOWS_TARGET_VERSION);
    // No "later": the Guide stays blocked until the versions match, so there is nothing to defer to.
    const pick = await window.showWarningMessage(
      `AIDLC Guide を使うには更新が必要です。${gate.message}`,
      label,
    );
    if (!isCurrent() || !workspace.isTrusted || !isOpenFolder(root)) return;
    if (pick === label) await runVersionGateAction(context, root, action);
    return;
  }
  const state = inspectWorkflowsManagement(
    root,
    context.workspaceState.get<boolean>(workflowsRepairKey(root)) === true,
  );
  if (!state.updateRetryNeeded) return;
  const pick = await window.showInformationMessage(
    `AIDLC Guide: ${state.message}`,
    "アップデートする",
  );
  if (!isCurrent() || !workspace.isTrusted || !isOpenFolder(root)) return;
  if (pick === "アップデートする") await openWorkflowsUpdatePanel(context, root);
}

export { UPDATE_WORKFLOWS_COMMAND };
