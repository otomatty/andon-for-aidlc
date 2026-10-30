import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BundledPlugin } from "@andon/shared-types";
import { afterEach, describe, expect, it } from "vitest";
import { pluginPackageSourceHash, pluginStoreRelative } from "../src/native-plugin-inputs.ts";
import { storePluginPackage } from "../src/plugin-store.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function write(root: string, relative: string, value: string) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "plugin-store-"));
  roots.push(root);
  const bundled = path.join(root, "extension", "dist", "plugins", "focus", "claude");
  await write(bundled, ".claude-plugin/plugin.json", JSON.stringify({ name: "focus", version: "0.1.0" }));
  await write(bundled, "stages/construction/focus-test.md", "# テスト先行\n");
  await write(bundled, "hooks/compose.ts", "export {};\n");
  const sourceHash = await pluginPackageSourceHash(bundled);
  const plugin = { name: "focus", version: "0.1.0", sourceHash, harness: "claude" } as BundledPlugin;
  return {
    root,
    bundles: path.join(root, "extension", "dist", "plugins"),
    store: path.join(root, "global", "plugins"),
    plugin,
  };
}

describe("storePluginPackage", () => {
  it("copies the bundled package into the store under its version and hash", async () => {
    const { bundles, store, plugin } = await setup();
    const stored = await storePluginPackage(bundles, store, plugin);
    expect(stored).toBe(
      path.join(store, pluginStoreRelative("focus", "0.1.0", plugin.sourceHash), "claude"),
    );
    expect(await readFile(path.join(stored, "stages/construction/focus-test.md"), "utf8")).toBe(
      "# テスト先行\n",
    );
    expect(await pluginPackageSourceHash(stored)).toBe(plugin.sourceHash);
    // A second install reuses what is there.
    expect(await storePluginPackage(bundles, store, plugin)).toBe(stored);
  });

  it("refuses a bundle whose bytes are not the ones the catalog describes", async () => {
    const { bundles, store, plugin } = await setup();
    await write(path.join(bundles, "focus", "claude"), "stages/construction/focus-test.md", "changed\n");
    await expect(storePluginPackage(bundles, store, plugin)).rejects.toThrow(/一致しません/);
  });

  it("replaces a stored copy that was changed after it was stored", async () => {
    const { bundles, store, plugin } = await setup();
    const stored = await storePluginPackage(bundles, store, plugin);
    await write(stored, "stages/construction/focus-test.md", "tampered\n");
    expect(await storePluginPackage(bundles, store, plugin)).toBe(stored);
    expect(await pluginPackageSourceHash(stored)).toBe(plugin.sourceHash);
  });

  it("refuses a bundle whose manifest names another plugin or version", async () => {
    const { bundles, store, plugin } = await setup();
    await write(
      path.join(bundles, "focus", "claude"),
      ".claude-plugin/plugin.json",
      JSON.stringify({ name: "focus", version: "0.2.0" }),
    );
    await expect(storePluginPackage(bundles, store, plugin)).rejects.toThrow(/0\.1\.0/);
  });

  it("explains a missing bundle", async () => {
    const { root, store, plugin } = await setup();
    await expect(storePluginPackage(path.join(root, "none"), store, plugin)).rejects.toThrow(
      /同梱/,
    );
  });
});
