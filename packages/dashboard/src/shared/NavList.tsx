import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The plain "pick one of these" list shared by the guides drawer and the agent
 * panel's stage/knowledge lists. One definition rather than the same utility
 * run repeated at every call site.
 */
export function NavList({ className, ...props }: ComponentProps<"ul">): ReactNode {
  return <ul className={cn("m-0 flex list-none flex-col gap-1 p-0", className)} {...props} />;
}

/**
 * A row in a `NavList`. Pass `data-active="true"` to mark the open entry —
 * Mantine's light primary plus weight, so the marking never rests on colour
 * alone.
 */
export function NavListButton({ className, ...props }: ComponentProps<"button">): ReactNode {
  return (
    <button
      type="button"
      className={cn(
        "block w-full cursor-pointer rounded-sm px-3 py-2 text-left text-sm hover:bg-muted",
        "data-[active=true]:bg-primary-light data-[active=true]:font-semibold data-[active=true]:text-primary-light-foreground",
        className,
      )}
      {...props}
    />
  );
}
