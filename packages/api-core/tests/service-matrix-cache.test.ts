import path from "node:path";
import { buildMatrixForUnits } from "@aidlc-guide/reader-core";
import type {
  Matrix,
  MatrixCell,
  ReadResult,
  WorkflowModel,
  WsMessage,
} from "@aidlc-guide/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuideService } from "../src/service.ts";

vi.mock("@aidlc-guide/reader-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aidlc-guide/reader-core")>()),
  buildMatrixForUnits: vi.fn(),
}));

const workflow: WorkflowModel = {
  project: "cache-test",
  scope: "feature",
  depth: "Standard",
  stateVersion: 8,
  phase: "CONSTRUCTION",
  currentStage: "code-generation",
  nextStage: "code-generation",
  gate: "in-progress",
  stages: [
    { slug: "code-generation", phase: "CONSTRUCTION", execution: "EXECUTE", status: "in-progress" },
  ],
  done: 0,
  total: 1,
};

function matrix(verdict: MatrixCell["verdict"]): ReadResult<Matrix> {
  return {
    ok: true,
    value: {
      units: ["unit-a", "unit-b"],
      stages: ["code-generation"],
      cells: ["unit-a", "unit-b"].map((unit) => ({
        unit,
        stage: "code-generation",
        files: ["plan.md"],
        verdict,
      })),
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const service = createGuideService({ versionGate: null,
    workspaceRoot: path.resolve("cache-test-workspace"),
    recordDir: path.resolve("cache-test-workspace/aidlc/spaces/default/intents/cache-test"),
  });
  const messages: WsMessage[] = [];
  service.hub.add({ send: (data) => messages.push(JSON.parse(data) as WsMessage) });
  vi.spyOn(service.reader, "getWorkflow").mockResolvedValue({ ok: true, value: workflow });
  return { service, messages };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(buildMatrixForUnits).mockReset();
});

describe("service matrix cache after review input changes", () => {
  it.each(["review-inputs", "state"] as const)(
    "invalidates %s immediately before the full read and reuses its result",
    async (scope) => {
      const { service } = fixture();
      const updated = deferred<ReadResult<Matrix>>();
      const read = vi
        .spyOn(service.reader, "getMatrix")
        .mockResolvedValueOnce(matrix("READY"))
        .mockReturnValueOnce(updated.promise);
      service.startMatrixBackground();
      await vi.waitFor(() => expect(service.readContext.matrix()).toEqual(matrix("READY")));

      const refresh = service.hub.handleWatchEvent({ type: "change", scope, path: "changed" });
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(service.readContext.matrix()).toBeNull();
      const reconnected: WsMessage[] = [];
      service.hub.add({ send: (data) => reconnected.push(JSON.parse(data) as WsMessage) });
      updated.resolve(matrix(null));
      await refresh;
      expect(service.readContext.matrix()).toEqual(matrix(null));
      expect(read).toHaveBeenCalledTimes(2);
      expect(reconnected.find((message) => message.type === "matrix-ready")).toMatchObject({
        type: "matrix-ready",
        matrix: { cells: [{ verdict: null }, { verdict: null }] },
      });
    },
  );

  it("does not let an older startup result overwrite a completed source refresh", async () => {
    const { service, messages } = fixture();
    const startup = deferred<ReadResult<Matrix>>();
    const read = vi
      .spyOn(service.reader, "getMatrix")
      .mockReturnValueOnce(startup.promise)
      .mockResolvedValueOnce(matrix(null));
    service.startMatrixBackground();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await service.hub.handleWatchEvent({
      type: "change",
      scope: "review-inputs",
      path: "src/a.ts",
    });
    expect(service.readContext.matrix()).toEqual(matrix(null));
    startup.resolve(matrix("READY"));
    await Promise.resolve();
    await Promise.resolve();
    expect(service.readContext.matrix()).toEqual(matrix(null));
    expect(messages.filter((message) => message.type === "matrix-ready")).toMatchObject([
      { type: "matrix-ready", matrix: { cells: [{ verdict: null }, { verdict: null }] } },
    ]);
  });

  it("replaces an invalidated READY cache with the full read failure", async () => {
    const { service } = fixture();
    const failure = { error: true, reason: "state-missing" } as const;
    vi.spyOn(service.reader, "getMatrix")
      .mockResolvedValueOnce(matrix("READY"))
      .mockResolvedValueOnce(failure);
    service.startMatrixBackground();
    await vi.waitFor(() => expect(service.readContext.matrix()).toEqual(matrix("READY")));
    await service.hub.handleWatchEvent({
      type: "change",
      scope: "review-inputs",
      path: "src/a.ts",
    });
    expect(service.readContext.matrix()).toEqual(failure);
  });

  it("clears and replaces only the changed unit without another full scan", async () => {
    const { service } = fixture();
    const changed = deferred<ReadResult<MatrixCell[]>>();
    vi.mocked(buildMatrixForUnits).mockReturnValueOnce(changed.promise);
    const read = vi.spyOn(service.reader, "getMatrix").mockResolvedValue(matrix("READY"));
    service.startMatrixBackground();
    await vi.waitFor(() => expect(service.readContext.matrix()).toEqual(matrix("READY")));
    const refresh = service.hub.handleWatchEvent({
      type: "change",
      scope: "matrix:unit-a",
      path: "plan.md",
    });
    await vi.waitFor(() => expect(buildMatrixForUnits).toHaveBeenCalledTimes(1));
    const invalidated = service.readContext.matrix();
    expect(
      invalidated && "ok" in invalidated && invalidated.value.cells.map((cell) => cell.verdict),
    ).toEqual([null, "READY"]);
    const updated: MatrixCell = {
      unit: "unit-a",
      stage: "code-generation",
      files: ["new-plan.md"],
      verdict: null,
    };
    changed.resolve({ ok: true, value: [updated] });
    await refresh;
    const cached = service.readContext.matrix();
    expect(
      cached && "ok" in cached && cached.value.cells.find((cell) => cell.unit === "unit-a"),
    ).toEqual(updated);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("overlays unit invalidation and completion on a still-running startup scan", async () => {
    const { service, messages } = fixture();
    const startup = deferred<ReadResult<Matrix>>();
    const changed = deferred<ReadResult<MatrixCell[]>>();
    vi.mocked(buildMatrixForUnits).mockReturnValueOnce(changed.promise);
    const read = vi.spyOn(service.reader, "getMatrix").mockReturnValueOnce(startup.promise);
    service.startMatrixBackground();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const refresh = service.hub.handleWatchEvent({
      type: "change",
      scope: "matrix:unit-a",
      path: "plan.md",
    });
    await vi.waitFor(() => expect(buildMatrixForUnits).toHaveBeenCalledTimes(1));
    startup.resolve(matrix("READY"));
    await vi.waitFor(() => expect(service.readContext.matrix()).not.toBeNull());
    const initial = service.readContext.matrix();
    expect(initial && "ok" in initial && initial.value.cells.map((cell) => cell.verdict)).toEqual([
      null,
      "READY",
    ]);
    const sent = messages.find((message) => message.type === "matrix-ready");
    expect(sent?.type === "matrix-ready" && sent.matrix.cells[0]?.verdict).toBeNull();
    const updated: MatrixCell = {
      unit: "unit-a",
      stage: "code-generation",
      files: ["new-plan.md"],
      verdict: "NOT-READY",
    };
    changed.resolve({ ok: true, value: [updated] });
    await refresh;
    const cached = service.readContext.matrix();
    expect(
      cached && "ok" in cached && cached.value.cells.find((cell) => cell.unit === "unit-a"),
    ).toEqual(updated);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
