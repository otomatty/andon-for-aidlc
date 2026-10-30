import type {
  CustomizationProposal,
  DocsQaJob,
  DocsQaRequest,
  DocsQaToolStatus,
} from "@andon/shared-types";
import { cleanup, render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocsShell } from "@/features/docs/DocsPage.tsx";
import {
  createBrowserTransport,
  type GetJsonResult,
  type PostJsonResult,
  setTransport,
} from "@/services/transport/index.ts";
import { StoreProvider, useDispatch } from "@/store/context.tsx";

const RULE = {
  id: "rule-section:review",
  kind: "rule-section" as const,
  title: "Code Review",
  owner: "project" as const,
  spaceId: "default",
  content: "## Code Review\n\nTwo approvals.\n",
  target: { layer: "project" as const, heading: "Code Review" },
};

const PROPOSAL: CustomizationProposal = {
  spaceId: "default",
  configurationRevision: "rev-1",
  changes: [
    {
      operation: "replace",
      item: { ...RULE, content: "## Code Review\n\nTwo approvals and a green CI.\n" },
    },
  ],
  entries: [
    {
      operation: "replace",
      itemId: RULE.id,
      kind: "rule-section",
      title: "Code Review",
      location: "aidlc/spaces/default/memory/project.md",
      before: RULE.content,
      after: "## Code Review\n\nTwo approvals and a green CI.\n",
    },
  ],
  diagnostics: [],
  canApply: true,
};

const ALL_TOOLS: DocsQaToolStatus[] = [
  { tool: "claude", label: "Claude Code", available: true },
  { tool: "cursor", label: "Cursor", available: true },
  { tool: "copilot", label: "GitHub Copilot", available: true },
];

function stubApi(
  options: {
    tools?: DocsQaToolStatus[];
    proposal?: CustomizationProposal;
  } = {},
) {
  const requests: DocsQaRequest[] = [];
  const saves: unknown[] = [];
  const getJson = vi.fn(async (route: string): Promise<GetJsonResult> => {
    let value: unknown;
    if (route.startsWith("/api/docs-qa/tools")) value = options.tools ?? ALL_TOOLS;
    else if (route.startsWith("/api/docs-qa/job?id=")) {
      const request = requests.at(-1);
      if (!request) throw new Error("No test job");
      value = {
        id: "question-1",
        question: request.question,
        tool: request.tool,
        locale: request.locale,
        ...(request.mode ? { mode: request.mode } : {}),
        phase: "completed",
        answer: "レビュー方針に CI を加えます。",
        citations: [],
        ...(request.mode === "customize" ? { proposal: options.proposal ?? PROPOSAL } : {}),
        createdAt: 1,
      } satisfies DocsQaJob;
    } else if (route === "/api/official-docs/manifest")
      value = { sourceVersion: "aidlc-workflows 2.8.0", source: "aidlc-workflows" };
    else if (route.startsWith("/api/official-docs/toc/"))
      value = { overview: [], guide: [], reference: [] };
    else if (route === "/api/guides") value = [];
    else throw new Error(`Unexpected GET ${route}`);
    return { reached: true, body: { ok: true, value } };
  });
  const postJson = vi.fn(async (route: string, body: unknown): Promise<PostJsonResult> => {
    let value: unknown;
    if (route === "/api/docs-qa/ask") {
      const request = body as DocsQaRequest;
      requests.push(request);
      value = {
        id: "question-1",
        question: request.question,
        tool: request.tool,
        locale: request.locale,
        ...(request.mode ? { mode: request.mode } : {}),
        phase: "searching",
        answer: "",
        citations: [],
        createdAt: 1,
      } satisfies DocsQaJob;
    } else if (route === "/api/customization/save") {
      saves.push(body);
      value = {
        id: "operation-1",
        requestId: (body as { requestId: string }).requestId,
        status: "completed",
        kind: "apply",
        message: "設定を保存しました。",
      };
    } else throw new Error(`Unexpected POST ${route}`);
    return { ok: true, status: 200, body: { ok: true, value } };
  });
  setTransport({ getJson, postJson, subscribe: () => () => {} });
  return { requests, saves };
}

/** Leaves the docs screen and comes back through its ordinary entry. */
function Navigate() {
  const dispatch = useDispatch();
  return (
    <>
      <button type="button" onClick={() => dispatch({ type: "home" })}>
        ホームへ
      </button>
      <button type="button" onClick={() => dispatch({ type: "docs-shell", open: true })}>
        ドキュメントへ
      </button>
    </>
  );
}

function showChat(mode?: "customize"): void {
  render(
    <StoreProvider
      preloaded={{
        route: {
          name: "docs",
          deepLink: { locale: "ja", chat: mode ? { mode, space: "team" } : {} },
        },
      }}
    >
      <Navigate />
      <div data-testid="app-scroll">
        <DocsShell />
      </div>
    </StoreProvider>,
  );
}

async function send(text: string): Promise<void> {
  await userEvent.type(await screen.findByRole("textbox", { name: "依頼" }), text);
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "依頼する" });
  await waitFor(() => expect(button.disabled).toBe(false));
  await userEvent.click(button);
}

afterEach(() => {
  cleanup();
  setTransport(createBrowserTransport());
});

describe("tools offered by the extension", () => {
  it("names the only selected tool instead of offering a choice", async () => {
    stubApi({ tools: [ALL_TOOLS[1]!] });
    showChat();
    expect((await screen.findByTestId("docs-question-tool-label")).textContent).toBe("Cursor");
    expect(screen.queryByRole("combobox", { name: "回答に使うツール" })).toBeNull();
  });

  it("asks with a selected tool when the default one is not offered", async () => {
    const api = stubApi({ tools: [ALL_TOOLS[2]!, ALL_TOOLS[1]!] });
    showChat();
    await screen.findByRole("combobox", { name: "回答に使うツール" });
    await userEvent.type(screen.getByRole("textbox", { name: "質問" }), "始め方は？");
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "質問する" });
    await waitFor(() => expect(button.disabled).toBe(false));
    await userEvent.click(button);
    await waitFor(() => expect(api.requests[0]?.tool).toBe("copilot"));
  });

  it("explains that no selected tool can chat and keeps the question unsent", async () => {
    const api = stubApi({ tools: [] });
    showChat();
    expect(await screen.findByText(/AI チャットで使えるもの/)).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "質問" }), "始め方は？");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "質問する" }).disabled).toBe(true);
    expect(api.requests).toEqual([]);
  });
});

describe("customizing by conversation", () => {
  it("opens in customize mode, sends the space, and applies a reviewed proposal", async () => {
    const api = stubApi();
    showChat("customize");
    expect(
      await screen.findByRole("heading", { name: "対話しながらカスタマイズする" }),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "カスタマイズ" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByTestId("docs-question-space").textContent).toContain("team");
    await userEvent.type(screen.getByRole("textbox", { name: "依頼" }), "レビューに CI を必須に");
    const send = screen.getByRole<HTMLButtonElement>("button", { name: "依頼する" });
    await waitFor(() => expect(send.disabled).toBe(false));
    await userEvent.click(send);
    await waitFor(() =>
      expect(api.requests[0]).toMatchObject({
        question: "レビューに CI を必須に",
        mode: "customize",
        spaceId: "team",
      }),
    );
    expect(api.requests[0]).not.toHaveProperty("target");

    const card = await screen.findByTestId("docs-proposal");
    expect(within(card).getByText("変更案（1件）")).toBeTruthy();
    expect(screen.getByText("レビュー方針に CI を加えます。")).toBeTruthy();
    await userEvent.click(within(card).getByTestId("docs-proposal-entry"));
    const diff = await within(card).findByTestId("docs-proposal-diff");
    expect(diff.textContent).toContain("Two approvals and a green CI.");
    expect(api.saves).toEqual([]);

    await userEvent.click(within(card).getByRole("button", { name: "この変更を適用" }));
    expect(await within(card).findByText("設定を保存しました。")).toBeTruthy();
    expect(api.saves).toEqual([
      {
        requestId: expect.any(String),
        spaceId: "default",
        expectedConfigurationRevision: "rev-1",
        changes: PROPOSAL.changes,
      },
    ]);
    expect(within(card).queryByRole("button", { name: "この変更を適用" })).toBeNull();
  });

  it("returns to the active space when the chosen one is cleared", async () => {
    const api = stubApi();
    showChat("customize");
    await userEvent.click(
      await screen.findByRole("button", { name: "現在のスペースを対象にする" }),
    );
    expect(screen.getByTestId("docs-question-space").textContent).toBe("現在のスペースの設定");
    await send("変えて");
    await waitFor(() => expect(api.requests[0]?.mode).toBe("customize"));
    expect(api.requests[0]).not.toHaveProperty("spaceId");
  });

  it("forgets the customization page's space after leaving the docs screen", async () => {
    const api = stubApi();
    showChat("customize");
    expect((await screen.findByTestId("docs-question-space")).textContent).toContain("team");
    await userEvent.click(screen.getByRole("button", { name: "ホームへ" }));
    await userEvent.click(screen.getByRole("button", { name: "ドキュメントへ" }));
    await userEvent.click(await screen.findByRole("button", { name: "AIに質問する" }));
    expect(screen.getByRole("radio", { name: "カスタマイズ" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect((await screen.findByTestId("docs-question-space")).textContent).toBe(
      "現在のスペースの設定",
    );
    await send("変えて");
    await waitFor(() => expect(api.requests[0]?.mode).toBe("customize"));
    expect(api.requests[0]).not.toHaveProperty("spaceId");
  });

  it("shows why a proposal cannot be applied and offers no apply button", async () => {
    stubApi({
      proposal: {
        ...PROPOSAL,
        canApply: false,
        reason: "設定の保存にはカスタマイズに対応するエンジンが必要です。",
        diagnostics: [{ severity: "error", code: "ai-proposal", message: "標準の設定です。" }],
      },
    });
    showChat("customize");
    await userEvent.type(await screen.findByRole("textbox", { name: "依頼" }), "変えて");
    const send = screen.getByRole<HTMLButtonElement>("button", { name: "依頼する" });
    await waitFor(() => expect(send.disabled).toBe(false));
    await userEvent.click(send);
    const card = await screen.findByTestId("docs-proposal");
    expect(within(card).getByText("標準の設定です。")).toBeTruthy();
    expect(within(card).getByTestId("docs-proposal-reason").textContent).toContain(
      "カスタマイズに対応するエンジン",
    );
    expect(within(card).queryByRole("button", { name: "この変更を適用" })).toBeNull();
  });
});
