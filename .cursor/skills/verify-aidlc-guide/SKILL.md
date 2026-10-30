---
name: verify-aidlc-guide
description: Drive the Andon dashboard the way a user does (local dashboard-server SPA in a browser). Use when proving a UI change, reproducing a dashboard bug, or checking Now strip, docs, settings, or effectiveness against the real app — not unit tests.
---

# Verify Andon

Primary user surface is the VS Code / Cursor extension webview. Agents cannot drive that host reliably. The same Dashboard SPA is served by the development-only `packages/dashboard-server` (not offered to users; there is no `bun run dashboard` script). **Verify against that local server**, from the repo root, in a browser. Header destinations always live in the waffle menu (`header-menu-trigger`); width does not change the nav shape.

Other surfaces, not this skill's default drive path:

- Extension Development Host (`bun run build:extension`, then F5) — real install/update flows live only here.
- MCP server, `bun .cursor/tools/aidlc-utility.ts doctor` — separate CLIs; do not treat their stdout as Dashboard proof.

## Launch

From the repo root:

```bash
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts launch
```

That command is idempotent. It starts `packages/dashboard-server/src/cli.ts --port 0` with `cwd` = repo root (so it reads this checkout's `aidlc/`). It builds `packages/dashboard` when `dist/index.html` or a referenced `/assets/*` file is missing. After Dashboard UI source changes, run `bun run build:dashboard` yourself before `launch`, or you will drive a stale SPA. Waits for:

```text
Andon dashboard: http://127.0.0.1:<port>
```

and writes `.cursor/skills/verify-aidlc-guide/.run.json` atomically (temp file, then replace). The child stays referenced until that write succeeds; a persist failure, a missed ready line, or a missing start key kills the spawn handle and waits for that pid (SIGKILL if SIGTERM is ignored) so `stop` is not left without a record. `launch` reuses that pid only when the origin is still this SPA **and** a fingerprint of `packages/dashboard-server`, `api-core`, `reader-core`, `docs-bridge`, `official-docs`, `core-utils`, and `shared-types` sources — plus each of those `package.json` files, `docs-bridge/data` (`agent-map.json`, `artifact-map.json`, `bridge-map.json`), and the workspace `bun.lock` — still matches (path + size + mtime of every file, so deletions and dependency resolution changes both force a respawn; Bun does not reload them). A truncated or malformed `.run.json` is not treated as absent: `launch` / `doctor` / `origin` / `stop` fail and leave the file so a still-running pid is not orphaned. The server binds `127.0.0.1` only. Never start on the default `4700` unless this harness printed that port. Print `origin` from the JSON; do not guess.

Ready means the ready line printed **and** `doctor` is green. A listening port with API-only mode (`packages/dashboard/dist/` missing) is not a UI instance.

Teardown is `stop` (Cleanup). Do not leave a launched pid running after the proof.

## Doctor

Run this first whenever the page looks wrong, the origin is unknown, or a previous run may still be up:

```bash
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts doctor
```

Pass only when all of these hold:

- `.run.json` exists, is readable JSON with a `pid` and `origin`, that pid is still alive, **and** `{origin}` still serves this Dashboard SPA (`Andon` + `#root`). A live PID alone is not enough — the OS may have reused it. `doctor` / `origin` / `launch` reuse also require the stored OS start identity to still match that pid. Malformed JSON is an error, not a missing run.
- `GET {origin}/` is 200 and the HTML includes `id="root"` (SPA, not API-only) **and** each bundled `/assets/*` reference returns 200 with a non-HTML content type (the static server falls back to `index.html` for unknown paths, so a 200 HTML body is a missing bundle, not a healthy asset). Connection refusal, a hung header/body read (8s abort), or a non-HTML body fails as `{ ok: false }` JSON, not an uncaught exception. `launch` reuse uses the same deadline; `stop` does not require a healthy origin.
- `GET {origin}/api/workflow` is 200 JSON that is one of: a `{ workflow, nextStep }` payload; a typed `{ error: true, reason: string }` (`no-selected-intent`, `no-active-intent`, `state-missing`, …); or `{ unsupported: true, version }` when the workspace state version is not current. HTTP 200 with any of those bodies is still a healthy instance; a dead port, non-JSON, or `{ error: true }` without `reason` is not. This checkout gitignores `active-intent`, so a fresh server often returns `no-selected-intent` until the Intent picker pins one.

`origin` prints the recorded URL:

```bash
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts origin
```

Refuse to drive any URL that is not this origin. A dashboard already open on `:4700` from a human is not this run.

## Drive

1. `launch` then `doctor`.
2. Open `{origin}` in the Cursor browser (or any Chromium) at **1280×800** for screenshots. Header nav is the waffle `button[aria-label="メニュー"]` (`data-testid="header-menu-trigger"`) at every width — open it, then pick a destination.
3. Wait until `[data-testid="app-shell"]` exists. If `[data-testid="intent-dialog"]` is open (no view pin yet), pick a listed intent or close the dialog — do not click through it blindly.
4. Follow the matching file under [features/](features/README.md). Prefer `data-testid` and accessible names already in the SPA. Do not use coordinates.
5. One structural action, then a fresh snapshot. Do not poke React state or call `/api/*` as a substitute for the click the user would make. `GET /api/workflow` is allowed as a **second** view of the same fact after the UI shows it.

Stable handles (not a complete list):

| Control | Handle |
|---|---|
| App root | `[data-testid="app-shell"]` |
| Stage list heading | heading `ステージ一覧` |
| Current stage | `[data-testid="now-current-stage"]` (prefix text `現在のステージ：`) |
| Menu | `button` name `メニュー` (`header-menu-trigger`) |
| Home | menuitem `ステージ一覧` (`header-home`) |
| Docs | menuitem `ドキュメント` (`official-docs-open`) |
| Effectiveness | menuitem `効果測定` (`effectiveness-open`) |
| Customization | menuitem `カスタマイズ` (`customization-open`) |
| Settings | menuitem `設定` (`settings-open`) |
| Intent picker | `[data-testid="intent-picker-trigger"]` |
| Stage row | `[data-testid="stage-rail-item-<slug>"]` |
| Docs home | `[data-testid="docs-home"]` |
| Settings page | `[data-testid="settings-page"]` |
| Effectiveness panel | `[data-testid="effectiveness-panel"]` |

Do not POST `/api/answer` against this checkout. The Answer editor writes `[Answer]:` lines in real `*-questions.md` files. Intent switching (`POST /api/select-intent`) is an in-memory view pin on **this server only**; it does not rewrite `active-intent`. Still prefer the Intent picker UI over curling it.

Two servers can bind different ports. They **share** the workspace tree if `cwd` is this repo. Do not double-drive: one harness run at a time. `launch` reuses a live pid instead of starting a second copy.

## Evidence

Write under the run's `evidenceDir` from `launch` / `doctor` JSON (`.cursor/skills/verify-aidlc-guide/evidence/<id>/`). Cleanup must not delete that directory. Cursor's `browser_take_screenshot` writes under the OS temp screenshots folder; copy the file into `evidenceDir` yourself.

Proof standards:

- Exercise the real click path. A green `bun test` or a raw `GET /api/workflow` without opening the SPA is not Dashboard proof.
- Capture the action and the resulting state: accessibility snapshot (or equivalent role dump) **and** a screenshot that shows the `Andon` shell (`app-shell`, header or Now strip).
- Save `GET {origin}/api/workflow` JSON next to the screenshot when the claim is about the current stage, scope, or completion counts — that is the second view of the stored workflow, not a mock.
- Name files `{feature-id}-{step}.{png|aria.txt|json}`. Record the feature id and entry point in a short `PROOF.md` in the same folder.

## Cleanup

```bash
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts stop
```

Kills **only** the pid in `.run.json` **and** only when the OS start identity stored at spawn still matches that pid. Origin HTTP is for reuse / `doctor` / `origin`, not for authorizing a kill — a hung or API-only origin must still be stoppable. `launch` refuses to persist a run whose start identity could not be read (it kills that child via the spawn handle instead). If the key is missing or does not match, `stop` / `launch` keep `.run.json` and fail instead of sending a signal. After a signal, wait until that same `processStartKey` is gone (or the pid is dead) before deleting the run file; if it is still the same process after 8s, keep the file and fail. Leaves `evidenceDir` in place. If there is no run file, exit 0. Never `taskkill` / `pkill` by image name (`bun`, `aidlc-dashboard`).

After a failed attempt, `stop` before the next `launch` so ports and pids are not stranded. `launch` will also skip a dead run file.

## Helpers

All four verbs print JSON.

```bash
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts launch
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts doctor
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts origin
bun .cursor/skills/verify-aidlc-guide/scripts/harness.ts stop
```
