# Home and current stage

Home is the first screen after the dashboard loads: the Now strip names the current stage (or a typed empty state) and the stage list heading `ステージ一覧` sits above the rail.

## Sub-features

- `home-paint` shows `app-shell` and the `ステージ一覧` heading.
- `now-current` shows `現在のステージ：` plus the current slug, `ワークフロー完了`, or `現在のステージなし`.
- `now-expand` reveals phase, scope, and done counts.
- `rail-list` lists stages as `stage-rail-item-<slug>` rows when a workflow parsed.

## How to get to it (user POV)

- Open the dashboard URL the harness printed.
- From any other Dashboard page, open header `メニュー` then `ステージ一覧`.

## Driving it with the Andon harness

Preconditions:

- `harness.ts doctor` is green.
- Browser is 1280×800 on `{origin}`.
- If `インテント一覧` is open, choose one intent so home is not covered, or close the dialog and note that Now strip may show empty until a pin exists. `GET /api/workflow` returning `{ error: true, reason: "no-selected-intent" }` is the matching API state, not a failed launch.

- **Confirm shell.** After load, `[data-testid="app-shell"]` exists and a heading `ステージ一覧` is visible. Screenshot `home-now-strip-paint.png`.
- **Unselected intent.** If `GET {origin}/api/workflow` is `{ error: true, reason: "no-selected-intent" }` (or the dialog was closed without a pin), do **not** look for `[data-testid="now-current-stage"]` or `[data-testid="now-toggle"]`. Proof is the empty title `インテントを選んでください` plus the saved JSON. Then pin an intent from `インテント一覧` and wait until the dialog closes before the next bullets.
- **Unsupported workspace.** If the JSON is `{ unsupported: true, version }`, save it as `home-now-strip-workflow.json`. Do not treat Now strip or the rail as workflow proof. Report `unsupported-workspace` and stop this feature.
- **Read current stage.** After a pin, save `GET {origin}/api/workflow` as `home-now-strip-workflow.json`. If it is a typed error (`{ error: true, reason }`), do **not** look for `[data-testid="now-current-stage"]` or `[data-testid="now-toggle"]`. Empty reasons (`no-selected-intent`, `no-active-intent`, `state-missing`) render EmptyState: title `インテントを選んでください` for `no-selected-intent`, otherwise `ワークフローはまだありません`. Any other reason (for example `state-unreadable`) renders `AreaError` — heading `読み込みエラー` plus the reason-specific detail (`状態ファイルを読み取れません` for `state-unreadable`). Do not require empty-state titles on those errors. If it is a workflow payload, find `[data-testid="now-current-stage"]`. If `workflow.currentStage` is a non-null slug, the strip text must equal that slug. If it is `null`, the strip shows `ワークフロー完了` when `total > 0` and `done >= total`, otherwise `現在のステージなし` — do not require the JSON `null` to equal the Japanese copy.
- **Expand Now strip.** Skip when the payload was a typed error (no toggle). Otherwise click `[data-testid="now-toggle"]`. `[data-testid="now-scope"]` and `[data-testid="done-total"]` appear. ARIA snapshot to `home-now-strip-expanded.aria.txt`.
- **Scan the rail.** A `stage-rail-item-*` node exists for at least the current stage when `workflow.stages` has rows. If the payload is an empty typed reason, the rail hint is the proof. If it is any other typed error, the rail `読み込みエラー` region is the proof. If it is an unsupported workspace, that report is the proof. Do not invent rows.
- **Home from elsewhere.** Open `メニュー` → `ドキュメント`, then `メニュー` → `ステージ一覧`. `[data-testid="docs-home"]` is gone and the stage list heading is visible again.

## Gotchas

- Destinations are never inline header buttons. Always open `header-menu-trigger` (`メニュー`) first.
- Intent dialog can sit on top of home on first paint. Closing it without selecting may leave Now strip empty even when `aidlc-state.md` exists on disk — the dashboard view pin is not the gitignored `active-intent` cursor. The dialog also has `効果測定を見る`. Intent rows disable while `select-intent` is in flight; wait until the dialog closes.
- `now-current-stage` showing `ワークフロー完了` is success for a finished intent, not a missing strip. A completed current stage still shows its slug (for example `performance-validation`) with a completed chip.
- Do not treat `bun test` in `packages/dashboard` as this feature's proof.
