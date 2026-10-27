import { Combobox, InputBase, useCombobox } from "@mantine/core";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type FormSelectOption = { value: string; label: string };

/**
 * A single choice from a short fixed list: Mantine's Combobox behind a button
 * that shows the chosen label, so the field reads like the other inputs and
 * its text is the current choice.
 */
export function FormSelect({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  id?: string;
  value: string;
  options: readonly FormSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
    onDropdownOpen: () => combobox.updateSelectedOptionIndex("active"),
  });
  const selected = options.find((option) => option.value === value);
  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(next) => {
        onChange(String(next));
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target targetType="button" withExpandedAttribute>
        <InputBase
          component="button"
          type="button"
          id={id}
          pointer
          disabled={disabled}
          className={cn("w-full", className)}
          classNames={{ input: "truncate text-left" }}
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => combobox.toggleDropdown()}
        >
          {selected?.label ?? ""}
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options className="max-h-72 overflow-y-auto">
          {options.map((option) => (
            <Combobox.Option
              key={option.value}
              value={option.value}
              active={option.value === value}
              aria-selected={option.value === value}
              className="flex items-center gap-2"
            >
              <CheckIcon
                aria-hidden="true"
                className={cn("size-3.5 shrink-0", option.value !== value && "invisible")}
              />
              {option.label}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
