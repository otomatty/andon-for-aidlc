import type { DocsQaCitation, DocsQaEvidence } from "@aidlc-guide/shared-types";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * What a cited source says about itself, wherever it is shown (the chat's
 * source panel or the full document): the quote the answer used, a load
 * failure, and a source that changed after the answer.
 */
export function EvidenceNotices({
  citation,
  data,
  error,
  busy,
  onReload,
  onRefreshAnswer,
}: {
  citation: DocsQaCitation;
  data?: DocsQaEvidence;
  error?: string;
  busy: boolean;
  onReload: () => void;
  onRefreshAnswer: () => void;
}): ReactNode {
  return (
    <>
      <div className="text-sm text-muted-foreground">
        <Collapsible>
          <CollapsibleTrigger variant="disclosure">回答時の引用文を見る</CollapsibleTrigger>
          <CollapsibleContent>
            <blockquote className="mt-2 max-h-40 overflow-y-auto border-l-2 pl-3 whitespace-pre-wrap">
              {citation.quote}
            </blockquote>
          </CollapsibleContent>
        </Collapsible>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="docs-reload-evidence"
            onClick={onReload}
          >
            参照元を再読み込み
          </Button>
        </Alert>
      ) : null}
      {data && !data.matches ? (
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
            disabled={busy}
            onClick={onRefreshAnswer}
          >
            最新の文書で回答を更新
          </Button>
        </Alert>
      ) : null}
    </>
  );
}
