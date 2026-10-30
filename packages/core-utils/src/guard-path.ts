import path from "node:path";
import type { ReadResult } from "@andon/shared-types";
import { canonicalPath } from "./canonical-path.ts";

/**
 * Is `target` inside `root`?
 *
 * Deliberately `path.relative`-based, never `startsWith` on the absolute paths:
 * `"/rec/foobar".startsWith("/rec/foo")` is true, yet `/rec/foobar` is outside
 * the record (S-RC-2 / business-logic-model.md L6). `path.relative` yields
 * `"../foobar"` for that pair, which the `..` test rejects.
 *
 * `path.sep` is used for the segment boundary rather than hardcoding `/`
 * (BR-RC-7), and both sides are resolved first so drive letters and casing are
 * normalised by the platform's own rules.
 */
function contains(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel === "") return true; // the root itself
  if (path.isAbsolute(rel)) return false; // different drive/root — no relation
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

/**
 * Primary enforcement of the read boundary (S-RC-2). Callers (mcp-server,
 * dashboard-server) re-check as defence in depth, but this is the one that counts.
 *
 * Rejects three vectors, all as `"outside-record"`:
 *  1. `../` traversal,
 *  2. an absolute path outside the record (absorbed by `path.relative`),
 *  3. symlink escape — the lexical answer is re-checked against `realpath`.
 *
 * Pure with respect to the filesystem apart from the `realpath` probe, so the
 * three vectors are unit-testable without a server.
 */
export async function guardPath(recordDir: string, relPath: string): Promise<ReadResult<string>> {
  const root = path.resolve(recordDir);
  const target = path.resolve(root, relPath);
  if (!contains(root, target)) return { error: true, reason: "outside-record" };

  // Vector 3. A path that does not exist yet cannot be a symlink escape, so an
  // unresolvable realpath falls through to the lexical verdict; the subsequent
  // read reports it as not-found.
  try {
    const realRoot = await canonicalPath(root);
    const realTarget = await canonicalPath(target);
    if (!contains(realRoot, realTarget)) return { error: true, reason: "outside-record" };
  } catch {
    /* not resolvable — nothing to escape through */
  }

  return { ok: true, value: target };
}
