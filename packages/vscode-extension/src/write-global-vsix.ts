import { tmpdir } from "node:os";
import path from "node:path";
import { inspectVersionGate, isPreviewRelease } from "@andon/reader-core";
import { WORKFLOWS_TARGET_VERSION } from "@andon/shared-types";
import {
  commands,
  type ExtensionContext,
  extensions,
  ProgressLocation,
  Uri,
  window,
  workspace,
} from "vscode";
import { type ApplyReleaseResult, applyReleaseFromUrl } from "./release-apply.ts";
import { confirmNewerRelease, fetchReleaseMetadata } from "./release-lookup.ts";
import { sideloadVsix } from "./sideload-vsix.ts";
import {
  acceptedChoice,
  applyProgressTitle,
  lookupFailureMessage,
  OPEN_GATE_ACTION,
  presentApplyResult,
  type ProjectSupport,
  projectUnsupportedNotice,
  UPDATE_ACTION,
  updateConfirmDetail,
} from "./update-feedback.ts";
import { type LatestRelease, releaseWorkflowsChange, vsixDownloadUrl } from "./update-release.ts";

/** Persist a downloaded VSIX under this extension's globalStorage. */
export async function writeGlobalVsix(
  context: ExtensionContext,
  version: string,
  bytes: Uint8Array,
): Promise<string> {
  const root = context.globalStorageUri ?? Uri.file(path.join(tmpdir(), "andon-updates"));
  const dir = Uri.joinPath(root, "updates");
  const file = Uri.joinPath(dir, `andon-for-aidlc-${version}.vsix`);
  await workspace.fs.createDirectory(dir);
  await workspace.fs.writeFile(file, bytes);
  return file.fsPath;
}

export async function deleteGlobalVsix(filePath: string): Promise<void> {
  try {
    await workspace.fs.delete(Uri.file(filePath));
  } catch {
    return;
  }
}

export async function applyLatestRelease(
  context: ExtensionContext,
  release: LatestRelease,
): Promise<ApplyReleaseResult> {
  return applyReleaseFromUrl(release.version, vsixDownloadUrl(release), {
    fetchImpl: fetch,
    writeBytes: (version, bytes) => writeGlobalVsix(context, version, bytes),
    installFromPath: sideloadVsix,
    cleanupPath: deleteGlobalVsix,
  });
}

let registered = false;
let boundContext: ExtensionContext | undefined;
let checkJob: Promise<void> | undefined;

function fallbackHost(): ExtensionContext {
  return {
    globalStorageUri: Uri.file(path.join(tmpdir(), "andon-updates")),
    extension: {
      packageJSON: extensions.getExtension("otomatty.andon-for-aidlc")?.packageJSON ?? {},
    },
  } as ExtensionContext;
}

/**
 * The version check's first folder (docs/maintenance/version-gate-design.md)
 * and the newest release it records, when that project is ahead of this
 * Guide; null otherwise.
 */
function projectAhead(): { root: string; version: string } | null {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root === undefined || !workspace.isTrusted) return null;
  try {
    const gate = inspectVersionGate(root, WORKFLOWS_TARGET_VERSION);
    if (gate.status !== "project-newer" || gate.projectVersion === null) return null;
    return { root, version: gate.projectVersion };
  } catch {
    return null;
  }
}

/**
 * What the version check says of the project under `target`: the same check
 * the offered Guide will run, so nothing about the project is re-derived here.
 */
function supportUnder(root: string, target: string): ProjectSupport["supported"] {
  try {
    switch (inspectVersionGate(root, target).status) {
      case "project-newer":
        return false;
      // Only this machine or Setup is left, and that Guide offers both.
      case "ok":
      case "engine-mismatch":
      case "engine-newer":
      case "not-installed":
        return true;
      default:
        return "partial";
    }
  } catch {
    return "unverified";
  }
}

function runSerializedCheck(context?: ExtensionContext): Promise<void> {
  if (checkJob !== undefined) return checkJob;
  const host = context ?? boundContext;
  const current = String(
    host?.extension?.packageJSON?.version ??
      extensions.getExtension("otomatty.andon-for-aidlc")?.packageJSON.version ??
      "",
  );
  const ahead = projectAhead();
  checkJob = confirmNewerRelease(
    current,
    async (release) => {
      // A Guide that supports another aidlc-workflows release blocks this project until it is updated.
      const metadata = await fetchReleaseMetadata(release);
      const change = releaseWorkflowsChange(WORKFLOWS_TARGET_VERSION, metadata);
      const project: ProjectSupport | null =
        ahead === null
          ? null
          : typeof metadata === "object"
            ? {
                version: ahead.version,
                target: metadata.workflowsTarget,
                supported: supportUnder(ahead.root, metadata.workflowsTarget),
              }
            : { version: ahead.version, target: null, supported: "unverified" };
      const detail = updateConfirmDetail(release.version, release.notes, change, project);
      const choice = await window.showInformationMessage(
        `新しいバージョン ${release.version} があります。更新しますか？`,
        detail === undefined ? { modal: true } : { modal: true, detail },
        UPDATE_ACTION,
      );
      return acceptedChoice(choice, UPDATE_ACTION);
    },
    // "Up to date" would read as a fix for a project this Guide cannot open yet.
    ahead === null
      ? undefined
      : async () => {
          const choice = await window.showWarningMessage(
            projectUnsupportedNotice(
              current,
              ahead.version,
              WORKFLOWS_TARGET_VERSION,
              isPreviewRelease(ahead.version),
            ),
            OPEN_GATE_ACTION,
          );
          if (choice === OPEN_GATE_ACTION) await commands.executeCommand("andon.open");
        },
    async (reason) => {
      void window.showErrorMessage(lookupFailureMessage(reason));
    },
  )
    .then(async (release) => {
      if (release === undefined) return;
      const ctx = host ?? fallbackHost();
      const result = await window.withProgress(
        { location: ProgressLocation.Notification, title: applyProgressTitle(release.version) },
        async () => applyLatestRelease(ctx, release),
      );
      await presentApplyResult(result, release.version, {
        showError: (message) => {
          void window.showErrorMessage(message);
        },
        confirmReload: async (message, action) => window.showInformationMessage(message, action),
        reload: async () => {
          await commands.executeCommand("workbench.action.reloadWindow");
        },
      });
    })
    .finally(() => {
      checkJob = undefined;
    });
  return checkJob;
}

export function registerApplyLatestCommand(context?: ExtensionContext): void {
  if (context !== undefined) boundContext = context;
  if (registered) return;
  registered = true;
  const disposable = commands.registerCommand("andon.checkUpdate", () =>
    runSerializedCheck(boundContext),
  );
  context?.subscriptions.push(disposable);
}
