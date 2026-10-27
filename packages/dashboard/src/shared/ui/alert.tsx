import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Mantine's light Alert look (tinted surface, coloured title and icon) on the
 * dashboard's children API: callers put an icon, AlertTitle, AlertDescription
 * and AlertAction inside, which Mantine's Alert has no slot for. The colours
 * are Mantine's own light-variant variables.
 */
const ALERT_COLORS: Record<"default" | "destructive", string> = {
  default:
    "[--alert-bg:var(--mantine-color-blue-light)] [--alert-color:var(--mantine-color-blue-light-color)]",
  destructive:
    "[--alert-bg:var(--mantine-color-red-light)] [--alert-color:var(--mantine-color-red-light-color)]",
};

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" | null }) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? "default"}
      role="alert"
      className={cn(
        "group/alert relative grid w-full gap-1 rounded-md bg-(--alert-bg) px-4 py-3 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-(--alert-color) *:[svg:not([class*='size-'])]:size-4",
        ALERT_COLORS[variant ?? "default"],
        className,
      )}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-bold text-(--alert-color) group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-action" className={cn("absolute top-2 right-2", className)} {...props} />
  );
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
