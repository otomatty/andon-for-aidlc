import {
  OFFICIAL_DOCS_SECTIONS,
  type OfficialDocsToc,
  type OfficialDocsTocNode,
} from "@aidlc-guide/shared-types";
import { flattenToc } from "@/features/docs/components/nav/DocsToc.tsx";
import type { DocsCategory, TocEntry } from "../types.ts";

export type { DocsCategory, TocEntry };

export const WORKFLOW_TIPS_INDEX = "aidlc-workflows-tips.md";

/** Tips are authored guides, but belong with workflow documentation in navigation. */
export function guideCategory(name: string): DocsCategory {
  return name === WORKFLOW_TIPS_INDEX || /^aidlc-tip-[a-z0-9-]+\.md$/i.test(name)
    ? "workflow"
    : "extension";
}

export function isReleaseDoc(path: string): boolean {
  return (
    path === "overview/changelog.md" ||
    path === "overview/release-highlights.md" ||
    path.startsWith("overview/releases/")
  );
}

/** 更新履歴の概要2ページの表示名。英語のみのページにも日本語の名前を付ける。 */
export function releaseTitle(path: string): string | undefined {
  if (path === "overview/release-highlights.md") return "更新のハイライト";
  if (path === "overview/changelog.md") return "更新履歴一覧";
  return undefined;
}

/** 更新履歴を取り除き、空になったディレクトリも一覧から除外する。 */
export function officialToc(tree: OfficialDocsToc): OfficialDocsToc {
  const filter = (nodes: readonly OfficialDocsTocNode[]): OfficialDocsTocNode[] =>
    nodes.flatMap((node) => {
      if (node.path !== undefined && isReleaseDoc(node.path)) return [];
      const children = filter(node.children);
      if (!node.path && children.length === 0) return [];
      return [{ ...node, children }];
    });
  const result = { ...tree };
  for (const section of OFFICIAL_DOCS_SECTIONS) result[section] = filter(tree[section] ?? []);
  return result;
}

/** 概要の2ページを残し、各バージョンは数字として比較して最新5件に絞る。 */
export function releaseEntries(tree: OfficialDocsToc): TocEntry[] {
  const priority = (path: string): number => {
    if (path === "overview/release-highlights.md") return 0;
    if (path === "overview/changelog.md") return 1;
    return 2;
  };
  const entries = flattenToc(tree)
    .filter((entry) => isReleaseDoc(entry.path))
    .sort(
      (a, b) =>
        priority(a.path) - priority(b.path) ||
        b.path.localeCompare(a.path, "en", { numeric: true }),
    );
  return [
    ...entries.filter((entry) => priority(entry.path) < 2),
    ...entries.filter((entry) => priority(entry.path) === 2).slice(0, 5),
  ];
}

/** 使い方ガイドのカタログ内だけを移動先として扱う。 */
export function resolveGuideHref(
  currentName: string,
  href: string,
  knownNames: readonly string[],
): { name: string; anchor: string | undefined } | null {
  const match = /^(?:(?:\.\/)?([a-z0-9][a-z0-9-]*\.md))?(?:#(.*))?$/i.exec(href.trim());
  if (match === null || href.trim() === "") return null;
  const requestedName = match[1] ?? currentName;
  const name = knownNames.find((entry) => entry.toLowerCase() === requestedName.toLowerCase());
  if (name === undefined) return null;
  try {
    const anchor = match[2] ? decodeURIComponent(match[2]) : undefined;
    return { name, anchor };
  } catch {
    return null;
  }
}
