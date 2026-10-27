import { fireEvent, render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DetailPanel } from "@/features/stage/StagePage.tsx";
import { StoreProvider, useDispatch } from "@/store/context.tsx";
import type { AppState } from "@/store/state.ts";
import { matrix, nextStep, stageDoc, workflow } from "@tests/fixtures.ts";

/**
 * P-AV-2: "チャンク取得と `GET /api/artifact` を並行発火（開く操作の時点で両方開始）".
 *
 * Its own file on purpose — Vitest gives each test file a fresh module
 * registry, so the very first render here genuinely suspends on the lazy
 * viewer chunk. That is what makes "the read is already in flight while the
 * chunk is still loading" a deterministic assertion rather than a race.
 */

const PATH = "construction/reader-core/nfr-design/logical-components.md";

const preloaded: Partial<AppState> = {
  workflow: { kind: "success", value: workflow() },
  nextStep: { kind: "success", value: nextStep() },
  stageDoc: { "nfr-design": { kind: "success", value: stageDoc({ slug: "nfr-design" }) } },
  matrix: { kind: "success", value: matrix() },
};

function Harness(): ReactNode {
  const dispatch = useDispatch();
  return (
    <>
      <button
        type="button"
        data-testid="open-cell"
        onClick={() => {
          dispatch({
            type: "select",
            selection: { kind: "cell", unit: "reader-core", stage: "nfr-design" },
          });
        }}
      >
        セルを開く
      </button>
      <DetailPanel />
    </>
  );
}

function mount(): { unmount: () => void } {
  return render(
    <StoreProvider preloaded={preloaded}>
      <Harness />
    </StoreProvider>,
  );
}

function stubOk(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ ok: true, value: "# 論理コンポーネント" })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe("artifact prefetch (P-AV-2)", () => {
  it("starts the read in the same commit as the chunk import, before the viewer mounts", async () => {
    const fetchMock = stubOk();
    mount();

    // Synchronous: React flushes the selection and DetailPanel's effects, but
    // the lazy chunk can only resolve on a later microtask.
    fireEvent.click(screen.getByTestId("open-cell"));

    expect(screen.queryByTestId("artifact-viewer")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(encodeURIComponent(PATH));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "論理コンポーネント" })).toBeDefined();
    });
    // The viewer consumed the in-flight promise instead of issuing its own.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("re-reads on a second open — the hand-off is a baton, not a content cache", async () => {
    const fetchMock = stubOk();
    const first = mount();
    await userEvent.click(screen.getByTestId("open-cell"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "論理コンポーネント" })).toBeDefined();
    });
    first.unmount();

    mount();
    await userEvent.click(screen.getByTestId("open-cell"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "論理コンポーネント" })).toBeDefined();
    });

    // Freshness matters: answer.ts verifies bytes against what it re-read.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
