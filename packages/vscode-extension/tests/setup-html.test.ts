import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { CliManagementState } from "../src/cli-management.ts";
import type { NativeDoctorReport } from "../src/doctor-output.ts";
import { findHarnessConflict } from "../src/harness-conflicts.ts";
import type { HarnessId } from "../src/harness-detect.ts";
import { setupHtml } from "../src/setup-html.ts";
import type { SetupSnapshot } from "../src/setup-state.ts";

vi.mock("../src/native-setup.ts", () => ({
  SETUP_RELEASE: "test-release",
  INSTALL_GUIDE_URL: "https://github.com/awslabs/aidlc-workflows/releases/tag/vtest-release",
}));

const missingCli: CliManagementState = {
  machineVersion: null,
  projectPin: null,
  projectVersion: null,
  effectiveVersion: null,
  target: "test-release",
  targetInstalled: false,
  launcherReady: false,
  setupReady: false,
  canPrepare: true,
  canUpdate: true,
  confirmUpdate: false,
  engineNewer: false,
  status: "missing",
  message: "CLI test-release を導入してこのマシンの既定バージョンにします。",
  updateMessage: "",
};
const readyCli: CliManagementState = {
  ...missingCli,
  machineVersion: "test-release",
  effectiveVersion: "test-release",
  targetInstalled: true,
  launcherReady: true,
  setupReady: true,
  canPrepare: false,
  canUpdate: false,
  status: "ready",
  message: "CLIを利用できます。",
};
const empty: SetupSnapshot = {
  root: "C:\\project & docs",
  configured: false,
  projectPresent: false,
  native: null,
  version: null,
  harnesses: [],
  docsReady: false,
  preference: undefined,
  cli: missingCli,
};
const prepared: SetupSnapshot = { ...empty, cli: readyCli };
const ready: SetupSnapshot = {
  ...prepared,
  configured: true,
  projectPresent: true,
  version: "test-release",
  harnesses: ["cursor"],
};

const diagnosticReport: NativeDoctorReport = {
  version: "2.8.1",
  executedAt: "2026-09-11T02:34:56.000Z",
  outcome: "failed",
  summary: "診断が完了しました。問題のある項目があります。",
  checks: [
    {
      section: "machine",
      status: "ok",
      label: "Git を利用できます。",
      originalLabel: "Git available",
      translated: true,
    },
    {
      section: "project",
      status: "warn",
      label: "フックを確認してください。",
      fix: "設定を更新してください。\naidlc setup",
      originalLabel: "Check hooks",
      originalFix: "Update settings.\naidlc setup",
      translated: true,
      fixTranslated: true,
    },
    {
      section: "framework",
      status: "fail",
      label: "本体のファイルが不足しています。",
      originalLabel: "Framework files missing",
      translated: true,
    },
  ],
  counts: { passed: 1, warnings: 1, failed: 1 },
  rawOutput: "Git available\nCheck hooks\nFramework files missing",
  unparsedOutput: [],
};

function webview(
  options: {
    trusted?: boolean;
    saved?: unknown;
    snapshot?: SetupSnapshot;
    selected?: HarnessId[];
    creatingProject?: boolean;
    adding?: boolean;
  } = {},
) {
  const postMessage = vi.fn();
  const setState = vi.fn();
  const dom = new JSDOM(
    setupHtml(options.snapshot ?? empty, {
      selected: options.selected ?? ["cursor"],
      trusted: options.trusted ?? true,
      nonce: "testnonce",
      extensionVersion: "test-extension",
      creatingProject: options.creatingProject,
      adding: options.adding,
    }),
    {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage,
            getState: () => options.saved ?? null,
            setState,
          }),
        });
      },
    },
  );
  const doc = dom.window.document;
  return {
    dom,
    doc,
    postMessage,
    setState,
    button: (id: string) => doc.querySelector<HTMLButtonElement>(`#${id}`),
    text: () => doc.body.textContent ?? "",
    current: () => doc.querySelector(".step[aria-current=step] .step-title")?.textContent,
    message(data: unknown) {
      dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data }));
    },
  };
}

describe("setup webview frame", () => {
  it("keeps one heading, the folder and footer links on every state", () => {
    const view = webview();
    expect(view.doc.querySelector("h1")?.textContent).toBe("AI-DLC のセットアップ");
    expect(view.doc.querySelector(".folder code")?.textContent).toBe("C:\\project & docs");
    const steps = [...view.doc.querySelectorAll(".steps > li .step-title")];
    expect(steps.map((node) => node.textContent)).toEqual([
      "このマシンの CLI",
      "プロジェクトの設定",
      "完了",
    ]);
    const docs = view.doc.querySelector<HTMLAnchorElement>("#docs");
    expect(docs?.className).toBe("text-link");
    expect(docs?.getAttribute("href")).toBe(
      "https://github.com/awslabs/aidlc-workflows/releases/tag/vtest-release",
    );
    docs?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "docs", harnesses: ["cursor"] });
    view.button("update-workflows")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "open-workflows-update",
      harnesses: ["cursor"],
    });
    view.message({ type: "busy", value: true });
    expect(view.button("update-workflows")?.disabled).toBe(true);
    view.postMessage.mockClear();
    docs?.click();
    expect(view.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "docs",
      harnesses: ["cursor"],
    });
    expect(view.text()).toContain("Andon test-extension");
    expect(view.text()).not.toContain("状態を再確認");
    view.dom.window.close();
  });

  it("escapes workspace and version content and uses a nonce-only script policy", () => {
    const html = setupHtml(
      { ...ready, root: '</code><script>alert("x")</script>', version: "<img src=x>" },
      { selected: ["claude"], trusted: true, nonce: "nonce" },
    );
    const dom = new JSDOM(html);
    expect(dom.window.document.querySelectorAll("script").length).toBe(1);
    expect(dom.window.document.querySelector("img")).toBeNull();
    expect(html).not.toContain("unsafe-inline");
    expect(html).toContain("script-src 'nonce-nonce'");
    dom.window.close();
  });
});

describe("one open step per state", () => {
  it("asks for workspace trust before any step and keeps every step closed", () => {
    const view = webview({ trusted: false });
    expect(view.doc.querySelector(".notice")?.textContent).toContain(
      "このフォルダを信頼すると、設定を始められます。",
    );
    expect(view.doc.querySelectorAll(".step.todo")).toHaveLength(3);
    expect(view.doc.querySelector("#prepare-cli, #install, #finish")).toBeNull();
    view.button("trust")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "trust", harnesses: ["cursor"] });
    view.dom.window.close();
  });

  it("offers one CLI action for a new project and folds the version details", () => {
    const view = webview();
    expect(view.current()).toBe("このマシンの CLI");
    expect(view.text()).toContain("このマシンに AI-DLC の CLI test-release を入れます。");
    expect(view.text()).toContain(missingCli.message);
    const prepare = view.button("prepare-cli");
    expect(prepare?.textContent).toBe("CLI をインストール");
    const facts = view.doc.querySelector("details.more");
    expect(facts?.textContent).toContain("入れるバージョンtest-release");
    expect(facts?.textContent).toContain("このフォルダで使う CLI未検出");
    expect(view.doc.querySelector("#install, #finish, #run-doctor")).toBeNull();
    prepare?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "prepare-cli",
      harnesses: ["cursor"],
    });
    view.message({ type: "busy", value: true });
    const sent = view.postMessage.mock.calls.length;
    prepare?.click();
    expect(view.postMessage).toHaveBeenCalledTimes(sent);
    expect(view.doc.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    view.message({ type: "busy", value: false });
    expect(prepare?.disabled).toBe(false);
    view.dom.window.close();
  });

  it("asks to update the CLI for an older pin and keeps the pin", () => {
    const view = webview({
      snapshot: {
        ...empty,
        projectPresent: true,
        harnesses: ["cursor"],
        version: "2.6.114",
        cli: {
          ...missingCli,
          canPrepare: false,
          projectPin: "2.6.114",
          projectVersion: "2.6.114",
          confirmUpdate: true,
        },
      },
    });
    expect(view.text()).toContain("固定バージョン 2.6.114 のまま、CLI test-release を入れます。");
    expect(view.button("prepare-cli")?.textContent).toBe("CLI を更新");
    expect(view.button("prepare-cli")?.disabled).toBe(false);
    view.dom.window.close();
  });

  it("prepares a joining user's CLI with the repository's tools already done", () => {
    const view = webview({
      snapshot: {
        ...empty,
        projectPresent: true,
        harnesses: ["cursor", "claude"],
        version: "2.8.1",
        runtimeIssue: "aidlc use 2.8.1 を実行してください。",
        runtimeIssueKind: "runtime-missing",
        cli: { ...missingCli, projectPin: "2.8.1", projectVersion: "2.8.1" },
      },
      selected: ["cursor", "claude"],
    });
    expect(view.current()).toBe("このマシンの CLI");
    expect(view.text()).toContain("このプロジェクトが使う CLI 2.8.1 を、このマシンに入れます。");
    expect(view.text()).not.toContain("aidlc use");
    expect(view.text()).not.toContain("参加");
    const project = view.doc.querySelector(".step.done");
    expect(project?.querySelector(".step-title")?.textContent).toBe("プロジェクトの設定");
    expect(project?.querySelector(".sum")?.textContent).toBe("Cursor・Claude Code");
    expect(view.doc.querySelector("input[name=harness], #install, #finish")).toBeNull();
    view.button("prepare-cli")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "prepare-cli",
      harnesses: ["cursor", "claude"],
    });
    view.dom.window.close();
  });

  it("folds a prepared CLI into one line that still explains terminal use", () => {
    const view = webview({ snapshot: prepared });
    const cli = view.doc.querySelector(".step.done");
    expect(cli?.querySelector(".sum")?.textContent).toBe("CLI test-release");
    expect(cli?.querySelector("details")?.open).toBe(false);
    expect(cli?.textContent).toContain("Windows の Git Bash では");
    expect(cli?.textContent).toContain("aidlc.cmd --version");
    expect(cli?.querySelector("#cli-terminal")?.classList.contains("text-link")).toBe(true);
    view.button("cli-terminal")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "cli-terminal",
      harnesses: ["cursor"],
    });
    view.dom.window.close();
  });
});

describe("project step", () => {
  it("selects tools for a new project and sends them with one action", () => {
    const view = webview({ snapshot: prepared });
    expect(view.current()).toBe("プロジェクトの設定");
    const install = view.button("install");
    expect(install?.textContent).toBe("プロジェクトを設定");
    expect(install?.disabled).toBe(false);
    expect(view.doc.querySelector("#selection-note")?.textContent).toBe(
      "1 個のツールを設定します。",
    );
    view.doc.querySelector<HTMLInputElement>('input[value="codex"]')?.click();
    expect(view.doc.querySelector("#selection-note")?.textContent).toContain("2 個のツールを設定");
    install?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "install",
      harnesses: ["cursor", "codex"],
    });
    view.message({ type: "busy", value: true });
    expect(install?.disabled).toBe(true);
    expect(view.doc.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    view.message({ type: "busy", value: false });
    expect(install?.disabled).toBe(false);
    expect(view.doc.querySelector("#finish")).toBeNull();
    view.dom.window.close();
  });

  it("blocks empty and conflicting selections before sending an install request", () => {
    const view = webview({ snapshot: prepared });
    const toggle = (id: string) =>
      view.doc.querySelector<HTMLInputElement>(`input[value="${id}"]`)?.click();
    const button = view.button("install");
    toggle("cursor");
    expect(button?.disabled).toBe(true);
    expect(view.doc.querySelector("#selection-note")?.textContent).toContain("1つ以上選択");
    for (const [first, second] of [
      ["copilot", "opencode"],
      ["kiro", "kiro-ide"],
    ] as const) {
      toggle(first);
      expect(button?.disabled).toBe(false);
      toggle(second);
      expect(button?.disabled).toBe(true);
      expect(view.doc.querySelector("#selection-note")?.textContent).toBe(
        findHarnessConflict([first, second])?.message,
      );
      expect(view.doc.querySelector("#selection-note")?.classList.contains("error")).toBe(true);
      toggle(first);
      toggle(second);
    }
    expect(view.postMessage.mock.calls.some(([message]) => message.type === "install")).toBe(false);
    view.dom.window.close();
  });

  it("offers to retry or drop only the tools that failed while creating the project", () => {
    const view = webview({
      snapshot: { ...ready, harnesses: ["cursor"] },
      selected: ["cursor", "claude"],
      creatingProject: true,
    });
    expect(view.text()).toContain("Claude Code を設定できませんでした。");
    expect(view.doc.querySelector("input[name=harness], #finish")).toBeNull();
    const retry = view.button("install");
    expect(retry?.textContent).toBe("Claude Code を再試行");
    retry?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "install",
      harnesses: ["cursor", "claude"],
    });
    expect(view.button("skip-failed")?.textContent).toBe("Claude Code を外して進む");
    view.button("skip-failed")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "skip-failed",
      harnesses: ["cursor", "claude"],
    });
    view.dom.window.close();
  });

  it("renders per-tool results as text", () => {
    const view = webview({ snapshot: prepared });
    view.message({
      type: "restore",
      log: "",
      text: "",
      error: false,
      doctorReport: null,
      installResults: [
        { id: "cursor", status: "configured", message: "設定しました" },
        { id: "claude", status: "failed", message: '<img src=x onerror="alert(1)">設定失敗' },
      ],
    });
    const list = view.doc.querySelector("#install-results");
    expect(list?.textContent).toContain("Cursor：設定しました");
    expect(list?.textContent).toContain("Claude Code：設定できませんでした");
    expect(list?.querySelector("img")).toBeNull();
    view.message({ type: "install-results", results: [] });
    expect(list?.children).toHaveLength(0);
    view.dom.window.close();
  });
});

describe("finish step", () => {
  it("finishes a configured project, with tool addition and an optional diagnosis beside it", () => {
    const view = webview({ snapshot: ready });
    expect(view.current()).toBe("完了");
    expect(view.text()).toContain("準備ができました。");
    const finish = view.button("finish");
    expect(finish?.textContent).toBe("セットアップを完了");
    expect(finish?.disabled).toBe(false);
    expect(view.button("add-tools")?.classList.contains("text-link")).toBe(true);
    expect(view.button("run-doctor")?.textContent).toBe("診断を実行（任意）");
    view.message({ type: "busy", value: true });
    expect(finish?.disabled).toBe(true);
    view.message({ type: "busy", value: false });
    expect(finish?.disabled).toBe(false);
    finish?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "finish", harnesses: ["cursor"] });
    view.button("add-tools")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "add-tools", harnesses: ["cursor"] });
    view.dom.window.close();
  });

  it("opens a completed setup on the dashboard action instead of joining wording", () => {
    const view = webview({
      snapshot: { ...ready, preference: { completed: true, docsSkipped: true, harness: "cursor" } },
    });
    expect(view.text()).toContain("セットアップは完了しています。");
    expect(view.button("finish")?.textContent).toBe("ダッシュボードを開く");
    expect(view.text()).not.toContain("参加");
    view.dom.window.close();
  });

  it("adds tools from the last step while keeping installed tools checked", () => {
    const view = webview({ snapshot: ready, adding: true });
    expect(view.doc.querySelector(".add-tools legend")?.textContent).toBe("追加するツール");
    expect(view.doc.querySelector("#finish")).toBeNull();
    const cursor = view.doc.querySelector<HTMLInputElement>('input[value="cursor"]');
    expect(cursor?.checked).toBe(true);
    expect(cursor?.disabled).toBe(true);
    const install = view.button("install");
    expect(install?.textContent).toBe("選んだツールを追加");
    expect(install?.disabled).toBe(true);
    expect(view.doc.querySelector("#selection-note")?.textContent).toBe(
      "追加するツールを選んでください。",
    );
    view.doc.querySelector<HTMLInputElement>('input[value="claude"]')?.click();
    view.doc.querySelector<HTMLInputElement>('input[value="codex"]')?.click();
    expect(view.doc.querySelector("#selection-note")?.textContent).toContain("2 個のツールを追加");
    install?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "install",
      harnesses: ["cursor", "claude", "codex"],
    });
    view.button("cancel-add")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "cancel-add",
      harnesses: ["cursor", "claude", "codex"],
    });
    view.dom.window.close();
  });

  it.each([
    ["copilot", "opencode"],
    ["kiro", "kiro-ide"],
  ] as const)("blocks adding %s's conflicting tool %s", (installed, addition) => {
    const view = webview({
      snapshot: { ...ready, harnesses: [installed] },
      selected: [addition],
      adding: true,
    });
    expect(view.button("install")?.disabled).toBe(true);
    expect(view.doc.querySelector("#selection-note")?.textContent).toBe(
      findHarnessConflict([installed, addition])?.message,
    );
    view.button("install")?.click();
    expect(view.postMessage.mock.calls.some(([message]) => message.type === "install")).toBe(false);
    view.dom.window.close();
  });

  it("sends tool addition to the update screen when the project must be updated first", () => {
    const view = webview({
      snapshot: {
        ...ready,
        workflows: {
          root: ready.root,
          target: "test-release",
          tools: [],
          projectPin: null,
          status: "update",
          message: "更新があります。すべてのツールを揃えます。",
          canInstall: false,
          canUpdate: true,
          engineBumpNeeded: true,
          engineVersionDiffers: true,
          updateRetryNeeded: false,
        },
      },
      adding: true,
    });
    expect(view.doc.querySelector(".add-tools")?.textContent).toContain("更新があります。");
    expect(view.doc.querySelector("input[name=harness], #install")).toBeNull();
    view.button("open-update")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "open-workflows-update",
      harnesses: ["cursor"],
    });
    view.dom.window.close();
  });
});

describe("blocked states", () => {
  it("names the CLI this extension cannot install and points to the update screen", () => {
    const view = webview({
      snapshot: {
        ...empty,
        projectPresent: true,
        harnesses: ["cursor"],
        version: "2.12.0",
        cli: {
          ...missingCli,
          canPrepare: false,
          canUpdate: false,
          status: "blocked",
          blockedReason: "needs-other-cli",
          projectPin: "2.12.0",
          projectVersion: "2.12.0",
          message: "このプロジェクトには CLI 2.12.0 が必要です。",
        },
      },
    });
    const step = view.doc.querySelector(".step.blocked");
    expect(step?.querySelector(".step-title")?.textContent).toBe("このマシンの CLI");
    expect(step?.textContent).toContain(
      "このプロジェクトの CLI 2.12.0 は、この拡張からは入れられません。",
    );
    expect(step?.querySelector("details.more")?.textContent).toContain(
      "このプロジェクトには CLI 2.12.0 が必要です。",
    );
    expect(view.doc.querySelector("#prepare-cli, #install, #finish")).toBeNull();
    view.button("open-update")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({
      type: "open-workflows-update",
      harnesses: ["cursor"],
    });
    step?.querySelector<HTMLAnchorElement>("a[data-send=docs]")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "docs", harnesses: ["cursor"] });
    view.dom.window.close();
  });

  it("asks for a recheck after git init for Codex", () => {
    const view = webview({
      snapshot: {
        ...ready,
        configured: false,
        harnesses: ["codex"],
        runtimeIssue: "Codex のプロジェクトフックには Git リポジトリが必要です。",
        runtimeIssueKind: "git",
      },
      selected: ["codex"],
    });
    expect(view.doc.querySelector(".step.blocked")?.textContent).toContain(
      "Codex を使うには、このフォルダが Git リポジトリである必要があります。",
    );
    expect(view.button("recheck")?.textContent).toBe("もう一度確認");
    view.button("recheck")?.click();
    expect(view.postMessage).toHaveBeenLastCalledWith({ type: "recheck", harnesses: ["codex"] });
    expect(view.doc.querySelector("#finish")).toBeNull();
    view.dom.window.close();
  });

  it("explains a project whose AI-DLC folder is missing instead of only marking it", () => {
    const view = webview({
      snapshot: { ...ready, configured: false, projectPresent: false },
    });
    expect(view.doc.querySelector(".step.blocked")?.textContent).toContain(
      "AI-DLC の設定の一部（aidlc/ フォルダなど）が見つかりません。",
    );
    expect(view.button("open-update")).not.toBeNull();
    view.dom.window.close();
  });
});

describe("status, log and diagnosis", () => {
  it("shows the log only once there is output and restores status text", () => {
    const view = webview({ snapshot: prepared });
    const details = view.doc.querySelector<HTMLDetailsElement>("#log-details");
    expect(details?.hidden).toBe(true);
    view.message({ type: "log", text: "installer output" });
    expect(details?.hidden).toBe(false);
    expect(details?.open).toBe(true);
    view.message({ type: "status", text: "失敗しました。", error: true });
    expect(view.doc.querySelector("#status")?.textContent).toBe("失敗しました。");
    expect(view.doc.querySelector("#status")?.classList.contains("error")).toBe(true);
    expect(view.setState).toHaveBeenLastCalledWith({
      log: "installer output\n",
      status: "失敗しました。",
      doctorReport: null,
    });
    view.dom.window.close();
  });

  it("summarizes a diagnosis in one line and folds checks, counts and the original", () => {
    const view = webview({ snapshot: ready });
    view.message({ type: "doctor-report", report: diagnosticReport });
    const result = view.doc.querySelector("#doctor-result");
    expect(result?.getAttribute("aria-live")).toBe("polite");
    expect(result?.querySelector(".doctor-summary")?.textContent).toBe(diagnosticReport.summary);
    const details = result?.querySelector<HTMLDetailsElement>(".doctor-details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("本体バージョン：2.8.1");
    expect(details?.querySelector("time")?.getAttribute("datetime")).toBe(
      diagnosticReport.executedAt,
    );
    expect([...view.doc.querySelectorAll(".doctor-counts li")].map((el) => el.textContent)).toEqual(
      ["正常 1 件", "要確認 1 件", "問題あり 1 件"],
    );
    expect([...(details?.querySelectorAll("h3") ?? [])].map((el) => el.textContent)).toEqual([
      "実行環境",
      "プロジェクト",
      "AI-DLC 本体",
    ]);
    expect([...view.doc.querySelectorAll(".doctor-state")].map((el) => el.textContent)).toEqual([
      "正常",
      "要確認",
      "問題あり",
    ]);
    expect(view.doc.querySelector(".doctor-fix")?.textContent).toBe(
      "対処方法：設定を更新してください。\naidlc setup",
    );
    expect(view.doc.querySelector("#doctor-original pre")?.textContent).toBe(
      diagnosticReport.rawOutput,
    );
    expect(view.button("run-doctor")?.textContent).toBe("診断を再実行");
    expect(view.setState).toHaveBeenLastCalledWith({
      log: "",
      status: "",
      doctorReport: diagnosticReport,
    });
    view.dom.window.close();
  });

  it("keeps unknown labels and remedies visible and renders diagnostic output as text", () => {
    const view = webview({ snapshot: ready });
    const original = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    view.message({
      type: "doctor-report",
      report: {
        ...diagnosticReport,
        summary: `新しい診断項目があります。${original}`,
        checks: [
          {
            section: "other",
            status: "warn",
            label: "日本語訳が未対応の項目です。",
            originalLabel: original,
            translated: false,
            fix: "日本語訳が未対応の対処方法です。",
            originalFix: "Run <repair> & retry",
            fixTranslated: false,
          },
        ],
        rawOutput: original,
        unparsedOutput: ["New output", original],
      },
    });
    const result = view.doc.querySelector("#doctor-result");
    expect(result?.textContent).toContain("日本語訳が未対応の項目です。");
    expect(result?.textContent).toContain(`原文：${original}`);
    expect(result?.textContent).toContain("対処方法の原文：Run <repair> & retry");
    expect(result?.textContent).toContain("形式を読み取れない出力があります。");
    expect(result?.querySelector(".doctor-details > details pre")?.textContent).toBe(
      `New output\n${original}`,
    );
    expect(result?.querySelector("#doctor-original pre")?.textContent).toBe(original);
    expect(view.doc.querySelectorAll("script")).toHaveLength(1);
    expect(result?.querySelector("img, repair, script")).toBeNull();
    view.dom.window.close();
  });

  it("replaces earlier results and distinguishes an unavailable diagnosis", () => {
    const view = webview({ snapshot: ready });
    view.message({ type: "doctor-report", report: diagnosticReport });
    view.message({
      type: "doctor-report",
      report: {
        ...diagnosticReport,
        version: "",
        outcome: "unavailable",
        summary: "診断の実行がタイムアウトしました。もう一度実行してください。",
        executedAt: "2026-09-11T02:35:56.000Z",
        checks: [],
        counts: null,
        rawOutput: "process timed out",
      },
    });
    const result = view.doc.querySelector("#doctor-result");
    expect(result?.textContent).toContain("診断の実行がタイムアウトしました。");
    expect(result?.textContent).toContain("本体バージョン：未取得");
    expect(result?.querySelector(".doctor-summary")?.classList.contains("doctor-fail")).toBe(true);
    expect(result?.querySelector(".doctor-counts, .doctor-check")).toBeNull();
    expect(result?.textContent).not.toContain("Git を利用できます。");
    expect(view.doc.querySelectorAll("#doctor-original")).toHaveLength(1);
    view.dom.window.close();
  });

  it("labels each tool and keeps its status, checks, counts and original output separate", () => {
    const view = webview({ snapshot: ready });
    const healthy = {
      ...diagnosticReport,
      outcome: "ok",
      summary: "問題はありません。",
      checks: [diagnosticReport.checks[0]],
      counts: { passed: 1, warnings: 0, failed: 0 },
      rawOutput: "Claude healthy",
    };
    const reports = [
      { id: "claude", report: healthy },
      { id: "cursor", report: diagnosticReport },
    ];
    view.message({ type: "doctor-reports", reports });
    const sections = [...view.doc.querySelectorAll(".doctor-tool")];
    expect(sections.map((section) => section.querySelector("h3")?.textContent)).toEqual([
      "Claude Code",
      "Cursor",
    ]);
    expect(sections[0]?.querySelector(".doctor-summary")?.classList.contains("doctor-ok")).toBe(
      true,
    );
    expect(sections[0]?.querySelectorAll(".doctor-check")).toHaveLength(1);
    expect(sections[0]?.querySelector("#doctor-original-claude pre")?.textContent).toBe(
      "Claude healthy",
    );
    expect(sections[1]?.querySelectorAll(".doctor-check")).toHaveLength(3);
    expect(
      [...(sections[1]?.querySelectorAll("h4") ?? [])].map((heading) => heading.textContent),
    ).toEqual(["実行環境", "プロジェクト", "AI-DLC 本体"]);
    expect(view.doc.querySelectorAll("#doctor-original")).toHaveLength(0);
    expect(view.button("run-doctor")?.textContent).toBe("診断を再実行");
    expect(view.setState).toHaveBeenLastCalledWith({
      log: "",
      status: "",
      doctorReport: null,
      doctorReports: reports,
    });
    view.dom.window.close();
  });

  it("restores grouped results and clears them on a new run", () => {
    const reports = [{ id: "cursor", report: diagnosticReport }];
    const view = webview({ snapshot: ready, saved: { doctorReports: reports } });
    expect(view.doc.querySelectorAll(".doctor-tool")).toHaveLength(1);
    view.message({ type: "doctor-running" });
    expect(view.doc.querySelectorAll(".doctor-tool, .doctor-check")).toHaveLength(0);
    expect(view.doc.querySelector("#doctor-result")?.textContent).toBe("診断を実行しています。");
    expect(view.button("run-doctor")?.textContent).toBe("診断中…");
    expect(view.doc.querySelector("#doctor")?.getAttribute("aria-busy")).toBe("true");
    view.message({ type: "restore", log: "", text: "", doctorReport: null, doctorReports: [] });
    expect(view.doc.querySelector("#doctor-result")?.textContent).toBe("");
    expect(view.button("run-doctor")?.textContent).toBe("診断を実行（任意）");
    view.dom.window.close();
  });

  it("keeps a diagnosis received outside the finish step for the next render", () => {
    const view = webview({ snapshot: prepared });
    view.message({ type: "doctor-report", report: diagnosticReport });
    expect(view.doc.querySelector("#doctor-result")).toBeNull();
    expect(view.setState).toHaveBeenLastCalledWith({
      log: "",
      status: "",
      doctorReport: diagnosticReport,
    });
    view.dom.window.close();
  });
});
