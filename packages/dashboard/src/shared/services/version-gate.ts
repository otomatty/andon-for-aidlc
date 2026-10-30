import type { VersionGate } from "@andon/shared-types";
import { createContext, useContext } from "react";

/**
 * The client half of the version check (docs/maintenance/version-gate-design.md).
 * The server refuses every blocked request with `reason: "version-gate"` and the
 * gate itself, so the webview and the browser dashboard learn about it the same
 * way: from whichever request reached the server first.
 */

const STATUSES = new Set<VersionGate["status"]>([
  "ok",
  "not-installed",
  "unknown",
  "project-newer",
  "project-older",
  "engine-mismatch",
  "engine-newer",
]);

/** The gate carried by a refusal, or null for any other body. */
export function versionGateOf(body: unknown): VersionGate | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.error !== true || record.reason !== "version-gate") return null;
  const gate = record.gate as Partial<VersionGate> | undefined;
  if (
    typeof gate !== "object" ||
    gate === null ||
    !STATUSES.has(gate.status as VersionGate["status"]) ||
    typeof gate.target !== "string" ||
    typeof gate.message !== "string" ||
    !Array.isArray(gate.tools)
  )
    return null;
  return gate as VersionGate;
}

const listeners = new Set<(gate: VersionGate) => void>();

/** Called by the API layer on every response; a refusal blocks the whole app. */
export function reportVersionGate(body: unknown): void {
  const gate = versionGateOf(body);
  if (gate === null) return;
  for (const listener of listeners) listener(gate);
}

export function onVersionGate(listener: (gate: VersionGate) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current gate while blocked; null when the workspace may be used. */
export const VersionGateContext = createContext<VersionGate | null>(null);

export function useVersionGate(): VersionGate | null {
  return useContext(VersionGateContext);
}
