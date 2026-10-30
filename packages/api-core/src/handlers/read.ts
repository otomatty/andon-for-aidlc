import type { Bridge } from "@aidlc-guide/docs-bridge";
import { guardPath, nextStepOf, type Reader, readStageModels } from "@aidlc-guide/reader-core";
import type {
  IntentList,
  Matrix,
  ReadResult,
  VersionGate,
  SpaceCatalog,
  WorkflowPayload,
} from "@aidlc-guide/shared-types";
import type { CustomizationService } from "../customization/index.ts";
import type { DocsQaService } from "../docs-qa/index.ts";
import { readAgentKnowledge, resolveAgent } from "./agents.ts";
import { routeCustomizationRead } from "./customization.ts";
import { listGuides, readGuide } from "./guides.ts";
import { buildStageIoPaths } from "./io-paths.ts";
import {
  officialDocsManifest,
  officialDocsPage,
  officialDocsStageMap,
  officialDocsToc,
} from "./official-docs.ts";
import { buildPreflight } from "./preflight.ts";
import { versionGateRefusal } from "../version-gate.ts";

/**
 * The seven GET handlers plus {@link mapResult} — the single ReadResult→HTTP
 * mapping (R-DS-1). No handler writes its own mapping.
 */

export interface RouteResult {
  status: number;
  body: unknown;
}

/**
 * The one 404 sentinel for an unrecognised `/api/*` path — shared with the
 * VS Code postMessage transport so the wire shape is declared once.
 */
export const UNKNOWN_ROUTE: RouteResult = {
  status: 404,
  body: { error: true, reason: "unknown-route" },
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Only two reasons are entry-level enough to earn a non-200 status. Everything
 * else — including `unsupported`, `no-active-intent` and internal faults — is
 * 200 with the payload, because the UI has to *render* degradation rather than
 * treat it as a dead endpoint (BR-DS-4 / NFR-6 fail-soft).
 *
 * A 500 from this server therefore always means a server bug, never a
 * degraded workspace.
 */
const STATUS_BY_REASON: Readonly<Record<string, number>> = {
  "outside-record": 403,
  "artifact-not-found": 404,
  path_rejected: 403,
  not_found: 404,
  empty_content: 404,
};

export function statusForResult<T>(result: ReadResult<T>): number {
  if ("ok" in result || "unsupported" in result) return 200;
  return STATUS_BY_REASON[result.reason] ?? 200;
}

/**
 * The ReadResult *is* the payload: passing it through verbatim keeps warnings
 * and the `unsupported`/`error` discriminants intact, so the client reuses the
 * same union it already has from shared-types. Only the status varies.
 */
export function mapResult<T>(result: ReadResult<T>): Response {
  return json(result, statusForResult(result));
}

export function mapResultRoute<T>(result: ReadResult<T>): RouteResult {
  return { status: statusForResult(result), body: result };
}

export interface ReadContext {
  intents?(): Promise<ReadResult<IntentList>>;
  spaces?(): Promise<ReadResult<SpaceCatalog>>;
  customization?: CustomizationService;
  docsQa?: DocsQaService;
  reader: Reader;
  bridge: Bridge;
  /** Workspace root — used for `docs/guides` and similar repo-local reads. */
  workspaceRoot: string;
  /**
   * Root that contains `docs/guide|reference` + official-docs manifest.
   * Defaults to {@link workspaceRoot}; the VS Code extension sets this to the
   * packaged snapshot under `media/official-docs` so installed VSIX hosts do
   * not read the user's workspace tree as official content.
   */
  officialDocsRoot: string;
  recordDir(): Promise<ReadResult<string>>;
  /** Current Dashboard view pin. Overlay onto `GET /api/intents`. */
  selected(): string | null;
  /** `null` until the background scan finishes (stage 2 of startup). */
  matrix(): ReadResult<Matrix> | null;
  /**
   * The version check every route but bundled docs must pass. Absent on
   * hand-built contexts; {@link createGuideService} always sets it.
   */
  versionGate?: () => VersionGate | null;
}

const STAGE_ROUTE = /^\/api\/stage\/(.+)$/;
const GUIDE_ROUTE = /^\/api\/guides\/(.+)$/;
const OFFICIAL_DOCS_TOC = /^\/api\/official-docs\/toc\/([^/]+)$/;
const OFFICIAL_DOCS_PAGE = /^\/api\/official-docs\/([^/]+)\/(.+)$/;
const OFFICIAL_DOCS_STAGE = /^\/api\/official-docs\/stage\/([^/]+)$/;
const AGENT_KNOWLEDGE_ROUTE = /^\/api\/agents\/([^/]+)\/knowledge\/(.+)$/;
const AGENT_ROUTE = /^\/api\/agents\/([^/]+)$/;

/**
 * Stage 1 of first paint: one state parse, no full scan (P-DS-1). Deliberately
 * carries **no** `matrix` key — the matrix arrives later over `/api/matrix` and
 * the `matrix-ready` push (ADR-03 段階的初回描画).
 */
async function workflow(ctx: ReadContext): Promise<RouteResult> {
  // One read for both slices: `nextStepOf` derives from the same state parse,
  // so this path costs a single cursor-resolve + parse (P-DS-1).
  const state = await ctx.reader.getWorkflow();
  if (!("ok" in state)) return mapResultRoute(state);
  const body: WorkflowPayload = {
    workflow: state.value,
    nextStep: nextStepOf(state.value),
    ...(state.warnings === undefined ? {} : { warnings: state.warnings }),
  };
  return { status: 200, body };
}

/**
 * Second check point on this path. `reader.readArtifact` guards internally too;
 * that duplication is deliberate defence in depth (S-DS-4) — unlike
 * `/api/answer`, which never goes through the reader and so has exactly one.
 */
async function artifact(ctx: ReadContext, url: URL): Promise<RouteResult> {
  const rel = url.searchParams.get("path");
  if (rel === null) return { status: 400, body: { error: true, reason: "missing-path" } };
  const record = await ctx.recordDir();
  if (!("ok" in record)) return mapResultRoute(record);
  const guarded = await guardPath(record.value, rel);
  if (!("ok" in guarded)) return mapResultRoute(guarded);
  return mapResultRoute(await ctx.reader.readArtifact(rel));
}

/** Transport-agnostic GET routing — used by HTTP and VS Code postMessage. */
export async function routeRead(ctx: ReadContext, url: URL): Promise<RouteResult | null> {
  const route = url.pathname;
  const refused = versionGateRefusal(ctx.versionGate, route);
  if (refused !== null) return refused;
  const customization = await routeCustomizationRead(ctx.customization, url);
  if (customization) return customization;

  if (route === "/api/docs-qa/tools") {
    return {
      status: 200,
      body: {
        ok: true,
        value: (await ctx.docsQa?.tools(url.searchParams.get("recheck") === "true")) ?? [],
      },
    };
  }
  if (route === "/api/docs-qa/job") {
    return {
      status: 200,
      body: ctx.docsQa?.get(url.searchParams.get("id") ?? "") ?? {
        error: true,
        reason: "unavailable",
      },
    };
  }

  if (route === "/api/spaces")
    return mapResultRoute((await ctx.spaces?.()) ?? { error: true, reason: "unavailable" });
  if (route === "/api/workflow") return await workflow(ctx);
  if (route === "/api/stage-models") {
    const record = await ctx.recordDir();
    return mapResultRoute(
      await readStageModels(ctx.workspaceRoot, "ok" in record ? record.value : null),
    );
  }
  // Deliberately its own route, not a key on /api/workflow: a full audit parse
  // must stay off the first-paint critical path (ADR-03 / NFR-2 3秒).
  if (route === "/api/timings") return mapResultRoute(await ctx.reader.getTimings());
  // Space-wide audit aggregation is requested only by the effectiveness view.
  if (route === "/api/effectiveness") return mapResultRoute(await ctx.reader.getEffectiveness());
  if (route === "/api/matrix") {
    await ctx.recordDir();
    const built = ctx.matrix();
    return built === null ? { status: 200, body: { building: true } } : mapResultRoute(built);
  }
  if (route === "/api/io-paths") {
    const stage = url.searchParams.get("stage");
    if (stage === null || stage.trim() === "") {
      return { status: 400, body: { error: true, reason: "missing-stage" } };
    }
    const unitParam = url.searchParams.get("unit");
    const unit = unitParam !== null && unitParam.trim() !== "" ? unitParam.trim() : null;
    const record = await ctx.recordDir();
    if (!("ok" in record)) return mapResultRoute(record);
    return mapResultRoute(await buildStageIoPaths(record.value, stage.trim(), unit));
  }
  if (route === "/api/artifact") return await artifact(ctx, url);
  if (route === "/api/intents") {
    if (ctx.intents) return mapResultRoute(await ctx.intents());
    await ctx.recordDir();
    const list = await ctx.reader.getIntents();
    if (!("ok" in list)) return mapResultRoute(list);
    return mapResultRoute({
      ok: true,
      value: { ...list.value, selected: ctx.selected() },
      ...(list.warnings === undefined ? {} : { warnings: list.warnings }),
    });
  }
  if (route === "/api/links") return mapResultRoute(await ctx.bridge.projectLinks());
  if (route === "/api/guides") return mapResultRoute(await listGuides(ctx.officialDocsRoot));

  if (route === "/api/preflight") {
    const text = url.searchParams.get("text");
    // fail-soft ペイロード（PreflightPayload 自身が部分応答を表現する）。
    return { status: 200, body: await buildPreflight(ctx.workspaceRoot, text) };
  }

  if (route === "/api/official-docs/manifest") {
    return mapResultRoute(await officialDocsManifest(ctx.officialDocsRoot));
  }

  const officialStage = OFFICIAL_DOCS_STAGE.exec(route);
  if (officialStage?.[1] !== undefined) {
    return mapResultRoute(officialDocsStageMap(decodeURIComponent(officialStage[1])));
  }

  const officialToc = OFFICIAL_DOCS_TOC.exec(route);
  if (officialToc?.[1] !== undefined) {
    return mapResultRoute(
      await officialDocsToc(ctx.officialDocsRoot, decodeURIComponent(officialToc[1])),
    );
  }

  const officialPage = OFFICIAL_DOCS_PAGE.exec(route);
  if (officialPage?.[1] !== undefined && officialPage[2] !== undefined) {
    const locale = decodeURIComponent(officialPage[1]);
    // splat is guide%2F… or guide/… — normalize to DocPath
    const docPath = decodeURIComponent(officialPage[2]);
    const anchor = url.searchParams.get("anchor") ?? undefined;
    return mapResultRoute(await officialDocsPage(ctx.officialDocsRoot, locale, docPath, anchor));
  }

  const guide = GUIDE_ROUTE.exec(route);
  if (guide?.[1] !== undefined) {
    return mapResultRoute(await readGuide(ctx.officialDocsRoot, decodeURIComponent(guide[1])));
  }

  const agentKnowledge = AGENT_KNOWLEDGE_ROUTE.exec(route);
  if (agentKnowledge?.[1] !== undefined && agentKnowledge[2] !== undefined) {
    return mapResultRoute(
      await readAgentKnowledge(
        ctx.workspaceRoot,
        decodeURIComponent(agentKnowledge[1]),
        decodeURIComponent(agentKnowledge[2]),
      ),
    );
  }

  const agent = AGENT_ROUTE.exec(route);
  if (agent?.[1] !== undefined) {
    return mapResultRoute(await resolveAgent(ctx.workspaceRoot, decodeURIComponent(agent[1])));
  }

  const stage = STAGE_ROUTE.exec(route);
  if (stage?.[1] !== undefined) {
    return mapResultRoute(await ctx.bridge.resolveStage(decodeURIComponent(stage[1])));
  }

  if (route.startsWith("/api/")) return UNKNOWN_ROUTE;
  return null;
}

/** `null` when the path is not an API route — the caller falls back to static. */
export async function handleRead(ctx: ReadContext, url: URL): Promise<Response | null> {
  if (
    url.pathname.startsWith("/api/docs-qa/") &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    return json({ error: true, reason: "forbidden-origin" }, 403);
  }
  const result = await routeRead(ctx, url);
  if (result === null) return null;
  const response = json(result.body, result.status);
  if (url.pathname.startsWith("/api/docs-qa/")) response.headers.set("Cache-Control", "no-store");
  return response;
}
