import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ReadResult } from "@andon/shared-types";
import { afterAll, describe, expect, it } from "vitest";

/*
 * Attack-vector table for the single guardPath implementation
 * (nfr-design/security-design.md S-RC-2 / S-DB-2).
 *
 * Historically this table guarded equivalence between two deliberate copies
 * (reader-core and docs-bridge each carried one to keep chokidar out of
 * docs-bridge's install closure). Both packages now import the one
 * implementation from @andon/core-utils, so the table is simply its
 * security suite; `guard-path.test.ts` stays as-is and this suite is additive.
 */

export type GuardPath = (root: string, relPath: string) => Promise<ReadResult<string>>;

export interface GuardPathFixture {
  /** The guarded root, `<tmp>/rec/foo`. */
  record: string;
  /** `<tmp>/outside.md` — a real file outside the root. */
  outsideFile: string;
  /** `<tmp>/rec/foobar/leak.md` — the prefix-confusion sibling. */
  siblingFile: string;
  /** False on hosts that cannot create symlinks (Windows without Dev Mode). */
  symlinkOk: boolean;
  root: string;
}

export interface GuardPathVector {
  name: string;
  /** Path handed to guardPath as its second argument. */
  relPath: (fixture: GuardPathFixture) => string;
  expect: "ok" | "outside-record";
  /** Skipped where the host cannot create symlinks. */
  needsSymlink?: boolean;
}

/**
 * `<tmp>/rec/foo` is the guarded root; `<tmp>/rec/foobar` is its prefix-confusing
 * sibling — the pair that a `startsWith`-based guard gets wrong.
 */
async function buildFixture(): Promise<GuardPathFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "guard-path-vectors-"));
  const record = path.join(root, "rec", "foo");
  await mkdir(path.join(record, "construction"), { recursive: true });
  await writeFile(path.join(record, "construction", "a.md"), "inside\n");

  const siblingFile = path.join(root, "rec", "foobar", "leak.md");
  await mkdir(path.dirname(siblingFile), { recursive: true });
  await writeFile(siblingFile, "secret\n");

  const outsideFile = path.join(root, "outside.md");
  await writeFile(outsideFile, "secret\n");

  let symlinkOk = true;
  try {
    await symlink(outsideFile, path.join(record, "escape.md"), "file");
  } catch {
    symlinkOk = false;
  }

  return { root, record, outsideFile, siblingFile, symlinkOk };
}

export const GUARD_PATH_VECTORS: GuardPathVector[] = [
  {
    name: "accepts a nested relative path inside the root",
    relPath: () => path.join("construction", "a.md"),
    expect: "ok",
  },
  {
    name: "accepts a redundant traversal that lands back inside",
    relPath: () => "construction/../construction/a.md",
    expect: "ok",
  },
  {
    name: "accepts the root itself",
    relPath: () => ".",
    expect: "ok",
  },
  {
    name: "accepts a path that does not exist yet (the read reports not-found, not the guard)",
    relPath: () => path.join("construction", "missing.md"),
    expect: "ok",
  },
  {
    name: "vector 1: ../ traversal",
    relPath: () => "../../secrets.md",
    expect: "outside-record",
  },
  {
    name: "vector 1b: a bare ..",
    relPath: () => "..",
    expect: "outside-record",
  },
  {
    name: "vector 2: an absolute path outside the root",
    relPath: (f) => f.outsideFile,
    expect: "outside-record",
  },
  {
    name: "prefix confusion: absolute /rec/foobar next to /rec/foo",
    relPath: (f) => f.siblingFile,
    expect: "outside-record",
  },
  {
    name: "prefix confusion: relative ../foobar/leak.md",
    relPath: () => "../foobar/leak.md",
    expect: "outside-record",
  },
  {
    name: "vector 3: a symlink escaping the root",
    relPath: () => "escape.md",
    expect: "outside-record",
    needsSymlink: true,
  },
];

/** Run every vector against one guardPath implementation. */
export function runGuardPathVectors(label: string, guardPath: GuardPath): void {
  describe(`guardPath shared vectors — ${label}`, async () => {
    const fixture = await buildFixture();
    afterAll(async () => {
      await rm(fixture.root, { recursive: true, force: true });
    });

    for (const vector of GUARD_PATH_VECTORS) {
      it.skipIf(vector.needsSymlink === true && !fixture.symlinkOk)(vector.name, async () => {
        const relPath = vector.relPath(fixture);
        const result = await guardPath(fixture.record, relPath);
        if (vector.expect === "ok") {
          expect(result).toEqual({ ok: true, value: path.resolve(fixture.record, relPath) });
        } else {
          expect(result).toEqual({ error: true, reason: vector.expect });
        }
      });
    }
  });
}
