import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bridgeMap } from "@andon/docs-bridge";
import { describe, expect, it } from "vitest";
import { routeRead } from "../src/handlers/read.ts";
import { createGuideService } from "../src/service.ts";

async function seedRecord(files: readonly string[]): Promise<string> {
  const recordDir = await mkdtemp(path.join(tmpdir(), "api-io-paths-"));
  for (const rel of files) {
    const absolute = path.join(recordDir, ...rel.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `# ${path.basename(rel)}\n`);
  }
  return recordDir;
}

describe("GET /api/io-paths", () => {
  it("rejects a missing stage", async () => {
    const recordDir = await seedRecord([]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    await expect(
      routeRead(service.readContext, new URL("http://localhost/api/io-paths")),
    ).resolves.toEqual({
      status: 400,
      body: { error: true, reason: "missing-stage" },
    });
  });

  it("returns not-found for an unknown stage", async () => {
    const recordDir = await seedRecord([]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    await expect(
      routeRead(service.readContext, new URL("http://localhost/api/io-paths?stage=unknown-stage")),
    ).resolves.toEqual({
      status: 200,
      body: { error: true, reason: "not-found" },
    });
  });

  /**
   * `build-test-results` is written to `test-results.md`, so probing
   * `<canonical name>.md` resolved it to null and the stage card rendered the
   * artifact as dead text. The real filename comes from the derived artifact
   * map (scripts/build-artifact-map.ts).
   */
  it("resolves an artifact whose file is not named after it", async () => {
    const recordDir = await seedRecord([
      "construction/build-and-test/build-instructions.md",
      "construction/build-and-test/test-results.md",
    ]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=build-and-test"),
    );
    const body = result?.body as { value: { outputs: Record<string, string | null> } };
    expect(body.value.outputs["build-test-results"]).toBe(
      "construction/build-and-test/test-results.md",
    );
    expect(body.value.outputs["build-instructions"]).toBe(
      "construction/build-and-test/build-instructions.md",
    );
  });

  /**
   * Every record committed under `aidlc/spaces/` writes the canonical name, so
   * the mapping has to extend the probe rather than replace it — substituting
   * `test-results.md` alone would unlink all of them.
   */
  it("still resolves a record that used the canonical name", async () => {
    const recordDir = await seedRecord(["construction/build-and-test/build-test-results.md"]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=build-and-test"),
    );
    const body = result?.body as { value: { outputs: Record<string, string | null> } };
    expect(body.value.outputs["build-test-results"]).toBe(
      "construction/build-and-test/build-test-results.md",
    );
  });

  /**
   * `pickIoPath` ends a candidate on a shared-tree match, so probing the
   * canonical name to exhaustion first would return a stray file outside
   * `construction/` in preference to this stage's own copy under the mapped
   * name. Every candidate gets its stage-specific chance first.
   */
  it("prefers this stage's own file over a stray shared one under another name", async () => {
    const recordDir = await seedRecord([
      "construction/build-and-test/test-results.md",
      "inception/notes/build-test-results.md",
    ]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=build-and-test"),
    );
    const body = result?.body as { value: { outputs: Record<string, string | null> } };
    expect(body.value.outputs["build-test-results"]).toBe(
      "construction/build-and-test/test-results.md",
    );
  });

  /**
   * `feedback-optimization` consumes `load-test-results`, whose file is
   * `test-results.md` — a name Build and Test also writes. Accepting a lone
   * `construction/<other stage>/` hit as "specific" would resolve the operation
   * stage's input to the build results.
   */
  it("does not resolve an operation input to another stage's same-named file", async () => {
    const recordDir = await seedRecord([
      "construction/build-and-test/test-results.md",
      "operation/performance-validation/load-test-results.md",
      "operation/performance-validation/test-results.md",
    ]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=feedback-optimization"),
    );
    const body = result?.body as { value: { inputs: Record<string, string | null> } };
    expect(body.value.inputs["load-test-results"]).toBe(
      "operation/performance-validation/load-test-results.md",
    );
  });

  /**
   * The harder shape of the same collision: this record has no
   * `load-test-results.md` at all, because Performance Validation wrote the
   * filename its stage file declares. Both copies of `test-results.md` are
   * then in play and only the producing stage tells them apart.
   */
  it("scopes a mapped filename to the stage that writes it", async () => {
    const recordDir = await seedRecord([
      "construction/build-and-test/test-results.md",
      "operation/performance-validation/test-results.md",
    ]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const consumer = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=feedback-optimization"),
    );
    const consumed = consumer?.body as { value: { inputs: Record<string, string | null> } };
    expect(consumed.value.inputs["load-test-results"]).toBe(
      "operation/performance-validation/test-results.md",
    );

    // And the other producer still gets its own copy, not the operation one.
    const producer = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=build-and-test"),
    );
    const produced = producer?.body as { value: { outputs: Record<string, string | null> } };
    expect(produced.value.outputs["build-test-results"]).toBe(
      "construction/build-and-test/test-results.md",
    );
  });

  it("resolves an input by the filename its producing stage actually writes", async () => {
    const recordDir = await seedRecord(["construction/build-and-test/test-results.md"]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=ci-pipeline"),
    );
    const body = result?.body as { value: { inputs: Record<string, string | null> } };
    expect(body.value.inputs["build-test-results"]).toBe(
      "construction/build-and-test/test-results.md",
    );
  });

  it("returns not-found for a prototype-chain stage name", async () => {
    const recordDir = await seedRecord([]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    await expect(
      routeRead(service.readContext, new URL("http://localhost/api/io-paths?stage=__proto__")),
    ).resolves.toEqual({
      status: 200,
      body: { error: true, reason: "not-found" },
    });
  });

  it("normalizes padded stage for lookup, resolve, and response", async () => {
    const recordDir = await seedRecord([
      "construction/u/functional-design/business-rules.md",
      "construction/u/code-generation/code-summary.md",
    ]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=%20code-generation%20&unit=u"),
    );

    expect(result?.body).toMatchObject({
      ok: true,
      value: {
        stage: "code-generation",
        unit: "u",
        outputs: {
          "code-summary": "construction/u/code-generation/code-summary.md",
        },
      },
    });
  });

  it("maps every logical input and output for the selected unit", async () => {
    const recordDir = await seedRecord([
      "inception/requirements-analysis/requirements.md",
      "construction/reader-core/functional-design/rules.md",
      "construction/other-unit/functional-design/rules.md",
    ]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=functional-design&unit=reader-core"),
    );

    expect(result?.status).toBe(200);
    expect(result?.body).toMatchObject({
      ok: true,
      value: {
        stage: "functional-design",
        unit: "reader-core",
        inputs: {
          requirements: "inception/requirements-analysis/requirements.md",
        },
        outputs: {
          rules: "construction/reader-core/functional-design/rules.md",
        },
      },
    });
    const body = result?.body as {
      ok: true;
      value: { inputs: Record<string, string | null>; outputs: Record<string, string | null> };
    };
    expect(Object.keys(body.value.inputs)).toEqual(bridgeMap.stages["functional-design"]?.inputs);
    expect(Object.keys(body.value.outputs)).toEqual(bridgeMap.stages["functional-design"]?.outputs);
    expect(body.value.outputs.rules).not.toContain("other-unit");
  });

  it("uses the current map I/O for v8 domain-design", async () => {
    const recordDir = await seedRecord([
      "inception/domain-design/components.md",
      "inception/domain-design/decisions.md",
      "inception/domain-design/traceability.md",
    ]);
    const service = createGuideService({ versionGate: null, workspaceRoot: recordDir, recordDir });

    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/io-paths?stage=domain-design"),
    );

    expect(result?.status).toBe(200);
    const body = result?.body as {
      ok: true;
      value: { stage: string; outputs: Record<string, string | null> };
    };
    expect(body.value.stage).toBe("domain-design");
    expect(Object.keys(body.value.outputs)).toEqual(bridgeMap.stages["domain-design"]?.outputs);
    expect(body.value.outputs.traceability).toBe("inception/domain-design/traceability.md");
    expect(body.value.outputs).not.toHaveProperty("component-methods");
  });
});
