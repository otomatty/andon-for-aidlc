import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DocsQaTool } from "@andon/shared-types";

/** Only generated temporary directories are writable; no workspace path is accepted. */
export async function createScratch(
  tool: DocsQaTool,
): Promise<{ cwd: string; env: NodeJS.ProcessEnv; cleanup(): Promise<void> }> {
  const parent = resolve(tmpdir());
  const cwd = await mkdtemp(join(parent, "aidlc-docs-qa-"));
  const cleanup = async () => {
    if (
      dirname(resolve(cwd)) !== parent ||
      !resolve(cwd).startsWith(join(parent, "aidlc-docs-qa-"))
    )
      throw new Error("Invalid temporary directory");
    await rm(cwd, { recursive: true, force: true });
  };
  const env = { ...process.env, NO_COLOR: "1", NO_OPEN_BROWSER: "1" };
  try {
    if (tool === "copilot") {
      const config = join(cwd, ".copilot");
      await mkdir(config);
      await writeFile(
        join(config, "settings.json"),
        JSON.stringify({
          disableAllHooks: true,
          autoUpdate: false,
          askUser: false,
          experimental: false,
          enabledPlugins: {},
          extraKnownMarketplaces: {},
          skillDirectories: [],
          ide: { autoConnect: false },
          customAgents: { defaultLocalOnly: true },
          builtInAgents: { rubberDuck: false, rubberDuckAutoInvoke: false },
          storeTokenPlaintext: false,
        }),
        { mode: 0o600 },
      );
      await writeFile(join(config, "mcp-config.json"), '{"mcpServers":{}}', { mode: 0o600 });
      const copilotEnv: NodeJS.ProcessEnv = {
        ...env,
        COPILOT_HOME: config,
        COPILOT_CACHE_HOME: join(config, "cache"),
        COPILOT_ALLOW_ALL: "false",
        COPILOT_MCP_TOOL_CACHE: "false",
        COPILOT_AUTO_UPDATE: "false",
        COPILOT_ENABLE_INTERRUPTED_SESSION_RESTORE: "false",
        GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "false",
        GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "false",
        GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: "false",
      };
      // These integration overrides can introduce external instructions or tools.
      delete copilotEnv.COPILOT_CUSTOM_INSTRUCTIONS_DIRS;
      delete copilotEnv.COPILOT_SKILLS_DIRS;
      delete copilotEnv.COPILOT_PLAN_THEN_AUTOPILOT;
      return { cwd, env: copilotEnv, cleanup };
    }
    if (tool === "cursor") {
      const config = join(cwd, ".cursor");
      await mkdir(config);
      const permissions = {
        allow: [],
        deny: [
          "Shell(*)",
          "Read(**)",
          "Read(*)",
          "Write(**)",
          "Write(*)",
          "WebFetch(*)",
          "Mcp(*:*)",
        ],
      };
      await writeFile(
        join(config, "cli-config.json"),
        JSON.stringify({
          version: 1,
          editor: { vimMode: false },
          permissions,
          approvalMode: "allowlist",
        }),
        { mode: 0o600 },
      );
      await writeFile(join(config, "cli.json"), JSON.stringify({ permissions }), { mode: 0o600 });
      await writeFile(join(config, "mcp.json"), '{"mcpServers":{}}', { mode: 0o600 });
      return { cwd, env: { ...env, CURSOR_CONFIG_DIR: config }, cleanup };
    }
    return { cwd, env, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
