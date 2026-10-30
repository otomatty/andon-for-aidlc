import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { BridgeConfig, ProjectLink, ReadResult } from "@aidlc-guide/shared-types";

/** Default config filename, looked up in the workspace root (D1 step 1). */
export const CONFIG_FILENAME = "aidlc-guide.config.json";

const DEFAULT_CONFIG: BridgeConfig = {
  docsRepoPath: null,
  projectLinks: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Drops malformed entries with a warning rather than failing the whole load. */
function readProjectLinks(raw: unknown, warnings: string[]): ProjectLink[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push("projectLinks is not an array, ignored");
    return [];
  }
  const links: ProjectLink[] = [];
  for (const [index, entry] of raw.entries()) {
    if (isRecord(entry) && typeof entry.label === "string" && typeof entry.target === "string") {
      links.push({ label: entry.label, target: entry.target });
    } else {
      warnings.push(`projectLinks[${index}] is not {label, target}, ignored`);
    }
  }
  return links;
}

/**
 * D1 — load `aidlc-guide.config.json`.
 *
 * `configPath` defaults to `<cwd>/aidlc-guide.config.json`. A relative
 * `docsRepoPath` resolves against the **config file's own directory**, not the
 * process cwd, so a config committed next to the workspace keeps working
 * whatever directory the server is started from (BR-DB-6 — `node:path` only, no
 * `path.sep` literals).
 *
 * Degradation ladder, straight from the design:
 * - file absent            -> `{ok}` with the defaults (running unconfigured is normal)
 * - unparseable / wrong type -> `{error, reason: "config-invalid"}` (fail loud: a
 *   typo'd config must not silently look like "no config")
 * - `docsRepoPath` missing on disk -> `{ok}` + warning (fail-soft; excerpts drop out)
 */
export async function loadConfig(configPath?: string): Promise<ReadResult<BridgeConfig>> {
  const file = path.resolve(configPath ?? path.join(process.cwd(), CONFIG_FILENAME));

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, value: DEFAULT_CONFIG };
    }
    // Present but unreadable (permissions, a directory in its place) is a real
    // misconfiguration, not "unconfigured" — surface it.
    return { error: true, reason: "config-invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: true, reason: "config-invalid" };
  }
  if (!isRecord(parsed)) return { error: true, reason: "config-invalid" };

  const warnings: string[] = [];
  const rawDocsRepoPath = parsed.docsRepoPath;
  if (
    rawDocsRepoPath !== undefined &&
    rawDocsRepoPath !== null &&
    typeof rawDocsRepoPath !== "string"
  ) {
    return { error: true, reason: "config-invalid" };
  }

  const projectLinks = readProjectLinks(parsed.projectLinks, warnings);

  let docsRepoPath: string | null = null;
  if (typeof rawDocsRepoPath === "string" && rawDocsRepoPath.trim() !== "") {
    docsRepoPath = path.resolve(path.dirname(file), rawDocsRepoPath);
    try {
      const info = await stat(docsRepoPath);
      if (!info.isDirectory()) {
        warnings.push(`docsRepoPath is not a directory, excerpts disabled: ${docsRepoPath}`);
        docsRepoPath = null;
      }
    } catch {
      warnings.push(`docsRepoPath does not exist, excerpts disabled: ${docsRepoPath}`);
      docsRepoPath = null;
    }
  }

  const value: BridgeConfig = { docsRepoPath, projectLinks };
  return warnings.length > 0 ? { ok: true, value, warnings } : { ok: true, value };
}
