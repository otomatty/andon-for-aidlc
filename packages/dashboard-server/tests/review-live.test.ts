import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createGuideService } from "@andon/api-core";
import type { MatrixCell, WsMessage } from "@andon/shared-types";
import { expect, it } from "vitest";
import { reviewFixture } from "../../reader-core/tests/review-fixtures.ts";
import { REPO_ROOT, seedWorkspace } from "./support.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const SOURCE_BODY = "export const answer = 42;\n";
const MANIFEST =
  '{"stage":"code-generation","unit":"unit-alpha","version":1,"writes":[{"path":"app.ts"}]}';
const verdict = (cells: readonly MatrixCell[]) =>
  cells.find((cell) => cell.unit === "unit-alpha" && cell.stage === "code-generation")?.verdict;

it("refreshes live and cached review verdicts when application sources change", async () => {
  const { root, recordDir } = await seedWorkspace();
  let dispose = () => {};
  try {
    const data = path.join(root, ".claude/tools/data");
    await mkdir(data, { recursive: true });
    await writeFile(path.join(data, "harness.json"), '{"name":"claude"}');
    await writeFile(
      path.join(data, "stage-graph.json"),
      JSON.stringify([
        {
          slug: "code-generation",
          phase: "construction",
          for_each: "unit-of-work",
          produces: ["code-summary"],
          review_artifact: "code-summary",
          workspace_requires: true,
        },
      ]),
    );
    const logical = "construction/unit-alpha/code-generation/code-summary.md";
    const body = "# Code summary\n";
    const stageDir = path.dirname(path.join(recordDir, logical));
    await mkdir(stageDir, { recursive: true });
    await writeFile(path.join(recordDir, logical), body);
    await writeFile(path.join(stageDir, "source-manifest.json"), MANIFEST);
    const app = path.join(root, "app.ts");
    await writeFile(app, SOURCE_BODY);
    const fixture = reviewFixture({
      stage: "code-generation",
      fingerprint: `sha256:${sha(JSON.stringify([[logical, `sha256:${sha(body)}`]]))}`,
      // Fixed v2.8.2 single-file workspace and unit source identities.
      sourceFingerprint: "b5b6888d58124a1c833e56fd8bb8947100d139cff78fa7fa1070ed68c7db21e6",
      unitSourceFingerprint:
        "sha256:034ea79cb458cb30b07539a413fd36afef9505f51a8cf303b79297472075ff98",
    });
    const reviewFile = path.join(recordDir, fixture.relative);
    await mkdir(path.dirname(reviewFile), { recursive: true });
    await writeFile(reviewFile, fixture.bytes);
    await mkdir(path.join(recordDir, "audit"));
    await writeFile(path.join(recordDir, "audit/clone.md"), fixture.request + fixture.completion);

    const service = createGuideService({ versionGate: null,
      workspaceRoot: root,
      officialDocsRoot: REPO_ROOT,
      recordDir,
      debounceMs: 20,
    });
    const messages: WsMessage[] = [];
    service.hub.add({ send: (data) => messages.push(JSON.parse(data) as WsMessage) });
    const cached = () => {
      const result = service.readContext.matrix();
      return result && "ok" in result ? verdict(result.value.cells) : undefined;
    };
    const pushed = () => {
      for (const message of [...messages].reverse()) {
        if (message.type === "change" && message.scope === "matrix:unit-alpha") {
          return verdict(message.cells);
        }
      }
      return undefined;
    };
    service.startMatrixBackground();
    await expect.poll(cached, { timeout: 5_000 }).toBe("READY");
    dispose = service.startWatch();

    // Retry the source write until subscription is live; no record/audit write
    // can accidentally refresh this assertion during watcher startup.
    await expect
      .poll(
        async () => {
          await writeFile(app, "export const answer = 43;\n");
          return pushed();
        },
        { timeout: 10_000, interval: 100 },
      )
      .toBeNull();
    // Retried writes can already have started another cache refresh after the
    // first matching push. Wait for that asynchronous refresh to settle too.
    await expect.poll(cached, { timeout: 5_000 }).toBeNull();

    await writeFile(app, SOURCE_BODY);
    await expect.poll(pushed, { timeout: 5_000 }).toBe("READY");
    await expect.poll(cached, { timeout: 5_000 }).toBe("READY");

    // Workspace identity includes additions outside this Unit's manifest too.
    const added = path.join(root, "another.ts");
    await writeFile(added, "new source\n");
    await expect.poll(pushed, { timeout: 5_000 }).toBeNull();
    await expect.poll(cached, { timeout: 5_000 }).toBeNull();
    await rm(added);
    await expect.poll(pushed, { timeout: 5_000 }).toBe("READY");
    await expect.poll(cached, { timeout: 5_000 }).toBe("READY");
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
