import { describe, expect, it } from "vitest";
import { LOCAL_AUDIT_DIRNAME, withoutLocalRecordCopies } from "../src/audit/local-record.ts";

const HEADER = "# AI-DLC Audit Log\n";

function row(event: string, timestamp: string, extra = ""): string {
  return `**Timestamp**: ${timestamp}\n**Event**: ${event}\n${extra}`;
}

describe("withoutLocalRecordCopies", () => {
  it("names the local record directory", () => {
    expect(LOCAL_AUDIT_DIRNAME).toBe(".aidlc-engine/audit");
  });

  it("drops identical timestamped rows once", () => {
    const copied = row("COPIED", "2026-01-01T00:00:01Z");
    const kept = row("KEPT", "2026-01-01T00:00:02Z");
    // Both copies in the tracked shard are the local record's row, so neither stays.
    expect(withoutLocalRecordCopies([copied, copied, kept].join("\n---\n"), copied)).toBe(kept);
    expect(withoutLocalRecordCopies([copied, kept, copied].join("\n---\n"), copied)).toBe(kept);
  });

  it("matches a row that differs only by the audit header", () => {
    const body = row("COPIED", "2026-01-01T00:00:01Z");
    const headed = HEADER + body;
    const kept = row("KEPT", "2026-01-01T00:00:02Z");
    expect(withoutLocalRecordCopies(headed, body)).toBe("");
    expect(withoutLocalRecordCopies(body, headed)).toBe("");
    expect(withoutLocalRecordCopies([headed, kept].join("\n---\n"), body)).toBe(kept);
  });

  it("never drops a block that has no Timestamp field", () => {
    const note = "a divider with no timestamp\nTimestamp: not a field";
    const copied = row("COPIED", "2026-01-01T00:00:01Z");
    const tracked = [note, copied].join("\n---\n");
    expect(withoutLocalRecordCopies(tracked, tracked)).toBe(note);
    // A bullet field is still a Timestamp, so that row is not protected.
    const bullet = "- **Event**: COPIED\n- **Timestamp**: 2026-01-01T00:00:01Z";
    expect(withoutLocalRecordCopies(bullet, bullet)).toBe("");
  });

  it("keeps a row that differs in one field", () => {
    const tracked = row("COPIED", "2026-01-01T00:00:01Z", "**Stage**: one\n");
    const local = row("COPIED", "2026-01-01T00:00:01Z", "**Stage**: two\n");
    expect(withoutLocalRecordCopies(tracked, local)).toBe(tracked);
  });

  it("normalises CRLF tracked text before comparing", () => {
    const copied = row("COPIED", "2026-01-01T00:00:01Z");
    const kept = row("KEPT", "2026-01-01T00:00:02Z");
    const tracked = `${copied.replaceAll("\n", "\r\n")}\r\n---\r\n${kept.replaceAll("\n", "\r\n")}`;
    expect(withoutLocalRecordCopies(tracked, copied)).toBe(kept);
  });

  it("returns the tracked shard byte for byte when no local row matches", () => {
    const tracked = `${HEADER}**Timestamp**: 2026-01-01T00:00:01Z\r\n**Event**: ONLY\r\n`;
    const local = row("OTHER", "2026-01-01T00:00:02Z");
    expect(withoutLocalRecordCopies(tracked, local)).toBe(tracked);
    expect(withoutLocalRecordCopies(tracked, "")).toBe(tracked);
  });
});
