import type { OfficialDocsLocale } from "@andon/shared-types";
import type { RefObject } from "react";
import { Suspense, type ReactNode, useRef } from "react";
import { MarkdownSurface } from "@/viewer/lazy-markdown.ts";
import { DocsPageOutline } from "@/features/docs/components/DocsPageOutline.tsx";
import { AnchorApplier } from "@/features/docs/components/qa/AnchorApplier.tsx";
import { EvidenceApplier } from "@/features/docs/components/qa/EvidenceApplier.tsx";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import type { DocsQaCitation, DocsQaEvidence, DocsQaJob } from "@andon/shared-types";

type Reference = {
  citation: DocsQaCitation;
  turn: DocsQaJob;
  data?: DocsQaEvidence;
  error?: string;
};

export function DocsArticleBody({
  title,
  markdown,
  reference,
  applyKey,
  articleRef,
  anchorApplied,
  requestedAnchor,
  locale,
  selectedPath,
  selectedGuide,
}: {
  title: string;
  markdown: string;
  reference: Reference | null;
  applyKey: number;
  articleRef: RefObject<HTMLElement | null>;
  anchorApplied: "scrolled" | "top" | "none" | undefined;
  requestedAnchor: string | undefined;
  locale: OfficialDocsLocale;
  selectedPath: string | null;
  selectedGuide: string | null;
}): ReactNode {
  const bodyRef = useRef<HTMLDivElement>(null);
  // `.docs-article` scopes the long-form reading styles in app.css; the shared
  // MarkdownSurface stays compact everywhere else it is used.
  return (
    <div className="docs-article">
      <div className="docs-article__layout">
        <div ref={bodyRef} className="docs-article__body">
          {title !== "" ? (
            <h1 data-testid="docs-article-h1" className="sr-only">
              {title}
            </h1>
          ) : null}
          <Suspense fallback={<DocumentSkeleton label="Official docs body" />}>
            <MarkdownSurface
              markdown={markdown}
              editable={null}
              evidence={
                reference?.data?.matches
                  ? {
                      startLine: reference.citation.startLine,
                      endLine: reference.citation.endLine,
                      label: `参照 ${reference.citation.id} の根拠`,
                    }
                  : undefined
              }
            />
            {reference ? (
              reference.data?.matches ? (
                <EvidenceApplier
                  articleRef={articleRef}
                  contentKey={`${reference.citation.sourceId}:${applyKey}`}
                />
              ) : null
            ) : (
              <AnchorApplier
                anchorApplied={anchorApplied}
                anchor={requestedAnchor}
                articleRef={articleRef}
                contentKey={`${locale}:${selectedPath ?? selectedGuide}:${markdown.length}:${applyKey}`}
              />
            )}
          </Suspense>
        </div>
        <DocsPageOutline contentRef={bodyRef} />
      </div>
    </div>
  );
}
