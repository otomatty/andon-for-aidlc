/**
 * Copy packaged official-docs snapshot into the VS Code extension media tree.
 * Layout: media/official-docs/docs/{<section>…,official-docs.manifest.json}
 *
 * Section list comes from the package, so a section added there is packaged
 * without touching this script — a snapshot missing a section would otherwise
 * serve an installed VSIX an empty nav for it with no build-time signal.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDE_VERSION_REL } from "../packages/official-docs/src/question-context.ts";
import { DOC_SECTIONS } from "../packages/official-docs/src/roots.ts";
import { regenerateDocsIndex } from "./build-docs-index.ts";

export async function copyOfficialDocsMedia(root: string): Promise<string> {
  const bundle = join(root, "packages/vscode-extension/media/official-docs");
  const dest = join(bundle, "docs");

  await regenerateDocsIndex(root, true);

  rmSync(bundle, {
    recursive: true,
    force: true,
  });
  mkdirSync(dest, { recursive: true });
  const missing: string[] = [];
  for (const section of DOC_SECTIONS) {
    const from = join(root, "docs", section);
    if (!existsSync(from)) {
      // RFCs were removed upstream in 2.8; the section remains readable in older snapshots.
      if (section !== "rfcs") missing.push(section);
      continue;
    }
    cpSync(from, join(dest, section), { recursive: true });
  }
  cpSync(join(root, "docs/official-docs.manifest.json"), join(dest, "official-docs.manifest.json"));
  cpSync(join(root, "docs/official-docs.index.json"), join(dest, "official-docs.index.json"));
  if (!existsSync(join(root, "docs/guides"))) missing.push("guides");
  else cpSync(join(root, "docs/guides"), join(dest, "guides"), { recursive: true });
  const metadata: unknown = JSON.parse(
    readFileSync(join(root, "packages/vscode-extension/package.json"), "utf8"),
  );
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("version" in metadata) ||
    typeof metadata.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version)
  )
    throw new Error("Extension package.json needs a valid version for bundled guides");
  writeFileSync(
    join(bundle, GUIDE_VERSION_REL),
    `${JSON.stringify({ version: metadata.version })}\n`,
  );
  cpSync(
    join(root, "packages/mcp-server/skills/andon-docs"),
    join(root, "packages/vscode-extension/media/andon-docs"),
    { recursive: true },
  );

  if (missing.length > 0) {
    // Fail the build rather than ship a VSIX whose nav is silently short a book.
    throw new Error(`missing official-docs section(s) under docs/: ${missing.join(", ")}`);
  }

  return dest;
}

if (import.meta.main) {
  const dest = await copyOfficialDocsMedia(join(import.meta.dirname, ".."));
  console.log(`copied official docs (${DOC_SECTIONS.join(", ")}, guides) → ${dest}`);
}
