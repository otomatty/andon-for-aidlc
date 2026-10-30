import type { ApplyReleaseResult } from "./release-apply.ts";
import type { WorkflowsChange } from "./update-release.ts";

export const UPDATE_ACTION = "更新する";
export const RELOAD_ACTION = "今すぐ再読み込み";

export type UpdateFeedbackUi = {
  showError: (message: string) => void | Promise<void>;
  confirmReload: (message: string, action: string) => Promise<unknown>;
  reload: () => Promise<void>;
};

export function acceptedChoice(choice: unknown, action: string): boolean {
  if (choice === action) return true;
  if (typeof choice === "object" && choice !== null && "title" in choice) {
    return (choice as { title: unknown }).title === action;
  }
  return false;
}

function failureLabel(reason: Exclude<ApplyReleaseResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "timeout":
      return "ダウンロードが時間切れ";
    case "network":
      return "ネットワークエラー";
    case "http":
      return "ダウンロード失敗";
    case "invalid-vsix":
      return "ファイルが VSIX ではありません";
    case "write":
      return "保存に失敗";
    case "install":
      return "インストールに失敗";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function applyFailureMessage(result: Exclude<ApplyReleaseResult, { ok: true }>): string {
  const head = `更新に失敗しました（${failureLabel(result.reason)}）`;
  const body = result.detail !== undefined && result.detail !== "" ? `：${result.detail}` : "。";
  const kept =
    result.reason === "install" && result.filePath
      ? ` ファイルを残してあります: ${result.filePath}。「Extensions: Install from VSIX」から手動で入れられます。`
      : "";
  return `${head}${body}${kept}`;
}

export function applySuccessMessage(version: string): string {
  return `Andon ${version} への更新が完了しました。新しいバージョンを有効にするには、ウィンドウを再読み込みしてください。`;
}

export function applyProgressTitle(version: string): string {
  return `Andon ${version} を更新しています…`;
}

export async function presentApplyResult(
  result: ApplyReleaseResult,
  version: string,
  ui: UpdateFeedbackUi,
): Promise<void> {
  if (!result.ok) {
    await ui.showError(applyFailureMessage(result));
    return;
  }
  const choice = await ui.confirmReload(applySuccessMessage(version), RELOAD_ACTION);
  if (acceptedChoice(choice, RELOAD_ACTION)) await ui.reload();
}

export function lookupFailureMessage(reason: string): string {
  switch (reason) {
    case "rate-limited":
      return "更新の確認に失敗しました（GitHub の要求回数制限に達しました）。";
    case "timeout":
      return "更新の確認に失敗しました（タイムアウト）。";
    case "network":
      return "更新の確認に失敗しました（ネットワークエラー）。";
    case "http":
      return "更新の確認に失敗しました（リリース情報を取得できません）。";
    case "missing-asset":
      return "更新の確認に失敗しました（VSIX がリリースにありません）。";
    case "parse":
      return "更新の確認に失敗しました（リリース情報を解釈できません）。";
    default:
      return `更新の確認に失敗しました（${reason}）。`;
  }
}

const CONFIRM_DETAIL_ITEMS = 5;

/**
 * A project ahead of this Guide's supported release, and what the version
 * check says of it under the offered Guide's release (`target`): `true` when
 * only this machine or Setup is left, which that Guide offers itself;
 * "partial" when the project's own files still block it; `false` when the
 * project is still newer; "unverified" when the release could not be read.
 */
export type ProjectSupport = {
  version: string;
  target: string | null;
  supported: boolean | "partial" | "unverified";
};

export const OPEN_GATE_ACTION = "更新の案内を開く";

/** Said when no newer Guide exists for a project that is ahead of this one. */
export function projectUnsupportedNotice(
  current: string,
  projectVersion: string,
  target: string,
  preview: boolean,
): string {
  const lead = preview
    ? `Andon は aidlc-workflows のプレビュー版（${projectVersion}）に対応しません。最新の Andon ${current} が対応するのは ${target} です。`
    : `最新の Andon ${current} は、まだ aidlc-workflows ${projectVersion} に対応していません。`;
  return `${lead}対応する Andon が出るまで、このプロジェクトでは Andon を使えません。${target} に戻す方法は、Andon の更新の案内で確認できます。`;
}

function projectLead(project: ProjectSupport, change: WorkflowsChange): string[] {
  if (project.supported === true)
    return [`この更新で、プロジェクトの aidlc-workflows ${project.version} に対応します。`];
  if (project.supported === "partial")
    return [
      `この更新の対応版は ${project.target ?? project.version} ですが、このプロジェクトには、それと異なるバージョンのツールや固定バージョン、読めないファイルも残っています。更新後に Andon の案内に従ってプロジェクトを整えるまで、Andon を使えません。`,
      "プロジェクトの更新で変わるファイルは、リポジトリへのコミットが必要です。",
    ];
  if (project.supported === "unverified")
    return [
      "新しい Andon が対応する aidlc-workflows の版を確認できませんでした。",
      `プロジェクトの aidlc-workflows ${project.version} に対応しているかは、更新後の画面で確認できます。`,
    ];
  const to = change !== null && change !== "unverified" ? change.to : null;
  return [
    to === null
      ? `この更新の対応版は変わりません。プロジェクトの aidlc-workflows ${project.version} にはまだ対応していないため、更新後も Andon を使えません。`
      : `この更新の対応版は ${to} です。プロジェクトの aidlc-workflows ${project.version} にはまだ対応していないため、更新後も Andon を使えません。`,
  ];
}

/** Detail text of the update confirmation, or `undefined` when the release lists nothing. */
export function updateConfirmDetail(
  version: string,
  notes: readonly string[],
  workflowsChange: WorkflowsChange = null,
  project: ProjectSupport | null = null,
): string | undefined {
  const rest = notes.length - CONFIRM_DETAIL_ITEMS;
  const changes =
    notes.length === 0
      ? []
      : [
          `${version} の主な変更:`,
          ...notes.slice(0, CONFIRM_DETAIL_ITEMS).map((note) => `・${note}`),
          ...(rest > 0 ? [`ほか ${rest} 件`] : []),
        ];
  // Said before installing, so blocking the project is a choice and not a surprise.
  const lead =
    workflowsChange === null
      ? null
      : workflowsChange === "unverified"
        ? [
            "新しい Andon が対応する aidlc-workflows の版を確認できませんでした。",
            "対応する版が変わっていた場合、更新後はプロジェクトの aidlc-workflows を更新するまで Andon を使えません。",
          ]
        : [
            `この更新後は、プロジェクトの aidlc-workflows を ${workflowsChange.from} から ${workflowsChange.to} に更新するまで Andon を使えません。`,
          ];
  // A project already ahead needs no project update from this Guide, only to know whether it unblocks.
  const warning =
    project !== null
      ? [...projectLead(project, workflowsChange), ...(changes.length === 0 ? [] : [""])]
      : lead === null
        ? []
        : [
            ...lead,
            "プロジェクトの更新で変わるファイルは、リポジトリへのコミットが必要です。今は更新しない場合は、このダイアログを閉じてください。",
            ...(changes.length === 0 ? [] : [""]),
          ];
  const lines = [...warning, ...changes];
  return lines.length === 0 ? undefined : lines.join("\n");
}
