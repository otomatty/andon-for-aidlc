import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { guardPath, readBounded } from "@andon/core-utils";
import { detectHarnesses, harnessVersionRel } from "../version/harness.ts";
import { validUsageSettings } from "./settings-schema.ts";
import { objectOf } from "./usage.ts";

const USAGE_FLAG = "AIDLC_DISABLE_USAGE_TRACKING";

/**
 * The switches recorded in any settings layer, or null when a layer cannot be
 * read (2.11: a bypass is on while any layer records it).
 */
async function recordedBypasses(root: string): Promise<{ layer: string } | Set<string>> {
  const explicit = process.env.AIDLC_INSTALL_ROOT?.trim();
  const machine = explicit
    ? resolve(explicit)
    : process.platform === "win32"
      ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "aidlc")
      : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "aidlc");
  const bypasses = new Set<string>();
  for (const [directory, file, layer] of [
    [machine, "aidlc.settings.json", "machine"],
    [root, "aidlc.settings.json", "project"],
    [root, "aidlc.settings.local.json", "local"],
  ] as const) {
    try {
      const guarded = await guardPath(directory, file);
      if (!("ok" in guarded)) throw new Error("settings outside root");
      // readBounded maps every stat failure to not-found; only ENOENT means an absent layer.
      await stat(guarded.value);
      const read = await readBounded(guarded.value, 64 * 1024);
      if (!read?.ok) throw new Error("unreadable settings");
      const settings: unknown = JSON.parse(read.value);
      if (!validUsageSettings(settings, layer)) throw new Error("invalid settings");
      if (settings.flags === undefined || settings.flags === null) continue;
      const flags = objectOf(settings.flags);
      if (flags?.schemaVersion !== 1) throw new Error("unsupported flags");
      if (flags.bypasses === undefined) continue;
      if (!Array.isArray(flags.bypasses) || flags.bypasses.some((flag) => typeof flag !== "string"))
        throw new Error("invalid bypasses");
      // A nearer file adds switches and never turns back on a check another
      // file switched off.
      for (const flag of flags.bypasses) bypasses.add(flag);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return { layer };
    }
  }
  return bypasses;
}

/** Resolve the usage flag like aidlc-settings / resolveProjectFlag, without running workspace code. */
export async function usageTrackingDisabled(root: string, warnings: string[]): Promise<boolean> {
  if (Object.hasOwn(process.env, USAGE_FLAG)) return process.env[USAGE_FLAG] === "1";
  const bypasses = await recordedBypasses(root);
  if (!(bypasses instanceof Set)) {
    warnings.push(`${bypasses.layer} usage settings unavailable; token and cost data withheld`);
    return true;
  }
  return bypasses.has(USAGE_FLAG);
}

const PLAN_APPROVAL_FLAG = "AIDLC_DISABLE_PLAN_APPROVAL_GUARD";

/**
 * The machine switch that turns plan approval off over everything else
 * (v2.11.0 resolvePlanApprovalSetting). The reader sees its own environment and
 * the settings files, not the environment the agent was started with; an
 * unreadable layer keeps the stop predicted.
 */
export async function planApprovalSwitchedOff(root: string): Promise<boolean> {
  if (Object.hasOwn(process.env, PLAN_APPROVAL_FLAG))
    return process.env[PLAN_APPROVAL_FLAG] === "1";
  const bypasses = await recordedBypasses(root);
  return bypasses instanceof Set && bypasses.has(PLAN_APPROVAL_FLAG);
}

/** The 2.11.0 scopes whose definition turns plan approval off, for a workspace without scope files. */
const SHIPPED_PLAN_APPROVAL_OFF = new Set(["express", "poc"]);
const SCOPE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const PLAN_APPROVAL_LINE = /^plan_approval:\s*(on|off)\s*$/m;

/**
 * The scope's plan-approval default, used when the intent records none (a
 * record from before 2.11) or an unreadable line, as the engine's
 * resolveCeremony does. Read from the first configured tool's scope file;
 * without one, the shipped 2.11.0 scopes decide, and an unknown scope is on.
 */
export async function scopePlanApprovalDefault(root: string, scope: string): Promise<"on" | "off"> {
  const name = scope.trim().toLowerCase();
  if (!SCOPE_NAME.test(name)) return "on";
  for (const { id } of detectHarnesses(root).harnesses) {
    const scopes = join(dirname(dirname(harnessVersionRel(id))), "scopes");
    try {
      const guarded = await guardPath(root, join(scopes, `aidlc-${name}.md`));
      if (!("ok" in guarded)) continue;
      const read = await readBounded(guarded.value, 64 * 1024);
      if (!read?.ok) continue;
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read.value)?.[1];
      if (front === undefined) continue;
      return (PLAN_APPROVAL_LINE.exec(front)?.[1] as "on" | "off" | undefined) ?? "on";
    } catch {
      continue;
    }
  }
  return SHIPPED_PLAN_APPROVAL_OFF.has(name) ? "off" : "on";
}
