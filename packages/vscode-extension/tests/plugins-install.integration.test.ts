import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPathSync } from "@andon/core-utils";
import { BUNDLED_PLUGINS, type PluginsHostMessage } from "@andon/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundlePlugins } from "../../../scripts/build-bundled-plugins.ts";
import { runSetupProcess, type SetupRunner } from "../src/native-setup.ts";
import { createPluginsController } from "../src/plugins-controller.ts";

/**
 * The real thing, short of the native binary: the bundled focus, built by the engine's builder,
 * installed into a copy of this repository's Claude Code tree by the in-repo engine, which the
 * native `aidlc` embeds. The fake runner in plugins-controller.test.ts covers the edges; this
 * shows the engine composes what the page promises.
 */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const focus = BUNDLED_PLUGINS.plugins.find((plugin) => plugin.name === "focus");

let work: string;
let bundles: string;
beforeAll(async () => {
  // The engine refuses paths outside the project as it resolves them; see build-bundled-plugins.
  work = canonicalPathSync(mkdtempSync(path.join(tmpdir(), "plugins-install-")));
  bundles = path.join(work, "bundles");
  await bundlePlugins(repo, path.join(work, "build"), bundles);
}, 120_000);
afterAll(() => rmSync(work, { recursive: true, force: true }));

function project(name: string): string {
  const root = path.join(work, name);
  const tracked = spawnSync("git", ["ls-files", "-z", ".claude"], { cwd: repo, encoding: "utf8" })
    .stdout.split("\0")
    .filter(Boolean);
  for (const file of tracked) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(repo, file), path.join(root, file));
  }
  return root;
}

/**
 * The project's in-repo dispatcher stands in for the native binary's `aidlc engine …`. With
 * `hideGraphDuringSync`, the project's `aidlc-graph.ts` is away while the plugin is composed: the
 * compose hook then returns without a word and `plugin sync` still succeeds, as it does in a
 * native project that lacks the file.
 */
function engine(root: string, hideGraphDuringSync = false): SetupRunner {
  const dispatcher = path.join(root, ".claude", "tools", "aidlc.ts");
  const graph = path.join(root, ".claude", "tools", "aidlc-graph.ts");
  return async (_command, args, cwd, env, signal) => {
    const hide = hideGraphDuringSync && args[2] === "sync";
    if (hide) renameSync(graph, `${graph}.away`);
    try {
      return await runSetupProcess("bun", [dispatcher, ...args], cwd, env, signal);
    } finally {
      if (hide) renameSync(`${graph}.away`, graph);
    }
  };
}

function controller(root: string, runner: SetupRunner = engine(root)) {
  const messages: PluginsHostMessage[] = [];
  const instance = createPluginsController({
    root,
    bundles,
    store: path.join(work, `${path.basename(root)}-store`),
    catalog: BUNDLED_PLUGINS.plugins,
    post: (message) => messages.push(message),
    isTrusted: () => true,
    isOpen: () => true,
    gateOk: () => true,
    readInstall: () => ({ executable: "aidlc", version: "2.11.0", binDir: path.join(work, "bin") }),
    copy: async () => {},
    runner,
    gitSnapshot: async () => null,
    acquire: () => () => {},
    isBusy: () => false,
  });
  const result = () =>
    messages.flatMap((message) => (message.type === "plugins-result" ? [message.result] : [])).at(-1);
  const status = () =>
    messages
      .flatMap((message) => (message.type === "plugins-state" ? [message.state] : []))
      .at(-1)
      ?.plugins.find((plugin) => plugin.name === "focus")?.status;
  return { instance, result, status };
}

describe.skipIf(focus === undefined)("installing focus with the engine", () => {
  it("installs, disables and enables focus, and each time the stages follow", async () => {
    const root = project("project");
    const { instance, result, status } = controller(root);
    await instance.receive({ type: "plugins-get" });
    expect(status()).toBe("not-installed");

    await instance.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(result()).toMatchObject({ outcome: "succeeded", action: "install" });
    expect(status()).toBe("enabled");

    await instance.receive({ type: "plugins-action", action: "disable", name: "focus" });
    expect(result()).toMatchObject({ outcome: "succeeded", action: "disable" });
    expect(status()).toBe("disabled");

    await instance.receive({ type: "plugins-action", action: "enable", name: "focus" });
    expect(result()).toMatchObject({ outcome: "succeeded", action: "enable" });
    expect(status()).toBe("enabled");
  }, 120_000);

  it("fails, and says what to run, when the engine composes nothing", async () => {
    // Without aidlc-graph.ts the compose hook returns without a word. Since 2.11.1 `plugin sync`
    // notices and fails itself; the controller's own graph check stays as the backstop.
    const root = project("no-graph");
    const { instance, result, status } = controller(root, engine(root, true));
    await instance.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(result()).toMatchObject({ outcome: "failed", action: "install" });
    expect(result()).toMatchObject({ message: expect.stringContaining("focus is not composed") });
    expect(status()).not.toBe("enabled");
  }, 120_000);
});
