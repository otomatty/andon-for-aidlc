import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import type { ChangeEvent, WatchEvent } from "@andon/shared-types";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { AUDIT_DIRNAME } from "../audit/events.ts";
import { STATE_FILENAME } from "../parse/state.ts";
import { CONSTRUCTION_DIRNAME } from "../tree/matrix.ts";
import { REVIEW_DIRNAMES } from "../tree/review-records.ts";

/** L5 — chokidar subscription, debounce, scope classification, resubscribe. */

export type Scope = ChangeEvent["scope"];

export const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MAX_RESUBSCRIBES = 3;
// Keep this boundary aligned with review-freshness.ts's single-repository walk
// (its unconditional names; v2.11.1 adds .codegraph, .idea and DerivedData).
const EXCLUDED_DIRECTORIES = new Set([
  ".cache",
  ".codegraph",
  ".git",
  ".gradle",
  ".idea",
  ".mypy_cache",
  ".next",
  ".nuxt",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  ".vs",
  "DerivedData",
  "__pycache__",
  "node_modules",
  "venv",
  "build",
  "coverage",
  "dist",
  "logs",
  "target",
  "tmp",
]);
const DOT_DIR = /^\.[a-z0-9][a-z0-9._-]*$/i;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function relativeInside(root: string, candidate: string): string | null {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)
    ? null
    : rel.split(path.sep).join("/");
}

function workspaceLayout(
  recordDir: string,
): { root: string; record: string; space: string } | null {
  const parts = path.resolve(recordDir).split(path.sep);
  const marker = parts.length - 5;
  if (
    parts[marker] !== "aidlc" ||
    parts[marker + 1] !== "spaces" ||
    parts[marker + 3] !== "intents" ||
    !SEGMENT.test(parts[marker + 2] ?? "") ||
    !SEGMENT.test(parts[marker + 4] ?? "")
  )
    return null;
  return {
    root: parts.slice(0, marker).join(path.sep) || path.parse(path.resolve(recordDir)).root,
    record: parts.slice(marker).join("/"),
    space: parts.slice(marker, marker + 3).join("/"),
  };
}

function recordReviewInput(relative: string): boolean {
  return (
    relative === "runtime-graph.json" ||
    relative === "inception/units-generation/unit-of-work-dependency.md"
  );
}

/** No project scan: chokidar supplies candidate paths; only a small stamp is read. */
function sourceWatchPolicy(recordDir: string) {
  const layout = workspaceLayout(recordDir);
  if (layout === null) return null;
  const stamps = new Map<string, boolean>();
  const stamped = (name: string): boolean => {
    if (stamps.has(name)) return stamps.get(name) as boolean;
    let found = false;
    let descriptor: number | undefined;
    try {
      const manifest = path.join(layout.root, name, "tools/data/harness.json");
      // Avoid traversing symlinked harness roots or metadata directories.
      for (const suffix of [name, `${name}/tools`, `${name}/tools/data`]) {
        if (lstatSync(path.join(layout.root, suffix)).isSymbolicLink())
          throw new Error("linked-harness-path");
      }
      const info = lstatSync(manifest);
      if (info.isFile() && !info.isSymbolicLink() && info.size <= 64 * 1024) {
        descriptor = openSync(
          manifest,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
        );
        const opened = fstatSync(descriptor);
        if (
          !opened.isFile() ||
          info.dev !== opened.dev ||
          info.ino !== opened.ino ||
          info.size !== opened.size
        )
          throw new Error("changed");
        const buffer = Buffer.alloc(64 * 1024 + 1);
        const length = readSync(descriptor, buffer, 0, buffer.length, 0);
        const after = fstatSync(descriptor);
        if (
          length !== info.size ||
          opened.size !== after.size ||
          opened.mtimeMs !== after.mtimeMs ||
          opened.ctimeMs !== after.ctimeMs
        )
          throw new Error("changed");
        const value: unknown = JSON.parse(buffer.subarray(0, length).toString("utf8"));
        found =
          value !== null &&
          typeof value === "object" &&
          "name" in value &&
          typeof value.name === "string" &&
          value.name.trim().length > 0;
      }
    } catch {
      /* An unstamped directory remains application source. */
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    stamps.set(name, found);
    return found;
  };
  const recordTrees = [CONSTRUCTION_DIRNAME, AUDIT_DIRNAME, ...REVIEW_DIRNAMES].map(
    (name) => `${layout.record}/${name}`,
  );
  const selectedFiles = [
    `${layout.record}/${STATE_FILENAME}`,
    `${layout.record}/runtime-graph.json`,
    `${layout.record}/inception/units-generation/unit-of-work-dependency.md`,
    ...["org", "team", "project"].map((name) => `${layout.space}/memory/${name}.md`),
    `${layout.space}/intents/intents.json`,
    ".aidlc/worktree-meta.json",
  ];
  const permits = (rel: string, files: readonly string[], trees: readonly string[] = []): boolean =>
    files.some((file) => file === rel || file.startsWith(`${rel}/`)) ||
    trees.some((tree) => tree === rel || tree.startsWith(`${rel}/`) || rel.startsWith(`${tree}/`));
  const ignored = (changed: string, info?: Stats): boolean => {
    const rel = relativeInside(layout.root, changed);
    if (rel === null) return true;
    if (!rel) return false;
    const segments = rel.split("/");
    if (segments.length > 65) return true;
    if (
      /(?:^|\/)aidlc\/spaces\/[^/]+\/intents\/(?:.*\/)?(?:\.aidlc-sensors|\.aidlc-engine)(?:\/|$)/.test(
        rel,
      )
    ) {
      // Engine files do not contribute to source identity. Reviews still need
      // their own watcher so a removed or tampered record clears its verdict.
      return !permits(
        rel,
        [],
        REVIEW_DIRNAMES.map((name) => `${layout.record}/${name}`),
      );
    }
    const head = segments[0] as string;
    if (head === "aidlc" || head === ".aidlc") return !permits(rel, selectedFiles, recordTrees);
    const git = segments.indexOf(".git");
    // The root's Git internals never affect source identity. A nested .git
    // marker changes the supported single-repository boundary; watch only it.
    if (git >= 0) return git === 0 || git < segments.length - 1;
    if (
      segments.some(
        (name, index) =>
          EXCLUDED_DIRECTORIES.has(name) &&
          (index < segments.length - 1 || info?.isDirectory() || info?.isSymbolicLink()),
      )
    )
      return true;
    if (DOT_DIR.test(head) && stamped(head)) {
      return !permits(rel, [
        `${head}/tools/data/stage-graph.json`,
        `${head}/tools/data/harness.json`,
      ]);
    }
    return false;
  };
  return {
    root: layout.root,
    ignored,
    classify(changed: string, directory: boolean): Scope | null {
      const relative = relativeInside(layout.root, changed);
      if (
        relative === null ||
        relative === "" ||
        ignored(changed, { isDirectory: () => directory, isSymbolicLink: () => false } as Stats)
      )
        return null;
      const existing = classifyScope(recordDir, changed);
      if (existing !== null) return existing;
      if (relative.startsWith(`${layout.record}/`))
        return recordReviewInput(relative.slice(layout.record.length + 1)) ? "review-inputs" : null;
      if (relative.startsWith("aidlc/") || relative.startsWith(".aidlc/")) {
        return selectedFiles.includes(relative) ? "review-inputs" : null;
      }
      // Source directory creation/removal matters too (empty directories have
      // no identity, but may contain files by the time the debounce expires).
      return "review-inputs";
    },
    stampChanged(changed: string): boolean {
      const rel = relativeInside(layout.root, changed);
      const name = /^([^/]+)\/tools\/data\/harness\.json$/.exec(rel ?? "")?.[1];
      if (!name || !DOT_DIR.test(name)) return false;
      const previous = stamps.get(name);
      stamps.delete(name);
      return previous !== undefined && previous !== stamped(name);
    },
  };
}

export interface WatchOptions {
  /** Trailing debounce window (P-RC-4 budgets 300ms). */
  debounceMs?: number;
  /** Resubscribe attempts before liveness is declared lost (R-RC-4). */
  maxResubscribes?: number;
}

/**
 * Which part of the model a changed path invalidates, or `null` when the path
 * is irrelevant. Pure — the consumer re-fetches exactly one scope, which is
 * what keeps the change path off the full-rescan budget (P-RC-2b).
 */
export function classifyScope(recordDir: string, changed: string): Scope | null {
  const rel = path.relative(path.resolve(recordDir), path.resolve(changed));
  if (rel === "" || path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)) {
    return null;
  }
  const segments = rel.split(path.sep);
  const [head, next] = segments;
  if (segments.length === 1 && head === STATE_FILENAME) return "state";
  if (head === CONSTRUCTION_DIRNAME && next !== undefined) return `matrix:${next}`;
  if (head === AUDIT_DIRNAME) return "audit";
  const reviewDirectory = REVIEW_DIRNAMES.find((dir) => segments.join("/").startsWith(`${dir}/`));
  if (reviewDirectory !== undefined) {
    const reviewParts = segments
      .join("/")
      .slice(reviewDirectory.length + 1)
      .split("/");
    if (reviewParts[1] === "units" && reviewParts[2]) return `matrix:${reviewParts[2]}`;
  }
  if (workspaceLayout(recordDir) !== null && recordReviewInput(segments.join("/")))
    return "review-inputs";
  return null;
}

export interface ChangeQueue {
  push(scope: Scope, changedPath: string): void;
  cancel(): void;
}

/**
 * Trailing debounce that coalesces a burst into **one event per scope**. Split
 * out from {@link watch} so the timing rule is testable with fake timers
 * without a real filesystem.
 */
export function createChangeQueue(
  debounceMs: number,
  emit: (event: ChangeEvent) => void,
): ChangeQueue {
  const pending = new Map<Scope, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const batch = [...pending.entries()];
    pending.clear();
    for (const [scope, changedPath] of batch) emit({ type: "change", scope, path: changedPath });
  };

  return {
    push(scope, changedPath) {
      // A burst can append receipts in several clone shards. Preserve that
      // invalidation as the audit directory instead of losing all but one path.
      const previous = pending.get(scope);
      pending.set(
        scope,
        scope === "audit" && previous !== undefined && previous !== changedPath
          ? path.dirname(changedPath)
          : changedPath,
      );
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}

/**
 * Watch state, construction artifacts, audit, and review records for changes.
 *
 * Returns `dispose`. Disposal flips a flag *before* closing the watcher, so no
 * callback can fire after the consumer has let go (R-RC-4).
 */
export function watch(
  recordDir: string,
  cb: (event: WatchEvent) => void,
  options: WatchOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxResubscribes = options.maxResubscribes ?? DEFAULT_MAX_RESUBSCRIBES;

  let disposed = false;
  let attempts = 0;
  let watcher: FSWatcher | null = null;

  const notify = (event: WatchEvent): void => {
    if (!disposed) cb(event);
  };
  const queue = createChangeQueue(debounceMs, notify);

  const recordTargets = [
    path.join(recordDir, STATE_FILENAME),
    path.join(recordDir, CONSTRUCTION_DIRNAME),
    path.join(recordDir, AUDIT_DIRNAME),
    ...REVIEW_DIRNAMES.map((directory) => path.join(recordDir, directory)),
  ];

  const subscribe = (): boolean => {
    try {
      const policy = sourceWatchPolicy(recordDir);
      // Subscribe at the existing record root: watching a not-yet-created
      // nested review path can miss its initial mkdir/write burst on Windows.
      const next = chokidarWatch([policy?.root ?? recordDir], {
        ignoreInitial: true,
        followSymlinks: false,
        ignored:
          policy?.ignored ??
          ((changed: string) => {
            const absolute = path.resolve(changed);
            return !recordTargets.some(
              (target) =>
                absolute === target ||
                target.startsWith(`${absolute}${path.sep}`) ||
                absolute.startsWith(`${target}${path.sep}`),
            );
          }),
      });
      next.on("all", (event, changed) => {
        if (disposed || watcher !== next) return;
        const scope = policy
          ? policy.classify(changed, event === "addDir" || event === "unlinkDir")
          : classifyScope(recordDir, changed);
        if (scope !== null) queue.push(scope, changed);
        if (policy?.stampChanged(changed)) {
          void next.close().catch(() => {});
          watcher = null;
          if (!subscribe()) notify({ type: "watch-warning", reason: "resubscribe-failed" });
        }
      });
      next.on("error", () => {
        if (watcher === next) onError();
      });
      watcher = next;
      return true;
    } catch {
      return false;
    }
  };

  function onError(): void {
    if (disposed) return;
    void watcher?.close().catch(() => {});
    watcher = null;
    attempts += 1;
    if (attempts > maxResubscribes || !subscribe()) {
      // Never fail silently: the UI has to be able to say "no longer live".
      notify({ type: "watch-warning", reason: "resubscribe-failed" });
    }
  }

  if (!subscribe()) {
    notify({ type: "watch-warning", reason: "watcher-lost" });
    return () => {};
  }

  return () => {
    disposed = true;
    queue.cancel();
    void watcher?.close().catch(() => {});
    watcher = null;
  };
}
