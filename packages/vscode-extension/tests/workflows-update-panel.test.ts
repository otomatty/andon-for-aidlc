import {
  type VersionGate,
  WORKFLOWS_TARGET_VERSION,
  type WorkflowsManagementState,
} from "@aidlc-guide/shared-types";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import { NEWER_WORKFLOWS_VERSION } from "./workflows-version-fixture.ts";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  inspect: vi.fn(),
  update: vi.fn(),
  inspectCli: vi.fn(),
  updateCli: vi.fn(),
  prepareCli: vi.fn(),
  prepareRuntime: vi.fn(),
  pinCli: vi.fn(),
  useTargetCli: vi.fn(),
  doctor: vi.fn(),
  doctorFix: vi.fn(),
  commands: vi.fn(),
  repair: vi.fn(),
  explain: vi.fn(),
  reapply: vi.fn(),
  probe: vi.fn(),
  clipboard: vi.fn(),
  warn: vi.fn(),
  gate: vi.fn(),
  snapshot: vi.fn(),
  workspace: {
    isTrusted: true,
    workspaceFolders: [{ uri: { fsPath: "project" } }],
    onDidChangeWorkspaceFolders: vi.fn(),
  },
}));
vi.mock("vscode", () => ({
  commands: { executeCommand: mocks.commands },
  env: { clipboard: { writeText: mocks.clipboard } },
  Uri: {},
  ViewColumn: { One: 1 },
  window: {
    createWebviewPanel: mocks.create,
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: mocks.warn,
  },
  workspace: mocks.workspace,
}));
vi.mock("../src/workflows-management.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/workflows-management.ts")>();
  return { ...actual, inspectWorkflowsManagement: mocks.inspect };
});
vi.mock("../src/workflows-update.ts", () => ({ updateInstalledWorkflows: mocks.update }));
vi.mock("@aidlc-guide/reader-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aidlc-guide/reader-core")>()),
  inspectVersionGate: mocks.gate,
}));
vi.mock("../src/shared-file-changes.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared-file-changes.ts")>()),
  gitStatusSnapshot: mocks.snapshot,
}));
vi.mock("../src/cli-management.ts", async (importOriginal) => ({
  cliRegistersPin: (await importOriginal<typeof import("../src/cli-management.ts")>())
    .cliRegistersPin,
  inspectCliManagement: mocks.inspectCli,
  updateMachineCli: mocks.updateCli,
  prepareProjectCli: mocks.prepareCli,
  prepareTargetRuntime: mocks.prepareRuntime,
  pinProjectCli: mocks.pinCli,
  useTargetCli: mocks.useTargetCli,
  CLI_UPDATE_CONFIRM_ACTION: "更新する",
  CLI_PIN_CONFIRM_ACTION: "固定する",
  CLI_USE_TARGET_CONFIRM_ACTION: "戻す",
  cliPinConfirmMessage: (machine: string, target: string) => `${target} に固定（既定 ${machine}）`,
  cliUseTargetConfirmMessage: (machine: string, target: string) =>
    `既定を ${machine} から ${target} に戻す`,
  cliUpdateConfirmMessage: (version: string, target: string) =>
    `このプロジェクトの固定バージョンは ${version} です。CLI を ${target} に更新しますか？`,
}));
vi.mock("../src/cli-environment.ts", () => ({ configureCliEnvironment: vi.fn() }));
vi.mock("../src/workflows-diagnose.ts", () => ({ diagnoseInstalledWorkflows: mocks.doctor }));
vi.mock("../src/doctor-fixes.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/doctor-fixes.ts")>()),
  runDoctorFix: mocks.doctorFix,
}));
vi.mock("../src/workflows-repair.ts", () => ({
  repairWorkflows: mocks.repair,
  explainRepair: mocks.explain,
  reapplyLocalPatches: mocks.reapply,
  probeRepairTools: mocks.probe,
  REPAIR_TOOLS: ["claude", "cursor", "copilot"],
}));

import type { CliManagementState } from "../src/cli-management.ts";
import type { RepairItem } from "../src/workflows-repair-plan.ts";
import { applyNativeWorkflowsUpdate } from "../src/workflows-native-update.ts";
import { type UpdateView, workflowsUpdateHtml } from "../src/workflows-update-html.ts";
import {
  cliUpdateMessage,
  openWorkflowsUpdatePanel,
  workflowsUpdateMessage,
} from "../src/workflows-update-panel.ts";

const target = WORKFLOWS_TARGET_VERSION;

const cli: CliManagementState = {
  machineVersion: target,
  projectPin: "2.8.0",
  projectVersion: "2.8.0",
  effectiveVersion: "2.8.0",
  target,
  targetInstalled: true,
  launcherReady: true,
  setupReady: true,
  canPrepare: false,
  canUpdate: false,
  confirmUpdate: false,
  engineNewer: false,
  status: "ready",
  message: "準備済み",
  updateMessage: "CLI の更新は不要です。",
};

const okGate: VersionGate = {
  status: "ok",
  target,
  tools: [],
  pin: null,
  engine: null,
  native: false,
  projectVersion: null,
  rollback: null,
  message: "プロジェクトは対応版です。",
};
const olderGate: VersionGate = {
  ...okGate,
  status: "project-older",
  native: true,
  engine: "2.8.0",
  pin: "2.8.0",
  projectVersion: "2.8.0",
  message: "プロジェクトの aidlc-workflows 2.8.0 は古いバージョンです。",
};

const state: WorkflowsManagementState = {
  target,
  root: "project",
  projectPin: "2.8.0",
  status: "update",
  message: "更新があります。",
  canInstall: false,
  canUpdate: true,
  engineBumpNeeded: true,
  engineVersionDiffers: true,
  updateRetryNeeded: false,
  tools: [
    { id: "cursor", label: "Cursor", version: "2.8.0" },
    { id: "claude", label: "Claude Code", version: "2.8.0" },
  ],
};
const current: WorkflowsManagementState = {
  ...state,
  projectPin: target,
  status: "current",
  message: "更新の必要はありません。",
  canUpdate: false,
  engineBumpNeeded: false,
  engineVersionDiffers: false,
  tools: state.tools.map((tool) => ({ ...tool, version: target })),
};
const problem = {
  harness: "claude" as const,
  kind: "ownership" as const,
  path: ".claude/settings.json",
  detail: "AI-DLC が管理するフックに独自の変更があります",
  guidance: "管理元を確認",
};
const item = (over: Partial<RepairItem> = {}): RepairItem => ({
  path: ".claude/settings.json",
  harnesses: ["claude"],
  kind: "ownership",
  group: "auto",
  guidance: "公式のファイルと内容が違います。",
  plan: "公式ファイルと同じ内容です。記録を作り直します。",
  options: [{ action: "regenerate", label: "作り直す" }],
  detail: "locally modified or unowned",
  ...over,
});
const custom = item({
  path: ".claude/agents/dev.md",
  group: "confirm",
  plan: "変えた部分を見分けられません。",
  options: [
    { action: "fetch-base", label: "旧版を取り寄せて当て直す" },
    { action: "ai-merge", label: "AI が当て直す" },
    { action: "replace", label: "公式版に置き換える" },
  ],
});
const broken = item({
  path: ".cursor/mcp.json",
  harnesses: ["cursor"],
  kind: "json",
  group: "ai",
  plan: "JSON の書式が壊れています。",
  options: [{ action: "ai-json", label: "AI に直してもらう" }],
  detail: "malformed JSON",
});
const linked = item({
  path: ".claude/hooks",
  kind: "not-file",
  group: "manual",
  plan: "リンクを外してください。",
  options: [],
  detail: "managed path is not a regular file",
});
const checkOf = (items: RepairItem[]) => ({
  state: "problems" as const,
  message: `${items.length} 件`,
  problems: items.map(() => problem),
  items,
});
const claudeOnly = { tools: [{ tool: "claude" as const, label: "Claude Code", available: true }] };
const okResult = {
  ok: true,
  stage: "complete" as const,
  message: "完了しました",
  nextAction: "",
  applied: true,
  recovery: "not-needed" as const,
  details: "",
};

function view(overrides: Partial<UpdateView> = {}): UpdateView {
  return {
    gate: olderGate,
    workflows: state,
    cli,
    check: { state: "pending" },
    repairTools: null,
    change: null,
    activity: null,
    outcome: null,
    toolResults: [],
    ...overrides,
  };
}

/** Render a page and run its script, collecting what it posts to the host. */
function page(input: UpdateView | string) {
  const posted: unknown[] = [];
  const dom = new JSDOM(typeof input === "string" ? input : workflowsUpdateHtml(input, "nonce"), {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.assign(window, {
        acquireVsCodeApi: () => ({ postMessage: (message: unknown) => posted.push(message) }),
      });
    },
  });
  const document = dom.window.document;
  return {
    dom,
    document,
    posted,
    byId: <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T,
    /** The filled buttons: each state has exactly one, its primary action. */
    primary: () =>
      [...document.querySelectorAll("main button:not(.text-link):not(.secondary)")].map(
        (button) => button.id,
      ),
    receive: (data: unknown) =>
      dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data })),
  };
}

function openPanel() {
  const webview = { html: "", postMessage: vi.fn(), onDidReceiveMessage: vi.fn() };
  const onDidDispose = vi.fn();
  mocks.create.mockReturnValue({ webview, onDidDispose });
  const context = {
    globalStorageUri: { fsPath: "storage" },
    workspaceState: { get: vi.fn(), update: vi.fn() },
  } as unknown as ExtensionContext;
  const receive = (message: unknown) => webview.onDidReceiveMessage.mock.calls[0]?.[0](message);
  const shown = () => page(webview.html);
  return { webview, context, onDidDispose, receive, shown };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.isTrusted = true;
  mocks.workspace.workspaceFolders = [{ uri: { fsPath: "project" } }];
  mocks.inspect.mockReturnValue(state);
  mocks.inspectCli.mockReturnValue(cli);
  mocks.gate.mockReturnValue(olderGate);
  mocks.snapshot.mockResolvedValue(null);
  mocks.repair.mockResolvedValue({ problems: [], items: [], message: "問題は見つかりませんでした。" });
  mocks.probe.mockResolvedValue([{ tool: "claude", label: "Claude Code", available: true }]);
  mocks.prepareRuntime.mockResolvedValue(okResult);
});

describe("update screen", () => {
  it("shows one status line, three versions and one primary action for an older project", () => {
    const { document, primary, byId, dom } = page(view());
    try {
      expect(byId("status").textContent).toContain(`プロジェクトを ${target} に更新してください`);
      expect([...document.querySelectorAll(".versions dt")].map((dt) => dt.textContent)).toEqual([
        "この PC",
        "このプロジェクト",
        "Guide の対応版",
      ]);
      expect([...document.querySelectorAll(".versions dd")].map((dd) => dd.textContent)).toEqual([
        "2.8.0古い",
        "2.8.0古い",
        target,
      ]);
      expect(primary()).toEqual(["apply"]);
      expect(byId("apply").textContent).toBe(`プロジェクトを ${target} に更新`);
      const steps = [...document.querySelectorAll(".steps > li")].map((step) =>
        step.textContent?.trim(),
      );
      expect(steps[0]).toContain("更新の前に確認します");
      expect(steps[2]).toContain("コミットして共有");
      expect(document.body.textContent).not.toContain(`この PC にも ${target} を入れます`);
      const files = byId("shared-files-note").textContent ?? "";
      expect(files).toContain(".aidlc-version");
      expect(files).toContain(".gitignore");
    } finally {
      dom.window.close();
    }
  });

  it("says the update also readies this PC when its runtime is missing", () => {
    const { document, dom } = page(view({ cli: { ...cli, targetInstalled: false } }));
    expect(document.body.textContent).toContain(`この PC にも ${target} を入れます`);
    dom.window.close();
  });

  it("keeps project text and diagnostics as text", () => {
    const { document, dom } = page(
      view({
        workflows: { ...state, root: "project<script>" },
        check: checkOf([item({ path: '<img src=x onerror="alert(1)">', detail: "<b>raw</b>" })]),
      }),
    );
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.querySelectorAll("b")).toHaveLength(0);
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(document.body.textContent).toContain("project<script>");
    dom.window.close();
  });

  it("sorts the files by how they are fixed and fixes them all with one button", () => {
    const { byId, primary, posted, document, dom } = page(
      view({ check: checkOf([item(), custom, broken]), repairTools: claudeOnly }),
    );
    try {
      expect(primary()).toEqual(["repair"]);
      expect(byId("apply")).toBeNull();
      expect(byId("repair").textContent).toBe(`3 件を直して ${target} に更新`);
      expect(
        [...document.querySelectorAll(".fix-group .fix-head .badge")].map((b) => b.textContent),
      ).toEqual(["自動で直します", "確認してください", "AI が直します"]);
      expect(document.body.textContent).toContain("使う AI：Claude Code（自動で選択）");
      const radios = [...document.querySelectorAll<HTMLInputElement>('input[name^="choice-"]')];
      expect(radios.map((radio) => [radio.value, radio.checked])).toEqual([
        ["fetch-base", true],
        ["ai-merge", false],
        ["replace", false],
      ]);
      expect(document.querySelector(".rec")?.closest("label")?.textContent).toContain("旧版");
      radios[2]!.click();
      expect(posted.at(-1)).toEqual({ type: "choose", path: ".claude/agents/dev.md", action: "replace" });
      (document.querySelector('[data-send="problem-file"]') as HTMLButtonElement).click();
      expect(posted.at(-1)).toEqual({ type: "problem-file", path: ".claude/settings.json" });
      (document.querySelector('[data-send="explain"]') as HTMLButtonElement).click();
      expect(posted.at(-1)).toEqual({ type: "explain", path: ".claude/settings.json", tool: "claude" });
      byId<HTMLButtonElement>("refresh").click();
      expect(radios[0]!.disabled).toBe(true);
    } finally {
      dom.window.close();
    }
    const again = page(view({ check: checkOf([item(), custom, broken]), repairTools: claudeOnly }));
    again.byId<HTMLButtonElement>("repair").click();
    expect(again.posted.at(-1)).toEqual({ type: "repair", tool: "claude" });
    expect(again.byId<HTMLButtonElement>("diagnose").disabled).toBe(true);
    again.dom.window.close();
  });

  it("asks for hand fixes first and re-checks instead of repairing", () => {
    const { byId, primary, document, dom } = page(
      view({ check: checkOf([item(), linked]), repairTools: claudeOnly }),
    );
    expect(primary()).toEqual(["diagnose"]);
    expect(byId("diagnose").textContent).toBe("直したので再チェック");
    expect(byId("repair")).toBeNull();
    expect(document.body.textContent).toContain(
      "手で直す必要がある 1 件を直してから、再チェックしてください。残りの 1 件は、そのあとボタン 1 つで直せます。",
    );
    expect(document.querySelector('[data-group="manual"]')?.textContent).toContain(".claude/hooks");
    dom.window.close();
  });

  it("leaves AI-only fixes to the person when no AI is available", () => {
    const { primary, document, dom } = page(
      view({
        check: checkOf([custom, broken]),
        repairTools: { tools: [], message: "AI の検出に失敗しました" },
      }),
    );
    try {
      expect(primary()).toEqual(["diagnose"]);
      expect(document.querySelector('[data-group="manual"]')?.textContent).toContain(".cursor/mcp.json");
      expect(document.querySelector('[data-group="confirm"]')?.textContent).toContain(
        ".claude/agents/dev.md",
      );
      const ai = document.querySelector<HTMLInputElement>('input[value="ai-merge"]');
      expect(ai?.disabled).toBe(true);
      expect(document.querySelector('[data-send="explain"]')).toBeNull();
      expect(document.body.textContent).toContain("AI の検出に失敗しました");
    } finally {
      dom.window.close();
    }
  });

  it("offers a choice of AI only when several are available", () => {
    const tools = [
      { tool: "claude" as const, label: "Claude Code", available: true },
      { tool: "cursor" as const, label: "Cursor", available: true },
      { tool: "copilot" as const, label: "Copilot", available: false, detail: "未導入" },
    ];
    const choice = page(view({ check: checkOf([broken]), repairTools: { tools } }));
    try {
      const select = choice.byId<HTMLSelectElement>("repair-tool");
      expect(select.options).toHaveLength(3);
      expect(select.options[2]?.disabled).toBe(true);
      select.value = "cursor";
      choice.byId<HTMLButtonElement>("repair").click();
      expect(choice.posted.at(-1)).toEqual({ type: "repair", tool: "cursor" });
    } finally {
      choice.dom.window.close();
    }
  });

  it("shows notes, AI explanations and upstream's own words for a file", () => {
    const { document, dom } = page(
      view({
        check: checkOf([{ ...custom, note: "2.7.0 を取り寄せられませんでした：offline", remediation: "move it" }]),
        repairTools: claudeOnly,
        explanations: { ".claude/agents/dev.md": { text: "独自の変更があるためです。", error: false } },
      }),
    );
    expect(document.querySelector(".item-note")?.textContent).toContain("offline");
    expect(document.querySelector(".ai-note")?.textContent).toContain("独自の変更があるためです。");
    expect(document.querySelector("details.raw")?.textContent).toContain("move it");
    dom.window.close();
  });

  it("shows an AI change as a diff with its checks before anything is applied", () => {
    const { byId, primary, posted, document, dom } = page(
      view({
        check: checkOf([item(), broken]),
        repairTools: claudeOnly,
        review: [
          {
            path: ".cursor/mcp.json",
            action: "ai-json",
            tool: "claude",
            before: '{\n  "a": "x",\n}\n',
            after: '{\n  "a": "x"\n}\n',
            summary: "余分なカンマを削除しました。",
            checks: [
              { ok: true, text: "JSON として読める" },
              { ok: false, text: "公式版の 1 行を削除している" },
            ],
            originalHash: "h",
          },
        ],
      }),
    );
    try {
      expect(primary()).toEqual(["approve"]);
      expect(byId("approve").textContent).toBe(`この内容で ${target} に更新`);
      expect(document.querySelector(".steps > li")?.textContent).toContain("AI が直した内容の確認");
      expect([...document.querySelectorAll("pre.diff .del")].map((row) => row.textContent)).toEqual([
        '2-  "a": "x",',
      ]);
      expect([...document.querySelectorAll("pre.diff .add")].map((row) => row.textContent)).toEqual([
        '2+  "a": "x"',
      ]);
      expect(document.querySelector(".checks .warn")?.textContent).toContain("1 行を削除");
      expect(document.body.textContent).toContain("まだプロジェクトには反映していません");
      byId<HTMLButtonElement>("discard-review").click();
      expect(posted.at(-1)).toEqual({ type: "discard-review" });
    } finally {
      dom.window.close();
    }
  });

  it("lists Doctor's findings and runs only the fixes the Guide knows", () => {
    const report = {
      version: target,
      executedAt: "",
      outcome: "failed" as const,
      summary: "問題 1 件、警告 1 件",
      counts: null,
      rawOutput: "",
      unparsedOutput: [],
      checks: [
        { section: "project" as const, status: "ok" as const, label: "正常", originalLabel: "ok", translated: true },
        {
          section: "project" as const,
          status: "warn" as const,
          label: "プラグインの構成が古い",
          fix: "`aidlc engine plugin sync` を実行してください",
          originalLabel: "Plugins: 1 require sync",
          originalFix: "run `aidlc engine plugin sync`",
          translated: true,
          fixTranslated: true,
        },
        {
          section: "project" as const,
          status: "fail" as const,
          label: "日本語訳が未対応の診断項目です。原文を確認してください。",
          fix: "git で戻してください",
          originalLabel: "Hooks: broken",
          originalFix: "run `git checkout -- .claude`",
          translated: false,
          fixTranslated: true,
        },
      ],
    };
    const { posted, document, dom } = page(
      view({ gate: { ...olderGate, status: "unknown" }, doctorReports: [{ id: "claude", report }] }),
    );
    try {
      const rows = [...document.querySelectorAll(".doctor-group li")];
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toContain("要確認");
      expect(rows[1]?.textContent).toContain("Hooks: broken");
      const fixes = [...document.querySelectorAll<HTMLButtonElement>('[data-send="doctor-fix"]')];
      expect(fixes.map((button) => button.textContent)).toEqual(["プラグインの構成をそろえる"]);
      fixes[0]!.click();
      expect(posted.at(-1)).toEqual({ type: "doctor-fix", harness: "claude", index: 1 });
    } finally {
      dom.window.close();
    }
  });

  it("lets the update go ahead after a check that could not finish", () => {
    const { byId, primary, document, dom } = page(
      view({ check: { state: "failed", message: "リンクは修正できません" } }),
    );
    expect(primary()).toEqual(["apply"]);
    expect(document.body.textContent).toContain(
      "更新前のチェックを完了できませんでした：リンクは修正できません",
    );
    expect(byId("diagnose")).not.toBeNull();
    dom.window.close();
  });

  it("waits while an action runs, keeps the stop button and shows its progress", () => {
    const { byId, document, receive, dom } = page(
      view({
        check: { state: "checking" },
        activity: { text: "更新前のチェックをしています…", cancellable: true },
      }),
    );
    try {
      expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
      expect(byId<HTMLButtonElement>("refresh").disabled).toBe(true);
      expect(byId<HTMLButtonElement>("cancel-repair").disabled).toBe(false);
      receive({ type: "log", line: "診断しています\n.claude を確認" });
      expect(byId("progress").textContent).toBe(".claude を確認");
      expect(byId("log").textContent).toContain("診断しています");
      receive({ type: "results", results: [{ label: "Cursor", message: "更新完了" }] });
      expect(byId("tool-results").textContent).toBe("Cursor：更新完了");
    } finally {
      dom.window.close();
    }
  });

  it("locks the page as soon as an action is pressed", () => {
    const { byId, posted, dom } = page(view());
    byId<HTMLButtonElement>("apply").click();
    expect(posted.at(-1)).toEqual({ type: "apply" });
    expect(byId<HTMLButtonElement>("apply").disabled).toBe(true);
    expect(byId<HTMLButtonElement>("refresh").disabled).toBe(true);
    dom.window.close();
  });

  it("gives the buttons back when the host ends an action without redrawing", () => {
    const { byId, receive, document, dom } = page(
      view({
        check: checkOf([custom]),
        repairTools: { tools: [], message: "AI の検出に失敗しました" },
      }),
    );
    try {
      const ai = () => document.querySelector<HTMLInputElement>('input[value="ai-merge"]');
      byId<HTMLButtonElement>("refresh").click();
      expect(byId<HTMLButtonElement>("diagnose").disabled).toBe(true);
      receive({ type: "unlock" });
      expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("false");
      expect(byId<HTMLButtonElement>("refresh").disabled).toBe(false);
      expect(byId<HTMLButtonElement>("diagnose").disabled).toBe(false);
      // A control that was disabled before the lock stays disabled.
      expect(ai()?.disabled).toBe(true);
    } finally {
      dom.window.close();
    }
  });

  it("lists the changed files by folder with the commit message once updated", () => {
    const { byId, primary, document, posted, dom } = page(
      view({
        gate: { ...olderGate, status: "ok", engine: target, projectVersion: target },
        workflows: current,
        check: { state: "ok", message: "問題なし" },
        change: {
          kind: "update",
          files: [".aidlc-version", ".claude/a.json", ".claude/b.json", ".cursor/"],
          commitMessage: `chore: aidlc-workflows を ${target} に更新`,
        },
      }),
    );
    try {
      expect(byId("status").textContent).toContain(`${target} に更新しました`);
      expect(primary()).toEqual(["copy-commit"]);
      expect([...document.querySelectorAll("#shared-files li")].map((li) => li.textContent)).toEqual(
        [".aidlc-version", ".claude/2 件", ".cursor/"],
      );
      expect(byId("commit-message").textContent).toBe(`chore: aidlc-workflows を ${target} に更新`);
      expect(document.querySelector(".versions")?.textContent).toContain("未コミット");
      byId<HTMLButtonElement>("open-scm").click();
      expect(posted.at(-1)).toEqual({ type: "open-scm" });
    } finally {
      dom.window.close();
    }
  });

  it("asks this PC to install or register the project's version", () => {
    const gate = { ...olderGate, status: "engine-mismatch" as const, projectVersion: target };
    const install = page(
      view({ gate: { ...gate, engine: "2.10.0" }, workflows: current, cli: { ...cli, canUpdate: true } }),
    );
    expect(install.primary()).toEqual(["update-cli"]);
    expect(install.byId("update-cli").textContent).toBe(`この PC に ${target} を導入`);
    install.dom.window.close();
    const register = page(
      view({
        gate: { ...gate, engine: null },
        workflows: current,
        cli: { ...cli, canPrepare: true, projectPin: target },
      }),
    );
    expect(register.byId("update-cli").textContent).toBe("この PC に登録");
    expect(register.document.querySelector(".versions")?.textContent).toContain("未登録");
    register.dom.window.close();
  });

  it("offers the pin with moving the default back as the quieter choice", () => {
    const { byId, primary, document, dom } = page(
      view({
        gate: { ...olderGate, status: "engine-newer", engine: NEWER_WORKFLOWS_VERSION, pin: null },
        workflows: { ...current, projectPin: null },
        cli: { ...cli, machineVersion: NEWER_WORKFLOWS_VERSION, engineNewer: true },
      }),
    );
    expect(primary()).toEqual(["pin-project"]);
    expect(byId("pin-project").textContent).toBe(`このプロジェクトを ${target} に固定`);
    expect(byId("use-target").classList.contains("text-link")).toBe(true);
    expect(document.querySelector(".versions")?.textContent).toContain("固定なし");
    dom.window.close();
  });

  it("points a newer project to a Guide update and keeps the way back folded", () => {
    const { byId, primary, dom } = page(
      view({
        gate: {
          ...olderGate,
          status: "project-newer",
          projectVersion: NEWER_WORKFLOWS_VERSION,
          rollback: {
            kind: "commands",
            commands: [`aidlc config --pin ${target} --yes`, "aidlc config --harness claude --yes"],
          },
        },
        workflows: { ...current, projectPin: NEWER_WORKFLOWS_VERSION },
      }),
    );
    expect(primary()).toEqual(["extension-update"]);
    expect(byId<HTMLDetailsElement>("rollback").open).toBe(false);
    expect(byId("rollback-commands").textContent).toBe(
      `aidlc config --pin ${target} --yes\naidlc config --harness claude --yes`,
    );
    expect(byId("copy-rollback")).not.toBeNull();
    dom.window.close();
  });

  it("sends an unreadable version to Doctor, or to a re-check when there is no tool", () => {
    const gate = { ...olderGate, status: "unknown" as const, message: "記録を読めません。" };
    const doctor = page(view({ gate }));
    expect(doctor.primary()).toEqual(["doctor"]);
    expect(doctor.byId("status").textContent).toContain("記録を読めません。");
    doctor.dom.window.close();
    const recheck = page(view({ gate, workflows: { ...state, tools: [] } }));
    expect(recheck.primary()).toEqual(["recheck"]);
    recheck.dom.window.close();
  });

  it("says when everything is current and keeps the other actions as links", () => {
    const { byId, primary, document, dom } = page(view({ gate: okGate, workflows: current }));
    expect(byId("status").textContent).toContain("最新です");
    expect(primary()).toEqual(["open-dashboard"]);
    for (const id of ["install", "doctor", "extension-update", "refresh"])
      expect(byId(id).classList.contains("text-link")).toBe(true);
    expect(document.querySelectorAll("#tools tr")).toHaveLength(2);
    dom.window.close();
  });

  it("does not mark this PC's default for a copied project, which runs its own files", () => {
    const { document, dom } = page(
      view({ gate: okGate, workflows: current, cli: { ...cli, machineVersion: "2.8.0" } }),
    );
    expect(document.querySelector(".versions dd")?.textContent).toBe("2.8.0");
    dom.window.close();
  });

  it("opens setup for a project without AI-DLC", () => {
    const { primary, dom } = page(view({ gate: { ...okGate, status: "not-installed" } }));
    expect(primary()).toEqual(["setup"]);
    dom.window.close();
  });
});

describe("update panel", () => {
  it("updates in one press: readies this PC, checks, updates and offers the commit", async () => {
    let installed = false;
    mocks.inspectCli.mockImplementation(() => ({ ...cli, targetInstalled: installed }));
    mocks.prepareRuntime.mockImplementation(async () => {
      installed = true;
      return okResult;
    });
    mocks.snapshot
      .mockResolvedValueOnce(new Map([["notes.md", " M"]]))
      .mockResolvedValueOnce(
        new Map([
          ["notes.md", " M"],
          [".aidlc-version", " M"],
          [".claude/", "??"],
        ]),
      );
    mocks.update.mockImplementation(async () => {
      mocks.gate.mockReturnValue({ ...olderGate, status: "ok", engine: target });
      mocks.inspect.mockReturnValue(current);
      return { ok: true, target };
    });
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    await receive({ type: "ready" });
    expect(mocks.repair).not.toHaveBeenCalled();
    await receive({ type: "apply", workspaceRoot: "attacker" });
    expect(mocks.prepareRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: "project" }),
    );
    expect(mocks.updateCli).not.toHaveBeenCalled();
    expect(mocks.repair).toHaveBeenCalledOnce();
    expect(mocks.repair.mock.calls[0]?.[0]).not.toHaveProperty("tool");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: "project" }));
    expect(mocks.prepareRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0]!,
    );
    const { byId, document, dom } = shown();
    expect(byId("status").textContent).toContain(`${target} に更新しました`);
    expect([...document.querySelectorAll("#shared-files li")].map((li) => li.textContent)).toEqual([
      ".aidlc-version",
      ".claude/",
    ]);
    dom.window.close();
    await receive({ type: "copy-commit" });
    expect(mocks.clipboard).toHaveBeenCalledWith(`chore: aidlc-workflows を ${target} に更新`);
    await receive({ type: "open-scm" });
    expect(mocks.commands).toHaveBeenCalledWith("workbench.view.scm");
  });

  it("moves on from the commit step once a refresh finds the change committed", async () => {
    mocks.snapshot
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([[".aidlc-version", " M"], [".claude/a.json", " M"]]))
      .mockResolvedValueOnce(new Map([[".claude/a.json", " M"], ["notes.md", " M"]]))
      .mockResolvedValueOnce(new Map([["notes.md", " M"]]));
    mocks.update.mockImplementation(async () => {
      mocks.gate.mockReturnValue({ ...olderGate, status: "ok", engine: target });
      mocks.inspect.mockReturnValue(current);
      return { ok: true, target };
    });
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    await receive({ type: "apply" });
    await receive({ type: "refresh" });
    let screen = shown();
    expect(screen.byId("status").textContent).toContain(`${target} に更新しました`);
    screen.dom.window.close();
    await receive({ type: "refresh" });
    screen = shown();
    expect(screen.byId("status").textContent).toContain("最新です");
    screen.dom.window.close();
  });

  it("stops before the update when this PC cannot be readied", async () => {
    mocks.inspectCli.mockReturnValue({ ...cli, targetInstalled: false });
    mocks.prepareRuntime.mockResolvedValue({
      ...okResult,
      ok: false,
      stage: "install",
      message: "取得に失敗",
      nextAction: "通信を確認してください。",
    });
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    await receive({ type: "apply" });
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    const { document, primary, dom } = shown();
    expect(document.querySelector(".outcome.error")?.textContent).toContain("CLI の導入で停止");
    expect(primary()).toEqual(["apply"]);
    dom.window.close();
  });

  it("stops at the check when it finds problems, and asks again only by pressing update", async () => {
    mocks.repair.mockResolvedValue({
      problems: [problem],
      items: [item()],
      message: "1 件の問題があります。",
    });
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    await receive({ type: "apply" });
    expect(mocks.update).not.toHaveBeenCalled();
    const { primary, document, dom } = shown();
    expect(primary()).toEqual(["repair"]);
    expect(document.body.textContent).toContain(".claude/settings.json");
    dom.window.close();
    await receive({ type: "copy-diagnosis" });
    const copied = JSON.parse(mocks.clipboard.mock.lastCall?.[0]);
    expect(copied.problems[0].path).toBe(".claude/settings.json");
    expect(copied.items[0]).toMatchObject({ path: ".claude/settings.json", group: "auto" });
  });

  it("checks by itself once when the panel opens, without repairing or updating", async () => {
    const { context, receive, webview } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    await receive({ type: "ready", tool: "claude" });
    await receive({ type: "ready" });
    expect(mocks.repair).toHaveBeenCalledOnce();
    expect(mocks.repair.mock.calls[0]?.[0]).not.toHaveProperty("tool");
    expect(mocks.probe).toHaveBeenCalledWith(mocks.repair.mock.calls[0]?.[0].signal);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(context.workspaceState.update).not.toHaveBeenCalled();
    expect(webview.html).toContain("問題は見つかりませんでした。");
    await receive({ type: "refresh" });
    expect(mocks.repair).toHaveBeenCalledTimes(2);
  });

  it("waits for this PC's runtime before the automatic check and survives a failed AI probe", async () => {
    mocks.inspectCli.mockReturnValue({ ...cli, targetInstalled: false });
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    await receive({ type: "ready" });
    expect(mocks.repair).not.toHaveBeenCalled();
    mocks.inspectCli.mockReturnValue(cli);
    mocks.repair.mockResolvedValue({ problems: [problem], items: [broken], message: "1 件" });
    mocks.probe.mockRejectedValue(new Error("missing"));
    await receive({ type: "ready" });
    expect(mocks.repair).toHaveBeenCalledOnce();
    const { document, byId, primary, dom } = shown();
    expect(document.body.textContent).toContain("AI の検出に失敗しました");
    expect(byId("repair")).toBeNull();
    expect(primary()).toEqual(["diagnose"]);
    dom.window.close();
  });

  it.each(["cancel", "dispose"])("aborts a pending AI probe on %s", async (action) => {
    const { context, receive, onDidDispose } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    let probeSignal: AbortSignal | undefined;
    mocks.probe.mockImplementation((signal: AbortSignal) => {
      probeSignal = signal;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    });
    const pending = receive({ type: "ready" });
    expect(probeSignal?.aborted).toBe(false);
    if (action === "cancel") await receive({ type: "cancel-repair" });
    else onDidDispose.mock.calls[0]?.[0]();
    await pending;
    expect(probeSignal?.aborted).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["success", "cancel-update", "remaining", "cancel", "failure", "disposed"])(
    "continues into the update only after a successful repair: %s",
    async (outcome) => {
      const { context, receive, onDidDispose, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      mocks.repair.mockImplementation(async () => {
        if (outcome === "cancel") await receive({ type: "cancel-repair" });
        if (outcome === "failure") throw new Error("修正失敗");
        if (outcome === "disposed") onDidDispose.mock.calls[0]?.[0]();
        return {
          problems: outcome === "remaining" ? [problem] : [],
          items: outcome === "remaining" ? [item()] : [],
          message: "修正結果",
          backup: "backup",
        };
      });
      mocks.update.mockImplementation(async (opts) => {
        expect(opts.workspaceRoot).toBe("project");
        expect(opts.signal.aborted).toBe(false);
        if (outcome === "cancel-update") {
          await receive({ type: "cancel-repair" });
          expect(opts.signal.aborted).toBe(true);
          return { ok: false, reason: "preflight", target };
        }
        return { ok: true, target };
      });
      await receive({ type: "repair", tool: "claude" });
      const continued = ["success", "cancel-update"].includes(outcome);
      expect(mocks.update).toHaveBeenCalledTimes(continued ? 1 : 0);
      if (continued) expect(webview.html).toContain("修正結果 バックアップ: backup");
      if (outcome === "failure") expect(webview.html).toContain("修正失敗");
    },
  );

  it.each([true, false])(
    "re-applies local patches only after a completed update (update ok: %s)",
    async (ok) => {
      const { context, receive, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      const patches = [{ path: ".cursor/hooks/a.ts", officialHash: "h", content: "patched" }];
      mocks.repair.mockResolvedValue({ problems: [], items: [], message: "修正結果", patches });
      mocks.update.mockResolvedValue(
        ok ? { ok: true, target } : { ok: false, reason: "preflight", target },
      );
      mocks.reapply.mockReturnValue({ applied: [".cursor/hooks/a.ts"], skipped: [] });
      await receive({ type: "repair", tool: "claude" });
      if (ok) {
        expect(mocks.reapply).toHaveBeenCalledWith("project", patches);
        expect(webview.html).toContain("独自パッチを当て直しました: .cursor/hooks/a.ts");
      } else {
        expect(mocks.reapply).not.toHaveBeenCalled();
        expect(webview.html).toContain("独自パッチを当て直していません");
        expect(webview.html).toContain("バックアップ");
      }
    },
  );

  it("names unapplied patches when the update throws", async () => {
    const { context, receive, webview } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    mocks.repair.mockResolvedValue({
      problems: [],
      items: [],
      message: "修正結果",
      patches: [{ path: ".cursor/hooks/a.ts", officialHash: "h", content: "patched" }],
    });
    mocks.update.mockRejectedValue(new Error("通信に失敗"));
    await receive({ type: "repair", tool: "claude" });
    expect(mocks.reapply).not.toHaveBeenCalled();
    expect(webview.html).toContain("更新に失敗しました：通信に失敗");
    expect(webview.html).toContain("独自パッチを当て直していません: .cursor/hooks/a.ts");
  });

  it("repairs only the host's root, takes only a supported AI and supports cancellation", async () => {
    const { context, receive } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    mocks.repair.mockImplementation(async (opts) => {
      expect(opts.root).toBe("project");
      expect(opts.fix.tool).toBe("claude");
      await receive({ type: "cancel-repair" });
      expect(opts.signal.aborted).toBe(true);
      return { problems: [], items: [], message: "中止しました" };
    });
    await receive({ type: "repair", root: "attacker", tool: "claude" });
    expect(mocks.repair).toHaveBeenCalledOnce();
    mocks.repair.mockResolvedValue({ problems: [problem], items: [item()], message: "1 件" });
    await receive({ type: "repair", tool: "unsupported" });
    expect(mocks.repair).toHaveBeenCalledTimes(2);
    expect(mocks.repair.mock.lastCall?.[0].fix).toEqual({ choices: {} });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("re-checks what stopped the update, so the next step is to fix it", async () => {
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    mocks.update.mockResolvedValue({ ok: false, reason: "preflight", target, problems: [problem] });
    mocks.repair
      .mockResolvedValueOnce({ problems: [], items: [], message: "問題は見つかりませんでした。" })
      .mockResolvedValue({ problems: [problem], items: [item()], message: "1 件" });
    await receive({ type: "apply" });
    expect(mocks.repair).toHaveBeenCalledTimes(2);
    const { primary, document, dom } = shown();
    expect(primary()).toEqual(["repair"]);
    expect(document.querySelector(".outcome.error")?.textContent).toContain(
      "更新は止まりました。次の 1 件を直すと更新できます",
    );
    dom.window.close();
    mocks.update.mockResolvedValue({ ok: false, reason: "preflight", target, problems: [] });
    await receive({ type: "apply" });
    await receive({ type: "copy-diagnosis" });
    expect(JSON.parse(mocks.clipboard.mock.lastCall?.[0]).problems).toEqual([]);
  });

  it("sends the person's picks with the repair, and the recommended one otherwise", async () => {
    const { context, receive } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    mocks.repair.mockResolvedValue({ problems: [problem], items: [item(), custom], message: "2 件" });
    await receive({ type: "ready" });
    mocks.repair.mockClear();
    await receive({ type: "repair", tool: "claude" });
    expect(mocks.repair.mock.lastCall?.[0].fix).toEqual({
      choices: { ".claude/agents/dev.md": "fetch-base" },
      tool: "claude",
    });
    await receive({ type: "choose", path: ".claude/agents/dev.md", action: "replace" });
    await receive({ type: "choose", path: ".claude/agents/dev.md", action: "delete" });
    await receive({ type: "choose", path: ".claude/settings.json", action: "replace" });
    await receive({ type: "repair", tool: "claude" });
    expect(mocks.repair.mock.lastCall?.[0].fix.choices).toEqual({
      ".claude/agents/dev.md": "replace",
    });
  });

  it("holds AI changes for approval and updates only after they are approved", async () => {
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    const reviewed = {
      path: ".cursor/mcp.json",
      action: "ai-json",
      tool: "claude",
      before: "{,}",
      after: "{}",
      summary: "直しました",
      checks: [{ ok: true, text: "JSON として読める" }],
      originalHash: "h",
    };
    mocks.repair.mockResolvedValue({
      problems: [problem],
      items: [broken],
      message: "AI が直した 1 件を確認してください。",
      review: [reviewed],
    });
    await receive({ type: "repair", tool: "claude" });
    expect(mocks.update).not.toHaveBeenCalled();
    let screen = shown();
    expect(screen.primary()).toEqual(["approve"]);
    screen.dom.window.close();
    await receive({ type: "discard-review" });
    screen = shown();
    expect(screen.byId("approve")).toBeNull();
    expect(screen.document.body.textContent).toContain("AI の修正を使わずに戻りました");
    screen.dom.window.close();
    await receive({ type: "approve" });
    expect(mocks.repair).toHaveBeenCalledOnce();
    await receive({ type: "repair", tool: "claude" });
    mocks.repair.mockResolvedValue({ problems: [], items: [], message: "1 ファイルを直しました。" });
    mocks.update.mockResolvedValue({ ok: true, target });
    await receive({ type: "approve" });
    expect(mocks.repair.mock.lastCall?.[0].fix).toEqual({
      choices: {},
      tool: "claude",
      approved: [reviewed],
    });
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("asks an AI about one listed file and shows the answer or why it failed", async () => {
    const { context, receive, webview } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    mocks.repair.mockResolvedValue({ problems: [problem], items: [custom], message: "1 件" });
    await receive({ type: "ready" });
    mocks.explain.mockResolvedValue("独自の変更があるためです。");
    await receive({ type: "explain", path: "../other", tool: "claude" });
    expect(mocks.explain).not.toHaveBeenCalled();
    await receive({ type: "explain", path: ".claude/agents/dev.md", tool: "claude" });
    expect(mocks.explain.mock.lastCall?.[0]).toMatchObject({ path: ".claude/agents/dev.md" });
    expect(mocks.explain.mock.lastCall?.[1]).toBe("claude");
    expect(webview.html).toContain("独自の変更があるためです。");
    mocks.explain.mockRejectedValue(new Error("ログインしてください"));
    await receive({ type: "explain", path: ".claude/agents/dev.md", tool: "claude" });
    expect(webview.html).toContain("ログインしてください");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("runs a Doctor fix the Guide knows and diagnoses again", async () => {
    mocks.gate.mockReturnValue({ ...olderGate, status: "unknown" });
    const { context, receive, webview } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    const report = {
      version: target,
      executedAt: "",
      outcome: "warning",
      summary: "警告 1 件",
      counts: null,
      rawOutput: "",
      unparsedOutput: [],
      checks: [
        {
          section: "project",
          status: "warn",
          label: "プラグインの構成が古い",
          originalLabel: "Plugins: 1 require sync",
          originalFix: "run `aidlc engine plugin sync`",
          translated: true,
        },
      ],
    };
    mocks.doctor.mockImplementation(async (opts) => {
      opts.onDoctorReport("claude", report);
      return { ok: true, message: "Doctor の確認が完了しました。" };
    });
    await receive({ type: "doctor" });
    expect(webview.html).toContain("プラグインの構成をそろえる");
    await receive({ type: "doctor-fix", harness: "claude", index: 0 });
    expect(mocks.doctorFix).toHaveBeenCalledWith(
      "project",
      "claude",
      expect.objectContaining({ kind: "plugin-sync" }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.doctor).toHaveBeenCalledTimes(2);
    mocks.doctorFix.mockRejectedValue(new Error("失敗しました"));
    await receive({ type: "doctor-fix", harness: "claude", index: 0 });
    expect(webview.html).toContain("「プラグインの構成をそろえる」を完了できませんでした");
    await receive({ type: "doctor-fix", harness: "claude", index: 5 });
    expect(mocks.doctorFix).toHaveBeenCalledTimes(2);
  });

  it("does not offer a commit for an update that did not finish", async () => {
    const { context, receive, shown } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    mocks.update.mockResolvedValue({ ok: false, reason: "preflight", target, problems: [] });
    await receive({ type: "apply" });
    const { byId, dom } = shown();
    expect(byId("copy-commit")).toBeNull();
    dom.window.close();
    await receive({ type: "copy-commit" });
    expect(mocks.clipboard).not.toHaveBeenCalled();
  });

  it("restores the old pin and machine default when the panel closes before configuration", async () => {
    const webview = { html: "", postMessage: vi.fn(), onDidReceiveMessage: vi.fn() };
    const onDidDispose = vi.fn();
    const dispose = vi.fn(() => onDidDispose.mock.calls[0]?.[0]());
    const unsubscribe = vi.fn();
    mocks.workspace.onDidChangeWorkspaceFolders.mockReturnValue({ dispose: unsubscribe });
    mocks.create.mockReturnValue({ webview, onDidDispose, dispose });
    const runtime = { version: target, executable: "/user/aidlc", binDir: "/user/bin" };
    const use = vi.fn();
    const pin = vi.fn(async () => {
      dispose();
    });
    const configure = vi.fn();
    mocks.update.mockImplementation(async (opts) => {
      const result = await applyNativeWorkflowsUpdate({
        ...opts,
        pin: target,
        selected: ["cursor"],
        detected: ["cursor"],
        hooks: {
          readActive: () => ({ ...runtime, version: NEWER_WORKFLOWS_VERSION }),
          readInstall: () => runtime,
          readProjectPin: () => "2.8.0",
          readWorkspaceVersions: () => ["2.8.0"],
          use,
          pin,
          configure,
        },
      });
      expect(result).toMatchObject({ ok: false, reason: "cancelled" });
      expect(opts.isCurrent()).toBe(false);
      expect(opts.signal.aborted).toBe(true);
      expect(opts.canRestore()).toBe(true);
      mocks.workspace.isTrusted = false;
      expect(opts.canRestore()).toBe(false);
      return result;
    });
    const context = {
      globalStorageUri: { fsPath: "storage" },
      workspaceState: { get: vi.fn() },
    } as unknown as ExtensionContext;
    await openWorkflowsUpdatePanel(context, "project");
    await webview.onDidReceiveMessage.mock.calls[0]?.[0]({ type: "apply" });
    expect(use.mock.calls.map((call) => call[1])).toEqual([target, NEWER_WORKFLOWS_VERSION]);
    expect(pin.mock.calls.map((call) => call[2])).toEqual([target, "2.8.0"]);
    expect(configure).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("disposes a stale panel when its folder is removed from a multi-root workspace", async () => {
    const webview = { html: "", postMessage: vi.fn(), onDidReceiveMessage: vi.fn() };
    const onDidDispose = vi.fn();
    const dispose = vi.fn(() => onDidDispose.mock.calls[0]?.[0]());
    const unsubscribe = vi.fn();
    mocks.workspace.onDidChangeWorkspaceFolders.mockReturnValue({ dispose: unsubscribe });
    mocks.create.mockReturnValue({ webview, onDidDispose, dispose });
    mocks.workspace.workspaceFolders.push({ uri: { fsPath: "other" } });
    mocks.update.mockImplementation(async (opts) => {
      mocks.workspace.workspaceFolders = [{ uri: { fsPath: "other" } }];
      mocks.workspace.onDidChangeWorkspaceFolders.mock.calls[0]?.[0]();
      expect(opts.isCurrent()).toBe(false);
      expect(opts.signal.aborted).toBe(true);
      expect(opts.canRestore()).toBe(false);
      mocks.workspace.workspaceFolders.push({ uri: { fsPath: "project" } });
      expect(opts.canRestore()).toBe(false);
      return { ok: false, target };
    });
    const context = {
      globalStorageUri: { fsPath: "storage" },
      workspaceState: { get: vi.fn() },
    } as unknown as ExtensionContext;
    await openWorkflowsUpdatePanel(context, "project");
    const receive = webview.onDidReceiveMessage.mock.calls[0]?.[0];
    await receive({ type: "apply" });
    expect(dispose).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await receive({ type: "apply" });
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("stores a failed update for a retry and reports each tool", async () => {
    const stored = new Map<string, unknown>();
    const webview = { html: "", postMessage: vi.fn(), onDidReceiveMessage: vi.fn() };
    mocks.create.mockReturnValue({ webview, onDidDispose: vi.fn() });
    const context = {
      globalStorageUri: { fsPath: "storage" },
      workspaceState: {
        get: (key: string) => stored.get(key),
        update: async (key: string, value: unknown) => {
          stored.set(key, value);
        },
      },
    } as unknown as ExtensionContext;
    let attempts = 0;
    mocks.update.mockImplementation(async (opts) => {
      expect(opts).not.toHaveProperty("selected");
      expect(opts).not.toHaveProperty("pin");
      if (attempts++ > 0) expect(opts.needsRepair).toBe(true);
      await opts.setNeedsRepair(true);
      opts.onHarnessResult({ id: "cursor", status: "failed", message: "再実行してください" });
      return { ok: false, target };
    });
    await openWorkflowsUpdatePanel(context, "project");
    const receive = webview.onDidReceiveMessage.mock.calls[0]?.[0];
    await receive({ type: "apply", workspaceRoot: "other", selected: ["cursor"], pin: "9.0.0" });
    await receive({ type: "apply" });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "results",
        results: [expect.objectContaining({ label: "Cursor", status: "failed" })],
      }),
    );
    expect(webview.html).toContain("Cursor：再実行してください");
    expect(webview.html).toContain("完了していません");
    mocks.workspace.isTrusted = false;
    await receive({ type: "apply" });
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("unlocks a page that a refresh or a repeated outcome leaves unchanged", async () => {
    mocks.gate.mockReturnValue(okGate);
    mocks.inspect.mockReturnValue(current);
    const { context, receive, webview } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    const html = webview.html;
    await receive({ type: "refresh" });
    expect(webview.html).toBe(html);
    expect(webview.postMessage).toHaveBeenCalledWith({ type: "unlock" });
    // A stale pin request ends before any progress is drawn, with the same note each time.
    await receive({ type: "pin-project" });
    expect(webview.html).toContain("状況が変わりました。");
    webview.postMessage.mockClear();
    await receive({ type: "pin-project" });
    expect(webview.postMessage).toHaveBeenCalledWith({ type: "unlock" });
  });

  it("runs Doctor and the other screens against the host root", async () => {
    mocks.gate.mockReturnValue(okGate);
    mocks.inspect.mockReturnValue(current);
    mocks.doctor.mockImplementation(async (opts) => {
      opts.onHarnessResult({ id: "claude", status: "completed", message: "正常" });
      return { ok: true, message: "Doctor 完了" };
    });
    const { context, receive, webview } = openPanel();
    await openWorkflowsUpdatePanel(context, "project");
    await receive({ type: "doctor", workspaceRoot: "attacker" });
    expect(mocks.doctor).toHaveBeenCalledWith(expect.objectContaining({ workspaceRoot: "project" }));
    expect(webview.html).toContain("Doctor 完了");
    expect(webview.html).toContain("Claude Code：正常");
    await receive({ type: "setup", workspaceRoot: "attacker" });
    expect(mocks.commands).toHaveBeenCalledWith("aidlc-guide.setup", "project");
    await receive({ type: "install" });
    expect(mocks.commands).toHaveBeenCalledWith("aidlc-guide.installWorkflows", "project");
    await receive({ type: "extension-update" });
    expect(mocks.commands).toHaveBeenCalledWith("aidlc-guide.checkUpdate");
    await receive({ type: "open-dashboard" });
    expect(mocks.commands).toHaveBeenCalledWith("aidlc-guide.open");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.repair).not.toHaveBeenCalled();
  });

  describe("this PC's runtime", () => {
    const mismatch = { ...olderGate, status: "engine-mismatch" as const, projectVersion: target };

    it("installs the target and reports how it went", async () => {
      mocks.gate.mockReturnValue(mismatch);
      mocks.inspect.mockReturnValue(current);
      mocks.inspectCli.mockReturnValue({ ...cli, canUpdate: true });
      mocks.updateCli.mockResolvedValue({ ...okResult, message: "CLI 完了" });
      const { context, receive, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      await receive({ type: "update-cli", workspaceRoot: "attacker", target: "9.0.0" });
      expect(mocks.updateCli).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: "project" }),
      );
      expect(mocks.updateCli.mock.calls[0]?.[0]).not.toHaveProperty("target");
      expect(mocks.update).not.toHaveBeenCalled();
      expect(webview.html).toContain("CLI 完了");
    });

    it("registers the existing pin of a fresh clone instead of updating the machine CLI", async () => {
      mocks.gate.mockReturnValue({ ...mismatch, engine: null });
      mocks.inspect.mockReturnValue(current);
      mocks.inspectCli.mockReturnValue({
        ...cli,
        projectPin: target,
        projectVersion: target,
        effectiveVersion: null,
        setupReady: false,
        canPrepare: true,
        status: "missing",
      });
      mocks.prepareCli.mockResolvedValue({ ...okResult, message: "登録しました" });
      const { context, receive, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      await receive({ type: "update-cli" });
      expect(mocks.prepareCli).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceRoot: "project" }),
      );
      expect(mocks.updateCli).not.toHaveBeenCalled();
      expect(mocks.warn).not.toHaveBeenCalled();
      expect(webview.html).toContain("登録しました");
    });

    const older = { ...cli, confirmUpdate: true, canUpdate: true, projectPin: "2.6.114" };

    it("confirms before moving the default under a project pinned elsewhere", async () => {
      mocks.inspectCli.mockReturnValue({ ...older, projectVersion: "2.6.114" });
      mocks.warn.mockResolvedValueOnce("更新する");
      mocks.updateCli.mockResolvedValue(okResult);
      const { context, receive } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      await receive({ type: "update-cli" });
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.stringContaining("2.6.114"),
        { modal: true },
        "更新する",
      );
      expect(mocks.updateCli).toHaveBeenCalledOnce();
    });

    it("does not move the default when the confirmation is dismissed or the pin changes", async () => {
      mocks.inspectCli.mockReturnValue({ ...older, projectVersion: "2.6.114" });
      mocks.warn.mockResolvedValueOnce(undefined);
      const { context, receive, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      await receive({ type: "update-cli" });
      expect(webview.html).toContain("CLI の更新を中止しました。");
      mocks.warn.mockResolvedValueOnce("更新する");
      mocks.inspectCli
        .mockReturnValueOnce({ ...older, projectVersion: "2.6.114" })
        .mockReturnValueOnce({ ...older, projectPin: "2.8.0", projectVersion: "2.8.0" });
      await receive({ type: "update-cli" });
      expect(mocks.updateCli).not.toHaveBeenCalled();
      expect(webview.html).toContain("固定バージョンが変わったため、CLI の更新を中止しました。");
    });
  });

  describe("version check", () => {
    it("focuses the action the version check asked for", async () => {
      const { context, receive, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project", "update-project");
      await receive({ type: "ready" });
      expect(webview.postMessage).toHaveBeenCalledWith({ type: "focus", id: "apply" });
      // The automatic check redrew the page; its new copy goes back to the same action.
      webview.postMessage.mockClear();
      await receive({ type: "ready" });
      expect(webview.postMessage).toHaveBeenCalledWith({ type: "focus", id: "apply" });
      webview.postMessage.mockClear();
      await receive({ type: "ready" });
      expect(webview.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "focus" }),
      );
    });

    it("reads out the new status once an action redraws the page", async () => {
      mocks.update.mockResolvedValue({ ok: false, reason: "preflight", target, problems: [] });
      const { context, receive, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      await receive({ type: "ready" });
      expect(webview.postMessage).not.toHaveBeenCalledWith({ type: "focus", id: "status" });
      await receive({ type: "apply" });
      await receive({ type: "ready" });
      expect(webview.postMessage).toHaveBeenCalledWith({ type: "focus", id: "status" });
      webview.postMessage.mockClear();
      await receive({ type: "ready" });
      expect(webview.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "focus" }));
    });

    it("focuses the re-check instead of Doctor when no tool is detected to diagnose", async () => {
      mocks.gate.mockReturnValue({ ...olderGate, status: "unknown" });
      mocks.inspect.mockReturnValue({ ...state, tools: [] });
      const { context, receive, webview } = openPanel();
      await openWorkflowsUpdatePanel(context, "project", "doctor");
      await receive({ type: "ready" });
      expect(webview.postMessage).toHaveBeenCalledWith({ type: "focus", id: "recheck" });
    });

    it("says the versions match once a blocked workspace is fixed", async () => {
      const { context, receive, shown } = openPanel();
      await openWorkflowsUpdatePanel(context, "project", "update-project");
      mocks.gate.mockReturnValue({ ...okGate, native: true, engine: target });
      mocks.inspect.mockReturnValue(current);
      await receive({ type: "refresh" });
      const { byId, primary, dom } = shown();
      expect(byId("status").textContent).toContain("最新です");
      expect(primary()).toEqual(["open-dashboard"]);
      dom.window.close();
    });

    it("copies the commands back from a newer project", async () => {
      mocks.gate.mockReturnValue({
        ...olderGate,
        status: "project-newer",
        rollback: {
          kind: "commands",
          commands: [`aidlc config --pin ${target} --yes`, "aidlc config --harness claude --yes"],
        },
      });
      const { context, receive } = openPanel();
      await openWorkflowsUpdatePanel(context, "project");
      await receive({ type: "copy-rollback" });
      expect(mocks.clipboard).toHaveBeenCalledWith(
        `aidlc config --pin ${target} --yes\naidlc config --harness claude --yes`,
      );
    });

    describe("a newer machine default on an unpinned project", () => {
      const newerCli: CliManagementState = {
        ...cli,
        machineVersion: NEWER_WORKFLOWS_VERSION,
        projectPin: null,
        projectVersion: target,
        effectiveVersion: NEWER_WORKFLOWS_VERSION,
        setupReady: false,
        engineNewer: true,
        status: "blocked",
      };
      const engineNewerGate: VersionGate = {
        ...okGate,
        status: "engine-newer",
        native: true,
        engine: NEWER_WORKFLOWS_VERSION,
        message: "この PC のエンジンが新しいバージョンです。",
      };
      beforeEach(() => {
        mocks.gate.mockReturnValue(engineNewerGate);
        mocks.inspect.mockReturnValue({ ...current, projectPin: null });
        mocks.inspectCli.mockReturnValue(newerCli);
      });

      it("focuses the pin the version check asked for", async () => {
        const { context, receive, webview } = openPanel();
        await openWorkflowsUpdatePanel(context, "project", "pin-project");
        await receive({ type: "ready" });
        expect(webview.postMessage).toHaveBeenCalledWith({ type: "focus", id: "pin-project" });
      });

      it("pins after confirmation and offers the commit for the new pin", async () => {
        mocks.warn.mockResolvedValue("固定する");
        mocks.snapshot
          .mockResolvedValueOnce(new Map())
          .mockResolvedValueOnce(new Map([[".aidlc-version", "??"]]));
        mocks.pinCli.mockImplementation(async () => {
          mocks.gate.mockReturnValue({ ...okGate, native: true, engine: target, pin: target });
          return { ...okResult, message: "固定しました" };
        });
        const { context, receive, shown } = openPanel();
        await openWorkflowsUpdatePanel(context, "project");
        await receive({ type: "pin-project" });
        expect(mocks.warn).toHaveBeenCalledWith(
          `${target} に固定（既定 ${NEWER_WORKFLOWS_VERSION}）`,
          { modal: true },
          "固定する",
        );
        expect(mocks.pinCli).toHaveBeenCalledOnce();
        expect(mocks.useTargetCli).not.toHaveBeenCalled();
        const { byId, primary, document, dom } = shown();
        expect(byId("status").textContent).toContain(`${target} に固定しました`);
        expect(primary()).toEqual(["copy-commit"]);
        expect(document.querySelector("#shared-files")?.textContent).toBe(".aidlc-version");
        dom.window.close();
        await receive({ type: "copy-commit" });
        expect(mocks.clipboard).toHaveBeenCalledWith(`chore: aidlc-workflows を ${target} に固定`);
      });

      it("moves the default back only after confirmation, and offers no commit", async () => {
        mocks.warn.mockResolvedValueOnce(undefined).mockResolvedValueOnce("戻す");
        mocks.useTargetCli.mockResolvedValue({ ...okResult, message: "戻しました" });
        const { context, receive, webview } = openPanel();
        await openWorkflowsUpdatePanel(context, "project");
        await receive({ type: "use-target" });
        expect(mocks.useTargetCli).not.toHaveBeenCalled();
        expect(webview.html).toContain("中止しました。");
        await receive({ type: "use-target" });
        expect(mocks.useTargetCli).toHaveBeenCalledOnce();
        expect(mocks.pinCli).not.toHaveBeenCalled();
        expect(webview.html).not.toContain('id="copy-commit"');
      });

      it("does nothing once the situation no longer applies", async () => {
        mocks.inspectCli.mockReturnValue(cli);
        const { context, receive } = openPanel();
        await openWorkflowsUpdatePanel(context, "project");
        await receive({ type: "pin-project" });
        expect(mocks.warn).not.toHaveBeenCalled();
        expect(mocks.pinCli).not.toHaveBeenCalled();
      });
    });
  });
});

describe("update messages", () => {
  it("distinguishes applied settings with failed diagnostics from preflight and partial failures", () => {
    const result = { ok: false, target };
    expect(workflowsUpdateMessage({ ...result, reason: "doctor" }, [])).toContain(
      "設定反映済み・診断未完了",
    );
    expect(workflowsUpdateMessage({ ...result, reason: "doctor" }, [])).toContain(
      "「Doctor で診断」",
    );
    expect(workflowsUpdateMessage({ ...result, reason: "runtime-required" }, [])).toContain(
      "必要な実行環境を準備できませんでした",
    );
    expect(workflowsUpdateMessage({ ...result, reason: "preflight" }, [])).toContain(
      "エンジンは未更新",
    );
    expect(
      workflowsUpdateMessage(result, [
        { id: "claude", status: "completed", message: "applied" },
        { id: "cursor", status: "failed", message: "failed" },
        { id: "codex", status: "pending", message: "pending" },
      ]),
    ).toContain("設定反映済み 1 件、失敗 1 件、未実行 1 件");
    const failed = cliUpdateMessage({
      ok: false,
      stage: "install",
      message: "取得に失敗",
      details: "timeout",
      applied: true,
      recovery: "restored",
      nextAction: "通信を確認してください。",
    });
    expect(failed).toContain("CLI の導入で停止");
    expect(failed).toContain("以前の既定バージョンに戻しました");
    expect(failed).toContain("通信を確認");
  });

  it("shows rollback failures alongside the original failure and explains a missing previous runtime", () => {
    const result = { ok: false, target };
    for (const reason of ["preflight", "pin-failed", "cancelled", "claude, cursor"]) {
      const message = workflowsUpdateMessage({ ...result, reason, recovery: "failed" }, []);
      expect(message).toContain("以前のバージョンへの復元にも失敗");
      expect(message).toContain(".aidlc-version と CLI のバージョン");
      expect(message).not.toContain("復元を確認しました");
    }
    expect(
      workflowsUpdateMessage({ ...result, reason: "preflight", recovery: "restored" }, []),
    ).toContain("更新前のバージョンへの復元を確認しました");
    const missing = workflowsUpdateMessage({ ...result, reason: "previous-runtime-required" }, []);
    expect(missing).toContain("更新前に停止");
    expect(missing).toContain("旧固定バージョンの CLI を公式手順で復元");
    expect(missing).toContain("設定は変更していません");
  });
});
