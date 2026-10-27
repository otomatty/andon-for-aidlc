import { WHATS_NEW, type WhatsNewEntry } from "@aidlc-guide/shared-types";
import { type ReactNode, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { emitOnboardingEvent } from "@/services/onboarding.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { targetActions } from "../utils/target-actions.ts";

/** `2026-09-05` → `2026年9月5日`. */
export function formatEntryDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function Entry({
  entry,
  fresh,
  onAction,
}: {
  entry: WhatsNewEntry;
  fresh: boolean;
  onAction: (entry: WhatsNewEntry) => void;
}): ReactNode {
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5",
        fresh ? "mb-2 rounded-md bg-primary-light p-4" : "border-b py-4 last:border-b-0",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <time dateTime={entry.date}>{formatEntryDate(entry.date)}</time>
        {fresh ? <Badge variant="info">新着</Badge> : null}
      </div>
      <h4 className="text-base font-bold">{entry.title}</h4>
      <p className="text-sm leading-relaxed text-muted-foreground">{entry.body}</p>
      {entry.action === undefined ? null : (
        <div className="pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onAction(entry)}>
            {entry.action.label}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * 更新情報 — AIDLC Guide's own changes, newest first. Opening it is what
 * "seen" means: the new entries are recorded as seen right away, but keep
 * their 新着 badge until the sheet closes.
 */
export function WhatsNewSheet(): ReactNode {
  const { onboarding, workflow } = useAppState();
  const dispatch = useDispatch();
  const { open, fresh } = onboarding.whatsNew;
  const hasWorkflow = workflow.kind === "success" || workflow.kind === "partial";

  useEffect(() => {
    if (open && fresh.length > 0) emitOnboardingEvent(dispatch, { kind: "news-seen", ids: fresh });
  }, [open, fresh, dispatch]);

  const close = (): void => dispatch({ type: "whats-new", open: false });
  const act = (entry: WhatsNewEntry): void => {
    if (entry.action === undefined) return;
    close();
    for (const action of targetActions(entry.action.target, hasWorkflow)) dispatch(action);
  };

  const freshIds = new Set(fresh);
  const newer = WHATS_NEW.filter((entry) => freshIds.has(entry.id));
  const older = WHATS_NEW.filter((entry) => !freshIds.has(entry.id));

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent side="right" data-testid="whats-new-sheet" size="min(100%, 28rem)">
        <SheetHeader>
          <SheetTitle>更新情報</SheetTitle>
          <SheetDescription>
            {onboarding.version === null
              ? "AIDLC Guide の新機能と変更点です。"
              : `AIDLC Guide ${onboarding.version} の新機能と変更点です。`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
          {newer.length === 0 ? null : (
            <section aria-labelledby="whats-new-fresh">
              <h3 id="whats-new-fresh" className="mb-2 text-xs font-bold text-muted-foreground">
                新着
              </h3>
              <ul className="m-0 list-none p-0">
                {newer.map((entry) => (
                  <Entry key={entry.id} entry={entry} fresh onAction={act} />
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="whats-new-past">
            <h3 id="whats-new-past" className="text-xs font-bold text-muted-foreground">
              {newer.length === 0 ? "最近の更新" : "これまでの更新"}
            </h3>
            <ul className="m-0 list-none p-0">
              {older.map((entry) => (
                <Entry key={entry.id} entry={entry} fresh={false} onAction={act} />
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
