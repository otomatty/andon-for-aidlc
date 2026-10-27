import type {
  CustomizationDiagnostic,
  CustomizationImportPlan,
  CustomizationImportSelection,
  CustomizationItem,
  CustomizationOperation,
} from "@aidlc-guide/shared-types";
import { MAX_CUSTOMIZATION_PACKAGE_JSON_BYTES } from "@aidlc-guide/shared-types";
import { Ellipsis } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FormSelect } from "@/shared/form-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  CustomizationError,
  customizationApi,
  customizationRequestId,
  downloadCustomization,
} from "@/services/customization";
import { CustomizationSkeleton } from "@/features/customization/components/CustomizationSkeleton.tsx";
import { CustomizationExplorer } from "@/features/customization/components/explorer/CustomizationExplorer";
import { Diagnostics } from "@/features/customization/components/Diagnostics";
import { EditorController } from "@/features/customization/model/editor-controller";
import {
  ExportDialog,
  type ExportSelection,
  ImportDialog,
} from "@/features/customization/components/PackageDialogs";
import {
  type Category,
  categoryOf,
  createItem,
} from "@/features/customization/utils/source-fields";
import { removeScope, stageDiagnostics } from "@/features/customization/utils/workflow-model";

const STATUS = {
  loading: "読み込み中",
  saved: "自動保存",
  dirty: "保存待ち…",
  error: "保存を確認してください",
  conflict: "別画面の変更と比較が必要",
};
export default function CustomizationPage({
  open,
  refreshVersion = 0,
  activeSpace,
  switching = false,
  onSwitchBlockedChange,
  onSettings,
  tip,
}: {
  open: boolean;
  refreshVersion?: number;
  activeSpace?: string;
  switching?: boolean;
  onSwitchBlockedChange?: (blocked: boolean) => void;
  onSettings?: () => void;
  /** Shown under the page header: the onboarding tip. The page itself stays store-free. */
  tip?: ReactNode;
}) {
  const [controller] = useState(() => new EditorController(customizationApi));
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [category, setCategory] = useState<Category | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plugin, setPlugin] = useState("all");
  const container = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [composing, setComposing] = useState(false);
  const attempted = useRef<{ items: CustomizationItem[]; revision: string } | null>(null);
  const sent = useRef<{ items: CustomizationItem[]; space: string } | null>(null);
  const busyRef = useRef(false);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const importItems = useRef<CustomizationItem[]>([]);
  const [operation, setOperation] = useState<CustomizationOperation | null>(null);
  const [importPlan, setImportPlan] = useState<CustomizationImportPlan | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirm, setConfirm] = useState<"discard" | "remove" | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [keepIds, setKeepIds] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<CustomizationDiagnostic[]>([]);
  const dirty = view.dirtyIds.length > 0;
  const applying = operation?.status === "running";
  const recoveryRequired = operation?.recoveryRequired === true;
  const disabled = switching || (busy && !saving) || uncertain || applying || recoveryRequired;
  const switchBlocked =
    dirty || busy || saving || uncertain || applying || recoveryRequired || importPlan !== null;
  useEffect(() => {
    onSwitchBlockedChange?.(switchBlocked);
  }, [onSwitchBlockedChange, switchBlocked]);
  useEffect(() => () => onSwitchBlockedChange?.(false), [onSwitchBlockedChange]);
  const plugins = view.items.filter((item) => item.kind === "plugin");
  const activePlugin = plugins.some((item) => (item.runtimeId ?? item.id) === plugin)
    ? plugin
    : "all";
  const selected = view.items.find((item) => item.id === selectedId);
  const changed = view.dirtyIds;
  const compareIds = view.dirtyIds;
  const compareItems = view.remote?.items;

  const autoSave = useRef(() => {});
  useEffect(() => {
    autoSave.current = () => {
      if (busyRef.current) return;
      attempted.current = {
        items: view.items,
        revision: view.catalog?.configurationRevision ?? "",
      };
      setSaving(true);
      void run(save).finally(() => setSaving(false));
    };
  });
  useEffect(() => {
    if (
      !dirty ||
      switching ||
      busy ||
      uncertain ||
      applying ||
      recoveryRequired ||
      composing ||
      view.remote ||
      importPlan ||
      conflictOpen
    )
      return;
    if (
      attempted.current?.items === view.items &&
      attempted.current.revision === view.catalog?.configurationRevision
    )
      return;
    const timer = setTimeout(() => autoSave.current(), 800);
    return () => clearTimeout(timer);
  }, [
    dirty,
    switching,
    busy,
    uncertain,
    applying,
    recoveryRequired,
    composing,
    view.remote,
    view.items,
    view.catalog?.configurationRevision,
    importPlan,
    conflictOpen,
  ]);

  const acceptSave = useCallback(async () => {
    const pending = sent.current;
    if (pending) await controller.acceptSaved(pending.items, pending.space);
    else await controller.load();
    sent.current = null;
  }, [controller]);

  useEffect(() => {
    controller.activate();
    void controller.load().catch(() => {});
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    if (!dirty && !saving && !applying && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving, applying, uncertain]);
  useEffect(() => {
    let live = true;
    void customizationApi
      .pendingOperation()
      .then((value) => {
        if (live && value) setOperation(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // the shared socket's change/reconnect revision triggers a refresh.
  useEffect(() => {
    if (!open || busy || applying || uncertain) return;
    let live = true;
    let pending = false;
    const refresh = () => {
      if (pending || busyRef.current) return;
      pending = true;
      void controller
        .refresh()
        .then(() => {
          if (live) setRefreshError(null);
        })
        .catch((cause) => {
          if (live)
            setRefreshError(cause instanceof Error ? cause.message : "設定を再確認できません。");
        })
        .finally(() => {
          pending = false;
        });
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 10000);
    refresh();
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [open, controller, refreshVersion, busy, applying, uncertain]);
  const operationId = operation?.status === "running" ? operation.id : null;
  useEffect(() => {
    if (!operationId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await customizationApi.operation(operationId);
        if (!live) return;
        if (next.status === "running") timer = setTimeout(() => void poll(), 750);
        else if (next.status === "completed") {
          await acceptSave();
        } else {
          setError(next.error?.message ?? next.message ?? "設定を保存できませんでした。");
        }
        if (live) setOperation(next);
      } catch (cause) {
        if (live) {
          setError(cause instanceof Error ? cause.message : "保存結果を確認できません。");
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [operationId, acceptSave]);

  async function run(task: () => Promise<void>) {
    if (busyRef.current || switching) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setRefreshError(null);
    setNotice(null);
    try {
      await task();
    } catch (cause) {
      if (cause instanceof CustomizationError) {
        setDiagnostics(cause.diagnostics ?? []);
        if (cause.reason === "configuration-changed") await controller.refresh().catch(() => {});
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "処理を完了できませんでした。入力は保持しています。",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  // Store the exact request closure before sending, including its ID and revision.
  async function reliable<T>(
    request: () => Promise<T>,
    accept: (value: T) => void | Promise<void>,
  ) {
    const perform = async () => {
      try {
        const value = await request();
        retry.current = null;
        setUncertain(false);
        await accept(value);
      } catch (cause) {
        if (
          !(cause instanceof CustomizationError) ||
          ["response-unknown", "unavailable"].includes(cause.reason)
        ) {
          retry.current = perform;
          setUncertain(true);
        } else {
          retry.current = null;
          setUncertain(false);
        }
        throw cause;
      }
    };
    await perform();
  }
  function chooseCategory(value: Category | null) {
    setCategory(value);
  }
  function show(id: string) {
    const item = view.items.find((value) => value.id === id);
    if (item) {
      chooseCategory(categoryOf(item.kind));
      setSelectedId(id);
    }
  }

  async function save() {
    const snapshot = controller.getSnapshot();
    const graphErrors = stageDiagnostics(snapshot.items);
    setDiagnostics(graphErrors);
    if (graphErrors.length) return;
    const body = { ...controller.request(), requestId: customizationRequestId() };
    sent.current = { items: snapshot.items, space: body.spaceId };
    await reliable(
      () => customizationApi.save(body),
      async (value) => {
        setOperation(value);
        if (value.status === "completed") {
          await acceptSave();
        } else if (value.status === "failed") {
          setError(value.error?.message ?? value.message ?? "設定を保存できませんでした。");
        }
      },
    );
  }
  async function importFile(file: File) {
    if (file.size > MAX_CUSTOMIZATION_PACKAGE_JSON_BYTES)
      throw new Error("設定ファイルは70 MB以下にしてください。");
    const text = await file.text();
    let content: unknown;
    try {
      content = JSON.parse(text);
    } catch {
      throw new Error(
        "設定ファイルのJSONを読み取れません。Guideから書き出した有効なJSONファイルを選択してください。",
      );
    }
    importItems.current = view.items;
    setImportPlan(
      await customizationApi.importAnalyze({ ...controller.request(), package: content }),
    );
  }
  async function importAdopt(selections: CustomizationImportSelection[]) {
    if (!importPlan) return;
    if (importItems.current !== view.items)
      throw new Error("入力が変わりました。ファイルを読み込み直してください。");
    const body = { ...controller.request(), planId: importPlan.id, selections };
    await reliable(
      () => customizationApi.importAdopt(body),
      (value) => {
        controller.setItems(value);
        setImportPlan(null);
        setNotice(`${selections.length}項目を取り込みました。`);
      },
    );
  }
  async function exportFile(selection: ExportSelection) {
    const body = { ...controller.request(), ...selection };
    await reliable(
      () => customizationApi.export(body),
      (file) => {
        downloadCustomization(file);
        setDiagnostics(file.diagnostics);
        setExportOpen(false);
        setNotice(`${file.filename}を書き出しました。`);
      },
    );
  }
  async function addDocument(file: File) {
    if (!view.catalog) return;
    if (file.size > 10 * 1024 * 1024) throw new Error("文書原本は10 MB以下にしてください。");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    let raw = "";
    for (let index = 0; index < bytes.length; index += 8192)
      raw += String.fromCharCode(...bytes.subarray(index, index + 8192));
    const item: CustomizationItem = {
      ...createItem("knowledge", view.catalog.spaceId),
      title: file.name,
      target: { knowledgeType: "document-source", filename: file.name, audience: "all" },
      binary: {
        base64: btoa(raw),
        bytes: file.size,
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        mimeType: file.type || "application/octet-stream",
      },
    };
    controller.edit(item);
    setSelectedId(item.id);
  }

  return (
    <div
      ref={container}
      className="flex min-w-0 flex-col gap-5 p-4"
      data-testid="customization-page"
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
    >
      <header className="grid grid-cols-title-actions items-end gap-x-5 gap-y-3 min-[820px]:flex">
        <h1 className="text-page-title font-bold">カスタマイズ</h1>
        {view.catalog ? (
          <div className="order-3 col-span-2 flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3 min-[820px]:order-0">
            <Field className="w-auto">
              <FieldLabel htmlFor="customization-space" className="shrink-0 whitespace-nowrap">
                対象スペース
              </FieldLabel>
              <FormSelect
                id="customization-space"
                className="w-36"
                value={view.catalog.spaceId}
                disabled={busy || uncertain || applying || dirty}
                onChange={(space) =>
                  void run(async () => {
                    if (space === view.catalog?.spaceId) return;
                    await controller.load(space);
                    setPlugin("all");
                    setCategory(null);
                    setSelectedId(null);
                  })
                }
                options={view.catalog.spaces.map((space) => ({ value: space, label: space }))}
              />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="customization-plugin" className="shrink-0 whitespace-nowrap">
                プラグイン
              </FieldLabel>
              <FormSelect
                id="customization-plugin"
                className="w-40"
                value={activePlugin}
                onChange={(value) => {
                  setPlugin(value);
                  setSelectedId(null);
                }}
                options={[
                  { value: "all", label: "すべて" },
                  ...plugins.map((item) => ({
                    value: item.runtimeId ?? item.id,
                    label: item.runtimeId ?? item.title,
                  })),
                ]}
              />
            </Field>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" role="status">
            {saving || applying
              ? "保存中…"
              : (error || diagnostics.length > 0) && dirty
                ? "未保存"
                : STATUS[view.status]}
          </Badge>
          <DropdownMenu position="bottom-end" width={224}>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label="その他の操作" />}
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  setCategory("plugins");
                  setSelectedId(null);
                }}
              >
                プラグインを管理
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || uncertain || applying || !view.catalog}
                onClick={() => importInput.current?.click()}
              >
                設定ファイルを読み込む
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || uncertain || applying || !view.catalog}
                onClick={() => {
                  setError(null);
                  setExportOpen(true);
                }}
              >
                書き出す
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {tip}
      {activeSpace && view.catalog && activeSpace !== view.catalog.spaceId ? (
        <Alert>
          <AlertDescription>
            現在の Space は {activeSpace} です。この画面では {view.catalog.spaceId}{" "}
            の設定を編集中です。編集対象はこの画面の「Space」で選べます。
          </AlertDescription>
        </Alert>
      ) : null}
      <input
        ref={importInput}
        type="file"
        accept=".json,.aidlc-guide.json"
        className="hidden"
        aria-label="Guide設定ファイル"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(() => importFile(file));
        }}
      />
      <input
        ref={documentInput}
        type="file"
        accept=".pdf,.docx,.md,.txt"
        className="hidden"
        aria-label="文書原本"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(() => addDocument(file));
        }}
      />
      {view.catalog && !view.catalog.capabilities.available ? (
        <Alert>
          <AlertDescription>
            <p>
              {view.catalog.capabilities.reason ?? "対応するワークフローエンジンを確認できません。"}
            </p>
            {onSettings ? (
              <Button variant="outline" onClick={onSettings}>
                設定を開く
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {error || view.error || refreshError ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{error ?? view.error ?? refreshError}</p>
            {uncertain ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const task = retry.current;
                  if (task) void run(task);
                }}
              >
                同じ操作の受付を再確認
              </Button>
            ) : !view.catalog ? (
              <Button variant="outline" onClick={() => void run(() => controller.load())}>
                再読み込み
              </Button>
            ) : dirty && !applying ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void run(save)}>
                  保存を再試行
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirm("discard")}>
                  未保存の変更を取り消す
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {operation?.recoveryRequired ? (
        <Alert>
          <AlertDescription>
            <p>{operation.message ?? "中断した保存の結果を確認してください。"}</p>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await customizationApi.recover(operation.id);
                  setOperation(next);
                  if (next.status === "completed") await acceptSave();
                  if (next.status === "failed")
                    setError(next.error?.message ?? "保存できませんでした。");
                })
              }
            >
              保存結果を確認・復旧
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {view.status === "conflict" ? (
        <Alert>
          <AlertDescription>
            <p>別画面の変更を読み直し、自分の入力を残す項目を選んでください。</p>
            <Button
              variant="outline"
              onClick={() =>
                void run(async () => {
                  await controller.refresh();
                  setKeepIds([...view.dirtyIds]);
                  setConflictOpen(true);
                })
              }
            >
              変更を比較する
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Diagnostics
        diagnostics={[...(view.catalog?.diagnostics ?? []), ...diagnostics]}
        onShow={show}
      />
      {view.catalog ? (
        <CustomizationExplorer
          key={`${view.catalog?.spaceId}:${activePlugin}`}
          items={view.items}
          plugin={activePlugin}
          space={view.catalog?.spaceId ?? "default"}
          category={category}
          selected={selected}
          changed={changed}
          disabled={disabled || !view.catalog}
          diagnostics={diagnostics}
          onCategory={chooseCategory}
          onSelect={setSelectedId}
          onItems={(items) => controller.setItems(items)}
          onRemove={(item) => {
            setSelectedId(item.id);
            setConfirm("remove");
          }}
          onDocument={() => documentInput.current?.click()}
        />
      ) : view.status === "loading" ? (
        <CustomizationSkeleton page={false} />
      ) : null}
      <ImportDialog
        key={importPlan?.id ?? "no-import"}
        plan={importPlan}
        items={view.items}
        stale={Boolean(importPlan && importItems.current !== view.items)}
        busy={busy || uncertain}
        error={error}
        onClose={() => setImportPlan(null)}
        onAdopt={(selections) => void run(() => importAdopt(selections))}
      />
      <ExportDialog
        open={exportOpen}
        items={view.items}
        busy={busy || uncertain}
        error={error}
        onClose={() => setExportOpen(false)}
        onExport={(selection) => void run(() => exportFile(selection))}
      />
      <Dialog
        open={confirm !== null}
        onOpenChange={(value) => {
          if (!value) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "discard"
                ? "未保存の変更を取り消しますか？"
                : "この項目を削除しますか？"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "discard"
                ? "未保存の変更を取り消し、現在の設定を読み直します。"
                : `${selected?.title ?? "選択項目"}を設定から削除します。`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              戻る
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (confirm === "discard") await controller.load();
                  else if (selected) {
                    const next =
                      selected.kind === "scope"
                        ? removeScope(view.items, selected)
                        : view.items.filter((item) => item.id !== selected.id);
                    controller.setItems(next);
                    setSelectedId(null);
                  }
                  setConfirm(null);
                })
              }
            >
              {confirm === "discard" ? "変更を取り消す" : "削除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>現在の設定と比較</DialogTitle>
            <DialogDescription>
              チェックした項目は自分の入力を残します。その他は比較先の保存された内容を使います。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {compareIds.map((id) => (
              <div key={id} className="flex flex-col gap-2">
                <Field orientation="horizontal">
                  <Checkbox
                    id={`conflict-${id}`}
                    checked={keepIds.includes(id)}
                    onCheckedChange={(checked) =>
                      setKeepIds((values) =>
                        checked ? [...values, id] : values.filter((value) => value !== id),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`conflict-${id}`}>
                    {view.items.find((item) => item.id === id)?.title ?? "削除した項目"}{" "}
                    の入力を残す
                  </FieldLabel>
                </Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p>現在の設定</p>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word text-xs">
                      {compareItems?.find((item) => item.id === id)?.content ?? "（項目なし）"}
                    </pre>
                  </div>
                  <div>
                    <p>自分の入力</p>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word text-xs">
                      {view.items.find((item) => item.id === id)?.content ?? "（削除）"}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </FieldGroup>
          {error ? <p role="alert">{error}</p> : null}
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                controller.resolveConflict(new Set(keepIds));
                setConflictOpen(false);
              })
            }
          >
            選んだ内容で編集を続ける
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
