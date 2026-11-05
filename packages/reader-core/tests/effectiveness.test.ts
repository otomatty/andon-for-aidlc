import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveEffectiveness } from "../src/effectiveness/derive.ts";
import { parseMeasurementEvents, sortMeasurementEvents } from "../src/effectiveness/events.ts";
import { getEffectiveness } from "../src/effectiveness/read.ts";
import { auditUsageSummary, ledgerUsage, selectUsage } from "../src/effectiveness/usage.ts";

const BASE = Date.parse("2026-09-01T00:00:00Z");
function block(event: string, second: number, fields: Record<string, string> = {}): string {
  return [
    "---",
    `**Event**: ${event}`,
    `**Timestamp**: ${new Date(BASE + second * 1000).toISOString()}`,
    ...Object.entries(fields).map(([k, v]) => `**${k}**: ${v}`),
    "",
  ].join("\n");
}
function events(...blocks: string[]) {
  return sortMeasurementEvents(parseMeasurementEvents(blocks.join("\n"), "a.md").events);
}
const stage = { Stage: "code-generation" };
const reviewFields = { ...stage, Reviewer: "quality", Iteration: "1" };
const sensorFields = {
  "Stage slug": "build-and-test",
  "Sensor ID": "linter",
  "Fire id": "12345678",
};
const usageFields = {
  ...stage,
  "Tokens In": "100",
  "Tokens Out": "20",
  "Cache Read": "50",
  "Cache Write": "10",
  "Cost USD": "0.25",
};

describe("effectiveness evidence aggregation", () => {
  it("retains only measurement fields, removes standalone runs and accepts historical identical timestamps", () => {
    const text =
      block("STAGE_STARTED", 0, {
        ...stage,
        Feedback: "private",
        "User Input": "private",
        Timestamp: new Date(BASE).toISOString(),
      }) + block("STAGE_COMPLETED", 1, { ...stage, Workflow: "single-stage:code-generation" });
    const parsed = parseMeasurementEvents(text, "a");
    expect(parsed.events).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain("private");
    expect(parsed.warnings).toEqual([]);
  });
  it("rejects malformed/conflicting audit evidence with bounded warning categories", () => {
    const parsed = parseMeasurementEvents(
      block("STAGE_STARTED", 0, { Timestamp: "invalid" }) +
        "\n**Event**: WORKFLOW_COMPLETED\n**Timestamp**: broken",
      "bad",
    );
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.events).toHaveLength(0);
    const conflicting = parseMeasurementEvents(
      block("STAGE_STARTED", 0, { Timestamp: new Date(BASE + 1000).toISOString() }),
      "one-block",
    );
    expect(conflicting.events).toHaveLength(0);
    expect(conflicting.warnings.join(" ")).toContain("conflicting audit field");
  });
  it("calculates complete lead time and excludes missing evidence from measured zeros", () => {
    const row = deriveEffectiveness(
      events(block("WORKFLOW_STARTED", 0), block("WORKFLOW_COMPLETED", 100)),
      BASE + 200_000,
    );
    expect(row.completionMs).toBe(100_000);
    expect(row.elapsedMs).toBe(100_000);
    expect(row.approvalWait).toBeNull();
    expect(row.rejections).toBeNull();
    expect(row.humanTurns).toBeNull();
    expect(row.reviews).toBeNull();
    expect(row.sensors).toBeNull();
    expect(deriveEffectiveness([], BASE).elapsedMs).toBeNull();
  });
  it("excludes unassigned isolated invocations and Q&A without guessing from adjacent events", () => {
    const parsed = parseMeasurementEvents(
      [
        block("WORKFLOW_STARTED", 0, { Workflow: "work.one" }),
        block("HUMAN_TURN", 1, { Session: "private-session", Prompt: "private invocation" }),
        block("STAGE_STARTED", 2, { ...stage, Workflow: "single-stage:code-generation" }),
        block("HUMAN_TURN", 3, { Session: "private-session" }),
        // A main-workflow input can occur concurrently with the isolated stage.
        block("HUMAN_TURN", 3, { Workflow: "work.one", Session: "private-session" }),
        block("STAGE_COMPLETED", 4, { ...stage, Workflow: "single-stage:code-generation" }),
        block("HUMAN_TURN", 5),
        block("HUMAN_TURN", 6, { Workflow: "single-stage:code-generation" }),
      ].join("\n"),
      "a",
    );
    expect(deriveEffectiveness(parsed.events, BASE + 10_000).humanTurns).toBe(1);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.warnings).toContain("human turns without workflow attribution excluded");
    expect(JSON.stringify(parsed)).not.toContain("private");
    const legacy = parseMeasurementEvents(block("HUMAN_TURN", 0), "b");
    expect(deriveEffectiveness(legacy.events, BASE).humanTurns).toBeNull();
    expect(legacy.warnings).toHaveLength(1);
  });
  it.each([
    ["recovered opening", [block("STAGE_AWAITING_APPROVAL", 0, { ...stage, Recovered: "true" })]],
    ["orphan resolution", [block("GATE_APPROVED", 1, stage)]],
    ["jumped opening", [block("STAGE_AWAITING_APPROVAL", 0, stage), block("STAGE_JUMPED", 1)]],
  ])("leaves excluded-only approval durations unrecorded: %s", (_name, blocks) => {
    const row = deriveEffectiveness(events(...blocks), BASE + 10_000);
    expect(row.approvalWait).toMatchObject({
      completedMs: null,
      pendingMs: null,
      completedIntervals: 0,
      pendingIntervals: 0,
    });
    expect(row.approvalWait?.excludedIntervals).toBeGreaterThan(0);
    expect(row.warnings.join(" ")).toContain("trustworthy");
  });
  it("preserves measured zero-length pairs and separates still-open waits", () => {
    const paired = deriveEffectiveness(
      events(block("STAGE_AWAITING_APPROVAL", 0, stage), block("GATE_APPROVED", 0, stage)),
      BASE,
    );
    expect(paired.approvalWait).toMatchObject({
      completedMs: 0,
      pendingMs: null,
      completedIntervals: 1,
    });
    const pending = deriveEffectiveness(events(block("STAGE_AWAITING_APPROVAL", 0, stage)), BASE);
    expect(pending.approvalWait).toMatchObject({
      completedMs: null,
      pendingMs: 0,
      completedIntervals: 0,
      pendingIntervals: 1,
    });
  });
  it("unions overlapping unit waits and preserves opening across revalidation", () => {
    const row = deriveEffectiveness(
      events(
        block("STAGE_AWAITING_APPROVAL", 0, { ...stage, Unit: "a" }),
        block("STAGE_AWAITING_APPROVAL", 10, { ...stage, Unit: "b" }),
        block("STAGE_AWAITING_APPROVAL", 20, { ...stage, Unit: "a", Revalidated: "true" }),
        block("GATE_APPROVED", 30, { ...stage, Unit: "a" }),
        block("GATE_REJECTED", 40, { ...stage, Unit: "b" }),
        block("STAGE_REVISING", 40, { ...stage, Unit: "b" }),
        block("STAGE_AWAITING_APPROVAL", 50, { ...stage, Unit: "b" }),
      ),
      BASE + 60_000,
    );
    expect(row.approvalWait).toEqual({
      completedMs: 40_000,
      pendingMs: 10_000,
      completedIntervals: 2,
      pendingIntervals: 1,
      excludedIntervals: 0,
    });
    expect(row.rejections).toBe(1);
    expect(row.revisions).toBe(1);
  });
  it("excludes recovered, ambiguous, skipped and jumped gate intervals", () => {
    const parsed = events(
      block("STAGE_AWAITING_APPROVAL", 0, { ...stage, Recovered: "true" }),
      block("GATE_APPROVED", 1, stage),
      block("STAGE_AWAITING_APPROVAL", 2, stage),
      block("STAGE_JUMPED", 3, { Target: "build-and-test" }),
      block("STAGE_AWAITING_APPROVAL", 4, stage),
      block("STAGE_SKIPPED", 5, stage),
    );
    const row = deriveEffectiveness(parsed, BASE + 10_000);
    expect(row.approvalWait?.pendingIntervals).toBe(0);
    expect(row.approvalWait?.excludedIntervals).toBeGreaterThan(0);
    const tied = [
      ...parseMeasurementEvents(block("STAGE_AWAITING_APPROVAL", 0, stage), "a").events,
      ...parseMeasurementEvents(block("GATE_APPROVED", 0, stage), "b").events,
    ];
    expect(deriveEffectiveness(tied, BASE + 1000).approvalWait).toBeNull();
  });
  it.each(["STAGE_JUMPED", "GATE_APPROVED", "BOLT_STARTED", "WORKFLOW_STARTED"])(
    "does not infer cross-clone ordering for an equal-time %s",
    (event) => {
      for (const [openingShard, resetShard] of [
        ["a", "z"],
        ["z", "a"],
      ]) {
        const tied = sortMeasurementEvents([
          ...parseMeasurementEvents(
            block("STAGE_AWAITING_APPROVAL", 1, stage),
            openingShard as string,
          ).events,
          ...parseMeasurementEvents(block(event, 1, stage), resetShard as string).events,
        ]);
        for (const now of [BASE + 10_000, BASE + 100_000]) {
          const row = deriveEffectiveness(tied, now);
          expect(row.approvalWait).toBeNull();
          expect(row.auditEventCount).toBeNull();
          expect(row.warnings).toContain(
            "cross-shard lifecycle timestamp ties; audit measurements withheld",
          );
        }
      }
    },
  );
  it("measures paired first reviews separately from later review iterations", () => {
    const row = deriveEffectiveness(
      events(
        block("REVIEW_REQUESTED", 0, { ...reviewFields, "Artifact Fingerprint": "sha256:a" }),
        block("REVIEW_COMPLETED", 1, {
          ...reviewFields,
          Verdict: "NOT-READY",
          "Request Fingerprint": "sha256:a",
        }),
        block("REVIEW_REQUESTED", 2, { ...reviewFields, Iteration: "2" }),
        block("REVIEW_COMPLETED", 3, { ...reviewFields, Iteration: "2", Verdict: "READY" }),
        block("REVIEW_COMPLETED", 4, { ...reviewFields, Iteration: "2", Verdict: "READY" }),
      ),
      BASE + 10_000,
    );
    expect(row.reviews).toMatchObject({
      completed: 2,
      firstPassTotal: 1,
      firstPassReady: 0,
      firstPassRate: 0,
    });
  });
  it.each([
    ["request-a", "request-b"],
    ["request-a", undefined],
    [undefined, "request-a"],
  ])("does not pair review request id %s with completion id %s", (requested, completed) => {
    const row = deriveEffectiveness(
      events(
        block("REVIEW_REQUESTED", 0, {
          ...reviewFields,
          ...(requested ? { "Request Id": requested } : {}),
        }),
        block("REVIEW_COMPLETED", 1, {
          ...reviewFields,
          Verdict: "READY",
          ...(completed ? { "Request Id": completed } : {}),
        }),
      ),
      BASE + 10_000,
    );
    expect(row.reviews).toMatchObject({ completed: 0, ready: 0, firstPassRate: null });
    expect(row.reviews?.unmatched).toBeGreaterThan(0);
  });
  it("matches retried iteration ids and uses the upstream completion fingerprint fallback", () => {
    const rows = events(
      block("REVIEW_REQUESTED", 0, {
        ...reviewFields,
        "Request Id": "a",
        "Artifact Fingerprint": "hash",
      }),
      block("REVIEW_COMPLETED", 1, {
        ...reviewFields,
        "Request Id": "a",
        "Artifact Fingerprint": "hash",
        Verdict: "NOT-READY",
      }),
      block("REVIEW_REQUESTED", 2, {
        ...reviewFields,
        "Request Id": "b",
        "Artifact Fingerprint": "hash",
      }),
      block("REVIEW_COMPLETED", 3, {
        ...reviewFields,
        "Request Id": "b",
        "Request Fingerprint": "hash",
        Verdict: "READY",
      }),
      block("REVIEW_COMPLETED", 4, {
        ...reviewFields,
        "Request Id": "b",
        "Request Fingerprint": "hash",
        Verdict: "READY",
      }),
    );
    expect(rows[0]?.fields["Request Id"]).toBe("a");
    expect(deriveEffectiveness(rows, BASE + 10_000).reviews).toMatchObject({
      completed: 2,
      ready: 1,
      notReady: 1,
      firstPassTotal: 1,
      firstPassReady: 0,
      unmatched: 0,
    });
  });
  it.each([{ Unit: "other" }, { "Attempt Generation": "2" }, { Workflow: "other" }])(
    "does not pair an id across different review scopes: %j",
    (other) => {
      const fields = {
        ...reviewFields,
        Unit: "one",
        Workflow: "main",
        "Attempt Generation": "1",
        "Request Id": "same",
      };
      const result = deriveEffectiveness(
        events(
          block("REVIEW_REQUESTED", 0, fields),
          block("REVIEW_COMPLETED", 1, { ...fields, ...other, Verdict: "READY" }),
        ),
        BASE + 10_000,
      );
      expect(result.reviews?.completed).toBe(0);
    },
  );
  it.each([
    ["Request Source Fingerprint", "missing"],
    ["Request Source Fingerprint", "mismatched"],
    ["Source Fingerprint", "missing"],
    ["Source Fingerprint", "mismatched"],
    ["Unit Source Fingerprint", "missing"],
    ["Unit Source Fingerprint", "mismatched"],
  ])("excludes a review with %s %s without consuming its request", (field, failure) => {
    const request = {
      ...reviewFields,
      Unit: "unit-alpha",
      "Request Id": `review:${"a".repeat(32)}`,
      "Artifact Fingerprint": `sha256:${"a".repeat(64)}`,
      "Source Fingerprint": "b".repeat(64),
      "Unit Source Fingerprint": `sha256:${"c".repeat(64)}`,
    };
    const completion = {
      ...request,
      Verdict: "READY",
      "Request Fingerprint": request["Artifact Fingerprint"],
      "Request Source Fingerprint": request["Source Fingerprint"],
    };
    const invalid: Record<string, string> = { ...completion };
    if (failure === "missing") delete invalid[field];
    else invalid[field] = `sha256:${"d".repeat(64)}`;
    const history = [block("REVIEW_REQUESTED", 0, request), block("REVIEW_COMPLETED", 1, invalid)];
    expect(deriveEffectiveness(events(...history), BASE + 10_000).reviews).toEqual({
      completed: 0,
      ready: 0,
      notReady: 0,
      firstPassTotal: 0,
      firstPassReady: 0,
      firstPassRate: null,
      unmatched: 2,
    });
    const valid = deriveEffectiveness(
      events(...history, block("REVIEW_COMPLETED", 2, completion)),
      BASE + 10_000,
    );
    expect(valid.reviews).toMatchObject({
      completed: 1,
      ready: 1,
      firstPassTotal: 1,
      firstPassReady: 1,
      firstPassRate: 1,
      unmatched: 1,
    });
  });
  // v2.11.0 stageJumpReaches: a jump resets only its Target and later stages.
  it.each([
    ["a later Target", "build-and-test", { completed: 1, unmatched: 0 }],
    ["the review's own stage", "code-generation", { completed: 0, unmatched: 2 }],
    ["an earlier Target", "functional-design", { completed: 0, unmatched: 2 }],
    ["an unknown Target", "unknown-stage", { completed: 0, unmatched: 2 }],
    ["no Target", undefined, { completed: 0, unmatched: 2 }],
  ])("pairs a review across a jump to %s only when the jump does not reach it", (_, target, expected) => {
    const order = ["functional-design", "code-generation", "build-and-test"];
    const row = deriveEffectiveness(
      events(
        block("REVIEW_REQUESTED", 0, reviewFields),
        block("STAGE_JUMPED", 1, target === undefined ? {} : { Target: target }),
        block("REVIEW_COMPLETED", 2, { ...reviewFields, Verdict: "READY" }),
      ),
      BASE + 10_000,
      order,
    );
    expect(row.reviews).toMatchObject(expected);
  });
  it("lets a jump reach every stage when the stage order is unknown", () => {
    const row = deriveEffectiveness(
      events(
        block("REVIEW_REQUESTED", 0, reviewFields),
        block("STAGE_JUMPED", 1, { Target: "build-and-test" }),
        block("REVIEW_COMPLETED", 2, { ...reviewFields, Verdict: "READY" }),
      ),
      BASE + 10_000,
    );
    expect(row.reviews).toMatchObject({ completed: 0, unmatched: 2 });
  });
  it("keeps a first-pass review first across a jump that does not reach its stage", () => {
    const order = ["code-generation", "build-and-test"];
    const row = deriveEffectiveness(
      events(
        block("REVIEW_REQUESTED", 0, reviewFields),
        block("REVIEW_COMPLETED", 1, { ...reviewFields, Verdict: "NOT-READY" }),
        block("STAGE_JUMPED", 2, { Target: "build-and-test" }),
        block("REVIEW_REQUESTED", 3, reviewFields),
        block("REVIEW_COMPLETED", 4, { ...reviewFields, Verdict: "READY" }),
      ),
      BASE + 10_000,
      order,
    );
    // The same attempt's iteration 1 repeats: a duplicate, not a new first pass.
    expect(row.reviews).toMatchObject({ completed: 1, firstPassTotal: 1, firstPassReady: 0 });
    expect(row.warnings).toContain("duplicate review completion ignored");
  });
  it("requires an independent Unit source binding even without a workspace source binding", () => {
    const request = { ...reviewFields, "Unit Source Fingerprint": `sha256:${"a".repeat(64)}` };
    const history = [
      block("REVIEW_REQUESTED", 0, request),
      block("REVIEW_COMPLETED", 1, { ...reviewFields, Verdict: "NOT-READY" }),
    ];
    expect(deriveEffectiveness(events(...history), BASE + 10_000).reviews?.completed).toBe(0);
    expect(
      deriveEffectiveness(
        events(...history, block("REVIEW_COMPLETED", 2, { ...request, Verdict: "NOT-READY" })),
        BASE + 10_000,
      ).reviews,
    ).toMatchObject({ completed: 1, ready: 0, notReady: 1, firstPassTotal: 1, firstPassRate: 0 });
  });
  it("keeps independent unit reviews valid when another unit revises, and resets all bundled gate stages", () => {
    const row = deriveEffectiveness(
      events(
        block("REVIEW_REQUESTED", 0, { ...reviewFields, Unit: "b" }),
        block("GATE_REJECTED", 1, { ...stage, Unit: "a" }),
        block("REVIEW_COMPLETED", 2, { ...reviewFields, Unit: "b", Verdict: "READY" }),
        block("GATE_REJECTED", 3, {
          Stage: "functional-design",
          Unit: "b",
          "Gate Stages": "functional-design,code-generation",
        }),
        block("REVIEW_REQUESTED", 4, { ...reviewFields, Unit: "b" }),
        block("REVIEW_COMPLETED", 5, { ...reviewFields, Unit: "b", Verdict: "READY" }),
        block("BOLT_STARTED", 6, { "Bolt names": "b" }),
        block("REVIEW_REQUESTED", 7, { ...reviewFields, Unit: "b" }),
        block("REVIEW_COMPLETED", 8, { ...reviewFields, Unit: "b", Verdict: "NOT-READY" }),
      ),
      BASE + 10_000,
    );
    expect(row.reviews).toMatchObject({ completed: 3, firstPassTotal: 3, firstPassReady: 2 });
  });
  it("rejects stale review fingerprints and orphan review completions", () => {
    const row = deriveEffectiveness(
      events(
        block("REVIEW_REQUESTED", 0, { ...reviewFields, "Artifact Fingerprint": "a" }),
        block("REVIEW_COMPLETED", 1, {
          ...reviewFields,
          Verdict: "READY",
          "Request Fingerprint": "b",
        }),
        block("STAGE_JUMPED", 2, { Target: "other" }),
        block("REVIEW_COMPLETED", 3, {
          ...reviewFields,
          Verdict: "READY",
          "Request Fingerprint": "a",
        }),
      ),
      BASE + 10_000,
    );
    expect(row.reviews?.firstPassRate).toBeNull();
    expect(row.reviews?.unmatched).toBeGreaterThan(0);
  });
  it("resets the canonical Bolt unit when its display name differs", () => {
    const unit = { ...stage, Unit: "checkout-unit" };
    const review = { ...reviewFields, Unit: "checkout-unit" };
    const row = deriveEffectiveness(
      events(
        block("STAGE_AWAITING_APPROVAL", 0, unit),
        block("REVIEW_REQUESTED", 0, review),
        block("BOLT_STARTED", 1, {
          "Bolt names": "Checkout improvements",
          "Bolt slug": "checkout-unit",
        }),
        block("GATE_APPROVED", 2, unit),
        block("REVIEW_COMPLETED", 2, { ...review, Verdict: "READY" }),
        block("STAGE_AWAITING_APPROVAL", 3, unit),
        block("REVIEW_REQUESTED", 3, review),
        block("GATE_APPROVED", 4, unit),
        block("REVIEW_COMPLETED", 4, { ...review, Verdict: "READY" }),
      ),
      BASE + 10_000,
    );
    expect(row.approvalWait).toMatchObject({
      completedMs: 1000,
      completedIntervals: 1,
      pendingIntervals: 0,
      excludedIntervals: 2,
    });
    expect(row.reviews).toMatchObject({
      completed: 1,
      firstPassTotal: 1,
      firstPassReady: 1,
      unmatched: 2,
    });
  });
  it("pairs interleaved sensor firings by identity and distinguishes verification from unavailable tools", () => {
    const rows: string[] = [];
    for (let i = 0; i < 5; i++)
      rows.push(block("SENSOR_FIRED", i, { ...sensorFields, "Fire id": `fire-${i}` }));
    rows.push(
      block("SENSOR_PASSED", 10, {
        ...sensorFields,
        "Fire id": "fire-1",
        Note: "tool-unavailable",
      }),
    );
    rows.push(block("SENSOR_PASSED", 11, { ...sensorFields, "Fire id": "fire-0" }));
    rows.push(
      block("SENSOR_FAILED", 12, { ...sensorFields, "Fire id": "fire-2", "Findings count": "3" }),
    );
    rows.push(block("SENSOR_BUDGET_OVERRIDE", 13, { ...sensorFields, "Fire id": "fire-3" }));
    const row = deriveEffectiveness(events(...rows), BASE + 20_000);
    expect(row.sensors).toEqual({
      scope: "intent-record",
      verifiedPassed: 1,
      failed: 1,
      skipped: 2,
      incomplete: 1,
      findings: 3,
    });
  });
  it.each([undefined, "", "invalid", "-1", "1.5", "99999999999999999999", "0", "2"])(
    "distinguishes missing sensor findings from a recorded count: %s",
    (count) => {
      const rows = [
        block("SENSOR_FIRED", 0, sensorFields),
        block("SENSOR_FAILED", 1, {
          ...sensorFields,
          ...(count === undefined ? {} : { "Findings count": count }),
        }),
      ];
      const known = count === "0" || count === "2";
      const first = deriveEffectiveness(events(...rows), BASE + 10_000);
      expect(first.sensors?.findings).toBe(known ? Number(count) : null);
      const next = { ...sensorFields, "Fire id": "next" };
      rows.push(
        block("SENSOR_FIRED", 2, next),
        block("SENSOR_FAILED", 3, { ...next, "Findings count": "3" }),
      );
      const combined = deriveEffectiveness(events(...rows), BASE + 10_000);
      expect(combined.sensors?.findings).toBe(known ? Number(count) + 3 : null);
      expect(combined.sensors?.failed).toBe(2);
      expect(combined.warnings.includes("sensor findings count unavailable")).toBe(!known);
    },
  );
  it.each(["Fire id", "Sensor ID", "Stage slug"])(
    "keeps sensors unavailable when receipts lack %s",
    (missing) => {
      const fields = Object.fromEntries(
        Object.entries(sensorFields).filter(([key]) => key !== missing),
      );
      const row = deriveEffectiveness(
        events(block("SENSOR_FIRED", 0, fields), block("SENSOR_PASSED", 1, fields)),
        BASE + 10_000,
      );
      expect(row.sensors).toBeNull();
      expect(row.warnings).toContain("sensor receipt missing correlation fields");
    },
  );
  it.each(["SENSOR_PASSED", "SENSOR_FAILED", "SENSOR_BUDGET_OVERRIDE"])(
    "keeps orphan %s receipts unavailable",
    (terminal) => {
      const row = deriveEffectiveness(events(block(terminal, 1, sensorFields)), BASE + 10_000);
      expect(row.sensors).toBeNull();
      expect(row.warnings).toContain("unmatched sensor terminal ignored");
    },
  );
  it("retains a valid incomplete firing alongside discarded receipts", () => {
    const row = deriveEffectiveness(
      events(
        block("SENSOR_FIRED", 0, sensorFields),
        block("SENSOR_PASSED", 1),
        block("SENSOR_FAILED", 2, { ...sensorFields, "Fire id": "orphan" }),
      ),
      BASE + 10_000,
    );
    expect(row.sensors).toMatchObject({ incomplete: 1, verifiedPassed: 0, failed: 0 });
    expect(row.warnings).toEqual([
      "sensor receipt missing correlation fields",
      "unmatched sensor terminal ignored",
    ]);
  });
  it("counts intent-wide checks consistently for tagged and untagged isolated writes", () => {
    const rows = [block("WORKFLOW_STARTED", 0)];
    for (const [index, workflow] of ["work.one", "single-stage:code-generation", ""].entries()) {
      const fields = {
        ...sensorFields,
        "Fire id": `fire-${index}`,
        ...(workflow ? { Workflow: workflow } : {}),
      };
      rows.push(block("SENSOR_FIRED", index * 2 + 1, fields));
      rows.push(block("SENSOR_PASSED", index * 2 + 2, fields));
    }
    rows.push(block("STAGE_COMPLETED", 7, { ...stage, Workflow: "single-stage:code-generation" }));
    rows.push(block("WORKFLOW_COMPLETED", 8));
    const row = deriveEffectiveness(events(...rows), BASE + 10_000);
    expect(row.sensors).toEqual({
      scope: "intent-record",
      verifiedPassed: 3,
      failed: 0,
      skipped: 0,
      incomplete: 0,
      findings: 0,
    });
    expect(row.completionMs).toBe(8_000);
    expect(row.auditEventCount).toBe(8);
  });
  it("never adds repeated stage cumulative usage snapshots or workflow totals together", () => {
    const rows = events(
      block("STAGE_COMPLETED", 0, usageFields),
      block("STAGE_COMPLETED", 1, { ...usageFields, "Tokens In": "200" }),
    );
    expect(auditUsageSummary(rows, [])).toMatchObject({
      inputTokens: 200,
      source: "audit-stages",
      partial: true,
    });
    rows.push(
      ...events(
        block("WORKFLOW_COMPLETED", 2, {
          ...usageFields,
          "Tokens In": "500",
          "By Model": "future=null;known=0.25",
        }),
      ),
    );
    expect(auditUsageSummary(rows, [])).toMatchObject({
      inputTokens: 500,
      source: "audit-workflow",
      partial: true,
      unknownModels: ["future"],
    });
  });
  it("uses newer stage totals after a restart instead of the obsolete workflow total", () => {
    const rows = events(
      block("WORKFLOW_STARTED", 0),
      block("STAGE_COMPLETED", 1, usageFields),
      block("WORKFLOW_COMPLETED", 2, { ...usageFields, "Tokens In": "500" }),
      block("WORKFLOW_STARTED", 3),
      block("STAGE_COMPLETED", 4, { ...usageFields, "Tokens In": "900", "Cost USD": "2" }),
    );
    const warnings: string[] = [];
    expect(auditUsageSummary(rows, warnings)).toMatchObject({
      source: "audit-stages",
      inputTokens: 900,
      estimatedUsd: 2,
      partial: true,
    });
    expect(warnings.join(" ")).toContain("obsolete completion");
    expect(
      auditUsageSummary(
        events(block("WORKFLOW_COMPLETED", 0, usageFields), block("WORKFLOW_STARTED", 1)),
        [],
      ),
    ).toBeNull();
  });
  it("accepts a completion after the latest start in the same shard and timestamp", () => {
    expect(
      auditUsageSummary(
        events(
          block("WORKFLOW_COMPLETED", 0, usageFields),
          block("WORKFLOW_STARTED", 1),
          block("WORKFLOW_COMPLETED", 1, { ...usageFields, "Tokens In": "900" }),
        ),
        [],
      ),
    ).toMatchObject({ source: "audit-workflow", inputTokens: 900, partial: false });
    const tied = sortMeasurementEvents([
      ...parseMeasurementEvents(block("WORKFLOW_STARTED", 1), "a").events,
      ...parseMeasurementEvents(block("WORKFLOW_COMPLETED", 1, usageFields), "b").events,
    ]);
    expect(auditUsageSummary(tied, [])).toBeNull();
  });
});

function totals(input: number, usd: number) {
  return { tokens: { input, output: 2, cacheRead: 3, cacheCreate5m: 4, cacheCreate1h: 5 }, usd };
}
function ledger() {
  return {
    schemaVersion: 3,
    cursors: { "/private/transcript": { byteOffset: 100 } },
    totals: totals(99999, 900),
    workflows: {
      "intent:abc": {
        totals: totals(50, 1),
        byModel: { known: totals(40, 1), future: totals(10, 0) },
        sessions: { "/private/session": {} },
      },
    },
  };
}
describe("usage ownership", () => {
  const forkFields = {
    "Bolt slug": "worker-one",
    "Source Audit Hash": "a".repeat(64),
    "Fork Boundary": "100",
  };
  const mergeFields = {
    ...forkFields,
    "Fork Timestamp": new Date(BASE + 1000).toISOString(),
    "Entries Merged": "3",
  };
  function mergedWorktree(override: Record<string, string> = {}) {
    const fork = block("AUDIT_FORKED", 1, forkFields);
    const delta = [
      block("STAGE_COMPLETED", 2, { ...usageFields, "Tokens In": "200", "Cost USD": "0.20" }),
      block("STAGE_COMPLETED", 3, {
        ...usageFields,
        Workflow: "single-stage:code-generation",
        "Tokens In": "9999",
      }),
      block("STAGE_COMPLETED", 4, { ...usageFields, "Tokens In": "300", "Cost USD": "0.30" }),
    ].join("\n");
    return {
      worker: parseMeasurementEvents(`${fork}\n${delta}`, "host-worker123.md").events,
      main: events(
        block("WORKFLOW_STARTED", 0),
        fork,
        // Physical append order differs from event time. This parent stage is not delta.
        block("STAGE_COMPLETED", 5, { ...usageFields, Stage: "requirements-analysis" }),
        delta,
        block("AUDIT_MERGED", 6, { ...mergeFields, ...override }),
        block("WORKFLOW_COMPLETED", 7, { ...usageFields, "Tokens In": "150", "Cost USD": "0.15" }),
      ),
    };
  }
  it.each([false, true])(
    "includes merged worktree usage once, with original shard present: %s",
    (original) => {
      const { main, worker } = mergedWorktree();
      const audit = auditUsageSummary(
        sortMeasurementEvents([...main, ...(original ? worker : [])]),
        [],
      );
      expect(audit).toMatchObject({ source: "audit-clones", inputTokens: 450, partial: true });
      expect(audit?.estimatedUsd).toBeCloseTo(0.45);
      const own = auditUsageSummary(
        events(block("WORKFLOW_COMPLETED", 7, { ...usageFields, "Tokens In": "150" })),
        [],
      );
      if (!own) throw new Error("missing parent snapshot");
      expect(selectUsage({ ...own, source: "claude-ledger" }, audit, [])).toBe(audit);
    },
  );
  it("retains parent stage usage outside the atomic delta when there is no completion", () => {
    const { main } = mergedWorktree();
    expect(
      auditUsageSummary(
        main.filter((e) => e.event !== "WORKFLOW_COMPLETED"),
        [],
      ),
    ).toMatchObject({
      source: "audit-clones",
      inputTokens: 400,
      partial: true,
    });
  });
  it.each<Record<string, string>>([
    { "Entries Merged": "invalid" },
    { "Entries Merged": "999" },
    { "Source Audit Hash": "b".repeat(64) },
    { "Fork Timestamp": new Date(BASE).toISOString() },
  ])("withholds audit usage for an uncorrelatable merge: %j", (override) => {
    const warnings: string[] = [];
    const audit = auditUsageSummary(mergedWorktree(override).main, warnings);
    expect(audit).toBeNull();
    expect(warnings).toContain("worktree usage provenance unavailable");
    const local = ledgerUsage(
      ledger(),
      "default",
      "example",
      "abc",
      new Set(["known", "future"]),
      [],
    );
    expect(selectUsage(local, audit, warnings)).toMatchObject({
      source: "claude-ledger",
      partial: true,
    });
  });
  it("separates overlapping worktrees that report the same stage", () => {
    const secondFork = { ...forkFields, "Bolt slug": "worker-two", "Fork Boundary": "200" };
    const rows = events(
      block("WORKFLOW_STARTED", 0),
      block("AUDIT_FORKED", 1, forkFields),
      block("AUDIT_FORKED", 2, secondFork),
      block("STAGE_COMPLETED", 4, { ...usageFields, "Tokens In": "300" }),
      block("AUDIT_MERGED", 6, { ...mergeFields, "Entries Merged": "1" }),
      block("STAGE_COMPLETED", 3, { ...usageFields, "Tokens In": "400" }),
      // Legacy merge receipts correlate through hash and boundary without Fork Timestamp.
      block("AUDIT_MERGED", 7, { ...secondFork, "Entries Merged": "1" }),
      block("WORKFLOW_COMPLETED", 8, { ...usageFields, "Tokens In": "150" }),
    );
    expect(auditUsageSummary(rows, [])).toMatchObject({ inputTokens: 850, partial: true });
  });
  it("does not mistake a parent shard beginning with a fork for its worker", () => {
    const { main } = mergedWorktree();
    expect(
      auditUsageSummary(
        main.filter((e) => e.event !== "WORKFLOW_STARTED"),
        [],
      ),
    ).toMatchObject({
      inputTokens: 450,
      partial: true,
    });
  });
  it("accepts an empty delta without attributing parent activity to the worker", () => {
    const warnings: string[] = [];
    expect(
      auditUsageSummary(
        events(
          block("WORKFLOW_STARTED", 0),
          block("AUDIT_FORKED", 1, forkFields),
          block("STAGE_COMPLETED", 2, usageFields),
          block("AUDIT_MERGED", 3, { ...mergeFields, "Entries Merged": "0" }),
          block("WORKFLOW_COMPLETED", 4, usageFields),
        ),
        warnings,
      ),
    ).toMatchObject({ inputTokens: 100, partial: true });
  });
  it("marks an unmerged fork as missing usage even with only the parent shard", () => {
    const warnings: string[] = [];
    expect(
      auditUsageSummary(
        events(
          block("WORKFLOW_STARTED", 0),
          block("AUDIT_FORKED", 1, forkFields),
          block("WORKFLOW_COMPLETED", 7, usageFields),
        ),
        warnings,
      ),
    ).toMatchObject({ inputTokens: 100, partial: true });
    expect(warnings).toContain("some clones lack usage snapshots; available totals are partial");
  });
  it("reconciles coordinator completion with worker snapshots without counting a clone twice", () => {
    const coordinator = parseMeasurementEvents(
      [
        block("WORKFLOW_STARTED", 0),
        block("STAGE_COMPLETED", 1, usageFields),
        block("WORKFLOW_COMPLETED", 10, { ...usageFields, "Tokens In": "150", "Cost USD": "0.15" }),
      ].join("\n"),
      "main-coordinator123.md",
    ).events;
    const workers = [
      ...parseMeasurementEvents(
        block("STAGE_COMPLETED", 2, { ...usageFields, "Tokens In": "200", "Cost USD": "0.20" }),
        "oldhost-workerone123.md",
      ).events,
      ...parseMeasurementEvents(
        block("STAGE_COMPLETED", 3, { ...usageFields, "Tokens In": "300", "Cost USD": "0.30" }),
        "newhost-workerone123.md",
      ).events,
      ...parseMeasurementEvents(
        block("STAGE_COMPLETED", 4, { ...usageFields, "Tokens In": "400", "Cost USD": "0.40" }),
        "host-workertwo123.md",
      ).events,
    ];
    const warnings: string[] = [];
    const audit = auditUsageSummary(sortMeasurementEvents([...coordinator, ...workers]), warnings);
    expect(audit).toMatchObject({ source: "audit-clones", inputTokens: 850, partial: true });
    expect(audit?.estimatedUsd).toBeCloseTo(0.85);
    const own = auditUsageSummary(coordinator, []);
    if (!own) throw new Error("missing coordinator usage");
    const local = { ...own, source: "claude-ledger" as const };
    expect(selectUsage(local, audit, [])).toBe(audit);
    expect(
      selectUsage(
        {
          ...local,
          inputTokens: 2000,
          outputTokens: 2000,
          cacheReadTokens: 2000,
          cacheWriteTokens: 2000,
        },
        audit,
        [],
      ),
    ).toMatchObject({ source: "claude-ledger", inputTokens: 2000, partial: true });
    expect(warnings).toContain("multiple clone usage snapshots combined; totals remain partial");
  });
  it("does not trust a coordinator total when a worker usage receipt is malformed", () => {
    const coordinator = parseMeasurementEvents(
      block("WORKFLOW_COMPLETED", 10, usageFields),
      "host-main123.md",
    ).events;
    const worker = parseMeasurementEvents(
      block("STAGE_COMPLETED", 2, { ...stage, "Tokens In": "100" }),
      "host-worker123.md",
    ).events;
    const warnings: string[] = [];
    expect(
      auditUsageSummary(sortMeasurementEvents([...coordinator, ...worker]), warnings),
    ).toMatchObject({ source: "audit-clones", inputTokens: 100, partial: true });
    expect(warnings).toContain("malformed usage snapshot ignored");
  });
  it("marks a coordinator total partial when another clone has lifecycle evidence only", () => {
    const coordinator = parseMeasurementEvents(
      block("WORKFLOW_COMPLETED", 10, usageFields),
      "host-main123.md",
    ).events;
    const abandoned = parseMeasurementEvents(
      block("STAGE_STARTED", 2, stage),
      "host-worker123.md",
    ).events;
    const warnings: string[] = [];
    const audit = auditUsageSummary(
      sortMeasurementEvents([...coordinator, ...abandoned]),
      warnings,
    );
    expect(audit).toMatchObject({
      source: "audit-clones",
      inputTokens: 100,
      estimatedUsd: 0.25,
      partial: true,
    });
    const local = auditUsageSummary(coordinator, []);
    if (!local) throw new Error("missing coordinator usage");
    expect(selectUsage({ ...local, source: "claude-ledger" }, audit, [])).toMatchObject({
      inputTokens: 100,
      partial: true,
    });
    expect(warnings).toContain("some clones lack usage snapshots; available totals are partial");
  });
  it.each([
    [1, 0.018, 0.02, false],
    [3, 0.004, 0, false],
    [3, 0.018, 0.02, false],
    [1, 0.018, 0.03, true],
    [3, 0.001, 0.02, true],
  ])("accounts for %s independently rounded stage costs", (stages, cost, recorded, partial) => {
    const local = {
      source: "claude-ledger" as const,
      inputTokens: 100 * stages,
      outputTokens: 20 * stages,
      cacheReadTokens: 50 * stages,
      cacheWriteTokens: 10 * stages,
      estimatedUsd: cost * stages,
      partial: false,
      unknownModels: [],
    };
    const receipts = Array.from({ length: stages }, (_, index) =>
      block("STAGE_COMPLETED", index, {
        ...usageFields,
        Stage: `stage-${index}`,
        "Cost USD": String(recorded),
      }),
    );
    // Repeated cumulative snapshots do not increase the rounding allowance.
    receipts.push(
      block("STAGE_COMPLETED", stages, {
        ...usageFields,
        Stage: "stage-0",
        "Cost USD": String(recorded),
      }),
    );
    const audit = auditUsageSummary(events(...receipts), []);
    const warnings: string[] = [];
    expect(selectUsage(local, audit, warnings)).toEqual({ ...local, partial });
    expect(warnings.length).toBe(partial ? 1 : 0);
  });
  it.each([
    [0.018, 0.02, false],
    [0.004, 0, false],
    [0.005, 0.01, false],
    [1.005, 1, false],
    [0.018, 0.018, false],
    [0.018, 0.03, true],
    [0.018, null, true],
  ])(
    "compares ledger cost %s with audit cost %s at recorded precision",
    (cost, recorded, partial) => {
      const local = {
        source: "claude-ledger" as const,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        estimatedUsd: cost,
        partial: false,
        unknownModels: [],
      };
      const audit = auditUsageSummary(
        events(block("WORKFLOW_COMPLETED", 0, { ...usageFields, "Cost USD": String(recorded) })),
        [],
      );
      const warnings: string[] = [];
      expect(selectUsage(local, audit, warnings)).toEqual({ ...local, partial });
      expect(warnings.length).toBe(partial ? 1 : 0);
    },
  );
  it("prefers a more complete workflow snapshot over a stale local ledger without adding them", () => {
    const local = ledgerUsage(ledger(), "default", "work", "abc", new Set(["known"]), []);
    const audit = auditUsageSummary(
      events(
        block("WORKFLOW_COMPLETED", 0, { ...usageFields, "Tokens In": "1000", "Cost USD": "10" }),
      ),
      [],
    );
    expect(selectUsage(local, audit, [])).toMatchObject({
      inputTokens: 1000,
      estimatedUsd: 10,
      source: "audit-workflow",
    });
    if (!audit) throw new Error("fixture usage missing");
    expect(selectUsage(local, { ...audit, outputTokens: 0 }, [])).toMatchObject({
      inputTokens: 50,
      partial: true,
      source: "claude-ledger",
    });
  });
  it.each(["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const)(
    "marks post-completion ledger growth in %s as partial even when costs still agree",
    (field) => {
      const audit = auditUsageSummary(events(block("WORKFLOW_COMPLETED", 0, usageFields)), []);
      if (!audit) throw new Error("fixture usage missing");
      const local = { ...audit, source: "claude-ledger" as const, [field]: audit[field] + 1 };
      const warnings: string[] = [];
      expect(selectUsage(local, audit, warnings)).toEqual({ ...local, partial: true });
      expect(warnings).toContain(
        "usage observations disagree; local ledger shown as partial without combining snapshots",
      );
      expect(local.partial).toBe(false);
    },
  );
  it("keeps a complete local ledger when it has grown beyond an intermediate stage snapshot", () => {
    const audit = auditUsageSummary(events(block("STAGE_COMPLETED", 0, usageFields)), []);
    if (!audit) throw new Error("fixture usage missing");
    const local = {
      ...audit,
      source: "claude-ledger" as const,
      inputTokens: audit.inputTokens + 100,
      estimatedUsd: 1,
      partial: false,
    };
    const warnings: string[] = [];
    expect(selectUsage(local, audit, warnings)).toBe(local);
    expect(warnings).toEqual([]);
  });
  it("reads only the selected intent, with unknown pricing and no transcript identifiers", () => {
    const row = ledgerUsage(ledger(), "default", "work", "abc", new Set(["known"]), []);
    expect(row).toMatchObject({
      source: "claude-ledger",
      inputTokens: 50,
      estimatedUsd: 1,
      partial: true,
      unknownModels: ["future"],
    });
    expect(JSON.stringify(row)).not.toContain("private");
    expect(ledgerUsage(ledger(), "default", "other", "other", new Set(), [])).toBeNull();
  });
  it("rejects old ledger semantics and malformed counts", () => {
    const old = ledger();
    old.schemaVersion = 2;
    expect(ledgerUsage(old, "default", "work", "abc", new Set(), [])).toBeNull();
    const malformed = ledger();
    malformed.workflows["intent:abc"].totals.tokens.input = -1;
    expect(ledgerUsage(malformed, "default", "work", "abc", new Set(), [])).toBeNull();
    const badCursors = { ...ledger(), cursors: { main: { lastUuid: "a" } } };
    expect(ledgerUsage(badCursors, "default", "work", "abc", new Set(), [])).toBeNull();
  });
});

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function workspace(dirName = "work.one") {
  const root = await mkdtemp(path.join(os.tmpdir(), "aidlc-effectiveness-"));
  roots.push(root);
  const record = path.join(root, "aidlc/spaces/default/intents", dirName);
  await mkdir(path.join(record, "audit"), { recursive: true });
  const golden = await readFile(
    new URL("./fixtures/golden/aidlc-state.md", import.meta.url),
    "utf8",
  );
  await writeFile(
    path.join(record, "aidlc-state.md"),
    golden.replace(/\*\*Status\*\*: [^\r\n]+/, "**Status**: Completed"),
  );
  await writeFile(
    path.join(record, "audit/a.md"),
    block("WORKFLOW_STARTED", 0) + block("WORKFLOW_COMPLETED", 10),
  );
  return { root, record };
}
describe("effectiveness reader boundaries", () => {
  it("returns intent cards in creation order using the same registry rule as the picker", async () => {
    const { root, record } = await workspace("260101-a");
    const intentsDir = path.dirname(record);
    const newest = path.join(intentsDir, "260101-z");
    const older = path.join(intentsDir, "251231-old");
    const state = await readFile(path.join(record, "aidlc-state.md"));
    for (const dir of [newest, older]) {
      await mkdir(dir);
      await writeFile(path.join(dir, "aidlc-state.md"), state);
    }
    const firstMs = Date.UTC(2026, 0, 1, 1);
    const uuidAt = (ms: number) => {
      const timestamp = ms.toString(16).padStart(12, "0");
      return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7000-8000-000000000000`;
    };
    await writeFile(
      path.join(intentsDir, "intents.json"),
      JSON.stringify([
        { dirName: "260101-a", uuid: uuidAt(firstMs) },
        { dirName: "260101-z", uuid: uuidAt(firstMs + 1) },
      ]),
    );

    const result = await getEffectiveness(root);
    if (!("ok" in result)) throw new Error("expected measurements");
    expect(result.value.intents.map((intent) => intent.dirName)).toEqual([
      "260101-z",
      "260101-a",
      "251231-old",
    ]);
  });

  it("judges a jump's reach against the record's Stage Progress order", async () => {
    const { root, record } = await workspace();
    await writeFile(
      path.join(record, "audit/a.md"),
      block("WORKFLOW_STARTED", 0) +
        block("REVIEW_REQUESTED", 1, reviewFields) +
        block("STAGE_JUMPED", 2, { Target: "build-and-test" }) +
        block("REVIEW_COMPLETED", 3, { ...reviewFields, Verdict: "READY" }) +
        block("WORKFLOW_COMPLETED", 10),
    );
    const result = await getEffectiveness(root);
    if (!("ok" in result)) throw new Error("expected measurements");
    expect(result.value.intents[0]?.reviews).toMatchObject({ completed: 1, unmatched: 0 });
  });

  it("includes the newest intent before applying the 500-intent limit", async () => {
    const { root, record } = await workspace("250101-000");
    const intentsDir = path.dirname(record);
    for (let start = 1; start < 500; start += 16) {
      await Promise.all(
        Array.from({ length: Math.min(16, 500 - start) }, async (_, offset) => {
          const dir = path.join(intentsDir, `250101-${String(start + offset).padStart(3, "0")}`);
          await mkdir(dir);
          await writeFile(path.join(dir, "aidlc-state.md"), "invalid state");
        }),
      );
    }
    const newest = path.join(intentsDir, "260101-z");
    await mkdir(newest);
    await writeFile(path.join(newest, "aidlc-state.md"), await readFile(path.join(record, "aidlc-state.md")));

    const result = await getEffectiveness(root);
    if (!("ok" in result)) throw new Error("expected measurements");
    expect(result.value.intents).toHaveLength(500);
    expect(result.value.intents[0]?.dirName).toBe("260101-z");
    expect(result.value.intents.some((intent) => intent.dirName === "250101-499")).toBe(false);
    expect(result.value.warnings).toContain("intent limit reached");
  });

  it("recognizes effective zero-priced override models and keeps the default rate floor", async () => {
    const { root } = await workspace();
    const { root: overrideRoot } = await workspace();
    const overridePath = path.join(overrideRoot, "rates.json");
    vi.stubEnv("AIDLC_MODEL_RATES", overridePath);
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "0");
    await mkdir(path.join(root, "aidlc/.aidlc-sessions"), { recursive: true });
    const aggregate = {
      totals: totals(100, 0),
      byModel: { "custom-free": totals(50, 0), "opus-5": totals(50, 0) },
    };
    await writeFile(
      path.join(root, "aidlc/.aidlc-sessions/usage-ledger.json"),
      JSON.stringify({ ...ledger(), workflows: { "record:default/work.one": aggregate } }),
    );
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    await writeFile(
      overridePath,
      JSON.stringify({ rates: { "custom-free": zero, "opus-5": { input: "invalid" } } }),
    );
    const priced = await getEffectiveness(root);
    expect("ok" in priced && priced.value.intents[0]?.usage).toMatchObject({
      estimatedUsd: 0,
      partial: false,
      unknownModels: [],
    });
    await writeFile(overridePath, JSON.stringify({ rates: { "custom-free": { input: 0 } } }));
    const unknown = await getEffectiveness(root);
    expect("ok" in unknown && unknown.value.intents[0]?.usage).toMatchObject({
      estimatedUsd: null,
      partial: true,
      unknownModels: ["custom-free"],
    });
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "1");
    await writeFile(overridePath, "invalid override");
    const disabled = await getEffectiveness(root);
    expect("ok" in disabled && disabled.value.intents[0]?.usage).toBeNull();
    expect("ok" in disabled && disabled.value.warnings.join(" ")).not.toContain("invalid JSON");
  });
  it("withholds audit usage as well as waits for cross-shard lifecycle ties", async () => {
    const { root, record } = await workspace();
    await writeFile(
      path.join(record, "audit/a.md"),
      block("WORKFLOW_STARTED", 0) + block("WORKFLOW_COMPLETED", 1, usageFields),
    );
    await writeFile(path.join(record, "audit/z.md"), block("STAGE_JUMPED", 1, stage));
    const result = await getEffectiveness(root);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      completionMs: null,
      approvalWait: null,
      auditEventCount: null,
      usage: null,
    });
    expect("ok" in result && result.value.intents[0]?.warnings).toContain(
      "cross-shard lifecycle timestamp ties; audit measurements withheld",
    );
  });
  it.each([
    { dirName: "old-work-2f5f16c4", stored: undefined, matched: true },
    { dirName: "old-work-de8e2f5f16c4", stored: undefined, matched: true },
    { dirName: "old-work-deadbeef", stored: undefined, matched: false },
    { dirName: "other-work-2f5f16c4", stored: undefined, matched: false },
    { dirName: "old-work-2F5F16C4", stored: undefined, matched: false },
    { dirName: "old-work-2f5f16c4", stored: "260911-renamed", matched: false },
    { dirName: "260911-renamed", stored: "260911-renamed", matched: true },
  ])(
    "joins legacy UUID usage only by the supported directory rule: $dirName / $stored",
    async ({ dirName, stored, matched }) => {
      const { root } = await workspace(dirName);
      const uuid = "019f7ffe-9dd5-7d44-ae3d-de8e2f5f16c4";
      await writeFile(
        path.join(root, "aidlc/spaces/default/intents/intents.json"),
        JSON.stringify([{ uuid, slug: "old-work", ...(stored ? { dirName: stored } : {}) }]),
      );
      const sessions = path.join(root, "aidlc/.aidlc-sessions");
      await mkdir(sessions, { recursive: true });
      await writeFile(
        path.join(sessions, "usage-ledger.json"),
        JSON.stringify({
          ...ledger(),
          workflows: { [`intent:${uuid}`]: ledger().workflows["intent:abc"] },
        }),
      );
      const result = await getEffectiveness(root);
      if (!("ok" in result)) throw new Error("expected measurements");
      expect(result.value.intents[0]?.id).toBe(matched ? uuid : null);
      if (matched)
        expect(result.value.intents[0]?.usage).toMatchObject({
          source: "claude-ledger",
          inputTokens: 50,
        });
      else expect(result.value.intents[0]?.usage).toBeNull();
    },
  );
  it("honors the usage kill switch at request time without reading the ledger or pricing", async () => {
    const { root, record } = await workspace();
    const sessions = path.join(root, "aidlc/.aidlc-sessions");
    const rates = path.join(root, ".claude/tools/data");
    await mkdir(sessions, { recursive: true });
    await mkdir(rates, { recursive: true });
    const ledgerPath = path.join(sessions, "usage-ledger.json");
    await writeFile(
      ledgerPath,
      JSON.stringify({
        ...ledger(),
        workflows: {
          "record:default/work.one": ledger().workflows["intent:abc"],
        },
      }),
    );
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "0");
    const enabled = await getEffectiveness(root);
    expect("ok" in enabled && enabled.value.intents[0]?.usage?.source).toBe("claude-ledger");
    await writeFile(
      path.join(record, "audit/a.md"),
      block("WORKFLOW_STARTED", 0) + block("WORKFLOW_COMPLETED", 10, usageFields),
    );
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "1");
    const disabled = await getEffectiveness(root);
    expect("ok" in disabled && disabled.value.intents[0]).toMatchObject({
      usage: null,
      completionMs: 10_000,
    });
    // Neither malformed file should even be parsed while tracking is disabled.
    await writeFile(ledgerPath, "invalid ledger");
    await writeFile(path.join(rates, "model-rates.json"), "invalid pricing");
    const skipped = await getEffectiveness(root);
    expect("ok" in skipped && skipped.value.warnings.join(" ")).not.toContain("invalid JSON");
    vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "true");
    const restored = await getEffectiveness(root);
    expect("ok" in restored && restored.value.intents[0]?.usage?.source).toBe("audit-workflow");
  });
  it.each(["machine", "project", "local"])(
    "honors %s usage settings, refreshes changes, and skips ledger/pricing reads",
    async (layer) => {
      const { root, record } = await workspace();
      const machine = path.join(root, "machine");
      await mkdir(machine);
      vi.stubEnv("AIDLC_INSTALL_ROOT", machine);
      vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", undefined);
      const settingsPath =
        layer === "machine"
          ? path.join(machine, "aidlc.settings.json")
          : path.join(
              root,
              layer === "local" ? "aidlc.settings.local.json" : "aidlc.settings.json",
            );
      const settings = (bypasses: string[]) =>
        JSON.stringify({ schemaVersion: 1, flags: { schemaVersion: 1, bypasses } });
      await writeFile(settingsPath, settings(["AIDLC_DISABLE_USAGE_TRACKING"]));
      await writeFile(
        path.join(record, "audit/a.md"),
        block("WORKFLOW_COMPLETED", 10, usageFields),
      );
      await mkdir(path.join(root, "aidlc/.aidlc-sessions"), { recursive: true });
      await mkdir(path.join(root, ".claude/tools/data"), { recursive: true });
      await writeFile(path.join(root, "aidlc/.aidlc-sessions/usage-ledger.json"), "invalid ledger");
      await writeFile(path.join(root, ".claude/tools/data/model-rates.json"), "invalid pricing");
      const disabled = await getEffectiveness(root);
      expect("ok" in disabled && disabled.value.intents[0]?.usage).toBeNull();
      expect("ok" in disabled && disabled.value.warnings).toEqual([
        "usage tracking disabled; token and cost data withheld",
      ]);
      await writeFile(settingsPath, settings([]));
      const enabled = await getEffectiveness(root);
      expect("ok" in enabled && enabled.value.intents[0]?.usage?.source).toBe("audit-workflow");
    },
  );
  it("reads all active-space intents with dotted directory names and state lifecycle status", async () => {
    const { root } = await workspace();
    const result = await getEffectiveness(root, BASE + 20_000);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      dirName: "work.one",
      scope: "prd-implementation",
      depth: "Standard",
      status: "Completed",
      completionMs: 10_000,
    });
  });
  it("rejects active-space traversal before scanning", async () => {
    const { root } = await workspace();
    await writeFile(path.join(root, "aidlc/active-space"), "../../outside");
    expect(await getEffectiveness(root)).toEqual({ error: true, reason: "outside-record" });
  });
  it("does not keep a terminal workflow clock running when the completion receipt is missing", async () => {
    const { root, record } = await workspace();
    await writeFile(path.join(record, "audit/a.md"), block("WORKFLOW_STARTED", 0));
    const result = await getEffectiveness(root, BASE + 100_000);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      status: "Completed",
      elapsedMs: null,
      completionMs: null,
    });
    expect("ok" in result && result.value.intents[0]?.warnings.join(" ")).toContain(
      "completion boundary",
    );
  });
  it.each(["Completed", "Cancelled", "Canceled", "Aborted", "Archived"])(
    "excludes open gate timers for %s records without a completion receipt",
    async (status) => {
      const { root, record } = await workspace();
      const stateFile = path.join(record, "aidlc-state.md");
      await writeFile(
        stateFile,
        (await readFile(stateFile, "utf8")).replace(
          "**Status**: Completed",
          `**Status**: ${status}`,
        ),
      );
      await writeFile(
        path.join(record, "audit/a.md"),
        [
          block("WORKFLOW_STARTED", 0),
          block("STAGE_AWAITING_APPROVAL", 1, stage),
          block("GATE_APPROVED", 2, stage),
          block("STAGE_AWAITING_APPROVAL", 3, stage),
        ].join("\n"),
      );
      for (const now of [BASE + 10_000, BASE + 100_000]) {
        const result = await getEffectiveness(root, now);
        expect("ok" in result && result.value.intents[0]).toMatchObject({
          status,
          elapsedMs: null,
          approvalWait: {
            completedMs: 1000,
            completedIntervals: 1,
            pendingMs: null,
            pendingIntervals: 0,
            excludedIntervals: 1,
          },
        });
      }
    },
  );
  it("does not derive measurements for unsupported state versions", async () => {
    const { root, record } = await workspace();
    const original = await readFile(path.join(record, "aidlc-state.md"), "utf8");
    await writeFile(
      path.join(record, "aidlc-state.md"),
      original.replace("**State Version**: 8", "**State Version**: 999"),
    );
    const result = await getEffectiveness(root);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      auditEventCount: null,
      completionMs: null,
      usage: null,
      reviews: null,
    });
    expect("ok" in result && result.value.intents[0]?.warnings.join(" ")).toContain("unsupported");
  });
  it("leaves the audit count unavailable when the state is unreadable", async () => {
    const { root, record } = await workspace();
    await rm(path.join(record, "aidlc-state.md"));
    await mkdir(path.join(record, "aidlc-state.md"));
    const result = await getEffectiveness(root);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      auditEventCount: null,
      completionMs: null,
    });
  });
  it("rejects audit junctions into a different record within the workspace", async () => {
    const { root, record } = await workspace();
    const other = path.join(root, "other-audit");
    await mkdir(other);
    await writeFile(path.join(other, "b.md"), block("HUMAN_TURN", 20));
    await rm(path.join(record, "audit"), { recursive: true });
    await symlink(other, path.join(record, "audit"), "junction");
    const result = await getEffectiveness(root);
    expect("ok" in result && result.value.intents[0]?.humanTurns).toBeNull();
    expect("ok" in result && result.value.intents[0]?.warnings.join(" ")).toContain(
      "outside-record",
    );
  });
  it("withholds audit measurements when an oversized shard could hide lifecycle boundaries", async () => {
    const { root, record } = await workspace();
    await writeFile(path.join(root, "aidlc/spaces/default/intents/intents.json"), "invalid");
    await writeFile(path.join(record, "audit/huge.md"), "x".repeat(4 * 1024 * 1024 + 1));
    const result = await getEffectiveness(root, BASE + 20_000);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      completionMs: null,
      auditEventCount: null,
    });
    expect("ok" in result && result.value.warnings.join(" ")).toContain("invalid JSON");
    expect("ok" in result && result.value.intents[0]?.warnings.join(" ")).toContain("too-large");
  });
  it("withholds capped audit metrics regardless of which shard holds newer boundaries", async () => {
    const { root, record } = await workspace();
    const repeated = block("STAGE_REVISING", 1, stage);
    for (let index = 0; index < 4; index++)
      await writeFile(path.join(record, `audit/part-${index}.md`), repeated.repeat(25_000));
    // The existing a.md has start/completion, but the cap must not select any prefix.
    const result = await getEffectiveness(root, BASE + 100_000);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      startedAt: null,
      completedAt: null,
      completionMs: null,
      elapsedMs: null,
      auditEventCount: null,
      approvalWait: null,
      rejections: null,
      revisions: null,
      humanTurns: null,
      reviews: null,
      sensors: null,
      usage: null,
    });
    expect("ok" in result && result.value.intents[0]?.warnings).toContain(
      "audit event limit reached; audit measurements withheld",
    );
  }, 30_000);
  it("withholds metrics when the shard cap omits records", async () => {
    const { root, record } = await workspace();
    await Promise.all(
      Array.from({ length: 128 }, (_, index) =>
        writeFile(path.join(record, `audit/extra-${index}.md`), ""),
      ),
    );
    const result = await getEffectiveness(root);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      auditEventCount: null,
      completionMs: null,
    });
    expect("ok" in result && result.value.intents[0]?.warnings).toContain(
      "audit shard limit reached; audit measurements withheld",
    );
  });
  it("retains independently valid ledger usage when audit evidence is incomplete", async () => {
    const { root, record } = await workspace();
    await writeFile(
      path.join(record, "audit/broken.md"),
      "**Event**: GATE_APPROVED\n**Timestamp**: invalid",
    );
    await mkdir(path.join(root, "aidlc/.aidlc-sessions"), { recursive: true });
    await writeFile(
      path.join(root, "aidlc/.aidlc-sessions/usage-ledger.json"),
      JSON.stringify({
        ...ledger(),
        workflows: { "record:default/work.one": ledger().workflows["intent:abc"] },
      }),
    );
    const result = await getEffectiveness(root);
    expect("ok" in result && result.value.intents[0]).toMatchObject({
      auditEventCount: null,
      completionMs: null,
      usage: { source: "claude-ledger", inputTokens: 50 },
    });
  });

  it("reads a team unit local record once, including rows copied into the tracked shard", async () => {
    const { root, record } = await workspace();
    const header = "# AI-DLC Audit Log\n";
    const row = (event: string, second: number) =>
      `**Timestamp**: ${new Date(BASE + second * 1000).toISOString()}\n**Event**: ${event}\n`;
    const copiedA = row("COPIED_A", 2);
    const copiedB = row("COPIED_B", 3);
    const trackedOnly = row("TRACKED_ONLY", 4);
    const localA = row("LOCAL_A", 1);
    const localB = row("LOCAL_B", 5);
    const shard = (first: string, ...rest: string[]) => [header + first, ...rest].join("\n---\n");
    await mkdir(path.join(record, ".aidlc-engine", "audit"), { recursive: true });
    await writeFile(path.join(record, "audit/a.md"), shard(copiedA, copiedB, trackedOnly));
    await writeFile(
      path.join(record, ".aidlc-engine/audit/a.md"),
      shard(localA, copiedA, copiedB, localB),
    );
    const result = await getEffectiveness(root, BASE + 60_000);
    if (!("ok" in result)) throw new Error("expected measurements");
    expect(result.value.intents[0]?.auditEventCount).toBe(5);
    expect(result.value.intents[0]?.warnings.join(" ")).not.toContain("withheld");
  });

  it("counts tracked and local shards toward the same shard cap", async () => {
    const { root, record } = await workspace();
    const localDir = path.join(record, ".aidlc-engine", "audit");
    await mkdir(localDir, { recursive: true });
    await Promise.all(
      Array.from({ length: 127 }, (_, index) =>
        writeFile(path.join(localDir, `local-${index}.md`), ""),
      ),
    );
    const kept = await getEffectiveness(root, BASE + 20_000);
    expect("ok" in kept && kept.value.intents[0]?.auditEventCount).toBe(2);
    await writeFile(path.join(localDir, "local-127.md"), "");
    const withheld = await getEffectiveness(root, BASE + 20_000);
    expect("ok" in withheld && withheld.value.intents[0]?.auditEventCount).toBeNull();
    expect("ok" in withheld && withheld.value.intents[0]?.warnings).toContain(
      "audit shard limit reached; audit measurements withheld",
    );
  }, 30_000);

  it("withholds measurements when an audit field conflicts with itself", async () => {
    const { root, record } = await workspace();
    await writeFile(
      path.join(record, "audit/a.md"),
      "**Event**: STAGE_STARTED\n**Event**: STAGE_COMPLETED\n**Timestamp**: 2026-09-01T00:00:00.000Z\n",
    );
    const result = await getEffectiveness(root, BASE + 20_000);
    expect("ok" in result && result.value.intents[0]?.auditEventCount).toBeNull();
    expect("ok" in result && result.value.intents[0]?.warnings.join(" ")).toContain(
      "conflicting audit",
    );
  });

  it("withholds measurements when the local audit directory is unreadable", async () => {
    const { root, record } = await workspace();
    // A path through a file is ENOENT on Windows, so the directory itself is replaced by a file.
    await mkdir(path.join(record, ".aidlc-engine"), { recursive: true });
    await writeFile(path.join(record, ".aidlc-engine", "audit"), "not a directory");
    const result = await getEffectiveness(root, BASE + 20_000);
    expect("ok" in result && result.value.intents[0]?.auditEventCount).toBeNull();
    expect("ok" in result && result.value.intents[0]?.warnings.join(" ")).toContain(
      ".aidlc-engine/audit: unreadable directory",
    );
  });
});
