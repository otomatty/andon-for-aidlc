import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readQuestionEvidence, retrieveQuestionContext } from "@aidlc-guide/official-docs";
import type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaJob,
  DocsQaRequest,
  DocsQaResult,
  DocsQaToolStatus,
} from "@aidlc-guide/shared-types";
import {
  type CliCapability,
  cliArguments,
  LABELS,
  probeTool,
  publicError,
  runCli,
} from "../ai-cli/process";
import { answerText, citedSources, questionPrompt } from "./prompt";
import { createScratch } from "../ai-cli/scratch";
import { parseQuestion } from "./validation";

export interface DocsQaService {
  tools(recheck?: boolean): Promise<DocsQaToolStatus[]>;
  start(body: unknown): Promise<DocsQaResult<DocsQaJob>>;
  get(id: string): DocsQaResult<DocsQaJob>;
  cancel(id: string): DocsQaResult<DocsQaJob>;
  evidence(body: unknown): Promise<DocsQaResult<DocsQaEvidence>>;
  dispose(): void;
}

export interface DocsQaDependencies {
  retrieve: typeof retrieveQuestionContext;
  readEvidence: typeof readQuestionEvidence;
  probe: typeof probeTool;
  run: typeof runCli;
  scratch: typeof createScratch;
  timeoutMs: number;
  now(): number;
}

interface StoredJob {
  job: DocsQaJob;
  issued: DocsQaCitation[];
  abort: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}
const MAX_JOBS = 20;
const RETAIN_MS = 30 * 60_000;
const active = (job: DocsQaJob) =>
  job.phase === "searching" || job.phase === "reading" || job.phase === "answering";
const ok = <T>(value: T): DocsQaResult<T> => ({ ok: true, value: structuredClone(value) });
const error = <T>(reason: string): DocsQaResult<T> => ({ error: true, reason });

export function createDocsQaService(config: {
  docsRoot: string;
  dependencies?: Partial<DocsQaDependencies>;
}): DocsQaService {
  const deps: DocsQaDependencies = {
    retrieve: retrieveQuestionContext,
    readEvidence: readQuestionEvidence,
    probe: probeTool,
    run: runCli,
    scratch: createScratch,
    timeoutMs: 120_000,
    now: Date.now,
    ...config.dependencies,
  };
  const jobs = new Map<string, StoredJob>();
  let disposed = false;
  let probing: Promise<CliCapability[]> | undefined;
  let capabilities: { at: number; value: CliCapability[] } | undefined;
  const prune = () => {
    for (const [id, entry] of jobs)
      if (!active(entry.job) && deps.now() - entry.job.createdAt > RETAIN_MS) jobs.delete(id);
    while (jobs.size >= MAX_JOBS) {
      const oldest = Array.from(jobs.values()).find((entry) => !active(entry.job));
      if (!oldest) break;
      jobs.delete(oldest.job.id);
    }
  };
  const tools = async (): Promise<CliCapability[]> => {
    if (disposed)
      return (["claude", "cursor", "copilot"] as const).map((tool) => ({
        tool,
        label: LABELS[tool],
        available: false,
        detail: "文書への質問はローカルの通常モードで利用できます。",
      }));
    if (capabilities && deps.now() - capabilities.at < 30_000) return capabilities.value;
    probing ??= Promise.all([deps.probe("claude"), deps.probe("cursor"), deps.probe("copilot")])
      .then((value) => {
        capabilities = { at: deps.now(), value };
        return value;
      })
      .finally(() => {
        probing = undefined;
      });
    return probing;
  };
  const run = async (entry: StoredJob, request: DocsQaRequest) => {
    const { job, abort } = entry;
    let scratch: Awaited<ReturnType<typeof createScratch>> | undefined;
    const running = () => !disposed && !abort.signal.aborted && active(job);
    entry.timer = setTimeout(() => {
      if (!running()) return;
      job.phase = "error";
      job.error = "回答の生成が時間内に終わりませんでした。質問の範囲を絞って再試行してください。";
      abort.abort();
    }, deps.timeoutMs);
    entry.timer.unref?.();
    try {
      const capability = (await tools()).find((candidate) => candidate.tool === request.tool);
      if (!running()) return;
      if (!capability?.available || !capability.command) {
        job.phase = "error";
        job.error =
          capability?.detail ?? "CLI が利用できません。アプリを再起動して確認してください。";
        return;
      }
      const context = await deps.retrieve(config.docsRoot, request);
      if (!running()) return;
      job.phase = "reading";
      let size = 0;
      job.citations = context.citations
        .filter((citation) => {
          size += citation.quote.length;
          return size <= 48_000;
        })
        .slice(0, 8);
      entry.issued = structuredClone(job.citations);
      if (!job.citations.length) {
        job.phase = "completed";
        job.answer =
          request.locale === "ja"
            ? "内蔵ドキュメントから、この質問を確認できる記述が見つかりませんでした。ツール名やステージ名を含めて質問するか、対象の文書を開いて「この文書について質問」をお試しください。"
            : "The bundled documentation did not contain a source that could confirm this answer. Include a tool or stage name, or open a document and ask about that page.";
        return;
      }
      scratch = await deps.scratch(request.tool);
      if (!running()) return;
      job.phase = "answering";
      job.sourcesKind = "citations";
      const supplied = structuredClone(job.citations);
      const text = await deps.run({
        command: capability.command,
        args: cliArguments(request.tool),
        tool: request.tool,
        cwd: scratch.cwd,
        env: scratch.env,
        prompt: questionPrompt(request, supplied),
        signal: abort.signal,
        onText: (text) => {
          if (running()) job.answer = answerText(text, supplied);
        },
      });
      if (!running()) return;
      job.answer = answerText(text, supplied);
      job.citations = citedSources(job.answer, supplied);
      if (!job.answer || !job.citations.length) {
        job.answer =
          request.locale === "ja"
            ? "内蔵ドキュメントに基づく回答を確認できませんでした。質問の範囲を絞って再試行してください。"
            : "A sourced answer could not be confirmed from the bundled documentation. Try a more specific question.";
        job.citations = supplied;
        job.sourcesKind = "related";
      }
      job.phase = "completed";
    } catch (failure) {
      if (running()) {
        job.phase = "error";
        job.answer = "";
        job.error = publicError(failure, request.tool);
      }
    } finally {
      clearTimeout(entry.timer);
      try {
        await scratch?.cleanup();
      } catch {
        /* Temporary cleanup must not replace the answer/error. */
      }
    }
  };
  return {
    async tools(recheck = false) {
      // An explicit UI recheck must discover a newly installed or updated CLI.
      if (recheck) capabilities = undefined;
      return (await tools()).map(({ tool, label, available, detail }) => ({
        tool,
        label,
        available,
        ...(detail ? { detail } : {}),
      }));
    },
    async start(body) {
      if (disposed) return error("disposed");
      const request = parseQuestion(body);
      if (!request) return error("bad-request");
      if (Array.from(jobs.values()).some((entry) => active(entry.job))) return error("busy");
      prune();
      const entry: StoredJob = {
        abort: new AbortController(),
        issued: [],
        job: {
          id: randomUUID(),
          question: request.question,
          tool: request.tool,
          locale: request.locale,
          ...(request.target ? { target: structuredClone(request.target) } : {}),
          phase: "searching",
          answer: "",
          citations: [],
          createdAt: deps.now(),
        },
      };
      jobs.set(entry.job.id, entry);
      queueMicrotask(() => {
        void run(entry, request);
      });
      return ok(entry.job);
    },
    get(id) {
      if (disposed) return error("disposed");
      const entry = jobs.get(id);
      if (!entry || (!active(entry.job) && deps.now() - entry.job.createdAt > RETAIN_MS))
        return error("not-found");
      return ok(entry.job);
    },
    cancel(id) {
      if (disposed) return error("disposed");
      const entry = jobs.get(id);
      if (!entry) return error("not-found");
      if (active(entry.job)) {
        entry.job.phase = "cancelled";
        entry.abort.abort();
        clearTimeout(entry.timer);
      }
      return ok(entry.job);
    },
    async evidence(body) {
      if (disposed) return error("disposed");
      let citation: DocsQaCitation | undefined;
      for (const entry of jobs.values()) {
        if (deps.now() - entry.job.createdAt <= RETAIN_MS)
          citation ??= entry.issued.find((candidate) => isDeepStrictEqual(candidate, body));
      }
      if (!citation) return error("not-found");
      try {
        return ok(await deps.readEvidence(config.docsRoot, citation));
      } catch {
        return error("source-unavailable");
      }
    },
    dispose() {
      disposed = true;
      for (const entry of jobs.values()) {
        entry.abort.abort();
        clearTimeout(entry.timer);
      }
      jobs.clear();
    },
  };
}
