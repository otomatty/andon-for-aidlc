# aidlc-workflows release highlights

This guide summarizes selected improvements from the upstream CHANGELOG. [All releases](changelog.md) includes the complete entries, with fixes and upgrade instructions, from the bundled source revision.

## 2.11.2

[2.11.2, released October 28, 2026](releases/2.11.2.md), retains State Version 8 and the 33-stage base graph.

Replies are read in the person's own words at every question and from any chat, and the record keeps the reply each decision was made on; a key or password typed in the chat is masked in the committed record. The learnings step asks only when the person corrected the agent in that stage. Far fewer gates end in a question with no way on, under Guard Policy strict too, and the review summary says which open findings Approve accepts as risk. Plan switches, skips, undos, jumps and `--single` runs carry on from where the work stands, and Requirements Analysis and Domain Design can offer "Approve, and add <Stage> next".

A workspace of many repositories reaches Reverse Engineering's gate, asking once before reading ten or more repositories nobody named, and `/aidlc intent add-repo <name>` adds a repository at any stage. Side-by-side builds start from the person's own branch, land back on it and bring their record edits home. Code Generation names any file the person brought that the build changed or deleted, with the git command to put it back; Build and Test owes four files every run, with the other test instructions only at the strategies that call for them. `aidlc config --yes` asks nothing at a terminal, and `aidlc doctor` says how old an update check is and warns, naming the machine, when the work ran in another clone.

Run `aidlc update`, then `aidlc config --yes` per project; open work carries on. Copy users replace the complete `runtime/<harness>/` tree from `aidlc-copy-runtime-2.11.2.tar.gz`. Three changes affect scripts: a copied project's own `config` with no `--from` on a machine that also has a native `aidlc` now needs `--download` or `--from`; a script or CI job that drives AI-DLC sets `AIDLC_UNATTENDED=1`; and on Claude Code an Amazon Bedrock answer goes to the git-ignored `.claude/settings.local.json`, so a script reads the profile from `aidlc config providers --show --json` instead of `harness.json`.

## 2.11.1

[2.11.1, released October 20, 2026](releases/2.11.1.md), retains State Version 8 and the 33-stage base graph.

Code kept in a git worktree, a clone, a submodule or a monorepo package now reaches Code Generation's approval question; where the review cannot see the code, the question says `AI-DLC found no source changes under <where it looked>` once and the person approves as usual. With Guard Policy off, a build carries on after the chat compacts. Going back from the open Code Generation gate goes through on the first ask. A person who pauses in their own words is not pushed on, and a park names the way back. The plan question waits for the person's reply before work starts, and a plan of two or more Units asks once who builds them (Just me, or Several teams).

Plugins someone else builds carry their author's own names (`<name>@<catalogue>`); AI-DLC's own plugins share one `aidlc-plugins` catalogue that stays put across updates, and plugins compose without Bun on Cursor and Kiro IDE. A project on any release from 2.8.0 refreshes without stopping. AI-DLC's status line is the person's choice, asked once. `install.sh` and `aidlc uninstall` take an opt-in `--allow-root`, and a project's `.env` no longer reaches the engine.

Run `aidlc update`, then `aidlc config --yes` per project; open work carries on. Copy users replace the complete `runtime/<harness>/` tree from `aidlc-copy-runtime-2.11.1.tar.gz`. Plugin users in Claude Code or Codex add AI-DLC's plugin catalogue once with `/plugin marketplace add <folder>` or `codex plugin marketplace add <folder>`. Scripts that build or install plugins AI-DLC does not ship must use `<name>@<catalogue>` instead of `aidlc-<name>@aidlc-plugins`.

## 2.11.0

[2.11.0, released October 8, 2026](releases/2.11.0.md), retains State Version 8 and the 33-stage base graph.

New work starts leaner: outside `enterprise`, Guard Policy is off and the new `collaborators` setting is off, so each stage runs with its lead agent only (`/aidlc --collaborators on` brings the support agents back). The engine asks for Plan Approval and asks about an approved plan once; `express` and `poc` ship with it off. Replies are read in the person's own words from any chat, a bare `/aidlc` carries on with open work, and requests such as `--skip`, `--add`, a scope change or a Construction setting are done at once with the way back. Finished Units stay finished across those changes. A composed plan belongs to its piece of work and writes no scope file unless saved.

`aidlc config` now runs beside open work and keeps the team's own files (`.claude/settings.json`, `.codex/config.toml`, `opencode.json`, and one `.gitignore` block after the team's rules). A tool whose hooks never run stops at the first message with its own setup step. On Windows, `install.ps1` in a UAC-elevated window warns and asks instead of refusing.

Run `aidlc update`, then `aidlc config --yes` per project; open work carries on. Copy users replace the complete `runtime/<harness>/` tree from `aidlc-copy-runtime-2.11.0.tar.gz`, which needs Bun 1.3.8 or newer.

## 2.10.0

[2.10.0, released September 24, 2026](releases/2.10.0.md), retains State Version 8 and the 33-stage base graph.

Eligible new solo workflows use serial, unit-major Construction with verified Unit checkpoints. Verification uses the recorded, human-authorized command; existing workflows retain their recorded policy. Parallel execution uses explicit stage-major/swarm settings and verified batch checkpoints.

Guard Policy replaces Change Control and supports strict, relaxed and off. Human approval gates and Unit ownership remain mandatory. Legacy names remain readable for this release. Non-colliding harnesses can coexist, share neutral onboarding, and keep the current provider unless Bedrock is selected. Intent-scoped Bolt worktrees avoid name collisions; parked attempts restore exact bytes and Doctor shows recovery commands.

Refresh between workflows. Run `aidlc update`, then `aidlc config --yes` and `aidlc doctor` per project. Refresh each installed harness with `aidlc config --harness <name> --yes`. Copy users replace the complete `runtime/<harness>/` tree from `aidlc-copy-runtime-2.10.0.tar.gz`.

## 2.9.0

[2.9.0, released September 15, 2026](releases/2.9.0.md), keeps State Version **8** and the **33-stage** base graph. New Classic intents use 18 stages through Build and Test. Existing Classic intents keep their recorded graph; use `workshop` for the prior 26-stage route (`--test-strategy standard` restores the Standard test floor).

| Change | Effect |
| --- | --- |
| Classic v1 ceremony | One human approval per stage; advisory reviews, sensors and learnings on, skeleton and summary confirmation off |
| Atomic intent settings | Apply depth, testing, review, change control and three ceremony switches together; invalid values reject the whole command |
| Intent archive | Retire unfinished work without deleting its record, then unarchive when needed |
| Commit provenance | Attribute committed paths to reviewed Units, classify drift and missing evidence, and report the trust basis |
| On-demand autonomy | Grant or revoke Construction autonomy while preserving the first approval, Unit Plan Approval and failure stops |
| Install and models | Separate Bun copy assets; no provider question on Kiro; balanced effort is medium for all three groups |
| Review retries | Use the current ordinal after rejection to avoid false budget-exhaustion stops |

## 2.8.2

[2.8.2, released September 10, 2026](releases/2.8.2.md), fixes summary confirmations, review-findings diagnostics, and Unit lifecycle handling. It includes the native installation and hook fixes in [2.8.1](releases/2.8.1.md). State Version remains 8, with 33 stages.

| Release | Improvement | Effect |
| --- | --- | --- |
| [2.8.2](releases/2.8.2.md) | Summary confirmation tolerates a decorative divider before Assumption Confirmation | Appending the section no longer invalidates an unchanged confirmed summary; substantive edits still require confirmation |
| [2.8.2](releases/2.8.2.md) | Malformed review-findings rows report their cell count and expected columns | Missing or surplus cells can be corrected without guessing which column was omitted; malformed rows still block review completion |
| [2.8.2](releases/2.8.2.md) | Wave stages reject serial Unit start, pause, and resume | The engine preserves state and audit and directs callers to `unit complete --wave`; switching back to unit-major leaves remaining units completable |
| [2.8.1](releases/2.8.1.md) | Fix native setup defaults, same-version updates, and Cursor/Copilot hook routing | Enter accepts setup defaults, current installs pass integrity checks under normal umasks, and native hook adapters receive the right arguments and emit valid Cursor allow responses |

The [2.8.6 entry](releases/2.8.6.md) is retained upstream as superseded development history. No 2.8.6 release was published; 2.8.2 was the intended release at that time. The current bundled target is 2.11.1.

## 2.8.0

[2.8.0, released September 8, 2026](releases/2.8.0.md), consolidates the 2.7.x cycle. Runtime behavior is unchanged from 2.7.2. State Version remains 8, with 33 stages.

| Release | Improvement | Effect |
| --- | --- | --- |
| [2.8.0](releases/2.8.0.md) | New minor baseline for the 2.7.x fixes | Version output and release archives use 2.8.0; existing 2.7.2 records need no migration |
| [2.7.2](releases/2.7.2.md) | Tag-bound release identity and versioned runtime archives | Installers check source identity and SHA-256, with signed attestation verification when a compatible GitHub CLI is available |
| [2.7.1](releases/2.7.1.md) | Fix solo Plan Approval deadlock | The Stop hook's read-only probe no longer invalidates approval, allowing Code Generation to begin |

## Earlier milestones

| Release | What changed |
| --- | --- |
| [2.7.0](releases/2.7.0.md) | Consolidated 2.6.x: 33 stages, Domain and Contract Design, Classic/Express scopes, stronger approval and review checks, focused CodeKB rescans |
| [2.6.124](releases/2.6.124.md) | New state writes use project-relative root and worktree paths, avoiding machine-specific absolute paths in shared records |
| [2.6.120](releases/2.6.120.md) | Focused rescans preserve unrelated CodeKB content and reject concurrent source/store changes |
| [2.6.116](releases/2.6.116.md) | Questions consult previously recorded answers before asking again |
| [2.6.115](releases/2.6.115.md) | Bounded, trust-marked document input for existing vision and requirements documents |
| [2.5.0](releases/2.5.0.md) | Pipeline and mob collaboration modes, recorded contributions and explicit unresolved dissent |
| [2.4.0](releases/2.4.0.md) | Reviews seek defects using tests, acceptance criteria and contracts as evidence |
| [2.3.0](releases/2.3.0.md) | Plugins add stages and contribute outputs, inputs and sensors to existing stages |
| [2.2.0](releases/2.2.0.md) | Adaptive Workflows and `/aidlc compose` propose task-specific stage plans for human approval |
| [2.1.0](releases/2.1.0.md) | Spaces, multiple intents and per-clone audit shards replace the flat workspace layout |
| [2.0.0](releases/2.0.0.md) | Optional LLM review before human approval, plus Kiro IDE support |
| [0.1.0](releases/0.1.0.md) | Initial public release: five phases, 32 stages, expert agents, approval gates and resumable records |

## Upgrading

Run `aidlc update`, then `aidlc config --yes` in each project and `aidlc doctor`. To pin the release, use `install.sh --version 2.9.0` or `install.ps1 -Version 2.9.0`. Manual-copy users replace the complete `runtime/<harness>/` tree from `aidlc-copy-runtime-2.9.0.tar.gz` and use Bun. Migrate scripts from the removed standalone `aidlc-utility.ts change-control` route to `aidlc engine config set change-control <strict|relaxed>`. Unknown `config-change` flags now fail. Pre-2.9 reviews remain `unverifiable` for commit provenance until their next Unit review writes committed evidence. See the [2.9.0 entry](releases/2.9.0.md) and [installation guide](guide/18-install-and-lifecycle.md).

The version badge identifies the bundled documentation, independently of the framework installed in the selected workspace and the AIDLC Guide extension version.
