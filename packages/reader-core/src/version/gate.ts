import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MAX_READ_BYTES } from "@aidlc-guide/core-utils";
import {
  CURRENT_STATE_VERSION,
  type VersionGate,
  type VersionGateRollback,
  versionGateRollbackCommands,
} from "@aidlc-guide/shared-types";
import { readStateVersion, STATE_FILENAME } from "../parse/state.ts";
import {
  detectHarnesses,
  findHarnessConflict,
  harnessVersionRel,
  readAllWorkspaceAidlcVersions,
  readNativeProjections,
  unreadableNativeStamps,
} from "./harness.ts";
import { inspectProjectPin, readNativeInstall } from "./native-install.ts";
import { compareReleaseIds, parseReleaseId, type ReleaseId } from "./release-id.ts";

/**
 * The single version check every surface enforces (docs/maintenance/version-gate-design.md).
 * The Guide reads only the format of the release it supports, so anything but
 * an exact match blocks. Synchronous file reads only: no process, no hashing.
 */

export type VersionGateDeps = {
  /** The engine version this machine resolves for the project. */
  readEngine?: (root: string) => string | null;
};

function defaultEngine(root: string): string | null {
  return readNativeInstall(root)?.version ?? null;
}

const named = (version: string, at: ReleaseId): string =>
  at.preview === null ? version : `プレビュー版の ${version}`;

/** The newest State Version any workflow record carries; null when none is readable. */
function newestStateVersion(root: string): number | null {
  let newest: number | null = null;
  const dirs = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => path.join(dir, entry.name));
    } catch {
      return [];
    }
  };
  for (const space of dirs(path.join(root, "aidlc", "spaces")))
    for (const record of dirs(path.join(space, "intents"))) {
      const file = path.join(record, STATE_FILENAME);
      try {
        // The same bound readState opens a record with, so every record it reads is counted.
        if (statSync(file).size > MAX_READ_BYTES) continue;
        const version = readStateVersion(readFileSync(file, "utf8"));
        if (version !== null && (newest === null || version > newest)) newest = version;
      } catch {
        // A record without a readable state says nothing about the format.
      }
    }
  return newest;
}

/**
 * The way back to `target`. Only offered, never run: going back rewrites
 * shared files, and a record already in a newer state format cannot go back.
 */
function rollbackFor(root: string, way: VersionGateRollback): VersionGateRollback {
  const state = newestStateVersion(root);
  return state !== null && state > CURRENT_STATE_VERSION
    ? { kind: "state-newer", stateVersion: state }
    : way;
}

export function inspectVersionGate(
  root: string,
  target: string,
  deps: VersionGateDeps = {},
): VersionGate {
  const detected = detectHarnesses(root).harnesses;
  const projections = readNativeProjections(root);
  const records = readAllWorkspaceAidlcVersions(root);
  const pin = inspectProjectPin(root);
  const tools = detected.map((tool) => ({
    ...tool,
    version:
      projections.find((entry) => entry.harness === tool.id)?.version ??
      records.find((entry) => entry.sourcePath === path.join(root, harnessVersionRel(tool.id)))
        ?.version ??
      null,
  }));
  const native = projections.length > 0;
  // A native project's screen always names this machine's engine, whichever
  // status it shows; null then means "not installed", never "not checked".
  const engine = native ? (deps.readEngine ?? defaultEngine)(root) : null;
  const recorded = [
    ...tools.map((tool) => tool.version),
    ...records.map((record) => record.version),
    ...(pin.version === null ? [] : [pin.version]),
  ].flatMap((version) => {
    const at = version === null ? null : parseReleaseId(version);
    return version === null || at === null ? [] : [{ version, at }];
  });
  const projectVersion =
    recorded.length === 0
      ? null
      : recorded.reduce((a, b) => (compareReleaseIds(b.at, a.at) > 0 ? b : a)).version;
  const base = { target, tools, pin: pin.version, engine, native, projectVersion, rollback: null };
  const unknown = (message: string): VersionGate => ({ ...base, status: "unknown", message });
  const newer = (version: string, at: ReleaseId, way: VersionGateRollback): VersionGate => ({
    ...base,
    status: "project-newer",
    rollback: rollbackFor(root, way),
    message:
      at.preview === null
        ? `プロジェクトの aidlc-workflows ${version} は、Andon の対応版 ${target} より新しいバージョンです。Andon を更新してください。`
        : `プロジェクトは aidlc-workflows のプレビュー版 ${version} を使っています。Andon が対応するのは安定版の ${target} だけです。安定版に対応した Andon を待つか、プロジェクトを ${target} に戻してください。`,
  });
  const wanted = parseReleaseId(target);
  if (wanted === null || wanted.preview !== null)
    return unknown(`Guide の対応版 ${target} を確認できません。`);

  // Neither is Setup's to fix. With no detected tool Doctor cannot run either,
  // so the message itself says what to change by hand before re-checking.
  if (pin.exists && pin.version === null)
    return unknown(
      `プロジェクトの固定バージョン（.aidlc-version）を読めません。ファイルを ${target} のようなバージョンだけの 1 行に直すか、Git で元に戻してから「状態を再確認」を押してください。`,
    );
  const stamps = unreadableNativeStamps(root);
  if (stamps.length > 0)
    return unknown(
      tools.length === 0
        ? `ツールの導入記録を読めません。導入が途中で止まった可能性があります。${stamps.map((file) => path.relative(root, file)).join("、")} を Git で元に戻すか削除してから、セットアップをやり直してください。`
        : "ツールの導入記録（aidlc-stamp.json）を読めません。更新が途中で止まった可能性があります。Doctor で確認してください。",
    );
  if (tools.length === 0) {
    // Version files an interrupted install left behind: Setup refuses any it
    // cannot read or that disagrees with the pin, so they are fixed first.
    const leftovers = records.filter((record) => record.version !== target);
    const newerLeftovers = leftovers.flatMap((record) => {
      const at = record.version === null ? null : parseReleaseId(record.version);
      return record.version !== null && at !== null && compareReleaseIds(at, wanted) > 0
        ? [{ version: record.version, at }]
        : [];
    });
    // Pinning back cannot fix a file a stopped install left at another version
    // (or unreadable), and Setup refuses any of them, so those come first.
    const way: VersionGateRollback =
      leftovers.length > 0
        ? {
            kind: "leftovers",
            files: leftovers.flatMap((record) =>
              record.sourcePath === null ? [] : [path.relative(root, record.sourcePath)],
            ),
          }
        : { kind: "commands", commands: versionGateRollbackCommands(target, []) };
    // Setup refuses to downgrade a newer pin, so only a Guide update helps.
    const pinAt = pin.version === null ? null : parseReleaseId(pin.version);
    if (pin.version !== null && pinAt !== null && compareReleaseIds(pinAt, wanted) > 0)
      return newer(pin.version, pinAt, way);
    const leftover = newerLeftovers[0];
    if (leftover) return newer(leftover.version, leftover.at, way);
    if (
      leftovers.length > 0 ||
      (records.length > 0 && pin.version !== null && pin.version !== target)
    )
      return unknown(
        `ツールが設定されていないのに、導入が途中で止まったと思われるファイルが残っています。${records
          .map((record) =>
            record.sourcePath === null ? "" : path.relative(root, record.sourcePath),
          )
          .filter(Boolean)
          .join("、")} を Git で元に戻すか削除してから、セットアップをやり直してください。`,
      );
    return {
      ...base,
      status: "not-installed",
      message:
        "このプロジェクトには aidlc-workflows が設定されていません。セットアップしてください。",
    };
  }
  const conflict = findHarnessConflict(detected.map((tool) => tool.id));
  if (conflict) return unknown(conflict.message);
  const versions = [
    ...tools.map((tool) => tool.version),
    ...records.map((record) => record.version),
    ...(pin.version === null ? [] : [pin.version]),
  ];
  if (versions.some((version) => version === null || parseReleaseId(version) === null))
    return unknown("バージョンを確認できないツールがあります。Doctor で確認してください。");

  const newest = recorded.reduce((a, b) => (compareReleaseIds(b.at, a.at) > 0 ? b : a));
  if (compareReleaseIds(newest.at, wanted) > 0)
    return newer(
      newest.version,
      newest.at,
      // Upstream refreshes one harness per `aidlc config` once a project has several.
      native
        ? {
            kind: "commands",
            commands: versionGateRollbackCommands(
              target,
              tools.map((tool) => tool.id),
            ),
          }
        : { kind: "copy" },
    );
  const oldest = recorded.reduce((a, b) => (compareReleaseIds(b.at, a.at) < 0 ? b : a));
  if (compareReleaseIds(oldest.at, wanted) < 0)
    return {
      ...base,
      status: "project-older",
      message: `プロジェクトの aidlc-workflows ${oldest.version} は、Andon の対応版 ${target} より古いバージョンです。プロジェクトを ${target} に更新してください。`,
    };

  // A copy-channel tree is the engine itself; only a native project runs a machine binary.
  if (!native) return { ...base, status: "ok", message: "プロジェクトは対応版です。" };
  if (engine === target)
    return { ...base, status: "ok", message: "プロジェクトとエンジンは対応版です。" };
  // An unpinned project follows this machine's default, which the person chose
  // to move ahead; pinning the project keeps both (upstream retains pinned releases).
  const engineAt = engine === null ? null : parseReleaseId(engine);
  if (
    engine !== null &&
    engineAt !== null &&
    !pin.exists &&
    compareReleaseIds(engineAt, wanted) > 0
  )
    return {
      ...base,
      status: "engine-newer",
      message: `この PC のエンジンは ${named(engine, engineAt)} で、Andon の対応版 ${target} より新しいバージョンです。このプロジェクトはバージョンを固定していないため、AI ツールも ${engine} のエンジンで動きます。プロジェクトを ${target} に固定してください。`,
    };
  return {
    ...base,
    status: "engine-mismatch",
    message:
      engine === null
        ? `この PC に aidlc-workflows ${target} のエンジンが導入されていません。この PC に ${target} を導入してください。`
        : `この PC のエンジンは ${engine} です。プロジェクトの ${target} に合わせて導入してください。`,
  };
}
