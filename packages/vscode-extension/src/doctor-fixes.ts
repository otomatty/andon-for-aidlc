import path from "node:path";
import type { NativeDoctorCheck } from "./doctor-output.ts";
import type { HarnessId } from "./harness-detect.ts";
import {
  type NativeInstall,
  nativeCommandEnv,
  readNativeInstall,
  runSetupProcess,
  type SetupRunner,
} from "./native-setup.ts";
import { acquireWorkflowsOperation, WORKFLOWS_BUSY_MESSAGE } from "./workflows-operation.ts";
import { harnessVersionRel } from "./workflows-version.ts";

/**
 * A Doctor fix the Guide runs itself. Only fixes that change nothing the
 * person wrote are listed; any other fix stays a sentence to follow.
 */
export type DoctorFix = { kind: "plugin-sync"; label: string };

/** The fix the Guide can run for one Doctor row, or null when the person follows it by hand. */
export function doctorFixFor(check: NativeDoctorCheck): DoctorFix | null {
  if (check.status === "ok") return null;
  const fix = (check.originalFix ?? "").trim();
  if (/^run:? `?(?:aidlc|bun \S*aidlc\.ts) engine plugin sync`?$/.test(fix))
    return { kind: "plugin-sync", label: "プラグインの構成をそろえる" };
  return null;
}

/** Run one listed Doctor fix for one tool with the project's own engine. */
export async function runDoctorFix(
  root: string,
  harness: HarnessId,
  fix: DoctorFix,
  log: (line: string) => void,
  signal?: AbortSignal,
  runner: SetupRunner = runSetupProcess,
  install: NativeInstall | null = readNativeInstall(root),
): Promise<void> {
  if (!install)
    throw new Error(
      "このプロジェクトで使う aidlc を確認できません。セットアップで準備してください。",
    );
  const harnessDir = path.dirname(path.dirname(harnessVersionRel(harness)));
  // Plugin sync rewrites project files: one operation per project, as for updates and Doctor.
  const release = acquireWorkflowsOperation(root);
  if (!release) throw new Error(WORKFLOWS_BUSY_MESSAGE);
  let result: Awaited<ReturnType<SetupRunner>>;
  try {
    log(`${fix.label}：aidlc engine plugin sync を実行しています…`);
    result = await runner(
      install.executable,
      ["engine", "plugin", "sync", "--project-dir", root, "--harness-dir", harnessDir, "--json"],
      root,
      { ...nativeCommandEnv(install), AIDLC_HARNESS_DIR: harnessDir, NO_COLOR: "1" },
      signal,
    );
  } finally {
    release();
  }
  let message = "";
  try {
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (parsed && typeof parsed === "object" && "message" in parsed)
      message = String((parsed as { message: unknown }).message);
  } catch {
    message = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  }
  if (message) log(message);
  if (result.code !== 0) throw new Error(message || "プラグインの構成をそろえられませんでした。");
}
