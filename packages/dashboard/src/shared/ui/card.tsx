import { Card as MantineCard } from "@mantine/core";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  size = "default",
  variant = "default",
  ...props
}: Omit<React.ComponentPropsWithRef<"div">, "color"> & {
  /** `lg` gives a page's main card 24px of room. */
  size?: "default" | "sm" | "lg";
  /** `selected` frames the card the reader is on in the primary colour. */
  variant?: "default" | "interactive" | "selected";
}) {
  // Mantine's Card supplies the surface, border and 8px radius; the sections
  // below keep the dashboard's own spacing through --card-spacing.
  return (
    <MantineCard
      data-slot="card"
      data-size={size}
      data-variant={variant}
      padding={0}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) py-(--card-spacing) text-sm [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=lg]:[--card-spacing:--spacing(6)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md",
        variant === "interactive" &&
          "transition-colors group-hover:border-(--mantine-color-dimmed) group-focus-within:border-(--mantine-color-dimmed) motion-reduce:transition-none",
        variant === "selected" && "border-primary",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-title-actions has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-bold group-data-[size=lg]/card:text-lg group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-(--card-spacing) pb-(--card-spacing)", className)}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
