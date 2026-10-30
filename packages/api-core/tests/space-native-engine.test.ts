import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSpaceEngine } from "../src/spaces/engine.ts";
import { createGuideService } from "../src/service.ts";
import { WORKFLOWS_TARGET_VERSION } from "@andon/shared-types";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
let base: string;
let root: string;
let installRoot: string;
let executable: string;
const version = WORKFLOWS_TARGET_VERSION;
beforeEach(async () => {
  // Open the workspace through a link, as an editor may: the engine must report the
  // folder by its real path. The raw temp directory is already an alias on macOS
  // (/var → /private/var) and on Windows runners (8.3 names such as RUNNER~1).
  base = await mkdtemp(path.join(tmpdir(), "guide-native-space-"));
  await mkdir(path.join(base, "real"));
  root = path.join(base, "workspace");
  await symlink(path.join(base, "real"), root, "junction");
  installRoot = path.join(root, "machine");
  executable = path.join(installRoot, "versions", version, process.platform === "win32" ? "aidlc.exe" : "aidlc");
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, "native launcher fixture");
  await chmod(executable, 0o755);
  await writeFile(path.join(installRoot, "active-executable"), executable);
  vi.stubEnv("AIDLC_INSTALL_ROOT", installRoot);
  vi.stubEnv("AIDLC_BIN_DIR", path.join(installRoot, "bin"));
  for (const key of Object.keys(process.env).filter((key) => key.toLowerCase() === "path")) vi.stubEnv(key, "");
  for (const space of ["default", "team-b"]) await mkdir(path.join(root, "aidlc/spaces", space, "intents"), { recursive: true });
  vi.mocked(execFile).mockReset();
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const done = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
    void writeFile(path.join(root, "aidlc/active-space"), "team-b").then(() => done(null, "", ""));
    return {} as ReturnType<typeof execFile>;
  });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(base, { recursive: true, force: true }); });

async function stamp(distribution = "copilot", id = ".aidlc") {
  const data = path.join(root, id, "tools/data");
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, "aidlc-stamp.json"), JSON.stringify({ schemaVersion: 1, frameworkVersion: version, distribution, harnessDir: id }));
}

it("switches a stamped native workspace through the API without Bun or project scripts", async () => {
  await stamp();
  const service = createGuideService({ workspaceRoot: root });
  expect(service.versionGate()?.status).toBe("ok");
  expect(await service.readContext.spaces!()).toMatchObject({ value: { harnesses: [{ id: ".aidlc", label: "GitHub Copilot" }], canSwitch: true } });
  expect(await service.switchSpace({ space: "team-b", expectedSpace: "default", harness: ".aidlc" })).toMatchObject({ status: 200 });
  expect(execFile).toHaveBeenCalledTimes(1);
  const [file, args, options] = vi.mocked(execFile).mock.calls[0]!;
  const workspace = await realpath(root);
  expect(file).toBe(await realpath(executable));
  expect(args).toEqual(["engine", "space", "switch", "team-b", "--project-dir", workspace]);
  const execution = options as import("node:child_process").ExecFileOptions;
  expect(execution.shell).toBeUndefined();
  expect(execution.env?.AIDLC_PROJECT_DIR).toBe(workspace);
  expect(execution.env?.AIDLC_HARNESS_DIR).toBe(".aidlc");
  expect(execution.env?.AIDLC_HARNESS_NAME).toBe("copilot");
  expect(execution.env?.AIDLC_SESSION_OVERRIDE).toMatch(/^andon-/);
});

it("honors the registered project pin instead of the machine's active version", async () => {
  await stamp();
  const active = path.join(installRoot, "versions/2.10.0", path.basename(executable));
  await mkdir(path.dirname(active), { recursive: true });
  await writeFile(active, "other version");
  await chmod(active, 0o755);
  await writeFile(path.join(installRoot, "active-executable"), active);
  await writeFile(path.join(root, ".aidlc-version"), version);
  await mkdir(path.join(root, "aidlc/.aidlc-sessions"));
  await writeFile(path.join(root, "aidlc/.aidlc-sessions/pin-target"), executable);
  await writeFile(path.join(installRoot, "pins.json"), JSON.stringify({ [root]: version }));
  await createSpaceEngine(root).switch("team-b", ".aidlc");
  expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe(await realpath(executable));
});

it("does not fall back to Bun when the native engine is missing", async () => {
  await stamp();
  await writeFile(path.join(root, ".aidlc/tools/aidlc-utility.ts"), "throw new Error('must not run')");
  await rm(executable);
  const engine = createSpaceEngine(root);
  expect(await engine.harnesses()).toEqual([]);
  await expect(engine.switch("team-b", ".aidlc")).rejects.toThrow("導入状態");
  expect(execFile).not.toHaveBeenCalled();
});

it("uses the projection stamp when mutable harness metadata names another product", async () => {
  await stamp();
  await writeFile(path.join(root, ".aidlc/tools/data/harness.json"), JSON.stringify({ distribution: "opencode", harnessDir: ".aidlc" }));
  expect(await createSpaceEngine(root).harnesses()).toEqual([{ id: ".aidlc", label: "GitHub Copilot" }]);
});

it("rejects mismatched native identities instead of running the wrong product", async () => {
  await stamp();
  await writeFile(path.join(root, ".aidlc/tools/data/aidlc-stamp.json"), JSON.stringify({ schemaVersion: 1, frameworkVersion: version, distribution: "copilot", harnessDir: ".github" }));
  const engine = createSpaceEngine(root);
  expect(await engine.harnesses()).toEqual([]);
  await expect(engine.switch("team-b", ".aidlc")).rejects.toThrow("導入状態");
  expect(execFile).not.toHaveBeenCalled();
});

it("refuses an engine version that does not match the native projection", async () => {
  await stamp();
  await writeFile(path.join(root, ".aidlc/tools/data/aidlc-stamp.json"), JSON.stringify({ schemaVersion: 1, frameworkVersion: "2.10.0", distribution: "copilot", harnessDir: ".aidlc" }));
  expect(await createSpaceEngine(root).harnesses()).toEqual([]);
  expect(execFile).not.toHaveBeenCalled();
});

it.each([["copilot", ".aidlc", "GitHub Copilot"], ["opencode", ".aidlc", "opencode"], ["kiro-ide", ".kiro", "Kiro IDE"]])("identifies source %s from metadata", async (distribution, id, label) => {
  const data = path.join(root, id!, "tools/data");
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, "harness.json"), JSON.stringify({ schemaVersion: 1, distribution, harnessDir: id }));
  await writeFile(path.join(data, "../aidlc-utility.ts"), "source fixture");
  const engine = createSpaceEngine(root);
  expect(await engine.harnesses()).toEqual([{ id, label }]);
  await engine.switch("team-b", id!);
  expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe("bun");
});

it("does not guess the product in an unlabelled shared directory or search .github for an engine", async () => {
  for (const id of [".aidlc", ".github"]) {
    await mkdir(path.join(root, id, "tools"), { recursive: true });
    await writeFile(path.join(root, id, "tools/aidlc-utility.ts"), "must not run");
  }
  expect(await createSpaceEngine(root).harnesses()).toEqual([]);
});
