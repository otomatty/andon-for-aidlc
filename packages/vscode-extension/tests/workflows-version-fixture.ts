import { WORKFLOWS_TARGET_VERSION } from "@andon/shared-types";

/** Ordering fixture, not a historical release. Remains newer when the target changes. */
export const NEWER_WORKFLOWS_VERSION = WORKFLOWS_TARGET_VERSION.replace(
  /^(\d+)\.(\d+)\.\d+$/,
  (_, major: string, minor: string) => `${major}.${Number(minor) + 1}.0`,
);
