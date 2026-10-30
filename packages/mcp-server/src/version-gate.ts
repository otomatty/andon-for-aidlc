import { inspectVersionGate } from "@aidlc-guide/reader-core";
import { type VersionGate, WORKFLOWS_TARGET_VERSION } from "@aidlc-guide/shared-types";
import { type ToolReply, toContent } from "./render.ts";

/**
 * The MCP half of the version check (docs/maintenance/version-gate-design.md).
 * Every tool, the bundled-docs ones included, answers with the update notice
 * while the project or this machine's engine does not match the Guide's
 * supported release. The reply is an ordinary one, not `isError`: the AI can
 * relay it and stop instead of retrying (BR-MS-3).
 */

export type GateCheck = () => VersionGate | null;

export function workspaceGate(workspaceRoot: string): GateCheck {
  return () => inspectVersionGate(workspaceRoot, WORKFLOWS_TARGET_VERSION);
}

export function versionGateReply(gate: VersionGate): ToolReply {
  return {
    text:
      `Andon はこのプロジェクトでは使えません。${gate.message}` +
      "VS Code / Cursor で Andon を開くと、更新画面に必要な操作が表示されます。" +
      "更新が終わるまで、この結果を利用者に伝え、ツールを再試行しないでください。",
    degraded: { kind: "unsupported", detail: "version-gate" },
  };
}

type Content = { content: { type: "text"; text: string }[] };

/** Wrap one tool handler so it runs only when the check passes. */
export function gated<A extends unknown[]>(
  check: GateCheck,
  handler: (...args: A) => Promise<Content>,
): (...args: A) => Promise<Content> {
  return async (...args: A) => {
    let gate: VersionGate | null;
    try {
      gate = check();
    } catch {
      // An unreadable workspace must fail closed, not open the tools.
      return toContent({
        text: "Andon はこのプロジェクトのバージョンを確認できませんでした。VS Code / Cursor で Andon を開いて確認してください。",
        degraded: { kind: "unsupported", detail: "version-gate" },
      });
    }
    if (gate !== null && gate.status !== "ok") return toContent(versionGateReply(gate));
    return handler(...args);
  };
}
