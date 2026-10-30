import { readdir } from "node:fs/promises";
import path from "node:path";
import { readTail } from "@andon/core-utils";
import {
  CONSTRUCTION_DIRNAME,
  type Matrix,
  type MatrixCell,
  type ReadResult,
  type Verdict,
} from "@andon/shared-types";
import {
  hasReviewRecordDirectory,
  type ReviewVerdicts,
  readReviewVerdicts,
  reviewCellKey,
} from "./review-records.ts";

/**
 * L2 — artifact tree scan. Structure-agnostic (BR-RC-4): the only State-Version
 * knowledge it uses is the CONSTRUCTION stage-slug set, which arrives as an
 * **argument** from the facade. Nothing here is hardcoded, so a scope change
 * follows automatically.
 */

export { CONSTRUCTION_DIRNAME };

/** `**Verdict:** READY` / `NOT-READY` in the closing `## Review` section. */
const VERDICT_RE = /\*\*Verdict:\*\*\s*(NOT-READY|READY)\b/g;

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort(); // R-RC-5: never rely on FS return order
}

/**
 * Last verdict in the cell, found by scanning artifacts newest-name-last and
 * reading only each file's tail (performance-requirements.md 設計制約). No hit
 * inside the tail window means `null` — it never degrades into a full read.
 */
async function findVerdict(stageDir: string, files: string[]): Promise<Verdict | null> {
  for (const name of [...files].reverse()) {
    const tail = await readTail(path.join(stageDir, name));
    if (tail === null) continue;
    let last: Verdict | null = null;
    for (const match of tail.matchAll(VERDICT_RE)) last = match[1] as Verdict;
    if (last !== null) return last;
  }
  return null;
}

async function cellFor(
  recordDir: string,
  unitDir: string,
  unit: string,
  stage: string,
  reviews: ReviewVerdicts,
): Promise<MatrixCell> {
  if (!stage || stage === "." || stage === ".." || /[\\/:\0]/.test(stage))
    return { unit, stage, files: [], verdict: null, error: "invalid-stage" };
  const stageDir = path.join(unitDir, stage);
  let files: string[];
  try {
    files = await listMarkdown(stageDir);
  } catch (cause) {
    // A stage directory that does not exist yet is simply an empty cell; any
    // other read failure is cell-level degradation (failure mode 4).
    const code = (cause as { code?: string }).code;
    if (code === "ENOENT") files = [];
    else
      return { unit, stage, files: [], verdict: null, error: `unreadable: ${code ?? "unknown"}` };
  }
  const key = reviewCellKey(unit, stage);
  // An unreadable shard may contain a reset/request for any cell, including
  // cells absent from the readable history. Do not revive legacy verdicts.
  const verdict = reviews.unavailable
    ? null
    : reviews.cells.has(key)
      ? (reviews.cells.get(key) ?? null)
      : (await hasReviewRecordDirectory(recordDir, unit, stage))
        ? null
        : await findVerdict(stageDir, files);
  return { unit, stage, files, verdict };
}

/** Cells for one unit — the change-driven path (P-RC-2b), never a full rescan. */
export async function buildMatrixForUnit(
  recordDir: string,
  unit: string,
  constructionStageSlugs: readonly string[],
): Promise<ReadResult<MatrixCell[]>> {
  return buildMatrixForUnits(recordDir, [unit], constructionStageSlugs);
}

/** Audit changes may affect several units; share the receipt snapshot across them. */
export async function buildMatrixForUnits(
  recordDir: string,
  units: readonly string[],
  constructionStageSlugs: readonly string[],
): Promise<ReadResult<MatrixCell[]>> {
  const reviews = await readReviewVerdicts(recordDir);
  return {
    ok: true,
    value: (
      await Promise.all(
        units.map((unit) => cellsForUnit(recordDir, unit, constructionStageSlugs, reviews)),
      )
    ).flat(),
  };
}

async function cellsForUnit(
  recordDir: string,
  unit: string,
  constructionStageSlugs: readonly string[],
  reviews: ReviewVerdicts,
): Promise<MatrixCell[]> {
  if (!unit || unit === "." || unit === ".." || /[\\/:\0]/.test(unit)) return [];
  const unitDir = path.join(recordDir, CONSTRUCTION_DIRNAME, unit);
  // Cells are independent directories; order comes from the slug array, not
  // completion order, so concurrency keeps determinism (R-RC-5) — and this
  // path sits inside the ≤2s change→reflect budget (NFR-3).
  const cells = await Promise.all(
    constructionStageSlugs.map((stage) => cellFor(recordDir, unitDir, unit, stage, reviews)),
  );
  return cells;
}

/**
 * Whole-record scan — startup background build only (P-RC-2a). Directories
 * named after a construction stage are cross-stage diaries, not units, so they
 * are excluded by the caller-supplied slug set.
 */
export async function buildMatrix(
  recordDir: string,
  constructionStageSlugs: readonly string[],
): Promise<ReadResult<Matrix>> {
  const root = path.join(recordDir, CONSTRUCTION_DIRNAME);
  const exclude = new Set(constructionStageSlugs);

  let units: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    units = entries
      .filter((e) => e.isDirectory() && !exclude.has(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    // No construction/ yet — an empty matrix, not a failure: the phase simply
    // has not started.
    return { ok: true, value: { units: [], stages: [...constructionStageSlugs], cells: [] } };
  }

  // Per unit in parallel: the scan is IO-bound and the unit count is small and
  // self-limiting, which is what keeps the startup build inside P-RC-2a.
  const rows = await buildMatrixForUnits(recordDir, units, constructionStageSlugs);
  const cells = "ok" in rows ? rows.value : [];

  return { ok: true, value: { units, stages: [...constructionStageSlugs], cells } };
}
