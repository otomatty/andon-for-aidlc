import type { DocsQaCitation, DocsQaJob, OfficialDocsLocale } from "@aidlc-guide/shared-types";
import { BookOpenIcon, ChevronLeftIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { docsQaApi } from "@/services/docs-qa.ts";
import type { DocsQaState } from "@/features/docs/hooks/useDocsQa.ts";
import type { DocLinks } from "@/features/docs/use-docs-article-links.ts";
import { DocsChatTurn } from "./DocsChatTurn.tsx";
import { DocsComposer, docsQaCanAsk, focusDocsQuestion } from "./DocsComposer.tsx";
import { type ChatSource, DocsSourcePanel } from "./DocsSourcePanel.tsx";

/** Questions the bundled docs answer well, to start an empty conversation. */
const SUGGESTIONS = [
  "Unit と Bolt はどう違いますか？",
  "project.md はいつ読み込まれますか？",
  "hooks が動かないときは？",
  "スコープと深度の選び方は？",
] as const;

function appScroll(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="app-scroll"]');
}

/**
 * Keeps the newest message in view as the conversation grows, unless the
 * reader scrolled up. Whether they were following is read when they scroll,
 * not after an update: an answer taller than the margin would otherwise
 * measure as "scrolled away" the moment it renders.
 */
function useFollowConversation(qa: DocsQaState): void {
  const count = qa.turns.length;
  const last = qa.turns.at(-1);
  const seen = useRef<number | null>(null);
  const following = useRef(true);
  useEffect(() => {
    const scroll = appScroll();
    if (!scroll) return;
    const onScroll = (): void => {
      following.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 160;
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const scroll = appScroll();
    if (!scroll) return;
    const grew = seen.current === null || count > seen.current;
    seen.current = count;
    if (grew || following.current) {
      following.current = true;
      scroll.scrollTop = scroll.scrollHeight;
    }
  }, [count, last?.answer, last?.phase, qa.submitting]);
}

function EmptyConversation({ qa }: { qa: DocsQaState }): ReactNode {
  const start = (question: string): void => {
    if (docsQaCanAsk(qa) && !qa.busy) void qa.submit(question);
    else {
      qa.setDraft(question);
      focusDocsQuestion();
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-xl bg-primary-light text-primary-light-foreground"
      >
        <BookOpenIcon className="size-5" />
      </span>
      <div className="flex flex-col gap-2">
        <h3 className="text-page-title font-bold">ドキュメントについて質問する</h3>
        <p className="text-sm text-muted-foreground">
          内蔵ドキュメントをもとに回答します。回答の番号から、根拠となる箇所を開けます。
        </p>
      </div>
      <DocsComposer
        qa={qa}
        label="質問"
        placeholder="例: 承認ゲートで差し戻すには？（Ctrl+Enter で送信）"
        className="w-full text-left"
      />
      <div className="flex flex-col items-center gap-2">
        <p id="docs-chat-suggestions" className="text-sm text-muted-foreground">
          よくある質問から始める
        </p>
        <ul aria-labelledby="docs-chat-suggestions" className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((question) => (
            <li key={question}>
              <Button
                type="button"
                variant="outline"
                className="rounded-full!"
                data-testid="docs-chat-suggestion"
                onClick={() => start(question)}
              >
                {question}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The question screen, laid out like a chat app: a bar to get back to the
 * docs or start over, the conversation in one centred column with the message
 * box pinned under it, and a cited source opened beside it (in its place on a
 * narrow screen).
 */
export function DocsChatView({
  qa,
  locale,
  docLinks,
  onBack,
  onOpenDocument,
}: {
  qa: DocsQaState;
  locale: OfficialDocsLocale;
  docLinks: DocLinks;
  onBack: () => void;
  /** Opens the cited document itself, full width, with a way back here. */
  onOpenDocument: (citation: DocsQaCitation, turn: DocsQaJob) => void;
}): ReactNode {
  const [source, setSource] = useState<ChatSource | null>(null);
  const requests = useRef(0);
  useFollowConversation(qa);

  const openSource = async (citation: DocsQaCitation, turn: DocsQaJob): Promise<void> => {
    const request = ++requests.current;
    setSource({ citation, turn, request });
    try {
      const data = await docsQaApi.evidence(citation);
      if (request === requests.current) setSource({ citation, turn, request, data });
    } catch (cause) {
      if (request === requests.current)
        setSource({
          citation,
          turn,
          request,
          error: cause instanceof Error ? cause.message : "参照元を読み込めませんでした。",
        });
    }
  };

  const closeSource = (): void => {
    requests.current += 1;
    setSource(null);
  };

  const empty = qa.turns.length === 0 && !qa.busy;
  const title = qa.turns[0]?.question ?? "新しい会話";

  return (
    <section
      aria-labelledby="docs-chat-title"
      data-testid="docs-chat"
      className="mx-auto flex w-full max-w-6xl flex-col"
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="docs-chat-back"
          aria-label="ドキュメントのトップへ"
          onClick={onBack}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          ドキュメント
        </Button>
        <h2
          id="docs-chat-title"
          className="min-w-0 flex-1 truncate text-center text-sm font-semibold"
        >
          {title}
        </h2>
        {qa.turns.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="docs-chat-new"
            disabled={qa.busy}
            onClick={() => {
              qa.reset();
              closeSource();
              focusDocsQuestion();
            }}
          >
            <PlusIcon data-icon="inline-start" />
            新しい会話
          </Button>
        ) : (
          <span aria-hidden="true" className="w-28 shrink-0" />
        )}
      </div>

      {empty ? (
        <EmptyConversation qa={qa} />
      ) : (
        <div
          className={cn(
            "pt-6",
            source &&
              "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start lg:gap-6",
          )}
        >
          <div
            className={cn(
              "mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-8",
              source && "max-lg:hidden",
            )}
          >
            {qa.turns.map((turn, index) => (
              <DocsChatTurn
                key={turn.id}
                turn={turn}
                index={index}
                activeCitation={source?.turn.id === turn.id ? source.citation.id : null}
                canEdit={!qa.busy}
                onCitation={(citation) => {
                  void openSource(citation, turn);
                }}
                onEdit={() => {
                  qa.setDraft(turn.question);
                  focusDocsQuestion();
                }}
              />
            ))}
            <div className="sticky bottom-0 z-10 bg-background pt-2 pb-3">
              <DocsComposer
                qa={qa}
                label="続けて質問する"
                placeholder="続けて質問する（Ctrl+Enter で送信）"
              />
            </div>
          </div>
          {source ? (
            <DocsSourcePanel
              source={source}
              busy={qa.busy}
              docLinks={docLinks}
              className="max-lg:min-h-[60vh] lg:sticky lg:top-14 lg:max-h-[calc(100vh-9rem)]"
              onSelect={(citation) => {
                void openSource(citation, source.turn);
              }}
              onClose={closeSource}
              onOpenDocument={() => onOpenDocument(source.citation, source.turn)}
              onAskAbout={() => {
                qa.setTarget(source.citation.target);
                closeSource();
                focusDocsQuestion();
              }}
              onRefreshAnswer={() => {
                const { turn } = source;
                closeSource();
                void qa.submit(turn.question, {
                  locale: turn.locale ?? locale,
                  target: turn.target,
                });
              }}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
