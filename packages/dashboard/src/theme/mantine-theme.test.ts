import { DEFAULT_THEME, defaultVariantColorsResolver, mergeMantineTheme } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { mantineTheme, variantColorResolver } from "./mantine-theme.ts";

const theme = mergeMantineTheme(DEFAULT_THEME, mantineTheme);

describe("variantColorResolver", () => {
  it("draws a filled primary's text and border from variables the VS Code host maps", () => {
    const colors = variantColorResolver({ color: "blue", theme, variant: "filled" });
    expect(colors.background).toBe("var(--mantine-color-blue-filled)");
    expect(colors.color).toBe("var(--mantine-primary-color-contrast)");
    expect(colors.border).toMatch(/ solid var\(--primary-border\)$/);
  });

  it.each([
    { color: "red", variant: "filled" },
    { color: "blue", variant: "light" },
    { color: "gray", variant: "subtle" },
  ])("leaves $variant $color to Mantine", (input) => {
    expect(variantColorResolver({ ...input, theme })).toEqual(
      defaultVariantColorsResolver({ ...input, theme }),
    );
  });
});
