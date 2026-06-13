# PR 1765 Final IPC Cleanup Spec

## Goal

Remove the remaining legacy presenter type dependency and close the last raw renderer IPC paths before merging PR 1765.

## Requirements

- `legacy.presenters.d.ts` is removed from the shared type surface.
- `IWindowPresenter` and `TabData` live in an independent window presenter type file.
- `AcpDebugRequest`, `AcpDebugRunResult`, `AcpDebugEventEntry`, `AcpDebugEventKind`, `AcpDebugActionType`, and `AcpWorkdirInfo` live in an independent ACP presenter type file.
- Main to renderer events use the typed `deepchat:event` envelope sender.
- `EventBus` remains only as a main-process event emitter.
- Raw IPC baseline for migrated paths is zero.
- The background exec utility host build guard is removed from the build script.

## Compatibility

Existing `@shared/presenter` imports must continue to resolve through the shared barrels. Remaining broad presenter compatibility types stay in `core.presenter.d.ts` for follow-up extraction.
