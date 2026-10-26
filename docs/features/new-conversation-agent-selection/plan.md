# Implementation Plan

Objective: implement the selection and ownership contract in [spec.md](./spec.md).

- [x] Separate Agent filtering from execution selection; unify new-conversation entry behavior
      around the existing draft Agent and preserve explicit workspace intent.
- [x] Add the composer Agent selector, remove the welcome-selection route and unused artifacts,
      and preserve model/default/ACP lifecycle and manually selected workspaces.
- [x] Review the complete change and update the smallest durable regression coverage for the
      observable behavior, including affected existing E2E helpers.
- [x] Run format, i18n, lint, typecheck, relevant renderer tests, and Electron checks with multiple
      Agents from an isolated copy of the real local profile. Remove temporary probes.
- [x] Commit and open a PR against `dev`, explain ownership and selection rules with BEFORE/AFTER
      ASCII layouts, include validation evidence and `Closes #2462`, and attach the PR to this chat.


## Validation

- Format, i18n, lint, typecheck, and the production build passed.
- 377 relevant renderer tests passed; 6 Electron smoke tests passed, including keyboard selection,
  history navigation followed by New Chat, and first-message assignment to a selected custom Agent.
- An isolated copy of the local real profile passed checks for six enabled Agents: three DeepChat
  Agents and pi ACP, DimCode, and Claude Agent. Selection matched created session Agent/model
  identities; filtering preserved the active conversation; ordinary and actual workspace-plus
  entry points preserved the new-conversation choice. Wide/narrow and light/dark layouts were
  visually checked. Sync, remote control, and scheduled jobs were disabled in the copy.
- The real-profile checks created empty sessions and prepared configured Agents without requesting
  live model completions. First-message execution used the Electron smoke suite's loopback fixture.
- Normal-build provider and ACP catalog refreshes are retained.

PR: https://github.com/ThinkInAIXYZ/deepchat/pull/2469 (base: `dev`; closes #2462).


## ACP Preparation Verification

- [x] Preserve warmup feedback in the composer selector and explain missing workspaces; keep ACP
      identities outside local Skill routes and discard pending native Skill results on switches.
- [x] Distinguish automatic Agent workspace defaults from manual choices; keep the active execution
      context unchanged on failed deactivation.
- [x] Validate loading/configuration readiness, invalid-to-valid workspace recovery, and route errors
      through Electron and isolated copies of the real local Agent configuration.


ACP verification: format, i18n, lint, typecheck, and the production build passed; 332 focused
renderer tests and four Electron smoke tests passed. The ACP stdio fixture holds initialization
open to verify the selector's loading state, then supplies model/mode configuration and exercises
invalid-to-valid workspace recovery while checking native Skill route errors.

The local real-profile snapshot verified unavailable-directory behavior for pi ACP and DimCode,
with no `DeepChat Agent not found` errors. DimCode completed actual draft preparation and displayed
its model/mode/permission controls with an existing directory. Pi ACP could not complete Session
creation: its default `pi` command resolves to the locally installed `@simon_he/pi` package manager
(version 0.2.11), whereas the adapter requires the Pi coding Agent. No global installation or real
profile setting was modified, and no live model completion was requested. Verification builds and
Electron runs used a temporary worktree so the running development app retained its own output.
