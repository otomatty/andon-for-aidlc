import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalPath, guardPath, mapBounded, readBounded } from "@andon/core-utils";
import type { Verdict } from "@andon/shared-types";
import { stageJumpReaches, stageOrderOf } from "../audit/stage-jump.ts";
import { createReviewFreshnessReader } from "./review-freshness.ts";

// aidlc-workflows v2.8.2: aidlc-lib.ts reviewCompletionMatchesRequest,
// ReviewRecord, and isReviewRecordRelativePath. Badges expose current readiness,
// so unlike the engine's historical review context they reset on a new attempt.
// v2.11.0 adds stageJumpReaches (a jump resets only its Target and later
// stages) and reviewRecordNotHere (relaxed/off keep an absent record's verdict).
// v2.11.1 adds reviewCompletionDidNotFinish: the NOT-READY fallback recorded
// when a retried review wrote nothing is no reviewer's verdict, so it shows none.

export const REVIEW_DIRNAME = ".aidlc-engine/reviews";
export const REVIEW_DIRNAMES = [REVIEW_DIRNAME, ".aidlc-reviews"] as const;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REQUEST_ID = /^review:[0-9a-f]{32}$/;
const MAX_REVIEW_BYTES = 4 * 1024 * 1024;
const BOUNDARIES = new Set([
  "WORKFLOW_STARTED",
  "STAGE_JUMPED",
  "STAGE_STARTED",
  "GATE_REJECTED",
  "BOLT_STARTED",
]);
const FIELDS = new Set([
  "Event",
  "Timestamp",
  "Stage",
  "Unit",
  "Bolt names",
  "Gate Stages",
  "Target",
  "Workflow",
  "Reviewer",
  "Iteration",
  "Attempt Generation",
  "Request Id",
  "Artifact Fingerprint",
  "Request Fingerprint",
  "Source Fingerprint",
  "Request Source Fingerprint",
  "Unit Source Fingerprint",
  "Review Challenge",
  "Review Appendix Artifact",
  "Review Appendix Offset",
  "Review Appendix Prior Digest",
  "Review Appendix Prior Length",
  "Review Record",
  "Review Record Digest",
  "Review Finished",
  "Verdict",
]);
type Fields = Record<string, string>;
type Row = { fields: Fields; valid: boolean; time: number; shard: string; position: number };
export type ReviewVerdicts = { cells: Map<string, Verdict | null>; unavailable: boolean };
export const reviewCellKey = (unit: string, stage: string): string => `${unit}\0${stage}`;

function parseRows(text: string, shard: string): Row[] {
  return text.split(/^---\s*$/m).flatMap((block, position) => {
    const fields: Fields = Object.create(null);
    const seen = new Set<string>();
    let valid = true;
    for (const match of block.matchAll(/^(?:-\s*)?\*\*([^*\r\n]+)\*\*:[ \t]*([^\r\n]*)$/gm)) {
      const name = (match[1] ?? "").trim();
      if (seen.has(name)) valid = false;
      seen.add(name);
      if (FIELDS.has(name) && !Object.hasOwn(fields, name)) fields[name] = (match[2] ?? "").trim();
    }
    const time = Date.parse(fields.Timestamp ?? "");
    if (!fields.Event || fields.Workflow || !Number.isFinite(time)) return [];
    return [{ fields, valid, time, shard, position }];
  });
}

/** What the state file says about attempt boundaries. */
interface StateFacts {
  unitMajor: boolean;
  /** Stage-graph order for a jump's reach; null reaches every stage. */
  order: readonly string[] | null;
}

/** Mirrors v2.8.2 review reset attribution, shared by reads and live invalidation. */
function boundaryAppliesTo(boundary: Fields, target: Fields, state: StateFacts): boolean {
  if (boundary.Event === "WORKFLOW_STARTED") return true;
  if (boundary.Event === "STAGE_JUMPED")
    return stageJumpReaches(boundary.Target, target.Stage ?? "", state.order);
  if (boundary.Event === "BOLT_STARTED") {
    return (boundary["Bolt names"] ?? "").split(",").some((unit) => unit.trim() === target.Unit);
  }
  if (boundary.Unit && boundary.Unit !== target.Unit) return false;
  if (boundary.Event === "GATE_REJECTED") {
    return (boundary["Gate Stages"] ?? boundary.Stage ?? "")
      .split(",")
      .some((stage) => stage.trim() === target.Stage);
  }
  return (
    boundary.Event === "STAGE_STARTED" &&
    boundary.Stage === target.Stage &&
    !(state.unitMajor && target.Unit)
  );
}

async function stateFacts(recordDir: string): Promise<StateFacts> {
  const unknown = { unitMajor: false, order: null };
  const guarded = await guardPath(recordDir, "aidlc-state.md");
  if (!("ok" in guarded)) return unknown;
  const read = await readBounded(guarded.value);
  if (!read.ok) return unknown;
  return {
    // The engine's getField reads a bullet field and opts in only on this exact value.
    unitMajor:
      /^- \*\*Construction Iteration\*\*:[ \t]*(.*)$/m.exec(read.value)?.[1]?.trim() ===
      "unit-major",
    order: stageOrderOf(read.value),
  };
}

/** Units affected by an audit write, including attempt resets after a review. */
export async function reviewUnitsInAuditShard(
  recordDir: string,
  changedPath: string,
): Promise<string[] | null> {
  const guarded = await guardPath(recordDir, changedPath);
  if (!("ok" in guarded)) return null;
  const rel = path.relative(path.resolve(recordDir), guarded.value).split(path.sep);
  if (rel.length !== 2 || rel[0] !== "audit" || !rel[1]?.endsWith(".md")) return null;
  const read = await readBounded(guarded.value);
  if (!read.ok) return null;
  const changed = parseRows(read.value, rel[1]);
  const units = new Set(
    changed.flatMap(({ fields }) =>
      fields.Event?.startsWith("REVIEW_") && fields.Unit && SEGMENT.test(fields.Unit)
        ? [fields.Unit]
        : [],
    ),
  );
  const boundaries = changed.filter(({ fields }) => BOUNDARIES.has(fields.Event ?? ""));
  if (boundaries.length > 0) {
    // A reset may land in a different clone's shard from the review it retires.
    // Read only audit metadata to discover those units; never scan their artifacts here.
    const [snapshot, state] = await Promise.all([auditRows(recordDir), stateFacts(recordDir)]);
    if (snapshot.unavailable) return null;
    for (const { fields } of snapshot.rows) {
      if (!fields.Event?.startsWith("REVIEW_") || !SEGMENT.test(fields.Unit ?? "")) continue;
      if (boundaries.some(({ fields: boundary }) => boundaryAppliesTo(boundary, fields, state)))
        units.add(fields.Unit as string);
    }
  }
  return [...units].sort();
}

/** Read exact bytes without following a redirected container or leaf. */
async function recordBytes(root: string, relative: string): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    let cursor = await canonicalPath(root);
    const parts = relative.split("/");
    for (const part of parts) {
      cursor = path.join(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) return null;
    }
    handle = await open(cursor, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_REVIEW_BYTES) return null;
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length !== before.size) return null;
    return bytes.subarray(0, length);
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function recordPath(fields: Fields): string | null {
  const relative = fields["Review Record"] ?? "";
  const prefix = REVIEW_DIRNAMES.find((dir) => relative.startsWith(`${dir}/`));
  if (prefix === undefined) return null;
  const parts = [prefix, ...relative.slice(prefix.length + 1).split("/")];
  const unit = fields.Unit;
  const attempt = unit ? parts[4] : parts[3];
  if (!SEGMENT.test(fields.Stage ?? "") || !DIGEST.test(fields["Review Record Digest"] ?? ""))
    return null;
  if (parts[1] !== fields.Stage || !/^[0-9a-f]{16}$/.test(attempt ?? "")) return null;
  if (
    unit
      ? parts.length !== 6 || parts[2] !== "units" || parts[3] !== unit || !SEGMENT.test(unit)
      : parts.length !== 5 || parts[2] !== "stage"
  )
    return null;
  return parts.at(-1) === `${fields.Iteration}.json` && /^[1-9][0-9]*$/.test(fields.Iteration ?? "")
    ? relative
    : null;
}

/**
 * aidlc-workflows v2.11.0 aidlc-lib.ts `reviewRecordAbsent`: some part of the
 * record's path does not exist and nothing on the way is a symlink. A dangling
 * or redirected entry is there, and is not that review.
 */
async function recordAbsent(root: string, relative: string): Promise<boolean> {
  let at = root;
  for (const part of relative.split("/")) {
    at = path.join(at, part);
    try {
      if ((await lstat(at)).isSymbolicLink()) return false;
    } catch (error) {
      return (error as { code?: string }).code === "ENOENT";
    }
  }
  return false;
}

/**
 * v2.11.1 reviewCompletionDidNotFinish: a NOT-READY row marked `Review
 * Finished: no`, or, before the field, one whose paired record has an empty
 * body. `body` is undefined when no record was paired.
 */
const didNotFinish = (fields: Fields, body: unknown): boolean =>
  fields.Verdict === "NOT-READY" &&
  (fields["Review Finished"] !== undefined ? fields["Review Finished"] === "no" : body === "");

/**
 * `acceptsAbsent` is the resolved Guard Policy being relaxed or off. Mirrors the
 * v2.11.0 review receipt scan (`reviewRecordNotHere`): a completion that matches
 * its request but whose record is not in this checkout keeps its recorded
 * verdict; a record that is here must still match its digest under every policy.
 * A verified completion of a review that did not finish is `"unfinished"`.
 */
async function verifiedVerdict(
  root: string,
  fields: Fields,
  acceptsAbsent: boolean,
): Promise<Verdict | "unfinished" | null> {
  const relative = recordPath(fields);
  if (!relative) return null;
  const bytes = await recordBytes(root, relative);
  if (bytes === null && acceptsAbsent && (await recordAbsent(root, relative)))
    // `matches` already admitted only a READY or NOT-READY row verdict.
    return didNotFinish(fields, undefined) ? "unfinished" : (fields.Verdict as Verdict);
  if (
    !bytes ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== fields["Review Record Digest"]
  )
    return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1)
    return null;
  const bindings = {
    stage: "Stage",
    unit: "Unit",
    workflow: "Workflow",
    reviewer: "Reviewer",
    verdict: "Verdict",
    request_id: "Request Id",
    artifact_fingerprint: "Artifact Fingerprint",
    source_fingerprint: "Source Fingerprint",
    unit_source_fingerprint: "Unit Source Fingerprint",
    request_challenge: "Review Challenge",
  };
  for (const [name, field] of Object.entries(bindings))
    if (value[name] !== (fields[field] ?? null)) return null;
  const parts = relative.split("/");
  if (
    value.attempt !== parts.at(-2) ||
    value.iteration !== Number(fields.Iteration) ||
    typeof value.body !== "string" ||
    typeof value.recorded_at !== "string" ||
    !Array.isArray(value.findings)
  )
    return null;
  if (
    !value.findings.every(
      (finding) =>
        finding &&
        typeof finding === "object" &&
        /^R-[0-9]+$/.test(finding.id) &&
        ["severity", "location", "finding", "required_action", "status"].every(
          (key) => typeof finding[key] === "string",
        ) &&
        (["New", "Unresolved", "Resolved", "Accepted risk"].includes(finding.status) ||
          /^Rejected: \S[\s\S]*$/.test(finding.status)),
    )
  )
    return null;
  // The binding above makes it the row's verdict, which `matches` admitted
  // only as READY or NOT-READY.
  return didNotFinish(fields, value.body) ? "unfinished" : (value.verdict as Verdict);
}

function pairKey(f: Fields): string {
  return [f.Stage, f.Unit ?? "", f.Reviewer, f.Iteration, f["Request Id"] ?? ""].join("\0");
}

function matches(request: Row, completion: Row): boolean {
  // Equal clocks in different clone shards do not establish causality. Within
  // one append-only shard, physical row order still proves request before completion.
  if (
    request.time > completion.time ||
    (request.time === completion.time &&
      (request.shard !== completion.shard || request.position >= completion.position))
  )
    return false;
  const a = request.fields;
  const b = completion.fields;
  for (const field of [
    "Review Challenge",
    "Review Appendix Artifact",
    "Review Appendix Offset",
    "Review Appendix Prior Digest",
    "Review Appendix Prior Length",
  ]) {
    if ((a[field] ?? null) !== (b[field] ?? null)) return false;
  }
  return (
    request.valid &&
    completion.valid &&
    (b.Verdict === "READY" || b.Verdict === "NOT-READY") &&
    recordPath(b) !== null &&
    REQUEST_ID.test(a["Request Id"] ?? "") &&
    DIGEST.test(a["Artifact Fingerprint"] ?? "") &&
    DIGEST.test(b["Artifact Fingerprint"] ?? "") &&
    (b["Request Fingerprint"] ?? b["Artifact Fingerprint"]) === a["Artifact Fingerprint"] &&
    (!a["Source Fingerprint"] ||
      (a["Source Fingerprint"] === b["Request Source Fingerprint"] &&
        a["Source Fingerprint"] === b["Source Fingerprint"])) &&
    (!a["Unit Source Fingerprint"] ||
      a["Unit Source Fingerprint"] === b["Unit Source Fingerprint"]) &&
    (a["Attempt Generation"] ?? "") === (b["Attempt Generation"] ?? "")
  );
}

async function auditRows(recordDir: string): Promise<{ rows: Row[]; unavailable: boolean }> {
  let shards: string[];
  try {
    shards = (await readdir(path.join(recordDir, "audit")))
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch (error) {
    return { rows: [], unavailable: (error as { code?: string }).code !== "ENOENT" };
  }
  let unavailable = false;
  const reads = await mapBounded(shards, 4, async (shard) => {
    const guarded = await guardPath(recordDir, `audit/${shard}`);
    if (!("ok" in guarded)) {
      unavailable = true;
      return [];
    }
    const read = await readBounded(guarded.value);
    if (!read.ok) {
      unavailable = true;
      return [];
    }
    return parseRows(read.value, shard);
  });
  const rows = reads
    .flat()
    .sort((a, b) => a.time - b.time || a.shard.localeCompare(b.shard) || a.position - b.position);
  return { rows, unavailable };
}

/** One bounded audit snapshot per matrix build; never retain review bodies. */
export async function readReviewVerdicts(recordDir: string): Promise<ReviewVerdicts> {
  const [{ rows, unavailable }, state] = await Promise.all([
    auditRows(recordDir),
    stateFacts(recordDir),
  ]);
  const boundariesByTime = new Map<number, Row[]>();
  for (const row of rows) {
    if (!BOUNDARIES.has(row.fields.Event ?? "")) continue;
    const boundaries = boundariesByTime.get(row.time) ?? [];
    boundaries.push(row);
    boundariesByTime.set(row.time, boundaries);
  }
  const cells = new Map<string, Verdict | null>();
  const completed = new Map<string, Fields[]>();
  const pending = new Map<string, Row>();
  const latestRequest = new Map<string, Row>();
  for (const row of rows) {
    const f = row.fields;
    if (BOUNDARIES.has(f.Event ?? "")) {
      for (const [key, request] of latestRequest) {
        if (boundaryAppliesTo(f, request.fields, state)) {
          cells.set(key, null);
          completed.delete(key);
          latestRequest.delete(key);
        }
      }
      for (const [key, request] of pending) {
        if (boundaryAppliesTo(f, request.fields, state)) pending.delete(key);
      }
      continue;
    }
    if (
      !f.Event?.startsWith("REVIEW_") ||
      !SEGMENT.test(f.Stage ?? "") ||
      !SEGMENT.test(f.Unit ?? "")
    )
      continue;
    const key = reviewCellKey(f.Unit as string, f.Stage as string);
    const modern =
      f["Request Id"] !== undefined ||
      f["Review Record"] !== undefined ||
      f["Review Record Digest"] !== undefined;
    if (!modern) continue;
    if (!cells.has(key)) cells.set(key, null);
    if (
      boundariesByTime
        .get(row.time)
        ?.some(
          (boundary) =>
            boundary.shard !== row.shard && boundaryAppliesTo(boundary.fields, f, state),
        )
    ) {
      // A reset in another shard has no provable order within this timestamp.
      // It retires tied reviews regardless of the shards' display sort order.
      cells.set(key, null);
      completed.delete(key);
      latestRequest.delete(key);
      continue;
    }
    if (f.Event === "REVIEW_REQUESTED") {
      cells.set(key, null);
      completed.delete(key);
      latestRequest.set(key, row);
      if (
        row.valid &&
        REQUEST_ID.test(f["Request Id"] ?? "") &&
        f.Reviewer &&
        /^[1-9][0-9]*$/.test(f.Iteration ?? "")
      )
        pending.set(pairKey(f), row);
    } else if (f.Event === "REVIEW_COMPLETED") {
      const request = pending.get(pairKey(f));
      if (!request || latestRequest.get(key) !== request || !matches(request, row)) continue;
      const candidates = completed.get(key) ?? [];
      candidates.push(f);
      completed.set(key, candidates);
    }
  }
  // Only the latest candidate matters to readiness. Historical JSON need not
  // be reopened on each watch event, and independent current cells read in parallel.
  if (!unavailable && completed.size > 0) {
    const isCurrent = await createReviewFreshnessReader(recordDir);
    await mapBounded([...completed], 4, async ([key, candidates]) => {
      // A malformed/unavailable completion does not consume its request. The
      // first verified completion does; a replay cannot replace its decision.
      for (const fields of candidates) {
        const verdict = await verifiedVerdict(recordDir, fields, isCurrent.acceptsChanges);
        if (verdict !== null) {
          // A review that did not finish consumes its request with no verdict.
          cells.set(key, verdict !== "unfinished" && (await isCurrent(fields)) ? verdict : null);
          // A stale but valid completion still consumed this request. A later
          // replay must not substitute a different verdict for its receipt.
          break;
        }
      }
    });
  }
  return { cells, unavailable };
}

/** An unpaired modern record must never resurrect a legacy READY appendix. */
export async function hasReviewRecordDirectory(
  recordDir: string,
  unit: string,
  stage: string,
): Promise<boolean> {
  for (const directory of REVIEW_DIRNAMES) {
    try {
      await lstat(path.join(recordDir, directory, stage, "units", unit));
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") return true;
    }
  }
  return false;
}
