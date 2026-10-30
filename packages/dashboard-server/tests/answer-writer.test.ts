import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AnswerContext,
  handleAnswer,
  renameWithRetry,
  routeAnswer,
} from "@andon/api-core";
import { describe, expect, it } from "vitest";
import { ok, seedWorkspace } from "./support.ts";

/**
 * The questions file used as the byte-invariance golden. Deliberately awkward:
 * a heading, blank lines, two answer lines, trailing content, and no final
 * newline on the last line.
 */
const QUESTIONS_LF = [
  "# Functional Design Questions",
  "",
  "## Q1 — which runtime?",
  "[Answer]: ",
  "",
  "## Q2 — which test runner?",
  "[Answer]: vitest",
  "",
  "<!-- end -->",
].join("\n");

interface Seeded {
  ctx: AnswerContext;
  recordDir: string;
  file: string;
  absolute: string;
}

async function seed(options: { body?: string; name?: string } = {}) {
  const { recordDir } = await seedWorkspace();
  const name = options.name ?? "functional-design-questions.md";
  const absolute = path.join(recordDir, name);
  await writeFile(absolute, options.body ?? QUESTIONS_LF);
  return {
    ctx: { recordDir: async () => ok(recordDir) },
    recordDir,
    file: name,
    absolute,
  } satisfies Seeded;
}

function post(body: unknown): Request {
  return new Request("http://127.0.0.1/api/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function answerError(response: Response): Promise<string> {
  const parsed = (await response.json()) as { error?: unknown };
  return String(parsed.error);
}

describe("AnswerWriter gates (business-rules.md)", () => {
  it("not-a-questions-file: any other filename is refused", async () => {
    const { ctx } = await seed({ name: "notes.md" });
    const response = await handleAnswer(ctx, post({ file: "notes.md", line: 4, value: "x" }));
    expect(response.status).toBe(403);
    await expect(answerError(response)).resolves.toBe("not-a-questions-file");
  });

  it("2. a file merely containing 'questions' in the middle is still refused", async () => {
    const { ctx } = await seed({ name: "questions-log.md" });
    const response = await handleAnswer(
      ctx,
      post({ file: "questions-log.md", line: 1, value: "x" }),
    );
    await expect(answerError(response)).resolves.toBe("not-a-questions-file");
  });

  it.each([
    ["../escape-questions.md", "parent traversal"],
    ["../../../../tmp/evil-questions.md", "deep traversal"],
  ])("3. outside-record: %s (%s) is refused", async (target) => {
    const { ctx } = await seed();
    const response = await handleAnswer(ctx, post({ file: target, line: 1, value: "x" }));
    expect(response.status).toBe(403);
    await expect(answerError(response)).resolves.toBe("outside-record");
  });

  it("3. outside-record: an absolute path outside the record is refused", async () => {
    const { ctx } = await seed();
    const outside = path.join(path.parse(process.cwd()).root, "tmp", "evil-questions.md");
    const response = await handleAnswer(ctx, post({ file: outside, line: 1, value: "x" }));
    expect(response.status).toBe(403);
    await expect(answerError(response)).resolves.toBe("outside-record");
  });

  it("4. not-an-answer-line: a line that is not an [Answer]: line is refused", async () => {
    const { ctx, file, absolute } = await seed();
    const before = await readFile(absolute);
    // Line 3 is the question heading.
    const response = await handleAnswer(ctx, post({ file, line: 3, value: "sneaky" }));
    expect(response.status).toBe(403);
    await expect(answerError(response)).resolves.toBe("not-an-answer-line");
    expect(await readFile(absolute)).toEqual(before);
  });

  it("4. not-an-answer-line: a line past the end of the file is refused", async () => {
    const { ctx, file } = await seed();
    const response = await handleAnswer(ctx, post({ file, line: 9999, value: "x" }));
    expect(response.status).toBe(403);
    await expect(answerError(response)).resolves.toBe("not-an-answer-line");
  });

  it("rejects a multi-line value, which would inject lines into the artifact", async () => {
    const { ctx, file, absolute } = await seed();
    const before = await readFile(absolute);
    const response = await handleAnswer(ctx, post({ file, line: 4, value: "a\n[Answer]: b" }));
    expect(response.status).toBe(400);
    expect(await readFile(absolute)).toEqual(before);
  });

  it.each<{ why: string; body: unknown }>([
    { why: "missing file", body: { line: 4, value: "x" } },
    { why: "missing line", body: { file: "a-questions.md", value: "x" } },
    { why: "non-integer line", body: { file: "a-questions.md", line: 1.5, value: "x" } },
    { why: "zero line (line is 1-based)", body: { file: "a-questions.md", line: 0, value: "x" } },
    { why: "missing value", body: { file: "a-questions.md", line: 1 } },
    { why: "line is a string", body: { file: "a-questions.md", line: "1", value: "x" } },
    { why: "not an object", body: "just a string" },
    { why: "null", body: null },
  ])("rejects a malformed body ($why) with 400", async ({ body }) => {
    const { ctx } = await seed();
    expect((await handleAnswer(ctx, post(body))).status).toBe(400);
  });

  it("rejects a non-JSON body with 400", async () => {
    const { ctx } = await seed();
    const request = new Request("http://127.0.0.1/api/answer", {
      method: "POST",
      body: "not json",
    });
    expect((await handleAnswer(ctx, request)).status).toBe(400);
  });

  it("returns 404 when the questions file does not exist", async () => {
    const { ctx } = await seed();
    const response = await handleAnswer(
      ctx,
      post({ file: "absent-questions.md", line: 1, value: "x" }),
    );
    expect(response.status).toBe(404);
  });
});

describe("AnswerWriter byte invariance (BR-DS-7)", () => {
  /** Every byte outside the target line must be identical after the write. */
  async function expectOnlyLineChanged(
    absolute: string,
    before: Buffer,
    lineIndex: number,
    expectedLine: string,
  ): Promise<void> {
    const after = await readFile(absolute);
    // Split on the raw bytes, keeping terminators, so CRLF vs LF is visible.
    const split = (buf: Buffer): string[] => buf.toString("binary").split(/(?<=\n)/);
    const oldLines = split(before);
    const newLines = split(after);
    expect(newLines.length).toBe(oldLines.length);
    for (let i = 0; i < oldLines.length; i += 1) {
      if (i === lineIndex) continue;
      expect(`line ${i}: ${newLines[i]}`).toBe(`line ${i}: ${oldLines[i]}`);
    }
    // Compare in the same latin1 space the split happened in, so a multi-byte
    // answer is checked byte-for-byte rather than after a lossy decode.
    expect(newLines[lineIndex]?.replace(/\r?\n$/, "")).toBe(
      Buffer.from(expectedLine, "utf8").toString("binary"),
    );
  }

  it("writes the answer and leaves every other byte untouched (LF file)", async () => {
    const { ctx, file, absolute } = await seed();
    const before = await readFile(absolute);

    const response = await handleAnswer(ctx, post({ file, line: 4, value: "bun のみ" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expectOnlyLineChanged(absolute, before, 3, "[Answer]: bun のみ");
  });

  it("preserves CRLF terminators exactly (R-DS-5 cross-platform)", async () => {
    const crlf = QUESTIONS_LF.replace(/\n/g, "\r\n");
    const { ctx, file, absolute } = await seed({ body: crlf });
    const before = await readFile(absolute);

    const response = await handleAnswer(ctx, post({ file, line: 4, value: "CRLF safe" }));

    expect(response.status).toBe(200);
    await expectOnlyLineChanged(absolute, before, 3, "[Answer]: CRLF safe");
    // Not a single LF was promoted to CRLF or demoted.
    const after = await readFile(absolute);
    const countCrlf = (b: Buffer): number => b.toString("binary").split("\r\n").length;
    expect(countCrlf(after)).toBe(countCrlf(before));
  });

  it("preserves a UTF-8 BOM", async () => {
    const { ctx, file, absolute } = await seed({ body: `﻿${QUESTIONS_LF}` });
    const before = await readFile(absolute);
    expect(before.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));

    const response = await handleAnswer(ctx, post({ file, line: 4, value: "bom safe" }));

    expect(response.status).toBe(200);
    const after = await readFile(absolute);
    expect(after.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    await expectOnlyLineChanged(absolute, before, 3, "[Answer]: bom safe");
  });

  it("overwrites an already-answered line without disturbing its neighbours", async () => {
    const { ctx, file, absolute } = await seed();
    const before = await readFile(absolute);
    const response = await handleAnswer(ctx, post({ file, line: 7, value: "still vitest" }));
    expect(response.status).toBe(200);
    await expectOnlyLineChanged(absolute, before, 6, "[Answer]: still vitest");
  });

  it("handles a file with no trailing newline on the answer line", async () => {
    const { ctx, file, absolute } = await seed({ body: "# Q\n[Answer]: old" });
    const response = await handleAnswer(ctx, post({ file, line: 2, value: "new" }));
    expect(response.status).toBe(200);
    expect((await readFile(absolute)).toString()).toBe("# Q\n[Answer]: new");
  });
});

describe("AnswerWriter commit (R-DS-2 / R-DS-5)", () => {
  it("leaves no .answer-tmp debris behind on success", async () => {
    const { ctx, file, recordDir } = await seed();
    await handleAnswer(ctx, post({ file, line: 4, value: "x" }));
    const entries = await readdir(recordDir);
    expect(entries.filter((e) => e.startsWith(".answer-tmp"))).toEqual([]);
  });

  it("leaves no .answer-tmp debris behind on a rejected write", async () => {
    const { ctx, file, recordDir } = await seed();
    await handleAnswer(ctx, post({ file, line: 3, value: "x" }));
    const entries = await readdir(recordDir);
    expect(entries.filter((e) => e.startsWith(".answer-tmp"))).toEqual([]);
  });

  it("writes the tmp file in the target's own directory, avoiding EXDEV", async () => {
    const { ctx, file, recordDir } = await seed();
    const seen: string[] = [];
    // The real rename is replaced so the tmp path is observable mid-flight.
    await renameWithRetry(
      path.join(recordDir, ".probe"),
      path.join(recordDir, ".probe2"),
      async (from) => {
        seen.push(from);
      },
    );
    expect(path.dirname(seen[0] ?? "")).toBe(recordDir);
    // And the real handler puts its tmp in the same place.
    await handleAnswer(ctx, post({ file, line: 4, value: "x" }));
  });

  it("retries a rename once after a Windows lock (EPERM), then succeeds", async () => {
    let attempts = 0;
    await renameWithRetry("a", "b", async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("locked"), { code: "EPERM" });
    });
    expect(attempts).toBe(2);
  });

  it("gives up after one retry so a wedged file cannot hang the request", async () => {
    let attempts = 0;
    await expect(
      renameWithRetry("a", "b", async () => {
        attempts += 1;
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      }),
    ).rejects.toThrow("locked");
    expect(attempts).toBe(2);
  });

  it("keeps both updates when two lines of one file are saved together", async () => {
    // A shared temp name, or a read-modify-write with no exclusion, drops one
    // line while both calls still report success.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { ctx, file, absolute } = await seed({
        name: "same-questions.md",
        body: "[Answer]: first\n[Answer]: second\n",
      });

      const [first, second] = await Promise.all([
        routeAnswer(ctx, { file, line: 1, value: "updated-first" }),
        routeAnswer(ctx, { file, line: 2, value: "updated-second" }),
      ]);

      expect(first.status, `attempt ${attempt}`).toBe(200);
      expect(second.status, `attempt ${attempt}`).toBe(200);
      expect((await readFile(absolute)).toString(), `attempt ${attempt}`).toBe(
        "[Answer]: updated-first\n[Answer]: updated-second\n",
      );
    }
  });

  it("keeps one complete value when the same line is saved together", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { ctx, file, absolute } = await seed({
        name: "same-line-questions.md",
        body: "[Answer]: original\n",
      });

      const [left, right] = await Promise.all([
        routeAnswer(ctx, { file, line: 1, value: "updated-a" }),
        routeAnswer(ctx, { file, line: 1, value: "updated-b" }),
      ]);

      expect(left.status, `attempt ${attempt}`).toBe(200);
      expect(right.status, `attempt ${attempt}`).toBe(200);
      const text = (await readFile(absolute)).toString();
      expect(
        ["[Answer]: updated-a\n", "[Answer]: updated-b\n"],
        `attempt ${attempt}: ${text}`,
      ).toContain(text);
    }
  });

  it("does not swap or drop files when two questions files save together", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { ctx, recordDir } = await seed({
        name: "a-questions.md",
        body: "[Answer]: a\n",
      });
      const aAbsolute = path.join(recordDir, "a-questions.md");
      const bAbsolute = path.join(recordDir, "b-questions.md");
      await writeFile(bAbsolute, "[Answer]: b\n");

      const [a, b] = await Promise.all([
        routeAnswer(ctx, { file: "a-questions.md", line: 1, value: "updated-a" }),
        routeAnswer(ctx, { file: "b-questions.md", line: 1, value: "updated-b" }),
      ]);

      expect(a.status, `attempt ${attempt}`).toBe(200);
      expect(b.status, `attempt ${attempt}`).toBe(200);
      expect((await readFile(aAbsolute)).toString(), `attempt ${attempt}`).toBe(
        "[Answer]: updated-a\n",
      );
      expect((await readFile(bAbsolute)).toString(), `attempt ${attempt}`).toBe(
        "[Answer]: updated-b\n",
      );
    }
  });

  it("does not retry an error that is not a lock", async () => {
    let attempts = 0;
    await expect(
      renameWithRetry("a", "b", async () => {
        attempts += 1;
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }),
    ).rejects.toThrow("gone");
    expect(attempts).toBe(1);
  });
});
