import { withResult } from "@andon/core-utils";
import type { BridgeConfig, ProjectLink, ReadResult, StageDoc } from "@andon/shared-types";
import { loadConfig } from "./config.ts";
import { projectLinks } from "./links.ts";
import { resolveStage } from "./resolve.ts";

export { CONFIG_FILENAME, loadConfig } from "./config.ts";
export { readExcerpt, sliceSection, slugifyHeading } from "./excerpt.ts";
export { projectLinks } from "./links.ts";
export { parsePersonaMarkdown } from "./persona.ts";
export type {
  AgentEntry,
  AgentMap,
  ArtifactMap,
  ArtifactStageEntry,
  BridgeMap,
  StageEntry,
  StageIo,
} from "./resolve.ts";
export {
  agentEntry,
  agentMap,
  artifactDocIndex,
  artifactDocsOf,
  artifactMap,
  artifactProducerOf,
  bridgeMap,
  resolveStage,
  stageEntryOf,
  stageIoOf,
  stagesForAgent,
} from "./resolve.ts";

/** The three public methods (component-methods.md). Every one returns ReadResult. */
export interface Bridge {
  getConfig(): Promise<ReadResult<BridgeConfig>>;
  resolveStage(slug: string): Promise<ReadResult<StageDoc>>;
  projectLinks(): Promise<ReadResult<ProjectLink[]>>;
}

/**
 * The consumer-facing facade. `createBridge` is the *only* place config is
 * wired: it runs `loadConfig` once and threads the result into `resolve`/`links`
 * as an argument, so those stay pure and callers never hold a config
 * (nfr-design/logical-components.md).
 *
 * "Once" is lazy-once, not eager: construction touches no filesystem (P-DB-3 —
 * the bridge must never sit on first paint's critical path), and the first
 * method call memoises the load. A failed load is memoised too — retrying a
 * broken config on every card open would just repeat the same error.
 *
 * Every method is wrapped in `withResult`, so nothing crosses this boundary as
 * an exception (R-DB-1).
 */
export function createBridge(configPath?: string): Bridge {
  let pending: Promise<ReadResult<BridgeConfig>> | null = null;
  const config = (): Promise<ReadResult<BridgeConfig>> => {
    pending ??= withResult(() => loadConfig(configPath));
    return pending;
  };

  /** Config warnings must survive onto the method's own result (BR-DB-3). */
  const withConfig = <T>(
    use: (config: BridgeConfig) => Promise<ReadResult<T>> | ReadResult<T>,
  ): Promise<ReadResult<T>> =>
    withResult(async () => {
      const loaded = await config();
      if (!("ok" in loaded)) return loaded;
      const result = await use(loaded.value);
      if (!("ok" in result) || loaded.warnings === undefined) return result;
      return { ...result, warnings: [...loaded.warnings, ...(result.warnings ?? [])] };
    });

  return {
    getConfig: config,
    resolveStage: (slug) => withConfig((c) => resolveStage(c, slug)),
    projectLinks: () => withConfig((c) => projectLinks(c)),
  };
}
