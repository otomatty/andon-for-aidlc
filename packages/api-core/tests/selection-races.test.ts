import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createGuideService } from "../src/service.ts";

const pause = vi.hoisted(() => ({ armed: false, entered: () => {}, release: Promise.resolve() }));
vi.mock("@andon/reader-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@andon/reader-core")>();
  return {
    ...actual,
    resolveIntents: async (...args: Parameters<typeof actual.resolveIntents>) => {
      const result = await actual.resolveIntents(...args);
      if (pause.armed) {
        pause.armed = false;
        pause.entered();
        await pause.release;
      }
      return result;
    },
  };
});

it.each(["guide", "external"])(
  "never adopts a delayed old-space read after a %s switch",
  async (kind) => {
    const root = await mkdtemp(path.join(tmpdir(), "guide-selection-race-"));
    let release = () => {};
    try {
      for (const space of ["default", "team-b"])
        await mkdir(path.join(root, "aidlc/spaces", space, "intents/shared"), { recursive: true });
      const messages: object[] = [];
      const selected: string[] = [];
      const service = createGuideService({
        workspaceRoot: root,
        versionGate: null,
        onSelection: (value) => {
          selected.push(value.space);
        },
        spaceEngine: {
          harnesses: async () => [{ id: ".claude", label: "Claude Code" }],
          switch: async (space) => {
            await writeFile(path.join(root, "aidlc/active-space"), space);
          },
        },
      });
      service.hub.add({ send: (value) => messages.push(JSON.parse(value)) });
      await service.readContext.recordDir();
      await vi.waitFor(() => expect(service.readContext.matrix()).not.toBeNull());
      const entered = new Promise<void>((resolve) => {
        pause.entered = resolve;
      });
      pause.release = new Promise<void>((resolve) => {
        release = resolve;
      });
      pause.armed = true;
      const staleRead = service.readContext.recordDir();
      await entered;
      if (kind === "guide") {
        expect(
          (
            await service.switchSpace({
              space: "team-b",
              expectedSpace: "default",
              harness: ".claude",
            })
          ).status,
        ).toBe(200);
      } else {
        // No watcher event has reached Guide yet: the cursor itself must be checked.
        await writeFile(path.join(root, "aidlc/active-space"), "team-b");
      }
      const offset = messages.length;
      const saved = selected.length;
      release();
      expect(await staleRead).toEqual({
        ok: true,
        value: path.join(root, "aidlc/spaces/team-b/intents/shared"),
      });
      expect(messages.slice(offset)).not.toContainEqual({
        type: "space-selected",
        space: "default",
        intent: "shared",
      });
      expect(selected.slice(saved)).not.toContain("default");
      expect((await readFile(path.join(root, "aidlc/active-space"), "utf8")).trim()).toBe("team-b");
      await vi.waitFor(() => expect(service.readContext.matrix()).not.toBeNull());
    } finally {
      release();
      pause.armed = false;
      await rm(root, { recursive: true, force: true });
    }
  },
);
