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
 * The AI chat's tools: the same set Setup shows as selected — the tools
 * configured in the project, or the saved choice while none is. Before any
 * choice is known, every tool the chat supports.
 */
export function chatTools(context: ExtensionContext, root: string): DocsQaTool[] {
  const detected = detectHarnesses(root).harnesses.map((harness) => harness.id);
  const preference = context.workspaceState.get<SetupPreference>(setupStateKey(root));
  const saved = preference?.harnesses ?? (preference?.harness ? [preference.harness] : []);
  const chosen = new Set<string>(detected.length > 0 ? detected : saved);
  if (chosen.size === 0) return [...CHAT_TOOLS];
  return CHAT_TOOLS.filter((tool) => chosen.has(tool));
}
