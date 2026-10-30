import type { DocsShellDeepLinkMessage, OfficialDocsLocale } from "@andon/shared-types";
import type { ExtensionContext, Webview } from "vscode";

/** Persist last Official Docs locale preference (Bolt 3). */
export const OFFICIAL_DOCS_LOCALE_KEY = "andon.officialDocsLocale";

export type OpenOfficialDocOutcome =
  | { ok: true; inject: DocsShellDeepLinkMessage }
  | { ok: false; reason: "invalid" };

function isLocale(value: unknown): value is OfficialDocsLocale {
  return value === "en" || value === "ja";
}

/**
 * Validate an `open-official-doc` message.
 * On fail: ignore (no persist, no Shell) — BLM F3.
 * On success: persist locale + return inject payload (no `vscode.open`).
 */
export function handleOpenOfficialDoc(
  message: unknown,
  context: Pick<ExtensionContext, "globalState">,
): OpenOfficialDocOutcome {
  if (typeof message !== "object" || message === null) {
    return { ok: false, reason: "invalid" };
  }
  const msg = message as Record<string, unknown>;
  if (msg.type !== "open-official-doc") {
    return { ok: false, reason: "invalid" };
  }
  if (!isLocale(msg.locale)) {
    return { ok: false, reason: "invalid" };
  }

  const hasPathKey = Object.hasOwn(msg, "path");
  const hasAnchorKey = Object.hasOwn(msg, "anchor");

  if (hasPathKey) {
    if (typeof msg.path !== "string" || msg.path.length < 1) {
      // Empty / non-string path is not unmapped success (BLM invariant).
      return { ok: false, reason: "invalid" };
    }
    if (hasAnchorKey && msg.anchor !== undefined && typeof msg.anchor !== "string") {
      return { ok: false, reason: "invalid" };
    }
    void context.globalState.update(OFFICIAL_DOCS_LOCALE_KEY, msg.locale);
    const inject: DocsShellDeepLinkMessage = {
      type: "docs-shell-deeplink",
      locale: msg.locale,
      path: msg.path,
      ...(typeof msg.anchor === "string" && msg.anchor !== "" ? { anchor: msg.anchor } : {}),
    };
    return { ok: true, inject };
  }

  // Unmapped: locale only — reject stray anchor without path.
  if (hasAnchorKey) {
    return { ok: false, reason: "invalid" };
  }

  void context.globalState.update(OFFICIAL_DOCS_LOCALE_KEY, msg.locale);
  return {
    ok: true,
    inject: { type: "docs-shell-deeplink", locale: msg.locale },
  };
}

/** Last persisted locale; corrupt / missing → `"ja"`. */
export function getLastOfficialDocsLocale(
  context: Pick<ExtensionContext, "globalState">,
): OfficialDocsLocale {
  const stored = context.globalState.get(OFFICIAL_DOCS_LOCALE_KEY);
  return isLocale(stored) ? stored : "ja";
}

/** Inject deep-link into the webview (Shell open is the webview's job). */
export function injectDocsShellDeepLink(
  webview: Pick<Webview, "postMessage">,
  inject: DocsShellDeepLinkMessage,
): void {
  void webview.postMessage(inject);
}
