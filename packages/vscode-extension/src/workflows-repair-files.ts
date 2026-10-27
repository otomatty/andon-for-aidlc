import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { canonicalPathSync } from "@aidlc-guide/core-utils";
import { acquireNativeWorkspaceLock } from "./native-workspace-lock.ts";

// Deliberately excludes application code, credentials, workflow artifacts, and runtime state.
const CONFIG = [
  ".claude",
  ".cursor",
  ".codex",
  ".agents",
  ".github/skills",
  ".github/agents",
  ".github/hooks",
  ".aidlc",
  ".opencode",
  ".kiro",
  ".gitignore",
  "AGENTS.md",
  ".mcp.json",
  ".vscode/settings.json",
  "opencode.json",
  "install.ts",
  "aidlc.settings.json",
  "aidlc.settings.local.json",
];
/** Whether a repair may write this project path; anything else stays the person's to change. */
export const isRepairConfigPath = (rel: string): boolean =>
  CONFIG.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
export type RepairFile = { bytes: Buffer; mode: number };
export type RepairSnapshot = Map<string, RepairFile>;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export const repairHash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

/** Explain a link or special file the repair snapshot refuses to copy. */
export function repairLinkMessage(rel: string): string {
  const lead = `リンクや特殊ファイルは修正できません: ${rel}`;
  if (/^\.claude\/worktrees\/[^/]+\/node_modules(?:\/|$)/.test(rel)) {
    return [
      lead,
      "これは作業ツリーに残ったパッケージへのリンクで、AI-DLC の設定ではありません。AI では修正しません。",
      "診断用の複製を中止したため、バックアップも更新も始まっていません。",
      "使っていない作業ツリーなら .claude/worktrees 内のそのツリーを削除してください。使うなら、その中の node_modules だけ削除してから再診断してください。リンクを実体のファイルに置き換えないでください。",
    ].join("");
  }
  return [
    lead,
    "診断は通常のファイルとディレクトリだけを複製します。この場所はリンクまたは特殊ファイルのため、チェックを中止しました。",
    "AI による修正は始まっていません。不要なら削除し、必要ならリンクを外してから再診断してください。",
  ].join("");
}

/** Resolve a project-relative path while rejecting traversal, links, and special files. */
export function repairPath(root: string, rel: string): string {
  if (!rel || /[\\:\0]/.test(rel) || rel.split("/").some((p) => !p || p === "." || p === ".."))
    throw new Error(`不正な設定パスです: ${rel}`);
  let target = canonicalPathSync(root);
  for (const part of rel.split("/")) {
    target = path.join(target, part);
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
        throw new Error(repairLinkMessage(rel));
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  return target;
}

/** Bounded snapshot also detects additions while AI is running. */
export function snapshotRepairFiles(root: string): RepairSnapshot {
  const files: RepairSnapshot = new Map();
  let size = 0;
  const collect = (rel: string) => {
    const file = repairPath(root, rel);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(file).sort()) collect(`${rel}/${entry}`);
    } else {
      size += stat.size;
      if (size > 64_000_000 || files.size >= 12_000)
        throw new Error("設定が大きすぎるため自動修正できません。");
      files.set(rel, { bytes: readFileSync(file), mode: stat.mode & 0o777 });
    }
  };
  for (const rel of [...CONFIG, ".aidlc-version", "aidlc/active-space"]) collect(rel);
  const spaces = repairPath(root, "aidlc/spaces");
  try {
    for (const space of readdirSync(spaces).sort()) collect(`aidlc/spaces/${space}/memory`);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  return files;
}

/** Fingerprint content and permissions independently of filesystem enumeration order. */
export function snapshotHash(files: RepairSnapshot): string {
  return repairHash(
    JSON.stringify(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rel, f]) => [rel, repairHash(f.bytes), f.mode]),
    ),
  );
}

/** Copy the captured configuration without carrying a pin that could select another engine. */
export function seedRepairFiles(stage: string, files: RepairSnapshot): void {
  for (const [rel, file] of files) {
    if (rel === ".aidlc-version") continue; // Always inspect with the explicit target distribution.
    const destination = repairPath(stage, rel);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.bytes, { mode: file.mode, flag: "wx" });
  }
}

/** Recheck bytes, permissions, and file type immediately before apply or rollback. */
function matchesRepairFile(root: string, rel: string, expected: RepairFile | undefined): boolean {
  const file = repairPath(root, rel);
  try {
    const stat = lstatSync(file);
    return (
      expected !== undefined &&
      stat.isFile() &&
      (stat.mode & 0o777) === expected.mode &&
      readFileSync(file).equals(expected.bytes)
    );
  } catch (error) {
    if (missing(error)) return expected === undefined;
    throw error;
  }
}

/** The only repair writer. AI cannot supply paths or content to this function directly. */
export async function commitRepairFiles(options: {
  root: string;
  stage: string;
  before: RepairSnapshot;
  backupParent: string;
  signal: AbortSignal;
  isCurrent(): boolean;
}): Promise<{ backup: string; changed: string[] }> {
  const check = () => {
    options.signal.throwIfAborted();
    if (!options.isCurrent()) throw new Error("修正を中止しました。");
  };
  check();
  const after = snapshotRepairFiles(options.stage);
  // The official CLI may seed memory in the staging folder; never import those writes.
  const changes = [...new Set([...options.before.keys(), ...after.keys()])].filter((rel) => {
    if (!isRepairConfigPath(rel)) return false;
    const old = options.before.get(rel),
      next = after.get(rel);
    return !old || !next || !old.bytes.equals(next.bytes) || old.mode !== next.mode;
  });
  if (!changes.length) return { backup: "", changed: [] };
  const release = await acquireNativeWorkspaceLock(options.root, options);
  const applied: string[] = [];
  let backup = "";
  const replace = (rel: string, file: RepairFile | undefined) => {
    const destination = repairPath(options.root, rel);
    if (!file) {
      unlinkSync(destination);
      return;
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    const temp = `${destination}.repair-${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, file.bytes, { flag: "wx", mode: file.mode });
      renameSync(temp, destination);
    } finally {
      try {
        unlinkSync(temp);
      } catch (error) {
        if (!missing(error)) console.error("修正用一時ファイルを削除できませんでした。", error);
      }
    }
  };
  try {
    check();
    if (snapshotHash(snapshotRepairFiles(options.root)) !== snapshotHash(options.before))
      throw new Error(
        "診断後に設定が変更されました。修正を適用せず停止しました。再診断してください。",
      );
    mkdirSync(options.backupParent, { recursive: true });
    backup = path.join(options.backupParent, randomUUID());
    mkdirSync(backup, { mode: 0o700 });
    for (const [index, rel] of changes.entries()) {
      const file = options.before.get(rel);
      if (file)
        writeFileSync(path.join(backup, `${index}.bin`), file.bytes, { flag: "wx", mode: 0o600 });
    }
    writeFileSync(
      path.join(backup, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          root: canonicalPathSync(options.root),
          status: "prepared",
          changes: changes.map((rel, index) => ({
            path: rel,
            backup: options.before.has(rel) ? `${index}.bin` : null,
            mode: options.before.get(rel)?.mode,
            after: after.get(rel) ? repairHash(after.get(rel)?.bytes ?? "") : null,
          })),
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    // Synchronous commit: no asynchronous AI work occurs inside the transaction.
    for (const rel of changes) {
      check();
      if (!matchesRepairFile(options.root, rel, options.before.get(rel)))
        throw new Error(`適用直前に変更されました: ${rel}`);
      replace(rel, after.get(rel));
      applied.push(rel);
    }
    writeFileSync(path.join(backup, "completed"), new Date().toISOString(), {
      flag: "wx",
      mode: 0o600,
    });
    return { backup, changed: changes };
  } catch (error) {
    const failed: string[] = [];
    for (const rel of applied.reverse()) {
      try {
        if (!matchesRepairFile(options.root, rel, after.get(rel))) throw new Error("changed");
        replace(rel, options.before.get(rel));
      } catch {
        failed.push(rel);
      }
    }
    if (failed.length)
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n復元できない設定があります: ${failed.join("、")}。バックアップ: ${backup}`,
        {
          cause: error,
        },
      );
    throw error;
  } finally {
    release();
  }
}
