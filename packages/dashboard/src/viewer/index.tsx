import type { Verdict } from "@andon/shared-types";
import { PencilIcon, XIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AreaError } from "@/shared/atoms.tsx";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { fetchArtifact } from "@/services/api.ts";
import { canOpenDocsInIde, editFileInIde } from "@/services/docs.ts";
import { deriveViewState } from "@/store/derive-view-state.ts";
import type { ViewState } from "@/store/state.ts";
import { AnswerEditor, answerLinesOf } from "./AnswerEditor.tsx";
import { artifactPath, firstArtifact } from "./artifact-path.ts";
import { MarkdownSurface } from "./MarkdownSurface.tsx";

/**
 * US-13 / FR-6.1 — the artifact viewer, the whole of which is behind a
 * `React.lazy` boundary in DetailPanel so that neither this file nor `mermaid`
 * can reach the initial bundle (P-AV-1).
 *
 * Which artifact is open is **local state**: it is a property of this panel,
 * not of the application, and putting it in the store would make a second
 * source of truth for something only this component reads.
 */

export interface ArtifactViewerProps {
  unit: string;
  stage: string;
  /** Filenames of the selected matrix cell, from `MatrixCell.files`. */
  files: string[];
  verdict: Verdict | null;
}

// Re-exported so the viewer's own tests and consumers have one import site;
// the definitions live in the leaf module DetailPanel also imports.
export { artifactPath, firstArtifact };

/**
 * Header of the viewer: switch artifact within the cell, show the cell's
 * verdict, close the artifact. It shares `open`/`files` with ArtifactViewer,
 * which is why it lives here rather than in a file of its own.
 */
function ViewerToolbar({
  files,
  open,
  verdict,
  editPath,
  onOpen,
  onClose,
}: {
  files: string[];
  open: string | null;
  verdict: Verdict | null;
  editPath: string | null;
  onOpen: (file: string) => void;
  onClose: () => void;
}): ReactNode {
  const canEdit = editPath !== null && canOpenDocsInIde();
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2" data-testid="viewer-toolbar">
      <Tabs
        value={open}
        onValueChange={(value) => {
          if (typeof value === "string") onOpen(value);
        }}
      >
        <TabsList aria-label="成果物" size="mono">
          {files.map((file) => (
            <TabsTrigger key={file} value={file}>
              {file}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <span className="flex-1" />
      {verdict === null ? null : (
        <span className="cell__verdict" data-verdict={verdict} data-testid="viewer-verdict">
          {verdict}
        </span>
      )}
      {canEdit ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="viewer-edit"
          onClick={() => {
            if (editPath !== null) editFileInIde(editPath);
          }}
        >
          <PencilIcon data-icon="inline-start" />
          エディタで編集
        </Button>
      ) : null}
      {open === null ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          data-testid="viewer-close"
        >
          <XIcon data-icon="inline-start" />
          成果物を閉じる
        </Button>
      )}
    </div>
  );
}

export function ArtifactViewer({ unit, stage, files, verdict }: ArtifactViewerProps): ReactNode {
  // Same rule DetailPanel's prefetch uses, so the warmed path is the one that
  // actually opens (P-AV-2).
  const first = firstArtifact(files);
  const [open, setOpen] = useState<string | null>(first);
  const [state, setState] = useState<ViewState<string>>({ kind: "loading" });

  // A different cell reuses this component instance; re-point it at that cell's
  // first artifact instead of showing the previous cell's file.
  // re-point on cell change, not on list identity
  useEffect(() => {
    setOpen(first);
  }, [unit, stage, first]);

  // D1 step 1. Late answers are dropped rather than dispatched, because unlike
  // the stage-doc cache there is no per-path slot for them to fill.
  useEffect(() => {
    if (open === null) return;
    let live = true;
    setState({ kind: "loading" });
    void fetchArtifact(artifactPath(unit, stage, open)).then((result) => {
      if (live) setState(deriveViewState(result));
    });
    return () => {
      live = false;
    };
  }, [unit, stage, open]);

  const onSaved = useCallback((markdown: string) => {
    setState({ kind: "success", value: markdown });
  }, []);

  const path = open === null ? null : artifactPath(unit, stage, open);
  const markdown = state.kind === "success" || state.kind === "partial" ? state.value : null;
  // One scan of the document, shared by the surface and the editor — memoised
  // (with the `editable` prop object) so MarkdownSurface's memo can hold and
  // unrelated dispatches stop re-lexing the open artifact.
  const answerLines = useMemo(
    () => (path === null || markdown === null ? [] : answerLinesOf(path, markdown)),
    [path, markdown],
  );
  const editable = useMemo(
    () => (answerLines.length === 0 ? null : { answerLines }),
    [answerLines],
  );

  if (files.length === 0) {
    return (
      <section aria-label="成果物" data-testid="artifact-viewer">
        <p data-testid="viewer-empty">成果物がありません</p>
      </section>
    );
  }

  return (
    <section
      className="viewer rounded-md border bg-card px-6 pt-3 pb-6"
      aria-label="成果物"
      data-testid="artifact-viewer"
    >
      <ViewerToolbar
        files={files}
        open={open}
        verdict={verdict}
        editPath={path}
        onOpen={setOpen}
        onClose={() => {
          setOpen(null);
        }}
      />

      {open === null ? (
        <p data-testid="viewer-closed">成果物を選択してください</p>
      ) : state.kind === "loading" ? (
        <DocumentSkeleton label="成果物" />
      ) : state.kind === "error" ? (
        <AreaError detail={state.detail} />
      ) : state.kind === "empty" ? (
        <p data-testid="viewer-empty">{state.hint}</p>
      ) : null}

      {markdown === null || path === null ? null : (
        <>
          {state.kind === "partial" ? (
            <ul className="viewer__notes" data-testid="viewer-notes">
              {state.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <MarkdownSurface markdown={markdown} editable={editable} documentPath={path} />
          <AnswerEditor
            path={path}
            answerLines={answerLines}
            markdown={markdown}
            onSaved={onSaved}
          />
        </>
      )}
    </section>
  );
}

export default ArtifactViewer;
