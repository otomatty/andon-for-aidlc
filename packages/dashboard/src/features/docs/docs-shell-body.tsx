import type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaJob,
  OfficialDocsLocale,
} from "@aidlc-guide/shared-types";
import { HouseIcon, MenuIcon, MessageCircleIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { useFetchView } from "@/hooks/useFetchView.ts";
import {
  fetchGuide,
  fetchGuides,
  fetchOfficialDocsManifest,
  fetchOfficialDocsPage,
  fetchOfficialDocsToc,
} from "@/services/api.ts";
import { docsQaApi } from "@/services/docs-qa.ts";
import { vsCodeApi } from "@/services/vscode-api.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { viewValue } from "@/store/state.ts";
import { routeDeepLink } from "@/app/routes.ts";
import { AreaError } from "@/shared/atoms.tsx";
import { DocsNavigation } from "@/features/docs/components/nav/DocsNavigation.tsx";
import { flattenToc } from "@/features/docs/components/nav/DocsToc.tsx";
import type { DocSelection, DocsCategory } from "./types.ts";
import { guideCategory } from "./utils/docs-navigation.ts";
import { LocaleControl } from "@/features/docs/components/LocaleControl.tsx";
import { SourceVersionBadge } from "@/features/docs/components/SourceVersionBadge.tsx";
import { UntranslatedNotice } from "@/features/docs/components/UntranslatedNotice.tsx";
import { DocVideoCard } from "@/features/docs/components/video/DocVideoCard.tsx";
import { DocsShellQuestionSurface } from "@/features/docs/docs-shell-chat.tsx";
import { useDocsQa } from "@/features/docs/hooks/useDocsQa.ts";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { PanelShell } from "@/shell/PanelShell.tsx";
import { LoadingSequence } from "@/shared/loading/LoadingSequence.tsx";
import { DocsArticleBody } from "@/features/docs/docs-article-body.tsx";
import { DocsCitationBar } from "@/features/docs/docs-ref-bar.tsx";
import { useDocsArticleLinks } from "@/features/docs/use-docs-article-links.ts";
import { OnboardingTip } from "@/features/onboarding/components/OnboardingTip.tsx";
import { useVersionGate } from "@/services/version-gate.ts";

function normalizeRequestedAnchor(anchor: string | undefined): string | undefined {
  if (anchor === undefined) return undefined;
  const trimmed = anchor.trim().replace(/^#/, "");
  return trimmed === "" ? undefined : trimmed;
}

export function DocsShell(): ReactNode {
  const { route, officialDocsLocale: locale } = useAppState();
  const open = route.name === "docs";
  const deepLink = routeDeepLink(route);
  const dispatch = useDispatch();
  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [category, setCategory] = useState<DocsCategory>("workflow");
  const selectedPath = selection?.kind === "official" ? selection.path : null;
  const selectedGuide = selection?.kind === "guide" ? selection.name : null;
  const [requestedAnchor, setRequestedAnchor] = useState<string | undefined>(undefined);
  const [shellLandKey, setShellLandKey] = useState(0);
  const [applyKey, setApplyKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const gated = useVersionGate() !== null;
  const qa = useDocsQa(open && !gated, locale);
  const [reference, setReference] = useState<{
    citation: DocsQaCitation;
    turn: DocsQaJob;
    data?: DocsQaEvidence;
    error?: string;
  } | null>(null);
  const evidenceRequest = useRef(0);
  const answerPosition = useRef<{ top: number; turnId: string; locale: OfficialDocsLocale } | null>(
    null,
  );
  const [returnKey, setReturnKey] = useState(0);

  const clearReference = (): void => {
    evidenceRequest.current += 1;
    setReference(null);
  };

  const setLocale = (next: OfficialDocsLocale): void => {
    if (next !== locale) clearReference();
    dispatch({ type: "official-docs-locale", locale: next });
    vsCodeApi()?.postMessage({ type: "official-docs-locale", locale: next });
  };

  const manifestView = useFetchView(open ? fetchOfficialDocsManifest : null, [open]);
  const tocView = useFetchView(open ? () => fetchOfficialDocsToc(locale) : null, [open, locale]);
  const guidesView = useFetchView(open ? fetchGuides : null, [open]);
  const pageView = useFetchView(
    open && selectedPath !== null
      ? () => fetchOfficialDocsPage(locale, selectedPath, requestedAnchor)
      : null,
    [open, locale, selectedPath, requestedAnchor],
  );
  const guideView = useFetchView(
    open && selectedGuide !== null ? () => fetchGuide(selectedGuide) : null,
    [open, selectedGuide],
  );

  const manifest = manifestView === null ? null : viewValue(manifestView);
  const toc = tocView === null ? null : viewValue(tocView);
  const page = pageView === null ? null : viewValue(pageView);
  const guide = guideView === null ? null : viewValue(guideView);
  const guides = guidesView === null ? null : viewValue(guidesView);
  const entries = useMemo(() => (toc === null ? [] : flattenToc(toc)), [toc]);
  const knownPaths = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const guideNames = useMemo(() => guides?.map((entry) => entry.name) ?? [], [guides]);

  useEffect(() => {
    if (!open) {
      evidenceRequest.current += 1;
      setReference(null);
      setSelection(null);
      setCategory("workflow");
      setRequestedAnchor(undefined);
      setDrawerOpen(false);
      return;
    }
    if (deepLink !== null) {
      evidenceRequest.current += 1;
      setReference(null);
      dispatch({ type: "official-docs-locale", locale: deepLink.locale });
      if (deepLink.guide !== undefined && deepLink.guide !== "") {
        setSelection({ kind: "guide", name: deepLink.guide });
        setCategory(guideCategory(deepLink.guide));
      } else if (deepLink.path !== undefined && deepLink.path !== "") {
        setSelection({ kind: "official", path: deepLink.path });
        setCategory("workflow");
      } else {
        setSelection(null);
        setCategory("workflow");
      }
      setDrawerOpen(false);
      setRequestedAnchor(normalizeRequestedAnchor(deepLink.anchor));
      setShellLandKey((n) => n + 1);
      setApplyKey((n) => n + 1);
      dispatch({ type: "docs-shell", open: true });
    }
  }, [open, deepLink, dispatch]);

  useDocsArticleLinks({
    open,
    articleRef,
    selection,
    knownPaths,
    guideNames,
    setReference,
    evidenceRequest,
    setSelection,
    setCategory,
    setRequestedAnchor,
    setApplyKey,
    setDrawerOpen,
    normalizeRequestedAnchor,
  });

  useEffect(() => {
    if (returnKey === 0 || !answerPosition.current) return;
    const position = answerPosition.current;
    const scroll = document.querySelector('[data-testid="app-scroll"]');
    if (scroll) scroll.scrollTop = position.top;
    document.getElementById(`docs-answer-${position.turnId}`)?.focus({ preventScroll: true });
  }, [returnKey]);

  if (!open) return null;

  const onClose = (): void => {
    dispatch({ type: "docs-shell", open: false });
  };

  const onSelectPath = (path: string): void => {
    clearReference();
    setSelection({ kind: "official", path });
    setCategory("workflow");
    setRequestedAnchor(undefined);
    setApplyKey((n) => n + 1);
    setDrawerOpen(false);
  };

  const onSelectGuide = (name: string): void => {
    clearReference();
    setSelection({ kind: "guide", name });
    setCategory(guideCategory(name));
    setRequestedAnchor(undefined);
    setApplyKey((n) => n + 1);
    setDrawerOpen(false);
  };

  const onHome = (): void => {
    if (reference && answerPosition.current)
      dispatch({ type: "official-docs-locale", locale: answerPosition.current.locale });
    clearReference();
    setSelection(null);
    setRequestedAnchor(undefined);
    setDrawerOpen(false);
    setShellLandKey((n) => n + 1);
    articleRef.current?.scrollIntoView({ block: "start" });
  };

  const onOpenCategory = (next: DocsCategory): void => {
    setCategory(next);
    setDrawerOpen(true);
  };

  const onCitation = async (citation: DocsQaCitation, turn: DocsQaJob): Promise<void> => {
    if (reference === null)
      answerPosition.current = {
        top: document.querySelector('[data-testid="app-scroll"]')?.scrollTop ?? 0,
        turnId: turn.id,
        locale,
      };
    const request = ++evidenceRequest.current;
    setReference({ citation, turn });
    dispatch({ type: "official-docs-locale", locale: citation.target.locale });
    setSelection(
      citation.target.kind === "guide"
        ? { kind: "guide", name: citation.target.path }
        : { kind: "official", path: citation.target.path },
    );
    setCategory(
      citation.target.kind === "guide" ? guideCategory(citation.target.path) : "workflow",
    );
    setRequestedAnchor(undefined);
    setDrawerOpen(false);
    setApplyKey((key) => key + 1);
    articleRef.current?.scrollIntoView({ block: "start" });
    try {
      const data = await docsQaApi.evidence(citation);
      if (request === evidenceRequest.current) setReference({ citation, turn, data });
    } catch (cause) {
      if (request === evidenceRequest.current)
        setReference({
          citation,
          turn,
          error:
            cause instanceof Error
              ? cause.message
              : "\u53c2\u7167\u5143\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002",
        });
    }
  };

  const returnToAnswer = (): void => {
    if (answerPosition.current)
      dispatch({ type: "official-docs-locale", locale: answerPosition.current.locale });
    clearReference();
    setSelection(null);
    setRequestedAnchor(undefined);
    setReturnKey((key) => key + 1);
  };

  const askAboutDocument = (): void => {
    if (!selection) return;
    qa.setTarget(
      selection.kind === "guide"
        ? { kind: "guide", path: selection.name, locale: "ja" }
        : { kind: "official", path: selection.path, locale },
    );
    onHome();
    requestAnimationFrame(() => document.getElementById("docs-question")?.focus());
  };

  const sourceVersion = page?.sourceVersion ?? manifest?.sourceVersion ?? null;
  const isGuide = selection?.kind === "guide";
  const title =
    selection === null
      ? "\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8"
      : isGuide
        ? (guide?.title ?? "\u62e1\u5f35\u6a5f\u80fd")
        : (page?.title ?? "\u516c\u5f0f\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8");
  const articleView = isGuide ? guideView : pageView;
  const markdown =
    reference !== null ? reference.data?.markdown : isGuide ? guide?.markdown : page?.bodyMarkdown;
  const showNotice = !isGuide && pageView?.kind !== "error" && page?.notice === "missing_ja";
  const anchorApplied = isGuide
    ? requestedAnchor === undefined
      ? "top"
      : "scrolled"
    : requestedAnchor === undefined && page?.anchorApplied === "none"
      ? "top"
      : page?.anchorApplied;

  return (
    <PanelShell
      headingId="docs-shell-heading"
      testId="docs-shell"
      headingFont="body"
      hideHeading
      focusKey={shellLandKey}
      returnFocusSelector='[data-testid="header-menu-trigger"]'
      title={title}
      onClose={onClose}
      leading={
        <Tooltip label="ドキュメント一覧">
          <Button
            type="button"
            variant="outline"
            size="icon"
            data-testid="docs-menu"
            aria-label="ドキュメント一覧"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setDrawerOpen(true);
            }}
          >
            <MenuIcon />
          </Button>
        </Tooltip>
      }
      actions={
        <>
          {selection !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="docs-ask-about-document"
              onClick={askAboutDocument}
            >
              <MessageCircleIcon data-icon="inline-start" />
              この文書について質問
            </Button>
          ) : null}
          {selection?.kind === "official" ? (
            <SourceVersionBadge sourceVersion={sourceVersion} />
          ) : null}
          {!isGuide ? <LocaleControl locale={locale} onChange={setLocale} /> : null}
        </>
      }
    >
      {selection === null ? (
        <div className="mb-4">
          <OnboardingTip area="docs" />
        </div>
      ) : null}
      <LoadingSequence>
        <div className="min-w-0 flex-none" data-testid="docs-shell-body">
          <main
            ref={articleRef}
            className="min-w-0"
            data-testid="docs-article"
            aria-labelledby="docs-shell-heading"
            tabIndex={-1}
          >
            {reference ? (
              <DocsCitationBar
                reference={reference}
                qa={qa}
                onCitation={(citation, turn) => {
                  void onCitation(citation, turn);
                }}
                returnToAnswer={returnToAnswer}
                answerLocale={answerPosition.current?.locale}
              />
            ) : null}
            {selection !== null && reference === null && showNotice ? (
              <UntranslatedNotice notice={page?.notice} />
            ) : null}
            {selection?.kind === "official" && reference === null ? (
              <DocVideoCard
                key={`${locale}:${selection.path}`}
                locale={locale}
                docPath={selection.path}
              />
            ) : null}
            {selection === null ? (
              <DocsShellQuestionSurface
                qa={qa}
                onOpenCategory={onOpenCategory}
                onOpenGuide={onSelectGuide}
                onCitation={(citation, turn) => {
                  void onCitation(citation, turn);
                }}
              />
            ) : reference?.error ? null : reference === null && articleView?.kind === "error" ? (
              <AreaError detail={articleView.detail} />
            ) : markdown === undefined ? (
              <DocumentSkeleton label="Official docs body" />
            ) : (
              <DocsArticleBody
                title={title}
                markdown={markdown}
                reference={reference}
                applyKey={applyKey}
                articleRef={articleRef}
                anchorApplied={anchorApplied}
                requestedAnchor={requestedAnchor}
                locale={locale}
                selectedPath={selectedPath}
                selectedGuide={selectedGuide}
              />
            )}
          </main>
        </div>
      </LoadingSequence>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" data-testid="docs-drawer" size="min(100%, 28rem)">
          <SheetHeader>
            <SheetTitle>ドキュメント一覧</SheetTitle>
            <SheetDescription>種類を切り替えて、読みたいページを選んでください。</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="docs-home-link"
              onClick={onHome}
            >
              <HouseIcon data-icon="inline-start" />
              トップページへ
            </Button>
          </div>
          <DocsNavigation
            category={category}
            onCategoryChange={setCategory}
            tocView={tocView}
            guidesView={guidesView}
            selectedPath={selectedPath}
            selectedGuide={selectedGuide}
            onSelectPath={onSelectPath}
            onSelectGuide={onSelectGuide}
          />
        </SheetContent>
      </Sheet>
    </PanelShell>
  );
}
