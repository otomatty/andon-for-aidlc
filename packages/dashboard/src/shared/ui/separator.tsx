import { Divider } from "@mantine/core";
import type * as React from "react";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: Omit<React.ComponentPropsWithRef<"div">, "color"> & {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <Divider
      data-slot="separator"
      role="separator"
      aria-orientation={orientation}
      orientation={orientation}
      className={className}
      {...props}
    />
  );
}

export { Separator };
