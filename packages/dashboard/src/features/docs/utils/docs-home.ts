import {
  OFFICIAL_DOCS_SECTIONS,
  type MarkdownItem,
  type OfficialDocsSection,
  type OfficialDocsToc,
  type OfficialDocsTocNode,
} from "@aidlc-guide/shared-types";
import { BOOK_TITLES } from "@/features/docs/components/nav/DocsToc.tsx";
import {
  guideCategory,
  isReleaseDoc,
  releaseTitle,
  WORKFLOW_TIPS_INDEX,
} from "./docs-navigation.ts";

/** One page the home can open, whichever catalog it comes from. */
export type HomeDoc =
  | { kind: "official"; path: string; title: string; section: OfficialDocsSection }
  | { kind: "guide"; name: string; title: string; category: "tips" | "extension" };

/** Where a page belongs, as the reader sees it on the home and in results. */
export function homeDocLabel(doc: HomeDoc): string {
  if (doc.kind === "guide") return doc.category === "tips" ? "運用Tips" : "拡張機能の使い方";
  return isReleaseDoc(doc.path) ? "更新履歴" : BOOK_TITLES[doc.section];
}

export function homeDocKey(doc: HomeDoc): string {
  return doc.kind === "official" ? `official:${doc.path}` : `guide:${doc.name}`;
}

/** Every page in upstream order, then the authored guides in catalog order. */
export function homeDocs(toc: OfficialDocsToc | null, guides: readonly MarkdownItem[] | null) {
  const out: HomeDoc[] = [];
  const walk = (section: OfficialDocsSection, nodes: readonly OfficialDocsTocNode[]): void => {
    for (const node of nodes) {
      if (node.path !== undefined && node.path !== "")
        out.push({
          kind: "official",
          path: node.path,
          title: releaseTitle(node.path) ?? node.title,
          section,
        });
      walk(section, node.children);
    }
  };
  if (toc !== null) for (const section of OFFICIAL_DOCS_SECTIONS) walk(section, toc[section] ?? []);
  for (const guide of guides ?? [])
    out.push({
      kind: "guide",
      name: guide.name,
      title: guide.title,
      category: guideCategory(guide.name) === "workflow" ? "tips" : "extension",
    });
  return out;
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * Pages whose title (or file name) holds every word of the query. Release
 * notes sink below the rest: a version number matches dozens of them, and the
 * reader searching "2.5" for a guide page should not have to scroll past them.
 */
export function searchHomeDocs(docs: readonly HomeDoc[], query: string): HomeDoc[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits = docs.filter((doc) => {
    const haystack = normalize(`${doc.title} ${doc.kind === "official" ? doc.path : doc.name}`);
    return terms.every((term) => haystack.includes(term));
  });
  const release = (doc: HomeDoc): number =>
    Number(doc.kind === "official" && isReleaseDoc(doc.path));
  return hits.sort((a, b) => release(a) - release(b));
}

/**
 * The reading order for someone new to AI-DLC; each step says why to read it.
 * `title` replaces a bundle title that reads as a site name, not a page.
 */
const START_HERE: ReadonlyArray<{ path: string; why: string; title?: string }> = [
  {
    path: "overview/README.md",
    title: "AI-DLC の概要",
    why: "AI-DLC の考え方と、ドキュメント全体の構成をつかむ",
  },
  { path: "guide/01-getting-started.md", why: "インストールして、最初の 1 回を動かす" },
  { path: "guide/02-your-first-workflow.md", why: "ひとつの開発を最初から最後まで通して見る" },
  { path: "guide/04-phases-and-stages.md", why: "フェーズとステージで、いまどこにいるかを知る" },
  { path: "guide/glossary.md", why: "インテント・Unit・Bolt などの用語を引く" },
];

/** Start-here steps that exist in this locale's bundle, titled as the bundle titles them. */
export function startHere(
  docs: readonly HomeDoc[],
): Array<{ doc: HomeDoc; title: string; why: string }> {
  return START_HERE.flatMap(({ path, why, title }) => {
    const doc = docs.find((entry) => entry.kind === "official" && entry.path === path);
    return doc ? [{ doc, title: title ?? doc.title, why }] : [];
  });
}

export type ShelfId =
  | "guide"
  | "harness-engineering"
  | "reference"
  | "tips"
  | "extension"
  | "releases";

/** A shelf on the home: who it is for, and the pages worth opening first. */
export interface Shelf {
  id: ShelfId;
  title: string;
  audience: string;
  featured: HomeDoc[];
  /** Every page on the shelf, for the "すべて見る" count. */
  total: number;
}

const FEATURED: Readonly<Record<ShelfId, readonly string[]>> = {
  guide: [
    "guide/05-scopes-and-depth.md",
    "guide/06-agents.md",
    "guide/12-cli-commands.md",
    "guide/15-troubleshooting.md",
  ],
  "harness-engineering": [
    "harness-engineering/00-overview.md",
    "harness-engineering/02-adding-a-stage.md",
    "harness-engineering/03-adding-an-agent.md",
    "harness-engineering/10-authoring-a-plugin.md",
  ],
  reference: [
    "reference/00-overview.md",
    "reference/01-architecture.md",
    "reference/diagrams.md",
    "reference/scopes.md",
  ],
  // The index is the shelf's "すべて見る" target, not one of its pages.
  tips: [],
  extension: ["getting-started.md", "reading-workflow.md", "customization.md", "asking-aidlc.md"],
  releases: ["overview/release-highlights.md", "overview/changelog.md"],
};

const SHELF_COPY: Readonly<Record<ShelfId, { title: string; audience: string }>> = {
  guide: {
    title: BOOK_TITLES.guide,
    audience: "AI-DLC で開発を進める人へ。使い方と困ったときの対処",
  },
  "harness-engineering": {
    title: BOOK_TITLES["harness-engineering"],
    audience: "ステージやエージェント、プラグインを追加・調整する人へ",
  },
  reference: {
    title: BOOK_TITLES.reference,
    audience: "仕組みを詳しく知りたい人へ。構成・状態・ルールの詳細",
  },
  tips: { title: "運用Tips", audience: "運用で迷ったときに。テーマごとの短い記事" },
  extension: {
    title: "拡張機能の使い方",
    audience: "AIDLC Guide の画面の読み方と設定",
  },
  releases: { title: "更新履歴", audience: "aidlc-workflows の各バージョンの変更点" },
};

const MAX_FEATURED = 4;

function onShelf(doc: HomeDoc, id: ShelfId): boolean {
  if (doc.kind === "guide") return doc.category === id && doc.name !== WORKFLOW_TIPS_INDEX;
  if (isReleaseDoc(doc.path)) return id === "releases";
  return doc.section === id;
}

function docId(doc: HomeDoc): string {
  return doc.kind === "official" ? doc.path : doc.name;
}

/**
 * The shelves, each with its curated first pages. A curated page missing from
 * this bundle is skipped, and the shelf tops up from its own pages in catalog
 * order, so an upstream rename thins a shelf rather than breaking a link.
 * Release notes add the newest version after the two overview pages.
 */
export function homeShelves(docs: readonly HomeDoc[]): Shelf[] {
  const ids: ShelfId[] = [
    "guide",
    "tips",
    "extension",
    "harness-engineering",
    "reference",
    "releases",
  ];
  return ids.flatMap((id) => {
    const pages = docs.filter((doc) => onShelf(doc, id));
    if (pages.length === 0) return [];
    const curated = FEATURED[id].flatMap((key) => pages.filter((doc) => docId(doc) === key));
    const rest =
      id === "releases"
        ? pages
            .filter((doc) => doc.kind === "official" && doc.path.startsWith("overview/releases/"))
            .sort((a, b) => docId(b).localeCompare(docId(a), "en", { numeric: true }))
        : pages.filter((doc) => !curated.includes(doc));
    return [
      {
        id,
        ...SHELF_COPY[id],
        featured: [...curated, ...rest].slice(0, MAX_FEATURED),
        total: pages.length,
      },
    ];
  });
}
