import path from "node:path";
import type { WatchEvent } from "@andon/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The R-RC-4 resubscribe ladder, driven through a stand-in for chokidar.
 * A real watcher cannot be made to emit `error` on demand, and "the UI must be
 * told when it stops being live" is exactly the branch that must not rot.
 */

interface FakeWatcher {
  handlers: Map<string, (...args: unknown[]) => void>;
  closed: boolean;
  targets: unknown;
  options: { followSymlinks?: boolean; ignoreInitial?: boolean };
}

const watchers: FakeWatcher[] = [];
/** Number of `chokidarWatch` calls that should throw before one succeeds. */
let failNextSubscribes = 0;

vi.mock("chokidar", () => ({
  watch: (targets: unknown, options: FakeWatcher["options"]) => {
    if (failNextSubscribes > 0) {
      failNextSubscribes -= 1;
      throw new Error("EMFILE: too many open files");
    }
    const w: FakeWatcher = { handlers: new Map(), closed: false, targets, options };
    watchers.push(w);
    return {
      on(event: string, handler: (...args: unknown[]) => void) {
        w.handlers.set(event, handler);
        return this;
      },
      close: async () => {
        w.closed = true;
      },
    };
  },
}));

const { watch } = await import("../src/watch/watcher.ts");

function fail(index: number): void {
  watchers[index]?.handlers.get("error")?.(new Error("watcher died"));
}

beforeEach(() => {
  watchers.length = 0;
  failNextSubscribes = 0;
});

describe("watch — subscription failures", () => {
  it("reports watcher-lost when the very first subscribe throws", () => {
    failNextSubscribes = 1;
    const events: WatchEvent[] = [];

    const dispose = watch("/rec", (e) => events.push(e));
    dispose();

    expect(events).toEqual([{ type: "watch-warning", reason: "watcher-lost" }]);
  });

  it("resubscribes silently up to the limit", () => {
    const events: WatchEvent[] = [];
    const dispose = watch("/rec", (e) => events.push(e), { maxResubscribes: 3 });

    fail(0);
    fail(1);
    fail(2);

    expect(watchers).toHaveLength(4); // initial + 3 replacements
    expect(watchers[0]?.closed).toBe(true);
    expect(events).toEqual([]);
    dispose();
  });

  it("reports resubscribe-failed once the limit is exceeded", () => {
    const events: WatchEvent[] = [];
    const dispose = watch("/rec", (e) => events.push(e), { maxResubscribes: 1 });

    fail(0); // resubscribed
    fail(1); // over the limit
    expect(events).toEqual([{ type: "watch-warning", reason: "resubscribe-failed" }]);
    dispose();
  });

  it("reports resubscribe-failed when the replacement subscribe itself throws", () => {
    const events: WatchEvent[] = [];
    const dispose = watch("/rec", (e) => events.push(e), { maxResubscribes: 3 });

    failNextSubscribes = 1;
    fail(0);

    expect(events).toEqual([{ type: "watch-warning", reason: "resubscribe-failed" }]);
    dispose();
  });

  it("stays silent about errors that arrive after dispose", () => {
    const events: WatchEvent[] = [];
    const dispose = watch("/rec", (e) => events.push(e));

    dispose();
    fail(0);

    expect(events).toEqual([]);
    expect(watchers).toHaveLength(1);
  });

  it("closes the watcher on dispose", () => {
    const dispose = watch("/rec", () => {});
    expect(watchers[0]?.closed).toBe(false);
    dispose();
    expect(watchers[0]?.closed).toBe(true);
  });

  it("drops queued and late filesystem callbacks after disposal", () => {
    vi.useFakeTimers();
    const events: WatchEvent[] = [];
    const root = path.resolve("rec");
    const changed = path.join(root, "aidlc-state.md");
    const dispose = watch(root, (event) => events.push(event), { debounceMs: 30 });
    try {
      const emit = watchers[0]?.handlers.get("all");
      emit?.("change", changed);
      vi.advanceTimersByTime(30);
      expect(events).toEqual([{ type: "change", scope: "state", path: changed }]);

      emit?.("change", changed);
      const beforeDispose = [...events];
      dispose();
      emit?.("change", changed);
      fail(0);
      vi.advanceTimersByTime(1000);
      expect(events).toEqual(beforeDispose);
      expect(watchers).toHaveLength(1);
    } finally {
      dispose();
      vi.useRealTimers();
    }
  });

  it("uses one root subscription without following symlinks for canonical records", () => {
    const root = path.resolve("project");
    const dispose = watch(path.join(root, "aidlc/spaces/default/intents/current"), () => {});
    expect(watchers).toHaveLength(1);
    expect(watchers[0]?.targets).toEqual([root]);
    expect(watchers[0]?.options).toMatchObject({ followSymlinks: false, ignoreInitial: true });
    dispose();
  });

  it("rejects stale callbacks after replacement and cancels queued source events on dispose", () => {
    vi.useFakeTimers();
    const root = path.resolve("project");
    const events: WatchEvent[] = [];
    const dispose = watch(
      path.join(root, "aidlc/spaces/default/intents/current"),
      (event) => events.push(event),
      { debounceMs: 30 },
    );
    try {
      const prior = watchers[0]?.handlers.get("all");
      fail(0);
      prior?.("change", path.join(root, "stale.ts"));
      fail(0);
      expect(watchers).toHaveLength(2);
      watchers[1]?.handlers.get("all")?.("change", path.join(root, "app.ts"));
      vi.advanceTimersByTime(30);
      expect(events).toEqual([
        { type: "change", scope: "review-inputs", path: path.join(root, "app.ts") },
      ]);
      watchers[1]?.handlers.get("all")?.("change", path.join(root, "queued.ts"));
      dispose();
      vi.advanceTimersByTime(30);
      expect(events).toHaveLength(1);
    } finally {
      dispose();
      vi.useRealTimers();
    }
  });
});
