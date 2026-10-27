import type { EffectivenessPayload, ReadResult } from "@aidlc-guide/shared-types";
import { act, fireEvent, render, screen } from "@tests/render.tsx";
import { lazy, StrictMode, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EffectivenessPanel from "@/features/effectiveness/EffectivenessPage.tsx";
import { GuidesPanel } from "@/features/guides/GuidesPage.tsx";
import { LoadingSuspense } from "@/shared/loading/LoadingSequence.tsx";
import { EffectivenessSkeleton } from "@/features/effectiveness/components/EffectivenessSkeleton.tsx";
import { StoreProvider } from "@/store/context.tsx";

const markdown = vi.hoisted(() => {
  let resolve!: (value: { default: ComponentType }) => void;
  return {
    promise: new Promise<{ default: ComponentType }>((done) => {
      resolve = done;
    }),
    resolve: (value: { default: ComponentType }) => resolve(value),
  };
});
vi.mock("@/viewer/lazy-markdown.ts", async () => {
  const { lazy } = await import("react");
  return { MarkdownSurface: lazy(() => markdown.promise) };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("continuous loading", () => {
  it.each([100, 300])(
    "shares the App lazy delay with the real page fetch after %ims",
    async (chunkMs) => {
      vi.useFakeTimers();
      const chunk = deferred<{ default: typeof EffectivenessPanel }>();
      const Page = lazy(() => chunk.promise);
      const first = deferred<ReadResult<EffectivenessPayload>>();
      const second = deferred<ReadResult<EffectivenessPayload>>();
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(await (++calls === 1 ? first.promise : second.promise))),
      );
      render(
        <StrictMode>
          <StoreProvider preloaded={{ route: { name: "effectiveness" } }}>
            <LoadingSuspense fallback={<EffectivenessSkeleton page />}>
              <Page />
            </LoadingSuspense>
          </StoreProvider>
        </StrictMode>,
      );
      const name = "効果測定を読み込み中";
      expect(screen.queryByRole("status", { name })).toBeNull();
      await act(async () => vi.advanceTimersByTime(chunkMs));
      if (chunkMs >= 200) expect(screen.getByRole("status", { name })).toBeTruthy();
      await act(async () => {
        chunk.resolve({ default: EffectivenessPanel });
      });
      if (chunkMs < 200) {
        expect(screen.queryByRole("status", { name })).toBeNull();
        await act(async () => vi.advanceTimersByTime(199 - chunkMs));
        expect(screen.queryByRole("status", { name })).toBeNull();
        await act(async () => vi.advanceTimersByTime(1));
      }
      expect(screen.getByRole("status", { name })).toBeTruthy();
      // StrictMode repeats the fetch effect; both initial calls share one request result.
      const result: ReadResult<EffectivenessPayload> = {
        ok: true,
        value: { space: "default", generatedAt: "2026-09-18T00:00:00Z", intents: [], warnings: [] },
      };
      await act(async () => {
        first.resolve(result);
        second.resolve(result);
      });
      expect(screen.queryByRole("status", { name })).toBeNull();
      expect(screen.getByText("計測対象の案件がありません")).toBeTruthy();
      const refresh = deferred<ReadResult<EffectivenessPayload>>();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(await refresh.promise)),
      );
      fireEvent.click(screen.getByTestId("effectiveness-refresh"));
      expect(screen.queryByRole("status", { name })).toBeNull();
      await act(async () => vi.advanceTimersByTime(199));
      expect(screen.queryByRole("status", { name })).toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(screen.getByRole("status", { name })).toBeTruthy();
      await act(async () => {
        refresh.resolve({ error: true, reason: "server-unreachable" });
      });
      expect(screen.queryByRole("status", { name })).toBeNull();
      expect(screen.getByText("読み込みエラー")).toBeTruthy();
    },
  );

  it("keeps the guide's data skeleton visible through the Markdown chunk load", async () => {
    vi.useFakeTimers();
    const guide = deferred<unknown>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url === "/api/guides"
            ? { ok: true, value: [{ name: "start.md", title: "ガイド" }] }
            : await guide.promise,
        ),
      ),
    );
    render(
      <StoreProvider preloaded={{ route: { name: "guides" } }}>
        <GuidesPanel />
      </StoreProvider>,
    );
    await act(async () => vi.advanceTimersByTime(300));
    const name = "ガイド本文を読み込み中";
    expect(screen.getByRole("status", { name })).toBeTruthy();
    await act(async () => {
      guide.resolve({ ok: true, value: { title: "ガイド", markdown: "本文" } });
    });
    expect(screen.getByRole("status", { name })).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(100));
    expect(screen.getByRole("status", { name })).toBeTruthy();
    await act(async () => {
      markdown.resolve({ default: () => <p>本文を表示しました</p> });
    });
    expect(screen.getByText("本文を表示しました")).toBeTruthy();
    expect(screen.queryByRole("status", { name })).toBeNull();
  });
});
