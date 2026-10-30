import { normalizeAnchor, slugifyHeading } from "@andon/shared-types";
import { type RefObject, useEffect } from "react";
import type { AnchorApplied } from "../../types.ts";
import { focusHeading } from "../../utils/focus-heading.ts";

export type { AnchorApplied };

export interface AnchorApplierProps {
  /** Outcome from OfficialDocsPage (FR-B2-3). */
  anchorApplied: AnchorApplied | undefined;
  /** Requested fragment (without `#`); required for `scrolled`. */
  anchor?: string;
  articleRef: RefObject<HTMLElement | null>;
  /** Re-run when body content changes (path/locale/markdown). */
  contentKey?: string;
}

/**
 * GitHub-style heading slug — the same function official-docs writes deep
 * links with, taken from the wire contract rather than copied. shared-types is
 * the one package the dashboard may import (no reader-core, no official-docs).
 */
export { slugifyHeading };

/**
 * Apply `page.anchorApplied` after load (FR-B2-3):
 * - scrolled → scroll/focus matching heading
 * - top → scroll/focus article top
 * - none → noop
 */
export function AnchorApplier({
  anchorApplied,
  anchor,
  articleRef,
  contentKey,
}: AnchorApplierProps): null {
  // contentKey re-runs after body swap
  useEffect(() => {
    const root = articleRef.current;
    if (root === null || anchorApplied === undefined || anchorApplied === "none") return;

    if (anchorApplied === "top") {
      root.scrollIntoView({ block: "start" });
      root.focus({ preventScroll: true });
      return;
    }

    const wanted = anchor === undefined ? "" : normalizeAnchor(anchor);
    if (wanted === "") return;

    const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (const node of headings) {
      if (!(node instanceof HTMLElement)) continue;
      if (slugifyHeading(node.textContent ?? "") !== wanted) continue;
      focusHeading(node);
      return;
    }
  }, [anchorApplied, anchor, articleRef, contentKey]);

  return null;
}
