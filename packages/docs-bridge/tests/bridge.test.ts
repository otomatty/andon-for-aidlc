import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridge } from "../src/index.ts";
import { expectError, expectOk, REPO_ROOT } from "./paths.ts";

let root: string;

async function bridgeWith(config: unknown) {
  const file = path.join(root, "andon.config.json");
  await writeFile(file, JSON.stringify(config));
  return createBridge(file);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "docs-bridge-facade-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createBridge", () => {
  it("works with no config file at all", async () => {
    const bridge = createBridge(path.join(root, "absent.json"));
    expect(expectOk(await bridge.getConfig()).value).toEqual({
      docsRepoPath: null,
      projectLinks: [],
    });
    expect(expectOk(await bridge.resolveStage("intent-capture")).value.excerpt).toBeNull();
    expect(expectOk(await bridge.projectLinks()).value).toEqual([]);
  });

  it("threads the config into resolve without the caller passing it", async () => {
    const bridge = await bridgeWith({ docsRepoPath: REPO_ROOT });
    const { value } = expectOk(await bridge.resolveStage("units-generation"));
    expect(value.excerpt?.startsWith("# Units Generation")).toBe(true);
  });

  it("returns the project links from the config (D4)", async () => {
    const links = [{ label: "Team wiki", target: "https://example.invalid/wiki" }];
    const bridge = await bridgeWith({ projectLinks: links });
    expect(expectOk(await bridge.projectLinks()).value).toEqual(links);
  });

  it("propagates a config warning onto every method's result", async () => {
    const bridge = await bridgeWith({ docsRepoPath: "./missing-docs" });
    const stage = expectOk(await bridge.resolveStage("build-and-test"));
    expect(stage.warnings[0]).toMatch(/does not exist/);
    expect(expectOk(await bridge.projectLinks()).warnings[0]).toMatch(/does not exist/);
  });

  it("surfaces a broken config as config-invalid on every method", async () => {
    await writeFile(path.join(root, "andon.config.json"), "{ broken");
    const bridge = createBridge(path.join(root, "andon.config.json"));
    expect(expectError(await bridge.getConfig())).toBe("config-invalid");
    expect(expectError(await bridge.resolveStage("ci-pipeline"))).toBe("config-invalid");
    expect(expectError(await bridge.projectLinks())).toBe("config-invalid");
  });

  it("loads the config once, so editing it mid-process does not change answers", async () => {
    const file = path.join(root, "andon.config.json");
    await writeFile(file, JSON.stringify({ projectLinks: [{ label: "A", target: "a" }] }));
    const bridge = createBridge(file);
    expect(expectOk(await bridge.projectLinks()).value).toHaveLength(1);
    await writeFile(file, JSON.stringify({ projectLinks: [] }));
    // Documented lifecycle: the map and config are loaded once and a change is
    // picked up on restart (domain-entities.md "watch しない").
    expect(expectOk(await bridge.projectLinks()).value).toHaveLength(1);
  });

  it("answers an unknown stage with not-found at the facade", async () => {
    const bridge = createBridge(path.join(root, "absent.json"));
    expect(expectError(await bridge.resolveStage("nope"))).toBe("not-found");
  });
});
