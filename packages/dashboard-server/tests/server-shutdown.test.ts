import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  serve: vi.fn(),
}));
vi.mock("@andon/api-core", () => ({
  acceptsCustomizationOrigin: vi.fn(),
  createGuideService: mocks.create,
  handlePost: vi.fn(),
  handleRead: vi.fn(),
}));

import { serve } from "../src/server.ts";

function deferred() {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Bun", { serve: mocks.serve });
});
afterEach(() => vi.unstubAllGlobals());

describe("server shutdown", () => {
  it("stops the listener and disposes resources once, including repeated stop calls", async () => {
    const network = deferred();
    const stop = vi.fn(() => network.promise);
    const unwatch = vi.fn();
    const disposeDocs = vi.fn();
    mocks.create.mockReturnValue({
      startMatrixBackground: vi.fn(),
      startWatch: () => unwatch,
      docsQa: { dispose: disposeDocs },
    });
    mocks.serve.mockReturnValue({ port: 4700, hostname: "127.0.0.1", stop });
    const running = await serve({ port: 0 });
    const stopping = running.stop();
    expect(running.stop()).toBe(stopping);
    expect(stop).toHaveBeenCalledExactlyOnceWith(true);
    expect(unwatch).toHaveBeenCalledOnce();
    expect(disposeDocs).toHaveBeenCalledOnce();
    let settled = false;
    void stopping.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    network.resolve();
    await stopping;
    expect(settled).toBe(true);
  });

  it("waits for network shutdown and propagates a cleanup failure", async () => {
    const network = deferred();
    const failure = new Error("cleanup failed");
    const stop = vi.fn(() => network.promise);
    mocks.create.mockReturnValue({
      startMatrixBackground: vi.fn(),
      startWatch: () => vi.fn(),
      docsQa: {
        dispose: () => {
          throw failure;
        },
      },
    });
    mocks.serve.mockReturnValue({ port: 4700, hostname: "127.0.0.1", stop });
    const running = await serve({ port: 0 });
    const stopping = running.stop();
    const failed = expect(stopping).rejects.toBe(failure);
    let settled = false;
    void stopping.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stop).toHaveBeenCalledExactlyOnceWith(true);
    expect(settled).toBe(false);
    network.resolve();
    await failed;
  });

  it("preserves both cleanup and network errors", async () => {
    const cleanupFailure = new Error("cleanup failed");
    const networkFailure = new Error("listener failed");
    mocks.create.mockReturnValue({
      startMatrixBackground: vi.fn(),
      startWatch: () => vi.fn(),
      docsQa: {
        dispose: () => {
          throw cleanupFailure;
        },
      },
    });
    mocks.serve.mockReturnValue({
      port: 4700,
      hostname: "127.0.0.1",
      stop: vi.fn().mockRejectedValue(networkFailure),
    });
    const running = await serve({ port: 0 });
    await expect(running.stop()).rejects.toMatchObject({
      errors: [cleanupFailure, networkFailure],
    });
  });
});
