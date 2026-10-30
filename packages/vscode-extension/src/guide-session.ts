import path from "node:path";
import {
  createGuideService,
  type GuideService,
  routePost,
  routeRead,
  UNKNOWN_ROUTE,
} from "@andon/api-core";
import type { SpaceSelection, WsMessage } from "@andon/shared-types";
import {
  type ExtensionContext,
  type FileSystemWatcher,
  RelativePattern,
  type Webview,
  workspace,
} from "vscode";

export const SELECTED_INTENT_KEY = "andon.selectedIntent";
export const SPACE_SELECTION_KEY = "andon.spaceSelection";

export interface SelectedIntentPersist {
  get(): string | undefined;
  set(slug: string | null): void;
  getSelection?(): SpaceSelection | undefined;
  setSelection?(selection: SpaceSelection): void;
}

export function persistSelectedIntent(context: ExtensionContext): SelectedIntentPersist {
  return {
    getSelection: () => context.workspaceState.get<SpaceSelection>(SPACE_SELECTION_KEY),
    setSelection: (selection) => {
      void context.workspaceState.update(SPACE_SELECTION_KEY, selection).then(undefined, () => {});
    },
    get: () => context.workspaceState.get<string>(SELECTED_INTENT_KEY),
    set: (slug) => {
      void context.workspaceState.update(SELECTED_INTENT_KEY, slug).then(undefined, () => {
        // Persist is best-effort; the in-memory pin stays.
      });
    },
  };
}

/** One workspace session — api-core in-process, push to every subscribed webview. */
export class GuideSession {
  readonly service: GuideService;
  private unwatch: () => void;
  private readonly creationWatcher: FileSystemWatcher;
  private disposed = false;
  private closing: Promise<void> | undefined;
  private readonly webviews = new Set<Webview>();
  private readonly pushClient = {
    send: (data: string) => {
      let message: WsMessage;
      try {
        message = JSON.parse(data) as WsMessage;
      } catch {
        return;
      }
      for (const webview of this.webviews) {
        void webview.postMessage({ type: "push", message });
      }
    },
  };

  constructor(
    workspaceRoot: string,
    officialDocsRoot: string = workspaceRoot,
    persist?: SelectedIntentPersist,
  ) {
    const initialSelection = persist?.getSelection?.();
    this.service = createGuideService({
      workspaceRoot,
      officialDocsRoot,
      canEdit: () => workspace.isTrusted,
      initialSelected: persist?.get() ?? null,
      ...(persist?.setSelection ? {} : { onSelect: persist?.set }),
      ...(initialSelection ? { initialSelection } : {}),
      ...(persist?.setSelection ? { onSelection: persist.setSelection } : {}),
    });
    this.service.hub.add(this.pushClient);
    this.creationWatcher = workspace.createFileSystemWatcher(
      new RelativePattern(workspaceRoot, "aidlc/spaces/*/intents/*/aidlc-state.md"),
      false,
      true,
      true,
    );
    this.creationWatcher.onDidCreate((uri) => {
      void this.onRecordCreated(uri.fsPath).catch(() => {
        if (!this.disposed)
          this.service.hub.broadcast({
            type: "live-status",
            degraded: true,
            reason: "watcher-lost",
          });
      });
    });
    this.service.startMatrixBackground();
    this.unwatch = this.service.startWatch();
  }

  /** A session created before setup has no record watcher until the first state file appears. */
  private async onRecordCreated(file: string): Promise<void> {
    const record = await this.service.readContext.recordDir();
    if (this.disposed || !("ok" in record) || path.dirname(file) !== record.value) return;
    this.unwatch();
    this.unwatch = this.service.startWatch();
    await this.service.hub.handleWatchEvent(
      { type: "change", scope: "state", path: file },
      () => !this.disposed,
    );
  }

  subscribe(webview: Webview): () => void {
    this.webviews.add(webview);
    void webview.postMessage({ type: "connected" });
    return () => {
      this.webviews.delete(webview);
    };
  }

  async handleGet(path: string): Promise<{ reached: true; body: unknown } | { reached: false }> {
    try {
      const url = new URL(path, "http://andon.local");
      if (url.pathname === "/api/docs-qa/tools" && !workspace.isTrusted)
        return { reached: true, body: { error: true, reason: "workspace-untrusted" } };
      const result = await routeRead(this.service.readContext, url);
      if (result === null) return { reached: false };
      return { reached: true, body: result.body };
    } catch {
      return { reached: false };
    }
  }

  async handlePost(
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    if (
      (path === "/api/docs-qa/ask" || path.startsWith("/api/customization/")) &&
      !workspace.isTrusted
    ) {
      return { ok: false, status: 403, body: { error: true, reason: "workspace-untrusted" } };
    }
    const result = await routePost(this.service, path, body);
    if (result === null) return { ok: false, ...UNKNOWN_ROUTE };
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      body: result.body,
    };
  }

  dispose(): void {
    void this.close();
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.disposed = true;
    this.closing = (async () => {
      this.creationWatcher.dispose();
      this.service.docsQa?.dispose();
      this.unwatch();
      this.service.hub.remove(this.pushClient);
      this.webviews.clear();
    })();
    closingSessions.add(this.closing);
    const closing = this.closing;
    void closing.then(
      () => closingSessions.delete(closing),
      (error) => {
        // Disposable callers cannot await failure. Keep it for deactivation too.
        console.error("Andon session shutdown failed", error);
      },
    );
    return closing;
  }
}

const sessions = new Map<string, GuideSession>();
const owners = new Map<GuideSession, number>();
const closingSessions = new Set<Promise<void>>();

/** Keep a shared watcher alive only while a status bar or dashboard owns it. */
export function acquireSession(
  workspaceRoot: string,
  officialDocsRoot: string = workspaceRoot,
  persist?: SelectedIntentPersist,
): { session: GuideSession; dispose(): void } {
  const session = getOrCreateSession(workspaceRoot, officialDocsRoot, persist);
  owners.set(session, (owners.get(session) ?? 0) + 1);
  let released = false;
  return {
    session,
    dispose() {
      if (released) return;
      released = true;
      if (sessions.get(workspaceRoot) !== session) return;
      const remaining = (owners.get(session) ?? 1) - 1;
      if (remaining === 0) disposeSession(workspaceRoot);
      else owners.set(session, remaining);
    },
  };
}

export function getOrCreateSession(
  workspaceRoot: string,
  officialDocsRoot: string = workspaceRoot,
  persist?: SelectedIntentPersist,
): GuideSession {
  let session = sessions.get(workspaceRoot);
  if (session === undefined) {
    session = new GuideSession(workspaceRoot, officialDocsRoot, persist);
    sessions.set(workspaceRoot, session);
  }
  return session;
}

function disposeSession(workspaceRoot: string): void {
  const session = sessions.get(workspaceRoot);
  if (session === undefined) return;
  session.dispose();
  owners.delete(session);
  sessions.delete(workspaceRoot);
}

export function disposeAllSessions(): void {
  for (const root of [...sessions.keys()]) disposeSession(root);
}

/** Await sessions already released by a panel as well as currently owned ones. */
export async function closeAllSessions(): Promise<void> {
  disposeAllSessions();
  const pending = [...closingSessions];
  const results = await Promise.allSettled(pending);
  for (const closing of pending) closingSessions.delete(closing);
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0) throw new AggregateError(errors, "Failed to close Andon sessions");
}
