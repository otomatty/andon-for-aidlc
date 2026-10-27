import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "../src/harness-detect.ts";
import { HARNESS_DIRECTORIES } from "../src/native-harness-merge.ts";
import { configureNative } from "../src/native-setup.ts";
import {
  classifyConflict,
  configProblems,
  NativeConfigConflict,
} from "../src/workflows-conflicts.ts";
import {
  canonicalGitignore,
  checkJsonFix,
  checkMerge,
  decodeLegacyText,
  explainRepair,
  generatedDocumentBlock,
  generatedGitignoreBlock,
  gitignoreConfigSource,
  ignoreRulesOverlap,
  jsonErrorLocation,
  keepName,
  legacyDocumentText,
  jsonContent,
  legacyIgnoreRules,
  managedGitignoreBlock,
  managedIgnoreParts,
  rebuildManagedIgnore,
  mergeLocalEdit,
  officialEquivalent,
  type RepairDependencies,
  reapplyLocalPatches,
  repairWorkflows,
  stripManagedBlocks,
} from "../src/workflows-repair.ts";
import { repairHash } from "../src/workflows-repair-files.ts";
import { harnessVersionRel } from "../src/workflows-version.ts";

const roots: string[] = [];
async function temporary() {
  const root = await mkdtemp(path.join(tmpdir(), "repair-test-"));
  roots.push(root);
  return root;
}
function put(root: string, rel: string, text: string | Buffer) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
const conflict = (
  file = ".claude/CLAUDE.md",
  detail = "locally modified or unowned",
  harness: HarnessId = "claude",
) =>
  configProblems(
    JSON.stringify({ data: { actions: [{ action: "conflict", path: file, detail }] } }),
    harness,
  );
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("update conflict diagnostics", () => {
  it("preserves structured failures and upstream's way forward from a nonzero dry run", async () => {
    const runner = vi.fn().mockResolvedValue({
      code: 4,
      stdout: JSON.stringify({
        message: "long raw error",
        remediation: "move .claude/CLAUDE.md somewhere else and run the same command again",
        data: {
          actions: [
            {
              action: "conflict",
              path: ".claude/CLAUDE.md",
              detail: "locally modified or unowned",
            },
            {
              action: "conflict",
              path: ".gitignore",
              detail:
                "legacy root integration ambiguous; move or delete the unmarked AI-DLC content",
            },
            { action: "preserve", path: "ok", detail: "unchanged" },
          ],
        },
      }),
      stderr: "",
    });
    const error = await configureNative(
      { executable: "/runtime/aidlc", version: "2.8.2", binDir: "/bin" },
      "/project",
      "claude",
      () => {},
      runner,
      { previewOnly: true },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(NativeConfigConflict);
    expect(error.problems.map((p: { kind: string }) => p.kind)).toEqual([
      "ownership",
      "legacy-root",
    ]);
    expect(error.problems[0].remediation).toContain("move .claude/CLAUDE.md");
    expect(runner).toHaveBeenCalledOnce();
  });
  it("does not infer ownership from text or accept malformed actions", () => {
    for (const data of [
      "178 config conflict(s)",
      "null",
      "{}",
      '{"data":{"actions":[null,{"action":"conflict","path":3}]}}',
    ])
      expect(configProblems(data, "claude")).toEqual([]);
    expect(conflict(".mcp.json", "unknown")[0]?.kind).toBe("other");
  });
  it.each([
    ["locally modified or unowned", "ownership"],
    ["unowned whole file", "ownership"],
    ["removed upstream but locally modified", "removed"],
    ["managed block has no ownership baseline", "block-baseline"],
    ["managed block was locally modified", "block-modified"],
    ["malformed JSON", "json"],
    ["JSON root must be an object", "json-shape"],
    ["mcpServers must be a JSON object", "json-shape"],
    ["hooks.Stop must be a JSON array", "json-shape"],
    ["permissions.allow must be a string array", "json-shape"],
    ["AGENTS.md is not valid UTF-8; convert its encoding before config", "encoding"],
    ["managed path is not a regular file", "not-file"],
    ["retired root integration is not a regular file", "not-file"],
    ["managed markers are missing, duplicated, or malformed", "markers"],
    ["retired managed block was locally modified", "retired"],
  ])("reads %j as %s with Japanese guidance", (detail, kind) => {
    const read = classifyConflict(detail);
    expect(read.kind).toBe(kind);
    expect(read.guidance).toMatch(/[ぁ-ん]/);
  });
  it("names the tool another conflict waits for", () => {
    expect(
      classifyConflict(
        "cursor is missing its shipped block copy (.cursor/tools/data/root-blocks/x); run aidlc config --harness cursor first",
      ),
    ).toMatchObject({ kind: "block-copy", related: "cursor" });
    expect(
      classifyConflict(
        "shared block is owned by copilot from a different release; refresh codex from the same release as copilot, or refresh copilot from this release first",
      ),
    ).toMatchObject({ kind: "shared-release", related: "copilot" });
    expect(classifyConflict("ghost is missing its shipped block copy").related).toBeUndefined();
  });
});

describe("exact repairs", () => {
  const original =
    "# project\n.env\n# BEGIN AIDLC CURSOR\n# AI-DLC old\naidlc/.cache/\n!keep\n# END AIDLC CURSOR\ncustom/\n";
  it("keeps every ignore rule and every outside line of an old marked section", () => {
    expect(legacyIgnoreRules(original)).toBe("# project\n.env\naidlc/.cache/\n!keep\ncustom/");
    expect(() => legacyIgnoreRules(original.replace("# END AIDLC CURSOR", ""))).toThrow();
    expect(officialEquivalent(Buffer.from("same\r\n"), Buffer.from("same\n"))).toBe(true);
    expect(officialEquivalent(Buffer.from("custom"), Buffer.from("official"))).toBe(false);
  });
  it("keeps the project's text around an old marked Markdown section", () => {
    expect(legacyDocumentText(legacyAgents)).toBe(retainedAgents);
    expect(
      legacyDocumentText("<!-- BEGIN AIDLC CURSOR -->\nold\n<!-- END AIDLC CURSOR -->"),
    ).toBe("");
    expect(() => legacyDocumentText("# Mine\n\n# AI-DLC\nRun /aidlc.\n")).toThrow(
      "区切りがない",
    );
  });
  it("splits a .gitignore around its one managed block", () => {
    expect(
      managedIgnoreParts(
        "# mine\n.env\n# BEGIN AI-DLC:gitignore\n# AI-DLC\naidlc/.cache/\nmine/\n# END AI-DLC:gitignore\n!mine/keep\n",
      ),
    ).toEqual({ before: "# mine\n.env", after: "!mine/keep", rules: ["aidlc/.cache/", "mine/"] });
    expect(() => managedIgnoreParts("# BEGIN AI-DLC:gitignore\n")).toThrow("区切り");
    // A leading space and an escaped trailing space belong to the pattern.
    expect(
      managedIgnoreParts(
        "\n \n secrets.txt\n# BEGIN AI-DLC:gitignore\n# END AI-DLC:gitignore\nname\\ \n  \n",
      ),
    ).toEqual({ before: " secrets.txt", after: "name\\ ", rules: [] });
    // The project's own blank lines stay; only those at either end go.
    expect(
      managedIgnoreParts("# mine\n\n\n.env\n\n# BEGIN AI-DLC:gitignore\n# END AI-DLC:gitignore\n").before,
    ).toBe("# mine\n\n\n.env");
    // Only a `#` in the first column starts a comment.
    expect(
      managedIgnoreParts("# BEGIN AI-DLC:gitignore\n#note\n #secrets\n  \n# END AI-DLC:gitignore\n")
        .rules,
    ).toEqual([" #secrets"]);
  });
  it("keeps every rule in order against the rules around the rebuilt block", () => {
    const block = "# BEGIN AI-DLC:gitignore\n# AI-DLC\naidlc/.cache/\n# END AI-DLC:gitignore";
    // A negation after the block still comes after the rule it negates, so keep.log stays tracked.
    const rebuilt = rebuildManagedIgnore(
      managedIgnoreParts("# BEGIN AI-DLC:gitignore\n*.log\n# END AI-DLC:gitignore\n!keep.log\n"),
      block,
    );
    expect(rebuilt).toBe(`${block}\n*.log\n\n!keep.log\n`);
    expect(
      rebuildManagedIgnore(
        managedIgnoreParts(
          "dist/\n\n# BEGIN AI-DLC:gitignore\naidlc/.cache/\nmine/\n# END AI-DLC:gitignore\n\n!mine/keep\n",
        ),
        block,
      ),
    ).toBe(`dist/\n\n${block}\nmine/\n\n!mine/keep\n`);
  });
  it("puts the project's rules before the block when after would let a negation win", () => {
    const block =
      "# BEGIN AI-DLC:gitignore\naidlc/active-space\naidlc/spaces/*/intents/active-intent\n# END AI-DLC:gitignore";
    // The negation came before the official exclusion, so the cursor stayed ignored.
    expect(
      rebuildManagedIgnore(
        managedIgnoreParts(
          "# BEGIN AI-DLC:gitignore\n!aidlc/active-space\naidlc/active-space\n# END AI-DLC:gitignore\n",
        ),
        block,
      ),
    ).toBe(`!aidlc/active-space\n${block}\n`);
    // Only a `!` in the first column negates, so this exclusion stays after the block.
    expect(
      rebuildManagedIgnore(
        managedIgnoreParts(
          "# BEGIN AI-DLC:gitignore\n !aidlc/active-space\naidlc/active-space\n# END AI-DLC:gitignore\n",
        ),
        block,
      ),
    ).toBe(`${block}\n !aidlc/active-space\n`);
    // A name without a slash matches the cursor too, so it stays before the exclusion.
    expect(
      rebuildManagedIgnore(
        managedIgnoreParts(
          "# BEGIN AI-DLC:gitignore\n!active-intent\naidlc/spaces/*/intents/active-intent\n# END AI-DLC:gitignore\n",
        ),
        block,
      ),
    ).toBe(`!active-intent\n${block}\n`);
    // A `**` part may stand for no folder, so this negation matches the cursor too.
    const cursor = "# BEGIN AI-DLC:gitignore\naidlc/active-space\n# END AI-DLC:gitignore";
    expect(
      rebuildManagedIgnore(
        managedIgnoreParts(
          "# BEGIN AI-DLC:gitignore\n!aidlc/**/active-space\naidlc/active-space\n# END AI-DLC:gitignore\n",
        ),
        cursor,
      ),
    ).toBe(`!aidlc/**/active-space\n${cursor}\n`);
  });
  it("rebuilds nothing when neither side keeps a negation's precedence", () => {
    const block = "# BEGIN AI-DLC:gitignore\n*.log\n# END AI-DLC:gitignore";
    expect(() =>
      rebuildManagedIgnore(
        managedIgnoreParts(
          "# BEGIN AI-DLC:gitignore\n!a.log\n*.log\n!b.log\n# END AI-DLC:gitignore\n",
        ),
        block,
      ),
    ).toThrow("!a.log");
  });
  it.each([
    ["aidlc/active-space", "!aidlc/active-space", true],
    ["aidlc/", "aidlc/active-space", true],
    ["*.log", "logs/keep.log", true],
    ["aidlc/spaces/*/intents/active-intent", "aidlc/spaces/default/intents/active-intent", true],
    ["**/.aidlc-engine/", ".aidlc-engine", true],
    ["aidlc/spaces/*/intents/active-intent", "aidlc", true],
    ["*.log", "*.tmp", true],
    ["aidlc/spaces/*/intents/active-intent", "!active-intent", true],
    ["aidlc/spaces/*/intents/*/runtime-graph.json", "runtime-graph.json", true],
    ["aidlc/**", "active-space", true],
    ["aidlc/spaces/*", "default", true],
    ["aidlc/**/active-space", "aidlc/active-space", true],
    ["**/active-space", "active-space", true],
    ["aidlc/**", "aidlc/x/active-space", true],
    ["aidlc/**/active-space", "aidlc/spaces/default", false],
    ["\\!keep.log", "build/", true],
    ["aidlc/.cache/", "aidlc/active-space", false],
    ["aidlc/spaces/*/intents/active-intent", "aidlc/active-space", false],
    ["aidlc/spaces/*/intents/active-intent", "active-space", false],
    ["*.log", "build/", false],
  ])("says whether %j and %j may match one path", (left, right, expected) => {
    expect(ignoreRulesOverlap(left, right)).toBe(expected);
  });
  it("removes every managed block and leaves the rest", () => {
    expect(
      stripManagedBlocks(
        "# Team\n\n<!-- BEGIN AI-DLC:cursor -->\nold\n<!-- END AI-DLC:cursor -->\n\n\n## Notes\n",
      ),
    ).toBe("# Team\n\n## Notes\n");
    expect(stripManagedBlocks("<!-- BEGIN AI-DLC:x -->\nonly\n<!-- END AI-DLC:x -->")).toBe("");
    expect(
      stripManagedBlocks("\n secrets.txt\n# BEGIN AI-DLC:gitignore\nold\n# END AI-DLC:gitignore\nname\\ \n"),
    ).toBe(" secrets.txt\nname\\ \n");
    for (const broken of [
      "no markers",
      "<!-- BEGIN AI-DLC:x -->\n",
      "<!-- BEGIN AI-DLC:x -->\n<!-- END AI-DLC:y -->",
    ])
      expect(() => stripManagedBlocks(broken)).toThrow("区切り");
  });
  it("finds a free local name beside the file", () => {
    expect(keepName(".cursor/rules/aidlc.mdc", () => false)).toBe(".cursor/rules/aidlc.local.mdc");
    expect(keepName("README", () => false)).toBe("README.local");
    expect(keepName("a/b.md", (name) => name === "a/b.local.md")).toBe("a/b.local-2.md");
  });
  it("reads older Japanese encodings and says where JSON breaks", () => {
    const sjis = Buffer.from([0x82, 0xa0, 0x82, 0xa2, 0x0a]); // あい in Shift_JIS
    expect(decodeLegacyText(sjis)).toEqual({ label: "Shift_JIS", text: "あい\n" });
    const euc = Buffer.from([0xa4, 0xa2, 0xa4, 0xa4]); // あい in EUC-JP
    expect(decodeLegacyText(euc)).toEqual({ label: "EUC-JP", text: "あい" });
    expect(decodeLegacyText(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
    expect(jsonErrorLocation('{\n  "a": 1,\n}')).toMatch(/^3 行目 \d+ 文字目付近$/);
    expect(jsonErrorLocation('{"a":1}')).toBeNull();
  });
});

describe("AI proposal checks", () => {
  it("accepts a merge built from official and project lines and reports what it kept", () => {
    const checks = checkMerge("a\nmine\nb", "a\nb\nc", "a\nmine\nb\nc");
    expect(checks.every((check) => check.ok)).toBe(true);
    const dropped = checkMerge("a\nmine\nb", "a\nb\nc", "a\nmine\nb");
    expect(dropped.find((check) => !check.ok)?.text).toContain("1 行を削除または変更");
    const lost = checkMerge("a\nmine\nb", "a\nb\nc", "a\nb\nc", "a\nb");
    expect(lost.find((check) => !check.ok)?.text).toContain("1 行を残していない");
    const unknown = checkMerge("a\nmine\nb", "a\nb\nc", "a\nb\nc");
    expect(unknown.every((check) => check.ok)).toBe(true);
    expect(unknown[2]?.text).toContain("1 行のうち 0 行");
  });
  it.each([
    ["invented line", "a\nb\nc\nextra"],
    ["empty", ""],
    ["non-string", null],
  ])("refuses a merge with %s", (_label, merged) => {
    expect(() => checkMerge("a\nb", "a\nb\nc", merged)).toThrow();
  });
  it("accepts a JSON fix that changes only punctuation and spacing", () => {
    expect(checkJsonFix('{"a": "x",}', '{"a": "x"}').every((check) => check.ok)).toBe(true);
    expect(checkJsonFix('{"a": "x", // note\n}', '{"a": "x" // note\n}')).toHaveLength(2);
    expect(checkJsonFix('{"a": 1 "b": true}', '{"a": 1, "b": true}')).toHaveLength(2);
  });
  it.each([
    ["dropped value", '{"a": "x", "b": "y",}', '{"a": "x"}'],
    ["changed number", '{"a": 1,}', '{"a": 2}'],
    ["changed boolean", '{"a": true,}', '{"a": false}'],
    ["reordered keys", '{"a": 1, "b": 2,}', '{"b": 2, "a": 1}'],
    ["moved comment", '{"a": 1, // a\n"b": 2,}', '{"a": 1, "b": 2 // a\n}'],
    ["still broken", '{"a": "x",}', '{"a": "x",}'],
    ["array root", '["x",]', '["x"]'],
    ["non-string", '{"a":1,}', null],
  ])("refuses a JSON fix with %s", (_label, original, fixed) => {
    expect(() => checkJsonFix(original, fixed)).toThrow();
  });
  it("says a missing quote is the person's to fix", () => {
    expect(() => checkJsonFix('{"a": "x\n}', '{"a": "x"\n}')).toThrow("引用符が足りない場合は");
    expect(() => checkJsonFix('{"a": 1,}', '{"a": 2}')).toThrow("キーや値、コメント");
  });
  it("reads keys, values and comments apart from punctuation", () => {
    expect(jsonContent('\uFEFF{"a\\"b": [1, -2.5e3, null], /* c */ "d": "e\n// x\n}')).toEqual([
      '"a\\"b"',
      "1",
      "-2.5e3",
      "null",
      "/* c */",
      '"d"',
      '"e',
      "// x",
    ]);
  });
});

const legacyAgents =
  "# Project guide\nUse /aidlc to start AI-DLC.\n\n<!-- BEGIN AIDLC CURSOR -->\n# Old AI-DLC\nold text\n<!-- END AIDLC CURSOR -->\n\n## Team notes\n";
const retainedAgents = "# Project guide\nUse /aidlc to start AI-DLC.\n\n## Team notes";
const frameworkAgentsBlock =
  "<!-- BEGIN AI-DLC:cursor -->\n# AI-DLC on Cursor\nnew text\n<!-- END AI-DLC:cursor -->";

describe("shared gitignore across tools", () => {
  it("keeps every tool's AI-DLC ignore rules in one official body", () => {
    const bodies = new Map<string, string>([
      ["cursor", "# Cursor\ndist\n\n# AI-DLC\naidlc/.aidlc-cursor-subagents/\nshared/\n"],
      [
        "claude",
        "# Claude\ndist\nonly-claude-general\n\n# AI-DLC\nshared/\n.claude/settings.local.json\n",
      ],
    ]);
    const canonical = canonicalGitignore(bodies);
    expect(canonical.startsWith("# Cursor")).toBe(true);
    expect(canonical).toContain("aidlc/.aidlc-cursor-subagents/");
    expect(canonical).toContain(".claude/settings.local.json");
    expect(canonical).not.toContain("# Claude");
    expect(canonical).not.toContain("only-claude-general");
    const block = managedGitignoreBlock(canonical);
    expect(block.startsWith("# BEGIN AI-DLC:gitignore\n")).toBe(true);
    expect(block.endsWith("\n# END AI-DLC:gitignore")).toBe(true);
    expect(() => generatedGitignoreBlock(block, "shared/\n")).toThrow("一般的な除外ルール");
    expect(generatedGitignoreBlock(block, "dist\nshared/\n")).toBe(block);
  });
  it("gives every tool the same .gitignore source when the official files differ", async () => {
    const root = await temporary();
    const executable = path.join(root, "aidlc");
    writeFileSync(executable, "");
    put(root, "runtime/cursor/.gitignore", "shared/\n\n# AI-DLC\ncursor-only/\n");
    put(root, "runtime/cursor/.cursor/tools/data/aidlc-stamp.json", "{}");
    put(root, "runtime/claude/.gitignore", "shared/\n\n# AI-DLC\nclaude-only/\n");
    const install = { executable, version: "2.9.0", binDir: root };
    const cursor = gitignoreConfigSource(install, "cursor", ["cursor", "claude"]);
    const claude = gitignoreConfigSource(install, "claude", ["cursor", "claude"]);
    try {
      const cursorText = readFileSync(path.join(cursor.sourceRoot, ".gitignore"), "utf8");
      const claudeText = readFileSync(path.join(claude.sourceRoot, ".gitignore"), "utf8");
      expect(cursorText).toBe(claudeText);
      expect(cursorText).toContain("cursor-only/");
      expect(cursorText).toContain("claude-only/");
      expect(cursor.sourceRoot).not.toBe(path.join(root, "runtime", "cursor"));
    } finally {
      await cursor.discard();
      await claude.discard();
    }
  });
});

describe("generated blocks", () => {
  it("extracts exactly one complete generated Markdown block", () => {
    expect(generatedDocumentBlock(`intro\r\n${frameworkAgentsBlock}\r\nfooter\r\n`)).toBe(
      frameworkAgentsBlock,
    );
    for (const generated of [
      "",
      frameworkAgentsBlock.replace("<!-- END AI-DLC:cursor -->", "<!-- END AI-DLC:claude -->"),
      `${frameworkAgentsBlock}\n${frameworkAgentsBlock}`,
    ])
      expect(() => generatedDocumentBlock(generated)).toThrow("管理ブロック");
  });
  it.each(["\n", "\r\n"])(
    "extracts only the complete framework .gitignore block with %j newlines",
    (newline) => {
      const generated = `dist\n.vscode/*\n${frameworkIgnoreBlock}\n*.local\n`.replaceAll(
        "\n",
        newline,
      );
      expect(generatedGitignoreBlock(generated, ".env\n!keep")).toBe(frameworkIgnoreBlock);
    },
  );
  it.each([
    "",
    frameworkIgnoreBlock.replace("# END AI-DLC:gitignore", ""),
    frameworkIgnoreBlock.replace("# END AI-DLC:gitignore", "# END AI-DLC:other"),
    frameworkIgnoreBlock.replace("# BEGIN AI-DLC:gitignore", "# BEGIN AI-DLC:other"),
    `${frameworkIgnoreBlock}\n${frameworkIgnoreBlock}`,
    "# END AI-DLC:gitignore\n# AI-DLC runtime\n# BEGIN AI-DLC:gitignore",
    frameworkIgnoreBlock.replace("# AI-DLC runtime", "# generic"),
  ])("rejects incomplete, mismatched or ambiguous generated blocks (%#)", (generated) => {
    expect(() => generatedGitignoreBlock(generated, "")).toThrow("公式の .gitignore");
  });
  it("refuses new generic exclusions inside the native ownership block", () => {
    const generated = frameworkIgnoreBlock.replace(
      "# AI-DLC runtime",
      "# Logs\ndist\n*.local\n# AI-DLC runtime",
    );
    expect(() => generatedGitignoreBlock(generated, "dist\n!dist/keep")).toThrow(
      "一般的な除外ルール",
    );
    expect(generatedGitignoreBlock(generated, "dist\n*.local\n!dist/keep")).toBe(generated);
  });
});

const frameworkIgnoreBlock =
  "# BEGIN AI-DLC:gitignore\n# AI-DLC runtime\naidlc/.cache/\n# END AI-DLC:gitignore";

const projection = (harness: HarnessId) => {
  const dir = HARNESS_DIRECTORIES[harness];
  const extraDir =
    harness === "copilot"
      ? ".github"
      : harness === "opencode"
        ? ".opencode"
        : harness === "codex"
          ? ".agents"
          : dir;
  return JSON.stringify({
    schemaVersion: 1,
    distribution: harness,
    harnessDir: dir,
    managedDirectories: [...new Set([dir, extraDir, "aidlc"])],
    rootIntegrations:
      harness === "claude"
        ? []
        : [
            { path: "AGENTS.md", policy: "managed-block" },
            ...(harness === "opencode" ? [{ path: "opencode.json", policy: "whole-file" }] : []),
          ],
  });
};

async function fixture(
  harness: HarnessId = "claude",
  files = [".claude/CLAUDE.md"],
  texts: { official?: string; old?: string } = {},
) {
  const official = texts.official ?? "new official";
  const old = texts.old ?? "official old";
  const root = await temporary(),
    release = await temporary(),
    backupParent = await temporary();
  const dir = HARNESS_DIRECTORIES[harness];
  const detector =
    harness === "copilot"
      ? ".github/skills/aidlc/SKILL.md"
      : harness === "opencode"
        ? ".opencode/command/aidlc.md"
        : `${dir}/skills/aidlc/SKILL.md`;
  put(root, detector, "skill");
  put(root, harnessVersionRel(harness), 'export const AIDLC_VERSION = "2.8.0";');
  put(root, ".aidlc-version", "2.8.0\n");
  const oldRelease = await temporary();
  for (const file of files) {
    put(root, file, old);
    put(release, `runtime/${harness}/${file}`, official);
    put(oldRelease, `runtime/${harness}/${file}`, old);
  }
  for (const distribution of [release, oldRelease])
    put(distribution, `runtime/${harness}/${dir}/tools/data/aidlc-projection.json`, projection(harness));
  const install = { executable: path.join(release, "aidlc"), version: "2.8.2", binDir: release };
  const configure: RepairDependencies["configure"] = vi.fn(
    async (_install, candidate, configured, _log, _runner, options) => {
      const conflicts = files.filter(
        (rel) =>
          existsSync(path.join(candidate, rel)) &&
          readFileSync(path.join(candidate, rel), "utf8") !== official,
      );
      if (conflicts.length)
        throw new NativeConfigConflict(
          conflicts.flatMap((rel) => conflict(rel, undefined, configured)),
        );
      if (!options?.previewOnly) for (const file of files) put(candidate, file, official);
      return { doctorOk: true, details: "", planToken: "token" };
    },
  );
  const cleanup = vi.fn();
  const run = vi.fn();
  const dependencies: Partial<RepairDependencies> = {
    readInstall: (version) =>
      version === "2.8.0"
        ? { ...install, version, executable: path.join(oldRelease, "aidlc") }
        : install,
    fetchInstall: vi.fn(),
    configure,
    probe: vi.fn().mockResolvedValue({
      tool: "claude",
      available: true,
      label: "Claude Code",
      command: "claude",
    }),
    run,
    scratch: vi.fn().mockResolvedValue({ cwd: release, env: {}, cleanup }),
  };
  const options = {
    root,
    backupParent,
    signal: new AbortController().signal,
    isCurrent: () => true,
    log: vi.fn(),
  };
  const fix = (choices: Record<string, string> = {}, more = {}) => ({
    ...options,
    fix: { choices: choices as never, tool: "claude" as const, ...more },
  });
  return {
    root,
    release,
    oldRelease,
    backupParent,
    options,
    fix,
    dependencies,
    run,
    cleanup,
    configure,
    install,
  };
}

async function gitignoreFixture(generated: string, preamble = "") {
  const f = await fixture();
  const original = `${preamble}# project\n.env\n# BEGIN AIDLC CURSOR\n# old rules\naidlc/.cache/\n# END AIDLC CURSOR\ncache/\n!cache/keep\n`;
  const retained = `${preamble}# project\n.env\naidlc/.cache/\ncache/\n!cache/keep`;
  put(f.root, ".gitignore", original);
  f.dependencies.configure = vi.fn(async (...args) => {
    if (readFileSync(path.join(args[1], ".gitignore"), "utf8").includes("# BEGIN AIDLC CURSOR"))
      throw new NativeConfigConflict([
        ...conflict(),
        ...conflict(".gitignore", "legacy root integration ambiguous"),
      ]);
    return f.configure(...args);
  });
  f.dependencies.pristine = vi.fn(async (_install, candidate) => {
    put(candidate, ".gitignore", generated);
    return { doctorOk: true, details: "", planToken: "token" };
  });
  return { ...f, original, retained };
}

describe("checking", () => {
  it("diagnoses all conflicts in a copy and plans them without starting AI", async () => {
    const f = await fixture();
    const result = await repairWorkflows(f.options, f.dependencies);
    expect(result.problems).toHaveLength(1);
    expect(result.items).toMatchObject([
      { path: ".claude/CLAUDE.md", group: "auto", options: [{ action: "regenerate" }] },
    ]);
    expect(f.run).not.toHaveBeenCalled();
    expect(readFileSync(path.join(f.root, ".aidlc-version"), "utf8")).toBe("2.8.0\n");
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("official old");
  });
  it.each([
    ".mcp.json",
    "aidlc/spaces/default/memory/project.md",
    ".claude/tools/data/aidlc-manifest.json",
    ".claude/tools/data/aidlc-guide-install.json",
  ])("leaves undeclared files, team memory and ownership records to the person: %s", async (file) => {
    const f = await fixture("claude", [file]);
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.items.map((item) => [item.path, item.group])).toEqual([[file, "manual"]]);
    expect(result.changed).toBeUndefined();
    expect(readFileSync(path.join(f.root, file), "utf8")).toBe("official old");
  });
  it("offers fetching the old release, AI and replacing when the project's edit cannot be told apart", async () => {
    const f = await fixture();
    put(f.root, ".claude/CLAUDE.md", "official old\npatched line");
    put(f.root, harnessVersionRel("claude"), 'export const AIDLC_VERSION = "2.7.0";');
    const readInstall = f.dependencies.readInstall;
    f.dependencies.readInstall = (version) =>
      version === "2.7.0" ? null : (readInstall?.(version) ?? null);
    const { items } = await repairWorkflows(f.options, f.dependencies);
    expect(items[0]?.group).toBe("confirm");
    expect(items[0]?.options.map((option) => option.action)).toEqual([
      "fetch-base",
      "ai-merge",
      "replace",
    ]);
    expect(items[0]?.plan).toContain("2.7.0");
  });
  it("merges tools that agree about one file and leaves disagreement to the person", async () => {
    const f = await fixture();
    put(f.root, ".cursor/skills/aidlc/SKILL.md", "skill");
    put(f.root, harnessVersionRel("cursor"), 'export const AIDLC_VERSION = "2.8.0";');
    put(f.root, "AGENTS.md", "# Team\n<!-- BEGIN AI-DLC:cursor -->\nx\n<!-- END AI-DLC:cursor -->\n");
    f.dependencies.configure = vi.fn(async (_install, _root, harness) => {
      throw new NativeConfigConflict(
        conflict(
          "AGENTS.md",
          harness === "claude" ? "managed block was locally modified" : "managed block has no ownership baseline",
          harness,
        ),
      );
    });
    const { items } = await repairWorkflows(f.options, f.dependencies);
    expect(items).toHaveLength(1);
    expect(items[0]?.group).toBe("confirm");
    expect(items[0]?.harnesses.sort()).toEqual(["claude", "cursor"]);
    f.dependencies.configure = vi.fn(async (_install, _root, harness) => {
      throw new NativeConfigConflict(
        conflict("AGENTS.md", harness === "claude" ? "managed block was locally modified" : "malformed JSON", harness),
      );
    });
    expect((await repairWorkflows(f.options, f.dependencies)).items[0]?.group).toBe("manual");
  });
});

describe("repairs without AI", () => {
  it("regenerates official copies and imports only verified native output with backup", async () => {
    const f = await fixture();
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.problems).toEqual([]);
    expect(result.changed).toEqual([".claude/CLAUDE.md"]);
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("new official");
    expect(readFileSync(path.join(result.backup ?? "", "0.bin"), "utf8")).toBe("official old");
    expect(readFileSync(path.join(f.root, ".aidlc-version"), "utf8")).toBe("2.8.0\n");
    expect(f.run).not.toHaveBeenCalled();
    expect(f.dependencies.probe).not.toHaveBeenCalled();
  });
  it.each(["\n", "\r\n"])(
    "moves an old .gitignore section to the official block with %j newlines",
    async (newline) => {
      const f = await gitignoreFixture(
        `dist\n.vscode/*\n${frameworkIgnoreBlock}\n*.local\n`.replaceAll("\n", newline),
      );
      const result = await repairWorkflows(f.fix(), f.dependencies);
      expect(result.problems).toEqual([]);
      expect(result.changed).toContain(".gitignore");
      expect(readFileSync(path.join(f.root, ".gitignore"), "utf8")).toBe(
        `${frameworkIgnoreBlock}\n\n${f.retained}\n`,
      );
      const manifest = JSON.parse(
        readFileSync(path.join(result.backup ?? "", "manifest.json"), "utf8"),
      );
      const saved = manifest.changes.find(
        (change: { path: string }) => change.path === ".gitignore",
      );
      expect(readFileSync(path.join(result.backup ?? "", saved.backup), "utf8")).toBe(f.original);
      expect(f.run).not.toHaveBeenCalled();
    },
  );
  it("keeps native ownership bytes when generic rules are already in the project", async () => {
    const block = frameworkIgnoreBlock.replace(
      "# AI-DLC runtime",
      "# Logs\ndist\n*.local\n# AI-DLC runtime",
    );
    const f = await gitignoreFixture(block, "dist\n*.local\n!dist/keep\n");
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.problems).toEqual([]);
    expect(readFileSync(path.join(f.root, ".gitignore"), "utf8")).toBe(
      `${block}\n\n${f.retained}\n`,
    );
  });
  it.each([
    frameworkIgnoreBlock.replace("# AI-DLC runtime", "dist\n# AI-DLC runtime"),
    frameworkIgnoreBlock.replace("# END AI-DLC:gitignore", "# END AI-DLC:other"),
  ])("leaves every original file unchanged when generated rules are unsafe (%#)", async (generated) => {
    const f = await gitignoreFixture(generated);
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.items.find((item) => item.path === ".gitignore")?.note).toContain(
      "公式の .gitignore",
    );
    expect(result.message).toContain("元の設定は変更していません");
    expect(readFileSync(path.join(f.root, ".gitignore"), "utf8")).toBe(f.original);
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("official old");
    expect(f.dependencies.configure).toHaveBeenCalledTimes(1);
  });
  it("replaces an old marked Markdown section with each tool's official block", async () => {
    const f = await fixture();
    put(f.root, "AGENTS.md", legacyAgents);
    f.dependencies.configure = vi.fn(async (...args) => {
      if (!readFileSync(path.join(args[1], "AGENTS.md"), "utf8").includes("<!-- BEGIN AI-DLC:"))
        throw new NativeConfigConflict([
          ...conflict(),
          ...conflict("AGENTS.md", "legacy root integration ambiguous", "cursor"),
        ]);
      return f.configure(...args);
    });
    f.dependencies.pristine = vi.fn(async (_install, candidate) => {
      put(candidate, "AGENTS.md", `${frameworkAgentsBlock}\n`);
      return { doctorOk: true, details: "", planToken: "token" };
    });
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.problems).toEqual([]);
    expect(readFileSync(path.join(f.root, "AGENTS.md"), "utf8")).toBe(
      `${retainedAgents}\n\n${frameworkAgentsBlock}\n`,
    );
    expect(f.dependencies.pristine).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "cursor",
      expect.any(Function),
      undefined,
      expect.objectContaining({ mcp: "none" }),
    );
    expect(f.run).not.toHaveBeenCalled();
  });
  it("restores the official file for the update and returns the merged project edit", async () => {
    const f = await fixture();
    put(f.oldRelease, "runtime/claude/.claude/CLAUDE.md", "line\nkeep");
    put(f.release, "runtime/claude/.claude/CLAUDE.md", "line\nkeep\nadded-by-release");
    put(f.root, ".claude/CLAUDE.md", "line\npatch\nkeep");
    const { items } = await repairWorkflows(f.options, f.dependencies);
    expect(items[0]).toMatchObject({ group: "auto", options: [{ action: "reapply" }] });
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.problems).toEqual([]);
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("new official");
    expect(result.patches).toEqual([
      {
        path: ".claude/CLAUDE.md",
        officialHash: repairHash("line\nkeep\nadded-by-release"),
        content: "line\npatch\nkeep\nadded-by-release",
      },
    ]);
    expect(result.message).toContain("更新の後で当て直します");
    expect(f.run).not.toHaveBeenCalled();
  });
  it("keeps the patch as it is when the official file did not change", async () => {
    const f = await fixture();
    put(f.root, harnessVersionRel("claude"), 'export const AIDLC_VERSION = "2.8.2";');
    put(f.root, ".claude/CLAUDE.md", "new official\npatched line");
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.patches?.[0]?.content).toBe("new official\npatched line");
    expect(f.run).not.toHaveBeenCalled();
  });
  it("merges an edit deterministically and refuses overlapping edits", () => {
    expect(mergeLocalEdit("a\nb\nc", "a\nb\npatch\nc", "a\nb\nc\nz")).toBe("a\nb\npatch\nc\nz");
    expect(mergeLocalEdit("a\nb", "a\na\nb", "a\nb\nz")).toBe("a\na\nb\nz");
    expect(mergeLocalEdit("a\nb", "a\nb\npatch", "a2\nb")).toBe("a2\nb\npatch");
    expect(mergeLocalEdit("a\nb\nc", "a\nb\npatch\nc", "a\nb2\nc")).toBeNull();
  });
  it("re-applies only onto the exact official bytes it expects", async () => {
    const root = await temporary();
    put(root, "a.ts", "official\r\n");
    put(root, "b.ts", "someone else's edit");
    const officialHash = repairHash("official\n");
    expect(
      reapplyLocalPatches(root, [
        { path: "a.ts", officialHash, content: "patched" },
        { path: "b.ts", officialHash, content: "patched" },
        { path: "missing.ts", officialHash, content: "patched" },
      ]),
    ).toEqual({ applied: ["a.ts"], skipped: ["b.ts", "missing.ts"] });
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("patched");
    expect(readFileSync(path.join(root, "b.ts"), "utf8")).toBe("someone else's edit");
  });
  it("configures the tool another tool's shared part waits for first", async () => {
    const f = await fixture();
    put(f.root, ".cursor/skills/aidlc/SKILL.md", "skill");
    put(f.root, harnessVersionRel("cursor"), 'export const AIDLC_VERSION = "2.8.0";');
    const applied: HarnessId[] = [];
    f.dependencies.configure = vi.fn(async (_install, candidate, harness, _log, _runner, options) => {
      if (harness === "claude" && !existsSync(path.join(candidate, ".cursor/rules/applied")))
        throw new NativeConfigConflict(
          conflict(
            "AGENTS.md",
            "cursor is missing its shipped block copy (.cursor/tools/data/root-blocks/AGENTS.md); run aidlc config --harness cursor first",
          ),
        );
      if (!options?.previewOnly) {
        applied.push(harness);
        if (harness === "cursor") put(candidate, ".cursor/rules/applied", "yes");
      }
      return { doctorOk: true, details: "", planToken: "token" };
    });
    const { items } = await repairWorkflows(f.options, f.dependencies);
    expect(items[0]).toMatchObject({ group: "auto", options: [{ action: "order" }] });
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.problems).toEqual([]);
    expect(applied).toEqual(["cursor", "claude"]);
    expect(readFileSync(path.join(f.root, ".cursor/rules/applied"), "utf8")).toBe("yes");
  });
  it("rebuilds a .gitignore managed block and keeps the project's own rules outside it", async () => {
    const f = await fixture();
    const original =
      "# BEGIN AI-DLC:gitignore\n# AI-DLC runtime\naidlc/.cache/\nmine/\n# END AI-DLC:gitignore\n.env\n";
    put(f.root, ".gitignore", original);
    f.dependencies.configure = vi.fn(async (...args) => {
      if (readFileSync(path.join(args[1], ".gitignore"), "utf8").includes("mine/\n# END"))
        throw new NativeConfigConflict(
          conflict(".gitignore", "managed block has no ownership baseline"),
        );
      return f.configure(...args);
    });
    f.dependencies.pristine = vi.fn(async (_install, candidate) => {
      put(candidate, ".gitignore", `${frameworkIgnoreBlock}\n`);
      return { doctorOk: true, details: "", planToken: "token" };
    });
    put(f.root, ".claude/CLAUDE.md", "new official");
    const { items } = await repairWorkflows(f.options, f.dependencies);
    expect(items[0]).toMatchObject({ group: "auto", options: [{ action: "rebuild-ignore" }] });
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.problems).toEqual([]);
    expect(readFileSync(path.join(f.root, ".gitignore"), "utf8")).toBe(
      `${frameworkIgnoreBlock}\nmine/\n\n.env\n`,
    );
  });
});

describe("repairs the person picks", () => {
  async function customFixture() {
    const f = await fixture();
    put(f.root, ".claude/CLAUDE.md", "custom edit");
    return f;
  }
  it("waits for a pick and changes nothing without one", async () => {
    const f = await customFixture();
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.items[0]).toMatchObject({ group: "confirm", note: "対処を選び直してください。" });
    expect(result.changed).toBeUndefined();
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("custom edit");
  });
  it("replaces with the official file and keeps the old bytes in the backup", async () => {
    const f = await customFixture();
    const result = await repairWorkflows(
      f.fix({ ".claude/CLAUDE.md": "replace" }),
      f.dependencies,
    );
    expect(result.problems).toEqual([]);
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("new official");
    expect(readFileSync(path.join(result.backup ?? "", "0.bin"), "utf8")).toBe("custom edit");
  });
  it("fetches the old release, then re-applies the edit without AI", async () => {
    const f = await fixture("claude", [".claude/CLAUDE.md"], { official: "a2\nb", old: "a\nb" });
    put(f.root, ".claude/CLAUDE.md", "a\nb\npatch");
    put(f.root, harnessVersionRel("claude"), 'export const AIDLC_VERSION = "2.7.0";');
    const readInstall = f.dependencies.readInstall;
    f.dependencies.readInstall = (version) =>
      version === "2.7.0" ? null : (readInstall?.(version) ?? null);
    const fetched = await temporary();
    put(fetched, "runtime/claude/.claude/CLAUDE.md", "a\nb");
    put(fetched, "runtime/claude/.claude/tools/data/aidlc-projection.json", projection("claude"));
    f.dependencies.fetchInstall = vi.fn().mockResolvedValue({
      executable: path.join(fetched, "aidlc"),
      version: "2.7.0",
      binDir: fetched,
    });
    const result = await repairWorkflows(
      f.fix({ ".claude/CLAUDE.md": "fetch-base" }),
      f.dependencies,
    );
    expect(f.dependencies.fetchInstall).toHaveBeenCalledWith("2.7.0", expect.any(Function), expect.any(Object));
    expect(result.problems).toEqual([]);
    expect(result.message).toContain("2.7.0 の公式ファイルを取り寄せました");
    expect(result.patches?.[0]?.content).toBe("a2\nb\npatch");
    expect(f.run).not.toHaveBeenCalled();
  });
  it("reports a failed fetch on the file and changes nothing", async () => {
    const f = await customFixture();
    put(f.root, harnessVersionRel("claude"), 'export const AIDLC_VERSION = "2.7.0";');
    const readInstall = f.dependencies.readInstall;
    f.dependencies.readInstall = (version) =>
      version === "2.7.0" ? null : (readInstall?.(version) ?? null);
    f.dependencies.fetchInstall = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await repairWorkflows(
      f.fix({ ".claude/CLAUDE.md": "fetch-base" }),
      f.dependencies,
    );
    expect(result.items[0]?.note).toContain("offline");
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("custom edit");
  });
  it("deletes or keeps under another name a file the new release no longer ships", async () => {
    for (const [action, kept] of [
      ["delete", null],
      ["keep-renamed", ".claude/rules/old.local.md"],
    ] as const) {
      const f = await fixture();
      put(f.root, ".claude/CLAUDE.md", "new official");
      put(f.root, ".claude/rules/old.md", "my rule");
      f.dependencies.configure = vi.fn(async (...args) => {
        if (existsSync(path.join(args[1], ".claude/rules/old.md")))
          throw new NativeConfigConflict(
            conflict(".claude/rules/old.md", "removed upstream but locally modified"),
          );
        return f.configure(...args);
      });
      const result = await repairWorkflows(
        f.fix({ ".claude/rules/old.md": action }),
        f.dependencies,
      );
      expect(result.problems).toEqual([]);
      expect(existsSync(path.join(f.root, ".claude/rules/old.md"))).toBe(false);
      if (kept) expect(readFileSync(path.join(f.root, kept), "utf8")).toBe("my rule");
    }
  });
  it("converts a Shift_JIS file to UTF-8 once confirmed", async () => {
    const f = await fixture();
    put(f.root, ".claude/CLAUDE.md", "new official");
    put(f.root, "AGENTS.md", Buffer.from([0x82, 0xa0, 0x0a]));
    f.dependencies.configure = vi.fn(async (...args) => {
      if (!readFileSync(path.join(args[1], "AGENTS.md")).equals(Buffer.from("あ\n")))
        throw new NativeConfigConflict(
          conflict("AGENTS.md", "AGENTS.md is not valid UTF-8; convert its encoding before config"),
        );
      return f.configure(...args);
    });
    const { items } = await repairWorkflows(f.options, f.dependencies);
    expect(items[0]).toMatchObject({ group: "confirm", options: [{ action: "convert" }] });
    expect(items[0]?.plan).toContain("Shift_JIS");
    await repairWorkflows(f.fix({ "AGENTS.md": "convert" }), f.dependencies);
    expect(readFileSync(path.join(f.root, "AGENTS.md"), "utf8")).toBe("あ\n");
  });
  it("puts a shared file's managed block back and keeps the team's text", async () => {
    const f = await fixture();
    put(f.root, ".claude/CLAUDE.md", "new official");
    put(f.root, "AGENTS.md", "# Team\n\n<!-- BEGIN AI-DLC:claude -->\nedited\n<!-- END AI-DLC:claude -->\n");
    f.dependencies.configure = vi.fn(async (...args) => {
      const agents = readFileSync(path.join(args[1], "AGENTS.md"), "utf8");
      if (agents.includes("edited"))
        throw new NativeConfigConflict(conflict("AGENTS.md", "managed block was locally modified"));
      if (!args[5]?.previewOnly && !agents.includes("BEGIN"))
        put(args[1], "AGENTS.md", `${agents}\n${frameworkAgentsBlock}\n`);
      return f.configure(...args);
    });
    await repairWorkflows(f.fix({ "AGENTS.md": "replace" }), f.dependencies);
    expect(readFileSync(path.join(f.root, "AGENTS.md"), "utf8")).toBe(
      `# Team\n\n${frameworkAgentsBlock}\n`,
    );
  });
});

describe.each([
  {
    harness: "copilot" as const,
    files: [
      ".github/skills/aidlc/SKILL.md",
      ".github/agents/aidlc-product-agent.md",
      ".github/hooks/aidlc.json",
      "AGENTS.md",
    ],
  },
  {
    harness: "opencode" as const,
    files: [
      ".opencode/command/aidlc.md",
      ".opencode/agents/aidlc-product-agent.md",
      ".opencode/plugin/aidlc-opencode-adapter.ts",
      "AGENTS.md",
      "opencode.json",
    ],
  },
  { harness: "codex" as const, files: [".agents/skills/aidlc/SKILL.md", "AGENTS.md"] },
])("$harness repair distribution", ({ harness, files }) => {
  it.each(["prior", "target"])(
    "repairs every managed directory and root file matching the %s distribution",
    async (reference) => {
      const f = await fixture(harness, files);
      if (reference === "target") {
        for (const file of files) put(f.release, `runtime/${harness}/${file}`, "official old");
        const readInstall = f.dependencies.readInstall;
        f.dependencies.readInstall = (version) =>
          version === "2.8.0" ? null : (readInstall?.(version) ?? null);
      }
      const result = await repairWorkflows(f.fix(), f.dependencies);
      expect(result.problems).toEqual([]);
      expect(result.changed?.sort()).toEqual([...files].sort());
      for (const file of files)
        expect(readFileSync(path.join(f.root, file), "utf8")).toBe("new official");
      expect(readFileSync(path.join(f.root, ".aidlc-version"), "utf8")).toBe("2.8.0\n");
    },
  );
  it.each(["AGENTS.md", files[0] ?? ""])(
    "waits for the person on custom edits to %s and leaves other files untouched",
    async (file) => {
      const f = await fixture(harness, files);
      put(f.root, file, "user instructions");
      const result = await repairWorkflows(f.fix(), f.dependencies);
      expect(result.items.find((item) => item.path === file)?.group).toBe("confirm");
      expect(result.items.filter((item) => item.group !== "auto").map((item) => item.path)).toEqual([file]);
      expect(result.changed).toBeUndefined();
      for (const rel of files)
        expect(readFileSync(path.join(f.root, rel), "utf8")).toBe(
          rel === file ? "user instructions" : "official old",
        );
    },
  );
});

describe("AI repairs", () => {
  async function jsonFixture() {
    const f = await fixture();
    put(f.root, ".claude/CLAUDE.md", "new official");
    put(f.root, ".claude/settings.json", '{\n  "a": "x",\n}\n');
    f.dependencies.configure = vi.fn(async (...args) => {
      try {
        JSON.parse(readFileSync(path.join(args[1], ".claude/settings.json"), "utf8"));
      } catch {
        throw new NativeConfigConflict(conflict(".claude/settings.json", "malformed JSON"));
      }
      return f.configure(...args);
    });
    f.run.mockResolvedValue(
      JSON.stringify({ proceed: true, fixed: '{\n  "a": "x"\n}\n', summary: "余分なカンマを削除しました。" }),
    );
    return f;
  }
  it("asks a tool-free AI for one file only and holds the change for review", async () => {
    const f = await jsonFixture();
    const { items } = await repairWorkflows(f.options, f.dependencies);
    expect(items[0]).toMatchObject({ group: "ai", options: [{ action: "ai-json" }] });
    expect(items[0]?.plan).toContain("3 行目");
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.review).toHaveLength(1);
    expect(result.review?.[0]).toMatchObject({
      path: ".claude/settings.json",
      action: "ai-json",
      summary: "余分なカンマを削除しました。",
    });
    expect(result.review?.[0]?.checks.every((check) => check.ok)).toBe(true);
    expect(result.changed).toBeUndefined();
    expect(readFileSync(path.join(f.root, ".claude/settings.json"), "utf8")).toBe(
      '{\n  "a": "x",\n}\n',
    );
    const call = f.run.mock.calls[0]?.[0];
    expect(call.cwd).not.toBe(f.root);
    expect(call.args).toContain("--safe-mode");
    expect(call.prompt).toContain('\\"a\\": \\"x\\"');
    expect(call.prompt).not.toContain("new official");
    expect(f.cleanup).toHaveBeenCalledOnce();
  });
  it("applies an approved change without asking again and refuses one whose file changed", async () => {
    const f = await jsonFixture();
    const { review } = await repairWorkflows(f.fix(), f.dependencies);
    f.run.mockClear();
    const result = await repairWorkflows(f.fix({}, { approved: review }), f.dependencies);
    expect(f.run).not.toHaveBeenCalled();
    expect(result.problems).toEqual([]);
    expect(readFileSync(path.join(f.root, ".claude/settings.json"), "utf8")).toBe(
      '{\n  "a": "x"\n}\n',
    );
    const g = await jsonFixture();
    const held = await repairWorkflows(g.fix(), g.dependencies);
    put(g.root, ".claude/settings.json", '{\n  "a": "y",\n}\n');
    const stale = await repairWorkflows(g.fix({}, { approved: held.review }), g.dependencies);
    expect(stale.items[0]?.note).toContain("ファイルが変わりました");
  });
  it("shows the AI's reason when it declines and changes nothing", async () => {
    const f = await jsonFixture();
    f.run.mockResolvedValue(JSON.stringify({ proceed: false, summary: "壊れ方が分かりません" }));
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.items[0]?.note).toContain("壊れ方が分かりません");
    expect(result.review).toBeUndefined();
  });
  it("needs a chosen AI and reports an unavailable CLI on the file", async () => {
    const f = await jsonFixture();
    const none = await repairWorkflows({ ...f.options, fix: { choices: {} } }, f.dependencies);
    expect(none.message).toContain("AI を選んでください");
    f.dependencies.probe = vi.fn().mockResolvedValue({ available: false, detail: "CLI がありません" });
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.items[0]?.note).toBe("CLI がありません");
    expect(f.run).not.toHaveBeenCalled();
  });
  it("merges a custom edit with AI, reports its checks and re-applies it after approval", async () => {
    const f = await fixture();
    put(f.root, ".claude/CLAUDE.md", "official old\nmine");
    put(f.root, harnessVersionRel("claude"), 'export const AIDLC_VERSION = "2.7.0";');
    const readInstall = f.dependencies.readInstall;
    f.dependencies.readInstall = (version) =>
      version === "2.7.0" ? null : (readInstall?.(version) ?? null);
    f.run.mockResolvedValue(
      JSON.stringify({ proceed: true, merged: "new official\nmine", summary: "mine を残しました。" }),
    );
    const held = await repairWorkflows(f.fix({ ".claude/CLAUDE.md": "ai-merge" }), f.dependencies);
    expect(held.review?.[0]?.checks.map((check) => check.ok)).toEqual([true, true, true, true]);
    expect(held.review?.[0]?.checks[2]?.text).toContain("2 行のうち 1 行");
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("official old\nmine");
    const done = await repairWorkflows(
      f.fix({ ".claude/CLAUDE.md": "ai-merge" }, { approved: held.review }),
      f.dependencies,
    );
    expect(done.patches).toEqual([
      { path: ".claude/CLAUDE.md", officialHash: repairHash("new official"), content: "new official\nmine" },
    ]);
  });
  it("cancels provider detection before creating a scratch session or sending anything", async () => {
    const f = await jsonFixture();
    const controller = new AbortController();
    const reason = new Error("cancelled during provider detection");
    f.dependencies.probe = vi.fn(async (_tool, signal) => {
      controller.abort(reason);
      signal?.throwIfAborted();
      throw new Error("expected cancellation");
    });
    await expect(
      repairWorkflows({ ...f.fix(), signal: controller.signal }, f.dependencies),
    ).rejects.toBe(reason);
    expect(f.dependencies.scratch).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
  it("explains a file in plain words without sending its content", async () => {
    const f = await jsonFixture();
    const { items } = await repairWorkflows(f.options, f.dependencies);
    f.run.mockResolvedValue("書式が壊れているためです。AI に直してもらうのがよいでしょう。");
    const answer = await explainRepair(
      items[0]!,
      "claude",
      new AbortController().signal,
      f.dependencies,
    );
    expect(answer).toContain("書式が壊れている");
    expect(f.run.mock.calls[0]?.[0].prompt).toContain("malformed JSON");
    expect(f.run.mock.calls[0]?.[0].prompt).not.toContain('\\"a\\": \\"x\\"');
  });
});

describe("repair safety", () => {
  it("leaves a non-UTF-8 .gitignore to the person without starting AI", async () => {
    const f = await fixture();
    const bytes = Buffer.concat([
      Buffer.from("# BEGIN AIDLC CURSOR\n"),
      Buffer.from([0x82, 0xa0]),
      Buffer.from("\nsecret/\n# END AIDLC CURSOR\n"),
    ]);
    writeFileSync(path.join(f.root, ".gitignore"), bytes);
    f.dependencies.configure = vi
      .fn()
      .mockRejectedValue(
        new NativeConfigConflict(conflict(".gitignore", "legacy root integration ambiguous")),
      );
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.items[0]).toMatchObject({ group: "manual" });
    expect(result.items[0]?.plan).toContain("UTF-8");
    expect(f.run).not.toHaveBeenCalled();
    expect(readFileSync(path.join(f.root, ".gitignore"))).toEqual(bytes);
  });
  it("refuses distributions with a mismatched harness identity", async () => {
    const f = await fixture();
    for (const distribution of [f.release, f.oldRelease])
      put(
        distribution,
        "runtime/claude/.claude/tools/data/aidlc-projection.json",
        JSON.stringify({
          schemaVersion: 1,
          distribution: "copilot",
          harnessDir: ".claude",
          managedDirectories: [".claude"],
          rootIntegrations: [],
        }),
      );
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.items[0]).toMatchObject({ group: "manual" });
    expect(result.changed).toBeUndefined();
  });
  it("rejects stale snapshots after concurrent edits and releases the operation lock", async () => {
    const f = await fixture();
    f.dependencies.configure = vi.fn(async (...args) => {
      if (!args[5]?.previewOnly) put(f.root, ".claude/new-rule.md", "user writing");
      return f.configure(...args);
    });
    await expect(repairWorkflows(f.fix(), f.dependencies)).rejects.toThrow("診断後に設定が変更");
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("official old");
    expect((await repairWorkflows(f.options, f.dependencies)).problems).toHaveLength(1);
  });
  it("cancels without writes", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      repairWorkflows({ ...f.fix(), signal: controller.signal }, f.dependencies),
    ).rejects.toThrow();
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("official old");
  });
  it("keeps what is left after the official update in the copy and changes nothing", async () => {
    const f = await fixture();
    f.dependencies.configure = vi.fn(async (...args) => {
      if (!args[5]?.previewOnly)
        throw new NativeConfigConflict(conflict(".claude/x.json", "JSON root must be an object"));
      return f.configure(...args);
    });
    const result = await repairWorkflows(f.fix(), f.dependencies);
    expect(result.message).toContain("作業用コピーで直しても 1 件が残りました");
    expect(result.items[0]).toMatchObject({ path: ".claude/x.json", group: "manual" });
    expect(readFileSync(path.join(f.root, ".claude/CLAUDE.md"), "utf8")).toBe("official old");
  });
});
