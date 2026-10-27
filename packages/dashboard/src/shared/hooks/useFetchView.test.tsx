import type { ReadResult } from "@aidlc-guide/shared-types";
import { act, renderHook } from "@tests/render.tsx";
import { describe, expect, it } from "vitest";
import { useFetchView } from "@/hooks/useFetchView.ts";

function pending<T>() {
  let resolve!: (result: ReadResult<T>) => void;
  const promise = new Promise<ReadResult<T>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Props = {
  load: (() => Promise<ReadResult<string>>) | null;
  token: number;
};

describe("useFetchView", () => {
  it("returns to loading on every refetch by default", async () => {
    const first = pending<string>();
    const second = pending<string>();
    const { result, rerender } = renderHook(
      ({ load, token }: Props) => useFetchView(load, [token]),
      { initialProps: { load: () => first.promise, token: 1 } },
    );
    expect(result.current).toEqual({ kind: "loading" });
    await act(async () => {
      first.resolve({ ok: true, value: "first" });
      await first.promise;
    });
    expect(result.current).toMatchObject({ kind: "success", value: "first" });

    rerender({ load: () => second.promise, token: 2 });
    expect(result.current).toEqual({ kind: "loading" });
  });

  it("keeps the settled view during a refetch when keepPrevious is set", async () => {
    const first = pending<string>();
    const second = pending<string>();
    const { result, rerender } = renderHook(
      ({ load, token }: Props) => useFetchView(load, [token], { keepPrevious: true }),
      { initialProps: { load: () => first.promise, token: 1 } },
    );
    expect(result.current).toEqual({ kind: "loading" });
    await act(async () => {
      first.resolve({ ok: true, value: "first" });
      await first.promise;
    });

    rerender({ load: () => second.promise, token: 2 });
    expect(result.current).toMatchObject({ kind: "success", value: "first" });

    await act(async () => {
      second.resolve({ ok: true, value: "second" });
      await second.promise;
    });
    expect(result.current).toMatchObject({ kind: "success", value: "second" });
  });

  it("keeps a settled error during a refetch and replaces it with the next result", async () => {
    const second = pending<string>();
    const { result, rerender } = renderHook(
      ({ load, token }: Props) => useFetchView(load, [token], { keepPrevious: true }),
      {
        initialProps: {
          load: () => Promise.resolve<ReadResult<string>>({ error: true, reason: "unavailable" }),
          token: 1,
        },
      },
    );
    await act(async () => {});
    expect(result.current?.kind).toBe("error");

    rerender({ load: () => second.promise, token: 2 });
    expect(result.current?.kind).toBe("error");

    await act(async () => {
      second.resolve({ ok: true, value: "recovered" });
      await second.promise;
    });
    expect(result.current).toMatchObject({ kind: "success", value: "recovered" });
  });

  it("still clears to null when the load is withdrawn, then loads afresh", async () => {
    const next = pending<string>();
    const initialProps: Props = {
      load: () => Promise.resolve<ReadResult<string>>({ ok: true, value: "first" }),
      token: 1,
    };
    const { result, rerender } = renderHook(
      ({ load, token }: Props) => useFetchView(load, [token], { keepPrevious: true }),
      { initialProps },
    );
    await act(async () => {});
    expect(result.current).toMatchObject({ kind: "success", value: "first" });

    rerender({ load: null, token: 2 });
    expect(result.current).toBeNull();

    rerender({ load: () => next.promise, token: 3 });
    expect(result.current).toEqual({ kind: "loading" });
  });

  it("drops a response that settles after a newer refetch started", async () => {
    const older = pending<string>();
    const newer = pending<string>();
    const { result, rerender } = renderHook(
      ({ load, token }: Props) => useFetchView(load, [token], { keepPrevious: true }),
      { initialProps: { load: () => older.promise, token: 1 } },
    );
    rerender({ load: () => newer.promise, token: 2 });
    await act(async () => {
      newer.resolve({ ok: true, value: "newer" });
      await newer.promise;
    });
    await act(async () => {
      older.resolve({ ok: true, value: "older" });
      await older.promise;
    });
    expect(result.current).toMatchObject({ kind: "success", value: "newer" });
  });
});
