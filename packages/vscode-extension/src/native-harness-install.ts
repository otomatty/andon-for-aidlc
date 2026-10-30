import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CODEX_GIT_REQUIRED, isGitRepository } from "./git-prerequisite.ts";
import { detectHarnesses, type HarnessId } from "./harness-detect.ts";
import {
  applyHarnessCandidate,
  planHarnessCandidate,
  priorHarnessVersionForReconciliation,
} from "./native-harness-merge.ts";
import { applyCandidatePlugins, capturePluginInputs } from "./native-plugin-inputs.ts";
import {
  type ConfigureNativeOptions,
  configureNative,
  type NativeConfigureResult,
  type NativeInstall,
  readVersionedNativeInstall,
  runNativeDoctor,
  runSetupProcess,
  type SetupRunner,
} from "./native-setup.ts";
import { harnessVersionRel } from "./workflows-version.ts";

type RegistryEntry = { dirName?: string; uuid?: string; slug?: string; status?: string };

async function entryStat(file: string) {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`リンク先の設定は変更できません: ${file}`);
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function directories(root: string): Promise<string[]> {
  const stat = await entryStat(root);
  if (stat === null) return [];
  if (!stat.isDirectory()) throw new Error(`設定フォルダーを確認できません: ${root}`);
  const result: string[] = [];
  for (const name of (await readdir(root)).sort()) {
    if ((await entryStat(path.join(root, name)))?.isDirectory()) result.push(name);
  }
  return result;
}

function matchesRecord(entry: RegistryEntry, name: string): boolean {
  if (typeof entry.dirName === "string" && entry.dirName) return entry.dirName === name;
  if (
    typeof entry.slug !== "string" ||
    typeof entry.uuid !== "string" ||
    !name.startsWith(`${entry.slug}-`)
  )
    return false;
  const suffix = name.slice(entry.slug.length + 1);
  return /^[0-9a-f]+$/.test(suffix) && entry.uuid.replaceAll("-", "").endsWith(suffix);
}

/**
 * Open workflows as `<space>/<record>`, like native config's open-work line, including
 * records outside the registry. Since 2.11 config runs beside open work instead of refusing.
 */
export async function listOpenWorkflows(root: string): Promise<string[]> {
  const workspace = path.join(root, "aidlc");
  if ((await entryStat(workspace)) === null) return [];
  const spaces = path.join(workspace, "spaces");
  const active: string[] = [];
  for (const space of await directories(spaces)) {
    const intents = path.join(spaces, space, "intents");
    const records = await directories(intents);
    const registryPath = path.join(intents, "intents.json");
    let registry: RegistryEntry[] = [];
    const registryStat = await entryStat(registryPath);
    if (registryStat !== null) {
      if (!registryStat.isFile()) throw new Error(`記録一覧を確認できません: ${registryPath}`);
      try {
        const parsed: unknown = JSON.parse(await readFile(registryPath, "utf8"));
        if (Array.isArray(parsed)) {
          registry = parsed.filter(
            (item): item is RegistryEntry => item !== null && typeof item === "object",
          );
        }
      } catch (error) {
        // Like the engine, a malformed registry cannot hide an on-disk active record.
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    for (const record of records) {
      const state = path.join(intents, record, "aidlc-state.md");
      const stateStat = await entryStat(state);
      if (stateStat === null) continue;
      if (!stateStat.isFile()) throw new Error(`進行状況を確認できません: ${state}`);
      if (registry.find((entry) => matchesRecord(entry, record))?.status === "complete") continue;
      const content = await readFile(state, "utf8");
      if (/^- \*\*Status\*\*:[ \t]*Completed[ \t]*\r?$/m.test(content)) continue;
      active.push(`${space}/${record}`);
    }
  }
  return active;
}

export function openWorkCarriesOnLine(open: readonly string[]): string | null {
  return open.length > 0
    ? `進行中の作業（${open.join("、")}）は、この変更の後もそのまま続けられます。`
    : null;
}

/**
 * Tell the person their open work carries on, as native config does after a refresh.
 * The note never blocks the change: a record the scan cannot read only drops the note.
 */
export async function noteOpenWorkflows(root: string, log: (line: string) => void): Promise<void> {
  let open: string[];
  try {
    open = await listOpenWorkflows(root);
  } catch {
    return;
  }
  const line = openWorkCarriesOnLine(open);
  if (line) log(line);
}

const digest = (value: string | Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

type PolicyInputs = {
  hash: string;
  files: Map<string, Buffer | null>;
  dirs: string[];
  space: string;
};

async function policyInputs(root: string): Promise<PolicyInputs> {
  const files = new Map<string, Buffer | null>();
  const dirs: string[] = [];
  const collect = async (rel: string): Promise<void> => {
    const source = path.join(root, rel);
    const stat = await entryStat(source);
    if (stat === null) files.set(rel, null);
    else if (stat.isDirectory()) {
      dirs.push(rel);
      for (const name of (await readdir(source)).sort()) await collect(`${rel}/${name}`);
    } else if (stat.isFile()) files.set(rel, await readFile(source));
    else throw new Error(`設定ファイルを確認できません: ${source}`);
  };
  for (const file of ["aidlc.settings.json", "aidlc.settings.local.json", "aidlc/active-space"]) {
    await collect(file);
  }
  const spaces = await directories(path.join(root, "aidlc", "spaces"));
  for (const space of spaces) await collect(`aidlc/spaces/${space}/memory`);
  const space = files.get("aidlc/active-space")?.toString("utf8").trim() || "default";
  if (!/^[a-z][a-z0-9-]*$/.test(space) || (space !== "default" && !spaces.includes(space))) {
    throw new Error("現在の AI-DLC スペースを確認できません。設定を確認してから実行してください。");
  }
  return {
    files,
    dirs,
    space,
    hash: digest(
      JSON.stringify({
        dirs,
        files: [...files].map(([name, value]) => [name, value === null ? null : digest(value)]),
      }),
    ),
  };
}

/** Seed exactly the inputs that the reviewed plan will verify again before committing. */
async function seedCandidatePolicy(inputs: PolicyInputs, candidate: string): Promise<void> {
  for (const dir of inputs.dirs) await mkdir(path.join(candidate, dir), { recursive: true });
  for (const [rel, bytes] of inputs.files) {
    if (bytes === null) continue;
    const file = path.join(candidate, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
}

async function alignCandidateSpace(
  install: NativeInstall,
  candidate: string,
  harnessDir: string,
  space: string,
  runner: SetupRunner,
  options: ConfigureNativeOptions,
): Promise<void> {
  if (space === "default") return;
  const baselinePath = path.join(candidate, harnessDir, "tools", "data", "aidlc-manifest.json");
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as {
    files: Record<string, string>;
    rootContributions: Record<string, { policy: string; hash?: string; marker?: string }>;
  };
  const result = await runner(
    install.executable,
    ["engine", "space", "switch", space, "--project-dir", candidate],
    candidate,
    { ...process.env, AIDLC_HARNESS_DIR: harnessDir },
    options.signal,
  );
  options.signal?.throwIfAborted();
  if (result.code !== 0)
    throw new Error(`スペースの設定に失敗しました: ${result.stderr || result.stdout}`);
  // The native space command intentionally rewrites committed include pointers. Record
  // those generated bytes so both the import integrity check and later refreshes agree.
  for (const rel of Object.keys(baseline.files)) {
    baseline.files[rel] = digest(await readFile(path.join(candidate, rel)));
  }
  for (const [rel, contribution] of Object.entries(baseline.rootContributions)) {
    if (contribution.policy === "whole-file")
      contribution.hash = digest(await readFile(path.join(candidate, rel)));
    else if (contribution.policy === "managed-block") {
      const text = await readFile(path.join(candidate, rel), "utf8");
      const identity = contribution.marker ?? path.basename(rel);
      const begin = rel.endsWith(".md")
        ? `<!-- BEGIN AI-DLC:${identity} -->`
        : `# BEGIN AI-DLC:${identity}`;
      const end = rel.endsWith(".md")
        ? `<!-- END AI-DLC:${identity} -->`
        : `# END AI-DLC:${identity}`;
      const start = text.indexOf(begin);
      const stop = text.indexOf(end);
      if (text.split(begin).length !== 2 || text.split(end).length !== 2 || stop < start)
        throw new Error(`スペース切り替え後の設定ブロックを確認できません: ${rel}`);
      contribution.hash = digest(text.slice(start, stop + end.length));
    }
  }
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

export async function configureNativeHarness(
  install: NativeInstall,
  root: string,
  harness: HarnessId,
  log: (message: string) => void,
  runner: SetupRunner = runSetupProcess,
  options: ConfigureNativeOptions = {},
): Promise<NativeConfigureResult> {
  const checkCurrent = () => {
    options.signal?.throwIfAborted();
    if (options.isCurrent?.() === false) throw new Error("設定を中止しました。");
  };
  checkCurrent();
  if (options.previewOnly && options.planToken !== undefined) {
    throw new Error("設定の確認と適用を同時には指定できません。");
  }
  const harnessDir = path.dirname(path.dirname(harnessVersionRel(harness)));
  const selectedRunner: SetupRunner = (command, args, cwd, env, signal, processOptions) =>
    runner(command, args, cwd, { ...env, AIDLC_HARNESS_DIR: harnessDir }, signal, processOptions);
  const sidecar = path.join(root, harnessDir, "tools", "data", "andon-install.json");
  const detected = detectHarnesses(root).harnesses;
  const alreadyInstalled = detected.some((item) => item.id === harness);
  checkCurrent();
  if ((alreadyInstalled || detected.length === 0) && !existsSync(sidecar)) {
    return configureNative(install, root, harness, log, selectedRunner, options);
  }
  if (harness === "codex" && !(await isGitRepository(root, options.signal))) {
    throw new Error(CODEX_GIT_REQUIRED);
  }
  checkCurrent();
  const inputs = await policyInputs(root);
  const plugins = await capturePluginInputs(root, harness, install);
  checkCurrent();
  const priorVersion = priorHarnessVersionForReconciliation(root, harness, install.version);
  const priorInstall = priorVersion ? readVersionedNativeInstall(priorVersion) : null;
  if (priorVersion && !priorInstall)
    throw new Error(
      `既存のプラグイン構成を検証するには本体 ${priorVersion} が必要です。公式インストーラーでこのバージョンを復元してから再実行してください。`,
    );
  const candidates: string[] = [];
  const generate = async (release: NativeInstall): Promise<string> => {
    const candidate = await mkdtemp(path.join(tmpdir(), "andon-harness-"));
    candidates.push(candidate);
    await seedCandidatePolicy(inputs, candidate);
    checkCurrent();
    if (harness === "codex") {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.toUpperCase().startsWith("GIT_")) delete env[key];
      const initialized = await runner(
        "git",
        ["init", "--quiet", candidate],
        candidate,
        env,
        options.signal,
      );
      checkCurrent();
      if (initialized.code !== 0) {
        throw new Error(
          `設定候補の Git 初期化に失敗しました: ${initialized.stderr || initialized.stdout}`,
        );
      }
    }
    log("公式の設定を一時フォルダーで生成しています…");
    await configureNative(release, candidate, harness, () => {}, selectedRunner, {
      sourceRoot:
        release === install && options.sourceRoot
          ? options.sourceRoot
          : path.join(path.dirname(release.executable), "runtime", harness),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.isCurrent ? { isCurrent: options.isCurrent } : {}),
      ...(options.mcp ? { mcp: options.mcp } : {}),
    });
    checkCurrent();
    await applyCandidatePlugins(release, candidate, harness, plugins, selectedRunner, options);
    checkCurrent();
    await alignCandidateSpace(
      release,
      candidate,
      harnessDir,
      inputs.space,
      selectedRunner,
      options,
    );
    checkCurrent();
    return candidate;
  };
  try {
    const candidate = await generate(install);
    const priorCandidate = priorInstall ? await generate(priorInstall) : undefined;
    const reconciliation = priorCandidate ? { priorCandidate } : {};
    const plan = await planHarnessCandidate(
      candidate,
      root,
      harness,
      install.version,
      reconciliation,
    );
    const planToken = digest(JSON.stringify([plan.planToken, inputs.hash, plugins.hash]));
    checkCurrent();
    if (options.previewOnly) {
      return {
        doctorOk: true,
        details: "ツールの設定計画を確認しました。",
        planToken,
      };
    }
    if (options.planToken !== undefined && options.planToken !== planToken) {
      throw new Error(
        "確認後にプロジェクトの設定が変更されました。もう一度設定内容を確認してください。",
      );
    }
    await applyHarnessCandidate(candidate, root, harness, install.version, {
      ...options,
      ...reconciliation,
      planToken: plan.planToken,
      recoverStaleLock: async () => {
        checkCurrent();
        log("終了した処理が残したロックを本体で確認しています…");
        const report = await runNativeDoctor(install, root, selectedRunner, options);
        checkCurrent();
        log(report.summary);
        // Doctor reports recovered locks as a failed check. Reacquisition determines
        // whether recovery succeeded; do not turn that diagnostic into a new block.
      },
      validateLocked: async () => {
        checkCurrent();
        if (
          (await policyInputs(root)).hash !== inputs.hash ||
          (await capturePluginInputs(root, harness, install)).hash !== plugins.hash
        ) {
          throw new Error(
            "確認後にプロジェクトの設定が変更されました。もう一度設定内容を確認してください。",
          );
        }
        if (harness === "codex" && !(await isGitRepository(root, options.signal))) {
          throw new Error(CODEX_GIT_REQUIRED);
        }
      },
    });
    checkCurrent();
    // The candidate ran in a scratch project, so this project's open work is named here.
    await noteOpenWorkflows(root, log);
    log("設定後の環境を診断しています…");
    const doctorReport = await runNativeDoctor(install, root, selectedRunner, options);
    checkCurrent();
    log(doctorReport.summary);
    return {
      doctorOk: doctorReport.outcome === "ok" || doctorReport.outcome === "warning",
      details: doctorReport.rawOutput,
      doctorReport,
      planToken,
    };
  } finally {
    await Promise.all(
      candidates.map((candidate) => rm(candidate, { recursive: true, force: true })),
    );
  }
}
