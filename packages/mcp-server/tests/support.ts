import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Reader } from "@andon/reader-core";
import {
  type NextStep,
  type ReadResult,
  type WorkflowModel,
  WORKFLOWS_TARGET_VERSION,
} from "@andon/shared-types";
import { expect } from "vitest";
import { type ToolReply, toContent } from "../src/render.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const CLI = path.join(here, "..", "src", "index.ts");

/** Same pin as `.github/workflows/check.yml` for clones without active-intent. */
export function liveActiveIntent(): string {
  return process.env.AIDLC_ACTIVE_INTENT?.trim() || "260730-docs-i18n";
}

const SMOKE_STATE_MD = `# AI-DLC State Tracking

## Project Information
- **Project**: mcp-server smoke
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
 * A throwaway workspace the spawned server may serve: a copy-channel Claude
 * Code harness at `version` (it needs no machine engine to pass the version
 * check) and one record. Pass an older version to see every tool refuse.
 */
export async function seedWorkspace(version: string = WORKFLOWS_TARGET_VERSION): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "aidlc-mcp-"));
  await mkdir(path.join(root, ".claude", "skills", "aidlc"), { recursive: true });
  await mkdir(path.join(root, ".claude", "tools"), { recursive: true });
  await writeFile(path.join(root, ".claude", "skills", "aidlc", "SKILL.md"), "# aidlc\n");
  await writeFile(
    path.join(root, ".claude", "tools", "aidlc-version.ts"),
    `export const AIDLC_VERSION = "${version}";\n`,
  );
  const intents = path.join(root, "aidlc", "spaces", "default", "intents");
  const record = path.join(intents, "260101-smoke");
  await mkdir(record, { recursive: true });
  await writeFile(path.join(intents, "active-intent"), "260101-smoke\n");
  await writeFile(path.join(record, "aidlc-state.md"), SMOKE_STATE_MD);
  return root;
}

/** An absolute root that is never touched — the stubs stand in for all I/O. */
export const ROOT = path.resolve(path.sep === "\\" ? "C:\\ws\\aidlc-guide" : "/ws/aidlc-guide");

const NOT_CALLED = (name: string) => () => {
  throw new Error(`${name} must not be called by this tool`);
};

export function stubReader(overrides: Partial<Reader> = {}): Reader {
  return {
    getWorkflow: NOT_CALLED("getWorkflow"),
    getMatrix: NOT_CALLED("getMatrix"),
    getAuditEvents: NOT_CALLED("getAuditEvents"),
    getIntents: NOT_CALLED("getIntents"),
    getNextStep: NOT_CALLED("getNextStep"),
    getTimings: NOT_CALLED("getTimings"),
    getEffectiveness: NOT_CALLED("getEffectiveness"),
    readArtifact: NOT_CALLED("readArtifact"),
    watch: NOT_CALLED("watch"),
    ...overrides,
  } as Reader;
}

/** Shorthands for the three `ReadResult` branches. */
export const ok = <T>(value: T, warnings?: string[]): ReadResult<T> => ({
  ok: true,
  value,
  ...(warnings === undefined ? {} : { warnings }),
});
export const unsupported = (version: string): ReadResult<never> => ({ unsupported: true, version });
export const failed = (reason: string): ReadResult<never> => ({ error: true, reason });

/**
 * BR-MS-3: whatever the branch, the reply must leave as an ORDINARY MCP
 * response — never `isError`, never an empty body the AI cannot act on.
 */
export function expectNormalReply(reply: ToolReply): ToolReply {
  const result = toContent(reply);
  expect(result).not.toHaveProperty("isError");
  expect(result.content[0]?.type).toBe("text");
  expect(reply.text.length).toBeGreaterThan(0);
  return reply;
}

export const WORKFLOW: WorkflowModel = {
  project: "Andon",
  scope: "mvp",
  depth: "practical",
  stateVersion: 8,
  phase: "CONSTRUCTION",
  currentStage: "code-generation",
  nextStage: "build-and-test",
  gate: "awaiting-approval",
  stages: [],
  done: 21,
  total: 33,
};

export const NEXT_STEP: NextStep = {
  nextStage: "build-and-test",
  requirement: "build-and-test: 未着手 — 実行を開始してください",
};

