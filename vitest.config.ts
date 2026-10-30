import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const dashboardSrc = path.resolve(repoRoot, "packages/dashboard/src");
const dashboardTests = path.resolve(repoRoot, "packages/dashboard/tests");
const dashboardReact = path.resolve(repoRoot, "packages/dashboard/tests/react-cjs-bridge.ts");
const dashboardAliases = [
  { find: "@tests", replacement: dashboardTests },
  { find: "@/components/ui", replacement: path.join(dashboardSrc, "shared/ui") },
  { find: "@/store", replacement: path.join(dashboardSrc, "shared/store") },
  { find: "@/hooks", replacement: path.join(dashboardSrc, "shared/hooks") },
  { find: "@/services", replacement: path.join(dashboardSrc, "shared/services") },
  { find: "@/lib", replacement: path.join(dashboardSrc, "shared/lib") },
  { find: "@/data", replacement: path.join(dashboardSrc, "shared/data") },
  { find: "@/styles", replacement: path.join(dashboardSrc, "shared/styles") },
  { find: "@", replacement: dashboardSrc },
];
const require = createRequire(import.meta.url);
const vitestEntry = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "dist/index.js",
);

export default defineConfig({
  resolve: {
    // Bun's isolated linker stores vitest under node_modules/.bun while Vite
    // resolves the workspace symlink. Two copies leave describe() without a suite.
    alias: [{ find: /^vitest$/, replacement: vitestEntry }],
  },
  test: {
    // Coverage plus jsdom on a 16-core Windows box otherwise forks enough
    // workers to starve repo scans and Bun.serve smoke tests (environment
    // setup alone has exceeded 10 minutes). Cap so the gate finishes.
    maxWorkers: 4,
    // Two environments in one run: every package but the dashboard is Node
    // (filesystem, process, server), the dashboard is a browser package and
    // needs a DOM. Projects keep them apart without a second command.
    projects: [
      {
        test: {
          name: "node",
          include: [
            "packages/*/tests/**/*.test.ts",
            "plugins/*/tests/**/*.test.ts",
            "scripts/**/*.test.ts",
            ".cursor/hooks/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**", "packages/dashboard/**"],
          // Several node suites read this repository's own AI-DLC record and
          // need a record elected before they run. The cursor that elects one
          // is per-user and gitignored, so the gate establishes its own
          // precondition here rather than having CI inject it — see
          // scripts/live-intent.ts.
          setupFiles: ["scripts/vitest-setup-live-intent.ts"],
          // Repo-wide filesystem scans (upstream-branch-refs,
          // customization-standard, review-freshness) finish in ~2s alone but
          // starve past Vitest's 5s default when coverage instruments every
          // worker at once — especially on Windows. Match the dashboard
          // project's budget so a slow scan fails on its assertion, not this.
          testTimeout: 20_000,
        },
      },
      {
        resolve: {
          alias: [
            { find: /^vitest$/, replacement: vitestEntry },
            ...dashboardAliases,
            // Exact `react` only — do not swallow `react/jsx-runtime`.
            { find: /^react$/, replacement: dashboardReact },
          ],
        },
        test: {
          name: "dashboard",
          environment: "jsdom",
          include: [
            "packages/dashboard/src/**/*.test.{ts,tsx}",
            "packages/dashboard/tests/**/*.test.{ts,tsx}",
          ],
          setupFiles: ["packages/dashboard/tests/setup.ts"],
          // Vitest's own 5000ms default, not RTL's wait budget, is what kills a
          // slow test — and it kills it with an opaque "Test timed out" rather
          // than the assertion that was actually pending. Keep this above
          // setup.ts's asyncUtilTimeout so a wait that genuinely never resolves
          // surfaces as RTL's readable error instead of this one.
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      // Windows: Node's fileURLToPath uses a lowercase drive letter while Vite's
      // config.root may be uppercase (C:/…). Without allowExternal, isIncluded
      // treats every workspace file as outside the root and coverage stays 0%.
      allowExternal: true,
      // Show 100%-covered files in the text report so NFR-B2-1 floors
      // (roots.ts / markdown.ts) are visibly attributed, not skipFull-hidden.
      skipFull: false,
      include: [
        "packages/*/src/**/*.ts",
        "packages/dashboard/src/**/*.tsx",
        "plugins/*/tools/**/*.ts",
      ],
      // Process-boundary code, verified by a smoke test rather than by unit
      // tests, so v8 in *this* process cannot see it:
      //  - dashboard-server server/cli: Bun.serve does not exist under the
      //    Node-hosted Vitest, so server-smoke.test.ts drives a spawned Bun
      //    child over real HTTP/WS instead (code-summary.md D-4).
      exclude: [
        "packages/dashboard-server/src/server.ts",
        "packages/dashboard-server/src/cli.ts",
        "packages/dashboard-server/src/index.ts",
        //  - mcp-server index: a bin whose module body connects the stdio
        //    transport, so it cannot be imported here either. Covered by
        //    server-smoke.test.ts driving a spawned Bun child over real stdio.
        "packages/mcp-server/src/index.ts",
        //  - dashboard main.tsx: the browser entry point. It calls createRoot
        //    against a real document at module load, so importing it here would
        //    mount the app rather than test it; the bootstrap ordering it exists
        //    for is asserted in app-boot.test.tsx instead.
        "packages/dashboard/src/main.tsx",
        "**/*.test.ts",
        "**/*.test.tsx",
      ],
      thresholds: {
        // team.md: the State Version parser is the risk centre of this project,
        // so it is gated on BRANCH coverage rather than lines (R-RC-2).
        "packages/reader-core/src/parse/**": {
          branches: 95,
          statements: 95,
          functions: 95,
          lines: 95,
        },
        // NFR-B2-1 / US-B2-03: official-docs resolve surface floor.
        "packages/official-docs/src/resolve.ts": {
          branches: 95,
          statements: 95,
          functions: 95,
          lines: 95,
        },
        "packages/official-docs/src/roots.ts": {
          branches: 95,
          statements: 95,
          functions: 95,
          lines: 95,
        },
        "packages/official-docs/src/markdown.ts": {
          branches: 95,
          statements: 95,
          functions: 95,
          lines: 95,
        },
        "packages/api-core/src/handlers/docs-qa.ts": {
          branches: 70,
        },
        "packages/api-core/src/docs-qa/**": {
          branches: 70,
        },
        lines: 80,
      },
    },
  },
});
