import type { AuditEvent } from "@andon/shared-types";
import { describe, expect, it } from "vitest";
import { isWorkObservation } from "../src/timing/policy.ts";

const event = (name: string, workflow: string | null = null): AuditEvent => ({
  event: name,
  stage: "code-generation",
  timestamp: "2026-10-01T00:00:00Z",
  shard: "a.md",
  workflow,
});

describe("work observations", () => {
  // v2.11.0 VALID_EVENT_TYPES adds UNIT_SKIPPED (a Unit lifecycle receipt) and
  // QUESTION_REPLIED (the person's reply to a question asked in the chat).
  it.each(["UNIT_SKIPPED", "QUESTION_REPLIED", "UNIT_COMPLETED", "QUESTION_ANSWERED"])(
    "counts %s as work",
    (name) => {
      expect(isWorkObservation(event(name))).toBe(true);
    },
  );

  it.each([
    "QUESTION_UNANSWERED",
    "CONSTRUCTION_POLICY_SET",
    "PLAN_APPROVAL_SKIPPED",
    "REQUEST_ROUTED",
    "SUBAGENT_PROMPT_UNMATCHED",
    "COORDINATION_STOOD_ASIDE",
    "SCOPE_SAVED",
    "WORKSPACE_RECLASSIFIED",
  ])("does not let the background receipt %s shorten an idle gap", (name) => {
    expect(isWorkObservation(event(name))).toBe(false);
  });

  it("counts a human turn only when it names its workflow", () => {
    expect(isWorkObservation(event("HUMAN_TURN"))).toBe(false);
    expect(isWorkObservation(event("HUMAN_TURN", "main"))).toBe(true);
  });
});
