import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { BundledPlugin } from "@andon/shared-types";
import { pluginPackageSourceHash, pluginStoreRelative } from "./native-plugin-inputs.ts";

/**
 * Copy a bundled plugin package out of the extension (`dist/plugins/<name>/<harness>`) into the
 * extension's global storage, and return where it now is. The install record pins the version
 * and source hash; the extension's own folder changes with every update, so the copy that a later
 * tool addition replays from must live outside it (docs/maintenance/plugins-page-design.md,
 * 「版をまたいだ保持」). The copy is checked against the catalog before anything uses it.
 */
export async function storePluginPackage(
  bundles: string,
  store: string,
  plugin: BundledPlugin,
): Promise<string> {
  const source = path.join(bundles, plugin.name, plugin.harness);
  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(
      await readFile(path.join(source, `.${plugin.harness}-plugin`, "plugin.json"), "utf8"),
    );
  } catch {
    throw new Error(`同梱の ${plugin.name} が見つかりません。拡張を入れ直してください。`);
  }
  // Since 2.11.1 a plugin AI-DLC does not ship is built under its own manifest name.
  if (manifest.name !== plugin.name || manifest.version !== plugin.version)
    throw new Error(
      `同梱の ${plugin.name} が ${plugin.version} ではありません。拡張を入れ直してください。`,
    );
  if ((await pluginPackageSourceHash(source)) !== plugin.sourceHash)
    throw new Error(
      `同梱の ${plugin.name} の中身がカタログと一致しません。拡張を入れ直してください。`,
    );

  const target = path.join(
    store,
    pluginStoreRelative(plugin.name, plugin.version, plugin.sourceHash),
    plugin.harness,
  );
  try {
    if ((await pluginPackageSourceHash(target)) === plugin.sourceHash) return target;
  } catch {
    /* Not stored yet. */
  }
  // Copy beside the target and swap it in, so a reader never sees half a package.
  const staging = `${target}.staging-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
    if ((await pluginPackageSourceHash(staging)) !== plugin.sourceHash)
      throw new Error(`${plugin.name} の写しが同梱物と一致しません。`);
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return target;
}
