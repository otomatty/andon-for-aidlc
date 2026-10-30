import type { IntentEffectiveness } from "@andon/shared-types";
import { SlidersHorizontalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FormSelect } from "@/shared/form-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

function Filter({
  name,
  label,
  values,
  value,
  onChange,
}: {
  name: string;
  label: string;
  values: (string | null)[];
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  const options = [
    ...new Set([...values.map((item) => JSON.stringify(item)), ...(value ? [value] : [])]),
  ].sort();
  return (
    <Field>
      <FieldLabel htmlFor={`effectiveness-${name}`}>{label}</FieldLabel>
      <FormSelect
        id={`effectiveness-${name}`}
        value={value}
        onChange={onChange}
        options={[
          { value: "", label: "すべて" },
          ...options.map((item) => ({
            value: item,
            label: String(JSON.parse(item) ?? "未記録"),
          })),
        ]}
      />
    </Field>
  );
}

export function EffectivenessFilters({
  rows,
  scope,
  depth,
  open,
  onOpenChange,
  onApply,
  disabled,
}: {
  rows: IntentEffectiveness[];
  scope: string;
  depth: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (scope: string, depth: string) => void;
  disabled: boolean;
}): ReactNode {
  const [draftScope, setDraftScope] = useState(scope);
  const [draftDepth, setDraftDepth] = useState(depth);
  const count = Number(scope !== "") + Number(depth !== "");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraftScope(scope);
          setDraftDepth(depth);
        }
        onOpenChange(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid="effectiveness-filters"
          />
        }
      >
        <SlidersHorizontalIcon data-icon="inline-start" />
        比較条件{count > 0 ? `（${count}）` : ""}
      </DialogTrigger>
      <DialogContent size="scroll">
        <DialogHeader>
          <DialogTitle>比較する案件</DialogTitle>
          <DialogDescription>
            対象範囲と進め方の深さで、比較する案件を絞り込みます。
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(draftScope, draftDepth);
            onOpenChange(false);
          }}
        >
          <FieldGroup>
            <Filter
              name="scope"
              label="Scope（対象範囲）"
              values={rows.map((row) => row.scope)}
              value={draftScope}
              onChange={setDraftScope}
            />
            <Filter
              name="depth"
              label="Depth（進め方の深さ）"
              values={rows.map((row) => row.depth)}
              value={draftDepth}
              onChange={setDraftDepth}
            />
          </FieldGroup>
          <DialogFooter className="flex-wrap">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraftScope("");
                setDraftDepth("");
              }}
            >
              条件をリセット
            </Button>
            <DialogClose render={<Button type="button" variant="outline" />}>
              キャンセル
            </DialogClose>
            <Button type="submit">適用</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
