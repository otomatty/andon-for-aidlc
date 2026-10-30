#!/usr/bin/env bun
/** Capture actual CLI processes. Expected rows come from upstream data, never Guide's parser. */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type DoctorCapture,
  type ExpectedDoctor,
  GENERATOR_VERSION,
  hash,
} from "./doctor-evidence.ts";
import { parseAidlcVersion } from "./sync-official-docs.ts";

function run(executable: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status === null)
    throw new Error(`process failed: ${executable}: ${String(result.error ?? result.signal)}`);
  return {
    code: result.status,
    stdout: result.stdout.replace(/\r\n/g, "\n"),
    stderr: result.stderr.replace(/\r\n/g, "\n"),
  };
}

/** Age of the warning scenario's update check: past the cache TTL, read as "30 days ago". */
const STALE_UPDATE_CHECK_MS = 30 * 24 * 60 * 60 * 1000;

// Doctor prints when the hooks last fired, which differs on every capture. A
// fixed instant keeps fresh captures byte-identical to the committed evidence
// while still reading as a timestamp to the label patterns.
export const CAPTURE_TIMESTAMP = "2000-01-01T00:00:00Z";

export function normalizeCaptureTimes(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, CAPTURE_TIMESTAMP);
}

export function verifyUpstream(upstream: string) {
  const version = parseAidlcVersion(
    readFileSync(path.join(upstream, "core/tools/aidlc-version.ts"), "utf8"),
  );
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("expected a stable AIDLC_VERSION");
  const git = (args: string[]) => {
    const result = run("git", args, upstream);
    if (result.code) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const upstreamSha = git(["rev-parse", "HEAD"]);
  if (git(["rev-parse", `refs/tags/v${version}^{commit}`]) !== upstreamSha)
    throw new Error("checkout HEAD is not the release tag");
  if (git(["status", "--porcelain", "--untracked-files=no"]))
    throw new Error("upstream tracked files are modified");
  return { version, upstreamSha };
}

/** Conservative dependency boundary: newly added tools/data also require review. */
export function doctorSourceDigests(upstream: string): Record<string, string> {
  const files: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(upstream, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && /\.(ts|json)$/.test(entry.name)) files.push(child);
    }
  };
  walk("core/tools");
  return Object.fromEntries(
    files.sort().map((file) => [
      file,
      hash(
        readFileSync(path.join(upstream, file))
          .toString("utf8")
          .replace(/\r\n/g, "\n")
          .replace(
            file === "core/tools/aidlc-version.ts" ? /(AIDLC_VERSION\s*=\s*")[^"]+(";)/ : /$^/,
            "$1<RELEASE>$2",
          ),
      ),
    ]),
  );
}

/**
 * The renderer's own fallback fix. 2.11 stopped quoting the doctor command (a
 * terminal tool deletes output up to a line that repeats it); earlier releases
 * build it from the invocation, which is the default above.
 */
export function upstreamFallbackFix(upstream: string): string | undefined {
  const source = readFileSync(path.join(upstream, "core/tools/aidlc-doctor.ts"), "utf8");
  return /const fallbackFix =\s*"([^"]+)";/.exec(source)?.[1];
}

type UpstreamCheck = { pass: boolean; severity?: string; label: string; fix?: string };
type Finding = { id: string; severity: string; summary: string; remedy?: string };
/** Mirrors the reviewed human-v1 renderer's grouping, independent of Guide's text parser. */
export function expectedFromUpstream(
  checks: UpstreamCheck[],
  findings: Finding[],
  code: number,
  invoke: string,
  fallbackFix?: string,
): ExpectedDoctor {
  const framework =
    /^(?:Agent filename|Scope filename|Cycle detection|Orphan stage|Uncompiled stage|Enabled stage compile coverage|Scope validation|Schema validation|Graph references|Keyword overlap|Rule drift|Paired sensor coverage|Stage graph|Scope grid|Sensor |Required sections|Upstream coverage|Traceability|Linter|Type check)/i;
  const machine =
    /^(?:Update:|Windows uninstall|Windows launcher|Runtime hook PATH|Harness CLI|Installed runtime|Command pointer|Rollback target|Plugin marketplace|Project pin registry|Transaction staging|Transaction recovery|Settings global)/i;
  const fallback =
    fallbackFix ??
    `run \`${invoke} doctor --verbose\`, correct the named condition, then rerun \`${invoke} doctor\``;
  const rows: ExpectedDoctor["checks"] = checks.map((check) => {
    const status = check.severity === "warn" ? "warn" : check.pass ? "ok" : "fail";
    return {
      section: machine.test(check.label)
        ? "machine"
        : framework.test(check.label)
          ? "framework"
          : "project",
      status,
      originalLabel: check.label,
      ...(status === "ok" ? {} : { originalFix: check.fix ?? fallback }),
    };
  });
  rows.push(
    ...findings
      .filter((f) => f.severity !== "info")
      .map((f) => ({
        section: "project",
        status: "warn",
        originalLabel: `[${f.id}] ${f.summary}`,
        originalFix: f.remedy ?? fallback,
      })),
  );
  const order = ["machine", "project", "framework"];
  rows.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
  const counts = {
    passed: rows.filter((c) => c.status === "ok").length,
    warnings: rows.filter((c) => c.status === "warn").length,
    failed: rows.filter((c) => c.status === "fail").length,
  };
  return { code, counts, checks: rows };
}

export async function captureDoctor(options: {
  upstream: string;
  out: string;
  releaseDir?: string;
  channels?: ("copy" | "native")[];
}) {
  const upstream = path.resolve(options.upstream);
  const provenance = verifyUpstream(upstream);
  const out = path.resolve(options.out);
  if (existsSync(path.join(out, "candidate.json")))
    throw new Error(
      "choose a fresh output directory; existing captures must not be mixed with a retry",
    );
  mkdirSync(out, { recursive: true });
  // Since 2.11.2 Doctor warns on Windows when a project folder is 75 characters
  // or more, so a healthy scenario needs a short path: the runner's own temp
  // folder (D:\a\_temp) and a short prefix keep the deepest project near 62.
  const base = realpathSync(mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), "adc-")));
  const captures: DoctorCapture[] = [];
  const fallbackFix = upstreamFallbackFix(upstream);
  const bun = process.execPath;
  const git = Bun.which("git");
  if (!git) throw new Error("git is required");
  try {
    for (const harness of ["claude", "kiro"]) {
      const packaged = run(bun, ["scripts/package.ts", harness], upstream);
      if (packaged.code) throw new Error(packaged.stderr);
    }
    // Test doubles cover external CLI presence/PATH only. AI-DLC code is unmodified.
    const tools = path.join(base, "test-tools");
    mkdirSync(tools);
    const stub = path.join(base, "tool.ts");
    writeFileSync(
      stub,
      'import {basename} from "node:path"; const name=basename(process.execPath).replace(/\\.exe$/, ""); if(name==="powershell"||name==="getconf") console.log(process.env.DOCTOR_BASELINE_PATH); else if(process.argv.includes("--version")) console.log("3.0.0 (Doctor fixture CLI)"); else process.exit(2);\n',
    );
    const stubExe = path.join(tools, process.platform === "win32" ? "tool.exe" : "tool");
    const built = run(bun, ["build", "--compile", stub, "--outfile", stubExe], base);
    if (built.code) throw new Error(built.stderr);
    for (const name of ["powershell", "getconf", "claude", "kiro-cli"]) {
      const file = path.join(tools, name + (process.platform === "win32" ? ".exe" : ""));
      cpSync(stubExe, file);
      chmodSync(file, 0o755);
    }
    for (const channel of options.channels ?? ["copy", "native"]) {
      const scenarios = [
        "healthy",
        "warning",
        "failed",
        ...(channel === "copy" ? ["bun-path", "analysis-warning", "kiro-provider"] : []),
      ];
      for (const scenario of scenarios) {
        const harness = scenario === "kiro-provider" ? "kiro" : "claude";
        const work = path.join(base, `${channel}-${harness}-${scenario}`);
        const project = path.join(work, "日本語 project");
        const home = path.join(work, "home");
        const machine = path.join(work, "machine");
        for (const dir of [project, home, machine]) mkdirSync(dir, { recursive: true });
        const bin = path.join(machine, "bin");
        const cliPath = [
          tools,
          bin,
          path.dirname(bun),
          path.dirname(git),
          ...(process.platform === "win32"
            ? [path.join(process.env.SystemRoot ?? "C:/Windows", "System32")]
            : ["/usr/bin", "/bin"]),
        ].join(path.delimiter);
        const env: NodeJS.ProcessEnv = {
          ...(process.platform === "win32"
            ? {
                SystemRoot: process.env.SystemRoot,
                ComSpec: process.env.ComSpec,
                PATHEXT: ".COM;.EXE;.BAT;.CMD",
              }
            : {}),
          PATH: cliPath,
          DOCTOR_BASELINE_PATH: cliPath,
          HOME: home,
          USERPROFILE: home,
          TEMP: work,
          TMP: work,
          TMPDIR: work,
          LOCALAPPDATA: path.join(home, "local"),
          APPDATA: path.join(home, "roaming"),
          XDG_CONFIG_HOME: path.join(home, "config"),
          XDG_DATA_HOME: path.join(home, "data"),
          AIDLC_INSTALL_ROOT: machine,
          AIDLC_BIN_DIR: bin,
          AIDLC_MANAGED_SETTINGS_PATH: path.join(home, "managed-settings.json"),
          AIDLC_CLAUDE_PLUGIN_REGISTRY: path.join(home, "plugins.json"),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: path.join(home, "gitconfig"),
          NO_COLOR: "1",
        };
        writeFileSync(
          env.AIDLC_CLAUDE_PLUGIN_REGISTRY as string,
          JSON.stringify({ version: 2, plugins: {} }),
        );
        let executable = bun;
        let prefix = [path.join(project, `.${harness}/tools/aidlc.ts`)];
        if (channel === "copy")
          cpSync(path.join(upstream, `dist/${harness}`), project, { recursive: true });
        else {
          if (!options.releaseDir)
            throw new Error("--release-dir with verified official native assets is required");
          const release = path.resolve(options.releaseDir);
          const metadata = JSON.parse(readFileSync(path.join(release, "version.json"), "utf8"));
          if (
            metadata.version !== provenance.version ||
            metadata.sourceDigest !== provenance.upstreamSha ||
            metadata.sourceRef !== `refs/tags/v${provenance.version}`
          )
            throw new Error("native release provenance mismatch");
          const asset = `aidlc-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
          const checksums = readFileSync(path.join(release, "checksums.txt"), "utf8");
          for (const file of [asset, `aidlc-runtime-${provenance.version}.tar.gz`]) {
            const checksum = checksums
              .split(/\r?\n/)
              .map((line) => line.trim().split(/\s+/))
              .find((row) => row[1] === file)?.[0];
            if (!checksum || hash(readFileSync(path.join(release, file))) !== checksum)
              throw new Error(`release checksum mismatch: ${file}`);
          }
          executable = path.join(release, asset);
          chmodSync(executable, 0o755);
          prefix = [];
          const installEnv = {
            ...env,
            PATH: cliPath.replace(
              tools,
              process.platform === "win32"
                ? path.join(
                    process.env.SystemRoot ?? "C:/Windows",
                    "System32/WindowsPowerShell/v1.0",
                  )
                : "/usr/bin",
            ),
          };
          const installed = run(
            executable,
            ["update", "--version", provenance.version, "--from", release],
            project,
            installEnv,
          );
          if (installed.code)
            throw new Error(`native install failed: ${installed.stdout}${installed.stderr}`);
          const configured = run(
            executable,
            ["config", "--harness", "claude", "--yes"],
            project,
            installEnv,
          );
          if (configured.code)
            throw new Error(`native config failed: ${configured.stdout}${configured.stderr}`);
        }
        run(git, ["init", "--quiet"], project, env);
        run(git, ["add", "aidlc"], project, env);
        const committed = run(
          git,
          [
            "-c",
            "user.name=Doctor fixture",
            "-c",
            "user.email=doctor@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "Seed isolated Doctor workspace",
          ],
          project,
          env,
        );
        if (committed.code) throw new Error(committed.stderr);
        // Since 2.11.1 a machine that never checked passes ("Update: not checked
        // yet"), so the warning scenario is an update check that went stale.
        // Since 2.11.2 Doctor prints its age, so it is a fixed age, not a date.
        writeFileSync(
          path.join(machine, "update-check.json"),
          JSON.stringify({
            schemaVersion: 1,
            checkedAt: new Date(
              Date.now() - (scenario === "warning" ? STALE_UPDATE_CHECK_MS : 0),
            ).toISOString(),
            latestVersion: provenance.version,
            releaseDate: "2026-09-15",
          }),
        );
        if (scenario === "failed")
          writeFileSync(
            path.join(project, ".claude/settings.local.json"),
            JSON.stringify({ disableAllHooks: true }),
          );
        if (scenario === "bun-path") env.DOCTOR_BASELINE_PATH = tools;
        if (scenario === "analysis-warning") {
          const seed = path.join(work, "seed.ts");
          writeFileSync(
            seed,
            `import {planFilePath} from ${JSON.stringify(pathToFileURL(path.join(project, `.${harness}/tools/aidlc-lib.ts`)).href)}; import {mkdirSync,writeFileSync} from "node:fs"; import {dirname} from "node:path"; const file=planFilePath(${JSON.stringify(project)}); mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,"invalid json");\n`,
          );
          const seeded = run(bun, [seed], project, env);
          if (seeded.code) throw new Error(seeded.stderr);
        }
        // A native project's hooks and Doctor run through the installed command,
        // whose runtime tree sits beside it; the raw release asset has none, and
        // since 2.11.2 Doctor fails every hook it cannot find beside itself.
        const command =
          channel === "native"
            ? path.join(
                machine,
                "versions",
                provenance.version,
                process.platform === "win32" ? "aidlc.exe" : "aidlc",
              )
            : executable;
        // Every scenario is a project someone has chatted in: the harness runs
        // its human-turn hook on the first message, and since 2.11 Doctor warns
        // until that hook has left a heartbeat. Run the official hook itself,
        // as the harness would, rather than writing the heartbeat by hand.
        const turn = spawnSync(command, [...prefix, "engine", "hook", "record-human-turn"], {
          cwd: project,
          env: { ...env, CLAUDE_PROJECT_DIR: project, AIDLC_PROJECT_DIR: project },
          input: JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "doctor-fixture",
            prompt: "Doctor fixture",
          }),
          encoding: "utf8",
          timeout: 120_000,
        });
        if (turn.error || turn.status !== 0)
          throw new Error(`first-message hook failed: ${turn.stderr ?? String(turn.error)}`);
        const args = [...prefix, "doctor", "--verbose", "--no-color"];
        const result = run(command, args, project, env);
        const jsonResult = run(
          command,
          [...prefix, "doctor", "--verbose", "--json", "--no-color"],
          project,
          env,
        );
        if (jsonResult.code !== result.code || jsonResult.stderr)
          throw new Error("JSON and human Doctor executions differ");
        const upstreamReport = JSON.parse(jsonResult.stdout).data;
        if (!Array.isArray(upstreamReport?.checks)) throw new Error("upstream JSON schema changed");
        // Analysis is read from the official source module: --json omits these findings.
        const analysisProbe = path.join(work, "analysis.ts");
        writeFileSync(
          analysisProbe,
          `import {runDoctorAnalysis} from ${JSON.stringify(pathToFileURL(path.join(upstream, `dist/${harness}/.${harness}/tools/aidlc-doctor-bundle.ts`)).href)}; console.log(JSON.stringify(runDoctorAnalysis(${JSON.stringify(project)}).findings));\n`,
        );
        const analysis = run(bun, [analysisProbe], project, env);
        if (analysis.code || analysis.stderr)
          throw new Error(`analysis probe failed: ${analysis.stderr}`);
        const findings = JSON.parse(analysis.stdout) as Finding[];
        if (channel === "native" && findings.some((f) => f.severity !== "info"))
          throw new Error(
            `native analysis findings require a compiled upstream oracle: ${JSON.stringify(findings)}`,
          );
        if (scenario === "analysis-warning" && !findings.some((f) => f.severity !== "info"))
          throw new Error("analysis scenario produced no extra finding");
        const expected = expectedFromUpstream(
          upstreamReport.checks,
          findings,
          result.code,
          channel === "native" ? "aidlc" : `bun .${harness}/tools/aidlc.ts`,
          fallbackFix,
        );
        const normalize = (text: string) =>
          normalizeCaptureTimes(text)
            .replaceAll(base, "<CAPTURE>")
            .replaceAll(base.replaceAll("\\", "/"), "<CAPTURE>")
            .replaceAll(bun, "<BUN>")
            .replaceAll(path.dirname(bun), "<BUN_DIR>");
        for (const check of expected.checks) {
          check.originalLabel = normalize(check.originalLabel);
          if (check.originalFix !== undefined) check.originalFix = normalize(check.originalFix);
        }
        const id = `${process.platform}-${channel}-${harness}-${scenario}`;
        const save = (suffix: string, text: string) => {
          const name = `${id}.${suffix}`;
          const normalized = normalize(text);
          writeFileSync(path.join(out, name), normalized);
          return { path: name, sha256: hash(normalized) };
        };
        const runtimeVersion = run(
          command,
          channel === "copy" ? ["--version"] : ["version"],
          project,
          env,
        );
        if (runtimeVersion.code !== 0 || runtimeVersion.stderr)
          throw new Error("runtime version probe failed");
        captures.push({
          kind: "process",
          platform: process.platform,
          channel,
          harness,
          scenario,
          ...provenance,
          generatorVersion: GENERATOR_VERSION,
          command: [
            channel === "copy" ? "bun" : "aidlc",
            ...(channel === "copy" ? [`.${harness}/tools/aidlc.ts`] : []),
            "doctor",
            "--verbose",
            "--no-color",
          ],
          runtime: {
            version: runtimeVersion.stdout.trim(),
            sha256: hash(readFileSync(command)),
          },
          code: result.code,
          stdout: save("stdout.txt", result.stdout),
          stderr: save("stderr.txt", result.stderr),
          expected: save("expected.json", `${JSON.stringify(expected, null, 2)}\n`),
        });
        console.log(`${id}: ${result.code}; ${JSON.stringify(expected.counts)}`);
      }
    }
    const candidate = {
      formatId: "human-v1",
      kind: "captured",
      upstreamSha: provenance.upstreamSha,
      sourceDigests: doctorSourceDigests(upstream),
      captures,
    };
    writeFileSync(path.join(out, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
    return candidate;
  } catch (error) {
    writeFileSync(path.join(out, "report.txt"), `${String(error)}\n`);
    throw error;
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  const upstream = value("--upstream"),
    out = value("--out");
  if (!upstream || !out)
    throw new Error(
      "usage: capture-doctor-fixtures --upstream <official checkout> --out <directory> [--release-dir <official assets>] [--copy-only]",
    );
  await captureDoctor({
    upstream,
    out,
    releaseDir: value("--release-dir"),
    channels: args.includes("--copy-only") ? ["copy"] : undefined,
  });
}
