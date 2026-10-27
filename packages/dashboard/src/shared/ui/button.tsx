import { ActionIcon, Button as MantineButton } from "@mantine/core";
import type * as React from "react";

import { cn } from "@/lib/utils";

type ButtonVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link"
  | "dashed";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

/** The dashboard's variant names on Mantine's variants. */
const VARIANTS: Record<ButtonVariant, { variant: string; color?: string; className?: string }> = {
  default: { variant: "filled" },
  outline: { variant: "default" },
  secondary: { variant: "light", color: "gray" },
  ghost: { variant: "subtle", color: "gray", className: "text-(--mantine-color-text)" },
  destructive: { variant: "light", color: "red" },
  link: {
    variant: "transparent",
    className: "h-auto px-0 font-normal underline underline-offset-4",
  },
  dashed: { variant: "default", className: "border-dashed" },
};

/** Mantine 36px inputs are the default; the smaller sizes step down from there. */
const SIZES: Record<"default" | "xs" | "sm" | "lg", string> = {
  default: "sm",
  xs: "compact-sm",
  sm: "xs",
  lg: "md",
};

/** Lucide icons draw at 24px unless the caller sizes them. */
const ICON_FIT = "[&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0";

const ICON_SIZES: Record<"icon" | "icon-xs" | "icon-sm" | "icon-lg", string> = {
  icon: "input-sm",
  "icon-xs": "md",
  "icon-sm": "input-xs",
  "icon-lg": "input-md",
};

type ButtonProps = Omit<React.ComponentPropsWithRef<"button">, "color"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

function isIconSize(size: ButtonSize): size is keyof typeof ICON_SIZES {
  return size.startsWith("icon");
}

function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  const look = VARIANTS[variant];
  if (isIconSize(size))
    return (
      <ActionIcon
        data-slot="button"
        variant={look.variant}
        color={look.color}
        size={ICON_SIZES[size]}
        className={cn(ICON_FIT, look.className, className)}
        {...props}
      />
    );
  return (
    <MantineButton
      data-slot="button"
      variant={look.variant}
      color={look.color}
      size={SIZES[size]}
      className={cn(look.className, className)}
      classNames={{ label: cn("gap-1.5", ICON_FIT) }}
      {...props}
    />
  );
}

export { Button, type ButtonProps };
