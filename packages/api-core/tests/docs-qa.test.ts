import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocsQaCitation, DocsQaJob, DocsQaResult } from "@andon/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocsQaService, type DocsQaDependencies, type DocsQaService } from "../src/docs-qa";
import { copilotCommands } from "../src/ai-cli/copilot";
import { AnswerStream, cliArguments, publicError, runCli } from "../src/ai-cli/process";
import { answerText, questionPrompt } from "../src/docs-qa/prompt";
import { createScratch } from "../src/ai-cli/scratch";

const citation: DocsQaCitation = {
  id: "1",
  sourceId: "guide-start",
  target: { kind: "guide", path: "start.md", locale: "ja" },
  title: "使い方",
  headings: ["始める"],
  version: "0.9.0",
  hash: "a".repeat(64),
  startLine: 3,
  endLine: 3,
  quote: "ステージ一覧から開始します。",
};
const request = { question: "どう始める？", tool: "claude", locale: "ja" };
const services: DocsQaService[] = [];
function setup(overrides: Partial<DocsQaDependencies> = {}) {
  const dependencies: DocsQaDependencies = {
    retrieve: vi.fn(async () => ({ citations: [structuredClone(citation)] })),
    readEvidence: vi.fn(async () => ({
      target: citation.target,
      title: citation.title,
      markdown: "# 使い方\n\nステージ一覧から開始します。",
      hash: citation.hash,
      matches: true,
    })),
    probe: vi.fn(async (tool) => ({ tool, label: tool, available: true, command: tool })),
    run: vi.fn(async ({ onText }) => {
      onText("ステージ一覧から開始");
      return "ステージ一覧から開始します。[1]";
    }),
    scratch: vi.fn(async () => ({ cwd: "/isolated", env: {}, cleanup: vi.fn(async () => {}) })),
    timeoutMs: 120_000,
    now: Date.now,
    ...overrides,
  };
  const service = createDocsQaService({ docsRoot: "/bundled", dependencies });
  services.push(service);
  return { service, dependencies };
}
function value<T>(result: DocsQaResult<T>): T {
  if ("error" in result) throw new Error(result.reason);
  return result.value;
}
async function finish(service: DocsQaService, id: string) {
  await vi.waitFor(() => {
    expect(["completed", "error", "cancelled"]).toContain(value(service.get(id)).phase);
  });
  return value(service.get(id));
}
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("document question jobs", () => {
  it("caches normal capability reads, rechecks explicitly, and expires the cache", async () => {
    let now = 1000;
    const { service, dependencies } = setup({ now: () => now });
    await service.tools();
    await service.tools();
    expect(dependencies.probe).toHaveBeenCalledTimes(3);
    await service.tools(true);
    expect(dependencies.probe).toHaveBeenCalledTimes(6);
    await service.tools();
    expect(dependencies.probe).toHaveBeenCalledTimes(6);
    now += 30_001;
    await service.tools();
    expect(dependencies.probe).toHaveBeenCalledTimes(9);
  });

  it("passes table headings to the model without expanding the highlighted row", async () => {
    const row = {
      ...citation,
      quote: "| resume | true |",
      context: "| Command | Enabled |\n| --- | --- |",
    };
    const { service, dependencies } = setup({
      retrieve: vi.fn(async () => ({ citations: [row] })),
    });
    const job = await finish(service, value(await service.start(request)).id);
    const prompt = vi.mocked(dependencies.run).mock.calls[0]?.[0].prompt ?? "";
    const payload = JSON.parse(prompt.split("\n\n").at(-1) ?? "{}");
    expect(payload.sources[0].text).toBe(`${row.context}\n${row.quote}`);
    expect(job.citations[0]).toEqual(row);
  });
  it("returns immediately, reads bundled text, streams, and retains only references used in the answer", async () => {
    const other = { ...citation, id: "2", sourceId: "unused" };
    const { service, dependencies } = setup({
      retrieve: vi.fn(async () => ({ citations: [citation, other] })),
    });
    const start = value(await service.start(request));
    expect(start.phase).toBe("searching");
    expect(start.locale).toBe("ja");
    const job = await finish(service, start.id);
    expect(job.phase).toBe("completed");
    expect(job.citations).toEqual([citation]);
    expect(dependencies.retrieve).toHaveBeenCalledWith("/bundled", request);
    const options = vi.mocked(dependencies.run).mock.calls[0]?.[0];
    expect(options?.cwd).toBe("/isolated");
    expect(options?.prompt).toContain(citation.quote);
    expect(options?.args).not.toContain(request.question);
    const result = value(await service.evidence(citation));
    expect(result.matches).toBe(true);
    // A source opened while the answer was streaming remains readable after final filtering.
    expect("ok" in (await service.evidence(other))).toBe(true);
    expect(await service.evidence({ ...citation, startLine: 1 })).toEqual({
      error: true,
      reason: "not-found",
    });
    const returnedCitation = job.citations[0];
    if (returnedCitation) returnedCitation.quote = "tampered";
    expect(value(service.get(start.id)).citations[0]?.quote).toBe(citation.quote);
  });

  it("rejects missing fields, traversal, unknown tools, and oversized conversation input", async () => {
    const { service, dependencies } = setup();
    for (const body of [
      null,
      [],
      {},
      { ...request, question: " " },
      { ...request, question: "x".repeat(4001) },
      { ...request, tool: "shell" },
      { ...request, locale: "de" },
      { ...request, target: { kind: "official", locale: "en", path: "../../.env.md" } },
      { ...request, history: [{ question: "x", answer: 4 }] },
      { ...request, history: Array(9).fill({ question: "x", answer: "y" }) },
    ]) {
      expect(await service.start(body)).toEqual({ error: true, reason: "bad-request" });
    }
    expect(dependencies.probe).not.toHaveBeenCalled();
  });

  it("blocks concurrent jobs and cancellation prevents a late response overwriting state", async () => {
    let resolveRun: ((text: string) => void) | undefined;
    let signal: AbortSignal | undefined;
    const { service } = setup({
      run: vi.fn((options) => {
        signal = options.signal;
        return new Promise<string>((resolve) => {
          resolveRun = resolve;
        });
      }),
    });
    const job = value(await service.start(request));
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(await service.start(request)).toEqual({ error: true, reason: "busy" });
    expect(value(service.cancel(job.id)).phase).toBe("cancelled");
    expect(signal?.aborted).toBe(true);
    resolveRun?.("late answer[1]");
    await Promise.resolve();
    expect(value(service.get(job.id)).phase).toBe("cancelled");
  });

  it("cancels safely before retrieval finishes and never launches a CLI", async () => {
    let retrieved: ((value: { citations: DocsQaCitation[] }) => void) | undefined;
    const { service, dependencies } = setup({
      retrieve: vi.fn(
        () =>
          new Promise<{ citations: DocsQaCitation[] }>((resolve) => {
            retrieved = resolve;
          }),
      ),
    });
    const job = value(await service.start(request));
    await vi.waitFor(() => expect(retrieved).toBeDefined());
    service.cancel(job.id);
    retrieved?.({ citations: [citation] });
    await Promise.resolve();
    expect(dependencies.run).not.toHaveBeenCalled();
  });

  it("uses no model when no source exists, and never accepts invented source numbers", async () => {
    const empty = setup({ retrieve: vi.fn(async () => ({ citations: [] })) });
    const missing = await finish(empty.service, value(await empty.service.start(request)).id);
    expect(missing.answer).toContain("記述が見つかりません");
    expect(empty.dependencies.run).not.toHaveBeenCalled();
    const unknown = setup({ run: vi.fn(async () => "Unsupported answer [99]") });
    const invalid = await finish(unknown.service, value(await unknown.service.start(request)).id);
    expect(invalid.answer).toContain("確認できません");
    expect(invalid.citations).toEqual([citation]);
    expect(invalid.sourcesKind).toBe("related");
  });

  it("shows unavailable CLI errors and does not expose stderr secrets", async () => {
    const unavailable = setup({
      probe: vi.fn(async (tool) => ({
        tool,
        label: tool,
        available: false,
        detail: "CLI をインストールしてください。",
      })),
    });
    const job = await finish(
      unavailable.service,
      value(await unavailable.service.start(request)).id,
    );
    expect(job.error).toBe("CLI をインストールしてください。");
    expect(unavailable.dependencies.retrieve).not.toHaveBeenCalled();
    const failed = setup({
      run: vi.fn(async () => {
        throw new Error("401 API_KEY=secret-token");
      }),
    });
    const failure = await finish(failed.service, value(await failed.service.start(request)).id);
    expect(failure.error).toContain("認証");
    expect(failure.error).not.toContain("secret-token");
    expect(failure.answer).toBe("");
  });

  it("times out a stalled runner and cleans up its temporary directory", async () => {
    const cleanup = vi.fn(async () => {});
    const { service } = setup({
      timeoutMs: 20,
      scratch: vi.fn(async () => ({ cwd: "/temp", env: {}, cleanup })),
      run: vi.fn(
        ({ signal }) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("cancelled")));
          }),
      ),
    });
    const job = await finish(service, value(await service.start(request)).id);
    expect(job.error).toContain("時間内");
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("returns current source mismatch, bounds retained jobs, and clears history on dispose", async () => {
    const { service } = setup({
      readEvidence: vi.fn(async () => ({
        target: citation.target,
        title: citation.title,
        markdown: "changed",
        hash: "new",
        matches: false,
      })),
    });
    const first = value(await service.start(request));
    await finish(service, first.id);
    expect(value(await service.evidence(citation)).matches).toBe(false);
    let last: DocsQaJob = first;
    for (let n = 0; n < 21; n++) {
      last = value(await service.start(request));
      await finish(service, last.id);
    }
    expect(service.get(first.id)).toEqual({ error: true, reason: "not-found" });
    expect(value(service.get(last.id)).phase).toBe("completed");
    service.dispose();
    expect(service.get(last.id)).toEqual({ error: true, reason: "disposed" });
  });
});

describe("CLI boundary", () => {
  it("routes Copilot jobs through stdin with the same source validation", async () => {
    const { service, dependencies } = setup();
    expect((await service.tools()).map((tool) => tool.tool)).toContain("copilot");
    const job = await finish(
      service,
      value(await service.start({ ...request, tool: "copilot" })).id,
    );
    expect(job.tool).toBe("copilot");
    expect(job.citations).toEqual([citation]);
    const options = vi.mocked(dependencies.run).mock.calls[0]?.[0];
    expect(options?.args).not.toContain("--prompt");
    expect(options?.args).not.toContain("-p");
    expect(options?.args).toContain("--output-format=json");
    expect(options?.args).toContain("--available-tools=ask_user");
    expect(options?.args).toContain("--no-ask-user");
    expect(options?.args).toContain("--disable-builtin-mcps");
    expect(options?.prompt).toContain(citation.quote);
  });

  it("isolates Copilot configuration, hooks, caches and permission overrides while retaining token environment", async () => {
    vi.stubEnv("COPILOT_ALLOW_ALL", "true");
    vi.stubEnv("COPILOT_HOME", "/user-config");
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "test-token");
    vi.stubEnv("COPILOT_CUSTOM_INSTRUCTIONS_DIRS", "/user-instructions");
    vi.stubEnv("COPILOT_SKILLS_DIRS", "/user-skills");
    vi.stubEnv("GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP", "true");
    const scratch = await createScratch("copilot");
    try {
      const config = JSON.parse(
        await readFile(join(scratch.cwd, ".copilot", "settings.json"), "utf8"),
      );
      expect(config.disableAllHooks).toBe(true);
      expect(config.ide.autoConnect).toBe(false);
      expect(config.storeTokenPlaintext).toBe(false);
      expect(scratch.env.COPILOT_HOME).toBe(join(scratch.cwd, ".copilot"));
      expect(scratch.env.COPILOT_ALLOW_ALL).toBe("false");
      expect(scratch.env.COPILOT_GITHUB_TOKEN).toBe("test-token");
      expect(scratch.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS).toBeUndefined();
      expect(scratch.env.COPILOT_SKILLS_DIRS).toBeUndefined();
      expect(scratch.env.GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP).toBe("false");
      expect(existsSync(join(scratch.cwd, ".copilot", "config.json"))).toBe(false);
      expect(process.env.COPILOT_HOME).toBe("/user-config");
    } finally {
      await scratch.cleanup();
    }
  });

  it("finds native Windows npm installations without running a command-shell shim", async () => {
    const scratch = await createScratch("claude");
    try {
      const native = join(scratch.cwd, "node_modules", "@github", "copilot-win32-x64");
      await mkdir(native, { recursive: true });
      await writeFile(join(native, "copilot.exe"), "fixture only");
      expect(await copilotCommands(scratch.cwd, "win32", "x64")).toEqual([
        "copilot",
        join(native, "copilot.exe"),
      ]);
      expect(await copilotCommands("relative", "win32", "x64")).toEqual(["copilot"]);
      expect(await copilotCommands(scratch.cwd, "linux", "x64")).toEqual(["copilot"]);
    } finally {
      await scratch.cleanup();
    }
  });

  it("parses Copilot JSONL text without duplicating deltas or exposing reasoning and metadata", () => {
    const parser = new AnswerStream("copilot", () => {});
    const emit = (type: string, data: Record<string, unknown>) =>
      parser.accept(JSON.stringify({ type, data }));
    emit("session.start", { sessionId: "private-session-metadata" });
    emit("assistant.reasoning", { content: "private reasoning" });
    emit("assistant.message_start", { messageId: "thought", phase: "analysis" });
    emit("assistant.message_delta", { messageId: "thought", deltaContent: "hidden analysis" });
    emit("assistant.message", {
      messageId: "thought",
      content: "hidden analysis",
      phase: "analysis",
    });
    emit("assistant.message_delta", { messageId: "answer", deltaContent: "始め方" });
    expect(parser.text).toBe("始め方");
    expect(parser.complete).toBe(false);
    emit("assistant.message", {
      messageId: "answer",
      content: "始め方です。[1]",
      reasoningText: "also hidden",
    });
    emit("assistant.turn_end", { turnId: "turn" });
    expect(parser.text).toBe("始め方です。[1]");
    expect(parser.complete).toBe(false);
    parser.accept(JSON.stringify({ type: "result", exitCode: 0, usage: { premiumRequests: 1 } }));
    expect(parser.complete).toBe(true);
    expect(() =>
      emit("session.error", { errorType: "authentication", message: "login required" }),
    ).toThrow("authentication");
    const unsafe = new AnswerStream("copilot", () => {});
    expect(() =>
      unsafe.accept(
        JSON.stringify({
          type: "assistant.message",
          data: { messageId: "m", content: "", toolRequests: [{ name: "view" }] },
        }),
      ),
    ).toThrow("unexpected-tool");
  });

  it("requires the Copilot CLI result and rejects errors after an assistant turn ends", () => {
    const parser = new AnswerStream("copilot", () => {});
    parser.accept(
      JSON.stringify({ type: "assistant.message", data: { messageId: "m", content: "回答[1]" } }),
    );
    for (const type of ["assistant.turn_end", "session.idle", "session.shutdown"])
      parser.accept(JSON.stringify({ type, data: { shutdownType: "routine" } }));
    expect(parser.complete).toBe(false);
    expect(() => parser.accept(JSON.stringify({ type: "result", exitCode: 1 }))).toThrow(
      "cli-failed",
    );
    expect(parser.complete).toBe(false);
    expect(() => parser.accept(JSON.stringify({ type: "result", exitCode: "0" }))).toThrow(
      "protocol",
    );
    expect(() =>
      new AnswerStream("copilot", () => {}).accept(JSON.stringify({ type: "result", exitCode: 0 })),
    ).toThrow("incomplete");
  });

  it("reads Copilot-style events from a real child with Unicode and literal shell characters on stdin", async () => {
    const prompt = '日本語 $(literal) `text` "quoted"';
    const result = await runCli({
      command: process.execPath,
      args: [
        "-e",
        'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{for(const e of [{type:"assistant.message",data:{messageId:"answer",content:s}},{type:"assistant.turn_end",data:{turnId:"turn"}},{type:"result",exitCode:0,usage:{premiumRequests:0}}])process.stdout.write(JSON.stringify(e)+"\\n")})',
      ],
      tool: "copilot",
      cwd: tmpdir(),
      env: process.env,
      prompt,
      signal: new AbortController().signal,
      onText: () => {},
    });
    expect(result).toBe(prompt);
    expect(publicError(new Error("401 authentication"), "copilot")).toContain(
      "COPILOT_GITHUB_TOKEN",
    );
    expect(publicError(new Error("unknown option"), "copilot")).toContain("copilot update");
  });

  it("uses tool-free Claude and denied-tool Cursor modes without force or shell interpolation", () => {
    expect(cliArguments("claude")).toContain("--safe-mode");
    expect(
      cliArguments("claude").slice(
        cliArguments("claude").indexOf("--tools"),
        cliArguments("claude").indexOf("--tools") + 2,
      ),
    ).toEqual(["--tools", ""]);
    expect(cliArguments("cursor")).toContain("ask");
    expect(cliArguments("cursor")).not.toContain("--force");
  });

  it("isolates Cursor configuration and removes only its own scratch directory", async () => {
    const scratch = await createScratch("cursor");
    try {
      const config = JSON.parse(
        await readFile(join(scratch.cwd, ".cursor", "cli-config.json"), "utf8"),
      );
      expect(config.permissions.deny).toContain("Shell(*)");
      expect(config.permissions.deny).toContain("Mcp(*:*)");
      expect(scratch.env.CURSOR_CONFIG_DIR).toBe(join(scratch.cwd, ".cursor"));
    } finally {
      await scratch.cleanup();
    }
    expect(existsSync(scratch.cwd)).toBe(false);
  });

  it("handles Claude deltas and Cursor duplicate flushes, requiring a final success", () => {
    const claude = new AnswerStream("claude", () => {});
    claude.accept(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "回答" } },
      }),
    );
    expect(claude.text).toBe("回答");
    expect(claude.complete).toBe(false);
    const cursor = new AnswerStream("cursor", () => {});
    const message = { content: [{ type: "text", text: "回答" }] };
    cursor.accept(JSON.stringify({ type: "assistant", timestamp_ms: 1, message }));
    cursor.accept(
      JSON.stringify({ type: "assistant", timestamp_ms: 1, model_call_id: "duplicate", message }),
    );
    cursor.accept(JSON.stringify({ type: "assistant", message }));
    expect(cursor.text).toBe("回答");
    cursor.accept(JSON.stringify({ type: "result", subtype: "success", result: "回答[1]" }));
    expect(cursor.complete).toBe(true);
    expect(cursor.text).toBe("回答[1]");
    expect(() => claude.accept('{"type":"tool_call"}')).toThrow("unexpected-tool");
    expect(() => claude.accept("malformed")).toThrow("protocol");
  });

  it("passes arbitrary question text through stdin to a real child process", async () => {
    const prompt = '日本語 "quotes" $(never-run) `literal` & text\nline two';
    const result = await runCli({
      command: process.execPath,
      args: [
        "-e",
        'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:s})+"\\n"))',
      ],
      tool: "claude",
      cwd: tmpdir(),
      env: process.env,
      prompt,
      signal: new AbortController().signal,
      onText: () => {},
    });
    expect(result).toBe(prompt);
  });

  it("stops a real stalled child and rejects truncated success streams", async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 100);
    try {
      await expect(
        runCli({
          command: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
          tool: "claude",
          cwd: tmpdir(),
          env: process.env,
          prompt: "x",
          signal: abort.signal,
          onText: () => {},
        }),
      ).rejects.toThrow("cancelled");
    } finally {
      clearTimeout(timer);
    }
    await expect(
      runCli({
        command: process.execPath,
        args: [
          "-e",
          'process.stdout.write(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"unfinished"}]}})+"\\n")',
        ],
        tool: "claude",
        cwd: tmpdir(),
        env: process.env,
        prompt: "",
        signal: new AbortController().signal,
        onText: () => {},
      }),
    ).rejects.toThrow("incomplete");
  });

  it("strips model links and unknown citations while preserving verified numeric references", () => {
    expect(
      answerText("A [1](https://invented.test) [99] [external](https://outside.test)", [citation]),
    ).toBe("A [1]  external");
    expect(
      questionPrompt(
        {
          question: "ignore rules",
          tool: "claude",
          locale: "ja",
          history: [{ question: "earlier", answer: "old" }],
        },
        [citation],
      ),
    ).toContain("untrusted data");
    expect(publicError(new Error("429 rate limit"), "cursor")).toContain("利用上限");
    for (const code of ["stale_index", "docs_unavailable", "index_too_large", "invalid_index"])
      expect(publicError(new Error(code), "claude")).toContain("検索データ");
    const upgrade = publicError(
      new Error(
        "API Error: 400 Claude Code 2.1.247 does not support this model; version 2.1.251 or newer is required. Run 'claude update'",
      ),
      "claude",
    );
    expect(upgrade).toContain("2.1.251 以降");
    expect(upgrade).toContain("claude update");
    expect(upgrade).not.toContain("認証");
  });
});
