import { inspectVersionGate } from "@aidlc-guide/reader-core";
import { type VersionGate, WORKFLOWS_TARGET_VERSION } from "@aidlc-guide/shared-types";
import type { RouteResult } from "./handlers/read.ts";

/**
 * Server-side half of the version check (docs/maintenance/version-gate-design.md).
 * The dashboard hides blocked screens itself; this refuses the same requests so a
 * missed branch in the UI, the browser dashboard, or a stale tab cannot read past it.
 */

/** Bundled docs stay readable while blocked; they do not depend on the project's version. */
export function isVersionGateOpenRoute(route: string): boolean {
  return (
    route.startsWith("/api/official-docs/") ||
    route === "/api/guides" ||
    route.startsWith("/api/guides/")
  );
}

/** How long one check answers a burst of requests before the files are read again. */
const GATE_TTL_MS = 1_000;

export interface VersionGateCheck {
  /** The current gate, or null when checking is switched off. */
  current(): VersionGate | null;
  invalidate(): void;
}

export function createVersionGateCheck(
  workspaceRoot: string,
  inspect: (() => VersionGate) | null | undefined,
): VersionGateCheck {
  if (inspect === null) return { current: () => null, invalidate: () => {} };
  const read = inspect ?? (() => inspectVersionGate(workspaceRoot, WORKFLOWS_TARGET_VERSION));
  let cached: { gate: VersionGate; at: number } | null = null;
  return {
    current() {
      const now = Date.now();
      if (cached === null || now - cached.at >= GATE_TTL_MS) cached = { gate: read(), at: now };
      return cached.gate;
    },
    invalidate() {
      cached = null;
    },
  };
}

/** The refusal for a blocked route, or null when the request may proceed. */
export function versionGateRefusal(
  check: (() => VersionGate | null) | undefined,
  route: string,
): RouteResult | null {
  if (check === undefined || isVersionGateOpenRoute(route)) return null;
  const gate = check();
  if (gate === null || gate.status === "ok") return null;
  return {
    status: 409,
    body: { error: true, reason: "version-gate", detail: gate.message, gate },
  };
}
