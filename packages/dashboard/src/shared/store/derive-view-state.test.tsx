import { describe, expect, it } from "vitest";
import {
  deriveViewState,
  deriveWorkflow,
  matrixNotes,
  workflowNotes,
} from "@/store/derive-view-state.ts";
import { matrix, payload, workflow } from "@tests/fixtures.ts";

const STATE_WARNING = "成果物の一部を読めませんでした。";

/** The five states of refined-mockups Q2. */

describe("deriveViewState", () => {
  it("success: a clean ok result", () => {
    expect(deriveViewState({ ok: true, value: 1 })).toEqual({ kind: "success", value: 1 });
  });

  it("empty: no-active-intent is emptiness, not breakage", () => {
    const state = deriveViewState({ error: true, reason: "no-active-intent" });
    expect(state.kind).toBe("empty");
    expect(state.kind === "empty" && state.hint).toContain("アクティブなインテント");
  });

  it("empty: no-selected-intent is emptiness, not breakage", () => {
    const state = deriveViewState({ error: true, reason: "no-selected-intent" });
    expect(state.kind).toBe("empty");
    expect(state.kind === "empty" && state.hint).toContain("インテントを選んでください");
  });

  it("maps state-missing to empty with guidance, not error", () => {
    const state = deriveViewState({ error: true, reason: "state-missing" });
    expect(state.kind).toBe("empty");
    if (state.kind !== "empty") return;
    expect(state.hint).toContain("aidlc-state.md");
    expect(state.hint).toContain("/aidlc");
  });

  it("error: an unsupported State Version names the version", () => {
    const state = deriveViewState({ unsupported: true, version: "9" });
    expect(state.kind).toBe("error");
    expect(state.kind === "error" && state.detail).toContain("9");
    expect(state.kind === "error" && state.detail).toContain("Version 8 を解析");
  });

  it("error: a State Version 7 record is refused, not browsed", () => {
    const state = deriveViewState({ unsupported: true, version: "7" });
    expect(state.kind).toBe("error");
    expect(state.kind === "error" && state.detail).toContain("State Version 7 は未対応");
  });

  it("error: a transport failure says the server is unreachable", () => {
    const state = deriveViewState({ error: true, reason: "server-unreachable" });
    expect(state.kind === "error" && state.detail).toContain("サーバに接続できません");
  });

  it("error: an unknown reason is still shown, never swallowed", () => {
    const state = deriveViewState({ error: true, reason: "internal: boom" });
    expect(state.kind === "error" && state.detail).toContain("internal: boom");
  });

  it("partial: a state-file warning is shown, not treated as unsupported", () => {
    const state = deriveViewState({ ok: true, value: 1, warnings: [STATE_WARNING] });
    expect(state.kind).toBe("partial");
    expect(state.kind === "partial" && state.notes).toEqual([STATE_WARNING]);
  });

  it("partial: server warnings downgrade success and are carried", () => {
    const state = deriveViewState({ ok: true, value: 1, warnings: ["行 12 が読めません"] });
    expect(state).toEqual({ kind: "partial", value: 1, notes: ["行 12 が読めません"] });
  });

  it("partial: value-level degradation also downgrades success (BR-UI-4)", () => {
    const degraded = workflow({
      unparseable: { gate: "unknown mark" },
      stages: [...workflow().stages],
    });
    const state = deriveViewState({ ok: true, value: degraded }, workflowNotes);
    expect(state.kind).toBe("partial");
    expect(state.kind === "partial" && state.notes).toEqual(["gate: unknown mark"]);
  });
});

describe("degradation extractors", () => {
  it("reports per-stage unparseable marks", () => {
    const model = workflow();
    const [first] = model.stages;
    if (first === undefined) throw new Error("fixture has no stages");
    first.unparseable = "unknown G-3 mark";
    expect(workflowNotes(model)).toEqual(["intent-capture: unknown G-3 mark"]);
  });

  it("reports cell-level errors and nothing else", () => {
    const model = matrix();
    const [cell] = model.cells;
    if (cell === undefined) throw new Error("fixture has no cells");
    cell.error = "ディレクトリを読めません";
    expect(matrixNotes(model)).toEqual([
      "reader-core / functional-design: ディレクトリを読めません",
    ]);
  });
});

describe("deriveWorkflow", () => {
  it("applies one state-file warning to both slices", () => {
    const { workflow: w, nextStep } = deriveWorkflow({
      ok: true,
      value: payload(),
      warnings: ["Total Stages 欄が欠落"],
    });
    expect(w.kind).toBe("partial");
    expect(nextStep.kind).toBe("partial");
  });

  it("propagates an entry-level error to both slices", () => {
    const { workflow: w, nextStep } = deriveWorkflow({
      error: true,
      reason: "server-unreachable",
    });
    expect(w.kind).toBe("error");
    expect(nextStep.kind).toBe("error");
  });

  it("treats state-missing as empty in both slices", () => {
    const { workflow: w, nextStep } = deriveWorkflow({
      error: true,
      reason: "state-missing",
    });
    expect(w.kind).toBe("empty");
    expect(nextStep.kind).toBe("empty");
  });

  it("treats no-selected-intent as empty without a server mode", () => {
    const { workflow: w, nextStep } = deriveWorkflow({
      error: true,
      reason: "no-selected-intent",
    });
    expect(w.kind).toBe("empty");
    expect(nextStep.kind).toBe("empty");
  });
});
