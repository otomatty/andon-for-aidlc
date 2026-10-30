import type { CustomizationCatalog, CustomizationItem } from "@andon/shared-types";
import { act, fireEvent, render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomizationPage from "@/features/customization/CustomizationPage";
import { ImportDialog } from "@/features/customization/components/PackageDialogs";
import { createItem, setSourceField } from "@/features/customization/utils/source-fields";
import { CustomizationError, customizationApi } from "@/services/customization";
import { chooseOption } from "@tests/choose-option.ts";

it("rejects imports above the shared JSON limit before reading them", async () => {
  const analyze = vi.spyOn(customizationApi, "importAnalyze");
  render(<CustomizationPage open />);
  await openRule();
  const file = new File([], "too-large.json");
  const read = vi.fn();
  Object.defineProperties(file, {
    size: { value: 70 * 1024 * 1024 + 1 },
    text: { value: read },
  });
  fireEvent.change(screen.getByLabelText("Andon設定ファイル"), { target: { files: [file] } });
  expect(await screen.findByText("設定ファイルは70 MB以下にしてください。")).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
  expect(analyze).not.toHaveBeenCalled();
});

it("warns before leaving with unsaved edits and stops warning after automatic save", async () => {
  const page = render(<CustomizationPage open />);
  const input = await openRule();
  const leave = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(leave()).toBe(false);
  fireEvent.change(input, { target: { value: "unsaved input" } });
  expect(leave()).toBe(true);
  expect(customizationApi.save).not.toHaveBeenCalled();
  await waitFor(() => expect(leave()).toBe(false));
  page.unmount();
  expect(leave()).toBe(false);
});

it("blocks Space switching until save completes and retains drafts after an external switch", async () => {
  const blocked = vi.fn();
  const page = render(
    <CustomizationPage open activeSpace="default" onSwitchBlockedChange={blocked} />,
  );
  const input = await openRule();
  fireEvent.change(input, { target: { value: "draft for default" } });
  expect(blocked).toHaveBeenLastCalledWith(true);
  page.rerender(<CustomizationPage open activeSpace="other" onSwitchBlockedChange={blocked} />);
  expect((input as HTMLTextAreaElement).value).toBe("draft for default");
  expect(screen.getByText(/この画面では default の設定を編集中/)).toBeTruthy();
  await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
});

it("passes a Guide export above 25 MB to server validation", async () => {
  const analyze = vi
    .spyOn(customizationApi, "importAnalyze")
    .mockRejectedValue(new Error("server reached"));
  render(<CustomizationPage open />);
  await openRule();
  const content = { schemaVersion: 1, items: [], padding: "a".repeat(27 * 1024 * 1024) };
  const text = JSON.stringify(content);
  const file = new File([text], "export.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Andon設定ファイル"), { target: { files: [file] } });
  await waitFor(() => expect(analyze).toHaveBeenCalled());
  expect(analyze.mock.calls[0]?.[0].package).toEqual(content);
});

it("explains malformed Guide JSON in Japanese before saving or analyzing the import", async () => {
  const analyze = vi.spyOn(customizationApi, "importAnalyze");
  render(<CustomizationPage open />);
  await openRule();
  const file = new File(["invalid"], "invalid.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => "invalid" });
  fireEvent.change(screen.getByLabelText("Andon設定ファイル"), { target: { files: [file] } });
  expect(
    await screen.findByText(
      "設定ファイルのJSONを読み取れません。Andonから書き出した有効なJSONファイルを選択してください。",
    ),
  ).toBeTruthy();
  expect(analyze).not.toHaveBeenCalled();
  expect(customizationApi.save).not.toHaveBeenCalled();
});

const rule: CustomizationItem = {
  id: "rule",
  kind: "rule-section",
  title: "Development rules",
  owner: "project",
  content: "Current guidance",
  target: { layer: "team", heading: "Rules" },
};

it("offers only compatible knowledge types as import replacement targets", async () => {
  const team: CustomizationItem = {
    ...createItem("knowledge", "default"),
    id: "team",
    title: "Team notes",
  };
  const document: CustomizationItem = {
    ...team,
    id: "document",
    title: "Document",
    target: { knowledgeType: "document-source", filename: "document.pdf" },
  };
  render(
    <ImportDialog
      plan={{
        id: "import",
        configurationRevision: "config",
        inputHash: "input",
        diagnostics: [],
        entries: [
          {
            sourceId: "incoming",
            item: team,
            matchId: null,
            action: "choose-target",
            candidates: [team.id],
          },
        ],
      }}
      items={[team, document]}
      stale={false}
      busy={false}
      onClose={() => {}}
      onAdopt={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("combobox", { name: "取り込み先" }));
  expect(await screen.findByRole("option", { name: /Team notes.*置き換える/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Document.*置き換える/ })).toBeNull();
});
const items: CustomizationItem[] = [
  rule,
  ...(["knowledge", "stage", "scope", "agent", "sensor", "tool", "plugin"] as const).map(
    (kind) => ({ ...createItem(kind, "default", "example"), id: kind }),
  ),
];
const catalog: CustomizationCatalog = {
  workspaceName: "fixture",
  spaceId: "default",
  spaces: ["default", "other"],
  engineVersion: "2.8.2",
  configurationRevision: "config",
  capabilities: {
    available: true,
    engineVersion: "2.8.2",
    protocolVersion: 1,
    canApply: true,
    canExportPlugin: true,
    canRecover: true,
  },
  items,
  diagnostics: [],
};
let savedCatalog: CustomizationCatalog;
beforeEach(() => {
  savedCatalog = structuredClone(catalog);
  vi.spyOn(customizationApi, "catalog").mockImplementation(async () =>
    structuredClone(savedCatalog),
  );
  vi.spyOn(customizationApi, "save").mockImplementation(async (body) => {
    const changed = new Map(savedCatalog.items.map((item) => [item.id, item]));
    for (const entry of body.changes)
      if (entry.operation === "remove") changed.delete(entry.itemId);
      else changed.set(entry.item.id, entry.item);
    savedCatalog = {
      ...savedCatalog,
      configurationRevision: "saved",
      items: [...changed.values()],
    };
    return { id: "operation", requestId: body.requestId, kind: "apply", status: "completed" };
  });
  vi.spyOn(customizationApi, "pendingOperation").mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("customization page", () => {
  it("navigates from concept cards through lists to editable details", async () => {
    render(<CustomizationPage open />);
    expect(await openRule()).toBeTruthy();
    for (const [category, title, label] of [
      ["ナレッジ", "新しい資料", "ファイル名"],
      ["ステージ", "新しいステージ", "主担当エージェント"],
      ["エージェント", "新しいエージェント", "専門性・説明"],
      ["品質チェック", "新しい品質チェック", "チェックコマンド"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: "カスタマイズ" }));
      fireEvent.click(screen.getByRole("link", { name: category }));
      fireEvent.click(screen.getByRole("link", { name: title }));
      expect(await screen.findByLabelText(label)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "カスタマイズ" }));
    await userEvent.click(screen.getByRole("button", { name: "その他の操作" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "プラグインを管理" }));
    fireEvent.click(screen.getByRole("link", { name: "新しいプラグイン" }));
    fireEvent.change(screen.getByLabelText("プラグイン名"), {
      target: { value: "changed-plugin" },
    });
    await waitFor(() => expect(customizationApi.save).toHaveBeenCalled());
    expect(savedCatalog.items.find((item) => item.id === "plugin")?.content).toContain(
      '"name": "changed-plugin"',
    );
    expect(screen.queryByRole("button", { name: "変更を確認" })).toBeNull();
    expect(screen.queryByText(/下書き/)).toBeNull();
  });
  it("updates a referenced stage from the scope assignment form", async () => {
    const scope = items.find((item) => item.id === "scope");
    if (!scope) throw new Error("fixture missing");
    savedCatalog.items = savedCatalog.items.map((item) =>
      item.id === "stage" ? { ...item, content: setSourceField(item.content, "scopes", []) } : item,
    );
    render(<CustomizationPage open />);
    fireEvent.click(await screen.findByRole("link", { name: "スコープ" }));
    fireEvent.click(screen.getByRole("link", { name: "新しいスコープ" }));
    fireEvent.click(screen.getByRole("tab", { name: "実行するステージ" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /を実行/ }));
    await waitFor(() => expect(customizationApi.save).toHaveBeenCalled());
    expect(savedCatalog.items.find((item) => item.id === "stage")?.content).toContain(
      scope.runtimeId,
    );
  });
});

it("imports only explicitly selected items with the chosen replacement target", () => {
  const onAdopt = vi.fn();
  render(
    <ImportDialog
      plan={{
        id: "import",
        configurationRevision: "config",
        inputHash: "input",
        diagnostics: [],
        entries: [
          {
            sourceId: "first",
            item: rule,
            matchId: rule.id,
            action: "replace",
            candidates: [rule.id],
          },
          {
            sourceId: "second",
            item: { ...rule, title: "Unselected" },
            matchId: null,
            action: "add",
            candidates: [],
          },
        ],
      }}
      items={items}
      stale={false}
      busy={false}
      onClose={() => {}}
      onAdopt={onAdopt}
    />,
  );
  const adopt = screen.getByRole("button", { name: "選んだ項目を取り込む" });
  expect((adopt as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Development rules · チーム · ルールの章" }),
  );
  fireEvent.click(adopt);
  expect(onAdopt).toHaveBeenCalledWith([{ sourceId: "first", targetId: "rule" }]);
});

it("opens the AI chat for the space being edited", async () => {
  const onAskAi = vi.fn();
  render(<CustomizationPage open onAskAi={onAskAi} />);
  await userEvent.click(await screen.findByRole("button", { name: "AIと相談" }));
  expect(onAskAi).toHaveBeenCalledWith(catalog.spaceId);
});

async function openRule() {
  fireEvent.click(await screen.findByRole("link", { name: "開発ルール" }));
  fireEvent.click(await screen.findByRole("link", { name: "Development rules" }));
  return screen.findByLabelText("本文・作業方針");
}

it("retains the input after a rejected save and shows the validation reason", async () => {
  vi.mocked(customizationApi.save).mockRejectedValue(
    new CustomizationError("validation-failed", "前提ステージを確認してください。"),
  );
  render(<CustomizationPage open />);
  const input = await openRule();
  fireEvent.change(input, { target: { value: "Local text" } });
  expect(await screen.findByText("前提ステージを確認してください。")).toBeTruthy();
  expect((input as HTMLTextAreaElement).value).toBe("Local text");
  expect(screen.queryByText("設定を保存しました。")).toBeNull();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(customizationApi.save).toHaveBeenCalledTimes(1);
});
it("retries an uncertain save with the same request instead of applying a new operation", async () => {
  vi.mocked(customizationApi.save).mockRejectedValueOnce(
    new CustomizationError("response-unknown", "接続が切れました。"),
  );
  render(<CustomizationPage open />);
  fireEvent.change(await openRule(), { target: { value: "Keep this" } });
  fireEvent.click(await screen.findByRole("button", { name: "同じ操作の受付を再確認" }));
  await screen.findByText("自動保存");
  expect(vi.mocked(customizationApi.save).mock.calls[0]?.[0]).toEqual(
    vi.mocked(customizationApi.save).mock.calls[1]?.[0],
  );
});

it("keeps typing enabled during a save and serializes the next save against the new revision", async () => {
  let finish: () => void = () => {};
  const save = vi.mocked(customizationApi.save);
  const persist = save.getMockImplementation();
  if (!persist) throw new Error("fixture missing");
  save.mockImplementationOnce(async (body) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return persist(body);
  });
  render(<CustomizationPage open />);
  const input = (await openRule()) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "first" } });
  fireEvent.change(input, { target: { value: "second" } });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(input.disabled).toBe(false);
  fireEvent.change(input, { target: { value: "third" } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(input.value).toBe("third");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]?.[0]).toMatchObject({
    expectedConfigurationRevision: "saved",
    changes: [{ operation: "replace", item: { content: "## Rules\nthird" } }],
  });
  await screen.findByText("自動保存");
  expect(input.value).toBe("third");
});

it("switches plugin context in the header and leaves standard settings visible", async () => {
  savedCatalog.items.push(
    { ...createItem("plugin", "default", "another"), id: "another-plugin", runtimeId: "another" },
    { ...createItem("agent", "default", "another"), id: "another-agent", title: "Another agent" },
    {
      ...createItem("agent", "default"),
      id: "standard-agent",
      title: "Standard agent",
      owner: "core",
      pluginId: undefined,
    },
  );
  render(<CustomizationPage open />);
  await screen.findByRole("combobox", { name: "対象スペース" });
  expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  expect(screen.queryByText("ワークフローの仕組みとカスタマイズ")).toBeNull();
  expect(screen.queryByRole("button", { name: /スコープを作る/ })).toBeNull();
  await chooseOption("プラグイン", "another");
  fireEvent.click(screen.getByRole("link", { name: "エージェント" }));
  expect(screen.getByRole("link", { name: "Another agent" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Standard agent" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "新しいエージェント" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "＋ 追加" }));
  expect((screen.getByLabelText("所有プラグイン") as HTMLInputElement).value).toBe("another");
});

it("waits for Japanese text composition to finish before saving", async () => {
  render(<CustomizationPage open />);
  const input = await openRule();
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "編集中" } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(customizationApi.save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await waitFor(() => expect(customizationApi.save).toHaveBeenCalledTimes(1));
});

it("switches spaces from the header after pending edits have saved", async () => {
  vi.mocked(customizationApi.catalog).mockImplementation(async (space) => ({
    ...structuredClone(savedCatalog),
    spaceId: space ?? "default",
  }));
  render(<CustomizationPage open />);
  fireEvent.change(await openRule(), { target: { value: "updated" } });
  expect(
    (screen.getByRole("combobox", { name: "対象スペース" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await screen.findByText("自動保存");
  await waitFor(() =>
    expect(
      (screen.getByRole("combobox", { name: "対象スペース" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await chooseOption("対象スペース", "other");
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "対象スペース" }).textContent).toContain("other"),
  );
  expect(customizationApi.catalog).toHaveBeenCalledWith("other");
  expect(screen.getByRole("link", { name: "開発ルール" })).toBeTruthy();
});
