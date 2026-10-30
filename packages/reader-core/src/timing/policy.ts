import type { AuditEvent, TimingPolicy } from "@andon/shared-types";

export const DEFAULT_TIMING_POLICY: TimingPolicy = Object.freeze({
  algorithmVersion: "session-gap-v2",
  gapThresholdMs: 20 * 60_000,
});

export const SENSITIVITY_THRESHOLDS_MS = [10, 20, 30].map((minutes) => minutes * 60_000);

/** Evidence of activity. Background receipts must never shorten an idle gap. */
const WORK_EVENTS = new Set([
  "STAGE_STARTED",
  "STAGE_COMPLETED",
  "ARTIFACT_CREATED",
  "ARTIFACT_UPDATED",
  "ARTIFACT_REUSED",
  "REVIEW_REQUESTED",
  "REVIEW_COMPLETED",
  "SENSOR_FIRED",
  "SENSOR_PASSED",
  "SENSOR_FAILED",
  "HUMAN_TURN",
  "SUBAGENT_COMPLETED",
  "PIPELINE_LINK_COMPLETED",
  "QUESTION_ANSWERED",
  "STAGE_REVISING",
  "UNIT_STARTED",
  "UNIT_COMPLETED",
  // v2.11.0: a Unit skipped by the person, and a reply to a chat question.
  "UNIT_SKIPPED",
  "QUESTION_REPLIED",
]);

export function isWorkObservation(event: AuditEvent): boolean {
  return WORK_EVENTS.has(event.event) && (event.event !== "HUMAN_TURN" || Boolean(event.workflow));
}

export function validateTimingPolicy(policy: TimingPolicy): void {
  if (
    policy.algorithmVersion !== "session-gap-v2" ||
    !Number.isFinite(policy.gapThresholdMs) ||
    policy.gapThresholdMs <= 0
  ) {
    throw new RangeError("Invalid stage timing policy");
  }
}
