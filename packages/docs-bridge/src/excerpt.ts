import { readFile } from "node:fs/promises";
import { guardPath } from "@andon/core-utils";
import { normalizeAnchor, slugifyHeading } from "@andon/shared-types";

/**
 * The anchor algorithm lives in shared-types: official-docs writes deep links
 * against it and the Shell matches DOM headings against it, so all three have
 * to agree byte-for-byte. Re-exported here because it is part of this
 * package's published surface (`readExcerpt` callers slug their own headings).
 */
export { slugifyHeading };

/** ATX heading level, or 0 when the line is not a heading. */
function headingLevel(line: string): number {
  const match = /^(#{1,6})\s/.exec(line);
  return match?.[1]?.length ?? 0;
}

/**
 * Verbatim slice of the section introduced by `anchor` (BR-DB-2 — the only
 * processing allowed is cutting at heading boundaries; nothing is summarised or
 * rewritten). Returns `null` when no heading matches.
 *
 * The section ends at the next heading of the *same or a shallower* level. The
 * design says "同レベル" — stopping on shallower too is the same rule seen from
 * the other side: a parent heading always ends its children.
 *
 * Fenced blocks are skipped, because aidlc stage files embed completion-message
 * templates like ```# :hammer: Build and Test Complete``` that would otherwise
 * truncate the section at a heading that does not exist in the rendered page.
 */
export function sliceSection(markdown: string, anchor: string): string | null {
  const wanted = normalizeAnchor(anchor);
  if (wanted === "") return null;

  const lines = markdown.split(/\r?\n/);
  let fence: string | null = null;
  let start = -1;
  let level = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceMark = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fenceMark !== undefined) {
      if (fence === null) fence = fenceMark[0] ?? "`";
      else if (fenceMark.startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const lineLevel = headingLevel(line);
    if (lineLevel === 0) continue;

    if (start === -1) {
      if (slugifyHeading(line) === wanted) {
        start = i;
        level = lineLevel;
      }
      continue;
    }
    if (lineLevel <= level) return lines.slice(start, i).join("\n").trimEnd();
  }

  return start === -1 ? null : lines.slice(start).join("\n").trimEnd();
}

export interface ExcerptResult {
  excerpt: string | null;
  /** Present only on degradation — the caller pushes it onto `warnings` (BR-DB-3). */
  warning?: string;
}

/**
 * Read `docPath` under `docsRoot` and slice out `anchor`.
 *
 * Never throws and never returns an error variant: a missing repository,
 * missing file or missing section all degrade to `excerpt: null` plus a warning
 * so the static map entry is still returned (BR-DB-3 / R-DB-2).
 *
 * Containment is enforced by `guardPath` even though `docPath` comes from our
 * own trusted map — defence in depth for S-DB-2, and the guard also covers a
 * symlink inside the docs tree pointing out of it.
 */
export async function readExcerpt(
  docsRoot: string,
  docPath: string,
  anchor: string,
): Promise<ExcerptResult> {
  const guarded = await guardPath(docsRoot, docPath);
  if (!("ok" in guarded)) {
    return { excerpt: null, warning: `docs path outside docsRepoPath, ignored: ${docPath}` };
  }

  let markdown: string;
  try {
    markdown = await readFile(guarded.value, "utf8");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { excerpt: null, warning: `docs file unreadable (${docPath}): ${message}` };
  }

  const section = sliceSection(markdown, anchor);
  return section === null
    ? { excerpt: null, warning: `docs anchor not found in ${docPath}: ${anchor}` }
    : { excerpt: section };
}
