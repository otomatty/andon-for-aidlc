/** Moved to reader-core so the browser dashboard and MCP server share one detector. */
export {
  type DetectedHarness,
  detectHarnesses,
  HARNESS_LABELS,
  type HarnessDetectResult,
  type HarnessId,
} from "@andon/reader-core";
