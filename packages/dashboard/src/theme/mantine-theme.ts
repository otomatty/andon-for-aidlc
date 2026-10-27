import {
  Accordion,
  Card,
  Checkbox,
  Collapse,
  createTheme,
  type CSSVariablesResolver,
  defaultVariantColorsResolver,
  mergeThemeOverrides,
  Paper,
  rem,
  type VariantColorsResolver,
} from "@mantine/core";

/** Text on the primary colour, white unless the VS Code host maps it (globals.css). */
const PRIMARY_CONTRAST = "var(--mantine-primary-color-contrast)";

/**
 * Mantine writes white on every filled colour, inside a transparent border. On
 * the primary colour the text reads PRIMARY_CONTRAST and the border
 * `--primary-border` instead, so inside VS Code a filled button is drawn with
 * all of the theme's button colours, not only its background.
 */
export const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  if (input.variant !== "filled" || input.color !== input.theme.primaryColor) return colors;
  return { ...colors, color: PRIMARY_CONTRAST, border: `${rem(1)} solid var(--primary-border)` };
};

/**
 * Mantine theme for the dashboard. Inputs, buttons and menus keep the 4px
 * radius (`sm`); cards and papers use 8px (`md`). The filled primary is blue
 * shade 8 in both schemes: Mantine's light default (shade 6) puts white text
 * at 3.6:1.
 *
 * Fonts stay on the dashboard's own variables, which globals.css points at the
 * editor fonts inside the VS Code webview, along with the editor theme's colours.
 */
export const mantineTheme = createTheme({
  primaryColor: "blue",
  primaryShade: { light: 8, dark: 8 },
  variantColorResolver,
  defaultRadius: "sm",
  fontFamily: "var(--font-sans)",
  fontFamilyMonospace: "var(--font-mono)",
  headings: { fontFamily: "var(--font-sans)" },
  components: {
    Card: Card.extend({ defaultProps: { radius: "md", withBorder: true, shadow: "xs" } }),
    Checkbox: Checkbox.extend({ defaultProps: { iconColor: PRIMARY_CONTRAST } }),
    Paper: Paper.extend({ defaultProps: { radius: "md" } }),
  },
});

/**
 * Text colours Mantine leaves under 4.5:1 on its own body colours: dimmed
 * (gray 6 / dark 2), links in light (blue 6) and error text (red 6 / red 8).
 * Each moves to the nearest shade that clears it on the body and on cards.
 */
/**
 * The theme under Vitest. `env="test"` already stops Mantine's transitions;
 * Collapse (and the Accordion built on it) times its own height animation, so
 * here it opens and closes at once.
 */
export const testTheme = mergeThemeOverrides(
  mantineTheme,
  createTheme({
    components: {
      Accordion: Accordion.extend({ defaultProps: { transitionDuration: 0 } }),
      Collapse: Collapse.extend({ defaultProps: { transitionDuration: 0 } }),
    },
  }),
);

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": "var(--mantine-color-gray-7)",
    "--mantine-color-anchor": "var(--mantine-color-blue-8)",
    "--mantine-color-error": "var(--mantine-color-red-9)",
  },
  dark: {
    "--mantine-color-dimmed": "#a1a1a1",
    "--mantine-color-error": "var(--mantine-color-red-4)",
  },
});
