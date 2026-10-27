import { CheckIcon } from "lucide-react";
import type { ComponentPropsWithRef, CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { type ChipStatus, STATUS_PRESENTATION } from "./StatusChip.tsx";

/**
 * A vertical timeline as a list: each item hangs off a round bullet, and a
 * line joins it to the next. The line runs in the primary colour while the
 * item is done, like Mantine's Timeline `active`.
 */
function Timeline({ className, ...props }: ComponentPropsWithRef<"ul">) {
  return (
    <ul
      data-slot="timeline"
      className={cn("m-0 flex list-none flex-col p-0", className)}
      {...props}
    />
  );
}

/**
 * One step. The bullet takes the status colour and symbol (a check once
 * done); it is decorative, since the row itself states the status.
 */
function TimelineItem({
  status,
  className,
  children,
  ...props
}: ComponentPropsWithRef<"li"> & { status: ChipStatus }) {
  const done = status === "completed";
  const { token, symbol } = STATUS_PRESENTATION[status];
  return (
    <li
      data-slot="timeline-item"
      data-status={status}
      className={cn(
        "relative pb-3 pl-9 last:pb-0",
        "before:absolute before:top-7 before:bottom-0.5 before:left-[11px] before:w-0.5 before:rounded-full before:bg-track last:before:hidden",
        done && "before:bg-primary",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1.5 left-0 inline-flex size-6 items-center justify-center rounded-full border-2 bg-background text-xs leading-none",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-(--timeline-color) text-(--timeline-color)",
          status === "skipped" && "border-dashed",
          status === "not-started" && "border-track",
        )}
        style={{ "--timeline-color": `var(${token})` } as CSSProperties}
      >
        {done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : symbol}
      </span>
      {children}
    </li>
  );
}

export { Timeline, TimelineItem };
