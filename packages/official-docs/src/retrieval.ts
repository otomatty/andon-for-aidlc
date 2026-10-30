import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UPSTREAM_REPO_URL } from "@andon/shared-types";
import { readDocsIndex } from "./index-file.ts";
import { readGuarded } from "./retrieval-build.ts";
import { contentHash, estimateTokens, markdownBlocks } from "./retrieval-markdown.ts";
import {
  DOCS_INDEX_REL,
  type DocsFailure,
  type DocsHit,
  type DocsIndex,
  type DocsReadInput,
  type DocsReadReply,
  type DocsSearchInput,
  type DocsSearchReply,
  INDEX_VERSION,
  type IndexedPage,
  type IndexedSection,
} from "./retrieval-types.ts";
import { isLocale, localeContentRoot, parseDocPath } from "./roots.ts";

const ALIASES = [
  ["承認", "approval", "approve", "gate"],
  ["ゲート", "gate", "approval"],
  ["センサー", "sensor", "sensors"],
  ["失敗", "failure", "failed", "blocking"],
  ["再開", "resume"],
  ["状態", "state", "status"],
  ["成果物", "artifact", "artifacts", "outputs"],
  ["要件", "requirements"],
  ["設計", "design"],
  ["実装", "code-generation", "construction"],
  ["テスト", "test", "testing"],
  ["スコープ", "scope", "scopes"],
  ["深さ", "depth"],
  ["並列", "parallel", "swarm"],
  ["レビュー", "review", "reviewer"],
  ["規則", "rules", "memory"],
  ["ルール", "rules", "memory"],
  ["知識", "knowledge", "documentkb"],
  ["文書", "document", "knowledge"],
  ["監査", "audit"],
  ["ボルト", "bolt"],
  ["ユニット", "unit"],
  ["質問", "questions"],
  ["エージェント", "agent", "agents"],
  ["運用", "operation", "operations"],
  ["初期化", "initialization", "init"],
  ["更新", "update", "upgrade"],
  ["ジャンプ", "jump", "stage"],
  ["停止", "park", "stop"],
  ["フック", "hook", "hooks"],
  ["継承", "inheritance", "additive"],
  ["スペース", "space", "spaces"],
  ["インテント", "intent", "intents"],
  ["ブラウザー", "ブラウザ", "browser"],
  ["ダッシュボード", "dashboard"],
  ["更新履歴", "release", "changelog"],
];
const STOP = new Set([
  "the",
  "a",
  "an",
  "what",
  "is",
  "how",
  "to",
  "do",
  "i",
  "in",
  "of",
  "and",
  "for",
  "can",
  "when",
  "with",
  "does",
  "are",
  "new",
  "ai-dlc",
  "aidlc",
  "workflows",
  "について",
  "どの",
  "よう",
  "する",
  "した",
  "です",
  "ます",
  "場合",
  "とは",
  "教え",
  "ください",
  // Intl.Segmenter splits polite requests into these pieces.
  "くだ",
  "さい",
  "って",
  // Answer-length preferences are not documentation subjects.
  "一文",
  "一言",
  "簡潔",
  "手短",
  "何",
  "どう",
]);
const segmenter = new Intl.Segmenter("ja", { granularity: "word" });

/** Extract distinct normalized English and Japanese terms, excluding question filler. */
function words(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
  const japanese = [...segmenter.segment(normalized)]
    .filter(
      (s) =>
        s.isWordLike && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s.segment),
    )
    .map((s) => (s.segment === "開き" ? "開く" : s.segment));
  return [...new Set([...latin, ...japanese])].filter((w) => w.length > 1 && !STOP.has(w));
}

/** Expand domain aliases and use introductory terms for an otherwise empty AI-DLC query. */
function queryWords(query: string): string[] {
  const normalized = query.normalize("NFKC").toLowerCase();
  const expanded = ALIASES.filter((group) =>
    group.some((word) => normalized.includes(word)),
  ).flat();
  const versions = normalized.match(/\b\d+\.\d+\.\d+\b/g) ?? [];
  const terms = [...new Set([...words(query), ...expanded, ...versions])];
  return terms.length === 0 && /ai[ -]?dlc/i.test(query)
    ? ["what is ai-dlc", "introduction"]
    : terms;
}

/** Shared ranking for bundled official sections and the product's own guides. */
export function sectionRanker(query: string) {
  const terms = queryWords(query);
  const primary = words(query);
  const stem = (word: string) => word.replace(/(?:ing|s)$/, "");
  const command = query.match(/\/aidlc(?:-[\w-]+)?(?:\s+--[\w-]+)?/)?.[0]?.toLowerCase();
  const version = query.match(/\b\d+\.\d+\.\d+\b/)?.[0];
  return (
    page: Pick<IndexedPage, "path" | "title">,
    section: Pick<IndexedSection, "headings" | "text">,
  ): number => {
    const title = `${page.path} ${section.headings.join(" ")}`.normalize("NFKC").toLowerCase();
    const body = section.text.normalize("NFKC").toLowerCase();
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const titleMatch = title.includes(term);
      const bodyMatch = body.includes(term);
      if (titleMatch || bodyMatch) matched++;
      score += (titleMatch ? 8 : 0) + (bodyMatch ? 2 : 0);
    }
    if (matched === 0) return 0;
    score += matched * matched;
    if (version && page.path === `overview/releases/${version}.md`) score += 500;
    const ownHeading = (section.headings.at(-1) ?? "")
      .replace(/[*`]/g, "")
      .normalize("NFKC")
      .toLowerCase();
    const headingWords = words(`${page.title} ${ownHeading}`).map(stem);
    if (primary.length > 0 && primary.every((word) => headingWords.includes(stem(word))))
      score += 20;
    if (ownHeading === primary.join(" ") && primary.length > 0) score += 40;
    if (command !== undefined && ownHeading.includes(command)) score += 40;
    return score / (1 + Math.log1p(body.length / 3000));
  };
}

/** QA can include release notes and constrain search before ranking, without including proposals. */
interface SearchOptions {
  path?: string;
  includeReleaseNotes?: boolean;
}

/** Return a data error shared by the CLI and MCP without throwing into either transport. */
function failure(reason: string, message: string): DocsFailure {
  return { error: true, reason, message };
}

/** Validate the persisted schema, section IDs and line ranges before trusting index fields. */
function validIndex(raw: unknown): raw is DocsIndex {
  if (typeof raw !== "object" || raw === null) return false;
  const index = raw as DocsIndex;
  if (
    index.schemaVersion !== INDEX_VERSION ||
    typeof index.sourceVersion !== "string" ||
    !/^[0-9a-f]{40}$/i.test(index.upstreamSha) ||
    !/^[0-9a-f]{64}$/.test(index.manifestHash) ||
    !Array.isArray(index.pages)
  )
    return false;
  const ids = new Set<string>();
  for (const page of index.pages) {
    if (
      !page ||
      typeof page.path !== "string" ||
      !parseDocPath(page.path) ||
      !isLocale(page.locale) ||
      typeof page.title !== "string" ||
      !/^[0-9a-f]{64}$/.test(page.hash) ||
      !Array.isArray(page.sections) ||
      !["documentation", "proposal", "research", "local-guide", "release-note"].includes(
        page.kind,
      ) ||
      !["original", "verified", "unverified", "stale"].includes(page.translation)
    )
      return false;
    for (const section of page.sections) {
      if (
        !section ||
        typeof section.id !== "string" ||
        ids.has(section.id) ||
        typeof section.text !== "string" ||
        typeof section.anchor !== "string" ||
        !Array.isArray(section.headings) ||
        !section.headings.every((s) => typeof s === "string") ||
        !Number.isInteger(section.startLine) ||
        section.startLine < 1 ||
        !Number.isInteger(section.endLine) ||
        section.endLine < section.startLine ||
        (section.parentId !== undefined && typeof section.parentId !== "string") ||
        (section.tableHeaderStart !== undefined &&
          (!Number.isInteger(section.tableHeaderStart) ||
            section.tableHeaderStart < 1 ||
            section.tableHeaderStart + 1 >= section.startLine))
      )
        return false;
      ids.add(section.id);
    }
  }
  return true;
}

/** Same output format for CLI and MCP: the body appears exactly once. */
export function serializeDocsReply(reply: unknown): string {
  return JSON.stringify(reply);
}

/** Account for response metadata as well as text when estimating the serialized budget. */
function measured<T extends { estimatedTokens: number }>(reply: T): T {
  reply.estimatedTokens = estimateTokens(serializeDocsReply(reply));
  // Include the digits of estimatedTokens itself in the serialized response size.
  reply.estimatedTokens = estimateTokens(serializeDocsReply(reply));
  return reply;
}

/** Create read-only search/read operations over a bundled corpus, independently of workflow state. */
export function createDocsLibrary(root: string) {
  let cached: { stamp: string; index: DocsIndex } | undefined;
  /** Cache the parsed index by file stamp and verify its pinned manifest on every request. */
  async function load(): Promise<DocsIndex> {
    const info = await stat(path.join(root, DOCS_INDEX_REL));
    const stamp = `${info.mtimeMs}:${info.size}`;
    if (cached?.stamp !== stamp) {
      const raw: unknown = JSON.parse(await readDocsIndex(root));
      if (!validIndex(raw)) throw new Error("invalid_index");
      cached = { stamp, index: raw };
    }
    const manifest = await readGuarded(path.join(root, "docs"), "official-docs.manifest.json");
    if (contentHash(manifest) !== cached.index.manifestHash) throw new Error("stale_index");
    return cached.index;
  }

  /** Read within the document locale root and reject content whose hash differs from the index. */
  async function pageText(page: IndexedPage): Promise<string> {
    const parsed = parseDocPath(page.path);
    if (parsed === null) throw new Error("invalid_index");
    const text = await readGuarded(
      localeContentRoot(root, parsed.section, page.locale),
      parsed.relFile,
    );
    if (contentHash(text) !== page.hash) throw new Error("stale_index");
    return text;
  }

  /** Convert missing, unsafe or stale corpus errors into actionable retrieval failures. */
  async function attempt<T>(action: () => Promise<T>): Promise<T | DocsFailure> {
    try {
      return await action();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unavailable";
      if (reason === "index_too_large")
        return failure(
          reason,
          "内蔵文書の索引が32 MiBの上限を超えています。索引を分割・縮小した配布へ更新してください。推測で仕様を回答しないでください。",
        );
      return failure(
        reason === "stale_index" || reason === "path_rejected" || reason === "invalid_index"
          ? reason
          : "docs_unavailable",
        "内蔵文書または索引を確認できません。Andon を更新するか、ソース checkout で bun run build:docs-index を実行してください。推測で仕様を回答しないでください。",
      );
    }
  }

  /** Rank matching sections, filter unverified translations, and fit excerpts within the output budget. */
  async function search(
    input: DocsSearchInput,
    options: SearchOptions = {},
  ): Promise<DocsSearchReply | DocsFailure> {
    if (
      typeof input.query !== "string" ||
      !input.query.trim() ||
      input.query.length > 1000 ||
      (input.locale !== undefined && !isLocale(input.locale))
    )
      return failure("invalid_input", "query と locale を確認してください。");
    const limit = input.limit ?? 5;
    const budget = input.max_tokens ?? 800;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 10 ||
      !Number.isInteger(budget) ||
      budget < 400 ||
      budget > 4000
    )
      return failure("invalid_input", "limit は1〜10、max_tokens は400〜4000です。");
    return attempt(async () => {
      const index = await load();
      const locale = input.locale ?? "ja";
      const rank = sectionRanker(input.query);
      const pages = index.pages.filter((page) => {
        if (options.path !== undefined && page.path !== options.path) return false;
        if (
          !input.include_non_normative &&
          (page.kind === "research" ||
            page.kind === "proposal" ||
            (page.kind === "release-note" && !options.includeReleaseNotes))
        )
          return false;
        if (locale === "en") return page.locale === "en";
        const ja = index.pages.find((p) => p.path === page.path && p.locale === "ja");
        return ja?.translation === "verified" ? page === ja : page.locale === "en";
      });
      const candidates: { page: IndexedPage; section: IndexedSection; score: number }[] = [];
      for (const page of pages) {
        for (const section of page.sections) {
          const score = rank(page, section);
          if (score === 0 && options.path === undefined) continue;
          candidates.push({ page, section, score });
        }
      }
      candidates.sort((a, b) => b.score - a.score || a.section.id.localeCompare(b.section.id));
      const reply: DocsSearchReply = {
        sourceVersion: index.sourceVersion,
        localeRequested: locale,
        results: [],
        truncated: false,
        estimatedTokens: 0,
        next: "aidlc_docs_read で原文を取得してから回答し、source の文書名・節・バージョン・リンクを根拠として示してください。日本語訳が未確認・古い・未作成の場合は英語原文を返します。",
      };
      const checked = new Set<string>();
      for (const { page, section } of candidates.slice(0, limit)) {
        if (!checked.has(page.path)) {
          await pageText(page);
          checked.add(page.path);
        }
        const hit: DocsHit = {
          id: section.id,
          path: page.path,
          headings: section.headings,
          locale: page.locale,
          snippet: section.text.replace(/\s+/g, " ").slice(0, 160),
          kind: page.kind,
        };
        reply.results.push(hit);
        measured(reply);
        if (reply.estimatedTokens > budget) {
          reply.results.pop();
          break;
        }
      }
      reply.truncated = reply.results.length < candidates.length;
      if (reply.results.length === 0)
        reply.next =
          "該当する文書を確認できません。コマンド名や英語の用語で再検索し、見つからなければ未確認と回答してください。";
      return measured(reply);
    });
  }

  /** Verify and return source text or child outlines using block cursors; oversized blocks require recovery. */
  async function read(input: DocsReadInput): Promise<DocsReadReply | DocsFailure> {
    const budget = input.max_tokens ?? 1600;
    const cursor = input.cursor ?? 0;
    if (
      typeof input.id !== "string" ||
      input.id.length > 1000 ||
      !Number.isInteger(budget) ||
      budget < 800 ||
      budget > 24000 ||
      !Number.isInteger(cursor) ||
      cursor < 0 ||
      (input.mode !== undefined && !["section", "outline"].includes(input.mode))
    )
      return failure("invalid_input", "id、cursor、max_tokens（800〜24000）を確認してください。");
    return attempt(async () => {
      const index = await load();
      const page = index.pages.find((p) => p.sections.some((s) => s.id === input.id));
      const section = page?.sections.find((s) => s.id === input.id);
      if (page === undefined || section === undefined)
        return failure(
          "not_found",
          "節IDが見つかりません。aidlc_docs_search で再検索してください。",
        );
      if (page.locale === "ja" && page.translation !== "verified")
        return failure(
          "translation_unverified",
          "この訳の対応原文が未確認か更新されています。英語原文を検索してください。",
        );
      const original = await pageText(page);
      if (page.locale === "ja") {
        const en = index.pages.find((p) => p.path === page.path && p.locale === "en");
        if (en === undefined) throw new Error("invalid_index");
        await pageText(en);
      }
      const rowText = original
        .split(/\r?\n/)
        .slice(section.startLine - 1, section.endLine)
        .join("\n");
      const text =
        section.tableHeaderStart === undefined
          ? rowText
          : `${original
              .split(/\r?\n/)
              .slice(section.tableHeaderStart - 1, section.tableHeaderStart + 1)
              .join("\n")}\n${rowText}`;
      if (text !== section.text) throw new Error("stale_index");
      const parsed = parseDocPath(page.path);
      if (parsed === null) throw new Error("invalid_index");
      const absolute = path
        .join(localeContentRoot(root, parsed.section, page.locale), parsed.relFile)
        .replace(/\\/g, "/");
      const upstreamPath = page.path.startsWith("overview/")
        ? page.path.slice("overview/".length)
        : page.path;
      const url =
        page.kind === "release-note"
          ? `${UPSTREAM_REPO_URL}/blob/${index.upstreamSha}/CHANGELOG.md`
          : page.locale === "en" && page.kind !== "local-guide"
            ? `${UPSTREAM_REPO_URL}/blob/${index.upstreamSha}/docs/${upstreamPath.split("/").map(encodeURIComponent).join("/")}#L${section.startLine}-L${section.endLine}`
            : pathToFileURL(absolute).href;
      const children = page.sections
        .filter((s) => s.parentId === section.id)
        .map((s) => ({ id: s.id, heading: s.headings.at(-1) ?? "" }));
      const reply: DocsReadReply = {
        source: {
          title: page.title,
          headings: section.headings,
          path: absolute,
          locale: page.locale,
          version: index.sourceVersion,
          hash: page.hash,
          upstreamSha: index.upstreamSha,
          url,
          kind: page.kind,
          lines: [section.startLine, section.endLine],
          ...(section.tableHeaderStart === undefined
            ? {}
            : {
                contextLines: [section.tableHeaderStart, section.tableHeaderStart + 1] as [
                  number,
                  number,
                ],
              }),
        },
        text: "",
        children,
        hasChildren: children.length > 0,
        truncated: false,
        estimatedTokens: 0,
      };
      const blocks =
        input.mode === "outline"
          ? children.map((child) => `${JSON.stringify(child)}\n`)
          : markdownBlocks(text);
      if (input.mode === "outline") reply.children = [];
      if (cursor >= blocks.length && cursor !== 0)
        return failure(
          "invalid_cursor",
          "cursor が本文の範囲外です。省略して最初から取得してください。",
        );
      // Children are discoverable through outline mode if their list exceeds this budget.
      if (measured(reply).estimatedTokens > budget / 2) reply.children = [];
      if (measured(reply).estimatedTokens > budget - 100)
        return failure(
          "budget_too_small",
          "出典情報が予算を超えています。max_tokens を増やして再取得してください。",
        );
      let next = cursor;
      for (; next < blocks.length; next++) {
        const previous = reply.text;
        reply.text += blocks[next];
        if (measured(reply).estimatedTokens > budget - 80) {
          if (next === cursor) {
            reply.requiredTokens = reply.estimatedTokens + 80;
            if (reply.requiredTokens > 24000)
              return failure(
                "block_too_large",
                "単一ブロックが最大予算24000を超えています。同じ取得を繰り返さず、outline で子節を探すか、別の節を検索してください。原文はまだ取得できていません。",
              );
          }
          reply.text = previous;
          break;
        }
      }
      reply.truncated = next < blocks.length;
      if (reply.truncated && next > cursor) reply.nextCursor = next;
      return measured(reply);
    });
  }

  return { search, read };
}
