import type {
  CustomizationChange,
  CustomizationEditRequest,
  CustomizationItem,
} from "@andon/shared-types";
import type { CustomizationApi } from "@/services/customization";
import { itemChanges } from "@/features/customization/components/Diagnostics";
import type { EditorView } from "@/features/customization/types.ts";

export type { EditorView };

/** Buffers input while the page serializes automatic saves. */
export class EditorController {
  private view: EditorView = {
    catalog: null,
    items: [],
    status: "loading",
    error: null,
    dirtyIds: [],
    remote: null,
  };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  constructor(private readonly api: Pick<CustomizationApi, "catalog">) {}
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<EditorView>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch };
    this.view.dirtyIds = itemChanges(this.view.catalog?.items ?? [], this.view.items);
    for (const listener of this.listeners) listener();
  }
  async load(space?: string) {
    const generation = ++this.generation;
    try {
      const catalog = await this.api.catalog(space ?? this.view.catalog?.spaceId);
      if (generation !== this.generation || this.disposed) return;
      this.publish({ catalog, items: catalog.items, status: "saved", remote: null, error: null });
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.publish({
        status: "error",
        error: error instanceof Error ? error.message : "設定を読み込めません。",
      });
      throw error;
    }
  }
  setItems(items: CustomizationItem[]) {
    if (!this.view.catalog) return;
    this.generation++;
    const dirty = itemChanges(this.view.catalog.items, items).length > 0;
    this.publish({
      items,
      status: this.view.remote ? "conflict" : dirty ? "dirty" : "saved",
      error: null,
    });
  }
  edit(item: CustomizationItem) {
    const items = new Map(this.view.items.map((value) => [value.id, value]));
    items.set(item.id, item);
    this.setItems([...items.values()]);
  }
  remove(id: string) {
    this.setItems(this.view.items.filter((item) => item.id !== id));
  }
  async acceptSaved(sentItems: CustomizationItem[], space: string) {
    const catalog = await this.api.catalog(space);
    if (this.disposed || this.view.catalog?.spaceId !== space) return;
    // Preserve edits made during the request, including additions and deletions.
    const items = new Map(catalog.items.map((item) => [item.id, item]));
    for (const id of itemChanges(sentItems, this.view.items)) {
      const local = this.view.items.find((item) => item.id === id);
      if (local) items.set(id, local);
      else items.delete(id);
    }
    this.generation++;
    const next = [...items.values()];
    this.publish({
      catalog,
      items: next,
      remote: null,
      error: null,
      status: itemChanges(catalog.items, next).length ? "dirty" : "saved",
    });
  }
  request(): CustomizationEditRequest {
    const catalog = this.view.catalog;
    if (!catalog) throw new Error("設定を読み込んでから編集してください。");
    if (this.view.remote) throw new Error("現在の設定と比較してから保存してください。");
    const changes: CustomizationChange[] = this.view.dirtyIds.map((id) => {
      const item = this.view.items.find((value) => value.id === id);
      return item
        ? { operation: catalog.items.some((value) => value.id === id) ? "replace" : "create", item }
        : { operation: "remove", itemId: id };
    });
    return {
      spaceId: catalog.spaceId,
      expectedConfigurationRevision: catalog.configurationRevision,
      changes,
    };
  }
  async refresh() {
    if (!this.view.catalog) return;
    const generation = this.generation;
    const catalog = await this.api.catalog(this.view.catalog.spaceId);
    if (generation !== this.generation || this.disposed) return;
    if (catalog.configurationRevision === this.view.catalog.configurationRevision) return;
    if (this.view.dirtyIds.length) this.publish({ remote: catalog, status: "conflict" });
    else
      this.publish({ catalog, items: catalog.items, remote: null, status: "saved", error: null });
  }
  resolveConflict(keepIds: Set<string>) {
    const catalog = this.view.remote;
    if (!catalog) return;
    const items = new Map(catalog.items.map((item) => [item.id, item]));
    for (const id of this.view.dirtyIds) {
      if (!keepIds.has(id)) continue;
      const local = this.view.items.find((item) => item.id === id);
      if (local) items.set(id, local);
      else items.delete(id);
    }
    this.generation++;
    this.publish({ catalog, remote: null, items: [...items.values()], error: null });
    this.publish({ status: this.view.dirtyIds.length ? "dirty" : "saved" });
  }
  activate() {
    this.disposed = false;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.listeners.clear();
  }
}
