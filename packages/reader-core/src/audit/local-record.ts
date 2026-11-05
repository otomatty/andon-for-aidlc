/**
 * A claimed team Unit writes its whole audit log under
 * `<record>/.aidlc-engine/audit` and copies some of those rows into the
 * tracked shard of the same name. Readers keep one copy of a row that both
 * files hold. The split and the Timestamp rule match aidlc-workflows
 * `auditShardBlocks` / `copiedAuditBlocks`.
 */

export const LOCAL_AUDIT_DIRNAME = ".aidlc-engine/audit";

const AUDIT_HEADER = "# AI-DLC Audit Log\n";

function auditShardBlocks(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split(/\n---\n/);
}

function auditBlockField(block: string, fieldName: string): string | null {
  const prefix = `**${fieldName}**:`;
  for (const raw of block.split("\n")) {
    const line = raw.startsWith("- ") ? raw.slice(2) : raw;
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

function unheaded(block: string): string {
  return block.startsWith(AUDIT_HEADER) ? block.slice(AUDIT_HEADER.length) : block;
}

/**
 * Tracked shard text with the timestamped blocks the local record also holds
 * removed. Blocks without a Timestamp field stay. When nothing is removed the
 * original `tracked` string is returned unchanged.
 */
export function withoutLocalRecordCopies(tracked: string, local: string): string {
  const held = new Set(
    auditShardBlocks(local)
      .filter((block) => auditBlockField(block, "Timestamp") !== null)
      .map(unheaded),
  );
  const kept: string[] = [];
  let dropped = false;
  for (const block of auditShardBlocks(tracked)) {
    if (auditBlockField(block, "Timestamp") !== null && held.has(unheaded(block))) {
      dropped = true;
      continue;
    }
    kept.push(block);
  }
  return dropped ? kept.join("\n---\n") : tracked;
}
