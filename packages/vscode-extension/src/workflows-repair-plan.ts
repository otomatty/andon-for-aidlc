import type { DocsQaTool } from "@andon/shared-types";
import type { HarnessId } from "./harness-detect.ts";
import type { ProblemKind } from "./workflows-conflicts.ts";

/** What the Guide does about one file the pre-update check refused. */
export type RepairAction =
  /** Same bytes as an official copy: the official update writes it again. */
  | "regenerate"
  /** An official file with the project's own edit: back to official, the edit re-applied after the update. */
  | "reapply"
  /** An older AI-DLC section with its old markers: the official block replaces it, the rest stays. */
  | "migrate-legacy"
  /** A .gitignore managed block: written again from the official text, the project's own rules kept outside. */
  | "rebuild-ignore"
  /** Another tool's part goes first: that tool is configured before the rest. */
  | "order"
  /** Read in a detected encoding and written as UTF-8. */
  | "convert"
  /** Fetch the previous release so the project's edit can be told apart from the official text. */
  | "fetch-base"
  /** AI re-applies the project's edit onto the new official file; shown as a diff before it applies. */
  | "ai-merge"
  /** The official version; the current bytes stay in the backup. */
  | "replace"
  /** Removed; the current bytes stay in the backup. */
  | "delete"
  /** Kept under a name AI-DLC does not manage. */
  | "keep-renamed"
  /** AI fixes the JSON syntax only; shown as a diff before it applies. */
  | "ai-json";

export type RepairOption = { action: RepairAction; label: string };

/**
 * auto: the Guide decides and changes no one's own text.
 * confirm: the person picks (or accepts) a way that replaces, removes or fetches.
 * ai: only an AI proposal, reviewed as a diff, can fix it.
 * manual: the person fixes it by hand and checks again.
 */
export type RepairGroup = "auto" | "confirm" | "ai" | "manual";

/** One project file the check refused, with what can be done about it. */
export type RepairItem = {
  path: string;
  /** Every tool whose update named this file. */
  harnesses: HarnessId[];
  kind: ProblemKind;
  group: RepairGroup;
  /** What happened. */
  guidance: string;
  /** What the Guide will do, or what the person needs to do. */
  plan: string;
  /** auto and ai: exactly one; confirm: one or more, the first is recommended; manual: none. */
  options: RepairOption[];
  /** Upstream's own words, kept for the 原文 fold. */
  detail: string;
  remediation?: string;
  /** How the last repair attempt left this file. */
  note?: string;
};

/** What the person picked for each confirm item, by path. */
export type RepairChoices = Readonly<Record<string, RepairAction>>;

/** An AI-written change, held back until the person approves its diff. */
export type RepairReview = {
  path: string;
  action: "ai-merge" | "ai-json";
  tool: DocsQaTool;
  /** The file as it is now. */
  before: string;
  /** What the file will hold once the update is done. */
  after: string;
  /** The AI's own explanation. */
  summary: string;
  /** The Guide's checks of the proposal; a failed check is shown, never hidden. */
  checks: { ok: boolean; text: string }[];
  /** The file the proposal was made from; approval is refused once it changes. */
  originalHash: string;
};

export const AI_ACTIONS: readonly RepairAction[] = ["ai-merge", "ai-json"];

export const isAiAction = (action: RepairAction | undefined): boolean =>
  action !== undefined && AI_ACTIONS.includes(action);

/**
 * The way a confirm item is fixed when the person has not picked one: the first
 * option the person can use. AI options need an available AI.
 */
export function defaultAction(item: RepairItem, aiReady: boolean): RepairAction | null {
  return item.options.find((option) => aiReady || !isAiAction(option.action))?.action ?? null;
}

/** The action one item will take, or null when it needs the person's hands. */
export function chosenAction(
  item: RepairItem,
  choices: RepairChoices,
  aiReady: boolean,
): RepairAction | null {
  if (item.group === "manual") return null;
  if (item.group === "ai") return aiReady ? (item.options[0]?.action ?? null) : null;
  if (item.group === "auto") return item.options[0]?.action ?? null;
  const picked = choices[item.path];
  if (
    picked !== undefined &&
    item.options.some((option) => option.action === picked) &&
    (aiReady || !isAiAction(picked))
  )
    return picked;
  return defaultAction(item, aiReady);
}

/** Items the one button cannot fix: the person fixes these by hand first. */
export const handFixes = (items: readonly RepairItem[], aiReady: boolean): RepairItem[] =>
  items.filter((item) => chosenAction(item, {}, aiReady) === null);

export type DiffRow = { kind: "same" | "del" | "add"; text: string; old?: number; new?: number };

const rows = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

/** The largest middle part, in table cells, compared line by line (16 MB of scores). */
const MAX_TABLE_CELLS = 4_000_000;

/**
 * Pairs of equal lines along one longest common subsequence. Equal lines at the
 * start and the end are paired first; the part between is compared only while
 * its table stays small, so a large text cannot exhaust the extension host's
 * memory. Past that bound the middle shares nothing, which overstates a change
 * rather than hiding one.
 */
export function commonLines(base: readonly string[], other: readonly string[]): [number, number][] {
  let start = 0;
  while (start < base.length && start < other.length && base[start] === other[start]) start++;
  let baseEnd = base.length;
  let otherEnd = other.length;
  while (baseEnd > start && otherEnd > start && base[baseEnd - 1] === other[otherEnd - 1]) {
    baseEnd--;
    otherEnd--;
  }
  const pairs: [number, number][] = [];
  for (let index = 0; index < start; index++) pairs.push([index, index]);
  const height = baseEnd - start;
  const width = otherEnd - start;
  if (height > 0 && width > 0 && (height + 1) * (width + 1) <= MAX_TABLE_CELLS) {
    const stride = width + 1;
    const scores = new Uint32Array((height + 1) * stride);
    for (let row = height - 1; row >= 0; row--)
      for (let column = width - 1; column >= 0; column--)
        scores[row * stride + column] =
          base[start + row] === other[start + column]
            ? scores[(row + 1) * stride + column + 1]! + 1
            : Math.max(scores[(row + 1) * stride + column]!, scores[row * stride + column + 1]!);
    let row = 0;
    let column = 0;
    while (row < height && column < width) {
      if (base[start + row] === other[start + column]) {
        pairs.push([start + row, start + column]);
        row++;
        column++;
      } else if (scores[(row + 1) * stride + column]! >= scores[row * stride + column + 1]!) row++;
      else column++;
    }
  }
  for (let index = 0; index < base.length - baseEnd; index++)
    pairs.push([baseEnd + index, otherEnd + index]);
  return pairs;
}

/** A line diff of two texts, removals before additions within each change. */
export function diffLines(before: string, after: string): DiffRow[] {
  const left = rows(before);
  const right = rows(after);
  const pairs = commonLines(left, right);
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  for (const [a, b] of [...pairs, [left.length, right.length] as [number, number]]) {
    while (i < a) out.push({ kind: "del", text: left[i]!, old: ++i });
    while (j < b) out.push({ kind: "add", text: right[j]!, new: ++j });
    if (a < left.length && b < right.length) {
      i++;
      j++;
      out.push({ kind: "same", text: left[a]!, old: i, new: j });
    }
  }
  return out;
}

/** The changed rows with `context` unchanged rows around each; null marks a skipped run. */
export function diffHunks(diff: readonly DiffRow[], context = 2): (DiffRow | null)[] {
  // Two passes mark the rows within `context` of a change, in time linear in the diff.
  const shown = diff.map(() => false);
  let last = -Infinity;
  for (const [index, row] of diff.entries()) {
    if (row.kind !== "same") last = index;
    if (index - last <= context) shown[index] = true;
  }
  last = Infinity;
  for (let index = diff.length - 1; index >= 0; index--) {
    if (diff[index]!.kind !== "same") last = index;
    if (last - index <= context) shown[index] = true;
  }
  const out: (DiffRow | null)[] = [];
  for (const [index, row] of diff.entries()) {
    if (shown[index]) out.push(row);
    else if (out.at(-1) !== null) out.push(null);
  }
  if (out[0] === null) out.shift();
  if (out.at(-1) === null) out.pop();
  return out;
}
