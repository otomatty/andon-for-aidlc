import type { DocsQaResult } from "@andon/shared-types";
import type { GuideService } from "../service.ts";
import type { RouteResult } from "./read.ts";

type Action = "ask" | "cancel" | "evidence";

function response(result: DocsQaResult<unknown>): RouteResult {
  return {
    status:
      "ok" in result
        ? 200
        : result.reason === "busy"
          ? 409
          : result.reason === "not-found"
            ? 404
            : 400,
    body: result,
  };
}

export async function routeDocsQa(
  service: GuideService,
  action: Action,
  body: unknown,
): Promise<RouteResult> {
  const qa = service.docsQa;
  if (qa === undefined) return { status: 503, body: { error: true, reason: "unavailable" } };
  if (action === "ask") return response(await qa.start(body));
  if (action === "evidence") return response(await qa.evidence(body));
  const id = typeof body === "object" && body !== null && "id" in body ? body.id : undefined;
  return response(typeof id === "string" ? qa.cancel(id) : { error: true, reason: "bad-request" });
}

/** A browser page from another site must not launch local CLI processes. */
function acceptsOrigin(request: Request): boolean {
  const server = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(server.hostname)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const caller = new URL(origin);
    if (caller.origin === server.origin) return true;
    // Vite's development proxy changes the port but retains the loopback host.
    return (
      caller.protocol === server.protocol &&
      caller.hostname === server.hostname &&
      ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname)
    );
  } catch {
    return false;
  }
}

export async function handleDocsQa(
  service: GuideService,
  action: Action,
  request: Request,
): Promise<Response> {
  if (!acceptsOrigin(request))
    return Response.json({ error: true, reason: "forbidden-origin" }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
    return Response.json({ error: true, reason: "json-required" }, { status: 415 });
  }
  const reader = request.body?.getReader();
  if (reader === undefined)
    return Response.json({ error: true, reason: "bad-request" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 128_000) {
        await reader.cancel();
        return Response.json({ error: true, reason: "body-too-large" }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const result = await routeDocsQa(service, action, body);
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: true, reason: "bad-request" }, { status: 400 });
  } finally {
    reader.releaseLock();
  }
}
