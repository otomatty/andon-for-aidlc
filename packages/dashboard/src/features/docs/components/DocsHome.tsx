import type { MarkdownItem, OfficialDocsToc } from "@andon/shared-types";
import {
  ArrowRight,
  BookOpen,
  ChevronRightIcon,
  FileTextIcon,
  History,
  LibraryBig,
  Lightbulb,
  type LucideIcon,
  MessageCircleIcon,
  PanelsTopLeft,
  SearchXIcon,
  Wrench,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { IconTile } from "@/components/ui/icon-tile";
import { Input } from "@/components/ui/input";
import { type ViewState, viewValue } from "@/store/state.ts";
import { AreaError } from "@/shared/atoms.tsx";
import { NavigationSkeleton } from "@/shared/loading/NavigationSkeleton.tsx";
import { NavList, NavListButton } from "@/shared/NavList.tsx";
import { type DocsCategory, WORKFLOW_TIPS_INDEX } from "@/features/docs/utils/docs-navigation.ts";
import {
  type HomeDoc,
  homeDocKey,
  homeDocLabel,
  homeDocs,
  homeShelves,
  type Shelf,
  type ShelfId,
  searchHomeDocs,
  startHere,
} from "@/features/docs/utils/docs-home.ts";

const SHELF_ICONS: Readonly<Record<ShelfId, LucideIcon>> = {
  guide: BookOpen,
  "harness-engineering": Wrench,
  reference: LibraryBig,
  tips: Lightbulb,
  extension: PanelsTopLeft,
  releases: History,
};

/** Results stop here; the count above them still says how many matched. */
const MAX_RESULTS = 30;

/** Still waiting on the request; a failed catalog is settled, not pending. */
function pending(view: ViewState<unknown> | null): boolean {
  return view === null || view.kind === "loading";
}

/** The conversation kept from before, as the home's way back into it. */
export interface DocsHomeConversation {
  first: string;
  count: number;
  busy: boolean;
}

function ResumeConversation({
  conversation,
  onOpen,
}: {
  conversation: DocsHomeConversation;
  onOpen: () => void;
}): ReactNode {
  const more = conversation.count > 1 ? ` ほか ${conversation.count - 1} 件` : "";
  return (
    <button
      type="button"
      data-testid="docs-home-resume"
      className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-primary bg-primary-light px-4 py-3 text-left text-foreground transition-colors hover:bg-primary-light/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      onClick={onOpen}
    >
      <span className="flex min-w-0 items-center gap-3">
        <MessageCircleIcon
          aria-hidden="true"
          className="size-5 shrink-0 text-primary-light-foreground"
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-bold">前回の会話の続き</span>
          <span className="truncate text-sm text-muted-foreground">
            {`「${conversation.first}」${more}`}
            {conversation.busy ? " · 回答を作成中" : ""}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1 text-sm font-bold text-primary-light-foreground">
        会話を開く
        <ChevronRightIcon aria-hidden="true" className="size-4" />
      </span>
    </button>
  );
}

function DocRow({ doc, onOpen }: { doc: HomeDoc; onOpen: (doc: HomeDoc) => void }): ReactNode {
  return (
    <NavListButton
      className="flex items-start gap-2 px-2 py-1.5"
      data-testid={`docs-home-doc-${homeDocKey(doc)}`}
      onClick={() => onOpen(doc)}
    >
      <FileTextIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 wrap-break-word">{doc.title}</span>
    </NavListButton>
  );
}

function StartHere({
  docs,
  onOpen,
}: {
  docs: readonly HomeDoc[];
  onOpen: (doc: HomeDoc) => void;
}): ReactNode {
  const steps = startHere(docs);
  if (steps.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="docs-home-start-title">
      <div className="flex flex-col gap-1">
        <h2 id="docs-home-start-title" className="text-section-title font-bold">
          はじめて読むなら
        </h2>
        <p className="text-sm text-muted-foreground">
          上から順に読むと、AI-DLC の全体像から実際の進め方までつかめます。
        </p>
      </div>
      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map(({ doc, title, why }, index) => (
          <li key={homeDocKey(doc)} className="min-w-0">
            <button
              type="button"
              className="flex h-full w-full cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              data-testid={`docs-home-start-${homeDocKey(doc)}`}
              aria-labelledby={`docs-home-step-${index}`}
              aria-describedby={`docs-home-step-${index}-why`}
              onClick={() => onOpen(doc)}
            >
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-primary-light-foreground"
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span id={`docs-home-step-${index}`} className="text-sm font-bold wrap-break-word">
                  <span className="sr-only">{`ステップ ${index + 1}: `}</span>
                  {title}
                </span>
                <span
                  id={`docs-home-step-${index}-why`}
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  {why}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ShelfCard({
  shelf,
  onOpen,
  onMore,
}: {
  shelf: Shelf;
  onOpen: (doc: HomeDoc) => void;
  onMore: (() => void) | null;
}): ReactNode {
  const Icon = SHELF_ICONS[shelf.id];
  const titleId = `docs-home-shelf-${shelf.id}-title`;
  return (
    <Card data-testid={`docs-home-shelf-${shelf.id}`} aria-labelledby={titleId} role="region">
      <CardHeader className="gap-2">
        <CardTitle className="flex items-center gap-3">
          <IconTile>
            <Icon />
          </IconTile>
          <h3 id={titleId}>{shelf.title}</h3>
        </CardTitle>
        <CardDescription>{shelf.audience}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <nav aria-label={`${shelf.title}のおすすめ`}>
          <NavList className="gap-0.5">
            {shelf.featured.map((doc) => (
              <li key={homeDocKey(doc)}>
                <DocRow doc={doc} onOpen={onOpen} />
              </li>
            ))}
          </NavList>
        </nav>
      </CardContent>
      {onMore !== null && shelf.total > shelf.featured.length ? (
        <CardFooter>
          <Button variant="ghost" size="sm" onClick={onMore}>
            {`${shelf.title}をすべて見る（${shelf.total}件）`}
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function SearchResults({
  query,
  docs,
  onOpen,
  onAsk,
}: {
  query: string;
  docs: readonly HomeDoc[];
  onOpen: (doc: HomeDoc) => void;
  onAsk: ((draft: string) => void) | undefined;
}): ReactNode {
  const hits = searchHomeDocs(docs, query);
  const shown = hits.slice(0, MAX_RESULTS);
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="docs-home-results-title"
      data-testid="docs-home-results"
    >
      <h2 id="docs-home-results-title" className="sr-only">
        検索結果
      </h2>
      <p role="status" className="text-sm text-muted-foreground">
        {hits.length === 0
          ? `「${query.trim()}」に一致するページはありません。`
          : hits.length > shown.length
            ? `「${query.trim()}」に一致するページ: ${hits.length}件（上位${shown.length}件を表示）`
            : `「${query.trim()}」に一致するページ: ${hits.length}件`}
      </p>
      {hits.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <SearchXIcon aria-hidden="true" className="size-6 text-muted-foreground" />
            <EmptyTitle>ページが見つかりませんでした</EmptyTitle>
            <EmptyDescription>
              {onAsk
                ? "別の言葉で探すか、AIに質問すると本文から答えを探します。"
                : "別の言葉で探すか、左上のメニューから一覧を開いてください。"}
            </EmptyDescription>
          </EmptyHeader>
          {onAsk ? (
            <Button variant="outline" onClick={() => onAsk(query.trim())}>
              <MessageCircleIcon data-icon="inline-start" />
              この内容をAIに質問する
            </Button>
          ) : null}
        </Empty>
      ) : (
        <NavList className="gap-0.5 rounded-md border border-border p-1">
          {shown.map((doc) => (
            <li key={homeDocKey(doc)}>
              <NavListButton
                className="flex items-start justify-between gap-3 px-3 py-2"
                data-testid="docs-home-result"
                onClick={() => onOpen(doc)}
              >
                <span className="flex min-w-0 items-start gap-2">
                  <FileTextIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 wrap-break-word">{doc.title}</span>
                </span>
                <Badge variant="secondary" className="shrink-0">
                  {homeDocLabel(doc)}
                </Badge>
              </NavListButton>
            </li>
          ))}
        </NavList>
      )}
    </section>
  );
}

/**
 * The docs landing, laid out for someone who came to read: find a page by
 * name, follow the reading order when new, or open a shelf's first pages
 * directly. Asking the AI has its own chat screen; the home only opens it,
 * resumes the conversation kept from before, or starts one from below the
 * reading paths for when none of those finds the answer.
 */
export function DocsHome({
  tocView,
  guidesView,
  query,
  onQueryChange,
  onSelectPath,
  onSelectGuide,
  onOpenCategory,
  onOpenChat,
  onAsk,
  conversation,
  questionPanel,
}: {
  tocView: ViewState<OfficialDocsToc> | null;
  guidesView: ViewState<MarkdownItem[]> | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectPath: (path: string) => void;
  onSelectGuide: (name: string) => void;
  onOpenCategory: (category: DocsCategory) => void;
  /** Absent, like `onAsk`, while questions are unavailable. */
  onOpenChat?: () => void;
  onAsk?: (draft: string) => void;
  conversation?: DocsHomeConversation | null;
  questionPanel?: ReactNode;
}): ReactNode {
  const toc = tocView === null ? null : viewValue(tocView);
  const guides = guidesView === null ? null : viewValue(guidesView);
  const docs = useMemo(() => homeDocs(toc, guides), [toc, guides]);
  const shelves = useMemo(() => homeShelves(docs), [docs]);
  // One catalog failing leaves the other searchable; its error shows above both views.
  const loading = pending(tocView) || pending(guidesView);
  const searching = query.trim() !== "";

  const open = (doc: HomeDoc): void => {
    if (doc.kind === "official") onSelectPath(doc.path);
    else onSelectGuide(doc.name);
  };

  const more = (id: ShelfId): (() => void) | null => {
    switch (id) {
      case "guide":
      case "harness-engineering":
      case "reference":
        return () => onOpenCategory("workflow");
      case "tips":
        return () => onSelectGuide(WORKFLOW_TIPS_INDEX);
      case "extension":
        return () => onOpenCategory("extension");
      case "releases":
        return null;
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  };

  return (
    <section
      className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-2 pb-8 sm:px-6"
      aria-labelledby="docs-home-title"
      data-testid="docs-home"
    >
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex max-w-2xl flex-col gap-2">
            <h1 id="docs-home-title" className="text-page-title font-bold">
              ドキュメント
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              aidlc-workflows の公式ドキュメント、運用Tips、Andon の使い方を、この画面から読めます。
            </p>
          </div>
          {onOpenChat ? (
            <Button variant="outline" data-testid="docs-home-open-chat" onClick={onOpenChat}>
              <MessageCircleIcon data-icon="inline-start" />
              AIに質問する
            </Button>
          ) : null}
        </div>
        {onOpenChat && conversation ? (
          <ResumeConversation conversation={conversation} onOpen={onOpenChat} />
        ) : null}
        <div role="search" className="max-w-2xl">
          <Field>
            <FieldLabel htmlFor="docs-home-search">ページを探す</FieldLabel>
            <Input
              id="docs-home-search"
              type="search"
              data-testid="docs-home-search"
              value={query}
              placeholder="例: スコープ、hooks、インストール"
              autoComplete="off"
              aria-describedby="docs-home-search-help"
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                // Escape while an IME is composing cancels the conversion, not the search.
                if (event.key === "Escape" && query !== "" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onQueryChange("");
                }
              }}
            />
            <FieldDescription id="docs-home-search-help">
              公式ドキュメント・運用Tips・拡張機能の使い方を、ページ名から探します。
            </FieldDescription>
          </Field>
        </div>
      </header>

      {tocView?.kind === "error" ? <AreaError detail={tocView.detail} /> : null}
      {guidesView?.kind === "error" ? <AreaError detail={guidesView.detail} /> : null}
      {searching ? (
        loading ? (
          <NavigationSkeleton label="ページ一覧" />
        ) : (
          <SearchResults query={query} docs={docs} onOpen={open} onAsk={onAsk} />
        )
      ) : (
        <>
          {pending(tocView) ? (
            <NavigationSkeleton label="はじめて読むなら" />
          ) : (
            <StartHere docs={docs} onOpen={open} />
          )}
          <section className="flex flex-col gap-3" aria-labelledby="docs-home-shelves-title">
            <div className="flex flex-col gap-1">
              <h2 id="docs-home-shelves-title" className="text-section-title font-bold">
                目的から選ぶ
              </h2>
              <p className="text-sm text-muted-foreground">
                よく読まれるページを並べています。すべてのページは左上のメニューからも開けます。
              </p>
            </div>
            {loading && shelves.length === 0 ? (
              <NavigationSkeleton label="ドキュメントの種類" />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shelves.map((shelf) => (
                  <ShelfCard key={shelf.id} shelf={shelf} onOpen={open} onMore={more(shelf.id)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {questionPanel ? (
        <section
          className="flex flex-col gap-3 border-t border-border pt-8"
          aria-labelledby="docs-home-ask-title"
        >
          <div className="flex flex-col gap-1">
            <h2 id="docs-home-ask-title" className="text-section-title font-bold">
              AIに質問する
            </h2>
            {onAsk ? (
              <p className="text-sm text-muted-foreground">
                読みたいページが見つからないときは、内蔵ドキュメントをもとにAIが出典付きで答えます。
              </p>
            ) : null}
          </div>
          {questionPanel}
        </section>
      ) : null}
    </section>
  );
}
