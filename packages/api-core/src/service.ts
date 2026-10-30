import path from "node:path";
import { type Bridge, CONFIG_FILENAME, createBridge } from "@aidlc-guide/docs-bridge";
import {
  createReader,
  intentsDirOf,
  isSwitchableSpaceName,
  listSpaces,
  readActiveSpace,
  type Reader,
  resolveIntents,
  watchSelection,
} from "@aidlc-guide/reader-core";
import type {
  IntentList,
  Matrix,
  MatrixCell,
  ReadResult,
  VersionGate,
  SpaceCatalog,
  SpaceSelection,
} from "@aidlc-guide/shared-types";
import { createSpaceEngine, type SpaceEngine } from "./spaces/engine.ts";
import type { CustomizationEngine } from "./customization/engine-adapter.ts";
import { type CustomizationService, createCustomizationService } from "./customization/index.ts";
import { CustomizationError } from "./customization/model.ts";
import { createDocsQaService, type DocsQaService } from "./docs-qa/index.ts";
import type { AnswerContext } from "./handlers/answer-writer.ts";
import type { ReadContext, RouteResult } from "./handlers/read.ts";
import { createHub, type Hub } from "./push.ts";
import { electSelected, isIntentDirName } from "./select.ts";
import { createVersionGateCheck } from "./version-gate.ts";

export interface GuideServiceConfig {
  spaceEngine?: SpaceEngine;
  initialSelection?: SpaceSelection;
  onSelection?: (selection: SpaceSelection) => void;
  customizationEngine?: CustomizationEngine;
  canEdit?: () => boolean;
  /** Workspace whose `aidlc/` tree is read. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /**
   * Root for bundled official docs (`docs/guide|reference` + manifest).
   * Defaults to {@link workspaceRoot}. Pass the extension media snapshot when
   * hosting inside a packaged VSIX.
   */
  officialDocsRoot?: string;
  /** Pin the record instead of resolving the view pin (tests). */
  recordDir?: string;
  /** Watch debounce; forwarded to reader-core. */
  debounceMs?: number;
  /** Restored view-pin slug (VS Code workspaceState). */
  initialSelected?: string | null;
  /** Persist the pin. Failures must not revert the in-memory pin. */
  onSelect?: (slug: string | null) => void;
  /**
   * The version check (docs/maintenance/version-gate-design.md). Omitted, the
   * workspace is checked against the Guide's supported release; only an
   * explicit `null` switches checking off (tests on bare fixtures).
   */
  versionGate?: (() => VersionGate) | null;
}

export interface GuideService {
  switchSpace(body: unknown): Promise<RouteResult>;
  customization?: CustomizationService;
  docsQa?: DocsQaService;
  reader: Reader;
  bridge: Bridge;
  hub: Hub;
  readContext: ReadContext;
  answerContext: AnswerContext;
  /** Stage 2: background matrix scan + matrix-ready broadcast. */
  startMatrixBackground(): void;
  /** Stage 6: file watch → hub push. Returns unwatch. */
  startWatch(): () => void;
  /** Set the view pin. Does not write `active-intent`. */
  selectIntent(name: string, expectedSpace: string): Promise<RouteResult>;
  /** The current version check; null when switched off. */
  versionGate(): VersionGate | null;
  /** Forget the cached check, e.g. after an update or a harness file change. */
  invalidateVersionGate(): void;
}

export function createGuideService(config: GuideServiceConfig = {}): GuideService {
  const workspaceRoot = config.workspaceRoot ?? process.cwd();
  const officialDocsRoot = config.officialDocsRoot ?? workspaceRoot;
  const gateCheck = createVersionGateCheck(workspaceRoot, config.versionGate);
  const pushAllowed = (): boolean => {
    const gate = gateCheck.current();
    return gate === null || gate.status === "ok";
  };
  const docsQa = createDocsQaService({
    docsRoot: officialDocsRoot,
  });
  const customization = createCustomizationService({
    workspaceRoot,
    ...(config.customizationEngine ? { engine: config.customizationEngine } : {}),
    ...(config.canEdit ? { canEdit: config.canEdit } : {}),
    onChange: () => hub.broadcast({ type: "customization-changed" }),
  });
  let pin: string | null = config.initialSelected ?? null;
  let pinSpace: string | null = null;
  const pins = new Map<string, string | null>();
  if (config.initialSelection)
    pins.set(config.initialSelection.space, config.initialSelection.intent);
  const spaceEngine = config.spaceEngine ?? createSpaceEngine(workspaceRoot);
  let selectionGeneration = 0;

  const persist = (next: string | null): void => {
    try {
      config.onSelect?.(next);
      if (pinSpace !== null) config.onSelection?.({ space: pinSpace, intent: next });
    } catch {
      // Persist is best-effort; the in-memory pin stays.
    }
  };

  const readSelection = async (): Promise<ReadResult<IntentList>> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const generation = selectionGeneration;
      const intents = await resolveIntents(workspaceRoot);
      // Local switches/pins and external cursor writes can both overtake a directory scan.
      const active = await readActiveSpace(workspaceRoot);
      if (generation !== selectionGeneration) continue;
      if (!("ok" in active)) return active;
      if (!("ok" in intents)) return intents;
      const space = intents.value.space;
      if (active.value !== space) continue;
      // No await between this freshness check and adopting/persisting the selection.
      if (pinSpace === null && !config.initialSelection && config.initialSelected)
        pins.set(space, config.initialSelected);
      const next = electSelected(intents.value.all, pins.get(space) ?? null);
      if (space !== pinSpace || next !== pin) adoptPin(next, space);
      return { ...intents, value: { ...intents.value, selected: next } };
    }
    return { error: true, reason: "selection-changed" };
  };

  const recordDirFromPin = async (): Promise<ReadResult<string>> => {
    if (config.recordDir !== undefined) return { ok: true, value: config.recordDir };
    const intents = await readSelection();
    if (!("ok" in intents)) return intents;
    const next = intents.value.selected;
    if (next === null) {
      return {
        error: true,
        reason: intents.value.all.length === 0 ? "no-active-intent" : "no-selected-intent",
      };
    }
    return {
      ok: true,
      value: path.join(intentsDirOf(workspaceRoot, intents.value.space), next),
    };
  };

  const reader = createReader(workspaceRoot, {
    recordDir: config.recordDir ?? recordDirFromPin,
  });
  const bridge = createBridge(path.join(workspaceRoot, CONFIG_FILENAME));

  let matrixCache: ReadResult<Matrix> | null = null;
  let matrixGeneration = 0;
  // Unit changes can arrive before the startup scan finishes. Overlay both
  // pending invalidations and completed rows on that scan before exposing it.
  const matrixUnitUpdates = new Map<string, readonly MatrixCell[] | null>();

  const withUnitUpdates = (result: ReadResult<Matrix>): ReadResult<Matrix> => {
    if (!("ok" in result) || matrixUnitUpdates.size === 0) return result;
    let cells = result.value.cells;
    const units = new Set(result.value.units);
    for (const [unit, updated] of matrixUnitUpdates) {
      if (updated === null) {
        cells = cells.map((cell) => (cell.unit === unit ? { ...cell, verdict: null } : cell));
      } else {
        cells = [...cells.filter((cell) => cell.unit !== unit), ...updated];
        if (updated.length > 0) units.add(unit);
      }
    }
    return { ...result, value: { ...result.value, units: [...units].sort(), cells } };
  };

  const hub = createHub({
    reader,
    allowPush: pushAllowed,
    recordDir: recordDirFromPin,
    onMatrixInvalidated(units) {
      if (units === undefined) {
        matrixGeneration += 1;
        matrixCache = null;
        matrixUnitUpdates.clear();
      } else {
        for (const unit of units) matrixUnitUpdates.set(unit, null);
        if (matrixCache !== null) matrixCache = withUnitUpdates(matrixCache);
      }
    },
    onMatrix(result) {
      matrixCache = result;
      matrixUnitUpdates.clear();
      // A client can connect while the cache is invalidated. Publish a full
      // model so it can leave its loading state before applying Unit patches.
      if ("ok" in result) hub.broadcast({ type: "matrix-ready", matrix: result.value });
    },
    onMatrixUnits(units, cells) {
      for (const unit of units)
        matrixUnitUpdates.set(
          unit,
          cells.filter((cell) => cell.unit === unit),
        );
      if (matrixCache !== null) matrixCache = withUnitUpdates(matrixCache);
    },
  });

  const readContext: ReadContext = {
    ...(config.recordDir === undefined ? { intents: readSelection } : {}),
    spaces: async (): Promise<ReadResult<SpaceCatalog>> => {
      const spaces = await listSpaces(workspaceRoot);
      if (!("ok" in spaces)) return spaces;
      const canSwitch = config.canEdit?.() !== false;
      const harnesses = canSwitch ? await spaceEngine.harnesses() : [];
      return {
        ok: true,
        value: { ...spaces.value, harnesses, canSwitch: canSwitch && harnesses.length > 0 },
      };
    },
    customization,
    docsQa,
    reader,
    bridge,
    workspaceRoot,
    officialDocsRoot,
    recordDir: recordDirFromPin,
    selected: () => pin,
    matrix: () => matrixCache,
    versionGate: () => gateCheck.current(),
  };

  const answerContext: AnswerContext = {
    recordDir: recordDirFromPin,
  };

  const watchOptions = config.debounceMs === undefined ? {} : { debounceMs: config.debounceMs };
  let unwatch: (() => void) | null = null;
  let watchGeneration = 0;
  let selectChain: Promise<void> = Promise.resolve();

  function startMatrixBackground(): void {
    const generation = ++matrixGeneration;
    queueMicrotask(() => {
      void reader.getMatrix().then((result) => {
        if (generation !== matrixGeneration) return;
        matrixCache = withUnitUpdates(result);
        if ("ok" in matrixCache) hub.broadcast({ type: "matrix-ready", matrix: matrixCache.value });
      });
    });
  }

  function rebindWatch(): void {
    unwatch?.();
    unwatch = null;
    const generation = ++watchGeneration;
    // reader.watch resolves recordDir() (and elects a lone record) itself.
    // Skipping here when pin is still null would miss that election and
    // leave dashboard-server with no watcher until a later selectIntent.
    unwatch = reader.watch((event) => {
      const gen = generation;
      if (gen !== watchGeneration) return;
      void hub.handleWatchEvent(event, () => gen === watchGeneration);
    }, watchOptions);
  }

  function adoptPin(next: string | null, space: string): void {
    const spaceChanged = pinSpace !== null && space !== pinSpace;
    const changed = next !== pin || spaceChanged;
    if (space !== pinSpace || next !== pin) selectionGeneration += 1;
    pinSpace = space;
    pin = next;
    pins.set(space, next);
    persist(pin);
    if (!changed) return;
    matrixCache = null;
    matrixUnitUpdates.clear();
    if (unwatch !== null) rebindWatch();
    startMatrixBackground();
    hub.broadcast(
      spaceChanged
        ? { type: "space-selected", space, intent: next }
        : { type: "intent-selected", intent: next },
    );
  }

  const listedIntents = readSelection;

  const runSelect = async (name: string, expectedSpace: string): Promise<RouteResult> => {
    const intents = await resolveIntents(workspaceRoot);
    if (!("ok" in intents)) return { status: 400, body: intents };
    if (intents.value.space !== expectedSpace)
      return failure(
        409,
        "space-conflict",
        "作業スペースが変更されました。一覧を読み直してください。",
      );
    if (!isIntentDirName(name, intents.value.all)) {
      return { status: 400, body: { error: true, reason: "bad-request" } };
    }
    adoptPin(name, intents.value.space);
    const listed = await listedIntents();
    return { status: 200, body: listed };
  };

  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    const previous = selectChain;
    let release = () => {};
    selectChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  };
  const failure = (status: number, reason: string, message: string): RouteResult => ({
    status,
    body: { error: true, reason, message },
  });
  const runSwitch = async (body: unknown): Promise<RouteResult> => {
    if (config.canEdit?.() === false)
      return failure(
        403,
        "workspace-untrusted",
        "ワークスペースを信頼してから切り替えてください。",
      );
    if (!body || typeof body !== "object")
      return failure(400, "bad-request", "スペースとツールを選んでください。");
    const { space, expectedSpace, harness } = body as Record<string, unknown>;
    if (
      typeof space !== "string" ||
      !isSwitchableSpaceName(space) ||
      typeof expectedSpace !== "string" ||
      typeof harness !== "string"
    )
      return failure(400, "bad-request", "スペースとツールを選んでください。");
    try {
      // save/recover hold this cross-process lock from snapshot through completion.
      // Check both the cursor and recovery receipts only after acquiring it.
      return await customization.storage.withLock(
        "apply",
        async () => {
          customization.assertEditable();
          const catalog = await readContext.spaces!();
          if (!("ok" in catalog))
            return failure(409, "spaces-unreadable", "スペース一覧を読み直してください。");
          if (
            !catalog.value.spaces.includes(space) ||
            !catalog.value.harnesses.some((item) => item.id === harness)
          )
            return failure(
              400,
              "bad-request",
              "存在するスペースと導入済みのツールを選んでください。",
            );
          if (catalog.value.active !== expectedSpace)
            return failure(
              409,
              "space-conflict",
              "作業スペースが変更されました。一覧を読み直してください。",
            );
          if (await customization.activeOperation())
            return failure(
              409,
              "customization-busy",
              "カスタマイズの保存・復旧が完了してから切り替えてください。",
            );
          await recordDirFromPin();
          selectionGeneration += 1;
          try {
            await spaceEngine.switch(space, harness);
            const after = await listSpaces(workspaceRoot);
            if (!("ok" in after) || after.value.active !== space)
              return failure(
                409,
                "space-switch-unconfirmed",
                "切り替え結果を確認できません。一覧を読み直してください。",
              );
            await recordDirFromPin();
            return { status: 200, body: await listedIntents() };
          } finally {
            selectionGeneration += 1;
            // A failed utility may already have moved the shared cursor.
            await recordDirFromPin();
          }
        },
        { wait: false },
      );
    } catch (error) {
      if (error instanceof CustomizationError && error.code === "operation-active")
        return failure(
          409,
          "customization-busy",
          "カスタマイズの保存・復旧が完了してから切り替えてください。",
        );
      return failure(
        409,
        "space-switch-failed",
        error instanceof Error ? error.message : "スペースを切り替えられませんでした。",
      );
    }
  };

  return {
    customization,
    docsQa,
    reader,
    bridge,
    hub,
    readContext,
    answerContext,
    startMatrixBackground,
    versionGate: () => gateCheck.current(),
    invalidateVersionGate: () => gateCheck.invalidate(),
    startWatch() {
      rebindWatch();
      const stopSelection =
        config.recordDir === undefined
          ? watchSelection(
              workspaceRoot,
              () => {
                void exclusive(async () => {
                  await recordDirFromPin();
                }).catch(() =>
                  hub.broadcast({
                    type: "live-status",
                    degraded: true,
                    reason: "selection-unreadable",
                  }),
                );
              },
              () => hub.broadcast({ type: "live-status", degraded: true, reason: "watcher-lost" }),
            )
          : () => {};
      return () => {
        stopSelection();
        watchGeneration += 1;
        unwatch?.();
        unwatch = null;
      };
    },
    selectIntent: (name, expectedSpace) => exclusive(() => runSelect(name, expectedSpace)),
    switchSpace: (body) => exclusive(() => runSwitch(body)),
  };
}
