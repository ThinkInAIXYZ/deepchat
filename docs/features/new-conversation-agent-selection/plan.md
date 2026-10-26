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
