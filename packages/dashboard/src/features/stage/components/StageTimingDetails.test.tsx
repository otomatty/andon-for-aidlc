import type { TimingBreakdown } from "@aidlc-guide/shared-types";
import { render, screen, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NowStrip } from "@/shell/now-strip/NowStrip.tsx";
import { StageTimingDetails } from "@/features/stage/components/StageTimingDetails.tsx";
import { stageView, workflow } from "@tests/fixtures.ts";

const minute = 60_000;
const breakdown: TimingBreakdown = {
  observedWallMs: 80 * minute,
  workMs: 20 * minute,
  approvalWaitMs: 0,
  suspendedMs: 0,
  excludedGapMs: 60 * minute,
  pendingObservationMs: 0,
  unattributedMs: 0,
};
const view = stageView("code-generation", {
  elapsedActiveMs: 20 * minute,
  breakdown,
  quality: { status: "limited", reasons: ["long-gap-excluded"], sampleEligible: true },
  estimateMs: 30 * minute,
  basis: "stage",
  sampleCount: 3,
  sampleExcludedCount: 2,
  sensitivity: [
    { thresholdMs: 10 * minute, workMs: 20 * minute },
    { thresholdMs: 20 * minute, workMs: 20 * minute },
    { thresholdMs: 30 * minute, workMs: 20 * minute },
  ],
});

describe("stage timing details", () => {
  it("explains the suspension diagnostic emitted by the timing classifier", () => {
    render(
      <StageTimingDetails
        view={{
          ...view,
          quality: {
            status: "incomplete",
            reasons: ["activity-during-suspension"],
            sampleEligible: false,
          },
        }}
        onOpenGuide={vi.fn()}
      />,
    );
    expect(
      screen.getByText("中断中に作業記録があり、中断と作業の記録が矛盾しています。"),
    ).toBeDefined();
    expect(screen.queryByText(/再開時刻を確認できません/)).toBeNull();
    expect(screen.queryByText(/記録の不足や対象の曖昧さ/)).toBeNull();
  });

  it("includes the pending tail in wall time while keeping it separate from work", () => {
    render(
      <StageTimingDetails
        view={{
          ...view,
          running: true,
          elapsedActiveMs: 5 * minute,
          sinceLastObservationMs: 7 * minute,
          breakdown: {
            ...breakdown,
            observedWallMs: 12 * minute,
            workMs: 5 * minute,
            excludedGapMs: 0,
            pendingObservationMs: 7 * minute,
          },
        }}
        onOpenGuide={vi.fn()}
      />,
    );
    expect(screen.getByText("開始からの経過").nextElementSibling?.textContent).toBe("12m");
    expect(screen.getByText("作業時間").nextElementSibling?.textContent).toBe("5m");
    expect(screen.getByText("未分類の時間").nextElementSibling?.textContent).toBe("7m");
    expect(screen.getByText(/最終記録から7m/).textContent).toContain(
      "この期間も「開始からの経過」に含み、作業時間には加えません。",
    );
    expect(screen.getByText(/最終記録から7m/).textContent).toContain(
      "「未分類の時間」に含むため、別途足す必要はありません。",
    );
  });

  it("shows exclusive breakdown, sample exclusions and the meaning of sensitivity", () => {
    render(
      <StageTimingDetails
        view={view}
        policy={{ algorithmVersion: "session-gap-v2", gapThresholdMs: 20 * minute }}
        onOpenGuide={vi.fn()}
      />,
    );
    const details = screen.getByTestId("stage-timing-details");
    expect(within(details).getByText("除外したログ空白").nextElementSibling?.textContent).toBe(
      "1h00m",
    );
    expect(within(details).getByText("作業時間").nextElementSibling?.textContent).toBe("20m");
    expect(within(details).getByText("承認待ち").nextElementSibling?.textContent).toBe("0m");
    expect(details.textContent).toContain("採用実績 3件・除外 2件");
    expect(details.textContent).toContain("20mで区切る（使用中）");
    expect(details.textContent).toContain("実際の作業時間の上下限や信頼区間ではありません");
  });

  it("does not turn missing logs into a known zero and explains unknown diagnostics", () => {
    render(
      <StageTimingDetails
        view={stageView("code-generation", {
          quality: { status: "incomplete", reasons: ["future-code"], sampleEligible: false },
        })}
        onOpenGuide={vi.fn()}
      />,
    );
    expect(screen.getByText("作業時間").nextElementSibling?.textContent).toBe("—");
    expect(screen.getByText("記録が不完全なため、作業時間は不明です。")).toBeDefined();
    expect(screen.getByText(/記録の不足や対象の曖昧さ/)).toBeDefined();
  });

  it("explains partial scope coverage without claiming the known portion is unavailable", () => {
    render(
      <StageTimingDetails
        view={{
          ...view,
          quality: {
            status: "incomplete",
            reasons: ["measurement-scope-mismatch"],
            sampleEligible: false,
          },
        }}
        onOpenGuide={vi.fn()}
      />,
    );
    expect(screen.getByText("作業時間").nextElementSibling?.textContent).toBe("20m");
    expect(screen.getByText(/判明した時間だけを表示/)).toBeDefined();
    expect(screen.queryByText("記録が不完全なため、作業時間は不明です。")).toBeNull();
  });

  it("offers the existing guide action before timing data arrives", async () => {
    const open = vi.fn();
    render(<StageTimingDetails view={null} onOpenGuide={open} />);
    await userEvent.click(screen.getByRole("button", { name: "算出方法を読む" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("keeps the pending tail separate from work and qualifies a partial remaining sum", () => {
    render(
      <NowStrip
        state={{ kind: "success", value: workflow() }}
        onRetry={vi.fn()}
        expanded
        current={stageView("code-generation", {
          running: true,
          elapsedActiveMs: 5 * minute,
          sinceLastObservationMs: 7 * minute,
          breakdown: { ...breakdown, workMs: 5 * minute, pendingObservationMs: 7 * minute },
        })}
        remaining={{ totalRemainingMs: 13 * minute, lowConfidence: false }}
        estimateCoverage={{ known: 2, unknown: 1 }}
      />,
    );
    expect(screen.getByTestId("now-elapsed").textContent).toBe("5m");
    expect(screen.getByTestId("now-last-observation").textContent).toContain(
      "最終記録から7m・次の観測待ち",
    );
    expect(screen.getByTestId("now-estimate-coverage").textContent).toContain(
      "推定できた工程のみ（2工程、不明1工程）",
    );
  });

  it("marks a running stage beyond its estimate instead of implying completion", () => {
    render(
      <NowStrip
        state={{ kind: "success", value: workflow() }}
        onRetry={vi.fn()}
        expanded
        current={stageView("code-generation", {
          running: true,
          elapsedActiveMs: 21 * minute,
          estimateMs: 20 * minute,
          remainingMs: 0,
        })}
      />,
    );
    expect(screen.getByTestId("now-remaining").textContent).toContain("≈0m 見積り超過");
  });
});
