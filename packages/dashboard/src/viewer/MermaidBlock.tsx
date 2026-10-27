import type mermaid from "mermaid";
import type { MermaidConfig } from "mermaid";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * FR-6.3 / S-AV-4. Props are `{ code }` and nothing else: the block knows only
 * "the text inside a mermaid fence", never how the surrounding document was
 * rendered. That is what makes it survive a renderer swap untouched
 * (nfr-design/logical-components.md「ADR-05 隔離の担保」).
 */

type MermaidApi = typeof mermaid;

let engine: Promise<MermaidApi> | null = null;

function cssColor(varName: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${varName}, ${fallback})`;
  document.documentElement.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return serializeColor(value === "" ? fallback : value, fallback);
}

function isLegacyColor(color: string): boolean {
  return /^(?:#|rgb\(|rgba\(|hsl\(|hsla\()/i.test(color.trim());
}

/**
 * Mermaid/Khroma cannot parse CSS Color 4 colours. Canvas stores `oklch()` as
 * hex/rgb, but keeps `color(srgb …)`, which a `color-mix()` token (the VS Code
 * theme's palette in globals.css) computes to, as written: that one is drawn
 * and read back as rgba.
 */
function serializeColor(color: string, fallback: string): string {
  if (isLegacyColor(color)) return color;
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx === null) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = color;
  if (isLegacyColor(ctx.fillStyle)) return ctx.fillStyle;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
}

function isDarkUi(): boolean {
  return (
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast")
  );
}

function themeStamp(): string {
  const root = document.documentElement;
  return [
    root.className,
    root.getAttribute("data-theme") ?? "",
    root.getAttribute("style") ?? "",
    document.body.className,
    document.body.getAttribute("style") ?? "",
    document.body.getAttribute("data-vscode-theme-kind") ?? "",
    document.body.getAttribute("data-vscode-theme-name") ?? "",
    document.body.getAttribute("data-vscode-theme-id") ?? "",
  ].join("|");
}

/** Re-render when dashboard / VS Code theme class changes (baked SVG colours). */
function useThemeRevision(): string {
  const [revision, setRevision] = useState(themeStamp);
  useEffect(() => {
    const sync = (): void => {
      setRevision(themeStamp());
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "data-vscode-theme-kind",
        "data-vscode-theme-name",
        "data-vscode-theme-id",
      ],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return revision;
}

/** Map the live document tokens (incl. VS Code `--vscode-*` via globals.css) into mermaid. */
function mermaidConfig(): MermaidConfig {
  const dark = isDarkUi();
  const fg = cssColor("--foreground", dark ? "#e6e6e6" : "#1a1a1a");
  const bg = cssColor("--background", dark ? "#1e1e1e" : "#ffffff");
  const muted = cssColor("--muted", dark ? "#2b2b2b" : "#f4f4f5");
  const border = cssColor("--border", dark ? "#555555" : "#d4d4d8");
  return {
    securityLevel: "strict",
    startOnLoad: false,
    // mermaid 12 switched unconfigured diagrams to the bundled ELK layout and
    // the `neo` look. Pin the v11 rendering so a dependency bump does not
    // silently reshape every diagram, and the ~1.4 MB ELK chunk is never fetched.
    layout: "dagre",
    look: "classic",
    theme: "base",
    themeVariables: {
      darkMode: dark,
      background: bg,
      primaryColor: muted,
      primaryTextColor: fg,
      primaryBorderColor: border,
      secondaryColor: muted,
      tertiaryColor: bg,
      lineColor: fg,
      textColor: fg,
      mainBkg: muted,
      actorBkg: muted,
      actorBorder: border,
      actorTextColor: fg,
      actorLineColor: fg,
      signalColor: fg,
      signalTextColor: fg,
      labelBoxBkgColor: muted,
      labelBoxBorderColor: border,
      labelTextColor: fg,
      loopTextColor: fg,
      noteBkgColor: muted,
      noteBorderColor: border,
      noteTextColor: fg,
      activationBkgColor: muted,
      activationBorderColor: border,
      sequenceNumberColor: fg,
    },
  };
}

/**
 * Module-scope memo (P-AV-3): the library is fetched on the first diagram in
 * the session and never again. `securityLevel: "strict"` disables click
 * bindings and script content; `startOnLoad: false` stops mermaid from
 * scanning the document behind our back (S-AV-4).
 */
function mermaidEngine(): Promise<MermaidApi> {
  engine ??= import("mermaid").then((module) => {
    module.default.initialize(mermaidConfig());
    return module.default;
  });
  return engine;
}

/** Test seam: drops the memo so a fresh `initialize` can be observed. */
export function resetMermaidEngine(): void {
  engine = null;
}

let sequence = 0;

/**
 * Mermaid hands back an SVG *string*. It is parsed with `DOMParser` and
 * adopted as a node rather than assigned to `innerHTML`: DOMParser does not
 * execute scripts, and the ban on raw HTML injection (S-AV-3) holds with no
 * exception carved out for this component.
 *
 * The parse is `text/html`, **not** `image/svg+xml`. With `htmlLabels` on (the
 * default) mermaid renders every node label as XHTML inside a `<foreignObject>`
 * and turns a `\n` in a label into a bare `<br>` — a void tag with no closing
 * slash. `image/svg+xml` is XML-strict, so it rejects that whole document with
 * `Opening and ending tag mismatch: br line 1 and p`, and every diagram whose
 * labels wrap onto two lines degraded to its source code. The HTML parser
 * applies the SVG foreign-content rules, so `viewBox` and friends keep their
 * camelCase and the tree still lands in the SVG namespace; it just also
 * tolerates the void tags mermaid actually emits.
 */
function adopt(host: HTMLElement, svg: string): void {
  const parsed = new DOMParser().parseFromString(svg, "text/html");
  const root = parsed.body.querySelector("svg");
  if (root === null) {
    throw new Error("mermaid returned unparseable SVG");
  }
  host.replaceChildren(document.importNode(root, true));
}

export function MermaidBlock({ code }: { code: string }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const themeRevision = useThemeRevision();

  // themeRevision re-runs the effect; it is not read in the body
  useEffect(() => {
    let live = true;
    setFailed(false);
    sequence += 1;
    const id = `mermaid-${sequence}`;

    // Diagrams render one by one and independently: a failure here shows this
    // block as code and leaves every other diagram on the page alone (D3
    // partial).
    void mermaidEngine()
      .then(async (mermaid) => {
        mermaid.initialize(mermaidConfig());
        const { svg } = await mermaid.render(id, code);
        if (!live || host.current === null) return;
        adopt(host.current, svg);
      })
      .catch(() => {
        if (live) setFailed(true);
      });

    return () => {
      live = false;
    };
  }, [code, themeRevision]);

  if (failed) {
    return (
      <figure className="viewer__diagram" data-testid="mermaid-fallback">
        <pre className="viewer__raw">
          <code>{code}</code>
        </pre>
        <figcaption className="viewer__note" role="status">
          図として描画できません（構文を確認してください）
        </figcaption>
      </figure>
    );
  }

  return <div className="viewer__diagram" data-testid="mermaid-diagram" ref={host} />;
}
