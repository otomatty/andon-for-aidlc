/**
 * The viewer's addressing rules, in a leaf module so that `DetailPanel` can use
 * them without dragging the viewer chunk into the initial bundle (P-AV-1).
 * `artifactPath` itself is the shared wire formula — re-exported so the
 * prefetch and the viewer's initial state agree by construction (P-AV-2).
 */
export { artifactPath } from "@andon/shared-types";

/** The artifact a cell opens with. `null` when the cell holds none. */
export function firstArtifact(files: readonly string[]): string | null {
  return files[0] ?? null;
}
