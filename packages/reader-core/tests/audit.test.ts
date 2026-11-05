import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAllAuditEvents, readAuditEvents } from "../src/audit/events.ts";
import { expectOk, fixture, REAL_RECORD } from "./paths.ts";

const RECORD = fixture("record");

describe("readAuditEvents", () => {
  it("merges shards newest first, breaking ties on shard name (R-RC-5)", async () => {
    const { value } = expectOk(await readAuditEvents(RECORD, 10));

    expect(value.map((e) => [e.event, e.shard])).toEqual([
      ["STAGE_COMPLETED", "aaa-clone.md"],
      ["GATE_OPENED", "bbb-clone.md"],
      ["STAGE_STARTED", "bbb-clone.md"],
      ["WORKFLOW_STARTED", "aaa-clone.md"],
    ]);
  });

  it("extracts measurement fields and shard position without retaining bodies (BR-RC-6)", async () => {
    const { value } = expectOk(await readAuditEvents(RECORD, 1));
    expect(value[0]).toEqual({
      event: "STAGE_COMPLETED",
      stage: "intent-capture",
      timestamp: "2026-07-20T12:00:00Z",
      shard: "aaa-clone.md",
      workflow: null,
      position: 1,
      fields: {
        Event: "STAGE_COMPLETED",
        Stage: "intent-capture",
        Timestamp: "2026-07-20T12:00:00Z",
      },
    });
  });

  it("extracts the Workflow field when present, distinguishing an isolated single-stage run", async () => {
    const { value } = expectOk(await readAuditEvents(RECORD, 10));
    const withWorkflow = value.find((e) => e.event === "WORKFLOW_STARTED");
    expect(withWorkflow?.workflow).toBe("single-stage:demo-stage");
    // Every other fixture record carries no Workflow field at all.
    expect(value.find((e) => e.event === "STAGE_STARTED")?.workflow).toBeNull();
  });

  it("reports a null stage for records that carry no Stage field", async () => {
    const { value } = expectOk(await readAuditEvents(RECORD, 10));
    expect(value.find((e) => e.event === "WORKFLOW_STARTED")?.stage).toBeNull();
  });

  it("skips an unreadable shard with a warning and keeps the rest (mode 5)", async () => {
    const { warnings } = expectOk(await readAuditEvents(RECORD, 10));
    expect(warnings).toEqual(["audit shard skipped: unreadable-shard.md (not-a-file)"]);
  });

  it("honours the limit", async () => {
    expect(expectOk(await readAuditEvents(RECORD, 2)).value).toHaveLength(2);
    expect(expectOk(await readAuditEvents(RECORD, 0)).value).toEqual([]);
    expect(expectOk(await readAuditEvents(RECORD, -1)).value).toEqual([]);
  });

  it("returns an empty timeline when there is no audit directory", async () => {
    const result = expectOk(await readAuditEvents(fixture("golden"), 10));
    expect(result.value).toEqual([]);
    expect(result.warnings).toBeUndefined();
  });

  it("reads the live record's shards", async () => {
    const { value } = expectOk(await readAuditEvents(REAL_RECORD, 5));
    expect(value.length).toBeGreaterThan(0);
    expect(value.every((e) => e.timestamp.length > 0 && e.event.length > 0)).toBe(true);
    // Descending order holds across the real shard set.
    const timestamps = value.map((e) => e.timestamp);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);
  });

  it("readAllAuditEvents returns every record with no limit applied", async () => {
    const { value } = expectOk(await readAllAuditEvents(RECORD));
    const limited = expectOk(await readAuditEvents(RECORD, 2)).value;
    expect(value).toHaveLength(4);
    expect(value.slice(0, 2)).toEqual(limited);
  });

  it("readAllAuditEvents carries the same shard warning as the limited read", async () => {
    const { warnings } = expectOk(await readAllAuditEvents(RECORD));
    expect(warnings).toEqual(["audit shard skipped: unreadable-shard.md (not-a-file)"]);
  });
});

const HEADER = "# AI-DLC Audit Log\n";
function auditRow(event: string, timestamp: string): string {
  return `**Timestamp**: ${timestamp}\n**Event**: ${event}\n`;
}

/** Header rides on the first block, the way an engine shard is written. */
function shard(first: string, ...rest: string[]): string {
  return [HEADER + first, ...rest].join("\n---\n");
}

describe("local audit record", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  async function record(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "audit-local-"));
    roots.push(root);
    await mkdir(path.join(root, "audit"), { recursive: true });
    return root;
  }

  it("reads each row once, from the local record when both shards hold it", async () => {
    const root = await record();
    const copiedA = auditRow("COPIED_A", "2026-11-05T00:00:02Z");
    const copiedB = auditRow("COPIED_B", "2026-11-05T00:00:03Z");
    const trackedOnly = auditRow("TRACKED_ONLY", "2026-11-05T00:00:04Z");
    const localA = auditRow("LOCAL_A", "2026-11-05T00:00:01Z");
    const localB = auditRow("LOCAL_B", "2026-11-05T00:00:05Z");
    await mkdir(path.join(root, ".aidlc-engine", "audit"), { recursive: true });
    await writeFile(path.join(root, "audit", "clone.md"), shard(copiedA, copiedB, trackedOnly));
    await writeFile(
      path.join(root, ".aidlc-engine", "audit", "clone.md"),
      shard(localA, copiedA, copiedB, localB),
    );

    const { value, warnings } = expectOk(await readAllAuditEvents(root));
    expect(warnings).toBeUndefined();
    expect(value.map((event) => [event.event, event.timestamp, event.shard])).toEqual([
      ["LOCAL_B", "2026-11-05T00:00:05Z", ".aidlc-engine/audit/clone.md"],
      ["TRACKED_ONLY", "2026-11-05T00:00:04Z", "clone.md"],
      ["COPIED_B", "2026-11-05T00:00:03Z", ".aidlc-engine/audit/clone.md"],
      ["COPIED_A", "2026-11-05T00:00:02Z", ".aidlc-engine/audit/clone.md"],
      ["LOCAL_A", "2026-11-05T00:00:01Z", ".aidlc-engine/audit/clone.md"],
    ]);
  });

  it("reads a local shard when the tracked audit directory is absent", async () => {
    const root = await record();
    await rm(path.join(root, "audit"), { recursive: true });
    await mkdir(path.join(root, ".aidlc-engine", "audit"), { recursive: true });
    await writeFile(
      path.join(root, ".aidlc-engine", "audit", "clone.md"),
      shard(auditRow("LOCAL_A", "2026-11-05T00:00:01Z")),
    );
    const { value, warnings } = expectOk(await readAllAuditEvents(root));
    expect(warnings).toBeUndefined();
    expect(value.map((event) => [event.event, event.shard])).toEqual([
      ["LOCAL_A", ".aidlc-engine/audit/clone.md"],
    ]);
  });

  it("skips an unreadable local shard and keeps the tracked row", async () => {
    const root = await record();
    await mkdir(path.join(root, ".aidlc-engine", "audit", "bad.md"), { recursive: true });
    await writeFile(
      path.join(root, "audit", "clone.md"),
      shard(auditRow("TRACKED_ONLY", "2026-11-05T00:00:04Z")),
    );
    const { value, warnings } = expectOk(await readAllAuditEvents(root));
    expect(warnings).toContain("audit shard skipped: .aidlc-engine/audit/bad.md (not-a-file)");
    expect(value.map((event) => event.event)).toEqual(["TRACKED_ONLY"]);
  });

  it.each(["audit", path.join(".aidlc-engine", "audit")])(
    "reports an unreadable %s directory the same way and returns no rows",
    async (directory) => {
      const root = await record();
      await writeFile(
        path.join(root, "audit", "clone.md"),
        shard(auditRow("TRACKED_ONLY", "2026-11-05T00:00:04Z")),
      );
      await rm(path.join(root, directory), { recursive: true, force: true });
      // A path through a file is ENOENT on Windows, so the directory itself is replaced by a file.
      await mkdir(path.dirname(path.join(root, directory)), { recursive: true });
      await writeFile(path.join(root, directory), "not a directory");
      expect(await readAllAuditEvents(root)).toEqual({
        ok: true,
        value: [],
        warnings: ["audit directory could not be read"],
      });
    },
  );
});
