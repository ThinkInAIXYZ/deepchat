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

- [x] Preserve warmup feedback in the composer selector and report unavailable selected workspaces;
      keep ACP identities outside local Skill routes and discard pending native Skill results on switches.
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

## ACP Option Menu Verification

- [x] Keep inline option menus at a compact 20rem width within the viewport; keep options on one line with
      ellipsis and show complete values on hover or keyboard focus using the existing tooltip.
- [x] Verify vertical scrolling, long unbroken IDs, selection, disabled selected-item tooltips,
      Escape/focus return, and light/dark layouts through Electron at 1280px and 480px widths.
- [x] Validate the real DimCode catalog from an isolated local profile at 1280px and 360px widths.
      All 412 options stayed on one line with no horizontal scrolling; constrained values showed
      ellipsis and a complete tooltip. No real model completion was requested.
- [x] Keep the composer toolbar on one row, shrink Agent/model labels, and reserve attachment/send
      actions at the edges. Only the central settings region scrolls when its minimum widths cannot
      fit; focused controls are revealed automatically. Validate full ACP status/configuration rows
      at 1280px, 800px, and 480px and real DeepChat/DimCode configurations at the same widths.
- [x] Keep Agent and model names visible, with the Agent selector beside the workspace below the
      composer and model before mode in its toolbar. Reveal other icon controls on
      hover, keyboard focus, and while their menu is open; preserve warmup feedback and click
      behavior. Keep revealed targets stable during pointer traversal and disable
      transitions for reduced-motion preferences. Validate compact, expanded, keyboard, and motion
      behavior through Electron and the isolated local DeepChat/DimCode configuration.

- [x] Resolve model-picker icons from model IDs for selected values and menu entries, prefer model
      names over hosting namespaces, and preserve provider icon/API-type fallback. Validate known
      ACP model icons and generic unknown-model fallback through the existing status bar coverage.

Layout checks: format, i18n, lint, typecheck, production compilation, 120 composer component tests,
and four focused Electron smoke tests passed. The normal-build provider catalog refresh is retained.

Real DeepChat/DimCode checks at 1280px, 800px, and 480px confirmed visible Agent/model names,
workspace-row placement, model-before-mode ordering, 32px compact controls, one toolbar row, and
intermediate animation frames during expansion. Reduced-motion and menu/keyboard behavior are
covered by the ACP Electron fixture. No live model completion was requested.

Model icon checks: 98 focused status-bar/icon component tests and two Electron smoke tests passed.
Selected values and menu rows use DeepSeek, Gemini, and GLM icons from model IDs; an unknown model
keeps the custom OpenAI-compatible provider fallback. The ACP smoke explicitly focuses its native
window for hover checks and dismisses nested tooltips before testing Escape/focus return.

An isolated copy of the real local configuration verified loaded DeepSeek, Qwen, GLM, and GPT icons
for custom OpenAI-compatible providers. Provider icons retain their API-type behavior. No live
model completion was requested.

## Accessibility and Icon Fallback Verification

- [x] Make context usage keyboard-focusable and keep focused controls visible after label expansion.
      Preserve readable values on disabled toolbar controls.
- [x] Give disabled ACP option rows focusable tooltip anchors while retaining native disabled
      actions and suppressing action hover styling.
- [x] Match model icons only against the final ID path segment, preserve unknown-model provider
      fallback, remove the unused Agent slot, and keep one namespaced icon case in the workspace
      Electron fixture.

Format, i18n, lint, typecheck, production compilation, 110 focused component tests, and two Electron
smoke tests passed. The ACP smoke covers keyboard context reveal, focus visibility after expansion
at narrow widths, visible values during a held configuration save, and disabled selected-row
tooltips on hover and focus. The existing CI E2E selection is unchanged.

A WAL-aware snapshot of the real local profile verified DeepSeek, Qwen, GLM, and GPT model icons,
keyboard context reveal in an existing DeepChat conversation, and hover/focus tooltips on DimCode's
disabled selected model row. Its action remained disabled. No live model generation was requested.

## ACP Chats Execution

- [x] Prepare the managed Chats directory on demand through a typed project route and a versioned
      snapshot. Keep manual selection and the custom default project unchanged.
- [x] Use the effective Chats directory consistently for warmup, draft creation, authentication
      continuation, workspace references, and submission. Persist the directory in ACP sessions so
      follow-up messages pass the existing workdir validation.
- [x] Exclude ACP identities from native runtime Skill validation. Give disabled option anchors
      button semantics and disabled state, and locate them by their accessible role in Electron.
      Check visible loading cues while retaining the parent's exposed loading contract test.

Full verification passed: 9,853 main tests, 2,748 renderer tests, formatting, i18n, lint, typecheck,
and production compilation. The ACP stdio smoke clears the selected workspace, checks the actual
`session/new` cwd, and completes two chat turns without native Skill scope errors. An isolated real
profile verified DeepChat and DimCode with Chats selected, ready configuration, and an enabled Send
button after entering text while preserving a separate custom default project. No live model
completion was requested.
