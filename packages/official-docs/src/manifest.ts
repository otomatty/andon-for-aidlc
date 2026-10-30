import { guardPath, readBounded, withResult } from "@andon/core-utils";
import type { ReadResult } from "@andon/shared-types";
import { docsRoot } from "./roots.ts";
import type { Manifest } from "./types.ts";

function parseManifest(raw: string): Manifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const sourceVersion = record.sourceVersion;
  const source = record.source;
  const capturedAt = record.capturedAt;
  if (
    typeof sourceVersion !== "string" ||
    sourceVersion.trim() === "" ||
    typeof source !== "string" ||
    source.trim() === "" ||
    typeof capturedAt !== "string" ||
    capturedAt.trim() === ""
  ) {
    return null;
  }
  return {
    sourceVersion: sourceVersion.trim(),
    source: source.trim(),
    capturedAt: capturedAt.trim(),
  };
}

/**
 * Read `docs/official-docs.manifest.json` under the workspace root.
 * Missing / invalid / empty required fields → `empty_content` (BR-OD-6).
 */
export async function readManifest(workspaceRoot: string): Promise<ReadResult<Manifest>> {
  return withResult(async () => {
    const root = docsRoot(workspaceRoot);
    // Containment against docs/ so the read cannot escape via symlink (BR-OD-2).
    const guarded = await guardPath(root, "official-docs.manifest.json");
    if (!("ok" in guarded)) {
      return { error: true, reason: "path_rejected" };
    }

    const bounded = await readBounded(guarded.value);
    if (!bounded.ok) {
      return { error: true, reason: "empty_content" };
    }

    const manifest = parseManifest(bounded.value);
    if (manifest === null) {
      return { error: true, reason: "empty_content" };
    }
    return { ok: true, value: manifest };
  });
}
