import { Checkbox as MantineCheckbox } from "@mantine/core";
import type * as React from "react";

type CheckboxProps = Omit<
  React.ComponentPropsWithRef<"input">,
  "type" | "size" | "onChange" | "color"
> & {
  onCheckedChange?: (checked: boolean) => void;
};

/** Mantine's Checkbox behind the dashboard's `onCheckedChange(checked)` callback. */
function Checkbox({ className, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <MantineCheckbox
      data-slot="checkbox"
      size="xs"
      className={className}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      {...props}
    />
  );
}

export { Checkbox, type CheckboxProps };
