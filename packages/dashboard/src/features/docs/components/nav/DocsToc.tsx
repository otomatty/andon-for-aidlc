import {
  OFFICIAL_DOCS_SECTIONS,
  type OfficialDocsSection,
  type OfficialDocsToc,
  type OfficialDocsTocNode,
} from "@andon/shared-types";
import { ChevronRightIcon, FileTextIcon, FolderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NavList, NavListButton } from "@/shared/NavList.tsx";
import type { TocEntry } from "../../types.ts";

export type { TocEntry };

/**
 * Flat page list behind the tree: deep-link path matching, in-body link
 * resolution (`knownPaths`), and the default selection all match on path, not
 * on nav shape. Category rows without a page contribute nothing.
 */
export function flattenToc(tree: OfficialDocsToc): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (nodes: readonly OfficialDocsTocNode[]): void => {
    for (const node of nodes) {
      if (node.path !== undefined && node.path !== "") {
        out.push({ id: node.id, title: node.title, path: node.path });
      }
      walk(node.children);
    }
  };
  for (const section of OFFICIAL_DOCS_SECTIONS) walk(tree[section] ?? []);
  return out;
}

/**
 * Heading for each bundled book. Keyed by section so the order comes from
 * `OFFICIAL_DOCS_SECTIONS` (upstream's own reading order) and this table only
 * supplies the Japanese titles — there is no second ordering to keep in step.
 */
export const BOOK_TITLES: Readonly<Record<OfficialDocsSection, string>> = {
  overview: "ドキュメント概要",
  guide: "ユーザーガイド",
  "harness-engineering": "ハーネスエンジニアガイド",
  reference: "開発者リファレンス",
  rfcs: "RFC",
};

const BOOKS: ReadonlyArray<{ key: OfficialDocsSection; title: string }> =
  OFFICIAL_DOCS_SECTIONS.map((key) => ({ key, title: BOOK_TITLES[key] }));

/** Folders only expand; a directory's own page stays accessible inside it. */
function TocFolder({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger
        render={<NavListButton className="group/folder flex items-center gap-2 px-2 py-1.5" />}
        data-testid={testId}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-aria-expanded/folder:rotate-90"
        />
        <FolderIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 wrap-break-word">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <NavList className="my-1 ml-4 gap-0.5 border-l border-border pl-2">{children}</NavList>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TocPage({
  path,
  title,
  selectedPath,
  onSelect,
}: {
  path: string;
  title: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}): ReactNode {
  return (
    <NavListButton
      className="flex items-center gap-2 px-2 py-1.5"
      data-active={path === selectedPath}
      aria-current={path === selectedPath ? "page" : undefined}
      data-testid={`docs-toc-${path}`}
      onClick={() => onSelect(path)}
    >
      <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 wrap-break-word">{title}</span>
    </NavListButton>
  );
}

function TocNodeRow({
  node,
  selectedPath,
  onSelect,
}: {
  node: OfficialDocsTocNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}): ReactNode {
  const path = node.path !== undefined && node.path !== "" ? node.path : null;
  return (
    <li>
      {node.children.length > 0 ? (
        <TocFolder title={node.title} testId={`docs-toc-group-${node.id}`}>
          {path === null ? null : (
            <li>
              <TocPage
                path={path}
                title={`${node.title} — 概要`}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            </li>
          )}
          {node.children.map((child) => (
            <TocNodeRow
              key={child.id}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </TocFolder>
      ) : path === null ? null : (
        <TocPage path={path} title={node.title} selectedPath={selectedPath} onSelect={onSelect} />
      )}
    </li>
  );
}

export interface DocsTocProps {
  tree: OfficialDocsToc;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

/**
 * Official-docs nav — lives in the left Sheet, same layout as the usage-guide
 * list. Books stay separate and folders stay nested: the categories are the
 * aidlc-workflows directory layout, not a taxonomy of our own.
 */
export function DocsToc({ tree, selectedPath, onSelect }: DocsTocProps): ReactNode {
  const books = BOOKS.filter((book) => (tree[book.key] ?? []).length > 0);
  return (
    <nav className="min-h-0 pb-2" aria-label="公式ドキュメント一覧" data-testid="docs-toc">
      {books.length === 0 ? (
        <p className="text-sm text-muted-foreground">ドキュメントがありません。</p>
      ) : (
        <NavList className="gap-0.5">
          {books.map((book) => (
            <li key={book.key}>
              <TocFolder title={book.title} testId={`docs-toc-book-${book.key}`}>
                {(tree[book.key] ?? []).map((node) => (
                  <TocNodeRow
                    key={node.id}
                    node={node}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                  />
                ))}
              </TocFolder>
            </li>
          ))}
        </NavList>
      )}
    </nav>
  );
}
