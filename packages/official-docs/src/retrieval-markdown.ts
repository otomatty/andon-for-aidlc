import { createHash } from "node:crypto";
import { slugifyHeading } from "@andon/shared-types";
import type { IndexedSection } from "./retrieval-types.ts";

/** Hash UTF-8 source text for index freshness checks and reviewer translation approvals. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Deliberately conservative, model-independent estimate, not a tokenizer count. */
export function estimateTokens(text: string): number {
  let units = 0;
  for (const character of text) units += character.charCodeAt(0) < 128 ? 1 : 4;
  return Math.ceil(units / 3);
}

/** Fences close only with the same character and at least the opening length. */
function fenceAfter(line: string, fence: string | null): string | null {
  if (fence !== null) {
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
    return closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length
      ? null
      : fence;
  }
  return /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
}

/** Disjoint sections: parent text is not repeated in every child result. */
export function indexSections(markdown: string, pageKey: string): IndexedSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: IndexedSection[] = [];
  const parents: { level: number; title: string; id: string }[] = [];
  const anchors = new Set<string>();
  let fence: string | null = null;
  let current: IndexedSection | undefined;
  /** Close the current section at the exclusive array boundary while preserving source line numbers. */
  const finish = (end: number) => {
    if (current === undefined) return;
    current.endLine = end;
    current.text = lines.slice(current.startLine - 1, end).join("\n");
    sections.push(current);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const previousFence = fence;
    fence = fenceAfter(line, fence);
    if (previousFence !== null || fence !== null) continue;
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match === null) continue;
    if (current === undefined && i > 0 && lines.slice(0, i).join("\n").trim() !== "") {
      current = {
        id: `${pageKey}:preamble`,
        anchor: "",
        headings: [],
        startLine: 1,
        endLine: i,
        text: "",
      };
    }
    finish(i);
    const level = match[1]?.length ?? 1;
    const title = (match[2] ?? "").replace(/\s+#+\s*$/, "");
    while (parents.length > 0 && (parents.at(-1)?.level ?? 0) >= level) parents.pop();
    const base = slugifyHeading(line);
    let anchor = base;
    let suffix = 0;
    while (anchors.has(anchor)) anchor = `${base}-${++suffix}`;
    anchors.add(anchor);
    const id = `${pageKey}:${i + 1}`;
    const parent = parents[parents.length - 1];
    current = {
      id,
      anchor,
      headings: [...parents.map((p) => p.title), title],
      startLine: i + 1,
      endLine: lines.length,
      text: "",
      ...(parent === undefined ? {} : { parentId: parent.id }),
    };
    parents.push({ level, title, id });
  }
  if (current === undefined)
    current = {
      id: `${pageKey}:1`,
      anchor: "",
      headings: [],
      startLine: 1,
      endLine: lines.length,
      text: "",
    };
  finish(lines.length);
  // A glossary/reference row is independently readable with its column headers.
  // Keep the original section too, for callers explicitly asking for the full table.
  for (const section of [...sections]) {
    let tableFence: string | null = null;
    for (let i = section.startLine - 1; i < section.endLine - 2; i++) {
      tableFence = fenceAfter(lines[i] ?? "", tableFence);
      if (tableFence !== null || !(lines[i] ?? "").includes("|")) continue;
      if (!/^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1] ?? "")) continue;
      const header = lines.slice(i, i + 2).join("\n");
      for (let row = i + 2; row < section.endLine && (lines[row] ?? "").includes("|"); row++) {
        const line = lines[row] ?? "";
        const label = line
          .replace(/^\s*\|/, "")
          .split(/(?<!\\)\|/)[0]
          ?.replace(/[*`]/g, "")
          .trim();
        if (!label) continue;
        sections.push({
          id: `${pageKey}:row:${row + 1}`,
          anchor: section.anchor,
          headings: [...section.headings, label],
          startLine: row + 1,
          endLine: row + 1,
          parentId: section.id,
          tableHeaderStart: i + 1,
          text: `${header}\n${line}`,
        });
      }
    }
  }
  return sections;
}

/** Pagination boundaries preserve paragraphs, tables and fenced code verbatim. */
export function markdownBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let start = 0;
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    fence = fenceAfter(lines[i] ?? "", fence);
    if (fence === null && lines[i]?.trim() === "" && i >= start) {
      blocks.push(lines.slice(start, i + 1).join("\n") + (i < lines.length - 1 ? "\n" : ""));
      start = i + 1;
    }
  }
  if (start < lines.length) blocks.push(lines.slice(start).join("\n"));
  return blocks.filter((block) => block.length > 0);
}
