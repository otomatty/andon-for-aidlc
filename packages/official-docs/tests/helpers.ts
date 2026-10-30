import { join } from "node:path";
import type { ReadResult } from "@andon/shared-types";
import { expect } from "vitest";

export const workspaceRoot = join(import.meta.dirname, "../../..");

export function expectOk<T>(result: ReadResult<T>): T {
  if (!("ok" in result)) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result.value;
}

export function expectError(result: ReadResult<unknown>, reason: string): void {
  if (!("error" in result) || !result.error) {
    throw new Error(`expected error ${reason}, got ${JSON.stringify(result)}`);
  }
  expect(result.reason).toBe(reason);
}
