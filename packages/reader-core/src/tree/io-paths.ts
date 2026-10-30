import { readdir } from "node:fs/promises";
import path from "node:path";
import { withResult } from "@andon/core-utils";
import type { ReadResult } from "@andon/shared-types";

/** Recursively lists Markdown files as sorted record-relative POSIX paths. */
export function listMarkdownRel(recordDir: string): Promise<ReadResult<string[]>> {
  return withResult(async () => {
    const markdown: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.endsWith(".md")) {
          markdown.push(path.relative(recordDir, absolute).split(path.sep).join("/"));
        }
      }
    };

    await visit(recordDir);
    return { ok: true, value: markdown.sort() };
  });
}

function pathBasename(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  return slash === -1 ? relPath : relPath.slice(slash + 1);
}

function pathSegments(relPath: string): string[] {
  return relPath.split("/");
}

/** hits = record 相対 POSIX（`/`）。fileName は `foo.md`。 */
export function pickIoPath(
  hits: readonly string[],
  fileName: string,
  opts: { unit: string | null; stage: string; specificOnly?: boolean },
): string | null {
  if (opts.unit !== null) {
    const unitPrefix = `construction/${opts.unit}/`;
    const unitHits = hits.filter(
      (hit) => hit.startsWith(unitPrefix) && pathBasename(hit) === fileName,
    );
    if (unitHits.length === 1) {
      const hit = unitHits[0];
      if (hit !== undefined) return hit;
    }
    if (unitHits.length > 1) {
      const stageHits = unitHits.filter((hit) => {
        const segments = pathSegments(hit);
        return segments.length >= 3 && segments[2] === opts.stage;
      });
      const pool = stageHits.length > 0 ? stageHits : unitHits;
      const picked = [...pool].sort()[0];
      if (picked !== undefined) return picked;
    }
  }

  const stageDirHits = hits.filter((hit) => {
    const segments = pathSegments(hit);
    return segments.length === 3 && segments[0] === "construction" && segments[2] === fileName;
  });
  const currentStageHit = stageDirHits.find((hit) => pathSegments(hit)[1] === opts.stage);
  if (currentStageHit !== undefined) return currentStageHit;

  // Everything below is best-effort: a lone `construction/<other stage>/` file
  // and a lone file outside `construction/` are both guesses about who wrote
  // it. A caller probing several filenames for one artifact runs a first pass
  // with this on, so a best-effort match on an earlier candidate cannot beat
  // the genuinely stage-specific file matching a later one.
  if (opts.specificOnly === true) return null;

  if (stageDirHits.length === 1) {
    const hit = stageDirHits[0];
    if (hit !== undefined) return hit;
  }

  const sharedHits = hits.filter(
    (hit) => !hit.startsWith("construction/") && pathBasename(hit) === fileName,
  );
  if (sharedHits.length === 1) {
    const hit = sharedHits[0];
    if (hit !== undefined) return hit;
  }

  return null;
}
