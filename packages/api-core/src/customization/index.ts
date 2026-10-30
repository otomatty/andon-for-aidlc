import { randomUUID } from "node:crypto";
import type {
  CustomizationCatalog,
  CustomizationDiagnostic,
  CustomizationExport,
  CustomizationFileChange,
  CustomizationImportSelection,
  CustomizationOperation,
  CustomizationRequestReceipt,
  CustomizationValidation,
} from "@andon/shared-types";
import { readCompatibilityCatalog } from "./catalog.ts";
import {
  type CustomizationEngine,
  createCustomizationEngine,
  type EngineRequest,
} from "./engine-adapter.ts";
import {
  applyChanges,
  CustomizationError,
  digest,
  fail,
  identifier,
  localDiagnostics,
  localIdentifier,
  object,
  parseChanges,
} from "./model.ts";
import { CustomizationPackages, type CustomizationSnapshot, guideExport } from "./packages.ts";
import { CustomizationStorage } from "./storage.ts";

type EnginePlan = {
  id: string;
  configurationRevision: string;
  files: (CustomizationFileChange & { content?: string })[];
  diagnostics: CustomizationDiagnostic[];
  canApply: boolean;
};
type EngineApplied = {
  transactionId?: string;
  status: "committed" | "rolled-back" | "recovery-required" | "nothing-to-recover";
  configurationRevision: string;
  diagnostics?: CustomizationDiagnostic[];
};
type ApplyReceipt = {
  hash: string;
  operation: CustomizationOperation;
  planId: string;
  spaceId: string;
};

export type CustomizationServiceConfig = {
  workspaceRoot: string;
  engine?: CustomizationEngine;
  /** Injected by hosts; a failed permission check never destroys stored edits. */
  canEdit?: () => boolean;
  onChange?: () => void;
};

export class CustomizationService {
  readonly storage: CustomizationStorage;
  readonly packages: CustomizationPackages;
  readonly engine: CustomizationEngine;
  constructor(readonly config: CustomizationServiceConfig) {
    this.storage = new CustomizationStorage(config.workspaceRoot);
    this.packages = new CustomizationPackages(this.storage);
    this.engine = config.engine ?? createCustomizationEngine(config.workspaceRoot);
  }
  assertEditable(): void {
    if (this.config.canEdit?.() === false)
      fail("workspace-untrusted", "信頼されていないワークスペースでは編集できません。", 403);
  }
  async catalog(spaceId?: string): Promise<CustomizationCatalog> {
    if (spaceId !== undefined && !identifier(spaceId))
      return fail("bad-request", "spaceが不正です。");
    if (this.config.canEdit?.() === false)
      return await readCompatibilityCatalog(this.config.workspaceRoot, spaceId);
    try {
      const catalog = await this.engine.call<CustomizationCatalog>("catalog", {
        schemaVersion: 1,
        ...(spaceId ? { spaceId } : {}),
      });
      if (!Array.isArray(catalog.items) || typeof catalog.configurationRevision !== "string")
        throw new CustomizationError(
          "engine-invalid-response",
          "エンジンの設定一覧が不正です。",
          502,
        );
      return catalog;
    } catch (error) {
      if (
        !(error instanceof CustomizationError) ||
        !["engine-capability-missing", "engine-unavailable"].includes(error.code)
      )
        throw error;
      return await readCompatibilityCatalog(this.config.workspaceRoot, spaceId);
    }
  }
  async item(id: string): Promise<CustomizationCatalog["items"][number]> {
    const catalog = await this.catalog();
    return (
      catalog.items.find((item) => item.id === id) ??
      fail("item-not-found", "項目が見つかりません。", 404)
    );
  }
  private async snapshot(body: Record<string, unknown>): Promise<CustomizationSnapshot> {
    this.assertEditable();
    if (!identifier(body.spaceId) || typeof body.expectedConfigurationRevision !== "string")
      return fail("bad-request", "対象スペースと設定のバージョンを指定してください。");
    const catalog = await this.catalog(body.spaceId);
    if (catalog.configurationRevision !== body.expectedConfigurationRevision)
      return fail(
        "configuration-changed",
        "設定が別の画面で更新されました。現在の設定と比較してください。",
        409,
      );
    const items = applyChanges(catalog.items, parseChanges(body.changes));
    return {
      spaceId: catalog.spaceId,
      engineVersion: catalog.engineVersion,
      baseConfigurationRevision: catalog.configurationRevision,
      baseItems: catalog.items,
      items,
      removedItemIds: catalog.items
        .filter((item) => !items.some((next) => next.id === item.id))
        .map((item) => item.id),
    };
  }
  private engineRequest(snapshot: CustomizationSnapshot): EngineRequest {
    const base = new Map(snapshot.baseItems.map((item) => [item.id, JSON.stringify(item)]));
    return {
      schemaVersion: 1,
      spaceId: snapshot.spaceId,
      items: snapshot.items.filter((item) => base.get(item.id) !== JSON.stringify(item)),
      removedItemIds: snapshot.removedItemIds,
      expectedConfigurationRevision: snapshot.baseConfigurationRevision,
    };
  }
  /** Validates unsaved changes as a save would, without planning or writing them. */
  async check(body: Record<string, unknown>): Promise<CustomizationValidation> {
    const snapshot = await this.snapshot(body);
    const local = localDiagnostics(snapshot.items);
    if (local.some((entry) => entry.severity === "error"))
      return { valid: false, diagnostics: local };
    try {
      return await this.engine.call<CustomizationValidation>(
        "validate",
        this.engineRequest(snapshot),
      );
    } catch (error) {
      if (
        !(error instanceof CustomizationError) ||
        !["engine-capability-missing", "engine-unavailable"].includes(error.code)
      )
        throw error;
      return {
        valid: true,
        diagnostics: [{ severity: "warning", code: error.code, message: error.message }],
      };
    }
  }
  async save(body: Record<string, unknown>): Promise<CustomizationOperation> {
    this.assertEditable();
    if (!localIdentifier(body.requestId)) return fail("bad-request", "保存操作のIDが不正です。");
    const requestId = body.requestId;
    const requestHash = digest(JSON.stringify(body));
    return await this.storage.withLock("apply", async () => {
      const existing = await this.storage.readJson<ApplyReceipt>(`requests/${requestId}.json`);
      if (existing && existing.hash !== requestHash)
        return fail("request-id-conflict", "同じrequest IDに異なる入力があります。", 409);
      if (existing) return await this.recoverReceipt(existing);
      if (await this.activeOperation())
        return fail("operation-active", "中断した保存の結果を確認してください。", 409);
      const snapshot = await this.snapshot(body);
      const local = localDiagnostics(snapshot.items);
      if (local.some((entry) => entry.severity === "error"))
        throw new CustomizationError(
          "validation-failed",
          "入力内容を確認してください。",
          409,
          local,
        );
      const request = this.engineRequest(snapshot);
      const validation = await this.engine.call<CustomizationValidation>("validate", request);
      if (!validation.valid || validation.diagnostics.some((entry) => entry.severity === "error"))
        throw new CustomizationError(
          "validation-failed",
          "設定の整合性を確認してください。",
          409,
          validation.diagnostics,
        );
      const plan = await this.engine.call<EnginePlan>("plan", request);
      if (!plan.canApply || plan.diagnostics.some((entry) => entry.severity === "error"))
        throw new CustomizationError(
          "validation-failed",
          "設定を保存できません。",
          409,
          plan.diagnostics,
        );
      if (
        !localIdentifier(plan.id) ||
        plan.configurationRevision !== snapshot.baseConfigurationRevision
      )
        return fail(
          "configuration-changed",
          "保存の準備中に設定が変わりました。現在の設定と比較してください。",
          409,
        );
      const operation: CustomizationOperation = {
        id: randomUUID(),
        requestId,
        status: "running",
        kind: "apply",
      };
      const receipt: ApplyReceipt = {
        hash: requestHash,
        operation,
        planId: plan.id,
        spaceId: snapshot.spaceId,
      };
      // Persist only transaction receipts, never editable or resumable drafts.
      await this.storeReceipt(receipt);
      await this.storage.writeJson("apply-running.json", {
        active: true,
        requestId,
        operationId: operation.id,
      });
      try {
        const result = await this.engine.call<EngineApplied>("apply", {
          schemaVersion: 1,
          requestId,
          planId: plan.id,
          expectedConfigurationRevision: plan.configurationRevision,
        });
        if (result.status !== "committed" && result.status !== "rolled-back")
          throw new CustomizationError("recovery-required", "保存結果の確認が必要です。", 409);
        await this.finishReceipt(receipt, result);
      } catch (error) {
        if (
          !(error instanceof CustomizationError) ||
          ["engine-unavailable", "engine-invalid-response", "recovery-required"].includes(
            error.code,
          )
        ) {
          operation.status = "running";
          operation.message = "保存結果を確認できません。同じ操作を再照会してください。";
          operation.error = { code: "recovery-required", message: operation.message };
          operation.recoveryRequired = true;
        } else {
          operation.status = "failed";
          operation.error = { code: error.code, message: error.message };
        }
      }
      await this.storeReceipt(receipt);
      if (operation.status === "failed")
        await this.storage.writeJson("apply-running.json", { active: false, requestId });
      this.config.onChange?.();
      return operation;
    });
  }
  async operation(id: string): Promise<CustomizationOperation> {
    this.assertEditable();
    if (!localIdentifier(id)) return fail("bad-request", "操作IDが不正です。");
    const operation =
      (await this.storage.readJson<CustomizationOperation>(`operations/${id}.json`)) ??
      fail("operation-not-found", "操作が見つかりません。", 404);
    return { ...operation, ...(operation.status === "running" ? { recoveryRequired: true } : {}) };
  }
  async activeOperation(): Promise<CustomizationOperation | null> {
    this.assertEditable();
    const active = await this.storage.readJson<{ active: boolean; requestId: string }>(
      "apply-running.json",
    );
    if (!active?.active) return null;
    const receipt = await this.storage.readJson<ApplyReceipt>(`requests/${active.requestId}.json`);
    return receipt ? { ...receipt.operation, recoveryRequired: true } : null;
  }
  async request(id: string): Promise<CustomizationRequestReceipt | null> {
    this.assertEditable();
    if (!localIdentifier(id)) return fail("bad-request", "request IDが不正です。");
    const applied = await this.storage.readJson<ApplyReceipt>(`requests/${id}.json`);
    if (applied)
      return {
        requestId: id,
        kind: "apply",
        status: applied.operation.status,
        operation: {
          ...applied.operation,
          ...(applied.operation.status === "running" ? { recoveryRequired: true } : {}),
        },
      };
    return null;
  }
  private async storeReceipt(receipt: ApplyReceipt): Promise<void> {
    await this.storage.writeJson(`operations/${receipt.operation.id}.json`, receipt.operation);
    await this.storage.writeJson(`requests/${receipt.operation.requestId}.json`, receipt);
  }
  private async finishReceipt(receipt: ApplyReceipt, result: EngineApplied): Promise<void> {
    const operation = receipt.operation;
    if (result.status === "committed") {
      operation.status = "completed";
      operation.message = "設定を保存しました。";
      operation.configurationRevision = result.configurationRevision;
      operation.transactionId = result.transactionId;
      delete operation.error;
    } else {
      operation.status = "failed";
      operation.message =
        result.status === "rolled-back"
          ? "保存を取り消し、元の設定に復旧しました。入力内容を確認して再保存してください。"
          : "保存は開始されていません。入力内容を確認して再保存してください。";
      operation.error = {
        code: result.status === "rolled-back" ? "apply-rolled-back" : "apply-not-started",
        message: operation.message,
      };
    }
    operation.recoveryRequired = false;
    // Persist the result before unfreezing edits. Repeating cleanup is safe across crashes.
    await this.storeReceipt(receipt);
    const active = await this.storage.readJson<{ active: boolean; requestId: string }>(
      "apply-running.json",
    );
    if (active?.active && active.requestId === operation.requestId)
      await this.storage.writeJson("apply-running.json", {
        active: false,
        requestId: operation.requestId,
      });
  }
  private async recoverReceipt(receipt: ApplyReceipt): Promise<CustomizationOperation> {
    try {
      if (receipt.operation.status !== "running") {
        const active = await this.storage.readJson<{ active: boolean; requestId: string }>(
          "apply-running.json",
        );
        if (active?.active && active.requestId === receipt.operation.requestId)
          await this.storage.writeJson("apply-running.json", {
            active: false,
            requestId: active.requestId,
          });
        return receipt.operation;
      }
      const result = await this.engine.call<EngineApplied>("recover", {
        schemaVersion: 1,
        requestId: receipt.operation.requestId,
        transactionId: receipt.operation.transactionId,
      });
      if (result.status === "recovery-required")
        throw new CustomizationError(
          "recovery-required",
          "エンジン側の復旧を完了できませんでした。",
          409,
        );
      await this.finishReceipt(receipt, result);
    } catch (error) {
      receipt.operation.status = "running";
      receipt.operation.recoveryRequired = true;
      receipt.operation.error = {
        code: "recovery-required",
        message: error instanceof Error ? error.message : "復旧状況を確認できません。",
      };
      await this.storeReceipt(receipt);
    }
    this.config.onChange?.();
    return receipt.operation;
  }
  async recover(body: Record<string, unknown>): Promise<CustomizationOperation> {
    this.assertEditable();
    if (!localIdentifier(body.operationId))
      return fail("bad-request", "復旧する操作IDが不正です。");
    return await this.storage.withLock("apply", async () => {
      const operation = await this.operation(String(body.operationId));
      const receipt = await this.storage.readJson<ApplyReceipt>(
        `requests/${operation.requestId}.json`,
      );
      if (!receipt) return fail("operation-not-found", "適用操作の記録がありません。", 404);
      return await this.recoverReceipt(receipt);
    });
  }
  async export(body: Record<string, unknown>): Promise<CustomizationExport> {
    const snapshot = await this.snapshot(body);
    if (!Array.isArray(body.selectedItemIds) || !body.selectedItemIds.every(identifier))
      return fail("bad-request", "書き出す項目を選択してください。");
    if (body.format === "guide") {
      const output = guideExport(
        snapshot,
        body.selectedItemIds,
        typeof body.name === "string" ? body.name : undefined,
        typeof body.version === "string" ? body.version : undefined,
      );
      let result: CustomizationValidation;
      try {
        result = await this.engine.call<CustomizationValidation>("validate", {
          ...this.engineRequest(snapshot),
          selectedItemIds: body.selectedItemIds,
        });
      } catch (error) {
        if (!(error instanceof CustomizationError) || error.code !== "engine-capability-missing")
          throw error;
        output.diagnostics.push({
          severity: "warning",
          code: "engine-capability-missing",
          message:
            "基本的な形式を検証して書き出しました。参照関係と適用の互換性は、対応するエンジンで確認してください。",
        });
        return output;
      }
      if (!result.valid || result.diagnostics.some((entry) => entry.severity === "error"))
        throw new CustomizationError(
          "validation-failed",
          "選択した配布内容の参照と設定を確認してください。",
          409,
          result.diagnostics,
        );
      output.diagnostics.push(...result.diagnostics);
      return output;
    }
    if (body.format !== "plugin") return fail("bad-request", "配布形式が不正です。");
    if (
      body.harnesses !== undefined &&
      (!Array.isArray(body.harnesses) ||
        !body.harnesses.every(
          (value) =>
            typeof value === "string" &&
            ["claude", "cursor", "codex", "copilot", "kiro", "kiro-ide", "opencode"].includes(
              value,
            ),
        ))
    )
      return fail("bad-request", "対象ハーネスが不正です。");
    const result = await this.engine.call<{
      filename: string;
      mimeType: string;
      base64: string;
      omittedItemIds?: string[];
      diagnostics?: CustomizationDiagnostic[];
    }>("export", {
      ...this.engineRequest(snapshot),
      format: "plugin",
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.version === "string" ? { version: body.version } : {}),
      selectedItemIds: body.selectedItemIds,
      harnesses: body.harnesses as string[] | undefined,
    });
    if (result.omittedItemIds?.length && body.confirmedOmissions !== true)
      throw new CustomizationError(
        "export-omissions",
        "標準プラグインに含められない項目を確認してください。",
        409,
        result.diagnostics,
      );
    return {
      id: randomUUID(),
      filename: result.filename,
      mimeType: result.mimeType,
      encoding: "base64",
      content: result.base64,
      diagnostics: result.diagnostics ?? [],
    };
  }

  async post(action: string, input: unknown): Promise<unknown> {
    this.assertEditable();
    if (!object(input)) return fail("bad-request", "JSONオブジェクトが必要です。");
    switch (action) {
      case "save":
        return await this.save(input);
      case "import/analyze":
        return await this.packages.analyze(input.package, await this.snapshot(input));
      case "import/adopt": {
        if (
          !Array.isArray(input.selections) ||
          !input.selections.every(
            (entry) =>
              object(entry) &&
              identifier(entry.sourceId) &&
              (entry.targetId === null || identifier(entry.targetId)),
          )
        )
          return fail("bad-request", "取り込む項目の選択が不正です。");
        const result = await this.packages.adopt(
          await this.snapshot(input),
          String(input.planId ?? ""),
          input.selections as CustomizationImportSelection[],
        );
        return result;
      }
      case "recover":
        return await this.recover(input);
      case "export":
        return await this.export(input);
      default:
        return fail("unknown-route", "操作が見つかりません。", 404);
    }
  }
}

export function createCustomizationService(
  config: CustomizationServiceConfig,
): CustomizationService {
  return new CustomizationService(config);
}
