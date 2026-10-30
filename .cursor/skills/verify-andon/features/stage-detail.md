# Stage detail

Choosing a stage from the rail opens that stage's card: purpose, artifacts, and agent links for the selected slug.

## Sub-features

- `rail-open` opens `[data-testid="stage-card-<slug>"]` from a rail row.
- `detail-nav` moves with previous/next stage controls when they exist.
- `detail-close` returns to the list without a selected card.

## How to get to it (user POV)

- Click a row in the stage rail on home (`stage-rail-item-<slug>`).
- After a card is open, `panel-prev-stage` / `panel-next-stage` move between stages.
- `panel-back` returns toward the list.

## Driving it with the Andon harness

Preconditions:

- Doctor is green. If `/api/workflow` is `{ unsupported: true, version }`, skip this feature and report `unsupported-workspace`. If it is a typed error, skip and report `no-parsed-workflow`. Otherwise `workflow.stages` must be a non-empty array — `total > 0` alone is not enough, because the Total Stages field can disagree with the parsed rows. If Now strip shows a slug, that slug must appear in `workflow.stages`; otherwise report `no-rail-rows`.
- 1280×800 on `{origin}`; home visible; Now strip not covering the rail.

- **Open current stage.** Read `[data-testid="now-current-stage"]`. If it is a slug (not `ワークフロー完了` / `現在のステージなし`), click `[data-testid="stage-rail-item-<that-slug>"]`. Wait for `[data-testid="stage-card-<that-slug>"]`, **or** a load error (`読み込みエラー` / `見つかりません`) with no card. Plugin-owned stages can sit on the rail while `/api/stage/<slug>` returns `{ error: true, reason: "not-found" }` — that is a typed unreachable card, not a failed open. If this slug has no card, do **not** click another rail row yet: home is parked (`data-[parked]:hidden`) while the panel is open. Click `[data-testid="panel-back"]` to unpark, then another `stage-rail-item-*` until a `stage-card-*` appears; or use enabled `panel-prev-stage` / `panel-next-stage` from this panel; or record the typed error in `PROOF.md` and continue nav from this panel. Screenshot `stage-detail-card.png` (or the error panel).
- **If completed or no current stage.** When Now strip says `ワークフロー完了` or `現在のステージなし`, click any `stage-rail-item-*`. Prefer a row that yields `stage-card-*`. If every open is `not-found`, that is still a valid rail; record it and skip card-only bullets.
- **Previous / next.** Note the open slug. If `[data-testid="panel-next-stage"]` is enabled (`aria-label` is not `次のステージはありません`), click it so the open slug changes (`stage-card-*` or the panel heading), then click `[data-testid="panel-prev-stage"]` and land back on the starting slug. If next is disabled but previous is enabled (`aria-label` is not `前のステージはありません`), click previous first, then next, and land back on the starting slug. If both are disabled, record that in `PROOF.md` — it is a one-stage workflow, not a failed nav.
- **Close.** Click `[data-testid="panel-back"]`. There is no panel close button — `DetailPanel` does not pass `closeTestId`. The card is gone; `ステージ一覧` is visible.

## Gotchas

- Opening a cell on the unit/stage matrix is a different entry (`UnitStageMatrix`). This feature's proof is the rail. If you only click the matrix, say so; do not count it as `rail-open`.
- Artifact viewer / Answer editor inside the card can write `[Answer]:` lines. Read-only open is fine; do not submit answers.
- Slugs are the stage ids from the workflow (for example `performance-validation`), not the Japanese labels.
- `workflow.total > 0` can still mean an empty rail when the Total Stages field disagrees with parsed rows. This feature needs `workflow.stages.length > 0`.
- A rail slug with no docs-bridge entry (`/api/stage/<slug>` `{ error: true, reason: "not-found" }`) shows `読み込みエラー` / `見つかりません` instead of `stage-card-*`. That is a typed unreachable card, not a failed open.
