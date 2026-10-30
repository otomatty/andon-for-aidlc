import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  watcherDispose: vi.fn(),
  item: { text: "", tooltip: "", command: "", show: vi.fn() },
}));
vi.mock("@andon/api-core", () => ({
  createGuideService: mocks.create,
  routePost: vi.fn(),
  routeRead: vi.fn(),
  UNKNOWN_ROUTE: {},
}));
vi.mock("vscode", () => ({
  RelativePattern: class {},
  workspace: {
    createFileSystemWatcher: () => ({ onDidCreate: vi.fn(), dispose: mocks.watcherDispose }),
  },
  StatusBarAlignment: { Left: 1 },
  window: { createStatusBarItem: () => mocks.item },
}));
vi.mock("../src/official-docs-root.ts", () => ({ resolveOfficialDocsRoot: () => "docs" }));

import { acquireSession, closeAllSessions, disposeAllSessions } from "../src/guide-session.ts";
import { createStatusBar, refreshStatusBar, startStatusBarRefresh } from "../src/status-bar.ts";

function service() {
  const unwatch = vi.fn();
  return {
    unwatch,
    startWatch: vi.fn(() => unwatch),
    startMatrixBackground: vi.fn(),
    hub: { add: vi.fn(), remove: vi.fn() },
    versionGate: vi.fn((): { status: string; message: string } | null => null),
    reader: {
      getWorkflow: vi.fn().mockResolvedValue({ ok: true, value: { currentStage: null } }),
      getTimings: vi.fn().mockResolvedValue({ error: true }),
    },
  };
}
const context = () =>
  ({
    extensionPath: "extension",
    subscriptions: [],
    workspaceState: { get: vi.fn() },
  }) as unknown as ExtensionContext;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.create.mockImplementation(service);
});
afterEach(async () => {
  await closeAllSessions();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("workspace session ownership", () => {
  it("shows that an update is needed instead of reading a blocked workspace", async () => {
    createStatusBar(context());
    const blocked = service();
    blocked.versionGate.mockReturnValue({
      status: "project-older",
      message: "プロジェクトの aidlc-workflows 2.10.0 は古いバージョンです。",
    });
    mocks.create.mockReturnValueOnce(blocked);
    await refreshStatusBar("blocked-test");
    expect(mocks.item.text).toBe("$(warning) Andon: 更新が必要");
    expect(mocks.item.tooltip).toContain("2.10.0 は古いバージョンです");
    expect(blocked.reader.getWorkflow).not.toHaveBeenCalled();
  });

  it("labels inferred work, an overrun and the pending observation in status details", async () => {
    createStatusBar(context());
    const currentService = service();
    currentService.reader.getWorkflow.mockResolvedValue({
      ok: true,
      value: { currentStage: "code-generation", phase: "CONSTRUCTION", record: { space: "default", intent: "test" } },
    });
    currentService.reader.getTimings.mockResolvedValue({
      ok: true,
      value: {
        space: "default", intent: "test",
        currentStage: "code-generation",
        stageViews: [
          {
            stage: "code-generation",
            isCurrent: true,
            running: true,
            elapsedActiveMs: 21 * 60_000,
            estimateMs: 20 * 60_000,
            remainingMs: 0,
            sinceLastObservationMs: 7 * 60_000,
            basis: "stage",
            sampleCount: 3,
          },
        ],
      },
    });
    mocks.create.mockReturnValueOnce(currentService);
    await refreshStatusBar("timing-test");
    expect(mocks.item.text).toContain("作業時間 21m / 見積り超過");
    expect(mocks.item.tooltip).toContain("0m（見積り超過・未完了）");
    expect(mocks.item.tooltip).toContain("最終記録から: 7m（作業へ未加算）");
  });

  it.each([
    { space: "other", intent: "test" },
    { space: "default", intent: "other" },
    { intent: "test" },
  ])("omits same-stage timings from a different or unknown record: %s", async (identity) => {
    createStatusBar(context());
    const currentService = service();
    currentService.reader.getWorkflow.mockResolvedValue({
      ok: true,
      value: { currentStage: "code-generation", phase: "CONSTRUCTION", record: { space: "default", intent: "test" } },
    });
    currentService.reader.getTimings.mockResolvedValue({
      ok: true,
      value: {
        ...identity,
        currentStage: "code-generation",
        stageViews: [{ stage: "code-generation", isCurrent: true, elapsedActiveMs: 60_000, remainingMs: 0 }],
      },
    });
    mocks.create.mockReturnValueOnce(currentService);
    await refreshStatusBar("record-switch-test");
    expect(mocks.item.text).toBe("$(list-tree) code-generation");
    expect(mocks.item.tooltip).not.toContain("作業時間");
  });

  describe("next approval gate", () => {
    const MIN = 60_000;
    const view = {
      stage: "nfr-requirements",
      isCurrent: true,
      running: true,
      elapsedActiveMs: 4 * MIN,
      estimateMs: 10 * MIN,
      remainingMs: 6 * MIN,
      basis: "stage",
      sampleCount: 3,
    };
    const gate = {
      kind: "stage",
      stage: "deployment-pipeline",
      remainingMs: 92 * MIN,
      stages: ["nfr-requirements", "code-generation", "build-and-test", "deployment-pipeline"],
      autoApproved: ["nfr-requirements", "code-generation", "build-and-test"],
      planApproval: true,
      lowConfidence: false,
      estimateCoverage: { known: 4, unknown: 0 },
    };

    async function refreshWith(nextGate: object, stageView: object = view): Promise<void> {
      createStatusBar(context());
      const currentService = service();
      currentService.reader.getWorkflow.mockResolvedValue({
        ok: true,
        value: { currentStage: "nfr-requirements", phase: "CONSTRUCTION", record: { space: "default", intent: "test" } },
      });
      currentService.reader.getTimings.mockResolvedValue({
        ok: true,
        value: { space: "default", intent: "test", currentStage: "nfr-requirements", stageViews: [stageView], nextGate },
      });
      mocks.create.mockReturnValueOnce(currentService);
      await refreshStatusBar("next-gate-test");
    }

    it("shows the work until the next approval gate and details the gate", async () => {
      await refreshWith(gate);
      expect(mocks.item.text).toBe(
        "$(list-tree) nfr-requirements · 作業時間 4m / 次の承認まで ≈1h32m",
      );
      expect(mocks.item.tooltip).toContain("残り時間: ≈6m");
      expect(mocks.item.tooltip).toContain("次の承認: deployment-pipeline の承認");
      expect(mocks.item.tooltip).toContain("次の承認までの作業: ≈1h32m");
      expect(mocks.item.tooltip).toContain(
        "承認なしで進むステージ: nfr-requirements、code-generation、build-and-test",
      );
      expect(mocks.item.tooltip).toContain("コード生成の前に計画承認があります");
    });

    it("shows an open gate as waiting for approval", async () => {
      await refreshWith({ ...gate, kind: "open", stage: "nfr-requirements", remainingMs: 0, stages: [], autoApproved: [], planApproval: false });
      expect(mocks.item.text).toBe("$(list-tree) nfr-requirements · 作業時間 4m / 承認待ち");
      expect(mocks.item.tooltip).toContain("次の承認: nfr-requirements の承認（承認待ち）");
      expect(mocks.item.tooltip).not.toContain("次の承認までの作業");
    });

    it("says when no approval gate is left, with the work to completion", async () => {
      await refreshWith({ ...gate, kind: "none", stage: null, remainingMs: 15 * MIN });
      expect(mocks.item.text).toBe("$(list-tree) nfr-requirements · 作業時間 4m / 承認ゲートなし");
      expect(mocks.item.tooltip).toContain("次の承認: なし");
      expect(mocks.item.tooltip).toContain("完了までの作業: ≈15m");
    });

    it("marks an overrun only when the overrun stage is all that is left", async () => {
      const overrun = { ...view, elapsedActiveMs: 12 * MIN, remainingMs: 0 };
      const alone = {
        ...gate,
        stage: "nfr-requirements",
        remainingMs: 0,
        stages: ["nfr-requirements"],
        autoApproved: [],
        planApproval: false,
      };
      await refreshWith(alone, overrun);
      expect(mocks.item.text).toBe("$(list-tree) nfr-requirements · 作業時間 12m / 見積り超過");
      expect(mocks.item.tooltip).toContain("次の承認までの作業: ≈0m（見積り超過・未完了）");
      await refreshWith(gate, overrun);
      expect(mocks.item.text).toBe(
        "$(list-tree) nfr-requirements · 作業時間 12m / 次の承認まで ≈1h32m",
      );
    });

    it("keeps an unknown or partial sum honest, and says a Unit approval can come sooner", async () => {
      await refreshWith({ ...gate, kind: "unit", remainingMs: null, estimateCoverage: { known: 0, unknown: 4 } });
      expect(mocks.item.text).toBe("$(list-tree) nfr-requirements · 作業時間 4m / 次の承認まで —");
      expect(mocks.item.tooltip).toContain("次の承認までの作業: —（Unit が複数あると早まります）");
      await refreshWith({ ...gate, estimateCoverage: { known: 3, unknown: 1 } });
      expect(mocks.item.tooltip).toContain("推定できない 1 工程を含みません");
    });
  });

  it("stops each obsolete status-bar watcher and releases the cached session", () => {
    const ctx = context();
    createStatusBar(ctx);
    for (const root of ["a", "b", "c"]) {
      const refresh = startStatusBarRefresh(ctx, root);
      const created = mocks.create.mock.results.at(-1)?.value;
      refresh.dispose();
      refresh.dispose();
      expect(created.unwatch).toHaveBeenCalledTimes(1);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.watcherDispose).toHaveBeenCalledTimes(3);
    const reopened = acquireSession("a");
    expect(mocks.create).toHaveBeenCalledTimes(4);
    reopened.dispose();
  });

  it("keeps the shared session alive until both status bar and dashboard release it", () => {
    const refresh = startStatusBarRefresh(context(), "a");
    const dashboard = acquireSession("a");
    const created = mocks.create.mock.results[0]?.value;
    expect(mocks.create).toHaveBeenCalledTimes(1);
    refresh.dispose();
    expect(created.unwatch).not.toHaveBeenCalled();
    dashboard.dispose();
    dashboard.dispose();
    expect(created.unwatch).toHaveBeenCalledTimes(1);
  });

  it("does not release a replacement session through an old lease after deactivation", () => {
    const old = acquireSession("a");
    disposeAllSessions();
    const current = acquireSession("a");
    const created = mocks.create.mock.results[1]?.value;
    old.dispose();
    expect(created.unwatch).not.toHaveBeenCalled();
    current.dispose();
    expect(created.unwatch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "ignores an old status read after folder replacement, including failure=%s",
    async (fails) => {
      const ctx = context();
      createStatusBar(ctx);
      let finish: () => void = () => {};
      const oldService = service();
      oldService.reader.getWorkflow.mockReturnValueOnce(
        new Promise((resolve, reject) => {
          finish = () =>
            fails
              ? reject(new Error("removed"))
              : resolve({ ok: true, value: { currentStage: "old", phase: "construction" } });
        }),
      );
      mocks.create.mockReturnValueOnce(oldService);
      const old = startStatusBarRefresh(ctx, "a");
      old.dispose();
      const nextService = service();
      nextService.reader.getWorkflow.mockResolvedValue({
        ok: true,
        value: { currentStage: "new", phase: "inception" },
      });
      mocks.create.mockReturnValueOnce(nextService);
      const next = startStatusBarRefresh(ctx, "b");
      await Promise.resolve();
      finish();
      await Promise.resolve();
      await Promise.resolve();
      expect(mocks.item.text).toContain("new");
      expect(oldService.unwatch).toHaveBeenCalledTimes(1);
      next.dispose();
    },
  );
});
