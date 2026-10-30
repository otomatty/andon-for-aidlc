# Effectiveness

効果測定 compares recorded intents on time, waits, and related totals. It is a panel over the dashboard, not a separate server.

## Sub-features

- `effectiveness-open` shows heading `効果測定` and `[data-testid="effectiveness-panel"]`.
- `effectiveness-summary` shows the `比較対象の集計` region (or a typed empty/error state).
- `effectiveness-refresh` reloads via `更新`.
- `effectiveness-close` returns to home.

## How to get to it (user POV)

- Header `メニュー` then `効果測定`.

## Driving it with the Andon harness

Preconditions:

- Doctor is green; 1280×800 on `{origin}`; home visible.

- **Open panel.** Open `メニュー`, then click menuitem `効果測定`. `[data-testid="effectiveness-panel"]` exists and accessible heading is `効果測定`. Screenshot `effectiveness-open.png`.
- **Read summary.** Wait until the loading skeleton is gone. Either `[aria-label="比較対象の集計"]` is present, or the panel shows the empty/error copy from the app. Save `GET {origin}/api/effectiveness` as `effectiveness.json`. A 200 body with zero intents is a valid empty proof, not a failure.
- **Refresh.** Click `更新` (`effectiveness-refresh`). The panel stays open; capture a second snapshot.
- **Close.** Press Escape. This panel has no shell close button. `[data-testid="effectiveness-panel"]` is gone and home `ステージ一覧` is visible. Header `メニュー` → `ステージ一覧` (`header-home`) also closes it.

## Gotchas

- Summary metrics can read `未記録`. That is stored-data emptiness, not a broken panel.
- Filters (`effectiveness-filters`) change which rows are shown. If you apply filters, say so in `PROOF.md`; default proof uses the unfiltered list.
- Do not compare these numbers to `bun run test` coverage. They come from workflow audit timings.
