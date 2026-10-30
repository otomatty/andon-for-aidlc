import path from "node:path";
import { describe, expect, it } from "vitest";
import { reasonText, relativize, renderResult, toContent } from "../src/render.ts";
import { failed, ok, ROOT, unsupported } from "./support.ts";

/** Every reason any of the five tools can surface (S-MS-4 / R-MS-2). */
const REASONS = [
  "no-active-intent",
  "no-selected-intent",
  "state-missing",
  "state-unreadable",
  "outside-record",
  "artifact-not-found",
  "file-too-large",
  "not-found",
  "undefined-term",
  "config-invalid",
];

describe("reasonText", () => {
  it.each(REASONS)("gives %s an actionable Japanese line", (reason) => {
    const text = reasonText(reason);
    expect(text.length).toBeGreaterThan(10);
    // Non-ASCII: the table must not fall through to the generic English-ish path.
    expect(text).toMatch(/[^\x20-\x7e]/);
    expect(text).not.toContain(reason);
  });

  it("names the fault for an internal-normalised reason", () => {
    expect(reasonText("internal: ENOENT open x")).toBe("内部エラー: ENOENT open x");
  });

  it("still answers for an unknown reason instead of throwing", () => {
    expect(reasonText("brand-new-reason")).toContain("brand-new-reason");
  });
});

describe("relativize (S-MS-4)", () => {
  it("strips the workspace root from a native-separator path", () => {
    const absolute = path.join(ROOT, "aidlc", "state.md");
    expect(relativize(`失敗: ${absolute}`, ROOT)).toBe(`失敗: ${path.join("aidlc", "state.md")}`);
  });

  it("strips it when the text uses the other separator", () => {
    const foreign = `${ROOT.split(path.sep).join("/")}/aidlc/state.md`;
    expect(relativize(foreign, ROOT)).toBe("aidlc/state.md");
  });

  it("leaves paths that are not under the root alone", () => {
    const outside = path.join(path.dirname(ROOT), "other", "secret.md");
    expect(relativize(outside, ROOT)).toBe(outside);
  });
});

describe("renderResult", () => {
  it("carries the value into data and never sets isError", () => {
    const reply = renderResult(ok({ a: 1 }), ROOT, (v) => `a=${v.a}`);
    expect(reply.text).toBe("a=1");
    expect(reply.data).toEqual({ a: 1 });
    expect(reply.degraded).toBeUndefined();
    expect(toContent(reply)).not.toHaveProperty("isError");
  });

  it("appends warnings as 注意 lines with paths relativized", () => {
    const warning = `${path.join(ROOT, "audit", "x.md")} を読めませんでした`;
    const reply = renderResult(ok("body", [warning]), ROOT, (v) => v);
    expect(reply.text).toBe(`body\n\n注意: ${path.join("audit", "x.md")} を読めませんでした`);
  });

  it("states the version and the supported one on unsupported", () => {
    const reply = renderResult(unsupported("9"), ROOT, () => "unreachable");
    expect(reply.text).toBe(
      "この state は State Version 9 で、本ツールは 8 に対応です（解析不可）。",
    );
    expect(reply.degraded).toEqual({ kind: "unsupported", detail: "9" });
  });

  it("puts the machine-readable reason on degraded, not just in prose", () => {
    const reply = renderResult(failed("no-active-intent"), ROOT, () => "unreachable");
    expect(reply.degraded).toEqual({ kind: "error", detail: "no-active-intent" });
    expect(reply.data).toBeUndefined();
  });

  it("relativizes an absolute path arriving inside an internal reason", () => {
    const reply = renderResult(
      failed(`internal: EACCES ${path.join(ROOT, "aidlc", "state.md")}`),
      ROOT,
      () => "unreachable",
    );
    expect(reply.text).not.toContain(ROOT);
    expect(reply.text).toContain(path.join("aidlc", "state.md"));
  });

  it("verbatim mode neither rewrites the body nor duplicates it into data", () => {
    const body = `参照: ${path.join(ROOT, "docs", "a.md")}`;
    const reply = renderResult(ok(body), ROOT, (v) => v, { verbatim: true });
    expect(reply.text).toBe(body);
    expect(reply.data).toBeUndefined();
  });
});

describe("toContent (BR-MS-6)", () => {
  it("emits the prose block plus a JSON twin", () => {
    const { content } = toContent({ text: "hi", data: { n: 1 } });
    expect(content).toHaveLength(2);
    expect(content[1]?.text).toBe('```json\n{\n  "n": 1\n}\n```');
  });

  it("falls back to the degraded payload when there is no data", () => {
    const { content } = toContent({ text: "no", degraded: { kind: "error", detail: "not-found" } });
    expect(content[1]?.text).toContain('"detail": "not-found"');
  });

  it("emits prose alone when there is neither", () => {
    expect(toContent({ text: "body" }).content).toHaveLength(1);
  });
});
