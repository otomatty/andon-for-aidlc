import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDoctorOutput } from "../src/doctor-output.ts";

const mocks = vi.hoisted(() => ({
  configure: vi.fn(),
  doctor: vi.fn(),
  plan: vi.fn(),
  apply: vi.fn(),
  git: vi.fn(),
  priorVersion: vi.fn(),
  retained: vi.fn(),
  plugins: vi.fn(),
  replay: vi.fn(),
}));
vi.mock("../src/native-setup.ts", async (original) => ({
  ...(await original<typeof import("../src/native-setup.ts")>()),
  configureNative: mocks.configure,
  runNativeDoctor: mocks.doctor,
  readVersionedNativeInstall: mocks.retained,
}));
vi.mock("../src/native-harness-merge.ts", () => ({
  planHarnessCandidate: mocks.plan,
  applyHarnessCandidate: mocks.apply,
  priorHarnessVersionForReconciliation: mocks.priorVersion,
}));
vi.mock("../src/native-plugin-inputs.ts", () => ({
  capturePluginInputs: mocks.plugins,
  applyCandidatePlugins: mocks.replay,
}));
vi.mock("../src/git-prerequisite.ts", async (original) => ({
  ...(await original<typeof import("../src/git-prerequisite.ts")>()),
  isGitRepository: mocks.git,
}));

import {
  configureNativeHarness,
  listOpenWorkflows,
  noteOpenWorkflows,
  openWorkCarriesOnLine,
} from "../src/native-harness-install.ts";
import type { ConfigureNativeOptions, SetupRunner } from "../src/native-setup.ts";

const roots: string[] = [];
const install = { executable: "/runtime/aidlc", binDir: "/runtime/bin", version: "2.8.0" };
const doctorReport = parseDoctorOutput(
  { code: 0, stdout: "0 problems, 0 warnings.\nYour install is ready.\n", stderr: "" },
  install.version,
);

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "harness-install-test-"));
  roots.push(root);
  return root;
}

async function write(root: string, relative: string, value = ""): Promise<void> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
}

async function existingClaude(root: string): Promise<void> {
  await mkdir(path.join(root, ".claude", "skills", "aidlc"), { recursive: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configure.mockResolvedValue({
    doctorOk: true,
    details: "native",
    planToken: "native-plan",
  });
  mocks.doctor.mockResolvedValue(doctorReport);
  mocks.plan.mockResolvedValue({ planToken: "merge-plan" });
  mocks.apply.mockImplementation(async (_candidate, _root, _harness, _version, options) => {
    await options.validateLocked?.();
    options.onApplyStart?.();
  });
  mocks.git.mockResolvedValue(true);
  mocks.priorVersion.mockReturnValue(null);
  mocks.retained.mockReturnValue(null);
  mocks.plugins.mockResolvedValue({ hash: "plugin-inputs" });
  mocks.replay.mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("open workflows", () => {
  it("names an active record in an inactive space even without a registry", async () => {
    const root = await fixture();
    await write(
      root,
      "aidlc/spaces/archive/intents/task/aidlc-state.md",
      "- **Status**: In Progress\n",
    );
    await expect(listOpenWorkflows(root)).resolves.toEqual(["archive/task"]);
  });

  it("allows completed records and ignores registry rows without records", async () => {
    const root = await fixture();
    await write(
      root,
      "aidlc/spaces/default/intents/done/aidlc-state.md",
      "- **Status**: Completed\n",
    );
    await write(
      root,
      "aidlc/spaces/default/intents/intents.json",
      JSON.stringify([{ dirName: "missing", status: "active" }]),
    );
    await expect(listOpenWorkflows(root)).resolves.toEqual([]);
  });

  it("honors completion in modern and legacy registry entries", async () => {
    const root = await fixture();
    const intents = "aidlc/spaces/default/intents";
    await write(root, `${intents}/dated-task/aidlc-state.md`, "- **Status**: In Progress\n");
    await write(root, `${intents}/legacy-11223344/aidlc-state.md`, "- **Status**: In Progress\n");
    await write(
      root,
      `${intents}/intents.json`,
      JSON.stringify([
        { dirName: "dated-task", status: "complete" },
        { slug: "legacy", uuid: "00000000-0000-0000-0000-000011223344", status: "complete" },
      ]),
    );
    await expect(listOpenWorkflows(root)).resolves.toEqual([]);
  });

  it("does not let a malformed registry hide an active record", async () => {
    const root = await fixture();
    await write(root, "aidlc/spaces/default/intents/task/aidlc-state.md", "- **Status**: Paused\n");
    await write(root, "aidlc/spaces/default/intents/intents.json", "{broken");
    await expect(listOpenWorkflows(root)).resolves.toEqual(["default/task"]);
  });

  it("says open work carries on, and never blocks when a record cannot be read", async () => {
    expect(openWorkCarriesOnLine([])).toBeNull();
    expect(openWorkCarriesOnLine(["default/a", "team/b"])).toBe(
      "進行中の作業（default/a、team/b）は、この変更の後もそのまま続けられます。",
    );
    const root = await fixture();
    await write(root, "aidlc/spaces/default/intents/task/aidlc-state.md", "- **Status**: Paused\n");
    const log = vi.fn();
    await noteOpenWorkflows(root, log);
    expect(log).toHaveBeenCalledWith(
      "進行中の作業（default/task）は、この変更の後もそのまま続けられます。",
    );
    const broken = await fixture();
    await mkdir(path.join(broken, "aidlc/spaces/default/intents/task/aidlc-state.md"), {
      recursive: true,
    });
    const quiet = vi.fn();
    await expect(noteOpenWorkflows(broken, quiet)).resolves.toBeUndefined();
    expect(quiet).not.toHaveBeenCalled();
  });
});

describe("native harness installation", () => {
  it("keeps a normal first installation on the native path", async () => {
    const root = await fixture();
    const log = vi.fn();
    const options = { previewOnly: true };
    const runner = vi.fn<SetupRunner>();
    const result = await configureNativeHarness(install, root, "cursor", log, runner, options);
    expect(result.planToken).toBe("native-plan");
    expect(mocks.configure).toHaveBeenCalledExactlyOnceWith(
      install,
      root,
      "cursor",
      log,
      expect.any(Function),
      options,
    );
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("refreshes an existing native-managed tool directly when other tools are present", async () => {
    const root = await fixture();
    await existingClaude(root);
    await mkdir(path.join(root, ".cursor", "skills", "aidlc"), { recursive: true });
    const options = { previewOnly: true };
    await configureNativeHarness(install, root, "cursor", vi.fn(), undefined, options);
    expect(mocks.configure.mock.calls[0]?.[1]).toBe(root);
    expect(mocks.configure.mock.calls[0]?.[5]).toBe(options);
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "configures beside an open workflow, preview: %s",
    async (previewOnly) => {
      const root = await fixture();
      await existingClaude(root);
      await mkdir(path.join(root, ".cursor", "skills", "aidlc"), { recursive: true });
      await write(
        root,
        "aidlc/spaces/archive/intents/current/aidlc-state.md",
        "- **Status**: In Progress\n",
      );
      await configureNativeHarness(install, root, "cursor", vi.fn(), undefined, { previewOnly });
      expect(mocks.configure).toHaveBeenCalled();
    },
  );

  it("allows a direct native refresh after the workflow completes", async () => {
    const root = await fixture();
    await existingClaude(root);
    await write(
      root,
      "aidlc/spaces/default/intents/done/aidlc-state.md",
      "- **Status**: Completed\n",
    );
    await configureNativeHarness(install, root, "claude", vi.fn());
    expect(mocks.configure.mock.calls[0]?.[1]).toBe(root);
  });

  it("reports broken wiring in the directly refreshed tool instead of a healthy sibling", async () => {
    const root = await fixture();
    await existingClaude(root);
    await mkdir(path.join(root, ".cursor", "skills", "aidlc"), { recursive: true });
    vi.stubEnv("AIDLC_HARNESS_DIR", ".claude");
    const nativeSetup =
      await vi.importActual<typeof import("../src/native-setup.ts")>("../src/native-setup.ts");
    mocks.configure.mockImplementation(nativeSetup.configureNative);
    const runner = vi.fn<SetupRunner>().mockImplementation(async (_command, args, _cwd, env) => {
      if (args.includes("--dry-run"))
        return {
          code: 0,
          stdout: JSON.stringify({ data: { planToken: "native-plan" } }),
          stderr: "",
        };
      if (args[0] !== "doctor") return { code: 0, stdout: "configured", stderr: "" };
      return env?.AIDLC_HARNESS_DIR === ".cursor"
        ? { code: 1, stdout: "Cursor wiring is broken", stderr: "" }
        : { code: 0, stdout: "0 problems, 0 warnings.\nYour install is ready.\n", stderr: "" };
    });
    const signal = new AbortController().signal;
    const result = await configureNativeHarness(install, root, "cursor", vi.fn(), runner, {
      signal,
    });
    expect(result.doctorOk).toBe(false);
    expect(result.details).toContain("Cursor wiring is broken");
    expect(runner.mock.calls.at(-1)).toEqual([
      install.executable,
      ["doctor", "--project-dir", root, "--verbose", "--no-color"],
      root,
      expect.objectContaining({ AIDLC_HARNESS_DIR: ".cursor", NO_COLOR: "1" }),
      signal,
      { timeoutMs: 120_000 },
    ]);
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("generates policy-aware candidates and applies only their reviewed merge plan", async () => {
    const root = await fixture();
    await existingClaude(root);
    await write(root, "aidlc.settings.json", '{"schemaVersion":1}');
    await write(root, "aidlc/spaces/default/memory/org.md", "project policy");
    let candidate = "";
    mocks.configure.mockImplementation(async (_install, generatedRoot) => {
      candidate = generatedRoot;
      expect(candidate).not.toBe(root);
      expect(await readFile(path.join(candidate, "aidlc.settings.json"), "utf8")).toContain(
        "schemaVersion",
      );
      expect(
        await readFile(path.join(candidate, "aidlc/spaces/default/memory/org.md"), "utf8"),
      ).toBe("project policy");
      return { doctorOk: true, details: "candidate" };
    });
    const onApplyStart = vi.fn();
    const result = await configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
      onApplyStart,
    });
    expect(result.doctorReport).toEqual(doctorReport);
    expect(mocks.apply).toHaveBeenCalledWith(
      candidate,
      root,
      "cursor",
      install.version,
      expect.objectContaining({ planToken: "merge-plan" }),
    );
    expect(onApplyStart).toHaveBeenCalledOnce();
    expect(mocks.doctor.mock.calls[0]?.[1]).toBe(root);
    expect(existsSync(candidate)).toBe(false);
    expect(await readFile(path.join(root, "aidlc/spaces/default/memory/org.md"), "utf8")).toBe(
      "project policy",
    );
  });

  it("scopes candidate diagnostics despite an inherited different harness", async () => {
    const root = await fixture();
    await existingClaude(root);
    vi.stubEnv("AIDLC_HARNESS_DIR", ".claude");
    const nativeSetup =
      await vi.importActual<typeof import("../src/native-setup.ts")>("../src/native-setup.ts");
    mocks.configure.mockImplementation(nativeSetup.configureNative);
    const runner = vi.fn<SetupRunner>().mockImplementation(async (_command, args) => ({
      code: 0,
      stdout: args.includes("--dry-run")
        ? JSON.stringify({ data: { planToken: "candidate-plan" } })
        : "0 problems, 0 warnings.\nYour install is ready.\n",
      stderr: "",
    }));
    const signal = new AbortController().signal;
    await configureNativeHarness(install, root, "cursor", vi.fn(), runner, { signal });
    const candidate = mocks.configure.mock.calls[0]?.[1];
    expect(candidate).not.toBe(root);
    expect(runner.mock.calls.at(-1)).toEqual([
      install.executable,
      ["doctor", "--project-dir", candidate, "--verbose", "--no-color"],
      candidate,
      expect.objectContaining({ AIDLC_HARNESS_DIR: ".cursor", NO_COLOR: "1" }),
      signal,
      { timeoutMs: 120_000 },
    ]);
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(existsSync(candidate)).toBe(false);
  });

  it("returns a merge token for preview without applying to the project", async () => {
    const root = await fixture();
    await existingClaude(root);
    const result = await configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
      previewOnly: true,
    });
    expect(result.planToken).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.doctor).not.toHaveBeenCalled();
    expect(existsSync(mocks.configure.mock.calls[0]?.[1])).toBe(false);
  });

  it("recovers abandoned locks with native doctor scoped to the selected harness", async () => {
    const root = await fixture();
    await existingClaude(root);
    vi.stubEnv("AIDLC_HARNESS_DIR", ".claude");
    const nativeSetup =
      await vi.importActual<typeof import("../src/native-setup.ts")>("../src/native-setup.ts");
    mocks.doctor.mockImplementation(nativeSetup.runNativeDoctor);
    const runner = vi.fn<SetupRunner>().mockResolvedValue({
      code: 1,
      stdout: "1 problems, 0 warnings.\nDead-owner lock - cleared.\n",
      stderr: "",
    });
    mocks.apply.mockImplementation(async (_candidate, _root, _harness, _version, options) => {
      await options.recoverStaleLock();
      await options.validateLocked();
      options.onApplyStart();
    });
    const onApplyStart = vi.fn();
    const signal = new AbortController().signal;
    await configureNativeHarness(install, root, "cursor", vi.fn(), runner, {
      signal,
      onApplyStart,
    });
    expect(onApplyStart).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0]).toEqual([
      install.executable,
      ["doctor", "--project-dir", root, "--verbose", "--no-color"],
      root,
      expect.objectContaining({ AIDLC_HARNESS_DIR: ".cursor", NO_COLOR: "1" }),
      signal,
      { timeoutMs: 120_000 },
    ]);
    expect(existsSync(mocks.configure.mock.calls[0]?.[1])).toBe(false);
  });

  it("generates from the selected retained release when the global runtime is another version", async () => {
    const root = await fixture();
    await existingClaude(root);
    vi.stubEnv("AIDLC_RUNTIME_ROOT", "/machine/versions/2.8.1/runtime");
    const retained = { ...install, executable: "/machine/versions/2.8.0/aidlc" };
    await configureNativeHarness(retained, root, "cursor", vi.fn());
    expect(mocks.configure.mock.calls[0]?.[0]).toBe(retained);
    expect(mocks.configure.mock.calls[0]?.[5]).toEqual({
      sourceRoot: path.join(path.dirname(retained.executable), "runtime", "cursor"),
    });
    expect(mocks.plan.mock.calls[0]?.[3]).toBe("2.8.0");
  });

  it("rejects a stale plan and cleans up the regenerated candidate", async () => {
    const root = await fixture();
    await existingClaude(root);
    await expect(
      configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
        planToken: "old-plan",
      }),
    ).rejects.toThrow("確認後");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(existsSync(mocks.configure.mock.calls[0]?.[1])).toBe(false);
  });

  it("includes project policy inputs in the token even when the generated merge is unchanged", async () => {
    const root = await fixture();
    await existingClaude(root);
    const preview = await configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
      previewOnly: true,
    });
    await write(root, "aidlc.settings.json", '{"schemaVersion":1}');
    await expect(
      configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
        planToken: preview.planToken,
      }),
    ).rejects.toThrow("確認後");
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("replays plugin inputs and refuses selection changes after preview", async () => {
    const root = await fixture();
    await existingClaude(root);
    const plugins = { hash: "selected-core-only" };
    mocks.plugins.mockResolvedValue(plugins);
    const preview = await configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
      previewOnly: true,
    });
    expect(mocks.replay).toHaveBeenCalledWith(
      install,
      mocks.configure.mock.calls[0]?.[1],
      "cursor",
      plugins,
      expect.any(Function),
      expect.objectContaining({ previewOnly: true }),
    );
    mocks.plugins.mockResolvedValue({ hash: "selected-test-pro" });
    await expect(
      configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
        planToken: preview.planToken,
      }),
    ).rejects.toThrow("確認後");
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("rechecks plugin sources while holding the workspace lock", async () => {
    const root = await fixture();
    await existingClaude(root);
    mocks.plugins
      .mockResolvedValueOnce({ hash: "original-plugin" })
      .mockResolvedValue({ hash: "changed-plugin" });
    const onApplyStart = vi.fn();
    await expect(
      configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
        onApplyStart,
      }),
    ).rejects.toThrow("確認後");
    expect(onApplyStart).not.toHaveBeenCalled();
    expect(mocks.doctor).not.toHaveBeenCalled();
  });

  it("uses the caller source for the target release and the prior runtime for reconciliation", async () => {
    const root = await fixture();
    await existingClaude(root);
    const prior = { ...install, version: "2.7.0", executable: "/runtime/versions/2.7.0/aidlc" };
    mocks.priorVersion.mockReturnValue(prior.version);
    mocks.retained.mockReturnValue(prior);
    await configureNativeHarness(install, root, "cursor", vi.fn(), undefined, {
      sourceRoot: "/shared/cursor-source",
    });
    expect(mocks.configure.mock.calls[0]?.[5]?.sourceRoot).toBe("/shared/cursor-source");
    expect(mocks.configure.mock.calls[1]?.[5]?.sourceRoot).toBe(
      path.join(path.dirname(prior.executable), "runtime", "cursor"),
    );
  });

  it("reproduces the prior release for a composed harness upgrade and cleans up both candidates", async () => {
    const root = await fixture();
    await existingClaude(root);
    const prior = { ...install, version: "2.7.0", executable: "/runtime/versions/2.7.0/aidlc" };
    mocks.priorVersion.mockReturnValue(prior.version);
    mocks.retained.mockReturnValue(prior);
    await configureNativeHarness(install, root, "cursor", vi.fn());
    expect(mocks.retained).toHaveBeenCalledExactlyOnceWith("2.7.0");
    const currentCandidate = mocks.configure.mock.calls[0]?.[1];
    const priorCandidate = mocks.configure.mock.calls[1]?.[1];
    expect(priorCandidate).not.toBe(currentCandidate);
    expect(mocks.configure.mock.calls[1]?.[0]).toBe(prior);
    expect(mocks.configure.mock.calls[1]?.[5]?.sourceRoot).toBe(
      path.join(path.dirname(prior.executable), "runtime", "cursor"),
    );
    expect(mocks.replay).toHaveBeenCalledTimes(2);
    expect(mocks.plan).toHaveBeenCalledWith(currentCandidate, root, "cursor", install.version, {
      priorCandidate,
    });
    expect(mocks.apply.mock.calls[0]?.[4]?.priorCandidate).toBe(priorCandidate);
    expect(existsSync(currentCandidate)).toBe(false);
    expect(existsSync(priorCandidate)).toBe(false);
  });

  it("preserves the project when a needed prior runtime is unavailable", async () => {
    const root = await fixture();
    await existingClaude(root);
    mocks.priorVersion.mockReturnValue("2.7.0");
    await expect(configureNativeHarness(install, root, "cursor", vi.fn())).rejects.toThrow(
      "本体 2.7.0 が必要",
    );
    expect(mocks.configure).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("stops when settings change between generation and the locked commit", async () => {
    const root = await fixture();
    await existingClaude(root);
    mocks.plan.mockImplementation(async () => {
      await write(root, "aidlc/active-space", "default\n");
      return { planToken: "merge-plan" };
    });
    const onApplyStart = vi.fn();
    await expect(
      configureNativeHarness(install, root, "cursor", vi.fn(), undefined, { onApplyStart }),
    ).rejects.toThrow("確認後");
    expect(onApplyStart).not.toHaveBeenCalled();
  });

  it("uses the native space command for non-default rules and records the generated include hashes", async () => {
    const root = await fixture();
    await existingClaude(root);
    await write(root, "aidlc/active-space", "custom\n");
    await write(root, "aidlc/spaces/custom/memory/team.md", "custom policy");
    const rel = ".cursor/rules/aidlc.mdc";
    mocks.configure.mockImplementation(async (_install, candidate) => {
      expect(await readFile(path.join(candidate, "aidlc/active-space"), "utf8")).toBe("custom\n");
      await write(candidate, rel, "aidlc/spaces/default/memory/team.md\n");
      await write(
        candidate,
        ".cursor/tools/data/aidlc-manifest.json",
        JSON.stringify({ files: { [rel]: "prior-hash" }, rootContributions: {} }),
      );
      return { doctorOk: true, details: "candidate" };
    });
    const runner = vi
      .fn<SetupRunner>()
      .mockImplementation(async (_command, args, candidate, env) => {
        expect(args).toEqual(["engine", "space", "switch", "custom", "--project-dir", candidate]);
        expect(env?.AIDLC_HARNESS_DIR).toBe(".cursor");
        await write(candidate, rel, "aidlc/spaces/custom/memory/team.md\n");
        return { code: 0, stdout: "repointed", stderr: "" };
      });
    mocks.plan.mockImplementation(async (candidate) => {
      const baseline = JSON.parse(
        await readFile(path.join(candidate, ".cursor/tools/data/aidlc-manifest.json"), "utf8"),
      );
      const bytes = await readFile(path.join(candidate, rel));
      expect(baseline.files[rel]).toBe(
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      );
      return { planToken: "merge-plan" };
    });
    await configureNativeHarness(install, root, "cursor", vi.fn(), runner);
    expect(runner).toHaveBeenCalledOnce();
  });

  it("names the open work a merged candidate carries on", async () => {
    const root = await fixture();
    await existingClaude(root);
    await write(root, "aidlc/spaces/default/intents/new/aidlc-state.md", "- **Status**: In Progress\n");
    const log = vi.fn();
    const onApplyStart = vi.fn();
    await configureNativeHarness(install, root, "cursor", log, undefined, { onApplyStart });
    expect(onApplyStart).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "進行中の作業（default/new）は、この変更の後もそのまま続けられます。",
    );
    expect(mocks.doctor).toHaveBeenCalled();
  });

  it.each([false, true])(
    "rehashes Copilot's managed imports after switching spaces (CRLF %s)",
    async (crlf) => {
      const root = await fixture();
      await existingClaude(root);
      await write(root, "aidlc/active-space", "custom\n");
      await write(root, "aidlc/spaces/custom/memory/team.md", "custom policy");
      const newline = crlf ? "\r\n" : "\n";
      const block = (space: string) =>
        [
          "<!-- BEGIN AI-DLC:AGENTS.md -->",
          `@aidlc/spaces/${space}/memory/team.md`,
          "<!-- END AI-DLC:AGENTS.md -->",
        ].join(newline);
      const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
      mocks.configure.mockImplementation(async (_install, candidate) => {
        await write(candidate, "AGENTS.md", `Outside${newline}${block("default")}${newline}`);
        await write(
          candidate,
          ".aidlc/tools/data/aidlc-manifest.json",
          JSON.stringify({
            files: {},
            rootContributions: {
              "AGENTS.md": {
                policy: "managed-block",
                marker: "AGENTS.md",
                hash: hash(block("default")),
              },
            },
          }),
        );
        return { doctorOk: true, details: "candidate" };
      });
      const runner = vi
        .fn<SetupRunner>()
        .mockImplementation(async (_command, args, candidate, env) => {
          expect(args).toEqual(["engine", "space", "switch", "custom", "--project-dir", candidate]);
          expect(env?.AIDLC_HARNESS_DIR).toBe(".aidlc");
          await write(candidate, "AGENTS.md", `Outside${newline}${block("custom")}${newline}`);
          return { code: 0, stdout: "repointed", stderr: "" };
        });
      mocks.plan.mockImplementation(async (candidate) => {
        const baseline = JSON.parse(
          await readFile(path.join(candidate, ".aidlc/tools/data/aidlc-manifest.json"), "utf8"),
        );
        expect(baseline.rootContributions["AGENTS.md"].hash).toBe(hash(block("custom")));
        return { planToken: "merge-plan" };
      });
      await configureNativeHarness(install, root, "copilot", vi.fn(), runner);
      expect(mocks.apply).toHaveBeenCalledOnce();
      expect(await readFile(path.join(root, "aidlc/active-space"), "utf8")).toBe("custom\n");
    },
  );

  it("requires the actual repository before creating a Codex candidate", async () => {
    const root = await fixture();
    await existingClaude(root);
    mocks.git.mockResolvedValue(false);
    await expect(configureNativeHarness(install, root, "codex", vi.fn())).rejects.toThrow(
      "Git リポジトリ",
    );
    expect(mocks.configure).not.toHaveBeenCalled();
  });

  it("initializes Git only inside the Codex candidate and scopes final doctor to Codex", async () => {
    const root = await fixture();
    await existingClaude(root);
    const runner = vi.fn<SetupRunner>().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await configureNativeHarness(install, root, "codex", vi.fn(), runner);
    const candidate = mocks.configure.mock.calls[0]?.[1];
    expect(runner.mock.calls[0]?.slice(0, 3)).toEqual([
      "git",
      ["init", "--quiet", candidate],
      candidate,
    ]);
    expect(mocks.git).toHaveBeenCalledTimes(2);
    const selectedRunner = mocks.doctor.mock.calls[0]?.[2] as SetupRunner;
    await selectedRunner("aidlc", ["doctor"], root, {});
    expect(runner.mock.calls.at(-1)?.[3]?.AIDLC_HARNESS_DIR).toBe(".codex");
  });

  it("uses the candidate path for an existing Guide-managed single tool", async () => {
    const root = await fixture();
    await write(root, ".cursor/tools/data/andon-install.json", "{}");
    await configureNativeHarness(install, root, "cursor", vi.fn());
    expect(mocks.configure.mock.calls[0]?.[1]).not.toBe(root);
    expect(mocks.apply).toHaveBeenCalledOnce();
  });

  it("cleans up after candidate generation fails or is cancelled", async () => {
    for (const cancelled of [false, true]) {
      const root = await fixture();
      await existingClaude(root);
      const abort = new AbortController();
      let candidate = "";
      mocks.configure.mockImplementation(async (_install, generatedRoot) => {
        candidate = generatedRoot;
        if (cancelled) abort.abort();
        else throw new Error("generation failed");
        return { doctorOk: true, details: "candidate" };
      });
      const options: ConfigureNativeOptions = { signal: abort.signal };
      await expect(
        configureNativeHarness(install, root, "cursor", vi.fn(), undefined, options),
      ).rejects.toThrow();
      expect(existsSync(candidate)).toBe(false);
    }
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
