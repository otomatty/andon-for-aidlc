import { formatDoctorDetailsForLog } from "./doctor-output.ts";
import { findHarnessConflict } from "./harness-conflicts.ts";
import type { HarnessId } from "./harness-detect.ts";
import { configureNativeHarness } from "./native-harness-install.ts";
import {
  type configureNative,
  inspectProjectPin,
  installNative,
  type NativeInstall,
  pinNative,
  readNativeInstall,
  readVersionedNativeInstall,
  SETUP_RELEASE,
  unpinNative,
  useNative,
} from "./native-setup.ts";
import { compareSemver, parseSemver } from "./update-release.ts";
import { NativeConfigConflict, type UpdateProblem } from "./workflows-conflicts.ts";
import { gitignoreConfigSource } from "./workflows-repair.ts";
import { readAllWorkspaceAidlcVersions } from "./workflows-version.ts";

export type NativeWorkflowsUpdateResult = {
  ok: boolean;
  reason?: string;
  target: string;
  problems?: UpdateProblem[];
  /** Outcome of attempted rollback; the original failure reason remains available. */
  recovery?: "restored" | "failed";
};

export type WorkflowsToolUpdateResult = {
  id: HarnessId;
  status: "pending" | "updating" | "completed" | "failed";
  message: string;
};

export type NativeWorkflowsUpdateHooks = {
  readInstall?: (version: string) => NativeInstall | null;
  readActive?: () => NativeInstall | null;
  readProjectPin?: (root: string) => string | null;
  readProjectPinState?: (root: string) => { exists: boolean; version: string | null };
  readWorkspaceVersions?: (root: string) => (string | null)[];
  install?: typeof installNative;
  use?: typeof useNative;
  pin?: typeof pinNative;
  unpin?: typeof unpinNative;
  configure?: typeof configureNative;
};

export type NativeUpdateBlockReason = "pin-invalid" | "pin-ahead";

/**
 * Why a native (2.8+) docs pin cannot be installed by this Guide build, or
 * null when `SETUP_RELEASE` is a compatible target.
 */
export function nativeUpdateBlockReason(pin: string): NativeUpdateBlockReason | null {
  const pinVersion = parseSemver(pin);
  const bootstrap = parseSemver(SETUP_RELEASE);
  if (pinVersion === null || pinVersion.prerelease !== "" || bootstrap === null)
    return "pin-invalid";
  if (compareSemver(pinVersion, bootstrap) > 0) return "pin-ahead";
  return null;
}

/**
 * Machine runtime for a native (2.8+) docs pin: the Setup bootstrap release
 * when that pin is not newer than the bootstrap. Docs `sourceVersion` moves on
 * every upstream commit and usually has no GitHub release tag, so the pin is
 * never used as an installer version.
 */
export function nativeUpdateRelease(pin: string): string | null {
  return nativeUpdateBlockReason(pin) === null ? SETUP_RELEASE : null;
}

export function needsNativeMachineInstall(install: NativeInstall | null, target: string): boolean {
  return install === null || install.version !== target;
}

export function wouldDowngradeWorkspace(versions: (string | null)[], target: string): boolean {
  const targetVersion = parseSemver(target);
  if (targetVersion === null) return false;
  return versions.some((version) => {
    const parsed = version === null ? null : parseSemver(version);
    return parsed !== null && compareSemver(parsed, targetVersion) > 0;
  });
}

/** Harnesses that must take part in a native update. */
export function omittedRequiredHarnesses(
  detected: HarnessId[],
  selected: HarnessId[],
): HarnessId[] {
  return detected.filter((id) => !selected.includes(id));
}

function isIncompleteRetainedUseError(message: string): boolean {
  return (
    /retained version \S+ is incomplete/i.test(message) || /not installed completely/i.test(message)
  );
}

/** Preflight every harness before configuration and restore the prior runtime on failure. */
export async function applyNativeWorkflowsUpdate(opts: {
  workspaceRoot: string;
  pin: string;
  selected: HarnessId[];
  detected?: HarnessId[];
  log: (line: string) => void;
  isCurrent?: () => boolean;
  canRestore?: () => boolean;
  signal?: AbortSignal;
  hooks?: NativeWorkflowsUpdateHooks;
  /** Repository updates use an already-installed runtime without activating or installing it. */
  preserveMachine?: boolean;
  onHarnessResult?: (result: WorkflowsToolUpdateResult) => void;
}): Promise<NativeWorkflowsUpdateResult> {
  const blocked = nativeUpdateBlockReason(opts.pin);
  if (blocked === "pin-ahead") {
    opts.log(
      `この Guide の想定バージョン ${opts.pin} は、拡張が導入できる本体 ${SETUP_RELEASE} より新しいため、自動更新はできません。公式手順から手動で更新してください。`,
    );
    return { ok: false, reason: blocked, target: opts.pin };
  }
  if (blocked !== null) {
    opts.log("Guide の想定バージョンが読めません。公式手順から手動で更新してください。");
    return { ok: false, reason: blocked, target: opts.pin };
  }
  const target = SETUP_RELEASE;
  for (const id of opts.selected)
    opts.onHarnessResult?.({ id, status: "pending", message: "未実行" });
  if (opts.selected.length === 0) {
    opts.log("更新するツールが選ばれていません。");
    return { ok: false, reason: "empty-selection", target };
  }
  const detected = opts.detected ?? opts.selected;
  const conflict = findHarnessConflict([...detected, ...opts.selected]);
  if (conflict) {
    opts.log(`${conflict.message}公式手順から手動で更新してください。`);
    return { ok: false, reason: "collision", target };
  }
  if (
    omittedRequiredHarnesses(detected, opts.selected).length > 0 ||
    omittedRequiredHarnesses(opts.selected, detected).length > 0
  ) {
    opts.log(
      "検出結果と選択が一致していません。パネルを閉じて開き直してから、検出されたハーネスをすべて更新してください。",
    );
    return { ok: false, reason: "incomplete-selection", target };
  }

  const readInstall = opts.hooks?.readInstall ?? readVersionedNativeInstall;
  const readActive = opts.hooks?.readActive ?? readNativeInstall;
  const readPinHook = opts.hooks?.readProjectPin;
  const inspectPin =
    opts.hooks?.readProjectPinState ??
    (readPinHook
      ? (root: string) => {
          const version = readPinHook(root);
          return { exists: version !== null, version };
        }
      : inspectProjectPin);
  const readWorkspaceVersions =
    opts.hooks?.readWorkspaceVersions ??
    ((root: string) => readAllWorkspaceAidlcVersions(root).map((item) => item.version));
  const install = opts.hooks?.install ?? installNative;
  const use = opts.hooks?.use ?? useNative;
  const pin = opts.hooks?.pin ?? pinNative;
  const unpin = opts.hooks?.unpin ?? unpinNative;
  const configure = opts.hooks?.configure ?? configureNativeHarness;
  const previousMachine = readActive();
  const previousActive = previousMachine?.version ?? null;
  const pinState = inspectPin(opts.workspaceRoot);
  if (pinState.exists && pinState.version === null) {
    opts.log(
      "プロジェクトの固定バージョン（.aidlc-version）が読めません。上書きや削除はせず、公式手順から確認してください。",
    );
    return { ok: false, reason: "pin-unreadable", target };
  }
  const previousPin = pinState.version;
  if (opts.preserveMachine && (!readInstall(target) || !previousMachine)) {
    opts.log(`この PC に ${target} の実行環境がありません。プロジェクトの設定は変更していません。`);
    return { ok: false, reason: "runtime-required", target };
  }
  if (opts.preserveMachine && previousPin && previousPin !== target && !readInstall(previousPin)) {
    opts.log(
      `失敗時に固定バージョンを戻すための CLI ${previousPin} が見つかりません。このバージョンを復元してから再実行してください。`,
    );
    return { ok: false, reason: "previous-runtime-required", target };
  }
  if (
    wouldDowngradeWorkspace([...readWorkspaceVersions(opts.workspaceRoot), previousPin], target)
  ) {
    opts.log(
      `このワークスペースには本体 ${target} より新しいハーネスまたは固定バージョンがあるため、自動更新はダウングレードになります。公式手順から手動で更新してください。`,
    );
    return { ok: false, reason: "would-downgrade", target };
  }

  const stillHere = (): boolean => !opts.signal?.aborted && opts.isCurrent?.() !== false;
  const forwardOptions = opts.signal ? { signal: opts.signal } : {};
  const ensureStillHere = () => {
    if (!stillHere()) throw new Error("更新を中止しました。");
  };
  const installRuntime = async (repair = false) => {
    ensureStillHere();
    return repair || opts.signal
      ? install(opts.log, undefined, fetch, target, {
          ...forwardOptions,
          ...(repair ? { repair: true } : {}),
        })
      : install(opts.log, undefined, fetch, target);
  };
  const activateRuntime = async (runtime: NativeInstall) => {
    ensureStillHere();
    return opts.signal
      ? use(runtime, target, opts.log, undefined, forwardOptions)
      : use(runtime, target, opts.log);
  };
  const folderWritable = (): boolean => opts.canRestore?.() !== false;
  let recovery: NativeWorkflowsUpdateResult["recovery"];
  const failureResult = (
    reason: string,
    problems?: UpdateProblem[],
  ): NativeWorkflowsUpdateResult => ({
    ok: false,
    reason,
    target,
    ...(problems ? { problems } : {}),
    ...(recovery ? { recovery } : {}),
  });
  const recoveryFailed = (cause: unknown) => {
    recovery = "failed";
    opts.log(
      `バージョンの復元に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  };
  const recoverySucceeded = () => {
    if (recovery !== "failed") recovery = "restored";
  };
  const restoreActiveRuntime = async (runtime?: NativeInstall): Promise<void> => {
    if (opts.preserveMachine) return;
    if (previousActive === null || previousActive === target) return;
    const from = runtime ?? previousMachine ?? readInstall(previousActive);
    if (from === null) {
      recoveryFailed("以前の本体が見つかりません。");
      return;
    }
    try {
      await use(from, previousActive, opts.log);
      if (readActive()?.version !== previousActive)
        throw new Error(`以前の既定バージョン ${previousActive} への復元を確認できません。`);
      recoverySucceeded();
    } catch (cause) {
      recoveryFailed(cause);
    }
  };
  if (!stillHere()) {
    opts.log("ワークスペースが閉じられたため、更新を中止しました。");
    return { ok: false, reason: "cancelled", target };
  }

  let switched = false;
  let machine = readInstall(target);
  if (!opts.preserveMachine && needsNativeMachineInstall(machine, target)) {
    try {
      if (!stillHere()) {
        opts.log("ワークスペースが閉じられたため、更新を中止しました。");
        return { ok: false, reason: "cancelled", target };
      }
      await installRuntime();
      switched = true;
    } catch (cause) {
      if (!stillHere()) {
        await restoreActiveRuntime();
        return failureResult("cancelled");
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      opts.log(message);
      await restoreActiveRuntime();
      return failureResult("install-failed");
    }
    machine = readInstall(target);
  } else {
    opts.log(`本体 ${machine?.version} は導入済みです。プロジェクトを設定します…`);
  }
  if (machine === null || needsNativeMachineInstall(machine, target)) {
    opts.log("本体の配置を確認できません。公式手順でインストール先を確認してください。");
    if (switched) await restoreActiveRuntime();
    return failureResult("missing-binary");
  }
  let installed = machine;
  let pinned = false;
  let maybeApplied = false;

  const restore = async (restorePin: boolean): Promise<void> => {
    if (restorePin) {
      try {
        if (previousPin === null) await unpin(installed, opts.workspaceRoot, opts.log);
        else if (previousPin !== target)
          await pin(installed, opts.workspaceRoot, previousPin, opts.log);
        const restored = inspectPin(opts.workspaceRoot);
        if (previousPin === null ? restored.exists : restored.version !== previousPin)
          throw new Error("プロジェクトの固定バージョンの復元を確認できません。");
        recoverySucceeded();
      } catch (cause) {
        recoveryFailed(cause);
      }
    }
    // A failed pin rollback must not prevent restoring the machine's default runtime.
    await restoreActiveRuntime(installed);
  };
  const cancel = async (): Promise<NativeWorkflowsUpdateResult> => {
    opts.log("ワークスペースが閉じられたため、更新を中止しました。");
    if ((switched || pinned) && folderWritable() && !maybeApplied) await restore(pinned);
    return failureResult("cancelled");
  };

  try {
    if (!stillHere()) return await cancel();
    // Even an aborted activation may already have changed the machine default.
    if (!opts.preserveMachine) {
      switched = true;
      await activateRuntime(installed);
    }
  } catch (cause) {
    if (!stillHere()) return await cancel();
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!isIncompleteRetainedUseError(message)) {
      opts.log(message);
      await restoreActiveRuntime();
      return failureResult("use-failed");
    }
    opts.log("導入済みの本体が不完全なため、公式インストーラーで修復します…");
    try {
      if (!stillHere()) return await cancel();
      await installRuntime(true);
      switched = true;
    } catch (installCause) {
      if (!stillHere()) return await cancel();
      const installMessage =
        installCause instanceof Error ? installCause.message : String(installCause);
      opts.log(installMessage);
      await restoreActiveRuntime();
      return failureResult("install-failed");
    }
    machine = readInstall(target);
    if (machine === null || needsNativeMachineInstall(machine, target)) {
      opts.log("本体の配置を確認できません。公式手順でインストール先を確認してください。");
      await restoreActiveRuntime();
      return failureResult("missing-binary");
    }
    installed = machine;
    try {
      if (!stillHere()) return await cancel();
      await activateRuntime(installed);
      switched = true;
    } catch (retryCause) {
      if (!stillHere()) return await cancel();
      const retryMessage = retryCause instanceof Error ? retryCause.message : String(retryCause);
      opts.log(retryMessage);
      await restoreActiveRuntime();
      return failureResult("use-failed");
    }
  }

  try {
    if (!stillHere()) return await cancel();
    ensureStillHere();
    // A cancelled command may already have committed the pin before it exits.
    pinned = true;
    if (opts.signal)
      await pin(installed, opts.workspaceRoot, target, opts.log, undefined, forwardOptions);
    else await pin(installed, opts.workspaceRoot, target, opts.log);
  } catch (cause) {
    if (!stillHere()) return await cancel();
    const message = cause instanceof Error ? cause.message : String(cause);
    opts.log(message);
    await restore(pinned);
    return failureResult("pin-failed");
  }

  const problems: UpdateProblem[] = [];
  let preflightFailed = false;
  const configureHarness = async (
    harness: (typeof opts.selected)[number],
    previewOnly: boolean,
  ) => {
    const source = gitignoreConfigSource(installed, harness, opts.selected);
    try {
      return await configure(installed, opts.workspaceRoot, harness, opts.log, undefined, {
        mcp: "preserve",
        ...forwardOptions,
        previewOnly,
        sourceRoot: source.sourceRoot,
        ...(previewOnly
          ? {}
          : {
              onApplyStart: () => {
                maybeApplied = true;
              },
            }),
        ...(opts.isCurrent ? { isCurrent: opts.isCurrent } : {}),
      });
    } finally {
      await source.discard();
    }
  };
  for (const harness of opts.selected) {
    try {
      if (!stillHere()) return await cancel();
      await configureHarness(harness, true);
    } catch (cause) {
      if (!stillHere()) return await cancel();
      const message = cause instanceof Error ? cause.message : String(cause);
      opts.log(`${harness} の設定確認に失敗しました: ${message}`);
      opts.onHarnessResult?.({ id: harness, status: "failed", message });
      preflightFailed = true;
      if (cause instanceof NativeConfigConflict) problems.push(...cause.problems);
    }
  }
  if (preflightFailed) {
    await restore(true);
    return failureResult("preflight", problems);
  }

  const failed: HarnessId[] = [];
  // Each apply plans again: earlier tools may legitimately change shared root files,
  // invalidating the tokens from the all-tools preflight above.
  for (const harness of opts.selected) {
    try {
      if (!stillHere()) return await cancel();
      opts.onHarnessResult?.({ id: harness, status: "updating", message: "更新中" });
      const result = await configureHarness(harness, false);
      if (!stillHere()) return await cancel();
      const diagnosticDetails = result.doctorReport
        ? formatDoctorDetailsForLog(result.doctorReport)
        : result.details;
      if (diagnosticDetails.trim()) opts.log(`${harness} の診断結果:\n${diagnosticDetails}`);
      if (!result.doctorOk) {
        opts.log(
          `${harness} を設定しました。診断に追加の対応項目があります。詳細を確認してください。`,
        );
      }
      opts.onHarnessResult?.({
        id: harness,
        status: "completed",
        message: "設定反映済み。全ツールの最終確認を待っています。",
      });
    } catch (cause) {
      if (!stillHere()) return await cancel();
      const message = cause instanceof Error ? cause.message : String(cause);
      opts.log(`${harness} の設定に失敗しました: ${message}`);
      failed.push(harness);
      opts.onHarnessResult?.({ id: harness, status: "failed", message });
    }
  }
  if (failed.length === opts.selected.length && !maybeApplied) await restore(true);
  if (failed.length > 0) {
    return failureResult(failed.join(", "));
  }
  return { ok: true, target };
}
