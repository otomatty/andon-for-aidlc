import { render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NowStrip } from "@/shell/now-strip/NowStrip.tsx";
import { PreflightWizard } from "@/shell/now-strip/PreflightWizard.tsx";
import { setTransport, type Transport } from "@/services/transport/types.ts";

const PAYLOAD = {
  scan: {
    projectType: "Brownfield",
    languages: "TypeScript",
    frameworks: "Unknown",
    buildSystem: "bun (package.json)",
  },
  scopes: [
    {
      name: "bugfix",
      description: "Fix a specific bug",
      depth: "Minimal",
      skeleton: "off",
      executeCount: 7,
      totalCount: 33,
      gateCount: 4,
    },
  ],
  inference: null as unknown,
  plan: null as unknown,
  cli: { bun: true, claude: true },
  errors: [] as string[],
};

// A `?text=` response, per the real server contract (finding 2): inference-
// only — scan/scopes/cli come back empty/null, never re-sent. The client is
// expected to keep showing the mount response's static info regardless.
const WITH_PLAN = {
  scan: null as unknown,
  scopes: [] as unknown[],
  cli: null as unknown,
  errors: [] as string[],
  inference: { scope: "bugfix", source: "keyword", matches: [{ scope: "bugfix", keyword: "fix" }] },
  plan: {
    scope: "bugfix",
    depth: "Minimal",
    skeleton: "off",
    executeCount: 7,
    totalCount: 33,
    gateCount: 4,
    phases: [
      {
        phase: "construction",
        stages: [
          {
            slug: "code-generation",
            number: "3.5",
            name: "Code Generation",
            phase: "construction",
            decision: "EXECUTE",
            leadAgent: "aidlc-developer-agent",
            gate: true,
            produces: ["src/"],
          },
        ],
      },
    ],
  },
};

const postMessage = vi.fn();
let getJson: ReturnType<typeof vi.fn<Transport["getJson"]>>;

beforeEach(() => {
  getJson = vi.fn<Transport["getJson"]>(async (path: string) =>
    path.includes("text=") ? { reached: true, body: WITH_PLAN } : { reached: true, body: PAYLOAD },
  );
  setTransport({
    getJson,
    postJson: async () => ({ ok: true, status: 200, body: null }),
    subscribe: () => () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  postMessage.mockClear();
});

describe("PreflightWizard", () => {
  beforeEach(() => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
  });

  it("loads static preflight on mount and disables start on empty text", async () => {
    render(<PreflightWizard hint="hint" />);
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/preflight"));
    expect((screen.getByTestId("preflight-start") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Brownfield/)).toBeDefined();
  });

  it("debounces typing, shows inferred scope, gates count and disclaimer", async () => {
    const user = userEvent.setup();
    render(<PreflightWizard hint="hint" />);
    await user.type(screen.getByTestId("preflight-text"), "fix the login bug");
    await waitFor(() =>
      expect(getJson).toHaveBeenCalledWith(
        `/api/preflight?text=${encodeURIComponent("fix the login bug")}`,
      ),
    );
    await screen.findByTestId("preflight-readout");
    expect(screen.getByTestId("preflight-scope").textContent).toContain("bugfix");
    expect(screen.getByTestId("preflight-scope").textContent).toContain("fix");
    expect(screen.getByTestId("preflight-gates").textContent).toContain("4");
    // プレビュー ≠ 約束 の注記(spec §4)。
    expect(screen.getByText(/これは見通しです/)).toBeDefined();
    // EXECUTE/SKIP はテキストラベル(色のみ禁止)。
    await user.click(screen.getByRole("button", { name: "フェーズ別ステージ一覧" }));
    expect(screen.getByText("EXECUTE")).toBeDefined();
  });

  it("start posts start-workflow with the raw text", async () => {
    const user = userEvent.setup();
    render(<PreflightWizard hint="hint" />);
    await user.type(screen.getByTestId("preflight-text"), "fix the login bug");
    await waitFor(() =>
      expect((screen.getByTestId("preflight-start") as HTMLButtonElement).disabled).toBe(false),
    );
    await user.click(screen.getByTestId("preflight-start"));
    expect(postMessage).toHaveBeenCalledWith({
      type: "start-workflow",
      text: "fix the login bug",
    });
  });

  it("degrades to static info with a setup hint when subprocess data is missing", async () => {
    getJson.mockImplementation(async () => ({
      reached: true,
      body: { ...PAYLOAD, scan: null, errors: ["detect-failed"] },
    }));
    render(<PreflightWizard hint="hint" />);
    await screen.findByTestId("preflight-degraded");
    // 静的カタログは出る。
    expect(screen.getByText(/bugfix/)).toBeDefined();
  });

  it("treats an unreachable mount preflight as degraded, keeping start usable", async () => {
    getJson.mockImplementation(async (path: string) =>
      path.includes("text=") ? { reached: true, body: WITH_PLAN } : { reached: false },
    );
    const user = userEvent.setup();
    render(<PreflightWizard hint="hint" />);
    // 不達は detect 失敗と同じ縮退表示(Setup 案内)に落ちる。
    await screen.findByTestId("preflight-degraded");
    // 開始ボタンは仕様どおり生きたまま(compose 実行は Claude Code 側の責務)。
    await user.type(screen.getByTestId("preflight-text"), "fix");
    expect((screen.getByTestId("preflight-start") as HTMLButtonElement).disabled).toBe(false);
  });

  it("StrictMode duplicate mount fetches: stale failure resolving last cannot re-degrade", async () => {
    const pending: Array<(result: { reached: true; body: unknown } | { reached: false }) => void> =
      [];
    getJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    render(
      <StrictMode>
        <PreflightWizard hint="hint" />
      </StrictMode>,
    );
    // StrictMode の setup→cleanup→setup でマウント fetch は 2 回飛ぶ。
    await waitFor(() => expect(pending.length).toBe(2));
    pending[1]?.({ reached: true, body: PAYLOAD }); // 最新(2通目)が成功
    await screen.findByText(/Brownfield/);
    pending[0]?.({ reached: false }); // 古い方が後から不達で戻る
    await waitFor(() => expect(screen.queryByTestId("preflight-degraded")).toBeNull());
    expect(screen.getByText(/Brownfield/)).toBeDefined();
  });

  it("StrictMode duplicate mount fetches: stale failure resolving first is ignored", async () => {
    const pending: Array<(result: { reached: true; body: unknown } | { reached: false }) => void> =
      [];
    getJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    render(
      <StrictMode>
        <PreflightWizard hint="hint" />
      </StrictMode>,
    );
    await waitFor(() => expect(pending.length).toBe(2));
    pending[0]?.({ reached: false }); // 古い方(1通目)が先に不達 — 適用されない
    pending[1]?.({ reached: true, body: PAYLOAD }); // 最新が成功
    await screen.findByText(/Brownfield/);
    expect(screen.queryByTestId("preflight-degraded")).toBeNull();
  });

  it("clears the pending debounce timer on unmount, so no fetch follows unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PreflightWizard hint="hint" />);
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/preflight"));
    await user.type(screen.getByTestId("preflight-text"), "fix");
    // Unmount before the 400ms debounce fires — nothing scheduled should survive.
    unmount();
    const callsAtUnmount = getJson.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(getJson.mock.calls.length).toBe(callsAtUnmount);
  });

  it("clears the readout when the text is cleared, keeping only static info (finding 3)", async () => {
    const user = userEvent.setup();
    render(<PreflightWizard hint="hint" />);
    const textarea = screen.getByTestId("preflight-text");
    await user.type(textarea, "fix the login bug");
    await screen.findByTestId("preflight-readout");

    await user.clear(textarea);
    await waitFor(() => expect(screen.queryByTestId("preflight-readout")).toBeNull());
    // Static info (from the mount response) survives; only inference/plan clear.
    expect(screen.getByText(/Brownfield/)).toBeDefined();
  });

  it("clears the previous readout as soon as the text changes, before the next fetch resolves", async () => {
    const user = userEvent.setup();
    const pending: Array<(result: { reached: true; body: unknown }) => void> = [];
    getJson.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path.includes("text=")) {
            pending.push(resolve as (result: { reached: true; body: unknown }) => void);
          } else {
            resolve({ reached: true, body: PAYLOAD });
          }
        }),
    );
    render(<PreflightWizard hint="hint" />);
    const textarea = screen.getByTestId("preflight-text");
    await user.type(textarea, "fix the login bug");
    await waitFor(() => expect(pending.length).toBe(1));
    pending[0]?.({ reached: true, body: WITH_PLAN });
    await screen.findByTestId("preflight-readout");

    // さらに入力した瞬間に前の見通しは消える — 2 通目の fetch は未解決の
    // ままなので、消えるとしたら onChange の即時クリアだけが理由。
    await user.type(textarea, " quickly");
    await waitFor(() => expect(screen.queryByTestId("preflight-readout")).toBeNull());
    expect(screen.getByText(/Brownfield/)).toBeDefined();
  });

  it("ignores a stale response that resolves after a newer request", async () => {
    const user = userEvent.setup();
    const pending: Array<(result: { reached: true; body: unknown }) => void> = [];
    getJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );

    render(<PreflightWizard hint="hint" />);
    await waitFor(() => expect(pending.length).toBe(1));
    pending[0]?.({ reached: true, body: PAYLOAD }); // mount fetch resolves immediately.

    await user.type(screen.getByTestId("preflight-text"), "old");
    await waitFor(() => expect(pending.length).toBe(2)); // debounce fired for "old"

    await user.type(screen.getByTestId("preflight-text"), " new");
    await waitFor(() => expect(pending.length).toBe(3)); // debounce fired for "old new"

    const OLD_BODY = { ...WITH_PLAN, plan: { ...WITH_PLAN.plan, gateCount: 1 } };
    const NEW_BODY = { ...WITH_PLAN, plan: { ...WITH_PLAN.plan, gateCount: 9 } };

    // Resolve the newer request (index 2) first, the stale older one (index 1) after —
    // the out-of-order arrival the sequence guard exists for.
    pending[2]?.({ reached: true, body: NEW_BODY });
    await waitFor(() => expect(screen.getByTestId("preflight-gates").textContent).toContain("9"));

    pending[1]?.({ reached: true, body: OLD_BODY });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the stale resolution settle.
    expect(screen.getByTestId("preflight-gates").textContent).toContain("9");
  });

  it("still applies the mount response after a later text fetch resolves first (regression)", async () => {
    const user = userEvent.setup();
    const pending: Array<(result: { reached: true; body: unknown }) => void> = [];
    getJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );

    render(<PreflightWizard hint="hint" />);
    await waitFor(() => expect(pending.length).toBe(1)); // mount fetch dispatched, still in flight

    // The mount round-trip (buildCatalog + 2 probes + detect) is realistically
    // slower than the 400ms debounce, so a text fetch can be dispatched — and
    // resolve — before the mount fetch does.
    await user.type(screen.getByTestId("preflight-text"), "fix the login bug");
    await waitFor(() => expect(pending.length).toBe(2)); // debounce fired for the text fetch

    pending[1]?.({ reached: true, body: WITH_PLAN }); // text fetch resolves first
    await screen.findByTestId("preflight-readout");

    pending[0]?.({ reached: true, body: PAYLOAD }); // mount fetch resolves after
    // Must still land — a shared staleness counter must not discard the
    // once-only mount response just because a text fetch outran it.
    await waitFor(() => expect(screen.getByText(/Brownfield/)).toBeDefined());
  });
});

describe("NowStrip empty branch", () => {
  it("renders the wizard in a VS Code webview", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    render(
      <NowStrip
        state={{ kind: "empty", hint: "h", reason: "no-active-intent" }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("preflight-text")).toBeDefined();
  });

  it("renders the wizard in a webview when reason is explicitly no-active-intent", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    render(
      <NowStrip
        state={{ kind: "empty", hint: "h", reason: "no-active-intent" }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("preflight-text")).toBeDefined();
  });

  it("keeps the plain EmptyState outside the webview", () => {
    // No acquireVsCodeApi stub = browser.
    render(<NowStrip state={{ kind: "empty", hint: "h" }} onRetry={() => {}} />);
    expect(screen.queryByTestId("preflight-text")).toBeNull();
    expect(screen.getByText("ワークフローはまだありません")).toBeDefined();
  });

  it("does not render the wizard for state-missing, even in a webview — an intent already exists", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }));
    render(
      <NowStrip
        state={{ kind: "empty", hint: "state-missing hint", reason: "state-missing" }}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByTestId("preflight-text")).toBeNull();
    expect(screen.getByText("ワークフローはまだありません")).toBeDefined();
    expect(screen.getByText("state-missing hint")).toBeDefined();
    // The "create your first intent" copy would be misleading here — suppressed.
    expect(screen.queryByText(/最初のインテントを作成してください/)).toBeNull();
  });
});
