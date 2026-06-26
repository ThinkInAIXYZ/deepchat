# Plan

## Existing Architecture

- Renderer settings UI: `src/renderer/settings/components/RemoteSettings.vue`.
- Renderer API: `src/renderer/api/RemoteControlClient.ts`.
- Typed routes: `src/shared/contracts/routes/remote-control.routes.ts`, exported through `src/shared/contracts/routes.ts`.
- Shared presenter types: `src/shared/types/presenters/remote-control.presenter.d.ts`.
- Main route dispatch: `src/main/routes/index.ts`.
- Main presenter/runtime: `src/main/presenter/remoteControlPresenter/index.ts`, `types.ts`, `services/remoteBindingStore.ts`, `feishu/feishuClient.ts`.

## Data Flow

### Official PersonalAgent install

1. Renderer calls `remoteControl.startFeishuInstall({ brand })` from the Feishu/Lark settings section.
2. Main presenter creates an in-memory install session and calls `https://accounts.feishu.cn/oauth/v1/app/registration` with form data:
   - `action=begin`
   - `archetype=PersonalAgent`
   - `auth_method=client_secret`
   - `request_user_info=open_id tenant_brand`
3. Main returns a session summary containing a safe session key, official verification URL (`installUrl`), user code, interval, and expiration.
4. Renderer chooses one of two UI modes:
   - web mode: open `installUrl` with `openRuntimeExternal`;
   - QR mode: render an in-app dialog with a locally generated QR code whose payload is exactly `installUrl`.
5. Renderer waits with `remoteControl.waitForFeishuInstall({ sessionKey })` for both modes.
6. Main polls the registration endpoint with `action=poll` and the stored device code.
7. If polling on Feishu reports `tenant_brand=lark` without a secret, main switches that session to `accounts.larksuite.com` and polls again.
8. When `client_id` and `client_secret` are returned, main updates existing Feishu settings:
   - `brand` from detected tenant domain;
   - `appId` from `client_id`;
   - `appSecret` from `client_secret`;
   - app-specific verification/encrypt manual fields cleared for the installed PersonalAgent;
   - `pairedUserOpenIds` extended with returned `user_info.open_id` when present.
9. Main discards all transient registration session data and rebuilds the Feishu runtime if enabled.
10. Renderer refreshes settings/status and shows success/failure status; QR dialog is closed on success.

### Feishu/Lark user authorization

- Keep `/pair <code>` as the main bot-command authorization path for Feishu/Lark remote control.
- Keep the local-callback OAuth scan authorization as a fallback for users who already configured a self-built app and want to add the current user's Open ID without typing `/pair`.
- Present both in one Feishu/Lark authorization section so users understand both update the same authorized-principal list.

### Existing local OAuth pairing fallback

- Keep the already implemented loopback OAuth helper and routes as a fallback for users who already configured a self-built app and explicitly need OAuth user pairing.
- Do not present the loopback redirect URI as the primary setup path.

### Manual fallback setup

- Keep manual fields visible and editable.
- Keep Echo Bot/developer console links as advanced/fallback guidance.
- Continue supporting `/pair <code>` exactly as before.

## Interfaces

Shared install types:

- `FeishuInstallSession`
- `FeishuInstallResult`
- `FeishuInstallStartInput`
- `FeishuInstallWaitInput`

New routes:

- `remoteControl.startFeishuInstall`
- `remoteControl.waitForFeishuInstall`
- `remoteControl.cancelFeishuInstall`

Existing routes remain:

- `remoteControl.startFeishuAuth`
- `remoteControl.waitForFeishuAuth`
- `remoteControl.cancelFeishuAuth`

Renderer client methods mirror all typed routes.

## Renderer QR Implementation

- Generate the QR in the renderer from `installUrl` without a third-party web service.
- Prefer a small local QR implementation or an existing dependency if present; keep the API contained in `RemoteSettings.vue` unless shared reuse appears.
- Expose stable test selectors:
  - `feishu-install-open-web-button`
  - `feishu-install-show-qr-button`
  - `feishu-install-qr-dialog`
  - `feishu-install-qr-code`
- Add a `data-qr-value` attribute to the QR container/image for deterministic tests and accessibility/debugging without decoding the QR bitmap.

## Compatibility

- `FeishuRemoteSettings` remains the persisted settings shape; no user OAuth token fields are added.
- Existing `/pair` state and `pairedUserOpenIds` remain the source of remote-control authorization.
- Existing manual save/rebuild behavior remains unchanged.
- Existing WebSocket Feishu runtime continues to use App ID/App Secret.
- Existing scan OAuth routes continue to work for self-built apps.

## Security

- Do not expose or log `client_secret`, registration device codes, OAuth tokens, or provider raw error bodies.
- Keep registration session state in memory and expire/cancel it.
- Check session completion after every async boundary before persisting credentials, paired users, or rebuilding runtime so cancelled/timed-out sessions have no late side effects.
- Use request-level timeouts or abort signals for Feishu/Lark OAuth and registration network calls.
- Return generic i18n message keys for provider/network failures.
- Store only the installed bot credentials already required by the Feishu runtime and the authorized user's `open_id`.
- Do not persist user OAuth access tokens or refresh tokens.
- Avoid adding the full install URL to logs; showing it in the user-triggered QR dialog is acceptable because it is the scanned payload.

## Test Strategy

- Main unit tests:
  - official install begins on Feishu for both Feishu and Lark selections;
  - Lark tenant detection switches polling to Lark accounts domain;
  - successful install stores App ID/App Secret and pairs returned Open ID;
  - pending/expired/error results are sanitized.
- Existing OAuth callback tests remain to cover fallback behavior.
- Renderer tests:
  - official install controls render as two buttons in Feishu tab;
  - web install opens the returned install URL and refreshes credentials on success;
  - QR install shows a dialog generated from the returned install URL, does not open external browser, waits for success, and refreshes settings/status;
  - Feishu/Lark user-authorization UI explains `/pair` and scan authorization together;
  - manual fields still render and save payload stays cloneable.

## Validation Commands

After implementation:

- targeted Vitest tests for touched main/renderer files;
- `pnpm run format`;
- `pnpm run i18n`;
- `pnpm run lint`.
