import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReadResult } from "@andon/shared-types";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Committed degraded/healthy fixtures. */
export const FIXTURES = path.join(here, "fixtures");

/** The workspace root of this repository. */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

/**
 * CI pin for live-workspace smoke (`check.yml`). The active-intent cursor is
 * gitignored, so a multi-record clone elects nothing unless this is set.
 */
export function liveActiveIntent(): string {
  return process.env.AIDLC_ACTIVE_INTENT?.trim() || "260730-docs-i18n";
}

/**
 * The live AI-DLC record. **Read only** — tests must never write here
 * (NFR-1 / project.md Forbidden). Used for the structural smoke test; exact
 * values are asserted against the pinned snapshot in `fixtures/golden`.
 */
export const REAL_RECORD = path.join(
  REPO_ROOT,
  "aidlc",
  "spaces",
  "default",
  "intents",
  "260720-aidlc-guide-prd",
);

export function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

/** Narrow to the `ok` variant, failing loudly with the actual result if not. */
export function expectOk<T>(result: ReadResult<T>): { value: T; warnings?: string[] } {
  if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return { value: result.value, ...(result.warnings ? { warnings: result.warnings } : {}) };
}
