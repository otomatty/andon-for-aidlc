import type { AnswerError } from "@andon/shared-types";
import { render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnswerEditor, answerLinesOf } from "@/viewer/AnswerEditor.tsx";
import { saveAnswer, unchangedOutsideLine } from "@/viewer/services/answer.ts";

/**
 * US-14 / FR-6.2 / S-AV-1,2,5. The write path is one function and one
 * component; between them they own every branch the server can produce.
 */

const FILE = "construction/artifact-viewer/functional-design/design-questions.md";

const DOC = ["# 質問", "", "## Q1 どちらにするか", "", "[Answer]: まだ", "", "終わり"].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers the POST with `post`, then the re-read GET with `reread`. */
function stubExchange(post: unknown, status: number, reread?: unknown): ReturnType<typeof vi.fn> {
  const calls = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(JSON.stringify(post), { status })
      : new Response(JSON.stringify(reread ?? { ok: true, value: DOC })),
  );
  vi.stubGlobal("fetch", calls);
  return calls as unknown as ReturnType<typeof vi.fn>;
}

function setup(overrides: { onSaved?: (markdown: string) => void } = {}): void {
  render(
    <AnswerEditor
      path={FILE}
      answerLines={answerLinesOf(FILE, DOC)}
      markdown={DOC}
      onSaved={overrides.onSaved ?? ((): void => {})}
    />,
  );
}

async function save(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
}

/* ------------------------- byte-invariance check ------------------------ */

describe("unchangedOutsideLine (P-AV-4 / S-AV-5)", () => {
  const before = "a\n[Answer]: old\nc\n";

  it("accepts a change confined to the edited line", () => {
    expect(unchangedOutsideLine(before, "a\n[Answer]: new value\nc\n", 2)).toBe(true);
  });

  it("rejects a change to any other line", () => {
    expect(unchangedOutsideLine(before, "a!\n[Answer]: new\nc\n", 2)).toBe(false);
    expect(unchangedOutsideLine(before, "a\n[Answer]: new\nc CHANGED\n", 2)).toBe(false);
  });

  it("rejects an added or removed line", () => {
    expect(unchangedOutsideLine(before, "a\n[Answer]: new\nc\nd\n", 2)).toBe(false);
    expect(unchangedOutsideLine(before, "a\n[Answer]: new\n", 2)).toBe(false);
  });

  it("rejects a changed line terminator (CRLF is part of the comparison)", () => {
    expect(unchangedOutsideLine("a\r\n[Answer]: x\r\nc\r\n", "a\r\n[Answer]: y\nc\r\n", 2)).toBe(
      false,
    );
    expect(unchangedOutsideLine("a\r\n[Answer]: x\r\nc\r\n", "a\r\n[Answer]: y\r\nc\r\n", 2)).toBe(
      true,
    );
  });

  it("rejects a line number the file does not have", () => {
    expect(unchangedOutsideLine(before, before, 99)).toBe(false);
  });
});

/* ------------------------------ saveAnswer ------------------------------ */

describe("saveAnswer (S-AV-1)", () => {
  it("posts the {file,line,value} contract and re-reads before believing it", async () => {
    const calls = stubExchange({ ok: true }, 200);
    const result = await saveAnswer({ file: FILE, line: 5, value: "決めた" }, DOC);

    const [postUrl, postInit] = calls.mock.calls[0] as [string, RequestInit];
    expect(postUrl).toBe("/api/answer");
    expect(postInit.method).toBe("POST");
    expect(JSON.parse(String(postInit.body))).toEqual({ file: FILE, line: 5, value: "決めた" });
    // Second call is the verification read of the same file.
    expect(calls.mock.calls[1]?.[0]).toContain("/api/artifact?path=");
    expect(result).toEqual({ kind: "saved", markdown: DOC, verified: true });
  });

  it("reports a mismatch as a boolean and never carries file content", async () => {
    const tampered = DOC.replace("終わり", "書き換えられた");
    stubExchange({ ok: true }, 200, { ok: true, value: tampered });
    const result = await saveAnswer({ file: FILE, line: 5, value: "x" }, DOC);
    expect(result).toEqual({ kind: "saved", markdown: tampered, verified: false });
  });

  it("surfaces a failed re-read rather than showing unverified content", async () => {
    stubExchange({ ok: true }, 200, { error: true, reason: "artifact-not-found" });
    expect(await saveAnswer({ file: FILE, line: 5, value: "x" }, DOC)).toEqual({
      kind: "failed",
      reason: "artifact-not-found",
    });
  });

  it("names the version when the re-read hits an unsupported workspace", async () => {
    stubExchange({ ok: true }, 200, { unsupported: true, version: "9" });
    expect(await saveAnswer({ file: FILE, line: 5, value: "x" }, DOC)).toEqual({
      kind: "failed",
      reason: "unsupported-version-9",
    });
  });

  it("falls back to the status code when the rejection body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    expect(await saveAnswer({ file: FILE, line: 5, value: "x" }, DOC)).toEqual({
      kind: "failed",
      reason: "http-502",
    });
  });

  it("uses a reason-shaped body when the server sends one instead of an error id", async () => {
    stubExchange({ error: true, reason: "multiline-value" }, 400);
    expect(await saveAnswer({ file: FILE, line: 5, value: "a\nb" }, DOC)).toEqual({
      kind: "failed",
      reason: "multiline-value",
    });
  });

  it("reports a dead server instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await saveAnswer({ file: FILE, line: 5, value: "x" }, DOC)).toEqual({
      kind: "failed",
      reason: "server-unreachable",
    });
  });
});

/* ----------------------------- AnswerEditor ---------------------------- */

describe("AnswerEditor", () => {
  it("renders nothing for a file with no [Answer]: lines", () => {
    render(
      <AnswerEditor
        path="construction/u/s/design.md"
        answerLines={answerLinesOf("construction/u/s/design.md", DOC)}
        markdown={DOC}
        onSaved={(): void => {}}
      />,
    );
    expect(screen.queryByTestId("answer-editor")).toBeNull();
  });

  it("labels the field with its line number and its question", () => {
    setup();
    const field = screen.getByLabelText(/5 行目の回答: Q1 どちらにするか/);
    expect((field as HTMLInputElement).value).toBe("まだ");
  });

  it("saves on the explicit button and shows the re-read result", async () => {
    const onSaved = vi.fn();
    stubExchange({ ok: true }, 200);
    setup({ onSaved });

    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "決めた");
    await save();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("保存しました");
    });
    expect(onSaved).toHaveBeenCalledWith(DOC);
  });

  it("warns without quoting the file when the bytes outside the line moved (S-AV-5)", async () => {
    stubExchange({ ok: true }, 200, { ok: true, value: DOC.replace("終わり", "改ざん") });
    setup();
    await save();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("保存内容が想定と異なります");
    });
    expect(screen.getByRole("status").textContent).not.toContain("改ざん");
  });

  const GATES: [AnswerError, number, string][] = [
    ["not-a-questions-file", 403, "このファイルは編集できません"],
    ["outside-record", 403, "記録ディレクトリ外のファイルは編集できません"],
    ["not-an-answer-line", 403, "この行は編集できません"],
    [
      "chat-answered-line",
      403,
      "この回答は AI-DLC がチャットでの回答から記録します。回答はチャットで行ってください",
    ],
    ["write-verification-failed", 500, "保存を中止しました（ファイルは変更されていません）"],
  ];

  it.each(GATES)("explains the %s rejection inline", async (error, status, message) => {
    stubExchange({ error }, status);
    setup();
    await save();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(message);
    });
    // A gate rejection will not change on a second attempt, so no retry.
    expect(screen.queryByRole("button", { name: "再試行" })).toBeNull();
  });

  it("has a default branch with a retry for an identifier it does not know (D2)", async () => {
    stubExchange({ error: "gate-invented-next-year" }, 403);
    setup();
    await save();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "保存できませんでした（gate-invented-next-year）",
      );
    });
    expect(screen.getByRole("button", { name: "再試行" })).toBeDefined();
  });

  it("takes the same default branch when the network fails, and retries", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    await save();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "保存できませんでした（server-unreachable）",
      );
    });
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});

/* ---------------------- engine-owned answers (v2.11) --------------------- */

describe("answers the engine records from the chat", () => {
  const PLAN_FILE = "construction/unit-a/code-generation/code-generation-questions.md";
  // aidlc-workflows v2.11.0 aidlc-plan-approval-ask.ts questionsFileContent.
  const PLAN = [
    "# Code Generation Plan Approval",
    "",
    "AI-DLC writes this file when it asks you to approve the plan. To answer here",
    "instead of in chat, write your answer after `[Answer]:` and say done.",
    "",
    "## Plan Approval",
    "",
    "Approve the code plan for unit-a?",
    "",
    "[Approval Fingerprint]: sha256:abc",
    "[Planned Source]: sha256:def",
    "",
    "- A. Approve",
    "- B. Request changes",
    "",
    "[Answer]: A",
    "",
  ].join("\n");
  const SUMMARY_FILE = "inception/requirements-analysis/requirements-analysis-questions.md";
  const SUMMARY = [
    "# Questions",
    "",
    "## Q1 どちらにするか",
    "",
    "[Answer]: A",
    "",
    "## Consolidated Summary Confirmation",
    "",
    "要約を確認してください。",
    "",
    "[Answer]: A",
    "",
    "## Q2 次の質問",
    "",
    "[Answer]:",
  ].join("\n");

  function renderEditor(path: string, markdown: string): void {
    render(
      <AnswerEditor
        path={path}
        answerLines={answerLinesOf(path, markdown)}
        markdown={markdown}
        onSaved={(): void => {}}
      />,
    );
  }

  it("offers no answer line of a Code Generation Plan Approval file", () => {
    expect(answerLinesOf(PLAN_FILE, PLAN)).toEqual([]);
    expect(answerLinesOf(PLAN_FILE, `﻿${PLAN.replace(/\n/g, "\r\n")}`)).toEqual([]);
  });

  it("shows the plan approval file read-only with a note to answer in the chat", () => {
    renderEditor(PLAN_FILE, PLAN);
    expect(screen.getByTestId("answer-editor")).toBeDefined();
    expect(screen.getByRole("note").textContent).toContain("チャット");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });

  it("keeps an ordinary questions file with the same heading editable", () => {
    expect(answerLinesOf("construction/u/s/design-questions.md", PLAN)).toEqual([16]);
  });

  it("leaves out only the summary confirmation's answer", () => {
    expect(answerLinesOf(SUMMARY_FILE, SUMMARY)).toEqual([5, 15]);
  });

  it("edits the other answers and notes that the summary is confirmed in the chat", () => {
    renderEditor(SUMMARY_FILE, SUMMARY);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByLabelText(/^5 行目の回答/)).toBeDefined();
    expect(screen.getByLabelText(/^15 行目の回答/)).toBeDefined();
    expect(screen.queryByLabelText(/^11 行目の回答/)).toBeNull();
    expect(screen.getByRole("note").textContent).toContain("Consolidated Summary Confirmation");
  });

  it("notes a summary-only file without offering a field", () => {
    const only = ["## Consolidated Summary Confirmation", "", "[Answer]: A"].join("\n");
    expect(answerLinesOf(SUMMARY_FILE, only)).toEqual([]);
    renderEditor(SUMMARY_FILE, only);
    expect(screen.getByRole("note")).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
