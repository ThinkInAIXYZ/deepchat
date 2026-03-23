# Tasks

1. Main presenter
   - Add `remoteControlPresenter` contract and register it in main `Presenter`.
   - Rebuild runtime on settings changes and app init.

2. Detached session support
   - Add `createDetachedSession()` to `newAgentPresenter`.
   - Ensure first remote message still triggers title generation through the shared send path.

3. Remote runtime services
   - Implement auth guard, binding store, command router, and conversation runner.
   - Reuse existing stop/open/session listing behavior.

4. Telegram transport
   - Implement native-fetch Telegram client.
   - Implement long polling with offset persistence and backoff.
   - Implement plain-text outbound chunking and draft/final delivery.

5. Renderer
   - Add `RemoteSettings.vue`.
   - Add `settings-remote` route.
   - Remove Telegram UI from `NotificationsHooksSettings.vue`.
   - Add i18n keys for `Remote`.

6. Tests
   - Add main tests for auth guard, bindings, command routing, and chunking.
   - Extend existing presenter tests for detached session creation and stop-by-event behavior.

7. Validation
   - Run formatting, i18n check, lint, and targeted tests when dependencies are available in the worktree.
