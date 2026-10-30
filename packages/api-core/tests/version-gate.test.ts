import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VersionGate } from "@andon/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePost, routePost } from "../src/handlers/post.ts";
import { handleRead, routeRead } from "../src/handlers/read.ts";
import { createGuideService } from "../src/service.ts";
import { isVersionGateOpenRoute } from "../src/version-gate.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "api-version-gate-"));
  roots.push(root);
  const dir = path.join(root, "aidlc", "spaces", "default", "intents", "260101-demo");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "aidlc-state.md"),
    "# AI-DLC State Tracking\n\n## Project Information\n- **State Version**: 8\n",
  );
  return root;
}

function gate(status: VersionGate["status"]): VersionGate {
  return {
    status,
    target: "2.11.0",
    tools: [{ id: "claude", label: "Claude Code", version: "2.10.0" }],
    pin: null,
    engine: null,
    native: false,
    projectVersion: null,
    rollback: null,
    message: `status ${status}`,
  };
}

const url = (route: string) => new URL(`http://localhost${route}`);

describe("isVersionGateOpenRoute", () => {
  it.each([
    "/api/official-docs/manifest",
    "/api/official-docs/ja/guide/concepts",
    "/api/official-docs/toc/ja",
    "/api/guides",
    "/api/guides/getting-started",
  ])("keeps %s open", (route) => {
    expect(isVersionGateOpenRoute(route)).toBe(true);
  });

  it.each([
    "/api/workflow",
    "/api/docs-settings",
    "/api/matrix",
    "/api/docs-qa/tools",
    "/api/docs-qa/ask",
    "/api/answer",
    "/api/customization",
    "/api/guidesX",
    "/api/official-docs",
    "/static/app.js",
  ])("closes %s", (route) => {
    expect(isVersionGateOpenRoute(route)).toBe(false);
  });
});

describe("version gate enforcement", () => {
  it("refuses workflow reads with the gate, and still serves bundled docs", async () => {
    const root = await workspace();
    const versionGate = vi.fn(() => gate("project-older"));
    const service = createGuideService({ workspaceRoot: root, versionGate });

    const blocked = await routeRead(service.readContext, url("/api/workflow"));
    expect(blocked).toEqual({
      status: 409,
      body: {
        error: true,
        reason: "version-gate",
        detail: "status project-older",
        gate: gate("project-older"),
      },
    });
    const docs = await routeRead(service.readContext, url("/api/official-docs/manifest"));
    expect(docs?.status).not.toBe(409);
    const qa = await routeRead(service.readContext, url("/api/docs-qa/tools"));
    expect(qa?.status).toBe(409);
  });

  it("refuses posts on both transports", async () => {
    const root = await workspace();
    const service = createGuideService({
      workspaceRoot: root,
      versionGate: () => gate("project-newer"),
    });

    const routed = await routePost(service, "/api/answer", {});
    expect(routed?.status).toBe(409);
    const response = await handlePost(
      service,
      "/api/answer",
      new Request("http://localhost/api/answer", { method: "POST", body: "{}" }),
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ reason: "version-gate" });
    expect(await routePost(service, "/api/not-a-route", {})).toBeNull();
  });

  it("answers HTTP reads with the same refusal", async () => {
    const root = await workspace();
    const service = createGuideService({
      workspaceRoot: root,
      versionGate: () => gate("engine-mismatch"),
    });
    const response = await handleRead(service.readContext, url("/api/workflow"));
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ reason: "version-gate" });
  });

  it("lets everything through when the gate is ok", async () => {
    const root = await workspace();
    const service = createGuideService({ workspaceRoot: root, versionGate: () => gate("ok") });
    const result = await routeRead(service.readContext, url("/api/workflow"));
    expect(result?.status).not.toBe(409);
  });

  it("enforces the real check by default", async () => {
    const root = await workspace();
    const service = createGuideService({ workspaceRoot: root });
    const result = await routeRead(service.readContext, url("/api/workflow"));
    expect(result?.status).toBe(409);
    expect(result?.body).toMatchObject({ gate: { status: "not-installed" } });
  });

  it("can be switched off only explicitly", async () => {
    const root = await workspace();
    const service = createGuideService({ workspaceRoot: root, versionGate: null });
    const result = await routeRead(service.readContext, url("/api/workflow"));
    expect(result?.status).not.toBe(409);
  });

  it("re-checks after the workspace changes instead of caching forever", async () => {
    const root = await workspace();
    let status: VersionGate["status"] = "project-older";
    const versionGate = vi.fn(() => gate(status));
    const service = createGuideService({ workspaceRoot: root, versionGate });
    expect((await routeRead(service.readContext, url("/api/workflow")))?.status).toBe(409);
    status = "ok";
    service.invalidateVersionGate();
    expect((await routeRead(service.readContext, url("/api/workflow")))?.status).not.toBe(409);
  });

  it("drops pushes while blocked", async () => {
    const root = await workspace();
    let status: VersionGate["status"] = "project-older";
    const service = createGuideService({ workspaceRoot: root, versionGate: () => gate(status) });
    const send = vi.fn();
    service.hub.add({ send });
    service.hub.broadcast({ type: "customization-changed" });
    expect(send).not.toHaveBeenCalled();
    status = "ok";
    service.invalidateVersionGate();
    service.hub.broadcast({ type: "customization-changed" });
    expect(send).toHaveBeenCalledOnce();
  });
});
