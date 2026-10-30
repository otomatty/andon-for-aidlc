import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { canonicalPathSync } from "@andon/core-utils";
import { isReleaseId } from "./release-id.ts";

/**
 * Read-only view of the machine's native aidlc install. Writing it (install,
 * `use`, pin) stays in the VS Code extension; this module only resolves which
 * engine a project would run.
 */

export type NativeInstall = { executable: string; version: string; binDir: string };

export type ProjectPinState = {
  exists: boolean;
  version: string | null;
};

export function installLocations(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): { root: string; binDir: string } {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const root =
    env.AIDLC_INSTALL_ROOT ||
    (platform === "win32"
      ? paths.join(env.LOCALAPPDATA || paths.join(home, "AppData", "Local"), "aidlc")
      : paths.join(env.XDG_DATA_HOME || paths.join(home, ".local", "share"), "aidlc"));
  return {
    root,
    binDir:
      env.AIDLC_BIN_DIR ||
      (platform === "win32" ? paths.join(root, "bin") : paths.join(home, ".local", "bin")),
  };
}

/** Resolve the active binary, or a registered project pin, within the machine install. */
export function readNativeInstall(projectRoot?: string): NativeInstall | null {
  const { root, binDir } = installLocations();
  try {
    // v2.8.1's stable launcher starts the active binary before dispatching a project pin.
    // A retained pin alone cannot make the normal `aidlc` command usable.
    const executable = readFileSync(path.join(root, "active-executable"), "utf8").trim();
    const version = path.basename(path.dirname(executable));
    const expected = path.join(
      root,
      "versions",
      version,
      process.platform === "win32" ? "aidlc.exe" : "aidlc",
    );
    if (
      !isReleaseId(version) ||
      !path.isAbsolute(executable) ||
      !existsSync(expected) ||
      canonicalPathSync(executable) !== canonicalPathSync(expected)
    )
      return null;
    if (!statSync(expected).isFile()) return null;
    if (process.platform !== "win32") accessSync(expected, constants.X_OK);
    if (projectRoot && existsSync(path.join(projectRoot, ".aidlc-version"))) {
      const pinned = readFileSync(path.join(projectRoot, ".aidlc-version"), "utf8").trim();
      if (!isReleaseId(pinned)) return null;
      const pinnedExecutable = path.join(root, "versions", pinned, path.basename(expected));
      const target = readFileSync(
        path.join(projectRoot, "aidlc", ".aidlc-sessions", "pin-target"),
        "utf8",
      );
      if (!/^[^\r\n]+\r?\n?$/.test(target)) return null;
      const targetPath = target.replace(/\r?\n$/, "");
      if (
        !path.isAbsolute(targetPath) ||
        canonicalPathSync(targetPath) !== canonicalPathSync(pinnedExecutable) ||
        !statSync(pinnedExecutable).isFile()
      )
        return null;
      if (process.platform !== "win32") accessSync(pinnedExecutable, constants.X_OK);
      const registry: unknown = JSON.parse(readFileSync(path.join(root, "pins.json"), "utf8"));
      if (!registry || typeof registry !== "object" || Array.isArray(registry)) return null;
      const projectPath = canonicalPathSync(projectRoot);
      const registered = Object.entries(registry).filter(([candidate]) => {
        try {
          return canonicalPathSync(candidate) === projectPath;
        } catch {
          return false;
        }
      });
      if (registered.length === 0 || registered.some(([, value]) => value !== pinned)) return null;
      return { executable: canonicalPathSync(pinnedExecutable), version: pinned, binDir };
    }
    return { executable: canonicalPathSync(expected), version, binDir };
  } catch {
    return null;
  }
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code: unknown }).code === "ENOENT"
  );
}

export function inspectProjectPin(root: string): ProjectPinState {
  try {
    const pinned = readFileSync(path.join(root, ".aidlc-version"), "utf8").trim();
    // A preview id is a version, not a broken file; the gate decides what to do with it.
    return { exists: true, version: isReleaseId(pinned) ? pinned : null };
  } catch (cause) {
    return { exists: !isMissingFile(cause), version: null };
  }
}
