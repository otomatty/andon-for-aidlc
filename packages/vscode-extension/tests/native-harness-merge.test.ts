import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalPathSync } from "@andon/core-utils";
import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyHarnessCandidate,
  GUIDE_INSTALL_FILE,
  planHarnessCandidate,
  priorHarnessVersionForReconciliation,
} from "../src/native-harness-merge.ts";

const fsFaults = vi.hoisted(() => ({
  mkdir: undefined as ((file: string) => void) | undefined,
  unlink: undefined as ((file: string) => void) | undefined,
  write: undefined as ((file: string) => void) | undefined,
  link: undefined as ((source: string, destination: string) => void) | undefined,
}));
const lockCalls = vi.hoisted(() => ({ roots: [] as string[] }));
vi.mock("../src/native-workspace-lock.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/native-workspace-lock.ts")>();
  return {
    ...actual,
    acquireNativeWorkspaceLock: (
      ...args: Parameters<typeof actual.acquireNativeWorkspaceLock>
    ) => {
      lockCalls.roots.push(args[0]);
      return actual.acquireNativeWorkspaceLock(...args);
    },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => {
      fsFaults.mkdir?.(String(args[0]));
      return actual.mkdirSync(...args);
    },
    unlinkSync: (...args: Parameters<typeof actual.unlinkSync>) => {
      fsFaults.unlink?.(String(args[0]));
      return actual.unlinkSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      fsFaults.write?.(String(args[0]));
      return actual.writeFileSync(...args);
    },
    linkSync: (...args: Parameters<typeof actual.linkSync>) => {
      fsFaults.link?.(String(args[0]), String(args[1]));
      return actual.linkSync(...args);
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  fsFaults.mkdir = undefined;
  fsFaults.unlink = undefined;
  fsFaults.write = undefined;
  fsFaults.link = undefined;
  lockCalls.roots.length = 0;
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function temp(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aidlc-harness-merge-"));
  roots.push(root);
  return root;
}

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function read(root: string, relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function hash(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function locks(root: string): { lock: string; gate: string } {
  const resolved = realpathSync(root);
  const canonical = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const bucket = createHash("md5").update(`${canonical}\0__workspace__`).digest("hex").slice(0, 8);
  const lock = path.join(tmpdir(), `.aidlc-audit-${bucket}.lock`);
  const gate = `${lock}.reap`;
  roots.push(lock, gate);
  return { lock, gate };
}

const skillPath = ".cursor/skills/aidlc/SKILL.md";
const dataDir = ".cursor/tools/data";
const memoryPath = "aidlc/spaces/default/memory/org.md";

function candidate(version = "2.8.0", skill = "Cursor workflow\n"): string {
  const root = temp();
  const stamp = {
    schemaVersion: 1,
    frameworkVersion: version,
    distribution: "cursor",
    harnessDir: ".cursor",
  };
  const projection = {
    schemaVersion: 1,
    distribution: "cursor",
    productName: "Cursor",
    configNextStep: "Open Cursor and run /aidlc --doctor",
    harnessDir: ".cursor",
    managedDirectories: [".cursor", "aidlc"],
    rootIntegrations: [
      { path: ".gitignore", policy: "managed-block", marker: "gitignore" },
      { path: "AGENTS.md", policy: "managed-block", marker: "agents" },
      { path: "install.ts", policy: "whole-file" },
    ],
  };
  const managed: Record<string, string> = {
    [skillPath]: skill,
    ".cursor/tools/aidlc-version.ts": `export const AIDLC_VERSION = "${version}";\n`,
    [`${dataDir}/aidlc-stamp.json`]: JSON.stringify(stamp),
    [`${dataDir}/aidlc-projection.json`]: JSON.stringify(projection),
  };
  for (const [relative, text] of Object.entries(managed)) write(root, relative, text);
  const ignore = "# BEGIN AI-DLC:gitignore\n.cursor/cache\n# END AI-DLC:gitignore";
  const agents = "<!-- BEGIN AI-DLC:agents -->\nUse Cursor for AI-DLC.\n<!-- END AI-DLC:agents -->";
  const installer = "// Cursor installer\n";
  write(root, ".gitignore", `${ignore}\n`);
  write(root, "AGENTS.md", `${agents}\n`);
  write(root, "install.ts", installer);
  write(root, memoryPath, "Framework method\n");
  write(root, "aidlc/active-space", "default\n");
  write(
    root,
    `${dataDir}/aidlc-manifest.json`,
    JSON.stringify({
      ...stamp,
      mcpMode: "none",
      files: Object.fromEntries(
        Object.entries(managed).map(([relative, text]) => [relative, hash(text)]),
      ),
      rootContributions: {
        ".gitignore": { policy: "managed-block", hash: hash(ignore), marker: "gitignore" },
        "AGENTS.md": { policy: "managed-block", hash: hash(agents), marker: "agents" },
        "install.ts": { policy: "whole-file", hash: hash(installer) },
      },
    }),
  );
  return root;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function jsonIntegration(
  source: string,
  policy: "json-array" | "json-map",
  values: string[] | Record<string, unknown>,
  key = policy === "json-array" ? "kiroAgent.trustedCommands" : "mcpServers",
  relative = policy === "json-array" ? ".vscode/settings.json" : ".mcp.json",
): void {
  write(source, relative, JSON.stringify({ [key]: values }));
  const manifest = JSON.parse(read(source, `${dataDir}/aidlc-manifest.json`));
  const entries = Array.isArray(values)
    ? Object.fromEntries(values.map((value) => [value, hash(canonical(value))]))
    : Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, hash(canonical(value))]),
      );
  manifest.rootContributions[relative] = { policy, key, entries };
  write(source, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));
}

function omitContributions(source: string, ...relative: string[]): void {
  const manifest = JSON.parse(read(source, `${dataDir}/aidlc-manifest.json`));
  for (const name of relative) delete manifest.rootContributions[name];
  write(source, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));
}

describe("native harness candidate merge", () => {
  it("upgrades selected-plugin output only when it matches an independent prior-release replay", async () => {
    const root = temp();
    const initial = candidate();
    write(initial, `${dataDir}/stage-graph.json`, '{"plugins":["aidlc"]}');
    await applyHarnessCandidate(initial, root, "cursor", "2.8.0");
    expect(priorHarnessVersionForReconciliation(root, "cursor", "2.8.1")).toBeNull();
    const selectedSkill = "Cursor workflow with selected plugin stages\n";
    const oldGraph = '{"plugins":["aidlc","test-pro"],"runtime":"2.8.0"}';
    write(root, skillPath, selectedSkill);
    write(root, `${dataDir}/stage-graph.json`, oldGraph);
    write(root, `${dataDir}/harness.json`, '{"plugins":["aidlc","test-pro"]}');
    const priorCandidate = candidate("2.8.0", selectedSkill);
    write(priorCandidate, `${dataDir}/stage-graph.json`, oldGraph);
    write(priorCandidate, `${dataDir}/harness.json`, '{"plugins":["aidlc","test-pro"]}');
    const next = candidate("2.8.1", "Updated workflow with selected plugin stages\n");
    write(
      next,
      `${dataDir}/stage-graph.json`,
      '{"plugins":["aidlc","test-pro"],"runtime":"2.8.1"}',
    );
    write(next, `${dataDir}/harness.json`, '{"plugins":["aidlc","test-pro"],"newRuntime":true}');

    expect(priorHarnessVersionForReconciliation(root, "cursor", "2.8.1")).toBe("2.8.0");
    expect(priorHarnessVersionForReconciliation(root, "cursor", "2.8.0")).toBeNull();
    await expect(planHarnessCandidate(next, root, "cursor", "2.8.1")).rejects.toThrow(
      "競合しています",
    );
    const plan = await planHarnessCandidate(next, root, "cursor", "2.8.1", { priorCandidate });
    await applyHarnessCandidate(next, root, "cursor", "2.8.1", { ...plan, priorCandidate });

    expect(read(root, skillPath)).toBe(read(next, skillPath));
    expect(read(root, `${dataDir}/stage-graph.json`)).toBe(
      read(next, `${dataDir}/stage-graph.json`),
    );
    expect(JSON.parse(read(root, `${dataDir}/${GUIDE_INSTALL_FILE}`)).files[skillPath]).toBe(
      hash(read(next, skillPath)),
    );
    expect(priorHarnessVersionForReconciliation(root, "cursor", "2.8.2")).toBeNull();
  });

  it.each([skillPath, `${dataDir}/stage-graph.json`])(
    "retains user edits to %s even with a valid prior-release replay",
    async (relative) => {
      const root = temp();
      const first = candidate();
      write(first, `${dataDir}/stage-graph.json`, '{"plugins":["aidlc"]}');
      await applyHarnessCandidate(first, root, "cursor", "2.8.0");
      const priorCandidate = candidate("2.8.0", "Selected plugin stages\n");
      write(priorCandidate, `${dataDir}/stage-graph.json`, '{"plugins":["test-pro"]}');
      const next = candidate("2.8.1", "Updated selected plugin stages\n");
      write(next, `${dataDir}/stage-graph.json`, '{"plugins":["test-pro"],"newRuntime":true}');
      write(root, skillPath, read(priorCandidate, skillPath));
      write(
        root,
        `${dataDir}/stage-graph.json`,
        read(priorCandidate, `${dataDir}/stage-graph.json`),
      );
      write(root, relative, "User's local adjustment\n");
      const receipt = read(root, `${dataDir}/${GUIDE_INSTALL_FILE}`);

      await expect(
        applyHarnessCandidate(next, root, "cursor", "2.8.1", { priorCandidate }),
      ).rejects.toThrow("競合しています");

      expect(read(root, relative)).toBe("User's local adjustment\n");
      expect(read(root, `${dataDir}/${GUIDE_INSTALL_FILE}`)).toBe(receipt);
    },
  );

  it.each([false, true])(
    "reconciles retired plugin-generated runners only with unchanged replayed bytes: edited=%s",
    async (edited) => {
      const root = temp();
      await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
      const runner = ".cursor/skills/test-pro-retired/SKILL.md";
      const content = "generated-by: aidlc-runner-gen\nRetired plugin stage\n";
      write(root, runner, edited ? "User's runner changes\n" : content);
      const priorCandidate = candidate();
      write(priorCandidate, runner, content);
      const next = candidate("2.8.1");

      const result = applyHarnessCandidate(next, root, "cursor", "2.8.1", { priorCandidate });

      if (edited) {
        await expect(result).rejects.toThrow("編集されています");
        expect(read(root, runner)).toBe("User's runner changes\n");
      } else {
        await expect(result).resolves.toBeUndefined();
        expect(existsSync(path.join(root, runner))).toBe(false);
      }
    },
  );

  it("rejects a replay from the wrong release and a replay with unverified managed bytes", async () => {
    const root = temp();
    await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
    const next = candidate("2.8.1");
    await expect(
      applyHarnessCandidate(next, root, "cursor", "2.8.1", { priorCandidate: candidate("2.7.0") }),
    ).rejects.toThrow("バージョン・ツール");
    const unverified = candidate();
    write(unverified, skillPath, "Unexpected replay bytes\n");
    await expect(
      applyHarnessCandidate(next, root, "cursor", "2.8.1", { priorCandidate: unverified }),
    ).rejects.toThrow("マニフェストと一致しません");
    expect(read(root, skillPath)).toBe("Cursor workflow\n");
  });

  it("retires replaced trusted commands, preserves user commands, and advances array ownership", async () => {
    const root = temp();
    write(
      root,
      ".vscode/settings.json",
      JSON.stringify({ "kiroAgent.trustedCommands": ["user", "shared"], "editor.tabSize": 2 }),
    );
    const first = candidate();
    jsonIntegration(first, "json-array", ["old", "shared"]);
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    const next = candidate("2.8.1");
    jsonIntegration(next, "json-array", ["new", "shared"]);

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(JSON.parse(read(root, ".vscode/settings.json"))).toEqual({
      "kiroAgent.trustedCommands": ["user", "shared", "new"],
      "editor.tabSize": 2,
    });
    const baseline = JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`));
    expect(baseline.rootContributions[".vscode/settings.json"].entries).toEqual({
      new: hash(JSON.stringify("new")),
    });
    await applyHarnessCandidate(candidate("2.8.2"), root, "cursor", "2.8.2");
    expect(JSON.parse(read(root, ".vscode/settings.json"))["kiroAgent.trustedCommands"]).toEqual([
      "user",
      "shared",
    ]);
    expect(
      JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`)).rootContributions[
        ".vscode/settings.json"
      ],
    ).toBeUndefined();
  });

  it.each(["json-array", "json-map"] as const)(
    "rejects %s values that disagree with candidate entry hashes",
    async (policy) => {
      const source = candidate();
      const root = temp();
      jsonIntegration(
        source,
        policy,
        policy === "json-array" ? ["safe"] : { tool: { command: "safe" } },
      );
      const relative = policy === "json-array" ? ".vscode/settings.json" : ".mcp.json";
      write(source, relative, read(source, relative).replace("safe", "unexpected"));

      await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow(
        "マニフェストと一致しません",
      );
      expect(existsSync(path.join(root, ".cursor"))).toBe(false);
      expect(existsSync(path.join(root, relative))).toBe(false);
    },
  );

  it.each(["json-array", "json-map"] as const)(
    "does not claim identical user-owned %s entries",
    async (policy) => {
      const root = temp();
      const source = candidate();
      const values =
        policy === "json-array"
          ? ["shared"]
          : { shared: { command: "user", env: { B: "2", A: "1" } } };
      jsonIntegration(source, policy, values);
      const relative = policy === "json-array" ? ".vscode/settings.json" : ".mcp.json";
      const original = read(source, relative);
      write(root, relative, original);

      await applyHarnessCandidate(source, root, "cursor", "2.8.0");
      expect(
        JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`)).rootContributions[relative]
          .entries,
      ).toEqual({});
      await applyHarnessCandidate(candidate("2.8.1"), root, "cursor", "2.8.1");
      expect(read(root, relative)).toBe(original);
    },
  );

  it("updates owned map entries, removes retired entries, and preserves unrelated user settings", async () => {
    const root = temp();
    write(
      root,
      ".mcp.json",
      JSON.stringify({ mcpServers: { user: { command: "custom" } }, note: "keep" }),
    );
    const first = candidate();
    jsonIntegration(first, "json-map", {
      existing: { command: "old" },
      retired: { command: "unused" },
    });
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    const source = candidate("2.8.1");
    jsonIntegration(source, "json-map", { existing: { command: "new", env: { B: "2", A: "1" } } });

    await applyHarnessCandidate(source, root, "cursor", "2.8.1");

    expect(JSON.parse(read(root, ".mcp.json"))).toEqual({
      mcpServers: {
        user: { command: "custom" },
        existing: { command: "new", env: { A: "1", B: "2" } },
      },
      note: "keep",
    });
    expect(
      JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`)).rootContributions[".mcp.json"]
        .entries,
    ).toEqual({ existing: hash('{"command":"new","env":{"A":"1","B":"2"}}') });
    await applyHarnessCandidate(candidate("2.8.2"), root, "cursor", "2.8.2");
    expect(JSON.parse(read(root, ".mcp.json"))).toEqual({
      mcpServers: { user: { command: "custom" } },
      note: "keep",
    });
  });

  it("preserves empty user MCP settings when the candidate has no owned entries", async () => {
    const root = temp();
    const source = candidate();
    jsonIntegration(source, "json-map", {});
    await rm(path.join(source, ".mcp.json"));
    const original = '{ "mcpServers": {}, "note": "user" }\n';
    write(root, ".mcp.json", original);

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(read(root, ".mcp.json")).toBe(original);
  });

  it.each(["absent", "empty"])(
    "retires owned MCP entries when the next integration is %s",
    async (mode) => {
      const root = temp();
      const source = candidate();
      jsonIntegration(source, "json-map", { retired: { command: "old" } });
      await applyHarnessCandidate(source, root, "cursor", "2.8.0");
      const next = candidate("2.8.1");
      if (mode === "empty") {
        jsonIntegration(next, "json-map", {});
        await rm(path.join(next, ".mcp.json"));
      }

      await applyHarnessCandidate(next, root, "cursor", "2.8.1");

      expect(JSON.parse(read(root, ".mcp.json"))).toEqual({});
    },
  );

  it.each(["absent", "empty"])(
    "retains edited owned JSON entries and baseline if next integration is %s",
    async (mode) => {
      const root = temp();
      const source = candidate();
      jsonIntegration(source, "json-map", { retired: { command: "old" } });
      await applyHarnessCandidate(source, root, "cursor", "2.8.0");
      const changed = '{"mcpServers":{"retired":{"command":"user edit"}},"keep":true}';
      write(root, ".mcp.json", changed);
      const before = read(root, `${dataDir}/aidlc-manifest.json`);
      const next = candidate("2.8.1");
      if (mode === "empty") jsonIntegration(next, "json-map", {});

      await expect(applyHarnessCandidate(next, root, "cursor", "2.8.1")).rejects.toThrow(
        "編集されています",
      );

      expect(read(root, ".mcp.json")).toBe(changed);
      expect(read(root, `${dataDir}/aidlc-manifest.json`)).toBe(before);
    },
  );

  it("removes only retired managed blocks and leaves unrelated bytes untouched", async () => {
    const root = temp();
    await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
    const before = read(root, "AGENTS.md");
    const shared = `${before}\n<!-- BEGIN AI-DLC:other -->\nOther tool\n<!-- END AI-DLC:other -->\nUser suffix\n`;
    write(root, "AGENTS.md", shared);
    const next = candidate("2.8.1");
    omitContributions(next, "AGENTS.md", ".gitignore", "install.ts");

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(read(root, "AGENTS.md")).toBe(shared.replace(before.trimEnd(), ""));
    expect(read(root, ".gitignore")).not.toContain("guide-cursor");
    expect(existsSync(path.join(root, "install.ts"))).toBe(false);
    expect(JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`)).rootContributions).toEqual({});
    expect(
      JSON.parse(read(root, `${dataDir}/${GUIDE_INSTALL_FILE}`)).files["install.ts"],
    ).toBeUndefined();
  });

  it.each(["AGENTS.md", "install.ts"])(
    "preserves an edited retired %s and does not advance ownership",
    async (relative) => {
      const root = temp();
      await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
      const changed = read(root, relative).replace(
        relative === "AGENTS.md" ? "Use Cursor" : "installer",
        "User edit",
      );
      write(root, relative, changed);
      const next = candidate("2.8.1");
      omitContributions(next, relative);

      await expect(applyHarnessCandidate(next, root, "cursor", "2.8.1")).rejects.toThrow(
        "編集されています",
      );

      expect(read(root, relative)).toBe(changed);
      expect(JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`)).frameworkVersion).toBe(
        "2.8.0",
      );
    },
  );

  it("accepts already absent retired files and entries", async () => {
    const root = temp();
    const first = candidate();
    jsonIntegration(first, "json-map", { retired: { command: "old" } });
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    await rm(path.join(root, "AGENTS.md"));
    await rm(path.join(root, "install.ts"));
    write(root, ".mcp.json", '{"user":true}');
    const next = candidate("2.8.1");
    omitContributions(next, "AGENTS.md", "install.ts");

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    expect(existsSync(path.join(root, "install.ts"))).toBe(false);
    expect(read(root, ".mcp.json")).toBe('{"user":true}');
  });

  it("retires the old managed block when the candidate marker changes", async () => {
    const root = temp();
    await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
    const next = candidate("2.8.1");
    const incoming = read(next, "AGENTS.md").replaceAll("AI-DLC:agents", "AI-DLC:new-agents");
    write(next, "AGENTS.md", incoming);
    const manifest = JSON.parse(read(next, `${dataDir}/aidlc-manifest.json`));
    manifest.rootContributions["AGENTS.md"] = {
      policy: "managed-block",
      marker: "new-agents",
      hash: hash(incoming.trimEnd()),
    };
    write(next, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(read(root, "AGENTS.md")).not.toContain("guide-cursor-agents");
    expect(read(root, "AGENTS.md")).toContain("guide-cursor-new-agents");
    expect(read(root, "AGENTS.md").match(/Use Cursor/g)).toHaveLength(1);
  });

  it("retires a prior JSON key before adding a new key in the same root file", async () => {
    const root = temp();
    const first = candidate();
    jsonIntegration(first, "json-array", ["old"], "oldCommands");
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    write(root, ".vscode/settings.json", '{"oldCommands":["old","user"],"editor.tabSize":2}');
    const next = candidate("2.8.1");
    jsonIntegration(next, "json-array", ["new"], "newCommands");

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(JSON.parse(read(root, ".vscode/settings.json"))).toEqual({
      oldCommands: ["user"],
      newCommands: ["new"],
      "editor.tabSize": 2,
    });
  });

  it("retires a whole-file integration before applying its replacement policy", async () => {
    const root = temp();
    await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
    const next = candidate("2.8.1");
    jsonIntegration(next, "json-map", { runner: { command: "new" } }, "tools", "install.ts");

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(JSON.parse(read(root, "install.ts"))).toEqual({ tools: { runner: { command: "new" } } });
    expect(
      JSON.parse(read(root, `${dataDir}/${GUIDE_INSTALL_FILE}`)).files["install.ts"],
    ).toBeUndefined();
    const shared = '{"tools":{"runner":{"command":"new"}},"user":true}';
    write(root, "install.ts", shared);
    await expect(
      applyHarnessCandidate(candidate("2.8.2"), root, "cursor", "2.8.2"),
    ).rejects.toThrow("競合しています");
    expect(read(root, "install.ts")).toBe(shared);
  });

  it.each(["lock", "gate"] as const)(
    "explains contention on the existing %s without changing it",
    async (target) => {
      const source = candidate();
      const root = temp();
      const paths = locks(root);
      mkdirSync(paths[target]);
      writeFileSync(path.join(paths[target], "owner.json"), "Existing owner\n");

      await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow(
        "このプロジェクトは別の処理で使用中です。完了後に再実行してください。",
      );

      expect(read(paths[target], "owner.json")).toBe("Existing owner\n");
      expect(existsSync(paths[target === "lock" ? "gate" : "lock"])).toBe(false);
      expect(existsSync(path.join(root, ".cursor"))).toBe(false);
    },
  );

  it.each(["lock", "gate"] as const)(
    "preserves permission failures acquiring the %s instead of reporting contention",
    async (target) => {
      const source = candidate();
      const root = temp();
      const paths = locks(root);
      const permissionError = Object.assign(new Error("mkdir permission denied"), {
        code: "EACCES",
      });
      fsFaults.mkdir = (file) => {
        if (file === paths[target]) throw permissionError;
      };

      await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toBe(
        permissionError,
      );

      expect(existsSync(paths.lock)).toBe(false);
      expect(existsSync(paths.gate)).toBe(false);
      expect(existsSync(path.join(root, ".cursor"))).toBe(false);
    },
  );

  it("retains the acquisition error when releasing the gate also fails", async () => {
    const source = candidate();
    const root = temp();
    const { lock, gate } = locks(root);
    const primary = Object.assign(new Error("lock permission denied"), { code: "EACCES" });
    const cleanup = new Error("gate release failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fsFaults.mkdir = (file) => {
      if (file === lock) throw primary;
    };
    fsFaults.unlink = (file) => {
      if (file === path.join(gate, "owner.json")) throw cleanup;
    };

    const result = applyHarnessCandidate(source, root, "cursor", "2.8.0");

    await expect(result).rejects.toBe(primary);
    expect(log).toHaveBeenCalledWith(expect.any(String), cleanup);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("releases the acquired workspace lock when releasing the gate fails", async () => {
    const source = candidate();
    const root = temp();
    const { lock, gate } = locks(root);
    const cleanup = new Error("gate release failed");
    fsFaults.unlink = (file) => {
      if (file === path.join(gate, "owner.json")) throw cleanup;
    };

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toBe(cleanup);

    expect(existsSync(lock)).toBe(false);
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("retains failed validation and records the secondary lock release failure", async () => {
    const source = candidate();
    const root = temp();
    const { lock } = locks(root);
    const primary = new Error("Selection changed");
    const cleanup = new Error("workspace lock release failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fsFaults.unlink = (file) => {
      if (file === path.join(lock, "owner.json")) throw cleanup;
    };

    const result = applyHarnessCandidate(source, root, "cursor", "2.8.0", {
      validateLocked: async () => {
        throw primary;
      },
    });

    await expect(result).rejects.toBe(primary);
    expect(log).toHaveBeenCalledWith(expect.any(String), cleanup);
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("retains the original failure even when recording cleanup diagnostics throws", async () => {
    const source = candidate();
    const root = temp();
    const { lock } = locks(root);
    const primary = new Error("Selection changed");
    fsFaults.unlink = (file) => {
      if (file === path.join(lock, "owner.json")) throw new Error("lock release failed");
    };
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("diagnostic sink failed");
    });

    await expect(
      applyHarnessCandidate(source, root, "cursor", "2.8.0", {
        validateLocked: async () => {
          throw primary;
        },
      }),
    ).rejects.toBe(primary);
  });

  it.each(["ENOSPC", "EIO"])(
    "removes partial staged bytes after a new-file write fails with %s",
    async (code) => {
      const source = candidate();
      const root = temp();
      const { lock, gate } = locks(root);
      const target = path.join(canonicalPathSync(root), ".cursor/tools/aidlc-version.ts");
      const primary = Object.assign(new Error("partial write failed"), { code });
      let partialFile = "";
      write(root, "AGENTS.md", "User instructions\n");
      fsFaults.write = (file) => {
        if (file !== target && !file.startsWith(`${target}.andon-`)) return;
        fsFaults.write = undefined;
        partialFile = file;
        writeFileSync(file, "partial bytes");
        throw primary;
      };

      await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toBe(primary);

      expect(partialFile).not.toBe("");
      expect(existsSync(partialFile)).toBe(false);
      expect(existsSync(target)).toBe(false);
      expect(existsSync(path.join(root, ".cursor"))).toBe(false);
      expect(read(root, "AGENTS.md")).toBe("User instructions\n");
      expect(existsSync(lock)).toBe(false);
      expect(existsSync(gate)).toBe(false);
    },
  );

  it("preserves an external file created before atomic publication returns EEXIST", async () => {
    const source = candidate();
    const root = temp();
    const { lock, gate } = locks(root);
    const target = path.join(canonicalPathSync(root), ".cursor/tools/aidlc-version.ts");
    let staged = "";
    fsFaults.link = (from, to) => {
      if (to !== target) return;
      staged = from;
      expect(readFileSync(from, "utf8")).toBe(read(source, ".cursor/tools/aidlc-version.ts"));
      writeFileSync(to, "Concurrent external file\n", { flag: "wx" });
    };

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toMatchObject({
      code: "EEXIST",
    });

    expect(staged).not.toBe("");
    expect(existsSync(staged)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("Concurrent external file\n");
    expect(existsSync(path.join(root, skillPath))).toBe(false);
    expect(existsSync(path.join(root, dataDir, GUIDE_INSTALL_FILE))).toBe(false);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(gate)).toBe(false);
  });

  it("reports lock release failure after successful writes", async () => {
    const source = candidate();
    const root = temp();
    const { lock } = locks(root);
    const cleanup = new Error("workspace lock release failed");
    fsFaults.unlink = (file) => {
      if (file === path.join(lock, "owner.json")) throw cleanup;
    };

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toBe(cleanup);

    expect(read(root, skillPath)).toBe("Cursor workflow\n");
    expect(existsSync(path.join(root, dataDir, GUIDE_INSTALL_FILE))).toBe(true);
  });

  it("locks the workspace by the path it was given, as the AI-DLC engine does", async () => {
    // The engine names its lock from realpathSync of its own project path. A path the
    // OS already resolved (8.3 names, subst drives) would name a different lock.
    const source = candidate();
    const destination = temp();
    const root = path.join(temp(), "project");
    symlinkSync(destination, root, process.platform === "win32" ? "junction" : "dir");

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(lockCalls.roots).toEqual([root]);
  });

  it.each([false, true])(
    "preserves apply and rollback diagnostics with a linked root: %s",
    async (linked) => {
      const source = candidate();
      const destination = temp();
      const root = linked ? path.join(temp(), "project") : destination;
      if (linked) symlinkSync(destination, root, process.platform === "win32" ? "junction" : "dir");
      // The merger resolves the project root before writing, including macOS temp aliases.
      const rollbackFile = path.join(canonicalPathSync(root), skillPath);
      const { lock } = locks(root);
      const rollback = new Error("rollback unlink failed");
      const cleanup = new Error("workspace lock release failed");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      fsFaults.unlink = (file) => {
        if (file === rollbackFile) throw rollback;
        if (file === path.join(lock, "owner.json")) throw cleanup;
      };
      const isCurrent = () => !existsSync(path.join(root, skillPath));

      const result = applyHarnessCandidate(source, root, "cursor", "2.8.0", { isCurrent });

      await expect(result).rejects.toThrow("プロジェクトの設定を中止しました。");
      await expect(result).rejects.toThrow("復元結果: Error: rollback unlink failed");
      expect(log).toHaveBeenCalledWith(expect.any(String), cleanup);
      expect(existsSync(rollbackFile)).toBe(true);
      expect(existsSync(path.join(root, dataDir, GUIDE_INSTALL_FILE))).toBe(false);
    },
  );

  it("adds Cursor alongside Claude while preserving complete root files and workflow records", async () => {
    const source = candidate();
    const root = temp();
    const ignore =
      "# user ignores\r\nsecrets/\r\n# BEGIN AI-DLC:gitignore\r\n.claude/cache\r\n# END AI-DLC:gitignore";
    const agents =
      "# Team instructions\r\nCustom rules.\r\n<!-- BEGIN AIDLC CURSOR -->\r\nLegacy instructions.\r\n<!-- END AIDLC CURSOR -->";
    write(root, ".gitignore", ignore);
    write(root, "AGENTS.md", agents);
    write(root, ".claude/skills/aidlc/SKILL.md", "Existing Claude workflow\n");
    write(root, "aidlc/spaces/default/intents/current/aidlc-state.md", "Active stage\n");

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(read(root, ".gitignore").startsWith(ignore)).toBe(true);
    expect(read(root, ".gitignore")).toContain("# BEGIN AI-DLC:guide-cursor-gitignore");
    expect(read(root, "AGENTS.md").startsWith(agents)).toBe(true);
    expect(read(root, "AGENTS.md")).toContain("<!-- BEGIN AI-DLC:guide-cursor-agents -->");
    expect(read(root, skillPath)).toBe("Cursor workflow\n");
    expect(read(root, ".claude/skills/aidlc/SKILL.md")).toBe("Existing Claude workflow\n");
    expect(read(root, "aidlc/spaces/default/intents/current/aidlc-state.md")).toBe(
      "Active stage\n",
    );
  });

  it("appends the framework part after the team's rules and omits generic installer patterns", async () => {
    const source = candidate();
    const root = temp();
    const incoming =
      "# BEGIN AI-DLC:gitignore\n*.local\n# AI-DLC\n.claude/settings.local.json\n# END AI-DLC:gitignore";
    write(source, ".gitignore", `${incoming}\n`);
    const manifest = JSON.parse(read(source, `${dataDir}/aidlc-manifest.json`));
    manifest.rootContributions[".gitignore"].hash = hash(incoming);
    write(source, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));
    const original = "*.local\n!config.local\n";
    write(root, ".gitignore", original);

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    const merged = read(root, ".gitignore");
    expect(merged.startsWith(`${original}\n# BEGIN AI-DLC:guide-cursor-gitignore\n`)).toBe(true);
    expect(merged.split("\n").filter((line) => line === "*.local")).toHaveLength(1);
    expect(merged.indexOf(".claude/settings.local.json")).toBeGreaterThan(
      merged.indexOf("!config.local"),
    );
    execFileSync("git", ["-C", root, "init", "--quiet"], { stdio: "pipe" });
    const match = execFileSync(
      "git",
      ["-C", root, "check-ignore", "--no-index", "-v", "config.local"],
      { encoding: "utf8" },
    );
    expect(match).toContain(":!config.local\tconfig.local");

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(read(root, ".gitignore")).toBe(merged);
  });

  it("seeds missing shared memory and preserves the existing method and active space", async () => {
    const source = candidate();
    const root = temp();
    write(source, "aidlc/spaces/default/memory/team.md", "Default team\n");
    write(root, memoryPath, "Our customised method\n");
    write(root, "aidlc/active-space", "engineering\n");

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(read(root, memoryPath)).toBe("Our customised method\n");
    expect(read(root, "aidlc/spaces/default/memory/team.md")).toBe("Default team\n");
    expect(read(root, "aidlc/active-space")).toBe("engineering\n");
  });

  it("refuses a candidate containing workflow records", async () => {
    const source = candidate();
    const root = temp();
    write(source, "aidlc/spaces/default/intents/unrelated/aidlc-state.md", "Do not copy\n");

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow();

    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
    expect(existsSync(path.join(root, "aidlc"))).toBe(false);
  });

  it("records Guide ownership and the installed root block identity for later updates", async () => {
    const source = candidate();
    const root = temp();

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    const receipt = JSON.parse(read(root, `${dataDir}/${GUIDE_INSTALL_FILE}`));
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      harness: "cursor",
      version: "2.8.0",
      files: { [skillPath]: hash(read(root, skillPath)) },
    });
    expect(receipt.files[memoryPath]).toBeUndefined();
    const manifest = JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`));
    expect(manifest.rootContributions["AGENTS.md"].marker).toBe("guide-cursor-agents");
    expect(manifest.rootContributions["AGENTS.md"].hash).toBe(
      hash(read(root, "AGENTS.md").trimEnd()),
    );
  });

  it("rejects a conflicting managed file without changing other files", async () => {
    const source = candidate();
    const root = temp();
    write(root, skillPath, "User's existing workflow\n");
    write(root, ".gitignore", "private/\n");

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow();

    expect(read(root, skillPath)).toBe("User's existing workflow\n");
    expect(read(root, ".gitignore")).toBe("private/\n");
    expect(existsSync(path.join(root, "AGENTS.md"))).toBe(false);
  });

  it("accepts identical managed files and does not duplicate its root blocks", async () => {
    const source = candidate();
    const root = temp();
    write(root, skillPath, read(source, skillPath));

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");
    const once = read(root, ".gitignore");
    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(read(root, ".gitignore")).toBe(once);
    expect(read(root, skillPath)).toBe(read(source, skillPath));
  });

  it("updates files previously installed by Guide when their contents are unchanged", async () => {
    const root = temp();
    await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
    write(root, "AGENTS.md", `${read(root, "AGENTS.md")}\nNew user instructions.\n`);

    await applyHarnessCandidate(
      candidate("2.8.1", "New Cursor workflow\n"),
      root,
      "cursor",
      "2.8.1",
    );

    expect(read(root, skillPath)).toBe("New Cursor workflow\n");
    expect(read(root, "AGENTS.md")).toContain("New user instructions.");
    expect(JSON.parse(read(root, `${dataDir}/aidlc-stamp.json`)).frameworkVersion).toBe("2.8.1");
  });

  it("refuses to overwrite edits to a previously installed managed file", async () => {
    const root = temp();
    await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
    write(root, skillPath, "Local adjustments\n");

    await expect(
      applyHarnessCandidate(candidate("2.8.1"), root, "cursor", "2.8.1"),
    ).rejects.toThrow();

    expect(read(root, skillPath)).toBe("Local adjustments\n");
    expect(JSON.parse(read(root, `${dataDir}/aidlc-stamp.json`)).frameworkVersion).toBe("2.8.0");
  });

  it("refuses to overwrite edits within a Guide root block", async () => {
    const root = temp();
    await applyHarnessCandidate(candidate(), root, "cursor", "2.8.0");
    const modified = read(root, "AGENTS.md").replace(
      "Use Cursor for AI-DLC.",
      "Customised Cursor instructions.",
    );
    write(root, "AGENTS.md", modified);

    await expect(
      applyHarnessCandidate(candidate("2.8.1"), root, "cursor", "2.8.1"),
    ).rejects.toThrow();

    expect(read(root, "AGENTS.md")).toBe(modified);
  });

  it("previews without writing and refuses a plan after the destination changes", async () => {
    const source = candidate();
    const root = temp();
    write(root, ".gitignore", "private/\n");
    const plan = await planHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(plan.planToken).toEqual(expect.any(String));
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
    expect(read(root, ".gitignore")).toBe("private/\n");
    write(root, ".gitignore", "private/\nnew-rule/\n");

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0", plan)).rejects.toThrow();
    expect(read(root, ".gitignore")).toBe("private/\nnew-rule/\n");
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("accepts a preview token for the same candidate and unchanged destination", async () => {
    const source = candidate();
    const root = temp();
    const plan = await planHarnessCandidate(source, root, "cursor", "2.8.0");

    await applyHarnessCandidate(source, root, "cursor", "2.8.0", plan);

    expect(read(root, skillPath)).toBe("Cursor workflow\n");
  });

  it("refuses a candidate file whose bytes disagree with its native manifest", async () => {
    const source = candidate();
    const root = temp();
    write(source, skillPath, "Unexpected replacement\n");

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow();
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it.each(["AGENTS.md", "install.ts"])(
    "refuses a changed root contribution %s whose native manifest hash no longer matches",
    async (relative) => {
      const source = candidate();
      const root = temp();
      const original = read(source, relative);
      write(
        source,
        relative,
        original.replace(relative === "AGENTS.md" ? "Use Cursor" : "installer", "Changed"),
      );

      await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow();

      expect(existsSync(path.join(root, ".cursor"))).toBe(false);
      expect(existsSync(path.join(root, relative))).toBe(false);
    },
  );

  it("rejects path traversal in a native file manifest", async () => {
    const source = candidate();
    const root = temp();
    const manifest = JSON.parse(read(source, `${dataDir}/aidlc-manifest.json`));
    manifest.files["../outside.txt"] = hash("escaped\n");
    write(source, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow();
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("rejects a destination directory symlink without writing to its target", async () => {
    const source = candidate();
    const root = temp();
    const outside = temp();
    write(outside, "keep.txt", "Outside project\n");
    symlinkSync(
      outside,
      path.join(root, ".cursor"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow();

    expect(read(outside, "keep.txt")).toBe("Outside project\n");
    expect(existsSync(path.join(outside, "skills"))).toBe(false);
  });

  it("runs the final locked validation before any writes", async () => {
    const source = candidate();
    const root = temp();
    const validateLocked = vi.fn(async () => {
      throw new Error("Selection changed");
    });
    const onApplyStart = vi.fn();

    await expect(
      applyHarnessCandidate(source, root, "cursor", "2.8.0", { validateLocked, onApplyStart }),
    ).rejects.toThrow("Selection changed");

    expect(validateLocked).toHaveBeenCalledOnce();
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("detects a destination edit made during final validation and preserves it", async () => {
    const source = candidate();
    const root = temp();
    write(root, ".gitignore", "original/\n");
    const validateLocked = async () => {
      write(root, ".gitignore", "concurrent-change/\n");
    };

    await expect(
      applyHarnessCandidate(source, root, "cursor", "2.8.0", { validateLocked }),
    ).rejects.toThrow();

    expect(read(root, ".gitignore")).toBe("concurrent-change/\n");
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("restores root files and removes new files when cancelled during writes", async () => {
    const source = candidate();
    const root = temp();
    const ignore = "private/\n";
    write(root, ".gitignore", ignore);
    const onApplyStart = vi.fn();
    let observedWrite = false;
    const isCurrent = () => {
      observedWrite ||=
        existsSync(path.join(root, skillPath)) || read(root, ".gitignore") !== ignore;
      return !observedWrite;
    };

    await expect(
      applyHarnessCandidate(source, root, "cursor", "2.8.0", { isCurrent, onApplyStart }),
    ).rejects.toThrow();

    expect(onApplyStart).toHaveBeenCalledOnce();
    expect(observedWrite).toBe(true);
    expect(read(root, ".gitignore")).toBe(ignore);
    expect(existsSync(path.join(root, skillPath))).toBe(false);
    expect(existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    expect(existsSync(path.join(root, memoryPath))).toBe(false);
  });
});

const settingsPath = ".vscode/settings.json";
const opencodePath = "opencode.json";

function contributionOf(root: string, relative: string): Record<string, unknown> | undefined {
  return JSON.parse(read(root, `${dataDir}/aidlc-manifest.json`)).rootContributions[relative];
}

/** A 2.11 candidate's .vscode/settings.json, created fresh by the native installer. */
function settingsIntegration(source: string, values: Record<string, unknown>): void {
  write(source, settingsPath, `${JSON.stringify(values, null, 2)}\n`);
  const manifest = JSON.parse(read(source, `${dataDir}/aidlc-manifest.json`));
  manifest.rootContributions[settingsPath] = {
    policy: "jsonc-settings",
    entries: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, hash(canonical(value))]),
    ),
    added: Object.keys(values).sort(),
    created: true,
  };
  write(source, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));
}

const methodGlob = "aidlc/spaces/default/memory/**/*.md";

function entryId(at: string[], item?: string): string {
  return JSON.stringify(item === undefined ? { path: at } : { path: at, item });
}

/** The native installer's json-entries ids: object paths, or one string of a string array. */
function entryHashes(value: Record<string, unknown>, at: string[] = []): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const where = [...at, key];
    if (child !== null && typeof child === "object" && !Array.isArray(child))
      Object.assign(entries, entryHashes(child as Record<string, unknown>, where));
    else if (Array.isArray(child))
      for (const item of child) {
        const slot =
          where.join(".") === "instructions" && item === methodGlob
            ? "aidlc/spaces/*/memory/**/*.md"
            : item;
        entries[entryId(where, slot)] = hash(canonical(slot));
      }
    else entries[entryId(where)] = hash(canonical(child));
  }
  return entries;
}

/** A 2.11 candidate's opencode.json, created fresh by the native installer. */
function entriesIntegration(source: string, value: Record<string, unknown>): void {
  write(source, opencodePath, `${JSON.stringify(value, null, 2)}\n`);
  const manifest = JSON.parse(read(source, `${dataDir}/aidlc-manifest.json`));
  manifest.rootContributions[opencodePath] = {
    policy: "json-entries",
    entries: entryHashes(value),
    created: true,
  };
  write(source, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));
}

describe("jsonc-settings shared settings", () => {
  const teamSettings = [
    "// Team editor settings",
    "{",
    "  // Wider tabs for this repo",
    '  "editor.tabSize": 4,',
    '  "chat.promptFiles": false, // the team keeps prompt files off',
    "}",
    "",
  ].join("\n");

  it("adds absent keys without touching team keys, values, or comments", async () => {
    const root = temp();
    write(root, settingsPath, teamSettings);
    const source = candidate();
    settingsIntegration(source, {
      "chat.promptFiles": true,
      "github.copilot.chat.codeGeneration.useInstructionFiles": true,
    });

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    const merged = read(root, settingsPath);
    // Every comment stays on the line of the member it annotates.
    for (const line of teamSettings.split("\n").slice(0, 5)) expect(merged).toContain(line);
    expect(parseJsonc(merged)).toEqual({
      "editor.tabSize": 4,
      "chat.promptFiles": false,
      "github.copilot.chat.codeGeneration.useInstructionFiles": true,
    });
    expect(contributionOf(root, settingsPath)).toEqual({
      policy: "jsonc-settings",
      entries: {
        "github.copilot.chat.codeGeneration.useInstructionFiles": hash(canonical(true)),
      },
      added: ["github.copilot.chat.codeGeneration.useInstructionFiles"],
    });
  });

  it("creates a missing settings file as shipped and records it as created", async () => {
    const root = temp();
    const source = candidate();
    settingsIntegration(source, { "chat.promptFiles": true });

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(read(root, settingsPath)).toBe(read(source, settingsPath));
    expect(contributionOf(root, settingsPath)).toMatchObject({
      added: ["chat.promptFiles"],
      created: true,
    });
  });

  it("follows an owned unchanged key on upgrade and keeps a value the team changed", async () => {
    const root = temp();
    write(root, settingsPath, teamSettings);
    const first = candidate();
    settingsIntegration(first, { "aidlc.followed": "v1", "aidlc.teamEdited": "v1" });
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    write(
      root,
      settingsPath,
      read(root, settingsPath).replace('"aidlc.teamEdited": "v1"', '"aidlc.teamEdited": "ours"'),
    );
    const next = candidate("2.8.1");
    settingsIntegration(next, { "aidlc.followed": "v2", "aidlc.teamEdited": "v2" });

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    const merged = read(root, settingsPath);
    expect(merged).toContain("// the team keeps prompt files off");
    expect(parseJsonc(merged)).toMatchObject({
      "editor.tabSize": 4,
      "aidlc.followed": "v2",
      "aidlc.teamEdited": "ours",
    });
    expect(contributionOf(root, settingsPath)).toEqual({
      policy: "jsonc-settings",
      entries: { "aidlc.followed": hash(canonical("v2")) },
      added: ["aidlc.followed", "aidlc.teamEdited"],
    });
  });

  it("removes a retired owned key only while it still has the recorded value", async () => {
    const root = temp();
    write(root, settingsPath, teamSettings);
    const first = candidate();
    settingsIntegration(first, { "aidlc.kept": 1, "aidlc.retired": 1, "aidlc.edited": 1 });
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    write(
      root,
      settingsPath,
      read(root, settingsPath).replace('"aidlc.edited": 1', '"aidlc.edited": 2'),
    );
    const next = candidate("2.8.1");
    settingsIntegration(next, { "aidlc.kept": 1 });

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    const merged = read(root, settingsPath);
    expect(merged).toContain("// Wider tabs for this repo");
    expect(merged).toContain("// the team keeps prompt files off");
    expect(parseJsonc(merged)).toEqual({
      "editor.tabSize": 4,
      "chat.promptFiles": false,
      "aidlc.kept": 1,
      "aidlc.edited": 2,
    });
    expect(contributionOf(root, settingsPath)).toMatchObject({
      entries: { "aidlc.kept": hash(canonical(1)) },
    });
  });

  it("does not add back a key the team removed from a file it kept", async () => {
    const root = temp();
    write(root, settingsPath, teamSettings);
    const first = candidate();
    settingsIntegration(first, { "aidlc.optional": true });
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    write(root, settingsPath, teamSettings);
    const next = candidate("2.8.1");
    settingsIntegration(next, { "aidlc.optional": true });

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(read(root, settingsPath)).toBe(teamSettings);
    expect(contributionOf(root, settingsPath)).toEqual({
      policy: "jsonc-settings",
      entries: {},
      added: ["aidlc.optional"],
    });
  });

  it("removes a file it created once only its unchanged keys remain", async () => {
    const root = temp();
    const first = candidate();
    settingsIntegration(first, { "aidlc.only": true });
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");

    await applyHarnessCandidate(candidate("2.8.1"), root, "cursor", "2.8.1");

    expect(existsSync(path.join(root, settingsPath))).toBe(false);
    expect(contributionOf(root, settingsPath)).toBeUndefined();
  });

  it.each([
    ["not an object", "[1, 2]\n"],
    ["malformed", '{ "editor.tabSize": \n'],
    ["duplicated keys", '{ "chat.promptFiles": true, "chat.promptFiles": false }\n'],
  ])("refuses a team settings file (%s) and keeps it", async (_shape, text) => {
    const root = temp();
    write(root, settingsPath, text);
    const source = candidate();
    settingsIntegration(source, { "chat.promptFiles": true });

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow(
      "内容を保持しました",
    );

    expect(read(root, settingsPath)).toBe(text);
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("rejects a candidate whose settings disagree with its manifest entries", async () => {
    const root = temp();
    const source = candidate();
    settingsIntegration(source, { "chat.promptFiles": true });
    write(source, settingsPath, '{ "chat.promptFiles": false }\n');

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow(
      "マニフェストと一致しません",
    );
    expect(existsSync(path.join(root, settingsPath))).toBe(false);
  });
});

describe("json-entries shared opencode.json", () => {
  const shipped = {
    $schema: "https://opencode.ai/config.json",
    instructions: [methodGlob, ".aidlc/rules/aidlc.md"],
    permission: { bash: { "*": "ask", "aidlc *": "allow" } },
  };
  const teamConfig = [
    "{",
    "  // The team's model choice",
    '  "model": "anthropic/claude",',
    '  "instructions": ["TEAM.md"], // team rules first',
    '  "permission": { "bash": "deny" },',
    "}",
    "",
  ].join("\n");

  it("adds absent entries next to the team's keys, values, and comments", async () => {
    const root = temp();
    write(root, opencodePath, teamConfig);
    const source = candidate();
    entriesIntegration(source, shipped);

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    const merged = read(root, opencodePath);
    expect(merged).toContain("// The team's model choice\n");
    expect(merged).toMatch(/"\.aidlc\/rules\/aidlc\.md"\], \/\/ team rules first\n/);
    expect(parseJsonc(merged)).toEqual({
      model: "anthropic/claude",
      instructions: ["TEAM.md", methodGlob, ".aidlc/rules/aidlc.md"],
      permission: { bash: { "*": "deny", "aidlc *": "allow" } },
      $schema: "https://opencode.ai/config.json",
    });
    const all = entryHashes(shipped);
    const { [entryId(["permission", "bash", "*"])]: _teamRule, ...owned } = all;
    expect(contributionOf(root, opencodePath)).toEqual({ policy: "json-entries", entries: owned });
  });

  it("writes the shipped file when the project has none", async () => {
    const root = temp();
    const source = candidate();
    entriesIntegration(source, shipped);

    await applyHarnessCandidate(source, root, "cursor", "2.8.0");

    expect(read(root, opencodePath)).toBe(read(source, opencodePath));
    expect(contributionOf(root, opencodePath)).toEqual({
      policy: "json-entries",
      entries: entryHashes(shipped),
      created: true,
    });
  });

  it("follows owned unchanged entries, keeps team edits, and removes retired owned entries", async () => {
    const root = temp();
    write(root, opencodePath, teamConfig);
    const first = candidate();
    entriesIntegration(first, {
      ...shipped,
      permission: { bash: { "aidlc *": "allow", "aidlc status": "allow" } },
      agent: { aidlc: { mode: "subagent" } },
    });
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    write(
      root,
      opencodePath,
      read(root, opencodePath).replace('"aidlc status": "allow"', '"aidlc status": "deny"'),
    );
    const next = candidate("2.8.1");
    entriesIntegration(next, {
      ...shipped,
      instructions: [methodGlob, ".aidlc/rules/aidlc-next.md"],
      permission: { bash: { "aidlc *": "ask", "aidlc status": "ask" } },
    });

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    const merged = read(root, opencodePath);
    expect(merged).toContain("// The team's model choice");
    expect(parseJsonc(merged)).toEqual({
      model: "anthropic/claude",
      instructions: ["TEAM.md", methodGlob, ".aidlc/rules/aidlc-next.md"],
      permission: { bash: { "*": "deny", "aidlc *": "ask", "aidlc status": "deny" } },
      $schema: "https://opencode.ai/config.json",
    });
    const entries = contributionOf(root, opencodePath)?.entries as Record<string, string>;
    expect(entries[entryId(["permission", "bash", "aidlc *"])]).toBe(hash(canonical("ask")));
    expect(entries[entryId(["permission", "bash", "aidlc status"])]).toBeUndefined();
    expect(entries[entryId(["instructions"], ".aidlc/rules/aidlc-next.md")]).toBeDefined();
    expect(entries[entryId(["instructions"], ".aidlc/rules/aidlc.md")]).toBeUndefined();
    expect(entries[entryId(["agent", "aidlc", "mode"])]).toBeUndefined();
  });

  it("removes its created file once only its unchanged entries remain", async () => {
    const root = temp();
    const first = candidate();
    entriesIntegration(first, shipped);
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");

    await applyHarnessCandidate(candidate("2.8.1"), root, "cursor", "2.8.1");

    expect(existsSync(path.join(root, opencodePath))).toBe(false);
  });

  it("adopts a file it once wrote whole and keeps the team's edits", async () => {
    const root = temp();
    const first = candidate();
    const whole = `${JSON.stringify(shipped, null, 2)}\n`;
    write(first, opencodePath, whole);
    const manifest = JSON.parse(read(first, `${dataDir}/aidlc-manifest.json`));
    manifest.rootContributions[opencodePath] = { policy: "whole-file", hash: hash(whole) };
    write(first, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));
    await applyHarnessCandidate(first, root, "cursor", "2.8.0");
    write(root, opencodePath, whole.replace('"aidlc *": "allow"', '"aidlc *": "deny"'));
    const next = candidate("2.8.1");
    entriesIntegration(next, { ...shipped, permission: { bash: { "*": "ask", "aidlc *": "ask" } } });

    await applyHarnessCandidate(next, root, "cursor", "2.8.1");

    expect(parseJsonc(read(root, opencodePath)).permission).toEqual({
      bash: { "*": "ask", "aidlc *": "deny" },
    });
    expect(contributionOf(root, opencodePath)).toMatchObject({ created: true });
  });

  it.each([
    ["an array where AI-DLC adds strings", '{ "instructions": "TEAM.md" }\n'],
    ["an object where AI-DLC adds a rule", '{ "permission": ["bash"] }\n'],
    ["not an object", "[]\n"],
    ["malformed", '{ "model": \n'],
  ])("refuses a team opencode.json (%s) and keeps it", async (_shape, text) => {
    const root = temp();
    write(root, opencodePath, text);
    const source = candidate();
    entriesIntegration(source, shipped);

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow(
      "内容を保持しました",
    );

    expect(read(root, opencodePath)).toBe(text);
    expect(existsSync(path.join(root, ".cursor"))).toBe(false);
  });

  it("rejects a candidate whose entries disagree with its manifest", async () => {
    const root = temp();
    const source = candidate();
    entriesIntegration(source, shipped);
    write(source, opencodePath, JSON.stringify({ ...shipped, extra: true }));

    await expect(applyHarnessCandidate(source, root, "cursor", "2.8.0")).rejects.toThrow(
      "マニフェストと一致しません",
    );
  });
});

describe("2.11 .gitignore block placement", () => {
  function ignoreCandidate(version: string, rules: string[]): string {
    const source = candidate(version);
    const block = ["# BEGIN AI-DLC:gitignore", ...rules, "# END AI-DLC:gitignore"].join("\n");
    write(source, ".gitignore", `${block}\n`);
    const manifest = JSON.parse(read(source, `${dataDir}/aidlc-manifest.json`));
    manifest.rootContributions[".gitignore"].hash = hash(block);
    write(source, `${dataDir}/aidlc-manifest.json`, JSON.stringify(manifest));
    return source;
  }

  it("adds a new block after the team's rules, keeping the local working files header", async () => {
    const root = temp();
    write(root, ".gitignore", "node_modules/\n!keep.local\n");

    await applyHarnessCandidate(
      ignoreCandidate("2.8.0", ["# AI-DLC: local working files", "aidlc/active-space"]),
      root,
      "cursor",
      "2.8.0",
    );

    expect(read(root, ".gitignore")).toBe(
      [
        "node_modules/",
        "!keep.local",
        "",
        "# BEGIN AI-DLC:guide-cursor-gitignore",
        "# AI-DLC: local working files",
        "aidlc/active-space",
        "# END AI-DLC:guide-cursor-gitignore",
        "",
      ].join("\n"),
    );
  });

  it("updates an existing block in place", async () => {
    const root = temp();
    write(root, ".gitignore", "node_modules/\n");
    await applyHarnessCandidate(
      ignoreCandidate("2.8.0", ["# AI-DLC: local working files", "aidlc/active-space"]),
      root,
      "cursor",
      "2.8.0",
    );
    write(root, ".gitignore", `${read(root, ".gitignore")}team-after/\n`);

    await applyHarnessCandidate(
      ignoreCandidate("2.8.1", [
        "# AI-DLC: local working files",
        "aidlc/active-space",
        "aidlc/.aidlc-sessions/",
      ]),
      root,
      "cursor",
      "2.8.1",
    );

    expect(read(root, ".gitignore")).toBe(
      [
        "node_modules/",
        "",
        "# BEGIN AI-DLC:guide-cursor-gitignore",
        "# AI-DLC: local working files",
        "aidlc/active-space",
        "aidlc/.aidlc-sessions/",
        "# END AI-DLC:guide-cursor-gitignore",
        "team-after/",
        "",
      ].join("\n"),
    );
  });
});
