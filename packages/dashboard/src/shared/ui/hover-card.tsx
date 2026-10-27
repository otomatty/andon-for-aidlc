import { HoverCard as MantineHoverCard, type HoverCardProps } from "@mantine/core";
import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";
import { Slot, type SlotProps } from "./slot.tsx";

/** Mantine's HoverCard: opens on hover and on keyboard focus of the trigger. */
function HoverCard({
  position = "bottom",
  width = 256,
  openDelay = 200,
  ...props
}: Pick<HoverCardProps, "children" | "position" | "width" | "openDelay" | "closeDelay">) {
  return (
    <MantineHoverCard
      position={position}
      width={width}
      openDelay={openDelay}
      offset={4}
      shadow="md"
      radius="md"
      {...props}
    />
  );
}

const TRIGGER_VARIANTS = {
  default: "",
  /** A field card that explains itself on hover or focus. */
  explain:
    "flex h-full min-w-0 cursor-help flex-col gap-1 rounded-md border bg-card px-4 py-3 text-left wrap-anywhere transition-colors hover:border-(--mantine-color-dimmed) focus-visible:border-primary focus-visible:outline-none",
} as const;

/** The hovered element: a `<button>` unless `render` names another. */
function HoverCardTrigger({
  className,
  variant = "default",
  ...props
}: SlotProps & { className?: string; variant?: keyof typeof TRIGGER_VARIANTS }) {
  const look = TRIGGER_VARIANTS[variant];
  return (
    <MantineHoverCard.Target>
      <Slot data-slot="hover-card-trigger" className={cn(look, className)} {...props} />
    </MantineHoverCard.Target>
  );
}

function HoverCardContent({ className, ...props }: Omit<ComponentPropsWithRef<"div">, "color">) {
  return (
    <MantineHoverCard.Dropdown
      data-slot="hover-card-content"
      className={cn("text-sm", className)}
      {...props}
    />
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
