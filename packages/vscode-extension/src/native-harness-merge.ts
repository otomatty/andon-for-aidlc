import { createHash, randomUUID } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { canonicalPathSync } from "@andon/core-utils";
import {
  findNodeAtLocation,
  getNodeValue,
  type Node as JsonNode,
  type ParseError,
  parseTree,
} from "jsonc-parser";
import { HARNESS_LABELS, type HarnessId } from "./harness-detect.ts";
import {
  applyNativeCustomization,
  planNativeCustomization,
  usesCustomizationEngine,
} from "./native-customization.ts";
import { acquireNativeWorkspaceLock } from "./native-workspace-lock.ts";

export const HARNESS_DIRECTORIES: Record<HarnessId, string> = {
  claude: ".claude",
  cursor: ".cursor",
  codex: ".codex",
  copilot: ".aidlc",
  opencode: ".aidlc",
  kiro: ".kiro",
  "kiro-ide": ".kiro",
};
export const GUIDE_INSTALL_FILE = "andon-install.json";

type Contribution = {
  policy:
    | "managed-block"
    | "whole-file"
    | "json-map"
    | "json-array"
    | "jsonc-settings"
    | "json-entries";
  marker?: string;
  hash?: string;
  key?: string;
  entries?: Record<string, string>;
  /** jsonc-settings: every key AI-DLC has added, so a key the team removed is not re-added. */
  added?: string[];
  /** jsonc-settings / json-entries: AI-DLC created the file and may remove it once empty. */
  created?: boolean;
};
type Baseline = {
  schemaVersion: number;
  frameworkVersion: string;
  distribution: string;
  harnessDir: string;
  files: Record<string, string>;
  rootContributions: Record<string, Contribution>;
};
type GuideInstall = {
  schemaVersion: number;
  harness: string;
  version: string;
  files: Record<string, string>;
};
type Change = { rel: string; before: Buffer | null; after: Buffer | null; mode: number };
type CandidatePlan = { planToken: string; root: string; changes: Change[] };
export type HarnessMergeOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  planToken?: string;
  validateLocked?: () => Promise<void>;
  onApplyStart?: () => void;
  recoverStaleLock?: () => Promise<void>;
  /** A pristine prior release with the saved plugin selection independently replayed. */
  priorCandidate?: string;
};

function digest(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Every source and destination is a regular file beneath its selected root. */
function safePath(root: string, rel: string): string {
  if (
    !rel ||
    /[\\:\0]/.test(rel) ||
    rel.split("/").some((part) => !part || part === ".." || part === ".")
  )
    throw new Error(`設定ファイルのパスが不正です: ${rel}`);
  const target = path.resolve(root, rel);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`プロジェクトの外には書き込みません: ${rel}`);
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new Error(`通常のファイル・フォルダ以外には書き込みません: ${rel}`);
      if (current !== target && !stat.isDirectory())
        throw new Error(`設定先の親がフォルダではありません: ${rel}`);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  return target;
}

function read(root: string, rel: string): Buffer | null {
  const file = safePath(root, rel);
  try {
    if (!lstatSync(file).isFile()) throw new Error(`設定先がファイルではありません: ${rel}`);
    return readFileSync(file);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function json<T>(root: string, rel: string): T | null {
  const bytes = read(root, rel);
  return bytes === null ? null : (JSON.parse(bytes.toString("utf8")) as T);
}

function markers(rel: string, identity: string) {
  return rel.endsWith(".md")
    ? { begin: `<!-- BEGIN AI-DLC:${identity} -->`, end: `<!-- END AI-DLC:${identity} -->` }
    : { begin: `# BEGIN AI-DLC:${identity}`, end: `# END AI-DLC:${identity}` };
}

function blockRange(text: string, rel: string, identity: string) {
  const { begin, end } = markers(rel, identity);
  const begins = text.split(begin).length - 1;
  const ends = text.split(end).length - 1;
  if (!begins && !ends) return null;
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (begins !== 1 || ends !== 1 || stop < start)
    throw new Error(`設定ブロックの区切りが不正です: ${rel}`);
  return { start, end: stop + end.length, body: text.slice(start + begin.length, stop).trim() };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Matches the native installer's per-entry hashes, including nested object key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function jsonEntries(contribution: Contribution, rel: string): Record<string, string> {
  if (
    typeof contribution.key !== "string" ||
    !contribution.key ||
    !object(contribution.entries) ||
    Object.values(contribution.entries).some(
      (hash) => typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error(`設定の JSON 所有記録を確認できません: ${rel}`);
  return contribution.entries;
}

function mergeJson(
  current: string,
  incoming: string,
  contribution: Contribution,
  rel: string,
  prior?: Contribution,
): { text: string; entries: Record<string, string> } {
  const previous: unknown = current ? JSON.parse(current) : {};
  const next: unknown = JSON.parse(incoming);
  if (!object(previous) || !object(next) || !contribution.key)
    throw new Error(`設定の JSON 形式を確認できません: ${rel}`);
  const key = contribution.key;
  const declared = jsonEntries(contribution, rel);
  const oldEntries = prior ? jsonEntries(prior, rel) : {};
  const entries: Record<string, string> = Object.create(null);
  let merged: unknown;
  if (contribution.policy === "json-array") {
    const left = Object.hasOwn(previous, key) ? previous[key] : [];
    const right = Object.hasOwn(next, key) ? next[key] : [];
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      !left.every((value) => typeof value === "string") ||
      !right.every((value) => typeof value === "string")
    )
      throw new Error(`設定が文字列の配列ではありません: ${rel}`);
    if (
      right.some(
        (value) => !Object.hasOwn(declared, value) || declared[value] !== digest(canonical(value)),
      ) ||
      Object.keys(declared).some((value) => !right.includes(value))
    )
      throw new Error(`共有設定の内容がマニフェストと一致しません: ${rel}`);
    const retained = left.filter((value) => {
      const owned =
        Object.hasOwn(oldEntries, value) && oldEntries[value] === digest(canonical(value));
      if (owned && Object.hasOwn(declared, value)) entries[value] = digest(canonical(value));
      return !owned || Object.hasOwn(declared, value);
    });
    for (const value of right)
      if (!retained.includes(value)) {
        retained.push(value);
        entries[value] = digest(canonical(value));
      }
    merged = retained.length ? retained : undefined;
  } else {
    const left = Object.hasOwn(previous, key) ? previous[key] : {};
    const right = Object.hasOwn(next, key) ? next[key] : {};
    if (!object(left) || !object(right))
      throw new Error(`設定がオブジェクトではありません: ${rel}`);
    if (
      Object.entries(right).some(
        ([name, value]) =>
          !Object.hasOwn(declared, name) || declared[name] !== digest(canonical(value)),
      ) ||
      Object.keys(declared).some((name) => !Object.hasOwn(right, name))
    )
      throw new Error(`共有設定の内容がマニフェストと一致しません: ${rel}`);
    for (const [name, hash] of Object.entries(oldEntries)) {
      if (!Object.hasOwn(left, name) || Object.hasOwn(right, name)) continue;
      if (digest(canonical(left[name])) !== hash)
        throw new Error(
          `削除予定の JSON 設定が編集されています。内容を保持しました: ${rel} (${name})`,
        );
      delete left[name];
    }
    for (const [name, value] of Object.entries(right)) {
      const present = Object.hasOwn(left, name);
      const currentHash = present ? digest(canonical(left[name])) : undefined;
      const owned = Object.hasOwn(oldEntries, name);
      if (present && currentHash !== declared[name] && (!owned || currentHash !== oldEntries[name]))
        throw new Error(`既存の設定と競合しています: ${rel} (${name})`);
      Object.defineProperty(left, name, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      // Identical pre-existing user entries remain user-owned when the framework retires them.
      if (!present || owned) entries[name] = digest(canonical(value));
    }
    merged = Object.keys(left).length ? left : undefined;
  }
  // An optional integration with no owned entries has no claim on the user's key.
  if (Object.keys(declared).length === 0 && Object.keys(oldEntries).length === 0)
    return { text: current, entries };
  if (merged === undefined) delete previous[key];
  else
    Object.defineProperty(previous, key, {
      value: merged,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  const unchanged = canonical(previous) === canonical(current ? JSON.parse(current) : {});
  return { text: unchanged ? current : `${JSON.stringify(previous, null, 2)}\n`, entries };
}

// --- JSONC files the team owns (.vscode/settings.json, opencode.json) ---------
// AI-DLC 2.11 edits these in place, one member at a time, so the team's keys,
// values, comments, and layout stay as they are. Ownership semantics follow the
// native installer (aidlc-init.ts jsonc-settings / json-entries). jsonc-parser
// supplies the tree and offsets; the text edits mirror the installer's, because
// jsonc-parser's own modify() moves a trailing comment onto an inserted member.

const BOM = "﻿";
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function hashOf(value: unknown): string {
  return digest(canonical(value));
}

function splitBom(text: string): { bom: string; body: string } {
  return text.startsWith(BOM) ? { bom: BOM, body: text.slice(1) } : { bom: "", body: text };
}

function uniqueKeys(node: JsonNode, rel: string): void {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const key = String(property.children?.[0]?.value);
      if (seen.has(key))
        throw new Error(`設定に重複したキーがあります。内容を保持しました: ${rel} (${key})`);
      seen.add(key);
    }
  }
  for (const child of node.children ?? []) uniqueKeys(child, rel);
}

/** The text's root object, or a refusal: an unreadable team file is never rewritten. */
function jsoncRoot(text: string, rel: string, message: string): JsonNode {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (!root || errors.length > 0 || root.type !== "object") throw new Error(`${message}: ${rel}`);
  uniqueKeys(root, rel);
  return root;
}

function teamRoot(text: string, rel: string): JsonNode {
  return jsoncRoot(
    text,
    rel,
    "既存の設定ファイルを JSON オブジェクトとして読めないため、内容を保持しました",
  );
}

function propertyIndex(object: JsonNode, key: string): number {
  return (object.children ?? []).findIndex((property) => property.children?.[0]?.value === key);
}

function memberValue(object: JsonNode, key: string): JsonNode | undefined {
  return object.type === "object"
    ? object.children?.[propertyIndex(object, key)]?.children?.[1]
    : undefined;
}

function skipTrivia(text: string, at: number): number {
  let index = at;
  while (index < text.length) {
    if (/\s/.test(text[index] ?? "")) index++;
    else if (text.startsWith("//", index)) {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 2;
    } else break;
  }
  return index;
}

function lineStartOf(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function lineIndentOf(text: string, position: number): string {
  return /^[ \t]*/.exec(text.slice(lineStartOf(text, position)))?.[0] ?? "";
}

function startsItsLine(text: string, position: number): boolean {
  return text.slice(lineStartOf(text, position), position).trim() === "";
}

function singleLine(text: string, node: JsonNode): boolean {
  return !text.slice(node.offset, node.offset + node.length).includes("\n");
}

/** A member or item's bounds; `end` is after its trailing comma when it has one. */
function spanOf(text: string, node: JsonNode) {
  const valueEnd = node.offset + node.length;
  const next = skipTrivia(text, valueEnd);
  return { start: node.offset, valueEnd, end: text[next] === "," ? next + 1 : valueEnd };
}

type JsonLayout = { eol: string; unit: string };

function layoutOf(text: string, root: JsonNode): JsonLayout {
  const first = root.children?.[0];
  const indent = first && startsItsLine(text, first.offset) ? lineIndentOf(text, first.offset) : "";
  return { eol: text.includes("\r\n") ? "\r\n" : "\n", unit: indent || "  " };
}

function jsonValueText(
  value: unknown,
  indent: string,
  layout: JsonLayout,
  inline: boolean,
): string {
  return inline
    ? JSON.stringify(value)
    : JSON.stringify(value, null, layout.unit).split("\n").join(`${layout.eol}${indent}`);
}

/**
 * Add one member to an object (first, or after the last), or one string to an
 * array, in the layout around it, keeping every other byte.
 */
function insertJsoncEntry(
  text: string,
  layout: JsonLayout,
  container: JsonNode,
  parentInline: boolean,
  key: string | undefined,
  value: unknown,
  first: boolean,
): string {
  const entries = (container.children ?? []).map((node) => spanOf(text, node));
  const close = container.offset + container.length - 1;
  const inline =
    singleLine(text, container) &&
    (entries.length > 0 || parentInline || container.type === "array");
  const entryText = (indent: string) =>
    `${key === undefined ? "" : `${JSON.stringify(key)}: `}${jsonValueText(value, indent, layout, inline)}`;
  if (inline) {
    const head = entries[0];
    const last = entries[entries.length - 1];
    if (!head || !last)
      return `${text.slice(0, container.offset + 1)}${entryText("")}${text.slice(close)}`;
    if (first) return `${text.slice(0, head.start)}${entryText("")}, ${text.slice(head.start)}`;
    return last.end !== last.valueEnd
      ? `${text.slice(0, last.end)} ${entryText("")}${text.slice(last.end)}`
      : `${text.slice(0, last.valueEnd)}, ${entryText("")}${text.slice(last.valueEnd)}`;
  }
  const outer = lineIndentOf(text, container.offset);
  const head = entries[0];
  const indent =
    head && startsItsLine(text, head.start)
      ? lineIndentOf(text, head.start)
      : `${outer}${layout.unit}`;
  if (head && first)
    return startsItsLine(text, head.start)
      ? `${text.slice(0, lineStartOf(text, head.start))}${indent}${entryText(indent)},${layout.eol}${text.slice(lineStartOf(text, head.start))}`
      : `${text.slice(0, head.start)}${entryText(indent)},${layout.eol}${indent}${text.slice(head.start)}`;
  const closeLine = lineStartOf(text, close);
  let next =
    closeLine > container.offset && text.slice(closeLine, close).trim() === ""
      ? `${text.slice(0, closeLine)}${indent}${entryText(indent)}${layout.eol}${text.slice(closeLine)}`
      : `${text.slice(0, close).trimEnd()}${layout.eol}${indent}${entryText(indent)}${layout.eol}${outer}${text.slice(close)}`;
  const last = entries[entries.length - 1];
  if (last && last.end === last.valueEnd)
    next = `${next.slice(0, last.valueEnd)},${next.slice(last.valueEnd)}`;
  return next;
}

function replaceJsoncNode(
  text: string,
  layout: JsonLayout,
  node: JsonNode,
  value: unknown,
): string {
  const inline = singleLine(text, node) && !object(value);
  return `${text.slice(0, node.offset)}${jsonValueText(value, lineIndentOf(text, node.offset), layout, inline)}${text.slice(node.offset + node.length)}`;
}

/**
 * Take one member or item out (with its line when it stood alone). Unlike
 * jsonc-parser's removal, a comment on a neighbouring member's line stays.
 */
function removeJsoncEntry(text: string, siblings: JsonNode[], at: number): string {
  const span = (node: JsonNode | undefined) => (node ? spanOf(text, node) : undefined);
  const entry = span(siblings[at]);
  if (!entry) return text;
  const previous = span(siblings[at - 1]);
  const following = span(siblings[at + 1]);
  const lineStart = lineStartOf(text, entry.start);
  let after = entry.end;
  while (text[after] === " " || text[after] === "\t") after++;
  const lineEnd =
    text[after] === "\r" && text[after + 1] === "\n"
      ? after + 2
      : text[after] === "\n"
        ? after + 1
        : -1;
  if (startsItsLine(text, entry.start) && lineEnd >= 0) {
    let next = `${text.slice(0, lineStart)}${text.slice(lineEnd)}`;
    // The last one had no comma of its own: drop the one before it instead.
    if (
      !following &&
      entry.end === entry.valueEnd &&
      previous &&
      previous.end !== previous.valueEnd
    )
      next = `${next.slice(0, previous.end - 1)}${next.slice(previous.end)}`;
    return next;
  }
  if (following) return `${text.slice(0, entry.start)}${text.slice(following.start)}`;
  if (previous) return `${text.slice(0, previous.valueEnd)}${text.slice(entry.end)}`;
  return `${text.slice(0, entry.start)}${text.slice(entry.end)}`;
}

function emptyObjectText(text: string): boolean {
  return text.replace(/\s/g, "") === "{}";
}

/** The recorded per-entry hashes (and jsonc-settings' added keys) of a contribution. */
function ownedRecord(
  contribution: Contribution,
  rel: string,
): { entries: Record<string, string>; added: string[]; created: boolean } {
  const { entries, added, created } = contribution;
  if (
    !object(entries) ||
    Object.values(entries).some((hash) => typeof hash !== "string" || !SHA256.test(hash)) ||
    (added !== undefined &&
      (!Array.isArray(added) || added.some((key) => typeof key !== "string"))) ||
    (created !== undefined && typeof created !== "boolean")
  )
    throw new Error(`設定の JSON 所有記録を確認できません: ${rel}`);
  return { entries, added: added ?? [], created: created === true };
}

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && right[key] === left[key])
  );
}

function textResult(current: Buffer | null, original: string, next: string): Buffer | null {
  return current !== null && next === original ? current : Buffer.from(next);
}

/**
 * jsonc-settings (.vscode/settings.json): add each shipped top-level key that is
 * absent, follow a key AI-DLC added while it still has the recorded value, and
 * never touch a team value, another key, or a comment. A key AI-DLC once added
 * and the team then removed from a file it kept is not added back.
 */
function mergeJsoncSettings(
  current: Buffer | null,
  incoming: string,
  contribution: Contribution,
  rel: string,
  prior?: Contribution,
): { bytes: Buffer | null; contribution: Contribution } {
  const declared = ownedRecord(contribution, rel).entries;
  const shippedRoot = jsoncRoot(
    splitBom(incoming).body,
    rel,
    "共有設定の内容がマニフェストと一致しません",
  );
  const shipped = (shippedRoot.children ?? []).map((property) => {
    const value: unknown = getNodeValue(property.children?.[1] as JsonNode);
    return { key: String(property.children?.[0]?.value), value, hash: hashOf(value) };
  });
  if (!sameRecord(declared, Object.fromEntries(shipped.map(({ key, hash }) => [key, hash]))))
    throw new Error(`共有設定の内容がマニフェストと一致しません: ${rel}`);
  const previous = prior ? ownedRecord(prior, rel) : undefined;
  const priorEntries = previous?.entries ?? {};
  const priorAdded = new Set([...(previous?.added ?? []), ...Object.keys(priorEntries)]);
  const entries: Record<string, string> = Object.create(null);
  const added = new Set<string>();
  let bytes: Buffer | null;
  if (current === null) {
    // A missing file (a clone without .vscode/) gets AI-DLC's settings as shipped.
    for (const { key, hash } of shipped) {
      entries[key] = hash;
      added.add(key);
    }
    bytes = Buffer.from(incoming);
  } else {
    const original = current.toString("utf8");
    const { bom, body: existing } = splitBom(original);
    const start = existing.trim() ? existing : "{}\n";
    let body = start;
    const layout = layoutOf(body, teamRoot(body, rel));
    for (const { key, value, hash } of shipped) {
      const root = teamRoot(body, rel);
      const present = memberValue(root, key);
      if (!present && priorAdded.has(key)) {
        added.add(key);
        continue;
      }
      if (!present) {
        body = insertJsoncEntry(body, layout, root, false, key, value, false);
        entries[key] = hash;
        added.add(key);
        continue;
      }
      if (priorAdded.has(key)) added.add(key);
      const priorHash = priorEntries[key];
      if (priorHash && hashOf(getNodeValue(present)) === priorHash) {
        if (priorHash !== hash) body = replaceJsoncNode(body, layout, present, value);
        entries[key] = hash;
      }
    }
    for (const [key, priorHash] of Object.entries(priorEntries)) {
      if (shipped.some((setting) => setting.key === key)) continue;
      body = removeOwnedSetting(body, key, priorHash, rel);
    }
    bytes = textResult(current, original, body === start ? original : `${bom}${body}`);
  }
  return {
    bytes,
    contribution: {
      policy: "jsonc-settings",
      entries,
      ...(added.size > 0 ? { added: [...added].sort() } : {}),
      ...(current === null || previous?.created ? { created: true } : {}),
    },
  };
}

function removeOwnedSetting(body: string, key: string, hash: string, rel: string): string {
  const root = teamRoot(body, rel);
  const at = propertyIndex(root, key);
  const value = root.children?.[at]?.children?.[1];
  if (!value || hashOf(getNodeValue(value)) !== hash) return body;
  return removeJsoncEntry(body, root.children ?? [], at);
}

// json-entries (opencode.json): an entry is one value at a path of object keys,
// or one string in a string array. `/aidlc space <name>` repoints the method
// glob, so any space's glob fills AI-DLC's one method entry.
const METHOD_INSTRUCTION = /^aidlc\/spaces\/[^/"]+\/memory\/\*\*\/\*\.md$/;
const METHOD_SLOT = "aidlc/spaces/*/memory/**/*.md";

type JsonEntry = { id: string; path: string[]; item?: string; value: unknown; hash: string };

function itemSlot(at: readonly string[], item: string): string {
  return at.length === 1 && at[0] === "instructions" && METHOD_INSTRUCTION.test(item)
    ? METHOD_SLOT
    : item;
}

function jsonEntriesOf(value: Record<string, unknown>, at: string[] = []): JsonEntry[] {
  const entries: JsonEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: JsonEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    entries.push(entry);
  };
  for (const [key, child] of Object.entries(value)) {
    const where = [...at, key];
    if (object(child) && Object.keys(child).length > 0) {
      for (const entry of jsonEntriesOf(child, where)) add(entry);
    } else if (
      Array.isArray(child) &&
      child.length > 0 &&
      child.every((item) => typeof item === "string")
    ) {
      for (const item of child as string[]) {
        const slot = itemSlot(where, item);
        add({
          id: JSON.stringify({ path: where, item: slot }),
          path: where,
          item,
          value: item,
          hash: hashOf(slot),
        });
      }
    } else {
      add({ id: JSON.stringify({ path: where }), path: where, value: child, hash: hashOf(child) });
    }
  }
  return entries;
}

function entryAddress(id: string): { path: string[]; item?: string } | null {
  try {
    const parsed = JSON.parse(id) as unknown;
    if (
      !object(parsed) ||
      !Array.isArray(parsed.path) ||
      parsed.path.length === 0 ||
      !parsed.path.every((part) => typeof part === "string") ||
      (parsed.item !== undefined && typeof parsed.item !== "string")
    )
      return null;
    return {
      path: parsed.path as string[],
      ...(typeof parsed.item === "string" ? { item: parsed.item } : {}),
    };
  } catch {
    return null;
  }
}

function valueAt(value: Record<string, unknown>, at: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of at) current = object(current) ? current[key] : undefined;
  return current;
}

function sameItem(node: JsonNode, at: readonly string[], slot: string): boolean {
  const value: unknown = getNodeValue(node);
  return typeof value === "string" && itemSlot(at, value) === slot;
}

/** Who owns the entries already in the team's file before this merge. */
type JsonEntriesOwnership =
  | { kind: "recorded"; entries: Record<string, string> }
  | { kind: "whole" }
  | { kind: "matching" };

// One shipped entry: added, followed, or left as the team has it. A key missing
// on the way is added with everything AI-DLC ships under it.
function applyJsonEntry(
  text: string,
  layout: JsonLayout,
  entry: JsonEntry,
  shippedValue: Record<string, unknown>,
  shipped: readonly JsonEntry[],
  prior: Record<string, string>,
  next: Record<string, string>,
  rel: string,
): string {
  let body = text;
  for (let attempt = 0; attempt < 2; attempt++) {
    const root = teamRoot(body, rel);
    const containerPath = entry.item === undefined ? entry.path.slice(0, -1) : entry.path;
    let node = root;
    let parentInline = false;
    let converted = false;
    for (let depth = 0; depth < containerPath.length; depth++) {
      const key = containerPath[depth] as string;
      const prefix = containerPath.slice(0, depth + 1);
      const child = memberValue(node, key);
      if (!child) {
        for (const other of shipped)
          if (prefix.every((part, index) => other.path[index] === part))
            next[other.id] = other.hash;
        return insertJsoncEntry(
          body,
          layout,
          node,
          parentInline,
          key,
          valueAt(shippedValue, prefix),
          false,
        );
      }
      const wantArray = entry.item !== undefined && depth === containerPath.length - 1;
      if (wantArray ? child.type !== "array" : child.type !== "object") {
        const value: unknown = getNodeValue(child);
        // opencode reads `"bash": "ask"` as the map `{"*": "ask"}`.
        if (
          !wantArray &&
          prefix.length === 2 &&
          prefix[0] === "permission" &&
          typeof value === "string"
        ) {
          body = replaceJsoncNode(body, layout, child, { "*": value });
          converted = true;
          break;
        }
        throw new Error(
          `既存の設定の形式が異なるため追加できません。内容を保持しました: ${rel} (${prefix.join(".")})`,
        );
      }
      parentInline = singleLine(body, node);
      node = child;
    }
    if (converted) continue;
    if (entry.item !== undefined) {
      const slot = itemSlot(entry.path, entry.item);
      if ((node.children ?? []).some((item) => sameItem(item, entry.path, slot))) {
        if (Object.hasOwn(prior, entry.id)) next[entry.id] = entry.hash;
        return body;
      }
      next[entry.id] = entry.hash;
      return insertJsoncEntry(body, layout, node, parentInline, undefined, entry.item, false);
    }
    const key = entry.path[entry.path.length - 1] as string;
    const member = memberValue(node, key);
    if (!member) {
      next[entry.id] = entry.hash;
      // opencode applies the last matching permission rule, so the team's rules after it decide.
      return insertJsoncEntry(body, layout, node, parentInline, key, entry.value, key === "*");
    }
    const currentHash = hashOf(getNodeValue(member));
    const priorHash = Object.hasOwn(prior, entry.id) ? prior[entry.id] : undefined;
    if (priorHash !== undefined && currentHash === priorHash) {
      next[entry.id] = entry.hash;
      return currentHash === entry.hash
        ? body
        : replaceJsoncNode(body, layout, member, entry.value);
    }
    if (priorHash !== undefined && currentHash === entry.hash) next[entry.id] = entry.hash;
    return body;
  }
  throw new Error(`既存の設定の形式を確認できません。内容を保持しました: ${rel}`);
}

// Remove one recorded entry while it still has the value AI-DLC wrote, then any
// object or array that removal left empty.
function removeRecordedJsonEntry(text: string, id: string, hash: string, rel: string): string {
  const address = entryAddress(id);
  if (!address) return text;
  const root = teamRoot(text, rel);
  const containerPath = address.item === undefined ? address.path.slice(0, -1) : address.path;
  const container = containerPath.length === 0 ? root : findNodeAtLocation(root, containerPath);
  if (!container) return text;
  const children = container.children ?? [];
  let next: string;
  if (address.item !== undefined) {
    const slot = address.item;
    if (container.type !== "array") return text;
    const at = children.findIndex((item) => sameItem(item, address.path, slot));
    if (at < 0 || hashOf(slot) !== hash) return text;
    next = removeJsoncEntry(text, children, at);
  } else {
    if (container.type !== "object") return text;
    const at = propertyIndex(container, address.path[address.path.length - 1] as string);
    const value = children[at]?.children?.[1];
    if (!value || hashOf(getNodeValue(value)) !== hash) return text;
    next = removeJsoncEntry(text, children, at);
  }
  for (let depth = containerPath.length; depth > 0; depth--) {
    const tree = teamRoot(next, rel);
    const emptied = findNodeAtLocation(tree, containerPath.slice(0, depth));
    if (!emptied || (emptied.children?.length ?? 0) > 0) break;
    const parent = depth === 1 ? tree : findNodeAtLocation(tree, containerPath.slice(0, depth - 1));
    if (parent?.type !== "object") break;
    const at = propertyIndex(parent, containerPath[depth - 1] as string);
    if (at < 0) break;
    next = removeJsoncEntry(next, parent.children ?? [], at);
  }
  return next;
}

/**
 * json-entries (opencode.json): add AI-DLC's absent entries, follow the ones it
 * wrote while nobody changed them, and remove only those it no longer ships. A
 * file that holds only AI-DLC's unchanged entries becomes the shipped file. A
 * shape AI-DLC cannot add to is refused, never guessed.
 */
function mergeJsonEntries(
  current: Buffer | null,
  incoming: string,
  contribution: Contribution,
  rel: string,
  ownership: JsonEntriesOwnership | undefined,
): { bytes: Buffer; entries: Record<string, string> } {
  const declared = ownedRecord(contribution, rel).entries;
  const shippedText = splitBom(incoming).body;
  const shippedValue: unknown = getNodeValue(
    jsoncRoot(shippedText, rel, "共有設定の内容がマニフェストと一致しません"),
  );
  if (!object(shippedValue)) throw new Error(`共有設定の内容がマニフェストと一致しません: ${rel}`);
  const shipped = jsonEntriesOf(shippedValue);
  const all: Record<string, string> = Object.create(null);
  for (const entry of shipped) all[entry.id] = entry.hash;
  if (!sameRecord(declared, all))
    throw new Error(`共有設定の内容がマニフェストと一致しません: ${rel}`);
  const original = current?.toString("utf8") ?? "";
  const { bom, body: existing } = splitBom(original);
  const asShipped = { bytes: Buffer.from(`${bom}${shippedText}`), entries: { ...all } };
  if (existing.trim() === "") return asShipped;
  const root = teamRoot(existing, rel);
  const currentValue: unknown = getNodeValue(root);
  if (!object(currentValue)) throw new Error(`既存の設定ファイルを確認できません: ${rel}`);
  const present = jsonEntriesOf(currentValue);
  const prior: Record<string, string> = Object.create(null);
  if (ownership?.kind === "recorded") Object.assign(prior, ownership.entries);
  else if (ownership?.kind === "whole") for (const entry of present) prior[entry.id] = entry.hash;
  else if (ownership?.kind === "matching") {
    const presentHashes = new Map(present.map((entry) => [entry.id, entry.hash]));
    for (const entry of shipped)
      if (presentHashes.get(entry.id) === entry.hash) prior[entry.id] = entry.hash;
  }
  // Without a Guide record, entries already in the team's file stay the team's.
  let plain = true;
  try {
    JSON.parse(existing);
  } catch {
    plain = false;
  }
  const shippedItems = new Set(
    shipped.flatMap((entry) => (entry.item === undefined ? [] : [entry.item])),
  );
  const repointed = (entry: JsonEntry) =>
    entry.item !== undefined &&
    itemSlot(entry.path, entry.item) !== entry.item &&
    !shippedItems.has(entry.item);
  // An empty object, or only AI-DLC's unchanged entries with no comments: the shipped file.
  if (
    plain &&
    (present.length > 0 || (root.children?.length ?? 0) === 0) &&
    present.every((entry) => prior[entry.id] === entry.hash && !repointed(entry))
  )
    return asShipped;
  const next: Record<string, string> = Object.create(null);
  const layout = layoutOf(existing, root);
  let body = existing;
  for (const entry of shipped) {
    if (Object.hasOwn(next, entry.id)) continue;
    body = applyJsonEntry(body, layout, entry, shippedValue, shipped, prior, next, rel);
  }
  for (const [id, hash] of Object.entries(prior))
    if (!Object.hasOwn(all, id)) body = removeRecordedJsonEntry(body, id, hash, rel);
  return {
    bytes: textResult(current, original, body === existing ? original : `${bom}${body}`) as Buffer,
    entries: next,
  };
}

function retireContribution(
  current: Buffer | null,
  contribution: Contribution,
  rel: string,
): Buffer | null {
  if (current === null) return null;
  const text = current.toString("utf8");
  if (contribution.policy === "managed-block") {
    if (!contribution.marker) throw new Error(`旧設定のブロック記録を確認できません: ${rel}`);
    const range = blockRange(text, rel, contribution.marker);
    if (!range) return current;
    if (digest(text.slice(range.start, range.end)) !== contribution.hash)
      throw new Error(`削除予定の旧設定ブロックが編集されています。内容を保持しました: ${rel}`);
    return Buffer.from(`${text.slice(0, range.start)}${text.slice(range.end)}`);
  }
  if (contribution.policy === "json-array" || contribution.policy === "json-map") {
    const retired = mergeJson(text, "{}", { ...contribution, entries: {} }, rel, contribution);
    return Buffer.from(retired.text);
  }
  if (contribution.policy === "whole-file") {
    if (digest(current) !== contribution.hash)
      throw new Error(`削除予定の旧設定が編集されています。内容を保持しました: ${rel}`);
    return null;
  }
  if (contribution.policy === "jsonc-settings" || contribution.policy === "json-entries") {
    // Remove only what AI-DLC wrote and nobody has changed since; edited entries become the team's.
    const { entries, created } = ownedRecord(contribution, rel);
    const { bom, body: existing } = splitBom(text);
    teamRoot(existing, rel);
    let body = existing;
    for (const [entry, hash] of Object.entries(entries))
      body =
        contribution.policy === "jsonc-settings"
          ? removeOwnedSetting(body, entry, hash, rel)
          : removeRecordedJsonEntry(body, entry, hash, rel);
    if (body === existing) return current;
    if (created && emptyObjectText(body)) return null;
    return Buffer.from(`${bom}${body}`);
  }
  throw new Error(`旧共有ファイルの設定方式を確認できません: ${rel}`);
}

function readCandidate(candidate: string, harness: HarnessId, version: string) {
  const source = canonicalPathSync(candidate);
  const dir = HARNESS_DIRECTORIES[harness];
  if (!dir) throw new Error("設定先のツールを確認できません。");
  const metadata = `${dir}/tools/data`;
  const baselineRel = `${metadata}/aidlc-manifest.json`;
  const guideRel = `${metadata}/${GUIDE_INSTALL_FILE}`;
  const stamp = json<Baseline>(source, `${metadata}/aidlc-stamp.json`);
  const baseline = json<Baseline>(source, baselineRel);
  const descriptor = json<{ managedDirectories: string[] }>(
    source,
    `${metadata}/aidlc-projection.json`,
  );
  if (
    !stamp ||
    !baseline ||
    !descriptor ||
    stamp.schemaVersion !== 1 ||
    stamp.frameworkVersion !== version ||
    stamp.distribution !== harness ||
    stamp.harnessDir !== dir ||
    baseline.schemaVersion !== 1 ||
    baseline.frameworkVersion !== version ||
    baseline.distribution !== harness ||
    baseline.harnessDir !== dir ||
    !object(baseline.files) ||
    !object(baseline.rootContributions) ||
    !Array.isArray(descriptor.managedDirectories)
  )
    throw new Error("公式の設定候補のバージョン・ツールを確認できません。");
  const allowed = new Set([
    dir,
    "aidlc",
    ...(harness === "codex" ? [".agents"] : []),
    ...(harness === "copilot" ? [".github"] : []),
    ...(harness === "opencode" ? [".opencode"] : []),
  ]);
  for (const [rel, hash] of Object.entries(baseline.files)) {
    if (![...allowed].some((prefix) => prefix !== "aidlc" && rel.startsWith(`${prefix}/`)))
      throw new Error(`設定候補の管理対象が不正です: ${rel}`);
    const bytes = read(source, rel);
    if (bytes === null || digest(bytes) !== hash)
      throw new Error(`設定候補の内容がマニフェストと一致しません: ${rel}`);
  }
  for (const rel of descriptor.managedDirectories)
    if (!allowed.has(rel)) throw new Error(`設定候補の配置先が不正です: ${rel}`);
  return { source, dir, baselineRel, guideRel, baseline, descriptor, allowed };
}

/** Only a version upgrade with changed managed bytes needs the additional old-release replay. */
export function priorHarnessVersionForReconciliation(
  destination: string,
  harness: HarnessId,
  version: string,
): string | null {
  const root = canonicalPathSync(destination);
  const guideRel = `${HARNESS_DIRECTORIES[harness]}/tools/data/${GUIDE_INSTALL_FILE}`;
  const prior = json<GuideInstall>(root, guideRel);
  if (!prior) return null;
  if (
    prior.schemaVersion !== 1 ||
    prior.harness !== harness ||
    typeof prior.version !== "string" ||
    !object(prior.files)
  )
    throw new Error("既存の追加設定の記録を確認できません。");
  if (prior.version === version) return null;
  return Object.entries(prior.files).some(([rel, hash]) => {
    const current = read(root, rel);
    return current !== null && digest(current) !== hash;
  })
    ? prior.version
    : null;
}

function buildPlan(
  candidate: string,
  destination: string,
  harness: HarnessId,
  version: string,
  priorCandidate?: string,
): CandidatePlan {
  const root = canonicalPathSync(destination);
  const { source, dir, baselineRel, guideRel, baseline, descriptor, allowed } = readCandidate(
    candidate,
    harness,
    version,
  );
  const prior = json<GuideInstall>(root, guideRel);
  if (prior && (prior.schemaVersion !== 1 || prior.harness !== harness || !object(prior.files)))
    throw new Error("既存の追加設定の記録を確認できません。");
  const previousBaseline = prior ? json<Baseline>(root, baselineRel) : null;
  if (
    prior &&
    (previousBaseline?.schemaVersion !== 1 ||
      previousBaseline.distribution !== harness ||
      previousBaseline.harnessDir !== dir ||
      !object(previousBaseline.rootContributions) ||
      prior.files[baselineRel] !== digest(read(root, baselineRel) ?? ""))
  )
    throw new Error("既存の共有設定の所有記録を確認できません。");
  const replayed: Record<string, string> = Object.create(null);
  if (priorCandidate) {
    if (
      !prior ||
      typeof prior.version !== "string" ||
      previousBaseline?.frameworkVersion !== prior.version
    )
      throw new Error("再現対象の旧バージョンを確認できません。");
    const reference = readCandidate(priorCandidate, harness, prior.version);
    const collect = (rel: string): void => {
      const file = safePath(reference.source, rel);
      const stat = lstatSync(file);
      if (stat.isDirectory()) {
        for (const name of readdirSync(file).sort()) collect(`${rel}/${name}`);
      } else if (rel !== baselineRel && rel !== guideRel) {
        replayed[rel] = digest(readFileSync(file));
      }
    };
    // Shared memory is user-owned. The reference proves only independently regenerated tool files.
    for (const rel of reference.descriptor.managedDirectories) if (rel !== "aidlc") collect(rel);
  }
  const changes = new Map<string, Change>();
  const owned: Record<string, string> = {};
  const put = (rel: string, bytes: Buffer | null, mode = 0o644) => {
    if (changes.has(rel)) throw new Error(`設定候補に重複したパスがあります: ${rel}`);
    const before = read(root, rel);
    const retainedMode = before === null ? mode : lstatSync(safePath(root, rel)).mode & 0o777;
    changes.set(rel, { rel, before, after: bytes, mode: retainedMode });
  };
  const keepOrWrite = (rel: string, bytes: Buffer, mode: number, seed = false) => {
    const before = read(root, rel);
    if (seed && before !== null) return;
    if (
      before !== null &&
      !before.equals(bytes) &&
      prior?.files[rel] !== digest(before) &&
      replayed[rel] !== digest(before)
    )
      throw new Error(`既存のファイルと競合しています。内容を保持しました: ${rel}`);
    put(rel, bytes, mode);
    if (!seed) owned[rel] = digest(bytes);
  };
  const walk = (rel: string) => {
    const file = safePath(source, rel);
    const stat = lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of readdirSync(file).sort()) walk(`${rel}/${name}`);
    } else {
      if (rel === baselineRel || rel === guideRel) return;
      const shared = rel.startsWith("aidlc/");
      if (shared && rel !== "aidlc/active-space" && !/^aidlc\/spaces\/[^/]+\/memory\//.test(rel))
        throw new Error(`作業記録を含む設定候補は取り込めません: ${rel}`);
      keepOrWrite(rel, readFileSync(file), stat.mode & 0o777, shared);
    }
  };
  for (const rel of descriptor.managedDirectories) {
    walk(rel);
  }
  const integrations = new Set([
    ...Object.keys(previousBaseline?.rootContributions ?? {}),
    ...Object.keys(baseline.rootContributions),
  ]);
  for (const rel of integrations) {
    if (
      ![
        "AGENTS.md",
        ".gitignore",
        ".mcp.json",
        ".vscode/settings.json",
        "opencode.json",
        "install.ts",
      ].includes(rel)
    )
      throw new Error(`未対応の共有設定ファイルです: ${rel}`);
    const contribution = baseline.rootContributions[rel];
    const previous = previousBaseline?.rootContributions[rel];
    let currentBytes = read(root, rel);
    // Retire an old key, policy, or marker before adding its replacement in the same file.
    const sameContribution =
      contribution &&
      previous &&
      contribution.policy === previous.policy &&
      (contribution.policy === "managed-block"
        ? previous.marker === `guide-${harness}-${contribution.marker ?? path.basename(rel)}`
        : contribution.policy === "jsonc-settings" || contribution.policy === "json-entries"
          ? true
          : contribution.key === previous.key);
    // A file AI-DLC once wrote whole (opencode.json before 2.11) is adopted entry by entry.
    const adoptsWholeFile =
      contribution?.policy === "json-entries" && previous?.policy === "whole-file";
    if (previous && !sameContribution && !adoptsWholeFile)
      currentBytes = retireContribution(currentBytes, previous, rel);
    if (!contribution) {
      put(rel, currentBytes);
      continue;
    }
    let incoming = read(source, rel);
    if (incoming === null) {
      if (
        ((contribution.policy === "json-map" || contribution.policy === "json-array") &&
          Object.keys(jsonEntries(contribution, rel)).length === 0) ||
        ((contribution.policy === "jsonc-settings" || contribution.policy === "json-entries") &&
          Object.keys(ownedRecord(contribution, rel).entries).length === 0)
      )
        incoming = Buffer.from("{}");
      else throw new Error(`設定候補がありません: ${rel}`);
    }
    if (contribution.policy === "managed-block") {
      const originalIdentity = contribution.marker ?? path.basename(rel);
      const shipped = incoming.toString("utf8");
      const shippedRange = blockRange(shipped, rel, originalIdentity);
      if (!shippedRange) throw new Error(`公式の設定ブロックがありません: ${rel}`);
      if (digest(shipped.slice(shippedRange.start, shippedRange.end)) !== contribution.hash)
        throw new Error(`共有設定の内容がマニフェストと一致しません: ${rel}`);
      const identity = `guide-${harness}-${originalIdentity}`;
      const current = currentBytes?.toString("utf8") ?? "";
      const range = blockRange(current, rel, identity);
      const newline = current.includes("\r\n") ? "\r\n" : "\n";
      const { begin, end } = markers(rel, identity);
      let body = shippedRange.body;
      if (rel === ".gitignore") {
        // Do not import the release's generic Node/editor ignores into an existing project.
        const frameworkStart = body.search(/^# AI-DLC\b/m);
        if (frameworkStart >= 0) body = body.slice(frameworkStart);
      }
      if (rel === "AGENTS.md")
        body = `このブロックは ${HARNESS_LABELS[harness]} で AI-DLC を実行するときだけ適用します。\n\n${body}`;
      const block = `${begin}${newline}${body.replace(/\r?\n/g, newline)}${newline}${end}`;
      if (
        range &&
        current.slice(range.start, range.end) !== block &&
        (!sameContribution || previous?.hash !== digest(current.slice(range.start, range.end)))
      )
        throw new Error(`追加設定のブロックが編集されています。内容を保持しました: ${rel}`);
      // An existing block stays where it is; a new one goes after the team's content
      // (2.11: AI-DLC's part of .gitignore is one block after the team's rules).
      const next = range
        ? `${current.slice(0, range.start)}${block}${current.slice(range.end)}`
        : `${current}${current && !current.endsWith("\n") ? newline : ""}${current ? newline : ""}${block}${newline}`;
      baseline.rootContributions[rel] = { ...contribution, marker: identity, hash: digest(block) };
      put(rel, Buffer.from(next));
    } else if (contribution.policy === "json-array" || contribution.policy === "json-map") {
      const next = mergeJson(
        currentBytes?.toString("utf8") ?? "",
        incoming.toString("utf8"),
        contribution,
        rel,
        sameContribution ? previous : undefined,
      );
      baseline.rootContributions[rel] = { ...contribution, entries: next.entries };
      put(rel, next.text ? Buffer.from(next.text) : currentBytes);
    } else if (contribution.policy === "jsonc-settings") {
      const next = mergeJsoncSettings(
        currentBytes,
        incoming.toString("utf8"),
        contribution,
        rel,
        sameContribution ? previous : undefined,
      );
      baseline.rootContributions[rel] = next.contribution;
      put(rel, next.bytes);
    } else if (contribution.policy === "json-entries") {
      const ownership: JsonEntriesOwnership | undefined =
        sameContribution && previous
          ? { kind: "recorded", entries: ownedRecord(previous, rel).entries }
          : adoptsWholeFile && currentBytes !== null
            ? digest(currentBytes) === previous?.hash
              ? { kind: "whole" }
              : { kind: "matching" }
            : undefined;
      const next = mergeJsonEntries(
        currentBytes,
        incoming.toString("utf8"),
        contribution,
        rel,
        ownership,
      );
      const created =
        currentBytes === null ||
        adoptsWholeFile ||
        (sameContribution && previous ? ownedRecord(previous, rel).created : false);
      baseline.rootContributions[rel] = {
        policy: "json-entries",
        entries: next.entries,
        ...(created ? { created: true } : {}),
      };
      put(rel, next.bytes);
    } else if (contribution.policy === "whole-file") {
      if (digest(incoming) !== contribution.hash)
        throw new Error(`共有設定の内容がマニフェストと一致しません: ${rel}`);
      if (
        currentBytes !== null &&
        !currentBytes.equals(incoming) &&
        (!sameContribution || previous?.hash !== digest(currentBytes))
      )
        throw new Error(`既存のファイルと競合しています。内容を保持しました: ${rel}`);
      put(rel, incoming);
      owned[rel] = digest(incoming);
    } else {
      throw new Error(`共有ファイルの設定方式を確認できません: ${rel}`);
    }
  }
  // Only remove retired files whose exact bytes this installer previously wrote.
  for (const rel of new Set([...Object.keys(prior?.files ?? {}), ...Object.keys(replayed)])) {
    if (Object.hasOwn(owned, rel) || changes.has(rel) || rel === baselineRel) continue;
    const before = read(root, rel);
    if (before === null) continue;
    if (digest(before) !== prior?.files[rel] && digest(before) !== replayed[rel])
      throw new Error(`削除予定の旧設定が編集されています: ${rel}`);
    if (
      rel.startsWith("aidlc/") ||
      ![...allowed].some((prefix) => prefix !== "aidlc" && rel.startsWith(`${prefix}/`))
    )
      throw new Error(`旧設定の削除対象を確認できません: ${rel}`);
    changes.set(rel, {
      rel,
      before,
      after: null,
      mode: lstatSync(safePath(root, rel)).mode & 0o777,
    });
  }
  const baselineBytes = Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`);
  keepOrWrite(baselineRel, baselineBytes, 0o644);
  const receipt: GuideInstall = { schemaVersion: 1, harness, version, files: owned };
  put(guideRel, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
  const list = [...changes.values()].sort((a, b) => a.rel.localeCompare(b.rel));
  // Includes managed files with identical bytes; shared method seeds always remain user-owned.
  const planToken = digest(
    JSON.stringify({
      root,
      harness,
      version,
      files: list.map((change) => [
        change.rel,
        change.before === null ? null : digest(change.before),
        change.after === null ? null : digest(change.after),
        change.mode,
      ]),
    }),
  );
  return { planToken, root, changes: list };
}

export async function planHarnessCandidate(
  candidate: string,
  root: string,
  harness: HarnessId,
  version: string,
  options: Pick<HarnessMergeOptions, "priorCandidate"> = {},
): Promise<{ planToken: string }> {
  const plan = buildPlan(candidate, root, harness, version, options.priorCandidate);
  const customization = await planNativeCustomization(plan.root, plan.changes);
  return {
    planToken: customization ? digest(`${plan.planToken}:${customization.token}`) : plan.planToken,
  };
}

function checkCurrent(options: HarnessMergeOptions): void {
  options.signal?.throwIfAborted();
  if (options.isCurrent?.() === false) throw new Error("プロジェクトの設定を中止しました。");
}

function equal(a: Buffer | null, b: Buffer | null): boolean {
  return a === null ? b === null : b !== null && a.equals(b);
}

/** Commit one tool as a transaction, retaining already committed tools on later failure. */
export async function applyHarnessCandidate(
  candidate: string,
  root: string,
  harness: HarnessId,
  version: string,
  options: HarnessMergeOptions = {},
): Promise<void> {
  checkCurrent(options);
  const plan = buildPlan(candidate, root, harness, version, options.priorCandidate);
  const customization = await planNativeCustomization(plan.root, plan.changes);
  const planToken = customization
    ? digest(`${plan.planToken}:${customization.token}`)
    : plan.planToken;
  if (options.planToken !== undefined && options.planToken !== planToken)
    throw new Error("設定計画の確認後にファイルが変更されました。再実行してください。");
  if (customization) {
    await options.validateLocked?.();
    checkCurrent(options);
    options.onApplyStart?.();
    await applyNativeCustomization(customization);
    return;
  }
  let releaseWorkspace: ((primary?: { error: unknown }) => void) | undefined;
  let failure: { error: unknown } | undefined;
  const committed: Change[] = [];
  const directories: string[] = [];
  const makeParents = (rel: string) => {
    const parts = rel.split("/").slice(0, -1);
    let current = plan.root;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        mkdirSync(current);
        directories.push(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  };
  const replace = (rel: string, bytes: Buffer, mode: number, createOnly = false) => {
    const file = safePath(plan.root, rel);
    const temporary = `${file}.andon-for-aidlc-${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode });
      // A hard link publishes complete bytes without overwriting a concurrent creation.
      if (createOnly) linkSync(temporary, file);
      else renameSync(temporary, file);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        // A rename already removed it. Preserve any primary failure if cleanup also fails.
      }
    }
  };
  try {
    // Lock by the path as given: the lock resolves it the way the AI-DLC engine does,
    // while plan.root is already resolved by the OS and may name another lock.
    releaseWorkspace = await acquireNativeWorkspaceLock(root, options);
    if (await usesCustomizationEngine(plan.root))
      throw new Error("設定の確認中にエンジンが変更されました。更新内容を確認し直してください。");
    await options.validateLocked?.();
    checkCurrent(options);
    for (const change of plan.changes)
      if (!equal(read(plan.root, change.rel), change.before))
        throw new Error(`設定確認後にファイルが変更されました: ${change.rel}`);
    options.onApplyStart?.();
    for (const change of plan.changes) {
      checkCurrent(options);
      if (equal(change.before, change.after)) continue;
      if (!equal(read(plan.root, change.rel), change.before))
        throw new Error(`設定中にファイルが変更されました: ${change.rel}`);
      makeParents(change.rel);
      if (change.after === null) unlinkSync(safePath(plan.root, change.rel));
      else replace(change.rel, change.after, change.mode, change.before === null);
      committed.push(change);
    }
    checkCurrent(options);
  } catch (error) {
    const recoveryErrors: string[] = [];
    for (const change of committed.reverse()) {
      try {
        if (!equal(read(plan.root, change.rel), change.after))
          throw new Error(`別の変更があるため復元できません: ${change.rel}`);
        if (change.before === null) unlinkSync(safePath(plan.root, change.rel));
        else replace(change.rel, change.before, change.mode);
      } catch (cause) {
        recoveryErrors.push(String(cause));
      }
    }
    for (const directory of directories.reverse()) {
      try {
        rmdirSync(directory);
      } catch {
        /* Never remove nonempty directories. */
      }
    }
    failure = {
      error: recoveryErrors.length
        ? new Error(`${String(error)}\n復元結果: ${recoveryErrors.join("\n")}`, { cause: error })
        : error,
    };
    throw failure.error;
  } finally {
    // A live owner cannot be reaped. Release only the generation acquired above.
    releaseWorkspace?.(failure);
  }
}
