import { MantineProvider } from "@mantine/core";
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import { isValidElement, type JSXElementConstructor, type ReactNode, StrictMode } from "react";
import { cssVariablesResolver, testTheme } from "@/theme/mantine-theme.ts";

/**
 * Testing Library with the dashboard's MantineProvider around every render,
 * as Mantine's Vitest guide asks. `env="test"` turns off transitions and
 * portals, so an opened Modal or Menu is in the container at once. The CSS
 * variable and global class `<style>` tags are left out: jsdom applies no CSS,
 * and their text would land in every container's textContent.
 *
 * Dashboard tests import from here, never from `@testing-library/react`
 * directly (.oxlintrc.json enforces it).
 *
 * React runs Strict Mode's second effect pass only when `<StrictMode>` is the
 * root of the render, so the provider never goes above it: a test's own
 * `wrapper` stays outermost, and a UI that starts with `<StrictMode>` is
 * handed to Testing Library's `reactStrictMode`, which puts it at the root.
 */

type Wrapper = JSXElementConstructor<{ children: ReactNode }>;

function withMantine(Outer: Wrapper | undefined): Wrapper {
  return function MantineTestProvider({ children }: { children: ReactNode }): ReactNode {
    const content = (
      <MantineProvider
        theme={testTheme}
        cssVariablesResolver={cssVariablesResolver}
        env="test"
        withCssVariables={false}
        withGlobalClasses={false}
      >
        {children}
      </MantineProvider>
    );
    return Outer === undefined ? content : <Outer>{content}</Outer>;
  };
}

export * from "@testing-library/react";

export function render(ui: ReactNode, options: Omit<RenderOptions, "queries"> = {}): RenderResult {
  const wrapper = withMantine(options.wrapper as Wrapper | undefined);
  if (isValidElement<{ children?: ReactNode }>(ui) && ui.type === StrictMode)
    return rtlRender(ui.props.children, { ...options, wrapper, reactStrictMode: true });
  return rtlRender(ui, { ...options, wrapper });
}

export function renderHook<Result, Props>(
  callback: (props: Props) => Result,
  options: RenderHookOptions<Props> = {},
): RenderHookResult<Result, Props> {
  return rtlRenderHook(callback, {
    ...options,
    wrapper: withMantine(options.wrapper as Wrapper | undefined),
  });
}
