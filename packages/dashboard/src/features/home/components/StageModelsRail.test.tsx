import type {
  ReadResult,
  StageModelSettings,
  StageModelsPayload,
  TimingsPayload,
} from "@aidlc-guide/shared-types";
import { act, render, screen, waitFor, within } from "@tests/render.tsx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StageModelLabel } from "@/features/home/components/StageModelLabel.tsx";
import { StageModelsRail } from "@/features/home/components/StageModelsRail.tsx";
import { StageRail } from "@/features/home/components/StageRail.tsx";
import { fetchStageModels } from "@/services/api.ts";
import { stageView, workflow } from "@tests/fixtures.ts";

vi.mock("@/services/api.ts", () => ({ fetchStageModels: vi.fn() }));
beforeEach(() => vi.mocked(fetchStageModels).mockReset());

describe("stage model display", () => {
  it("replaces the default with recorded models without a settings selector", async () => {
    vi.mocked(fetchStageModels).mockResolvedValue({
      ok: true,
      value: {
        harnesses: [{ id: "claude", label: "Claude Code", stages: [] }],
        observed: { "code-generation": ["fable-5.1"] },
      },
    });
    render(
      <StageModelsRail
        state={{ kind: "success", value: workflow() }}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(await screen.findByText("担当: fable-5.1")).toBeDefined();
    const row = within(screen.getByTestId("stage-rail-item-code-generation"));
    expect(row.queryByText("担当: デフォルト")).toBeNull();
    expect(screen.queryByLabelText("モデル設定の表示元")).toBeNull();
    expect(screen.queryByText(/セッションを継承/)).toBeNull();
    expect(screen.queryByText(/レビュー設定:/)).toBeNull();
  });
  it("distinguishes API failure from missing usage without restoring a settings selector", async () => {
    vi.mocked(fetchStageModels).mockResolvedValue({ error: true, reason: "unavailable" });
    render(
      <StageModelsRail
        state={{ kind: "success", value: workflow() }}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    await waitFor(() => expect(fetchStageModels).toHaveBeenCalled());
    const row = within(screen.getByTestId("stage-rail-item-code-generation"));
    expect(await row.findByText("担当: 取得できません")).toBeDefined();
    expect(row.queryByText("担当: デフォルト")).toBeNull();
    expect(row.queryByTitle("使用記録がないため、デフォルトと表示しています。")).toBeNull();
    expect(screen.queryByLabelText("モデル設定の表示元")).toBeNull();
    expect(screen.queryByText("モデル設定を取得できません。")).toBeNull();
  });
  it("lists all recorded models without claiming per-agent attribution", () => {
    render(
      <StageRail
        state={{ kind: "success", value: workflow() }}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        observedModels={{ "code-generation": ["fable-5.1", "sonnet-4-6"] }}
      />,
    );
    const row = within(screen.getByTestId("stage-rail-item-code-generation"));
    expect(row.getByText("担当: fable-5.1、sonnet-4-6")).toBeDefined();
    expect(row.queryByText(/使用記録:/)).toBeNull();
    expect(row.queryByText(/レビュー設定:/)).toBeNull();
  });
  it("uses the default when the usage list is empty", () => {
    render(<StageModelLabel stage="code-generation" observed={[]} />);
    expect(screen.getByTestId("stage-models-code-generation").textContent).toBe("担当: デフォルト");
  });
});

const reviewerStage: StageModelSettings = {
  slug: "code-generation",
  mode: "subagent",
  lead: {
    agent: "developer",
    source: "agent",
    model: "configured-only",
    projectModel: null,
    effort: null,
  },
  supports: [
    { agent: "architect", source: "session", model: null, projectModel: null, effort: null },
  ],
  reviewer: {
    agent: "reviewer",
    source: "agent",
    model: "sonnet",
    projectModel: null,
    effort: "medium",
  },
};
const modelResult = (model: string): ReadResult<StageModelsPayload> => ({
  ok: true,
  value: {
    harnesses: [{ id: "claude", label: "Claude Code", stages: [reviewerStage] }],
    observed: { "code-generation": [model] },
  },
});

function pendingModels() {
  let resolve!: (result: ReadResult<StageModelsPayload>) => void;
  const promise = new Promise<ReadResult<StageModelsPayload>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("reviewers and model refresh", () => {
  it("shows one reviewer row across installations without treating configuration or aggregate usage as reviewer evidence", async () => {
    const payload: StageModelsPayload = {
      harnesses: [
        { id: "claude", label: "Claude Code", stages: [reviewerStage] },
        { id: "cursor", label: "Cursor", stages: [reviewerStage] },
      ],
      observed: { "code-generation": ["fable-5.1", "sonnet-4-6"] },
    };
    vi.mocked(fetchStageModels).mockResolvedValue({ ok: true, value: payload });
    render(
      <StageModelsRail
        state={{ kind: "success", value: workflow() }}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(await screen.findByText("レビュワー: デフォルト")).toBeDefined();
    expect(screen.getAllByText("レビュワー: デフォルト")).toHaveLength(1);
    expect(screen.getAllByText("補助: デフォルト")).toHaveLength(1);
    const badges = screen
      .getByTestId("stage-models-code-generation")
      .querySelectorAll('[data-slot="badge"]');
    expect([...badges].map((badge) => badge.textContent)).toEqual([
      "担当: fable-5.1、sonnet-4-6",
      "レビュワー: デフォルト",
      "補助: デフォルト",
    ]);
    expect(screen.getByText("担当: fable-5.1、sonnet-4-6")).toBeDefined();
    expect(
      screen.queryByText(/configured-only|レビュワー: sonnet|レビュー設定|モデル設定の表示元/),
    ).toBeNull();
    expect(
      within(screen.getByTestId("stage-rail-item-build-and-test")).queryByText(/レビュワー:/),
    ).toBeNull();
    expect(
      within(screen.getByTestId("stage-rail-item-build-and-test")).queryByText(/補助:/),
    ).toBeNull();
  });

  it("keeps recorded durations visible during model loading and failure", async () => {
    const pending = pendingModels();
    vi.mocked(fetchStageModels).mockReturnValue(pending.promise);
    const timings: TimingsPayload = {
      intent: "alpha",
      timings: [],
      currentStage: "code-generation",
      remaining: { totalRemainingMs: null, lowConfidence: false },
      stageViews: [
        stageView("code-generation", {
          status: "awaiting-approval",
          isCurrent: true,
          actualActiveMs: 1_320_000,
        }),
      ],
    };
    render(
      <StageModelsRail
        state={{ kind: "success", value: workflow() }}
        timings={timings}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("rail-duration-code-generation").textContent).toBe("22m");
    const models = within(screen.getByTestId("stage-models-code-generation"));
    expect(models.getByText("担当: 読み込み中")).toBeDefined();
    expect(models.queryByText("担当: デフォルト")).toBeNull();
    await act(async () => {
      pending.resolve({ error: true, reason: "unavailable" });
      await pending.promise;
    });
    expect(screen.getByTestId("rail-duration-code-generation").textContent).toBe("22m");
    expect(
      within(screen.getByTestId("stage-rail-item-code-generation")).getByText(
        "担当: 取得できません",
      ),
    ).toBeDefined();
  });

  it("ignores an earlier response that completes after the latest refresh", async () => {
    const older = pendingModels();
    const newer = pendingModels();
    vi.mocked(fetchStageModels)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const props = { onSelect: vi.fn(), onRetry: vi.fn() };
    const view = render(
      <StageModelsRail {...props} state={{ kind: "success", value: workflow() }} />,
    );
    view.rerender(<StageModelsRail {...props} state={{ kind: "success", value: workflow() }} />);
    await act(async () => {
      newer.resolve(modelResult("new-model"));
      await newer.promise;
    });
    expect(await screen.findByText("担当: new-model")).toBeDefined();
    await act(async () => {
      older.resolve(modelResult("old-model"));
      await older.promise;
    });
    expect(screen.getByText("担当: new-model")).toBeDefined();
    expect(screen.queryByText("担当: old-model")).toBeNull();
  });

  it("keeps the default and reviewer badges in place while a feed refresh is in flight", async () => {
    vi.mocked(fetchStageModels).mockResolvedValueOnce({
      ok: true,
      value: {
        harnesses: [{ id: "claude", label: "Claude Code", stages: [reviewerStage] }],
        observed: {},
      },
    });
    const refresh = pendingModels();
    vi.mocked(fetchStageModels).mockReturnValueOnce(refresh.promise);
    const props = { onSelect: vi.fn(), onRetry: vi.fn() };
    const view = render(
      <StageModelsRail {...props} state={{ kind: "success", value: workflow() }} />,
    );
    const badgeTexts = () =>
      [
        ...screen
          .getByTestId("stage-models-code-generation")
          .querySelectorAll('[data-slot="badge"]'),
      ].map((badge) => badge.textContent);
    expect(await screen.findByText("レビュワー: デフォルト")).toBeDefined();
    const settled = ["担当: デフォルト", "レビュワー: デフォルト", "補助: デフォルト"];
    expect(badgeTexts()).toEqual(settled);

    // A workflow push or the 30s timings poll hands a new `state` object.
    view.rerender(<StageModelsRail {...props} state={{ kind: "success", value: workflow() }} />);
    expect(fetchStageModels).toHaveBeenCalledTimes(2);
    expect(badgeTexts()).toEqual(settled);
    expect(screen.queryByText("担当: 読み込み中")).toBeNull();

    await act(async () => {
      refresh.resolve(modelResult("refreshed-model"));
      await refresh.promise;
    });
    expect(badgeTexts()).toEqual([
      "担当: refreshed-model",
      "レビュワー: デフォルト",
      "補助: デフォルト",
    ]);
  });

  it("removes the previous intent's model and reviewer when the selected record changes", async () => {
    vi.mocked(fetchStageModels).mockResolvedValueOnce(modelResult("previous-model"));
    const next = pendingModels();
    vi.mocked(fetchStageModels).mockReturnValueOnce(next.promise);
    const state = { kind: "success" as const, value: workflow() };
    const props = { state, onSelect: vi.fn(), onRetry: vi.fn() };
    const view = render(<StageModelsRail key="first-intent" {...props} />);
    expect(await screen.findByText("担当: previous-model")).toBeDefined();
    view.rerender(<StageModelsRail key="second-intent" {...props} />);
    expect(screen.queryByText("担当: previous-model")).toBeNull();
    expect(screen.queryByText(/レビュワー:/)).toBeNull();
    await act(async () => {
      next.resolve({ ok: true, value: { harnesses: [], observed: {} } });
      await next.promise;
    });
    expect(
      within(screen.getByTestId("stage-rail-item-code-generation")).getByText("担当: デフォルト"),
    ).toBeDefined();
    expect(screen.queryByLabelText("モデル設定の表示元")).toBeNull();
  });
});

describe("model retrieval states", () => {
  it.each([false, true])(
    "shows default after a successful empty result (partial=%s)",
    async (partial) => {
      vi.mocked(fetchStageModels).mockResolvedValue({
        ok: true,
        value: { harnesses: [], observed: {} },
        ...(partial ? { warnings: ["cursor: stage graph unavailable"] } : {}),
      });
      render(
        <StageModelsRail
          state={{ kind: "success", value: workflow() }}
          onSelect={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      const row = within(screen.getByTestId("stage-rail-item-code-generation"));
      expect(await row.findByText("担当: デフォルト")).toBeDefined();
      expect(row.queryByText("担当: 取得できません")).toBeNull();
    },
  );

  it("does not treat withheld usage as a missing record", async () => {
    vi.mocked(fetchStageModels).mockResolvedValue({
      ok: true,
      value: {
        harnesses: [{ id: "claude", label: "Claude Code", stages: [reviewerStage] }],
        observed: null,
      },
      warnings: ["usage tracking disabled; token and cost data withheld"],
    });
    render(
      <StageModelsRail
        state={{ kind: "success", value: workflow() }}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const row = within(screen.getByTestId("stage-rail-item-code-generation"));
    expect(await row.findByText("担当: 取得できません")).toBeDefined();
    expect(row.queryByText("担当: デフォルト")).toBeNull();
    expect(row.queryByTitle("使用記録がないため、デフォルトと表示しています。")).toBeNull();
    expect(row.getByText("レビュワー: デフォルト")).toBeDefined();
    expect(row.getByText("補助: デフォルト")).toBeDefined();
  });

  it("recovers from a failed request to recorded usage on the next refresh", async () => {
    vi.mocked(fetchStageModels).mockResolvedValueOnce({
      error: true,
      reason: "server-unreachable",
    });
    const props = { onSelect: vi.fn(), onRetry: vi.fn() };
    const view = render(
      <StageModelsRail {...props} state={{ kind: "success", value: workflow() }} />,
    );
    const row = within(screen.getByTestId("stage-rail-item-code-generation"));
    expect(await row.findByText("担当: 取得できません")).toBeDefined();
    vi.mocked(fetchStageModels).mockResolvedValueOnce(modelResult("recovered-model"));
    view.rerender(<StageModelsRail {...props} state={{ kind: "success", value: workflow() }} />);
    expect(await screen.findByText("担当: recovered-model")).toBeDefined();
    expect(row.queryByText("担当: 取得できません")).toBeNull();
    expect(row.queryByText("担当: デフォルト")).toBeNull();
  });
});
