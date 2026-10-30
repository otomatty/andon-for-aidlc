import { render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "@/features/agent/AgentPage.tsx";
import { DetailPanel } from "@/features/stage/StagePage.tsx";
import { StoreProvider, useDispatch } from "@/store/context.tsx";
import { reducer } from "@/store/reducer.ts";
import { initialState } from "@/store/state.ts";
import { stageDoc } from "@tests/fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubAgentApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes("/api/agents/aidlc-quality-agent/knowledge/testing-guide.md")) {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            name: "testing-guide.md",
            title: "Testing Guide",
            markdown: "# Testing Guide\n\nKnowledge body.\n",
          },
        }),
      );
    }
    if (path.includes("/api/agents/aidlc-quality-agent")) {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            id: "aidlc-quality-agent",
            displayName: "品質エージェント",
            description: "テスト戦略を担う QA リード。",
            markdown: "# 品質エージェント\n\n解説本文。\n",
            stages: ["build-and-test", "performance-validation"],
            knowledge: [{ name: "testing-guide.md", title: "Testing Guide" }],
          },
        }),
      );
    }
    return new Response(JSON.stringify({ error: true, reason: "unexpected" }), { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function AgentHarness(): ReactNode {
  const dispatch = useDispatch();
  return (
    <>
      <button
        type="button"
        data-testid="open-stage"
        onClick={() => {
          dispatch({ type: "select", selection: { kind: "stage", slug: "build-and-test" } });
        }}
      >
        stage
      </button>
      <DetailPanel />
      <AgentPanel />
    </>
  );
}

describe("AgentPanel — stage detail entry", () => {
  it("opens from StageCard, shows knowledge, and returns to the stage detail", async () => {
    stubAgentApi();
    render(
      <StoreProvider
        preloaded={{
          stageDoc: {
            "build-and-test": {
              kind: "success",
              value: stageDoc({
                agent: "aidlc-quality-agent",
                agentDisplayName: "品質エージェント",
                slug: "build-and-test",
              }),
            },
          },
        }}
      >
        <AgentHarness />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-stage"));
    expect(screen.getByTestId("detail-panel")).toBeTruthy();

    await userEvent.click(screen.getByTestId("agent-link-aidlc-quality-agent"));
    expect(screen.getByTestId("agent-panel")).toBeTruthy();
    expect(screen.queryByTestId("detail-panel")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "品質エージェント" })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId("agent-body").textContent).toContain("解説本文");
    });

    await userEvent.click(screen.getByTestId("agent-knowledge-testing-guide.md"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-body").textContent).toContain("Knowledge body");
    });

    await userEvent.click(screen.getByTestId("agent-knowledge-back"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-body").textContent).toContain("解説本文");
    });

    await userEvent.click(screen.getByTestId("agent-back"));
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    expect(screen.getByTestId("detail-panel")).toBeTruthy();
  });
});

describe("agent route exclusivity", () => {
  it("parks stage selection when an agent opens and restores it on back", () => {
    const withStage = reducer(initialState, {
      type: "select",
      selection: { kind: "stage", slug: "code-generation" },
    });
    const withAgent = reducer(withStage, { type: "open-agent", id: "aidlc-quality-agent" });
    expect(withAgent.route).toEqual({
      name: "agent",
      id: "aidlc-quality-agent",
      returnTo: { kind: "stage", slug: "code-generation" },
    });

    const restored = reducer(withAgent, { type: "close-agent" });
    expect(restored.route).toEqual({ name: "stage", slug: "code-generation" });
  });

  it("clears agentOpen when effectiveness or another stage opens", () => {
    const withAgent = reducer(
      reducer(initialState, {
        type: "select",
        selection: { kind: "stage", slug: "build-and-test" },
      }),
      { type: "open-agent", id: "aidlc-quality-agent" },
    );

    const effectiveness = reducer(withAgent, { type: "effectiveness", open: true });
    expect(effectiveness.route).toEqual({ name: "effectiveness" });

    const withAgentAgain = reducer(
      reducer(initialState, {
        type: "select",
        selection: { kind: "stage", slug: "build-and-test" },
      }),
      { type: "open-agent", id: "aidlc-quality-agent" },
    );
    const stage = reducer(withAgentAgain, {
      type: "select",
      selection: { kind: "stage", slug: "code-generation" },
    });
    expect(stage.route).toEqual({ name: "stage", slug: "code-generation" });
  });
});
