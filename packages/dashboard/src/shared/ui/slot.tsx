import { cloneElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type AnyProps = Record<string, unknown>;
type Handler = (...args: unknown[]) => void;

const HANDLER = /^on[A-Z]/;

/**
 * Merge a part's own props into the props of the element it renders as. The
 * element's props win, except that event handlers run both (the element's
 * first) and class names join.
 */
function mergeSlotProps(own: AnyProps, element: AnyProps): AnyProps {
  const merged: AnyProps = { ...own, ...element };
  for (const [key, value] of Object.entries(own)) {
    const theirs = element[key];
    if (HANDLER.test(key) && typeof value === "function" && typeof theirs === "function") {
      merged[key] = (...args: unknown[]) => {
        (theirs as Handler)(...args);
        (value as Handler)(...args);
      };
    }
  }
  if (own.className !== undefined || element.className !== undefined) {
    merged.className = cn(own.className as string, element.className as string) || undefined;
  }
  return merged;
}

type SlotProps = AnyProps & {
  /** The element this part renders as; a `<button type="button">` when unset. */
  render?: ReactElement;
  children?: ReactNode;
};

/**
 * The `render` prop the dashboard's trigger parts share: the caller hands an
 * element (often a `<Button>`) and the part adds its behaviour to it. Children
 * passed to the part replace the element's own.
 */
function Slot({ render, children, ...own }: SlotProps): ReactNode {
  if (render === undefined) {
    return (
      <button type="button" {...own}>
        {children}
      </button>
    );
  }
  const element = render.props as AnyProps;
  return cloneElement(
    render,
    mergeSlotProps(own, element),
    children === undefined ? (element.children as ReactNode) : children,
  );
}

export { mergeSlotProps, Slot, type SlotProps };
