import type { ReadResult } from "@andon/shared-types";

/** Narrow to the `ok` variant, failing loudly with the actual result if not. */
export function expectOk<T>(result: ReadResult<T>): { value: T; warnings?: string[] } {
  if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return { value: result.value, ...(result.warnings ? { warnings: result.warnings } : {}) };
}
