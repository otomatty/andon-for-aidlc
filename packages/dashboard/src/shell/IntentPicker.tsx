import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { refetchAfterIntentSelect, refetchAll } from "@/services/api.ts";
import { selectIntent } from "@/services/select-intent.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { intentChoicePending, viewValue } from "@/store/state.ts";

export function IntentPicker(): ReactNode {
  const state = useAppState();
  const dispatch = useDispatch();
  const intents = viewValue(state.intents);
  const selected = intents?.selected ?? null;
  const all = intents?.all ?? [];
  const shouldAutoOpen =
    intentChoicePending(intents) &&
    state.route.name !== "effectiveness" &&
    state.route.name !== "settings" &&
    state.route.name !== "plugins" &&
    state.route.name !== "welcome";
  const [open, setOpen] = useState(shouldAutoOpen);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shouldAutoOpen) setOpen(true);
  }, [shouldAutoOpen]);

  const label = selected ?? "未選択";

  const onSelect = async (name: string): Promise<void> => {
    if (!intents) return;
    setError(null);
    setPending(name);
    try {
      const result = await selectIntent(name, intents.space);
      if (!result.ok) {
        const body = result.body as { reason?: unknown } | null;
        if (result.status === 409 && body?.reason === "space-conflict") {
          setError("Space が変更されました。表示中の一覧から選び直してください。");
          await refetchAll(dispatch);
        } else setError("切り替えに失敗しました");
        return;
      }
      setOpen(false);
      await refetchAfterIntentSelect(dispatch, name);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="min-w-0 max-w-full" data-testid="intent-picker">
      <Button
        type="button"
        variant="outline"
        className="max-w-full"
        title={label}
        data-testid="intent-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="truncate font-mono font-medium">{label}</span>
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="intent-dialog">
          <DialogHeader>
            <DialogTitle>インテント一覧</DialogTitle>
            <DialogDescription>表示するインテントを選んでください</DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              dispatch({ type: "effectiveness", open: true });
            }}
          >
            効果測定を見る
          </Button>
          {all.length === 0 ? (
            <p className="text-muted-foreground">インテントは見つかりませんでした。</p>
          ) : (
            <ul
              className="m-0 flex max-h-menu list-none flex-col gap-1 overflow-y-auto p-0"
              data-testid="intent-list"
            >
              {all.map((name) => {
                const isSelected = name === selected;
                const content = (
                  <>
                    <span aria-hidden="true">{isSelected ? "✔" : "○"}</span> {name}
                    {isSelected ? <span className="text-muted-foreground">（表示中）</span> : null}
                  </>
                );
                return (
                  <li
                    className="rounded-lg border px-3 py-2 text-sm data-[selected=true]:border-primary data-[selected=true]:bg-muted data-[selected=true]:font-semibold"
                    key={name}
                    data-selected={isSelected}
                    data-active={isSelected}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 text-left"
                      disabled={pending !== null || state.spaceSwitchPending}
                      onClick={() => {
                        void onSelect(name);
                      }}
                    >
                      {content}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {error !== null ? <p className="text-destructive">{error}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
