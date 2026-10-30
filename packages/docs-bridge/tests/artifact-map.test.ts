import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BridgeConfig } from "@aidlc-guide/shared-types";
import { describe, expect, it } from "vitest";
import {
  buildArtifactMap,
  positionalAgreement,
  readCommittedMap,
  readSections,
  serialize,
} from "../../../scripts/build-artifact-map.ts";
import {
  artifactDocIndex,
  artifactDocsOf,
  artifactMap,
  bridgeMap,
  resolveStage,
} from "../src/resolve.ts";
import { expectOk, REPO_ROOT } from "./paths.ts";

const noDocs: BridgeConfig = {
  docsRepoPath: null,
  projectLinks: [],
};

const stageGraphPath = path.join(REPO_ROOT, ".claude", "tools", "data", "stage-graph.json");
const snapshotPath = path.join(REPO_ROOT, "docs", "reference", "en", "04-stages");
const derivable = existsSync(stageGraphPath) && existsSync(snapshotPath);

if (!derivable) {
  console.warn("[artifact-map] stage graph or docs snapshot not found — derivation checks SKIPPED");
}

interface GraphNode {
  slug: string;
  number: string;
  produces: string[];
  consumes: { artifact: string }[];
}

const graph: GraphNode[] = derivable
  ? (JSON.parse(readFileSync(stageGraphPath, "utf8")) as GraphNode[])
  : [];

const artifactEntries = Object.entries(artifactMap.stages).flatMap(([slug, stage]) =>
  Object.entries(stage.artifacts).map(([artifact, entry]) => ({ slug, artifact, entry })),
);

describe("artifact-map shape", () => {
  it("is generated, and says which script regenerates it", () => {
    expect(artifactMap.generator).toBe("scripts/build-artifact-map.ts");
  });

  it("claims the same framework release as bridge-map", () => {
    expect(artifactMap.sourceVersion).toBe(bridgeMap.sourceVersion);
  });

  it("gives every stage a section anchor in both locales", () => {
    for (const [slug, stage] of Object.entries(artifactMap.stages)) {
      expect(stage.anchors.en, `${slug} has no en anchor`).toMatch(/^#\S/);
      expect(stage.anchors.ja, `${slug} has no ja anchor`).toMatch(/^#\S/);
    }
  });

  it("never ships an empty description string — an undocumented row is null", () => {
    for (const { slug, artifact, entry } of artifactEntries) {
      for (const locale of ["en", "ja"] as const) {
        const description = entry.descriptions[locale];
        if (description === null || description === undefined) continue;
        expect(description.trim(), `${slug}/${artifact} (${locale})`).not.toBe("");
      }
    }
  });
});

describe.skipIf(!derivable)("artifact-map matches the installed stage graph", () => {
  it("covers exactly the stages the graph declares", () => {
    expect(Object.keys(artifactMap.stages).sort()).toEqual(graph.map((n) => n.slug).sort());
  });

  it.each(graph.map((node) => [node.slug, node] as const))(
    "stage %s lists exactly its produced artifacts",
    (slug, node) => {
      expect(Object.keys(artifactMap.stages[slug]?.artifacts ?? {})).toEqual(node.produces);
      expect(artifactMap.stages[slug]?.number).toBe(node.number);
    },
  );
});

/**
 * The generated file is only trustworthy while it still matches what the
 * snapshot says. Regenerating in-process and comparing bytes is the same check
 * `bun scripts/build-artifact-map.ts --check` runs, kept inside the gate so a
 * docs sync that changes an Outputs table cannot land silently.
 */
/** Stages whose ja Outputs table translates the filename column. */
const untranslatedFileNames = new Set(
  graph
    .filter((node) => node.number.startsWith("3.") || node.number.startsWith("4."))
    .map((node) => node.slug),
);

describe.skipIf(!derivable)("artifact-map is in sync with the docs snapshot", () => {
  // Lazy, not eager: a suite callback runs during collection even when
  // `skipIf` will skip it, so building here would throw before the skip on a
  // workspace with no stage graph -- the very case the flag exists for.
  let cached: ReturnType<typeof buildArtifactMap> | null = null;
  const build = (): ReturnType<typeof buildArtifactMap> => {
    cached ??= buildArtifactMap(REPO_ROOT, bridgeMap.sourceVersion, readCommittedMap(REPO_ROOT));
    return cached;
  };
  const committed = (): string =>
    readFileSync(
      path.join(REPO_ROOT, "packages", "docs-bridge", "data", "artifact-map.json"),
      "utf8",
    );

  it("regenerates byte-identically from the bundled snapshot", () => {
    expect(serialize(build().map)).toBe(committed());
  });

  /**
   * The ja construction and operation pages translate the filename column, so
   * their descriptions can only be reached by row index. That is sound only
   * while the translation preserves row order — which this measures on every
   * row where ja *does* name the file. A ja page that reorders its Outputs
   * table fails here rather than shipping a description under the wrong file.
   */
  it("agrees on row order wherever both locales name the file", () => {
    const en = readSections(REPO_ROOT, "en");
    const ja = readSections(REPO_ROOT, "ja");
    for (const [number, section] of en) {
      const other = ja.get(number);
      if (other === undefined) continue;
      const { checked, agreed } = positionalAgreement(section.rows, other.rows);
      expect(agreed, `stage ${number} row order differs between locales`).toBe(checked);
    }
    const { agreement } = build();
    expect(agreement.checked).toBeGreaterThan(0);
    expect(agreement.agreed).toBe(agreement.checked);
  });

  /**
   * Six artifacts have no row in the upstream Outputs tables — five stages omit
   * their `traceability.json` and Build and Test omits `cross-unit-traceability`.
   * The en list is pinned: it is the derivation base, so a new gap there is a
   * regression and a documented row that disappears should fail.
   */
  /**
   * The committed map is the allowlist, so it retires its own entries. A hand-
   * kept list cannot: once upstream documents one of the six and the list still
   * grants it, a later upstream removal is waved through as "historically
   * known". Comparing against what is committed means a description that has
   * become available can never quietly go away again, while a gap upstream has
   * simply never filled stays allowed — and neither blocks the docs sync, which
   * runs this gate before opening the PR that would carry the improvement.
   */
  it("never loses an en description the committed map already had", () => {
    expect(build().lostDescriptions).toEqual([]);
  });

  /**
   * The ja list is NOT pinned, deliberately. A ja page trails its en page for
   * as long as it takes upstream to translate a changed Outputs table, and the
   * docs sync runs this gate *before* opening the PR that would carry the new
   * translation — pinning ja would deadlock that sync on its own output. Every
   * en gap is necessarily a ja gap; anything beyond that is translation lag,
   * which the card renders as the English text.
   */
  it("never claims a ja description where the en snapshot has none", () => {
    const { missing } = build();
    for (const entry of missing.en) {
      expect(missing.ja, `${entry} described in ja but not en`).toContain(entry);
    }
  });

  /**
   * Canonical name and filename differ for exactly these; both land in
   * `test-results.md`, which is why the filename cannot be inferred from the
   * artifact name alone.
   */
  it("resolves the artifacts whose file is not named after them", () => {
    expect(artifactMap.stages["build-and-test"]?.artifacts["build-test-results"]?.fileName).toBe(
      "test-results.md",
    );
    expect(
      artifactMap.stages["performance-validation"]?.artifacts["load-test-results"]?.fileName,
    ).toBe("test-results.md");
    expect(artifactMap.stages["units-generation"]?.artifacts.traceability?.fileName).toBe(
      "traceability.json",
    );
    // bridge-map points this stage at a stub with no `outputs:` frontmatter, so
    // the filename has to come from the installed stage file instead.
    expect(artifactMap.stages["domain-design"]?.artifacts.traceability?.fileName).toBe(
      "traceability.json",
    );
  });

  it("reads every stage's filenames from frontmatter rather than guessing", () => {
    expect(build().unresolvedFileNames).toEqual([]);
  });

  /**
   * The corroboration above cannot reach the stages that actually rely on the
   * row index, so those record the en row order they were paired against.
   *
   * Invariants, not the current state. A degraded stage legitimately carries
   * `join.ja: "name"` alongside a retained `joinOrder`, and that state is
   * committed by the docs sync itself — asserting it away would fail this gate
   * for the exact situation the degradation exists to survive.
   */
  it("records a row order wherever ja is or was paired by it", () => {
    for (const [slug, stage] of Object.entries(artifactMap.stages)) {
      if (stage.join.ja === "position") {
        expect(Array.isArray(stage.joinOrder), `${slug} joins by row index`).toBe(true);
      }
      if (stage.joinOrder !== null) {
        // A baseline only ever belongs to a page that translates the filename
        // column; a name-joined page has an exact join and needs no baseline.
        expect(untranslatedFileNames.has(slug), `${slug} carries a row order`).toBe(true);
      }
    }
  });

  it("drops ja on every pairing it refuses, and keeps that pairing's baseline", () => {
    const built = build();
    for (const slug of built.untrustedPairings) {
      const stage = built.map.stages[slug];
      expect(stage?.joinOrder, `${slug} lost its trusted baseline`).not.toBeNull();
      for (const [artifact, entry] of Object.entries(stage?.artifacts ?? {})) {
        expect(entry.descriptions.ja, `${slug}/${artifact}`).toBeNull();
      }
    }
  });

  /**
   * A subset, not an equality. The invariant worth holding is that the row
   * index is never trusted on a page where ja names the file — there the
   * filename join is available and exact. Which construction and operation
   * stages currently use it is not pinned: a stage whose ja table is mid-
   * translation drops out of this list, and that is the expected intermediate
   * state of a docs sync, not a regression.
   */
  it("matches ja by row position only on the pages that translate the filename", () => {
    for (const [slug, stage] of Object.entries(artifactMap.stages)) {
      if (stage.join.ja !== "position") continue;
      expect(untranslatedFileNames.has(slug), `${slug} joined ja by row index`).toBe(true);
    }
  });
});

describe.skipIf(!derivable)("artifact index", () => {
  it("covers every consumed artifact, so inputs are explained too", () => {
    const consumed = new Set(graph.flatMap((node) => node.consumes.map((c) => c.artifact)));
    for (const artifact of consumed) {
      expect(artifactDocIndex().has(artifact), `no description for input ${artifact}`).toBe(true);
    }
  });

  it("leaves out a name several stages produce, rather than picking one", () => {
    // `traceability` has eight producers with eight different meanings. It is
    // never consumed, so excluding it costs nothing and avoids a wrong answer.
    expect(artifactDocIndex().has("traceability")).toBe(false);
  });
});

describe("resolveStage exposes artifact descriptions", () => {
  it("explains both what the stage reads and what it writes", async () => {
    const { value } = expectOk(await resolveStage(noDocs, "units-generation"));
    expect(value.artifactDocs["unit-of-work"]?.descriptions.ja).toMatch(/ユニット定義/);
    // `components` is produced by domain-design and consumed here.
    expect(value.inputs).toContain("components");
    expect(value.artifactDocs.components?.descriptions.ja).not.toBeNull();
  });

  it("names the real file when it differs from the canonical name", async () => {
    const { value } = expectOk(await resolveStage(noDocs, "build-and-test"));
    expect(value.artifactDocs["build-test-results"]?.fileName).toBe("test-results.md");
  });

  it("has no descriptions for the retired State Version 7 application-design slug", () => {
    expect(artifactDocsOf("application-design")).toEqual({});
  });
});
