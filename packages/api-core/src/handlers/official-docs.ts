import {
  type Locale,
  listToc,
  type Manifest,
  mapStageToDoc,
  type ResolvedPage,
  readManifest,
  resolvePage,
  type StageDocRef,
  type TocTree,
} from "@andon/official-docs";
import type { ReadResult } from "@andon/shared-types";

/**
 * `/api/official-docs/*` — distinct from `/api/guides` (FR-U2.6).
 */

export function officialDocsManifest(workspaceRoot: string): Promise<ReadResult<Manifest>> {
  return readManifest(workspaceRoot);
}

export function officialDocsToc(
  workspaceRoot: string,
  locale: string,
): Promise<ReadResult<TocTree>> {
  return listToc(workspaceRoot, locale as Locale);
}

export function officialDocsPage(
  workspaceRoot: string,
  locale: string,
  docPath: string,
  anchor?: string,
): Promise<ReadResult<ResolvedPage>> {
  return resolvePage({ workspaceRoot, locale, path: docPath, anchor });
}

export function officialDocsStageMap(stageSlug: string): ReadResult<StageDocRef | null> {
  return { ok: true, value: mapStageToDoc(stageSlug) };
}
