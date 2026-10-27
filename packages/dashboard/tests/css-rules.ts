/**
 * The declarations of a stylesheet, by selector, for tests that pin CSS jsdom
 * never applies. Comments are dropped and whitespace is collapsed; a selector
 * that appears in several rules collects the declarations of all of them.
 */
export function cssRules(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Split the selector list on top-level commas only: `:is(p, ul)` is one selector.
    const selectors = (match[1] ?? "")
      .split(/,(?![^(]*\))/)
      .map((s) => s.trim().replace(/\s+/g, " "));
    const body = (match[2] ?? "")
      .split(";")
      .map((d) => d.trim().replace(/\s+/g, " "))
      .filter((d) => d !== "");
    for (const selector of selectors) out.set(selector, [...(out.get(selector) ?? []), ...body]);
  }
  return out;
}
