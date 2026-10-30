import type { ReadResult } from "@andon/shared-types";
import { useEffect, useState } from "react";
import { deriveViewState } from "@/store/derive-view-state.ts";
import type { ViewState } from "@/store/state.ts";

/**
 * The one fetch→ViewState machine for panel-local data: liveness-guarded,
 * funnelled through `deriveViewState` so every degradation (`error`,
 * `unsupported`, `warnings`) renders the same way everywhere. This existed as
 * six hand-rolled useState/useEffect copies before being extracted — each
 * with its own subset of the branches.
 *
 * `load` is `null` to skip (panel closed, nothing selected); `deps` are the
 * values the fetch closure reads. Returns `null` until the first fetch of the
 * current deps starts resolving state.
 *
 * `keepPrevious` is for background refreshes of data already on screen: a
 * refetch keeps the settled view until the new result lands instead of
 * dropping back to `loading`, so a periodic refresh does not blink the panel.
 * Withdrawing `load` (`null`) still clears it, and the first fetch still loads.
 */
export function useFetchView<T>(
  load: (() => Promise<ReadResult<T>>) | null,
  deps: readonly unknown[],
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
): ViewState<T> | null {
  const [view, setView] = useState<ViewState<T> | null>(null);

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's fetch-closure inputs
  useEffect(
    () => {
      if (load === null) {
        setView(null);
        return;
      }
      let live = true;
      setView((previous) => (keepPrevious && previous !== null ? previous : { kind: "loading" }));
      void load().then((result) => {
        if (live) setView(deriveViewState(result));
      });
      return () => {
        live = false;
      };
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  return view;
}
