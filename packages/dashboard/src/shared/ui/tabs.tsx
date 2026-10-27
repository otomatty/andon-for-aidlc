import { Tabs as MantineTabs } from "@mantine/core";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

const LOOKS = {
  underline: undefined,
  /** A segmented control: the chosen tab raised on a grey track. */
  segmented: {
    list: "w-fit gap-1 rounded-sm bg-muted p-1",
    tab: "h-8 rounded-sm px-3 font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-xs",
  },
};

/**
 * Mantine's Tabs: underlined, or `segmented` for a switch between a few views
 * of one thing. Only the selected panel is mounted, and `onValueChange`
 * reports the newly selected tab's value.
 */
function Tabs({
  value,
  defaultValue,
  onValueChange,
  variant = "underline",
  className,
  children,
}: {
  variant?: keyof typeof LOOKS;
  /** `null` selects no tab. */
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <MantineTabs
      data-slot="tabs"
      value={value}
      defaultValue={defaultValue}
      onChange={(next) => {
        if (next !== null) onValueChange?.(next);
      }}
      keepMounted={false}
      variant={variant === "segmented" ? "pills" : "default"}
      classNames={LOOKS[variant]}
      className={cn("flex flex-col gap-2", className)}
    >
      {children}
    </MantineTabs>
  );
}

function TabsList({
  className,
  size = "default",
  ...props
}: Omit<ComponentPropsWithRef<"div">, "color"> & {
  size?: "default" | "mono";
  children: ReactNode;
}) {
  return (
    <MantineTabs.List
      data-slot="tabs-list"
      data-size={size}
      className={cn(
        "max-w-full flex-nowrap overflow-x-auto",
        size === "mono" && "font-mono **:data-[slot=tabs-trigger]:text-xs",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  value,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "color" | "value"> & { value: string }) {
  return (
    <MantineTabs.Tab
      data-slot="tabs-trigger"
      value={value}
      className={cn("shrink-0 whitespace-nowrap", className)}
      {...props}
    />
  );
}

function TabsPanel({
  className,
  value,
  ...props
}: Omit<ComponentPropsWithRef<"div">, "color"> & { value: string; children: ReactNode }) {
  return (
    <MantineTabs.Panel
      data-slot="tabs-panel"
      value={value}
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsPanel, TabsTrigger };
