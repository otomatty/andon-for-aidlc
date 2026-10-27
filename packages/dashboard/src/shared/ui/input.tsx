import { Input as MantineInput } from "@mantine/core";
import type * as React from "react";

/**
 * Mantine's bare Input: the 36px field without a label wrapper, since callers
 * pair it with FieldLabel. `className` sizes the wrapper; every other prop
 * lands on the `<input>`.
 */
function Input({ className, ...props }: Omit<React.ComponentPropsWithRef<"input">, "size">) {
  return <MantineInput data-slot="input" className={className} {...props} />;
}

export { Input };
