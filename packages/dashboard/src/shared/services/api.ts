import type {
  AgentDoc,
  EffectivenessPayload,
  IntentList,
  MarkdownDoc,
  MarkdownItem,
  Matrix,
  OfficialDocsLocale,
  OfficialDocsManifest,
  OfficialDocsPage,
  OfficialDocsToc,
  ProjectLink,
  ReadResult,
  SpaceCatalog,
  StageDoc,
  StageDocRef,
  StageIoPaths,
  StageModelsPayload,
  TimingsPayload,
  WorkflowPayload,
} from "@aidlc-guide/shared-types";
import type { Action, MatrixResponse } from "@/store/reducer.ts";
import { getTransport } from "@/services/transport/index.ts";

/**
 * The whole client surface. **GET only** — there is no POST helper in this
 * module and no other module issues requests, which is how S-UI-1 ("this unit
 * emits zero writes") is enforced structurally rather than by review.
 * `POST /api/answer` belongs to the artifact-viewer unit.
 */

/** Transport failure reason; joins the server's own StandardReason values. */
const UNREACHABLE = "server-unreachable";

export const fetchStageModels = (): Promise<ReadResult<StageModelsPayload>> =>
  getResult("/api/stage-models");

function unreachable<T>(): ReadResult<T> {
  return { error: true, reason: UNREACHABLE };
}

/** A `ReadResult` shape passed through verbatim by the server's `mapResult`. */
function asReadResult<T>(body: unknown): ReadResult<T> {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (record.ok === true || record.unsupported === true || record.error === true) {
      return body as ReadResult<T>;
    }
  }
  return { error: true, reason: "unexpected-response" };
}

async function getJson(path: string) {
  return await getTransport().getJson(path);
}

/** The one GET→ReadResult wrapper — every plain endpoint fetcher is this. */
async function getResult<T>(path: string): Promise<ReadResult<T>> {
  const fetched = await getJson(path);
  return fetched.reached ? asReadResult<T>(fetched.body) : unreachable();
}

export async function fetchWorkflow(): Promise<ReadResult<WorkflowPayload>> {
  const fetched = await getJson("/api/workflow");
  if (!fetched.reached) return unreachable();
  const body = fetched.body;
  if (typeof body === "object" && body !== null && "workflow" in body) {
    const payload = body as WorkflowPayload;
    return payload.warnings === undefined
      ? { ok: true, value: payload }
      : { ok: true, value: payload, warnings: payload.warnings };
  }
  return asReadResult(body);
}

export async function fetchMatrix(): Promise<MatrixResponse> {
  const fetched = await getJson("/api/matrix");
  if (!fetched.reached) return unreachable<Matrix>();
  const body = fetched.body;
  if (typeof body === "object" && body !== null && "building" in body) return { building: true };
  return asReadResult<Matrix>(body);
}

async function readArtifact(path: string): Promise<ReadResult<string>> {
  return await getResult<string>(`/api/artifact?path=${encodeURIComponent(path)}`);
}

const inFlight = new Map<string, Promise<ReadResult<string>>>();

export function prefetchArtifact(path: string): void {
  inFlight.set(path, readArtifact(path));
}

export function clearArtifactPrefetch(): void {
  inFlight.clear();
}

export async function fetchArtifact(path: string): Promise<ReadResult<string>> {
  const pending = inFlight.get(path);
  if (pending === undefined) return await readArtifact(path);
  inFlight.delete(path);
  return await pending;
}

export const fetchStageDoc = (slug: string): Promise<ReadResult<StageDoc>> =>
  getResult(`/api/stage/${encodeURIComponent(slug)}`);

export function fetchIoPaths(
  stage: string,
  unit: string | null,
): Promise<ReadResult<StageIoPaths>> {
  const q = new URLSearchParams({ stage });
  if (unit !== null) q.set("unit", unit);
  return getResult(`/api/io-paths?${q}`);
}

export const fetchIntents = (): Promise<ReadResult<IntentList>> => getResult("/api/intents");

export const fetchSpaces = (): Promise<ReadResult<SpaceCatalog>> => getResult("/api/spaces");

export const fetchLinks = (): Promise<ReadResult<ProjectLink[]>> => getResult("/api/links");

export const fetchTimings = (): Promise<ReadResult<TimingsPayload>> => getResult("/api/timings");

export const fetchEffectiveness = (): Promise<ReadResult<EffectivenessPayload>> =>
  getResult("/api/effectiveness");

export const fetchGuides = (): Promise<ReadResult<MarkdownItem[]>> => getResult("/api/guides");

export const fetchGuide = (name: string): Promise<ReadResult<MarkdownDoc>> =>
  getResult(`/api/guides/${encodeURIComponent(name)}`);

/** Encode a DocPath (`guide/…`) so each segment stays a path segment on the wire. */
function encodeDocPath(docPath: string): string {
  return docPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export const fetchOfficialDocsManifest = (): Promise<ReadResult<OfficialDocsManifest>> =>
  getResult("/api/official-docs/manifest");

export const fetchOfficialDocsToc = (
  locale: OfficialDocsLocale,
): Promise<ReadResult<OfficialDocsToc>> =>
  getResult(`/api/official-docs/toc/${encodeURIComponent(locale)}`);

export function fetchOfficialDocsPage(
  locale: OfficialDocsLocale,
  docPath: string,
  anchor?: string,
): Promise<ReadResult<OfficialDocsPage>> {
  const base = `/api/official-docs/${encodeURIComponent(locale)}/${encodeDocPath(docPath)}`;
  if (anchor === undefined || anchor === "") return getResult(base);
  const q = new URLSearchParams({ anchor });
  return getResult(`${base}?${q}`);
}

/** `GET /api/official-docs/stage/:slug` — mapped StageDocRef or null (unmapped). */
export const fetchOfficialDocsStageMap = (slug: string): Promise<ReadResult<StageDocRef | null>> =>
  getResult(`/api/official-docs/stage/${encodeURIComponent(slug)}`);

export const fetchAgent = (id: string): Promise<ReadResult<AgentDoc>> =>
  getResult(`/api/agents/${encodeURIComponent(id)}`);

export const fetchAgentKnowledge = (
  agentId: string,
  name: string,
): Promise<ReadResult<MarkdownDoc>> =>
  getResult(`/api/agents/${encodeURIComponent(agentId)}/knowledge/${encodeURIComponent(name)}`);

let snapshotGen = 0;

/** Generation of the in-flight record-scoped REST snapshot (0 before any claim). */
export function snapshotToken(): number {
  return snapshotGen;
}

export function snapshotCurrent(token: number): boolean {
  return token === snapshotGen;
}

function claimSnapshot(): number {
  return ++snapshotGen;
}

async function dispatchSnapshot(dispatch: (action: Action) => void, token: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [workflow, matrix, intents] = await Promise.all([
      fetchWorkflow(),
      fetchMatrix(),
      fetchIntents(),
    ]);
    if (!snapshotCurrent(token)) return;
    const matches = (record: Matrix["record"]): boolean =>
      "ok" in intents &&
      record !== undefined &&
      record.space === intents.value.space &&
      record.intent === intents.value.selected;
    const consistent =
      (!("ok" in workflow) || matches(workflow.value.workflow.record)) &&
      (!("ok" in matrix) || matches(matrix.value.record));
    if (!consistent && attempt < 2) continue;
    // One batch must describe one record, even when no newer client request exists.
    // Exhaustion clears the old record rather than displaying an unchecked mixture.
    const changed = { error: true as const, reason: "selection-changed" };
    dispatch({ type: "intents", result: intents });
    dispatch({ type: "workflow", result: consistent ? workflow : changed });
    dispatch({ type: "matrix", result: consistent ? matrix : changed });
    return;
  }
}

export async function refetchAll(dispatch: (action: Action) => void): Promise<void> {
  clearArtifactPrefetch();
  await dispatchSnapshot(dispatch, claimSnapshot());
}

export async function refetchAfterSpaceSelect(
  dispatch: (action: Action) => void,
  space: string,
  intent: string | null,
): Promise<void> {
  const token = claimSnapshot();
  clearArtifactPrefetch();
  dispatch({
    type: "ws",
    message: { type: "space-selected", space, intent },
    receivedAt: new Date().toISOString(),
  });
  await dispatchSnapshot(dispatch, token);
}

/** After a view-pin change: close record-scoped UI, then refetch the ADR-03 three. */
export async function refetchAfterIntentSelect(
  dispatch: (action: Action) => void,
  intent: string | null,
): Promise<void> {
  clearArtifactPrefetch();
  dispatch({
    type: "ws",
    message: { type: "intent-selected", intent },
    receivedAt: new Date().toISOString(),
  });
  await dispatchSnapshot(dispatch, claimSnapshot());
}
