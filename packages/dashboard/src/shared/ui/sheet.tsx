import { CloseButton, Drawer } from "@mantine/core";
import { createContext, useContext, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type SheetState = { open: boolean; onOpenChange: (open: boolean) => void };
const SheetContext = createContext<SheetState>({ open: false, onOpenChange: () => {} });

/** A side panel on Mantine's Drawer; the open state always comes from the caller. */
function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}) {
  return <SheetContext.Provider value={{ open, onOpenChange }}>{children}</SheetContext.Provider>;
}

function SheetContent({
  className,
  children,
  side = "right",
  size = "min(75%, 24rem)",
  showCloseButton = true,
  ...props
}: Omit<ComponentPropsWithRef<"div">, "color"> & {
  side?: "top" | "right" | "bottom" | "left";
  /** The panel's width (or height, for top and bottom), as any CSS length. */
  size?: string;
  showCloseButton?: boolean;
}) {
  const { open, onOpenChange } = useContext(SheetContext);
  const onClose = () => onOpenChange(false);
  return (
    <Drawer.Root opened={open} onClose={onClose} position={side} size={size}>
      <Drawer.Overlay backgroundOpacity={0.4} />
      <Drawer.Content
        data-slot="sheet-content"
        data-side={side}
        classNames={{ content: cn("relative flex flex-col gap-4 text-sm", className) }}
        {...props}
      >
        {/* First in the DOM, so opening a long panel focuses Close, not a control mid-list. */}
        {showCloseButton && (
          <CloseButton
            data-slot="sheet-close"
            aria-label="閉じる"
            className="absolute top-3 right-3"
            onClick={onClose}
          />
        )}
        {children}
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SheetHeader({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4 pr-12", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: Omit<ComponentPropsWithRef<"h2">, "color">) {
  return (
    <Drawer.Title
      data-slot="sheet-title"
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: ComponentPropsWithRef<"p">) {
  return (
    <p
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle };
