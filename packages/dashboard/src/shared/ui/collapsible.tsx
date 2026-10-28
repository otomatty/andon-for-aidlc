import { Collapse } from "@mantine/core";
import { useUncontrolled } from "@mantine/hooks";
import { ChevronRightIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useId,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
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

const TRIGGER_VARIANTS = {
  default: "",
  /** A `<summary>`'s place: a small inline toggle led by its triangle. */
  disclosure:
    "inline-flex w-fit cursor-pointer items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
} as const;

function CollapsibleTrigger({
  className,
  variant = "default",
  children,
  ...props
}: SlotProps & { className?: string; variant?: keyof typeof TRIGGER_VARIANTS }) {
  const { open, toggle, panelId } = useCollapsible();
  return (
    <Slot
      data-slot="collapsible-trigger"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      className={cn(TRIGGER_VARIANTS[variant], className)}
      onClick={toggle}
      {...props}
    >
      {variant === "disclosure" ? (
        <>
          <ChevronRightIcon
            aria-hidden="true"
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")}
          />
          {children}
        </>
      ) : (
        children
      )}
    </Slot>
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
