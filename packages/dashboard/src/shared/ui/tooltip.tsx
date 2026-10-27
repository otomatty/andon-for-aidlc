import { Tooltip as MantineTooltip } from "@mantine/core";
import type { ReactElement, ReactNode } from "react";

/**
 * Mantine's Tooltip: shows `label` while the child (an element that takes a
 * ref, such as `<Button>`) is hovered or focused.
 */
function Tooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <MantineTooltip label={label} position="top" offset={6} withArrow arrowSize={6} fz="xs">
      {children}
    </MantineTooltip>
  );
}

export { Tooltip };
