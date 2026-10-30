import type { BridgeConfig, ProjectLink, ReadResult } from "@andon/shared-types";

/**
 * D4 — the project-specific links from the config (FR-5.3).
 *
 * Validation already happened in `loadConfig`, so this is a pure read of the
 * held config. It takes `config` as an argument rather than importing
 * `config.ts`, which is what keeps the config wiring confined to `createBridge`
 * (nfr-design/logical-components.md).
 */
export function projectLinks(config: BridgeConfig): ReadResult<ProjectLink[]> {
  return { ok: true, value: config.projectLinks };
}
