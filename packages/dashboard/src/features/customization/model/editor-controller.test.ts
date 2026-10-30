import type { CustomizationCatalog, CustomizationItem } from "@andon/shared-types";
import { expect, it, vi } from "vitest";
import { EditorController } from "@/features/customization/model/editor-controller";

const item: CustomizationItem = {
  id: "rule",
  title: "Rules",
  kind: "rule-section",
  owner: "project",
  content: "original",
  target: { layer: "project", heading: "Rules" },
};
const catalog: CustomizationCatalog = {
  workspaceName: "fixture",
  spaceId: "default",
  spaces: ["default"],
  engineVersion: "2.8.2",
  configurationRevision: "config-1",
  capabilities: {
    available: true,
    engineVersion: "2.8.2",
    protocolVersion: 1,
    canApply: true,
    canExportPlugin: true,
    canRecover: true,
  },
  items: [item],
  diagnostics: [],
};
it("buffers edits until the page submits them and loses unsaved input in a new editor", async () => {
  const api = { catalog: vi.fn(async () => structuredClone(catalog)), save: vi.fn() };
  const editor = new EditorController(api);
  await editor.load();
  editor.edit({ ...item, content: "local" });
  expect(api.save).not.toHaveBeenCalled();
  expect(editor.request()).toMatchObject({
    expectedConfigurationRevision: "config-1",
    changes: [{ operation: "replace", item: { content: "local" } }],
  });
  const reopened = new EditorController(api);
  await reopened.load();
  expect(reopened.getSnapshot().items[0]?.content).toBe("original");
});
it("rebases edits made during a save onto its new revision, including additions and deletions", async () => {
  let remote = catalog;
  const editor = new EditorController({ catalog: async () => remote });
  await editor.load();
  editor.edit({ ...item, content: "sent" });
  const sent = editor.getSnapshot().items;
  editor.edit({ ...item, content: "typed while saving" });
  editor.edit({ ...item, id: "new", content: "added" });
  remote = { ...catalog, configurationRevision: "config-2", items: sent };
  await editor.acceptSaved(sent, "default");
  expect(editor.request()).toMatchObject({
    expectedConfigurationRevision: "config-2",
    changes: [
      { operation: "replace", item: { id: "rule", content: "typed while saving" } },
      { operation: "create", item: { id: "new" } },
    ],
  });
  const next = editor.getSnapshot().items;
  editor.remove("new");
  remote = { ...remote, configurationRevision: "config-3", items: next };
  await editor.acceptSaved(next, "default");
  expect(editor.request().changes).toEqual([{ operation: "remove", itemId: "new" }]);
});
it("returns to a clean state when an edit is undone or an unsaved creation is removed", async () => {
  const editor = new EditorController({ catalog: async () => catalog });
  await editor.load();
  editor.edit({ ...item, content: "local" });
  editor.edit(item);
  expect(editor.getSnapshot().dirtyIds).toEqual([]);
  editor.edit({ ...item, id: "new" });
  editor.remove("new");
  expect(editor.request().changes).toEqual([]);
});
it("preserves input on a remote update and rebases only explicitly chosen edits", async () => {
  let remote = catalog;
  const editor = new EditorController({ catalog: async () => remote });
  await editor.load();
  editor.edit({ ...item, content: "local" });
  remote = {
    ...catalog,
    configurationRevision: "config-2",
    items: [
      { ...item, content: "remote" },
      { ...item, id: "other" },
    ],
  };
  await editor.refresh();
  expect(editor.getSnapshot().items[0]?.content).toBe("local");
  expect(() => editor.request()).toThrow("比較");
  editor.resolveConflict(new Set([item.id]));
  expect(editor.request()).toMatchObject({
    expectedConfigurationRevision: "config-2",
    changes: [{ operation: "replace", item: { content: "local" } }],
  });
  expect(editor.getSnapshot().items.find((value) => value.id === "other")).toBeTruthy();
});
it("ignores a stale refresh that arrives after the user starts typing", async () => {
  let resolve: (value: CustomizationCatalog) => void = () => {};
  const api = { catalog: vi.fn(async () => catalog) };
  const editor = new EditorController(api);
  await editor.load();
  api.catalog.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const refresh = editor.refresh();
  editor.edit({ ...item, content: "local" });
  resolve({ ...catalog, configurationRevision: "new" });
  await refresh;
  expect(editor.getSnapshot().items[0]?.content).toBe("local");
});
