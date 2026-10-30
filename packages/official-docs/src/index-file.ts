import path from "node:path";
import { guardPath, readBounded } from "@andon/core-utils";
import { DOCS_INDEX_REL, type DocsIndex } from "./retrieval-types.ts";

/** The aggregate index can outgrow the 10 MiB single-document limit; cap it at 32 MiB. */
export const MAX_DOCS_INDEX_BYTES = 32 * 1024 * 1024;

/** Serialize exactly what is written and reject oversized UTF-8 output before replacing an index. */
export function serializeDocsIndex(index: DocsIndex): string {
  const text = `${JSON.stringify(index)}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_DOCS_INDEX_BYTES)
    throw new Error(
      `index_too_large: ${DOCS_INDEX_REL}: ${bytes} bytes exceeds ${MAX_DOCS_INDEX_BYTES} bytes. Split or reduce the indexed corpus before rebuilding.`,
    );
  return text;
}

/** Read only the guarded aggregate index using the same limit enforced by its writer. */
export async function readDocsIndex(root: string): Promise<string> {
  const guarded = await guardPath(path.join(root, "docs"), "official-docs.index.json");
  if (!("ok" in guarded)) throw new Error("path_rejected");
  const result = await readBounded(guarded.value, MAX_DOCS_INDEX_BYTES);
  if (!result.ok)
    throw new Error(result.reason === "file-too-large" ? "index_too_large" : "docs_unavailable");
  return result.value;
}
