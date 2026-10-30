import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalPath,
  HARNESS_LABELS,
  type HarnessId,
  isSwitchableSpaceName,
  readNativeInstall,
  readNativeProjections,
} from "@andon/reader-core";
import type { SpaceCatalog } from "@andon/shared-types";

export interface SpaceEngine {
  harnesses(): Promise<SpaceCatalog["harnesses"]>;
  switch(space: string, harness: string): Promise<void>;
}

const HARNESSES: ReadonlyArray<{ id: string; distributions: HarnessId[] }> = [
  { id: ".cursor", distributions: ["cursor"] },
  { id: ".claude", distributions: ["claude"] },
  { id: ".codex", distributions: ["codex"] },
  { id: ".kiro", distributions: ["kiro", "kiro-ide"] },
  { id: ".aidlc", distributions: ["copilot", "opencode"] },
];

/** The official utility owns cursors, session bindings, and native rule includes. */
export function createSpaceEngine(root: string): SpaceEngine {
  const safeFile = async (relative: string): Promise<string | null> => {
    let current = await canonicalPath(root);
    try {
      for (const part of relative.split("/")) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink()) return null;
      }
      return (await lstat(current)).isFile() ? current : null;
    } catch {
      return null;
    }
  };

  const commandFor = async (id: string) => {
    const harness = HARNESSES.find((item) => item.id === id);
    if (!harness) return null;
    const workspace = await canonicalPath(root);
    const stamp = `${id}/tools/data/aidlc-stamp.json`;
    // Stamped installations run the registered native engine, including the project pin.
    // Never silently run project scripts when a stamped install is incomplete.
    const projection = readNativeProjections(workspace).find(
      (item) => item.sourcePath === path.join(workspace, stamp),
    );
    if (
      await lstat(path.join(workspace, stamp)).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      )
    ) {
      if (!projection || !(await safeFile(stamp)) || JSON.parse(projection.raw).harnessDir !== id)
        return null;
      const distribution = harness.distributions.find((name) => name === projection.harness);
      const install = readNativeInstall(workspace);
      if (!distribution || !install || install.version !== projection.version) return null;
      return {
        id,
        distribution,
        label: HARNESS_LABELS[distribution],
        executable: install.executable,
        prefix: ["engine"],
        binDir: install.binDir,
      };
    }

    const script = await safeFile(`${id}/tools/aidlc-utility.ts`);
    if (!script) return null;
    const metadata = await safeFile(`${id}/tools/data/harness.json`);
    let distribution = harness.distributions.length === 1 ? harness.distributions[0] : undefined;
    if (metadata) {
      try {
        const value = JSON.parse(await readFile(metadata, "utf8"));
        if (
          value?.harnessDir !== id ||
          (value.schemaVersion !== undefined && value.schemaVersion !== 1)
        )
          return null;
        distribution = harness.distributions.find(
          (name) => name === (value.distribution ?? value.name),
        );
      } catch {
        return null;
      }
    }
    // Shared directories cannot identify their product without metadata.
    if (!distribution) return null;
    return {
      id,
      distribution,
      label: HARNESS_LABELS[distribution],
      executable: "bun",
      prefix: [script],
      binDir: null,
    };
  };

  return {
    async harnesses() {
      const found = await Promise.all(HARNESSES.map((item) => commandFor(item.id)));
      return found.filter((item) => item !== null).map(({ id, label }) => ({ id, label }));
    },
    async switch(space, harness) {
      if (!isSwitchableSpaceName(space)) throw new Error("切り替え先の Space 名が不正です。");
      const command = await commandFor(harness);
      if (!command)
        throw new Error(
          "選択したツールのAI-DLC本体を読み込めません。導入状態と固定バージョンを確認してください。",
        );
      const workspace = await canonicalPath(root);
      // A GUI action belongs to Guide, never to an inherited terminal/chat session.
      const session = `andon-for-aidlc-${createHash("sha256").update(workspace).digest("hex").slice(0, 24)}`;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        AIDLC_PROJECT_DIR: workspace,
        AIDLC_HARNESS_DIR: harness,
        AIDLC_HARNESS_NAME: command.distribution,
        AIDLC_SESSION_OVERRIDE: session,
        AIDLC_SESSION_OVERRIDE_SOURCE: "payload",
      };
      if (command.binDir) {
        const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
        env[pathKey] = `${command.binDir}${path.delimiter}${env[pathKey] ?? ""}`;
      }
      await new Promise<void>((resolve, reject) => {
        execFile(
          command.executable,
          [...command.prefix, "space", "switch", space, "--project-dir", workspace],
          {
            cwd: workspace,
            windowsHide: true,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
            env,
          },
          (error) =>
            error
              ? reject(
                  new Error(
                    "スペースを切り替えられませんでした。AI-DLC本体の導入状態と実行権限を確認して再試行してください。",
                    { cause: error },
                  ),
                )
              : resolve(),
        );
      });
    },
  };
}
