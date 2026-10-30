import { guardPath, readBounded, withResult } from "@andon/core-utils";
import type { ReadResult } from "@andon/shared-types";
import { readManifest } from "./manifest.ts";
import { extractTitle, headingExists } from "./markdown.ts";
import { isLocale, localeContentRoot, parseDocPath } from "./roots.ts";
import type {
  AnchorApplied,
  DocSection,
  Locale,
  PageNotice,
  ResolvedPage,
  ResolvePageInput,
} from "./types.ts";

function anchorApplied(body: string, anchor: string | undefined): AnchorApplied {
  if (anchor === undefined || anchor.trim() === "") return "none";
  return headingExists(body, anchor) ? "scrolled" : "top";
}

async function readLocaleFile(
  workspaceRoot: string,
  section: DocSection,
  locale: Locale,
  relFile: string,
): Promise<ReadResult<string>> {
  const contentRoot = localeContentRoot(workspaceRoot, section, locale);
  const guarded = await guardPath(contentRoot, relFile);
  if (!("ok" in guarded)) {
    return { error: true, reason: "path_rejected" };
  }
  const bounded = await readBounded(guarded.value);
  if (!bounded.ok) {
    return { error: true, reason: "not_found" };
  }
  return { ok: true, value: bounded.value };
}

/**
 * Resolve a locale-scoped official docs page (F1 / BR-OD-1–5).
 *
 * DocPath is `<section>/…` (see types.ts). Escape → `path_rejected`.
 * Requested `ja` with missing file → en body + `notice: "missing_ja"` (ok result).
 */
export async function resolvePage(input: ResolvePageInput): Promise<ReadResult<ResolvedPage>> {
  return withResult(async () => {
    const { workspaceRoot, path: rawPath, anchor } = input;

    if (!isLocale(input.locale)) {
      return { error: true, reason: "path_rejected" };
    }
    const locale: Locale = input.locale;

    const parsed = parseDocPath(rawPath);
    if (parsed === null) {
      return { error: true, reason: "path_rejected" };
    }

    let bodyMarkdown: string;
    let localeServed: Locale = locale;
    let notice: PageNotice | undefined;

    const primary = await readLocaleFile(workspaceRoot, parsed.section, locale, parsed.relFile);

    if ("ok" in primary) {
      bodyMarkdown = primary.value;
    } else if ("error" in primary && primary.reason === "path_rejected") {
      return primary;
    } else if (locale === "ja") {
      const enBody = await readLocaleFile(workspaceRoot, parsed.section, "en", parsed.relFile);
      if ("ok" in enBody) {
        bodyMarkdown = enBody.value;
        localeServed = "en";
        notice = "missing_ja";
      } else if ("error" in enBody && enBody.reason === "path_rejected") {
        return enBody;
      } else {
        return { error: true, reason: "not_found" };
      }
    } else {
      return { error: true, reason: "not_found" };
    }

    const manifest = await readManifest(workspaceRoot);
    const sourceVersion = "ok" in manifest ? manifest.value.sourceVersion : "";

    const title = extractTitle(bodyMarkdown);
    const page: ResolvedPage = {
      localeRequested: locale,
      localeServed,
      path: parsed.docPath,
      bodyMarkdown,
      ...(title !== undefined ? { title } : {}),
      ...(notice !== undefined ? { notice } : {}),
      sourceVersion,
      anchorApplied: anchorApplied(bodyMarkdown, anchor),
    };
    return { ok: true, value: page };
  });
}
