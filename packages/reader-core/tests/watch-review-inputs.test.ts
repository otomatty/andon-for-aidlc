import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WatchEvent } from "@andon/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watch } from "../src/watch/watcher.ts";

let root: string;
let record: string;
let events: WatchEvent[];
let dispose: (() => void) | undefined;
const recordRel = "aidlc/spaces/default/intents/current";
const memoryRel = "aidlc/spaces/default/memory";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function write(relative: string, text: string) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}
function changed(relative: string) {
  return events.some(
    (event) =>
      event.type === "change" &&
      event.scope === "review-inputs" &&
      path.relative(root, event.path).split(path.sep).join("/") === relative,
  );
}
async function expectChange(relative: string, mutate: () => Promise<unknown>) {
  events.length = 0;
  await mutate();
  await vi.waitFor(() => expect(changed(relative)).toBe(true), { timeout: 20_000, interval: 20 });
  await pause(100);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "watch-review-")));
  record = path.join(root, recordRel);
  events = [];
  await write(`${recordRel}/aidlc-state.md`, "- **Change Control**: strict\n");
  await write("app.ts", "first\n");
  await write(".claude/tools/data/harness.json", '{"name":"claude"}');
  await write(".claude/tools/data/stage-graph.json", "[]");
  await write(".claude/tools/engine.ts", "bulk\n");
  await write(`${memoryRel}/org.md`, "# org\n");
  dispose = watch(record, (event) => events.push(event), { debounceMs: 30 });
  const deadline = Date.now() + 20_000;
  for (
    let i = 0;
    !events.some((event) => event.type === "change" && event.scope === "state");
    i++
  ) {
    if (Date.now() > deadline) throw new Error("canonical watcher never became live");
    await write(`${recordRel}/aidlc-state.md`, `- **Change Control**: strict\nprobe ${i}\n`);
    await pause(100);
  }
  await pause(300);
  events.length = 0;
});
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("watch — review inputs outside the record", () => {
  it("reports source edit, addition and deletion", async () => {
    await expectChange("app.ts", () => write("app.ts", "edited\n"));
    await expectChange("new.ts", () => write("new.ts", "added\n"));
    await expectChange("new.ts", () => rm(path.join(root, "new.ts")));
  });

  it("reports memory additions, edits and deletions including an initially absent layer", async () => {
    await expectChange(`${memoryRel}/team.md`, () =>
      write(`${memoryRel}/team.md`, "## Change Control\nMode: strict\n"),
    );
    await expectChange(`${memoryRel}/org.md`, () =>
      write(`${memoryRel}/org.md`, "## Change Control\nMode: strict\n"),
    );
    await expectChange(`${memoryRel}/team.md`, () => rm(path.join(root, memoryRel, "team.md")));
  });

  it("watches graph, intent registry and unit definitions", async () => {
    await expectChange(".claude/tools/data/stage-graph.json", () =>
      write(".claude/tools/data/stage-graph.json", '[{"slug":"changed"}]'),
    );
    await expectChange("aidlc/spaces/default/intents/intents.json", () =>
      write("aidlc/spaces/default/intents/intents.json", "[]"),
    );
    await expectChange(`${recordRel}/runtime-graph.json`, () =>
      write(`${recordRel}/runtime-graph.json`, "{}"),
    );
    await expectChange(`${recordRel}/inception/units-generation/unit-of-work-dependency.md`, () =>
      write(`${recordRel}/inception/units-generation/unit-of-work-dependency.md`, "units"),
    );
  });

  it("watches the recorded source checkouts but no other engine file", async () => {
    const checkouts = `${recordRel}/.aidlc-engine/source-checkouts.json`;
    await expectChange(checkouts, () => write(checkouts, '{"version":1,"checkouts":[]}'));
    await expectChange(checkouts, () => rm(path.join(root, checkouts)));
    events.length = 0;
    await write(`${recordRel}/.aidlc-engine/plan.json`, "{}");
    await pause(200);
    expect(events).toEqual([]);
  });

  it("prunes dependency/generated trees, other intents/spaces and stamped harness bulk", async () => {
    for (const relative of [
      "node_modules/pkg/index.js",
      "src/node_modules/pkg/index.js",
      ".vs/FileContentIndex/a.vsidx",
      ".idea/workspace.xml",
      "src/.codegraph/index.db",
      "src/DerivedData/Build/app.o",
      "src/__pycache__/m.pyc",
      "dist/bundle.js",
      ".git/index",
      "aidlc/spaces/default/intents/other/construction/unit/design.md",
      "aidlc/spaces/other/memory/org.md",
      `${memoryRel}/phases/construction.md`,
      ".claude/tools/engine.ts",
      ".claude/skills/aidlc/SKILL.md",
    ])
      await write(relative, "ignored\n");
    await pause(300);
    // A positive control confirms the subscription is still delivering events.
    await write("app.ts", "control\n");
    await vi.waitFor(() => expect(changed("app.ts")).toBe(true), { timeout: 20_000, interval: 20 });
    expect(
      events.flatMap((event) =>
        event.type === "change" && event.scope === "review-inputs"
          ? [path.relative(root, event.path).split(path.sep).join("/")]
          : [],
      ),
    ).toEqual(["src", "app.ts"].filter((relative) => changed(relative)));
    expect(
      events.every((event) => event.type === "change" && event.scope === "review-inputs"),
    ).toBe(true);
  });

  it("keeps same-named regular source files and active units observable", async () => {
    await expectChange("dist", () => write("dist", "a regular source file\n"));
    await write(
      `${recordRel}/construction/build/functional-design/design.md`,
      "unit named build\n",
    );
    await vi.waitFor(
      () =>
        expect(
          events.some((event) => event.type === "change" && event.scope === "matrix:build"),
        ).toBe(true),
      { timeout: 20_000, interval: 20 },
    );
  });

  it("observes transitions into unsupported source contexts without watching Git internals", async () => {
    await expectChange(".aidlc-source-paths.json", () => write(".aidlc-source-paths.json", "{}"));
    await expectChange(".aidlc/worktree-meta.json", () => write(".aidlc/worktree-meta.json", "{}"));
    await mkdir(path.join(root, "nested"));
    await pause(100);
    await expectChange("nested/.git", () => mkdir(path.join(root, "nested/.git")));
    events.length = 0;
    await write("nested/.git/HEAD", "ignored metadata\n");
    await pause(200);
    expect(events).toEqual([]);
    await expectChange("nested/.git", () =>
      rm(path.join(root, "nested/.git"), { recursive: true }),
    );
  });

  it("resubscribes when removing a harness stamp makes its former bulk application source", async () => {
    await expectChange(".claude/tools/data/harness.json", () =>
      rm(path.join(root, ".claude/tools/data/harness.json")),
    );
    // Probe until the replacement watcher has attached to the newly included tree.
    await vi.waitFor(
      async () => {
        await write(".claude/tools/engine.ts", `now source ${Date.now()}\n`);
        expect(changed(".claude/tools/engine.ts")).toBe(true);
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(events.some((event) => event.type === "watch-warning")).toBe(false);
  });
});
