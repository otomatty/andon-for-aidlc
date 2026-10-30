import type { CustomizationItem } from "@andon/shared-types";
import descriptions from "@/data/scope-descriptions.ja.json";
import { sourceBody } from "./source-fields";

/** A translation belongs to its exact source, not just a familiar scope name. */
export function japaneseScopeDescription(item: CustomizationItem): string | null {
  if (item.owner !== "core") return null;
  const entry = (descriptions as Record<string, { source: string; markdown: string }>)[
    item.runtimeId ?? ""
  ];
  const body = sourceBody(item.content).replaceAll("\r\n", "\n").trim();
  return entry?.source === body ? entry.markdown : null;
}
