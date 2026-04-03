# Tasks

1. Main presenter
   - Add `remoteControlPresenter` contract and register it in main `Presenter`.
   - Rebuild runtime on settings changes and app init.

2. Detached session support
   - Add `createDetachedSession()` to `agentSessionPresenter`.
   - Ensure first remote message still triggers title generation through the shared send path.

3. Remote runtime services
   - Implement auth guard, binding store, command router, and conversation runner.
   - Route new Telegram sessions through a validated default DeepChat agent.
   - Make `/sessions` prefer the currently bound agent and add bound-session `/model` switching.

4. Telegram transport
   - Implement native-fetch Telegram client.
   - Implement long polling with offset persistence and backoff.
   - Implement plain-text outbound chunking and draft/final delivery.
   - Register default Telegram bot commands, support inline-keyboard callback queries, and keep reactions scoped to plain-text conversations.

5. Renderer
   - Add `RemoteSettings.vue`.
   - Add `settings-remote` route.
   - Remove Telegram UI from `NotificationsHooksSettings.vue`.
   - Simplify the Telegram remote first layer and move pairing / binding management into dialogs.
   - Hide remote and hook detail sections when their toggle is off.
   - Add i18n keys for `Remote`.

6. Tests
   - Add main tests for auth guard, bindings, command routing, and chunking.
   - Add parser/client tests for callback query and inline-keyboard payloads.
   - Extend existing presenter tests for detached session creation, session model switching, and stop-by-event behavior.

7. Validation
   - Run formatting, i18n check, lint, and targeted tests when dependencies are available in the worktree.
