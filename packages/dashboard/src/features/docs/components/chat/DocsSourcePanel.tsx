import type { DocsQaCitation, DocsQaEvidence, DocsQaJob } from "@andon/shared-types";
import { ExternalLinkIcon, MessageCircleIcon, XIcon } from "lucide-react";
import { type ReactNode, Suspense, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MarkdownSurface } from "@/viewer/lazy-markdown.ts";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { EvidenceApplier } from "@/features/docs/components/qa/EvidenceApplier.tsx";
import { EvidenceNotices } from "@/features/docs/components/qa/EvidenceNotices.tsx";
import type { DocSelection } from "@/features/docs/types.ts";
import { type DocLinks, useDocLinks } from "@/features/docs/use-docs-article-links.ts";

export type ChatSource = {
  citation: DocsQaCitation;
  turn: DocsQaJob;
  /** Counts opens, so opening the same citation again scrolls to it again. */
  request: number;
  data?: DocsQaEvidence;
  error?: string;
};

/**
 * A cited source beside the conversation: the source's text with the quoted
 * lines highlighted, the other sources of the same answer one click away, and
 * the full document a click further. The conversation stays where it was.
 */
export function DocsSourcePanel({
  source,
  busy,
  docLinks,
  className,
  onSelect,
  onClose,
  onOpenDocument,
  onAskAbout,
  onRefreshAnswer,
}: {
  source: ChatSource;
  busy: boolean;
  /** Routes the source's own links: a bundled page opens in the docs, not the webview. */
  docLinks: DocLinks;
  className?: string;
  onSelect: (citation: DocsQaCitation) => void;
  onClose: () => void;
  onOpenDocument: () => void;
  onAskAbout: () => void;
  onRefreshAnswer: () => void;
}): ReactNode {
  const bodyRef = useRef<HTMLDivElement>(null);
  const { citation, turn, data, error } = source;
  const { kind, path, locale } = citation.target;
  const page = useMemo<DocSelection>(
    () => (kind === "guide" ? { kind, name: path } : { kind, path }),
    [kind, path],
  );
  // The source is shown in its own language; a page it links to opens in that language too.
  useDocLinks(bodyRef, page, {
    ...docLinks,
    onFollow: (target) => docLinks.onFollow({ ...target, locale }),
  });
  return (
    <aside
      aria-labelledby="docs-source-title"
      data-testid="docs-source-panel"
      className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card", className)}
    >
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          {turn.citations.length > 1 ? (
            <div role="group" aria-label="出典を切り替える" className="flex shrink-0 gap-1">
              {turn.citations.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant={item.id === citation.id ? "default" : "outline"}
                  size="icon-sm"
                  aria-label={`参照 ${item.id} を表示`}
                  aria-pressed={item.id === citation.id}
                  onClick={() => onSelect(item)}
                >
                  {item.id}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 id="docs-source-title" className="m-0 text-sm font-bold wrap-break-word">
              {data?.title ?? citation.title}
            </h3>
            <p className="text-xs text-muted-foreground">
              {`参照 ${citation.id} · ${citation.headings.join(" › ")} · ${citation.target.locale.toUpperCase()} · ${citation.version}`}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-testid="docs-source-close"
            aria-label="出典を閉じる"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="docs-source-open-document"
            onClick={onOpenDocument}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            ドキュメントで開く
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onAskAbout}>
            <MessageCircleIcon data-icon="inline-start" />
            この文書について質問
          </Button>
        </div>
        <EvidenceNotices
          citation={citation}
          data={data}
          error={error}
          busy={busy}
          onReload={() => onSelect(citation)}
          onRefreshAnswer={onRefreshAnswer}
        />
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? null : data === undefined ? (
          <DocumentSkeleton label="出典の本文" />
        ) : (
          <Suspense fallback={<DocumentSkeleton label="出典の本文" />}>
            <MarkdownSurface
              markdown={data.markdown}
              editable={null}
              evidence={
                data.matches
                  ? {
                      startLine: citation.startLine,
                      endLine: citation.endLine,
                      label: `参照 ${citation.id} の根拠`,
                    }
                  : undefined
              }
            />
            {data.matches ? (
              <EvidenceApplier
                articleRef={bodyRef}
                contentKey={`${citation.sourceId}:${source.request}`}
              />
            ) : null}
          </Suspense>
        )}
      </div>
    </aside>
  );
}
