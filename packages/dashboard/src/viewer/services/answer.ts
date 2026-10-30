import type { AnswerError, AnswerRequest } from "@andon/shared-types";
import { fetchArtifact } from "@/services/api.ts";
import { getTransport } from "@/services/transport/index.ts";

/**
 * **S-AV-1: the entire write surface of the client.** This is the only module
 * in `packages/dashboard` that issues a non-GET request, and
 * `dependency-direction.test.ts` fails if a second one appears.
 */

export type SaveResult =
  | { kind: "saved"; markdown: string; verified: boolean }
  | { kind: "rejected"; error: AnswerError }
  | { kind: "failed"; reason: string };

function lineBounds(text: string, line: number): { start: number; end: number } | null {
  let start = 0;
  for (let i = 1; i < line; i += 1) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) return null;
    start = newline + 1;
  }
  if (start > text.length) return null;
  const newline = text.indexOf("\n", start);
  let end = newline === -1 ? text.length : newline;
  if (end > start && text.charAt(end - 1) === "\r") end -= 1;
  return { start, end };
}

export function unchangedOutsideLine(before: string, after: string, line: number): boolean {
  const a = lineBounds(before, line);
  const b = lineBounds(after, line);
  if (a === null || b === null) return false;
  return (
    before.slice(0, a.start) + before.slice(a.end) === after.slice(0, b.start) + after.slice(b.end)
  );
}

const GATE_ERRORS: ReadonlySet<string> = new Set<AnswerError>([
  "not-a-questions-file",
  "outside-record",
  "not-an-answer-line",
  "chat-answered-line",
  "write-verification-failed",
]);

export async function saveAnswer(request: AnswerRequest, before: string): Promise<SaveResult> {
  const response = await getTransport().postJson("/api/answer", request);

  const record = (
    typeof response.body === "object" && response.body !== null ? response.body : {}
  ) as Record<string, unknown>;

  if (response.ok && record.ok === true) {
    const reread = await fetchArtifact(request.file);
    if (!("ok" in reread)) {
      return {
        kind: "failed",
        reason: "unsupported" in reread ? `unsupported-version-${reread.version}` : reread.reason,
      };
    }
    return {
      kind: "saved",
      markdown: reread.value,
      verified: unchangedOutsideLine(before, reread.value, request.line),
    };
  }

  const error = record.error;
  if (typeof error === "string" && GATE_ERRORS.has(error)) {
    return { kind: "rejected", error: error as AnswerError };
  }
  const reason =
    typeof error === "string"
      ? error
      : typeof record.reason === "string"
        ? record.reason
        : `http-${response.status}`;
  return { kind: "failed", reason: response.status === 0 ? "server-unreachable" : reason };
}
