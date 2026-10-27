import { ThemeIcon } from "@mantine/core";
import type { ReactNode } from "react";

/** A card's icon on a light primary tile (Mantine's light ThemeIcon). */
function IconTile({ children }: { children: ReactNode }) {
  return (
    <ThemeIcon
      data-slot="icon-tile"
      variant="light"
      size="lg"
      radius="sm"
      aria-hidden="true"
      className="shrink-0 [&_svg]:size-4.5"
    >
      {children}
    </ThemeIcon>
  );
}

export { IconTile };
