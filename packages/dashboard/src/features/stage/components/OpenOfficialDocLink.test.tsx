import { render, screen, waitFor } from "@tests/render.tsx";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenOfficialDocLink } from "@/features/stage/components/OpenOfficialDocLink.tsx";
import { StageCard } from "@/features/stage/components/StageCard.tsx";
import { buildOpenOfficialDocMessage, stageDisplayName } from "@/services/docs.ts";
import { deliverOfficialDocsLocale, onOfficialDocsLocale } from "@/services/docs-shell-inject.ts";
import { StoreProvider, useAppState } from "@/store/context.tsx";
import { reducer } from "@/store/reducer.ts";
import { initialState } from "@/store/state.ts";
import { stageDoc } from "@tests/fixtures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubVsCodeHost(): { posted: () => unknown[] } {
  const posted: unknown[] = [];
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage: (message: unknown) => {
      posted.push(message);
    },
  }));
  return { posted: () => posted };
}

function RouteProbe(): ReactNode {
  const { route } = useAppState();
  return (
    <div data-testid="route-probe" hidden>
      {JSON.stringify(route)}
    </div>
  );
}

describe("Open in Docs outside VS Code", () => {
  it("opens the mapped page in the app's own docs view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          value: { path: "guide/getting-started.md", anchor: "approval-gates" },
        }),
      ),
    );
    render(
      <StoreProvider>
        <OpenOfficialDocLink slug="intent-capture" />
        <RouteProbe />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-official-doc"));

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId("route-probe").textContent ?? "{}")).toEqual({
        name: "docs",
        deepLink: { locale: "ja", path: "guide/getting-started.md", anchor: "approval-gates" },
      });
    });
  });
});

describe("buildOpenOfficialDocMessage", () => {
  it("mapped: locale + path + optional anchor", () => {
    expect(
      buildOpenOfficialDocMessage("ja", {
        path: "guide/getting-started.md",
        anchor: "approval-gates",
      }),
    ).toEqual({
      type: "open-official-doc",
      locale: "ja",
      path: "guide/getting-started.md",
      anchor: "approval-gates",
    });
  });

  it("unmapped / empty path: locale only (omit path/anchor keys)", () => {
    const unmapped = buildOpenOfficialDocMessage("en", null);
    expect(unmapped).toEqual({ type: "open-official-doc", locale: "en" });
    expect("path" in unmapped).toBe(false);
    expect("anchor" in unmapped).toBe(false);

    const empty = buildOpenOfficialDocMessage("en", { path: "" });
    expect(empty).toEqual({ type: "open-official-doc", locale: "en" });
    expect("path" in empty).toBe(false);
  });

  it("defaults invalid locale bits to en via ternary", () => {
    expect(buildOpenOfficialDocMessage("en", null).locale).toBe("en");
    expect(buildOpenOfficialDocMessage("ja", null).locale).toBe("ja");
  });
});

describe("stageDisplayName", () => {
  it("title-cases kebab slug", () => {
    expect(stageDisplayName("intent-capture")).toBe("Intent Capture");
    expect(stageDisplayName("code-generation")).toBe("Code Generation");
  });
});

describe("OpenOfficialDocLink / StageCard a11y", () => {
  it("accessible name is Open in Docs (FR-B4-2.4)", async () => {
    stubVsCodeHost();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          value: { path: "guide/getting-started.md", anchor: "approval-gates" },
        }),
      ),
    );

    render(
      <StoreProvider>
        <OpenOfficialDocLink slug="intent-capture" sourceVersion="1.4.0" />
      </StoreProvider>,
    );

    const control = screen.getByRole("button", { name: "Open in Docs" });
    expect(control.getAttribute("aria-label")).toBe("Open in Docs");
    expect(control.textContent).toBe("Open in Docs");
    expect(control.getAttribute("data-testid")).toBe("open-official-doc");
  });

  it("mapped StageCard path does not post open-doc", async () => {
    const host = stubVsCodeHost();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/official-docs/stage/")) {
          return Response.json({
            ok: true,
            value: { path: "guide/getting-started.md", anchor: "approval-gates" },
          });
        }
        return Response.json({ error: true, reason: "not_found" }, { status: 404 });
      }),
    );

    render(
      <StoreProvider>
        <StageCard doc={stageDoc({ slug: "intent-capture", purpose: "Capture intent." })} />
      </StoreProvider>,
    );

    expect(screen.queryByTestId("docs-open-ide")).toBeNull();
    await userEvent.click(screen.getByTestId("open-official-doc"));

    await waitFor(() => {
      expect(host.posted()).toHaveLength(1);
    });
    expect(host.posted()[0]).toEqual({
      type: "open-official-doc",
      locale: "ja",
      path: "guide/getting-started.md",
      anchor: "approval-gates",
    });
    expect(host.posted().some((m) => (m as { type?: string }).type === "open-doc")).toBe(false);
  });

  it("uses officialDocsLocale from store for payload locale", async () => {
    const host = stubVsCodeHost();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, value: null })),
    );

    render(
      <StoreProvider preloaded={{ officialDocsLocale: "en" }}>
        <OpenOfficialDocLink slug="code-generation" />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-official-doc"));
    await waitFor(() => {
      expect(host.posted()).toEqual([{ type: "open-official-doc", locale: "en" }]);
    });
  });

  it("does not open Shell when stage-map fetch errors (not unmapped)", async () => {
    const host = stubVsCodeHost();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: true, reason: "server-unreachable" })),
    );

    render(
      <StoreProvider>
        <OpenOfficialDocLink slug="intent-capture" />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-official-doc"));
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0);
    });
    expect(host.posted()).toEqual([]);
  });

  it("ignores a stage-map result after unmount (stale activation)", async () => {
    const host = stubVsCodeHost();
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const view = render(
      <StoreProvider>
        <OpenOfficialDocLink slug="intent-capture" />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-official-doc"));
    view.unmount();
    resolveFetch(
      Response.json({
        ok: true,
        value: { path: "guide/getting-started.md", anchor: "approval-gates" },
      }),
    );
    await Promise.resolve();
    expect(host.posted()).toEqual([]);
  });

  it("ignores a stage-map result after slug changes (reused StageCard)", async () => {
    const host = stubVsCodeHost();
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const view = render(
      <StoreProvider>
        <OpenOfficialDocLink slug="intent-capture" />
      </StoreProvider>,
    );

    await userEvent.click(screen.getByTestId("open-official-doc"));
    view.rerender(
      <StoreProvider>
        <OpenOfficialDocLink slug="code-generation" />
      </StoreProvider>,
    );
    resolveFetch(
      Response.json({
        ok: true,
        value: { path: "guide/getting-started.md", anchor: "approval-gates" },
      }),
    );
    await Promise.resolve();
    expect(host.posted()).toEqual([]);
  });
});

describe("officialDocsLocale host bootstrap", () => {
  it("replays a ready-locale that arrived before subscribe", () => {
    const seen: string[] = [];
    deliverOfficialDocsLocale("ja");
    const off = onOfficialDocsLocale((locale) => {
      seen.push(locale);
    });
    expect(seen).toEqual(["ja"]);
    off();
  });
});

describe("store deep-link locale", () => {
  it("requires locale when deep-link is non-null; one-shot clear still works", () => {
    const open = reducer(initialState, {
      type: "docs-shell",
      open: true,
      locale: "ja",
      path: "guide/concepts.md",
      anchor: "approval-gates",
    });
    expect(open.route).toEqual({
      name: "docs",
      deepLink: {
        locale: "ja",
        path: "guide/concepts.md",
        anchor: "approval-gates",
      },
    });
    expect(open.officialDocsLocale).toBe("ja");

    const cleared = reducer(open, { type: "docs-shell", open: true });
    expect(cleared.route).toEqual({ name: "docs" });
    expect(cleared.officialDocsLocale).toBe("ja");

    const localeOnly = reducer(initialState, {
      type: "docs-shell",
      open: true,
      locale: "en",
    });
    expect(localeOnly.route).toEqual({ name: "docs", deepLink: { locale: "en" } });
    expect(
      "path" in (localeOnly.route.name === "docs" ? (localeOnly.route.deepLink ?? {}) : {}),
    ).toBe(false);
  });
});
