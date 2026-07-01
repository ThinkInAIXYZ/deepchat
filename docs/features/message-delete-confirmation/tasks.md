# Message Delete Confirmation Tasks

## 0. Review Gate

- [ ] Review `spec.md` copy and destructive-action behavior.
- [ ] Confirm no undo/soft-delete requirement for this increment.

## 1. Renderer Implementation

- [ ] Add local pending-delete state in `ChatPage.vue`.
- [ ] Split delete request from confirmed delete.
- [ ] Add one controlled shadcn `AlertDialog` in `ChatPage.vue`.
- [ ] Clear pending delete state when dialog closes.
- [ ] Clear pending delete state when session id changes.
- [ ] Keep existing delete API call and rehydrate flow unchanged.

## 2. i18n

- [ ] Add `dialog.deleteMessage.title`.
- [ ] Add `dialog.deleteMessage.description`.
- [ ] Add `dialog.deleteMessage.confirm`.
- [ ] Run i18n sync for other locale files.

## 3. Tests

- [ ] Add renderer test: trash request opens confirm and does not delete immediately.
- [ ] Add renderer test: confirm deletes selected message.
- [ ] Add renderer test: cancel/Escape path does not delete.
- [ ] Add renderer test: read-only session cannot open delete confirm.

## 4. Verification

- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run focused ChatPage renderer test.
