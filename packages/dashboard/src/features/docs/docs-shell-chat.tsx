import type {
  DocsQaCitation,
  DocsQaJob,
  MarkdownItem,
  OfficialDocsLocale,
  OfficialDocsToc,
} from "@aidlc-guide/shared-types";
import type { ReactNode } from "react";
import { DocsChatView } from "@/features/docs/components/chat/DocsChatView.tsx";
import { DocsComposer, focusDocsQuestion } from "@/features/docs/components/chat/DocsComposer.tsx";
import { DocsHome } from "@/features/docs/components/DocsHome.tsx";
import type { DocsQaState } from "@/features/docs/hooks/useDocsQa.ts";
import type { DocsCategory } from "@/features/docs/types.ts";
import type { DocLinks } from "@/features/docs/use-docs-article-links.ts";
import { useVersionGate } from "@/services/version-gate.ts";
import type { ViewState } from "@/store/state.ts";

/** The docs landing, or the question screen while it is open. */
export function DocsShellQuestionSurface({
  qa,
  locale,
  chatOpen,
  onOpenChat,
  onCloseChat,
  onOpenDocument,
  docLinks,
  ...home
}: {
  qa: DocsQaState;
  locale: OfficialDocsLocale;
  chatOpen: boolean;
  onOpenChat: () => void;
  onCloseChat: () => void;
  onOpenDocument: (citation: DocsQaCitation, turn: DocsQaJob) => void;
  docLinks: DocLinks;
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
  if (chatOpen)
    return (
      <DocsChatView
        qa={qa}
        locale={locale}
        docLinks={docLinks}
        onBack={onCloseChat}
        onOpenDocument={onOpenDocument}
      />
    );
  const openChat = (): void => {
    onOpenChat();
    focusDocsQuestion();
  };
  const first = qa.turns[0];
  return (
    <DocsHome
      {...home}
      onOpenChat={openChat}
      onAsk={(draft) => {
        qa.setDraft(draft);
        openChat();
      }}
      conversation={first ? { first: first.question, count: qa.turns.length, busy: qa.busy } : null}
      questionPanel={
        <DocsComposer
          qa={qa}
          label="質問"
          onSubmit={() => {
            onOpenChat();
            void qa.submit();
          }}
        />
      }
    />
  );
}
