import type { SpaceCatalog } from "@aidlc-guide/shared-types";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FormSelect } from "@/shared/form-select";
import { fetchSpaces, refetchAll } from "@/services/api.ts";
import { switchSpace } from "@/services/spaces.ts";
import { useAppState, useDispatch } from "@/store/context.tsx";
import { viewValue } from "@/store/state.ts";

export function SpacePicker() {
  const state = useAppState();
  const dispatch = useDispatch();
  const active = viewValue(state.intents)?.space;
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<SpaceCatalog | null>(null);
  const [space, setSpace] = useState("");
  const [harness, setHarness] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const pending = state.spaceSwitchPending;

  useEffect(() => {
    if (!open) return;
    let live = true;
    setCatalog(null);
    void fetchSpaces().then((result) => {
      if (!live) return;
      if (!("ok" in result)) {
        setError("Space 一覧を読み込めませんでした。再読み込みしてください。");
        return;
      }
      setCatalog(result.value);
      setSpace(result.value.active);
      setHarness(result.value.harnesses.length === 1 ? result.value.harnesses[0]!.id : "");
    });
    return () => {
      live = false;
    };
  }, [open, active, revision]);

  const apply = async () => {
    if (!catalog || pending || state.spaceSwitchBlocked) return;
    dispatch({ type: "space-switch-pending", value: true });
    setError(null);
    try {
      const result = await switchSpace({ space, expectedSpace: catalog.active, harness });
      // A failed command may already have changed the cursor. Always read it back.
      await refetchAll(dispatch);
      if (result.ok) setOpen(false);
      else {
        const body = result.body as { message?: unknown } | null;
        setError(
          typeof body?.message === "string"
            ? body.message
            : "切り替え結果を確認できませんでした。一覧を再読み込みして現在の Space を確認してください。",
        );
        setRevision((value) => value + 1);
      }
    } finally {
      dispatch({ type: "space-switch-pending", value: false });
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="max-w-full"
        aria-label={`Space: ${active ?? "読み込み中"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <span className="truncate font-medium">Space: {active ?? "…"}</span>
        <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Space を切り替える</DialogTitle>
            <DialogDescription>
              ワークスペースの Space を切り替え、ツールが読む手順のコピー（aidlc/active-memory/、Git
              の対象外）を更新します。進行中のチャットは、そのチャットで切り替えてください。
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!catalog ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setError(null);
                setRevision((value) => value + 1);
              }}
            >
              一覧を再読み込み
            </Button>
          ) : !catalog.canSwitch ? (
            <p>切り替えには、信頼済みのワークスペースと aidlc-workflows の導入が必要です。</p>
          ) : (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="switch-space">切り替え先</FieldLabel>
                  <FormSelect
                    id="switch-space"
                    value={space}
                    disabled={pending}
                    onChange={setSpace}
                    options={catalog.spaces.map((name) => ({ value: name, label: name }))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="switch-harness">使用するツール</FieldLabel>
                  <FormSelect
                    id="switch-harness"
                    value={harness}
                    disabled={pending}
                    onChange={setHarness}
                    options={catalog.harnesses.map((item) => ({
                      value: item.id,
                      label: item.label,
                    }))}
                  />
                </Field>
              </FieldGroup>
              {state.spaceSwitchBlocked ? (
                <Alert>
                  <AlertDescription>
                    カスタマイズの保存・復旧を完了するか、未保存の変更を取り消してから切り替えてください。
                  </AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <Button
                  onClick={() => void apply()}
                  disabled={
                    pending || state.spaceSwitchBlocked || !harness || space === catalog.active
                  }
                >
                  {pending ? "切り替え中…" : "切り替える"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
