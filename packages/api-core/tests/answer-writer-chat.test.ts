import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AnswerError } from "@andon/shared-types";
import { afterEach, describe, expect, it } from "vitest";
import { routeAnswer } from "../src/handlers/answer-writer.ts";

/**
 * Contract: aidlc-workflows v2.11.0 records the Code Generation Plan Approval
 * answer and a Consolidated Summary Confirmation answer from the chat. The
 * writer refuses them with the identifier the dashboard explains, and leaves
 * every other answer writable.
 */

const PLAN = [
  "# Code Generation Plan Approval",
  "",
  "## Plan Approval",
  "",
  "- A. Approve",
  "",
  "[Answer]: A",
  "",
].join("\n");
const SUMMARY = [
  "# Questions",
  "",
  "## Q1",
  "[Answer]: A",
  "",
  "## Consolidated Summary Confirmation",
  "[Answer]: A",
  "",
  "## Q2",
  "[Answer]:",
  "",
].join("\n");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function seed(file: string, body: string) {
  const record = await mkdtemp(path.join(tmpdir(), "answer-chat-"));
  roots.push(record);
  await mkdir(path.dirname(path.join(record, file)), { recursive: true });
  await writeFile(path.join(record, file), body);
  return {
    ctx: { recordDir: async () => ({ ok: true as const, value: record }) },
    read: () => readFile(path.join(record, file), "utf8"),
  };
}

const CHAT_ANSWERED: AnswerError = "chat-answered-line";

describe("answers recorded from the chat", () => {
  it("refuses the Code Generation Plan Approval answer and leaves the file untouched", async () => {
    const file = "construction/unit-a/code-generation/code-generation-questions.md";
    const { ctx, read } = await seed(file, PLAN);
    const result = await routeAnswer(ctx, { file, line: 7, value: "B" });
    expect(result).toEqual({ status: 403, body: { error: CHAT_ANSWERED } });
    expect(await read()).toBe(PLAN);
  });

  it("refuses it through a BOM and CRLF line ends", async () => {
    const file = "construction/code-generation/code-generation-questions.md";
    const body = `﻿${PLAN.replace(/\n/g, "\r\n")}`;
    const { ctx, read } = await seed(file, body);
    expect((await routeAnswer(ctx, { file, line: 7, value: "B" })).status).toBe(403);
    expect(await read()).toBe(body);
  });

  it("refuses the summary confirmation answer but writes the others", async () => {
    const file = "inception/requirements-analysis/requirements-analysis-questions.md";
    const { ctx, read } = await seed(file, SUMMARY);
    expect(await routeAnswer(ctx, { file, line: 7, value: "B" })).toEqual({
      status: 403,
      body: { error: CHAT_ANSWERED },
    });
    expect((await routeAnswer(ctx, { file, line: 10, value: "C" })).status).toBe(200);
    expect((await routeAnswer(ctx, { file, line: 4, value: "B" })).status).toBe(200);
    expect(await read()).toBe(
      SUMMARY.replace("## Q1\n[Answer]: A", "## Q1\n[Answer]: B").replace(
        "## Q2\n[Answer]:",
        "## Q2\n[Answer]: C",
      ),
    );
  });

  it("writes an ordinary questions file that only shares the heading", async () => {
    const file = "construction/u/functional-design/design-questions.md";
    const { ctx } = await seed(file, PLAN);
    expect((await routeAnswer(ctx, { file, line: 7, value: "B" })).status).toBe(200);
  });
});
