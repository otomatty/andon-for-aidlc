import { createRequire } from "node:module";
import path from "node:path";
import { render, screen } from "@tests/render.tsx";
import { type ReactNode, useState } from "react";
import { describe, expect, it } from "vitest";

describe("react singleton (dashboard Vitest graph)", () => {
  it('uses the same useState as react-dom\'s require("react")', () => {
    const required = createRequire(path.join(process.cwd(), "packages/dashboard/package.json"))(
      "react",
    ) as { useState: typeof useState };
    expect(useState).toBe(required.useState);
  });

  it("can call useState inside a rendered component", () => {
    function Probe(): ReactNode {
      const [value] = useState("hook-ok");
      return <div>{value}</div>;
    }

    render(<Probe />);
    expect(screen.getByText("hook-ok")).toBeDefined();
  });
});
