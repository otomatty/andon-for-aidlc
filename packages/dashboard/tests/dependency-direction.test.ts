import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * BR-UI-1 / S-UI-1 / S-UI-2 / S-UI-3 enforced structurally rather than by
 * review. These are the rules that are cheap to break by accident and
 * expensive to notice: one `import { createReader }` would put filesystem code
 * in a browser bundle, one `fetch(..., {method:"POST"})` would make a
 * read-only surface writable.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/** Anything that would give this package filesystem or server reach. */
const FORBIDDEN_IMPORTS = [
  "@aidlc-guide/reader-core",
  "@aidlc-guide/docs-bridge",
  "@aidlc-guide/official-docs",
  "@aidlc-guide/dashboard-server",
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:child_process",
  "chokidar",
];

const REQUIRED_DEPENDENCIES = ["react", "react-dom", "@aidlc-guide/shared-types"];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+["']([^"']+)["']/g;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files.sort();
}

/** Strip comments so the prose explaining a rule cannot trip the rule. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("dashboard dependency direction", () => {
  it("imports no reader, no bridge and no node builtin", async () => {
    const files = await sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const [, specifier] of text.matchAll(IMPORT_RE)) {
        for (const banned of FORBIDDEN_IMPORTS) {
          expect(specifier, `${path.basename(file)} imports ${specifier}`).not.toBe(banned);
        }
      }
    }
  });

  it("declares required deps and the Mantine UI stack", async () => {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const keys = Object.keys(manifest.dependencies);
    for (const required of REQUIRED_DEPENDENCIES) {
      expect(keys).toContain(required);
    }
    expect(keys).toContain("tailwindcss");
    expect(keys).toContain("lucide-react");
    expect(keys).toContain("@mantine/core");
    expect(keys).toContain("@mantine/hooks");
  });

  /**
   * ADR-05 / S-AV-3: `marked` may only be used as a **lexer**. `marked.parse`,
   * `marked.parseInline` and the `marked()` shorthand all return an HTML
   * string, which would need innerHTML to display and would reopen the raw-HTML
   * path this unit exists to keep shut.
   */
  it("uses marked only as a lexer, never as an HTML parser", async () => {
    for (const file of await sourceFiles(SRC)) {
      const body = code(await readFile(file, "utf8"));
      expect(body, `${path.basename(file)} calls marked's HTML parser`).not.toMatch(
        /\bmarked\s*[(.]/,
      );
      // Tiptap's helpers.parseInline returns document nodes, not HTML.
      // Check parser imports from marked without banning unrelated helpers.
      for (const [declaration] of body.matchAll(/import\s+[^;]*?from\s+["']marked["']/g))
        expect(declaration, `${path.basename(file)} imports marked's HTML parser`).not.toMatch(
          /\b(?:parse|parseInline|Parser|Marked)\b/,
        );
    }
  });

  /**
   * S-UI-1 / S-AV-1. Disk write is `POST /api/answer` in the artifact-viewer
   * unit. View-pin mutation is `POST /api/select-intent` in services/.
   */
  it("issues a write request from exactly the allowed modules (S-AV-1)", async () => {
    const writers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const body = code(await readFile(file, "utf8"));
      const writes =
        /method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(body) ||
        body.includes("/api/answer") ||
        body.includes("/api/select-intent");
      if (writes) writers.push(path.relative(SRC, file));
    }
    expect(writers.sort()).toEqual(
      [
        path.join("shared", "services", "select-intent.ts"),
        path.join("shared", "services", "transport", "browser.ts"),
        path.join("viewer", "services", "answer.ts"),
      ].sort(),
    );
  });

  it("never injects raw HTML (S-UI-3)", async () => {
    for (const file of await sourceFiles(SRC)) {
      const body = code(await readFile(file, "utf8"));
      expect(body, `${path.basename(file)} uses dangerouslySetInnerHTML`).not.toContain(
        "dangerouslySetInnerHTML",
      );
      expect(body).not.toContain("innerHTML");
    }
  });

  it("reaches the network from exactly two modules (the GET client and the one writer)", async () => {
    const callers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const body = code(await readFile(file, "utf8"));
      if (/\bfetch\s*\(/.test(body)) callers.push(path.relative(SRC, file));
    }
    expect(callers.sort()).toEqual([path.join("shared", "services", "transport", "browser.ts")]);
  });
});
