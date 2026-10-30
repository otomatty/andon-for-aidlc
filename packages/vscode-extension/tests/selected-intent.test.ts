import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKFLOWS_TARGET_VERSION } from "@andon/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

const creation = vi.hoisted(() => new Set<(uri: { fsPath: string }) => void>());
const authority = vi.hoisted(() => ({ trusted: true }));
vi.mock("vscode", () => ({
  RelativePattern: class {},
  workspace: {
    get isTrusted() {
      return authority.trusted;
    },
    createFileSystemWatcher: () => {
      let listener: (uri: { fsPath: string }) => void;
      return {
        onDidCreate: (callback: typeof listener) => {
          listener = callback;
          creation.add(callback);
        },
        dispose: () => creation.delete(listener),
      };
    },
  },
}));

import {
  closeAllSessions,
  getOrCreateSession,
  type SelectedIntentPersist,
} from "../src/guide-session.ts";

const STATE_MD = `# AI-DLC State Tracking

## Project Information
- **Project**: selected-intent test
- **Project Type**: Greenfield
- **Scope**: feature
- **State Version**: 8

## Scope Configuration
- **Depth**: Standard
- **Test Strategy**: Standard

## Execution Plan Summary
- **Total Stages**: 1
- **Completed**: 0

## Stage Progress

### IDEATION PHASE
- [ ] intent-capture — EXECUTE

## Current Status
- **Lifecycle Phase**: IDEATION
- **Current Stage**: intent-capture
- **Next Stage**: intent-capture
`;

async function seedRecords(names: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "selected-intent-"));
  // A copy-channel harness on the supported release passes the version check.
  await mkdir(path.join(root, ".claude", "skills", "aidlc"), { recursive: true });
  await mkdir(path.join(root, ".claude", "tools"), { recursive: true });
  await writeFile(
    path.join(root, ".claude", "tools", "aidlc-version.ts"),
    `export const AIDLC_VERSION = "${WORKFLOWS_TARGET_VERSION}";\n`,
  );
  const intents = path.join(root, "aidlc", "spaces", "default", "intents");
  for (const name of names) {
    const dir = path.join(intents, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "aidlc-state.md"), STATE_MD);
  }
  return root;
}

function memoryPersist(initial?: string): SelectedIntentPersist & { stored: string | undefined } {
  const persist = {
    stored: initial,
    get: (): string | undefined => persist.stored,
    set: (slug: string | null): void => {
      persist.stored = slug ?? undefined;
    },
  };
  return persist;
}

describe("GuideSession view-pin persist", () => {
  const roots: string[] = [];

  afterEach(async () => {
    authority.trusted = true;
    await closeAllSessions();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  it("requires workspace trust for document questions and disposes the runner with its session", async () => {
    const root = await seedRecords([]);
    roots.push(root);
    const session = getOrCreateSession(root);
    const qa = session.service.docsQa;
    if (!qa) throw new Error("Missing document question service");
    const start = vi.spyOn(qa, "start").mockResolvedValue({ error: true, reason: "bad-request" });
    const dispose = vi.spyOn(qa, "dispose");
    const tools = vi.spyOn(qa, "tools").mockResolvedValue([]);
    authority.trusted = false;
    for (const path of ["/api/docs-qa/tools", "/api/docs-qa/tools?recheck=true"])
      expect(await session.handleGet(path)).toEqual({
        reached: true,
        body: { error: true, reason: "workspace-untrusted" },
      });
    expect(tools).not.toHaveBeenCalled();
    expect(await session.handlePost("/api/docs-qa/ask", {})).toMatchObject({
      status: 403,
      body: { reason: "workspace-untrusted" },
    });
    expect(start).not.toHaveBeenCalled();
    for (const route of ["save", "import/adopt"])
      expect(await session.handlePost(`/api/customization/${route}`, {})).toMatchObject({
        status: 403,
        body: { reason: "workspace-untrusted" },
      });
    authority.trusted = true;
    expect(await session.handleGet("/api/docs-qa/tools")).toEqual({
      reached: true,
      body: { ok: true, value: [] },
    });
    expect(tools).toHaveBeenCalledOnce();
    expect(await session.handlePost("/api/docs-qa/ask", {})).toMatchObject({ status: 400 });
    expect(start).toHaveBeenCalledOnce();
    session.dispose();
    session.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("pushes the first Intent immediately from a creation event without polling", async () => {
    const root = await seedRecords([]);
    roots.push(root);
    const session = getOrCreateSession(root);
    expect(await session.service.reader.getWorkflow()).toHaveProperty("error", true);
    const events: string[] = [];
    session.service.hub.add({ send: (data) => events.push(data) });
    const dir = path.join(root, "aidlc", "spaces", "default", "intents", "first-intent");
    await mkdir(dir, { recursive: true });
    const state = path.join(dir, "aidlc-state.md");
    await writeFile(state, STATE_MD);
    for (const listener of creation) listener({ fsPath: state });
    await vi.waitFor(
      () =>
        expect(
          events.some((data) => {
            const message = JSON.parse(data);
            return (
              message.type === "change" &&
              message.scope === "state" &&
              message.workflow.currentStage === "intent-capture"
            );
          }),
        ).toBe(true),
      { timeout: 2000 },
    );
    expect(getOrCreateSession(root)).toBe(session);
    session.dispose();
    expect(creation.size).toBe(0);
  });

  it("restores the listed slug from persist.get", async () => {
    const root = await seedRecords(["a-intent", "b-intent"]);
    roots.push(root);
    const persist = memoryPersist("b-intent");
    const session = getOrCreateSession(root, root, persist);
    const result = await session.handleGet("/api/intents");
    expect(result).toEqual({
      reached: true,
      body: {
        ok: true,
        value: {
          space: "default",
          active: null,
          all: ["a-intent", "b-intent"],
          selected: "b-intent",
        },
      },
    });
  });

  it("writes the pin through persist.set and not active-intent", async () => {
    const root = await seedRecords(["a-intent", "b-intent"]);
    roots.push(root);
    const persist = memoryPersist();
    const session = getOrCreateSession(root, root, persist);
    const result = await session.handlePost("/api/select-intent", { intent: "a-intent", expectedSpace: "default" });
    expect(result.status).toBe(200);
    expect(persist.stored).toBe("a-intent");
    expect(
      existsSync(path.join(root, "aidlc", "spaces", "default", "intents", "active-intent")),
    ).toBe(false);
  });

  it("exposes space-wide effectiveness through the webview transport without selecting a record", async () => {
    const root = await seedRecords(["a-intent", "b-intent"]);
    roots.push(root);
    const session = getOrCreateSession(root, root, memoryPersist());
    const response = await session.handleGet("/api/effectiveness");
    expect(response).toMatchObject({
      reached: true,
      body: {
        ok: true,
        value: {
          space: "default",
          intents: [
            { dirName: "a-intent", usage: null },
            { dirName: "b-intent", usage: null },
          ],
        },
      },
    });
    expect(session.service.readContext.selected()).toBeNull();
  });

  /**
   * dashboard-panel only checks `typeof msg.path === "string"` before handing
   * the path over, so a webview can name an Object.prototype member. That must
   * come back as the unknown-route reply like any other unrouted path — a
   * throw here leaves the webview waiting for a `post-response` forever.
   */
  it("answers an Object.prototype path with unknown-route instead of throwing", async () => {
    const root = await seedRecords(["a-intent"]);
    roots.push(root);
    const session = getOrCreateSession(root, root, memoryPersist());

    for (const probe of ["toString", "constructor", "__proto__"]) {
      const result = await session.handlePost(probe, {});
      expect(result, probe).toEqual({
        ok: false,
        status: 404,
        body: { error: true, reason: "unknown-route" },
      });
    }
  });
});
