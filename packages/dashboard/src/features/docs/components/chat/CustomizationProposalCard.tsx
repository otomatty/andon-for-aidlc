import type { CustomizationProposal, CustomizationProposalEntry } from "@andon/shared-types";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { KIND_LABELS } from "@/features/customization/utils/kind-labels.ts";
import type { ProposalApply } from "@/features/docs/hooks/proposal-apply.ts";
import { foldDiff, lineDiff } from "@/features/docs/utils/line-diff.ts";

const OPERATIONS: Record<
  CustomizationProposalEntry["operation"],
  { label: string; variant: "success" | "info" | "destructive" }
> = {
  create: { label: "追加", variant: "success" },
  replace: { label: "変更", variant: "info" },
  remove: { label: "削除", variant: "destructive" },
};

const MARKS = { same: " ", add: "+", remove: "-" } as const;

/** The entry's text before and after, as a diff with unchanged runs folded. */
function EntryDiff({ entry }: { entry: CustomizationProposalEntry }): ReactNode {
  const diff = lineDiff(entry.before ?? "", entry.after ?? "");
  if (diff === null)
    return (
      <p className="text-sm text-muted-foreground">
        内容が大きいため差分を表示できません。適用後にカスタマイズ画面で確認してください。
      </p>
    );
  return (
    <pre
      className="max-h-96 overflow-auto rounded-md border bg-muted/40 py-2 font-mono text-xs leading-relaxed"
      data-testid="docs-proposal-diff"
    >
      {foldDiff(diff).map((row, index) =>
        row.type === "skip" ? (
          <span key={index} className="block px-3 text-muted-foreground italic">
            {`… 変更のない ${row.count} 行`}
          </span>
        ) : (
          <span
            key={index}
            className={cn(
              "block px-3 whitespace-pre-wrap wrap-anywhere",
              row.type === "add" && "bg-status-done/15",
              row.type === "remove" && "bg-destructive/15",
            )}
          >
            <span aria-hidden="true" className="mr-2 text-muted-foreground select-none">
              {MARKS[row.type]}
            </span>
            <span className="sr-only">
              {row.type === "add" ? "追加: " : row.type === "remove" ? "削除: " : ""}
            </span>
            {row.text}
          </span>
        ),
      )}
    </pre>
  );
}

/**
 * The changes a customize turn proposes. Nothing is written until the reader
 * applies them; applying goes through the same save as the customization page.
 */
export function CustomizationProposalCard({
  proposal,
  result,
  onApply,
  onOpenCustomization,
}: {
  proposal: CustomizationProposal;
  result: ProposalApply | undefined;
  onApply: () => void;
  onOpenCustomization?: () => void;
}): ReactNode {
  const errors = proposal.diagnostics.filter((entry) => entry.severity === "error");
  const warnings = proposal.diagnostics.filter((entry) => entry.severity === "warning");
  const done = result?.status === "applied";
  const applying = result?.status === "applying";
  const uncertain = result?.status === "failed" && result.uncertain === true;
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border p-4"
      aria-label="設定の変更案"
      data-testid="docs-proposal"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold">{`変更案（${proposal.entries.length}件）`}</h4>
        <Badge variant="outline">{`スペース: ${proposal.spaceId}`}</Badge>
      </div>
      {proposal.entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {proposal.entries.map((entry) => {
            const operation = OPERATIONS[entry.operation];
            return (
              <li key={entry.itemId} className="rounded-lg border px-3 py-2">
                <Collapsible>
                  <CollapsibleTrigger
                    variant="disclosure"
                    className="w-full text-sm"
                    data-testid="docs-proposal-entry"
                  >
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <Badge variant={operation.variant}>{operation.label}</Badge>
                      <span className="font-medium">{entry.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {`${KIND_LABELS[entry.kind]} · ${entry.location}`}
                      </span>
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2">
                      <EntryDiff entry={entry} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            );
          })}
        </ul>
      ) : null}
      {[...errors, ...warnings].map((entry) => (
        <Alert
          key={`${entry.code}-${entry.itemId ?? ""}-${entry.message}`}
          variant={entry.severity === "error" ? "destructive" : "default"}
        >
          <AlertTitle>{entry.severity === "error" ? "修正が必要" : "確認事項"}</AlertTitle>
          <AlertDescription>{entry.message}</AlertDescription>
        </Alert>
      ))}
      {result?.status === "failed" ? (
        <Alert variant="destructive" data-testid="docs-proposal-error">
          <AlertTitle>適用できませんでした</AlertTitle>
          <AlertDescription>
            <p>{result.message}</p>
            {result.diagnostics.map((entry) => (
              <p key={`${entry.code}-${entry.itemId ?? ""}-${entry.message}`}>{entry.message}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {!proposal.canApply && proposal.reason ? (
        <p className="text-sm text-muted-foreground" data-testid="docs-proposal-reason">
          {proposal.reason}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {done ? (
          <p
            role="status"
            className="inline-flex items-center gap-1 text-sm font-medium text-status-done"
            data-testid="docs-proposal-applied"
          >
            <CheckIcon aria-hidden="true" className="size-4" />
            {result.message}
          </p>
        ) : proposal.canApply && !uncertain ? (
          <Button
            type="button"
            size="sm"
            data-testid="docs-proposal-apply"
            disabled={applying}
            onClick={onApply}
          >
            {applying ? (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {applying ? "適用しています…" : "この変更を適用"}
          </Button>
        ) : null}
        {onOpenCustomization ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="docs-proposal-open-customization"
            onClick={onOpenCustomization}
          >
            カスタマイズ画面で確認
          </Button>
        ) : null}
      </div>
    </section>
  );
}
