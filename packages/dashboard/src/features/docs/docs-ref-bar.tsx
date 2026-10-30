import type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaJob,
  OfficialDocsLocale,
} from "@andon/shared-types";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EvidenceNotices } from "@/features/docs/components/qa/EvidenceNotices.tsx";
import type { DocsQaState } from "@/features/docs/hooks/useDocsQa.ts";

type Reference = {
  citation: DocsQaCitation;
  turn: DocsQaJob;
  data?: DocsQaEvidence;
  error?: string;
};

export function DocsCitationBar({
  reference,
  qa,
  onCitation,
  returnToAnswer,
  answerLocale,
}: {
  reference: Reference;
  qa: DocsQaState;
  onCitation: (citation: DocsQaCitation, turn: DocsQaJob) => void;
  returnToAnswer: () => void;
  answerLocale: OfficialDocsLocale | undefined;
}): ReactNode {
  return (
    <section
      className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background px-4 py-3"
      aria-label="answer reference"
      data-testid="docs-citation-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="docs-return-to-chat"
          onClick={returnToAnswer}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          回答に戻る
        </Button>
        <span className="text-sm text-muted-foreground">
          参照 [{reference.citation.id}] · {reference.citation.target.locale.toUpperCase()} ·{" "}
          {reference.citation.version}
        </span>
        {reference.turn.citations.length > 1
          ? reference.turn.citations.map((citation) => (
              <Button
                key={citation.id}
                type="button"
                variant={citation.id === reference.citation.id ? "secondary" : "ghost"}
                size="sm"
                data-testid="docs-citation"
                aria-label={`参照 ${citation.id} を表示`}
                aria-current={citation.id === reference.citation.id ? "true" : undefined}
                onClick={() => onCitation(citation, reference.turn)}
              >
                [{citation.id}]
              </Button>
            ))
          : null}
      </div>
      <EvidenceNotices
        citation={reference.citation}
        data={reference.data}
        error={reference.error}
        busy={qa.busy}
        onReload={() => onCitation(reference.citation, reference.turn)}
        onRefreshAnswer={() => {
          const question = reference.turn.question;
          returnToAnswer();
          void qa.submit(question, {
            locale: reference.turn.locale ?? answerLocale,
            target: reference.turn.target,
          });
        }}
      />
    </section>
  );
}
