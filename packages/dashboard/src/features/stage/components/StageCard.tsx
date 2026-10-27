import type {
  ArtifactDoc,
  OfficialDocsLocale,
  StageDoc,
  StageIoPaths,
} from "@aidlc-guide/shared-types";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canOpenDocsInIde, docsOpenHref, isExternal } from "@/services/docs.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { OpenOfficialDocLink } from "./OpenOfficialDocLink.tsx";

export interface StageCardProps {
  doc: StageDoc;
  ioPaths?: StageIoPaths | null;
  /** Open a resolved I/O Markdown path in the dashboard preview (issue #32). */
  onPreviewIo?: (path: string) => void;
}

/**
 * What one artifact contains, in the reader's locale. Falls back to English
 * where the ja snapshot documents no row, the same degradation the official
 * docs shell already uses; `null` means neither locale documents it and the
 * item is rendered bare rather than with invented copy.
 */
function describeArtifact(doc: ArtifactDoc | undefined, locale: OfficialDocsLocale): string | null {
  if (doc === undefined) return null;
  return doc.descriptions[locale] ?? doc.descriptions.en ?? null;
}

function List({
  label,
  items,
  paths,
  docs,
  onPreviewIo,
  onboardingAnchor,
}: {
  label: string;
  items: string[];
  paths: Record<string, string | null> | null;
  docs: Record<string, ArtifactDoc>;
  onPreviewIo?: (path: string) => void;
  /** Where the guided tour points (features/onboarding/tour/steps.ts). */
  onboardingAnchor?: string;
}): ReactNode {
  const canOpen = canOpenDocsInIde();
  const locale = useAppState().officialDocsLocale;
  return (
    <div data-onboarding={onboardingAnchor}>
      <SectionLabel>{label}</SectionLabel>
      {items.length === 0 ? (
        <p className="text-muted-foreground">（なし）</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => {
            const path = paths?.[item];
            const description = describeArtifact(docs[item], locale);
            return (
              <li key={item}>
                {typeof path === "string" && canOpen && onPreviewIo !== undefined ? (
                  <Button
                    type="button"
                    variant="link"
                    data-testid={`io-open-${item}`}
                    onClick={() => {
                      onPreviewIo(path);
                    }}
                  >
                    <span className="font-mono">{item}</span>
                  </Button>
                ) : (
                  <span className="font-mono text-muted-foreground">{item}</span>
                )}
                {description === null ? null : (
                  <p
                    className="text-muted-foreground text-xs"
                    data-testid={`artifact-description-${item}`}
                  >
                    {description}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A part's name inside the card: bold, a step below the card title. */
function SectionLabel({ children }: { children: ReactNode }): ReactNode {
  return <h4 className="mb-1.5 text-sm font-bold">{children}</h4>;
}

function DocsLink({ doc }: { doc: StageDoc }): ReactNode {
  const { docsBaseUrl, stageDocs } = useAppState();
  const inIde = canOpenDocsInIde();

  // Bolt 3: VS Code webview uses Official Docs Shell (open-official-doc).
  // Must not call docsOpenHref / openDocInIde / open-doc on this path (FR-B3-5.1).
  if (inIde) {
    return <OpenOfficialDocLink slug={doc.slug} sourceVersion={doc.sourceVersion} />;
  }

  // Browser / Mob: legacy Confluence override or docsBaseUrl href (not Fail for NFR-B3-2).
  const href = docsOpenHref(doc.slug, doc.deepLink, { docsBaseUrl, stageDocs });
  if (href === null) return null;

  return (
    <p>
      <a
        href={href}
        className="text-primary underline-offset-4 hover:underline"
        rel="noopener noreferrer"
        {...(isExternal(href) ? { target: "_blank" } : {})}
      >
        docs を開く
      </a>{" "}
      <span className="text-muted-foreground">（sync: {doc.sourceVersion}）</span>
    </p>
  );
}

function AgentLink({ agentId, label }: { agentId: string; label: string }): ReactNode {
  const dispatch = useDispatch();
  return (
    <Button
      type="button"
      variant="link"
      data-testid={`agent-link-${agentId}`}
      title={agentId}
      onClick={() => {
        dispatch({ type: "open-agent", id: agentId });
      }}
    >
      {label}
    </Button>
  );
}

export function StageCard({ doc, ioPaths = null, onPreviewIo }: StageCardProps): ReactNode {
  return (
    <Card size="lg" className="overflow-visible" data-testid={`stage-card-${doc.slug}`}>
      <CardHeader>
        <CardTitle>目的</CardTitle>
        <CardDescription>{doc.purpose}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-5 md:grid-cols-2">
          <List
            label="入力"
            items={doc.inputs}
            paths={ioPaths?.inputs ?? null}
            docs={doc.artifactDocs}
            onPreviewIo={onPreviewIo}
          />
          <List
            label="出力"
            items={doc.outputs}
            paths={ioPaths?.outputs ?? null}
            docs={doc.artifactDocs}
            onPreviewIo={onPreviewIo}
            onboardingAnchor="stage-outputs"
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <SectionLabel>担当エージェント</SectionLabel>
            <AgentLink agentId={doc.agent} label={doc.agentDisplayName} />
          </div>
          <div data-onboarding="gate-requirement">
            <SectionLabel>ゲート要求</SectionLabel>
            <p>{doc.gateRequirement}</p>
          </div>
        </div>
        <div className="border-t pt-4 empty:hidden">
          <DocsLink doc={doc} />
        </div>
        {/* Bolt 4 / FR-B4-1: never mount doc.excerpt as article (UI-only; API may still return it). */}
      </CardContent>
    </Card>
  );
}
