import { readdir } from "node:fs/promises";
import { guardPath, readBounded } from "@andon/core-utils";
import type { ReadResult } from "@andon/shared-types";

export const isSpaceName = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");

/** Names left unchanged by the official utility's slugify(name, 48). */
export const isSwitchableSpaceName = (value: string): boolean =>
  value.length <= 48 && value !== "help" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);

export async function readActiveSpace(root: string): Promise<ReadResult<string>> {
  const guarded = await guardPath(root, "aidlc/active-space");
  if (!("ok" in guarded)) return guarded;
  const read = await readBounded(guarded.value, 4096);
  if (!read.ok)
    return read.reason === "not-found"
      ? { ok: true, value: "default" }
      : { error: true, reason: read.reason };
  const space = read.value.split(/\r?\n/)[0]?.trim() || "default";
  return isSpaceName(space)
    ? { ok: true, value: space }
    : { error: true, reason: "outside-record" };
}

export async function listSpaces(
  root: string,
): Promise<ReadResult<{ active: string; spaces: string[] }>> {
  const active = await readActiveSpace(root);
  if (!("ok" in active)) return active;
  const guarded = await guardPath(root, "aidlc/spaces");
  const names = new Set(["default"]);
  if ("ok" in guarded) {
    try {
      for (const entry of await readdir(guarded.value, { withFileTypes: true }))
        if (entry.isDirectory() && !entry.isSymbolicLink() && isSwitchableSpaceName(entry.name))
          names.add(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { ok: true, value: { active: active.value, spaces: ["default"] } };
      return { error: true, reason: "spaces-unreadable" };
    }
  } else return guarded;
  return { ok: true, value: { active: active.value, spaces: [...names].sort() } };
}
