import { readdir } from "node:fs/promises";
import path from "node:path";
import { guardPath, readBounded } from "@andon/core-utils";
import type { IntentList, ReadResult } from "@andon/shared-types";
import { indexIntentRecords, sortIntentNames } from "./order.ts";
import { isSpaceName, readActiveSpace } from "./spaces.ts";

/**
 * L4 — cursor resolution and enumeration.
 *
 * Active resolution mirrors aidlc-lib `activeIntent()`:
 *   cursor (if it names a listed record) > lone-intent > null.
 * Enumeration of `all` stays independent of the cursor (failure mode 2).
 */

export const DEFAULT_SPACE = "default";
const WORKSPACE_DIRNAME = "aidlc";

/** Cursors are one short line; the bound guards against a garbage file. */
const CURSOR_MAX_BYTES = 4096;
const REGISTRY_MAX_BYTES = 4 * 1024 * 1024;

async function readCursor(file: string): Promise<string | null> {
  const read = await readBounded(file, CURSOR_MAX_BYTES);
  if (!read.ok) return null;
  const first = read.value.split(/\r?\n/)[0]?.trim();
  return first === undefined || first === "" ? null : first;
}

export function intentsDirOf(rootPath: string, space: string): string {
  return path.join(rootPath, WORKSPACE_DIRNAME, "spaces", space, "intents");
}

/**
 * Precedence matches `.claude/tools/aidlc-lib.ts` `activeIntent()`:
 * named cursor, else the single record when exactly one exists, else null.
 */
export function electActive(all: readonly string[], cursor: string | null): string | null {
  if (cursor !== null && all.includes(cursor)) return cursor;
  if (all.length === 1) return all[0] ?? null;
  return null;
}

export async function resolveIntents(
  rootPath: string,
  requestedSpace?: string,
): Promise<ReadResult<IntentList>> {
  if (requestedSpace !== undefined && !isSpaceName(requestedSpace))
    return { error: true, reason: "outside-record" };
  const activeSpace =
    requestedSpace === undefined
      ? await readActiveSpace(rootPath)
      : { ok: true, value: requestedSpace };
  if (!("ok" in activeSpace)) return activeSpace;
  const space = activeSpace.value;
  const dir = intentsDirOf(rootPath, space);
  const guarded = await guardPath(rootPath, path.relative(rootPath, dir));
  if (!("ok" in guarded)) return guarded;

  let all: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    all = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return { ok: true, value: { space, active: null, all: [], selected: null } };
  }

  const registryPath = await guardPath(rootPath, `aidlc/spaces/${space}/intents/intents.json`);
  const registry =
    "ok" in registryPath ? await readBounded(registryPath.value, REGISTRY_MAX_BYTES) : null;
  let records: Record<string, unknown>[] = [];
  if (registry?.ok) {
    try {
      const parsed: unknown = JSON.parse(registry.value);
      if (Array.isArray(parsed)) {
        records = parsed.filter(
          (row): row is Record<string, unknown> =>
            row !== null && typeof row === "object" && !Array.isArray(row),
        );
      }
    } catch {
      // Directory dates still provide an order when the registry is unavailable.
    }
  }
  all = sortIntentNames(all, indexIntentRecords(records, all));

  // CI / fresh clones have no committed active-intent cursor (gitignored).
  // With two or more records, lone-intent cannot elect — allow an explicit
  // override so smoke tests against the live workspace stay deterministic.
  // File cursor wins when present (local session); env fills the gap in CI.
  const fileCursor = await readCursor(path.join(dir, "active-intent"));
  const envCursor = process.env.AIDLC_ACTIVE_INTENT?.trim() || null;
  const cursor = fileCursor ?? envCursor;
  const active = electActive(all, cursor);
  return { ok: true, value: { space, active, all, selected: null } };
}

/** Record directory of the active intent, or the standard no-active-intent error. */
export async function resolveRecordDir(rootPath: string): Promise<ReadResult<string>> {
  const intents = await resolveIntents(rootPath);
  if (!("ok" in intents)) return intents;
  if (intents.value.active === null) return { error: true, reason: "no-active-intent" };
  return {
    ok: true,
    value: path.join(intentsDirOf(rootPath, intents.value.space), intents.value.active),
  };
}
