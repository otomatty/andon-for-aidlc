import type { OfficialDocsLocale } from "@aidlc-guide/shared-types";
import type { RefObject } from "react";
import { useEffect, useEffectEvent } from "react";
import { isExternal } from "@/services/docs.ts";
import { resolveGuideHref } from "@/features/docs/utils/docs-navigation.ts";
import { resolveOfficialDocHref } from "@/features/docs/utils/resolve-doc-href.ts";
import type { DocSelection } from "./types.ts";

/**
 * A bundled page a link points at, and where on it. `locale` is set when the
 * linking page was shown in a language of its own (a cited source), so the
 * destination opens in that language and its anchors still match.
 */
export type DocLinkTarget = {
  selection: DocSelection;
  anchor: string | undefined;
  locale?: OfficialDocsLocale;
};

/** What a rendered document needs to route its own links inside the docs shell. */
export interface DocLinks {
  knownPaths: readonly string[];
  guideNames: readonly string[];
  onFollow: (target: DocLinkTarget) => void;
}

function resolveDocLink(
  base: DocSelection,
  href: string,
  knownPaths: readonly string[],
  guideNames: readonly string[],
): DocLinkTarget | null {
  if (base.kind === "official") {
    const resolved = resolveOfficialDocHref(base.path, href, knownPaths);
    return resolved === null
      ? null
      : { selection: { kind: "official", path: resolved.path }, anchor: resolved.anchor };
  }
  const resolved = resolveGuideHref(base.name, href, guideNames);
  return resolved === null
    ? null
    : { selection: { kind: "guide", name: resolved.name }, anchor: resolved.anchor };
}

/**
 * Routes a click on a link inside `root`, a rendering of `base`: a bundled
 * page opens in the docs shell, a web link keeps the browser's default, and
 * anything else (a relative URL the bundle lacks) goes nowhere rather than
 * navigating the webview away from the app.
 */
function followDocLink(event: Event, root: Element, base: DocSelection, links: DocLinks): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a");
  if (anchor === null || !root.contains(anchor)) return;
  const href = anchor.getAttribute("href");
  if (href === null) return;
  const resolved = resolveDocLink(base, href, links.knownPaths, links.guideNames);
  if (resolved !== null) {
    event.preventDefault();
    links.onFollow(resolved);
    return;
  }
  if (!isExternal(href)) event.preventDefault();
}

/** Routes links in `root` while it shows `base`; inert when nothing is shown. */
export function useDocLinks(
  root: RefObject<HTMLElement | null>,
  base: DocSelection | null,
  links: DocLinks,
): void {
  const follow = useEffectEvent((event: Event, element: Element, page: DocSelection) =>
    followDocLink(event, element, page, links),
  );
  useEffect(() => {
    const element = root.current;
    if (element === null || base === null) return;
    const onClick = (event: Event): void => follow(event, element, base);
    element.addEventListener("click", onClick);
    return () => {
      element.removeEventListener("click", onClick);
    };
  }, [root, base]);
}
