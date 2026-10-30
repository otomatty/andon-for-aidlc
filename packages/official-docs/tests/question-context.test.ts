import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DocsQaRequest } from "@aidlc-guide/shared-types";
import { afterEach, describe, expect, it } from "vitest";
import { readQuestionEvidence, retrieveQuestionContext } from "../src/index.ts";
import { buildDocsIndex } from "../src/retrieval-build.ts";
import { contentHash, estimateTokens } from "../src/retrieval-markdown.ts";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function put(root: string, rel: string, text: string): Promise<void> {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

const EN =
  "# Approval gates\r\n\r\nHuman approval is required.\r\n\r\n## Blocking sensors\r\n\r\nA failed blocking sensor stops the approval gate.\r\n\r\nThe same paragraph.\r\n\r\n## More\r\n\r\nThe same paragraph.\r\n";
const JA = "# 承認ゲート\n\n人の承認が必要です。\n";
const GUIDE =
  "# ダッシュボードの使い方\n\nワークフローの進捗はステージ一覧で確認します。\n\n## ブラウザー\n\nブラウザーでダッシュボードを開きます。\n";

async function seed(extra: Record<string, string> = {}, verified = false) {
  const root = await mkdtemp(path.join(tmpdir(), "aidlc-question-"));
  temporary.push(root);
  await put(
    root,
    "docs/official-docs.manifest.json",
    JSON.stringify({ sourceVersion: "2.8.0", upstreamSha: "a".repeat(40) }),
  );
  await put(root, "docs/guide/en/gates.md", EN);
  await put(root, "docs/guide/ja/gates.md", JA);
  await put(root, "docs/guides/browser-dashboard.md", GUIDE);
  await put(root, "packages/vscode-extension/package.json", JSON.stringify({ version: "1.2.3" }));
  for (const [rel, text] of Object.entries(extra)) await put(root, rel, text);
  const index = await buildDocsIndex(
    root,
    verified ? { "guide/gates.md": { enHash: contentHash(EN), jaHash: contentHash(JA) } } : {},
  );
  await put(root, "docs/official-docs.index.json", JSON.stringify(index));
  return root;
}

const request = (question: string, extra: Partial<DocsQaRequest> = {}): DocsQaRequest => ({
  question,
  tool: "claude",
  locale: "ja",
  ...extra,
});

describe("question source retrieval", () => {
  it("cites verified original text with exact CRLF line positions and actual fallback locale", async () => {
    const root = await seed();
    const { citations } = await retrieveQuestionContext(
      root,
      request("承認ゲートでセンサーが失敗した場合"),
    );
    const source = citations.find((citation) =>
      citation.quote.includes("A failed blocking sensor"),
    );
    expect(source).toMatchObject({
      target: { kind: "official", path: "guide/gates.md", locale: "en" },
      startLine: 7,
      endLine: 7,
      hash: contentHash(EN),
      version: "aidlc-workflows 2.8.0",
    });
    expect(source?.quote).toBe(EN.split(/\r?\n/).slice(6, 7).join("\n"));
    if (!source) throw new Error("missing source");
    expect(await readQuestionEvidence(root, source)).toMatchObject({
      matches: true,
      markdown: EN,
    });
  });

  it("uses reviewed Japanese and keeps extension guide versions separate", async () => {
    const root = await seed({}, true);
    const official = await retrieveQuestionContext(
      root,
      request("承認", { target: { kind: "official", path: "guide/gates.md", locale: "ja" } }),
    );
    expect(official.citations[0]?.target.locale).toBe("ja");
    const result = await retrieveQuestionContext(root, request("ブラウザー"));
    const guide = result.citations.find((citation) => citation.target.kind === "guide");
    expect(guide).toMatchObject({
      target: { kind: "guide", path: "browser-dashboard.md", locale: "ja" },
      version: "Andon 1.2.3",
      startLine: 7,
      endLine: 7,
    });
    if (!guide) throw new Error("missing guide");
    expect(await readQuestionEvidence(root, guide)).toMatchObject({
      matches: true,
      markdown: GUIDE,
    });
    await put(root, "docs/guides.version.json", JSON.stringify({ version: "9.8.7" }));
    const packaged = await retrieveQuestionContext(
      root,
      request("ブラウザー", { target: guide?.target }),
    );
    expect(packaged.citations[0]?.version).toBe("Andon 9.8.7");
  });

  it("searches release notes but keeps proposals and research out, even when scoped", async () => {
    const root = await seed({
      "docs/overview/en/releases/2.8.0.md":
        "# Zebra release\n\n[All releases](../changelog.md)\n\nZebra installer fix.\n",
      "docs/rfcs/en/proposal.md": "# Zebra proposal\n\nZebra speculative change.\n",
      "docs/reference/en/research/study.md": "# Zebra research\n\nZebra research claim.\n",
    });
    const result = await retrieveQuestionContext(root, request("Zebra"));
    expect(result.citations.length).toBeGreaterThan(0);
    expect(
      result.citations.every((citation) => citation.target.path === "overview/releases/2.8.0.md"),
    ).toBe(true);
    expect(result.citations.every((citation) => !citation.quote.includes("[All releases]"))).toBe(
      true,
    );
    const version = await retrieveQuestionContext(root, request("2.8.0の更新内容"));
    expect(version.citations[0]?.target.path).toBe("overview/releases/2.8.0.md");
    const proposal = await retrieveQuestionContext(
      root,
      request("Zebra", { target: { kind: "official", path: "rfcs/proposal.md", locale: "en" } }),
    );
    expect(proposal.citations).toEqual([]);
  });

  it("restricts retrieval before ranking and uses question history for follow-ups", async () => {
    const root = await seed();
    const followup = await retrieveQuestionContext(
      root,
      request("もっと詳しく", { history: [{ question: "ブラウザー", answer: "回答" }] }),
    );
    expect(followup.citations.some((citation) => citation.target.kind === "guide")).toBe(true);
    const scoped = await retrieveQuestionContext(
      root,
      request("内容を説明して", {
        target: { kind: "guide", path: "browser-dashboard.md", locale: "ja" },
      }),
    );
    expect(scoped.citations.length).toBeGreaterThan(0);
    expect(
      scoped.citations.every((citation) => citation.target.path === "browser-dashboard.md"),
    ).toBe(true);
    expect((await retrieveQuestionContext(root, request("unfindablezzxy"))).citations).toEqual([]);
  });

  it("does not highlight a changed file or a mismatched source range", async () => {
    const root = await seed();
    const { citations } = await retrieveQuestionContext(root, request("approval"));
    const citation = citations[0];
    if (!citation) throw new Error("missing citation");
    expect(await readQuestionEvidence(root, { ...citation, startLine: 1 })).toHaveProperty(
      "matches",
      false,
    );
    await put(root, "docs/guide/en/gates.md", `${EN}\nA later update.\n`);
    expect(await readQuestionEvidence(root, citation)).toMatchObject({
      matches: false,
      markdown: expect.stringContaining("A later update."),
    });
    await expect(retrieveQuestionContext(root, request("approval"))).rejects.toThrow("stale_index");
  });

  it("bounds context, preserves table rows and rejects paths outside the catalog", async () => {
    const root = await seed({
      "docs/reference/en/table.md":
        "# Commands\n\n| Command | Action |\n| --- | --- |\n| resume | Resume the workflow |\n| park | Stop the workflow |\n\n" +
        "Resume details.\n\n".repeat(30),
    });
    const { citations } = await retrieveQuestionContext(root, request("resume"));
    expect(citations.length).toBeLessThanOrEqual(6);
    expect(estimateTokens(JSON.stringify(citations))).toBeLessThanOrEqual(6010);
    for (const citation of citations)
      expect(await readQuestionEvidence(root, citation)).toHaveProperty("matches", true);
    const tableRow = citations.find((citation) => citation.quote.startsWith("| resume"));
    expect(tableRow).toMatchObject({
      startLine: 5,
      endLine: 5,
      quote: "| resume | Resume the workflow |",
      context: "| Command | Action |\n| --- | --- |",
    });
    for (const target of [
      { kind: "official" as const, path: "guide/../../secret.md", locale: "en" as const },
      { kind: "guide" as const, path: "../secret.md", locale: "ja" as const },
      { kind: "official" as const, path: "/guide/gates.md", locale: "en" as const },
    ])
      await expect(retrieveQuestionContext(root, request("secret", { target }))).rejects.toThrow(
        "invalid_target",
      );
  });
});

describe("common questions against the bundled extension guides", () => {
  it.each([
    "Dashboard の開き方を一文で教えてください。",
    "Dashboard はどうやって開きますか？",
    "Andon の Dashboard はどうやって開きますか？手順を短く教えてください。",
  ])("retrieves the actual opening command for %s", async (question) => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const { citations } = await retrieveQuestionContext(root, request(question));
    const opening = citations
      .slice(0, 2)
      .find(
        (citation) =>
          citation.target.kind === "guide" &&
          citation.target.path === "getting-started.md" &&
          citation.quote.includes("Andon: Open"),
      );
    expect(opening, JSON.stringify(citations.map((citation) => citation.headings))).toBeDefined();
    if (!opening) throw new Error("opening instructions were not retrieved");
    expect(await readQuestionEvidence(root, opening)).toHaveProperty("matches", true);
  });
});
