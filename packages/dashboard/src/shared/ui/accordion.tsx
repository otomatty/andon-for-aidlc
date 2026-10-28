import { Accordion as MantineAccordion } from "@mantine/core";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

const LOOKS = {
  /** Rows divided by rules, flush with the text around them. */
  default: {
    item: "last:border-b-0",
    control: "px-0 py-2.5 text-sm font-semibold",
    label: "p-0 font-semibold",
    content: "px-0 pt-0 pb-2.5 text-sm",
    chevron: "text-muted-foreground",
  },
  /** One bordered box, the rows inset. */
  contained: {
    item: "bg-card data-active:bg-card",
    control: "px-4 py-3 text-sm font-semibold data-active:bg-transparent",
    label: "p-0 font-semibold",
    content: "px-4 pt-0 pb-3 text-sm",
    chevron: "text-muted-foreground",
  },
  /**
   * Rows divided by rules inside the caller's own frame, each header a full
   * row: the stage rail's phases.
   */
  rail: {
    item: "border-b border-border last:border-b-0",
    control: "gap-3 px-4 py-3 hover:bg-muted",
    label: "p-0",
    content: "px-4 pt-1 pb-4",
    chevron: "text-muted-foreground",
  },
};

/** The Mantine variant each look draws on; `rail` draws its rules itself. */
const MANTINE_VARIANT = { default: "default", contained: "contained", rail: "default" } as const;

/**
 * Mantine's Accordion with the open items always as an array, one item at a
 * time unless `multiple`. A closed panel's content is unmounted.
 */
function Accordion({
  variant = "default",
  multiple = false,
  order,
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  variant?: keyof typeof LOOKS;
  multiple?: boolean;
  /** Wraps each trigger in a heading of this level. */
  order?: 2 | 3 | 4 | 5 | 6;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  className?: string;
  children?: ReactNode;
}) {
  const shared = {
    "data-slot": "accordion",
    keepMounted: false,
    chevronPosition: "right" as const,
    variant: MANTINE_VARIANT[variant],
    order,
    radius: "md" as const,
    className: cn("flex w-full flex-col", className),
    classNames: LOOKS[variant],
    children,
  };
  if (multiple) {
    return (
      <MantineAccordion
        {...shared}
        multiple
        value={value}
        defaultValue={defaultValue}
        onChange={(next) => onValueChange?.(next)}
      />
    );
  }
  return (
    <MantineAccordion
      {...shared}
      value={value === undefined ? undefined : (value[0] ?? null)}
      defaultValue={defaultValue?.[0] ?? null}
      onChange={(next) => onValueChange?.(next === null ? [] : [next])}
    />
  );
}

function AccordionItem({
  className,
  value,
  ...props
}: Omit<ComponentPropsWithRef<"div">, "color"> & { value: string }) {
  return (
    <MantineAccordion.Item
      data-slot="accordion-item"
      value={value}
      className={className}
      {...props}
    />
  );
}

function AccordionTrigger({ className, ...props }: Omit<ComponentPropsWithRef<"button">, "color">) {
  return (
    <MantineAccordion.Control
      data-slot="accordion-trigger"
      className={cn("text-left", className)}
      {...props}
    />
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: Omit<ComponentPropsWithRef<"div">, "onTransitionEnd" | "onTransitionStart">) {
  return (
    <MantineAccordion.Panel data-slot="accordion-content" {...props}>
      <div
        className={cn(
          "[&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
          className,
        )}
      >
        {children}
      </div>
    </MantineAccordion.Panel>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
