import { Input as MantineInput } from "@mantine/core";
import type * as React from "react";

/**
 * Mantine's bare Input as a `<textarea>` that grows with its content
 * (`field-sizing: content`). `className` sizes the wrapper; every other prop
 * lands on the `<textarea>`.
 */
function Textarea({ className, ...props }: React.ComponentPropsWithRef<"textarea">) {
  return (
    <MantineInput
      component="textarea"
      multiline
      data-slot="textarea"
      className={className}
      classNames={{ input: "field-sizing-content min-h-16 py-2" }}
      {...props}
    />
  );
}

export { Textarea };
