import type { IntentList } from "@andon/shared-types";
import { render, screen, waitFor, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app/App.tsx";
import { IntentPicker } from "@/shell/IntentPicker.tsx";
import { NowStrip } from "@/shell/now-strip/NowStrip.tsx";
import { fetchIntents } from "@/services/api.ts";
import { createBrowserTransport, setTransport } from "@/services/transport/index.ts";
import { StoreProvider } from "@/store/context.tsx";
import { matrix, payload, workflow } from "./fixtures.ts";

const INTENTS: IntentList = {
  space: "default",
  active: "260101-guide",
  all: ["260101-guide", "251201-spike"],
  selected: "260101-guide",
};

afterEach(() => {
  vi.unstubAllGlobals();
  setTransport(createBrowserTransport());
});

function stubApi(intentsBody: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.includes("/api/intents")) return new Response(JSON.stringify(intentsBody));
    if (input.includes("/api/matrix")) {
      return new Response(JSON.stringify({ ok: true, value: matrix() }));
    }
    if (input.includes("/api/links")) return new Response(JSON.stringify({ ok: true, value: [] }));
    return new Response(JSON.stringify(payload()));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "WebSocket",
    class {
      close(): void {}
    },
  );
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe("fetchIntents", () => {
  it("reads the list over GET and passes the ReadResult through", async () => {
    const fetchMock = stubApi({ ok: true, value: INTENTS });
    expect(await fetchIntents()).toEqual({ ok: true, value: INTENTS });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/intents");
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("method");
  });

  it("reports a dead server as unreachable rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await fetchIntents()).toEqual({ error: true, reason: "server-unreachable" });
  });
});

describe("IntentPicker", () => {
  it("opens a dialog that lists every intent and marks the selected one", async () => {
    render(
      <StoreProvider preloaded={{ intents: { kind: "success", value: INTENTS } }}>
        <IntentPicker />
      </StoreProvider>,
    );
    expect(screen.queryByTestId("intent-dialog")).toBeNull();
    await userEvent.click(screen.getByTestId("intent-picker-trigger"));
    const dialog = screen.getByRole("dialog", { name: "インテント一覧" });
    const items = within(dialog).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "✔ 260101-guide（表示中）",
      "○ 251201-spike",
    ]);
    expect(items[0]?.getAttribute("data-selected")).toBe("true");
  });

  it("posts the chosen intent", async () => {
    const posted: unknown[] = [];
    setTransport({
      getJson: async (path) => {
        if (path.includes("/api/matrix")) {
          return { reached: true, body: { ok: true, value: matrix() } };
        }
        if (path.includes("/api/intents")) {
          return { reached: true, body: { ok: true, value: INTENTS } };
        }
        return { reached: true, body: { ok: true, value: payload() } };
      },
      postJson: async (path, body) => {
        posted.push({ path, body });
        return { ok: true, status: 200, body: { ok: true, value: INTENTS } };
      },
      subscribe: () => () => {},
    });
    render(
      <StoreProvider preloaded={{ intents: { kind: "success", value: INTENTS } }}>
        <IntentPicker />
      </StoreProvider>,
    );
    await userEvent.click(screen.getByTestId("intent-picker-trigger"));
    await userEvent.click(screen.getByRole("button", { name: /251201-spike/ }));
    expect(posted).toEqual([{ path: "/api/select-intent", body: { intent: "251201-spike", expectedSpace: "default" } }]);
  });

  it("shows 未選択 while the list is loading", () => {
    render(
      <StoreProvider preloaded={{ workflow: { kind: "success", value: workflow() } }}>
        <IntentPicker />
      </StoreProvider>,
    );
    expect(screen.getByTestId("intent-picker").textContent).toContain("未選択");
  });

  it("refreshes a stale space's list and requires the user to choose again", async () => {
    const currentIntents = { ...INTENTS, space: "team-b", selected: null };
    const postJson = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, body: { error: true, reason: "space-conflict" } })
      .mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true } });
    setTransport({
      getJson: async (path) => {
        if (path === "/api/intents") return { reached: true, body: { ok: true, value: currentIntents } };
        if (path === "/api/matrix") return { reached: true, body: { ok: true, value: matrix() } };
        return { reached: true, body: { ok: true, value: payload() } };
      },
      postJson,
      subscribe: () => () => {},
    });
    render(
      <StoreProvider preloaded={{ intents: { kind: "success", value: INTENTS } }}>
        <IntentPicker />
      </StoreProvider>,
    );
    await userEvent.click(screen.getByTestId("intent-picker-trigger"));
    await userEvent.click(screen.getByRole("button", { name: /251201-spike/ }));
    await waitFor(() => expect(screen.getByTestId("intent-picker-trigger").textContent).toBe("未選択"));
    expect(screen.getByText("Space が変更されました。表示中の一覧から選び直してください。")).toBeDefined();
    expect(postJson).toHaveBeenCalledExactlyOnceWith("/api/select-intent", { intent: "251201-spike", expectedSpace: "default" });
    expect(screen.getByRole("dialog", { name: "インテント一覧" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: /251201-spike/ }));
    expect(postJson).toHaveBeenNthCalledWith(2, "/api/select-intent", { intent: "251201-spike", expectedSpace: "team-b" });
    await waitFor(() => expect(screen.queryByTestId("intent-dialog")).toBeNull());
  });

  it("opens the dialog unprompted when nothing is selected but intents exist", () => {
    render(
      <StoreProvider
        preloaded={{
          intents: {
            kind: "success",
            value: { space: "default", active: null, all: ["a", "b"], selected: null },
          },
        }}
      >
        <IntentPicker />
      </StoreProvider>,
    );
    expect(screen.getByRole("dialog", { name: "インテント一覧" })).toBeDefined();
    expect(within(screen.getByTestId("intent-list")).getByText("a")).toBeDefined();
  });
});

describe("empty state (US-15 AC)", () => {
  it("opens one picker in the app and closes it after selecting an intent", async () => {
    let selected: string | null = null;
    const postJson = vi.fn(async () => {
      selected = "251201-spike";
      return { ok: true, status: 200, body: { ok: true } };
    });
    setTransport({
      getJson: async (path) => {
        if (path === "/api/intents") {
          return { reached: true, body: { ok: true, value: { ...INTENTS, selected } } };
        }
        if (path === "/api/workflow") {
          return { reached: true, body: selected === null ? { error: true, reason: "no-selected-intent" } : { ok: true, value: payload({ workflow: workflow({ record: { space: "default", intent: selected } }) }) } };
        }
        if (path === "/api/matrix") {
          return { reached: true, body: selected === null ? { error: true, reason: "no-selected-intent" } : { ok: true, value: matrix({ record: { space: "default", intent: selected } }) } };
        }
        return { reached: true, body: { error: true, reason: "not-found" } };
      },
      postJson,
      subscribe: () => () => {},
    });
    render(
      <App bootstrap={Promise.resolve({ error: true as const, reason: "no-selected-intent" })} />,
    );

    const dialog = await screen.findByRole("dialog", { name: "インテント一覧" });
    expect(screen.getAllByTestId("intent-dialog")).toHaveLength(1);
    expect(screen.getAllByTestId("intent-picker-trigger")).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "251201-spike" }));

    expect(postJson).toHaveBeenCalledExactlyOnceWith("/api/select-intent", {
      intent: "251201-spike",
      expectedSpace: "default",
    });
    await waitFor(() => {
      expect(screen.queryByTestId("intent-dialog")).toBeNull();
      expect(screen.getByTestId("intent-picker-trigger").textContent).toBe("251201-spike");
    });
    expect(screen.getByTestId("intent-picker-trigger").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("stage-rail-item-code-generation")).toBeDefined();
  });

  it("asks the user to pick when records exist but none is selected", () => {
    render(
      <StoreProvider
        preloaded={{
          intents: {
            kind: "success",
            value: { space: "default", active: null, all: ["251201-spike"], selected: null },
          },
        }}
      >
        <NowStrip
          state={{
            kind: "empty",
            hint: "インテントを選んでください",
            reason: "no-selected-intent",
          }}
          onRetry={() => {}}
          intentPicker={<IntentPicker />}
        />
      </StoreProvider>,
    );

    const alert = screen.getByRole("alert", { hidden: true });
    expect(within(alert).getAllByText("インテントを選んでください").length).toBeGreaterThan(0);
    expect(alert.textContent).not.toContain("ワークフローはまだありません");
    expect(alert.textContent).not.toContain("/aidlc intent");
    expect(screen.getByRole("dialog", { name: "インテント一覧" })).toBeDefined();
    expect(within(screen.getByTestId("intent-list")).getByText("251201-spike")).toBeDefined();
  });
});

describe("degradation (BR-UI-4)", () => {
  it("renders the rest of the app when the intents payload is unusable", async () => {
    stubApi({ error: true, reason: "state-unreadable" });
    render(<App bootstrap={Promise.resolve({ ok: true as const, value: payload() })} />);

    await userEvent.click(await screen.findByTestId("now-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("done-total").textContent).toBe("3 / 6");
    });
    expect(screen.getByTestId("stage-rail-item-code-generation")).toBeDefined();
    expect(screen.getByTestId("intent-picker").textContent).toContain("未選択");
  });
});
