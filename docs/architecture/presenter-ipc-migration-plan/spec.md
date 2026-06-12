# Presenter IPC Migration Completion - Spec

> Status: automated migration gate passed; external/manual validation remains.
> Audit snapshot: 2026-06-10; latest verification snapshot: 2026-06-11 on branch
> `codex/presenter-ipc-migration-plan`.

## Problem

DeepChat has a typed renderer-main boundary for the main chat path:

```text
renderer/api/*Client
  -> window.deepchat
  -> shared/contracts routes + events
  -> src/main/routes
  -> presenter-backed ports
```

At the start of this work the migration was incomplete: the main window hot path was mostly
migrated, but settings and secondary renderer surfaces still used legacy presenter reflection, raw
`window.electron.ipcRenderer` channels, or direct `window.api` calls.

The stale signal was risky: `docs/architecture/baselines/main-kernel-migration-scoreboard.md`
claimed P5 was ready and `node scripts/architecture-guard.mjs` passed, while the source still
contained settings renderer legacy calls. The guard protected the migrated main renderer hot path
more than the full renderer surface. The current branch expands that guard and removes the broad
renderer legacy transport from business code.

## Goals

1. Remove renderer business dependency on `useLegacyPresenter()`, `useLegacyRemoteControlPresenter()`,
   `useLegacyShortcutPresenter()`, raw `window.electron`, and direct `window.api`.
2. Replace every renderer-visible presenter method with a typed domain client backed by
   `src/shared/contracts/routes/*.routes.ts`, `src/shared/contracts/events/*.events.ts`, and
   `src/main/routes`.
3. Keep `EventBus` as an internal main-process coordination mechanism, but publish renderer-visible
   notifications through typed events.
4. Retire `ipcMain.handle('presenter:call')` and `ipcMain.handle('remoteControlPresenter:call')`
   once no renderer imports the legacy transport.
5. Extend architecture guard coverage so future changes cannot reintroduce legacy IPC in
   `src/renderer/settings`, `src/renderer/splash`, `src/renderer/floating`,
   `src/renderer/browser-overlay`, or other renderer entry points.

## Non-Goals

- No behavior redesign of presenters themselves.
- No data-model migration unless a typed route requires payload normalization for existing data.
- No removal of main-process internal `EventBus` listeners.
- No immediate removal of specialized preload APIs for floating, splash, browser overlay, or plugin
  settings if they are still the correct boundary for a dedicated renderer. They should still get
  typed payload validation and explicit allowlists.
- No UI redesign.

## Acceptance Criteria

- `rg "useLegacyPresenter|useLegacyRemoteControlPresenter|useLegacyShortcutPresenter" src/renderer`
  only finds legacy quarantine definitions or returns no business usages.
- `rg "window\\.electron|window\\.api" src/renderer` only finds explicitly allowlisted runtime
  wrappers or specialized preloads; settings/business components have zero direct hits.
- All renderer-visible calls are represented in shared route/event contracts with zod validation.
- `presenter:call` and `remoteControlPresenter:call` handlers are removed or gated behind a documented
  temporary bridge register with zero active renderer consumers.
- `scripts/architecture-guard.mjs` scans all renderer roots and fails on new legacy IPC outside
  allowlisted wrappers.
- Existing tests pass for affected domains, and each new route/client/event has focused unit coverage.
- Manual verification covers the surfaces that cannot be safely automated, especially external
  integrations such as ACP install, remote-control login/pairing, provider OAuth, and database reset.

## Constraints

- New renderer-main capabilities must use shared contracts and `renderer/api/*Client`.
- Do not expose broad presenter methods through new typed routes. Prefer domain-specific routes with
  narrow input/output schemas.
- Avoid adding methods such as `windowPresenter.sendToAllWindows` to typed clients. Replace the user
  workflow with a narrower command or event.
- Preserve dual publish only during an individual migration PR. After the consumer is migrated, remove
  the legacy raw event in the same PR or a directly follow-up PR.
- Secrets and tokens must never be sent through broad typed events or logged in route errors.
