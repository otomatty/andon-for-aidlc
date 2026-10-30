import type { CustomizationDiagnostic, CustomizationItem } from "@andon/shared-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export function Diagnostics({
  diagnostics,
  onShow,
}: {
  diagnostics: CustomizationDiagnostic[];
  onShow: (id: string) => void;
}) {
  if (!diagnostics.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="設定の確認結果">
      {diagnostics.map((entry) => (
        <Alert
          key={`${entry.code}-${entry.itemId}-${entry.field}-${entry.message}`}
          variant={entry.severity === "error" ? "destructive" : "default"}
        >
          <AlertTitle>{entry.severity === "error" ? "修正が必要" : "確認事項"}</AlertTitle>
          <AlertDescription>
            <p>{entry.message}</p>
            {entry.itemId ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (entry.itemId) onShow(entry.itemId);
                }}
              >
                該当項目を開く
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ))}
    </section>
  );
}

export function itemChanges(base: CustomizationItem[], items: CustomizationItem[]): string[] {
  const before = new Map(base.map((item) => [item.id, item]));
  const after = new Map(items.map((item) => [item.id, item]));
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)),
  );
}
