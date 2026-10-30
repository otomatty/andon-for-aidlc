import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { upstreamBlobUrl } from "@andon/shared-types";

export const CHANGELOG_INDEX_PATH = "overview/changelog.md";

/** Split the upstream history so the reader only renders one release at a time. */
export function buildChangelogPages(markdown: string): Map<string, string> {
  const source = markdown.replace(/\r\n/g, "\n");
  const headings = [...source.matchAll(/^## \[([^\]\n]+)\][^\n]*$/gm)];
  if (headings.length === 0) throw new Error("CHANGELOG.md has no release headings");
  const pages = new Map<string, string>();
  const index = [
    "# aidlc-workflows release history",
    "",
    "Release dates, improvements, fixes and upgrade notes from the bundled upstream CHANGELOG.md. Select a version to read its complete entry in English.",
    "",
    "[改善点の日本語ガイド](release-highlights.md)",
    "",
    "| Version | Date |",
    "| --- | --- |",
  ];
  for (const [i, heading] of headings.entries()) {
    const version = heading[1] ?? "";
    if (!/^(?:\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?|Unreleased)$/.test(version)) {
      throw new Error(`Unsupported CHANGELOG heading: ${version}`);
    }
    const docPath = `overview/releases/${version}.md`;
    if (pages.has(docPath)) throw new Error(`Duplicate CHANGELOG release: ${version}`);
    const date = /\d{4}-\d{2}-\d{2}/.exec(heading[0])?.[0] ?? "Unreleased";
    const entry = source.slice(heading.index, headings[i + 1]?.index).trim();
    // Changelog links are relative to the repository root, not docs/overview/releases/.
    const body = entry.replace(
      /\]\((docs\/[^)]+)\)/g,
      (_match, target: string) => `](${upstreamBlobUrl(target)})`,
    );
    pages.set(
      docPath,
      `# aidlc-workflows ${version}\n\n[All releases / 更新履歴一覧](../changelog.md) · [改善点の日本語ガイド](../release-highlights.md)\n\n${body}\n`,
    );
    index.push(`| [${version}](releases/${version}.md) | ${date} |`);
  }
  pages.set(CHANGELOG_INDEX_PATH, `${index.join("\n")}\n`);
  return pages;
}

/** Older fixtures/docs-only checkouts can omit the root changelog; sync requires it. */
export function readChangelogPages(upstreamRoot: string): Map<string, string> {
  const file = path.join(upstreamRoot, "CHANGELOG.md");
  if (!existsSync(file)) return new Map();
  if (!lstatSync(file).isFile()) throw new Error("CHANGELOG.md must be a regular file");
  return buildChangelogPages(readFileSync(file, "utf8"));
}
