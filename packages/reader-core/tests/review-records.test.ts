import { createHash } from "node:crypto";
import { appendFile, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllAuditEvents } from "../src/audit/events.ts";
import { buildMatrix, buildMatrixForUnit } from "../src/tree/matrix.ts";
import {
  readReviewVerdicts,
  reviewCellKey,
  reviewUnitsInAuditShard,
} from "../src/tree/review-records.ts";
import { expectOk } from "./paths.ts";
import { reviewFixture as createReviewFixture, reviewAudit } from "./review-fixtures.ts";
import { stateWithStages } from "./state-fixtures.ts";

describe.each([".aidlc-reviews", ".aidlc-engine/reviews"] as const)(
  "matrix review records in %s",
  (directory) => {
    const reviewFixture = (options: Parameters<typeof createReviewFixture>[0] = {}) =>
      createReviewFixture({ directory, ...options });
    let root: string;
    let record: string;
    const configureIteration = async (iteration: "stage-major" | "unit-major") =>
      writeFile(
        path.join(record, "aidlc-state.md"),
        `## Scope Configuration\n- **Change Control**: relaxed (set by you)\n\n## Runtime State\n- **Construction Iteration**: ${iteration}\n`,
      );
    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "guide-reviews-"));
      record = path.join(root, "aidlc", "spaces", "default", "intents", "review-12345678");
      await mkdir(path.join(record, "construction", "unit-alpha", "functional-design"), {
        recursive: true,
      });
      await mkdir(path.join(record, "audit"), { recursive: true });
      await configureIteration("stage-major");
      await writeFile(
        path.join(record, "construction", "unit-alpha", "functional-design", "design.md"),
        "## Review\n**Verdict:** NOT-READY\n",
      );
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const read = async () =>
      expectOk(await buildMatrixForUnit(record, "unit-alpha", ["functional-design"])).value[0]
        ?.verdict;
    const audit = async (text: string) => writeFile(path.join(record, "audit", "clone.md"), text);
    const save = async (fixture: ReturnType<typeof reviewFixture>) => {
      const file = path.join(record, fixture.relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, fixture.bytes);
      return file;
    };

    it.each([".aidlc-reviews", ".aidlc-engine/reviews"] as const)(
      "uses verified JSON from %s instead of an older embedded verdict",
      async (directory) => {
        const fixture = reviewFixture({ directory });
        await save(fixture);
        await audit(fixture.request + fixture.completion);
        expect(await read()).toBe("READY");
      },
    );

    it("preserves a genuinely legacy embedded review", async () => {
      await audit(
        reviewAudit("REVIEW_COMPLETED", {
          Stage: "functional-design",
          Unit: "unit-alpha",
          Verdict: "NOT-READY",
        }),
      );
      expect(await read()).toBe("NOT-READY");
    });

    it.each(["directory", "shard"])(
      "withholds all verdicts when the audit %s is unreadable, then recovers",
      async (unreadable) => {
        await writeFile(
          path.join(record, "construction/unit-alpha/functional-design/design.md"),
          "## Review\n**Verdict:** READY\n",
        );
        const fixture = reviewFixture({ unit: "unit-beta" });
        await mkdir(path.join(record, "construction/unit-beta/functional-design"), {
          recursive: true,
        });
        await save(fixture);
        await audit(fixture.request + fixture.completion);
        expect(await read()).toBe("READY");
        const auditDir = path.join(record, "audit");
        if (unreadable === "directory") {
          await rm(auditDir, { recursive: true });
          await writeFile(auditDir, "not a readable audit directory");
        } else {
          await mkdir(path.join(auditDir, "unreadable.md"));
        }
        const snapshot = await readReviewVerdicts(record);
        expect(snapshot.unavailable).toBe(true);
        expect(snapshot.cells.has(reviewCellKey("unit-alpha", "functional-design"))).toBe(false);
        expect(await read()).toBeNull();
        const matrix = expectOk(await buildMatrix(record, ["functional-design"])).value;
        expect(matrix.cells.map((cell) => cell.verdict)).toEqual([null, null]);
        expect(matrix.cells.find((cell) => cell.unit === "unit-alpha")?.files).toEqual([
          "design.md",
        ]);

        if (unreadable === "directory") {
          await rm(auditDir);
          await mkdir(auditDir);
        } else {
          await rm(path.join(auditDir, "unreadable.md"), { recursive: true });
        }
        await audit(fixture.request + fixture.completion);
        expect(
          expectOk(await buildMatrix(record, ["functional-design"])).value.cells.map(
            (cell) => cell.verdict,
          ),
        ).toEqual(["READY", "READY"]);
      },
    );

    it("preserves a legacy verdict when the audit directory has never been created", async () => {
      await rm(path.join(record, "audit"), { recursive: true });
      expect((await readReviewVerdicts(record)).unavailable).toBe(false);
      expect(await read()).toBe("NOT-READY");
    });

    it("does not inherit a stage-level or another unit's review", async () => {
      const stage = reviewFixture({ unit: null });
      const other = reviewFixture({ unit: "unit-beta", id: "b" });
      await save(stage);
      await save(other);
      await audit(stage.request + stage.completion + other.request + other.completion);
      expect(await read()).toBe("NOT-READY");
    });

    it.each(["digest", "malformed", "scope", "attempt", "findings"])(
      "clears a modern review whose JSON is %s without resurrecting legacy text",
      async (kind) => {
        const fixture = reviewFixture();
        let bytes = fixture.bytes;
        if (kind === "digest") bytes += " ";
        if (kind === "malformed") bytes = "{";
        if (kind === "scope") bytes = JSON.stringify({ ...fixture.record, unit: "unit-beta" });
        if (kind === "attempt")
          bytes = JSON.stringify({ ...fixture.record, attempt: "b".repeat(16) });
        if (kind === "findings")
          bytes = JSON.stringify({ ...fixture.record, findings: [{ id: "bad" }] });
        await save({ ...fixture, bytes });
        const fields = { ...fixture.completionFields };
        if (kind !== "digest")
          fields["Review Record Digest"] =
            `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        await audit(fixture.request + reviewAudit("REVIEW_COMPLETED", fields, 2));
        expect(await read()).toBeNull();
      },
    );

    // v2.11.0 reviewRecordNotHere: relaxed and off keep the recorded verdict of a
    // review whose written record is simply not in this checkout.
    describe("a completion whose review record is not here", () => {
      const strict = async () =>
        writeFile(path.join(record, "aidlc-state.md"), "- **Guard Policy**: strict (set by you)\n");

      it.each(["READY", "NOT-READY"] as const)(
        "uses the audit row's %s verdict under relaxed",
        async (verdict) => {
          const fixture = reviewFixture({ verdict });
          await audit(fixture.request + fixture.completion);
          expect(await read()).toBe(verdict);
        },
      );

      it("uses the audit row's verdict under off", async () => {
        await writeFile(path.join(record, "aidlc-state.md"), "- **Guard Policy**: off\n");
        const fixture = reviewFixture();
        await audit(fixture.request + fixture.completion);
        expect(await read()).toBe("READY");
      });

      it("keeps requiring the record under strict and when the policy cannot be read", async () => {
        const fixture = reviewFixture();
        await audit(fixture.request + fixture.completion);
        await strict();
        expect(await read()).toBeNull();
        await writeFile(path.join(record, "aidlc-state.md"), "- **Guard Policy**: unknown\n");
        expect(await read()).toBeNull();
      });

      it("still rejects a record that is here but does not match its digest", async () => {
        const fixture = reviewFixture();
        await save({ ...fixture, bytes: `${fixture.bytes} ` });
        await audit(fixture.request + fixture.completion);
        expect(await read()).toBeNull();
      });

      it("never accepts a completion that does not match its request", async () => {
        const fixture = reviewFixture();
        await audit(
          fixture.request +
            reviewAudit(
              "REVIEW_COMPLETED",
              { ...fixture.completionFields, "Request Fingerprint": `sha256:${"b".repeat(64)}` },
              2,
            ),
        );
        expect(await read()).toBeNull();
      });

      it("treats a symlink on the record's path as present, not absent", async () => {
        const fixture = reviewFixture();
        const container = path.join(record, fixture.relative.split("/")[0] as string);
        await symlink(path.join(root, "missing-target"), container, "junction");
        await audit(fixture.request + fixture.completion);
        expect(await read()).toBeNull();
      });

      it("treats a path through a regular file like the engine does on this OS", async () => {
        const fixture = reviewFixture();
        await writeFile(path.join(record, fixture.relative.split("/")[0] as string), "a file");
        await audit(fixture.request + fixture.completion);
        // POSIX reports ENOTDIR (present); Windows reports ENOENT, which the
        // engine's reviewRecordAbsent also reads as absent there.
        expect(await read()).toBe(process.platform === "win32" ? "READY" : null);
      });
    });

    // v2.11.1 reviewCompletionDidNotFinish: the NOT-READY the engine records
    // when a retried review wrote nothing is no reviewer's verdict.
    describe("a review that did not finish", () => {
      it.each([
        ["marked Review Finished: no", { finished: "no" }],
        ["recorded before the field with an empty body", { body: "" }],
        ["marked no with an empty body", { finished: "no", body: "" }],
      ])("shows no verdict for a NOT-READY %s", async (_, options) => {
        const fixture = reviewFixture({ verdict: "NOT-READY", ...options });
        await save(fixture);
        await audit(fixture.request + fixture.completion);
        expect(await read()).toBeNull();
      });

      it.each([
        ["a reviewer's NOT-READY with a body", "NOT-READY", { finished: undefined, body: "## Review\n" }],
        ["an empty body marked Review Finished: yes", "NOT-READY", { finished: "yes", body: "" }],
        ["a READY marked Review Finished: no", "READY", { finished: "no", body: "" }],
      ] as const)("keeps %s", async (_, verdict, options) => {
        const fixture = reviewFixture({ verdict, ...options });
        await save(fixture);
        await audit(fixture.request + fixture.completion);
        expect(await read()).toBe(verdict);
      });

      it("reads the marker, not the body, when the record is not on this machine", async () => {
        const marked = reviewFixture({ verdict: "NOT-READY", finished: "no" });
        await audit(marked.request + marked.completion);
        expect(await read()).toBeNull();
        // Without the marker an absent record cannot show an empty body.
        const unmarked = reviewFixture({ verdict: "NOT-READY", body: "" });
        await audit(unmarked.request + unmarked.completion);
        expect(await read()).toBe("NOT-READY");
      });

      it("consumes its request, so a replayed completion cannot substitute a verdict", async () => {
        const unfinished = reviewFixture({ verdict: "NOT-READY", finished: "no" });
        const replay = reviewFixture();
        await save(unfinished);
        await audit(
          unfinished.request +
            unfinished.completion +
            reviewAudit("REVIEW_COMPLETED", replay.completionFields, 3),
        );
        expect(await read()).toBeNull();
      });

      it("gives way to the next finished review", async () => {
        const unfinished = reviewFixture({ verdict: "NOT-READY", finished: "no" });
        const next = reviewFixture({ id: "b", iteration: 2, second: 3 });
        await save(unfinished);
        await save(next);
        await audit(unfinished.request + unfinished.completion + next.request + next.completion);
        expect(await read()).toBe("READY");
      });
    });

    it("does not read orphan JSON without a paired request and completion", async () => {
      const fixture = reviewFixture();
      await save(fixture);
      expect(await read()).toBeNull();
      await audit(fixture.completion);
      expect(await read()).toBeNull();
    });

    it.each(["verdict", "reference", "digest"])(
      "does not consume the request on a malformed %s before a valid completion",
      async (kind) => {
        const fixture = reviewFixture();
        await save(fixture);
        const fields = { ...fixture.completionFields };
        if (kind === "verdict") fields.Verdict = "invalid" as "READY";
        if (kind === "reference") fields["Review Record"] = "bad.json";
        if (kind === "digest") fields["Review Record Digest"] = `sha256:${"b".repeat(64)}`;
        await audit(
          fixture.request +
            reviewAudit("REVIEW_COMPLETED", fields, 2) +
            reviewAudit("REVIEW_COMPLETED", fixture.completionFields, 3),
        );
        expect(await read()).toBe("READY");
      },
    );

    it("pairs Request Id, leaving a newer pending attempt empty even if an old completion arrives late", async () => {
      const previous = reviewFixture();
      const next = reviewFixture({ id: "b", attempt: "b".repeat(16), second: 3 });
      await save(previous);
      await save(next);
      await audit(previous.request + previous.completion + next.request);
      expect(await read()).toBeNull();
      await audit(
        previous.request +
          next.request +
          reviewAudit("REVIEW_COMPLETED", previous.completionFields, 4),
      );
      expect(await read()).toBeNull();
      await audit(previous.request + previous.completion + next.request + next.completion);
      expect(await read()).toBe("READY");
    });

    it.each(["STAGE_STARTED", "GATE_REJECTED", "WORKFLOW_STARTED", "STAGE_JUMPED"])(
      "invalidates the prior verdict after %s",
      async (event) => {
        const fixture = reviewFixture();
        await save(fixture);
        await audit(
          fixture.request +
            fixture.completion +
            reviewAudit(event, { Stage: "functional-design", "Attempt Generation": "2" }, 3),
        );
        expect(await read()).toBeNull();
      },
    );

    // v2.11.0 stageJumpReaches: a jump resets its Target and every later stage.
    describe("a STAGE_JUMPED row's reach", () => {
      const order = ["units-generation", "functional-design", "code-generation"];
      beforeEach(async () => {
        await writeFile(
          path.join(record, "aidlc-state.md"),
          stateWithStages(order, "- **Change Control**: relaxed (set by you)"),
        );
      });

      it.each([
        ["a later stage", "code-generation", "READY", []],
        ["the stage itself", "functional-design", null, ["unit-alpha"]],
        ["an earlier stage", "units-generation", null, ["unit-alpha"]],
        ["a stage the graph does not know", "unknown-stage", null, ["unit-alpha"]],
      ])("keeps the verdict only when a jump to %s does not reach it", async (_, target, verdict, units) => {
        const fixture = reviewFixture();
        await save(fixture);
        await audit(fixture.request + fixture.completion);
        const changed = path.join(record, "audit", "jump-clone.md");
        await writeFile(changed, reviewAudit("STAGE_JUMPED", { Target: target }, 3));
        expect(await read()).toBe(verdict);
        expect(await reviewUnitsInAuditShard(record, changed)).toEqual(units);
      });

      it("keeps a pending request open across a jump that does not reach it", async () => {
        const fixture = reviewFixture();
        await save(fixture);
        await audit(
          fixture.request +
            reviewAudit("STAGE_JUMPED", { Target: "code-generation" }, 2) +
            reviewAudit("REVIEW_COMPLETED", fixture.completionFields, 3),
        );
        expect(await read()).toBe("READY");
      });

      it("reaches every stage when the state gives no graph order", async () => {
        await configureIteration("stage-major");
        const fixture = reviewFixture();
        await save(fixture);
        await audit(
          fixture.request +
            fixture.completion +
            reviewAudit("STAGE_JUMPED", { Target: "code-generation" }, 3),
        );
        expect(await read()).toBeNull();
      });
    });

    it("keeps a different unit's scoped rejection separate", async () => {
      const fixture = reviewFixture();
      await save(fixture);
      await audit(
        fixture.request +
          fixture.completion +
          reviewAudit("GATE_REJECTED", { Stage: "functional-design", Unit: "unit-beta" }, 3),
      );
      expect(await read()).toBe("READY");
    });

    it.each(["completed", "pending"])(
      "preserves unit-major %s reviews across a synthesized stage start",
      async (state) => {
        await configureIteration("unit-major");
        const design = reviewFixture();
        const other = reviewFixture({ unit: "unit-beta", id: "b" });
        for (const fixture of [design, other]) await save(fixture);
        await audit(
          [design, other]
            .map((fixture) => fixture.request + (state === "completed" ? fixture.completion : ""))
            .join(""),
        );
        const changed = path.join(record, "audit", "stage-clone.md");
        await writeFile(changed, reviewAudit("STAGE_STARTED", { Stage: "functional-design" }, 3));
        const expected = new Map([
          [
            reviewCellKey("unit-alpha", "functional-design"),
            state === "completed" ? "READY" : null,
          ],
          [reviewCellKey("unit-beta", "functional-design"), state === "completed" ? "READY" : null],
        ]);
        expect((await readReviewVerdicts(record)).cells).toEqual(expected);
        expect(await reviewUnitsInAuditShard(record, changed)).toEqual([]);
        if (state === "pending") {
          await writeFile(
            path.join(record, "audit", "late-clone.md"),
            [design, other]
              .map((fixture) => reviewAudit("REVIEW_COMPLETED", fixture.completionFields, 4))
              .join(""),
          );
          expect(await read()).toBe("READY");
        }
      },
    );

    it("still resets stage-major reviews and notifies their units on stage start", async () => {
      const fixture = reviewFixture();
      await save(fixture);
      await audit(fixture.request + fixture.completion);
      const changed = path.join(record, "audit", "stage-clone.md");
      await writeFile(changed, reviewAudit("STAGE_STARTED", { Stage: "functional-design" }, 3));
      expect(await read()).toBeNull();
      expect(await reviewUnitsInAuditShard(record, changed)).toEqual(["unit-alpha"]);
    });

    it.each(["completed", "pending"])(
      "resets only the named Bolt units' %s reviews across all stages",
      async (state) => {
        await configureIteration("unit-major");
        const design = reviewFixture();
        const code = reviewFixture({ stage: "code-generation", id: "b" });
        const other = reviewFixture({ unit: "unit-beta", id: "c" });
        for (const fixture of [design, code, other]) await save(fixture);
        await audit(
          [design, code]
            .map((fixture) => fixture.request + (state === "completed" ? fixture.completion : ""))
            .join("") +
            other.request +
            other.completion,
        );
        const changed = path.join(record, "audit", "bolt-clone.md");
        await writeFile(
          changed,
          reviewAudit("BOLT_STARTED", { "Bolt names": " unit-alpha, unit-gamma " }, 3),
        );
        const expected = new Map([
          [reviewCellKey("unit-alpha", "functional-design"), null],
          [reviewCellKey("unit-alpha", "code-generation"), null],
          [reviewCellKey("unit-beta", "functional-design"), "READY"],
        ]);
        expect((await readReviewVerdicts(record)).cells).toEqual(expected);
        expect(await reviewUnitsInAuditShard(record, changed)).toEqual(["unit-alpha"]);

        await writeFile(
          path.join(record, "audit", "late-clone.md"),
          [design, code]
            .map((fixture) => reviewAudit("REVIEW_COMPLETED", fixture.completionFields, 4))
            .join(""),
        );
        expect((await readReviewVerdicts(record)).cells).toEqual(expected);

        const next = reviewFixture({ id: "d", attempt: "d".repeat(16), second: 5 });
        await save(next);
        await writeFile(
          path.join(record, "audit", "fresh-clone.md"),
          next.request + next.completion,
        );
        expect(await read()).toBe("READY");
      },
    );

    it.each(["completed", "pending"])(
      "resets %s reviews for every Gate Stages entry in only the rejected unit",
      async (state) => {
        await configureIteration("unit-major");
        const design = reviewFixture();
        const code = reviewFixture({ stage: "code-generation", id: "b" });
        const otherUnit = reviewFixture({ unit: "unit-beta", id: "c" });
        const otherStage = reviewFixture({ stage: "nfr-requirements", id: "d" });
        for (const fixture of [design, code, otherUnit, otherStage]) await save(fixture);
        await audit(
          [design, code]
            .map((fixture) => fixture.request + (state === "completed" ? fixture.completion : ""))
            .join("") +
            [otherUnit, otherStage].map((fixture) => fixture.request + fixture.completion).join(""),
        );
        const changed = path.join(record, "audit", "gate-clone.md");
        await writeFile(
          changed,
          reviewAudit(
            "GATE_REJECTED",
            {
              Stage: "nfr-requirements",
              "Gate Stages": " functional-design, code-generation ",
              Unit: "unit-alpha",
            },
            3,
          ),
        );
        const expected = new Map([
          [reviewCellKey("unit-alpha", "functional-design"), null],
          [reviewCellKey("unit-alpha", "code-generation"), null],
          [reviewCellKey("unit-beta", "functional-design"), "READY"],
          [reviewCellKey("unit-alpha", "nfr-requirements"), "READY"],
        ]);
        expect((await readReviewVerdicts(record)).cells).toEqual(expected);
        expect(await reviewUnitsInAuditShard(record, changed)).toEqual(["unit-alpha"]);

        await writeFile(
          path.join(record, "audit", "late-clone.md"),
          [design, code]
            .map((fixture) => reviewAudit("REVIEW_COMPLETED", fixture.completionFields, 4))
            .join(""),
        );
        expect((await readReviewVerdicts(record)).cells).toEqual(expected);
      },
    );

    it("requests full invalidation when a reset's audit snapshot is unreadable", async () => {
      await audit(reviewAudit("BOLT_STARTED", { "Bolt names": "unit-alpha" }, 3));
      await mkdir(path.join(record, "audit", "unreadable.md"));
      expect(
        await reviewUnitsInAuditShard(record, path.join(record, "audit", "clone.md")),
      ).toBeNull();
    });

    it.each([
      ["BOLT_STARTED", "a-boundary.md"],
      ["BOLT_STARTED", "z-boundary.md"],
      ["GATE_REJECTED", "a-boundary.md"],
      ["GATE_REJECTED", "z-boundary.md"],
    ])("rejects reviews tied with %s in another shard (%s)", async (event, shard) => {
      await configureIteration("unit-major");
      const fixture = reviewFixture();
      const other = reviewFixture({ unit: "unit-beta", id: "b" });
      await save(fixture);
      await save(other);
      await audit(
        [fixture, other]
          .map(
            (value) => value.request + reviewAudit("REVIEW_COMPLETED", value.completionFields, 1),
          )
          .join(""),
      );
      await writeFile(
        path.join(record, "audit", shard),
        reviewAudit(event, {
          "Bolt names": "unit-alpha",
          "Gate Stages": "functional-design, code-generation",
          Unit: "unit-alpha",
        }),
      );
      expect((await readReviewVerdicts(record)).cells).toEqual(
        new Map([
          [reviewCellKey("unit-alpha", "functional-design"), null],
          [reviewCellKey("unit-beta", "functional-design"), "READY"],
        ]),
      );
    });

    it.each(["a-request.md", "z-request.md"])(
      "refuses same-time request/completion pairs across shards when the request is in %s",
      async (requestShard) => {
        const fixture = reviewFixture();
        await save(fixture);
        await writeFile(path.join(record, "audit", requestShard), fixture.request);
        await writeFile(
          path.join(record, "audit", "m-completion.md"),
          reviewAudit("REVIEW_COMPLETED", fixture.completionFields, 1),
        );
        expect(await read()).toBeNull();
      },
    );

    it("accepts a later completion from a different shard", async () => {
      const fixture = reviewFixture();
      await save(fixture);
      await writeFile(path.join(record, "audit", "z-request.md"), fixture.request);
      await writeFile(path.join(record, "audit", "a-completion.md"), fixture.completion);
      expect(await read()).toBe("READY");
    });

    it.each([true, false])(
      "uses physical row order for same-time pairs in one shard (request first: %s)",
      async (requestFirst) => {
        const fixture = reviewFixture();
        await save(fixture);
        const completion = reviewAudit("REVIEW_COMPLETED", fixture.completionFields, 1);
        await audit(requestFirst ? fixture.request + completion : completion + fixture.request);
        expect(await read()).toBe(requestFirst ? "READY" : null);
      },
    );

    it("ignores isolated workflow approvals and refuses duplicate completion fields", async () => {
      const fixture = reviewFixture();
      await save(fixture);
      await audit(
        fixture.request +
          fixture.completion.replace(
            "**Verdict**: READY",
            "**Verdict**: READY\n**Verdict**: NOT-READY",
          ),
      );
      expect(await read()).toBeNull();
      await audit(
        [fixture.request, fixture.completion]
          .map((text) => `${text}**Workflow**: single-stage:functional-design\n`)
          .join(""),
      );
      expect(await read()).toBeNull();
    });

    it.each([
      "../outside.json",
      ".aidlc-reviews/functional-design/units/unit-alpha/../../../../../outside.json",
      "C:/outside.json",
      ".aidlc-reviews\\functional-design\\units\\unit-alpha\\aaaaaaaaaaaaaaaa\\1.json",
    ])("rejects an escaping or noncanonical record path %s", async (relative) => {
      const fixture = reviewFixture();
      await writeFile(path.join(root, "outside.json"), fixture.bytes);
      await audit(
        fixture.request +
          reviewAudit(
            "REVIEW_COMPLETED",
            { ...fixture.completionFields, "Review Record": relative },
            2,
          ),
      );
      expect(await read()).toBeNull();
    });

    it("rejects a symlinked container and hardlinked record", async () => {
      const fixture = reviewFixture();
      const outside = path.join(root, "outside");
      await mkdir(outside);
      await symlink(
        outside,
        path.join(record, directory === ".aidlc-reviews" ? directory : ".aidlc-engine"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await save(fixture);
      await audit(fixture.request + fixture.completion);
      expect(await read()).toBeNull();
      await rm(path.join(record, directory === ".aidlc-reviews" ? directory : ".aidlc-engine"));
      const file = await save(fixture);
      await link(file, path.join(root, "hardlink.json"));
      expect(await read()).toBeNull();
    });
  },
);

describe("team unit local audit record", () => {
  let root: string;
  let record: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "guide-local-audit-"));
    record = path.join(root, "aidlc", "spaces", "default", "intents", "review-12345678");
    await mkdir(path.join(record, "construction", "unit-alpha", "functional-design"), {
      recursive: true,
    });
    await mkdir(path.join(record, "audit"), { recursive: true });
    await writeFile(
      path.join(record, "aidlc-state.md"),
      "## Scope Configuration\n- **Change Control**: relaxed (set by you)\n\n## Runtime State\n- **Construction Iteration**: stage-major\n",
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads each row once and the unit of a review appended to the local shard", async () => {
    const fixture = createReviewFixture();
    const saved = path.join(record, fixture.relative);
    await mkdir(path.dirname(saved), { recursive: true });
    await writeFile(saved, fixture.bytes);
    const header = "# AI-DLC Audit Log\n";
    const neutral = (event: string, second: number) =>
      `**Timestamp**: 2026-11-05T00:00:0${second}Z\n**Event**: ${event}\n`;
    const copiedA = neutral("COPIED_A", 3);
    const copiedB = neutral("COPIED_B", 4);
    const trackedOnly = neutral("TRACKED_ONLY", 5);
    const request = fixture.request.replace(/^---\n/, "");
    const completion = fixture.completion.replace(/^---\n/, "");
    await mkdir(path.join(record, ".aidlc-engine", "audit"), { recursive: true });
    await writeFile(
      path.join(record, "audit", "clone.md"),
      [header + copiedA, copiedB, trackedOnly].join("\n---\n"),
    );
    const localPath = path.join(record, ".aidlc-engine", "audit", "clone.md");
    await writeFile(
      localPath,
      [header + request, copiedA, copiedB, completion].join("\n---\n"),
    );

    const { value, warnings } = expectOk(await readAllAuditEvents(record));
    expect(warnings).toBeUndefined();
    expect(value.map((event) => [event.event, event.shard])).toEqual([
      ["TRACKED_ONLY", "clone.md"],
      ["COPIED_B", ".aidlc-engine/audit/clone.md"],
      ["COPIED_A", ".aidlc-engine/audit/clone.md"],
      ["REVIEW_COMPLETED", ".aidlc-engine/audit/clone.md"],
      ["REVIEW_REQUESTED", ".aidlc-engine/audit/clone.md"],
    ]);
    expect(
      expectOk(await buildMatrixForUnit(record, "unit-alpha", ["functional-design"])).value[0]
        ?.verdict,
    ).toBe("READY");

    await appendFile(
      localPath,
      `\n${reviewAudit("REVIEW_REQUESTED", { Stage: "functional-design", Unit: "unit-beta" }, 9)}`,
    );
    expect(await reviewUnitsInAuditShard(record, localPath)).toEqual(["unit-alpha", "unit-beta"]);
  });

  it.each([
    [".aidlc-engine", "plan.json"],
    [".aidlc-engine/audit", "notes.txt"],
    [".aidlc-engine/other", "clone.md"],
    ["not-audit/audit", "clone.md"],
  ])("ignores %s/%s as an audit shard path", async (directory, name) => {
    expect(await reviewUnitsInAuditShard(record, path.join(record, directory, name))).toBeNull();
  });

  it("treats an unreadable local audit directory as an unreadable snapshot", async () => {
    await writeFile(
      path.join(record, "audit", "clone.md"),
      reviewAudit("BOLT_STARTED", { "Bolt names": "unit-alpha" }, 3),
    );
    // A path through a file is ENOENT on Windows, so the directory itself is replaced by a file.
    await mkdir(path.join(record, ".aidlc-engine"), { recursive: true });
    await writeFile(path.join(record, ".aidlc-engine", "audit"), "not a directory");
    expect((await readReviewVerdicts(record)).unavailable).toBe(true);
    expect(
      await reviewUnitsInAuditShard(record, path.join(record, "audit", "clone.md")),
    ).toBeNull();
  });

  it("treats a shard symlink that leaves the record as an unreadable snapshot", async () => {
    const outside = path.join(root, "outside.md");
    await writeFile(
      outside,
      reviewAudit("REVIEW_REQUESTED", { Stage: "functional-design", Unit: "unit-alpha" }),
    );
    await symlink(outside, path.join(record, "audit", "link.md"));
    expect((await readReviewVerdicts(record)).unavailable).toBe(true);
  });

  it("marks the snapshot unavailable when a local shard cannot be read", async () => {
    await mkdir(path.join(record, ".aidlc-engine", "audit", "bad.md"), { recursive: true });
    await writeFile(
      path.join(record, "audit", "clone.md"),
      reviewAudit("REVIEW_REQUESTED", {
        Stage: "functional-design",
        Unit: "unit-alpha",
      }),
    );
    expect((await readReviewVerdicts(record)).unavailable).toBe(true);
    expect(
      await reviewUnitsInAuditShard(
        record,
        path.join(record, ".aidlc-engine", "audit", "bad.md"),
      ),
    ).toBeNull();
  });
});
