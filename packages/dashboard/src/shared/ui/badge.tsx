import { Badge as MantineBadge } from "@mantine/core";
import type * as React from "react";

import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "ghost"
  | "link"
  | "info"
  | "success";

const VARIANTS: Record<BadgeVariant, { variant: string; color?: string; className?: string }> = {
  default: { variant: "filled" },
  secondary: { variant: "light", color: "gray" },
  destructive: { variant: "light", color: "red" },
  outline: { variant: "outline", color: "gray" },
  ghost: { variant: "transparent", color: "gray" },
  link: { variant: "transparent", className: "underline-offset-4 hover:underline" },
  info: { variant: "light", color: "blue" },
  success: { variant: "light", color: "var(--color-status-done)" },
};

type BadgeProps = Omit<React.ComponentPropsWithRef<"span">, "color"> & { variant?: BadgeVariant };

/**
 * Mantine's Badge without its upper-casing: these badges carry identifiers
 * (model names, scopes, file names) that must read as written. StatusChip keeps
 * Mantine's capitals for the English status words.
 */
function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const look = VARIANTS[variant];
  return (
    <MantineBadge
      component="span"
      data-slot="badge"
      variant={look.variant}
      color={look.color}
      className={cn("normal-case tracking-normal", look.className, className)}
      {...props}
    />
  );
}

export { Badge, type BadgeProps };
