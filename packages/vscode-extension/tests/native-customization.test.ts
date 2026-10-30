import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CustomizationEngine } from "@andon/api-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyNativeCustomization,
  planNativeCustomization,
  usesCustomizationEngine,
} from "../src/native-customization";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project(file?: string) {
  const root = await mkdtemp(path.join(tmpdir(), "guide-customization-install-"));
  roots.push(root);
  if (file) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "{}");
  }
  return root;
}
const helper = ".cursor/tools/aidlc-customization.ts";
const change = {
  rel: ".cursor/skills/aidlc/SKILL.md",
  before: Buffer.from("old"),
  after: Buffer.from("new"),
  mode: 0o644,
};

describe("native installation with customization", () => {
  it("retains the legacy installer only when no customization state exists", async () => {
    expect(await usesCustomizationEngine(await project())).toBe(false);
    for (const file of [
      "aidlc/guide-customization/manifest.json",
      "aidlc/.aidlc-customization/pending.json",
    ])
      await expect(usesCustomizationEngine(await project(file))).rejects.toThrow(
        "エンジンがありません",
      );
  });

  it("submits native bytes to the engine rebase and keeps confirmation stable across new plan IDs", async () => {
    const root = await project(helper);
    const call = vi.fn().mockResolvedValue({
      id: "first",
      configurationRevision: "revision",
      canApply: true,
      diagnostics: [],
      files: [{ relativePath: change.rel, beforeHash: "before", afterHash: "after", itemIds: [] }],
    });
    const factory = () => ({ call }) as CustomizationEngine;
    const first = await planNativeCustomization(root, [change], factory);
    expect(call).toHaveBeenCalledWith("install-plan", {
      schemaVersion: 1,
      installationFiles: [
        {
          relativePath: change.rel,
          beforeHash: createHash("sha256").update(change.before).digest("hex"),
          afterBase64: change.after.toString("base64"),
          mode: change.mode,
        },
      ],
    });
    call.mockResolvedValue({
      id: "second",
      configurationRevision: "revision",
      canApply: true,
      diagnostics: [],
      files: [{ relativePath: change.rel, beforeHash: "before", afterHash: "after", itemIds: [] }],
    });
    const second = await planNativeCustomization(root, [change], factory);
    expect(first?.token).toBe(second?.token);
    call.mockResolvedValue({
      id: "third",
      configurationRevision: "revision",
      canApply: true,
      diagnostics: [],
      files: [
        {
          relativePath: change.rel,
          beforeHash: "before",
          afterHash: "changed-rebase",
          itemIds: [],
        },
      ],
    });
    expect((await planNativeCustomization(root, [change], factory))?.token).not.toBe(first?.token);
  });

  it("refuses an update when the engine reports active work or a rebase conflict", async () => {
    const call = vi.fn().mockResolvedValue({
      id: "blocked",
      configurationRevision: "revision",
      files: [],
      canApply: false,
      diagnostics: [{ severity: "error", message: "進行中のワークフローがあります。" }],
    });
    await expect(
      planNativeCustomization(
        await project(helper),
        [change],
        () => ({ call }) as CustomizationEngine,
      ),
    ).rejects.toThrow("進行中のワークフロー");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed native plans with an explicit compatibility error", async () => {
    const root = await project(helper);
    const valid = {
      id: "plan",
      configurationRevision: "revision",
      canApply: true,
      diagnostics: [],
      files: [],
    };
    const file = { relativePath: change.rel, beforeHash: null, afterHash: "hash", itemIds: [] };
    for (const result of [
      null,
      [],
      {},
      { ...valid, id: undefined },
      { ...valid, configurationRevision: 1 },
      { ...valid, canApply: "yes" },
      { ...valid, diagnostics: null },
      { ...valid, diagnostics: [null] },
      { ...valid, diagnostics: [{ severity: "error" }] },
      { ...valid, files: null },
      { ...valid, files: [null] },
      { ...valid, files: [{ ...file, afterHash: undefined }] },
      { ...valid, files: [{ ...file, itemIds: [42] }] },
    ]) {
      const call = vi.fn().mockResolvedValue(result);
      await expect(
        planNativeCustomization(root, [change], () => ({ call }) as CustomizationEngine),
      ).rejects.toMatchObject({ code: "engine-invalid-response", status: 502 });
    }
  });

  it("uses the engine transaction and never treats partial recovery as success", async () => {
    const call = vi.fn().mockResolvedValue({ status: "recovery-required" });
    const plan = {
      id: "plan",
      token: "token",
      configurationRevision: "base",
      engine: { call } as CustomizationEngine,
    };
    await expect(applyNativeCustomization(plan)).rejects.toThrow("復旧が必要");
    expect(call).toHaveBeenCalledWith(
      "apply",
      expect.objectContaining({ planId: "plan", expectedConfigurationRevision: "base" }),
    );
    call.mockResolvedValue({ status: "committed" });
    await expect(applyNativeCustomization(plan)).resolves.toBeUndefined();
  });
});
