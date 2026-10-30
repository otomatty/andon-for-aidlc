import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { type HarnessId, harnessVersionRel } from "@andon/reader-core";

/**
 * Which files a project update changed, for the "commit these" step of the
 * version-check UX (docs/maintenance/version-gate-design.md). Git, not the
 * updater, is the source: it also sees managed blocks in files like
 * `.gitignore`, and it is what the person will commit from.
 */

/** Path → its porcelain code, then (in a snapshot) a fingerprint of what it holds. */
export type GitStatus = Map<string, string>;

/** `git status --porcelain=v1 -z`: `XY path\0`, with a rename's source as an extra entry. */
export function parseGitStatus(raw: string): GitStatus {
  const status: GitStatus = new Map();
  const entries = raw.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    status.set(entry.slice(3), code);
    if (code.includes("R") || code.includes("C")) index += 1;
  }
  return status;
}

/**
 * What a listed path holds. A file already dirty before the update keeps its
 * porcelain code (` M .gitignore`, `?? .claude/`) after the update rewrites it,
 * so the code alone cannot say the update touched it; the bytes can.
 */
export async function contentFingerprint(file: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (at: string, rel: string): Promise<void> => {
    let stat;
    try {
      stat = await lstat(at);
    } catch {
      hash.update(`missing ${rel}\0`);
      return;
    }
    if (stat.isSymbolicLink()) hash.update(`link ${rel} ${await readlink(at)}\0`);
    else if (stat.isDirectory()) {
      hash.update(`dir ${rel}\0`);
      for (const name of (await readdir(at)).sort())
        await walk(path.join(at, name), `${rel}/${name}`);
    } else
      hash
        .update(`file ${rel}\0`)
        .update(await readFile(at))
        .update("\0");
  };
  await walk(file, ".");
  return hash.digest("hex");
}

/** Null when the folder is not a repository or git is unavailable. */
export async function gitStatusSnapshot(
  root: string,
  signal?: AbortSignal,
): Promise<GitStatus | null> {
  const env = { ...process.env };
  // The question is about this folder, not a repository selected by the parent shell.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith("GIT_")) delete env[key];
  const status = await new Promise<GitStatus | null>((resolve) => {
    execFile(
      "git",
      ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=normal"],
      { env, signal, windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : parseGitStatus(stdout)),
    );
  });
  if (status === null) return null;
  const snapshot: GitStatus = new Map();
  for (const [file, code] of status)
    snapshot.set(file, `${code} ${await contentFingerprint(path.join(root, file))}`);
  return snapshot;
}

/** Paths whose status or contents the update changed, sorted; dirty paths it left alone stay out. */
export function changedSince(before: GitStatus, after: GitStatus): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((file) => before.get(file) !== after.get(file)).sort();
}

/** The shared paths a project update rewrites, named before it runs. */
export function sharedFilesFor(tools: readonly HarnessId[]): string[] {
  const trees = new Set(
    tools.map(
      (id) =>
        `${path
          .dirname(path.dirname(harnessVersionRel(id)))
          .split(path.sep)
          .join("/")}/`,
    ),
  );
  // Every root file a refresh or a harness merge may rewrite (native-harness-merge.ts):
  // which of them a release touches depends on the harness, so all are named.
  return [
    ...trees,
    ".aidlc-version",
    ".gitignore",
    "AGENTS.md",
    ".mcp.json",
    ".vscode/settings.json",
    "opencode.json",
    "install.ts",
  ];
}

export function updateCommitMessage(target: string): string {
  return `chore: aidlc-workflows を ${target} に更新`;
}

export function pinCommitMessage(target: string): string {
  return `chore: aidlc-workflows を ${target} に固定`;
}
