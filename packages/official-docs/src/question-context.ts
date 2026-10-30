import { readdir } from "node:fs/promises";
import path from "node:path";
import type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaRequest,
  DocsQaTarget,
} from "@aidlc-guide/shared-types";
import { extractTitle } from "./markdown.ts";
import { createDocsLibrary, sectionRanker } from "./retrieval.ts";
import { readGuarded } from "./retrieval-build.ts";
import {
  contentHash,
  estimateTokens,
  indexSections,
  markdownBlocks,
} from "./retrieval-markdown.ts";
import type { IndexedSection } from "./retrieval-types.ts";
import { isLocale, localeContentRoot, parseDocPath } from "./roots.ts";

const GUIDE_NAME = /^[a-z0-9][a-z0-9-]*\.md$/i;
export const GUIDE_VERSION_REL = "docs/guides.version.json";
const MAX_CITATIONS = 6;
const MAX_CONTEXT_TOKENS = 6000;
const MAX_BLOCK_CHARACTERS = 4500;

interface Candidate extends Omit<DocsQaCitation, "id"> {
  score: number;
}

/** Only a catalog path can become an evidence target, never an arbitrary file or URL. */
function targetFile(root: string, target: DocsQaTarget): { root: string; rel: string } {
  if (!target || !isLocale(target.locale) || typeof target.path !== "string")
    throw new Error("invalid_target");
  if (target.kind === "guide") {
    if (!GUIDE_NAME.test(target.path) || target.locale !== "ja") throw new Error("invalid_target");
    return { root: path.join(root, "docs/guides"), rel: target.path };
  }
  const parsed = target.kind === "official" ? parseDocPath(target.path) : null;
  if (
    !parsed ||
    parsed.docPath !== target.path ||
    !/\.md$/i.test(parsed.relFile) ||
    parsed.relFile.split("/").some((part) => part === "." || part === ".." || !part)
  )
    throw new Error("invalid_target");
  return {
    root: localeContentRoot(root, parsed.section, target.locale),
    rel: parsed.relFile,
  };
}

async function readTarget(root: string, target: DocsQaTarget): Promise<string> {
  const file = targetFile(root, target);
  return readGuarded(file.root, file.rel);
}

async function guideVersion(root: string): Promise<string> {
  for (const rel of [GUIDE_VERSION_REL, "packages/vscode-extension/package.json"]) {
    try {
      const metadata: unknown = JSON.parse(await readGuarded(root, rel));
      if (
        typeof metadata === "object" &&
        metadata !== null &&
        "version" in metadata &&
        typeof metadata.version === "string" &&
        /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(metadata.version)
      )
        return `Andon ${metadata.version}`;
    } catch {
      // Source checkouts use package.json; packaged builds use the small version manifest.
    }
  }
  return "Andon";
}

/** Preserve complete source blocks and their offsets; never locate repeated text by fuzzy matching. */
function sectionCandidates(
  page: Omit<Candidate, "startLine" | "endLine" | "quote" | "score">,
  section: Pick<IndexedSection, "startLine" | "endLine" | "tableHeaderStart">,
  markdown: string,
  rank: ReturnType<typeof sectionRanker>,
): Candidate[] {
  const lines = markdown.split(/\r?\n/);
  const text = lines.slice(section.startLine - 1, section.endLine).join("\n");
  const context =
    section.tableHeaderStart === undefined
      ? undefined
      : lines.slice(section.tableHeaderStart - 1, section.tableHeaderStart + 1).join("\n");
  const rawBlocks = section.tableHeaderStart === undefined ? markdownBlocks(text) : [text];
  const blocks: string[] = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    let block = rawBlocks[i] ?? "";
    // Keep a code/table introduction with its example so a source never says only "Run:".
    if (/[:：]$/.test(block.trim()) && rawBlocks[i + 1]) block += rawBlocks[++i];
    blocks.push(block);
  }
  let line = section.startLine;
  const candidates: Candidate[] = [];
  for (const block of blocks) {
    const blockLines = block.split("\n");
    const advance = blockLines.length - 1;
    let first = 0;
    let last = blockLines.length - 1;
    while (first <= last && blockLines[first]?.trim() === "") first++;
    while (last >= first && blockLines[last]?.trim() === "") last--;
    const quote = blockLines.slice(first, last + 1).join("\n");
    const navigationOnly = /^(?:\s*\[[^\]]+\]\([^\n)]+\)\s*[·|・]*\s*)+$/.test(quote);
    if (
      quote &&
      quote.length <= MAX_BLOCK_CHARACTERS &&
      !navigationOnly &&
      !/^#{1,6}\s+[^\n]+$/.test(quote)
    ) {
      candidates.push({
        ...page,
        startLine: line + first,
        endLine: line + last,
        quote,
        ...(context ? { context } : {}),
        score: rank(
          { path: page.target.path, title: page.title },
          { headings: page.headings, text: context ? `${context}\n${quote}` : quote },
        ),
      });
    }
    line += advance;
  }
  return candidates;
}

async function officialCandidates(
  root: string,
  request: DocsQaRequest,
  query: string,
): Promise<Candidate[]> {
  const library = createDocsLibrary(root);
  const found = await library.search(
    { query, locale: request.target?.locale ?? request.locale, limit: 10, max_tokens: 4000 },
    { path: request.target?.path, includeReleaseNotes: true },
  );
  if ("error" in found) throw new Error(found.reason);
  const rank = sectionRanker(query);
  const candidates: Candidate[] = [];
  const pages = new Map<string, string>();
  for (const hit of found.results) {
    // Outline mode verifies the indexed source even when the section body exceeds the read budget.
    const read = await library.read({ id: hit.id, mode: "outline", max_tokens: 4000 });
    if ("error" in read) throw new Error(read.reason);
    const target: DocsQaTarget = { kind: "official", path: hit.path, locale: hit.locale };
    const key = `${target.locale}:${target.path}`;
    const markdown = pages.get(key) ?? (await readTarget(root, target));
    if (contentHash(markdown) !== read.source.hash) throw new Error("stale_index");
    pages.set(key, markdown);
    candidates.push(
      ...sectionCandidates(
        {
          sourceId: hit.id,
          target,
          title: read.source.title,
          headings: read.source.headings,
          version: `aidlc-workflows ${read.source.version}`,
          hash: read.source.hash,
        },
        {
          startLine: read.source.lines[0],
          endLine: read.source.lines[1],
          ...(read.source.contextLines ? { tableHeaderStart: read.source.contextLines[0] } : {}),
        },
        markdown,
        rank,
      ),
    );
  }
  return candidates;
}

async function guideCandidates(
  root: string,
  request: DocsQaRequest,
  query: string,
): Promise<Candidate[]> {
  const directory = path.join(root, "docs/guides");
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const names = entries
    .filter((entry) => entry.isFile() && GUIDE_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const candidates: Candidate[] = [];
  const version = await guideVersion(root);
  const rank = sectionRanker(query);
  for (const name of names) {
    if (request.target && request.target.path !== name) continue;
    const target: DocsQaTarget = { kind: "guide", path: name, locale: "ja" };
    const markdown = await readTarget(root, target);
    const hash = contentHash(markdown);
    const title = extractTitle(markdown) ?? name;
    for (const section of indexSections(markdown, `guide:${name}:${hash.slice(0, 12)}`)) {
      candidates.push(
        ...sectionCandidates(
          {
            sourceId: section.id,
            target,
            title,
            headings: section.headings,
            version,
            hash,
          },
          section,
          markdown,
          rank,
        ),
      );
    }
  }
  return candidates;
}

/** Retrieve verified bundled text for a model, with citations already bound to local pages. */
export async function retrieveQuestionContext(
  root: string,
  request: DocsQaRequest,
): Promise<{ citations: DocsQaCitation[] }> {
  if (request.target) targetFile(root, request.target);
  const query = [request.question, request.history?.at(-1)?.question]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000)
    .trim();
  if (!query) throw new Error("invalid_question");
  const [official, guides] = await Promise.all([
    request.target?.kind === "guide" ? [] : officialCandidates(root, request, query),
    request.target?.kind === "official" ? [] : guideCandidates(root, request, query),
  ]);
  const candidates = [...official, ...guides].filter(
    (candidate) => candidate.score > 0 || request.target !== undefined,
  );
  candidates.sort(
    (a, b) =>
      b.score - a.score || a.sourceId.localeCompare(b.sourceId) || a.startLine - b.startLine,
  );
  const citations: DocsQaCitation[] = [];
  let tokens = 0;
  for (const candidate of candidates) {
    if (citations.length >= MAX_CITATIONS) break;
    if (!request.target && candidate.score < (candidates[0]?.score ?? 0) * 0.3) continue;
    if (
      !request.target &&
      citations.filter(
        (item) =>
          item.target.path === candidate.target.path && item.target.kind === candidate.target.kind,
      ).length >= 3
    )
      continue;
    // Table-row hits and their parent table may overlap. Supply each source span only once.
    if (
      citations.some(
        (item) =>
          item.target.path === candidate.target.path &&
          item.target.kind === candidate.target.kind &&
          item.target.locale === candidate.target.locale &&
          item.startLine <= candidate.endLine &&
          item.endLine >= candidate.startLine,
      )
    )
      continue;
    const { score: _score, ...source } = candidate;
    const citation = { ...source, id: String(citations.length + 1) };
    const size = estimateTokens(JSON.stringify(citation));
    if (tokens + size > MAX_CONTEXT_TOKENS) continue;
    tokens += size;
    citations.push(citation);
  }
  return { citations };
}

/** Re-read the actual cited locale and disable the highlight if the source or span changed. */
export async function readQuestionEvidence(
  root: string,
  citation: DocsQaCitation,
): Promise<DocsQaEvidence> {
  const markdown = await readTarget(root, citation.target);
  const hash = contentHash(markdown);
  const lines = markdown.split(/\r?\n/);
  const validRange =
    Number.isInteger(citation.startLine) &&
    Number.isInteger(citation.endLine) &&
    citation.startLine >= 1 &&
    citation.endLine >= citation.startLine &&
    citation.endLine <= lines.length;
  return {
    target: citation.target,
    title: extractTitle(markdown) ?? citation.title,
    markdown,
    hash,
    matches:
      hash === citation.hash &&
      validRange &&
      lines.slice(citation.startLine - 1, citation.endLine).join("\n") === citation.quote,
  };
}
