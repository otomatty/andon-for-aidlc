import { act, cleanup, render, screen, within } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocsPageOutline, readPageOutline } from "./DocsPageOutline.tsx";

const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function Harness({ children }: { children: ReactNode }): ReactNode {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={bodyRef} data-testid="outline-body">
        {children}
      </div>
      <DocsPageOutline contentRef={bodyRef} />
    </>
  );
}

describe("readPageOutline", () => {
  it("lists Markdown ## and ### (rendered h4 / h5) in document order", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      "<h3>ページ題</h3>",
      "<h4>  フェーズ 0: 初期化 </h4>",
      "<h5>実行上の注意</h5>",
      "<h6>細かすぎる見出し</h6>",
      "<h4>フェーズ 1</h4>",
      "<h4>   </h4>",
    ].join("");

    expect(readPageOutline(root).map(({ text, level }) => ({ text, level }))).toEqual([
      { text: "フェーズ 0: 初期化", level: 2 },
      { text: "実行上の注意", level: 3 },
      { text: "フェーズ 1", level: 2 },
    ]);
  });

  it("returns nothing for a body without section headings", () => {
    const root = document.createElement("div");
    root.innerHTML = "<h3>題だけ</h3><p>本文</p>";
    expect(readPageOutline(root)).toEqual([]);
  });
});

describe("DocsPageOutline", () => {
  it("offers one entry per section and jumps to the heading on click", async () => {
    render(
      <Harness>
        <h4>承認ゲート</h4>
        <p>本文</p>
        <h5>ゲートの種類</h5>
        <h4>検証ゲート</h4>
      </Harness>,
    );

    const nav = await screen.findByRole("navigation", { name: "このページの内容" });
    const entries = within(nav).getAllByRole("button");
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "承認ゲート",
      "ゲートの種類",
      "検証ゲート",
    ]);
    expect(entries[1]?.getAttribute("data-level")).toBe("3");

    await userEvent.click(within(nav).getByRole("button", { name: "検証ゲート" }));
    const target = screen.getByRole("heading", { name: "検証ゲート" });
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(document.activeElement).toBe(target);
    expect(
      within(nav).getByRole("button", { name: "検証ゲート" }).getAttribute("aria-current"),
    ).toBe("location");
  });

  it("clears the current section when the page changes under reused heading elements", async () => {
    render(
      <Harness>
        <h4>記事Aの一</h4>
        <h4>記事Aの二</h4>
      </Harness>,
    );
    const nav = await screen.findByRole("navigation", { name: "このページの内容" });
    await userEvent.click(within(nav).getByRole("button", { name: "記事Aの二" }));
    expect(
      within(nav).getByRole("button", { name: "記事Aの二" }).getAttribute("aria-current"),
    ).toBe("location");

    // React may keep the same <h4> nodes and swap only their text on navigation.
    const [first, second] = screen.getAllByRole("heading");
    await act(async () => {
      if (first) first.textContent = "記事Bの一";
      if (second) second.textContent = "記事Bの二";
    });

    const next = await within(nav).findByRole("button", { name: "記事Bの二" });
    expect(next.getAttribute("aria-current")).toBeNull();
  });

  it("stays hidden when a page has fewer than two sections", () => {
    render(
      <Harness>
        <h4>ひとつだけ</h4>
      </Harness>,
    );
    expect(screen.queryByRole("navigation", { name: "このページの内容" })).toBeNull();
  });

  it("picks up headings that mount after the outline (lazy Markdown body)", async () => {
    render(
      <Harness>
        <p>読み込み中</p>
      </Harness>,
    );
    expect(screen.queryByRole("navigation", { name: "このページの内容" })).toBeNull();

    await act(async () => {
      screen.getByTestId("outline-body").innerHTML = "<h4>あとから一</h4><h4>あとから二</h4>";
    });

    const nav = await screen.findByRole("navigation", { name: "このページの内容" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((entry) => entry.textContent),
    ).toEqual(["あとから一", "あとから二"]);
  });
});
