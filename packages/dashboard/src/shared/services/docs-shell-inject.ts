import type { DocsShellDeepLink, OfficialDocsLocale } from "@andon/shared-types";

type DocsShellDeepLinkHandler = (deepLink: DocsShellDeepLink) => void;
type OfficialDocsLocaleHandler = (locale: OfficialDocsLocale) => void;

const handlers = new Set<DocsShellDeepLinkHandler>();
const localeHandlers = new Set<OfficialDocsLocaleHandler>();
/** Host `ready` locale can arrive before App subscribes — hold one shot. */
let pendingOfficialDocsLocale: OfficialDocsLocale | null = null;

/** Register a store dispatch for host `docs-shell-deeplink` injects (Bolt 3). */
export function onDocsShellDeepLink(handler: DocsShellDeepLinkHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** Register a store dispatch for host locale bootstrap (panel open / ready). */
export function onOfficialDocsLocale(handler: OfficialDocsLocaleHandler): () => void {
  localeHandlers.add(handler);
  if (pendingOfficialDocsLocale !== null) {
    const locale = pendingOfficialDocsLocale;
    pendingOfficialDocsLocale = null;
    handler(locale);
  }
  return () => {
    localeHandlers.delete(handler);
  };
}

export function deliverOfficialDocsLocale(locale: OfficialDocsLocale): void {
  if (localeHandlers.size === 0) {
    pendingOfficialDocsLocale = locale;
    return;
  }
  pendingOfficialDocsLocale = null;
  for (const handler of localeHandlers) {
    handler(locale);
  }
}

export function parseDocsShellDeepLink(data: Record<string, unknown>): DocsShellDeepLink | null {
  const locale = data.locale;
  if (locale !== "en" && locale !== "ja") return null;
  const deepLink: DocsShellDeepLink = { locale: locale as OfficialDocsLocale };
  if (typeof data.path === "string" && data.path.length >= 1) {
    deepLink.path = data.path;
  }
  if (typeof data.anchor === "string" && data.anchor !== "") {
    deepLink.anchor = data.anchor;
  }
  return deepLink;
}

/** Deliver a parsed deep-link to every registered handler. */
export function deliverDocsShellDeepLink(deepLink: DocsShellDeepLink): void {
  for (const handler of handlers) {
    handler(deepLink);
  }
}
