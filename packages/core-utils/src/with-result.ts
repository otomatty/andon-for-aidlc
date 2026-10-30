import type { ReadResult } from "@andon/shared-types";

/**
 * Last line of defence for R-RC-1 ("throw ゼロ"): every public method body runs
 * inside this, so an unexpected internal fault becomes `{error, reason}` rather
 * than an exception crossing the package boundary.
 *
 * Known failures are already returned as `{error, reason}` early by the callee;
 * this only catches the ones nobody predicted.
 */
export async function withResult<T>(fn: () => Promise<ReadResult<T>>): Promise<ReadResult<T>> {
  try {
    return await fn();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { error: true, reason: `internal: ${message}` };
  }
}
