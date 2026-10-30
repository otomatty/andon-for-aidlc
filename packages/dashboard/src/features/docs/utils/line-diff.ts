export type DiffLine = { type: "same" | "add" | "remove"; text: string };
/** A run of unchanged lines folded away, with how many it hides. */
export type DiffRow = DiffLine | { type: "skip"; count: number };

/** Beyond this many line comparisons the texts are shown whole instead. */
const MAX_CELLS = 4_000_000;

const lines = (text: string): string[] =>
  text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

/** Line diff by longest common subsequence; null when the texts are too large to compare. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end += 1;
  const left = a.slice(start, a.length - end);
  const right = b.slice(start, b.length - end);
  if (left.length * right.length > MAX_CELLS) return null;
  // table[i][j]: common lines of left[i..] and right[j..].
  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1)
    for (let j = right.length - 1; j >= 0; j -= 1)
      table[i * width + j] =
        left[i] === right[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      middle.push({ type: "same", text: left[i] ?? "" });
      i += 1;
      j += 1;
    } else if (
      i < left.length &&
      (j === right.length || (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0))
    ) {
      middle.push({ type: "remove", text: left[i] ?? "" });
      i += 1;
    } else {
      middle.push({ type: "add", text: right[j] ?? "" });
      j += 1;
    }
  }
  return [
    ...a.slice(0, start).map((text) => ({ type: "same" as const, text })),
    ...middle,
    ...a.slice(a.length - end).map((text) => ({ type: "same" as const, text })),
  ];
}

/** Keeps `context` unchanged lines around each change and folds the rest. */
export function foldDiff(diff: DiffLine[], context = 3): DiffRow[] {
  const near = diff.map(() => false);
  diff.forEach((line, index) => {
    if (line.type === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(diff.length - 1, index + context); k++)
      near[k] = true;
  });
  const rows: DiffRow[] = [];
  let hidden = 0;
  diff.forEach((line, index) => {
    if (near[index]) {
      if (hidden) rows.push({ type: "skip", count: hidden });
      hidden = 0;
      rows.push(line);
    } else hidden += 1;
  });
  if (hidden) rows.push({ type: "skip", count: hidden });
  return rows;
}
