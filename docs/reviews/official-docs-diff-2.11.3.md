# Official docs diff report

- generatedAt: `2026-11-05T12:46:32.153Z`
- workspace: `.`
- upstream: `awslabs/aidlc-workflows@a8721be3631e`
- snapshotManifest: source=`aidlc-workflows` sourceVersion=`2.11.2` capturedAt=`2026-10-30T02:44:32Z`

## Summary

| Status | Count |
|--------|------:|
| added | 1 |
| removed | 3 |
| modified | 45 |
| unchanged | 346 |

## Added (in upstream, not in snapshot en)

- `overview/releases/2.11.3.md` — ja missing — needs translation

## Removed (in snapshot en, not in upstream)

- `guide/getting-started.md` — ja present (orphan translation?)
- `overview/release-highlights.md` — ja present (orphan translation?)
- `reference/scopes.md` — ja present (orphan translation?)

## Modified (content hash differs)

- `guide/00-introduction.md` — ja present — review for refresh
- `guide/01-getting-started.md` — ja present — review for refresh
- `guide/03-spaces-and-intents.md` — ja present — review for refresh
- `guide/04-phases-and-stages.md` — ja present — review for refresh
- `guide/05-scopes-and-depth.md` — ja present — review for refresh
- `guide/07-interaction-modes.md` — ja present — review for refresh
- `guide/08-knowledge.md` — ja present — review for refresh
- `guide/10-state-and-audit.md` — ja present — review for refresh
- `guide/12-cli-commands.md` — ja present — review for refresh
- `guide/13-customization.md` — ja present — review for refresh
- `guide/15-troubleshooting.md` — ja present — review for refresh
- `guide/16-worked-examples.md` — ja present — review for refresh
- `guide/18-install-and-lifecycle.md` — ja present — review for refresh
- `guide/facilitator-guide.md` — ja present — review for refresh
- `guide/glossary.md` — ja present — review for refresh
- `guide/harnesses/copilot.md` — ja present — review for refresh
- `guide/harnesses/kiro-cli.md` — ja present — review for refresh
- `guide/harnesses/kiro-ide.md` — ja present — review for refresh
- `guide/harnesses/opencode.md` — ja present — review for refresh
- `guide/harnesses/README.md` — ja present — review for refresh
- `guide/workshop-mode.md` — ja present — review for refresh
- `harness-engineering/10-authoring-a-plugin.md` — ja present — review for refresh
- `overview/changelog.md` — ja missing — needs translation
- `overview/roadmap.md` — ja present — review for refresh
- `reference/00-overview.md` — ja present — review for refresh
- `reference/01-architecture.md` — ja present — review for refresh
- `reference/03-orchestrator.md` — ja present — review for refresh
- `reference/04-stage-protocol.md` — ja present — review for refresh
- `reference/04-stages/construction.md` — ja present — review for refresh
- `reference/04-stages/ideation.md` — ja present — review for refresh
- `reference/04-stages/inception.md` — ja present — review for refresh
- `reference/04-stages/operation.md` — ja present — review for refresh
- `reference/06-hooks-and-tools.md` — ja present — review for refresh
- `reference/07-sensor-system.md` — ja present — review for refresh
- `reference/09-testing.md` — ja present — review for refresh
- `reference/10-knowledge-system.md` — ja present — review for refresh
- `reference/11-contributing.md` — ja present — review for refresh
- `reference/12-state-machine.md` — ja present — review for refresh
- `reference/13-runtime-graph.md` — ja present — review for refresh
- `reference/14-claude-features.md` — ja present — review for refresh
- `reference/17-skill-system.md` — ja present — review for refresh
- `reference/18-plugin-mechanism.md` — ja present — review for refresh
- `reference/20-commit-provenance.md` — ja present — review for refresh
- `reference/diagrams.md` — ja present — review for refresh
- `reference/kiro-ide-hook-payload.md` — ja present — review for refresh

## Unchanged

346 file(s) identical between upstream and snapshot `en`.

## Translate-PR checklist

- [ ] Review **added** and **modified** English pages above
- [ ] Add or refresh `docs/<section>/ja/**` counterparts (US-07)
- [ ] Bump `docs/official-docs.manifest.json` `sourceVersion` / `capturedAt` when snapshot is updated
- [ ] Keep runtime offline — do not add fetch of upstream into the extension (NFR-1)
