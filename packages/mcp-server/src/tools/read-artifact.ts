import { guardPath, type Reader } from "@andon/reader-core";
import type { ReadResult } from "@andon/shared-types";
import { renderDegraded, renderResult, type ToolReply } from "../render.ts";

export const READ_ARTIFACT_DESCRIPTION =
  "AI-DLC の成果物ファイル（設計文書・要件・計画など）の本文を読みたいときに使う。" +
  "path はアクティブなインテントの記録ディレクトリからの相対パス（例: " +
  "`inception/requirements-analysis/requirements.md`）。記録ディレクトリの外は読めない。";

/**
 * M4 (FR-2.4). The pre-gate is `reader-core`'s exported `guardPath` — the same
 * function `reader.readArtifact` calls internally, invoked once more here
 * (BR-MS-2). Not a second implementation: one implementation, two call sites,
 * so a rejected path never reaches the reader boundary at all.
 *
 * `path` is the whole attack surface of this server (security-design.md 信頼境界):
 * the AI composes it freely, so it is the one input treated as半-trusted.
 */
export async function readArtifact(
  reader: Reader,
  workspaceRoot: string,
  recordDir: () => Promise<ReadResult<string>>,
  relPath: string,
): Promise<ToolReply> {
  const record = await recordDir();
  if (!("ok" in record)) return renderDegraded(record, workspaceRoot);

  const guarded = await guardPath(record.value, relPath);
  if (!("ok" in guarded)) return renderDegraded(guarded, workspaceRoot);

  // `verbatim`: the body is the answer. Rewriting paths inside a user's artifact
  // would break BR-MS-4, and echoing it into `data` would double a 10MB read.
  return renderResult(await reader.readArtifact(relPath), workspaceRoot, (body) => body, {
    verbatim: true,
  });
}
