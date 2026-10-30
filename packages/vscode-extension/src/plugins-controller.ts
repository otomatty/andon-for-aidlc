import { access } from "node:fs/promises";
import path from "node:path";
import {
  type BundledPlugin,
  CHANGED_FILES_SHOWN,
  type PluginAction,
  type PluginOperation,
  type PluginResult,
  type PluginsHostMessage,
  type PluginsState,
  parsePluginsPanelMessage,
} from "@andon/shared-types";
import { detectHarnesses } from "./harness-detect.ts";
import { nativePluginEnv, refreshNativeManifest } from "./native-plugin-inputs.ts";
import {
  type NativeInstall,
  nativeCommandEnv,
  runSetupProcess,
  type SetupRunner,
} from "./native-setup.ts";
import { storePluginPackage } from "./plugin-store.ts";
import {
  canAct,
  hasAtlassianMcp,
  pluginPrerequisites,
  pluginStatuses,
  type ProjectPluginFacts,
  readProjectPluginFacts,
  unfinishedWorkflows,
} from "./plugins-state.ts";
import { changedSince, type GitStatus, gitStatusSnapshot } from "./shared-file-changes.ts";
import { acquireWorkflowsOperation, workflowsOperationRunning } from "./workflows-operation.ts";

/**
 * The extension side of the 「プラグイン」 page: it answers the page with each bundled plugin's
 * state, and installs, enables, disables or updates one with the native `aidlc` CLI
 * (docs/maintenance/plugins-page-design.md, 「導入の流れ」). The project root is the host's own,
 * never one a message names, and every action re-checks what it needs before it runs.
 */

export interface PluginsControllerDeps {
  root: string;
  /** The bundled plugin packages: `<extension>/dist/plugins`. */
  bundles: string;
  /** The extension's own copies of installed packages: `<globalStorage>/plugins`. */
  store: string;
  catalog: readonly BundledPlugin[];
  post: (message: PluginsHostMessage) => void;
  isTrusted: () => boolean;
  /** The project's folder is still open in this window; a stale page must not act on it. */
  isOpen: () => boolean;
  /** The version check reads `ok`. */
  gateOk: () => boolean;
  readInstall: () => NativeInstall | null;
  copy: (text: string) => Promise<void>;
  runner?: SetupRunner;
  gitSnapshot?: (root: string, signal?: AbortSignal) => Promise<GitStatus | null>;
  /** Serialize with every other install and update in this extension host. */
  acquire?: (root: string) => (() => void) | null;
  isBusy?: () => boolean;
}

export interface PluginsController {
  receive: (raw: unknown) => Promise<void>;
  /** Post the state again, if the page has asked for it before. */
  refresh: () => Promise<void>;
  running: () => PluginOperation | null;
  dispose: () => void;
}

const HARNESS = "claude" as const;

class StepError extends Error {
  constructor(
    message: string,
    readonly doctor = false,
  ) {
    super(message);
  }
}

/** The message a native command failed with: its JSON `message`, else what it printed. */
function failureMessage(stdout: string, stderr: string): string {
  try {
    const parsed = JSON.parse(stdout) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message !== "") return parsed.message;
  } catch {
    /* Not JSON. */
  }
  const text = (stderr || stdout).trim();
  return text === "" ? "AI-DLC のコマンドが失敗しました。" : text.slice(0, 2000);
}

/** The plugins every composed record enables when the project keeps no selection list. */
function effectiveSelection(facts: ProjectPluginFacts): string[] {
  return facts.selected ?? ["aidlc", ...facts.records.keys()];
}

function selection(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

const ALLOWED: Record<PluginAction, ReadonlySet<string>> = {
  install: new Set(["not-installed"]),
  update: new Set(["update-available", "attention"]),
  enable: new Set(["disabled"]),
  disable: new Set(["enabled"]),
};

const VERB: Record<PluginAction, string> = {
  install: "導入",
  update: "更新",
  enable: "有効化",
  disable: "無効化",
};

export function createPluginsController(deps: PluginsControllerDeps): PluginsController {
  const runner = deps.runner ?? runSetupProcess;
  const gitSnapshot = deps.gitSnapshot ?? gitStatusSnapshot;
  const acquire = deps.acquire ?? acquireWorkflowsOperation;
  const isBusy = deps.isBusy ?? workflowsOperationRunning;
  let running: PluginOperation | null = null;
  let abort: AbortController | null = null;
  let asked = false;

  const exists = async (relative: string) =>
    access(path.join(deps.root, relative)).then(
      () => true,
      () => false,
    );

  const readState = async (): Promise<PluginsState> => {
    const facts = await readProjectPluginFacts(deps.root);
    const prerequisites = pluginPrerequisites({
      trusted: deps.isTrusted(),
      gateOk: deps.gateOk(),
      claude: await exists(".claude/tools/data/harness.json"),
      others: detectHarnesses(deps.root)
        .harnesses.filter(({ id }) => id !== HARNESS)
        .map(({ label }) => label),
      native: await exists(".claude/tools/data/aidlc-stamp.json"),
      unfinished: await unfinishedWorkflows(deps.root),
      busy: running === null && isBusy(),
      atlassian: await hasAtlassianMcp(deps.root),
    });
    return {
      plugins: pluginStatuses(deps.catalog, facts),
      prerequisites,
      canAct: canAct(prerequisites, running),
      running,
    };
  };

  const postState = async () => {
    deps.post({ type: "plugins-state", state: await readState() });
  };

  const perform = async (
    operation: PluginOperation,
    plugin: BundledPlugin,
    signal: AbortSignal,
  ): Promise<PluginResult> => {
    const { action } = operation;
    const writes = action === "install" || action === "update";
    const total = writes ? 5 : 3;
    let step = 0;
    const progress = (text: string) => {
      signal.throwIfAborted();
      step += 1;
      deps.post({ type: "plugins-progress", progress: { ...operation, step, total, text } });
    };

    progress("必要なものを確かめています");
    const install = deps.readInstall();
    if (install === null)
      throw new StepError("このパソコンの aidlc が見つかりません。セットアップを開いてください。");
    const env = nativePluginEnv(HARNESS, nativeCommandEnv(install));
    const cli = async (args: string[], extra: NodeJS.ProcessEnv = {}) => {
      signal.throwIfAborted();
      const result = await runner(
        install.executable,
        ["engine", ...args],
        deps.root,
        {
          ...env,
          ...extra,
        },
        signal,
      );
      signal.throwIfAborted();
      if (result.code !== 0) throw new StepError(failureMessage(result.stdout, result.stderr));
    };
    const select = (names: string[]) =>
      cli(["plugin", "select", names.join(","), "--project-dir", deps.root]);

    const before = await gitSnapshot(deps.root, signal);
    const initial = await readProjectPluginFacts(deps.root);
    const previous = selection(effectiveSelection(initial));
    const wasEnabled = initial.selected === null || initial.selected.includes(plugin.name);

    if (writes) {
      progress("プラグインの元パッケージを用意しています");
      const stored = await storePluginPackage(deps.bundles, deps.store, plugin);
      progress("AI-DLC に組み込んでいます");
      await cli(["plugin", "sync", "--project-dir", deps.root, "--json"], {
        AIDLC_PLUGIN_ROOT: stored,
      });
    }

    let selected: string[] | null = null;
    const composed = await readProjectPluginFacts(deps.root);
    if (action === "install" || action === "enable") {
      progress("プラグインを有効にしています");
      selected = selection([...effectiveSelection(composed), plugin.name]);
    } else if (action === "disable") {
      progress("プラグインを無効にしています");
      selected = selection(effectiveSelection(composed).filter((name) => name !== plugin.name));
    } else progress("プラグインの選択はそのままにします");
    // Once `plugin select` has started, the project's selection may have changed: whatever stops
    // the operation after that (a failed check, an error, the reader cancelling) puts it back.
    const restore = async (): Promise<boolean> => {
      try {
        const undo = await runner(
          install.executable,
          ["engine", "plugin", "select", previous.join(","), "--project-dir", deps.root],
          deps.root,
          env,
        );
        if (undo.code !== 0) return false;
      } catch {
        return false;
      }
      // The selection is back; a manifest that cannot be refreshed is the error already reported.
      await refreshNativeManifest(deps.root, HARNESS, { required: false }).catch(() => {});
      return true;
    };
    try {
      if (selected !== null) await select(selected);
      await refreshNativeManifest(deps.root, HARNESS, { required: false });

      progress("組み込めたかを確かめています");
      const expectEnabled = selected === null ? wasEnabled : selected.includes(plugin.name);
      const after = await readProjectPluginFacts(deps.root);
      const record = after.records.get(plugin.name);
      const problem =
        record === undefined || record === "unreadable"
          ? "導入の記録が見つかりません。"
          : record.version !== plugin.version || record.sourceHash !== plugin.sourceHash
            ? "導入の記録が同梱のプラグインと一致しません。"
            : after.retry.has(plugin.name)
              ? "組み込みが途中で止まりました。"
              : expectEnabled && !after.graphPlugins.has(plugin.name)
                ? "ステージの構成にプラグインのステージがありません。組み込みが行われていません。"
                : // The engine keeps every composed stage in the graph and filters by selection.
                  !expectEnabled &&
                    (after.selected === null || after.selected.includes(plugin.name))
                  ? "プラグインの選択から外れていません。"
                  : null;
      if (problem !== null)
        throw new StepError(`${problem}Doctor で状態を確かめてください。`, true);
    } catch (error) {
      if (selected !== null && !(await restore()))
        throw new StepError(
          "プラグインの選択を元に戻せませんでした。Doctor で状態を確かめてください。",
          true,
        );
      // A step the project cannot reproduce from what the reader saw is for Doctor to check.
      if (error instanceof StepError || signal.aborted) throw error;
      throw new StepError(
        `${error instanceof Error ? error.message : String(error)} Doctor で状態を確かめてください。`,
        true,
      );
    }

    const end = await gitSnapshot(deps.root);
    const changed = before === null || end === null ? [] : changedSince(before, end).sort();
    return {
      ...operation,
      outcome: "succeeded",
      changedFiles: changed.slice(0, CHANGED_FILES_SHOWN),
      moreFiles: Math.max(0, changed.length - CHANGED_FILES_SHOWN),
      commitMessage:
        before === null
          ? null
          : `chore: AI-DLC プラグイン ${plugin.name} ${plugin.version} を${VERB[action]}`,
    };
  };

  const run = async (operation: PluginOperation) => {
    const plugin = deps.catalog.find((entry) => entry.name === operation.name);
    if (plugin === undefined || running !== null) return;
    const fail = async (message: string, doctor = false) => {
      deps.post({
        type: "plugins-result",
        result: { ...operation, outcome: "failed", message, doctor },
      });
      await postState();
    };
    if (!deps.isOpen())
      return fail("このフォルダーはもう開かれていません。ダッシュボードを開き直してください。");
    const state = await readState();
    if (!state.canAct) {
      const unmet = state.prerequisites
        .filter((item) => item.level === "required" && item.met !== true)
        .map((item) => item.label);
      return fail(`必要なものがそろっていません: ${unmet.join("、")}`);
    }
    const status = state.plugins.find((entry) => entry.name === plugin.name)?.status;
    if (status === undefined || !ALLOWED[operation.action].has(status))
      return fail(
        "プラグインの状態が変わりました。画面の表示を確かめてから、もう一度操作してください。",
      );
    const release = acquire(deps.root);
    if (release === null)
      return fail("ほかの導入や更新が実行中です。終わってから、もう一度操作してください。");
    running = operation;
    abort = new AbortController();
    const { signal } = abort;
    let result: PluginResult;
    try {
      await postState();
      result = await perform(operation, plugin, signal);
    } catch (error) {
      // A failure while cancelling (the selection could not be put back) is still a failure.
      result =
        signal.aborted && !(error instanceof StepError)
          ? { ...operation, outcome: "cancelled" }
          : {
              ...operation,
              outcome: "failed",
              message: error instanceof Error ? error.message : String(error),
              doctor: error instanceof StepError ? error.doctor : false,
            };
    } finally {
      running = null;
      abort = null;
      release();
    }
    deps.post({ type: "plugins-result", result });
    await postState();
  };

  return {
    receive: async (raw) => {
      const message = parsePluginsPanelMessage(raw);
      if (message === null) return;
      switch (message.type) {
        case "plugins-get":
          asked = true;
          return postState();
        case "plugins-cancel":
          abort?.abort();
          return;
        case "plugins-copy-start": {
          const plugin = deps.catalog.find((entry) => entry.name === message.name);
          if (plugin !== undefined) await deps.copy(plugin.startCommand);
          return;
        }
        case "plugins-action":
          return run({ action: message.action, name: message.name });
      }
    },
    refresh: async () => {
      if (asked) await postState();
    },
    running: () => running,
    dispose: () => abort?.abort(),
  };
}
