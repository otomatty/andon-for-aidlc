import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  readQuestionEvidence,
  retrieveQuestionContext,
} from "../packages/official-docs/src/index.ts";
import { buildDocsIndex } from "../packages/official-docs/src/retrieval-build.ts";
import { DOC_SECTIONS } from "../packages/official-docs/src/roots.ts";
import { copyOfficialDocsMedia } from "./copy-official-docs-media.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("packages the extension guides and their own version for source navigation in a VSIX", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aidlc-copy-docs-"));
  temporary.push(root);
  const put = async (rel: string, text: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  };
  await put(
    "docs/official-docs.manifest.json",
    JSON.stringify({ sourceVersion: "2.8.0", upstreamSha: "a".repeat(40) }),
  );
  for (const section of DOC_SECTIONS.filter((section) => section !== "rfcs")) {
    await put(`docs/${section}/en/README.md`, `# ${section}\n\nWorkflow docs.\n`);
  }
  await put("docs/guides/README.md", "# 拡張機能\n\nダッシュボードの使い方。\n");
  await put("packages/vscode-extension/package.json", JSON.stringify({ version: "1.2.3" }));
  await put("packages/mcp-server/skills/aidlc-guide-docs/SKILL.md", "# Docs\n");
  await put("docs/official-docs.index.json", `${JSON.stringify(await buildDocsIndex(root))}\n`);
  await copyOfficialDocsMedia(root);
  const bundle = path.join(root, "packages/vscode-extension/media/official-docs");
  expect(await readFile(path.join(bundle, "docs/guides.version.json"), "utf8")).toContain(
    '"version":"1.2.3"',
  );
  const { citations } = await retrieveQuestionContext(bundle, {
    question: "ダッシュボード",
    tool: "claude",
    locale: "ja",
  });
  expect(citations[0]).toMatchObject({
    target: { kind: "guide", path: "README.md" },
    version: "Andon 1.2.3",
  });
  const citation = citations[0];
  if (!citation) throw new Error("missing citation");
  expect(await readQuestionEvidence(bundle, citation)).toMatchObject({
    matches: true,
    markdown: "# 拡張機能\n\nダッシュボードの使い方。\n",
  });
});
