export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const esc = escapeHtml;

/**
 * The page frame the setup and update screens share: a header, a numbered
 * step list whose one open step holds the single primary action, and a footer.
 * Colours come from `webviewThemeStyles`, which must precede these rules.
 */
export const webviewPageStyles = `
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--m-text); background: var(--m-body); font-family: var(--vscode-font-family, system-ui); font-size: 14px; line-height: 1.7; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 28px 36px; display: flex; flex-direction: column; gap: 22px; }
  .eyebrow { color: var(--m-dimmed); font-size: 12px; font-weight: 700; letter-spacing: .08em; }
  h1 { margin: 4px 0 0; color: var(--m-bright); font-size: clamp(24px, 4vw, 30px); font-weight: 700; line-height: 1.35; }
  p { margin: 0; }
  .muted { color: var(--m-dimmed); }
  .folder { margin-top: 4px; overflow-wrap: anywhere; color: var(--m-dimmed); }
  .folder code { padding: 1px 6px; border-radius: 4px; background: var(--m-code); color: var(--m-text); font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .steps { list-style: none; margin: 0; padding: 0; border: 1px solid var(--m-border); border-radius: 8px; background: var(--m-card); box-shadow: var(--m-shadow); }
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
  button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; font: inherit; font-weight: 600; cursor: pointer; border: 1px solid var(--m-primary-border); border-radius: 4px; padding: 0 18px; background: var(--m-primary); color: var(--m-primary-contrast); }
  button:hover { background: var(--m-primary-hover); }
  button:disabled, input:disabled { opacity: .55; cursor: default; }
  a.text-link, button.text-link { min-height: 0; background: transparent; color: var(--m-primary-light-color); font-weight: 500; border: 0; padding: 0; border-radius: 0; text-decoration: none; }
  a.text-link:hover, button.text-link:hover { background: transparent; text-decoration: underline; }
  button.text-link:disabled { text-decoration: none; }
  button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid var(--m-focus); outline-offset: 2px; }
  details.more > summary { width: max-content; max-width: 100%; color: var(--m-primary-light-color); font-weight: 500; cursor: pointer; }
  pre { max-height: 300px; overflow: auto; margin: 8px 0 0; padding: 14px; border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--m-code); font-size: 12px; }
  footer { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--m-dimmed); }
  @media (max-width: 540px) { main { padding: 24px 16px; } .row { padding: 12px 14px; } .body { padding: 0 14px 18px; } .actions button:not(.text-link) { width: 100%; } }
`;

export const CHECK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
export const STOP_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17v.01"/></svg>';

export type StepStatus = "done" | "current" | "blocked" | "todo";

/**
 * One numbered step. A done step folds to a row with its summary; the open
 * (current or blocked) step carries the body; a later step is only its title.
 * `body` is HTML; the title and summary are text.
 */
export function stepItem(
  index: number,
  title: string,
  status: StepStatus,
  body = "",
  summary = "",
): string {
  const sum = summary ? `<span class="sum">${esc(summary)}</span>` : "";
  if (status === "done")
    return `<li class="step done"><details><summary class="row"><span class="ic done">${CHECK_ICON}</span><span class="step-title">${esc(title)}</span>${sum}<span class="sr-only">（完了）</span></summary><div class="body">${body}</div></details></li>`;
  if (status === "todo")
    return `<li class="step todo"><div class="row"><span class="ic todo" aria-hidden="true">${index}</span><span class="step-title">${esc(title)}</span>${sum}</div></li>`;
  return `<li class="step ${status}" aria-current="step"><div class="row"><span class="ic ${status === "blocked" ? "stop" : "now"}" aria-hidden="true">${status === "blocked" ? STOP_ICON : index}</span><h2 class="step-title">${esc(title)}</h2></div><div class="body">${body}</div></li>`;
}
