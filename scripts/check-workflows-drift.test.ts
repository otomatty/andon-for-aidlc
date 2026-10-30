import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAPPED_STAGE_SLUGS } from "../packages/official-docs/src/stage-map.ts";
import {
  buildFindings,
  type DriftFinding,
  diffSlugs,
  expectedSourceVersion,
  formatDriftSection,
  LOCAL_ONLY_AGENTS,
  parseAgentsDeclaration,
  parseDataLintStageCount,
  parseReadmeDeclaration,
  parseUpstreamStateVersion,
  parseWorkspaceStateVersions,
  readUpstreamAgents,
  readUpstreamStages,
  readWorkspaceFacts,
  runCli,
  type UpstreamFacts,
  type WorkspaceFacts,
} from "./check-workflows-drift.ts";

function write(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
}

const UPSTREAM_SHELL = "dist/claude/.claude";

/** The seven slugs stage-map.ts deep-links, so a fixture never trips that finding by accident. */
const MAPPED = [...MAPPED_STAGE_SLUGS];

function seedUpstream(options?: {
  version?: string;
  stateVersion?: string;
  stages?: readonly string[];
  agents?: readonly string[];
}): string {
  const root = mkdtempSync(join(tmpdir(), "drift-upstream-"));
  write(
    root,
    `${UPSTREAM_SHELL}/tools/aidlc-version.ts`,
    `export const AIDLC_VERSION = "${options?.version ?? "2.7.0"}";\n`,
  );
  write(
    root,
    `${UPSTREAM_SHELL}/tools/aidlc-lib.ts`,
    `export const CURRENT_STATE_VERSION = "${options?.stateVersion ?? "8"}";\n`,
  );
  for (const slug of options?.stages ?? [...MAPPED, "code-generation"]) {
    write(root, `${UPSTREAM_SHELL}/aidlc-common/stages/ideation/${slug}.md`, `# ${slug}\n`);
  }
  for (const slug of options?.agents ?? ["aidlc-product-agent"]) {
    write(root, `${UPSTREAM_SHELL}/agents/${slug}.md`, `# ${slug}\n`);
  }
  return root;
}

function seedWorkspace(options?: {
  current?: number;
  supported?: readonly number[];
  stages?: readonly string[];
  agents?: readonly string[];
  sourceVersion?: string;
  dataLintCount?: number;
  agentsVersion?: string;
  readmeVersion?: string;
  /** Write no README at all, so the missing-declaration path can be exercised. */
  omitReadme?: boolean;
}): string {
  const root = mkdtempSync(join(tmpdir(), "drift-workspace-"));
  write(
    root,
    "packages/shared-types/src/index.ts",
    [
      `export const CURRENT_STATE_VERSION = ${options?.current ?? 8};`,
      `export const SUPPORTED_STATE_VERSIONS = [${(options?.supported ?? [7, 8]).join(", ")}] as const;`,
      "",
    ].join("\n"),
  );
  const sourceVersion = options?.sourceVersion ?? "aidlc 2.7.0 (State Version 8)";
  const stages = Object.fromEntries(
    (options?.stages ?? [...MAPPED, "code-generation"]).map((slug) => [slug, { purpose: slug }]),
  );
  const agents = Object.fromEntries(
    (options?.agents ?? ["orchestrator", "aidlc-product-agent"]).map((slug) => [
      slug,
      { displayName: slug },
    ]),
  );
  write(
    root,
    "packages/docs-bridge/data/bridge-map.json",
    `${JSON.stringify({ sourceVersion, stages, terms: {} }, null, 2)}\n`,
  );
  write(
    root,
    "packages/docs-bridge/data/agent-map.json",
    `${JSON.stringify({ sourceVersion, agents }, null, 2)}\n`,
  );
  write(
    root,
    "AGENTS.md",
    "This project uses **AI-DLC Workflows " +
      (options?.agentsVersion ?? "2.7.0") +
      "** (State Version **8**, " +
      String(MAPPED.length + 1) +
      " stages) in lockstep.\n",
  );
  if (options?.omitReadme !== true) {
    write(
      root,
      "README.md",
      `**対応 aidlc-workflows バージョン: ${options?.readmeVersion ?? "2.7.0"}**（State Version **8** / **${MAPPED.length + 1}** ステージ）\n`,
    );
  }
  write(
    root,
    "packages/docs-bridge/tests/data-lint.test.ts",
    `expect(stageEntries).toHaveLength(${options?.dataLintCount ?? MAPPED.length + 1});\n`,
  );
  return root;
}

const UPSTREAM: UpstreamFacts = {
  version: "2.7.0",
  stateVersion: 8,
  stages: ["intent-capture", "code-generation"],
  agents: ["aidlc-product-agent"],
};

const WORKSPACE: WorkspaceFacts = {
  currentStateVersion: 8,
  supportedStateVersions: [7, 8],
  bridgeStages: ["intent-capture", "code-generation"],
  bridgeSourceVersion: "aidlc 2.7.0 (State Version 8)",
  agents: ["orchestrator", "aidlc-product-agent"],
  agentSourceVersion: "aidlc 2.7.0 (State Version 8)",
  mappedStageSlugs: ["intent-capture"],
  dataLintStageCount: 2,
  agentsDeclaration: { version: "2.7.0", stateVersion: 8, stages: 2 },
  readmeDeclaration: {
    declared: true,
    version: "2.7.0",
    stateVersion: 8,
    stages: 2,
    otherVersions: [],
  },
};

function ids(findings: readonly DriftFinding[]): string[] {
  return findings.map((finding) => finding.id);
}

describe("native installation and Doctor compatibility", () => {
  const upstream = { ...UPSTREAM, version: "2.8.2" };
  const workspace = {
    ...WORKSPACE,
    installTargetVersion: "2.8.2",
    doctorSupportedVersions: ["2.8.0", "2.8.1", "2.8.2"],
  };

  it("detects the previous 2.8.1 installer and Doctor even when State Version is supported", () => {
    const findings = buildFindings(upstream, {
      ...workspace,
      installTargetVersion: "2.8.1",
      doctorSupportedVersions: ["2.8.0", "2.8.1"],
    });
    expect(ids(findings)).toEqual(
      expect.arrayContaining(["install-target-stale", "doctor-version-unsupported"]),
    );
    expect(ids(findings)).not.toContain("state-version-unsupported");
  });
  it.each(["2.8.2", "2.8.3"])(
    "accepts a tested stable target %s covering the docs pin",
    (target) => {
      const found = ids(
        buildFindings(upstream, {
          ...workspace,
          installTargetVersion: target,
          doctorSupportedVersions: [...workspace.doctorSupportedVersions, target],
        }),
      );
      expect(found).not.toContain("install-target-stale");
      expect(found).not.toContain("doctor-version-unsupported");
    },
  );
  it.each([null, "bad", "2.8.3-preview.20260914.1"])(
    "reports an absent, invalid or preview installation target: %s",
    (target) => {
      expect(
        ids(buildFindings(upstream, { ...workspace, installTargetVersion: target })),
      ).toContain("install-target-stale");
    },
  );
  it("checks Doctor support for the installed target too", () => {
    expect(ids(buildFindings(upstream, { ...workspace, installTargetVersion: "2.8.3" }))).toContain(
      "doctor-version-unsupported",
    );
  });
  it("reads the actual target and Doctor declarations, and reports missing declarations", () => {
    const root = seedWorkspace();
    const empty = readWorkspaceFacts(root);
    expect(empty.installTargetVersion).toBeNull();
    expect(empty.doctorSupportedVersions).toEqual([]);
    write(
      root,
      "packages/shared-types/src/workflows-management.ts",
      'export const WORKFLOWS_TARGET_VERSION = "2.8.2";\n',
    );
    write(
      root,
      "packages/vscode-extension/data/doctor-compatibility.json",
      JSON.stringify({ schemaVersion: 1, releases: { "2.8.1": {}, "2.8.2": {} } }),
    );
    expect(readWorkspaceFacts(root)).toMatchObject({
      installTargetVersion: "2.8.2",
      doctorSupportedVersions: ["2.8.1", "2.8.2"],
    });
    write(
      root,
      "packages/shared-types/src/workflows-management.ts",
      "export const WORKFLOWS_TARGET_VERSION = compute();\n",
    );
    write(root, "packages/vscode-extension/data/doctor-compatibility.json", "invalid json");
    expect(readWorkspaceFacts(root)).toMatchObject({
      installTargetVersion: null,
      doctorSupportedVersions: [],
    });
  });
});

describe("parsers", () => {
  it("reads upstream's string-literal CURRENT_STATE_VERSION", () => {
    expect(parseUpstreamStateVersion('export const CURRENT_STATE_VERSION = "9";')).toBe(9);
    expect(parseUpstreamStateVersion("export const CURRENT_STATE_VERSION = '10'")).toBe(10);
  });

  it("returns null when upstream's constant is absent or not a number", () => {
    expect(parseUpstreamStateVersion("nothing here")).toBeNull();
    expect(parseUpstreamStateVersion('export const CURRENT_STATE_VERSION = "eight";')).toBeNull();
  });

  it("reads this repository's numeric constants", () => {
    const parsed = parseWorkspaceStateVersions(
      [
        "export const CURRENT_STATE_VERSION = 8;",
        "export const SUPPORTED_STATE_VERSIONS = [8, 7] as const;",
      ].join("\n"),
    );
    expect(parsed).toEqual({ current: 8, supported: [7, 8] });
  });

  it("returns null when either constant is missing, empty or malformed", () => {
    expect(parseWorkspaceStateVersions("export const CURRENT_STATE_VERSION = 8;")).toBeNull();
    expect(
      parseWorkspaceStateVersions(
        "export const CURRENT_STATE_VERSION = 8;\nexport const SUPPORTED_STATE_VERSIONS = [] as const;",
      ),
    ).toBeNull();
    expect(
      parseWorkspaceStateVersions(
        "export const CURRENT_STATE_VERSION = 8;\nexport const SUPPORTED_STATE_VERSIONS = [7, x] as const;",
      ),
    ).toBeNull();
  });

  it("reads the pinned stage count out of the data-lint suite", () => {
    expect(parseDataLintStageCount("expect(stageEntries).toHaveLength(33);")).toBe(33);
    expect(parseDataLintStageCount("expect(termEntries).toHaveLength(11);")).toBeNull();
  });

  it("builds the sourceVersion string both maps carry", () => {
    expect(expectedSourceVersion("2.7.0", 8)).toBe("aidlc 2.7.0 (State Version 8)");
  });
});

describe("upstream readers", () => {
  it("collects stage slugs across phase directories and agent slugs", () => {
    const upstream = seedUpstream({ stages: ["intent-capture"], agents: ["aidlc-quality-agent"] });
    write(upstream, `${UPSTREAM_SHELL}/aidlc-common/stages/construction/code-generation.md`, "#\n");
    // Not a stage file, and a directory entry that is not a phase directory.
    write(upstream, `${UPSTREAM_SHELL}/aidlc-common/stages/ideation/notes.txt`, "x");
    write(upstream, `${UPSTREAM_SHELL}/aidlc-common/stages/README.md`, "x");
    expect(readUpstreamStages(upstream)).toEqual(["code-generation", "intent-capture"]);
    expect(readUpstreamAgents(upstream)).toEqual(["aidlc-quality-agent"]);
  });

  it("returns empty lists when the directories are absent", () => {
    const empty = mkdtempSync(join(tmpdir(), "drift-empty-"));
    expect(readUpstreamStages(empty)).toEqual([]);
    expect(readUpstreamAgents(empty)).toEqual([]);
  });
});

describe("diffSlugs", () => {
  it("splits upstream-only from workspace-only", () => {
    expect(diffSlugs(["a", "b"], ["b", "c"])).toEqual({ added: ["a"], removed: ["c"] });
  });

  it("never reports a locally owned slug as removed upstream", () => {
    expect(diffSlugs(["a"], ["a", "orchestrator"], LOCAL_ONLY_AGENTS)).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe("buildFindings", () => {
  it("finds nothing when the workspace already matches the pin", () => {
    expect(buildFindings(UPSTREAM, WORKSPACE)).toEqual([]);
  });

  it("flags an unsupported State Version as blocking", () => {
    const findings = buildFindings({ ...UPSTREAM, stateVersion: 9 }, WORKSPACE);
    const blocking = findings.filter((finding) => finding.severity === "blocking");
    expect(ids(blocking)).toEqual(["state-version-unsupported"]);
  });

  it("flags a supported-but-behind CURRENT_STATE_VERSION as advisory only", () => {
    const findings = buildFindings(
      { ...UPSTREAM, stateVersion: 9 },
      { ...WORKSPACE, supportedStateVersions: [7, 8, 9] },
    );
    expect(ids(findings)).toContain("state-version-not-current");
    expect(findings.every((finding) => finding.severity === "advisory")).toBe(true);
  });

  it("reports stages upstream added and removed, and the pinned count", () => {
    const findings = buildFindings(
      { ...UPSTREAM, stages: ["intent-capture", "test-design", "test-review"] },
      WORKSPACE,
    );
    expect(ids(findings)).toEqual(
      expect.arrayContaining(["stages-added", "stages-removed", "data-lint-stage-count"]),
    );
    const added = findings.find((finding) => finding.id === "stages-added");
    expect(added?.detail).toContain("test-design");
  });

  it("leaves the pinned count alone when a rename keeps it correct", () => {
    const findings = buildFindings(
      { ...UPSTREAM, stages: ["intent-capture", "test-design"] },
      { ...WORKSPACE, dataLintStageCount: 2 },
    );
    expect(ids(findings)).not.toContain("data-lint-stage-count");
  });

  it("skips the count finding when the assertion could not be read", () => {
    const findings = buildFindings(
      { ...UPSTREAM, stages: ["intent-capture"] },
      { ...WORKSPACE, dataLintStageCount: null },
    );
    expect(ids(findings)).not.toContain("data-lint-stage-count");
  });

  it("reports agents upstream added and removed", () => {
    const findings = buildFindings(
      { ...UPSTREAM, agents: ["aidlc-product-agent", "aidlc-test-agent"] },
      { ...WORKSPACE, agents: ["orchestrator", "aidlc-product-agent", "aidlc-gone-agent"] },
    );
    expect(ids(findings)).toEqual(expect.arrayContaining(["agents-added", "agents-removed"]));
    const removed = findings.find((finding) => finding.id === "agents-removed");
    expect(removed?.detail).toContain("aidlc-gone-agent");
    expect(removed?.detail).not.toContain("orchestrator");
  });

  it("reports a stage-map slug upstream no longer ships", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      mappedStageSlugs: ["intent-capture", "retired-stage"],
    });
    const finding = findings.find((item) => item.id === "stage-map-unknown");
    expect(finding?.detail).toContain("retired-stage");
  });

  it("reports a stale sourceVersion on either map", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      agentSourceVersion: "aidlc 2.6.124 (State Version 8)",
    });
    const finding = findings.find((item) => item.id === "source-version-stale");
    expect(finding?.detail).toContain("2.6.124");
    expect(finding?.detail).toContain("aidlc 2.7.0 (State Version 8)");
  });
});

describe("formatDriftSection", () => {
  it("says so plainly when there is no drift", () => {
    const body = formatDriftSection({ upstream: UPSTREAM, workspace: WORKSPACE, findings: [] });
    expect(body).toContain("差分なし");
    expect(body).toContain("| AIDLC_VERSION | 2.7.0 |");
    expect(body).toContain("`orchestrator`");
  });

  it("leads with a caution block when a blocking finding is present", () => {
    const findings = buildFindings({ ...UPSTREAM, stateVersion: 9 }, WORKSPACE);
    const body = formatDriftSection({
      upstream: { ...UPSTREAM, stateVersion: 9 },
      workspace: WORKSPACE,
      findings,
    });
    expect(body).toContain("[!CAUTION]");
    expect(body).toContain("release:skip");
    expect(body).toContain("**BLOCKING**");
  });

  it("fences a stage slug containing a backtick so it cannot escape the code span", () => {
    // Slugs are upstream filenames, and a backtick is legal in one. With a bare
    // backtick pair the span closes at the embedded one and the tail renders as
    // Markdown in the PR body that carries the checklist.
    const evil = "a`b**bold**c";
    const upstream = { ...UPSTREAM, stages: [...UPSTREAM.stages, evil] };
    const body = formatDriftSection({
      upstream,
      workspace: WORKSPACE,
      findings: buildFindings(upstream, WORKSPACE),
    });
    expect(body).toContain(`\`\`${evil}\`\``);
    expect(body).not.toContain("**bold**`");
  });
});

describe("runCli", () => {
  it("reports a clean pin and writes the markdown section", () => {
    const upstream = seedUpstream();
    const workspace = seedWorkspace();
    const out = join(mkdtempSync(join(tmpdir(), "drift-out-")), "drift.md");
    const result = runCli(["--upstream", upstream, "--workspace", workspace, "--out", out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("upstream_version=2.7.0");
    expect(result.stdout).toContain("state_version_supported=true");
    expect(result.stdout).toContain("drift=false");
    expect(result.stdout).toContain("finding_ids=\n");
    expect(readFileSync(out, "utf8")).toContain("差分なし");
  });

  it("marks an unsupported State Version in the machine-readable output", () => {
    const upstream = seedUpstream({ stateVersion: "9" });
    const workspace = seedWorkspace();
    const result = runCli(["--upstream", upstream, "--workspace", workspace]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("state_version_supported=false");
    expect(result.stdout).toContain("blocking=1");
    expect(result.stdout).toContain("finding_ids=state-version-unsupported");
  });

  it("refuses a checkout that is not an aidlc-workflows tree", () => {
    const upstream = mkdtempSync(join(tmpdir(), "drift-bad-"));
    const workspace = seedWorkspace();
    const result = runCli(["--upstream", upstream, "--workspace", workspace]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("aidlc-version.ts");
  });

  it("refuses a checkout with no stage files", () => {
    // A fresh root that has the two tool files but nothing else.
    const bare = mkdtempSync(join(tmpdir(), "drift-bare-"));
    write(
      bare,
      `${UPSTREAM_SHELL}/tools/aidlc-version.ts`,
      'export const AIDLC_VERSION = "2.7.0";',
    );
    write(
      bare,
      `${UPSTREAM_SHELL}/tools/aidlc-lib.ts`,
      'export const CURRENT_STATE_VERSION = "8";',
    );
    expect(runCli(["--upstream", bare, "--workspace", seedWorkspace()]).stderr).toContain(
      "no stage files",
    );
    // …and with stages but no agents.
    write(bare, `${UPSTREAM_SHELL}/aidlc-common/stages/ideation/intent-capture.md`, "#\n");
    expect(runCli(["--upstream", bare, "--workspace", seedWorkspace()]).stderr).toContain(
      "no agent files",
    );
  });

  it("prints usage when --upstream is missing or takes no value", () => {
    expect(runCli([]).status).toBe(1);
    expect(runCli([]).stderr).toContain("Usage:");
    expect(runCli(["--upstream", "--out"]).stderr).toContain("Usage:");
  });
});

describe("parseAgentsDeclaration", () => {
  const line =
    "This project uses **AI-DLC Workflows 2.6.124** (State Version **8**, 33 stages) in lockstep.";

  it("reads the version, State Version and stage count out of the prose", () => {
    expect(parseAgentsDeclaration(line)).toEqual({
      version: "2.6.124",
      stateVersion: 8,
      stages: 33,
    });
  });

  it("reads each fact independently, so a reworded paragraph still checks", () => {
    expect(parseAgentsDeclaration("AI-DLC Workflows 2.7.0 ships 34 stages.")).toEqual({
      version: "2.7.0",
      stateVersion: null,
      stages: 34,
    });
  });

  it("declares nothing for a file that says nothing", () => {
    expect(parseAgentsDeclaration("# Some other document\n")).toEqual({
      version: null,
      stateVersion: null,
      stages: null,
    });
  });
});

describe("parseReadmeDeclaration", () => {
  const readme = [
    "# Andon",
    "",
    "aidlc-workflows 2.7.0（State Version **8** / 33 ステージ）のためのツールです。",
    "",
    "**対応 aidlc-workflows バージョン: 2.7.0**（State Version **8** / **33** ステージ）",
    "",
    "- 対象ワークスペースに aidlc-workflows **2.7.0**（State Version **8**）。State Version **7** は閲覧互換",
    "",
  ].join("\n");

  it("reads all three facts off the declaration line", () => {
    expect(parseReadmeDeclaration(readme)).toMatchObject({
      declared: true,
      version: "2.7.0",
      stateVersion: 8,
      stages: 33,
    });
  });

  it("takes the State Version from the declaration line, not the read-compatible one", () => {
    // The prerequisites legitimately name State Version 7 as readable. Scanning
    // the whole file would report that as a stale pin.
    expect(parseReadmeDeclaration(readme).stateVersion).toBe(8);
  });

  it("collects every version mentioned outside the declaration line", () => {
    // Not filtered against the declaration: the caller compares them to
    // upstream, so a declaration stating no version still yields the mentions.
    expect(parseReadmeDeclaration(readme).otherVersions).toEqual(["2.7.0"]);
    const stale = readme.replace(
      "aidlc-workflows 2.7.0（State Version **8** / 33 ステージ）のため",
      "aidlc-workflows 2.6.2（State Version **8** / 33 ステージ）のため",
    );
    expect(parseReadmeDeclaration(stale).otherVersions).toEqual(["2.6.2", "2.7.0"]);
  });

  it("reads an incomplete declaration as declared-but-blank, not as absent", () => {
    const partial = "**対応 aidlc-workflows バージョン: 2.7.0**（ピンと同期）\n";
    expect(parseReadmeDeclaration(partial)).toEqual({
      declared: true,
      version: "2.7.0",
      stateVersion: null,
      stages: null,
      otherVersions: [],
    });
  });

  it("does not mistake prose about the declaration for the declaration", () => {
    // The README documents this very check in a table row that names the
    // phrase and carries no version. Read as the declaration, it turned a
    // deleted declaration into a bogus "stale pin" finding.
    const prose = [
      "# Andon",
      "",
      "| `README.md` 冒頭の「対応 aidlc-workflows バージョン」行 | 何が古くなるか |",
      "",
    ].join("\n");
    expect(parseReadmeDeclaration(prose).declared).toBe(false);
  });

  it("reports a file with no declaration rather than reading nothing into it", () => {
    expect(parseReadmeDeclaration("# Some other document\n")).toEqual({
      declared: false,
      version: null,
      stateVersion: null,
      stages: null,
      otherVersions: [],
    });
  });

  it("does not leak the /g regex lastIndex between calls", () => {
    const first = parseReadmeDeclaration(readme);
    expect(parseReadmeDeclaration(readme)).toEqual(first);
  });
});

describe("buildFindings — README.md", () => {
  it("flags each declared fact that upstream has moved past", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      readmeDeclaration: {
        declared: true,
        version: "2.6.2",
        stateVersion: 7,
        stages: 33,
        otherVersions: [],
      },
    });
    const finding = findings.find((item) => item.id === "readme-stale");
    expect(finding?.detail).toContain("バージョン 2.6.2 → 2.7.0");
    expect(finding?.detail).toContain("State Version 7 → 8");
    expect(finding?.detail).toContain("ステージ数 33 → 2");
    expect(finding?.action).toContain("README.md");
  });

  it("flags a stale mention outside the declaration even when the declaration is current", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      readmeDeclaration: { ...WORKSPACE.readmeDeclaration, otherVersions: ["2.6.2"] },
    });
    expect(findings.find((item) => item.id === "readme-stale")?.detail).toContain("2.6.2");
  });

  it("accepts mentions outside the declaration that already name upstream's version", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      readmeDeclaration: { ...WORKSPACE.readmeDeclaration, otherVersions: [UPSTREAM.version] },
    });
    expect(ids(findings)).not.toContain("readme-stale");
  });

  it("flags a declaration that states a fact nowhere, not just one that states it wrong", () => {
    // The line still reads as a declaration to a human, so `declared` is true
    // and the missing-declaration finding does not fire. Left unreported, a
    // reword that drops the numbers switches this check off silently.
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      readmeDeclaration: {
        declared: true,
        version: null,
        stateVersion: null,
        stages: null,
        otherVersions: [],
      },
    });
    const finding = findings.find((item) => item.id === "readme-stale");
    expect(finding?.detail).toContain("宣言行にバージョンの記載が無い");
    expect(finding?.detail).toContain("宣言行に State Version の記載が無い");
    expect(finding?.detail).toContain("宣言行にステージ数の記載が無い");
  });

  it("flags a partially complete declaration on the facts it omits", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      readmeDeclaration: {
        declared: true,
        version: UPSTREAM.version,
        stateVersion: null,
        stages: null,
        otherVersions: [],
      },
    });
    const finding = findings.find((item) => item.id === "readme-stale");
    expect(finding?.detail).toContain("宣言行に State Version の記載が無い");
    expect(finding?.detail).toContain("宣言行にステージ数の記載が無い");
    expect(finding?.detail).not.toContain("バージョンの記載が無い（");
  });

  it("reports a missing declaration, so a reworded README cannot switch the check off", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      readmeDeclaration: {
        declared: false,
        version: null,
        stateVersion: null,
        stages: null,
        otherVersions: [],
      },
    });
    const finding = findings.find((item) => item.id === "readme-declaration-missing");
    // The action has to carry the line to restore, version and all.
    expect(finding?.action).toContain("2.7.0");
    expect(ids(findings)).not.toContain("readme-stale");
  });

  it("says nothing when the declaration already matches", () => {
    expect(ids(buildFindings(UPSTREAM, WORKSPACE))).not.toContain("readme-stale");
    expect(ids(buildFindings(UPSTREAM, WORKSPACE))).not.toContain("readme-declaration-missing");
  });
});

describe("buildFindings — AGENTS.md", () => {
  it("flags each declared fact that upstream has moved past", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      agentsDeclaration: { version: "2.6.124", stateVersion: 7, stages: 33 },
    });
    const finding = findings.find((item) => item.id === "agents-md-stale");
    expect(finding?.detail).toContain("2.6.124 → 2.7.0");
    expect(finding?.detail).toContain("State Version 7 → 8");
    expect(finding?.detail).toContain("ステージ数 33 → 2");
    // Repo-authored, so the shell mirror cannot fix it — the action has to say so.
    expect(finding?.action).toContain("AGENTS.md");
  });

  it("says nothing when the declaration already matches", () => {
    expect(ids(buildFindings(UPSTREAM, WORKSPACE))).not.toContain("agents-md-stale");
  });

  it("does not invent a finding for a fact the file never declares", () => {
    const findings = buildFindings(UPSTREAM, {
      ...WORKSPACE,
      agentsDeclaration: { version: null, stateVersion: null, stages: null },
    });
    expect(ids(findings)).not.toContain("agents-md-stale");
  });
});
