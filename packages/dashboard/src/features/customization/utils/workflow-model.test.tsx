import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomizationItem } from "@andon/shared-types";
import { fireEvent, render, screen, within } from "@tests/render.tsx";
import { describe, expect, it, vi } from "vitest";
import graph from "../../../../../../.claude/tools/data/stage-graph.json";
import { CustomizationExplorer } from "@/features/customization/components/explorer/CustomizationExplorer";
import { ItemEditor } from "@/features/customization/components/editor/ItemEditor";
import { StageDescription } from "@/features/customization/components/editor/StageDescription";
import { japaneseScopeDescription } from "@/features/customization/utils/scope-description";
import {
  createItem,
  listField,
  setSourceField,
  sourceField,
} from "@/features/customization/utils/source-fields";
import { japaneseStageSection } from "@/features/customization/utils/stage-description";
import {
  contributionScopes,
  createOwnedPlugin,
  duplicateScope,
  removeScope,
  runsStage,
  setMembership,
  stageDiagnostics,
  stageItems,
} from "@/features/customization/utils/workflow-model";

const stage = (slug: string, phase: string, scopes = ["bugfix"]): CustomizationItem => ({
  id: slug,
  kind: "stage",
  runtimeId: slug,
  title: slug,
  owner: "core",
  content: `---\nslug: ${slug}\nphase: ${phase}\nscopes: ${JSON.stringify(scopes)}\nrequires_stage: []\nlead_agent: developer\n---\nOriginal work\n`,
});
const base: CustomizationItem = {
  ...createItem("scope", "default"),
  id: "bugfix",
  runtimeId: "bugfix",
  title: "bugfix",
  owner: "core",
  content: "---\nname: bugfix\ndepth: Minimal\nkeywords: [fix]\n---\nScope instructions\n",
};
const items = [
  base,
  stage("workspace-scaffold", "initialization"),
  stage("workspace-detection", "initialization"),
  stage("state-init", "initialization"),
  stage("code-generation", "construction"),
  stage("build-and-test", "construction"),
  stage("requirements-analysis", "inception", ["feature"]),
];
const copy = () => duplicateScope(items, base, "my-hotfix", "my-team", "default");

describe("custom scopes", () => {
  it("copies the selected standard stages as adds.scopes and leaves original bytes intact", () => {
    const result = copy();
    expect(result.items.filter((item) => item.target?.contributionTo)).toHaveLength(2);
    expect(result.scope.content).toContain('baseScope: "bugfix"');
    for (const original of items)
      expect(result.items.find((item) => item.id === original.id)).toBe(original);
    expect(stageItems(result.items)).toHaveLength(6);
    expect(result.scope.runtimeId).toBe("my-team-my-hotfix");
    expect(sourceField(result.scope.content, "name")).toBe(result.scope.runtimeId);
    expect(sourceField(result.scope.content, "plugin")).toBe("my-team");
    expect(runsStage(required(items[1]), "my-team-my-hotfix", result.items)).toBe(true);
    expect(runsStage(required(items[4]), "my-team-my-hotfix", result.items)).toBe(true);
    expect(runsStage(required(items[6]), "my-team-my-hotfix", result.items)).toBe(false);
    for (const contribution of result.items.filter((item) => item.target?.contributionTo)) {
      expect(sourceField(contribution.content, "plugin")).toBe("my-team");
      expect(contribution.content).toContain("adds:\n  scopes:\n    - my-team-my-hotfix\n");
    }
  });
  it("coalesces contributions for multiple scopes and removes only the chosen membership", () => {
    const first = copy();
    const second = duplicateScope(first.items, first.scope, "my-docs", "my-team", "default");
    expect(second.items.filter((item) => item.target?.contributionTo)).toHaveLength(2);
    const unchecked = setMembership(second.items, first.scope, required(items[4]), false);
    const addition = required(
      unchecked.find((item) => item.target?.contributionTo === "code-generation"),
    );
    expect(contributionScopes(addition)).toEqual(["my-team-my-docs"]);
    expect(sourceField(addition.content, "plugin")).toBe("my-team");
    expect(addition.content).toContain("adds:\n  scopes:\n    - my-team-my-docs\n");
    const removed = removeScope(unchecked, second.scope);
    expect(removed.some((item) => item.target?.contributionTo === "code-generation")).toBe(false);
    expect(removed.find((item) => item.id === required(items[4]).id)).toBe(items[4]);
  });
  it("edits custom stage scopes, preserves fixed initialization, and rejects invalid identities", () => {
    const result = copy();
    const own = {
      ...stage("my-team-review", "construction", []),
      owner: "plugin" as const,
      pluginId: "my-team",
    };
    const checked = setMembership([...result.items, own], result.scope, own, true);
    expect(
      listField(required(checked.find((item) => item.id === own.id)).content, "scopes"),
    ).toEqual(["my-team-my-hotfix"]);
    expect(setMembership(items, base, required(items[4]), false)).toBe(items);
    expect(setMembership(result.items, result.scope, required(items[1]), false)).toBe(result.items);
    expect(() => duplicateScope(result.items, base, "my-hotfix", "my-team", "default")).toThrow();
    expect(() =>
      duplicateScope(result.items, base, "my-team-my-hotfix", "my-team", "default"),
    ).toThrow();
    expect(duplicateScope(items, base, "my-team-fix", "my-team", "default").scope.runtimeId).toBe(
      "my-team-fix",
    );
    expect(() => duplicateScope(items, base, "my-team-", "my-team", "default")).toThrow();
    expect(() => duplicateScope(items, base, "../escape", "my-team", "default")).toThrow();
    expect(() => createOwnedPlugin("core", "default")).toThrow();
    expect(
      JSON.parse(createOwnedPlugin("my-team", "default").content).aidlc.contributes.overlays,
    ).toBe("contributions/");
  });
  it("handles missing adds and preserves other additions and fragments when removing membership", () => {
    const result = copy();
    const coreStage = required(items[4]);
    const contribution = required(
      result.items.find((item) => item.target?.contributionTo === coreStage.runtimeId),
    );
    for (const field of ["", "adds: null\n"]) {
      const incomplete = {
        ...contribution,
        content: `---\ntarget: code-generation\n${field}---\n`,
      };
      const source = [coreStage, result.scope, incomplete];
      expect(setMembership(source, result.scope, coreStage, false)).toEqual([
        coreStage,
        result.scope,
      ]);
      const enabled = required(
        setMembership(source, result.scope, coreStage, true).find(
          (item) => item.id === contribution.id,
        ),
      );
      expect(sourceField(enabled.content, "plugin")).toBe("my-team");
      expect(enabled.content).toContain("adds:\n  scopes:\n    - my-team-my-hotfix\n");
    }
    const extra = {
      ...contribution,
      content:
        "---\ntarget: code-generation\nadds:\n  scopes:\n    - my-team-my-hotfix\n  sensors:\n    - my-team-check\nfragments:\n  before: before.md\n---\nKeep prose\n",
    };
    const updated = required(
      setMembership([coreStage, result.scope, extra], result.scope, coreStage, false).find(
        (item) => item.id === extra.id,
      ),
    );
    expect(sourceField(updated.content, "adds")).toEqual({
      scopes: [],
      sensors: ["my-team-check"],
    });
    expect(updated.content).toContain("fragments:\n  before: before.md\n");
    expect(updated.content).toContain("---\nKeep prose\n");
  });
  it("passes the bundled engine's validator with generated scope and contribution files", () => {
    const scratch = mkdtempSync(join(tmpdir(), "guide-custom-scope-"));
    const root = join(scratch, "my-team");
    try {
      for (const directory of [".aidlc-plugin", "hooks", "scopes", "contributions"])
        mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(
        join(root, ".aidlc-plugin", "plugin.json"),
        createOwnedPlugin("my-team", "default").content,
      );
      writeFileSync(
        join(root, "hooks", "compose.ts"),
        readFileSync(".claude/tools/data/plugin-hooks-template/compose.ts"),
      );
      const result = copy();
      writeFileSync(join(root, "scopes", `${result.scope.runtimeId}.md`), result.scope.content);
      // Since 2.11.1 the validator reads contributions only at contributions/<phase>/<slug>.md.
      for (const item of result.items.filter((item) => item.target?.contributionTo)) {
        const phase = required(item.target?.phase);
        mkdirSync(join(root, "contributions", phase), { recursive: true });
        writeFileSync(join(root, "contributions", phase, `${item.runtimeId}.md`), item.content);
      }
      const command = spawnSync("bun", [".claude/tools/aidlc-plugin-validate.ts", root, "--json"], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(command.status, command.stdout || command.stderr).toBe(0);
      const validation = JSON.parse(command.stdout);
      expect(validation.errors).toEqual([]);
      expect(validation.valid).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  it("allows skipped prerequisites but reports missing references and cycles", () => {
    const source = stage("child", "construction", ["custom"]);
    const child = {
      ...source,
      content: setSourceField(source.content, "requires_stage", ["code-generation"]),
    };
    expect(stageDiagnostics([...items, child])).toEqual([]);
    expect(
      stageDiagnostics([
        { ...child, content: setSourceField(child.content, "requires_stage", ["missing"]) },
      ])[0]?.code,
    ).toBe("missing-stage");
    expect(
      stageDiagnostics([
        { ...child, content: setSourceField(child.content, "requires_stage", ["child"]) },
      ])[0]?.code,
    ).toBe("stage-cycle");
  });
});

it("matches the bundled reference section for all 33 standard stages", () => {
  expect(graph).toHaveLength(33);
  for (const stage of graph) {
    const doc = readFileSync(`docs/reference/ja/04-stages/${stage.phase}.md`, "utf8");
    const section = japaneseStageSection(doc, stage.number);
    expect(section, stage.slug).toMatch(
      new RegExp(`^## (?:ステージ|Stage) ${stage.number.replaceAll(".", "\\.")}(?:[:： \\t]|$)`),
    );
    expect(section?.match(/^## /gm)).toHaveLength(1);
  }
  expect(japaneseStageSection("## Stage 1.10: Other", "1.1")).toBeNull();
});

it.each(["scope", "stage", "agent", "sensor"] as const)(
  "keeps standard %s forms and raw source read only",
  (kind) => {
    const item = { ...createItem(kind, "default"), owner: "core" as const };
    render(<ItemEditor item={item} items={[item]} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect((screen.getByLabelText("表示名") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("原文", { exact: true }));
    expect((screen.getByLabelText("設定の原文") as HTMLTextAreaElement).disabled).toBe(true);
  },
);

it("offers the 2.11 scope settings for plan approval, collaborators and existing code", () => {
  const item = {
    ...createItem("scope", "default"),
    content: "---\nname: quick\nplan_approval: off\ncollaborators: off\nexisting_code: true\n---\n",
  };
  render(<ItemEditor item={item} items={[item]} onChange={vi.fn()} onRemove={vi.fn()} />);
  for (const label of ["計画承認", "協働エージェント", "既存コードの変更"])
    expect(screen.getByText(label, { exact: true })).toBeTruthy();
});

it("gives every concept and list card exactly one interactive heading link", () => {
  const props = {
    items,
    space: "default",
    category: null,
    changed: [],
    disabled: false,
    diagnostics: [],
    onCategory: vi.fn(),
    onSelect: vi.fn(),
    onItems: vi.fn(),
    onRemove: vi.fn(),
    onDocument: vi.fn(),
  };
  const page = render(<CustomizationExplorer {...props} />);
  expect(screen.getAllByRole("article")).toHaveLength(6);
  for (const card of screen.getAllByRole("article")) {
    expect(within(card).getAllByRole("link")).toHaveLength(1);
    expect(card.querySelectorAll("a,button,input,select,textarea,[role=button]")).toHaveLength(1);
  }
  page.rerender(<CustomizationExplorer {...props} category="scopes" />);
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(
    screen.getByRole("article").querySelectorAll("a,button,input,select,textarea"),
  ).toHaveLength(1);
});

it.each(["stages", "rules"] as const)(
  "keeps missing and unknown %s groups visible and selectable",
  (category) => {
    const onSelect = vi.fn();
    const entries: CustomizationItem[] =
      category === "stages"
        ? [stage("unknown-stage", "typo"), stage("missing-phase", "")]
        : [
            {
              ...createItem("rule-section", "default"),
              id: "missing-layer",
              title: "Missing layer",
              target: undefined,
            },
            {
              ...createItem("rule-section", "default"),
              id: "unknown-layer",
              title: "Unknown layer",
              target: { layer: "typo" as "project" },
            },
          ];
    render(
      <CustomizationExplorer
        items={entries}
        space="default"
        category={category}
        changed={[]}
        disabled={false}
        diagnostics={[]}
        onCategory={vi.fn()}
        onSelect={onSelect}
        onItems={vi.fn()}
        onRemove={vi.fn()}
        onDocument={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "その他" })).toBeTruthy();
    for (const entry of entries) {
      fireEvent.click(screen.getByRole("link", { name: entry.title }));
      expect(onSelect).toHaveBeenLastCalledWith(entry.id);
    }
  },
);

it("links each stage language tab to its corresponding panel", async () => {
  const onChange = vi.fn();
  render(<StageDescription item={required(items[4])} disabled onChange={onChange} />);
  const english = screen.getByRole("tab", { name: "英語" });
  const englishPanel = screen.getByRole("tabpanel", { name: "英語" });
  expect(english.getAttribute("aria-controls")).toBe(englishPanel.id);
  expect(englishPanel.getAttribute("aria-labelledby")).toBe(english.id);
  expect(await within(englishPanel).findByRole("textbox")).toBeTruthy();
  const japanese = screen.getByRole("tab", { name: "日本語" });
  fireEvent.click(japanese);
  const japanesePanel = screen.getByRole("tabpanel", { name: "日本語" });
  expect(japanese.getAttribute("aria-controls")).toBe(japanesePanel.id);
  expect(japanesePanel.getAttribute("aria-labelledby")).toBe(japanese.id);
  expect(screen.queryByRole("tabpanel", { name: "英語" })).toBeNull();
  fireEvent.click(english);
  expect(
    await within(screen.getByRole("tabpanel", { name: "英語" })).findByRole("textbox"),
  ).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("fixes all initialization checkboxes and does not open a drawer when checking execution", () => {
  const result = copy();
  const onItems = vi.fn();
  render(
    <CustomizationExplorer
      items={result.items}
      space="default"
      category="scopes"
      selected={result.scope}
      changed={[]}
      disabled={false}
      diagnostics={[]}
      onCategory={vi.fn()}
      onSelect={vi.fn()}
      onItems={onItems}
      onRemove={vi.fn()}
      onDocument={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "実行するステージ" }));
  for (const slug of ["workspace-scaffold", "workspace-detection", "state-init"])
    expect(
      (screen.getByRole("checkbox", { name: `${slug} を実行` }) as HTMLInputElement).disabled,
    ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "code-generation を実行" }));
  expect(onItems).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "code-generation" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("has a current Japanese description for every bundled scope without translating custom or changed sources", () => {
  const files = readdirSync(".claude/scopes").filter((file) => /^aidlc-.*\.md$/.test(file));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const item = {
      ...base,
      runtimeId: file.slice(6, -3),
      content: readFileSync(`.claude/scopes/${file}`, "utf8"),
    };
    expect(japaneseScopeDescription(item), file).toMatch(/対象ステージ/);
    expect(japaneseScopeDescription({ ...item, owner: "plugin" })).toBeNull();
    expect(
      japaneseScopeDescription({ ...item, content: `${item.content}\nUpdated policy` }),
    ).toBeNull();
  }
});

it("opens scope settings in Japanese and switches to the original without changing settings", async () => {
  const scope = { ...base, content: readFileSync(".claude/scopes/aidlc-bugfix.md", "utf8") };
  const onItems = vi.fn();
  render(
    <CustomizationExplorer
      items={[scope, ...items.filter((item) => item.kind === "stage")]}
      selected={scope}
      space="default"
      category="scopes"
      changed={[]}
      disabled={false}
      diagnostics={[]}
      onCategory={vi.fn()}
      onSelect={vi.fn()}
      onItems={onItems}
      onRemove={vi.fn()}
      onDocument={vi.fn()}
    />,
  );
  expect(screen.getByRole("tab", { name: "スコープ設定" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(screen.getByRole("tab", { name: "日本語" }).getAttribute("aria-selected")).toBe("true");
  expect(await screen.findByText(/既存コードの特定のバグを/)).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "本文・作業方針" }).getAttribute("contenteditable"),
  ).toBe("false");
  expect(screen.getByLabelText("ランナー").closest("details")).toBeNull();
  expect(screen.getByLabelText("自由記述の既定スコープ").closest("details")).toBeNull();
  expect(screen.queryByText("詳細設定", { exact: true })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "英語" }));
  expect(screen.getByRole("textbox", { name: "本文・作業方針" }).textContent).toContain(
    "Minimal depth for fixing one specific bug",
  );
  expect(
    screen.getByRole("textbox", { name: "本文・作業方針" }).getAttribute("contenteditable"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("tab", { name: "実行するステージ" }));
  expect(screen.getByRole("button", { name: "code-generation" })).toBeTruthy();
  expect(onItems).not.toHaveBeenCalled();
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}

import { spawnSync } from "node:child_process";
