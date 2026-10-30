import type { CustomizationCatalog, CustomizationItem } from "@andon/shared-types";
import type { Category } from "./utils/source-fields";

export type { Category };

export interface EditorView {
  catalog: CustomizationCatalog | null;
  items: CustomizationItem[];
  status: "loading" | "saved" | "dirty" | "error" | "conflict";
  error: string | null;
  dirtyIds: string[];
  remote: CustomizationCatalog | null;
}

export type ExportSelection = {
  format: "guide" | "plugin";
  itemIds: string[];
  name: string;
  version: string;
  excludeUnsupported: boolean;
  harnesses: string[];
};
