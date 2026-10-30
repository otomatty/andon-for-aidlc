#!/usr/bin/env bun
/**
 * Launch, doctor, and stop a disposable Andon dashboard-server.
 * Invocation is documented in ../SKILL.md. Never attach to a server this
 * process did not start.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..", "..");
const RUN_FILE = path.join(SKILL_DIR, ".run.json");
const EVIDENCE_DIR = path.join(SKILL_DIR, "evidence");
const CLI = path.join(REPO_ROOT, "packages", "dashboard-server", "src", "cli.ts");
const DIST_INDEX = path.join(REPO_ROOT, "packages", "dashboard", "dist", "index.html");
const DIST_DIR = path.dirname(DIST_INDEX);
const READY = /Andon dashboard: http:\/\/([\d.]+):(\d+)/;
const READY_MS = 30_000;
const HEALTH_MS = 8_000;
const KILL_WAIT_MS = 8_000;
const BUN = process.platform === "win32" ? "bun.exe" : "bun";

type Command = "launch" | "doctor" | "origin" | "stop";

interface RunRecord {
  id: string;
  pid: number;
  origin: string;
  hostname: string;
  port: number;
  cwd: string;
  startedAt: string;
  evidenceDir: string;
  /** Hash of every fingerprinted file's path, size, and mtime (deletes included). */
  sourceFingerprint: string;
  /** OS start identity captured at spawn. Required before any `process.kill(pid)`. */
  processStartKey: string | null;
}

function isCommand(value: string): value is Command {
  return value === "launch" || value === "doctor" || value === "origin" || value === "stop";
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function fail(message: string, extra?: Record<string, unknown>): never {
  print({ ok: false, error: message, ...extra });
  process.exit(1);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stable OS-level identity for `pid`. Origin HTTP is not process identity:
 * another listener can serve the same URL, and Windows can reuse the pid
 * between the alive-check and `process.kill`.
 */
function processStartKey(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
        ],
        { encoding: "utf8", timeout: 8000, windowsHide: true },
      );
      const key = result.stdout.trim();
      return result.status === 0 && /^\d+$/.test(key) ? key : null;
    }
    const procStat = `/proc/${pid}/stat`;
    if (existsSync(procStat)) {
      const stat = readFileSync(procStat, "utf8");
      const close = stat.lastIndexOf(")");
      if (close === -1) return null;
      const after = stat.slice(close + 1).trim().split(/\s+/);
      const starttime = after[19];
      return starttime !== undefined && starttime !== "" ? starttime : null;
    }
    const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 5000,
    });
    const key = result.stdout.trim();
    return result.status === 0 && key !== "" ? key : null;
  } catch {
    return null;
  }
}

function sameProcess(pid: number, startKey: string | null | undefined): boolean {
  if (startKey === undefined || startKey === null || startKey === "") return false;
  const live = processStartKey(pid);
  return live !== null && live === startKey;
}

/** Signal only when the recorded pid is still the same OS process. */
function tryKillRecorded(
  run: Pick<RunRecord, "pid" | "processStartKey">,
): "signaled" | "already-dead" | "mismatch" {
  if (!sameProcess(run.pid, run.processStartKey)) return "mismatch";
  try {
    process.kill(run.pid);
    return "signaled";
  } catch (error) {
    if (!pidAlive(run.pid)) return "already-dead";
    fail("failed to kill recorded pid", { pid: run.pid, error: errorMessage(error) });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True once the pid is gone or no longer the spawn-time process. */
async function confirmRecordedExit(
  run: Pick<RunRecord, "pid" | "processStartKey">,
): Promise<boolean> {
  const deadline = Date.now() + KILL_WAIT_MS;
  while (Date.now() < deadline) {
    if (!pidAlive(run.pid)) return true;
    if (
      run.processStartKey !== undefined &&
      run.processStartKey !== null &&
      run.processStartKey !== "" &&
      !sameProcess(run.pid, run.processStartKey)
    ) {
      return true;
    }
    await sleep(100);
  }
  if (!pidAlive(run.pid)) return true;
  if (
    run.processStartKey !== undefined &&
    run.processStartKey !== null &&
    run.processStartKey !== ""
  ) {
    return !sameProcess(run.pid, run.processStartKey);
  }
  return false;
}

async function reapSpawned(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.pid === undefined) {
    child.kill();
    return;
  }
  const key = processStartKey(child.pid);
  child.kill();
  if (await confirmRecordedExit({ pid: child.pid, processStartKey: key })) return;
  child.kill("SIGKILL");
  await confirmRecordedExit({ pid: child.pid, processStartKey: key });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isWorkflowPayload(body: unknown): boolean {
  return isRecord(body) && isRecord(body.workflow) && isRecord(body.nextStep);
}

function isTypedWorkflowError(body: unknown): boolean {
  return isRecord(body) && body.error === true && typeof body.reason === "string";
}

function isUnsupportedWorkspace(body: unknown): boolean {
  return isRecord(body) && body.unsupported === true && typeof body.version === "string";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function timedGet(
  url: string,
): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      contentType: response.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchUrl(
  url: string,
): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  try {
    return await timedGet(url);
  } catch (error) {
    fail("request failed", { url, error: errorMessage(error) });
  }
}

function parseJsonBody(text: string, url: string, status: number): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("response was not JSON", { url, status, error: errorMessage(error) });
  }
}

async function originLooksLikeDashboard(origin: string): Promise<boolean> {
  try {
    const page = await timedGet(origin);
    return page.ok && page.text.includes('id="root"') && page.text.includes("Andon");
  } catch {
    return false;
  }
}

const SERVER_SRC_PACKAGES = [
  "dashboard-server",
  "api-core",
  "reader-core",
  "docs-bridge",
  "official-docs",
  "core-utils",
  "shared-types",
] as const;

const SERVER_DATA_DIRS = [path.join("docs-bridge", "data")] as const;

async function collectFileRecords(dir: string, relPrefix: string, records: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const next = path.join(dir, entry.name);
    const rel = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectFileRecords(next, rel, records);
      continue;
    }
    const info = await stat(next);
    records.push(`${rel}\0${info.size}\0${info.mtimeMs}`);
  }
}

async function addFileRecord(abs: string, rel: string, records: string[]): Promise<void> {
  if (!existsSync(abs)) return;
  const info = await stat(abs);
  records.push(`${rel}\0${info.size}\0${info.mtimeMs}`);
}

async function serverSourceFingerprint(): Promise<string> {
  const records: string[] = [];
  for (const name of SERVER_SRC_PACKAGES) {
    const root = path.join(REPO_ROOT, "packages", name, "src");
    if (existsSync(root)) await collectFileRecords(root, `${name}/src`, records);
    await addFileRecord(
      path.join(REPO_ROOT, "packages", name, "package.json"),
      `${name}/package.json`,
      records,
    );
  }
  for (const rel of SERVER_DATA_DIRS) {
    const root = path.join(REPO_ROOT, "packages", rel);
    if (!existsSync(root)) continue;
    await collectFileRecords(root, rel.replaceAll("\\", "/"), records);
  }
  await addFileRecord(path.join(REPO_ROOT, "bun.lock"), "bun.lock", records);
  records.sort();
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

type LoadedRun =
  | { kind: "missing" }
  | { kind: "unreadable"; error: string }
  | { kind: "ok"; run: RunRecord };

function parseRunRecord(parsed: unknown): RunRecord | null {
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("pid" in parsed) ||
    !("origin" in parsed) ||
    typeof parsed.pid !== "number" ||
    typeof parsed.origin !== "string"
  ) {
    return null;
  }
  const sourceFingerprint =
    "sourceFingerprint" in parsed && typeof parsed.sourceFingerprint === "string"
      ? parsed.sourceFingerprint
      : "";
  const processStartKeyValue =
    "processStartKey" in parsed &&
    typeof parsed.processStartKey === "string" &&
    parsed.processStartKey !== ""
      ? parsed.processStartKey
      : null;
  return { ...(parsed as RunRecord), sourceFingerprint, processStartKey: processStartKeyValue };
}

async function loadRun(): Promise<LoadedRun> {
  if (!existsSync(RUN_FILE)) return { kind: "missing" };
  let text: string;
  try {
    text = await readFile(RUN_FILE, "utf8");
  } catch (error) {
    return { kind: "unreadable", error: errorMessage(error) };
  }
  try {
    const run = parseRunRecord(JSON.parse(text));
    if (run === null) return { kind: "unreadable", error: "run file is not a valid RunRecord" };
    return { kind: "ok", run };
  } catch (error) {
    return { kind: "unreadable", error: errorMessage(error) };
  }
}

async function requireReadableRun(): Promise<RunRecord> {
  const loaded = await loadRun();
  switch (loaded.kind) {
    case "missing":
      fail("no run file; launch first");
    case "unreadable":
      fail("run file exists but is unreadable", { path: RUN_FILE, cause: loaded.error });
    case "ok":
      return loaded.run;
    default: {
      const _exhaustive: never = loaded;
      fail(`unhandled load: ${_exhaustive}`);
    }
  }
}

async function writeRun(record: RunRecord): Promise<void> {
  const tmp = `${RUN_FILE}.${process.pid}.tmp`;
  const body = `${JSON.stringify(record, null, 2)}\n`;
  try {
    await writeFile(tmp, body);
    try {
      await rename(tmp, RUN_FILE);
    } catch {
      await copyFile(tmp, RUN_FILE);
      await rm(tmp, { force: true });
    }
  } catch (error) {
    await rm(tmp, { force: true });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function bundledAssetRefs(html: string): string[] {
  return [...html.matchAll(/\b(?:src|href)="(\/?assets\/[^"]+)"/g)]
    .map((match) => match[1])
    .filter((ref): ref is string => ref !== undefined && ref !== "");
}

function distComplete(): boolean {
  if (!existsSync(DIST_INDEX)) return false;
  const html = readFileSync(DIST_INDEX, "utf8");
  const refs = bundledAssetRefs(html);
  if (refs.length === 0) return false;
  for (const ref of refs) {
    const abs = path.join(DIST_DIR, ref.replace(/^\//, "").split("?")[0] ?? ref);
    if (!existsSync(abs)) return false;
  }
  return true;
}

function isHtmlFallback(asset: { contentType: string; text: string }): boolean {
  const type = asset.contentType.toLowerCase();
  if (type.includes("text/html")) return true;
  return asset.text.includes('id="root"') && asset.text.includes("Andon");
}

async function waitReady(child: ReturnType<typeof spawn>): Promise<{
  hostname: string;
  port: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no ready line within ${READY_MS}ms. out=${stdout} err=${stderr}`));
    }, READY_MS);

    const settle = (error: Error | null, hostname?: string, port?: number): void => {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      if (hostname === undefined || port === undefined) {
        reject(new Error(`ready line missing host/port. out=${stdout}`));
        return;
      }
      resolve({ hostname, port, stdout, stderr });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = READY.exec(stdout);
      if (match?.[1] === undefined || match[2] === undefined) return;
      settle(null, match[1], Number(match[2]));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => settle(error instanceof Error ? error : new Error(String(error))));
    child.on("exit", (code) => {
      settle(new Error(`server exited early (${code}). out=${stdout} err=${stderr}`));
    });
  });
}

async function buildDashboard(): Promise<void> {
  if (distComplete()) return;
  const proc = spawn(BUN, ["run", "build:dashboard"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  const code: number | null = await new Promise((resolve) => {
    proc.on("exit", (exitCode) => resolve(exitCode));
  });
  if (code !== 0) fail("dashboard build failed", { code });
  if (!distComplete()) fail("dashboard build did not write a complete dist (index.html plus /assets/*)");
}

async function launch(): Promise<void> {
  const sourceFingerprint = await serverSourceFingerprint();
  const loaded = await loadRun();
  switch (loaded.kind) {
    case "unreadable":
      fail("run file exists but is unreadable; not overwritten", {
        path: RUN_FILE,
        cause: loaded.error,
      });
    case "missing":
      break;
    case "ok": {
      const existing = loaded.run;
      const alive = pidAlive(existing.pid);
      const ours = alive && sameProcess(existing.pid, existing.processStartKey);
      const originOk = ours && (await originLooksLikeDashboard(existing.origin));
      if (ours && originOk && existing.sourceFingerprint === sourceFingerprint) {
        print({ ok: true, reused: true, ...existing });
        return;
      }
      if (ours) {
        const kill = tryKillRecorded(existing);
        if (kill === "mismatch") {
          fail("stale dashboard pid; recorded process identity did not match, not killed", {
            pid: existing.pid,
            origin: existing.origin,
          });
        }
        if (kill === "signaled" && !(await confirmRecordedExit(existing))) {
          fail("recorded pid did not exit after signal; run file kept", {
            pid: existing.pid,
            origin: existing.origin,
          });
        }
      } else if (alive) {
        fail("recorded pid is still alive but process identity did not match; not killed", {
          pid: existing.pid,
          origin: existing.origin,
        });
      }
      await rm(RUN_FILE, { force: true });
      break;
    }
    default: {
      const _exhaustive: never = loaded;
      fail(`unhandled load: ${_exhaustive}`);
    }
  }

  await buildDashboard();

  const id = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
  const evidenceDir = path.join(EVIDENCE_DIR, id);
  await mkdir(evidenceDir, { recursive: true });

  const child = spawn(BUN, [CLI, "--port", "0"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    windowsHide: true,
  });
  if (child.pid === undefined) fail("dashboard-server spawned without a pid");

  let ready: Awaited<ReturnType<typeof waitReady>>;
  try {
    ready = await waitReady(child);
  } catch (error) {
    await reapSpawned(child);
    fail(error instanceof Error ? error.message : String(error));
  }

  const startKey = processStartKey(child.pid);
  if (startKey === null) {
    await reapSpawned(child);
    fail("could not read OS process identity for spawned pid", { pid: child.pid });
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  const origin = `http://127.0.0.1:${ready.port}`;
  const record: RunRecord = {
    id,
    pid: child.pid,
    origin,
    hostname: ready.hostname,
    port: ready.port,
    cwd: REPO_ROOT,
    startedAt: new Date().toISOString(),
    evidenceDir,
    sourceFingerprint,
    processStartKey: startKey,
  };
  try {
    await writeRun(record);
  } catch (error) {
    await reapSpawned(child);
    fail("failed to persist run file", { pid: child.pid, cause: errorMessage(error) });
  }
  child.unref();
  print({ ok: true, reused: false, ...record });
}

async function doctor(): Promise<void> {
  const run = await requireReadableRun();
  if (!pidAlive(run.pid)) fail("recorded pid is not running", { pid: run.pid, origin: run.origin });
  if (!sameProcess(run.pid, run.processStartKey)) {
    fail("recorded pid is not the spawned process", { pid: run.pid, origin: run.origin });
  }

  const page = await fetchUrl(run.origin);
  if (!page.ok) fail("SPA did not answer", { status: page.status, origin: run.origin });
  if (!page.text.includes('id="root"') || !page.text.includes("Andon")) {
    fail("SPA HTML is missing #root or title; dist may be stale, api-only, or a reused PID", {
      origin: run.origin,
    });
  }
  const assets = bundledAssetRefs(page.text);
  if (assets.length === 0) {
    fail("SPA HTML has no bundled /assets/*; dist may be incomplete or API-only", { origin: run.origin });
  }
  for (const ref of assets) {
    const url = `${run.origin}${ref.startsWith("/") ? ref : `/${ref}`}`;
    const asset = await fetchUrl(url);
    if (!asset.ok || isHtmlFallback(asset)) {
      fail("SPA asset missing or served as index.html fallback", {
        url,
        status: asset.status,
        contentType: asset.contentType,
      });
    }
  }

  const workflowUrl = `${run.origin}/api/workflow`;
  const workflow = await fetchUrl(workflowUrl);
  if (!workflow.ok) {
    fail("HTTP was not 200", { url: workflowUrl, status: workflow.status, body: workflow.text.slice(0, 300) });
  }
  const body = parseJsonBody(workflow.text, workflowUrl, workflow.status);
  if (
    !isWorkflowPayload(body) &&
    !isTypedWorkflowError(body) &&
    !isUnsupportedWorkspace(body)
  ) {
    fail("/api/workflow JSON was not a known 200 variant", { body });
  }

  print({
    ok: true,
    origin: run.origin,
    pid: run.pid,
    cwd: run.cwd,
    evidenceDir: run.evidenceDir,
    distPresent: distComplete(),
    spaStatus: page.status,
    workflowStatus: workflow.status,
    body,
  });
}

async function origin(): Promise<void> {
  const run = await requireReadableRun();
  if (!pidAlive(run.pid)) fail("recorded pid is not running", { pid: run.pid });
  if (!sameProcess(run.pid, run.processStartKey)) {
    fail("recorded pid is not the spawned process", { pid: run.pid, origin: run.origin });
  }
  if (!(await originLooksLikeDashboard(run.origin))) {
    fail("recorded origin is not this Dashboard (stale PID or wrong server)", {
      pid: run.pid,
      origin: run.origin,
    });
  }
  print({ ok: true, origin: run.origin, pid: run.pid, evidenceDir: run.evidenceDir });
}

async function stop(): Promise<void> {
  const loaded = await loadRun();
  switch (loaded.kind) {
    case "missing":
      print({ ok: true, stopped: false, reason: "no-run" });
      return;
    case "unreadable":
      fail("run file exists but is unreadable; not removed", {
        path: RUN_FILE,
        cause: loaded.error,
      });
    case "ok":
      break;
    default: {
      const _exhaustive: never = loaded;
      fail(`unhandled load: ${_exhaustive}`);
    }
  }
  if (loaded.kind !== "ok") {
    fail("run file exists but is unreadable; not removed", { path: RUN_FILE });
  }
  const run = loaded.run;
  const pidWasAlive = pidAlive(run.pid);
  if (!pidWasAlive) {
    await rm(RUN_FILE, { force: true });
    print({
      ok: true,
      stopped: false,
      reason: "pid-dead",
      pid: run.pid,
      origin: run.origin,
      evidenceDir: run.evidenceDir,
      evidenceKept: true,
    });
    return;
  }
  if (!sameProcess(run.pid, run.processStartKey)) {
    fail("recorded pid is not the spawned process; not killed", {
      pid: run.pid,
      origin: run.origin,
    });
  }
  const kill = tryKillRecorded(run);
  if (kill === "mismatch") {
    fail("recorded process identity did not match; not killed", {
      pid: run.pid,
      origin: run.origin,
    });
  }
  if (kill === "signaled" && !(await confirmRecordedExit(run))) {
    fail("recorded pid did not exit after signal; run file kept", {
      pid: run.pid,
      origin: run.origin,
    });
  }
  await rm(RUN_FILE, { force: true });
  print({
    ok: true,
    stopped: true,
    pid: run.pid,
    origin: run.origin,
    evidenceDir: run.evidenceDir,
    evidenceKept: true,
  });
}

async function main(argv: readonly string[]): Promise<void> {
  const command = argv[0];
  if (command === undefined || !isCommand(command)) {
    fail("usage: bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts <launch|doctor|origin|stop>");
  }
  switch (command) {
    case "launch":
      await launch();
      break;
    case "doctor":
      await doctor();
      break;
    case "origin":
      await origin();
      break;
    case "stop":
      await stop();
      break;
    default: {
      const _exhaustive: never = command;
      fail(`unhandled command: ${_exhaustive}`);
    }
  }
}

await main(process.argv.slice(2));
