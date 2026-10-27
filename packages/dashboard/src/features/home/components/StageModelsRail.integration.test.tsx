import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act, render, screen, waitFor, within } from "@tests/render.tsx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { routeRead } from "../../../../../api-core/src/handlers/read.ts";
import { createGuideService, type GuideService } from "../../../../../api-core/src/service.ts";
import { StageModelsRail } from "@/features/home/components/StageModelsRail.tsx";
import { createBrowserTransport, setTransport } from "@/services/transport/index.ts";
import { workflow } from "@tests/fixtures.ts";

let root: string;
let service: GuideService;
let lastRead: Promise<unknown>;
const post = vi.fn();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "model-record-display-"));
  vi.stubEnv("AIDLC_DISABLE_USAGE_TRACKING", "0");
  post.mockReset();
  const intents = join(root, "aidlc/spaces/default/intents");
  await mkdir(join(intents, "first"), { recursive: true });
  await mkdir(join(intents, "second"), { recursive: true });
  await writeFile(
    join(intents, "intents.json"),
    JSON.stringify([
      { dirName: "first", uuid: "first-id" },
      { dirName: "second", uuid: "second-id" },
    ]),
  );
  service = createGuideService({
    versionGate: null,
    workspaceRoot: root,
    initialSelected: "first",
  });
  setTransport({
    async getJson(path) {
      const read = routeRead(service.readContext, new URL(path, "http://localhost"));
      lastRead = read;
      const result = await read;
      if (!result) throw new Error(`Unexpected route: ${path}`);
      return { reached: true, body: result.body };
    },
    postJson: post,
    subscribe: () => () => {},
  });
});

afterEach(async () => {
  await lastRead;
  service.docsQa?.dispose();
  setTransport(createBrowserTransport());
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("reflects on-disk usage through the real reader, API and UI without writing a recording itself", async () => {
  const props = { onSelect: vi.fn(), onRetry: vi.fn() };
  const view = render(
    <StageModelsRail key="first" {...props} state={{ kind: "success", value: workflow() }} />,
  );
  await act(async () => {
    await lastRead;
  });
  expect(
    within(screen.getByTestId("stage-rail-item-code-generation")).getByText("担当: デフォルト"),
  ).toBeDefined();

  // A producer's file is a fixture here. No runtime hook or auto-save writer is simulated.
  const ledgerPath = join(root, "aidlc/.aidlc-sessions/usage-ledger.json");
  await mkdir(join(root, "aidlc/.aidlc-sessions"), { recursive: true });
  const content = JSON.stringify({
    schemaVersion: 3,
    workflows: {
      "intent:first-id": {
        byStage: { "code-generation": { byModel: { "fable-5.1": { tokens: { input: 7 } } } } },
      },
      "intent:second-id": {
        byStage: { "code-generation": { byModel: { "other-model": { tokens: { output: 3 } } } } },
      },
    },
  });
  await writeFile(ledgerPath, content);
  view.rerender(
    <StageModelsRail key="first" {...props} state={{ kind: "success", value: workflow() }} />,
  );
  expect(await screen.findByText("担当: fable-5.1")).toBeDefined();
  expect(screen.queryByText("担当: other-model")).toBeNull();

  expect((await service.selectIntent("second", "default")).status).toBe(200);
  view.rerender(
    <StageModelsRail key="second" {...props} state={{ kind: "success", value: workflow() }} />,
  );
  expect(screen.queryByText("担当: fable-5.1")).toBeNull();
  expect(await screen.findByText("担当: other-model")).toBeDefined();
  expect(screen.queryByLabelText("モデル設定の表示元")).toBeNull();

  await rm(ledgerPath);
  view.rerender(
    <StageModelsRail key="second" {...props} state={{ kind: "success", value: workflow() }} />,
  );
  await waitFor(() => expect(screen.queryByText("担当: other-model")).toBeNull());
  await act(async () => {
    await lastRead;
  });
  expect(
    within(screen.getByTestId("stage-rail-item-code-generation")).getByText("担当: デフォルト"),
  ).toBeDefined();
  expect(post).not.toHaveBeenCalled();
  await expect(readFile(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
});
