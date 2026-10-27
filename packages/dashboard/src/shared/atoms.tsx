import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { STATUS_PRESENTATION } from "@/shared/ui/StatusChip.tsx";

/**
 * Cross-cutting feedback pieces built on the shared/ui parts.
 */

/** R-UI-2: degradation always shows up as an element. */
export function UnparseableBadge({ detail }: { detail: string }): ReactNode {
  const { symbol, label } = STATUS_PRESENTATION.unparseable;
  return (
    <Badge
      variant="destructive"
      role="status"
      className="h-auto max-w-full items-start whitespace-normal wrap-anywhere"
    >
      <span className="shrink-0" aria-hidden="true">
        {symbol}
      </span>
      <span>
        解析不可（{label}）: {detail}
      </span>
    </Badge>
  );
}

export function EmptyState({
  hint,
  children,
  showCreateHint = true,
  title = "ワークフローはまだありません",
}: {
  hint: string;
  children?: ReactNode;
  /**
   * Suppresses the "create your first intent" paragraph — wrong wording when
   * an intent already exists (`state-missing`, spec §7-2 / §9). Defaults to
   * `true` so every other caller keeps today's copy unchanged.
   */
  showCreateHint?: boolean;
  title?: string;
}): ReactNode {
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{hint}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {showCreateHint ? (
          <p>
            `/aidlc`
            で最初のインテントを作成してください。既存のインテントは下の一覧で確認できます。
          </p>
        ) : null}
        {children}
      </EmptyContent>
    </Empty>
  );
}

export function AreaError({
  detail,
  onRetry,
}: {
  detail: string;
  onRetry?: () => void;
}): ReactNode {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>読み込みエラー</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
      {onRetry === undefined ? null : (
        <AlertAction>
          <Button type="button" variant="outline" size="sm" onClick={onRetry} data-testid="retry">
            再試行
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
