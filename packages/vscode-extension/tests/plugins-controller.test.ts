import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BundledPlugin, PluginsHostMessage, PluginsState } from "@andon/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginPackageSourceHash } from "../src/native-plugin-inputs.ts";
import type { NativeInstall, ProcessResult, SetupRunner } from "../src/native-setup.ts";
import {
  createPluginsController,
  type PluginsControllerDeps,
} from "../src/plugins-controller.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
async function write(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
}
async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

type Fake = {
  /** What `plugin sync` does to the project; `"nothing"` stands for a silent compose. */
  sync: "compose" | "nothing" | { code: number; stdout: string; stderr?: string };
  /** Resolves when the runner is called for the step, for cancellation tests. */
  hang?: "sync";
  /** Exit codes for each `plugin select`, in order; the selection is written only on 0. */
  selectCodes?: number[];
  /** Runs once a `plugin select` has written its selection, before the runner returns. */
  afterSelect?: () => Promise<void>;
};

async function setup(fake: Fake = { sync: "compose" }, overrides: Partial<PluginsControllerDeps> = {}) {
  const base = await mkdtemp(path.join(tmpdir(), "plugins-controller-"));
  roots.push(base);
  const root = path.join(base, "project");
  const data = path.join(root, ".claude", "tools", "data");
  await write(path.join(data, "harness.json"), { name: "claude" });
  await write(path.join(data, "aidlc-stamp.json"), { frameworkVersion: "2.11.0" });
  await write(path.join(data, "stage-graph.json"), [{ slug: "requirements-analysis" }]);
  await write(path.join(data, "aidlc-manifest.json"), {
    files: { ".claude/tools/data/stage-graph.json": "sha256:old" },
  });
  const bundles = path.join(base, "extension", "dist", "plugins");
  const bundle = path.join(bundles, "focus", "claude");
  await write(path.join(bundle, ".claude-plugin", "plugin.json"), { name: "focus", version: "0.1.0" });
  await write(path.join(bundle, "stages", "construction", "focus-test.md"), "# テスト先行\n");
  await write(path.join(bundle, "hooks", "compose.ts"), "export {};\n");
  const plugin = {
    name: "focus",
    version: "0.1.0",
    sourceHash: await pluginPackageSourceHash(bundle),
    harness: "claude",
    startCommand: "/aidlc --scope focus-flow <チケット番号> <要約>",
  } as BundledPlugin;
  const install: NativeInstall = { executable: "/opt/aidlc/bin/aidlc", version: "2.11.0", binDir: "/opt/aidlc/bin" };
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
  let selects = 0;
  const runner = vi.fn<SetupRunner>(async (_command, args, _cwd, env, signal): Promise<ProcessResult> => {
    calls.push({ args, env });
    const verb = args[2];
    if (verb === "sync") {
      if (fake.hang === "sync") {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
        return { code: 1, stdout: "", stderr: "aborted", failure: "aborted" };
      }
      if (typeof fake.sync === "object") return { stderr: "", ...fake.sync };
      if (fake.sync === "compose") {
        await write(path.join(data, "plugin-compose-focus.json"), {
          schemaVersion: 1,
          name: "focus",
          version: "0.1.0",
          sourceHash: plugin.sourceHash,
        });
        await write(path.join(data, "stage-graph.json"), [
          { slug: "requirements-analysis" },
          { slug: "focus-test", plugin: "focus" },
        ]);
      }
      return { code: 0, stdout: '{"ok":true}', stderr: "" };
    }
    if (verb === "select") {
      const code = fake.selectCodes?.[selects++] ?? 0;
      if (code !== 0) return { code, stdout: "", stderr: "select failed" };
      const names = String(args[3]).split(",");
      await write(path.join(data, "harness.json"), { name: "claude", plugins: names });
      const graph = (await readJson(path.join(data, "stage-graph.json"))) as Array<{ plugin?: string }>;
      const hasStages = await readFile(path.join(data, "plugin-compose-focus.json")).then(
        () => fake.sync === "compose",
        () => false,
      );
      await write(
        path.join(data, "stage-graph.json"),
        names.includes("focus") && hasStages
          ? [{ slug: "requirements-analysis" }, { slug: "focus-test", plugin: "focus" }]
          : graph.filter((node) => node.plugin !== "focus"),
      );
      await fake.afterSelect?.();
      return { code: 0, stdout: "Enabled plugins: " + names.join(", "), stderr: "" };
    }
    return { code: 2, stdout: "", stderr: `unexpected ${args.join(" ")}` };
  });
  const messages: PluginsHostMessage[] = [];
  let snapshots = 0;
  const deps: PluginsControllerDeps = {
    root,
    bundles,
    store: path.join(base, "global", "plugins"),
    catalog: [plugin],
    post: (message) => messages.push(message),
    isTrusted: () => true,
    isOpen: () => true,
    gateOk: () => true,
    readInstall: () => install,
    runner,
    gitSnapshot: async () =>
      snapshots++ === 0
        ? new Map()
        : new Map([[".claude/tools/data/stage-graph.json", "x"], [".claude/agents/focus-builder-agent.md", "y"]]),
    copy: vi.fn(async () => {}),
    acquire: () => () => {},
    isBusy: () => false,
    ...overrides,
  };
  const controller = createPluginsController(deps);
  const lastState = (): PluginsState | undefined =>
    messages.flatMap((message) => (message.type === "plugins-state" ? [message.state] : [])).at(-1);
  const result = () => messages.find((message) => message.type === "plugins-result");
  return { root, data, plugin, install, calls, runner, messages, controller, deps, lastState, result };
}

describe("plugins controller", () => {
  it("answers the page with each plugin's state and what it needs", async () => {
    const { controller, lastState } = await setup();
    await controller.receive({ type: "plugins-get" });
    expect(lastState()).toMatchObject({
      plugins: [{ name: "focus", status: "not-installed" }],
      canAct: true,
      running: null,
    });
  });

  it("installs from the stored copy with the native CLI, then shows what changed", async () => {
    const { controller, calls, data, messages, result, lastState, deps } = await setup();
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });

    const sync = calls.find((call) => call.args[2] === "sync");
    expect(sync?.args).toEqual(["engine", "plugin", "sync", "--project-dir", deps.root, "--json"]);
    // From the extension's store, never from the extension folder an update replaces.
    expect(sync?.env?.AIDLC_PLUGIN_ROOT).toContain(path.join("global", "plugins", "focus"));
    expect(sync?.env?.AIDLC_HARNESS_DIR).toBe(".claude");
    expect(calls.find((call) => call.args[2] === "select")?.args.slice(0, 4)).toEqual([
      "engine",
      "plugin",
      "select",
      "aidlc,focus",
    ]);
    expect(
      messages.flatMap((message) => (message.type === "plugins-progress" ? [message.progress.step] : [])),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(result()).toEqual({
      type: "plugins-result",
      result: {
        outcome: "succeeded",
        action: "install",
        name: "focus",
        changedFiles: [".claude/agents/focus-builder-agent.md", ".claude/tools/data/stage-graph.json"],
        moreFiles: 0,
        commitMessage: "chore: AI-DLC プラグイン focus 0.1.0 を導入",
      },
    });
    expect(lastState()?.plugins[0]?.status).toBe("enabled");
    // The native install manifest follows the files the plugin commands rewrote.
    const manifest = (await readJson(path.join(data, "aidlc-manifest.json"))) as {
      files: Record<string, string>;
    };
    expect(manifest.files[".claude/tools/data/stage-graph.json"]).toBe(
      sha(await readFile(path.join(data, "stage-graph.json"), "utf8")),
    );
  });

  it("does not trust a compose that reports success but adds no stages, and undoes the selection", async () => {
    const { controller, calls, result, lastState } = await setup({ sync: "nothing" });
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(result()).toMatchObject({ result: { outcome: "failed", doctor: true } });
    const selects = calls.filter((call) => call.args[2] === "select").map((call) => call.args[3]);
    expect(selects).toEqual(["aidlc,focus", "aidlc"]);
    expect(lastState()?.plugins[0]?.status).toBe("not-installed");
  });

  it("reports the CLI's own message when a step fails", async () => {
    const { controller, calls, result } = await setup({
      sync: {
        code: 1,
        stdout: '{"ok":false,"message":"cannot sync focus: owned path changed since composition: x.md"}',
      },
    });
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(result()).toMatchObject({
      result: { outcome: "failed", message: expect.stringContaining("owned path changed") },
    });
    expect(calls.some((call) => call.args[2] === "select")).toBe(false);
  });

  it("stops the running CLI when the reader cancels", async () => {
    const { controller, result } = await setup({ sync: "compose", hang: "sync" });
    const running = controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    await vi.waitFor(() => expect(controller.running()).not.toBeNull());
    await controller.receive({ type: "plugins-cancel" });
    await running;
    expect(result()).toMatchObject({ result: { outcome: "cancelled", action: "install" } });
    expect(controller.running()).toBeNull();
  });

  it("puts the selection back when the reader cancels after it changed", async () => {
    const fake: Fake = { sync: "compose" };
    const { controller, calls, result, lastState, messages } = await setup(fake);
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    calls.length = 0;
    messages.length = 0;
    fake.afterSelect = async () => {
      fake.afterSelect = undefined;
      await controller.receive({ type: "plugins-cancel" });
    };
    await controller.receive({ type: "plugins-action", action: "disable", name: "focus" });
    expect(result()).toMatchObject({ result: { outcome: "cancelled", action: "disable" } });
    const selects = calls.filter((call) => call.args[2] === "select").map((call) => call.args[3]);
    expect(selects).toEqual(["aidlc", "aidlc,focus"]);
    expect(lastState()?.plugins[0]?.status).toBe("enabled");
  });

  it("puts the selection back when a later step fails", async () => {
    const { controller, calls, data, result, lastState, messages } = await setup();
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    calls.length = 0;
    messages.length = 0;
    await writeFile(path.join(data, "aidlc-manifest.json"), "{ not json");
    await controller.receive({ type: "plugins-action", action: "disable", name: "focus" });
    expect(result()).toMatchObject({ result: { outcome: "failed", doctor: true } });
    expect(result()).not.toMatchObject({ result: { message: expect.stringContaining("元に戻せません") } });
    const selects = calls.filter((call) => call.args[2] === "select").map((call) => call.args[3]);
    expect(selects).toEqual(["aidlc", "aidlc,focus"]);
    expect(lastState()?.plugins[0]?.status).toBe("enabled");
  });

  it("sends the reader to Doctor when the selection cannot be put back", async () => {
    const { controller, calls, result } = await setup({ sync: "nothing", selectCodes: [0, 1] });
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(result()).toMatchObject({
      result: { outcome: "failed", doctor: true, message: expect.stringContaining("元に戻せません") },
    });
    expect(calls.filter((call) => call.args[2] === "select")).toHaveLength(2);
  });

  it("runs nothing while a required prerequisite is unmet", async () => {
    const { controller, runner, result } = await setup({ sync: "compose" }, { isTrusted: () => false });
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(runner).not.toHaveBeenCalled();
    expect(result()).toMatchObject({ result: { outcome: "failed", doctor: false } });
  });

  it("runs nothing once the project's folder is no longer open", async () => {
    const { controller, runner, result } = await setup({ sync: "compose" }, { isOpen: () => false });
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(runner).not.toHaveBeenCalled();
    expect(result()).toMatchObject({
      result: { outcome: "failed", message: expect.stringContaining("開き直して") },
    });
  });

  it("runs nothing when another tool in the project also uses AI-DLC", async () => {
    const { controller, root, runner, result } = await setup();
    await mkdir(path.join(root, ".cursor", "skills", "aidlc"), { recursive: true });
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(runner).not.toHaveBeenCalled();
    expect(result()).toMatchObject({
      result: { outcome: "failed", message: expect.stringContaining("Claude Code だけ") },
    });
  });

  it("runs nothing while another install or update holds the operation", async () => {
    const { controller, runner, result } = await setup({ sync: "compose" }, { acquire: () => null });
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    expect(runner).not.toHaveBeenCalled();
    expect(result()).toMatchObject({ result: { outcome: "failed" } });
  });

  it("refuses an action the plugin's state does not allow", async () => {
    const { controller, runner, result } = await setup();
    await controller.receive({ type: "plugins-action", action: "disable", name: "focus" });
    expect(runner).not.toHaveBeenCalled();
    expect(result()).toMatchObject({ result: { outcome: "failed" } });
  });

  it("disables and enables with the selection alone", async () => {
    const { controller, calls, lastState, messages } = await setup();
    await controller.receive({ type: "plugins-action", action: "install", name: "focus" });
    calls.length = 0;
    messages.length = 0;
    await controller.receive({ type: "plugins-action", action: "disable", name: "focus" });
    expect(calls.map((call) => call.args.slice(2, 4))).toEqual([["select", "aidlc"]]);
    expect(lastState()?.plugins[0]?.status).toBe("disabled");
    calls.length = 0;
    await controller.receive({ type: "plugins-action", action: "enable", name: "focus" });
    expect(calls.map((call) => call.args.slice(2, 4))).toEqual([["select", "aidlc,focus"]]);
    expect(lastState()?.plugins[0]?.status).toBe("enabled");
  });

  it("copies the command that starts the plugin's workflow", async () => {
    const { controller, deps } = await setup();
    await controller.receive({ type: "plugins-copy-start", name: "focus" });
    expect(deps.copy).toHaveBeenCalledWith("/aidlc --scope focus-flow <チケット番号> <要約>");
  });

  it("ignores messages that are not its own or not well formed", async () => {
    const { controller, messages, runner } = await setup();
    await controller.receive({ type: "plugins-action", action: "install", name: "../focus" });
    await controller.receive({ type: "plugins-action", action: "install", name: "other" });
    await controller.receive("plugins-get");
    expect(runner).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
  });
});
