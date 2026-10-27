import { HARNESS_LABELS, type HarnessId } from "./harness-detect.ts";

/** What upstream `aidlc config` refused, as the update screen sorts it. */
export type ProblemKind =
  /** A file AI-DLC manages differs from what it shipped, or has no record (`--force` takes it). */
  | "ownership"
  /** An older AI-DLC section whose extent cannot be told (2.8 releases). */
  | "legacy-root"
  /** A file the new release no longer ships, edited in the project. */
  | "removed"
  /** AI-DLC's marked part of a shared file, with no record of what it wrote. */
  | "block-baseline"
  /** AI-DLC's marked part of a shared file, edited in the project. */
  | "block-modified"
  /** A part another tool wrote from a different release; that tool goes first. */
  | "shared-release"
  /** Another tool lacks the copy a shared part is built from; that tool goes first. */
  | "block-copy"
  | "json"
  | "json-shape"
  | "encoding"
  /** A link, folder or special file where AI-DLC writes a file. */
  | "not-file"
  /** AI-DLC's begin and end markers are missing, repeated or out of order. */
  | "markers"
  /** A setting an earlier release wrote that this one retires, edited or broken. */
  | "retired"
  | "other";

export type UpdateProblem = {
  harness: HarnessId;
  path: string;
  kind: ProblemKind;
  /** Upstream's own words for the conflict. */
  detail: string;
  /** What happened, in Japanese. */
  guidance: string;
  /** The other tool the conflict names, which is to be configured first. */
  related?: HarnessId;
  /** Upstream's way forward for the whole preview, in its words. */
  remediation?: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const harnessId = (value: string | undefined): HarnessId | undefined =>
  value !== undefined && Object.hasOwn(HARNESS_LABELS, value) ? (value as HarnessId) : undefined;

/** Read one upstream conflict detail; unknown details stay `other` with their own words. */
export function classifyConflict(detail: string): {
  kind: ProblemKind;
  guidance: string;
  related?: HarnessId;
} {
  const label = (id: HarnessId | undefined, fallback: string) =>
    id ? HARNESS_LABELS[id] : fallback;
  if (detail === "locally modified or unowned" || detail === "unowned whole file")
    return {
      kind: "ownership",
      guidance:
        "AI-DLC が管理するファイルですが、公式のファイルと内容が違うか、AI-DLC が書いた記録がありません。",
    };
  if (detail.startsWith("legacy root integration ambiguous"))
    return {
      kind: "legacy-root",
      guidance: "古い AI-DLC の設定が、どこまでが AI-DLC の部分か分からない形で残っています。",
    };
  if (detail === "removed upstream but locally modified")
    return {
      kind: "removed",
      guidance: "新しい版ではなくなったファイルですが、このプロジェクトで変更されています。",
    };
  if (detail === "managed block has no ownership baseline")
    return {
      kind: "block-baseline",
      guidance: "AI-DLC の管理ブロックはありますが、AI-DLC が書いた記録がありません。",
    };
  if (detail === "managed block was locally modified")
    return {
      kind: "block-modified",
      guidance: "AI-DLC の管理ブロックの中が、このプロジェクトで変更されています。",
    };
  const shared = /^shared block is owned by (\S+) from a different release/.exec(detail);
  if (shared) {
    const related = harnessId(shared[1]);
    return {
      kind: "shared-release",
      guidance: `${label(related, shared[1] ?? "別のツール")} と共有する部分が、別のバージョンのまま残っています。`,
      ...(related ? { related } : {}),
    };
  }
  const copy = /^(\S+) is missing its shipped block copy/.exec(detail);
  if (copy) {
    const related = harnessId(copy[1]);
    return {
      kind: "block-copy",
      guidance: `${label(related, copy[1] ?? "別のツール")} の設定に、共有する部分の元になるファイルがありません。`,
      ...(related ? { related } : {}),
    };
  }
  if (detail === "malformed JSON")
    return { kind: "json", guidance: "JSON として読めません。書式が壊れています。" };
  if (detail === "JSON root must be an object")
    return { kind: "json-shape", guidance: "JSON の一番外側が { } のオブジェクトではありません。" };
  const shape = /^(.+) must be a JSON (object|array)$/.exec(detail);
  if (shape)
    return {
      kind: "json-shape",
      guidance: `JSON の「${shape[1]}」が${shape[2] === "array" ? "配列" : "オブジェクト"}ではありません。`,
    };
  const strings = /^(.+) must be a string array$/.exec(detail);
  if (strings)
    return {
      kind: "json-shape",
      guidance: `JSON の「${strings[1]}」が文字列の配列ではありません。`,
    };
  if (/ is not valid UTF-8/.test(detail))
    return { kind: "encoding", guidance: "文字コードが UTF-8 ではありません。" };
  if (/(?:^|\b)(?:managed path|root integration) is not a regular file$/.test(detail))
    return {
      kind: "not-file",
      guidance: "AI-DLC がファイルを書く場所が、リンクかフォルダーになっています。",
    };
  if (
    detail === "managed markers are missing, duplicated, or malformed" ||
    detail === "managed end marker precedes its begin marker"
  )
    return {
      kind: "markers",
      guidance:
        "AI-DLC の管理ブロックの区切り（BEGIN / END の行）が足りないか、重なっているか、順番が逆です。",
    };
  if (detail.startsWith("retired "))
    return {
      kind: "retired",
      guidance:
        "以前の版が書いた設定で、新しい版では使わない部分が、変更されているか壊れています。",
    };
  return {
    kind: "other",
    guidance: "AI-DLC が更新できない状態です。原文の説明を確認してください。",
  };
}

/** Preserve the native failure's structured actions, including on nonzero exit. */
export function configProblems(stdout: string, harness: HarnessId): UpdateProblem[] {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!object(value) || !object(value.data) || !Array.isArray(value.data.actions)) return [];
  const remediation =
    typeof value.remediation === "string" && value.remediation.trim()
      ? value.remediation.trim()
      : undefined;
  return value.data.actions.flatMap((action): UpdateProblem[] => {
    if (
      !object(action) ||
      action.action !== "conflict" ||
      typeof action.path !== "string" ||
      typeof action.detail !== "string"
    )
      return [];
    return [
      {
        harness,
        path: action.path,
        detail: action.detail,
        ...classifyConflict(action.detail),
        ...(remediation ? { remediation } : {}),
      },
    ];
  });
}

export class NativeConfigConflict extends Error {
  /** Carry structured diagnostics through native command failures to the update panel. */
  constructor(readonly problems: UpdateProblem[]) {
    super(`${problems.length} 件の設定競合があります。更新画面の問題一覧を確認してください。`);
  }
}
