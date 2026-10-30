# Andon verification map

This directory is the maintained source for verifying user-facing Dashboard behavior. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `bun .cursor/skills/verify-andon/scripts/harness.ts launch` from the repo root.
- Run `doctor` and require `ok: true`, a loopback `origin`, and SPA HTML (not API-only).
- Open `{origin}` at 1280×800. Confirm `[data-testid="app-shell"]`.
- Never drive a dashboard this harness did not start. The server binds `127.0.0.1` only.
- Do not submit answers from the artifact viewer; that writes the live intent tree.

## Driving conventions

- Start every recipe from home (`ステージ一覧`) unless the feature says otherwise.
- Prefer `data-testid` and accessible names in [SKILL.md](../SKILL.md). Treat quoted labels as literal Japanese UI copy.
- One click or keypress, then a new snapshot. Restore home after a mutation of view state (open panel → close it).
- Intent picker auto-opens when the server has records but no view pin. Dismiss or choose before asserting home.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the Dashboard shell visible.
- Workflow claims include `GET {origin}/api/workflow` saved beside the screenshot.
- Record the feature ID and entry point with every artifact.
- Report an unreachable path with the attempted control and the unmet precondition. Do not mark it verified via a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the Andon harness` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact control and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Home and current stage](./home-now-strip.md) covers first paint, Now strip, and the stage rail.
- [Official docs](./docs-shell.md) covers the docs home, workflow vs extension categories, and an article.
- [Settings](./settings.md) covers the settings page in the browser host (install CTAs are IDE-only).
- [Effectiveness](./effectiveness.md) covers opening the comparison panel and reading the summary.
- [Stage detail](./stage-detail.md) covers opening a stage from the rail and seeing its card.
