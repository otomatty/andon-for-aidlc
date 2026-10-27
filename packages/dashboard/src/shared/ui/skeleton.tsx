import { Skeleton as MantineSkeleton } from "@mantine/core";
import type * as React from "react";

/** Mantine's Skeleton; callers size it with layout classes (h-4 w-1/2 …). */
function Skeleton({ className, ...props }: Omit<React.ComponentPropsWithRef<"div">, "color">) {
  return <MantineSkeleton data-slot="skeleton" className={className} {...props} />;
}

export { Skeleton };
