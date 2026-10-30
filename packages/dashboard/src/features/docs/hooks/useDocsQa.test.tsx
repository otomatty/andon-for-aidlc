import type {
  DocsQaCitation,
  DocsQaEvidence,
  DocsQaJob,
  DocsQaPhase,
  DocsQaRequest,
  DocsQaToolStatus,
} from "@andon/shared-types";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocsShell } from "@/features/docs/DocsPage.tsx";
import { useDocsQa } from "@/features/docs/hooks/useDocsQa.ts";
import { docsQaApi } from "@/services/docs-qa.ts";
import {
  createBrowserTransport,
  type GetJsonResult,
  type PostJsonResult,
  setTransport,
} from "@/services/transport/index.ts";
import { StoreProvider } from "@/store/context.tsx";
import { chooseOption } from "@tests/choose-option.ts";

const GUIDE: DocsQaCitation = {
  id: "1",
  sourceId: "guide-ja-revision-1",
  target: { kind: "guide", path: "getting-started.md", locale: "ja" },
  title: "拡張機能のはじめかた",
  headings: ["初期設定"],
  version: "Andon 1.0.0",
  hash: "guide-revision-1",
  startLine: 7,
  endLine: 7,
  quote: "設定画面を開きます。",
};

const OFFICIAL_EN: DocsQaCitation = {
  id: "2",
  sourceId: "official-en-revision-1",
  target: { kind: "official", path: "guide/harnesses/cursor.md", locale: "en" },
  title: "Cursor setup",
  headings: ["Getting started"],
  version: "aidlc-workflows 2.8.0",
  hash: "official-en-revision-1",
  startLine: 5,
  endLine: 5,
  quote: "Run /aidlc to start the workflow.",
};

const OFFICIAL_JA: DocsQaCitation = {
  ...OFFICIAL_EN,
  id: "3",
  sourceId: "official-ja-revision-1",
  target: { ...OFFICIAL_EN.target, locale: "ja" },
  title: "Cursor の設定",
  hash: "official-ja-revision-1",
  quote: "/aidlc でワークフローを開始します。",
};

const TOOLS: DocsQaToolStatus[] = [
  { tool: "claude", label: "Claude Code", available: true },
  { tool: "cursor", label: "Cursor", available: true },
  { tool: "copilot", label: "GitHub Copilot", available: true },
];

function evidenceFor(citation: DocsQaCitation, changed = false): DocsQaEvidence {
  const markdown =
    citation.target.kind === "guide"
      ? `# ${citation.title}\n\n${citation.quote}\n\n## 初期設定\n\n${citation.quote}\n`
      : `# ${citation.title}\n\n## Getting started\n\n${citation.quote}\n`;
  return {
    target: citation.target,
    title: citation.title,
    markdown: changed ? `# 更新された文書\n\n移動した本文です。\n\n${citation.quote}\n` : markdown,
    hash: changed ? "revision-2" : citation.hash,
    matches: !changed,
  };
}

interface ApiOptions {
  citations?: DocsQaCitation[];
  phases?: DocsQaPhase[];
  keepRunning?: boolean;
  tools?: DocsQaToolStatus[];
  changed?: boolean;
  answerError?: string;
  evidence?: (citation: DocsQaCitation) => Promise<DocsQaEvidence>;
  firstJobError?: "not-found" | "disposed";
  firstAskDelay?: Promise<void>;
  cancelError?: string;
}

function stubApi(options: ApiOptions = {}) {
  const citations = options.citations ?? [GUIDE];
  const jobs = new Map<string, DocsQaJob>();
  const polls = new Map<string, number>();
  const requests: DocsQaRequest[] = [];
  const getJson = vi.fn(async (route: string): Promise<GetJsonResult> => {
    let value: unknown;
    if (route.startsWith("/api/docs-qa/tools")) {
      value = options.tools ?? TOOLS;
    } else if (route.startsWith("/api/docs-qa/job?id=")) {
      const id = new URL(route, "http://localhost").searchParams.get("id") ?? "";
      if (id === "question-1" && options.firstJobError) {
        return { reached: true, body: { error: true, reason: options.firstJobError } };
      }
      const job = jobs.get(id);
      if (job === undefined) throw new Error(`Unknown test job: ${id}`);
      const index = polls.get(id) ?? 0;
      const phases = options.phases ?? ["completed"];
      const phase = options.keepRunning
        ? "answering"
        : (phases[index] ?? phases.at(-1) ?? "completed");
      polls.set(id, index + 1);
      const updated: DocsQaJob = {
        ...job,
        phase,
        answer:
          phase === "completed"
            ? `設定を確認してから開始します。${citations.map((citation) => `[${citation.id}]`).join(" ")}`
            : "",
        citations: phase === "completed" ? citations : [],
        ...(options.answerError ? { error: options.answerError } : {}),
      };
      jobs.set(id, updated);
      value = updated;
    } else if (route === "/api/official-docs/manifest") {
      value = { sourceVersion: "aidlc-workflows 2.8.0", source: "aidlc-workflows" };
    } else if (route.startsWith("/api/official-docs/toc/")) {
      value = {
        overview: [],
        guide: [
          {
            id: OFFICIAL_EN.target.path,
            path: OFFICIAL_EN.target.path,
            title: "Cursor setup",
            children: [],
          },
        ],
        reference: [],
      };
    } else if (route === "/api/guides") {
      value = [
        GUIDE,
        ...citations.filter(
          (item) => item.target.kind === "guide" && item.target.path !== GUIDE.target.path,
        ),
      ].map((item) => ({ name: item.target.path, title: item.title }));
    } else if (citations.some((item) => route === `/api/guides/${item.target.path}`)) {
      const item = citations.find((item) => route === `/api/guides/${item.target.path}`)!;
      value = { name: item.target.path, title: item.title, markdown: evidenceFor(item).markdown };
    } else if (route === `/api/guides/${GUIDE.target.path}`) {
      value = {
        name: GUIDE.target.path,
        title: GUIDE.title,
        markdown: evidenceFor(GUIDE).markdown,
      };
    } else if (route.startsWith("/api/official-docs/en/")) {
      value = {
        localeRequested: "en",
        localeServed: "en",
        path: OFFICIAL_EN.target.path,
        title: OFFICIAL_EN.title,
        bodyMarkdown: evidenceFor(OFFICIAL_EN).markdown,
        sourceVersion: OFFICIAL_EN.version,
        anchorApplied: "none",
      };
    } else if (route.startsWith("/api/official-docs/ja/")) {
      value = {
        localeRequested: "ja",
        localeServed: "ja",
        path: OFFICIAL_JA.target.path,
        title: OFFICIAL_JA.title,
        bodyMarkdown: evidenceFor(OFFICIAL_JA).markdown,
        sourceVersion: OFFICIAL_JA.version,
        anchorApplied: "none",
      };
    } else {
      throw new Error(`Unexpected GET ${route}`);
    }
    return { reached: true, body: { ok: true, value } };
  });
  const postJson = vi.fn(async (route: string, body: unknown): Promise<PostJsonResult> => {
    let value: unknown;
    if (route === "/api/docs-qa/ask") {
      const request = body as DocsQaRequest;
      requests.push(request);
      const job: DocsQaJob = {
        id: `question-${requests.length}`,
        question: request.question,
        tool: request.tool,
        locale: request.locale,
        ...(request.target ? { target: request.target } : {}),
        phase: "searching",
        answer: "",
        citations: [],
        createdAt: requests.length,
      };
      jobs.set(job.id, job);
      if (requests.length === 1 && options.firstAskDelay) await options.firstAskDelay;
      value = job;
    } else if (route === "/api/docs-qa/evidence") {
      value = options.evidence
        ? await options.evidence(body as DocsQaCitation)
        : evidenceFor(body as DocsQaCitation, options.changed);
    } else if (route === "/api/docs-qa/cancel") {
      if (options.cancelError) {
        return { ok: false, status: 500, body: { error: true, reason: options.cancelError } };
      }
      const job = jobs.get((body as { id: string }).id);
      if (job === undefined) throw new Error("No test job to cancel");
      const cancelled: DocsQaJob = { ...job, phase: "cancelled" };
      jobs.set(job.id, cancelled);
      value = cancelled;
    } else {
      throw new Error(`Unexpected POST ${route}`);
    }
    return { ok: true, status: 200, body: { ok: true, value } };
  });
  setTransport({ getJson, postJson, subscribe: () => () => {} });
  return { getJson, postJson, requests };
}

function showDocs(): void {
  render(
    <StoreProvider preloaded={{ route: { name: "docs" } }}>
      <div data-testid="app-scroll">
        <DocsShell />
      </div>
    </StoreProvider>,
  );
}

async function ask(question = "Cursor で始めるには？"): Promise<void> {
  await userEvent.type(screen.getByRole("textbox", { name: "質問" }), question);
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "質問する" });
  await waitFor(() => expect(button.disabled).toBe(false));
  await userEvent.click(button);
}

/** The cited source opened beside the conversation. */
function sourcePanel(): HTMLElement {
  return screen.getByTestId("docs-source-panel");
}

function panelHighlights(): HTMLElement[] {
  return Array.from(sourcePanel().querySelectorAll<HTMLElement>('[data-doc-evidence="true"]'));
}

function highlighted(): HTMLElement[] {
  return Array.from(
    screen.getByTestId("docs-article").querySelectorAll<HTMLElement>('[data-doc-evidence="true"]'),
  );
}

const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  setTransport(createBrowserTransport());
  vi.restoreAllMocks();
});

describe("document questions and verified source navigation", () => {
  it("opens a Tips citation in workflow navigation and keeps its evidence highlight", async () => {
    const tip: DocsQaCitation = {
      ...GUIDE,
      target: { kind: "guide", path: "aidlc-tip-hooks.md", locale: "ja" },
      title: "Claude Codeのhooksを修復する",
    };
    stubApi({ citations: [tip] });
    showDocs();
    await ask();
    await userEvent.click(await screen.findByRole("button", { name: `参照 1: ${tip.title}` }));
    await waitFor(() =>
      expect(panelHighlights().map((node) => node.textContent)).toEqual([tip.quote]),
    );
    await userEvent.click(
      within(sourcePanel()).getByRole("button", { name: "ドキュメントで開く" }),
    );
    await waitFor(() => expect(highlighted().map((node) => node.textContent)).toEqual([tip.quote]));
    expect(screen.queryByTestId("docs-chat")).toBeNull();
    await userEvent.click(screen.getByTestId("docs-menu"));
    expect(screen.getByRole("tab", { name: "ワークフロー" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "運用Tips" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      (await screen.findByTestId("docs-guide-aidlc-tip-hooks.md")).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("uses cached detection on reopen and explicitly rechecks only on refresh", async () => {
    const api = stubApi();
    const { result, rerender } = renderHook(({ open }) => useDocsQa(open, "ja"), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(result.current.tools).toEqual(TOOLS));
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(api.getJson).toHaveBeenCalledWith("/api/docs-qa/tools?recheck=true"),
    );
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => expect(api.getJson).toHaveBeenCalledTimes(3));
    expect(api.getJson.mock.calls.map(([route]) => route)).toEqual([
      "/api/docs-qa/tools",
      "/api/docs-qa/tools?recheck=true",
      "/api/docs-qa/tools",
    ]);
  });

  it("keeps cancellation terminal when an older running response arrives in the same batch", async () => {
    stubApi();
    const job: DocsQaJob = {
      id: "race",
      question: "質問",
      tool: "claude",
      phase: "answering",
      answer: "",
      citations: [],
      createdAt: 1,
    };
    let resolvePoll: (value: DocsQaJob) => void = () => {};
    vi.spyOn(docsQaApi, "ask").mockResolvedValue(job);
    vi.spyOn(docsQaApi, "job").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    vi.spyOn(docsQaApi, "cancel").mockResolvedValue({ ...job, phase: "cancelled" });
    const { result } = renderHook(() => useDocsQa(true, "ja"));
    await act(async () => {
      await result.current.submit("質問");
    });
    await waitFor(() => expect(docsQaApi.job).toHaveBeenCalled());
    await act(async () => {
      await result.current.cancel();
      resolvePoll(job);
      await Promise.resolve();
    });
    expect(result.current.turns[0]?.phase).toBe("cancelled");
    expect(result.current.busy).toBe(false);
  });
  it("submits a question, shows progress and displays the answer with its source", async () => {
    const api = stubApi({ phases: ["reading", "answering", "completed"] });
    showDocs();
    await ask();
    expect(await screen.findByText("参照する箇所を確認しています…")).toBeTruthy();
    expect(await screen.findByText("文書をもとに回答を作成しています…")).toBeTruthy();
    expect(await screen.findByText("回答が完了しました")).toBeTruthy();
    expect(api.requests).toEqual([
      { question: "Cursor で始めるには？", tool: "claude", locale: "ja", history: [] },
    ]);
    expect(api.getJson).toHaveBeenCalledWith("/api/docs-qa/job?id=question-1");
    const answer = screen.getByTestId("docs-answer");
    expect(await within(answer).findByRole("link", { name: "1" })).toBeTruthy();
    expect(within(answer).getByRole("button", { name: `参照 1: ${GUIDE.title}` })).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "続けて質問する" }).value).toBe(
      "",
    );
  });

  it("opens the inline guide citation beside the answer, then the full document, and restores draft and scroll", async () => {
    const api = stubApi();
    showDocs();
    await ask();
    await screen.findByText("回答が完了しました");
    const draft = "ログイン後の設定も知りたい";
    await userEvent.type(screen.getByRole("textbox", { name: "続けて質問する" }), draft);
    await userEvent.click(
      await within(screen.getByTestId("docs-answer")).findByRole("link", {
        name: "1",
      }),
    );
    await waitFor(() =>
      expect(panelHighlights().map((node) => node.textContent)).toEqual([GUIDE.quote]),
    );
    const panelSurface = within(sourcePanel()).getByTestId("markdown-surface");
    const panelDuplicates = within(panelSurface).getAllByText(GUIDE.quote);
    expect(panelHighlights()).toEqual([panelDuplicates[1]]);
    expect(document.activeElement).toBe(panelDuplicates[1]);
    expect(api.postJson).toHaveBeenCalledWith("/api/docs-qa/evidence", GUIDE);
    // The conversation stays put while a source is open beside it.
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "続けて質問する" }).value).toBe(
      draft,
    );

    const scroll = screen.getByTestId("app-scroll");
    scroll.scrollTop = 420;
    await userEvent.click(
      within(sourcePanel()).getByRole("button", { name: "ドキュメントで開く" }),
    );
    await waitFor(() =>
      expect(highlighted().map((node) => node.textContent)).toEqual([GUIDE.quote]),
    );
    const surface = screen.getByTestId("markdown-surface");
    const duplicates = within(surface).getAllByText(GUIDE.quote);
    expect(highlighted()).toEqual([duplicates[1]]);
    expect(api.getJson).toHaveBeenCalledWith(`/api/guides/${GUIDE.target.path}`);
    expect(screen.queryByTestId("docs-chat")).toBeNull();
    scroll.scrollTop = 0;
    await userEvent.click(screen.getByRole("button", { name: "回答に戻る" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "続けて質問する" }).value).toBe(
      draft,
    );
    expect(screen.getByTestId("docs-answer").textContent).toContain(
      "設定を確認してから開始します。",
    );
    expect(scroll.scrollTop).toBe(420);
    expect(document.activeElement).toBe(screen.getByTestId("docs-answer"));
  });

  it("asks GitHub Copilot and keeps its answer and draft when returning from cited evidence", async () => {
    const api = stubApi();
    showDocs();
    await screen.findByRole("combobox", { name: "回答に使うツール" });
    await chooseOption("回答に使うツール", "GitHub Copilot");
    await ask("拡張機能の初期設定は？");
    await screen.findByText("回答が完了しました");
    expect(api.requests).toEqual([
      { question: "拡張機能の初期設定は？", tool: "copilot", locale: "ja", history: [] },
    ]);
    const answer = screen.getByTestId("docs-answer");
    expect(within(answer).getByText("内蔵ドキュメントから回答 · GitHub Copilot")).toBeTruthy();
    await userEvent.type(
      screen.getByRole("textbox", { name: "続けて質問する" }),
      "設定後の操作は？",
    );
    await userEvent.click(await within(answer).findByRole("link", { name: "1" }));
    await waitFor(() =>
      expect(panelHighlights().map((node) => node.textContent)).toEqual([GUIDE.quote]),
    );
    expect(api.postJson).toHaveBeenCalledWith("/api/docs-qa/evidence", GUIDE);
    expect(document.activeElement).toBe(panelHighlights()[0]);
    await userEvent.click(screen.getByRole("button", { name: "出典を閉じる" }));
    expect(screen.queryByTestId("docs-source-panel")).toBeNull();
    expect(
      within(screen.getByTestId("docs-answer")).getByText(
        "内蔵ドキュメントから回答 · GitHub Copilot",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "回答に使うツール" }).textContent).toContain(
      "GitHub Copilot",
    );
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "続けて質問する" }).value).toBe(
      "設定後の操作は？",
    );
  });

  it("shows each source in its own language beside the answer without changing the reader's locale", async () => {
    const api = stubApi({ citations: [OFFICIAL_EN, OFFICIAL_JA] });
    showDocs();
    await ask();
    await userEvent.click(
      await screen.findByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
    );
    await waitFor(() =>
      expect(panelHighlights().map((node) => node.textContent)).toEqual([OFFICIAL_EN.quote]),
    );
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    await userEvent.click(screen.getByRole("button", { name: "参照 3 を表示" }));
    await waitFor(() =>
      expect(panelHighlights().map((node) => node.textContent)).toEqual([OFFICIAL_JA.quote]),
    );
    expect(api.postJson).toHaveBeenCalledWith("/api/docs-qa/evidence", OFFICIAL_JA);
    await userEvent.click(screen.getByRole("button", { name: "参照 2 を表示" }));
    await waitFor(() =>
      expect(panelHighlights().map((node) => node.textContent)).toEqual([OFFICIAL_EN.quote]),
    );
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
  });

  it("opens the full document in the source's locale and switches between English and Japanese references on the same path", async () => {
    const api = stubApi({ citations: [OFFICIAL_EN, OFFICIAL_JA] });
    showDocs();
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    await ask();
    await userEvent.click(
      await screen.findByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
    );
    await userEvent.click(
      await within(sourcePanel()).findByRole("button", { name: "ドキュメントで開く" }),
    );
    await waitFor(() =>
      expect(highlighted().map((node) => node.textContent)).toEqual([OFFICIAL_EN.quote]),
    );
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en");
    expect(api.getJson).toHaveBeenCalledWith(`/api/official-docs/en/${OFFICIAL_EN.target.path}`);
    await userEvent.click(screen.getByRole("button", { name: "参照 3 を表示" }));
    await waitFor(() =>
      expect(highlighted().map((node) => node.textContent)).toEqual([OFFICIAL_JA.quote]),
    );
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    expect(api.getJson).toHaveBeenCalledWith(`/api/official-docs/ja/${OFFICIAL_JA.target.path}`);
    expect(api.postJson).toHaveBeenCalledWith("/api/docs-qa/evidence", OFFICIAL_JA);
    await userEvent.click(screen.getByRole("button", { name: "参照 2 を表示" }));
    await waitFor(() =>
      expect(highlighted().map((node) => node.textContent)).toEqual([OFFICIAL_EN.quote]),
    );
    expect(screen.queryByText(OFFICIAL_JA.quote)).toBeNull();
  });

  it("shows the updated document without a stale highlight and can regenerate the answer", async () => {
    const api = stubApi({ changed: true });
    showDocs();
    await ask();
    await userEvent.click(await screen.findByRole("button", { name: `参照 1: ${GUIDE.title}` }));
    expect(await screen.findByText("回答後に文書が更新されています")).toBeTruthy();
    expect(within(sourcePanel()).getByTestId("markdown-surface").textContent).toContain(
      "移動した本文です。",
    );
    expect(panelHighlights()).toEqual([]);
    await userEvent.click(screen.getByText("回答時の引用文を見る"));
    expect(sourcePanel().textContent).toContain(GUIDE.quote);
    await userEvent.click(screen.getByRole("button", { name: "最新の文書で回答を更新" }));
    await waitFor(() => expect(api.requests).toHaveLength(2));
    expect(api.requests[1]?.question).toBe("Cursor で始めるには？");
    expect(screen.getAllByTestId("docs-answer")).toHaveLength(2);
  });

  it("ignores a delayed citation response after the reader has selected another source", async () => {
    const response: { finish?: (evidence: DocsQaEvidence) => void } = {};
    const delayedEnglish = new Promise<DocsQaEvidence>((resolve) => {
      response.finish = resolve;
    });
    stubApi({
      citations: [OFFICIAL_EN, OFFICIAL_JA],
      evidence: async (citation) => (citation.id === "2" ? delayedEnglish : evidenceFor(citation)),
    });
    showDocs();
    await ask();
    await userEvent.click(
      await screen.findByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
    );
    await userEvent.click(screen.getByRole("button", { name: "参照 3 を表示" }));
    await waitFor(() =>
      expect(highlighted().map((node) => node.textContent)).toEqual([OFFICIAL_JA.quote]),
    );
    const finish = response.finish;
    if (finish === undefined) throw new Error("Missing test response resolver");
    await act(async () => {
      finish(evidenceFor(OFFICIAL_EN));
    });
    expect(highlighted().map((node) => node.textContent)).toEqual([OFFICIAL_JA.quote]);
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
  });

  it("includes the previous answer when the reader asks a follow-up", async () => {
    const api = stubApi();
    showDocs();
    await ask();
    await screen.findByText("回答が完了しました");
    await chooseOption("回答に使うツール", "Cursor");
    await userEvent.type(
      screen.getByRole("textbox", { name: "続けて質問する" }),
      "その次の操作は？",
    );
    await userEvent.click(screen.getByRole("button", { name: "質問する" }));
    await waitFor(() => expect(api.requests).toHaveLength(2));
    expect(api.requests[1]).toMatchObject({
      question: "その次の操作は？",
      tool: "cursor",
      history: [{ question: "Cursor で始めるには？", answer: "設定を確認してから開始します。[1]" }],
    });
    expect(screen.getAllByTestId("docs-answer")).toHaveLength(2);
  });

  it("restores Japanese for a follow-up after returning from an English source", async () => {
    const api = stubApi({ citations: [OFFICIAL_EN] });
    showDocs();
    await ask();
    await userEvent.click(
      await screen.findByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
    );
    await userEvent.click(
      await within(sourcePanel()).findByRole("button", { name: "ドキュメントで開く" }),
    );
    await waitFor(() => expect(highlighted()).toHaveLength(1));
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en");
    await userEvent.click(screen.getByRole("button", { name: "回答に戻る" }));
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    await userEvent.type(screen.getByRole("textbox", { name: "続けて質問する" }), "次の操作は？");
    await userEvent.click(screen.getByRole("button", { name: "質問する" }));
    await waitFor(() => expect(api.requests).toHaveLength(2));
    expect(api.requests[1]?.locale).toBe("ja");
    expect(api.requests[1]?.target).toBeUndefined();
  });

  it.each([false, true])(
    "regenerates an old answer using its original scope and language, scoped=%s",
    async (scoped) => {
      const api = stubApi({ citations: [GUIDE, OFFICIAL_EN], changed: true });
      showDocs();
      await ask();
      await screen.findByText("回答が完了しました");
      if (scoped) {
        await userEvent.click(screen.getByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }));
        await screen.findByText("回答後に文書が更新されています");
        await userEvent.click(screen.getByRole("button", { name: "この文書について質問" }));
        await userEvent.type(
          screen.getByRole("textbox", { name: "続けて質問する" }),
          "この文書の設定は？",
        );
        await userEvent.click(screen.getByRole("button", { name: "質問する" }));
        await waitFor(() => expect(screen.getAllByText("回答が完了しました")).toHaveLength(2));
      }
      const oldAnswer = screen.getAllByTestId("docs-answer").at(-1);
      if (oldAnswer === undefined) throw new Error("Missing original answer");
      await userEvent.click(
        within(oldAnswer).getByRole("button", { name: `参照 1: ${GUIDE.title}` }),
      );
      await screen.findByText("回答後に文書が更新されています");
      await userEvent.click(screen.getByRole("button", { name: "この文書について質問" }));
      expect(screen.getByText(`この文書: ${GUIDE.target.path}`)).toBeTruthy();
      await userEvent.click(screen.getByTestId("locale-control"));
      expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en");
      const displayedAnswer = screen.getAllByTestId("docs-answer").at(-1);
      if (displayedAnswer === undefined)
        throw new Error("Missing original answer after navigation");
      await userEvent.click(
        within(displayedAnswer).getByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
      );
      await screen.findByText("回答後に文書が更新されています");
      await userEvent.click(screen.getByRole("button", { name: "最新の文書で回答を更新" }));
      await waitFor(() => expect(api.requests).toHaveLength(scoped ? 3 : 2));
      expect(api.requests.at(-1)).toMatchObject({
        question: scoped ? "この文書の設定は？" : "Cursor で始めるには？",
        locale: "ja",
      });
      expect(api.requests.at(-1)?.target).toEqual(scoped ? OFFICIAL_EN.target : undefined);
    },
  );

  it.each(["not-found", "disposed"] as const)(
    "releases the composer when polling returns %s and preserves the failed question",
    async (reason) => {
      const api = stubApi({ firstJobError: reason });
      showDocs();
      await ask();
      const answer = await screen.findByTestId("docs-answer");
      expect(await within(answer).findByText("回答を作成できませんでした")).toBeTruthy();
      expect(within(answer).getByRole("heading", { name: "Cursor で始めるには？" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "回答を停止" })).toBeNull();
      await userEvent.type(
        screen.getByRole("textbox", { name: "続けて質問する" }),
        "新しく質問します",
      );
      const send = screen.getByRole<HTMLButtonElement>("button", { name: "質問する" });
      expect(send.disabled).toBe(false);
      await userEvent.click(send);
      await waitFor(() => expect(api.requests).toHaveLength(2));
      expect(api.requests[1]?.question).toBe("新しく質問します");
      expect(api.requests[1]?.history).toEqual([]);
      expect(await screen.findByText("回答が完了しました")).toBeTruthy();
      expect(screen.getAllByTestId("docs-answer")).toHaveLength(2);
    },
  );

  it("keeps polling if cancellation requested during a delayed ask fails", async () => {
    const response: { finish?: () => void } = {};
    const firstAskDelay = new Promise<void>((resolve) => {
      response.finish = resolve;
    });
    const api = stubApi({
      firstAskDelay,
      cancelError: "unavailable",
      phases: ["answering", "completed"],
    });
    showDocs();
    await ask();
    expect(screen.getByText("質問を送信しています…")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "回答を停止" }));
    expect(api.postJson.mock.calls.some(([route]) => route === "/api/docs-qa/cancel")).toBe(false);
    const finish = response.finish;
    if (finish === undefined) throw new Error("Missing test response resolver");
    await act(async () => {
      finish();
    });
    await waitFor(() =>
      expect(api.postJson).toHaveBeenCalledWith("/api/docs-qa/cancel", { id: "question-1" }),
    );
    expect(api.getJson).toHaveBeenCalledWith("/api/docs-qa/job?id=question-1");
    expect(await screen.findByText("回答が完了しました")).toBeTruthy();
    expect(screen.getByTestId("docs-answer").textContent).toContain(
      "設定を確認してから開始します。",
    );
    await userEvent.type(screen.getByRole("textbox", { name: "続けて質問する" }), "次の質問");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "質問する" }).disabled).toBe(
      false,
    );
  });

  it("cancels a running answer and enables the composer again", async () => {
    const api = stubApi({ keepRunning: true });
    showDocs();
    await ask();
    await screen.findByText("文書をもとに回答を作成しています…");
    await userEvent.type(screen.getByRole("textbox", { name: "続けて質問する" }), "別の質問");
    await userEvent.click(screen.getByRole("button", { name: "回答を停止" }));
    expect(await screen.findByText("回答を停止しました")).toBeTruthy();
    expect(api.postJson).toHaveBeenCalledWith("/api/docs-qa/cancel", { id: "question-1" });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "質問する" }).disabled).toBe(
      false,
    );
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "続けて質問する" }).value).toBe(
      "別の質問",
    );
  });

  it("keeps an unavailable tool disabled and explains how to recover", async () => {
    const api = stubApi({
      tools: [
        {
          tool: "claude",
          label: "Claude Code",
          available: false,
          detail: "Claude Code にログインしてください。",
        },
        {
          tool: "cursor",
          label: "Cursor",
          available: false,
          detail: "Cursor CLI をインストールしてください。",
        },
      ],
    });
    showDocs();
    expect(await screen.findByText("Claude Code にログインしてください。")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "質問" }), "開始方法は？");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "質問する" }).disabled).toBe(true);
    await chooseOption("回答に使うツール", "Cursor");
    expect(screen.getByText("Cursor CLI をインストールしてください。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "接続を再確認" }));
    await waitFor(() =>
      expect(
        api.getJson.mock.calls.filter(([route]) => route.startsWith("/api/docs-qa/tools")),
      ).toHaveLength(2),
    );
    expect(api.requests).toEqual([]);
  });

  it("explains an unavailable GitHub Copilot CLI and prevents sending the question", async () => {
    const detail = "GitHub Copilot CLI をインストールしてログインしてください。";
    const api = stubApi({
      tools: TOOLS.map((tool) =>
        tool.tool === "copilot" ? { ...tool, available: false, detail } : tool,
      ),
    });
    showDocs();
    await screen.findByRole("combobox", { name: "回答に使うツール" });
    await chooseOption("回答に使うツール", "GitHub Copilot");
    expect(await screen.findByText(detail)).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "質問" }), "拡張機能の初期設定は？");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "質問する" }).disabled).toBe(true);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(api.requests).toEqual([]);
    expect(screen.queryByTestId("docs-answer")).toBeNull();
  });

  it("shows a tool authentication error and lets the reader edit the failed question", async () => {
    stubApi({
      phases: ["error"],
      answerError: "Claude Code にログインして、もう一度質問してください。",
    });
    showDocs();
    await ask();
    expect(await screen.findByText("回答を作成できませんでした")).toBeTruthy();
    expect(screen.getByText("Claude Code にログインして、もう一度質問してください。")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "参照したドキュメント" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "この質問を編集する" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "続けて質問する" }).value).toBe(
      "Cursor で始めるには？",
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "質問する" }).disabled).toBe(
      false,
    );
  });

  it("scopes a new question to the source document after reading a citation", async () => {
    const api = stubApi({ citations: [OFFICIAL_EN] });
    showDocs();
    await ask();
    await userEvent.click(
      await screen.findByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
    );
    await waitFor(() => expect(highlighted()).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "この文書について質問" }));
    expect(screen.getByText(`この文書: ${OFFICIAL_EN.target.path}`)).toBeTruthy();
    await userEvent.type(
      screen.getByRole("textbox", { name: "続けて質問する" }),
      "この設定の前提は？",
    );
    await userEvent.click(screen.getByRole("button", { name: "質問する" }));
    await waitFor(() => expect(api.requests).toHaveLength(2));
    expect(api.requests[1]?.target).toEqual(OFFICIAL_EN.target);
    // The answer language stays Japanese while the scope identifies English source text.
    expect(api.requests[1]?.locale).toBe("ja");
  });

  it("opens an empty conversation from the home and starts it from a suggested question", async () => {
    const api = stubApi();
    showDocs();
    await userEvent.click(screen.getByRole("button", { name: "AIに質問する" }));
    const chat = await screen.findByTestId("docs-chat");
    expect(within(chat).getByRole("heading", { name: "新しい会話" })).toBeTruthy();
    expect(
      within(chat).getByRole("heading", { name: "ドキュメントについて質問する" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("docs-home")).toBeNull();
    expect(await screen.findByText("利用できます")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Unit と Bolt はどう違いますか？" }));
    expect(await screen.findByText("回答が完了しました")).toBeTruthy();
    expect(api.requests).toEqual([
      { question: "Unit と Bolt はどう違いますか？", tool: "claude", locale: "ja", history: [] },
    ]);
    expect(
      within(chat).getByRole("heading", { level: 2, name: "Unit と Bolt はどう違いますか？" }),
    ).toBeTruthy();
  });

  it("keeps the conversation behind the home until the reader starts a new one", async () => {
    stubApi();
    showDocs();
    await ask();
    await screen.findByText("回答が完了しました");
    await userEvent.click(screen.getByRole("button", { name: "ドキュメントのトップへ" }));
    expect(await screen.findByTestId("docs-home")).toBeTruthy();
    const resume = screen.getByTestId("docs-home-resume");
    expect(resume.textContent).toContain("「Cursor で始めるには？」");
    await userEvent.click(resume);
    expect(screen.getByTestId("docs-answer").textContent).toContain(
      "設定を確認してから開始します。",
    );
    await userEvent.click(screen.getByRole("button", { name: "新しい会話" }));
    expect(screen.queryByTestId("docs-answer")).toBeNull();
    expect(screen.getByRole("heading", { name: "ドキュメントについて質問する" })).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "質問" }).value).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "ドキュメントのトップへ" }));
    expect(await screen.findByTestId("docs-home")).toBeTruthy();
    expect(screen.queryByTestId("docs-home-resume")).toBeNull();
  });

  it("takes an unmatched page search to the chat with the words already in the box", async () => {
    stubApi();
    showDocs();
    await userEvent.type(
      await screen.findByRole("searchbox", { name: "ページを探す" }),
      "承認の取り消し",
    );
    await userEvent.click(await screen.findByRole("button", { name: "この内容をAIに質問する" }));
    expect(await screen.findByTestId("docs-chat")).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "質問" }).value).toBe(
      "承認の取り消し",
    );
  });

  it("starts over only once no reply is in flight", async () => {
    stubApi({ keepRunning: true });
    const { result } = renderHook(() => useDocsQa(true, "ja"));
    act(() => result.current.setTarget(GUIDE.target));
    await act(async () => {
      await result.current.submit("質問");
    });
    expect(result.current.busy).toBe(true);
    act(() => result.current.reset());
    expect(result.current.turns).toHaveLength(1);
    await act(async () => {
      await result.current.cancel();
    });
    act(() => {
      result.current.setDraft("書きかけ");
    });
    act(() => result.current.reset());
    expect(result.current.turns).toEqual([]);
    expect(result.current.draft).toBe("");
    expect(result.current.target).toBeUndefined();
  });

  it("opens a bundled page linked from a source beside the chat, and keeps unknown links in the app", async () => {
    const tip: DocsQaCitation = {
      ...GUIDE,
      target: { kind: "guide", path: "aidlc-tip-hooks.md", locale: "ja" },
      title: "Claude Codeのhooksを修復する",
    };
    const api = stubApi({
      citations: [tip],
      evidence: async (citation) => ({
        ...evidenceFor(citation),
        markdown: `# ${tip.title}\n\n${tip.quote}\n\n[はじめかた](./getting-started.md) と [未収録](./missing.md)\n`,
      }),
    });
    showDocs();
    await ask();
    await userEvent.click(await screen.findByRole("button", { name: `参照 1: ${tip.title}` }));
    const missing = await within(sourcePanel()).findByRole("link", { name: "未収録" });
    // A relative URL the bundle lacks must not navigate the webview away from the app.
    expect(fireEvent.click(missing)).toBe(false);
    expect(screen.getByTestId("docs-chat")).toBeTruthy();
    await userEvent.click(within(sourcePanel()).getByRole("link", { name: "はじめかた" }));
    await waitFor(() =>
      expect(screen.getByTestId("docs-article-h1").textContent).toBe(GUIDE.title),
    );
    expect(api.getJson).toHaveBeenCalledWith(`/api/guides/${GUIDE.target.path}`);
    expect(screen.queryByTestId("docs-chat")).toBeNull();
  });

  it("opens a page linked from an English source in English, so its anchor still matches", async () => {
    const api = stubApi({
      citations: [OFFICIAL_EN],
      evidence: async (citation) => ({
        ...evidenceFor(citation),
        markdown: `# ${OFFICIAL_EN.title}\n\n## Getting started\n\n${OFFICIAL_EN.quote}\n\n[See getting started](#getting-started)\n`,
      }),
    });
    showDocs();
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    await ask();
    await userEvent.click(
      await screen.findByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
    );
    await userEvent.click(
      await within(sourcePanel()).findByRole("link", { name: "See getting started" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en"),
    );
    await waitFor(() =>
      expect(
        api.getJson.mock.calls.some(([route]) =>
          route.startsWith(`/api/official-docs/en/${OFFICIAL_EN.target.path}`),
        ),
      ).toBe(true),
    );
    expect(
      api.getJson.mock.calls.some(([route]) =>
        route.startsWith(`/api/official-docs/ja/${OFFICIAL_EN.target.path}`),
      ),
    ).toBe(false);
  });

  it("answers a question about a source opened full page in the reader's language", async () => {
    const api = stubApi({ citations: [OFFICIAL_EN] });
    showDocs();
    await ask();
    await userEvent.click(
      await screen.findByRole("button", { name: `参照 2: ${OFFICIAL_EN.title}` }),
    );
    await userEvent.click(
      await within(sourcePanel()).findByRole("button", { name: "ドキュメントで開く" }),
    );
    await waitFor(() => expect(highlighted()).toHaveLength(1));
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("en");
    await userEvent.click(screen.getByRole("button", { name: "この文書について質問" }));
    expect(screen.getByTestId("locale-control").getAttribute("data-locale")).toBe("ja");
    expect(screen.getByText(`この文書: ${OFFICIAL_EN.target.path}`)).toBeTruthy();
    await userEvent.type(
      screen.getByRole("textbox", { name: "続けて質問する" }),
      "この設定の前提は？",
    );
    await userEvent.click(screen.getByRole("button", { name: "質問する" }));
    await waitFor(() => expect(api.requests).toHaveLength(2));
    expect(api.requests[1]?.target).toEqual(OFFICIAL_EN.target);
    expect(api.requests[1]?.locale).toBe("ja");
  });

  it("keeps following the newest answer when it arrives taller than the follow margin", async () => {
    stubApi({ phases: ["answering", "completed"] });
    showDocs();
    const scroll = screen.getByTestId("app-scroll");
    let height = 1000;
    Object.defineProperty(scroll, "clientHeight", { configurable: true, get: () => 500 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, get: () => height });
    await ask();
    await screen.findByText("文書をもとに回答を作成しています…");
    // The reader is at the bottom; then the whole answer lands at once.
    scroll.scrollTop = 500;
    fireEvent.scroll(scroll);
    height = 1400;
    expect(await screen.findByText("回答が完了しました")).toBeTruthy();
    await waitFor(() => expect(scroll.scrollTop).toBe(1400));
  });

  it("stops following once the reader scrolls up to an earlier answer", async () => {
    stubApi({ phases: ["answering", "completed"] });
    showDocs();
    const scroll = screen.getByTestId("app-scroll");
    let height = 1000;
    Object.defineProperty(scroll, "clientHeight", { configurable: true, get: () => 500 });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, get: () => height });
    await ask();
    await screen.findByText("文書をもとに回答を作成しています…");
    scroll.scrollTop = 100;
    fireEvent.scroll(scroll);
    height = 1400;
    expect(await screen.findByText("回答が完了しました")).toBeTruthy();
    expect(scroll.scrollTop).toBe(100);
  });

  it("keeps questions available and does not mention shared mode", async () => {
    stubApi();
    showDocs();
    expect(
      screen.queryByText("共有モードでは利用できません。ローカルで開いてください。"),
    ).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "質問" }), "開始方法は？");
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "質問する" }).disabled).toBe(
        false,
      ),
    );
  });
});
