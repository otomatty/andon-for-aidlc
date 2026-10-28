import type {
  DocsQaCitation,
  DocsQaJob,
  MarkdownItem,
  OfficialDocsToc,
} from "@aidlc-guide/shared-types";
import type { ReactNode } from "react";
import { DocsHome } from "@/features/docs/components/DocsHome.tsx";
import { DocsChat } from "@/features/docs/DocsChat.tsx";
import type { DocsQaState } from "@/features/docs/hooks/useDocsQa.ts";
import type { DocsCategory } from "@/features/docs/types.ts";
import { useVersionGate } from "@/services/version-gate.ts";
import type { ViewState } from "@/store/state.ts";

/** Home keeps the entry only; turns move the user onto the chat screen. */
export function docsShellShowsChat(
  qa: Pick<DocsQaState, "turns" | "busy" | "submitting">,
): boolean {
  return qa.turns.length > 0 || qa.busy || qa.submitting;
}

export function DocsShellQuestionSurface({
  qa,
  onCitation,
  ...home
}: {
  qa: DocsQaState;
  onCitation: (citation: DocsQaCitation, turn: DocsQaJob) => void;
  tocView: ViewState<OfficialDocsToc> | null;
  guidesView: ViewState<MarkdownItem[]> | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectPath: (path: string) => void;
  onSelectGuide: (name: string) => void;
  onOpenCategory: (category: DocsCategory) => void;
}): ReactNode {
  // While the version check blocks the workspace, the docs stay readable but
  // questions (an AI integration) wait for the update.
  const gated = useVersionGate() !== null;
  if (gated)
    return (
      <DocsHome
        {...home}
        questionPanel={
          <p className="text-sm text-muted-foreground" data-testid="docs-questions-gated">
            ドキュメントへの質問は、aidlc-workflows
            のバージョンを揃えた後に使えます。読みたいページは目次から選べます。
          </p>
        }
      />
    );
  if (docsShellShowsChat(qa)) {
    return <DocsChat mode="chat" qa={qa} onCitation={onCitation} />;
  }
  return (
    <DocsHome
      {...home}
      onAsk={qa.setDraft}
      questionPanel={<DocsChat mode="entry" qa={qa} onCitation={onCitation} />}
    />
  );
}
