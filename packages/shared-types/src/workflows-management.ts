/** The tested release installed by every Guide installation/update entry point. */
export const WORKFLOWS_TARGET_VERSION = "2.11.2";

export type WorkflowsManagementState = {
  target: string;
  root: string;
  tools: { id: string; label: string; version: string | null }[];
  projectPin: string | null;
  status: "not-installed" | "current" | "update" | "blocked";
  message: string;
  canInstall: boolean;
  canUpdate: boolean;
  /** True when the update action should run, including writing a missing project pin. */
  engineBumpNeeded: boolean;
  /** True when a recorded tool or pin version differs from the target. A missing pin alone is false. */
  engineVersionDiffers: boolean;
  /** True when a previous update can still be retried. A finished, matching install is false. */
  updateRetryNeeded: boolean;
};

/**
 * Whether this workspace may use the Guide. Anything but `ok` blocks every
 * surface except the update/setup screens, bundled docs, and Doctor/repair.
 * The order of the checks is documented in docs/maintenance/version-gate-design.md.
 */
export type VersionGateStatus =
  | "ok"
  | "not-installed"
  | "unknown"
  | "project-newer"
  | "project-older"
  | "engine-mismatch"
  | "engine-newer";

/** The one action the update screen offers for each status. */
export type VersionGateAction =
  | "setup"
  | "doctor"
  | "update-guide"
  | "update-project"
  | "install-engine"
  | "pin-project";

/** How a project that moved past the Guide's release can return to it. */
export type VersionGateRollback =
  /** A native project: pin the supported release again, then refresh each tool from it. */
  | { kind: "commands"; commands: string[] }
  /** No tool is configured, but a stopped install left files recording a newer release. */
  | { kind: "leftovers"; files: string[] }
  /** A copy-channel project: the official procedure restores an earlier copy runtime. */
  | { kind: "copy" }
  /** A workflow record already uses a newer state format, which the supported release refuses to open. */
  | { kind: "state-newer"; stateVersion: number };

export type VersionGate = {
  status: VersionGateStatus;
  target: string;
  tools: { id: string; label: string; version: string | null }[];
  /** `.aidlc-version`, or null when absent or unreadable. */
  pin: string | null;
  /** The engine this machine resolves for the project; null when none or not native. */
  engine: string | null;
  /** True when a harness tree carries a native-install stamp. */
  native: boolean;
  /** The newest aidlc-workflows version the project records; null when none is readable. */
  projectVersion: string | null;
  /** For `project-newer`: the way back to the supported release; null for every other status. */
  rollback: VersionGateRollback | null;
  /** Japanese, human-readable explanation of the status. */
  message: string;
};

export const VERSION_GATE_ACTIONS: Readonly<
  Record<Exclude<VersionGateStatus, "ok">, VersionGateAction>
> = {
  "not-installed": "setup",
  unknown: "doctor",
  "project-newer": "update-guide",
  "project-older": "update-project",
  "engine-mismatch": "install-engine",
  "engine-newer": "pin-project",
};

/** The button text for each action; shared by the dashboard and the extension's notice. */
export function versionGateActionLabel(action: VersionGateAction, target: string): string {
  switch (action) {
    case "update-project":
      return `プロジェクトを ${target} に更新`;
    case "update-guide":
      return "Andon を更新";
    case "install-engine":
      return `この PC に ${target} を導入`;
    case "pin-project":
      return `このプロジェクトを ${target} に固定`;
    case "doctor":
      return "Doctor で診断";
    case "setup":
      return "セットアップを開く";
  }
}

/**
 * The official commands that pin a native project back to `target` and refresh
 * its tools: upstream refuses a bare `aidlc config` once a project has several,
 * so each tool gets its own `--harness` run.
 */
export function versionGateRollbackCommands(
  target: string,
  harnesses: readonly string[],
): string[] {
  return [
    `aidlc config --pin ${target} --yes`,
    ...harnesses.map((harness) => `aidlc config --harness ${harness} --yes`),
  ];
}

export type VersionGateRollbackGuide = {
  heading: string;
  lines: string[];
  /** Run in the project folder, in order; empty when there is nothing to run. */
  commands: string[];
};

/**
 * The way back for a `project-newer` gate, worded once for the dashboard and
 * the update panel. The Guide shows it and never runs it: going back changes
 * files the team shares, so the person who updated decides
 * (docs/maintenance/version-gate-design.md).
 */
export function versionGateRollbackGuide(gate: VersionGate): VersionGateRollbackGuide | null {
  const rollback = gate.rollback;
  // A gate from a server that predates the field carries none.
  if (!rollback) return null;
  const heading = `${gate.target} に戻す場合`;
  switch (rollback.kind) {
    case "state-newer":
      return {
        heading,
        lines: [
          `作業記録が新しい形式（State Version ${rollback.stateVersion}）で保存されているため、${gate.target} には戻せません。${gate.target} はこの形式の記録を開けません。`,
          "このプロジェクトのバージョンに対応した Andon が出るまでお待ちください。",
        ],
        commands: [],
      };
    case "copy":
      return {
        heading,
        lines: [
          `このプロジェクトは aidlc-workflows をコピーで導入しています。公式手順の「更新の安全」に従って ${gate.target} のコピー用ランタイムで戻すか、Git で更新前のコミットに戻してください。`,
          "更新をすでにコミットしてチームと共有していた場合は、戻す前にチームで相談してください。",
        ],
        commands: [],
      };
    case "leftovers":
      return {
        heading,
        lines: [
          `導入が途中で止まったと思われる次のファイルに、新しいバージョンが記録されています：${rollback.files.join("、")}。`,
          "Git で元に戻すか削除してから「状態を再確認」を押し、セットアップをやり直してください。",
        ],
        commands: [],
      };
    case "commands":
      return {
        heading,
        lines: [
          rollback.commands.length > 1
            ? `プロジェクトのフォルダーで次のコマンドを順に実行すると、固定バージョンを ${gate.target} に戻し、各ツールのファイルを ${gate.target} にそろえます。`
            : `プロジェクトのフォルダーで次のコマンドを実行すると、固定バージョンを ${gate.target} に戻します。その後、セットアップを開いてください。`,
          "戻した後は git status で変わったファイルを確認してください。更新をすでにコミットしてチームと共有していた場合は、戻す前にチームで相談し、戻した変更もコミットします。",
        ],
        commands: rollback.commands,
      };
  }
}
