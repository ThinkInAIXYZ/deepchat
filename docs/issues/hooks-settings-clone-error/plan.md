# Plan

## Implementation Approach

1. Convert the Vue reactive hooks settings object to raw, structured-cloneable data before invoking `config.setHooksNotifications`.
2. Keep the returned normalized config assignment unchanged so the UI reflects main-process validation/normalization.
3. Add focused renderer/API test coverage proving a reactive hooks settings object is sanitized before IPC.

## Affected Interfaces

- Renderer settings component: `src/renderer/settings/components/NotificationsHooksSettings.vue`
- Renderer config client: `src/renderer/api/ConfigClient.ts`
- Existing route contract: `config.setHooksNotifications` remains unchanged.

## Data Flow

Current failing flow:

`Vue ref/proxy config` -> `ConfigClient.setHooksNotificationsConfig` -> `window.deepchat.invoke` -> Electron structured clone failure

Fixed flow:

`Vue ref/proxy config` -> plain hooks config clone -> `ConfigClient.setHooksNotificationsConfig` -> route validation -> Electron IPC -> main presenter normalization

## Compatibility

The serialized payload remains `{ hooks: [{ id, name, enabled, command, events }] }`; persisted data and API contracts are unchanged.

## Test Strategy

- Add/adjust renderer API client unit test to call `setHooksNotificationsConfig` with a Vue reactive object and assert the bridge receives a non-reactive plain object.
- Run required repository checks after implementation: `pnpm run format`, `pnpm run i18n`, `pnpm run lint`.
