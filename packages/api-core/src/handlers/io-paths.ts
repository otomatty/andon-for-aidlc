import {
  artifactDocIndex,
  artifactDocsOf,
  artifactProducerOf,
  stageIoOf,
} from "@andon/docs-bridge";
import { listMarkdownRel, pickIoPath } from "@andon/reader-core";
import type { ReadResult, StageIoPaths } from "@andon/shared-types";

export async function buildStageIoPaths(
  recordDir: string,
  stage: string,
  unit: string | null,
): Promise<ReadResult<StageIoPaths>> {
  const key = stage.trim();
  const io = stageIoOf(key);
  if (io === undefined) return { error: true, reason: "not-found" };

  const listed = await listMarkdownRel(recordDir);
  if (!("ok" in listed)) return listed;

  // A canonical artifact name is not always its filename: `build-test-results`
  // lands as `test-results.md`. Probing `<name>.md` alone silently resolves
  // those to null and renders the artifact as dead text instead of a link.
  //
  // Both names are tried, canonical first. Records committed under
  // `aidlc/spaces/` were written with the canonical name, so replacing rather
  // than extending the probe would unlink every one of them; the mapping is
  // additive reach, not a correction. Own outputs win over the shared index,
  // which answers for inputs another stage produced.
  //
  // A `.json` mapping is skipped: `listMarkdownRel` lists `.md` and nothing
  // else, so it can never match, and the canonical `<name>.md` probe still
  // finds the `traceability.md` a State Version 7 record wrote.
  const own = artifactDocsOf(key);
  const candidates = (name: string): string[] => {
    if (name.endsWith(".md")) return [name];
    const mapped = own[name]?.fileName ?? artifactDocIndex().get(name)?.fileName;
    const canonical = `${name}.md`;
    return mapped === undefined || mapped === canonical || !mapped.endsWith(".md")
      ? [canonical]
      : [canonical, mapped];
  };

  /**
   * A mapped filename is searched only under the stage that writes it.
   * `test-results.md` is written by Build and Test AND by Performance
   * Validation, in different phases, so an unscoped probe hands Feedback &
   * Optimization's `load-test-results` input the build results instead. The
   * canonical name keeps searching the whole record: it is unambiguous, and
   * narrowing it would unlink records whose layout predates these names.
   */
  const scopeFor = (name: string, fileName: string): readonly string[] => {
    if (fileName === `${name}.md`) return listed.value;
    const producer = own[name] === undefined ? artifactProducerOf(name) : key;
    return producer === undefined
      ? listed.value
      : listed.value.filter((hit) => hit.split("/").includes(producer));
  };
  // Two passes, not one loop: `pickIoPath` ends a candidate on a best-effort
  // match — a lone file under another construction stage, or a lone file
  // outside `construction/` — so trying one name to exhaustion would let those
  // beat the genuinely stage-specific file matching another name. Every
  // candidate gets its specific chance before any of them guesses.
  const resolve = (name: string): string | null => {
    const names = candidates(name);
    for (const fileName of names) {
      const scope = scopeFor(name, fileName);
      const hit = pickIoPath(scope, fileName, { unit, stage: key, specificOnly: true });
      if (hit !== null) return hit;
    }
    for (const fileName of names) {
      const hit = pickIoPath(scopeFor(name, fileName), fileName, { unit, stage: key });
      if (hit !== null) return hit;
    }
    return null;
  };

  return {
    ok: true,
    value: {
      stage: key,
      unit,
      inputs: Object.fromEntries(io.inputs.map((name) => [name, resolve(name)])),
      outputs: Object.fromEntries(io.outputs.map((name) => [name, resolve(name)])),
    },
  };
}
