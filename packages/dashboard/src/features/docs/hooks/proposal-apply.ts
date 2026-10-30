import type { CustomizationDiagnostic, CustomizationProposal } from "@andon/shared-types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CustomizationError,
  customizationApi,
  customizationRequestId,
} from "@/services/customization";

export type ProposalApply =
  | { status: "applying" }
  | { status: "applied"; message: string }
  | {
      status: "failed";
      message: string;
      diagnostics: CustomizationDiagnostic[];
      /** The save may have gone through; the customization page shows the outcome. */
      uncertain?: boolean;
    };

const POLL_MS = 750;
const POLL_LIMIT = 80;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Applies a chat proposal through the regular customization save, keyed by
 * the turn that proposed it. A proposal is applied at most once.
 */
export function useProposalApply() {
  const [results, setResults] = useState<Record<string, ProposalApply>>({});
  const live = useRef(true);
  const pending = useRef(new Set<string>());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const record = useCallback((turnId: string, result: ProposalApply) => {
    if (live.current) setResults((previous) => ({ ...previous, [turnId]: result }));
  }, []);

  const apply = useCallback(
    async (turnId: string, proposal: CustomizationProposal): Promise<void> => {
      if (!proposal.canApply || pending.current.has(turnId)) return;
      pending.current.add(turnId);
      record(turnId, { status: "applying" });
      // Once the save is accepted, a later failure leaves its outcome unknown.
      let accepted = false;
      try {
        let operation = await customizationApi.save({
          requestId: customizationRequestId(),
          spaceId: proposal.spaceId,
          expectedConfigurationRevision: proposal.configurationRevision,
          changes: proposal.changes,
        });
        accepted = true;
        for (let poll = 0; operation.status === "running" && poll < POLL_LIMIT; poll += 1) {
          await wait(POLL_MS);
          operation = await customizationApi.operation(operation.id);
        }
        if (operation.status === "completed")
          record(turnId, {
            status: "applied",
            message: operation.message ?? "設定を保存しました。",
          });
        else
          record(turnId, {
            status: "failed",
            message:
              operation.error?.message ??
              operation.message ??
              (operation.status === "running"
                ? "保存の結果を確認できません。カスタマイズ画面で状態を確認してください。"
                : "設定を保存できませんでした。"),
            diagnostics: [],
            ...(operation.status === "running" ? { uncertain: true } : {}),
          });
      } catch (cause) {
        if (accepted) {
          record(turnId, {
            status: "failed",
            message: "保存の結果を確認できません。カスタマイズ画面で状態を確認してください。",
            diagnostics: [],
            uncertain: true,
          });
          return;
        }
        const changed =
          cause instanceof CustomizationError && cause.reason === "configuration-changed";
        record(turnId, {
          status: "failed",
          message: changed
            ? "提案のあとに設定が変わりました。最新の設定で、もう一度 AI に依頼してください。"
            : cause instanceof Error
              ? cause.message
              : "設定を保存できませんでした。",
          diagnostics: cause instanceof CustomizationError ? (cause.diagnostics ?? []) : [],
          ...(cause instanceof CustomizationError && cause.reason === "response-unknown"
            ? { uncertain: true }
            : {}),
        });
      } finally {
        // A failed attempt may be retried; a finished one keeps its result.
        pending.current.delete(turnId);
      }
    },
    [record],
  );

  const clear = useCallback(() => {
    if (pending.current.size === 0) setResults({});
  }, []);

  return { results, apply, clear };
}

export type ProposalApplyState = ReturnType<typeof useProposalApply>;
