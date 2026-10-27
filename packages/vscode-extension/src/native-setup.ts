import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalPathSync } from "@aidlc-guide/core-utils";
import { WORKFLOWS_TARGET_VERSION } from "@aidlc-guide/shared-types";
import { type NativeDoctorReport, parseDoctorOutput } from "./doctor-output.ts";
import { CODEX_GIT_REQUIRED, isGitRepository } from "./git-prerequisite.ts";
import type { HarnessId } from "./harness-detect.ts";
import { configProblems, NativeConfigConflict } from "./workflows-conflicts.ts";
import {
  inspectProjectPin,
  installLocations,
  isReleaseId,
  type NativeInstall,
  type ProjectPinState,
  readNativeInstall,
} from "@aidlc-guide/reader-core";

/** Read-only resolution lives in reader-core so every surface checks the same engine. */
export { inspectProjectPin, installLocations, readNativeInstall };
export type { NativeInstall, ProjectPinState };

/** Compatibility name for the shared installation/update release. */
export const SETUP_RELEASE = WORKFLOWS_TARGET_VERSION;
export const INSTALL_GUIDE_URL = `https://github.com/awslabs/aidlc-workflows/releases/tag/v${SETUP_RELEASE}`;
const RELEASE_BASE = "https://github.com/awslabs/aidlc-workflows/releases";
const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * A retained version is complete only when the executable, version.json, and
 * runtime tree are all present. An interrupted installer can leave the binary
 * behind; `aidlc use` then fails closed instead of repairing.
 */
function isCompleteRetainedRelease(
  versionRoot: string,
  version: string,
  executable: string,
): boolean {
  try {
    if (!existsSync(executable) || !statSync(executable).isFile()) return false;
    if (process.platform !== "win32") accessSync(executable, constants.X_OK);
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(versionRoot, "version.json"), "utf8"),
    );
    if (
      manifest === null ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      !("schemaVersion" in manifest) ||
      !("version" in manifest) ||
      !("assets" in manifest)
    )
      return false;
    if (
      manifest.schemaVersion !== 1 ||
      manifest.version !== version ||
      !Array.isArray(manifest.assets)
    )
      return false;
    const digest = createHash("sha256").update(readFileSync(executable)).digest("hex");
    const assetMatches = manifest.assets.some((asset) => {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) return false;
      return "sha256" in asset && asset.sha256 === digest;
    });
    if (!assetMatches) return false;
    const runtime = path.join(versionRoot, "runtime");
    return existsSync(runtime) && statSync(runtime).isDirectory();
  } catch {
    return false;
  }
}

function retainedVersionRoot(version: string): string {
  return path.join(installLocations().root, "versions", version);
}

function retainedExecutablePath(version: string): string {
  return path.join(
    retainedVersionRoot(version),
    process.platform === "win32" ? "aidlc.exe" : "aidlc",
  );
}

/**
 * Move an incomplete (or, when `force` is set, any) retained version out of
 * `versions/<version>` so the official installer can recreate it. The
 * installer refuses an existing corrupt destination rather than replacing it.
 */
export function quarantineRetainedVersion(
  version: string,
  log: (message: string) => void,
  options: { force?: boolean } = {},
): boolean {
  if (!STRICT_VERSION.test(version)) return false;
  const dest = retainedVersionRoot(version);
  if (!existsSync(dest)) return false;
  if (!options.force && isCompleteRetainedRelease(dest, version, retainedExecutablePath(version)))
    return false;
  const recovery = path.join(
    installLocations().root,
    `.aidlc-recovery-${Date.now()}-${randomUUID()}`,
  );
  log(`不完全な本体 ${version} を隔離してから入れ直します…`);
  try {
    renameSync(dest, recovery);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`不完全な本体 ${version} を隔離できませんでした: ${message}`);
  }
  return true;
}

/** Resolve one installed version directory, independent of the active pointer. */
export function readVersionedNativeInstall(version: string): NativeInstall | null {
  if (!STRICT_VERSION.test(version)) return null;
  try {
    const executable = retainedExecutablePath(version);
    if (!isCompleteRetainedRelease(path.dirname(executable), version, executable)) return null;
    return {
      executable: canonicalPathSync(executable),
      version,
      binDir: installLocations().binDir,
    };
  } catch {
    return null;
  }
}

export type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
  failure?: "timeout" | "spawn" | "aborted" | "buffer" | "signal";
};
export type SetupRunner = (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  options?: { timeoutMs?: number },
) => Promise<ProcessResult>;

export const runSetupProcess: SetupRunner = async (
  command,
  args,
  cwd,
  env = process.env,
  signal,
  options = {},
) => {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    let result: ProcessResult | undefined;
    const child = execFile(
      command,
      args,
      {
        cwd,
        env,
        signal,
        windowsHide: true,
        timeout: options.timeoutMs ?? 600_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        result = {
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          // 診断出力がある場合は保持し、無出力の異常終了では実行エラーを補う。
          stderr:
            stderr || (error && (typeof error.code !== "number" || !stdout) ? error.message : ""),
        };
        if (error) {
          if (signal?.aborted) result.failure = "aborted";
          else if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") result.failure = "buffer";
          else if (error.killed) result.failure = "timeout";
          else if (typeof error.code === "string") result.failure = "spawn";
          else if (error.signal) result.failure = "signal";
        }
      },
    );
    // Abort reports an error before the child exits. Keep the folder busy until it has stopped.
    child.once("close", () =>
      resolve(
        result ?? { code: 1, stdout: "", stderr: "プロセスの実行結果を取得できませんでした。" },
      ),
    );
    child.stdin?.end();
  });
};

/**
 * JSON では省かれるワークフローの指摘も取得するため、通常出力で診断を1回実行する。
 * 実行失敗は診断結果に含め、キャンセル時や対象フォルダーが無効になった場合は中断する。
 */
export async function runNativeDoctor(
  install: NativeInstall,
  root: string,
  runner: SetupRunner = runSetupProcess,
  options: { signal?: AbortSignal; isCurrent?: () => boolean } = {},
): Promise<NativeDoctorReport> {
  const checkCurrent = () => {
    options.signal?.throwIfAborted();
    if (options.isCurrent && !options.isCurrent()) throw new Error("診断を中止しました。");
  };
  checkCurrent();
  const env: NodeJS.ProcessEnv = { ...nativeCommandEnv(install), NO_COLOR: "1" };
  let result: ProcessResult;
  try {
    result = await runner(
      install.executable,
      ["doctor", "--project-dir", root, "--verbose", "--no-color"],
      root,
      env,
      options.signal,
      { timeoutMs: 120_000 },
    );
  } catch (error) {
    checkCurrent();
    result = {
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      failure: "spawn",
    };
  }
  checkCurrent();
  return parseDoctorOutput(result, install.version);
}

/** Native config's own change lines (what changed, its undo, open work), in Japanese where known. */
export function translateConfigChange(line: string): string {
  let m = /^Updated\. Your open work \((.+)\) carries on\.$/.exec(line);
  if (m) return `更新しました。進行中の作業（${m[1]}）はそのまま続けられます。`;
  m = /^Added (\S+)\. Your open work \((.+)\) carries on\.$/.exec(line);
  if (m) return `${m[1]} を追加しました。進行中の作業（${m[2]}）はそのまま続けられます。`;
  m =
    /^To go back: (`[^`]+`) \(this pins the version for everyone on the project; (`[^`]+`) removes the pin\)\.$/.exec(
      line,
    );
  if (m)
    return `元に戻すには ${m[1]} を実行します（プロジェクトの全員に同じバージョンが固定されます。固定は ${m[2]} で解除できます）。`;
  m = /^To go back: get (\S+) and its \.sha256 into one folder, then run (`[^`]+`)\.$/.exec(line);
  if (m)
    return `元に戻すには ${m[1]} とその .sha256 を同じフォルダーに取得し、${m[2]} を実行します。`;
  m = /^To go back: (`[^`]+`)\.$/.exec(line);
  if (m) return `元に戻すには ${m[1]} を実行します。`;
  return line;
}

export function configChangeLines(stdout: string): string[] {
  let changes: unknown;
  try {
    changes = (JSON.parse(stdout.trim()) as { data?: { changes?: unknown } })?.data?.changes;
  } catch {
    return [];
  }
  if (!Array.isArray(changes)) return [];
  return changes
    .filter((line): line is string => typeof line === "string")
    .map(translateConfigChange);
}

function resultMessage(result: ProcessResult): string {
  try {
    const json = JSON.parse(result.stdout.trim());
    return (
      [json.message, json.remediation].filter((v) => typeof v === "string").join("\n") ||
      result.stdout
    );
  } catch {
    return [result.stdout, result.stderr].filter(Boolean).join("\n");
  }
}

export function nativeCommandEnv(install: NativeInstall): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${install.binDir}${path.delimiter}${env[pathKey] ?? ""}`;
  return env;
}

async function downloadSmall(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetchImpl(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new Error(`公式インストーラーの取得に失敗しました（HTTP ${response.status}）。`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 1024 * 1024) throw new Error("インストーラーのサイズが上限を超えています。");
  return bytes;
}

export function verifyInstaller(bytes: Uint8Array, checksums: string, filename: string): void {
  const rows = checksums
    .split(/\r?\n/)
    .filter((row) => row.slice(66) === filename && /^[a-f0-9]{64} {2}/.test(row));
  if (
    rows.length !== 1 ||
    rows[0]?.slice(0, 64) !== createHash("sha256").update(bytes).digest("hex")
  )
    throw new Error("公式インストーラーのチェックサムが一致しません。");
}

// install.ps1 2.11+ warns in a UAC-elevated window and stops a non-interactive run unless
// -Yes is passed. The Guide always runs it non-interactively, so it asks the person itself
// with the same warning, and passes -Yes only after an explicit answer.
export const UAC_ELEVATED_WARNING =
  "この VS Code は管理者として実行されています。AI-DLC はあなたのアカウントだけに導入するため管理者権限は不要です。管理者として導入すると安全性が下がり、あなたとして動いている別のプログラムが導入に干渉できます。";
export const UAC_ELEVATED_ADVICE =
  "最も安全なのは、ここで中止し、通常の（管理者ではない）VS Code から導入し直すことです。";

/** Asks whether to install from an elevated window anyway; absent means no one can answer. */
export type AdminInstallConfirm = (warning: string, advice: string) => Promise<boolean>;
let adminInstallConfirm: AdminInstallConfirm | undefined;
export function setAdminInstallConfirm(confirm: AdminInstallConfirm | undefined): void {
  adminInstallConfirm = confirm;
}

// TokenElevationType like install.ps1: 1 full token (built-in Administrator or UAC off),
// 2 the elevated half of a UAC split token, 3 the limited half. Not an administrator: 3.
// An administrator whose token cannot be read fails closed as 2, as upstream does.
const ELEVATION_PROBE = [
  "$p = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())",
  "if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { '3'; exit 0 }",
  "try {",
  "  Add-Type -Namespace AidlcGuide -Name Token -MemberDefinition '[DllImport(\"advapi32.dll\", SetLastError = true)] public static extern bool GetTokenInformation(IntPtr h, int c, out int v, int l, out int r);'",
  "  $id = [Security.Principal.WindowsIdentity]::GetCurrent(); $v = 0; $r = 0",
  "  if ([AidlcGuide.Token]::GetTokenInformation($id.Token, 18, [ref]$v, 4, [ref]$r)) { \"$v\" } else { '2' }",
  "} catch { '2' }",
].join("; ");

export async function readWindowsTokenElevation(
  runner: SetupRunner = runSetupProcess,
  signal?: AbortSignal,
): Promise<number> {
  const result = await runner(
    "powershell.exe",
    // An encoded command keeps the probe's quotes intact on Windows PowerShell's command line.
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(ELEVATION_PROBE, "utf16le").toString("base64"),
    ],
    tmpdir(),
    process.env,
    signal,
  );
  const value = Number.parseInt(result.stdout.trim(), 10);
  // A probe that does not answer cannot show the window is safe.
  return result.code === 0 && [1, 2, 3].includes(value) ? value : 2;
}

/** Throws unless the window is not UAC-elevated or the person chose to continue. */
export async function confirmElevatedInstall(
  elevation: number,
  log: (message: string) => void,
  confirm: AdminInstallConfirm | undefined = adminInstallConfirm,
): Promise<void> {
  if (elevation !== 2) return;
  if (!confirm) throw new Error(`${UAC_ELEVATED_WARNING}${UAC_ELEVATED_ADVICE}`);
  if (!(await confirm(UAC_ELEVATED_WARNING, UAC_ELEVATED_ADVICE)))
    throw new Error(
      "管理者としての導入を中止しました。通常の（管理者ではない）VS Code から導入し直してください。",
    );
  log(`警告: ${UAC_ELEVATED_WARNING}`);
}

export async function installNative(
  log: (message: string) => void,
  runner: SetupRunner = runSetupProcess,
  fetchImpl: typeof fetch = fetch,
  version: string = SETUP_RELEASE,
  options: {
    repair?: boolean;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    /** Windows only; defaults to the real token probe. */
    readElevation?: () => Promise<number>;
  } = {},
): Promise<void> {
  const checkCurrent = () => {
    options.signal?.throwIfAborted();
    if (options.isCurrent && !options.isCurrent()) throw new Error("インストールを中止しました。");
  };
  checkCurrent();
  if (!STRICT_VERSION.test(version)) throw new Error("導入するバージョンを解釈できません。");
  if (
    !(
      (process.platform === "win32" && process.arch === "x64") ||
      (["darwin", "linux"].includes(process.platform) && ["x64", "arm64"].includes(process.arch))
    )
  )
    throw new Error("この OS / CPU 向けの公式インストーラーはありません。");
  const filename = process.platform === "win32" ? "install.ps1" : "install.sh";
  const base = `${RELEASE_BASE}/download/v${version}`;
  log(`AI-DLC ${version} の公式インストーラーを取得しています…`);
  const [bytes, checksums] = await Promise.all([
    downloadSmall(`${base}/${filename}`, fetchImpl, options.signal),
    downloadSmall(`${base}/checksums.txt`, fetchImpl, options.signal),
  ]);
  checkCurrent();
  verifyInstaller(bytes, new TextDecoder().decode(checksums), filename);
  if (process.platform === "win32") {
    const elevation = await (
      options.readElevation ?? (() => readWindowsTokenElevation(undefined, options.signal))
    )();
    checkCurrent();
    await confirmElevatedInstall(elevation, log);
    checkCurrent();
  }
  quarantineRetainedVersion(version, log, { force: options.repair === true });
  const temporary = await mkdtemp(path.join(tmpdir(), "aidlc-guide-install-"));
  try {
    const script = path.join(temporary, filename);
    await writeFile(script, bytes);
    checkCurrent();
    log("本体と各ツール向けのランタイムをインストールしています。数分かかる場合があります…");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AIDLC_RELEASE_REPOSITORY: "awslabs/aidlc-workflows",
      AIDLC_RELEASE_BASE_URL: RELEASE_BASE,
      AIDLC_RELEASE_WORKFLOW: "awslabs/aidlc-workflows/.github/workflows/release.yml",
      AIDLC_GUIDE_INSTALL_SCRIPT: script,
      AIDLC_GUIDE_INSTALL_VERSION: version,
    };
    // PowerShell 7's inherited module path can hide Windows PowerShell's built-in Get-FileHash.
    for (const key of Object.keys(env)) if (key.toLowerCase() === "psmodulepath") delete env[key];
    const result =
      process.platform === "win32"
        ? await runner(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-Command",
              "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; & $env:AIDLC_GUIDE_INSTALL_SCRIPT -Version $env:AIDLC_GUIDE_INSTALL_VERSION -Yes -Json; exit $LASTEXITCODE",
            ],
            temporary,
            env,
            options.signal,
          )
        : await runner(
            "/bin/sh",
            [script, "--version", version, "--yes", "--json"],
            temporary,
            env,
            options.signal,
          );
    checkCurrent();
    log(resultMessage(result));
    if (result.code !== 0)
      throw new Error(resultMessage(result) || "本体のインストールに失敗しました。");
  } finally {
    // Only the unique temporary directory created above is removed.
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * Keep another release on this machine beside the default, for reading its
 * official files. The installer may move the default; it is moved back.
 */
export async function installRetainedNative(
  version: string,
  log: (message: string) => void,
  options: { signal?: AbortSignal; isCurrent?: () => boolean } = {},
): Promise<NativeInstall> {
  const existing = readVersionedNativeInstall(version);
  if (existing) return existing;
  const previous = readNativeInstall();
  try {
    await installNative(log, undefined, undefined, version, options);
  } finally {
    // Restore even when cancelled: the default is the person's choice.
    if (previous && readNativeInstall()?.version !== previous.version)
      await useNative(previous, previous.version, log);
  }
  if (previous && readNativeInstall()?.version !== previous.version)
    throw new Error(`既定のバージョン ${previous.version} への復元を確認できません。`);
  const installed = readVersionedNativeInstall(version);
  if (!installed) throw new Error(`本体 ${version} を確認できません。`);
  return installed;
}

export async function useNative(
  install: NativeInstall,
  version: string,
  log: (message: string) => void,
  runner: SetupRunner = runSetupProcess,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  // A preview the person chose is restored as it was; the Guide itself only installs stable releases.
  if (!isReleaseId(version)) throw new Error("切り替えるバージョンを解釈できません。");
  options.signal?.throwIfAborted();
  log(`本体 ${version} をこのマシンの既定バージョンにします…`);
  const result = await runner(
    install.executable,
    ["use", version],
    install.binDir,
    nativeCommandEnv(install),
    options.signal,
  );
  log(resultMessage(result));
  if (result.code !== 0) throw new Error(resultMessage(result) || "本体の切り替えに失敗しました。");
}

export async function pinNative(
  install: NativeInstall,
  root: string,
  version: string,
  log: (message: string) => void,
  runner: SetupRunner = runSetupProcess,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  if (!STRICT_VERSION.test(version)) throw new Error("固定するバージョンを解釈できません。");
  options.signal?.throwIfAborted();
  log(`プロジェクトを本体 ${version} に固定します…`);
  const result = await runner(
    install.executable,
    ["config", "--pin", version, "--project-dir", root],
    root,
    nativeCommandEnv(install),
    options.signal,
  );
  log(resultMessage(result));
  if (result.code !== 0)
    throw new Error(resultMessage(result) || "プロジェクトのバージョンの固定に失敗しました。");
}

export function readProjectPin(root: string): string | null {
  return inspectProjectPin(root).version;
}

export async function unpinNative(
  install: NativeInstall,
  root: string,
  log: (message: string) => void,
  runner: SetupRunner = runSetupProcess,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  log("プロジェクトのバージョンの固定を解除します…");
  const result = await runner(
    install.executable,
    ["config", "--unpin", "--project-dir", root],
    root,
    nativeCommandEnv(install),
    options.signal,
  );
  log(resultMessage(result));
  if (result.code !== 0)
    throw new Error(
      resultMessage(result) || "プロジェクトのバージョンの固定の解除に失敗しました。",
    );
}

export type NativeConfigureResult = {
  doctorOk: boolean;
  details: string;
  planToken?: string;
  /** Absent for preview-only requests, which do not run doctor. */
  doctorReport?: NativeDoctorReport;
};

export type ConfigureNativeOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  mcp?: "none" | "preserve";
  previewOnly?: boolean;
  planToken?: string;
  onApplyStart?: () => void;
  /** Exact installed projection, used when an isolated candidate has no project pin. */
  sourceRoot?: string;
};

/**
 * 設定計画を確認して適用し、適用後の診断結果を返す。previewOnly では適用も診断もしない。
 * ログには診断の要約を送り、呼び出し元の画面は doctorReport または details を表示する。
 */
export async function configureNative(
  install: NativeInstall,
  root: string,
  harness: HarnessId,
  log: (message: string) => void,
  runner: SetupRunner = runSetupProcess,
  options: ConfigureNativeOptions = {},
): Promise<NativeConfigureResult> {
  const { signal, isCurrent, mcp = "none", previewOnly = false, planToken } = options;
  if (previewOnly && planToken !== undefined)
    throw new Error("設定の確認と適用を同時には指定できません。");
  const checkCurrent = () => {
    signal?.throwIfAborted();
    if (isCurrent && !isCurrent()) throw new Error("プロジェクトの設定を中止しました。");
  };
  checkCurrent();
  if (harness === "codex") {
    const gitReady = await isGitRepository(root, signal);
    checkCurrent();
    if (!gitReady) throw new Error(CODEX_GIT_REQUIRED);
  }
  const args = ["config", "--project-dir", root, "--harness", harness];
  if (options.sourceRoot) args.push("--from", options.sourceRoot);
  switch (mcp) {
    case "preserve":
      break;
    case "none":
      args.push("--mcp", "none");
      break;
    default: {
      const _never: never = mcp;
      throw new Error(`未対応の MCP 指定です: ${_never}`);
    }
  }
  const env = nativeCommandEnv(install);
  let token = planToken;
  if (token === undefined) {
    log("プロジェクトへの設定内容を確認しています…");
    checkCurrent();
    const preview = await runner(
      install.executable,
      [...args, "--dry-run", "--json"],
      root,
      env,
      signal,
    );
    checkCurrent();
    if (preview.code !== 0) {
      const problems = configProblems(preview.stdout, harness);
      if (problems.length) throw new NativeConfigConflict(problems);
      throw new Error(resultMessage(preview));
    }
    const plan: unknown = JSON.parse(preview.stdout.trim());
    const previewToken = (plan as { data?: { planToken?: unknown } })?.data?.planToken;
    if (typeof previewToken !== "string" || previewToken.length === 0)
      throw new Error("設定計画を取得できませんでした。");
    token = previewToken;
    if (previewOnly) return { doctorOk: true, details: resultMessage(preview), planToken: token };
  } else if (token.length === 0) {
    throw new Error("設定計画を取得できませんでした。");
  }
  log("選択したツール向けにプロジェクトを設定しています…");
  checkCurrent();
  options.onApplyStart?.();
  const applied = await runner(
    install.executable,
    [...args, "--plan-token", token, "--json"],
    root,
    env,
    signal,
  );
  checkCurrent();
  log(resultMessage(applied));
  if (applied.code !== 0) throw new Error(resultMessage(applied));
  for (const line of configChangeLines(applied.stdout)) log(line);
  log("設定後の環境を診断しています…");
  checkCurrent();
  const doctorReport = await runNativeDoctor(install, root, runner, options);
  checkCurrent();
  log(doctorReport.summary);
  return {
    doctorOk: doctorReport.outcome === "ok" || doctorReport.outcome === "warning",
    details: doctorReport.rawOutput,
    doctorReport,
    planToken: token,
  };
}
