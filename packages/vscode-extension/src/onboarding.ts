import { existsSync } from "node:fs";
import {
  advanceOnboardingVersion,
  applyOnboardingEvent,
  initialOnboardingRecord,
  type OnboardingRecord,
  type OnboardingSnapshot,
  type OnboardingView,
  parseOnboardingEvent,
  parseOnboardingRecord,
  unseenNews,
  WHATS_NEW,
} from "@aidlc-guide/shared-types";
import type { ExtensionContext } from "vscode";

/**
 * Per-user onboarding progress. User scope on purpose: the welcome page and
 * the 更新情報 announcement are about this person and this extension, not
 * about one folder, and nothing here is written to a workspace (NFR-1).
 */
export const ONBOARDING_KEY = "aidlc-guide.onboarding.v1";

/** Button of the update notification. */
export const WHATS_NEW_ACTION = "更新情報を見る";

type Storage = Pick<ExtensionContext, "globalState" | "workspaceState"> &
  Partial<Pick<ExtensionContext, "globalStorageUri">>;

export interface OnboardingStart {
  record: OnboardingRecord;
  /** The version changed since the last start, or an existing user is seen for the first time. */
  updated: boolean;
}

const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;

/** The running extension version, or `0.0.0` when the manifest is unreadable. */
export function extensionVersion(context: Pick<ExtensionContext, "extension">): string {
  const version: unknown = context.extension?.packageJSON?.version;
  return typeof version === "string" && VERSION_RE.test(version) ? version : "0.0.0";
}

/**
 * Whether an earlier Andon already ran for this person. Any value it
 * stored counts, for the person or for this workspace, and so does its user
 * storage folder, which the in-extension update has created since 0.27. A
 * first-time user has none of them yet, because this check runs at
 * activation, before setup or the dashboard.
 *
 * Someone who only used other folders, never used a user-level feature and
 * installed this version by hand leaves nothing here to tell them apart, and
 * is greeted as new.
 */
export function detectPriorUse(context: Storage): boolean {
  const userFolder = context.globalStorageUri?.fsPath;
  return (
    context.globalState.keys().length > 0 ||
    context.workspaceState.keys().length > 0 ||
    (userFolder !== undefined && existsSync(userFolder))
  );
}

function storedRecord(context: Pick<ExtensionContext, "globalState">): OnboardingRecord | null {
  return parseOnboardingRecord(context.globalState.get(ONBOARDING_KEY));
}

/**
 * Stand-in when nothing is stored at a later point than activation. It does
 * not greet: by then setup has run, so a missing record is a storage problem,
 * not a new user.
 */
function quietRecord(version: string): OnboardingRecord {
  return initialOnboardingRecord({ version, priorUse: true, entries: WHATS_NEW });
}

/**
 * Run once per activation: create the record, or record the running version.
 * Nothing waits before `update`, which VS Code applies to what `get` returns
 * at once: a dashboard that becomes ready meanwhile reads this record.
 */
export async function startOnboarding(context: Storage, version: string): Promise<OnboardingStart> {
  const stored = storedRecord(context);
  if (stored === null) {
    const priorUse = detectPriorUse(context);
    const record = initialOnboardingRecord({ version, priorUse, entries: WHATS_NEW });
    await context.globalState.update(ONBOARDING_KEY, record);
    return { record, updated: priorUse };
  }
  const { record, previousVersion } = advanceOnboardingVersion(stored, version);
  if (previousVersion !== null) await context.globalState.update(ONBOARDING_KEY, record);
  return { record, updated: previousVersion !== null };
}

/** What a dashboard panel receives on `ready`. Read-only: never writes storage. */
export function onboardingSnapshot(
  context: Pick<ExtensionContext, "globalState">,
  version: string,
  open?: OnboardingView,
): OnboardingSnapshot {
  const record = storedRecord(context) ?? quietRecord(version);
  return open === undefined ? { version, record } : { version, record, open };
}

/**
 * Apply one webview event after validating it. Returns `false` for an
 * invalid event. Writes only when the record actually changes. Reading,
 * applying and `update` happen without waiting in between, so events from
 * two dashboards cannot overwrite each other.
 */
export async function recordOnboardingEvent(
  context: Pick<ExtensionContext, "globalState">,
  version: string,
  message: unknown,
): Promise<boolean> {
  const event = parseOnboardingEvent(message);
  if (event === null) return false;
  const current = storedRecord(context) ?? quietRecord(version);
  const next = applyOnboardingEvent(current, event, WHATS_NEW);
  if (next !== current) await context.globalState.update(ONBOARDING_KEY, next);
  return true;
}

/** The notification after an update, or `null` when there is nothing new to point at. */
export function updateNotice(start: OnboardingStart, version: string): string | null {
  if (!start.updated) return null;
  const fresh = unseenNews(WHATS_NEW, start.record);
  const first = fresh[0];
  if (first === undefined) return null;
  const rest = fresh.length > 1 ? `（ほか ${fresh.length - 1} 件）` : "";
  return `Andon を ${version} に更新しました。新機能：${first.title}${rest}`;
}
