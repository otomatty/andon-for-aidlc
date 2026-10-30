import { OFFICIAL_DOCS_SECTIONS } from "@andon/shared-types";

export interface OfficialDocHref {
  path: string;
  anchor: string | undefined;
}

const DOC_SECTIONS = new Set<string>(OFFICIAL_DOCS_SECTIONS);

/**
 * The section whose pages upstream keeps loose in the docs root, so its DocPath
 * has one segment more than the file's real depth: `overview/README.md` is
 * `docs/README.md`. Links written inside those pages are relative to the docs
 * root, which is where {@link baseForSection} sends them.
 */
const ROOT_SECTION = "overview";

/**
 * The directory a relative href in `currentPath` resolves against, as a
 * `docs/`-relative prefix.
 *
 * For every ordinary section that is just the page's own directory. For
 * `overview` it is the docs root: upstream's `docs/README.md` links its books
 * as `guide/00-introduction.md`, and resolving that against `overview/` would
 * invent `overview/guide/00-introduction.md`. Stripping the synthetic segment
 * makes the href mean what its author wrote.
 */
function baseForSection(currentPath: string): string {
  const slash = currentPath.indexOf("/");
  if (slash <= 0 || currentPath.slice(0, slash) !== ROOT_SECTION) return currentPath;
  return currentPath.slice(slash + 1);
}

/**
 * Classify a raw href segment the way the URL parser does before it walks the
 * path. A percent-encoded dot counts as a dot there — `%2e%2e/x` pops a
 * directory exactly as `../x` does, and `.%2e` and `%2e.` are the same segment
 * — so a walk over the raw text would wave those through and let `new URL`
 * apply the climb we meant to reject. Fold only that one encoding, so
 * `%2e%2e%2e` stays the ordinary name `...` rather than becoming a climb.
 */
function dotSegment(segment: string): "." | ".." | null {
  const folded = segment.toLowerCase().replace(/%2e/g, ".");
  return folded === "." || folded === ".." ? folded : null;
}

/**
 * Whether a relative href climbs above the docs root.
 *
 * `new URL` clamps `..` at the origin rather than failing, so `../README.md`
 * written in upstream's `docs/README.md` — which names the *repository* README,
 * a file we do not bundle — would silently resolve back to that same page and
 * render as a link to itself. Only `overview` pages sit shallow enough for that
 * to bite, and simulating the walk is the one way to tell "resolved to the
 * root" apart from "tried to leave it".
 *
 * `baseDepth` is how many directories deep the linking page sits below `docs/`.
 */
function climbsAboveRoot(baseDepth: number, hrefPath: string): boolean {
  let depth = hrefPath.startsWith("/") ? 0 : baseDepth;
  for (const segment of hrefPath.split("/")) {
    if (segment === "") continue;
    const dots = dotSegment(segment);
    if (dots === ".") continue;
    if (dots === null) {
      depth += 1;
      continue;
    }
    if (depth === 0) return true;
    depth -= 1;
  }
  return false;
}

/**
 * Map a `docs/`-relative path back to a DocPath. A path whose first segment is
 * a real section already is one; anything else is a loose docs-root file and
 * therefore belongs to `overview` (`roadmap.md` → `overview/roadmap.md`).
 * Returns null for a bare filename that is not a docs-root page.
 */
function toDocPath(
  relToDocsRoot: string,
  knownPaths: readonly string[] | undefined,
): string | null {
  const slash = relToDocsRoot.indexOf("/");
  if (slash > 0 && DOC_SECTIONS.has(relToDocsRoot.slice(0, slash))) {
    return relToDocsRoot.slice(slash + 1) === "" ? null : relToDocsRoot;
  }
  // Generated overview pages can have subdirectories (release history).
  // Only accept these when the bundled catalog confirms the destination.
  if (slash >= 0 && !knownPaths?.includes(`${ROOT_SECTION}/${relToDocsRoot}`)) return null;
  return `${ROOT_SECTION}/${relToDocsRoot}`;
}

/**
 * When a directory href rewrote to README.md, pick a page that actually exists
 * in the TOC. Prefer the README when it is catalogued; otherwise the first
 * page under that folder. Without a catalog, the README rewrite stands.
 */
function landingForDirectory(
  readmePath: string,
  knownPaths: readonly string[] | undefined,
): string | null {
  if (knownPaths === undefined) return readmePath;
  if (knownPaths.includes(readmePath)) return readmePath;
  const prefix = readmePath.replace(/\/README\.md$/i, "/");
  return knownPaths.find((p) => p.startsWith(prefix) && p.toLowerCase().endsWith(".md")) ?? null;
}

/**
 * Resolve a markdown href against the current official-docs page path
 * (`<section>/…`). http(s), other schemes, path escapes, and non-`.md` targets
 * return null — the caller must not treat those as in-app navigation.
 *
 * `knownPaths` is the flattened TOC. Directory hrefs use it so folders
 * without a README (e.g. `04-stages/`) land on a real page instead of 404.
 */
export function resolveOfficialDocHref(
  currentPath: string,
  href: string,
  knownPaths?: readonly string[],
): OfficialDocHref | null {
  const trimmed = href.trim();
  if (trimmed === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) return null;

  const current = baseForSection(currentPath.replace(/\\/g, "/").replace(/^\/+/, "").trim());
  if (current === "" || current.includes("\0")) return null;

  // Directories between `docs/` and the linking page — its own name excluded.
  const baseDepth = current.split("/").length - 1;
  if (climbsAboveRoot(baseDepth, trimmed.split("#")[0]?.split("?")[0] ?? "")) return null;

  let pathname: string;
  let fragment: string;
  try {
    const url = new URL(trimmed, `https://docs.local/${current}`);
    if (url.hostname !== "docs.local") return null;
    pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    fragment = url.hash.startsWith("#") ? decodeURIComponent(url.hash.slice(1)) : "";
  } catch {
    return null;
  }

  let fromDirectory = false;
  if (pathname.endsWith("/")) {
    pathname = `${pathname}README.md`;
    fromDirectory = true;
  } else if (!pathname.toLowerCase().endsWith(".md")) {
    const last = pathname.slice(pathname.lastIndexOf("/") + 1);
    if (last.includes(".")) return null;
    pathname = `${pathname}/README.md`;
    fromDirectory = true;
  }

  if (pathname === "" || pathname.includes("\0") || pathname.includes("\\")) return null;
  if (pathname.split("/").some((part) => part === "" || part === "..")) return null;
  if (!pathname.toLowerCase().endsWith(".md")) return null;

  const docPath = toDocPath(pathname, knownPaths);
  if (docPath === null) return null;
  pathname = docPath;

  if (fromDirectory) {
    const landing = landingForDirectory(pathname, knownPaths);
    if (landing === null) return null;
    pathname = landing;
  }

  return { path: pathname, anchor: fragment === "" ? undefined : fragment };
}
