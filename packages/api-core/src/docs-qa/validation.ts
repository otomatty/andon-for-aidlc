import type { DocsQaRequest, DocsQaTarget } from "@andon/shared-types";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function target(value: unknown): value is DocsQaTarget {
  if (!record(value) || (value.kind !== "official" && value.kind !== "guide")) return false;
  if (value.locale !== "en" && value.locale !== "ja") return false;
  if (typeof value.path !== "string" || value.path.length > 400) return false;
  if (!/^[a-zA-Z0-9_./-]+\.md$/.test(value.path)) return false;
  if (
    value.path.startsWith("/") ||
    value.path.split("/").some((part) => !part || part === ".." || part === ".")
  )
    return false;
  return value.kind !== "guide" || !value.path.includes("/");
}

export function parseQuestion(value: unknown): DocsQaRequest | undefined {
  if (!record(value)) return undefined;
  if (typeof value.question !== "string" || !value.question.trim() || value.question.length > 2000)
    return undefined;
  if (value.tool !== "claude" && value.tool !== "cursor" && value.tool !== "copilot")
    return undefined;
  if (value.locale !== "en" && value.locale !== "ja") return undefined;
  if (value.target !== undefined && !target(value.target)) return undefined;
  if (
    value.history !== undefined &&
    (!Array.isArray(value.history) ||
      value.history.length > 8 ||
      value.history.some(
        (turn) =>
          !record(turn) ||
          typeof turn.question !== "string" ||
          turn.question.length > 2000 ||
          typeof turn.answer !== "string" ||
          turn.answer.length > 16000,
      ))
  )
    return undefined;
  return {
    question: value.question.trim(),
    tool: value.tool,
    locale: value.locale,
    ...(value.target
      ? {
          target: {
            kind: (value.target as DocsQaTarget).kind,
            path: (value.target as DocsQaTarget).path,
            locale: (value.target as DocsQaTarget).locale,
          },
        }
      : {}),
    ...(value.history
      ? {
          history: (value.history as NonNullable<DocsQaRequest["history"]>).map(
            ({ question, answer }) => ({ question, answer }),
          ),
        }
      : {}),
  };
}
