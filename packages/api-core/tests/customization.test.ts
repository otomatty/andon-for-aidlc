import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CustomizationCatalog, CustomizationItem } from "@andon/shared-types";
import { afterEach, expect, it, vi } from "vitest";
import { readCompatibilityCatalog } from "../src/customization/catalog.ts";
import type {
  CustomizationEngine,
  EngineAction,
  EngineRequest,
} from "../src/customization/engine-adapter.ts";
import { CustomizationService } from "../src/customization/index.ts";
import {
  applyChanges,
  CustomizationError,
  digest,
  localDiagnostics,
  parseItem,
} from "../src/customization/model.ts";
import { CustomizationStorage } from "../src/customization/storage.ts";
import { handleCustomizationPost, routeCustomizationRead } from "../src/handlers/customization.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
const item: CustomizationItem = {
  id: "rule-1",
  kind: "rule-section",
  title: "Code Style",
  owner: "project",
  spaceId: "default",
  content: "## Code Style\r\nKeep tabs.\r\n",
  target: { layer: "team", heading: "Code Style" },
  source: { relativePath: "aidlc/spaces/default/memory/team.md", hash: "basehash" },
};
const second: CustomizationItem = {
  ...item,
  id: "rule-2",
  title: "Testing",
  content: "## Testing\r\nRun focused tests.\r\n",
  target: { layer: "team", heading: "Testing" },
};
function makeCatalog(): CustomizationCatalog {
  return {
    workspaceName: "fixture",
    spaceId: "default",
    spaces: ["default"],
    engineVersion: "2.8.2",
    configurationRevision: "base",
    capabilities: {
      available: true,
      engineVersion: "2.8.2",
      protocolVersion: 1,
      canApply: true,
      canExportPlugin: true,
      canRecover: true,
    },
    diagnostics: [],
    items: [structuredClone(item), structuredClone(second)],
  };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "guide-customization-test-"));
  directories.push(root);
  const catalog = makeCatalog();
  const calls: { action: string; request: EngineRequest }[] = [];
  let applyCount = 0;
  const engine: CustomizationEngine = {
    async call<T>(action: EngineAction, request: EngineRequest): Promise<T> {
      calls.push({ action, request });
      if (action === "catalog") return structuredClone(catalog) as T;
      if (action === "validate") return { valid: true, diagnostics: [] } as T;
      if (action === "plan")
        return {
          id: "plan-1",
          configurationRevision: catalog.configurationRevision,
          files: [
            {
              relativePath: "aidlc/spaces/default/memory/team.md",
              beforeHash: "before",
              afterHash: "after",
              content: request.items?.[0]?.content,
              itemIds: [item.id],
            },
          ],
          diagnostics: [],
          canApply: true,
        } as T;
      if (action === "apply") {
        applyCount++;
        catalog.configurationRevision = "applied";
        return {
          transactionId: "transaction-1",
          status: "committed",
          configurationRevision: "applied",
        } as T;
      }
      if (action === "export")
        return {
          filename: "plugin.zip",
          mimeType: "application/zip",
          base64: "UEs=",
          diagnostics: [],
          omittedItemIds: request.selectedItemIds?.includes(item.id) ? [item.id] : [],
        } as T;
      throw new Error("unexpected engine action");
    },
  };
  const service = new CustomizationService({ workspaceRoot: root, engine });
  return { root, service, engine, catalog, calls, getApplyCount: () => applyCount };
}
const edit = () => ({ spaceId: "default", expectedConfigurationRevision: "base", changes: [] });
const saveRequest = () => ({
  ...edit(),
  requestId: "save-1",
  changes: [
    { operation: "replace" as const, item: { ...item, content: "## Code Style\nUpdated\n" } },
  ],
});
it("allows catalog sections and scoped knowledge to share a runtime filename", () => {
  const sections = [item, second].map((entry) => ({ ...entry, runtimeId: "team" }));
  const knowledge: CustomizationItem[] = ["developer", "quality"].map((agent) => ({
    id: `knowledge-${agent}`,
    kind: "knowledge",
    title: "Reference",
    owner: "project",
    runtimeId: "reference",
    content: "Reference text",
    target: { knowledgeType: "team-markdown", audience: [agent] },
  }));
  expect(localDiagnostics([...sections, ...knowledge])).toEqual([]);
  const stages: CustomizationItem[] = ["one", "two"].map((id) => ({
    id,
    kind: "stage",
    title: id,
    owner: "project",
    runtimeId: "same-stage",
    content: "stage definition",
  }));
  expect(localDiagnostics(stages)).toContainEqual(
    expect.objectContaining({ code: "duplicate-id", itemId: "two" }),
  );
});
it("old owner directories cannot poison the OS-backed lock", async () => {
  const { root } = await fixture();
  const storage = new CustomizationStorage(root);
  const lock = await storage.path("test.lock", true);
  await mkdir(lock);
  await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2147483647 }));
  await storage.withLock("test", () => storage.writeJson("recovered.json", { recovered: true }));
  expect(await storage.readJson("recovered.json")).toEqual({ recovered: true });
});
it("serializes independent processes and releases the lock after their owner is killed", async () => {
  const { root, service } = await fixture();
  const worker = path.join(root, "lock-worker.ts");
  const module = pathToFileURL(
    fileURLToPath(new URL("../src/customization/storage.ts", import.meta.url)),
  ).href;
  await writeFile(
    worker,
    `import { CustomizationStorage } from ${JSON.stringify(module)};
const storage = new CustomizationStorage(process.argv[2]);
await storage.withLock("multiprocess", async () => {
  if (process.argv[3] === "hold") { process.stdout.write("locked\\n"); await new Promise(() => setInterval(() => {}, 1000)); }
  const current = await storage.readJson("counter.json");
  await Bun.sleep(100);
  await storage.writeJson("counter.json", { value: (current?.value ?? 0) + 1 });
});`,
  );
  const start = (mode: string) => {
    const child = spawn("bun", [worker, root, mode], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return Object.assign(child, { events: child as unknown as EventEmitter });
  };
  const successful = (child: ReturnType<typeof start>) =>
    new Promise<void>((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.events.once("error", reject);
      child.events.once("exit", (code: number | null) =>
        code === 0 ? resolve() : reject(new Error(stderr || `worker exited: ${code}`)),
      );
    });
  await Promise.all([
    successful(start("increment")),
    successful(start("increment")),
    successful(start("increment")),
  ]);
  expect(await service.storage.readJson("counter.json")).toEqual({ value: 3 });
  const owner = start("hold");
  try {
    await new Promise<void>((resolve, reject) => {
      owner.events.once("error", reject);
      owner.stdout.once("data", () => resolve());
    });
    const exited = new Promise<void>((resolve) => owner.events.once("exit", () => resolve()));
    owner.kill("SIGKILL");
    await exited;
    await successful(start("increment"));
    expect(await service.storage.readJson("counter.json")).toEqual({ value: 4 });
  } finally {
    owner.kill("SIGKILL");
  }
}, 20_000);
it("reads per-space rule sections without requiring an active intent", async () => {
  const { root } = await fixture();
  const memory = path.join(root, "aidlc/spaces/default/memory");
  await mkdir(memory, { recursive: true });
  const raw = "\uFEFF---\r\nstatus: active\r\n---\r\nPreamble\r\n## One\r\nA\r\n## Two\r\nB\r\n";
  await writeFile(path.join(memory, "team.md"), raw);
  const catalog = await readCompatibilityCatalog(root);
  expect(
    catalog.items.filter((entry) => entry.kind === "rule-section").map((entry) => entry.content),
  ).toEqual(["## One\r\nA\r\n", "## Two\r\nB\r\n"]);
  expect(await readFile(path.join(memory, "team.md"), "utf8")).toBe(raw);
});

it("validates and commits a save in one request without creating a draft", async () => {
  const { service, calls, root, getApplyCount } = await fixture();
  const request = saveRequest();
  const result = await service.post("save", request);
  expect(result).toMatchObject({ status: "completed" });
  expect(calls.map((call) => call.action)).toEqual(["catalog", "validate", "plan", "apply"]);
  expect(calls.find((call) => call.action === "plan")?.request.items).toEqual([
    request.changes[0]?.item,
  ]);
  expect(
    await readFile(path.join(root, "aidlc/guide-customization/.local/draft.json"), "utf8").catch(
      () => null,
    ),
  ).toBeNull();
  expect(await service.save(request)).toEqual(result);
  expect(getApplyCount()).toBe(1);
  await expect(service.save({ ...request, changes: [] })).rejects.toMatchObject({
    code: "request-id-conflict",
  });
});
it("rejects stale revisions, incomplete settings, and standard edits before applying", async () => {
  const { service, calls, catalog } = await fixture();
  await expect(
    service.save({ ...saveRequest(), expectedConfigurationRevision: "stale" }),
  ).rejects.toMatchObject({ code: "configuration-changed" });
  await expect(
    service.save({
      ...saveRequest(),
      changes: [{ operation: "replace", item: { ...item, content: "" } }],
    }),
  ).rejects.toMatchObject({ code: "validation-failed" });
  catalog.items.push({ ...item, id: "standard", kind: "scope", owner: "core" });
  await expect(
    service.save({ ...saveRequest(), changes: [{ operation: "remove", itemId: "standard" }] }),
  ).rejects.toMatchObject({ code: "item-read-only" });
  expect(calls.some((call) => call.action === "apply")).toBe(false);
});
it("keeps validation errors visible and never reports success on an unsupported engine", async () => {
  const { service, engine, calls } = await fixture();
  const original = engine.call.bind(engine);
  vi.spyOn(engine, "call").mockImplementation(async (action, request) => {
    if (action === "validate")
      throw new CustomizationError("engine-capability-missing", "unsupported", 409);
    return original(action, request);
  });
  await expect(service.save(saveRequest())).rejects.toMatchObject({
    code: "engine-capability-missing",
  });
  expect(calls.some((call) => call.action === "apply")).toBe(false);
  expect(await service.activeOperation()).toBeNull();
});
it("refuses invalid references and blocked plans before any write", async () => {
  const { service, engine, calls } = await fixture();
  const original = engine.call.bind(engine);
  let validationError = true;
  vi.spyOn(engine, "call").mockImplementation(async (action, request) => {
    if (action === "validate" && validationError)
      return {
        valid: false,
        diagnostics: [
          {
            severity: "error",
            code: "missing-reference",
            message: "Missing reference",
            itemId: item.id,
          },
        ],
      } as never;
    if (action === "plan")
      return {
        id: "plan-1",
        configurationRevision: "base",
        canApply: false,
        files: [],
        diagnostics: [{ severity: "error", code: "active-workflow", message: "Workflow active" }],
      } as never;
    return original(action, request);
  });
  await expect(service.save(saveRequest())).rejects.toMatchObject({
    code: "validation-failed",
    diagnostics: [expect.objectContaining({ code: "missing-reference" })],
  });
  validationError = false;
  await expect(service.save(saveRequest())).rejects.toMatchObject({ code: "validation-failed" });
  expect(calls.some((call) => call.action === "apply")).toBe(false);
});
it("serializes concurrent saves so only the current revision commits", async () => {
  const { service, root, engine, getApplyCount } = await fixture();
  const other = new CustomizationService({ workspaceRoot: root, engine });
  const results = await Promise.allSettled([
    service.save(saveRequest()),
    other.save({ ...saveRequest(), requestId: "save-2" }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(getApplyCount()).toBe(1);
});
it("recovers a lost commit response by receipt without persisting editor input", async () => {
  const { service, engine, root, getApplyCount } = await fixture();
  const original = engine.call.bind(engine);
  vi.spyOn(engine, "call").mockImplementation(async (action, request) => {
    if (action === "apply") {
      await original(action, request);
      throw new CustomizationError("engine-unavailable", "lost", 503);
    }
    if (action === "recover")
      return { status: "committed", configurationRevision: "applied" } as never;
    return original(action, request);
  });
  const result = await service.save(saveRequest());
  expect(result).toMatchObject({ status: "running", recoveryRequired: true });
  const reopened = new CustomizationService({ workspaceRoot: root, engine });
  expect(await reopened.activeOperation()).toMatchObject({ id: result.id });
  expect(await reopened.recover({ operationId: result.id })).toMatchObject({ status: "completed" });
  expect(await reopened.save(saveRequest())).toMatchObject({ status: "completed" });
  expect(getApplyCount()).toBe(1);
  expect(await reopened.activeOperation()).toBeNull();
});
it("releases a rolled back save for a corrected request", async () => {
  const { service, engine } = await fixture();
  const original = engine.call.bind(engine);
  vi.spyOn(engine, "call").mockImplementation(async (action, request) =>
    action === "apply"
      ? ({ status: "rolled-back", configurationRevision: "base" } as never)
      : original(action, request),
  );
  expect(await service.save(saveRequest())).toMatchObject({
    status: "failed",
    recoveryRequired: false,
  });
  expect(await service.activeOperation()).toBeNull();
});
it("removes draft and separate apply endpoints", async () => {
  const { service } = await fixture();
  expect(
    await routeCustomizationRead(service, new URL("http://localhost/api/customization/draft")),
  ).toBeNull();
  for (const action of ["draft/save", "draft/discard", "draft/reconcile", "plan", "apply"])
    await expect(service.post(action, {})).rejects.toMatchObject({ code: "unknown-route" });
});
it("rejects host writes, untrusted writes, and cross-origin save requests", async () => {
  const { root, engine, service } = await fixture();
  for (const config of [{ canEdit: () => false }]) {
    const restricted = new CustomizationService({ workspaceRoot: root, engine, ...config });
    await expect(restricted.save(saveRequest())).rejects.toBeInstanceOf(CustomizationError);
  }
  const response = await handleCustomizationPost(
    service,
    "save",
    new Request("http://localhost/api/customization/save", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify(saveRequest()),
    }),
  );
  expect(response.status).toBe(403);
});
it("exports and imports selected edits without saving or applying them", async () => {
  const { service, calls } = await fixture();
  const output = await service.export({
    ...saveRequest(),
    format: "guide",
    selectedItemIds: [item.id],
  });
  const data = JSON.parse(output.content);
  expect(data.items).toHaveLength(1);
  expect(data.items[0].source).toBeUndefined();
  const plan = (await service.post("import/analyze", {
    ...edit(),
    package: data,
  })) as import("@andon/shared-types").CustomizationImportPlan;
  const imported = (await service.post("import/adopt", {
    ...edit(),
    planId: plan.id,
    selections: [{ sourceId: item.id, targetId: item.id }],
  })) as CustomizationItem[];
  expect(imported[0]?.content).toContain("Updated");
  expect(imported[1]).toEqual(second);
  await expect(
    service.post("import/adopt", {
      ...saveRequest(),
      planId: plan.id,
      selections: [{ sourceId: item.id, targetId: item.id }],
    }),
  ).rejects.toMatchObject({ code: "import-stale" });
  expect(calls.some((call) => call.action === "apply")).toBe(false);
});
it("rejects corrupt packages and invalid checksums and ignores injected provenance", async () => {
  const { service } = await fixture();
  expect(
    applyChanges(
      [item],
      [
        {
          operation: "replace",
          item: parseItem({ ...item, source: { relativePath: "../../secret", hash: "x" } }),
        },
      ],
    )[0]?.source,
  ).toEqual(item.source);
  expect(() =>
    parseItem({
      ...item,
      binary: { base64: "YQ==", bytes: 1, sha256: "wrong", mimeType: "text/plain" },
    }),
  ).toThrow();
  const output = await service.export({ ...edit(), format: "guide", selectedItemIds: [item.id] });
  const data = JSON.parse(output.content);
  data.items[0].content = "tampered";
  await expect(service.post("import/analyze", { ...edit(), package: data })).rejects.toMatchObject({
    code: "package-corrupt",
  });
});
it("requires acknowledgement for omissions in plugin exports", async () => {
  const { service } = await fixture();
  await expect(
    service.export({ ...edit(), format: "plugin", selectedItemIds: [item.id] }),
  ).rejects.toMatchObject({ code: "export-omissions" });
  expect(
    await service.export({
      ...edit(),
      format: "plugin",
      selectedItemIds: [item.id],
      confirmedOmissions: true,
    }),
  ).toMatchObject({ filename: "plugin.zip", encoding: "base64" });
});

it("keeps imported document references bound to the explicitly selected source", async () => {
  const { service } = await fixture();
  const source: CustomizationItem = {
    id: "doc-source",
    kind: "knowledge",
    owner: "project",
    title: "Document",
    content: "",
    target: { knowledgeType: "document-source", filename: "example.txt" },
    binary: { base64: "YQ==", bytes: 1, sha256: digest("a"), mimeType: "text/plain" },
  };
  const ref: CustomizationItem = {
    id: "doc-ref",
    kind: "knowledge",
    owner: "project",
    title: "Reference",
    content: JSON.stringify({ documentId: "local-document", sourceItemId: source.id }),
    target: { knowledgeType: "document-reference", audience: "all" },
  };
  const input = {
    ...edit(),
    changes: [source, ref].map((item) => ({ operation: "create", item })),
  };
  const output = await service.export({
    ...input,
    format: "guide",
    selectedItemIds: [source.id, ref.id],
  });
  const plan = (await service.post("import/analyze", {
    ...input,
    package: JSON.parse(output.content),
  })) as import("@andon/shared-types").CustomizationImportPlan;
  const imported = (await service.post("import/adopt", {
    ...input,
    planId: plan.id,
    selections: [
      { sourceId: source.id, targetId: null },
      { sourceId: ref.id, targetId: null },
    ],
  })) as CustomizationItem[];
  const newSource = imported.find(
    (item) => item.target?.knowledgeType === "document-source" && item.id !== source.id,
  );
  const newRef = imported.find(
    (item) => item.target?.knowledgeType === "document-reference" && item.id !== ref.id,
  );
  expect(newSource).toBeTruthy();
  expect(JSON.parse(newRef?.content ?? "{}").sourceItemId).toBe(newSource?.id);
  const isolated = (await service.post("import/adopt", {
    ...input,
    planId: plan.id,
    selections: [{ sourceId: ref.id, targetId: null }],
  })) as CustomizationItem[];
  expect(
    JSON.parse(
      isolated.find(
        (item) => item.target?.knowledgeType === "document-reference" && item.id !== ref.id,
      )?.content ?? "{}",
    ).documentId,
  ).toBe("unresolved-import");
});
it("exports Guide JSON without a capable engine but never hides other validation failures", async () => {
  const { service, engine } = await fixture();
  const original = engine.call.bind(engine);
  let reason = "engine-capability-missing";
  vi.spyOn(engine, "call").mockImplementation(async (action, request) => {
    if (action === "validate") throw new CustomizationError(reason, "engine unavailable", 409);
    return original(action, request);
  });
  expect(
    await service.export({ ...edit(), format: "guide", selectedItemIds: [item.id] }),
  ).toMatchObject({
    diagnostics: [
      expect.objectContaining({ severity: "warning", code: "engine-capability-missing" }),
    ],
  });
  reason = "engine-unavailable";
  await expect(
    service.export({ ...edit(), format: "guide", selectedItemIds: [item.id] }),
  ).rejects.toMatchObject({ code: "engine-unavailable" });
});
