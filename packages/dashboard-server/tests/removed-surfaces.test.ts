import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("removed sharing and side-question surfaces stay gone", () => {
  it("does not ship btw, Live Share, LAN bind, or the removed commands", async () => {
    expect(existsSync("packages/btw")).toBe(false);
    expect(existsSync("docs/guides/live-share.md")).toBe(false);
    expect(existsSync("packages/api-core/src/exposure.ts")).toBe(false);
    const pkg = JSON.parse(await readFile("packages/vscode-extension/package.json", "utf8")) as {
      contributes: { commands: { command: string }[] };
    };
    const commands = pkg.contributes.commands.map((command) => command.command);
    expect(commands).not.toContain("andon.askBtw");
    expect(commands).not.toContain("andon.askOneShot");
    expect(commands).not.toContain("andon.shareLan");
    const cli = await readFile("packages/dashboard-server/src/cli.ts", "utf8");
    expect(cli).not.toContain('"--host"');
    const server = await readFile("packages/dashboard-server/src/server.ts", "utf8");
    expect(server).toContain("127.0.0.1");
    expect(server).not.toContain("0.0.0.0");
    const guides = await readFile("packages/api-core/src/handlers/guides.ts", "utf8");
    expect(guides).not.toContain("live-share.md");
  });
});
