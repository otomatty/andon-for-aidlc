export const repairHtml = `
<section class="repair-card" id="repair-section" aria-labelledby="repair-heading" aria-busy="false">
<div class="repair-heading"><h2 id="repair-heading">更新前のチェック</h2><span class="repair-badge" id="repair-badge">自動診断</span></div>
<p id="problem-summary" role="status">実行環境の準備ができると、自動で診断します。</p>
<p class="muted">修正前にバックアップを作成します。修正できたら、更新と最終診断まで続けて実行します。</p>
<div id="repair-actions" hidden>
<div class="repair-provider"><span id="repair-provider" role="status">利用できる AI を確認しています…</span>
<div id="repair-tool-field" hidden><label for="repair-tool">使用する AI</label>
<select id="repair-tool" disabled aria-describedby="repair-consent"></select></div></div>
<p class="muted" id="repair-consent">診断情報と必要な .gitignore の内容を表示中の AI に送信します。CLI のログインと利用枠を使用します。</p>
<div class="repair-actions"><button id="repair" disabled>AIで修正して更新</button></div>
</div>
<p id="repair-status" role="status" hidden></p>
<button class="text-link" id="cancel-repair" hidden>処理を中止</button>
<details class="repair-diagnostics"><summary>診断の詳細・その他の操作</summary>
<div id="problems"></div>
<p class="muted">診断は作業用コピーで行います。公式配布物と一致する設定、除外ルールを保持できる古い .gitignore、独自の文章を残したまま移行できる AGENTS.md などの古い AI-DLC 案内を修正します。独自変更がある設定は、確認が必要な項目として残します。</p>
<div class="repair-actions"><button class="text-link" id="diagnose">再診断・AIを再検出</button>
<button class="text-link" id="copy-diagnosis" disabled>診断情報をコピー</button></div>
</details>
</section>`;

export const repairStyles = `
[hidden] { display: none !important; }
.muted { color: var(--m-dimmed); font-size: .9em; }
section.repair-card { margin: 16px 0 0; padding: 20px; border-color: var(--m-warning); background: var(--m-card); box-shadow: none; }
.repair-heading, .repair-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.repair-heading h2 { margin: 0; font-size: 18px; }
.repair-badge { padding: 0 8px; border-radius: 1000px; background: var(--m-warning-light); color: var(--m-warning); font-size: 11px; font-weight: 700; line-height: 20px; }
#problem-summary { font-weight: 700; margin-bottom: 8px; }
.repair-provider { margin-top: 20px; }
#repair-tool-field { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; margin-top: 8px; }
select { box-sizing: border-box; min-width: 0; max-width: 100%; min-height: 36px; font: inherit; padding: 0 10px; border-radius: 4px; border: 1px solid var(--m-input-border); color: var(--m-text); background: var(--m-card); }
select:focus-visible, summary:focus-visible { outline: 2px solid var(--m-focus); outline-offset: 2px; }
.repair-actions button { margin: 0; }
.repair-diagnostics { margin-top: 20px; padding: 0 16px; border: 1px solid var(--m-border); border-radius: 8px; }
.repair-diagnostics > summary { padding: 12px 0; }
summary { cursor: pointer; overflow-wrap: anywhere; }
#problems details { margin: 12px 0; }
#problems p { margin: 8px 0; }
#problems li { overflow-wrap: anywhere; margin-bottom: 8px; }
@media (max-width: 480px) {
  body { padding: 12px; }
  section.repair-card { padding: 14px; }
  #repair-tool-field { grid-template-columns: minmax(0, 1fr); gap: 4px; }
}
`;

// All diagnostic strings enter the DOM through textContent, never innerHTML.
export const repairScript = `
let problems = [];
let repairRunning = false;
let availableTools = [];
let repairOutcome = '';
const toolSelect = document.getElementById('repair-tool');
function repairButtons() {
  document.getElementById('repair-section').hidden = !canUpdate && !problems.length && !repairOutcome;
  apply.hidden = problems.length > 0;
  document.getElementById('diagnose').disabled = busy;
  document.getElementById('copy-diagnosis').disabled = busy || !problems.length;
  document.getElementById('repair').disabled = busy || !problems.length || !toolSelect.value;
  document.getElementById('repair-actions').hidden = !problems.length;
  document.getElementById('cancel-repair').hidden = !repairRunning;
  document.getElementById('cancel-repair').disabled = !repairRunning;
  document.getElementById('repair-section').setAttribute('aria-busy', String(busy && busyScope === 'repair'));
  toolSelect.disabled = busy || !availableTools.length;
}
toolSelect.addEventListener('change', repairButtons);
for (const id of ['diagnose', 'repair']) document.getElementById(id).addEventListener('click', () => {
  busy = true; busyScope = 'repair'; repairRunning = id === 'repair'; buttons();
  const status = document.getElementById('repair-status');
  status.hidden = false;
  status.textContent = repairRunning ? '修正しています。完了後、更新と最終診断を行います…' : '設定と利用できる AI を確認しています…';
  vscode.postMessage({ type: id, tool: toolSelect.value });
});
document.getElementById('cancel-repair').addEventListener('click', () => vscode.postMessage({ type: 'cancel-repair' }));
document.getElementById('copy-diagnosis').addEventListener('click', () => vscode.postMessage({ type: 'copy-diagnosis' }));
window.addEventListener('message', ({ data: msg }) => {
  if (msg.type === 'repair-checking') {
    busy = true; busyScope = 'repair';
    document.getElementById('repair-badge').textContent = '確認中';
    document.getElementById('problem-summary').textContent = '設定と利用できる AI を確認しています…';
    document.getElementById('repair-status').hidden = true;
    buttons();
  }
  if (msg.type === 'problems') {
    problems = msg.problems;
    document.getElementById('problem-summary').textContent = msg.message || (problems.length + ' 件の問題があります。');
    document.getElementById('repair-badge').textContent = problems.length ? '要確認 ' + problems.length + ' 件' : '問題なし';
    const groups = new Map();
    for (const [index, problem] of problems.entries()) {
      const key = problem.harness + ':' + problem.kind;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ problem, index });
    }
    document.getElementById('problems').replaceChildren(...Array.from(groups.values(), entries => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = entries[0].problem.label + '：' + entries.length + ' 件';
      details.append(summary);
      const guidance = document.createElement('p'); guidance.textContent = entries[0].problem.guidance;
      details.append(guidance);
      const list = document.createElement('ul');
      for (const { problem, index } of entries) {
        const item = document.createElement('li');
        const label = document.createElement('span'); label.textContent = problem.path + '：' + problem.detail;
        item.append(label);
        if (problem.path && problem.path !== '設定全体') {
          const button = document.createElement('button'); button.textContent = 'ファイルを開く'; button.className = 'text-link';
          button.addEventListener('click', () => vscode.postMessage({ type: 'problem-file', index }));
          item.append(button);
        }
        list.append(item);
      }
      details.append(list); return details;
    }));
  }
  if (msg.type === 'repair-tools') {
    const selected = toolSelect.value;
    availableTools = msg.tools.filter(tool => tool.available);
    toolSelect.replaceChildren(...msg.tools.map(tool => {
      const option = document.createElement('option'); option.value = tool.available ? tool.tool : '';
      option.disabled = !tool.available;
      option.textContent = tool.label + (tool.available ? '' : '：' + (tool.detail || '利用できません'));
      return option;
    }));
    const first = availableTools.find(tool => tool.tool === selected) || availableTools[0];
    toolSelect.value = first ? first.tool : '';
    document.getElementById('repair-tool-field').hidden = availableTools.length < 2;
    document.getElementById('repair-provider').textContent = msg.message || (availableTools.length > 1 ? '利用できる AI を検出しました。' : first ? '使用する AI：' + first.label + '（自動選択）' : '利用できる AI がありません。Claude Code、Cursor、GitHub Copilot CLI のいずれかを導入・ログインしてから、詳細欄で再診断してください。');
  }
  if (msg.type === 'repair-done') {
    busy = msg.continuing === true; repairRunning = busy;
    if (!busy) busyScope = '';
    repairOutcome = msg.message || '';
    if (msg.failed && !problems.length) {
      document.getElementById('repair-badge').textContent = '確認が必要';
      document.getElementById('problem-summary').textContent = msg.message || 'チェックを完了できませんでした。';
      document.getElementById('repair-status').hidden = true;
    } else {
      document.getElementById('repair-status').textContent = msg.message;
      document.getElementById('repair-status').hidden = !msg.message;
      if (msg.failed) document.getElementById('repair-badge').textContent = '確認が必要';
    }
    buttons();
  }
  if (msg.type === 'done') {
    if (repairRunning) {
      document.getElementById('repair-status').textContent = msg.message + (repairOutcome ? ' ' + repairOutcome : '');
      document.getElementById('repair-status').hidden = !msg.message;
    }
    repairRunning = false;
  }
  repairButtons();
});
`;
