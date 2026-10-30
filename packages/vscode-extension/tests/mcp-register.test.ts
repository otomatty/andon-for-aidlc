import { existsSync, readFileSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/user-notice.ts", () => ({ showPlainNotice: vi.fn() }));
vi.mock("../src/write-global-vsix.ts", () => ({ registerApplyLatestCommand: vi.fn() }));

import {
  docsSkillPath,
  isMcpRegistered,
  mcpScriptPath,
  refreshDocsRegistration,
  registerMcp,
} from "../src/mcp-register.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function seed() {
  const root = await mkdtemp(path.join(tmpdir(), "aidlc-registration-"));
  roots.push(root);
  const skill = path.join(root, "skill.md");
  await writeFile(
    skill,
    "---\nname: andon-docs\ndescription: documentation lookup\n---\nRead and cite.\n",
  );
  return { root, skill };
}

describe("MCP and automatic documentation skill registration", () => {
  it.each([1, 2])(
    "refuses a replaced parent before directory creation at callback %s",
    async (swapAt) => {
      const { root, skill } = await seed();
      const { root: outside } = await seed();
      await mkdir(path.join(root, ".claude"));
      let calls = 0;
      let swapped = false;
      const result = await registerMcp(root, "server.mjs", skill, () => {
        if (!swapped && existsSync(path.join(root, ".cursor/mcp.json")) && ++calls === swapAt) {
          rmdirSync(path.join(root, ".claude"));
          symlinkSync(outside, path.join(root, ".claude"), "junction");
          swapped = true;
        }
        return true;
      });
      expect(swapped).toBe(true);
      expect(result).toEqual({ ok: false, reason: "registration-path-changed" });
      expect(existsSync(path.join(outside, "skills"))).toBe(false);
      expect(existsSync(path.join(root, ".mcp.json"))).toBe(false);
      expect(existsSync(path.join(root, ".cursor/mcp.json"))).toBe(false);
    },
  );
  const destinations = [
    ".mcp.json",
    ".cursor/mcp.json",
    ".claude/skills/andon-docs/SKILL.md",
    ".cursor/skills/andon-docs/SKILL.md",
  ];
  it.each(destinations)(
    "restores all prior files when cancelled after writing %s",
    async (cancelAfter) => {
      const { root, skill } = await seed();
      await registerMcp(root, "old-server.mjs", skill);
      const before = destinations.map((rel) => readFileSync(path.join(root, rel), "utf8"));
      await writeFile(
        skill,
        "---\nname: andon-docs\ndescription: updated\n---\nUpdated source.\n",
      );
      let cancelled = false;
      const result = await registerMcp(root, "new-server.mjs", skill, () => {
        const content = readFileSync(path.join(root, cancelAfter), "utf8");
        if (content.includes("new-server.mjs") || content.includes("Updated source."))
          cancelled = true;
        return !cancelled;
      });
      expect(result).toEqual({ ok: false, reason: "registration-cancelled" });
      expect(destinations.map((rel) => readFileSync(path.join(root, rel), "utf8"))).toEqual(before);
      expect(await refreshDocsRegistration(root, "new-server.mjs", skill, false)).toHaveProperty(
        "complete",
        false,
      );
    },
  );
  it("removes newly created registration files on cancellation", async () => {
    const { root, skill } = await seed();
    const result = await registerMcp(
      root,
      "new-server.mjs",
      skill,
      () => !existsSync(path.join(root, ".mcp.json")),
    );
    expect(result).toEqual({ ok: false, reason: "registration-cancelled" });
    for (const rel of destinations) expect(existsSync(path.join(root, rel))).toBe(false);
    expect(await refreshDocsRegistration(root, "new-server.mjs", skill, false)).toHaveProperty(
      "complete",
      false,
    );
  });
  it("preserves intervening user edits and reports a rollback conflict", async () => {
    const { root, skill } = await seed();
    const target = path.join(root, ".mcp.json");
    const userContent = '{"mcpServers":{"personal":{"command":"custom"}}}';
    const result = await registerMcp(root, "new-server.mjs", skill, () => {
      if (!existsSync(target)) return true;
      writeFileSync(target, userContent);
      return false;
    });
    expect(result).toEqual({
      ok: false,
      reason: "registration-cancelled; rollback-conflict:.mcp.json",
    });
    expect(readFileSync(target, "utf8")).toBe(userContent);
    expect(await refreshDocsRegistration(root, "new-server.mjs", skill, false)).toHaveProperty(
      "complete",
      false,
    );
  });
  it("adopts unmarked current Skills so a subsequent source update remains possible", async () => {
    const { root, skill } = await seed();
    await registerMcp(root, "server.mjs", skill);
    const source = await readFile(skill, "utf8");
    const targets = [".claude", ".cursor"].map((client) =>
      path.join(root, client, "skills/andon-docs/SKILL.md"),
    );
    for (const target of targets) await writeFile(target, source);
    expect(await refreshDocsRegistration(root, "server.mjs", skill, false)).toEqual({
      complete: false,
      updated: false,
    });
    for (const target of targets) expect(await readFile(target, "utf8")).toBe(source);
    expect(await refreshDocsRegistration(root, "server.mjs", skill)).toEqual({
      complete: true,
      updated: true,
    });
    for (const target of targets)
      expect(await readFile(target, "utf8")).toMatch(/<!-- andon-managed:[0-9a-f]{64} -->/);
    expect(await refreshDocsRegistration(root, "server.mjs", skill)).toEqual({
      complete: true,
      updated: false,
    });
    const nextSource = source.replace("Read and cite.", "Read, verify and cite.");
    await writeFile(skill, nextSource);
    expect(await registerMcp(root, "new-server.mjs", skill)).toEqual({ ok: true });
    for (const target of targets) expect(await readFile(target, "utf8")).toContain(nextSource);
  });
  it("refreshes old installed paths and owned skills without overwriting custom options", async () => {
    const { root, skill } = await seed();
    const oldScript = path.join(root, "extensions/otomatty.andon-for-aidlc-0.6.9/dist/aidlc-mcp.mjs");
    const newScript = path.join(root, "extensions/otomatty.andon-for-aidlc-0.7.0/dist/aidlc-mcp.mjs");
    await registerMcp(root, oldScript, skill);
    await writeFile(skill, "---\nname: andon-docs\ndescription: newer\n---\nNew content.\n");
    expect(await refreshDocsRegistration(root, newScript, skill, false)).toEqual({
      complete: false,
      updated: false,
    });
    expect(await refreshDocsRegistration(root, newScript, skill)).toEqual({
      complete: true,
      updated: true,
    });
    for (const rel of [".mcp.json", ".cursor/mcp.json"]) {
      const config = JSON.parse(await readFile(path.join(root, rel), "utf8"));
      expect(config.mcpServers["andon"].args[1]).toBe(newScript.replace(/\\/g, "/"));
    }
    expect(
      await readFile(path.join(root, ".claude/skills/andon-docs/SKILL.md"), "utf8"),
    ).toContain("New content.");
    expect(await refreshDocsRegistration(root, newScript, skill)).toEqual({
      complete: true,
      updated: false,
    });
    const configPath = path.join(root, ".mcp.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.mcpServers["andon"].env = { CUSTOM: "yes" };
    const custom = JSON.stringify(config);
    await writeFile(configPath, custom);
    expect(await refreshDocsRegistration(root, oldScript, skill)).toHaveProperty("complete", false);
    expect(await readFile(configPath, "utf8")).toBe(custom);
  });

  it("requires setup for legacy MCP-only, missing client or missing Skill", async () => {
    const { root, skill } = await seed();
    await registerMcp(root, "server.mjs");
    expect(await refreshDocsRegistration(root, "server.mjs", skill)).toEqual({
      complete: false,
      updated: false,
    });
    await registerMcp(root, "server.mjs", skill);
    const missing = path.join(root, ".cursor/skills/andon-docs/SKILL.md");
    await rm(missing);
    expect(await refreshDocsRegistration(root, "server.mjs", skill)).toHaveProperty(
      "complete",
      false,
    );
    await expect(readFile(missing)).rejects.toHaveProperty("code", "ENOENT");
    await registerMcp(root, "server.mjs", skill);
    await rm(path.join(root, ".cursor/mcp.json"));
    expect(await refreshDocsRegistration(root, "server.mjs", skill)).toHaveProperty(
      "complete",
      false,
    );
  });

  it("preserves custom scripts and Skills and refuses outside junctions on activation", async () => {
    const { root, skill } = await seed();
    await registerMcp(root, "custom.mjs", skill);
    const before = await readFile(path.join(root, ".mcp.json"), "utf8");
    const target = path.join(root, ".claude/skills/andon-docs/SKILL.md");
    await writeFile(target, "Custom instructions.");
    expect(await refreshDocsRegistration(root, "new.mjs", skill)).toHaveProperty("complete", false);
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(before);
    expect(await readFile(target, "utf8")).toBe("Custom instructions.");
    const { root: outside } = await seed();
    await rm(path.join(root, ".cursor/mcp.json"));
    await rm(path.join(root, ".cursor/skills/andon-docs/SKILL.md"));
    await rmdir(path.join(root, ".cursor/skills/andon-docs"));
    await rmdir(path.join(root, ".cursor/skills"));
    await rmdir(path.join(root, ".cursor"));
    await symlink(outside, path.join(root, ".cursor"), "junction");
    expect(await refreshDocsRegistration(root, "new.mjs", skill)).toHaveProperty("complete", false);
    await expect(readFile(path.join(outside, "mcp.json"))).rejects.toHaveProperty("code", "ENOENT");
    await writeFile(path.join(root, ".mcp.json"), "{broken");
    expect(await refreshDocsRegistration(root, "new.mjs", skill)).toHaveProperty("reason");
  });
  it("rejects missing targets under outside junctions before writing any config", async () => {
    const { root, skill } = await seed();
    const { root: outside } = await seed();
    await symlink(outside, path.join(root, ".cursor"), "junction");
    expect(await registerMcp(root, "server.mjs", skill)).toHaveProperty(
      "reason",
      "mcp-path-outside-workspace",
    );
    await expect(readFile(path.join(root, ".mcp.json"))).rejects.toHaveProperty("code", "ENOENT");
    const { root: other } = await seed();
    await mkdir(path.join(other, ".claude"));
    await symlink(outside, path.join(other, ".claude/skills"), "junction");
    expect(await registerMcp(other, "server.mjs", skill)).toHaveProperty(
      "reason",
      "docs-skill-outside-workspace",
    );
    expect(await registerMcp(other, "server.mjs", path.join(other, "missing.md"))).toHaveProperty(
      "reason",
      "registration-io-error:ENOENT",
    );
  });
  it("registers both clients, preserves other servers, and updates owned skills", async () => {
    const { root, skill } = await seed();
    await writeFile(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other" } }, preserved: true }),
    );
    expect(await registerMcp(root, "C:\\extension\\dist\\aidlc-mcp.mjs", skill)).toEqual({
      ok: true,
    });
    const claude = JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8"));
    const cursor = JSON.parse(await readFile(path.join(root, ".cursor/mcp.json"), "utf8"));
    expect(claude.mcpServers.other.command).toBe("other");
    expect(claude.preserved).toBe(true);
    expect(cursor.mcpServers["andon"]).toEqual(claude.mcpServers["andon"]);
    expect(cursor.mcpServers["andon"].args[1]).toBe("C:/extension/dist/aidlc-mcp.mjs");
    expect(await isMcpRegistered(root)).toBe(true);
    await writeFile(
      skill,
      "---\nname: andon-docs\ndescription: revised\n---\nRevised lookup.\n",
    );
    expect(await registerMcp(root, "new.mjs", skill)).toEqual({ ok: true });
    for (const harness of [".claude", ".cursor"]) {
      const installed = await readFile(
        path.join(root, harness, "skills/andon-docs/SKILL.md"),
        "utf8",
      );
      expect(installed).toContain("Revised lookup.");
      expect(installed).toMatch(/^---\n/);
    }
  });

  it("refuses a user-edited skill before changing either MCP config", async () => {
    const { root, skill } = await seed();
    await registerMcp(root, "old.mjs", skill);
    const before = await readFile(path.join(root, ".mcp.json"), "utf8");
    const target = path.join(root, ".claude/skills/andon-docs/SKILL.md");
    await writeFile(target, `${await readFile(target, "utf8")}User edits.\n`);
    expect(await registerMcp(root, "new.mjs", skill)).toHaveProperty("ok", false);
    expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(before);
    expect(await readFile(target, "utf8")).toContain("User edits.");
  });

  it.each(["null", "[]", '{"mcpServers":null}', '{"mcpServers":[]}', "{broken"])(
    "rejects malformed config %s",
    async (raw) => {
      const { root, skill } = await seed();
      await writeFile(path.join(root, ".mcp.json"), raw);
      expect(await registerMcp(root, "server.mjs", skill)).toHaveProperty(
        "reason",
        "invalid-mcp-json",
      );
      expect(await readFile(path.join(root, ".mcp.json"), "utf8")).toBe(raw);
    },
  );

  it("resolves installed bundles and skills without sibling workspace packages", async () => {
    const { root } = await seed();
    expect(mcpScriptPath(root)).toBe(path.join(root, "../mcp-server/src/index.ts"));
    expect(docsSkillPath(root)).toBe(
      path.join(root, "../mcp-server/skills/andon-docs/SKILL.md"),
    );
    await mkdir(path.join(root, "dist"));
    await mkdir(path.join(root, "media/andon-docs"), { recursive: true });
    await writeFile(path.join(root, "dist/aidlc-mcp.mjs"), "");
    await writeFile(path.join(root, "media/andon-docs/SKILL.md"), "");
    expect(mcpScriptPath(root)).toBe(path.join(root, "dist/aidlc-mcp.mjs"));
    expect(docsSkillPath(root)).toBe(path.join(root, "media/andon-docs/SKILL.md"));
    expect(await isMcpRegistered(root)).toBe(false);
  });
});
