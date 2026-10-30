#!/usr/bin/env bun
/**
 * Derive one learner-facing description per stage artifact from the bundled
 * official-docs snapshot, and write it to
 * `packages/docs-bridge/data/artifact-map.json`.
 *
 * That file is excluded from oxfmt in `.oxfmtrc.json` (`ignorePatterns`): this script owns its
 * formatting, and a second formatter rewriting it would make the byte-identity
 * check in `tests/artifact-map.test.ts` unsatisfiable.
 *
 * Usage:
 *   bun scripts/build-artifact-map.ts [--workspace <root>] [--out <file>]
 *   bun scripts/build-artifact-map.ts --check
 *   bun scripts/build-artifact-map.ts --accept-ja-order <stage>[,<stage>]
 *
 * Why derived rather than hand-written: `docs/reference/<locale>/04-stages/*.md`
 * already documents every artifact a stage writes, one row (or bullet) per file.
 * A second hand-maintained list would drift the moment upstream renames an
 * artifact — the same failure `16-artifact-vocabulary.md` avoids by deriving its
 * registry from `produces[]` instead of writing it down.
 *
 * The join key is the stage NUMBER (`2.7`), not the heading text: numbers are
 * identical across locales, headings are not. Which artifacts exist comes from
 * the compiled stage graph's `produces[]`, so a row the snapshot documents but
 * the stage no longer declares is dropped rather than shipped as a ghost entry.
 *
 * No network I/O: everything is read from this workspace.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { slugifyHeading } from "../packages/shared-types/src/index.ts";

export const LOCALES = ["en", "ja"] as const;
export type ArtifactLocale = (typeof LOCALES)[number];

/** Phase files under `docs/reference/<locale>/04-stages/`, in workflow order. */
export const PHASE_FILES = [
  "initialization",
  "ideation",
  "inception",
  "construction",
  "operation",
] as const;

export const OUT_REL = path.join("packages", "docs-bridge", "data", "artifact-map.json");

/** DocPath (official-docs convention) of one phase page. Locale is separate. */
export function phaseDocPath(phase: string): string {
  return `reference/04-stages/${phase}.md`;
}

/** One row of a stage's Outputs table or bullet list, in document order. */
export interface OutputRow {
  /** Bare filename when the row names one; null when the label is translated. */
  fileName: string | null;
  description: string;
}

export interface StageSection {
  /** `"2.7"` — the locale-independent join key. */
  number: string;
  /** `"#stage-27-units-generation"` — GitHub slug of the `##` heading. */
  anchor: string;
  /** DocPath of the page this section lives on. */
  docPath: string;
  rows: OutputRow[];
}

/**
 * `## Stage 2.7: Units Generation`, `## Stage 0.1 — Workspace Scaffold`,
 * `## ステージ 2.7: 単位生成`. The separator between number and name is a colon
 * in four phase files and an em dash in `initialization.md`.
 */
const STAGE_HEADING = /^##\s+(?:Stage|ステージ)\s+(\d+\.\d+)\s*(?:[:：]|[—–-])\s*\S/;

/** `### Outputs`, `### Key Outputs`, `### 出力`, `### 主な出力`. */
const OUTPUTS_HEADING = /^###\s+(?:(?:Key\s+)?Outputs|(?:主な)?出力)\s*$/;

/** Any `##`/`###` heading — where a section body stops. */
const ANY_HEADING = /^#{2,3}\s/;

/**
 * A bare artifact filename: no directory, no placeholder. Deliberately strict —
 * `<record>/verification/phase-check-ideation.md` and
 * `aidlc/spaces/<active-space>/memory/team.md` are paths the Outputs prose
 * mentions, not artifacts the stage declares.
 */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|json)$/;

/** Header cells, so a table's own heading row is never read as a data row. */
const HEADER_CELL =
  /^(?:#|file|files?name|artifacts?|contents?|descriptions?|conditions?|value|ファイル|成果物|内容|説明|条件|プロパティ|値)$/i;

function unwrap(cell: string): string {
  return cell
    .trim()
    .replace(/^`+|`+$/g, "")
    .trim();
}

function fileNameOf(cell: string): string | null {
  const text = unwrap(cell);
  return FILE_NAME.test(text) ? text : null;
}

/**
 * Collapse wrapped Markdown prose to the single line a card can render.
 *
 * The card renders this as text, not Markdown: a relative link like
 * `../13-runtime-graph.md` does not resolve from a stage card, and a one-line
 * caption is not a place for formatting. So the markup is removed here rather
 * than leaking raw brackets and backticks into the UI — link text, code span
 * and emphasised word all survive, only their syntax goes.
 */
/**
 * Replace `[text](destination)` — and `![alt](destination)` — with just the
 * text, tracking nesting so a destination containing parentheses is consumed
 * whole. A regex that stops at the first `)` leaves the tail behind:
 * `[Guide](../foo_(draft).md)` becomes `Guide.md)` on the card.
 *
 * A bracket with no destination, and an unbalanced one, are both left exactly
 * as written — better a literal bracket than a swallowed sentence.
 */
export function stripMarkdownLinks(text: string): string {
  let out = "";
  let at = 0;

  while (at < text.length) {
    const open = text.indexOf("[", at);
    if (open === -1) break;

    const close = text.indexOf("]", open);
    if (close === -1) break;
    if (text[close + 1] !== "(") {
      out += text.slice(at, close + 1);
      at = close + 1;
      continue;
    }

    let depth = 1;
    let scan = close + 2;
    while (scan < text.length && depth > 0) {
      if (text[scan] === "(") depth += 1;
      else if (text[scan] === ")") depth -= 1;
      scan += 1;
    }
    if (depth !== 0) {
      out += text.slice(at, close + 1);
      at = close + 1;
      continue;
    }

    // Drop the `!` of an image along with the brackets.
    const start = open > 0 && text[open - 1] === "!" ? open - 1 : open;
    out += text.slice(at, start) + text.slice(open + 1, close);
    at = scan;
  }

  return out + text.slice(at);
}

export function tidyDescription(raw: string): string {
  const linkless = stripMarkdownLinks(raw.replace(/\s+/g, " "));
  return linkless
    .replace(/^(?:[-–—]{1,2}|[:：])\s*/, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  return trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
}

function isSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function isHeader(cells: string[]): boolean {
  return cells.some((cell) => HEADER_CELL.test(unwrap(cell)));
}

/**
 * Pull the Outputs rows out of one stage section, in document order. Two shapes
 * appear upstream and both are used by real stages, so both are parsed:
 *
 *   - pipe tables, `| File | Contents |` or `| # | File | Contents |`
 *   - bullet lists, `` - `team-practices.md` -- descriptive, team-voice prose ``
 *
 * A row whose first column is a translated label rather than a filename still
 * becomes a row, with `fileName: null` — the ja construction and operation pages
 * translate that column, and dropping those rows would lose their descriptions.
 */
export function extractOutputRows(section: string): OutputRow[] {
  const rows: OutputRow[] = [];
  const lines = section.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    const cells = splitRow(line);
    if (cells.length >= 2) {
      if (isSeparator(cells) || isHeader(cells)) continue;
      // Skip a leading ordinal column (`| 1 | file | contents |`).
      const start = /^\d+$/.test(unwrap(cells[0] ?? "")) ? 1 : 0;
      const label = cells[start] ?? "";
      // The description is one cell. A third column is a Condition (Stage 3.6),
      // which belongs to the stage grid, not to what the file contains.
      const description = tidyDescription(cells[start + 1] ?? "");
      if (description === "") continue;
      rows.push({ fileName: fileNameOf(label), description });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet?.[1] === undefined) continue;
    const code = /^`([^`]+)`\s*(.*)$/.exec(bullet[1]);
    if (code?.[1] === undefined) continue;
    const fileName = fileNameOf(code[1]);
    if (fileName === null) continue;

    // Continuation lines of a wrapped bullet are indented; a blank line or a
    // new top-level bullet ends it.
    const parts = [code[2] ?? ""];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? "";
      if (next.trim() === "" || !/^\s+\S/.test(next)) break;
      parts.push(next.trim());
      i = j;
    }
    const description = tidyDescription(parts.join(" "));
    if (description !== "") rows.push({ fileName, description });
  }

  return rows;
}

/** Split one phase page into its per-stage Outputs sections. */
export function splitStageSections(markdown: string, phase: string): StageSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: StageSection[] = [];
  let current: StageSection | null = null;
  let collecting = false;
  let buffer: string[] = [];

  const flush = (): void => {
    if (current === null) return;
    if (buffer.length > 0) current.rows = extractOutputRows(buffer.join("\n"));
    sections.push(current);
    current = null;
    buffer = [];
    collecting = false;
  };

  for (const line of lines) {
    const heading = STAGE_HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      flush();
      current = {
        number: heading[1],
        anchor: `#${slugifyHeading(line)}`,
        docPath: phaseDocPath(phase),
        rows: [],
      };
      continue;
    }
    if (current === null) continue;

    if (OUTPUTS_HEADING.test(line)) {
      // A stage may carry both `### Outputs` and a later `### Key Outputs`;
      // keep the first, which is the enumerated one.
      if (buffer.length === 0) collecting = true;
      continue;
    }
    if (collecting && ANY_HEADING.test(line)) {
      collecting = false;
      continue;
    }
    if (collecting) buffer.push(line);
  }
  flush();
  return sections;
}

/**
 * Canonical artifact name and on-disk filename are allowed to differ — the
 * artifact vocabulary's collision-resolution policy. `build-test-results` lands
 * as `test-results.md`, and so does `load-test-results` in another stage.
 *
 * The bridge is each stage file's `outputs:` frontmatter line, which lists the
 * real filenames in `produces[]` order, followed by the `optional_produces[]`
 * files after `CONDITIONAL:`. An exact stem match wins wherever one exists, so a
 * reordered list only affects the genuinely aliased names; when the two lists
 * disagree in length, position means nothing and is not used.
 */
export interface ResolvedFileName {
  /** Filenames to look for, best first. */
  candidates: string[];
  /**
   * True when neither an exact stem nor a length-aligned position answered, so
   * the name is a `.md` probe. A guess is wrong for every artifact whose file
   * is not `<canonical name>.md`, and wrong silently, so callers refuse it.
   */
  guessed: boolean;
}

export function resolveFileNames(
  produces: readonly string[],
  outputsLine: string | null,
  optionalProduces: readonly string[] = [],
): Record<string, ResolvedFileName> {
  const listed = [...produces, ...optionalProduces];
  const declared: string[] =
    outputsLine === null
      ? []
      : (outputsLine.match(/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:md|json)/g) ?? []);

  const exactOf = (artifact: string): string[] =>
    [`${artifact}.md`, `${artifact}.json`].filter((name) => declared.includes(name));

  // Equal length is necessary but nowhere near sufficient: a reordered list of
  // the same length would hand an aliased artifact the file at its old index.
  // The artifacts that DO match by name are the witnesses — if any of them sits
  // at a different index than its own filename, the two lists are not
  // positionally aligned and position tells us nothing about the rest.
  const aligned =
    declared.length === listed.length &&
    listed.every((artifact, at) => {
      const exact = exactOf(artifact)[0];
      return exact === undefined || declared[at] === exact;
    });

  const resolved: Record<string, ResolvedFileName> = {};
  for (const [at, artifact] of listed.entries()) {
    const exact = exactOf(artifact);
    const positional = aligned ? [declared[at] ?? ""] : [];
    // Probing both extensions keeps a stage with no `outputs:` line working,
    // but the result is flagged: `traceability` probes to `traceability.md`
    // where the stage in fact writes `traceability.json`.
    const probed = [`${artifact}.md`, `${artifact}.json`];
    resolved[artifact] = {
      candidates: [...new Set([...exact, ...positional, ...probed])].filter((n) => n !== ""),
      guessed: exact.length === 0 && positional.length === 0,
    };
  }
  return resolved;
}

/** The `outputs:` frontmatter line of a stage file, or null when it has none. */
export function readStageOutputsLine(workspaceRoot: string, docPath: string): string | null {
  const file = path.join(workspaceRoot, docPath);
  if (!existsSync(file)) return null;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"));
  if (frontmatter?.[1] === undefined) return null;
  return /^outputs:\s*(.+)$/m.exec(frontmatter[1])?.[1] ?? null;
}

/**
 * The installed stage file for one stage, which is where `outputs:` lives.
 *
 * The harness tree is the authority, not bridge-map's `docPath`: two of
 * bridge-map's entries point at hand-written stubs under `data/upstream-stages/`
 * that carry no `outputs:` line, and reading those turned `traceability.json`
 * into `traceability.md`. bridge-map is kept as the fallback for a stage the
 * harness tree does not carry under `<phase>/<slug>.md`.
 */
export function stageFilePathOf(
  workspaceRoot: string,
  slug: string,
  phase: string,
  bridgeDocPath: string | null,
): string | null {
  const installed = path.join(
    workspaceRoot,
    ".claude",
    "aidlc-common",
    "stages",
    phase,
    `${slug}.md`,
  );
  if (existsSync(installed)) return path.relative(workspaceRoot, installed);
  return bridgeDocPath;
}

/** Stage slug -> the stage file bridge-map points at. Fallback only. */
export function readStageDocPaths(workspaceRoot: string): Record<string, string> {
  const bridge = path.join(workspaceRoot, "packages", "docs-bridge", "data", "bridge-map.json");
  const parsed = JSON.parse(readFileSync(bridge, "utf8")) as {
    stages: Record<string, { docPath: string }>;
  };
  return Object.fromEntries(
    Object.entries(parsed.stages).map(([slug, entry]) => [slug, entry.docPath]),
  );
}

/** How a locale's description was matched to the artifact. */
export type JoinMode = "name" | "position";

/**
 * Row-order agreement between two locales of the same stage section.
 *
 * The ja construction and operation pages translate the filename column, so the
 * only way to reach their descriptions is the row index. That is only sound if
 * the translation preserves row order — which this measures wherever ja *does*
 * name the file (every ideation and inception stage). `checked` is how many rows
 * could be compared, `agreed` how many landed on the same artifact.
 */
/**
 * Digest of a locale's Outputs rows, in document order. Truncated: this only
 * ever answers "did these rows change", never "what were they".
 */
export function fingerprintRows(rows: readonly OutputRow[]): string {
  const joined = rows.map((row) => row.description).join("\u0000");
  return createHash("sha256").update(joined).digest("hex").slice(0, 16);
}

export function positionalAgreement(
  enRows: readonly OutputRow[],
  jaRows: readonly OutputRow[],
): { checked: number; agreed: number } {
  if (enRows.length !== jaRows.length) return { checked: 0, agreed: 0 };
  let checked = 0;
  let agreed = 0;
  for (const [at, ja] of jaRows.entries()) {
    if (ja.fileName === null) continue;
    checked += 1;
    if (ja.fileName === enRows[at]?.fileName) agreed += 1;
  }
  return { checked, agreed };
}

export interface ArtifactEntry {
  /** On-disk file the stage writes, e.g. `unit-of-work.md`. */
  fileName: string;
  /** Learner-facing description per locale; null when the snapshot has none. */
  descriptions: Record<ArtifactLocale, string | null>;
}

export interface ArtifactStageEntry {
  /** Stage number, kept so a reader can find the section by eye. */
  number: string;
  /** DocPath of the phase page documenting this stage (locale-independent). */
  docPath: string;
  /** Section anchor per locale — headings are translated, so anchors differ. */
  anchors: Record<ArtifactLocale, string | null>;
  /**
   * How each locale's descriptions were matched. `position` means that locale
   * translates the filename column and the row index carried the join.
   */
  join: Record<ArtifactLocale, JoinMode>;
  /**
   * The en Outputs row order the positional pairing was made against, as
   * filenames in document order; null when every locale joined by name.
   *
   * Recorded because the pairing is otherwise unverifiable: `positionalAgreement`
   * can only corroborate rows where ja names the file, and on these stages it
   * never does. Comparing this against the committed map is what catches an en
   * table that reordered while ja did not — the one way a row-index pairing
   * silently attaches a description to the wrong artifact.
   */
  joinOrder: string[] | null;
  /**
   * Digest of the ja Outputs rows the pairing was made against, in document
   * order; null when no positional pairing is trusted.
   *
   * `joinOrder` cannot see a ja-only change: those rows carry no filename, so
   * a translator swapping two of them leaves en — and therefore the recorded
   * order — untouched while every description shifts onto its neighbour. The
   * row text is the only thing about them that IS observable, so it is what
   * gets compared.
   */
  jaFingerprint: string | null;
  artifacts: Record<string, ArtifactEntry>;
}

export interface ArtifactMap {
  sourceVersion: string;
  /** Regenerate with this; never hand-edit the JSON. */
  generator: string;
  stages: Record<string, ArtifactStageEntry>;
}

interface GraphNode {
  slug: string;
  number: string;
  phase: string;
  produces: string[];
  optional_produces?: string[];
}

export function readStageGraph(workspaceRoot: string): GraphNode[] {
  const graphPath = path.join(workspaceRoot, ".claude", "tools", "data", "stage-graph.json");
  return JSON.parse(readFileSync(graphPath, "utf8")) as GraphNode[];
}

function readPhase(workspaceRoot: string, locale: ArtifactLocale, phase: string): string | null {
  const file = path.join(workspaceRoot, "docs", "reference", locale, "04-stages", `${phase}.md`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** Per locale: stage number -> its parsed section. */
export function readSections(
  workspaceRoot: string,
  locale: ArtifactLocale,
): Map<string, StageSection> {
  const byNumber = new Map<string, StageSection>();
  for (const phase of PHASE_FILES) {
    const markdown = readPhase(workspaceRoot, locale, phase);
    if (markdown === null) continue;
    for (const section of splitStageSections(markdown, phase)) {
      byNumber.set(section.number, section);
    }
  }
  return byNumber;
}

export interface BuildResult {
  map: ArtifactMap;
  /** `<stage>/<artifact>` entries with no description in that locale. */
  missing: Record<ArtifactLocale, string[]>;
  /** Row-order agreement, summed over every stage that could be compared. */
  agreement: { checked: number; agreed: number; disagreed: string[] };
  /**
   * `<stage>/<artifact>` entries that had an en description in the committed
   * map and lost it. A gap upstream never filled is not a regression; one it
   * filled and then dropped is, and a hand-kept allowlist cannot tell them
   * apart because it never retires an entry it once granted.
   */
  lostDescriptions: string[];
  /**
   * `<stage>/<artifact>` entries whose filename had to be guessed — either the
   * stage file carried no `outputs:` line, or it carried one that does not name
   * this artifact. Surfaced rather than absorbed: a guessed name resolves to a
   * file that does not exist and the I/O link goes dead.
   */
  unresolvedFileNames: string[];
  /**
   * Stages whose ja pairing cannot be trusted — the en rows reordered, or the
   * pairing was already dropped on an earlier run and nothing has confirmed it
   * since. Their ja descriptions are dropped rather than re-paired onto
   * whatever artifact now sits at that row, and the trusted order is left as it
   * was, so the state is stable across regenerations. The card falls back to
   * English until a human confirms the ja page and reruns with
   * `--accept-ja-order`.
   *
   * Degradation is sticky on purpose. `joinOrder` records the EN order, which
   * is all that is observable: those ja pages translate the filename column, so
   * a ja table that comes back at the right length with its rows in a different
   * arrangement is indistinguishable from one that came back correct. Only a
   * human can tell the difference, so only a human restores the pairing.
   */
  untrustedPairings: string[];
}

export function buildArtifactMap(
  workspaceRoot: string,
  sourceVersion: string,
  previous: ArtifactMap | null = null,
  acceptJaOrder: ReadonlySet<string> = new Set(),
): BuildResult {
  const graph = readStageGraph(workspaceRoot);
  const sections = new Map(LOCALES.map((l) => [l, readSections(workspaceRoot, l)] as const));
  const stageDocPaths = readStageDocPaths(workspaceRoot);
  const missing: Record<ArtifactLocale, string[]> = { en: [], ja: [] };
  const agreement = { checked: 0, agreed: 0, disagreed: [] as string[] };
  const unresolvedFileNames: string[] = [];
  const untrustedPairings: string[] = [];
  const lostDescriptions: string[] = [];
  const stages: Record<string, ArtifactStageEntry> = {};

  for (const node of graph) {
    const enSection = sections.get("en")?.get(node.number) ?? null;
    const jaSection = sections.get("ja")?.get(node.number) ?? null;

    if (enSection !== null && jaSection !== null) {
      const per = positionalAgreement(enSection.rows, jaSection.rows);
      agreement.checked += per.checked;
      agreement.agreed += per.agreed;
      if (per.checked !== per.agreed) agreement.disagreed.push(node.slug);
    }

    const docPath = stageFilePathOf(
      workspaceRoot,
      node.slug,
      node.phase,
      stageDocPaths[node.slug] ?? null,
    );
    const outputsLine = docPath === null ? null : readStageOutputsLine(workspaceRoot, docPath);
    const fileNames = resolveFileNames(node.produces, outputsLine, node.optional_produces);
    const sameLength =
      enSection !== null && jaSection !== null && enSection.rows.length === jaSection.rows.length;

    const join: Record<ArtifactLocale, JoinMode> = { en: "name", ja: "name" };
    const artifacts: Record<string, ArtifactEntry> = {};

    for (const artifact of node.produces) {
      const { candidates, guessed } = fileNames[artifact] ?? {
        candidates: [`${artifact}.md`],
        guessed: true,
      };
      if (guessed) unresolvedFileNames.push(`${node.slug}/${artifact}`);
      const at =
        enSection?.rows.findIndex(
          (row) => row.fileName !== null && candidates.includes(row.fileName),
        ) ?? -1;
      const descriptions: Record<ArtifactLocale, string | null> = { en: null, ja: null };

      descriptions.en = at === -1 ? null : (enSection?.rows[at]?.description ?? null);
      if (descriptions.en === null) {
        missing.en.push(`${node.slug}/${artifact}`);
        const had = previous?.stages?.[node.slug]?.artifacts?.[artifact]?.descriptions?.en ?? null;
        if (had !== null) lostDescriptions.push(`${node.slug}/${artifact}`);
      }

      const named = jaSection?.rows.find(
        (row) => row.fileName !== null && candidates.includes(row.fileName),
      );
      if (named !== undefined) {
        descriptions.ja = named.description;
      } else if (sameLength && at !== -1) {
        descriptions.ja = jaSection?.rows[at]?.description ?? null;
        if (descriptions.ja !== null) join.ja = "position";
      }
      if (descriptions.ja === null) missing.ja.push(`${node.slug}/${artifact}`);

      artifacts[artifact] = { fileName: candidates[0] ?? `${artifact}.md`, descriptions };
    }

    const positional = join.ja === "position";
    const joinOrder = positional ? (enSection?.rows.map((row) => row.fileName ?? "") ?? []) : null;
    const previousStage = previous?.stages?.[node.slug];
    const previousOrder = previousStage?.joinOrder ?? null;
    const reordered =
      positional &&
      joinOrder !== null &&
      previousOrder !== null &&
      joinOrder.join("\u0000") !== previousOrder.join("\u0000");
    // A stage carrying a trusted baseline while not joining positionally is one
    // whose pairing an earlier run already dropped. It stays dropped: nothing
    // observable distinguishes a ja table that came back correct from one that
    // came back rearranged.
    const wasDegraded = previousOrder !== null && previousStage?.join?.ja === "name";
    // A ja-only edit moves every description onto its neighbour while leaving
    // en, and therefore `joinOrder`, untouched. The row text is the only
    // observable thing about those rows, so a change to it un-trusts the
    // pairing until a human has looked.
    const previousFingerprint = previousStage?.jaFingerprint ?? null;
    const jaFingerprint = positional && jaSection !== null ? fingerprintRows(jaSection.rows) : null;
    const jaChanged =
      previousFingerprint !== null &&
      jaFingerprint !== null &&
      jaFingerprint !== previousFingerprint;
    // Per stage, never blanket: confirming one ja page says nothing about the
    // others, and a single flag would hand every degraded stage a fresh
    // fingerprint on the strength of one review.
    const accepted = acceptJaOrder.has(node.slug);
    const untrusted = positional && !accepted && (reordered || jaChanged || wasDegraded);

    if (untrusted) {
      untrustedPairings.push(node.slug);
      // Drop the pairing rather than block: this fires during a docs sync, and
      // the sync PR is where the ja page would be updated. A null description
      // falls back to English in the card; a mispaired one is a lie.
      for (const artifact of Object.keys(artifacts)) {
        const entry = artifacts[artifact];
        if (entry === undefined || entry.descriptions.ja === null) continue;
        entry.descriptions.ja = null;
        missing.ja.push(`${node.slug}/${artifact}`);
      }
      join.ja = "name";
    }

    // The baseline records the last order a pairing was actually trusted at, and
    // only moves when one is. Overwriting it in either degraded branch loses the
    // comparison the next derivation needs: on a reorder it would re-pair stale
    // ja rows onto the wrong artifacts (and diverge from what was just written,
    // failing the byte-identity gate the docs sync runs before opening its PR);
    // on a row-count mismatch it would drop to null, so whatever order ja comes
    // back with is accepted with nothing to check it against.
    const trusted = positional && !untrusted;

    stages[node.slug] = {
      number: node.number,
      docPath: enSection?.docPath ?? phaseDocPath(PHASE_FILES[0]),
      anchors: { en: enSection?.anchor ?? null, ja: jaSection?.anchor ?? null },
      join,
      joinOrder: trusted ? joinOrder : previousOrder,
      jaFingerprint: trusted ? jaFingerprint : previousFingerprint,
      artifacts,
    };
  }

  return {
    map: { sourceVersion, generator: "scripts/build-artifact-map.ts", stages },
    missing,
    agreement,
    unresolvedFileNames,
    untrustedPairings,
    lostDescriptions,
  };
}

/** The committed map, or null when this workspace has none yet. */
export function readCommittedMap(workspaceRoot: string): ArtifactMap | null {
  const outPath = path.join(workspaceRoot, OUT_REL);
  if (!existsSync(outPath)) return null;
  try {
    return JSON.parse(readFileSync(outPath, "utf8")) as ArtifactMap;
  } catch {
    return null;
  }
}

/** `sourceVersion` is owned by bridge-map — the two must never disagree. */
export function readSourceVersion(workspaceRoot: string): string {
  const bridge = path.join(workspaceRoot, "packages", "docs-bridge", "data", "bridge-map.json");
  return (JSON.parse(readFileSync(bridge, "utf8")) as { sourceVersion: string }).sourceVersion;
}

export function serialize(map: ArtifactMap): string {
  return `${JSON.stringify(map, null, 2)}\n`;
}

/**
 * Rewrite the committed artifact map from this workspace's snapshot.
 *
 * Returns false, without writing, when the workspace has no artifact map to
 * keep current — the docs sync runs against fixture workspaces that carry a
 * `docs/` tree and nothing else, and mirroring documentation must not fail
 * because a package this repository happens to ship is absent there.
 */
export function regenerateArtifactMap(workspaceRoot: string): boolean {
  const outPath = path.join(workspaceRoot, OUT_REL);
  const inputs = [
    outPath,
    path.join(workspaceRoot, "packages", "docs-bridge", "data", "bridge-map.json"),
    path.join(workspaceRoot, ".claude", "tools", "data", "stage-graph.json"),
    path.join(workspaceRoot, ".claude", "aidlc-common", "stages"),
    path.join(workspaceRoot, "docs", "reference", "en", "04-stages"),
  ];
  if (inputs.some((input) => !existsSync(input))) return false;

  const { map, unresolvedFileNames } = buildArtifactMap(
    workspaceRoot,
    readSourceVersion(workspaceRoot),
    readCommittedMap(workspaceRoot),
  );
  // Writing a map whose filenames were guessed is worse than not writing one:
  // `traceability.json` silently becomes `traceability.md` and the I/O links
  // that read it stop resolving.
  if (unresolvedFileNames.length > 0) return false;

  writeFileSync(outPath, serialize(map));
  return true;
}

function flagValue(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

export function runCli(argv: string[]): { status: number; stdout: string } {
  const workspaceRoot = path.resolve(
    flagValue(argv, "--workspace") ?? path.join(import.meta.dirname, ".."),
  );
  const outPath = path.resolve(flagValue(argv, "--out") ?? path.join(workspaceRoot, OUT_REL));
  const acceptJaOrder = new Set(
    (flagValue(argv, "--accept-ja-order") ?? "")
      .split(",")
      .map((slug) => slug.trim())
      .filter((slug) => slug !== ""),
  );
  if (argv.includes("--accept-ja-order") && acceptJaOrder.size === 0) {
    return {
      status: 1,
      stdout:
        "--accept-ja-order needs the stages you actually checked, comma-separated:\n" +
        "  bun scripts/build-artifact-map.ts --accept-ja-order deployment-pipeline,ci-pipeline\n",
    };
  }
  const { map, missing, agreement, unresolvedFileNames, untrustedPairings, lostDescriptions } =
    buildArtifactMap(
      workspaceRoot,
      readSourceVersion(workspaceRoot),
      readCommittedMap(workspaceRoot),
      acceptJaOrder,
    );
  const serialized = serialize(map);

  const total = Object.values(map.stages).reduce(
    (sum, stage) => sum + Object.keys(stage.artifacts).length,
    0,
  );
  const lines = [
    `artifacts: ${total}`,
    `described (en): ${total - missing.en.length}`,
    `described (ja): ${total - missing.ja.length}`,
    `row-order agreement: ${agreement.agreed}/${agreement.checked}`,
  ];
  for (const locale of LOCALES) {
    if (missing[locale].length > 0) {
      lines.push(`missing (${locale}): ${missing[locale].join(", ")}`);
    }
  }
  if (agreement.disagreed.length > 0) {
    lines.push(`row order differs between locales: ${agreement.disagreed.join(", ")}`);
  }
  if (unresolvedFileNames.length > 0) {
    lines.push(`no \`outputs:\` frontmatter, filenames guessed: ${unresolvedFileNames.join(", ")}`);
  }
  if (lostDescriptions.length > 0) {
    lines.push(
      `en descriptions the committed map had and this snapshot lost: ${lostDescriptions.join(", ")}`,
    );
  }
  if (untrustedPairings.length > 0) {
    lines.push(
      `ja is paired by row index on these stages and that pairing is no longer verifiable, so its descriptions were dropped and the card falls back to English: ${untrustedPairings.join(", ")}`,
      "the en rows moved, or the ja rows themselves changed — either way the row index no longer proves anything",
      `once you have checked a ja page against the en one, name it to pair them again: --accept-ja-order ${untrustedPairings[0] ?? "<stage>"}`,
    );
  }

  if (argv.includes("--check")) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== serialized) {
      lines.push(
        `STALE: ${path.relative(workspaceRoot, outPath)} — rerun bun scripts/build-artifact-map.ts`,
      );
      return { status: 1, stdout: `${lines.join("\n")}\n` };
    }
    // Byte-identical output is not enough. A locale that reorders its Outputs
    // table still serialises the same today and would silently mislabel the
    // next artifact matched by row index, so incomplete agreement fails too.
    if (agreement.disagreed.length > 0 || unresolvedFileNames.length > 0) {
      return { status: 1, stdout: `${lines.join("\n")}\n` };
    }
    lines.push(`up to date: ${path.relative(workspaceRoot, outPath)}`);
    return { status: 0, stdout: `${lines.join("\n")}\n` };
  }

  // The write path refuses on the same condition `regenerateArtifactMap` does,
  // so the two entry points cannot disagree about what is safe to publish.
  if (unresolvedFileNames.length > 0) {
    lines.push(`refused to write: ${path.relative(workspaceRoot, outPath)}`);
    return { status: 1, stdout: `${lines.join("\n")}\n` };
  }

  writeFileSync(outPath, serialized);
  lines.push(`wrote: ${path.relative(workspaceRoot, outPath)}`);
  return { status: 0, stdout: `${lines.join("\n")}\n` };
}

if (import.meta.main) {
  const { status, stdout } = runCli(process.argv.slice(2));
  process.stdout.write(stdout);
  process.exit(status);
}
