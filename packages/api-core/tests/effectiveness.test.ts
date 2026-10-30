import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EffectivenessPayload, ReadResult } from "@andon/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRead, routeRead } from "../src/handlers/read.ts";
import { createGuideService } from "../src/service.ts";

const STATE = `# AI-DLC State Tracking
## Project Information
- **Project**: Metrics test
- **Scope**: feature
- **State Version**: 8
## Scope Configuration
- **Depth**: Standard
## Execution Plan Summary
- **Total Stages**: 1
- **Completed**: 1
## Stage Progress
### IDEATION PHASE
- [x] intent-capture — EXECUTE
## Current Status
- **Status**: Completed
- **Lifecycle Phase**: IDEATION
- **Current Stage**: none
- **Next Stage**: none
`;

const AUDIT = [
  ["WORKFLOW_STARTED", "00:00", "**Request**: private prompt"],
  ["STAGE_STARTED", "00:00", "**Stage**: intent-capture"],
  ["STAGE_AWAITING_APPROVAL", "04:00", "**Stage**: intent-capture"],
  ["GATE_APPROVED", "05:00", "**Stage**: intent-capture\n**User Input**: private answer"],
  ["WORKFLOW_COMPLETED", "05:00", ""],
]
  .map(
    ([event, minute, fields]) =>
      `**Event**: ${event}\n**Timestamp**: 2026-09-01T10:${minute}Z\n${fields}\n`,
  )
  .join("\n---\n\n");

describe("GET /api/effectiveness", () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function workspace(names: string[] = []): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "effectiveness-api-"));
    roots.push(root);
    for (const name of names) {
      const record = path.join(root, "aidlc", "spaces", "default", "intents", name);
      await mkdir(path.join(record, "audit"), { recursive: true });
      await writeFile(path.join(record, "aidlc-state.md"), STATE);
      await writeFile(path.join(record, "audit", "test.md"), AUDIT);
    }
    return root;
  }

  it("returns space-wide measurements without requiring or changing the view pin", async () => {
    const root = await workspace(["a-intent", "b-intent"]);
    const service = createGuideService({ versionGate: null, workspaceRoot: root,  });
    const result = await routeRead(
      service.readContext,
      new URL("http://localhost/api/effectiveness"),
    );
    expect(result?.status).toBe(200);
    const body = result?.body as ReadResult<EffectivenessPayload>;
    expect("ok" in body).toBe(true);
    if (!("ok" in body)) throw new Error("expected measurements");
    expect(body.value.intents.map((row) => row.dirName)).toEqual(["a-intent", "b-intent"]);
    expect(body.value.intents[0]).toMatchObject({
      scope: "feature",
      depth: "Standard",
      completionMs: 300_000,
      approvalWait: { completedMs: 60_000, completedIntervals: 1 },
      reviews: null,
      usage: null,
    });
    expect(service.readContext.selected()).toBeNull();
    expect(JSON.stringify(body)).not.toContain("private prompt");
    expect(JSON.stringify(body)).not.toContain("private answer");
    expect(JSON.stringify(body)).not.toContain(root);
    const intents = path.join(root, "aidlc", "spaces", "default", "intents");
    expect(existsSync(path.join(intents, "active-intent"))).toBe(false);
    expect(await readFile(path.join(intents, "a-intent", "audit", "test.md"), "utf8")).toBe(AUDIT);
    expect(await readFile(path.join(intents, "a-intent", "aidlc-state.md"), "utf8")).toBe(STATE);
  });

  it("serves an empty workspace over HTTP as an empty dataset", async () => {
    const root = await workspace();
    const service = createGuideService({ versionGate: null, workspaceRoot: root });
    const response = await handleRead(
      service.readContext,
      new URL("http://localhost/api/effectiveness"),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      ok: true,
      value: { space: "default", intents: [] },
    });
  });
  it("exposes missing wait evidence and excludes unassigned human inputs with diagnostics", async () => {
    const root = await workspace(["a-intent"]);
    const audit =
      AUDIT.replace(
        "**Event**: STAGE_AWAITING_APPROVAL",
        "**Recovered**: true\n**Event**: STAGE_AWAITING_APPROVAL",
      ) +
      "\n---\n**Event**: HUMAN_TURN\n**Timestamp**: 2026-09-01T10:01:00Z\n**Session**: private-session\n";
    await writeFile(path.join(root, "aidlc/spaces/default/intents/a-intent/audit/test.md"), audit);
    const service = createGuideService({ versionGate: null, workspaceRoot: root });
    const response = await handleRead(
      service.readContext,
      new URL("http://localhost/api/effectiveness"),
    );
    const body = await response?.json();
    expect(body).toMatchObject({
      value: {
        intents: [
          {
            completionMs: 300_000,
            humanTurns: null,
            approvalWait: {
              completedMs: null,
              pendingMs: null,
              completedIntervals: 0,
              pendingIntervals: 0,
              excludedIntervals: 2,
            },
            warnings: expect.arrayContaining(["human turns without workflow attribution excluded"]),
          },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-session");
  });
  it("returns unavailable sensors and diagnostics for uncorrelatable receipts", async () => {
    const root = await workspace(["a-intent"]);
    await writeFile(
      path.join(root, "aidlc/spaces/default/intents/a-intent/audit/test.md"),
      `${AUDIT}\n---\n**Event**: SENSOR_PASSED\n**Timestamp**: 2026-09-01T10:01:00Z\n**Sensor ID**: linter\n`,
    );
    const service = createGuideService({ versionGate: null, workspaceRoot: root });
    const response = await handleRead(
      service.readContext,
      new URL("http://localhost/api/effectiveness"),
    );
    expect(await response?.json()).toMatchObject({
      value: {
        intents: [{ sensors: null, warnings: ["sensor receipt missing correlation fields"] }],
      },
    });
  });
  it("withholds existing audited usage from host clients when tracking is disabled", async () => {
    const root = await workspace(["a-intent"]);
    await writeFile(
      path.join(root, "aidlc/spaces/default/intents/a-intent/audit/test.md"),
      `${AUDIT}\n**Tokens In**: 100\n**Tokens Out**: 20\n**Cache Read**: 50\n**Cache Write**: 10\n**Cost USD**: 0.25\n`,
    );
    const service = createGuideService({ versionGate: null, workspaceRoot: root,  });
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "0");
    const enabled = await handleRead(
      service.readContext,
      new URL("http://localhost/api/effectiveness"),
    );
    expect(await enabled?.json()).toMatchObject({
      value: { intents: [{ usage: { inputTokens: 100 } }] },
    });
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "1");
    const disabled = await handleRead(
      service.readContext,
      new URL("http://localhost/api/effectiveness"),
    );
    expect(await disabled?.json()).toMatchObject({
      value: { intents: [{ usage: null, completionMs: 300_000 }] },
    });
  });

  it.each(["aidlc.settings.json", "aidlc.settings.local.json"])(
    "withholds host usage when disabled in %s",
    async (file) => {
      const root = await workspace(["a-intent"]);
      vi.stubEnv("AIDLC_INSTALL_ROOT", path.join(root, "machine"));
      vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", undefined);
      await writeFile(
        path.join(root, file),
        JSON.stringify({
          schemaVersion: 1,
          flags: { schemaVersion: 1, bypasses: ["AIDLC_DISABLE_USAGE_TRACKING"] },
        }),
      );
      await writeFile(
        path.join(root, "aidlc/spaces/default/intents/a-intent/audit/test.md"),
        `${AUDIT}\n**Tokens In**: 100\n**Tokens Out**: 20\n**Cache Read**: 50\n**Cache Write**: 10\n**Cost USD**: 0.25\n`,
      );
      const service = createGuideService({ versionGate: null, workspaceRoot: root,  });
      const response = await handleRead(
        service.readContext,
        new URL("http://localhost/api/effectiveness"),
      );
      expect(await response?.json()).toMatchObject({
        value: {
          intents: [{ usage: null, completionMs: 300_000 }],
          warnings: ["usage tracking disabled; token and cost data withheld"],
        },
      });
    },
  );
  it("does not add audit aggregation to the initial workflow response", async () => {
    const root = await workspace(["a-intent"]);
    const service = createGuideService({ versionGate: null, workspaceRoot: root, initialSelected: "a-intent" });
    service.reader.getEffectiveness = async () => {
      throw new Error("must remain lazy");
    };
    const result = await routeRead(service.readContext, new URL("http://localhost/api/workflow"));
    expect(result?.status).toBe(200);
    expect(result?.body).not.toHaveProperty("effectiveness");
  });
});
