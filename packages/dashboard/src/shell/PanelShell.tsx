import { XIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useEffectEvent, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The scrolling content region of a panel.
 *
 * The body sizes to its content; App owns scrolling for both current progress
 * and page content, below the fixed header.
 */
export function PanelBody({ className, ...props }: ComponentProps<"div">): ReactNode {
  return <div className={cn("flex flex-none flex-col gap-4", className)} {...props} />;
}

/**
 * An open popup (dialog, drawer, menu, listbox) closes on Escape itself; the
 * page responds only to an Escape nothing else has taken.
 */
const POPUP = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[aria-haspopup="menu"][aria-expanded="true"]',
  '[aria-haspopup="listbox"][aria-expanded="true"]',
].join(", ");

function escapeBelongsToPopup(event: KeyboardEvent): boolean {
  const target = event.target;
  if (target instanceof Element && target.closest(POPUP) !== null) return true;
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

export interface PanelShellProps {
  /** `aria-labelledby` target id for the heading. */
  headingId: string;
  /** `data-testid` of the `aside`. */
  testId: string;
  title: ReactNode;
  headingFont?: "body" | "mono";
  /** Keep the accessible heading and focus target without duplicating the page title. */
  hideHeading?: boolean;
  /** Bar content rendered before the heading (back button, menu, …). */
  leading?: ReactNode;
  /** Extra action buttons rendered before the close button. */
  actions?: ReactNode;
  /** Omit when the page uses navigation instead of a close button. */
  closeTestId?: string;
  onClose: () => void;
  /**
   * Re-runs the focus save/heading-focus cycle when it changes (DetailPanel
   * re-focuses per stage). Mount/unmount alone covers open/close panels.
   */
  focusKey?: unknown;
  /** Persistent navigation control to focus when its menu item has unmounted. */
  returnFocusSelector?: string;
  children: ReactNode;
}

/**
 * The frame every side panel shares: Escape to close, the panel `aside` with
 * its bar/heading/close button, and the focus save-and-restore cycle. Panels
 * own only their bar extras and body — this existed as three near-identical
 * copies (Detail/Agent/Guides) before being extracted.
 *
 * The page stays in normal flow after the shared progress region.
 */
export function PanelShell({
  headingId,
  testId,
  title,
  headingFont = "mono",
  hideHeading = false,
  leading,
  actions,
  closeTestId,
  onClose,
  focusKey,
  returnFocusSelector,
  children,
}: PanelShellProps): ReactNode {
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<Element | null>(null);

  // focusKey is a re-run trigger, not read in the body
  useEffect(() => {
    const panelElement = panel.current;
    trigger.current = document.activeElement;
    heading.current?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      // Preserve an explicit move to navigation or another mounted page.
      // Body focus after unmount still needs the usual opener restoration.
      if (
        active !== null &&
        active !== document.body &&
        active.isConnected &&
        !panelElement?.contains(active)
      ) {
        return;
      }
      const opener =
        (returnFocusSelector === undefined ? null : document.querySelector(returnFocusSelector)) ??
        trigger.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [focusKey, returnFocusSelector]);

  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || escapeBelongsToPopup(event)) return;
    onClose();
  });
  useEffect(() => {
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  return (
    <aside
      ref={panel}
      className="flex w-full flex-col bg-background p-4 text-foreground"
      aria-labelledby={headingId}
      data-testid={testId}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {leading}
        <h2
          id={headingId}
          className={cn(
            hideHeading
              ? "sr-only"
              : "m-0 flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-2 text-page-title font-bold wrap-anywhere",
            headingFont === "mono" ? "font-mono" : "font-sans",
          )}
          ref={heading}
          tabIndex={-1}
        >
          {title}
        </h2>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          {actions}
          {closeTestId === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onClose}
              data-testid={closeTestId}
              aria-label="閉じる"
              title="閉じる"
            >
              <XIcon />
            </Button>
          )}
        </div>
      </div>
      {children}
    </aside>
  );
}
