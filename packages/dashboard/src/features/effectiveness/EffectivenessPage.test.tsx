import type { EffectivenessPayload, IntentEffectiveness, ReadResult } from "@andon/shared-types";
import { act, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import EffectivenessPanel from "@/features/effectiveness/EffectivenessPage.tsx";
import { summarizeEffectiveness } from "@/features/effectiveness/utils/summary.ts";
import { Header } from "@/shell/Header.tsx";
import { StoreProvider, useDispatch } from "@/store/context.tsx";
import { reducer } from "@/store/reducer.ts";
import { initialState } from "@/store/state.ts";
import { chooseOption } from "@tests/choose-option.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function intent(name: string, overrides: Partial<IntentEffectiveness> = {}): IntentEffectiveness {
  return {
    dirName: name,
    id: name,
    name,
    scope: "mvp",
    depth: "standard",
    status: "Completed",
    startedAt: "2026-09-10T00:00:00Z",
    completedAt: "2026-09-10T02:00:00Z",
    completionMs: 7_200_000,
    elapsedMs: 7_200_000,
    auditEventCount: 20,
    approvalWait: {
      completedMs: 300_000,
      pendingMs: null,
      completedIntervals: 1,
      pendingIntervals: 0,
      excludedIntervals: 0,
    },
    rejections: 0,
    revisions: 0,
    humanTurns: 3,
    reviews: {
      completed: 2,
      ready: 2,
      notReady: 0,
      firstPassReady: 1,
      firstPassTotal: 2,
      firstPassRate: 0.5,
      unmatched: 0,
    },
    sensors: {
      scope: "intent-record",
      verifiedPassed: 3,
      failed: 1,
      skipped: 2,
      incomplete: 1,
      findings: 4,
    },
    usage: null,
    warnings: [],
    ...overrides,
  };
}

function payload(rows = [intent("完成案件")], space = "default"): EffectivenessPayload {
  return { space, generatedAt: "2026-09-11T00:00:00Z", intents: rows, warnings: [] };
}

function Controls() {
  const dispatch = useDispatch();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "intents",
            result: {
              ok: true,
              value: {
                space: "other",
                active: "次の案件",
                selected: "次の案件",
                all: ["次の案件"],
              },
            },
          })
        }
      >
        別のスペース
      </button>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "ws",
            message: { type: "change", scope: "audit", events: [] },
            receivedAt: new Date().toISOString(),
          })
        }
      >
        変更通知
      </button>
    </>
  );
}

function Harness({
  open = false,
  selected = "完成案件",
}: {
  open?: boolean;
  selected?: string | null;
}) {
  return (
    <StoreProvider
      preloaded={{
        route: open ? { name: "effectiveness" } : { name: "home" },
        intents: {
          kind: "success",
          value: { space: "default", selected, active: "完成案件", all: ["完成案件"] },
        },
      }}
    >
      <Header />
      <Controls />
      <EffectivenessPanel />
    </StoreProvider>
  );
}

function stubMetrics(
  load: () => ReadResult<EffectivenessPayload> | Promise<ReadResult<EffectivenessPayload>>,
) {
  const metrics = vi.fn(load);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const result =
        String(input) === "/api/effectiveness" ? await metrics() : { ok: true, value: [] };
      return new Response(JSON.stringify(result));
    }),
  );
  return metrics;
}

describe("effectiveness observations", () => {
  it("keeps the summary and record grids through a delayed data load", async () => {
    vi.useFakeTimers();
    let resolve!: (value: ReadResult<EffectivenessPayload>) => void;
    stubMetrics(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<Harness open />);
    const loadingName = "効果測定を読み込み中";
    expect(screen.queryByRole("status", { name: loadingName })).toBeNull();
    await act(async () => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status", { name: loadingName })).toBeTruthy();
    const summary = screen.getByTestId("effectiveness-summary-skeleton");
    const records = screen.getByTestId("effectiveness-records-skeleton");
    expect(summary.children).toHaveLength(4);
    expect(records.children).toHaveLength(2);
    expect(screen.getByRole("button", { name: "比較条件" }).hasAttribute("disabled")).toBe(true);
    await act(async () => {
      resolve({ ok: true, value: payload([intent("案件A"), intent("案件B")]) });
    });
    const loadedSummary = screen.getByRole("region", { name: "比較対象の集計" });
    const loadedCard = screen.getByTestId("effectiveness-card-案件A");
    expect(loadedSummary.className).toBe(summary.className);
    expect(loadedCard.parentElement?.className).toBe(records.className);
    expect(loadedSummary.children[0]?.getAttribute("data-size")).toBe(
      summary.children[0]?.getAttribute("data-size"),
    );
    expect(screen.queryByRole("status", { name: loadingName })).toBeNull();
    expect(screen.getByRole("button", { name: "比較条件" }).hasAttribute("disabled")).toBe(false);
  });

  it("opens directly from the picker without selecting an intent", async () => {
    const calls = stubMetrics(() => ({ ok: true, value: payload() }));
    render(<Harness selected={null} />);
    expect(screen.getByTestId("intent-dialog")).toBeTruthy();
    expect(calls).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "効果測定を見る" }));
    expect(await screen.findByTestId("effectiveness-card-完成案件")).toBeTruthy();
    expect(screen.queryByTestId("intent-dialog")).toBeNull();
    await userEvent.click(screen.getByText("変更通知"));
    await screen.findByTestId("effectiveness-card-完成案件");
    expect(screen.queryByTestId("intent-dialog")).toBeNull();
  });

  it("renders zero minutes distinctly and keeps long descriptions compact", async () => {
    const longName = "とても長い案件の説明".repeat(40);
    stubMetrics(() => ({
      ok: true,
      value: payload([
        intent("stable-id", {
          name: longName,
          completionMs: 0,
          approvalWait: {
            completedMs: 0,
            pendingMs: null,
            completedIntervals: 1,
            pendingIntervals: 0,
            excludedIntervals: 0,
          },
        }),
      ]),
    }));
    render(<Harness open />);
    const row = await screen.findByTestId("effectiveness-card-stable-id");
    expect(within(row).getAllByText("0m")).toHaveLength(2);
    expect(row.textContent).not.toContain("<1m");
    expect(within(row).getByText("stable-id")).toBeTruthy();
    expect(within(row).getByTitle(longName).className).toContain("line-clamp-2");
  });
  it("explains why current unassigned human receipts cannot provide an input count", async () => {
    stubMetrics(() => ({
      ok: true,
      value: payload([
        intent("実行先不明", {
          humanTurns: null,
          warnings: ["human turns without workflow attribution excluded"],
        }),
      ]),
    }));
    render(<Harness open />);
    const row = within(await screen.findByTestId("effectiveness-card-実行先不明"));
    await userEvent.click(row.getByText("記録の内訳・注意 1 件"));
    expect(row.getByText(/人の入力: 判別不可（実行先未記録）/)).toBeTruthy();
  });
  it("loads only while open and stops responding to audit pushes after close", async () => {
    const calls = stubMetrics(() => ({ ok: true, value: payload() }));
    render(<Harness />);
    expect(calls).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("header-menu-trigger"));
    await userEvent.click(await screen.findByTestId("effectiveness-open"));
    expect(await screen.findByTestId("effectiveness-card-完成案件")).toBeTruthy();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "効果測定" }));
    await userEvent.click(screen.getByTestId("header-menu-trigger"));
    expect((await screen.findByTestId("effectiveness-open")).getAttribute("aria-current")).toBe(
      "page",
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("effectiveness-panel")).toBeTruthy();
    expect(screen.queryByTestId("effectiveness-close")).toBeNull();
    await userEvent.click(screen.getByTestId("header-menu-trigger"));
    await userEvent.click(await screen.findByTestId("header-home"));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("header-menu-trigger"));
    });
    await userEvent.click(screen.getByText("変更通知"));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("effectiveness-panel")).toBeNull();
  });

  it("separates zero, missing data, pending wait, and unfinished lead time", async () => {
    stubMetrics(() => ({
      ok: true,
      value: payload([
        intent("完成案件"),
        intent("進行案件", {
          status: "Active",
          completedAt: null,
          completionMs: null,
          elapsedMs: 600_000,
          rejections: null,
          sensors: null,
          reviews: null,
          approvalWait: {
            completedMs: null,
            pendingMs: 120_000,
            completedIntervals: 0,
            pendingIntervals: 1,
            excludedIntervals: 0,
          },
        }),
        intent("完了日時不明", {
          auditEventCount: null,
          completedAt: null,
          completionMs: null,
          elapsedMs: 999_000,
          reviews: {
            completed: 0,
            ready: 0,
            notReady: 0,
            firstPassReady: 0,
            firstPassTotal: 0,
            firstPassRate: null,
            unmatched: 0,
          },
        }),
      ]),
    }));
    render(<Harness open />);
    const complete = within(await screen.findByTestId("effectiveness-card-完成案件"));
    expect(complete.getByText("0 件")).toBeTruthy();
    await userEvent.click(complete.getByText("記録の内訳"));
    expect(complete.getByText(/案件内の品質チェック（通常・単独実行の合計）/)).toBeTruthy();
    expect(screen.getByText("通常・単独実行を含む、検証結果の証跡がある合格")).toBeTruthy();
    const active = within(screen.getByTestId("effectiveness-card-進行案件"));
    expect(active.getByText("進行中の経過")).toBeTruthy();
    expect(active.getAllByText("未記録").length).toBe(2);
    expect(active.getByText("確定分は未記録")).toBeTruthy();
    expect(active.getByText("待機中 2m")).toBeTruthy();
    const unknown = within(screen.getByTestId("effectiveness-card-完了日時不明"));
    expect(unknown.queryByText("進行中の経過")).toBeNull();
    expect(unknown.getAllByText("未記録").length).toBeGreaterThan(0);
    await userEvent.click(unknown.getByText("記録の内訳"));
    expect(unknown.getByText(/^監査イベント: 未記録/)).toBeTruthy();
    expect(complete.getByText(/^監査イベント: 20 件/)).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "比較対象の集計" })).getByText(
        /完了の記録あり 1 \/ 3 件/,
      ),
    ).toBeTruthy();
  });

  it("excludes unavailable sensor evidence from coverage and preserves its warning", async () => {
    const missing = intent("対応不明の検査", {
      sensors: null,
      warnings: ["sensor receipt missing correlation fields"],
    });
    expect(summarizeEffectiveness([missing]).sensors.count).toBe(0);
    stubMetrics(() => ({ ok: true, value: payload([missing]) }));
    render(<Harness open />);
    const row = within(await screen.findByTestId("effectiveness-card-対応不明の検査"));
    expect(row.getByText("品質チェック").nextElementSibling?.textContent).toBe("未記録");
    await userEvent.click(row.getByText("記録の内訳・注意 1 件"));
    expect(row.getByText("sensor receipt missing correlation fields")).toBeTruthy();
    expect(screen.getByText("記録あり 0 / 1 件")).toBeTruthy();
    expect(row.queryByText(/失敗 0/)).toBeNull();
  });
  it("shows unavailable findings separately from a measured zero", async () => {
    const unknown = intent("指摘数不明");
    if (!unknown.sensors) throw new Error("missing fixture sensors");
    unknown.sensors.findings = null;
    const zero = intent("指摘ゼロ");
    if (!zero.sensors) throw new Error("missing fixture sensors");
    zero.sensors.findings = 0;
    stubMetrics(() => ({ ok: true, value: payload([unknown, zero]) }));
    render(<Harness open />);
    const missing = within(await screen.findByTestId("effectiveness-card-指摘数不明"));
    await userEvent.click(missing.getByText("記録の内訳"));
    expect(missing.getByText(/指摘数は未記録/)).toBeTruthy();
    expect(missing.queryByText(/指摘 0 件/)).toBeNull();
    const measured = within(screen.getByTestId("effectiveness-card-指摘ゼロ"));
    await userEvent.click(measured.getByText("記録の内訳"));
    expect(measured.getByText(/指摘 0 件/)).toBeTruthy();
  });
  it("shows the four workflow metrics without review or usage details", async () => {
    const row = intent("完成案件", {
      usage: {
        source: "claude-ledger",
        inputTokens: 1_000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        estimatedUsd: 0.05,
        partial: false,
        unknownModels: [],
      },
    });
    stubMetrics(() => ({ ok: true, value: payload([row]) }));
    render(<Harness open />);
    const card = within(await screen.findByTestId("effectiveness-card-完成案件"));
    const summary = screen.getByRole("region", { name: "比較対象の集計" });
    expect(summary.children).toHaveLength(4);
    expect(within(summary).getByText("完了までの時間")).toBeTruthy();
    expect(within(summary).getByText("承認待ち")).toBeTruthy();
    expect(within(summary).getByText("差し戻し")).toBeTruthy();
    expect(within(summary).getByText("案件内の品質チェック")).toBeTruthy();
    await userEvent.click(card.getByText("記録の内訳"));
    expect(screen.getByTestId("effectiveness-panel").textContent).not.toMatch(
      /初回合格率|レビュー|READY|トークン|費用|キャッシュ|50%/,
    );
  });

  it("retains scope/depth filters across manual and push refreshes", async () => {
    const calls = stubMetrics(() => ({
      ok: true,
      value: payload([
        intent("対象"),
        intent("別scope", { scope: "fix" }),
        intent("別depth", { depth: "minimal" }),
      ]),
    }));
    render(<Harness open />);
    await screen.findByTestId("effectiveness-card-対象");
    expect(screen.queryByRole("combobox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "比較条件" }));
    await screen.findByRole("dialog", { name: "比較する案件" });
    await chooseOption("Scope（対象範囲）", "mvp");
    await chooseOption("Depth（進め方の深さ）", "standard");
    await userEvent.click(screen.getByRole("button", { name: "適用" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("effectiveness-card-別scope")).toBeNull();
    expect(screen.queryByTestId("effectiveness-card-別depth")).toBeNull();
    await userEvent.click(screen.getByTestId("effectiveness-refresh"));
    await screen.findByTestId("effectiveness-card-対象");
    await userEvent.click(screen.getByText("変更通知"));
    await screen.findByTestId("effectiveness-card-対象");
    expect(calls).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("effectiveness-card-別depth")).toBeNull();
    expect(screen.getByText("表示 1 / 3 件")).toBeTruthy();
  });

  it("exposes partial data without showing diagnostic bodies upfront", async () => {
    stubMetrics(() => ({
      ok: true,
      warnings: ["unreadable shard"],
      value: {
        ...payload([
          intent("検査記録", {
            warnings: ["sensor receipt missing correlation fields"],
          }),
        ]),
        warnings: ["unreadable shard"],
      },
    }));
    render(<Harness open />);
    const row = await screen.findByTestId("effectiveness-card-検査記録");
    expect(screen.getByText("一部の記録を集計できません")).toBeTruthy();
    const notes = screen.getByRole("button", { name: "集計の注意 1 件" });
    expect(notes.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("unreadable shard")).toBeNull();
    await userEvent.click(within(row).getByText(/記録の内訳/));
    expect(within(row).getByText(/省略と証跡不足は合格に含めません/)).toBeTruthy();
    expect(within(row).getByText("sensor receipt missing correlation fields")).toBeTruthy();
  });

  it("discards a previous space's delayed response", async () => {
    let resolveOld: (value: ReadResult<EffectivenessPayload>) => void = () => {};
    const old = new Promise<ReadResult<EffectivenessPayload>>((resolve) => {
      resolveOld = resolve;
    });
    let count = 0;
    stubMetrics(() =>
      ++count === 1 ? old : { ok: true, value: payload([intent("次の案件")], "other") },
    );
    render(<Harness open />);
    await userEvent.click(screen.getByText("別のスペース"));
    await screen.findByTestId("effectiveness-card-次の案件");
    await act(async () => {
      resolveOld({ ok: true, value: payload([intent("古い案件")]) });
    });
    expect(screen.queryByTestId("effectiveness-card-古い案件")).toBeNull();
    expect(screen.getByTestId("effectiveness-card-次の案件")).toBeTruthy();
  });

  it("keeps the newer push response when the first request finishes late", async () => {
    let resolveOld: (value: ReadResult<EffectivenessPayload>) => void = () => {};
    const old = new Promise<ReadResult<EffectivenessPayload>>((resolve) => {
      resolveOld = resolve;
    });
    let count = 0;
    stubMetrics(() => (++count === 1 ? old : { ok: true, value: payload([intent("新しい集計")]) }));
    render(<Harness open />);
    await userEvent.click(screen.getByText("変更通知"));
    await screen.findByTestId("effectiveness-card-新しい集計");
    await act(async () => {
      resolveOld({ ok: true, value: payload([intent("古い集計")]) });
    });
    expect(screen.queryByTestId("effectiveness-card-古い集計")).toBeNull();
  });

  it("recovers from an unavailable endpoint and shows an empty space", async () => {
    let count = 0;
    stubMetrics(() =>
      ++count === 1
        ? { error: true, reason: "server-unreachable" }
        : { ok: true, value: payload([]) },
    );
    render(<Harness open />);
    expect(await screen.findByText("読み込みエラー")).toBeTruthy();
    await userEvent.click(screen.getByTestId("effectiveness-refresh"));
    expect(await screen.findByText("計測対象の案件がありません")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("does not merge completed and ongoing durations or treat missing amounts as zero", () => {
    const total = summarizeEffectiveness([
      intent("a", { completionMs: 60_000 }),
      intent("b", { completionMs: 180_000 }),
      intent("c", {
        completionMs: null,
        elapsedMs: 99_000_000,
        rejections: null,
        approvalWait: null,
        reviews: null,
        sensors: null,
      }),
    ]);
    expect(total.completed).toEqual({ median: 120_000, count: 2 });
    expect(total.rejections).toEqual({ total: 0, count: 2 });
  });
  it("excludes unmeasurable waits from coverage while retaining their diagnostics", async () => {
    const excluded = intent("除外のみ", {
      approvalWait: {
        completedMs: null,
        pendingMs: null,
        completedIntervals: 0,
        pendingIntervals: 0,
        excludedIntervals: 2,
      },
    });
    const paired = intent("実測ゼロ", {
      approvalWait: {
        completedMs: 0,
        pendingMs: null,
        completedIntervals: 1,
        pendingIntervals: 0,
        excludedIntervals: 0,
      },
    });
    const pending = intent("待機中のみ", {
      approvalWait: {
        completedMs: null,
        pendingMs: 60_000,
        completedIntervals: 0,
        pendingIntervals: 1,
        excludedIntervals: 0,
      },
    });
    const total = summarizeEffectiveness([excluded, paired, pending]);
    expect(total.waits).toEqual({ count: 1, pendingCount: 1, completedMs: 0, pendingMs: 60_000 });
    const calls = stubMetrics(() => ({ ok: true, value: payload([excluded]) }));
    render(<Harness open />);
    const row = within(await screen.findByTestId("effectiveness-card-除外のみ"));
    expect(row.getByText("承認待ち").nextElementSibling?.textContent).toBe("未記録");
    await userEvent.click(row.getByText(/記録の内訳/));
    expect(row.getByText(/集計除外 2 区間/)).toBeTruthy();
    const summary = within(screen.getByRole("region", { name: "比較対象の集計" }));
    expect(summary.getByText("記録あり 0 / 1 件。計測中の待機なし。")).toBeTruthy();
    expect(summary.queryByText("0m")).toBeNull();
    calls.mockReturnValue({ ok: true, value: payload([excluded, paired, pending]) });
    await userEvent.click(screen.getByTestId("effectiveness-refresh"));
    const zero = within(await screen.findByTestId("effectiveness-card-実測ゼロ"));
    expect(zero.getByText("承認待ち").nextElementSibling?.textContent).toBe("0m確定分");
    expect(screen.getByText("記録あり 1 / 3 件。待機中 1m は別集計。")).toBeTruthy();
  });

  it("opens a route exclusive of the other panels and closes on home/stage/docs navigation", () => {
    const open = reducer(
      { ...initialState, route: { name: "plugins" } },
      { type: "effectiveness", open: true },
    );
    expect(open.route).toEqual({ name: "effectiveness" });
    expect(reducer(open, { type: "home" }).route).toEqual({ name: "home" });
    expect(
      reducer(open, { type: "select", selection: { kind: "stage", slug: "code-generation" } }).route
        .name,
    ).toBe("stage");
    expect(reducer(open, { type: "docs-shell", open: true }).route.name).toBe("docs");
  });
});
