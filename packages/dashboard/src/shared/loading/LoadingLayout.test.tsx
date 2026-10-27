import { act, render, screen } from "@tests/render.tsx";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NowStripSkeleton } from "@/shell/now-strip/NowStripSkeleton.tsx";
import { CustomizationSkeleton } from "@/features/customization/components/CustomizationSkeleton.tsx";
import { EffectivenessSkeleton } from "@/features/effectiveness/components/EffectivenessSkeleton.tsx";
import { MatrixSkeleton } from "@/features/home/components/MatrixSkeleton.tsx";
import { StageRailSkeleton } from "@/features/home/components/StageRailSkeleton.tsx";
import { StageDetailSkeleton } from "@/features/stage/components/StageDetailSkeleton.tsx";
import { SKELETON_DELAY_MS } from "@/hooks/useDelayedLoading.ts";
import { DocumentSkeleton } from "@/shared/loading/DocumentSkeleton.tsx";
import { NavigationSkeleton } from "@/shared/loading/NavigationSkeleton.tsx";

afterEach(() => vi.useRealTimers());

describe("layout loading placeholders", () => {
  it.each([
    ["効果測定", <EffectivenessSkeleton key="EffectivenessSkeleton" page />],
    ["カスタマイズ", <CustomizationSkeleton key="CustomizationSkeleton" />],
    ["成果物マトリクス", <MatrixSkeleton key="MatrixSkeleton" heading />],
    ["ステージ一覧", <StageRailSkeleton key="StageRailSkeleton" />],
    ["ステージ解説", <StageDetailSkeleton key="StageDetailSkeleton" />],
    ["現在のステージ", <NowStripSkeleton key="NowStripSkeleton" expanded />],
    ["本文", <DocumentSkeleton key="DocumentSkeleton" label="本文" />],
    ["一覧", <NavigationSkeleton key="NavigationSkeleton" label="一覧" />],
  ] as const)("delays %s and exposes one named status without fake controls", (label, element) => {
    vi.useFakeTimers();
    render(element as ReactNode);
    const name = `${label}を読み込み中`;
    expect(screen.queryByRole("status", { name })).toBeNull();
    act(() => vi.advanceTimersByTime(SKELETON_DELAY_MS - 1));
    expect(screen.queryByRole("status", { name })).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const status = screen.getByRole("status", { name });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.children[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});
