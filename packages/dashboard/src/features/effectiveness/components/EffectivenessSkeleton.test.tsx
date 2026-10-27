import { act, render, screen } from "@tests/render.tsx";
import { lazy, Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffectivenessSkeleton } from "@/features/effectiveness/components/EffectivenessSkeleton.tsx";
import { SKELETON_DELAY_MS } from "@/hooks/useDelayedLoading.ts";

afterEach(() => vi.useRealTimers());

describe("EffectivenessSkeleton", () => {
  it("uses identical summary and record layouts for the lazy page and data wait", () => {
    const { container, rerender } = render(<EffectivenessSkeleton page />);
    const summary = screen.getByTestId("effectiveness-summary-skeleton");
    const records = screen.getByTestId("effectiveness-records-skeleton");
    expect(summary.children).toHaveLength(4);
    expect(summary.className).toContain("sm:grid-cols-2 xl:grid-cols-4");
    expect(records.children).toHaveLength(2);
    expect(records.className).toContain("grid-cols-cards");
    const summaryHtml = summary.outerHTML;
    const recordsHtml = records.outerHTML;
    expect(container.querySelectorAll('[data-slot="card-footer"]')).toHaveLength(6);
    rerender(<EffectivenessSkeleton />);
    expect(screen.getByTestId("effectiveness-summary-skeleton").outerHTML).toBe(summaryHtml);
    expect(screen.getByTestId("effectiveness-records-skeleton").outerHTML).toBe(recordsHtml);
  });

  it("removes the Suspense placeholder when the page resolves before the delay", async () => {
    vi.useFakeTimers();
    let resolve!: (module: { default: () => ReactNode }) => void;
    const Page = lazy(
      () =>
        new Promise<{ default: () => ReactNode }>((done) => {
          resolve = done;
        }),
    );
    const { container } = render(
      <Suspense fallback={<EffectivenessSkeleton page />}>
        <Page />
      </Suspense>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => {
      resolve({ default: () => <h1>効果測定</h1> });
    });
    act(() => vi.advanceTimersByTime(SKELETON_DELAY_MS));
    expect(screen.getByRole("heading", { name: "効果測定" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
});
