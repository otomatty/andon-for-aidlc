import type { DocVideoPayload, ReadResult } from "@aidlc-guide/shared-types";
import { act, cleanup, render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchVideo: vi.fn<(locale: string, docPath: string) => Promise<ReadResult<DocVideoPayload>>>(),
  inWebview: vi.fn(() => true),
}));

vi.mock("@/services/api.ts", () => ({ fetchOfficialDocsVideo: mocks.fetchVideo }));
vi.mock("@/services/vscode-api.ts", () => ({ inVsCodeWebview: mocks.inWebview }));
vi.mock("./DocVideoPlayer.tsx", () => ({
  DocVideoPlayer: (props: { audio: HTMLAudioElement }) => (
    <div data-testid="player-stub" data-url={props.audio.getAttribute("src") ?? ""} />
  ),
}));

import { deliverVideoPacksChanged } from "@/services/video-packs-inject.ts";
import { DocVideoCard } from "./DocVideoCard.tsx";

const PAGE = "guide/04-phases-and-stages.md";

function available(
  overrides: Partial<Extract<DocVideoPayload, { status: "available" }>> = {},
): ReadResult<DocVideoPayload> {
  return {
    ok: true,
    value: {
      status: "available",
      packId: "official-ja",
      packVersion: "0.1.0",
      freshness: "fresh",
      missingTemplates: [],
      durationSec: 172.4,
      storyboard: {},
      timeline: {},
      narrationUrl: "webview:narration.opus",
      ...overrides,
    },
  };
}

beforeEach(() => {
  mocks.fetchVideo.mockReset();
  mocks.inWebview.mockReturnValue(true);
});

afterEach(() => cleanup());

describe("DocVideoCard", () => {
  it("asks for this page's video in this locale", async () => {
    mocks.fetchVideo.mockResolvedValue(available());
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    await screen.findByTestId("doc-video");
    expect(mocks.fetchVideo).toHaveBeenCalledWith("ja", PAGE);
  });

  it("offers the video with its length and the AI-voice label, without playing it", async () => {
    mocks.fetchVideo.mockResolvedValue(available());
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    const play = await screen.findByRole("button", { name: /解説動画 2:52/ });
    expect(screen.getByText("音声は AI 生成")).toBeTruthy();
    expect(screen.queryByTestId("player-stub")).toBeNull();
    expect(screen.queryByTestId("doc-video-stale")).toBeNull();
    const started = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    await userEvent.click(play);
    // The narration starts inside the click, before the player chunk has loaded.
    expect(started).toHaveBeenCalledOnce();
    const player = await screen.findByTestId("player-stub");
    expect(player.dataset.url).toBe("webview:narration.opus");
    started.mockRestore();
    expect((play as HTMLButtonElement).disabled).toBe(true);
  });

  it("still opens the player when the browser refuses to start the audio", async () => {
    mocks.fetchVideo.mockResolvedValue(available());
    const refused = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValue(new Error("NotAllowedError"));
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    await userEvent.click(await screen.findByRole("button", { name: /解説動画/ }));
    expect(await screen.findByTestId("player-stub")).toBeTruthy();
    refused.mockRestore();
  });

  it("asks again when the host reports packs installed or removed", async () => {
    mocks.fetchVideo.mockResolvedValue({ ok: true, value: { status: "none", packs: 0 } });
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    await screen.findByTestId("doc-video-hint");
    mocks.fetchVideo.mockResolvedValue(available());
    act(() => deliverVideoPacksChanged());
    expect(await screen.findByTestId("doc-video")).toBeTruthy();
    expect(mocks.fetchVideo).toHaveBeenCalledTimes(2);
  });

  it("flags a video made before the page last changed", async () => {
    mocks.fetchVideo.mockResolvedValue(available({ freshness: "stale" }));
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    expect(await screen.findByTestId("doc-video-stale")).toBeTruthy();
    expect(screen.getByText(/ページが更新されています/)).toBeTruthy();
  });

  it("explains instead of playing when the extension is too old for the video", async () => {
    mocks.fetchVideo.mockResolvedValue(available({ missingTemplates: ["hologram"] }));
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    const play = await screen.findByRole("button", { name: /解説動画/ });
    expect((play as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("拡張機能の更新が必要");
  });

  it("explains instead of playing where pack files cannot be served", async () => {
    mocks.fetchVideo.mockResolvedValue(available({ narrationUrl: null }));
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    const play = await screen.findByRole("button", { name: /解説動画/ });
    expect((play as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("VS Code");
  });

  it("hints at the pack in the VS Code panel when no Japanese pack is installed", async () => {
    mocks.fetchVideo.mockResolvedValue({ ok: true, value: { status: "none", packs: 0 } });
    render(<DocVideoCard locale="ja" docPath={PAGE} />);
    expect((await screen.findByTestId("doc-video-hint")).textContent).toContain(
      "VSIX からインストール",
    );
  });

  it.each([
    ["a pack is installed but has no video for the page", { status: "none", packs: 1 }, "ja", true],
    ["the page is in English", { status: "none", packs: 0 }, "en", true],
    ["the browser cannot install packs", { status: "none", packs: 0 }, "ja", false],
  ] as const)("shows nothing when %s", async (_label, value, locale, webview) => {
    mocks.inWebview.mockReturnValue(webview);
    mocks.fetchVideo.mockResolvedValue({ ok: true, value });
    const { container } = render(<DocVideoCard locale={locale} docPath={PAGE} />);
    await waitFor(() => expect(mocks.fetchVideo).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });

  it.each([
    ["an error", { error: true, reason: "server-unreachable" }],
    ["an unexpected body", { ok: true, value: { localeServed: "ja" } }],
  ] as const)("stays out of the way on %s", async (_label, result) => {
    mocks.fetchVideo.mockResolvedValue(result as unknown as ReadResult<DocVideoPayload>);
    const { container } = render(<DocVideoCard locale="ja" docPath={PAGE} />);
    await waitFor(() => expect(mocks.fetchVideo).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
