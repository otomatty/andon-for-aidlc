import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { canonicalPath } from "@andon/reader-core";
import type { CustomizationItem } from "@andon/shared-types";
import { CustomizationError, object } from "./model.ts";

export type EngineAction =
  | "capabilities"
  | "catalog"
  | "validate"
  | "plan"
  | "apply"
  | "recover"
  | "export"
  | "install-plan";
export type EngineRequest = {
  installationFiles?: Array<{
    relativePath: string;
    beforeHash: string | null;
    afterBase64: string | null;
    mode?: number;
  }>;
  schemaVersion: 1;
  requestId?: string;
  spaceId?: string;
  items?: CustomizationItem[];
  removedItemIds?: string[];
  expectedConfigurationRevision?: string;
  planId?: string;
  transactionId?: string;
  format?: "guide" | "plugin";
  name?: string;
  version?: string;
  selectedItemIds?: string[];
  harnesses?: string[];
};
export interface CustomizationEngine {
  call<T>(action: EngineAction, request: EngineRequest): Promise<T>;
}

/** Only the engine receives formal apply/recovery requests. Guide has no settings writer. */
export function createCustomizationEngine(root: string): CustomizationEngine {
  return {
    async call<T>(action: EngineAction, request: EngineRequest): Promise<T> {
      let script: string | null = null;
      const workspace = await canonicalPath(root);
      for (const harness of [".claude", ".cursor", ".codex", ".aidlc", ".kiro"]) {
        const candidate = path.join(workspace, harness, "tools", "aidlc-customization.ts");
        try {
          let current = workspace;
          for (const part of [harness, "tools", "aidlc-customization.ts"]) {
            current = path.join(current, part);
            if ((await lstat(current)).isSymbolicLink())
              throw new CustomizationError(
                "external-settings-root",
                "リンクされた設定からエンジンを起動できません。",
                409,
              );
          }
          const info = await lstat(candidate);
          if (info.isFile() && !info.isSymbolicLink()) {
            script = candidate;
            break;
          }
        } catch (error) {
          if (error instanceof CustomizationError) throw error;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw new CustomizationError(
              "engine-unavailable",
              "エンジンの設定を読み取れません。",
              503,
            );
        }
      }
      if (!script)
        throw new CustomizationError(
          "engine-capability-missing",
          "設定の保存にはカスタマイズに対応するエンジンが必要です。",
          409,
        );
      const output = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          "bun",
          [script, action, "--project-dir", root],
          { cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 150 * 1024 * 1024 },
          (error, stdout) => {
            // A failed engine operation still returns a structured error on stdout.
            if (stdout.trim()) resolve(stdout);
            else
              reject(
                new CustomizationError(
                  "engine-unavailable",
                  error
                    ? "エンジンを実行できません。Bunの実行環境と設定を確認してください。"
                    : "エンジンの応答がありません。",
                  503,
                ),
              );
          },
        );
        // The process callback owns completion, including structured failures on stdout.
        child.stdin?.on("error", () => {});
        child.stdin?.end(JSON.stringify(request));
      });
      let response: unknown;
      try {
        response = JSON.parse(output);
      } catch {
        throw new CustomizationError(
          "engine-invalid-response",
          "エンジンの応答を読み取れません。",
          502,
        );
      }
      if (!object(response))
        throw new CustomizationError("engine-invalid-response", "エンジンの応答が不正です。", 502);
      if (response.ok === true && Object.hasOwn(response, "data")) return response.data as T;
      const error = object(response.error) ? response.error : {};
      throw new CustomizationError(
        typeof error.code === "string" ? error.code : "engine-failed",
        typeof error.message === "string" ? error.message : "エンジン処理に失敗しました。",
        409,
      );
    },
  };
}
