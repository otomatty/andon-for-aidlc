import { Badge } from "@mantine/core";
import type { StageStatus } from "@andon/shared-types";
import type { ReactNode } from "react";

/** BR-UI-2 / US-18: colour + symbol + text label, all three in the DOM. */

export type ChipStatus = StageStatus | "unparseable";

export interface StatusPresentation {
  token: string;
  symbol: string;
  label: string;
}

export const STATUS_PRESENTATION: Readonly<Record<ChipStatus, StatusPresentation>> = {
  completed: { token: "--color-status-done", symbol: "✔", label: "completed" },
  "in-progress": { token: "--color-status-progress", symbol: "◐", label: "in progress" },
  "awaiting-approval": { token: "--color-status-gate", symbol: "◔", label: "awaiting approval" },
  revising: { token: "--color-status-revising", symbol: "◑", label: "revising" },
  "not-started": { token: "--color-status-idle", symbol: "○", label: "not started" },
  skipped: { token: "--color-status-skip", symbol: "⊘", label: "skipped" },
  unparseable: { token: "--destructive", symbol: "⚠", label: "unparseable" },
};

export const CHIP_STATUSES = Object.keys(STATUS_PRESENTATION) as ChipStatus[];

/**
 * Mantine's light Badge in the status colour. The token stays the one source:
 * the text is the token and the tint is 10% of it, so each token is chosen to
 * read at 4.5:1 on that tint (globals.css).
 */
export function StatusChip({ status }: { status: ChipStatus }): ReactNode {
  const { token, symbol, label } = STATUS_PRESENTATION[status];
  return (
    <Badge
      component="span"
      variant="light"
      color={`var(${token})`}
      className="chip"
      data-status={status}
      data-token={token}
      leftSection={
        <span className="chip__symbol" aria-hidden="true">
          {symbol}
        </span>
      }
    >
      <span className="chip__label">{label}</span>
    </Badge>
  );
}
