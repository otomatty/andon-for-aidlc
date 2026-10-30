#!/usr/bin/env bun
// Fail the quality gate when source resolves a path with Node's realpath directly.
//
// Node ships two resolvers that disagree on Windows (8.3 short names, subst
// drives), so a path from one compared with a path from the other names one
// folder twice. Every path identity goes through canonicalPath/canonicalPathSync
// in @andon/core-utils instead. oxlint's no-restricted-imports cannot carry
// this: its overrides replace each other and several write-path files turn it off.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSIONS = new Set([".ts", ".tsx"]);

/** Files allowed to call realpath directly, and why. */
export const ALLOWED: Readonly<Record<string, string>> = {
  "packages/core-utils/src/canonical-path.ts": "the shared resolver itself",
  // The lock directory name must hash the same identity as the AI-DLC engine's
  // auditLockIdentity (aidlc-lib.ts), which resolves with realpathSync. The
  // engine is not ours to change, so this mirrors it rather than canonicalPath.
  "packages/vscode-extension/src/native-workspace-lock.ts":
    "mirrors the AI-DLC engine lock identity",
  // Captured doctor output is scrubbed by replacing this temp directory's path, so
  // the path must be spelled the way the engine (run by the same bun) resolves it.
  "scripts/capture-doctor-fixtures.ts": "matches paths the AI-DLC engine prints",
};

export type RealpathUse = { file: string; line: number; found: string };

const FS_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/g;
const MEMBER = /\.\s*(realpath(?:Sync)?)\b/g;

function lineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

export function findRealpathUses(source: string, file: string): RealpathUse[] {
  const uses: RealpathUse[] = [];
  for (const match of source.matchAll(FS_IMPORT)) {
    const names = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].indexOf("{") + 1;
    for (const name of names.matchAll(/\b(realpath(?:Sync)?)\b/g)) {
      uses.push({ file, line: lineNumber(source, start + (name.index ?? 0)), found: name[1]! });
    }
  }
  for (const match of source.matchAll(MEMBER)) {
    uses.push({ file, line: lineNumber(source, match.index ?? 0), found: `.${match[1]}` });
  }
  return uses.sort((a, b) => a.line - b.line);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") out.push(...walk(next));
    } else if (EXTENSIONS.has(path.extname(entry.name)) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(next);
    }
  }
  return out;
}

/**
 * Package sources and maintainer scripts. Tests are left out: they resolve paths
 * independently to check the shared resolver. plugins/ is left out: its tools are
 * copied into a harness and must stay dependency-free.
 */
export function scanSources(root: string): RealpathUse[] {
  const packages = path.join(root, "packages");
  const dirs = [
    ...readdirSync(packages, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(packages, entry.name, "src")),
    path.join(root, "scripts"),
  ];
  return dirs
    .filter((dir) => existsSync(dir))
    .flatMap(walk)
    .map((file) => path.relative(root, file).replaceAll("\\", "/"))
    .filter((file) => !(file in ALLOWED))
    .flatMap((file) => findRealpathUses(readFileSync(path.join(root, file), "utf8"), file));
}

if (import.meta.main) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uses = scanSources(root);
  if (uses.length === 0) process.exit(0);
  console.error(
    "canonical paths: resolve with canonicalPath / canonicalPathSync from @andon/core-utils.",
  );
  console.error("");
  for (const use of uses) console.error(`  ${use.file}:${use.line}: ${use.found}`);
  console.error("");
  process.exit(1);
}
