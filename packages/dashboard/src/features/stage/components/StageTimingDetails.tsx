import { formatTimingDuration, type StageView, type TimingPolicy } from "@aidlc-guide/shared-types";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const REASONS: Readonly<Record<string, string>> = {
  "long-gap-excluded": "長いログ空白を除外しています。無ログの処理時間も含まれる可能性があります。",
  "unattributed-time": "他ステージの作業など、この実行に割り当てられない時間があります。",
  "unscoped-event": "対象ステージのない記録を、開始順から割り当てています。",
  "unit-scope-unavailable": "Unitの対象を確認できない時間があります。",
  "observation-scope-mismatch": "作業記録の対象をこの実行に対応付けられない時間があります。",
  "measurement-scope-mismatch": "待機・中断の対象をこの実行に対応付けられない時間があります。",
  "clock-order-ambiguous": "複数の記録の前後関係を確定できません。",
  "invalid-run-window": "開始・終了日時に矛盾があります。",
  "missing-boundary": "開始または終了の対応する記録がありません。",
  "activity-during-suspension": "中断中に作業記録があり、中断と作業の記録が矛盾しています。",
  "pending-wait-on-completed-run": "完了した実行に、終了を確認できない待機が残っています。",
  "audit-run-missing": "今回の実行に対応する監査ログがありません。",
  "audit-read-incomplete": "監査ログの一部を読み取れませんでした。",
  "recovered-boundary": "時計ずれを補正した境界のため、所要時間の実績には使いません。",
};

export function StageTimingDetails({
  view,
  policy,
  onOpenGuide,
}: {
  view: StageView | null;
  policy?: TimingPolicy;
  onOpenGuide: () => void;
}): ReactNode {
  const breakdown = view?.breakdown;
  const reasons = [
    ...new Set(
      (view?.quality?.reasons ?? []).map(
        (reason) =>
          REASONS[reason] ?? "記録の不足や対象の曖昧さがあるため、算出値に制約があります。",
      ),
    ),
  ];
  const rows = [
    ["開始からの経過", breakdown?.observedWallMs],
    ["作業時間", view?.elapsedActiveMs],
    ["承認待ち", breakdown?.approvalWaitMs],
    ["明示的な中断", breakdown?.suspendedMs],
    ["除外したログ空白", breakdown?.excludedGapMs],
    ["未分類の時間", breakdown?.pendingObservationMs],
    ["割り当てできない時間", breakdown?.unattributedMs],
  ] as const;
  return (
    <Card size="lg" data-testid="stage-timing-details">
      <CardHeader>
        <CardTitle>時間の内訳</CardTitle>
        <CardDescription>
          監査ログからの推定です。人の操作時間やAIの処理時間を直接計測した値ではありません。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid max-w-xl grid-cols-label-value text-sm">
          {rows.map(([label, ms]) => (
            <div className="contents" key={label}>
              <dt className="border-b py-2">{label}</dt>
              <dd className="border-b py-2 text-right font-bold tabular-nums">
                {formatTimingDuration(ms)}
              </dd>
            </div>
          ))}
        </dl>
        {view === null ? (
          <p className="text-sm text-muted-foreground">このステージの時間情報はまだありません。</p>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            {view.quality?.status === "incomplete" ? (
              <p>
                {view.elapsedActiveMs === null
                  ? "記録が不完全なため、作業時間は不明です。"
                  : "記録が不完全なため、判明した時間だけを表示しています。所要時間の実績には使いません。"}
              </p>
            ) : null}
            {view.quality?.status === "limited" ? (
              <p>記録に基づき、一部の時間を除外・推定しています。</p>
            ) : null}
            {reasons.length > 0 ? (
              <ul className="list-disc pl-5">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {view.running && view.sinceLastObservationMs != null ? (
              <p>
                最終記録から{formatTimingDuration(view.sinceLastObservationMs)}
                。この期間も「開始からの経過」に含み、作業時間には加えません。
                待機・中断・他ステージへの割り当てがない部分は「未分類の時間」に含むため、別途足す必要はありません。
              </p>
            ) : null}
            {view.running && view.elapsedActiveMs === 0 ? <p>作業区間の観測待ちです。</p> : null}
            <p>
              所要時間:{" "}
              {view.estimateMs === null ? "—" : `≈${formatTimingDuration(view.estimateMs)}`}
              {view.estimateMs !== null &&
              (view.status === "not-started" || view.status === "skipped")
                ? " (参考)"
                : null}
              。採用実績 {view.sampleCount}件・除外 {view.sampleExcludedCount ?? 0}件
              {view.basis === "phase"
                ? "（同じフェーズ）"
                : view.basis === "global"
                  ? "（同じスペース全体）"
                  : view.basis === "stage"
                    ? "（同じステージ）"
                    : ""}
            </p>
          </div>
        )}
        {(view?.sensitivity?.length ?? 0) > 0 ? (
          <div className="flex flex-col gap-2 text-sm">
            <h3 className="font-bold">区切り設定による変動幅</h3>
            <dl className="grid max-w-xl grid-cols-label-value overflow-hidden rounded-md border">
              {view?.sensitivity?.map((comparison) => (
                <div className="contents" key={comparison.thresholdMs}>
                  <dt className="border-b px-4 py-2.5">
                    {formatTimingDuration(comparison.thresholdMs)}で区切る
                    {comparison.thresholdMs === policy?.gapThresholdMs ? "（使用中）" : ""}
                  </dt>
                  <dd className="border-b px-4 py-2.5 text-right tabular-nums">
                    {formatTimingDuration(comparison.workMs)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              同じ記録の区切りを変えた比較です。実際の作業時間の上下限や信頼区間ではありません。
            </p>
          </div>
        ) : null}
        <Button variant="link" className="self-start" onClick={onOpenGuide}>
          算出方法を読む
        </Button>
      </CardContent>
    </Card>
  );
}
