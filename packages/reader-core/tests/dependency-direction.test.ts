import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * BR-RC-3 / S-RC-1 enforced structurally rather than by review: reader-core is
 * a pure data layer. oxlint's `no-restricted-imports` rule covers the fs write APIs;
 * this covers the UI/transport direction and the package's dependency list.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const PACKAGE_JSON = path.resolve(SRC, "..", "package.json");

/** Anything that would make reader-core depend on a surface or a transport. */
const FORBIDDEN = [
  "react",
  "react-dom",
  "@modelcontextprotocol",
  "express",
  "ws",
  "node:http",
  "node:https",
  "node:net",
  "node:dgram",
];

/** fs entry points that would let this package write (BR-RC-1). */
const WRITE_APIS =
  /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|createWriteStream|truncate|symlink|chmod|chown|utimes)\b/;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files.sort();
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+["']([^"']+)["']/g;

describe("dependency direction", () => {
  it("imports no UI or transport module", async () => {
    const files = await sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const [, specifier] of text.matchAll(IMPORT_RE)) {
        for (const banned of FORBIDDEN) {
          expect(specifier, `${path.basename(file)} imports ${specifier}`).not.toBe(banned);
          expect(specifier, `${path.basename(file)} imports ${specifier}`).not.toMatch(
            new RegExp(`^${banned}/`),
          );
        }
      }
    }
  });

  it("uses no filesystem write API", async () => {
    for (const file of await sourceFiles(SRC)) {
      const text = await readFile(file, "utf8");
      // Strip comments so the prose explaining the rule does not trip it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code, `${path.basename(file)} references a write API`).not.toMatch(WRITE_APIS);
    }
  });

  it("declares only chokidar and the first-party foundation packages as dependencies", async () => {
    const manifest = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@andon/core-utils",
      "@andon/shared-types",
      "chokidar",
    ]);
  });
});
