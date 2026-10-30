#!/usr/bin/env bun
/**
 * Mirror the upstream aidlc-workflows workspace shells into this repository's
 * own harness trees: `dist/claude/.claude` → `.claude/` and
 * `dist/cursor/.cursor` → `.cursor/`.
 *
 * Usage:
 *   bun scripts/sync-workflows-shell.ts --upstream <checkout> --upstream-sha <sha>
 *     [--workspace <root>] [--pr-body <file>]
 *
 * Like `sync-official-docs.ts` this does no network I/O: `--upstream` is a
 * checkout someone else fetched, so the whole sync is a pure filesystem
 * operation, testable and re-runnable.
 *
 * BOTH HARNESSES OR NEITHER. AGENTS.md opens by stating the project runs AI-DLC
 * "in lockstep on two harnesses: Cursor (`.cursor/`) and Claude Code
 * (`.claude/`)". Mirroring one alone is therefore not a smaller version of this
 * job, it is the bug: the first sync would move Claude Code to the new tools,
 * stages, hooks and state graph while Cursor stayed on the old ones. Both trees
 * are planned before either is written, and a run refuses outright if upstream
 * ships them at different versions.
 *
 * WHY THIS IS NOT A USER-VISIBLE RELEASE. Neither tree is shipped: `.vscodeignore`
 * packages only `dist/` and `media/`, and at runtime `docs-bridge` resolves every
 * `docPath` against the *user's* `docsRepoPath`. What they are is the fixture the
 * gate validates against — `packages/docs-bridge/tests/data-lint.test.ts` resolves
 * all 33 bridge-map entries against `.claude/aidlc-common/stages`. So a stale
 * shell means the gate is checking yesterday's stage graph, which is exactly the
 * drift nobody notices. The sync PR therefore lands as `release:skip` by default;
 * swap the label if you land user-visible work on the branch alongside it.
 *
 * THE MIRROR DELETES, AND IT OVERWRITES LOCAL PATCHES. A stage or agent upstream
 * removed has to disappear here too, or the gate keeps passing against a file the
 * framework no longer has. The only exceptions are each harness's `localOnly`
 * paths and the gitignored per-user settings. That includes overwriting
 * `.cursor/hooks/aidlc-cursor-adapter.ts`, which this repository patches — and
 * that is the intended upgrade path, not an accident: the patch's own comment
 * says it is "re-applied on each engine upgrade", and the repo-authored
 * `aidlc-cursor-adapter.test.ts` pins it, so losing it turns the gate red instead
 * of passing silently. The PR body names every file the mirror rewrote.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { inlineCode } from "../packages/official-docs/src/diff-report.ts";
import {
  UPSTREAM_REPO_SLUG,
  UPSTREAM_REPO_URL,
  upstreamBlobUrl,
} from "../packages/shared-types/src/index.ts";
import { parseAidlcVersion, unportablePaths } from "./sync-official-docs.ts";

/** Where the framework version sits inside every harness tree. */
const VERSION_REL = path.join("tools", "aidlc-version.ts");

export type Harness = {
  id: string;
  /** The tree inside an upstream checkout. */
  upstreamRel: string;
  /** Where it lands here. */
  localRel: string;
  /**
   * Paths this repository owns inside the tree. They do not exist upstream and
   * must survive the mirror.
   */
  localOnly: ReadonlySet<string>;
  /** Paths the mirror neither writes nor deletes. */
  ignored: ReadonlySet<string>;
};

/**
 * Both harnesses, mirrored together. AGENTS.md states the project runs AI-DLC
 * "in lockstep on two harnesses: Cursor (`.cursor/`) and Claude Code
 * (`.claude/`)", so syncing one alone is what breaks the invariant -- the first
 * sync would leave Cursor on the old tools, stages, hooks and state graph.
 */
export const HARNESSES: readonly Harness[] = [
  {
    id: "claude",
    upstreamRel: path.join("dist", "claude", ".claude"),
    localRel: ".claude",
    localOnly: new Set([
      // This project's own AI-DLC scope; upstream has no such scope.
      "scopes/aidlc-prd-implementation.md",
      // Repo-authored dev-server config for previewing the dashboard via the
      // browser tool; upstream ships no such file.
      "launch.json",
    ]),
    // The gitignored per-user override the README tells contributors to
    // create; deleting it would wipe a developer's local model and env config
    // every time upstream moved.
    ignored: new Set(["settings.local.json"]),
  },
  {
    id: "cursor",
    upstreamRel: path.join("dist", "cursor", ".cursor"),
    localRel: ".cursor",
    localOnly: new Set([
      // Written by upstream's installer, not shipped by it. It records the
      // sha256 of every managed file as upstream shipped it, which is how the
      // installer detects a hand-edited file -- so it is NEVER regenerated from
      // local content here. Doing that would erase the drift signal and report
      // a patched file as pristine. It goes stale on every mirror instead, and
      // the PR body says which managed files moved.
      "aidlc-install.json",
      // Repo-authored, and the reason the mirror can overwrite the adapter
      // safely: it pins the local patch, so losing the patch turns the gate red
      // rather than passing silently.
      "hooks/aidlc-cursor-adapter.test.ts",
      "scopes/aidlc-prd-implementation.md",
      "skills/verify-andon",
    ]),
    ignored: new Set<string>(),
  },
];

/** Never walked, on either side. */
const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);

/** C0 controls plus DEL -- never part of a legitimate shell path. */
// oxlint-disable-next-line no-control-regex -- matching them is the point.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

export type ShellPlan = {
  /** Relative POSIX paths to copy from upstream into `.claude/`. */
  writes: string[];
  /** Of those writes, the ones that already exist here with different content. */
  overwrites: string[];
  /** Relative POSIX paths to remove from `.claude/`. */
  deletes: string[];
  /** Paths absent upstream that are kept because this repo owns them. */
  preserved: string[];
};

/**
 * Walk a shell root; return relative POSIX paths → sha256 hex.
 *
 * Unlike the docs walker this keeps dotfiles: `tools/data/templates/.gitkeep`
 * is what holds those directories in git, and skipping it would leave the
 * mirror unable to create them. Symlinks are still never followed — the
 * upstream tree is an external repository, and a symlink into the runner's
 * checkout would otherwise be copied in as a file.
 */
export function walkShellFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(root)) return out;
  if (lstatSync(root).isSymbolicLink()) {
    throw new Error(`shell root must not be a symlink: ${root}`);
  }

  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      const abs = path.join(dir, name);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(abs);
        continue;
      }
      // Symlinks are neither isFile() nor isDirectory() under lstat, so they
      // fall out here and a directory symlink cannot escape the root.
      if (!st.isFile()) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (rel === "") continue;
      // A control character survives into the PR body, where a newline ends the
      // list item and lets the rest of the path render as its own markdown.
      if (CONTROL_CHAR_RE.test(rel)) {
        throw new Error(`shell path contains a control character: ${JSON.stringify(rel)}`);
      }
      out.set(rel, createHash("sha256").update(readFileSync(abs)).digest("hex"));
    }
  }
  return out;
}

/** Pure: every filesystem decision this script makes is visible here. */
export function planShellSync(
  upstream: ReadonlyMap<string, string>,
  local: ReadonlyMap<string, string>,
  localOnly: ReadonlySet<string>,
  ignored: ReadonlySet<string>,
): ShellPlan {
  const plan: ShellPlan = { writes: [], overwrites: [], deletes: [], preserved: [] };
  for (const [rel, hash] of upstream) {
    if (ignored.has(rel)) continue;
    // Before the hash comparison, not inside one branch of it: a path this
    // repository owns stays ours even if upstream starts publishing one at the
    // same name. The PR body still reports the collision as preserved.
    if ([...localOnly].some((owned) => rel === owned || rel.startsWith(`${owned}/`))) {
      plan.preserved.push(rel);
      continue;
    }
    const current = local.get(rel);
    if (current === hash) continue;
    plan.writes.push(rel);
    if (current !== undefined) plan.overwrites.push(rel);
  }
  for (const rel of local.keys()) {
    if (upstream.has(rel) || ignored.has(rel)) continue;
    if ([...localOnly].some((owned) => rel === owned || rel.startsWith(`${owned}/`))) {
      plan.preserved.push(rel);
      continue;
    }
    plan.deletes.push(rel);
  }
  const sort = (values: string[]): string[] =>
    [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return {
    writes: sort(plan.writes),
    overwrites: sort(plan.overwrites),
    deletes: sort(plan.deletes),
    preserved: sort(plan.preserved),
  };
}

/** Resolve a relative shell path under a root, refusing anything that escapes it. */
function resolveUnder(root: string, rel: string): string {
  const abs = path.resolve(root, ...rel.split("/"));
  const bounded = path.resolve(root);
  if (abs !== bounded && !abs.startsWith(bounded + path.sep)) {
    throw new Error(`shell path escapes the tree: ${rel}`);
  }
  return abs;
}

/**
 * Execute a plan against the filesystem. Every decision was already made in
 * `planShellSync`; the only judgement left here is ordering, which matters
 * more than it looks -- see the comment on the deletion loop.
 */
export function applyShellSync(input: {
  workspaceRoot: string;
  upstreamShellRoot: string;
  localRel: string;
  plan: ShellPlan;
}): void {
  const { workspaceRoot, upstreamShellRoot, localRel, plan } = input;
  const localRoot = path.join(workspaceRoot, localRel);
  // Deletions first: upstream can replace a directory `tools/data/` with a file
  // named `data`, which reaches the plan as a write plus the deletions of
  // everything that used to live there. Writing first would hit the stale entry
  // (EISDIR / ENOTDIR) and kill the whole sync on that revision.
  for (const rel of plan.deletes) {
    rmSync(resolveUnder(localRoot, rel), { force: true });
  }
  for (const rel of plan.writes) {
    const dest = resolveUnder(localRoot, rel);
    // Ordering alone does not clear a directory-turned-file: its files are gone
    // but the empty directory still occupies the destination name.
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(resolveUnder(upstreamShellRoot, rel), dest);
  }
}

/** AIDLC_VERSION from either shell, or null when absent or unparseable. */
export function readShellVersion(shellRoot: string): string | null {
  const file = path.join(shellRoot, VERSION_REL);
  if (!existsSync(file)) return null;
  try {
    return parseAidlcVersion(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * At most `limit` entries as inline code, then a count of the rest. Fenced via
 * `inlineCode` rather than a bare backtick pair: a backtick is legal in a Git
 * filename, and one inside a path would close the span early and let the tail
 * of the name render as Markdown in the PR body -- the same body that carries
 * the review checklist.
 */
function capped(values: readonly string[], limit = 20): string {
  if (values.length === 0) return "_(なし)_";
  const shown = values.slice(0, limit).map((value) => inlineCode(value));
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} ほか ${rest} 件` : shown.join(", ");
}

export type HarnessResult = {
  harness: Harness;
  plan: ShellPlan;
  /** Managed files whose content the mirror changed, so the installer manifest is now stale. */
  staleManaged: string[];
};

/**
 * Managed paths the manifest now records a wrong hash for, relative to the
 * repository root. `aidlc-install.json` records the sha256 of each file AS
 * UPSTREAM SHIPPED IT, which is how the installer spots a hand-edited file, so
 * the mirror never rewrites it -- it reports what went stale and lets a human
 * regenerate it by running the installer.
 *
 * Staleness is decided by COMPARING hashes, not by membership in the touched
 * set, because touching a managed file does not imply the manifest went wrong
 * in either direction:
 *
 *   - A hand-edited file the mirror restores to upstream's current bytes is an
 *     overwrite, yet it makes the file MATCH a manifest that was already
 *     recording upstream's hash. Reporting it would send a human to re-run the
 *     installer for nothing.
 *   - A managed file deleted locally and then restored by the mirror is a
 *     plain write, never an overwrite, and is stale exactly when upstream has
 *     changed it since the manifest was recorded.
 *
 * `hashAfter` is what each path will hash to once the sync lands -- upstream's
 * map, since every written file ends up byte-identical to upstream. A path
 * absent from it was deleted, and a manifest entry for an absent file is
 * always stale.
 */
export function staleManagedFiles(
  manifestJson: string,
  localRel: string,
  touched: readonly string[],
  hashAfter: ReadonlyMap<string, string>,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object") return [];
  const managed = (parsed as Record<string, unknown>).managedFiles;
  if (managed === null || typeof managed !== "object") return [];
  const recorded = managed as Record<string, unknown>;
  return [...new Set(touched)]
    .filter((rel) => {
      const entry = recorded[`${localRel}/${rel}`];
      if (typeof entry !== "string") return false;
      return hashAfter.get(rel) !== entry;
    })
    .map((rel) => `${localRel}/${rel}`)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The PR body. It has to answer the two questions a reviewer opens this PR
 * with -- why is a 500-file mirror not a release, and what do I have to do by
 * hand -- so both get a section rather than a line in the commit message.
 */
export function formatShellPrBody(input: {
  version: string;
  previousVersion: string | null;
  upstreamSha: string;
  results: readonly HarnessResult[];
}): string {
  const { version, previousVersion, upstreamSha, results } = input;
  const trees = results.map((result) => `\`${result.harness.upstreamRel}\``).join(" と ");
  const lines = [
    `Automated mirror of [${UPSTREAM_REPO_SLUG}](${UPSTREAM_REPO_URL}) の ${trees}（ワークスペースシェル、既定ブランチ）。`,
    "",
    "| Field | Previous | New |",
    "|-------|----------|-----|",
    `| AIDLC_VERSION | ${previousVersion ?? "_(none)_"} | ${version} |`,
    `| UPSTREAM_SHA | — | \`${upstreamSha}\` |`,
    "",
    `Changelog: ${upstreamBlobUrl("CHANGELOG.md")}`,
    "",
    "両ハーネスは同じバージョンでのみ同期されます（AGENTS.md の lockstep 要件）。",
    "",
    "## What this PR changed",
    "",
    "| Tree | 書き換え/追加 | うち上書き | 削除 | 温存 |",
    "|------|--------------|-----------|------|------|",
  ];
  for (const { harness, plan } of results) {
    lines.push(
      `| \`${harness.localRel}/\` | ${plan.writes.length} | ${plan.overwrites.length} | ${plan.deletes.length} | ${plan.preserved.length} |`,
    );
  }
  lines.push("");
  for (const { harness, plan, staleManaged } of results) {
    if (plan.overwrites.length === 0 && plan.deletes.length === 0 && staleManaged.length === 0) {
      continue;
    }
    lines.push(`### \`${harness.localRel}/\``, "");
    if (plan.overwrites.length > 0) {
      lines.push(`- 上書きされた既存ファイル: ${capped(plan.overwrites)}`);
    }
    if (plan.deletes.length > 0) lines.push(`- 削除されたファイル: ${capped(plan.deletes)}`);
    if (staleManaged.length > 0) {
      lines.push(
        `- \`${harness.localRel}/aidlc-install.json\` が古くなりました（内容が変わった managed file: ${capped(staleManaged)}）。このマニフェストは upstream 出荷時の sha256 を記録して手編集を検出するものなので、このスクリプトは再生成しません。upstream のインストーラで作り直してください。`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Why this is labelled `release:skip`",
    "",
    "`.claude/` と `.cursor/` は VSIX に同梱されず（`.vscodeignore` は `dist/` と `media/` のみ）、実行時のドキュメント解決はユーザ側の `docsRepoPath` を見ます。ここでのハーネスツリーは品質ゲートのフィクスチャ（`data-lint` が bridge-map の 33 エントリをステージツリーに対して検証する）であり、更新そのものはユーザに見える変更ではありません。ユーザに見える変更をこのブランチに載せた場合はラベルを貼り替えてください。",
    "",
    "## Review checklist",
    "",
    "- [ ] `.cursor/hooks/aidlc-cursor-adapter.ts` のローカルパッチ（PR #43）を再適用した。ミラーは upstream 版で上書きするため、パッチが消えると `aidlc-cursor-adapter.test.ts` が落ちます（それが検出手段です）",
    "- [ ] 上記の `aidlc-install.json` を再生成した",
    "- [ ] 下の互換性チェックで挙がった項目に対応した（bridge-map / agent-map / shared-types / stage-map）",
    "- [ ] `AGENTS.md` の冒頭が記載しているバージョン表記を更新した",
    "- [ ] `bun run check` の結果を確認した（ゲートは別ジョブで実行済み。結果はこの PR 本文の末尾を参照）",
    "",
  );
  return lines.join("\n");
}

class UsageError extends Error {
  constructor() {
    super(USAGE);
    this.name = "UsageError";
  }
}

const USAGE = `Usage:
  bun scripts/sync-workflows-shell.ts --upstream <checkout> --upstream-sha <sha>
    [--workspace <root>] [--pr-body <file>]
`;

function flagValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) return undefined;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith("-")) throw new UsageError();
  return value;
}

function run(argv: string[]): string[] {
  const upstream = flagValue(argv, "--upstream");
  const upstreamSha = flagValue(argv, "--upstream-sha");
  if (upstream === undefined || upstreamSha === undefined) throw new UsageError();

  const workspaceRoot = path.resolve(
    flagValue(argv, "--workspace") ?? path.join(import.meta.dirname, ".."),
  );
  // Read every flag, and claim the PR body destination, before the first write:
  // this run copies and deletes across two trees, and there is no half-applied
  // shell worth leaving behind.
  const prBodyPath = flagValue(argv, "--pr-body");
  if (prBodyPath !== undefined) {
    const resolved = path.resolve(prBodyPath);
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, "");
  }
  const upstreamRoot = path.resolve(upstream);

  // PLAN BOTH TREES BEFORE WRITING EITHER. The harnesses have to land on the
  // same version or not move at all: a run that mirrored .claude and then threw
  // on .cursor would leave exactly the split-version state this sync exists to
  // prevent, and it would be committed before anyone noticed.
  const planned: Array<{
    harness: Harness;
    upstreamShellRoot: string;
    plan: ShellPlan;
    upstreamFiles: Map<string, string>;
  }> = [];
  const versions = new Map<string, string>();
  let previousVersion: string | null = null;

  for (const harness of HARNESSES) {
    const upstreamShellRoot = path.join(upstreamRoot, harness.upstreamRel);
    const upstreamFiles = walkShellFiles(upstreamShellRoot);
    // Judge the OUTCOME, not the cause. A tree reaches the mirror empty when it
    // is absent, replaced by a file, or fetched by a sparse checkout that came
    // back with nothing -- and every one of those turns into "upstream deleted
    // the entire shell", which this script would faithfully carry out.
    if (upstreamFiles.size === 0) {
      throw new Error(`upstream checkout has no shell files under ${upstreamShellRoot}`);
    }
    const version = readShellVersion(upstreamShellRoot);
    if (version === null) {
      throw new Error(
        `could not read AIDLC_VERSION from ${path.join(upstreamShellRoot, VERSION_REL)}`,
      );
    }
    versions.set(harness.id, version);

    const localShellRoot = path.join(workspaceRoot, harness.localRel);
    // The first harness that reports one wins; upstream versions are checked
    // for agreement below, so any of them describes the repository.
    previousVersion = previousVersion ?? readShellVersion(localShellRoot);
    const plan = planShellSync(
      upstreamFiles,
      walkShellFiles(localShellRoot),
      harness.localOnly,
      harness.ignored,
    );

    // The mirror runs on Linux and would happily create a path Windows cannot
    // check out, and the sync PR is precisely the change that may never see the
    // three-OS matrix. The set is everything that will EXIST after the sync,
    // not just what upstream sends -- a preserved local-only file stays on disk
    // and could collide with a case variant upstream publishes.
    const surviving = [...upstreamFiles.keys(), ...plan.preserved].filter(
      (rel) => !plan.deletes.includes(rel),
    );
    const unportable = unportablePaths(surviving);
    if (unportable.length > 0) {
      throw new Error(
        `${harness.localRel}: paths are not portable across supported OSes: ${unportable.join(", ")}`,
      );
    }
    planned.push({ harness, upstreamShellRoot, plan, upstreamFiles });
  }

  // Lockstep, enforced rather than assumed. If upstream ever ships harness
  // trees at different versions, mirroring them would import that split into
  // this repository and quietly violate AGENTS.md.
  const distinct = [...new Set(versions.values())];
  if (distinct.length !== 1) {
    const detail = [...versions].map(([id, value]) => `${id}=${value}`).join(", ");
    throw new Error(`upstream harness versions disagree (${detail}); refusing to split lockstep`);
  }
  const version = distinct[0];
  if (version === undefined) throw new Error("no harness produced a version");

  const results: HarnessResult[] = [];
  for (const { harness, upstreamShellRoot, plan, upstreamFiles } of planned) {
    applyShellSync({ workspaceRoot, upstreamShellRoot, localRel: harness.localRel, plan });
    const manifest = path.join(workspaceRoot, harness.localRel, "aidlc-install.json");
    // Every path the sync touches -- overwrites are a subset of writes, and a
    // delete leaves a manifest entry pointing at a file that is now gone.
    // staleManagedFiles compares hashes rather than trusting this set, so a
    // touch that happens to leave the manifest correct is not reported.
    const staleManaged = existsSync(manifest)
      ? staleManagedFiles(
          readFileSync(manifest, "utf8"),
          harness.localRel,
          [...plan.writes, ...plan.deletes],
          upstreamFiles,
        )
      : [];
    results.push({ harness, plan, staleManaged });
  }

  if (prBodyPath !== undefined) {
    writeFileSync(
      path.resolve(prBodyPath),
      formatShellPrBody({ version, previousVersion, upstreamSha, results }),
    );
  }

  const total = (pick: (plan: ShellPlan) => number): number =>
    results.reduce((sum, result) => sum + pick(result.plan), 0);
  const written = total((plan) => plan.writes.length);
  const deleted = total((plan) => plan.deletes.length);
  const out = [
    `version=${version}`,
    `previous_version=${previousVersion ?? ""}`,
    `sha=${upstreamSha}`,
    `written=${written}`,
    `overwritten=${total((plan) => plan.overwrites.length)}`,
    `deleted=${deleted}`,
    `preserved=${total((plan) => plan.preserved.length)}`,
    `stale_manifests=${results.reduce((sum, result) => sum + result.staleManaged.length, 0)}`,
    `changed=${written > 0 || deleted > 0}`,
  ];
  for (const { harness, plan } of results) {
    out.push(
      `${harness.id}_written=${plan.writes.length}`,
      `${harness.id}_deleted=${plan.deletes.length}`,
    );
  }
  return out;
}

export function runCli(argv: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: `${run(argv).join("\n")}\n`, stderr: "" };
  } catch (error) {
    if (error instanceof UsageError) return { status: 1, stdout: "", stderr: USAGE };
    const message = error instanceof Error ? error.message : String(error);
    return { status: 1, stdout: "", stderr: `${message}\n` };
  }
}

if (import.meta.main) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  process.exit(result.status);
}
