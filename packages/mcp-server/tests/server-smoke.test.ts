import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLI, seedWorkspace } from "./support.ts";

/**
 * End-to-end over a **real** stdio transport against a spawned Bun process.
 *
 * `src/index.ts` is a bin whose module body connects the transport, so it
 * cannot be imported into this process — and Vitest runs under Node here.
 * A real MCP client driving a real child is therefore the only way to cover
 * the wiring (tool registration, descriptions, the zod schema layer), which is
 * why index.ts is excluded from coverage the same way dashboard-server's
 * server.ts/cli.ts are.
 *
 * cwd is a seeded workspace that passes the version check: this repository
 * is itself a native install, and a CI runner has no aidlc engine to match it.
 * Every tool called here is a read (NFR-1).
 */

const BUN = process.platform === "win32" ? "bun.exe" : "bun";
const TIMEOUT = 30_000;

let client: Client;
let blocked: Client;
const roots: string[] = [];

async function connect(name: string, cwd: string): Promise<Client> {
  const connected = new Client({ name, version: "0.0.0" });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // The seeded record elects itself; a CI pin for this repository's own
    // record would name an intent the throwaway workspace does not have.
    if (value !== undefined && key !== "AIDLC_ACTIVE_INTENT") env[key] = value;
  }
  // Windows spawn does not always inherit the parent env; forward it explicitly.
  await connected.connect(new StdioClientTransport({ command: BUN, args: [CLI], cwd, env }));
  return connected;
}

beforeAll(async () => {
  const current = await seedWorkspace();
  const older = await seedWorkspace("2.0.0");
  roots.push(current, older);
  [client, blocked] = await Promise.all([connect("smoke", current), connect("blocked", older)]);
}, TIMEOUT);

afterAll(async () => {
  await Promise.all([client?.close(), blocked?.close()]);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** Flattened text of a tool result. Typed loosely because the SDK's result is a
 * back-compat union whose non-`content` arm this server never produces. */
function textOf(result: unknown): string {
  const blocks = (result as { content?: { text?: string }[] }).content;
  return blocks?.map((block) => block.text ?? "").join("\n") ?? "";
}

describe("mcp-server over real stdio", () => {
  it("registers five read-only tools, each saying when to use it", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "aidlc_docs_read",
      "aidlc_docs_search",
      "aidlc_next_steps",
      "aidlc_read_artifact",
      "aidlc_status",
    ]);
    // BR-MS-6 規約: the description tells the AI *when* to reach for the tool.
    for (const tool of tools) expect(tool.description ?? "").toMatch(/ときに使う|呼ぶ/);
  });

  it("aidlc_status reports the live workflow position", async () => {
    const result = await client.callTool({ name: "aidlc_status", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("フェーズ:");
  });

  it("aidlc_next_steps answers without an argument", async () => {
    const result = await client.callTool({ name: "aidlc_next_steps", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/次のステージ|ワークフロー完了/);
  });

  it("aidlc_read_artifact refuses a traversal as a NORMAL reply, not a protocol error", async () => {
    const result = await client.callTool({
      name: "aidlc_read_artifact",
      arguments: { path: "../../../../etc/passwd" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("記録ディレクトリの外は読めません");
  });

  it.each([
    ["aidlc_status", {}],
    ["aidlc_next_steps", {}],
    ["aidlc_read_artifact", { path: "aidlc-state.md" }],
    ["aidlc_docs_search", { query: "AI-DLC" }],
    ["aidlc_docs_read", { id: "guide/concepts" }],
  ] as const)("%s answers an older project with the update notice", async (name, args) => {
    const result = await blocked.callTool({ name, arguments: { ...args } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Andon はこのプロジェクトでは使えません");
    expect(textOf(result)).toContain("version-gate");
  });

  it("isError is reserved for schema violations — the one protocol-error path", async () => {
    const missing = await client.callTool({ name: "aidlc_read_artifact", arguments: {} });
    expect(missing.isError).toBe(true);
    const empty = await client.callTool({
      name: "aidlc_read_artifact",
      arguments: { path: "" },
    });
    expect(empty.isError).toBe(true);
  });
});
