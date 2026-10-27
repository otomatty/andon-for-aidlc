import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssRules } from "@tests/css-rules.ts";
import { describe, expect, it } from "vitest";

/**
 * jsdom never applies app.css, so a DOM test cannot notice that Tailwind's
 * preflight stripped list markers or link colour from rendered Markdown. This
 * pins the declarations that undo it, plus the Docs-only reading measure.
 */

const APP_CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), "app.css");

const css = cssRules(readFileSync(APP_CSS, "utf8"));

function declarationsOf(selector: string): string[] {
  const found = css.get(selector);
  if (found === undefined) throw new Error(`app.css has no rule for ${selector}`);
  return found;
}

describe("app.css — Markdown undoes Tailwind preflight", () => {
  it("restores bullets, numbers and indentation on lists", () => {
    expect(declarationsOf(".viewer__surface ul")).toContain("list-style: disc");
    expect(declarationsOf(".viewer__surface ol")).toContain("list-style: decimal");
    expect(declarationsOf(".viewer__surface ul").join(";")).toMatch(/padding-left: \d/);
  });

  it("makes links look like links, following the VS Code link colour when present", () => {
    const link = declarationsOf(".viewer__surface a");
    expect(link.join(";")).toMatch(/color: var\(--vscode-textLink-foreground,/);
    expect(link).toContain("text-decoration: underline");
  });

  it("drops the bullet from a task item, which shows a checkbox instead", () => {
    expect(declarationsOf(".viewer__surface .viewer__task-item")).toContain("list-style: none");
  });

  it("separates a horizontal rule from the text around it", () => {
    expect(declarationsOf(".viewer__surface hr").join(";")).toMatch(/margin-block: [1-9]/);
  });

  it("lets a wide table scroll inside its own box", () => {
    expect(declarationsOf(".viewer__table-scroll")).toContain("overflow-x: auto");
  });

  it.each(["note", "tip", "important", "warning", "caution"])(
    "gives the %s callout its own accent",
    (kind) => {
      expect(declarationsOf(`.viewer__callout[data-callout="${kind}"]`).join(";")).toMatch(
        /--callout-accent: /,
      );
    },
  );
});

describe("app.css — Docs articles read as long-form text", () => {
  it("opens the leading and caps the line length of prose", () => {
    const article = declarationsOf(".docs-article .viewer__surface");
    expect(article).toContain("font-size: 1rem");
    expect(article).toContain("line-height: 1.85");
    expect(
      declarationsOf(
        ".docs-article .viewer__surface > :is(p, ul, ol, blockquote, hr, h3, h4, h5, h6)",
      ),
    ).toContain("max-inline-size: 42rem");
  });

  it("leaves diagrams and code the full column instead of the prose measure", () => {
    for (const selector of [".docs-article .viewer__surface", ".docs-article .viewer__mermaid"]) {
      expect(css.get(selector)?.join(";") ?? "").not.toMatch(/max-inline-size/);
    }
  });

  it("sizes inline code only, leaving fenced code blocks at their block size", () => {
    expect(css.has(".docs-article .viewer__surface code")).toBe(false);
    expect(declarationsOf(".docs-article .viewer__surface :not(pre) > code")).toContain(
      "font-size: 0.875em",
    );
  });

  it("keeps table cells from splitting short tokens mid-word", () => {
    expect(declarationsOf(".docs-article .viewer__table")).toContain("overflow-wrap: normal");
  });

  it("marks off a ## section with space and a rule", () => {
    const section = declarationsOf(".docs-article .viewer__surface h4").join(";");
    expect(section).toMatch(/margin-top: 2\.5em/);
    expect(section).toMatch(/border-bottom: 1px solid/);
  });
});
