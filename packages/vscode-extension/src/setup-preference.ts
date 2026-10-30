import type { DocsQaTool } from "@andon/shared-types";
import type { ExtensionContext } from "vscode";
import { detectHarnesses, type HarnessId } from "./harness-detect.ts";

export type SetupPreference = {
  completed: boolean;
  docsSkipped: boolean;
  harness: HarnessId;
  /** Older preferences retain the single harness field. */
  harnesses?: HarnessId[];
};

export const setupStateKey = (root: string): string => `andon.setup.v2:${root}`;

const CHAT_TOOLS: readonly DocsQaTool[] = ["claude", "cursor", "copilot"];

/**
 * The AI chat's tools: those chosen in Setup, plus any added to the project
 * since — the same set Setup shows as selected. Before any choice is known,
 * every tool the chat supports.
 */
export function chatTools(context: ExtensionContext, root: string): DocsQaTool[] {
  const preference = context.workspaceState.get<SetupPreference>(setupStateKey(root));
  const chosen = new Set<string>([
    ...(preference?.harnesses ?? (preference?.harness ? [preference.harness] : [])),
    ...detectHarnesses(root).harnesses.map((harness) => harness.id),
  ]);
  if (chosen.size === 0) return [...CHAT_TOOLS];
  return CHAT_TOOLS.filter((tool) => chosen.has(tool));
}
