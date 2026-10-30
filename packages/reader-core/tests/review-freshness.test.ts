import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReviewFreshnessReader,
  currentReviewArtifactFingerprint,
  type ReviewArtifactStage,
} from "../src/tree/review-freshness.ts";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, open: vi.fn(actual.open) };
});

const STAGE: ReviewArtifactStage = {
  slug: "functional-design",
  phase: "construction",
  for_each: "unit-of-work",
  produces: ["traceability", "design"],
  optional_produces: ["optional"],
  review_artifact: "design",
};
// Fixed v2.8.2 manifest vectors, independently serialized from its wire contract.
const ARTIFACT = "sha256:b2ceba4d1c1a0386b4d142acc75b8c69c41528196e8de4373c1137549cdfc898";
const SOURCE = "b5b6888d58124a1c833e56fd8bb8947100d139cff78fa7fa1070ed68c7db21e6";
const UNIT_SOURCE = "sha256:034ea79cb458cb30b07539a413fd36afef9505f51a8cf303b79297472075ff98";
const MANIFEST =
  '{"stage":"code-generation","unit":"unit-alpha","version":1,"writes":[{"path":"app.ts"}]}';
let root: string;
let record: string;
let stage: ReviewArtifactStage;

async function write(relative: string, body: string | Buffer) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}
const recordPath = (relative: string) => path.relative(root, path.join(record, relative));
const artifactPath = (name: string) => recordPath(`construction/unit-alpha/${stage.slug}/${name}`);
async function graph() {
  await write(".claude/tools/data/harness.json", '{"name":"claude"}');
  await write(".claude/tools/data/stage-graph.json", JSON.stringify([stage]));
}
async function fields() {
  return {
    Stage: stage.slug,
    Unit: "unit-alpha",
    "Artifact Fingerprint": (await currentReviewArtifactFingerprint(
      record,
      stage,
      "unit-alpha",
    )) as string,
  };
}
async function sourceFixture() {
  stage = { ...STAGE, slug: "code-generation", workspace_requires: true };
  await graph();
  await write(artifactPath("design.md"), "# Design\n");
  await write(artifactPath("source-manifest.json"), MANIFEST);
  await write("app.ts", "export const answer = 42;\n");
  return {
    ...(await fields()),
    "Source Fingerprint": SOURCE,
    "Unit Source Fingerprint": UNIT_SOURCE,
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "aidlc-freshness-"));
  record = path.join(root, "aidlc/spaces/default/intents/example");
  stage = { ...STAGE };
  await write(recordPath("aidlc-state.md"), "- **Change Control**: strict (set by you)\n");
  await write(artifactPath("design.md"), "# Design\n");
  await graph();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("current review artifact identity", () => {
  it("matches the fixed sorted-path vector, including missing optional and traceability JSON", async () => {
    expect(await currentReviewArtifactFingerprint(record, stage, "unit-alpha")).toBe(ARTIFACT);
    const isCurrent = await createReviewFreshnessReader(record);
    expect(
      await isCurrent({ Stage: stage.slug, Unit: "unit-alpha", "Artifact Fingerprint": ARTIFACT }),
    ).toBe(true);
  });

  it.each(["design.md", "traceability.json", "optional.md"])(
    "invalidates a receipt when %s is changed or created",
    async (name) => {
      const receipt = await fields();
      await write(artifactPath(name), "changed\n");
      expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
    },
  );

  it("invalidates deleted artifacts and ignores undeclared diaries or another unit", async () => {
    const receipt = await fields();
    await write(artifactPath("memory.md"), "unrelated diary");
    await write(recordPath(`construction/unit-beta/${stage.slug}/design.md`), "other unit");
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(true);
    await rm(path.join(root, artifactPath("design.md")));
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
  });

  it("uses the test-results filename exception", async () => {
    stage = {
      ...stage,
      produces: ["build-test-results"],
      optional_produces: [],
      review_artifact: "build-test-results",
    };
    await write(artifactPath("test-results.md"), "passed");
    const first = await currentReviewArtifactFingerprint(record, stage, "unit-alpha");
    expect(first).toMatch(/^sha256:/);
    await write(artifactPath("build-test-results.md"), "not the declared path");
    expect(await currentReviewArtifactFingerprint(record, stage, "unit-alpha")).toBe(first);
    await write(artifactPath("test-results.md"), "failed");
    expect(await currentReviewArtifactFingerprint(record, stage, "unit-alpha")).not.toBe(first);
  });

  it.each([
    ["bare", "unit-alpha", "ui", "[unit-beta]"],
    ["double quoted", '"unit-alpha"', '"ui"', '["unit-beta"]'],
    ["single quoted", "'unit-alpha'", "'ui'", "['unit-beta']"],
    ["block dependencies", '"unit-alpha"', "'ui'", '\n      - "unit-beta"'],
    ["scalar dependency", "'unit-alpha'", '"ui"', "'unit-beta'"],
    ["inline comment", '"unit-alpha"', '"ui"', '["unit-beta"] # dependency'],
  ])(
    "resolves %s authored unit kinds ahead of a stale runtime cache",
    async (_, name, kind, deps) => {
      stage = { ...stage, produces_kinds: { traceability: ["service"], optional: ["service"] } };
      await graph();
      await write(
        recordPath("inception/units-generation/unit-of-work-dependency.md"),
        `\`\`\`yaml\nunits:\n  - name: 'unit-beta'\n    kind: "service"\n    depends_on: []\n  - name: ${name}\n    kind: ${kind}\n    depends_on: ${deps}\n\`\`\`\n`,
      );
      await write(
        recordPath("runtime-graph.json"),
        JSON.stringify({
          bolt_dag: { units: [{ name: "unit-alpha", kind: "service" }], batches: [["unit-alpha"]] },
        }),
      );
      const fingerprint = await currentReviewArtifactFingerprint(record, stage, "unit-alpha", "ui");
      expect(
        await (await createReviewFreshnessReader(record))({
          Stage: stage.slug,
          Unit: "unit-alpha",
          "Artifact Fingerprint": fingerprint as string,
        }),
      ).toBe(true);
      await write(artifactPath("design.md"), "changed\n");
      expect(
        await (await createReviewFreshnessReader(record))({
          Stage: stage.slug,
          Unit: "unit-alpha",
          "Artifact Fingerprint": fingerprint as string,
        }),
      ).toBe(false);
    },
  );

  it.each([
    ["unmatched name quote", '  - name: "unit-alpha\n    kind: ui'],
    ["mismatched kind quotes", "  - name: unit-alpha\n    kind: \"ui'"],
    ["unknown quoted kind", '  - name: unit-alpha\n    kind: "unknown"'],
    ["escaping quoted name", '  - name: "../unit-alpha"\n    kind: ui'],
    ["unmatched dependency quote", '  - name: unit-alpha\n    depends_on: ["unit-beta]'],
    ["unknown quoted dependency", '  - name: unit-alpha\n    depends_on: ["unit-beta"]'],
    ["quoted self dependency", '  - name: unit-alpha\n    depends_on: ["unit-alpha"]'],
    ["duplicate quoted name", '  - name: unit-alpha\n  - name: "unit-alpha"'],
    [
      "quoted dependency cycle",
      '  - name: "unit-alpha"\n    depends_on: ["unit-beta"]\n  - name: "unit-beta"\n    depends_on:\n      - \'unit-alpha\'',
    ],
  ])("rejects a DAG with %s without falling back to its runtime cache", async (_, units) => {
    stage = { ...stage, produces_kinds: { traceability: ["service"], optional: ["service"] } };
    await graph();
    await write(
      recordPath("inception/units-generation/unit-of-work-dependency.md"),
      `\`\`\`yaml\nunits:\n${units}\n\`\`\`\n`,
    );
    await write(
      recordPath("runtime-graph.json"),
      JSON.stringify({
        bolt_dag: { units: [{ name: "unit-alpha", kind: "ui" }], batches: [["unit-alpha"]] },
      }),
    );
    const fingerprint = await currentReviewArtifactFingerprint(record, stage, "unit-alpha", "ui");
    expect(
      await (await createReviewFreshnessReader(record))({
        Stage: stage.slug,
        Unit: "unit-alpha",
        "Artifact Fingerprint": fingerprint as string,
      }),
    ).toBe(false);
  });

  it("compares only fingerprint declarations across harnesses", async () => {
    await write(
      ".cursor/tools/data/stage-graph.json",
      JSON.stringify([{ ...stage, rules_in_context: [{ path: ".cursor/rules/x" }] }]),
    );
    expect(await (await createReviewFreshnessReader(record))(await fields())).toBe(true);
    await write(
      ".cursor/tools/data/stage-graph.json",
      JSON.stringify([{ ...stage, produces: ["design"] }]),
    );
    expect(await (await createReviewFreshnessReader(record))(await fields())).toBe(false);
  });

  it("rejects escaping names, linked artifacts and reads beyond the file budget", async () => {
    expect(await currentReviewArtifactFingerprint(record, stage, "../unit-alpha")).toBeNull();
    expect(
      await currentReviewArtifactFingerprint(
        record,
        { ...stage, produces: ["../design"] },
        "unit-alpha",
      ),
    ).toBeNull();
    const target = path.join(root, artifactPath("design.md"));
    await link(target, path.join(root, "hardlink.md"));
    expect(await currentReviewArtifactFingerprint(record, stage, "unit-alpha")).toBeNull();
    await rm(path.join(root, "hardlink.md"));
    await writeFile(target, Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(await currentReviewArtifactFingerprint(record, stage, "unit-alpha")).toBeNull();
  });

  it("rejects a symlinked artifact directory without following it", async () => {
    await mkdir(path.join(root, "outside"));
    const unit = path.join(record, "construction/unit-alpha");
    await rm(unit, { recursive: true });
    await symlink(path.join(root, "outside"), unit, "junction");
    expect(await currentReviewArtifactFingerprint(record, stage, "unit-alpha")).toBeNull();
  });
});

describe("Guard Policy resolution, including legacy Change Control", () => {
  it.each(["relaxed", "off"])("accepts v2.10 %s but respects strict memory", async (value) => {
    await write(recordPath("aidlc-state.md"), `- **Guard Policy**: ${value}\n`);
    expect(await (await createReviewFreshnessReader(record))({})).toBe(true);
    await write("aidlc/spaces/default/memory/team.md", "## Guard Policy\n- **Mode**:\n  strict\n");
    expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
  });
  it.each(["strict", "invalid"])("treats conflicting legacy %s as strict", async (legacy) => {
    await write(recordPath("aidlc-state.md"), `- **Guard Policy**: off\n- **Change Control**: ${legacy}\n`);
    expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
  });
  it("prefers a modern memory declaration over a retired heading in the same file", async () => {
    await write(recordPath("aidlc-state.md"), "- **Guard Policy**: off\n- **Change Control**: off\n");
    await write("aidlc/spaces/default/memory/team.md", "## Guard Policy\nMode: off\n## Change Control\nMode: strict\n");
    expect(await (await createReviewFreshnessReader(record))({})).toBe(true);
  });
  it("recognizes a code-formatted strict memory value", async () => {
    await write(recordPath("aidlc-state.md"), "- **Guard Policy**: off\n");
    await write("aidlc/spaces/default/memory/team.md", "## Guard Policy\nMode: "+String.fromCharCode(96)+"strict"+String.fromCharCode(96)+"\n");
    expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
  });

  it.each([
    ["relaxed", "relaxed"],
    ["off", "off"],
  ])(
    "lets the narrowest memory %s replace a scope-derived state value (v2.11)",
    async (_, memory) => {
      await write(recordPath("aidlc-state.md"), "- **Guard Policy**: strict (from scope enterprise)\n");
      const reader = await createReviewFreshnessReader(record);
      expect(reader.acceptsChanges).toBe(false);
      expect(await reader({})).toBe(false);
      await write("aidlc/spaces/default/memory/project.md", `## Guard Policy\nMode: ${memory}\n`);
      const relaxed = await createReviewFreshnessReader(record);
      expect(relaxed.acceptsChanges).toBe(true);
      expect(await relaxed({})).toBe(true);
    },
  );

  it.each([
    ["an unset state line", "- **Scope**: classic\n", true],
    ["a bare scope label", "- **Guard Policy**: strict (scope enterprise)\n", true],
    ["the person's own switch", "- **Guard Policy**: strict (set by you)\n", false],
    ["an unlabelled state value", "- **Guard Policy**: strict\n", false],
    ["a command's switch", "- **Guard Policy**: strict (set by a command)\n", false],
    ["a memory-sourced label", "- **Guard Policy**: strict (from project.md)\n", false],
    [
      "conflicting state lines",
      "- **Guard Policy**: strict (from scope enterprise)\n- **Change Control**: relaxed\n",
      false,
    ],
  ])("applies memory relaxed over %s only as upstream does", async (_, state, expected) => {
    await write(recordPath("aidlc-state.md"), state);
    await write("aidlc/spaces/default/memory/team.md", "## Guard Policy\nMode: relaxed\n");
    const reader = await createReviewFreshnessReader(record);
    expect(reader.acceptsChanges).toBe(expected);
    expect(await reader({})).toBe(expected);
  });

  it("keeps strict when any memory layer declares strict, whichever layer is narrower", async () => {
    await write(recordPath("aidlc-state.md"), "- **Guard Policy**: off (from scope classic)\n");
    await write("aidlc/spaces/default/memory/org.md", "## Guard Policy\nMode: strict\n");
    await write("aidlc/spaces/default/memory/project.md", "## Guard Policy\nMode: off\n");
    expect((await createReviewFreshnessReader(record)).acceptsChanges).toBe(false);
  });

  it("denies everything for a record outside the workspace layout", async () => {
    const reader = await createReviewFreshnessReader(root);
    expect(reader.acceptsChanges).toBe(false);
    expect(await reader({})).toBe(false);
  });

  it("retains relaxed receipts when graph and current artifacts are unavailable", async () => {
    await write(recordPath("aidlc-state.md"), "- **Change Control**: relaxed (set by you)\n");
    await rm(path.join(root, ".claude"), { recursive: true });
    expect(await (await createReviewFreshnessReader(record))({})).toBe(true);
  });

  it.each(["org", "team", "project"])(
    "honors strict memory in %s over relaxed state",
    async (layer) => {
      await write(recordPath("aidlc-state.md"), "- **Change Control**: relaxed (set by you)\n");
      await write(`aidlc/spaces/default/memory/${layer}.md`, "## Change Control\nMode: strict\n");
      expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
    },
  );

  it("ignores fenced and commented memory declarations", async () => {
    await write(recordPath("aidlc-state.md"), "- **Change Control**: relaxed (set by you)\n");
    await write(
      "aidlc/spaces/default/memory/org.md",
      "```md\n## Change Control\nMode: strict\n```\n<!--\n## Change Control\nMode: strict\n-->\n",
    );
    expect(await (await createReviewFreshnessReader(record))({})).toBe(true);
  });

  it("does not let a fence inside a comment hide a real strict declaration", async () => {
    await write(recordPath("aidlc-state.md"), "- **Change Control**: relaxed\n");
    await write(
      "aidlc/spaces/default/memory/org.md",
      "<!--\n```\n-->\n## Change Control\nMode: strict\n",
    );
    expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
  });

  it.each(["説明では `<!--` を使います。", "説明では `` `<!--` `` を使います。", "    <!--"])(
    "does not let a literal comment marker hide strict memory: %s",
    async (example) => {
      await write(recordPath("aidlc-state.md"), "- **Change Control**: relaxed\n");
      await write(
        "aidlc/spaces/default/memory/org.md",
        `${example}\n\n## Change Control\nMode: strict\n`,
      );
      expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
    },
  );

  it.each([
    "## Change Control\nMode: unknown\n",
    "## Change Control\nMode: relaxed\nMode: strict\n",
    "## Change Control\nMode: relaxed\n## Change Control\nMode: strict\n",
  ])("treats invalid or ambiguous memory as unknown", async (memory) => {
    await write(recordPath("aidlc-state.md"), "- **Change Control**: relaxed\n");
    await write("aidlc/spaces/default/memory/org.md", memory);
    expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
  });

  it("rejects contradictory state declarations and noncanonical records", async () => {
    await write(
      recordPath("aidlc-state.md"),
      "- **Change Control**: relaxed\n- **Change Control**: strict\n",
    );
    expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
    expect(await (await createReviewFreshnessReader(root))({})).toBe(false);
  });

  it.each([
    "**Change Control**: relaxed\n",
    " - **Change Control**: relaxed\n",
    "```md\n- **Change Control**: strict\n```\n- **Change Control**: relaxed\n",
  ])("uses the engine's raw exact-bullet state grammar: %s", async (state) => {
    await write(recordPath("aidlc-state.md"), state);
    expect(await (await createReviewFreshnessReader(record))({})).toBe(false);
  });
});

describe("current source identity", () => {
  it("excludes nested v2.9 engine state but keeps similarly named application source", async () => {
    const receipt = await sourceFixture();
    await write(
      "packages/example/aidlc/spaces/default/intents/task-12345678/.aidlc-engine/reviews/result.json",
      "internal",
    );
    await write(
      "packages/example/aidlc/spaces/default/intents/.aidlc-engine/hooks-health/last",
      "internal",
    );
    await write(
      "packages/example/aidlc/spaces/default/intents/task-12345678/.aidlc-sensors/result.md",
      "legacy",
    );
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(true);
    await write("src/.aidlc-engine/application.ts", "real source");
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
  });
  it("matches fixed workspace and manifest-bound unit vectors", async () => {
    const receipt = await sourceFixture();
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(true);
  });

  it.each(["edit", "add", "delete", "manifest"])(
    "rejects a receipt after source %s",
    async (change) => {
      const receipt = await sourceFixture();
      if (change === "edit") await write("app.ts", "export const answer = 43;\n");
      if (change === "add") await write("added.ts", "new file\n");
      if (change === "delete") await rm(path.join(root, "app.ts"));
      if (change === "manifest") await write(artifactPath("source-manifest.json"), `${MANIFEST}\n`);
      expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
    },
  );

  it("excludes dependencies, generated directories and stamped harness trees", async () => {
    const receipt = await sourceFixture();
    await write("node_modules/dependency/index.js", "dependency");
    await write("src/node_modules/dependency/index.js", "nested dependency");
    await write("dist/output.bin", Buffer.alloc(100));
    await write(".claude/tools/other.ts", "engine update");
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(true);
  });

  // v2.11.0 aidlc-lib.ts SOURCE_FINGERPRINT_HARD_EXCLUDED_NAMES/_FILES,
  // AIDLC_ROOT_SETTINGS_FILES and the .NET output rule, with legacy aliases.
  describe("v2.11 exclusions", () => {
    const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
    const APP = "export const answer = 42;\n";
    const line = (relative: string, body: string) => `file:${relative}:-=${sha(body)}`;
    const workspace = (lines: string[]) =>
      sha(
        `aidlc-workspace-source-v2\nfilesystem=${sha(["aidlc-filesystem-source-v2", ...lines].join("\n"))}`,
      );
    const current = async (receipt: Record<string, string>, source: string) =>
      (await createReviewFreshnessReader(record))({ ...receipt, "Source Fingerprint": source });

    it("derives the fixed vector from the walk's lines", () => {
      expect(workspace([line("app.ts", APP)])).toBe(SOURCE);
    });

    it("leaves out machine-local caches, OS and editor byproducts and root settings", async () => {
      const receipt = await sourceFixture();
      for (const name of [
        ".vs/FileContentIndex/a.vsidx",
        "src/.vs/state",
        "__pycache__/m.pyc",
        "pkg/__pycache__/m.cpython-312.pyc",
        ".DS_Store",
        "src/.DS_Store",
        ".coverage",
        "src/.coverage.host.123",
        "Thumbs.db",
        "src/desktop.ini",
        "app.ts.swp",
        ".app.ts.swo",
        "src/.notes.swn",
        "src/.notes.swm",
        "notes.md~",
        "aidlc.settings.json",
        "aidlc.settings.local.json",
      ])
        await write(name, `byproduct ${name}\n`);
      expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(true);
    });

    it.each(["movie.swf", "config/aidlc.settings.json", "src/coverage.ts", "src/Thumbs.db.ts"])(
      "keeps %s, which only resembles an excluded name",
      async (name) => {
        const receipt = await sourceFixture();
        await write(name, "source\n");
        expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
        expect(
          await current(receipt, workspace([line("app.ts", APP), line(name, "source\n")].sort())),
        ).toBe(true);
      },
    );

    it("leaves out .NET bin, obj and out only beside a project file", async () => {
      const receipt = await sourceFixture();
      await write("svc/App.csproj", "<Project/>\n");
      await write("svc/bin/Debug/app.dll", "binary\n");
      await write("svc/obj/project.assets.json", "{}\n");
      await write("svc/out/app.dll", "published\n");
      await write("tools/bin/run.sh", "#!/bin/sh\n");
      const expected = workspace([
        line("app.ts", APP),
        line("svc/App.csproj", "<Project/>\n"),
        line("tools/bin/run.sh", "#!/bin/sh\n"),
      ]);
      expect(await current(receipt, expected)).toBe(true);
    });

    it("accepts evidence recorded before files were excluded by name", async () => {
      const receipt = await sourceFixture();
      await write(".DS_Store", "finder\n");
      await write("aidlc.settings.json", "{}\n");
      await write("pkg/__pycache__/b.pyc", "b\n");
      await write("pkg/__pycache__/a.pyc", "a\n");
      const legacy = [
        line(".DS_Store", "finder\n"),
        line("aidlc.settings.json", "{}\n"),
        line("app.ts", APP),
        line("pkg/__pycache__/a.pyc", "a\n"),
        line("pkg/__pycache__/b.pyc", "b\n"),
      ];
      expect(await current(receipt, SOURCE)).toBe(true);
      expect(await current(receipt, workspace(legacy))).toBe(true);
      expect(await current(receipt, workspace(legacy.slice(1)))).toBe(false);
      await write(".DS_Store", "changed\n");
      expect(await current(receipt, workspace(legacy))).toBe(false);
      expect(await current(receipt, SOURCE)).toBe(true);
    });

    it("drops the legacy alias when an excluded cache holds anything but flat files", async () => {
      const receipt = await sourceFixture();
      await write("pkg/__pycache__/nested/a.pyc", "a\n");
      expect(await current(receipt, SOURCE)).toBe(true);
      expect(
        await current(receipt, workspace([line("app.ts", APP), line("pkg/__pycache__/nested/a.pyc", "a\n")])),
      ).toBe(false);
    });

    it("accepts evidence recorded while .NET outputs were still source", async () => {
      const receipt = await sourceFixture();
      await write(".DS_Store", "finder\n");
      await write("svc/App.csproj", "<Project/>\n");
      await write("svc/bin/app.dll", "binary\n");
      const earlier = [
        line("app.ts", APP),
        line("svc/App.csproj", "<Project/>\n"),
        line("svc/bin/app.dll", "binary\n"),
      ];
      expect(await current(receipt, workspace(earlier))).toBe(true);
      expect(await current(receipt, workspace([line(".DS_Store", "finder\n"), ...earlier]))).toBe(
        true,
      );
      expect(
        await current(receipt, workspace([line("app.ts", APP), line("svc/bin/app.dll", "binary\n")])),
      ).toBe(false);
    });
  });

  it.each([".aidlc-source-paths.json", ".aidlc/worktree-meta.json", "nested/.git/HEAD"])(
    "fails closed on unsupported source context %s",
    async (name) => {
      const receipt = await sourceFixture();
      await write(name, "{}");
      expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
    },
  );

  it("fails closed while the work records an extra source checkout", async () => {
    const receipt = await sourceFixture();
    const checkouts = recordPath(".aidlc-engine/source-checkouts.json");
    await write(checkouts, JSON.stringify({ version: 1, checkouts: [] }));
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(true);
    await write(
      checkouts,
      JSON.stringify({
        version: 1,
        checkouts: [{ label: "web", path: "../web", real: path.join(root, "../web") }],
      }),
    );
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
  });

  it.each([
    [
      "an older stored directory with the same slug",
      { dirName: "example-87654321", slug: "example", uuid: "12345678" },
      true,
    ],
    ["a legacy row with another UUID", { slug: "example", uuid: "87654321" }, true],
    ["a legacy row without a UUID", { slug: "example" }, true],
    ["a legacy row with another slug", { slug: "other", uuid: "12345678" }, true],
    [
      "the exact stored directory",
      { dirName: "example-12345678", slug: "other", uuid: "87654321" },
      false,
    ],
    [
      "the matching legacy UUID suffix",
      { slug: "example", uuid: "00000000-0000-0000-0000-000012345678" },
      false,
    ],
    [
      "an empty stored name with a matching legacy UUID",
      { dirName: "", slug: "example", uuid: "12345678" },
      false,
    ],
  ])("resolves repository mappings for %s", async (_, entry, expected) => {
    record = path.join(root, "aidlc/spaces/default/intents/example-12345678");
    await write(recordPath("aidlc-state.md"), "- **Change Control**: strict\n");
    const receipt = await sourceFixture();
    await write(
      recordPath("../intents.json"),
      JSON.stringify([
        { ...entry, repos: ["app"] },
        { dirName: "example-12345678", slug: "example", repos: [] },
      ]),
    );
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(expected);
  });

  it("fails closed for a mapped repository and an invalid manifest path", async () => {
    const receipt = await sourceFixture();
    await write(
      recordPath("../intents.json"),
      JSON.stringify([{ dirName: "example", repos: ["app"] }]),
    );
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
    await rm(path.join(record, "../intents.json"));
    await write(artifactPath("source-manifest.json"), MANIFEST.replace("app.ts", "../app.ts"));
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
  });

  it.runIf(process.platform !== "win32")("binds the executable bit", async () => {
    const receipt = await sourceFixture();
    await chmod(path.join(root, "app.ts"), 0o755);
    expect(await (await createReviewFreshnessReader(record))(receipt)).toBe(false);
  });

  it("detects a top-level addition after the source read and shares one source read within a build", async () => {
    const receipt = await sourceFixture();
    // Windows runners may expose TEMP through an 8.3 alias. The reader opens
    // the canonical path, so count that identity rather than its spelling.
    const appPath = await fs.realpath(path.join(root, "app.ts"));
    const { open: original } =
      await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let appReads = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (String(args[0]) === appPath) appReads++;
      return original(...args);
    });
    const current = await createReviewFreshnessReader(record);
    expect(await current(receipt)).toBe(true);
    expect(await current(receipt)).toBe(true);
    expect(appReads).toBe(1);
    await write("late.ts", "after snapshot");
    expect(await current(receipt)).toBe(false);
    expect(await readFile(path.join(root, artifactPath("source-manifest.json")), "utf8")).toBe(
      MANIFEST,
    );
  });
});

// v2.11.1 aidlc-lib.ts committedTextBytes / committedTextParts: a file Git
// would convert reads with CRLF as LF; the raw-bytes form recorded before
// 2.11.1 still compares (currentFingerprintForm).
describe("v2.11.1 committed text line endings", () => {
  const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const logical = (name: string) => `construction/unit-alpha/${stage.slug}/${name}`;
  const artifactVector = (design: string | Buffer) =>
    `sha256:${sha(
      JSON.stringify([
        [logical("design.md"), `sha256:${sha(design)}`],
        [logical("optional.md"), "missing"],
        [logical("traceability.json"), "missing"],
      ]),
    )}`;
  const isCurrent = async (fingerprint: string) =>
    (await createReviewFreshnessReader(record))({
      Stage: stage.slug,
      Unit: "unit-alpha",
      "Artifact Fingerprint": fingerprint,
    });

  it("derives the fixed artifact vector from its manifest", () => {
    expect(artifactVector("# Design\n")).toBe(ARTIFACT);
  });

  it.each([
    ["CRLF text", "a\r\nb\r\n", "a\nb\n"],
    ["UTF-8 CRLF text", "日本語\r\n", "日本語\n"],
    ["mixed LF and CRLF text", "a\nb\r\n", "a\nb\n"],
    ["one control byte per 128 printable", `${"x".repeat(128)}\u0001\r\n`, null],
    ["a trailing DOS end-of-file mark", "ab\r\n\u001a", "ab\n\u001a"],
    ["tab, backspace, escape and form feed", "a\t\b\u001b\f\r\n", "a\t\b\u001b\f\n"],
    ["a NUL byte", "a\r\n\u0000", undefined],
    ["a lone CR", "a\rb\r\n", undefined],
    ["a trailing CR", "a\r\nb\r", undefined],
    ["a control byte in fewer than 128 printable", "ab\u0001\r\n", undefined],
    ["two control bytes in 128 printable", `${"x".repeat(128)}\u0001\u0001\r\n`, undefined],
    ["DEL", "ab\u007f\r\n", undefined],
    ["an end-of-file mark that is not last", "a\u001a\r\n", undefined],
    ["LF only", "a\nb\n", undefined],
  ])("reads %s as Git would", async (_, body, text) => {
    // null: the CRLF form of the same body with LF, computed below.
    const expected = text === null ? body.replace(/\r\n/g, "\n") : (text ?? body);
    await write(artifactPath("design.md"), Buffer.from(body, "utf8"));
    expect(await currentReviewArtifactFingerprint(record, stage, "unit-alpha")).toBe(
      artifactVector(expected),
    );
    expect(await isCurrent(artifactVector(expected))).toBe(true);
    // The raw-bytes form recorded before 2.11.1 is an alias of the same bytes.
    expect(await isCurrent(artifactVector(body))).toBe(true);
    expect(await isCurrent(artifactVector(`${body}x`))).toBe(false);
  });

  it("matches a CRLF review artifact against the receipt recorded for LF bytes", async () => {
    await write(artifactPath("design.md"), "# Design\r\n");
    expect(await isCurrent(ARTIFACT)).toBe(true);
  });

  describe("source", () => {
    const APP = "export const answer = 42;\n";
    const CRLF_APP = "export const answer = 42;\r\n";
    const line = (relative: string, body: string) => `file:${relative}:-=${sha(body)}`;
    const workspace = (lines: string[]) =>
      sha(
        `aidlc-workspace-source-v2\nfilesystem=${sha(["aidlc-filesystem-source-v2", ...lines].join("\n"))}`,
      );
    const unitVector = (manifest: string, entries: [string, string][]) =>
      `sha256:${sha(
        `manifest\t${sha(manifest)}\t-\n${entries
          .map(([file, body]) => `\t${file}\t100644\t${sha(body)}\n`)
          .join("")}`,
      )}`;
    const current = async (
      receipt: Record<string, string>,
      source: string,
      unitSource = receipt["Unit Source Fingerprint"] as string,
    ) =>
      (await createReviewFreshnessReader(record))({
        ...receipt,
        "Source Fingerprint": source,
        "Unit Source Fingerprint": unitSource,
      });

    it("derives the fixed unit vector from the manifest and listing", () => {
      expect(unitVector(MANIFEST, [["app.ts", APP]])).toBe(UNIT_SOURCE);
    });

    it("hashes CRLF source as LF and accepts the raw workspace and unit forms", async () => {
      const receipt = await sourceFixture();
      await write("app.ts", CRLF_APP);
      expect(await current(receipt, SOURCE)).toBe(true);
      const rawSource = workspace([line("app.ts", CRLF_APP)]);
      const rawUnit = unitVector(MANIFEST, [["app.ts", CRLF_APP]]);
      expect(await current(receipt, rawSource)).toBe(true);
      expect(await current(receipt, SOURCE, rawUnit)).toBe(true);
      expect(await current(receipt, rawSource, rawUnit)).toBe(true);
      expect(await current(receipt, workspace([line("app.ts", `${CRLF_APP}x`)]))).toBe(false);
    });

    it("binds the manifest's LF text and keeps one raw form, never a mix", async () => {
      const receipt = await sourceFixture();
      await write(artifactPath("source-manifest.json"), `${MANIFEST}\r\n`);
      await write("app.ts", CRLF_APP);
      const rawSource = workspace([line("app.ts", CRLF_APP)]);
      expect(await current(receipt, SOURCE, unitVector(`${MANIFEST}\n`, [["app.ts", APP]]))).toBe(
        true,
      );
      expect(
        await current(receipt, rawSource, unitVector(`${MANIFEST}\r\n`, [["app.ts", CRLF_APP]])),
      ).toBe(true);
      expect(
        await current(receipt, SOURCE, unitVector(`${MANIFEST}\r\n`, [["app.ts", APP]])),
      ).toBe(false);
      expect(
        await current(receipt, SOURCE, unitVector(`${MANIFEST}\n`, [["app.ts", CRLF_APP]])),
      ).toBe(false);
    });

    it("takes the raw form of a claimed LF file whose text another CRLF file shares", async () => {
      // v2.11.1 rawFingerprintForm keys the raw form by listing entry, so an
      // LF file with the same text as a CRLF one reads the CRLF raw entry.
      const receipt = await sourceFixture();
      await write("z.ts", CRLF_APP);
      const source = workspace([line("app.ts", APP), line("z.ts", APP)]);
      expect(await current(receipt, source)).toBe(true);
      expect(await current(receipt, source, unitVector(MANIFEST, [["app.ts", CRLF_APP]]))).toBe(
        true,
      );
    });

    it("rebuilds the legacy alias from LF text", async () => {
      const receipt = await sourceFixture();
      await write(".DS_Store", "finder\r\n");
      expect(
        await current(receipt, workspace([line(".DS_Store", "finder\n"), line("app.ts", APP)])),
      ).toBe(true);
      expect(
        await current(receipt, workspace([line(".DS_Store", "finder\r\n"), line("app.ts", APP)])),
      ).toBe(false);
    });
  });
});

describe("v2.11.1 source boundary", () => {
  const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  const APP = "export const answer = 42;\n";
  const line = (relative: string, body: string) => `file:${relative}:-=${sha(body)}`;
  const workspace = (lines: string[]) =>
    sha(
      `aidlc-workspace-source-v2\nfilesystem=${sha(["aidlc-filesystem-source-v2", ...lines].join("\n"))}`,
    );
  const unitVector = (manifest: string, entries: [string, string][]) =>
    `sha256:${sha(
      `manifest\t${sha(manifest)}\t-\n${entries
        .map(([file, body]) => `\t${file}\t100644\t${sha(body)}\n`)
        .join("")}`,
    )}`;
  const current = async (receipt: Record<string, string>, source: string, unitSource?: string) =>
    (await createReviewFreshnessReader(record))({
      ...receipt,
      "Source Fingerprint": source,
      ...(unitSource === undefined ? {} : { "Unit Source Fingerprint": unitSource }),
    });
  const claim = async (claimed: string) => {
    const manifest = MANIFEST.replace('"app.ts"', JSON.stringify(claimed));
    await write(artifactPath("source-manifest.json"), manifest);
    return manifest;
  };

  it("leaves out .codegraph, .idea and DerivedData at any depth, even as symlinks", async () => {
    const receipt = await sourceFixture();
    await write(".idea/workspace.xml", "<project/>\n");
    await write("src/.codegraph/index.db", Buffer.from([0, 1, 2]));
    await write("ios/DerivedData/Build/app.o", "object\n");
    await mkdir(path.join(root, "node_modules/target"), { recursive: true });
    await symlink(path.join(root, "node_modules/target"), path.join(root, "src/DerivedData"), "junction");
    expect(await current(receipt, SOURCE)).toBe(true);
    // A regular file of the same name is still source.
    await write("DerivedData", "notes\n");
    expect(await current(receipt, SOURCE)).toBe(false);
    expect(await current(receipt, workspace([line("DerivedData", "notes\n"), line("app.ts", APP)]))).toBe(
      true,
    );
  });

  it.each([
    ["composer.json", "vendor"],
    ["go.mod", "vendor"],
    ["Podfile", "Pods"],
    ["mix.exs", "deps"],
    ["mix.exs", "_build"],
    ["pubspec.yaml", ".dart_tool"],
    ["bower.json", "bower_components"],
    ["Gemfile", ".bundle"],
    ["stack.yaml", ".stack-work"],
  ])("leaves out %s's %s only beside that manifest", async (manifest, dir) => {
    const receipt = await sourceFixture();
    await write(`pkg/${manifest}`, "manifest\n");
    await write(`pkg/${dir}/lib/dependency.txt`, "dependency\n");
    await write(`other/${dir}/source.txt`, "source\n");
    expect(
      await current(
        receipt,
        workspace([
          line("app.ts", APP),
          line(`other/${dir}/source.txt`, "source\n"),
          line(`pkg/${manifest}`, "manifest\n"),
        ]),
      ),
    ).toBe(true);
  });

  it("does not follow an owned dependency symlink and keeps a regular file of that name", async () => {
    const receipt = await sourceFixture();
    const outside = path.join(root, "node_modules/target");
    await mkdir(outside, { recursive: true });
    await write("php/composer.json", "{}\n");
    await symlink(outside, path.join(root, "php/vendor"), "junction");
    await write("go/go.mod", "module x\n");
    await write("go/vendor", "a file\n");
    expect(
      await current(
        receipt,
        workspace([
          line("app.ts", APP),
          line("go/go.mod", "module x\n"),
          line("go/vendor", "a file\n"),
          line("php/composer.json", "{}\n"),
        ]),
      ),
    ).toBe(true);
  });

  it.each(["pkg/vendor/lib.php", "pkg/vendor/", ".idea/workspace.xml", "src/DerivedData/x"])(
    "refuses a source claim on %s",
    async (claimed) => {
      const receipt = await sourceFixture();
      await write("pkg/composer.json", "{}\n");
      await write("pkg/vendor/lib.php", "<?php\n");
      const source = workspace([line("app.ts", APP), line("pkg/composer.json", "{}\n")]);
      const manifest = await claim(claimed);
      expect(await current(receipt, source, unitVector(manifest, []))).toBe(false);
    },
  );

  it("still binds a claim on a same-named directory no manifest owns", async () => {
    const receipt = await sourceFixture();
    await write("lib/vendor/lib.c", "int x;\n");
    const source = workspace([line("app.ts", APP), line("lib/vendor/lib.c", "int x;\n")]);
    const manifest = await claim("lib/vendor/lib.c");
    expect(await current(receipt, source, unitVector(manifest, [["lib/vendor/lib.c", "int x;\n"]]))).toBe(
      true,
    );
  });

  describe(".aidlc-source-paths.json exclude", () => {
    const REGISTRY = ".aidlc-source-paths.json";
    const registered = async (body: string) => {
      await write(REGISTRY, body);
      return line(REGISTRY, body);
    };

    it.each([
      ["no lists", "{\"version\":1}"],
      ["empty lists", "{\"version\":1,\"paths\":[],\"exclude\":[]}"],
      ["null lists", "{\"version\":1,\"paths\":null,\"exclude\":null}"],
      ["unknown keys", "{\"version\":1,\"comment\":\"ours\"}"],
    ])("walks the whole boundary for a registry with %s", async (_, body) => {
      const receipt = await sourceFixture();
      const registry = await registered(body);
      expect(await current(receipt, workspace([registry, line("app.ts", APP)]))).toBe(true);
    });

    it("leaves out each excluded path and everything under it, normalizing entries", async () => {
      const receipt = await sourceFixture();
      const registry = await registered(
        JSON.stringify({
          version: 1,
          paths: [],
          exclude: ["cache/", "./gen/out", "notes.txt", "docs\\draft", "linked", ".DS_Store"],
        }),
      );
      await write("cache/blob.bin", Buffer.from([0, 1]));
      await write("gen/out/bundle.js", "built\n");
      await write("gen/keep.ts", "kept\n");
      await write("notes.txt", "scratch\n");
      await write("docs/draft/x.md", "draft\n");
      await write("docs/final.md", "final\n");
      await write("cachefile.txt", "kept\n");
      await write(".DS_Store", "finder\n");
      const outside = path.join(root, "node_modules/target");
      await mkdir(outside, { recursive: true });
      await symlink(outside, path.join(root, "linked"), "junction");
      const lines = [
        registry,
        line("app.ts", APP),
        line("cachefile.txt", "kept\n"),
        line("docs/final.md", "final\n"),
        line("gen/keep.ts", "kept\n"),
      ];
      expect(await current(receipt, workspace(lines))).toBe(true);
      // An excluded byproduct leaves no legacy alias behind.
      expect(await current(receipt, workspace([lines[0] as string, line(".DS_Store", "finder\n"), ...lines.slice(1)]))).toBe(
        false,
      );
      await write("gen/out/bundle.js", "rebuilt\n");
      await write("cache/blob.bin", Buffer.from([2]));
      expect(await current(receipt, workspace(lines))).toBe(true);
      await write("gen/keep.ts", "edited\n");
      expect(await current(receipt, workspace(lines))).toBe(false);
    });

    it("refuses a source claim on an excluded path", async () => {
      const receipt = await sourceFixture();
      const registry = await registered('{"version":1,"exclude":["gen"]}');
      await write("gen/out.js", "built\n");
      const manifest = await claim("gen/out.js");
      expect(
        await current(receipt, workspace([registry, line("app.ts", APP)]), unitVector(manifest, [])),
      ).toBe(false);
    });

    it.each([
      ["another version", '{"version":2,"exclude":[]}'],
      ["registered paths", '{"version":1,"paths":["src"],"exclude":["gen"]}'],
      ["a non-array exclude", '{"version":1,"exclude":"gen"}'],
      ["a non-array paths", '{"version":1,"paths":{}}'],
      ["a non-string entry", '{"version":1,"exclude":[1]}'],
      ["an empty entry", '{"version":1,"exclude":[""]}'],
      ["a dot entry", '{"version":1,"exclude":["."]}'],
      ["a bare ./ entry", '{"version":1,"exclude":["./"]}'],
      ["a parent entry", '{"version":1,"exclude":["../x"]}'],
      ["an inner parent segment", '{"version":1,"exclude":["a/../b"]}'],
      ["an inner dot segment", '{"version":1,"exclude":["a/./b"]}'],
      ["an empty segment", '{"version":1,"exclude":["a//b"]}'],
      ["an absolute entry", '{"version":1,"exclude":["/etc"]}'],
      ["a drive entry", '{"version":1,"exclude":["C:\\\\x"]}'],
      ["a UNC entry", '{"version":1,"exclude":["//server/share"]}'],
      ["a NUL entry", '{"version":1,"exclude":["a\\u0000b"]}'],
      ["an overlong entry", JSON.stringify({ version: 1, exclude: ["x".repeat(4097)] })],
      ["too many entries", JSON.stringify({ version: 1, exclude: Array(10_001).fill("x") })],
      ["an array", "[]"],
      ["null", "null"],
      ["invalid JSON", "{"],
      ["more than 1 MiB", JSON.stringify({ version: 1, pad: "x".repeat(1024 * 1024) })],
    ])("fails closed on a registry with %s", async (_, body) => {
      const receipt = await sourceFixture();
      const registry = await registered(body);
      expect(await current(receipt, workspace([registry, line("app.ts", APP)]))).toBe(false);
    });

    it("fails closed on a registry that is a directory or a symlink", async () => {
      const receipt = await sourceFixture();
      await mkdir(path.join(root, REGISTRY));
      expect(await current(receipt, SOURCE)).toBe(false);
      await rm(path.join(root, REGISTRY), { recursive: true });
      // File symlinks need elevated rights on Windows; the directory case covers it there.
      if (process.platform === "win32") return;
      await write("real.json", '{"version":1}');
      await symlink(path.join(root, "real.json"), path.join(root, REGISTRY));
      expect(await current(receipt, workspace([line("app.ts", APP), line("real.json", '{"version":1}')]))).toBe(
        false,
      );
    });
  });
});
