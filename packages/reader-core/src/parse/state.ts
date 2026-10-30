import path from "node:path";
import { readBounded } from "@andon/core-utils";
import {
  CEREMONY_FIELDS,
  CEREMONY_KEYS,
  type ActiveUnit,
  type CeremonyKey,
  type CeremonySetting,
  type ConstructionGatePolicy,
  CURRENT_STATE_VERSION,
  isSupportedStateVersion,
  type Phase,
  type ReadResult,
  type StageInfo,
  type StageStatus,
  type WorkflowModel,
} from "@andon/shared-types";

/**
 * L1 — the **only** module that knows the State Version file format
 * (BR-RC-4). If the engine ever moves state to YAML/JSON, this file is the one
 * that gets replaced.
 *
 * Grammar rules G-1..G-6 live in
 * `construction/reader-core/functional-design/business-rules.md`.
 */

export { CURRENT_STATE_VERSION };
export const STATE_FILENAME = "aidlc-state.md";

/** G-1: `## <heading>` opens a section. */
const SECTION_RE = /^##\s+(.+?)\s*$/;
/** G-4: `### <PHASE> PHASE` opens a phase block inside Stage Progress. */
const PHASE_RE = /^###\s+(.+?)\s+PHASE\s*$/;
/** G-1: `- **<name>**: <value>` is a field. */
const FIELD_RE = /^-\s+\*\*(.+?)\*\*:\s*(.*)$/;
/** G-3: `- [<mark>] <slug> — <EXECUTE|SKIP>` is a stage row. */
const STAGE_RE = /^-\s+\[(.)\]\s+(.+?)\s+—\s+(\S+)\s*$/;

/** G-3: the six marks, 1:1 with StageStatus. */
const MARKS: Record<string, StageStatus> = {
  " ": "not-started",
  "-": "in-progress",
  "?": "awaiting-approval",
  R: "revising",
  x: "completed",
  S: "skipped",
};

const PHASES: readonly Phase[] = [
  "INITIALIZATION",
  "IDEATION",
  "INCEPTION",
  "CONSTRUCTION",
  "OPERATION",
];

function toPhase(raw: string): Phase | null {
  return (PHASES as readonly string[]).includes(raw) ? (raw as Phase) : null;
}

interface Doc {
  /** section name → field name → value */
  fields: Map<string, Map<string, string>>;
  /**
   * field name → value of its FIRST line anywhere in the file, section or not.
   * This is the engine's own lookup (aidlc-lib.ts `getField`), kept for the
   * settings whose meaning is the engine's exact-value test on that line.
   */
  firstFields: Map<string, string>;
  stages: StageInfo[];
}

/** G-1/G-3/G-4: single forward pass, line-oriented, no backtracking (S-RC-4). */
function scan(text: string): Doc {
  const fields = new Map<string, Map<string, string>>();
  const firstFields = new Map<string, string>();
  const stages: StageInfo[] = [];
  let section: string | null = null;
  let phase: Phase | null = null;

  for (const line of text.split(/\r?\n/)) {
    const section_ = SECTION_RE.exec(line);
    if (section_?.[1] !== undefined) {
      section = section_[1];
      phase = null;
      continue;
    }

    const phase_ = PHASE_RE.exec(line);
    if (phase_?.[1] !== undefined) {
      // G-4: an unknown phase heading suppresses its rows rather than
      // inventing a phase for them.
      phase = toPhase(phase_[1]);
      continue;
    }

    const field = FIELD_RE.exec(line);
    if (field?.[1] !== undefined) {
      const value = field[2] ?? "";
      if (!firstFields.has(field[1])) firstFields.set(field[1], value);
      if (section !== null) {
        const bucket = fields.get(section) ?? new Map<string, string>();
        bucket.set(field[1], value);
        fields.set(section, bucket);
        continue;
      }
    }

    if (section !== "Stage Progress" || phase === null) continue;
    const stage = STAGE_RE.exec(line);
    const mark = stage?.[1];
    const slug = stage?.[2];
    const execution = stage?.[3];
    if (mark === undefined || slug === undefined || execution === undefined) continue;

    const marked = MARKS[mark];
    const known = execution === "EXECUTE" || execution === "SKIP";
    const notes: string[] = [];
    if (marked === undefined) notes.push(`unknown-mark: ${JSON.stringify(mark)}`);
    if (!known) notes.push(`unknown-execution: ${execution}`);

    // An unreadable execution column must not inflate the EXECUTE tally that
    // G-6 falls back to, so it degrades to SKIP.
    const scope = execution === "EXECUTE" ? "EXECUTE" : "SKIP";
    const status = marked ?? "not-started";

    stages.push({
      slug,
      phase,
      execution: scope,
      // G-3: the engine leaves out-of-scope rows unticked (`[ ] … — SKIP`) and
      // reserves `[S]` for an in-scope stage jumped over. Both are skipped —
      // an out-of-scope stage is not merely "not started yet". Keyed on the
      // literal token and the parsed mark, never on their fallbacks: those two
      // degradations exist to keep an unreadable row countable, and neither is
      // evidence of what the row actually says.
      status: execution === "SKIP" && marked === "not-started" ? "skipped" : status,
      ...(notes.length > 0 ? { unparseable: notes.join("; ") } : {}),
    });
  }

  return { fields, firstFields, stages };
}

function field(doc: Doc, section: string, name: string): string | undefined {
  const value = doc.fields.get(section)?.get(name);
  return value === undefined || value === "" ? undefined : value;
}

function integer(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * `aidlc-state.ts` writes the literal string `"none"` into `Current Stage`,
 * `Next Stage` (and `In Progress`, unread here) as its "nothing here"
 * sentinel — both when a workflow finishes (`finalize()`, ~line 1513-1516:
 * `Current Stage: none` / `Next Stage: none` alongside `Status: Completed`)
 * and mid-run whenever there is no next stage to name (~line 1371/1502/2162).
 * No stage definition is ever slugged `"none"`, so the literal can never be
 * a real in-scope stage — treat it exactly like an absent field (Codex PR #4
 * finding 1). Without this, `"none"` round-trips as a stage slug that
 * doesn't exist in `doc.stages`, and `timing/estimate.ts` reads a
 * non-existent "current stage" as an unstarted one, billing it the
 * workspace-wide median as phantom remaining work on an already-finished
 * workflow. Do not "fix" this back to passing the literal through — the
 * sentinel is the engine's, not a legitimate slug.
 */
function normalizeNoneSentinel(value: string | undefined): string | undefined {
  return value === "none" ? undefined : value;
}

/**
 * The Construction settings that move or waive Construction approval gates,
 * read the way the engine reads them: first line anywhere, trimmed, compared
 * with one exact value (aidlc-lib.ts `constructionCheckpointsApply`,
 * `isConstructionSwarmEnabled`, `isAutonomousMode`, `isTeamUnitOwnership`,
 * `readUnitGateRhythm`; aidlc-orchestrate.ts `readConstructionIteration`). A
 * Skeleton Stance counts as recorded when its line exists at all, as in the
 * engine's `getField(...) !== null`.
 */
/** aidlc-workflows v2.11.0 `UNIT_NAME_REGEX`, with its 64-character cap. */
const UNIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The Unit checkpoint cache (aidlc-state.ts `unit start|pause|resume`). Only a
 * valid Unit name is kept, and only a `Unit Stage` naming a stage of this
 * workflow, as the engine's resume context does (aidlc-session-start.ts). A
 * missing `Unit State` reads as in progress, the engine's own default there.
 */
function activeUnitOf(doc: Doc): ActiveUnit | undefined {
  const unit = doc.firstFields.get("Active Unit")?.trim() ?? "";
  if (!UNIT_NAME.test(unit)) return undefined;
  const rawStage = doc.firstFields.get("Unit Stage")?.trim() ?? "";
  const stage = doc.stages.some((row) => row.slug === rawStage) ? rawStage : null;
  const state = doc.firstFields.get("Unit State")?.trim() === "paused" ? "paused" : "in-progress";
  return { unit, stage, state };
}

function constructionPolicyOf(doc: Doc): ConstructionGatePolicy {
  const is = (name: string, expected: string): boolean =>
    doc.firstFields.get(name)?.trim() === expected;
  return {
    checkpoints: is("Construction Checkpoints", "enabled"),
    unitMajor: is("Construction Iteration", "unit-major"),
    iterationRecorded: doc.firstFields.has("Construction Iteration"),
    swarm: is("Construction Execution", "swarm"),
    autonomous: is("Construction Autonomy Mode", "autonomous"),
    teamOwnership: is("Unit Ownership", "team"),
    unitEndRhythm: is("Unit Gate Rhythm", "unit-end"),
    skeletonStanceRecorded: doc.firstFields.has("Skeleton Stance"),
    skeletonMayRun: is("Skeleton Stance", "on") || is("Skeleton Stance", "scope-dependent"),
  };
}

/** v2.11.0 aidlc-lib.ts CEREMONY_STATE_LINE_RE. */
const CEREMONY_LINE = /^(on|off)\b(?:\s*\((.*)\))?\s*$/i;

/**
 * The scope-owned ceremonies, read with the engine's `getField` (first line
 * anywhere). The engine falls back to the scope default on an unreadable
 * line; the reader records that line as unparseable and leaves it out.
 */
function ceremoniesOf(doc: Doc): {
  ceremonies: Partial<Record<CeremonyKey, CeremonySetting>>;
  unreadable: string[];
} {
  const ceremonies: Partial<Record<CeremonyKey, CeremonySetting>> = {};
  const unreadable: string[] = [];
  for (const key of CEREMONY_KEYS) {
    const raw = doc.firstFields.get(CEREMONY_FIELDS[key]);
    if (raw === undefined) continue;
    const match = CEREMONY_LINE.exec(raw.trim());
    if (!match) {
      unreadable.push(`unknown ${CEREMONY_FIELDS[key]}: ${raw.trim()}`);
      continue;
    }
    ceremonies[key] = {
      value: (match[1] as string).toLowerCase() as "on" | "off",
      source: match[2]?.trim() || null,
    };
  }
  return { ceremonies, unreadable };
}

/**
 * Pure parser over the file body — the FS-free half of L1, so every G-rule
 * branch is reachable from a unit test (R-RC-2 branch coverage).
 */
/**
 * G-2 alone: the record's State Version, or null when it is missing or not a
 * number. Lets the version check tell whether a record has moved past this
 * Guide's format without interpreting anything else in it.
 */
export function readStateVersion(text: string): number | null {
  const raw = field(scan(text), "Project Information", "State Version");
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
}

export function parseState(text: string): ReadResult<WorkflowModel> {
  // The section split runs first because G-2's version field is section-scoped
  // (it only counts inside `## Project Information`) — locating it needs the
  // document model. The scan is a single linear pass with no interpretation:
  // nothing is derived from an unsupported file, the model is discarded at the
  // gate below.
  const doc = scan(text);

  // G-2: version gate. Unregistered versions are refused outright — no field
  // of an unknown format is ever interpreted.
  const rawVersion = field(doc, "Project Information", "State Version");
  const version =
    rawVersion !== undefined && /^\d+$/.test(rawVersion) ? Number(rawVersion) : undefined;
  if (version === undefined || !isSupportedStateVersion(version)) {
    return { unsupported: true, version: rawVersion ?? "unknown" };
  }

  const unparseable: Record<string, string> = {};
  const warnings: string[] = [];

  const required = (key: keyof WorkflowModel, section: string, name: string): string => {
    const value = field(doc, section, name);
    if (value === undefined) unparseable[key] = `missing field: ${section} → ${name}`;
    return value ?? "";
  };

  const project = required("project", "Project Information", "Project");
  const scope = required("scope", "Project Information", "Scope");
  const depth = required("depth", "Scope Configuration", "Depth");
  // Unlike an absent legacy field, an explicitly blank policy is invalid upstream.
  const policyFields = doc.fields.get("Scope Configuration");
  const rawModern = policyFields?.get("Guard Policy");
  const rawLegacy = policyFields?.get("Change Control");
  const rawGuardPolicy = rawModern ?? rawLegacy;
  const guardPolicyMatch = rawGuardPolicy
    ?.trim()
    .match(/^(strict|relaxed|off)\b(?:\s*\((.*)\))?\s*$/i);
  let guardPolicy: WorkflowModel["guardPolicy"];
  if (guardPolicyMatch) {
    guardPolicy = {
      value: guardPolicyMatch[1]?.toLowerCase() as "strict" | "relaxed" | "off",
      source: guardPolicyMatch[2]?.trim() || null,
    };
  } else if (rawGuardPolicy !== undefined) {
    unparseable.guardPolicy = `unknown Guard Policy: ${rawGuardPolicy}`;
  }
  if (rawModern !== undefined && rawLegacy !== undefined) {
    const retired = /^(strict|relaxed|off)\b(?:\s*\((.*)\))?\s*$/i.exec(rawLegacy.trim());
    if (
      !guardPolicyMatch ||
      !retired ||
      guardPolicyMatch[1]?.toLowerCase() !== retired[1]?.toLowerCase()
    ) {
      guardPolicy = undefined;
      unparseable.guardPolicy = "conflicting Guard Policy and Change Control records";
    }
  }

  const { ceremonies, unreadable } = ceremoniesOf(doc);
  if (unreadable.length > 0) unparseable.ceremonies = unreadable.join("; ");
  const rawProjectType = doc.firstFields.get("Project Type")?.trim();
  const plan = doc.firstFields.get("Plan")?.trim();

  const rawPhase = field(doc, "Current Status", "Lifecycle Phase");
  const phase = rawPhase === undefined ? null : toPhase(rawPhase);
  if (phase === null) {
    unparseable.phase = rawPhase === undefined ? "missing field" : `unknown phase: ${rawPhase}`;
  }

  // G-5: field first, [x]+[S] tally as fallback. Scoped to EXECUTE rows so the
  // fallback shares G-6's denominator — out-of-scope rows are skipped by
  // definition and would otherwise push done past total.
  const doneField = integer(field(doc, "Execution Plan Summary", "Completed"));
  const doneTally = doc.stages.filter(
    (s) => s.execution === "EXECUTE" && (s.status === "completed" || s.status === "skipped"),
  ).length;

  // G-6: field first, EXECUTE-row count as fallback. On disagreement the field
  // wins and the mismatch is surfaced — state is the engine's property, the
  // reader reports rather than adjudicates.
  const totalField = integer(field(doc, "Execution Plan Summary", "Total Stages"));
  const totalTally = doc.stages.filter((s) => s.execution === "EXECUTE").length;
  if (totalField !== undefined && totalField !== totalTally) {
    warnings.push(
      `Total Stages field (${totalField}) disagrees with the EXECUTE row count (${totalTally})`,
    );
  }

  const currentStage = normalizeNoneSentinel(field(doc, "Current Status", "Current Stage")) ?? null;
  const activeUnit = activeUnitOf(doc);
  const model: WorkflowModel = {
    project,
    scope,
    depth,
    ...(guardPolicy === undefined ? {} : { guardPolicy }),
    ...(Object.keys(ceremonies).length === 0 ? {} : { ceremonies }),
    ...(rawProjectType
      ? {
          projectType: {
            value: rawProjectType,
            source: doc.firstFields.get("Project Type Source")?.trim() || null,
          },
        }
      : {}),
    ...(plan ? { plan } : {}),
    stateVersion: version,
    // `phase` stays typed as Phase; consumers must consult `unparseable.phase`
    // before trusting it (BR-RC-5 field-level degradation).
    phase: phase ?? "INITIALIZATION",
    currentStage,
    nextStage: normalizeNoneSentinel(field(doc, "Current Status", "Next Stage")) ?? null,
    gate: doc.stages.find((s) => s.slug === currentStage)?.status ?? null,
    stages: doc.stages,
    done: doneField ?? doneTally,
    total: totalField ?? totalTally,
    constructionPolicy: constructionPolicyOf(doc),
    ...(activeUnit === undefined ? {} : { activeUnit }),
    ...(Object.keys(unparseable).length > 0 ? { unparseable } : {}),
  };

  return warnings.length > 0 ? { ok: true, value: model, warnings } : { ok: true, value: model };
}

/** L1 entry point: bounded read (S-RC-4) then {@link parseState}. */
export async function readState(recordDir: string): Promise<ReadResult<WorkflowModel>> {
  const read = await readBounded(path.join(recordDir, STATE_FILENAME));
  if (!read.ok) {
    if (read.reason === "not-found") return { error: true, reason: "state-missing" };
    if (read.reason === "file-too-large") return { error: true, reason: "file-too-large" };
    return { error: true, reason: "state-unreadable" };
  }
  return parseState(read.value);
}
