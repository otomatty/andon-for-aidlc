import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { canonicalPath } from "@andon/core-utils";
import {
  type CustomizationEngine,
  CustomizationError,
  createCustomizationEngine,
} from "@andon/api-core";
import type { CustomizationFileChange } from "@andon/shared-types";

type NativeChange = { rel: string; before: Buffer | null; after: Buffer | null; mode: number };
export type NativeCustomizationPlan = {
  id: string;
  token: string;
  configurationRevision: string;
  engine: CustomizationEngine;
};
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
type EngineInstallPlan = {
  id: string;
  configurationRevision: string;
  files: CustomizationFileChange[];
  canApply: boolean;
  diagnostics: Array<{ severity: string; message: string }>;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);

function installPlan(value: unknown): EngineInstallPlan {
  if (
    !record(value) ||
    !text(value.id) ||
    !value.id ||
    !text(value.configurationRevision) ||
    !value.configurationRevision ||
    typeof value.canApply !== "boolean" ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.some(
      (entry) =>
        !record(entry) ||
        !["error", "warning", "info"].includes(String(entry.severity)) ||
        !text(entry.message),
    ) ||
    !Array.isArray(value.files) ||
    value.files.some(
      (file) =>
        !record(file) ||
        !text(file.relativePath) ||
        !file.relativePath ||
        !nullableText(file.beforeHash) ||
        !nullableText(file.afterHash) ||
        !Array.isArray(file.itemIds) ||
        !file.itemIds.every(text) ||
        (file.before !== undefined && !text(file.before)) ||
        (file.after !== undefined && !text(file.after)) ||
        (file.generated !== undefined && typeof file.generated !== "boolean"),
    )
  )
    throw new CustomizationError(
      "engine-invalid-response",
      "エンジンの更新計画を読み取れません。対応するエンジンのバージョンを確認してください。",
      502,
    );
  return value as EngineInstallPlan;
}

async function installed(root: string, relative: string): Promise<boolean> {
  let current = await canonicalPath(root);
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("リンクされたカスタマイズ設定は更新できません。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return (await lstat(current)).isFile();
}

/** Native setup supplies server-generated candidates; browser request bodies never enter here. */
export async function planNativeCustomization(
  root: string,
  changes: NativeChange[],
  makeEngine: (root: string) => CustomizationEngine = createCustomizationEngine,
): Promise<NativeCustomizationPlan | null> {
  if (!(await usesCustomizationEngine(root))) return null;
  const engine = makeEngine(root);
  const result = installPlan(
    await engine.call<unknown>("install-plan", {
      schemaVersion: 1,
      installationFiles: changes.map((change) => ({
        relativePath: change.rel,
        beforeHash: change.before === null ? null : digest(change.before),
        afterBase64: change.after === null ? null : change.after.toString("base64"),
        mode: change.mode,
      })),
    }),
  );
  if (!result.canApply)
    throw new Error(
      result.diagnostics
        .filter((entry) => entry.severity === "error")
        .map((entry) => entry.message)
        .join("\n") || "設定を更新できません。進行中の作業とエンジンの対応状況を確認してください。",
    );
  const token = digest(
    JSON.stringify({
      revision: result.configurationRevision,
      files: result.files.map(({ relativePath, beforeHash, afterHash }) => ({
        relativePath,
        beforeHash,
        afterHash,
      })),
    }),
  );
  return { id: result.id, token, configurationRevision: result.configurationRevision, engine };
}

/** Recheck under the legacy lock so an intervening engine install cannot be overwritten. */
export async function usesCustomizationEngine(root: string): Promise<boolean> {
  let available = false;
  for (const harness of [".claude", ".cursor", ".codex", ".aidlc", ".kiro"])
    if (await installed(root, `${harness}/tools/aidlc-customization.ts`)) {
      available = true;
      break;
    }
  if (!available) {
    if (
      (await installed(root, "aidlc/guide-customization/manifest.json")) ||
      (await installed(root, "aidlc/.aidlc-customization/pending.json"))
    )
      throw new Error(
        "カスタマイズの保護に対応するエンジンがありません。復旧または対応バージョンの導入を先に行ってください。",
      );
    return false;
  }
  return true;
}

export async function applyNativeCustomization(plan: NativeCustomizationPlan): Promise<void> {
  const result = await plan.engine.call<{ status: string }>("apply", {
    schemaVersion: 1,
    requestId: `${Date.now()}-${randomUUID()}`,
    planId: plan.id,
    expectedConfigurationRevision: plan.configurationRevision,
  });
  if (result.status !== "committed")
    throw new Error("設定更新の復旧が必要です。カスタマイズ画面で結果を確認してください。");
}
