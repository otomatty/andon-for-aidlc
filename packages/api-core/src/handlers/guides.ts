import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { guardPath } from "@aidlc-guide/reader-core";
import type { MarkdownDoc, MarkdownItem, ReadResult } from "@aidlc-guide/shared-types";
import { MD_FILE, titleFromMarkdown } from "./markdown.ts";

/** Preferred order; anything else follows alphabetically. */
const PREFERRED_ORDER = [
  "README.md",
  "getting-started.md",
  "onboarding.md",
  "reading-workflow.md",
  "effectiveness.md",
  "configuring-docs.md",
  "side-questions.md",
  "async-sharing.md",
] as const;

function guidesDir(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, "docs", "guides");
}

function sortGuides(names: string[]): string[] {
  const rank = new Map(PREFERRED_ORDER.map((name, index) => [name.toLowerCase(), index]));
  return [...names].sort((a, b) => {
    const ra = rank.get(a.toLowerCase()) ?? PREFERRED_ORDER.length;
    const rb = rank.get(b.toLowerCase()) ?? PREFERRED_ORDER.length;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

export async function listGuides(workspaceRoot: string): Promise<ReadResult<MarkdownItem[]>> {
  const dir = guidesDir(workspaceRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { ok: true, value: [], warnings: [`docs/guides not found under ${workspaceRoot}`] };
  }

  const names = sortGuides(entries.filter((name) => MD_FILE.test(name)));
  const guides: MarkdownItem[] = [];
  for (const name of names) {
    try {
      const text = await readFile(path.join(dir, name), "utf8");
      guides.push({ name, title: titleFromMarkdown(text, name) });
    } catch {
      // Skip unreadable files rather than failing the whole catalogue.
    }
  }
  return { ok: true, value: guides };
}

export async function readGuide(
  workspaceRoot: string,
  name: string,
): Promise<ReadResult<MarkdownDoc>> {
  if (!MD_FILE.test(name)) {
    return { error: true, reason: "not-found" };
  }
  // The one containment implementation (guardPath) — same as the agents
  // handlers; an inline path.relative check here would be a third copy.
  const guarded = await guardPath(guidesDir(workspaceRoot), name);
  if (!("ok" in guarded)) {
    return { error: true, reason: "not-found" };
  }
  try {
    const markdown = await readFile(guarded.value, "utf8");
    return {
      ok: true,
      value: { name, title: titleFromMarkdown(markdown, name), markdown },
    };
  } catch {
    return { error: true, reason: "not-found" };
  }
}
