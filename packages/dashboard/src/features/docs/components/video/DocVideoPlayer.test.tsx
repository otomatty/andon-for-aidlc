import { cleanup, render, screen, waitFor } from "@tests/render.tsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocVideoPlayer } from "./DocVideoPlayer.tsx";

const HASH = "d".repeat(64);
const STORYBOARD = {
  formatVersion: 1,
  page: "guide/04-phases-and-stages.md",
  sourceHash: HASH,
  title: "フェーズとステージ",
  chapters: [
    {
      id: "intro",
      title: "はじめに",
      template: "title",
      cues: [{ text: "流れを見ます。" }],
      data: { headline: "フェーズとステージ" },
    },
  ],
};
const TIMELINE = {
  formatVersion: 1,
  duration: 5,
  chapters: [{ id: "intro", start: 0, duration: 5, cues: [{ start: 1, end: 4 }] }],
};

/** A 2D context that accepts every call (jsdom has no canvas). */
function fakeContext(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {};
  return new Proxy(state, {
    get: (target, prop) =>
      prop in target
        ? target[prop]
        : prop === "measureText"
          ? (s: string) => ({ width: s.length * 10 })
          : () => undefined,
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => fakeContext() as unknown as RenderingContext,
  );
  play = vi.fn(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

/** A narration element as the card makes it; `playing` mimics a play() already started by the click. */
function narration({ playing = false, failed = false } = {}): HTMLAudioElement {
  const audio = document.createElement("audio");
  audio.src = "webview:n.opus";
  Object.defineProperty(audio, "paused", { configurable: true, get: () => !playing });
  if (failed) Object.defineProperty(audio, "error", { value: { code: 4 } });
  return audio;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DocVideoPlayer", () => {
  it("mounts the Kamishibai player and follows the narration the click started", async () => {
    const audio = narration({ playing: true });
    render(<DocVideoPlayer storyboard={STORYBOARD} timeline={TIMELINE} audio={audio} />);
    const root = screen.getByTestId("doc-video-player");
    await waitFor(() => expect(root.querySelector(".ksb canvas")).not.toBeNull());
    expect(root.querySelector(".ksb-time")?.textContent).toBe("0:00 / 0:05");
    // The picture joins the playing audio; it does not start a second playback.
    await waitFor(() =>
      expect(root.querySelector("[data-a=play]")?.getAttribute("aria-label")).toBe("一時停止"),
    );
  });

  it("does not play on its own when the click could not start the audio", async () => {
    render(<DocVideoPlayer storyboard={STORYBOARD} timeline={TIMELINE} audio={narration()} />);
    await waitFor(() => expect(document.querySelector(".ksb")).not.toBeNull());
    expect(play).not.toHaveBeenCalled();
    expect(document.querySelector("[data-a=play]")?.getAttribute("aria-label")).toBe("再生");
  });

  it("removes the player and releases the audio on unmount", async () => {
    const audio = narration();
    const { unmount } = render(
      <DocVideoPlayer storyboard={STORYBOARD} timeline={TIMELINE} audio={audio} />,
    );
    await waitFor(() => expect(document.querySelector(".ksb")).not.toBeNull());
    unmount();
    expect(document.querySelector(".ksb")).toBeNull();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(audio.getAttribute("src")).toBeNull();
  });

  it("reports unreadable video data instead of drawing", async () => {
    render(<DocVideoPlayer storyboard={{}} timeline={{}} audio={narration()} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "動画データを読み込めませんでした",
    );
  });

  it("reports a storyboard the templates cannot draw", async () => {
    const broken = { ...STORYBOARD, chapters: [{ ...STORYBOARD.chapters[0], data: {} }] };
    render(<DocVideoPlayer storyboard={broken} timeline={TIMELINE} audio={narration()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("headline");
  });

  it("reports a host that cannot draw at all", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(<DocVideoPlayer storyboard={STORYBOARD} timeline={TIMELINE} audio={narration()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("描画できません");
  });

  it("reports narration that will not play", async () => {
    play.mockRejectedValueOnce(new Error("NotAllowedError"));
    render(
      <DocVideoPlayer
        storyboard={STORYBOARD}
        timeline={TIMELINE}
        audio={narration({ playing: true })}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("再生できませんでした");
  });

  it("reports a narration file that fails to load, before or after mounting", async () => {
    const late = narration();
    render(<DocVideoPlayer storyboard={STORYBOARD} timeline={TIMELINE} audio={late} />);
    await waitFor(() => expect(document.querySelector(".ksb")).not.toBeNull());
    late.dispatchEvent(new Event("error"));
    expect((await screen.findByRole("alert")).textContent).toContain("音声を読み込めませんでした");
    cleanup();
    render(
      <DocVideoPlayer
        storyboard={STORYBOARD}
        timeline={TIMELINE}
        audio={narration({ failed: true })}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("音声を読み込めませんでした");
  });
});
