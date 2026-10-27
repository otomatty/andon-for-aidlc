import { CloseButton, Drawer, Modal } from "@mantine/core";
import { useUncontrolled } from "@mantine/hooks";
import { createContext, useContext, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Slot, type SlotProps } from "./slot.tsx";

type DialogState = { open: boolean; setOpen: (open: boolean) => void };

const DialogContext = createContext<DialogState | null>(null);
/** Whether the open popup is a Modal or a right-hand Drawer, so the title uses the matching part. */
const DialogKindContext = createContext<"modal" | "drawer">("modal");

function useDialog(): DialogState {
  const state = useContext(DialogContext);
  if (state === null) throw new Error("Dialog parts must be inside <Dialog>.");
  return state;
}

/**
 * Open state shared by the trigger, the popup and its close buttons; Mantine's
 * Modal (or Drawer, for `size="drawer"`) draws the popup.
 */
function Dialog({
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
  const [value, setOpen] = useUncontrolled({
    value: open,
    defaultValue: defaultOpen,
    finalValue: false,
    onChange: onOpenChange,
  });
  return (
    <DialogContext.Provider value={{ open: value, setOpen }}>{children}</DialogContext.Provider>
  );
}

const TRIGGER_VARIANTS = {
  default: "",
  screenshot:
    "group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
} as const;

function DialogTrigger({
  className,
  variant = "default",
  ...props
}: SlotProps & { className?: string; variant?: keyof typeof TRIGGER_VARIANTS }) {
  const { open, setOpen } = useDialog();
  const look = TRIGGER_VARIANTS[variant];
  return (
    <Slot
      data-slot="dialog-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn(look, className)}
      onClick={() => setOpen(true)}
      {...props}
    />
  );
}

function DialogClose(props: SlotProps) {
  const { setOpen } = useDialog();
  return <Slot data-slot="dialog-close" onClick={() => setOpen(false)} {...props} />;
}

/** Centered sizes as Mantine's `--modal-size`; the popup scrolls when taller than the viewport. */
const MODAL_SIZES = { default: "sm", scroll: "sm", lg: "32rem", xl: "48rem" } as const;

const DRAWER_CLASSES =
  "relative flex flex-col overflow-hidden **:data-[slot=dialog-header]:shrink-0 **:data-[slot=dialog-header]:border-b **:data-[slot=dialog-header]:p-4 **:data-[slot=dialog-header]:pr-12";

// Mantine puts a Modal or Drawer content's `className` on its fixed wrapper as
// well, so the popup's own classes go through `classNames.content`.
function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "default",
  ...props
}: Omit<ComponentPropsWithRef<"div">, "color"> & {
  showCloseButton?: boolean;
  size?: keyof typeof MODAL_SIZES | "drawer";
}) {
  const { open, setOpen } = useDialog();
  const onClose = () => setOpen(false);
  const close = showCloseButton ? (
    <CloseButton
      data-slot="dialog-close"
      aria-label="閉じる"
      className="absolute top-2 right-2"
      onClick={onClose}
    />
  ) : null;

  if (size === "drawer") {
    return (
      <Drawer.Root opened={open} onClose={onClose} position="right" size="min(100%, 42rem)">
        <Drawer.Overlay backgroundOpacity={0.4} />
        <Drawer.Content
          data-slot="dialog-content"
          data-size={size}
          classNames={{ content: cn(DRAWER_CLASSES, className) }}
          {...props}
        >
          <DialogKindContext.Provider value="drawer">{children}</DialogKindContext.Provider>
          {close}
        </Drawer.Content>
      </Drawer.Root>
    );
  }

  return (
    <Modal.Root opened={open} onClose={onClose} centered radius="md" size={MODAL_SIZES[size]}>
      <Modal.Overlay backgroundOpacity={0.4} />
      <Modal.Content
        data-slot="dialog-content"
        data-size={size}
        classNames={{ content: className }}
        {...props}
      >
        <Modal.Body className="relative grid gap-4 text-sm">
          {children}
          {close}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

function DialogHeader({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: Omit<ComponentPropsWithRef<"h2">, "color">) {
  const Title = useContext(DialogKindContext) === "drawer" ? Drawer.Title : Modal.Title;
  return (
    <Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: ComponentPropsWithRef<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
