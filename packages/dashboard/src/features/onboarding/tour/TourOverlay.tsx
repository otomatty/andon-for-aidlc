import { Popover } from "@mantine/core";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { viewValue } from "@/store/state.ts";
import { buildTourSteps, type TourRoute } from "./steps.ts";
import { type AnchorBox, useTourAnchor } from "./useTourAnchor.ts";

const RING_GAP = 6;
const RING_RADIUS = 10;

/** Where the card goes when its element could not be found: the upper middle. */
function centerBox(): AnchorBox {
  return { left: window.innerWidth / 2, top: window.innerHeight / 3, width: 0, height: 0 };
}

/** A rounded rectangle as an SVG subpath. */
function roundedRect(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RING_RADIUS, width / 2, height / 2);
  return [
    `M${x + r},${y}`,
    `H${x + width - r}`,
    `A${r},${r} 0 0 1 ${x + width},${y + r}`,
    `V${y + height - r}`,
    `A${r},${r} 0 0 1 ${x + width - r},${y + height}`,
    `H${x + r}`,
    `A${r},${r} 0 0 1 ${x},${y + height - r}`,
    `V${y + r}`,
    `A${r},${r} 0 0 1 ${x + r},${y}`,
    "Z",
  ].join(" ");
}

/**
 * Fades everything but the step's element in the page's own background
 * colour, and rings the element. One even-odd path cuts the hole, so no mask
 * or literal colour is needed; the SVG clips the oversized outer square to
 * the viewport. It never takes pointer events.
 */
function Spotlight({ box }: { box: AnchorBox | null }): ReactNode {
  const hole =
    box === null
      ? null
      : roundedRect(
          box.left - RING_GAP,
          box.top - RING_GAP,
          box.width + RING_GAP * 2,
          box.height + RING_GAP * 2,
        );
  return (
    <svg
      aria-hidden="true"
      data-testid="tour-spotlight"
      className="pointer-events-none fixed inset-0 z-60 size-full"
    >
      <path
        d={`M-1,-1 H100000 V100000 H-1 Z ${hole ?? ""}`}
        fillRule="evenodd"
        className="fill-background/75"
      />
      {hole === null ? null : (
        <path d={hole} fillOpacity={0} strokeWidth={2} className="stroke-ring" />
      )}
    </svg>
  );
}

/**
 * The guided tour: one card at a time, pointing at the real element on the
 * user's own workflow. It opens the pages it explains, keeps focus inside the
 * card, and ends with Escape or 「ツアーを終了」 at any step.
 */
export default function TourOverlay(): ReactNode {
  const state = useAppState();
  const dispatch = useDispatch();
  // Fixed at the start: a live workflow push must not reshuffle the steps.
  const [steps] = useState(() => buildTourSteps(viewValue(state.workflow)));
  const [index, setIndex] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = steps[index] ?? steps[0];
  const { element, box, status } = useTourAnchor(
    step?.anchor ?? { attr: "data-testid", value: "header-menu-trigger" },
  );

  // Ending returns to the page the tour started from (the store keeps it).
  const end = useCallback((): void => {
    dispatch({ type: "tour", active: false });
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-testid="header-menu-trigger"]')?.focus(),
    );
  }, [dispatch]);

  // Each step opens the page it explains; the page underneath is inert, so
  // the tour is the only thing that moves between pages while it runs.
  const open = useCallback(
    (to: TourRoute): void => {
      if (to === null) return;
      if (to.name === "home") dispatch({ type: "home" });
      else dispatch({ type: "select", selection: { kind: "stage", slug: to.slug } });
    },
    [dispatch],
  );
  useEffect(() => {
    open(steps[0]?.route ?? null);
  }, [open, steps]);
  const goTo = (next: number): void => {
    open(steps[next]?.route ?? null);
    setIndex(next);
  };

  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [index]);

  if (step === undefined) return null;
  const last = index === steps.length - 1;

  // The card follows an invisible box over the step's element (or the upper
  // middle), so the element itself never has to be a React child here.
  const target = element !== null && box !== null ? box : centerBox();

  return (
    <>
      <Spotlight box={status === "found" ? box : null} />
      <Popover
        opened
        // Only Escape or 「ツアーを終了」 end the tour. A page that takes focus
        // while it opens, or a click on the faded page, must not.
        onChange={(next) => {
          if (!next) end();
        }}
        closeOnClickOutside={false}
        trapFocus
        withRoles={false}
        position={element === null ? "bottom" : "bottom-start"}
        offset={12}
        middlewares={{ flip: true, shift: { padding: 16 } }}
        floatingStrategy="fixed"
        hideDetached={false}
        // The page underneath is inert while the tour runs; the Spotlight
        // above this clear layer does the fading.
        withOverlay
        overlayProps={{ backgroundOpacity: 0, zIndex: 59 }}
        width={320}
        zIndex={60}
        radius="md"
        shadow="lg"
      >
        <Popover.Target>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed top-(--tour-top) left-(--tour-left) h-(--tour-height) w-(--tour-width)"
            style={
              {
                "--tour-top": `${target.top}px`,
                "--tour-left": `${target.left}px`,
                "--tour-width": `${target.width}px`,
                "--tour-height": `${target.height}px`,
              } as CSSProperties
            }
          />
        </Popover.Target>
        <Popover.Dropdown
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          data-testid="tour-card"
          data-anchor={status}
          className="flex max-w-viewport-gutter flex-col gap-2 p-4 text-sm"
        >
          <p className="text-xs text-muted-foreground" aria-hidden="true">
            {`${index + 1} / ${steps.length}`}
          </p>
          <h2
            ref={title}
            id={titleId}
            tabIndex={-1}
            data-autofocus
            className="text-base font-semibold outline-none"
          >
            {step.title}
          </h2>
          <p id={bodyId} className="leading-relaxed text-muted-foreground">
            {step.body}
          </p>
          {status === "missing" ? (
            <p className="text-xs text-muted-foreground">
              この画面では対象の場所を表示できませんでした。説明だけ確認して進めます。
            </p>
          ) : null}
          <p className="sr-only">{`手順 ${index + 1} / ${steps.length}`}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={end}>
              ツアーを終了
            </Button>
            <div className="flex gap-2">
              {index === 0 ? null : (
                <Button type="button" variant="outline" size="sm" onClick={() => goTo(index - 1)}>
                  戻る
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => (last ? end() : goTo(index + 1))}>
                {last ? "完了" : "次へ"}
              </Button>
            </div>
          </div>
        </Popover.Dropdown>
      </Popover>
    </>
  );
}
