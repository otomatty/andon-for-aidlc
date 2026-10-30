import { describe, expect, it, vi } from "vitest";
import {
  acceptedChoice,
  applyFailureMessage,
  applyProgressTitle,
  applySuccessMessage,
  lookupFailureMessage,
  presentApplyResult,
  RELOAD_ACTION,
  UPDATE_ACTION,
  updateConfirmDetail,
} from "../src/update-feedback.ts";

describe("acceptedChoice", () => {
  it("accepts the action string and a MessageItem with that title", () => {
    expect(acceptedChoice(UPDATE_ACTION, UPDATE_ACTION)).toBe(true);
    expect(acceptedChoice({ title: UPDATE_ACTION }, UPDATE_ACTION)).toBe(true);
    expect(acceptedChoice(RELOAD_ACTION, RELOAD_ACTION)).toBe(true);
  });

  it("rejects dismissals and other labels", () => {
    expect(acceptedChoice(undefined, UPDATE_ACTION)).toBe(false);
    expect(acceptedChoice("閉じる", UPDATE_ACTION)).toBe(false);
    expect(acceptedChoice({ title: "閉じる" }, UPDATE_ACTION)).toBe(false);
    expect(acceptedChoice({ id: UPDATE_ACTION }, UPDATE_ACTION)).toBe(false);
    expect(acceptedChoice(null, UPDATE_ACTION)).toBe(false);
  });
});

describe("applyFailureMessage", () => {
  it("uses a Japanese label instead of the raw reason code", () => {
    expect(applyFailureMessage({ ok: false, reason: "timeout" })).toBe(
      "更新に失敗しました（ダウンロードが時間切れ）。",
    );
    expect(applyFailureMessage({ ok: false, reason: "invalid-vsix" })).toBe(
      "更新に失敗しました（ファイルが VSIX ではありません）。",
    );
  });
});

describe("applyFailureMessage detail", () => {
  it("appends detail and keeps the VSIX path on install failure", () => {
    expect(applyFailureMessage({ ok: false, reason: "http", detail: "HTTP 404" })).toBe(
      "更新に失敗しました（ダウンロード失敗）：HTTP 404",
    );
    expect(
      applyFailureMessage({
        ok: false,
        reason: "install",
        detail: "command not found",
        filePath: "/tmp/andon-for-aidlc-0.2.0.vsix",
      }),
    ).toBe(
      "更新に失敗しました（インストールに失敗）：command not found ファイルを残してあります: /tmp/andon-for-aidlc-0.2.0.vsix。「Extensions: Install from VSIX」から手動で入れられます。",
    );
  });
});

describe("presentApplyResult", () => {
  it("shows the failure message and does not reload", async () => {
    const showError = vi.fn(async () => undefined);
    const confirmReload = vi.fn(async () => RELOAD_ACTION);
    const reload = vi.fn(async () => undefined);
    await presentApplyResult({ ok: false, reason: "network", detail: "ECONNRESET" }, "0.2.0", {
      showError,
      confirmReload,
      reload,
    });
    expect(showError).toHaveBeenCalledWith("更新に失敗しました（ネットワークエラー）：ECONNRESET");
    expect(confirmReload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("asks to reload after a successful install and honors the choice", async () => {
    const showError = vi.fn(async () => undefined);
    const confirmReload = vi.fn(async () => ({ title: RELOAD_ACTION }));
    const reload = vi.fn(async () => undefined);
    await presentApplyResult({ ok: true }, "0.2.0", { showError, confirmReload, reload });
    expect(showError).not.toHaveBeenCalled();
    expect(confirmReload).toHaveBeenCalledWith(applySuccessMessage("0.2.0"), RELOAD_ACTION);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload when the success prompt is dismissed", async () => {
    const reload = vi.fn(async () => undefined);
    await presentApplyResult({ ok: true }, "0.2.0", {
      showError: async () => undefined,
      confirmReload: async () => undefined,
      reload,
    });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("copy", () => {
  it("names the version in progress and success text", () => {
    expect(applyProgressTitle("0.2.0")).toContain("0.2.0");
    expect(applySuccessMessage("0.2.0")).toContain("0.2.0");
    expect(applySuccessMessage("0.2.0")).toContain("再読み込み");
  });
});

describe("lookupFailureMessage", () => {
  it("maps known lookup reasons to Japanese copy", () => {
    expect(lookupFailureMessage("rate-limited")).toContain("GitHub");
    expect(lookupFailureMessage("mystery")).toContain("mystery");
  });
});

describe("updateConfirmDetail", () => {
  it("lists the offered version's changes, five at most", () => {
    expect(updateConfirmDetail("0.35.0", ["はじめにを追加", "修正"])).toBe(
      "0.35.0 の主な変更:\n・はじめにを追加\n・修正",
    );
    const many = ["1", "2", "3", "4", "5", "6", "7"];
    expect(updateConfirmDetail("0.35.0", many)).toBe(
      "0.35.0 の主な変更:\n・1\n・2\n・3\n・4\n・5\nほか 2 件",
    );
  });

  it("adds nothing when the release lists no changes", () => {
    expect(updateConfirmDetail("0.35.0", [])).toBeUndefined();
  });
});
