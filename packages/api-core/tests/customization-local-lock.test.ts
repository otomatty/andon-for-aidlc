import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { acquireLocalLock, localLockPorts } from "../src/customization/local-lock";

// Windows reserves loopback port ranges (Hyper-V, WinNAT, WSL, Docker) and a
// listen inside one fails with EACCES. The mock reproduces that per port so the
// lock can be exercised on every OS.
const reserved = new Set<number>();
const failing = new Map<number, string>();
vi.mock("node:net", async (original) => {
  const net = await original<typeof import("node:net")>();
  return {
    ...net,
    createServer: vi.fn((...args: Parameters<typeof net.createServer>) => {
      const server = net.createServer(...args);
      const listen = server.listen.bind(server) as (...rest: unknown[]) => Server;
      server.listen = ((...rest: unknown[]) => {
        const port = (rest[0] as { port?: number }).port ?? -1;
        const code = reserved.has(port) ? "EACCES" : failing.get(port);
        if (code === undefined) return listen(...rest);
        process.nextTick(() =>
          server.emit(
            "error",
            Object.assign(new Error(`listen ${code}: 127.0.0.1:${port}`), { code }),
          ),
        );
        return server;
      }) as Server["listen"];
      return server;
    }),
  };
});

afterEach(() => {
  reserved.clear();
  failing.clear();
});

const open = (port: number) =>
  new Promise<Server | null>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => resolve(server));
  });
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

/** A key whose candidate ports this machine can actually bind right now. */
async function freeKey(): Promise<string> {
  for (;;) {
    const key = `/tmp/customization-lock-${randomUUID()}/locks/apply.lock`;
    const servers = await Promise.all(localLockPorts(key).map(open));
    await Promise.all(servers.filter((server) => server !== null).map(close));
    if (servers.every((server) => server !== null)) return key;
  }
}

const busy = { code: "operation-active", status: 409 };

it("keeps the first candidate on the port older releases use, so mixed versions exclude each other while it is bindable", () => {
  const key = "/workspace/.andon/customization/locks/apply.lock";
  const legacy = 16384 + (createHash("sha256").update(key).digest().readUInt32BE(0) % 49152);
  const ports = localLockPorts(key);
  expect(ports[0]).toBe(process.platform === "win32" ? localLockPorts(key.toLowerCase())[0] : legacy);
  expect(ports.length).toBeGreaterThan(1);
  expect(new Set(ports).size).toBe(ports.length);
  for (const port of ports) {
    expect(port).toBeGreaterThanOrEqual(16384);
    expect(port).toBeLessThan(65536);
  }
});

it("acquires the lock when the first candidate port is reserved by the OS", async () => {
  const key = await freeKey();
  reserved.add(localLockPorts(key)[0]!);
  const release = await acquireLocalLock(key, false);
  await expect(acquireLocalLock(key, false)).rejects.toMatchObject(busy);
  await release();
  await (await acquireLocalLock(key, false))();
});

it("treats any held candidate as contention and keeps none of the others", async () => {
  const key = await freeKey();
  const ports = localLockPorts(key);
  const other = (await open(ports.at(-1)!))!;
  try {
    await expect(acquireLocalLock(key, false)).rejects.toMatchObject(busy);
    // Nothing acquired before the contention is left bound.
    for (const port of ports.slice(0, -1)) {
      const probe = await open(port);
      expect(probe).not.toBeNull();
      await close(probe!);
    }
  } finally {
    await close(other);
  }
  await (await acquireLocalLock(key, false))();
});

it("excludes a holder that saw a different set of reserved ports", async () => {
  const key = await freeKey();
  // The holder started while the first port sat inside a reserved range ...
  reserved.add(localLockPorts(key)[0]!);
  const release = await acquireLocalLock(key, false);
  // ... and the range was released before the next process tried.
  reserved.clear();
  try {
    await expect(acquireLocalLock(key, false)).rejects.toMatchObject(busy);
  } finally {
    await release();
  }
  await (await acquireLocalLock(key, false))();
});

it("waits for a holder to release instead of failing", async () => {
  const key = await freeKey();
  const release = await acquireLocalLock(key, false);
  const waiting = acquireLocalLock(key, true);
  setTimeout(() => void release(), 50);
  await (await waiting)();
});

it("fails with the OS error when every candidate port is reserved", async () => {
  const key = await freeKey();
  for (const port of localLockPorts(key)) reserved.add(port);
  await expect(acquireLocalLock(key, true)).rejects.toMatchObject({ code: "EACCES" });
});

it("releases what it holds and surfaces an unexpected listen error", async () => {
  const key = await freeKey();
  const ports = localLockPorts(key);
  failing.set(ports[1]!, "EPERM");
  await expect(acquireLocalLock(key, false)).rejects.toMatchObject({ code: "EPERM" });
  failing.clear();
  await (await acquireLocalLock(key, false))();
});
