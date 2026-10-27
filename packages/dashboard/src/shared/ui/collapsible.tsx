import { Collapse } from "@mantine/core";
import { useUncontrolled } from "@mantine/hooks";
import {
  createContext,
  useContext,
  useId,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { Slot, type SlotProps } from "./slot.tsx";

type CollapsibleState = { open: boolean; toggle: () => void; panelId: string };
const CollapsibleContext = createContext<CollapsibleState | null>(null);

function useCollapsible(): CollapsibleState {
  const state = useContext(CollapsibleContext);
  if (state === null) throw new Error("Collapsible parts must be inside <Collapsible>.");
  return state;
}

function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const [value, setValue] = useUncontrolled({
    value: open,
    defaultValue: defaultOpen,
    finalValue: false,
    onChange: onOpenChange,
  });
  const panelId = useId();
  return (
    <CollapsibleContext.Provider value={{ open: value, toggle: () => setValue(!value), panelId }}>
      {children}
    </CollapsibleContext.Provider>
  );
}

function CollapsibleTrigger(props: SlotProps) {
  const { open, toggle, panelId } = useCollapsible();
  return (
    <Slot
      data-slot="collapsible-trigger"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={toggle}
      {...props}
    />
  );
}

/** Mantine's Collapse; a closed panel's content is unmounted. */
function CollapsibleContent(
  props: Omit<ComponentPropsWithRef<"div">, "color" | "onTransitionEnd" | "onTransitionStart">,
) {
  const { open, panelId } = useCollapsible();
  return (
    <Collapse
      data-slot="collapsible-content"
      id={panelId}
      expanded={open}
      keepMounted={false}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
