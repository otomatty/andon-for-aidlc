import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReadResult } from "@andon/shared-types";

const here = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURES = path.join(here, "fixtures");

/** Stand-in docs checkout used wherever a `docsRepoPath` is needed. */
export const DOCS_ROOT = path.join(FIXTURES, "docs");

/** Deliberately a sibling of {@link DOCS_ROOT}, so `../outside/...` escapes it. */
export const OUTSIDE_ROOT = path.join(FIXTURES, "outside");

/** The workspace root of this repository — the real docs tree for the data-lint. */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

/** Narrow to the `ok` variant, failing loudly with the actual result if not. */
export function expectOk<T>(result: ReadResult<T>): { value: T; warnings: string[] } {
  if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return { value: result.value, warnings: result.warnings ?? [] };
}

/** Narrow to the `error` variant. */
export function expectError<T>(result: ReadResult<T>): string {
  if (!("error" in result)) throw new Error(`expected error, got ${JSON.stringify(result)}`);
  return result.reason;
}
