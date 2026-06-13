# PR 1765 Final IPC Cleanup Plan

## Steps

1. Rename the broad presenter compatibility declarations to `core.presenter.d.ts`.
2. Extract window and ACP debug/workdir types into independent declaration files.
3. Replace `publishDeepchatEvent` eventBus delivery with a registered `IWindowPresenter` sender.
4. Add `window.getRuntimeIdentity` typed route and migrate renderer identity lookups to it.
5. Remove preload synchronous identity IPC and main raw handlers.
6. Remove renderer window focus raw constants and send typed focus envelopes directly.
7. Tighten architecture raw channel baseline to zero.
8. Remove the background exec utility host build guard from `pnpm run build`.
9. Remove stale test mocks for the retired renderer EventBus path.
10. Update focused tests and run verification.

## Side Effects

- `getRuntimeWindowId()` and `getRuntimeWebContentsId()` are async.
- Current-window event listener registration waits for runtime identity resolution.
- Session activation filtering uses a webContents id getter that updates after identity resolution.
- `EventBus` renderer/webContents forwarding methods are unavailable to new code.
- Test fixtures now model renderer notifications through the typed publisher or window presenter sender.
