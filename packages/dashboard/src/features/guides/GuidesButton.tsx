import { CircleHelpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useAppState, useDispatch } from "@/store/context.tsx";

/** Opens the in-app usage guides route. Tests use this; Header navigates via the menu. */
export function GuidesButton(): ReactNode {
  const open = useAppState().route.name === "guides";
  const dispatch = useDispatch();

  return (
    <Tooltip label="使い方">
      <Button
        type="button"
        variant="outline"
        size="icon"
        data-testid="guides-open"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="使い方"
        onClick={() => {
          dispatch({ type: "guides", open: true });
        }}
      >
        <CircleHelpIcon />
      </Button>
    </Tooltip>
  );
}
