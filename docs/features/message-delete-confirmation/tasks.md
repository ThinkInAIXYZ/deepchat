# Message Delete Confirmation Tasks

## 0. Review Gate

- [x] Review `spec.md` copy and destructive-action behavior.
- [x] Confirm no undo/soft-delete requirement for this increment.

## 1. Renderer Implementation

- [x] Add local pending-delete state in `ChatPage.vue`.
- [x] Split delete request from confirmed delete.
- [x] Add one controlled shadcn `AlertDialog` in `ChatPage.vue`.
- [x] Clear pending delete state when dialog closes.
- [x] Clear pending delete state when session id changes.
- [x] Keep existing delete API call and rehydrate flow unchanged.

## 2. i18n

- [x] Add `dialog.deleteMessage.title`.
- [x] Add `dialog.deleteMessage.description`.
- [x] Add `dialog.deleteMessage.confirm`.
- [x] Run i18n sync for other locale files.

## 3. Tests

- [x] Add renderer test: trash request opens confirm and does not delete immediately.
- [x] Add renderer test: confirm deletes selected message.
- [x] Add renderer test: cancel/Escape path does not delete.
- [x] Add renderer test: read-only session cannot open delete confirm.

## 4. Verification

- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run focused ChatPage renderer test.
