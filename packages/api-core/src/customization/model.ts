import { createHash } from "node:crypto";
import type {
  CustomizationChange,
  CustomizationDiagnostic,
  CustomizationItem,
  CustomizationKind,
} from "@andon/shared-types";

export const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
export const localIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value) &&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const MAX_ITEM_BYTES = 10 * 1024 * 1024;
export { MAX_CUSTOMIZATION_PACKAGE_BYTES as MAX_PACKAGE_BYTES } from "@andon/shared-types";
export const KINDS: readonly CustomizationKind[] = [
  "rule-section",
  "rule-file-metadata",
  "artifact-template",
  "knowledge",
  "stage",
  "scope",
  "agent",
  "sensor",
  "tool",
  "plugin",
];

export class CustomizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly diagnostics?: CustomizationDiagnostic[],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export const fail = (code: string, message: string, status = 400): never => {
  throw new CustomizationError(code, message, status);
};

/** Shape validation accepts unfinished source text. Domain validity belongs to validate/plan. */
export function parseItem(input: unknown): CustomizationItem {
  if (
    !object(input) ||
    !identifier(input.id) ||
    !KINDS.includes(input.kind as CustomizationKind) ||
    typeof input.title !== "string" ||
    input.title.length > 500 ||
    typeof input.content !== "string" ||
    Buffer.byteLength(input.content) > MAX_ITEM_BYTES ||
    !["core", "plugin", "project"].includes(String(input.owner))
  )
    return fail("bad-request", "項目の形式またはサイズが不正です。");
  const allowed = new Set([
    "id",
    "kind",
    "title",
    "owner",
    "content",
    "originalContent",
    "pluginId",
    "runtimeId",
    "spaceId",
    "target",
    "binary",
    "source",
    "editable",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    return fail("bad-request", "未知の編集フィールドがあります。");
  if (
    input.originalContent !== undefined &&
    (typeof input.originalContent !== "string" ||
      Buffer.byteLength(input.originalContent) > MAX_ITEM_BYTES)
  )
    return fail("bad-request", "原本が不正です。");
  for (const key of ["pluginId", "runtimeId", "spaceId"] as const)
    if (input[key] !== undefined && !identifier(input[key]))
      return fail("bad-request", `${key}が不正です。`);
  if (input.target !== undefined) {
    if (!object(input.target)) return fail("bad-request", "保存対象の形式が不正です。");
    const target = input.target;
    if (target.contributionTo !== undefined && !identifier(target.contributionTo))
      return fail("bad-request", "追加設定の対象工程が不正です。");
    if (
      Object.keys(target).some(
        (key) =>
          ![
            "layer",
            "phase",
            "heading",
            "knowledgeType",
            "audience",
            "filename",
            "contributionTo",
          ].includes(key),
      )
    )
      return fail("bad-request", "未知の保存対象があります。");
    if (
      target.layer !== undefined &&
      !["org", "team", "project", "phase"].includes(String(target.layer))
    )
      return fail("bad-request", "ルールの層が不正です。");
    if (
      target.phase !== undefined &&
      !["initialization", "ideation", "inception", "construction", "operation"].includes(
        String(target.phase),
      )
    )
      return fail("bad-request", "フェーズが不正です。");
    if (
      target.heading !== undefined &&
      (typeof target.heading !== "string" || /[\r\n]/.test(target.heading))
    )
      return fail("bad-request", "章見出しが不正です。");
    if (
      target.filename !== undefined &&
      (typeof target.filename !== "string" ||
        target.filename.length > 180 ||
        /[<>:"/\\|?*]/.test(target.filename) ||
        [...target.filename].some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(target.filename) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(target.filename) ||
        target.filename === "." ||
        target.filename === "..")
    )
      return fail("bad-request", "ファイル名が不正です。");
    if (
      target.knowledgeType !== undefined &&
      !["team-markdown", "plugin-markdown", "document-source", "document-reference"].includes(
        String(target.knowledgeType),
      )
    )
      return fail("bad-request", "資料の種類が不正です。");
    if (
      target.audience !== undefined &&
      target.audience !== "all" &&
      (!Array.isArray(target.audience) || !target.audience.every(identifier))
    )
      return fail("bad-request", "資料の参照先が不正です。");
  }
  if (
    input.source !== undefined &&
    (!object(input.source) ||
      typeof input.source.relativePath !== "string" ||
      typeof input.source.hash !== "string")
  )
    return fail("bad-request", "原本情報が不正です。");
  if (input.binary !== undefined) {
    const binary = input.binary;
    if (
      !object(binary) ||
      typeof binary.base64 !== "string" ||
      !Number.isSafeInteger(binary.bytes) ||
      Number(binary.bytes) > MAX_ITEM_BYTES ||
      Number(binary.bytes) < 0 ||
      typeof binary.sha256 !== "string" ||
      typeof binary.mimeType !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(binary.base64)
    )
      return fail("bad-request", "文書データが不正です。");
    const bytes = Buffer.from(binary.base64, "base64");
    if (bytes.byteLength !== binary.bytes || digest(bytes) !== binary.sha256)
      return fail("bad-request", "文書データのhashまたはサイズが一致しません。");
  }
  return structuredClone(input) as CustomizationItem;
}

export function parseChanges(input: unknown): CustomizationChange[] {
  if (!Array.isArray(input) || input.length > 500)
    return fail("bad-request", "変更一覧が不正です。");
  return input.map((entry) => {
    if (!object(entry)) return fail("bad-request", "変更形式が不正です。");
    if (
      entry.operation === "remove" &&
      identifier(entry.itemId) &&
      Object.keys(entry).every((key) => ["operation", "itemId"].includes(key))
    )
      return { operation: "remove", itemId: entry.itemId };
    if (
      (entry.operation === "create" || entry.operation === "replace") &&
      Object.keys(entry).every((key) => ["operation", "item"].includes(key))
    )
      return { operation: entry.operation, item: parseItem(entry.item) };
    return fail("bad-request", "変更操作が不正です。");
  });
}

export function applyChanges(
  items: CustomizationItem[],
  changes: CustomizationChange[],
): CustomizationItem[] {
  const values = new Map(items.map((item) => [item.id, item]));
  for (const change of changes) {
    if (change.operation === "remove") {
      const current = values.get(change.itemId);
      if (current?.owner === "core" && ["stage", "scope", "agent", "sensor"].includes(current.kind))
        fail("item-read-only", "標準の設定は閲覧のみです。", 403);
      if (values.get(change.itemId)?.editable === false)
        fail("item-read-only", "原本を確認できない項目は削除できません。", 403);
      if (!values.delete(change.itemId)) fail("item-not-found", "削除対象がありません。", 404);
      continue;
    }
    const before = values.get(change.item.id);
    if (
      (before ?? change.item).owner === "core" &&
      ["stage", "scope", "agent", "sensor"].includes((before ?? change.item).kind)
    )
      fail("item-read-only", "標準の設定は閲覧のみです。", 403);
    if (change.operation === "create" && before)
      fail("item-conflict", "同じIDの項目があります。", 409);
    if (change.operation === "replace" && !before)
      fail("item-not-found", "変更対象がありません。", 404);
    if (before?.editable === false)
      fail("item-read-only", "原本を確認できない項目は変更できません。", 403);
    if (
      before &&
      (before.kind !== change.item.kind ||
        before.owner !== change.item.owner ||
        before.pluginId !== change.item.pluginId ||
        before.spaceId !== change.item.spaceId)
    )
      fail("item-conflict", "種類・所有者・対象spaceは変更できません。", 409);
    const next = structuredClone(change.item);
    if (before?.source) next.source = before.source;
    else delete next.source;
    if (before?.originalContent !== undefined) next.originalContent = before.originalContent;
    else delete next.originalContent;
    if (before?.editable !== undefined) next.editable = before.editable;
    values.set(next.id, next);
  }
  if (
    values.size > 500 ||
    Buffer.byteLength(JSON.stringify([...values.values()])) > 100 * 1024 * 1024
  )
    fail("size-limit", "編集内容の上限を超えました。");
  return [...values.values()];
}

export function localDiagnostics(items: CustomizationItem[]): CustomizationDiagnostic[] {
  const diagnostics: CustomizationDiagnostic[] = [];
  const seen = new Map<string, string>();
  for (const item of items) {
    if (
      !item.title.trim() ||
      (item.kind !== "rule-file-metadata" && !item.content.trim() && !item.binary)
    )
      diagnostics.push({
        severity: "error",
        code: "incomplete-item",
        message: "名前と内容を入力してください。",
        itemId: item.id,
      });
    if (
      !["stage", "scope", "agent", "sensor", "tool", "plugin", "artifact-template"].includes(
        item.kind,
      )
    )
      continue;
    const runtime = `${item.kind}:${item.spaceId ?? ""}:${item.runtimeId ?? item.id}`;
    if (seen.has(runtime))
      diagnostics.push({
        severity: "error",
        code: "duplicate-id",
        message: "同じ実行時識別子が使われています。",
        itemId: item.id,
      });
    seen.set(runtime, item.id);
  }
  return diagnostics;
}
