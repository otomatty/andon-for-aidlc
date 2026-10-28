import type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaJob,
  OfficialDocsLocale,
} from "@aidlc-guide/shared-types";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
          {"\u56de\u7b54\u306b\u623b\u308b"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {"\u53c2\u7167"} [{reference.citation.id}] ·{" "}
          {reference.citation.target.locale.toUpperCase()} · {reference.citation.version}
        </span>
        {reference.turn.citations.length > 1
          ? reference.turn.citations.map((citation) => (
              <Button
                key={citation.id}
                type="button"
                variant={citation.id === reference.citation.id ? "secondary" : "ghost"}
                size="sm"
                data-testid="docs-citation"
                aria-label={`\u53c2\u7167 ${citation.id} \u3092\u8868\u793a`}
                aria-current={citation.id === reference.citation.id ? "true" : undefined}
                onClick={() => onCitation(citation, reference.turn)}
              >
                [{citation.id}]
              </Button>
            ))
          : null}
      </div>
      <div className="text-sm text-muted-foreground">
        <Collapsible>
          <CollapsibleTrigger variant="disclosure">
            {"\u56de\u7b54\u6642\u306e\u5f15\u7528\u6587\u3092\u898b\u308b"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <blockquote className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 pl-3">
              {reference.citation.quote}
            </blockquote>
          </CollapsibleContent>
        </Collapsible>
      </div>
      {reference.error ? (
        <Alert variant="destructive">
          <AlertDescription>{reference.error}</AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="docs-reload-evidence"
            onClick={() => onCitation(reference.citation, reference.turn)}
          >
            参照元を再読み込み
          </Button>
        </Alert>
      ) : null}
      {reference.data && !reference.data.matches ? (
        <Alert>
          <AlertTitle>回答後に文書が更新されています</AlertTitle>
          <AlertDescription>
            最新の本文を表示しています。引用位置が変わっている可能性があるため、ハイライトを解除しました。
          </AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="docs-refresh-answer"
            disabled={qa.busy}
            onClick={() => {
              const question = reference.turn.question;
              returnToAnswer();
              void qa.submit(question, {
                locale: reference.turn.locale ?? answerLocale,
                target: reference.turn.target,
              });
            }}
          >
            最新の文書で回答を更新
          </Button>
        </Alert>
      ) : null}
    </section>
  );
}
