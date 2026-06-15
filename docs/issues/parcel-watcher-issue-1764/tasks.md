# Parcel Watcher Issue 1764 Tasks

- [x] Add `@parcel/watcher`, remove `chokidar`, and update package/ASAR/build configuration.
- [x] Add watcher utility process entrypoint and `WatcherHostClient` RPC lifecycle.
- [x] Add `WatcherService`, `WatcherPool`, shared watcher types, and event coalescer.
- [x] Add host restart, request replay, throttling, and degraded-mode state handling.
- [x] Add snapshot polling, git metadata polling, and lifecycle fallback modes.
- [x] Migrate `WorkspacePresenter` content watching to `WatcherService`.
- [x] Migrate workspace git metadata watching to the git watcher host.
- [x] Migrate `SkillPresenter` hot reload watcher to `WatcherService` and async lifecycle.
- [x] Add typed workspace watcher status event and WorkspacePanel degraded warning UI.
- [x] Update watcher-focused main and renderer tests.
- [x] Run targeted verification and required project quality gates.

## Verification

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `pnpm exec playwright test -c test/e2e/playwright.config.ts test/e2e/specs/30-workspace-watcher-events.smoke.spec.ts`
