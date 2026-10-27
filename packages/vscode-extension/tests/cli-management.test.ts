import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CliManagementHooks,
  type CliManagementOptions,
  inspectCliManagement,
  nativeLauncherReady,
  pinProjectCli,
  prepareProjectCli,
  prepareTargetRuntime,
  updateMachineCli,
  useTargetCli,
} from "../src/cli-management.ts";
import { type NativeInstall, SETUP_RELEASE } from "../src/native-setup.ts";
import { NEWER_WORKFLOWS_VERSION } from "./workflows-version-fixture.ts";

function runtime(version: string): NativeInstall {
  return { version, executable: `/machine/versions/${version}/aidlc`, binDir: "/machine/bin" };
}

function fixture(
  opts: {
    machine?: string | null;
    pin?: string | null;
    pinExists?: boolean;
    versions?: (string | null)[];
    registered?: boolean;
    retained?: string[];
  } = {},
) {
  const local = {
    machine: opts.machine ? runtime(opts.machine) : null,
    pin: { exists: opts.pinExists ?? !!opts.pin, version: opts.pin ?? null },
    versions: opts.versions ?? [],
    registered: opts.registered ?? false,
    launcherReady: true,
  };
  const retained = new Map(
    (opts.retained ?? (opts.machine ? [opts.machine] : [])).map((version) => [
      version,
      runtime(version),
    ]),
  );
  const hooks = {
    inspectPin: () => ({ ...local.pin }),
    readWorkspaceVersions: () => [...local.versions],
    readActive: (root?: string) => {
      if (!local.machine) return null;
      if (root && local.pin.exists)
        return local.registered && local.pin.version
          ? (retained.get(local.pin.version) ?? null)
          : null;
      return local.machine;
    },
    readInstall: (version: string) => retained.get(version) ?? null,
    readPinBytes: () => Buffer.from(local.pin.version ?? ""),
    writePinBytes: vi.fn(),
    launcherReady: (install: NativeInstall | null) => install !== null && local.launcherReady,
    install: vi.fn(async () => {
      local.machine = runtime(SETUP_RELEASE);
      retained.set(SETUP_RELEASE, local.machine);
    }),
    use: vi.fn(async (_install: NativeInstall, version: string) => {
      const selected = retained.get(version);
      if (!selected) throw new Error("runtime missing");
      local.machine = selected;
    }),
    pin: vi.fn(async (_install: NativeInstall, _root: string, version: string) => {
      expect(local.pin).toEqual({ exists: true, version });
      local.registered = true;
    }),
  } satisfies CliManagementHooks;
  const options: CliManagementOptions = { workspaceRoot: "/project", log: vi.fn(), hooks };
  return { local, retained, hooks, options };
}

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workflowFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "cli-active-workflow-"));
  temporaryRoots.push(root);
  const record = path.join(root, "aidlc", "spaces", "other", "intents", "work-12345678");
  mkdirSync(record, { recursive: true });
  const state = path.join(record, "aidlc-state.md");
  writeFileSync(state, "- **Status**: In Progress\n");
  return { root, state };
}

describe("CLI during open work", () => {
  it.each([
    { mode: "prepare", retained: false },
    { mode: "prepare", retained: true },
    { mode: "update", retained: false },
    { mode: "update", retained: true },
  ])("runs $mode beside an open workflow (retained: $retained)", async (input) => {
    const project = workflowFixture();
    const state = fixture({
      machine: "2.8.0",
      retained: input.retained ? ["2.8.0", SETUP_RELEASE] : ["2.8.0"],
    });
    const action = input.mode === "prepare" ? prepareProjectCli : updateMachineCli;
    const result = await action({ ...state.options, workspaceRoot: project.root });
    expect(result).toMatchObject({ ok: true, stage: "complete", applied: true });
    expect(state.hooks.install).toHaveBeenCalledTimes(input.retained ? 0 : 1);
    expect(state.local.machine?.version).toBe(SETUP_RELEASE);
  });

  it("allows an already prepared CLI to be inspected during an active workflow", async () => {
    const project = workflowFixture();
    const state = fixture({ machine: SETUP_RELEASE });
    for (const action of [prepareProjectCli, updateMachineCli])
      expect(await action({ ...state.options, workspaceRoot: project.root })).toMatchObject({
        ok: true,
        applied: false,
      });
    expect(state.hooks.install).not.toHaveBeenCalled();
    expect(state.hooks.use).not.toHaveBeenCalled();
  });
});


function existingPinFile(original: string) {
  const root = mkdtempSync(path.join(tmpdir(), "cli-existing-pin-"));
  temporaryRoots.push(root);
  const pinPath = path.join(root, ".aidlc-version");
  writeFileSync(pinPath, original);
  const fixtureState = fixture({
    machine: "2.8.0",
    pin: SETUP_RELEASE,
    versions: [SETUP_RELEASE],
    retained: ["2.8.0", SETUP_RELEASE],
  });
  const fileHooks: CliManagementHooks = {
    ...fixtureState.hooks,
    readPinBytes: undefined,
    writePinBytes: undefined,
  };
  fixtureState.hooks.pin.mockImplementation(async () => {
    writeFileSync(pinPath, `${SETUP_RELEASE}\n`);
    fixtureState.local.registered = true;
  });
  return {
    ...fixtureState,
    root,
    pinPath,
    fileHooks,
    options: { ...fixtureState.options, workspaceRoot: root, hooks: fileHooks },
  };
}

describe("existing project pin bytes", () => {
  it.each([
    SETUP_RELEASE,
    `${SETUP_RELEASE}\r\n`,
    `${SETUP_RELEASE}\n`,
    `\ufeff${SETUP_RELEASE}\r\n`,
    ` \t${SETUP_RELEASE} \r\n`,
  ])("preserves the exact shared file while registering the machine: %j", async (original) => {
    const state = existingPinFile(original);
    expect(await prepareProjectCli(state.options)).toMatchObject({ ok: true });
    expect(readFileSync(state.pinPath)).toEqual(Buffer.from(original));
    expect(state.hooks.pin).toHaveBeenCalledOnce();
    expect(state.local.registered).toBe(true);
    expect(state.local.machine?.version).toBe("2.8.0");
  });

  it.each(["failure", "cancel"])(
    "restores the original bytes after registration %s",
    async (outcome) => {
      const original = `${SETUP_RELEASE}\r\n`;
      const state = existingPinFile(original);
      const abort = new AbortController();
      state.hooks.pin.mockImplementation(async () => {
        writeFileSync(state.pinPath, `${SETUP_RELEASE}\n`);
        if (outcome === "cancel") abort.abort();
        throw new Error("registration stopped after committing");
      });
      expect(await prepareProjectCli({ ...state.options, signal: abort.signal })).toMatchObject({
        ok: false,
        reason: outcome === "cancel" ? "cancelled" : "register-failed",
      });
      expect(readFileSync(state.pinPath)).toEqual(Buffer.from(original));
    },
  );

  it.each([`${NEWER_WORKFLOWS_VERSION}\n`, `${SETUP_RELEASE}\r\n`])(
    "keeps concurrent external edits instead of restoring over them: %j",
    async (external) => {
      const state = existingPinFile(SETUP_RELEASE);
      state.hooks.pin.mockImplementation(async () => {
        writeFileSync(state.pinPath, external);
      });
      const result = await prepareProjectCli(state.options);
      expect(result).toMatchObject({ ok: false, stage: "register" });
      expect(result.details).toContain("外部の変更を上書きせず");
      expect(result.nextAction).toContain(".aidlc-version の差分");
      expect(readFileSync(state.pinPath, "utf8")).toBe(external);
    },
  );

  it("does not recreate a pin deleted externally during registration", async () => {
    const state = existingPinFile(SETUP_RELEASE);
    state.hooks.pin.mockImplementation(async () => {
      rmSync(state.pinPath);
    });
    expect(await prepareProjectCli(state.options)).toMatchObject({ ok: false, stage: "register" });
    expect(() => readFileSync(state.pinPath)).toThrow();
  });

  it("refuses registration if the pin bytes changed after inspecting the version", async () => {
    const state = existingPinFile(`${NEWER_WORKFLOWS_VERSION}\r\n`);
    expect(await prepareProjectCli(state.options)).toMatchObject({ ok: false, stage: "register" });
    expect(state.hooks.pin).not.toHaveBeenCalled();
    expect(readFileSync(state.pinPath, "utf8")).toBe(`${NEWER_WORKFLOWS_VERSION}\r\n`);
  });

  it("preserves both registration and formatting-restoration errors", async () => {
    const state = existingPinFile(SETUP_RELEASE);
    state.hooks.pin.mockImplementation(async () => {
      writeFileSync(state.pinPath, `${SETUP_RELEASE}\n`);
      throw new Error("registry failed");
    });
    state.fileHooks.writePinBytes = () => {
      throw new Error("EPERM restore denied");
    };
    const result = await prepareProjectCli(state.options);
    expect(result.ok).toBe(false);
    expect(result.details).toContain("registry failed");
    expect(result.details).toContain("EPERM restore denied");
  });

  it("registers a missing machine registry entry even when a stale local pin-target file remains", async () => {
    const state = existingPinFile(`${SETUP_RELEASE}\r\n`);
    const sessionRoot = path.join(state.root, "aidlc", ".aidlc-sessions");
    mkdirSync(sessionRoot, { recursive: true });
    writeFileSync(
      path.join(sessionRoot, "pin-target"),
      `/machine/versions/${SETUP_RELEASE}/aidlc\n`,
    );
    expect(inspectCliManagement(state.root, state.fileHooks).setupReady).toBe(false);
    expect(await prepareProjectCli(state.options)).toMatchObject({ ok: true });
    expect(state.hooks.pin).toHaveBeenCalledOnce();
    expect(state.local.registered).toBe(true);
    expect(readFileSync(state.pinPath, "utf8")).toBe(`${SETUP_RELEASE}\r\n`);
  });
});

describe("native CLI launcher", () => {
  function launcher(platform: NodeJS.Platform) {
    const root = mkdtempSync(path.join(tmpdir(), "cli-launcher-"));
    temporaryRoots.push(root);
    const binDir = path.join(root, "bin");
    mkdirSync(binDir);
    const install = { ...runtime(SETUP_RELEASE), binDir };
    writeFileSync(path.join(root, "active-version"), `${SETUP_RELEASE}\n`);
    const entries =
      platform === "win32"
        ? [path.join(binDir, "aidlc.cmd"), path.join(root, "aidlc-shim.ps1")]
        : [path.join(binDir, "aidlc")];
    for (const file of entries) {
      writeFileSync(file, "launcher fixture\n");
      chmodSync(file, 0o700);
    }
    return { root, install, entries };
  }

  it.each(["win32", "linux"] as const)(
    "checks the real %s entry points and active marker",
    (platform) => {
      const state = launcher(platform);
      expect(nativeLauncherReady(state.install, platform, state.root)).toBe(true);
      writeFileSync(path.join(state.root, "active-version"), "2.8.0\n");
      expect(nativeLauncherReady(state.install, platform, state.root)).toBe(false);
    },
  );

  it.each(["aidlc.cmd", "aidlc-shim.ps1"])(
    "rejects a Windows installation missing %s",
    (missing) => {
      const state = launcher("win32");
      const file = state.entries.find((entry) => path.basename(entry) === missing);
      if (!file) throw new Error("missing test entry");
      rmSync(file);
      expect(nativeLauncherReady(state.install, "win32", state.root)).toBe(false);
    },
  );

  it("rejects a missing, empty or non-file Unix entry point", () => {
    const state = launcher("linux");
    const file = path.join(state.install.binDir, "aidlc");
    writeFileSync(file, "");
    expect(nativeLauncherReady(state.install, "linux", state.root)).toBe(false);
    rmSync(file);
    expect(nativeLauncherReady(state.install, "linux", state.root)).toBe(false);
    mkdirSync(file);
    expect(nativeLauncherReady(state.install, "linux", state.root)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "requires execution permission for the Unix launcher",
    () => {
      const state = launcher("linux");
      chmodSync(path.join(state.install.binDir, "aidlc"), 0o600);
      expect(nativeLauncherReady(state.install, "linux", state.root)).toBe(false);
    },
  );

  it.each([prepareProjectCli, updateMachineCli])(
    "repairs missing launcher files even when the target binary already exists",
    async (operation) => {
      const state = fixture({ machine: SETUP_RELEASE });
      state.local.launcherReady = false;
      expect(inspectCliManagement("/project", state.hooks)).toMatchObject({
        setupReady: false,
        canPrepare: true,
        canUpdate: true,
        launcherReady: false,
      });
      state.hooks.install.mockImplementation(async () => {
        state.local.launcherReady = true;
      });
      expect(await operation(state.options)).toMatchObject({ ok: true });
      expect(state.hooks.install).toHaveBeenCalledOnce();
      expect(inspectCliManagement("/project", state.hooks).setupReady).toBe(true);
    },
  );

  it("does not claim successful update if the launcher remains missing after installation", async () => {
    const state = fixture({ machine: SETUP_RELEASE });
    state.local.launcherReady = false;
    expect(await updateMachineCli(state.options)).toMatchObject({ ok: false, stage: "verify" });
    expect(state.hooks.install).toHaveBeenCalledOnce();
  });
});

describe("CLI management", () => {
  it("installs a new machine default without creating a project pin", async () => {
    const { options, hooks, local } = fixture();
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      canPrepare: true,
      canUpdate: true,
      setupReady: false,
      launcherReady: false,
    });
    expect(inspectCliManagement("/project", hooks).message).toContain("他のプロジェクト");
    expect(await prepareProjectCli(options)).toMatchObject({
      ok: true,
      stage: "complete",
      applied: true,
    });
    expect(local.machine?.version).toBe(SETUP_RELEASE);
    expect(hooks.pin).not.toHaveBeenCalled();
    expect(local.pin.exists).toBe(false);
  });

  it("registers the existing project pin and restores the previous machine default", async () => {
    const { options, hooks, local } = fixture({
      machine: "2.8.0",
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
    });
    expect(await prepareProjectCli(options)).toMatchObject({ ok: true, recovery: "restored" });
    expect(hooks.install).toHaveBeenCalledOnce();
    expect(hooks.pin).toHaveBeenCalledOnce();
    expect(local.machine?.version).toBe("2.8.0");
    expect(local.pin.version).toBe(SETUP_RELEASE);
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      setupReady: true,
      machineVersion: "2.8.0",
      effectiveVersion: SETUP_RELEASE,
    });
  });

  it("uses an already retained project runtime without changing the machine default", async () => {
    const { options, hooks, local } = fixture({
      machine: "2.8.0",
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
      retained: ["2.8.0", SETUP_RELEASE],
    });
    expect(await prepareProjectCli(options)).toMatchObject({ ok: true, recovery: "not-needed" });
    expect(hooks.install).not.toHaveBeenCalled();
    expect(hooks.use).not.toHaveBeenCalled();
    expect(local.machine?.version).toBe("2.8.0");
  });

  it("does not rewrite an already registered shared pin or hold the operation lock", async () => {
    const { options, hooks } = fixture({
      machine: SETUP_RELEASE,
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
      registered: true,
    });
    expect(await prepareProjectCli(options)).toMatchObject({ ok: true, applied: false });
    expect(await prepareProjectCli(options)).toMatchObject({ ok: true, applied: false });
    expect(hooks.pin).not.toHaveBeenCalled();
    expect(hooks.install).not.toHaveBeenCalled();
  });

  it("recognizes an already working older CLI without an automatic upgrade", async () => {
    const { options, hooks } = fixture({ machine: "2.8.0", versions: ["2.8.0"] });
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      setupReady: true,
      canPrepare: false,
      canUpdate: true,
      confirmUpdate: false,
    });
    expect((await prepareProjectCli(options)).ok).toBe(true);
    expect(hooks.install).not.toHaveBeenCalled();
  });

  it("does not ask to confirm a CLI update when the project is not pinned", () => {
    const { hooks } = fixture({ machine: "2.6.114", versions: ["2.6.114"] });
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      projectPin: null,
      canUpdate: true,
      confirmUpdate: false,
    });
  });

  it("does not treat a newer pin as a confirmed machine update", () => {
    const { hooks } = fixture({ pin: NEWER_WORKFLOWS_VERSION, versions: [NEWER_WORKFLOWS_VERSION] });
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      canPrepare: false,
      confirmUpdate: false,
    });
  });

  it("keeps an older project pin and still allows a machine CLI update", async () => {
    const { options, hooks, local } = fixture({
      machine: "2.6.114",
      pin: "2.6.114",
      versions: ["2.6.114"],
      registered: true,
    });
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      setupReady: true,
      canPrepare: false,
      canUpdate: true,
      confirmUpdate: true,
    });
    expect(await updateMachineCli(options)).toMatchObject({ ok: true });
    expect(local.machine?.version).toBe(SETUP_RELEASE);
    expect(local.pin.version).toBe("2.6.114");
    expect(hooks.pin).not.toHaveBeenCalled();
  });

  it("treats an older pin as ready once the verified CLI is installed", () => {
    const { hooks } = fixture({
      machine: SETUP_RELEASE,
      pin: "2.6.114",
      versions: ["2.6.114"],
    });
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      setupReady: true,
      canPrepare: false,
      canUpdate: false,
      confirmUpdate: false,
    });
    expect(inspectCliManagement("/project", hooks).message).toContain("2.6.114 は維持");
  });

  it("offers a confirmed CLI update when the older pin has no native runtime", () => {
    const { hooks } = fixture({ pin: "2.6.114", versions: ["2.6.114"] });
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      setupReady: false,
      canPrepare: false,
      canUpdate: true,
      confirmUpdate: true,
    });
    expect(inspectCliManagement("/project", hooks).message).toContain(SETUP_RELEASE);
  });

  it.each([
    { pin: "2.8.0", versions: ["2.8.0"] },
    { pin: NEWER_WORKFLOWS_VERSION, versions: [NEWER_WORKFLOWS_VERSION] },
    { pin: SETUP_RELEASE, versions: ["2.8.0"] },
    { versions: [SETUP_RELEASE, "2.8.0"] },
    { versions: [null] },
    { pinExists: true, pin: null },
  ])(
    "blocks unsafe setup inputs without blocking the independent machine update: %j",
    async (input) => {
      const { options, hooks, local } = fixture(input);
      const original = { ...local.pin };
      expect(await prepareProjectCli(options)).toMatchObject({
        ok: false,
        stage: "preflight",
        reason: "blocked",
        applied: false,
      });
      expect(hooks.install).not.toHaveBeenCalled();
      expect(await updateMachineCli(options)).toMatchObject({ ok: true });
      expect(hooks.pin).not.toHaveBeenCalled();
      expect(local.pin).toEqual(original);
    },
  );

  it("updates the machine independently while preserving an older project runtime and pin", async () => {
    const { options, hooks, local } = fixture({
      machine: "2.8.0",
      pin: "2.8.0",
      versions: ["2.8.0"],
      registered: true,
    });
    expect(await updateMachineCli(options)).toMatchObject({ ok: true });
    expect(local.machine?.version).toBe(SETUP_RELEASE);
    expect(local.pin.version).toBe("2.8.0");
    expect(hooks.pin).not.toHaveBeenCalled();
    expect(inspectCliManagement("/project", hooks).effectiveVersion).toBe("2.8.0");
  });

  it("activates a retained target without downloading it", async () => {
    const { options, hooks, local } = fixture({
      machine: "2.8.0",
      retained: ["2.8.0", SETUP_RELEASE],
    });
    expect(await updateMachineCli(options)).toMatchObject({ ok: true });
    expect(hooks.install).not.toHaveBeenCalled();
    expect(hooks.use).toHaveBeenCalledOnce();
    expect(local.machine?.version).toBe(SETUP_RELEASE);
  });

  it.each([false, true])(
    "prepares the target beside a newer default without changing the project (pinned: %s)",
    async (pinned) => {
      const { options, hooks, local } = fixture({
        machine: NEWER_WORKFLOWS_VERSION,
        versions: ["2.8.0"],
        ...(pinned ? { pin: "2.8.0", registered: true } : {}),
        retained: [NEWER_WORKFLOWS_VERSION, "2.8.0"],
      });
      const previousPin = { ...local.pin };
      expect(inspectCliManagement("/project", hooks)).toMatchObject({
        canUpdate: true,
        targetInstalled: false,
      });
      const result = await updateMachineCli(options);
      expect(result).toMatchObject({ ok: true, recovery: "restored" });
      expect(result.message).toContain(`${NEWER_WORKFLOWS_VERSION} は維持`);
      expect(hooks.install).toHaveBeenCalledOnce();
      expect(hooks.use).toHaveBeenCalledExactlyOnceWith(runtime(NEWER_WORKFLOWS_VERSION), NEWER_WORKFLOWS_VERSION, options.log);
      expect(hooks.pin).not.toHaveBeenCalled();
      expect(local.pin).toEqual(previousPin);
      expect(local.versions).toEqual(["2.8.0"]);
      expect(inspectCliManagement("/project", hooks)).toMatchObject({
        machineVersion: NEWER_WORKFLOWS_VERSION,
        effectiveVersion: pinned ? "2.8.0" : NEWER_WORKFLOWS_VERSION,
        targetInstalled: true,
        launcherReady: true,
        canUpdate: false,
      });
      expect(await updateMachineCli(options)).toMatchObject({ ok: true, applied: false });
      expect(hooks.install).toHaveBeenCalledOnce();
    },
  );

  it("does not switch the default when the installer already preserves it", async () => {
    const state = fixture({ machine: NEWER_WORKFLOWS_VERSION });
    state.hooks.install.mockImplementation(async () => {
      state.retained.set(SETUP_RELEASE, runtime(SETUP_RELEASE));
    });
    expect(await updateMachineCli(state.options)).toMatchObject({
      ok: true,
      recovery: "not-needed",
    });
    expect(state.hooks.use).not.toHaveBeenCalled();
    expect(state.local.machine?.version).toBe(NEWER_WORKFLOWS_VERSION);
  });

  it("does not downgrade a newer default when the target is already retained", async () => {
    const { options, hooks } = fixture({ machine: NEWER_WORKFLOWS_VERSION, retained: [NEWER_WORKFLOWS_VERSION, SETUP_RELEASE] });
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      canUpdate: false,
      canPrepare: false,
      setupReady: true,
    });
    expect(await updateMachineCli(options)).toMatchObject({ ok: true, applied: false });
    expect(hooks.install).not.toHaveBeenCalled();
    expect(hooks.use).not.toHaveBeenCalled();
    expect(await updateMachineCli(fixture().options)).toMatchObject({ ok: true });
  });

  it("prepares a fresh project beside a newer default without creating a project pin", async () => {
    const state = fixture({ machine: NEWER_WORKFLOWS_VERSION });
    expect(inspectCliManagement("/project", state.hooks)).toMatchObject({
      canPrepare: true,
      setupReady: false,
      targetInstalled: false,
    });
    expect(await prepareProjectCli(state.options)).toMatchObject({
      ok: true,
      recovery: "restored",
    });
    expect(inspectCliManagement("/project", state.hooks)).toMatchObject({
      canPrepare: false,
      setupReady: true,
      targetInstalled: true,
      machineVersion: NEWER_WORKFLOWS_VERSION,
      projectPin: null,
    });
    expect(state.hooks.pin).not.toHaveBeenCalled();
    expect(state.local.pin.exists).toBe(false);
    expect(state.hooks.use).toHaveBeenCalledExactlyOnceWith(
      runtime(NEWER_WORKFLOWS_VERSION),
      NEWER_WORKFLOWS_VERSION,
      state.options.log,
    );
  });

  it("does not treat an older pinned project as a fresh install", async () => {
    const state = fixture({
      machine: NEWER_WORKFLOWS_VERSION,
      retained: [NEWER_WORKFLOWS_VERSION, SETUP_RELEASE],
      pin: "2.8.0",
      versions: [],
    });
    expect(inspectCliManagement("/project", state.hooks)).toMatchObject({
      setupReady: true,
      canPrepare: false,
      confirmUpdate: false,
      projectPin: "2.8.0",
    });
    expect(await prepareProjectCli(state.options)).toMatchObject({ ok: true, applied: false });
    expect(state.hooks.install).not.toHaveBeenCalled();
    expect(state.hooks.pin).not.toHaveBeenCalled();
    expect(state.local.pin).toEqual({ exists: true, version: "2.8.0" });
  });

  it.each([{ versions: [SETUP_RELEASE] }, { versions: [null] }, { pinExists: true, pin: null, versions: [] }])(
    "does not treat an existing or unreadable project as fresh: %j",
    async (input) => {
    const state = fixture({ machine: NEWER_WORKFLOWS_VERSION, retained: [NEWER_WORKFLOWS_VERSION, SETUP_RELEASE], ...input });
    expect(inspectCliManagement("/project", state.hooks)).toMatchObject({
      setupReady: false,
      canPrepare: false,
    });
    expect(await prepareProjectCli(state.options)).toMatchObject({
      ok: false,
      reason: "blocked",
      applied: false,
    });
    expect(state.hooks.install).not.toHaveBeenCalled();
    expect(state.hooks.pin).not.toHaveBeenCalled();
    expect(state.hooks.use).not.toHaveBeenCalled();
  });

  it.each(["failure", "cancel"])(
    "restores a newer default after fresh-project preparation %s",
    async (stop) => {
      const state = fixture({ machine: NEWER_WORKFLOWS_VERSION });
      const controller = new AbortController();
      state.hooks.install.mockImplementation(async () => {
        state.local.machine = runtime(SETUP_RELEASE);
        if (stop === "cancel") controller.abort();
        throw new Error("installation interrupted");
      });
      expect(
        await prepareProjectCli({ ...state.options, signal: controller.signal }),
      ).toMatchObject({ ok: false, recovery: "restored" });
      expect(state.local.machine?.version).toBe(NEWER_WORKFLOWS_VERSION);
      expect(state.hooks.pin).not.toHaveBeenCalled();
      expect(inspectCliManagement("/project", state.hooks).setupReady).toBe(false);
    },
  );

  it("repairs missing launchers and keeps the newer default", async () => {
    const state = fixture({ machine: NEWER_WORKFLOWS_VERSION, retained: [NEWER_WORKFLOWS_VERSION, SETUP_RELEASE] });
    state.local.launcherReady = false;
    expect(inspectCliManagement("/project", state.hooks).canUpdate).toBe(true);
    state.hooks.install.mockImplementation(async () => {
      state.local.machine = runtime(SETUP_RELEASE);
      state.local.launcherReady = true;
    });
    expect(await updateMachineCli(state.options)).toMatchObject({ ok: true, recovery: "restored" });
    expect(state.local.machine?.version).toBe(NEWER_WORKFLOWS_VERSION);
    expect(state.hooks.install).toHaveBeenCalledOnce();
  });

  it("reports a failure to restore the newer default instead of claiming success", async () => {
    const state = fixture({ machine: NEWER_WORKFLOWS_VERSION });
    state.hooks.use.mockRejectedValueOnce(new Error("newer CLI locked"));
    expect(await updateMachineCli(state.options)).toMatchObject({
      ok: false,
      stage: "restore",
      recovery: "failed",
      reason: "restore-failed",
    });
    expect(await updateMachineCli(fixture().options)).toMatchObject({ ok: true });
  });

  it("rechecks the retained target after restoring the newer default", async () => {
    const state = fixture({ machine: NEWER_WORKFLOWS_VERSION });
    state.hooks.use.mockImplementation(async () => {
      state.local.machine = runtime(NEWER_WORKFLOWS_VERSION);
      state.retained.delete(SETUP_RELEASE);
    });
    expect(await updateMachineCli(state.options)).toMatchObject({
      ok: false,
      stage: "verify",
      reason: "verification-failed",
      recovery: "restored",
    });
  });

  it("can prepare a pinned project while preserving a newer machine default", async () => {
    const { options, local } = fixture({
      machine: NEWER_WORKFLOWS_VERSION,
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
    });
    expect(await prepareProjectCli(options)).toMatchObject({ ok: true, recovery: "restored" });
    expect(local.machine?.version).toBe(NEWER_WORKFLOWS_VERSION);
  });

  it.each([
    { machine: "2.8.0", stop: "failure" },
    { machine: "2.8.0", stop: "cancel" },
    { machine: NEWER_WORKFLOWS_VERSION, stop: "failure" },
    { machine: NEWER_WORKFLOWS_VERSION, stop: "cancel" },
  ])(
    "restores $machine when installation changes the default before $stop",
    async ({ machine, stop }) => {
      const { options, hooks, local, retained } = fixture({ machine });
      const abort = new AbortController();
      hooks.install.mockImplementation(async () => {
        local.machine = runtime(SETUP_RELEASE);
        retained.set(SETUP_RELEASE, local.machine);
        if (stop === "cancel") abort.abort();
        throw new Error("installer failed after activation");
      });
      const result = await updateMachineCli({ ...options, signal: abort.signal });
      expect(result).toMatchObject({
        ok: false,
        stage: "install",
        recovery: "restored",
        applied: true,
        reason: stop === "cancel" ? "cancelled" : "install-failed",
      });
      expect(local.machine?.version).toBe(machine);
      // Recovery never inherits the aborted request's signal.
      expect(hooks.use.mock.calls[0]).toHaveLength(3);
    },
  );

  it("stops before registering a pin when the repository version changes during download", async () => {
    const { options, hooks, local, retained } = fixture({
      machine: "2.8.0",
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
    });
    hooks.install.mockImplementation(async () => {
      local.machine = runtime(SETUP_RELEASE);
      retained.set(SETUP_RELEASE, local.machine);
      local.pin.version = NEWER_WORKFLOWS_VERSION;
    });
    expect(await prepareProjectCli(options)).toMatchObject({
      ok: false,
      stage: "preflight",
      recovery: "restored",
    });
    expect(hooks.pin).not.toHaveBeenCalled();
    expect(local.pin.version).toBe(NEWER_WORKFLOWS_VERSION);
    expect(local.machine?.version).toBe("2.8.0");
  });

  it("reports registration failures and preserves the repository version", async () => {
    const { options, hooks, local } = fixture({
      machine: "2.8.0",
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
    });
    hooks.pin.mockImplementation(async () => {
      throw new Error("EPERM pin registry");
    });
    const result = await prepareProjectCli(options);
    expect(result).toMatchObject({ ok: false, stage: "register", recovery: "restored" });
    expect(result.nextAction).toContain("権限");
    expect(local.pin.version).toBe(SETUP_RELEASE);
  });

  it("reports restoration failure as an incomplete operation and releases the lock", async () => {
    const { options, hooks } = fixture({
      machine: "2.8.0",
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
    });
    hooks.use.mockImplementation(async () => {
      throw new Error("previous binary locked");
    });
    expect(await prepareProjectCli(options)).toMatchObject({
      ok: false,
      stage: "restore",
      recovery: "failed",
      reason: "restore-failed",
    });
    expect(await updateMachineCli(fixture().options)).toMatchObject({ ok: true });
  });

  it("retains both the original error and restoration failure", async () => {
    const { options, hooks } = fixture({
      machine: "2.8.0",
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
    });
    hooks.pin.mockImplementation(async () => {
      throw new Error("registry failure");
    });
    hooks.use.mockImplementation(async () => {
      throw new Error("restore failure");
    });
    const result = await prepareProjectCli(options);
    expect(result.details).toContain("registry failure");
    expect(result.details).toContain("restore failure");
  });

  it("verifies restoration instead of trusting a successful command exit", async () => {
    const { options, hooks } = fixture({
      machine: "2.8.0",
      pin: SETUP_RELEASE,
      versions: [SETUP_RELEASE],
    });
    hooks.use.mockImplementation(async () => {});
    expect(await prepareProjectCli(options)).toMatchObject({ ok: false, reason: "restore-failed" });
  });

  it.each([
    ["公式インストーラーのチェックサムが一致しません。", "検証に失敗"],
    ["fetch failed", "通信環境"],
  ])("shows actionable installer errors: %s", async (message, expected) => {
    const { options, hooks } = fixture();
    hooks.install.mockImplementation(async () => {
      throw new Error(message);
    });
    expect((await prepareProjectCli(options)).nextAction).toContain(expected);
    expect(hooks.pin).not.toHaveBeenCalled();
  });

  it("serializes machine operations across workspace roots", async () => {
    const first = fixture();
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    first.hooks.install.mockImplementation(async () => {
      started?.();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      first.local.machine = runtime(SETUP_RELEASE);
      first.retained.set(SETUP_RELEASE, first.local.machine);
    });
    const operation = updateMachineCli(first.options);
    await waiting;
    expect(
      await prepareProjectCli({ ...fixture().options, workspaceRoot: "/other" }),
    ).toMatchObject({ ok: false, reason: "busy" });
    finish?.();
    expect(await operation).toMatchObject({ ok: true });
    expect(await prepareProjectCli(fixture().options)).toMatchObject({ ok: true });
  });
});

describe("a newer machine default on an unpinned native project", () => {
  function newerDefault(retained = [NEWER_WORKFLOWS_VERSION, SETUP_RELEASE]) {
    const state = fixture({ machine: NEWER_WORKFLOWS_VERSION, retained, versions: [SETUP_RELEASE] });
    const pin = vi.fn(async (_install: NativeInstall, _root: string, version: string) => {
      // The official CLI writes `.aidlc-version` and registers it on this machine.
      state.local.pin = { exists: true, version };
      state.local.registered = true;
    });
    const hooks = { ...state.hooks, pin, isNative: () => true };
    return { ...state, hooks, options: { ...state.options, hooks } };
  }

  it("offers to pin the project or move the default back, not a CLI update", () => {
    const { hooks } = newerDefault();
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      engineNewer: true,
      setupReady: false,
      canPrepare: false,
      canUpdate: false,
      effectiveVersion: NEWER_WORKFLOWS_VERSION,
    });
    expect(inspectCliManagement("/project", hooks).message).toContain(`${SETUP_RELEASE} に固定`);
  });

  it("is not offered for a copy-channel project or a pinned one", () => {
    const copy = fixture({
      machine: NEWER_WORKFLOWS_VERSION,
      retained: [NEWER_WORKFLOWS_VERSION, SETUP_RELEASE],
      versions: [SETUP_RELEASE],
    });
    expect(inspectCliManagement("/project", { ...copy.hooks, isNative: () => false }).engineNewer).toBe(
      false,
    );
    const pinned = fixture({
      machine: NEWER_WORKFLOWS_VERSION,
      retained: [NEWER_WORKFLOWS_VERSION, SETUP_RELEASE],
      versions: [SETUP_RELEASE],
      pin: SETUP_RELEASE,
    });
    expect(inspectCliManagement("/project", { ...pinned.hooks, isNative: () => true }).engineNewer).toBe(
      false,
    );
  });

  it("pins the project with the target runtime and keeps the newer default", async () => {
    const { options, hooks, local } = newerDefault();
    expect(await pinProjectCli(options)).toMatchObject({
      ok: true,
      stage: "complete",
      applied: true,
      recovery: "not-needed",
    });
    expect(hooks.pin).toHaveBeenCalledExactlyOnceWith(
      runtime(SETUP_RELEASE),
      "/project",
      SETUP_RELEASE,
      options.log,
      undefined,
      {},
    );
    expect(hooks.install).not.toHaveBeenCalled();
    expect(hooks.use).not.toHaveBeenCalled();
    expect(local.pin).toEqual({ exists: true, version: SETUP_RELEASE });
    expect(local.machine?.version).toBe(NEWER_WORKFLOWS_VERSION);
    expect(inspectCliManagement("/project", hooks)).toMatchObject({
      engineNewer: false,
      setupReady: true,
      effectiveVersion: SETUP_RELEASE,
    });
  });

  it("installs a missing target beside the newer default before pinning", async () => {
    const { options, hooks, local } = newerDefault([NEWER_WORKFLOWS_VERSION]);
    expect(await pinProjectCli(options)).toMatchObject({ ok: true, recovery: "restored" });
    expect(hooks.install).toHaveBeenCalledOnce();
    expect(local.machine?.version).toBe(NEWER_WORKFLOWS_VERSION);
    expect(local.pin).toEqual({ exists: true, version: SETUP_RELEASE });
  });

  it("reports a pin that did not take instead of claiming success", async () => {
    const { options, hooks } = newerDefault();
    hooks.pin.mockImplementation(async () => {});
    expect(await pinProjectCli(options)).toMatchObject({ ok: false, stage: "verify" });
  });

  it("moves the default back only when asked, without creating a pin", async () => {
    const { options, hooks, local } = newerDefault();
    expect(await useTargetCli(options)).toMatchObject({ ok: true, stage: "complete" });
    expect(hooks.use).toHaveBeenCalledExactlyOnceWith(
      runtime(SETUP_RELEASE),
      SETUP_RELEASE,
      options.log,
      undefined,
      {},
    );
    expect(local.machine?.version).toBe(SETUP_RELEASE);
    expect(hooks.pin).not.toHaveBeenCalled();
    expect(local.pin.exists).toBe(false);
  });

  it.each([pinProjectCli, useTargetCli])("refuses %o once the situation no longer applies", async (run) => {
    const { options, hooks } = newerDefault();
    const stale = { ...options, hooks: { ...hooks, isNative: () => false } };
    expect(await run(stale)).toMatchObject({ ok: false, reason: "blocked", applied: false });
    expect(hooks.install).not.toHaveBeenCalled();
    expect(hooks.pin).not.toHaveBeenCalled();
    expect(hooks.use).not.toHaveBeenCalled();
  });
});

describe("readying the target runtime for a project update", () => {
  it("installs the target beside an older default and leaves the default as it was", async () => {
    const state = fixture({ machine: "2.8.0", pin: "2.8.0", versions: ["2.8.0"] });
    const result = await prepareTargetRuntime(state.options);
    expect(result).toMatchObject({ ok: true, stage: "complete", recovery: "restored" });
    expect(result.message).toContain("既定のバージョン 2.8.0 は変えていません");
    expect(state.hooks.install).toHaveBeenCalledOnce();
    expect(state.retained.has(SETUP_RELEASE)).toBe(true);
    expect(state.local.machine?.version).toBe("2.8.0");
    expect(state.hooks.pin).not.toHaveBeenCalled();
    expect(state.hooks.writePinBytes).not.toHaveBeenCalled();
  });

  it("makes the target the default on a PC that had no CLI", async () => {
    const state = fixture({ pin: "2.8.0", versions: ["2.8.0"] });
    expect(await prepareTargetRuntime(state.options)).toMatchObject({
      ok: true,
      recovery: "not-needed",
    });
    expect(state.local.machine?.version).toBe(SETUP_RELEASE);
    expect(state.hooks.use).not.toHaveBeenCalled();
  });

  it("does nothing when the target is already there", async () => {
    const state = fixture({ machine: "2.8.0", retained: ["2.8.0", SETUP_RELEASE] });
    expect(await prepareTargetRuntime(state.options)).toMatchObject({ ok: true, applied: false });
    expect(state.hooks.install).not.toHaveBeenCalled();
    expect(state.hooks.use).not.toHaveBeenCalled();
  });
});
