import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReadContext } from "@aidlc-guide/api-core";
import type { Bridge } from "@aidlc-guide/docs-bridge";
import type { Reader } from "@aidlc-guide/reader-core";
import {
  type ReadResult,
  type StageDoc,
  WORKFLOWS_TARGET_VERSION,
} from "@aidlc-guide/shared-types";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const CLI = path.join(REPO_ROOT, "packages", "dashboard-server", "src", "cli.ts");

/** A State-Version-8 record the reader can parse. */
export const STATE_MD = `# AI-DLC State Tracking

## Project Information
- **Project**: dashboard-server test
- **Project Type**: Greenfield
- **Scope**: feature
- **State Version**: 8

## Scope Configuration
- **Depth**: Standard
- **Test Strategy**: Standard

## Execution Plan Summary
- **Total Stages**: 3
- **Completed**: 1

## Stage Progress

### IDEATION PHASE
- [x] intent-capture — EXECUTE

### CONSTRUCTION PHASE
- [?] functional-design — EXECUTE
- [ ] code-generation — EXECUTE

## Current Status
- **Lifecycle Phase**: CONSTRUCTION
- **Current Stage**: functional-design
- **Next Stage**: code-generation
`;

/**
 * A throwaway workspace with the full cursor chain, so a spawned server
 * resolves an active intent exactly the way it would in a real checkout.
 */
/**
 * A copy-channel Claude Code harness at `version`. The server enforces the
 * version check, and a copy-channel tree needs no machine engine to pass it.
 */
export async function seedHarness(root: string, version: string): Promise<void> {
  const tools = path.join(root, ".claude", "tools");
  await mkdir(path.join(root, ".claude", "skills", "aidlc"), { recursive: true });
  await mkdir(tools, { recursive: true });
  await writeFile(path.join(root, ".claude", "skills", "aidlc", "SKILL.md"), "# aidlc\n");
  await writeFile(
    path.join(tools, "aidlc-version.ts"),
    `export const AIDLC_VERSION = "${version}";\n`,
  );
}

export async function seedWorkspace(
  version: string = WORKFLOWS_TARGET_VERSION,
): Promise<{ root: string; recordDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "dash-"));
  await seedHarness(root, version);
  const intents = path.join(root, "aidlc", "spaces", "default", "intents");
  const recordDir = path.join(intents, "260101-test-intent");
  await mkdir(recordDir, { recursive: true });
  await writeFile(path.join(intents, "active-intent"), "260101-test-intent\n");
  await writeFile(path.join(recordDir, "aidlc-state.md"), STATE_MD);
  return { root, recordDir };
}

export function ok<T>(value: T): ReadResult<T> {
  return { ok: true, value };
}

export function stageDoc(slug: string): StageDoc {
  return {
    slug,
    purpose: "purpose",
    inputs: [],
    outputs: [],
    agent: "developer-agent",
    agentDisplayName: "developer-agent",
    gateRequirement: "approve",
    deepLink: null,
    excerpt: null,
    artifactDocs: {},
    sourceVersion: "test",
  };
}

/** Only the methods a test exercises need to be supplied. */
export function stubReader(overrides: Partial<Reader> = {}): Reader {
  const unused = async (): Promise<ReadResult<never>> => ({ error: true, reason: "not-stubbed" });
  return {
    getWorkflow: unused,
    getMatrix: unused,
    getAuditEvents: unused,
    getIntents: unused,
    getNextStep: unused,
    getTimings: unused,
    getEffectiveness: unused,
    readArtifact: unused,
    watch: () => () => {},
    ...overrides,
  };
}

export function stubBridge(overrides: Partial<Bridge> = {}): Bridge {
  const unused = async (): Promise<ReadResult<never>> => ({ error: true, reason: "not-stubbed" });
  return {
    getConfig: unused,
    resolveStage: unused,
    projectLinks: unused,
    ...overrides,
  };
}

export function context(overrides: Partial<ReadContext> = {}): ReadContext {
  return {
    reader: stubReader(),
    bridge: stubBridge(),
    workspaceRoot: REPO_ROOT,
    officialDocsRoot: REPO_ROOT,
    recordDir: async () => ok("/record"),
    selected: () => null,
    matrix: () => null,
    ...overrides,
  };
}

/** Fetch a route through the handler under test with a real Request/Response. */
export function url(pathAndQuery: string): URL {
  return new URL(pathAndQuery, "http://127.0.0.1:4700");
}
