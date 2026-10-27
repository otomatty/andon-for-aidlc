import { Menu, type MenuProps } from "@mantine/core";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { cn } from "@/lib/utils";
import { Slot, type SlotProps } from "./slot.tsx";

/** Mantine's Menu: arrow keys move between items, Escape closes and refocuses the trigger. */
function DropdownMenu({
  position = "bottom-start",
  width = "max-content",
  ...props
}: Pick<MenuProps, "children" | "position" | "width">) {
  return (
    <Menu
      position={position}
      width={width}
      offset={4}
      shadow="md"
      radius="md"
      returnFocus
      {...props}
    />
  );
}

function DropdownMenuTrigger(props: SlotProps) {
  return (
    <Menu.Target>
      <Slot data-slot="dropdown-menu-trigger" {...props} />
    </Menu.Target>
  );
}

/** Home and End reach the first and last item, also from the menu's initial focus. */
function focusEdgeItem(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.defaultPrevented || (event.key !== "Home" && event.key !== "End")) return;
  const items = event.currentTarget.querySelectorAll<HTMLElement>(
    "[data-menu-item]:not([data-disabled])",
  );
  const item = event.key === "Home" ? items[0] : items[items.length - 1];
  if (item === undefined) return;
  event.preventDefault();
  item.focus();
}

function DropdownMenuContent({ className, ...props }: Omit<ComponentPropsWithRef<"div">, "color">) {
  return (
    <Menu.Dropdown
      data-slot="dropdown-menu-content"
      className={cn("max-h-[calc(100dvh-5rem)] overflow-y-auto", className)}
      onKeyDown={focusEdgeItem}
      {...props}
    />
  );
}

type GroupLabel = { id: string; mount: () => () => void };
const GroupLabelContext = createContext<GroupLabel | null>(null);

/** A `role="group"` named by the DropdownMenuLabel inside it, when there is one. */
function DropdownMenuGroup(props: ComponentPropsWithRef<"div">) {
  const id = useId();
  const [labelled, setLabelled] = useState(false);
  const [label] = useState<GroupLabel>(() => ({
    id,
    mount: () => {
      setLabelled(true);
      return () => setLabelled(false);
    },
  }));
  return (
    <GroupLabelContext.Provider value={label}>
      <div
        data-slot="dropdown-menu-group"
        role="group"
        aria-labelledby={labelled ? id : undefined}
        {...props}
      />
    </GroupLabelContext.Provider>
  );
}

function DropdownMenuLabel({ className, ...props }: Omit<ComponentPropsWithRef<"div">, "color">) {
  const group = useContext(GroupLabelContext);
  useLayoutEffect(() => group?.mount(), [group]);
  return (
    <Menu.Label
      data-slot="dropdown-menu-label"
      id={group?.id}
      className={cn("px-1.5 py-1 text-xs font-semibold", className)}
      {...props}
    />
  );
}

const ITEM_VARIANTS = {
  default: {
    item: "gap-1.5 px-1.5 py-1 text-sm",
    label: "flex min-w-0 flex-1 items-center gap-1.5",
  },
  tile: {
    item: "h-auto min-h-20 w-full px-1 py-2 text-xs font-medium whitespace-normal aria-[current=page]:bg-(--mantine-color-default-hover)",
    label: "flex flex-col items-center justify-center gap-1 text-center",
  },
} as const;

/**
 * One menu entry. `render={<a href=… />}` makes it a link; every other prop
 * lands on the item.
 */
function DropdownMenuItem({
  className,
  variant = "default",
  render,
  ...props
}: Omit<ComponentPropsWithRef<"button">, "color"> & {
  variant?: keyof typeof ITEM_VARIANTS;
  render?: ReactElement<Record<string, unknown>, "a">;
}) {
  const styles = ITEM_VARIANTS[variant];
  const shared = {
    "data-slot": "dropdown-menu-item",
    "data-variant": variant,
    className: cn(
      "rounded-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      styles.item,
      className,
    ),
    classNames: { itemLabel: styles.label },
  };
  if (render === undefined) return <Menu.Item {...shared} {...props} />;
  const { ref: _ref, ...rest } = props;
  return (
    <Menu.Item
      {...shared}
      component="a"
      {...(render.props as ComponentPropsWithRef<"a">)}
      {...(rest as ComponentPropsWithRef<"a">)}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: Omit<ComponentPropsWithRef<"div">, "color">) {
  return <Menu.Divider data-slot="dropdown-menu-separator" className={className} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
