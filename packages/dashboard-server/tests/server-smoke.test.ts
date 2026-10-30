import { type ChildProcess, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { WsMessage } from "@aidlc-guide/shared-types";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIST_DIR, DIST_MISSING_HINT } from "../src/server.ts";
import { CLI, STATE_MD, seedWorkspace } from "./support.ts";

/** @types/node@26 ChildProcess class omits EventEmitter methods; restore them. */
function processEvents(child: ChildProcess): EventEmitter {
  return child as unknown as EventEmitter;
}

/**
 * End-to-end against a **real** `Bun.serve` on port 0.
 *
 * Vitest runs under Node here, where `Bun.serve` does not exist, so the server
 * is spawned as a child Bun process and driven over real HTTP and a real
 * WebSocket. This is the only test that exercises server.ts / cli.ts wiring —
 * both are excluded from coverage for exactly that reason (vitest.config.ts).
 */

const BUN = process.platform === "win32" ? "bun.exe" : "bun";
// Anchored on the ready line's own prefix so a later URL in the log cannot
// be mistaken for the bind address.
const READY = /Andon dashboard: http:\/\/([\d.]+):(\d+)/;
const TIMEOUT = 30_000;
// The ready line is printed once Bun.serve returns, but under a busy machine
// (pre-push packs objects while this suite runs) the upgrade can still fail
// for a moment. A few short retries cover that gap; a dead server still fails.
const CONNECT_ATTEMPTS = 30;
const CONNECT_GAP_MS = 500;
const CONNECT_ATTEMPT_MS = 1_000;

interface Running {
  origin: string;
  hostname: string;
  stdout: string;
  child: ChildProcess;
}

const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

function start(args: readonly string[], cwd: string): Promise<Running> {
  return new Promise((resolve, reject) => {
    const child = spawn(BUN, [CLI, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    running.push(child);

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => reject(new Error(`no ready line. out=${stdout} err=${stderr}`)),
      TIMEOUT - 5_000,
    );

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = READY.exec(stdout);
      if (match?.[1] === undefined || match[2] === undefined) return;
      clearTimeout(timer);
      // Always talk to loopback even when the server bound 0.0.0.0.
      resolve({ origin: `http://127.0.0.1:${match[2]}`, hostname: match[1], stdout, child });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    processEvents(child).on("error", reject);
    processEvents(child).on("exit", (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}). out=${stdout} err=${stderr}`));
    });
  });
}

function openOnce(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error("websocket timed out"));
    }, CONNECT_ATTEMPT_MS);
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) {
        resolve(socket);
        return;
      }
      socket.close();
      reject(error);
    };
    socket.addEventListener("open", () => settle());
    socket.addEventListener("error", (event) => {
      const message = "message" in event && typeof event.message === "string" ? event.message : "";
      settle(new Error(message === "" ? "websocket error" : `websocket error: ${message}`));
    });
  });
}

async function open(origin: string): Promise<WebSocket> {
  const url = `${origin.replace("http", "ws")}/ws`;
  let last: unknown;
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await openOnce(url);
    } catch (error) {
      last = error;
      if (attempt === CONNECT_ATTEMPTS - 1) break;
      await new Promise((resolve) => setTimeout(resolve, CONNECT_GAP_MS));
    }
  }
  throw last instanceof Error ? last : new Error("websocket error");
}

/** Collect pushes until `match` is satisfied, then resolve with everything seen. */
async function collect(origin: string, match: (m: WsMessage) => boolean): Promise<WsMessage[]> {
  const socket = await open(origin);
  return new Promise((resolve, reject) => {
    const seen: WsMessage[] = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no matching push. saw ${JSON.stringify(seen)}`));
    }, TIMEOUT - 5_000);

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as WsMessage;
      seen.push(message);
      if (!match(message)) return;
      clearTimeout(timer);
      socket.close();
      resolve(seen);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    });
  });
}

describe("bind and startup", () => {
  it(
    "defaults to loopback and answers /api/workflow without a matrix (S-DS-1, ADR-03)",
    async () => {
      const { root } = await seedWorkspace();
      const server = await start(["--port", "0"], root);

      expect(server.hostname).toBe("127.0.0.1");
      // The dashboard package now exists, so whether this run is API-only
      // depends on whether `bun run build:dashboard` has been run in this
      // checkout. Assert the branch rather than one side of it — the API
      // contract below is identical either way.
      const apiOnly = !existsSync(path.join(DEFAULT_DIST_DIR, "index.html"));
      expect(server.stdout.includes(DIST_MISSING_HINT)).toBe(apiOnly);

      const body = (await (await fetch(`${server.origin}/api/workflow`)).json()) as Record<
        string,
        unknown
      >;
      expect(body).not.toHaveProperty("serverMode");
      expect(server.stdout).not.toContain("0.0.0.0");
      expect(body.workflow).toMatchObject({ currentStage: "functional-design" });
      expect(body).not.toHaveProperty("matrix");
    },
    TIMEOUT,
  );

  it(
    "refuses workflow reads for an older project but still serves bundled docs",
    async () => {
      const { root } = await seedWorkspace("2.0.0");
      const server = await start(["--port", "0"], root);

      const workflow = await fetch(`${server.origin}/api/workflow`);
      expect(workflow.status).toBe(409);
      expect(await workflow.json()).toMatchObject({
        reason: "version-gate",
        gate: { status: "project-older" },
      });
      const docs = await fetch(`${server.origin}/api/guides`);
      expect(docs.status).not.toBe(409);
    },
    TIMEOUT,
  );

  it(
    "rejects --host and does not start a server",
    async () => {
      const { root: workspace } = await seedWorkspace();
      const result = await new Promise<{ code: number | null; out: string; err: string }>(
        (resolve, reject) => {
          const child = spawn(BUN, [CLI, "--host"], { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] });
          running.push(child);
          let out = "";
          let err = "";
          child.stdout?.on("data", (chunk: Buffer) => {
            out += chunk.toString();
          });
          child.stderr?.on("data", (chunk: Buffer) => {
            err += chunk.toString();
          });
          processEvents(child).on("error", reject);
          processEvents(child).on("exit", (code: number | null) => resolve({ code, out, err }));
        },
      );
      expect(result.code).not.toBe(0);
      expect(result.err).toContain("unknown argument");
      expect(result.err).toContain("--host");
      expect(result.out).not.toMatch(READY);
    },
    TIMEOUT,
  );

  it(
    "makes a bind failure fatal instead of falling back to loopback (R-MM-1 / BR-MM-5)",
    async () => {
      const { root } = await seedWorkspace();
      // Take a real port with a real server, then ask a second one for it.
      const holder = await start(["--port", "0"], root);
      const port = new URL(holder.origin).port;

      const second = await new Promise<{ code: number | null; out: string; err: string }>(
        (resolve, reject) => {
          const child = spawn(BUN, [CLI, "--port", port], {
            cwd: root,
            stdio: ["ignore", "pipe", "pipe"],
          });
          running.push(child);
          let out = "";
          let err = "";
          child.stdout?.on("data", (chunk: Buffer) => {
            out += chunk.toString();
          });
          child.stderr?.on("data", (chunk: Buffer) => {
            err += chunk.toString();
          });
          processEvents(child).on("error", reject);
          processEvents(child).on("exit", (code: number | null) => resolve({ code, out, err }));
        },
      );

      expect(second.code).not.toBe(0);
      // The operator is told why and what to do, on stderr.
      expect(second.err).toMatch(/EADDRINUSE|address already in use|port \d+ in use/i);
      expect(second.err).toContain("使用中");
      expect(second.err).toContain("--port");
      // And it did NOT quietly serve something: no ready line.
      expect(second.out).not.toMatch(READY);
      // The first server is untouched and still answering.
      expect((await fetch(`${holder.origin}/api/workflow`)).status).toBe(200);
    },
    TIMEOUT,
  );

});

describe("write path end to end (US-14)", () => {
  it(
    "accepts an answer on loopback and leaves the rest of the file intact",
    async () => {
      const { root, recordDir } = await seedWorkspace();
      const questions = path.join(recordDir, "a-questions.md");
      await writeFile(questions, "# Q1\n[Answer]: \n\n# Q2\n[Answer]: keep\n");
      const server = await start(["--port", "0"], root);

      const response = await fetch(`${server.origin}/api/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "a-questions.md", line: 2, value: "bun" }),
      });

      expect(response.status).toBe(200);
      const body = (await (
        await fetch(`${server.origin}/api/artifact?path=a-questions.md`)
      ).json()) as { value: string };
      expect(body.value).toBe("# Q1\n[Answer]: bun\n\n# Q2\n[Answer]: keep\n");
    },
    TIMEOUT,
  );
});

describe("websocket push (FR-7.2 / BR-DS-6)", () => {
  it(
    "delivers the identical payload to two connected clients and ignores inbound frames",
    async () => {
      const { root, recordDir } = await seedWorkspace();
      const server = await start(["--port", "0"], root);

      // Open one client at a time. Two upgrade attempts in parallel, retried
      // together, keep the stalled server from accepting either.
      const a = await open(server.origin);
      const b = await open(server.origin);
      const isState = (m: WsMessage): boolean => m.type === "change" && m.scope === "state";
      const waitA = new Promise<string>((resolve) =>
        a.addEventListener("message", (event) => {
          if (isState(JSON.parse(String(event.data)) as WsMessage)) resolve(String(event.data));
        }),
      );
      const waitB = new Promise<string>((resolve) =>
        b.addEventListener("message", (event) => {
          if (isState(JSON.parse(String(event.data)) as WsMessage)) resolve(String(event.data));
        }),
      );

      // S-DS-6: the server defines no inbound protocol; this must be dropped
      // rather than crash the connection or the process.
      a.send(JSON.stringify({ type: "write", evil: true }));
      a.send("not even json");

      // The child subscribes its watcher just after it prints the ready line,
      // so a single write can land before chokidar is listening. Re-apply the
      // same change until it is observed — the content is identical every time,
      // so extra events cannot change what the clients are asserted on.
      const both = Promise.all([waitA, waitB]);
      let settled = false;
      void both.then(() => {
        settled = true;
      });
      const trigger = setInterval(() => {
        if (settled) return;
        void writeFile(
          path.join(recordDir, "aidlc-state.md"),
          STATE_MD.replace("**Completed**: 1", "**Completed**: 2"),
        );
      }, 400);

      const [rawA, rawB] = await both.finally(() => clearInterval(trigger));
      expect(rawA).toBe(rawB);
      const message = JSON.parse(rawA) as Extract<WsMessage, { scope: "state" }>;
      expect(message.workflow.done).toBe(2);
      expect(message.nextStep.nextStage).toBe("code-generation");

      a.close();
      b.close();
      // The server survived the junk frames.
      expect((await fetch(`${server.origin}/api/workflow`)).status).toBe(200);
    },
    TIMEOUT * 2,
  );

  it(
    "builds the matrix in the background and announces it with matrix-ready",
    async () => {
      const { root } = await seedWorkspace();
      const started = Date.now();
      const server = await start(["--port", "0"], root);
      // Either the push arrives, or the scan already finished — both prove the
      // stage-2 build ran off the first-paint path. A dropped socket must not
      // cancel the HTTP check; under load the upgrade fails while GET still works.
      // Keep polling until just before this test's own deadline: a 4s cap can
      // expire while the matrix is still building and the socket is still retrying.
      const pushed = collect(server.origin, (m) => m.type === "matrix-ready").then(
        () => "pushed" as const,
      );
      const cached = (async () => {
        const deadline = started + TIMEOUT * 2 - 5_000;
        while (Date.now() < deadline) {
          const body = (await (await fetch(`${server.origin}/api/matrix`)).json()) as {
            building?: boolean;
          };
          if (body.building !== true) return "cached" as const;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("matrix never finished");
      })();
      // The loser may reject after the winner settles. A handler keeps that
      // from becoming an unhandled rejection; Promise.any still sees the originals.
      void pushed.catch(() => {});
      void cached.catch(() => {});
      const settled = await Promise.any([pushed, cached]);
      expect(["pushed", "cached"]).toContain(settled);
    },
    TIMEOUT * 2,
  );
});
