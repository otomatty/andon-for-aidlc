import { fileURLToPath } from "node:url";
import type { CustomizationItem } from "@andon/shared-types";
import { expect, it } from "vitest";
import { readCompatibilityCatalog } from "../src/customization/catalog";
import { applyChanges } from "../src/customization/model";

it.each(["scope", "stage", "agent", "sensor"] as const)(
  "rejects replacing and removing standard %s through the API",
  (kind) => {
    const item: CustomizationItem = {
      id: kind,
      kind,
      owner: "core",
      title: kind,
      content: "original",
    };
    expect(() =>
      applyChanges([item], [{ operation: "replace", item: { ...item, content: "changed" } }]),
    ).toThrow("標準の設定は閲覧のみ");
    expect(() => applyChanges([item], [{ operation: "remove", itemId: item.id }])).toThrow(
      "標準の設定は閲覧のみ",
    );
    expect(() => applyChanges([], [{ operation: "create", item }])).toThrow("標準の設定は閲覧のみ");
  },
);

it("reads the current installation's 33 stage sources instead of the orchestrator skill folder", async () => {
  const catalog = await readCompatibilityCatalog(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const stages = catalog.items.filter((item) => item.kind === "stage" && item.owner === "core");
  expect(stages).toHaveLength(33);
  expect(stages.every((item) => item.editable === false)).toBe(true);
  expect(stages.find((item) => item.runtimeId === "code-generation")?.content).toContain(
    "slug: code-generation",
  );
});
