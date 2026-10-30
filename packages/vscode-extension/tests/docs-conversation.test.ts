import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import {
  DOCS_CONVERSATION_KEY,
  loadDocsConversation,
  parseDocsConversation,
  saveDocsConversation,
  type DocsConversationState,
} from "../src/docs-conversation.ts";

function mockGlobalState() {
  const store = new Map<string, unknown>();
  const update = vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  });
  const workspaceStateUpdate = vi.fn(async () => undefined);
  const context = {
    globalState: {
      get: <T>(key: string) => store.get(key) as T | undefined,
      update,
      keys: () => [...store.keys()],
      setKeysForSync: () => undefined,
    },
    workspaceState: {
      get: vi.fn(),
      update: workspaceStateUpdate,
      keys: () => [],
      setKeysForSync: () => undefined,
    },
  } as unknown as ExtensionContext;
  return { context, update, workspaceStateUpdate, store };
}

describe("docs conversation globalState persistence", () => {
  it("saves turns to globalState and restores them", async () => {
    const { context } = mockGlobalState();
    const state: DocsConversationState = {
      turns: [{ id: "t1", question: "q", answer: "a", citations: [] }],
      draft: "",
    };
    await saveDocsConversation(context, state);
    expect(loadDocsConversation(context)).toEqual(state);
  });

  it("saves draft to globalState and restores it", async () => {
    const { context } = mockGlobalState();
    await saveDocsConversation(context, { turns: [], draft: "draft-text" });
    expect(loadDocsConversation(context).draft).toBe("draft-text");
  });

  it("restores turns and draft after a simulated close", async () => {
    const shared = new Map<string, unknown>();
    const make = () =>
      ({
        globalState: {
          get: <T>(key: string) => shared.get(key) as T | undefined,
          update: async (key: string, value: unknown) => {
            shared.set(key, value);
          },
          keys: () => [...shared.keys()],
          setKeysForSync: () => undefined,
        },
      }) as unknown as ExtensionContext;
    const state: DocsConversationState = {
      turns: [{ id: "t1", question: "q", answer: "a", citations: [] }],
      draft: "x",
    };
    await saveDocsConversation(make(), state);
    expect(loadDocsConversation(make())).toEqual(state);
  });

  it("does not write workspaceState or create workspace files", async () => {
    const { context, workspaceStateUpdate, update } = mockGlobalState();
    await saveDocsConversation(context, { turns: [], draft: "" });
    expect(workspaceStateUpdate).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(DOCS_CONVERSATION_KEY, expect.any(Object));
  });

  it("keeps more than 8 turns in the restored list", async () => {
    const { context } = mockGlobalState();
    const turns = Array.from({ length: 12 }, (_, index) => ({
      id: `t${index + 1}`,
      question: `q${index + 1}`,
      answer: `a${index + 1}`,
      citations: [] as DocsConversationState["turns"][number]["citations"],
    }));
    await saveDocsConversation(context, { turns, draft: "" });
    expect(loadDocsConversation(context).turns).toHaveLength(12);
  });

  it("keeps each turn's locale and target so a refresh asks the original question", async () => {
    const { context } = mockGlobalState();
    const state: DocsConversationState = {
      turns: [
        {
          id: "t1",
          question: "q",
          answer: "a",
          citations: [],
          locale: "en",
          target: { kind: "guide", path: "concepts.md", locale: "en" },
        },
      ],
      draft: "",
    };
    await saveDocsConversation(context, state);
    expect(loadDocsConversation(context)).toEqual(state);
  });

  it("keeps a customize turn's mode but never its proposal", async () => {
    const { context } = mockGlobalState();
    await saveDocsConversation(context, {
      turns: [
        {
          id: "t1",
          question: "q",
          answer: "a",
          citations: [],
          mode: "customize",
          proposal: { changes: [] },
        } as DocsConversationState["turns"][number],
      ],
      draft: "",
    });
    expect(loadDocsConversation(context).turns).toEqual([
      { id: "t1", question: "q", answer: "a", citations: [], mode: "customize" },
    ]);
    expect(parseDocsConversation({ turns: [{ ...loadDocsConversation(context).turns[0], mode: "x" }] }).turns).toEqual([]);
  });

  it("drops turns whose locale or target is malformed", () => {
    expect(
      parseDocsConversation({
        turns: [
          { id: "t1", question: "q", answer: "a", citations: [], locale: "fr" },
          { id: "t2", question: "q", answer: "a", citations: [], target: { kind: "x" } },
          { id: "t3", question: "q", answer: "a", citations: [] },
        ],
        draft: "d",
      }),
    ).toEqual({ turns: [{ id: "t3", question: "q", answer: "a", citations: [] }], draft: "d" });
  });

  it("returns an empty conversation when nothing is stored", () => {
    const { context } = mockGlobalState();
    expect(loadDocsConversation(context)).toEqual({ turns: [], draft: "" });
  });
});
