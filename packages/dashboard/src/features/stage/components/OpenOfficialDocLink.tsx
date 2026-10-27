import { BookOpenIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { fetchOfficialDocsStageMap } from "@/services/api.ts";
import { buildOpenOfficialDocMessage, openOfficialDocInIde } from "@/services/docs.ts";
import { useAppState } from "@/store/context.tsx";

/** Bolt 4 primary CTA strings (FR-B4-2.4) — visible + aria-label. */
const OPEN_IN_DOCS_LABEL = "Open in Docs";

export interface OpenOfficialDocLinkProps {
  /** Stage slug used for GET /api/official-docs/stage/:slug. */
  slug: string;
  /**
   * @deprecated Bolt 4 CTA label is fixed `Open in Docs` (FR-B4-2.4).
   * Kept optional so callers may still pass a display name without effect.
   */
  stageDisplayName?: string;
  /** Sync version label (StageDoc.sourceVersion). */
  sourceVersion?: string;
}

/**
 * StageCard control: fetch stage map → post `open-official-doc`.
 * Bolt 4: primary CTA label `Open in Docs` (solid). Must not call
 * docsOpenHref / openDocInIde / open-doc on this path.
 */
export function OpenOfficialDocLink({
  slug,
  stageDisplayName: _stageDisplayName,
  sourceVersion,
}: OpenOfficialDocLinkProps): ReactNode {
  const locale = useAppState().officialDocsLocale;
  // Bump on each activate / slug change / unmount so a slow map fetch cannot
  // post after the user left this StageCard or started a newer click (#35).
  const activationGen = useRef(0);
  const slugSeen = useRef(slug);
  if (slugSeen.current !== slug) {
    slugSeen.current = slug;
    activationGen.current += 1;
  }

  useEffect(() => {
    return () => {
      activationGen.current += 1;
    };
  }, []);

  const onActivate = (): void => {
    const gen = ++activationGen.current;
    void fetchOfficialDocsStageMap(slug).then((result) => {
      if (gen !== activationGen.current) return;
      // Only a successful ReadResult may open Shell. Transport/API errors must
      // not be treated as unmapped (locale-only) — that hides the failure and
      // lands the wrong document (NFR reliability; Codex P2 on PR #35).
      if (!("ok" in result) || !result.ok) return;
      const message = buildOpenOfficialDocMessage(locale, result.value);
      openOfficialDocInIde(message);
    });
  };

  return (
    <p className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="default"
        data-testid="open-official-doc"
        aria-label={OPEN_IN_DOCS_LABEL}
        onClick={onActivate}
      >
        <BookOpenIcon />
        {OPEN_IN_DOCS_LABEL}
      </Button>
      {sourceVersion === undefined ? null : (
        <span className="text-xs text-muted-foreground">（sync: {sourceVersion}）</span>
      )}
    </p>
  );
}
