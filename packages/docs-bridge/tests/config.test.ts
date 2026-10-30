import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, loadConfig } from "../src/config.ts";
import { expectError, expectOk } from "./paths.ts";

let root: string;

const configAt = (name: string) => path.join(root, name);

async function writeConfig(body: string, name = CONFIG_FILENAME): Promise<string> {
  const file = configAt(name);
  await writeFile(file, body);
  return file;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "docs-bridge-config-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("falls back to the defaults when the file does not exist", async () => {
    const { value, warnings } = expectOk(await loadConfig(configAt("nowhere.json")));
    expect(value).toEqual({ docsRepoPath: null, projectLinks: [] });
    expect(warnings).toEqual([]);
  });

  it("looks for andon.config.json in the cwd when the path is omitted", async () => {
    const cwd = process.cwd();
    try {
      process.chdir(root);
      await writeConfig(
        JSON.stringify({ projectLinks: [{ label: "Runbook", target: "./ops.md" }] }),
      );
      const { value } = expectOk(await loadConfig());
      expect(value.projectLinks).toEqual([{ label: "Runbook", target: "./ops.md" }]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("reports config-invalid for malformed JSON", async () => {
    const file = await writeConfig("{ docsRepoPath: ");
    expect(expectError(await loadConfig(file))).toBe("config-invalid");
  });

  it("reports config-invalid when the root is not an object", async () => {
    const file = await writeConfig('["not", "a", "config"]');
    expect(expectError(await loadConfig(file))).toBe("config-invalid");
  });

  it("reports config-invalid when docsRepoPath has the wrong type", async () => {
    const file = await writeConfig(JSON.stringify({ docsRepoPath: 42 }));
    expect(expectError(await loadConfig(file))).toBe("config-invalid");
  });

  it("reports config-invalid when the config path is a directory, not a file", async () => {
    await mkdir(configAt("adir"));
    expect(expectError(await loadConfig(configAt("adir")))).toBe("config-invalid");
  });

  it("warns but stays ok when docsRepoPath points nowhere (fail-soft)", async () => {
    const file = await writeConfig(JSON.stringify({ docsRepoPath: "./no-such-docs" }));
    const { value, warnings } = expectOk(await loadConfig(file));
    expect(value.docsRepoPath).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/does not exist/);
  });

  it("warns when docsRepoPath is a file rather than a directory", async () => {
    await writeFile(configAt("README.md"), "# not a directory\n");
    const file = await writeConfig(JSON.stringify({ docsRepoPath: "./README.md" }));
    const { value, warnings } = expectOk(await loadConfig(file));
    expect(value.docsRepoPath).toBeNull();
    expect(warnings[0]).toMatch(/not a directory/);
  });

  it("resolves a relative docsRepoPath against the config file's own directory", async () => {
    await mkdir(path.join(root, "checkout", "docs"), { recursive: true });
    await mkdir(path.join(root, "nested"));
    const file = await writeConfig(
      JSON.stringify({ docsRepoPath: "../checkout/docs" }),
      path.join("nested", CONFIG_FILENAME),
    );
    const { value, warnings } = expectOk(await loadConfig(file));
    expect(warnings).toEqual([]);
    expect(value.docsRepoPath).toBe(path.join(root, "checkout", "docs"));
  });

  it("drops malformed projectLinks entries instead of failing the load", async () => {
    const file = await writeConfig(
      JSON.stringify({ projectLinks: [{ label: "A", target: "a.md" }, { label: "B" }, "nope"] }),
    );
    const { value, warnings } = expectOk(await loadConfig(file));
    expect(value.projectLinks).toEqual([{ label: "A", target: "a.md" }]);
    expect(warnings).toHaveLength(2);
  });

  it("ignores a projectLinks value that is not an array", async () => {
    const file = await writeConfig(JSON.stringify({ projectLinks: { label: "A" } }));
    const { value, warnings } = expectOk(await loadConfig(file));
    expect(value.projectLinks).toEqual([]);
    expect(warnings[0]).toMatch(/not an array/);
  });

  it("ignores the retired docsBaseUrl and stageDocs keys without a warning", async () => {
    const file = await writeConfig(
      JSON.stringify({
        docsBaseUrl: "https://github.com/org/repo/blob/main",
        stageDocs: { "intent-capture": "https://confluence.example.com/wiki/spaces/X/pages/1" },
      }),
    );
    const { value, warnings } = expectOk(await loadConfig(file));
    expect(value).toEqual({ docsRepoPath: null, projectLinks: [] });
    expect(warnings).toEqual([]);
  });
});
