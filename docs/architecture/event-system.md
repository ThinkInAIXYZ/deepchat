# Event System

This document describes the current DeepChat event boundary as of 2026-06-13.

Renderer-main state notifications use typed event contracts. Raw event constants in
`src/main/events.ts` remain for main-process coordination and a small set of compatibility channels.

## Current Boundary

```text
Main presenter/service
  -> publishDeepchatEvent(name, payload)
  -> shared/contracts/events validates payload
  -> EventBus sends deepchat:event
  -> preload createBridge dispatches envelope
  -> renderer/api client or store listener handles typed payload
```

| Layer | File | Responsibility |
| --- | --- | --- |
| Event catalog | `src/shared/contracts/events.ts` | Exports every renderer-visible event contract and payload schema |
| Channel name | `src/shared/contracts/channels.ts` | Defines `deepchat:event` |
| Publisher | `src/main/routes/publishDeepchatEvent.ts` | Validates payloads and emits typed envelopes |
| Transport | `src/main/eventbus.ts` | Routes events to all windows, default window/tab, or specific webContents |
| Preload bridge | `src/preload/createBridge.ts` | Subscribes to `deepchat:event` and dispatches by event name |
| Renderer entry | `src/renderer/api/*Client.ts` and stores | Owns domain listeners and cleanup |

## Typed Events

`DEEPCHAT_EVENT_CATALOG` is the renderer-visible source of truth. New renderer-visible events should
be added under `src/shared/contracts/events/*.events.ts`, exported from
`src/shared/contracts/events.ts`, and published through `publishDeepchatEvent`.

Current event families include:

| Family | Examples | Publisher owner |
| --- | --- | --- |
| `chat.*` | `chat.stream.updated`, `chat.stream.completed`, `chat.stream.failed`, `chat.plan.updated` | `agentRuntimePresenter`, `dispatch` |
| `sessions.*` | `sessions.updated`, `sessions.status.changed`, `sessions.pendingInputs.changed` | `agentSessionPresenter`, runtime services |
| `settings.*` | `settings.changed`, `settings.navigateRequested`, `settings.checkForUpdatesRequested` | config/settings/window flows |
| `config.*` | language, theme, system prompts, agents, shortcut keys | `configPresenter` helpers |
| `providers.*` and `models.*` | provider/model/rate-limit updates | provider runtime |
| `mcp.*` | server status, config, sampling, tool results | `mcpPresenter` |
| `sync.*` and `skillSync.*` | backup/import/scan/export progress | sync presenters |
| `browser.*` | status, activity, open requests | `YoBrowserPresenter` |
| `window.*` and `appRuntime.*` | window state, shortcuts, deeplinks, notifications | window/app presenters |

Example publisher:

```ts
publishDeepchatEvent('chat.stream.completed', {
  eventId,
  userStop: false
})
```

Example renderer listener:

```ts
const stop = window.deepchat.on('chat.stream.completed', (payload) => {
  messageStore.finishStream(payload.eventId)
})
```

## EventBus Role

`EventBus` is now a transport and main-process pub/sub helper:

- `sendToMain()` emits process-local events.
- `sendToRenderer()` sends a raw channel to all windows, the default window, or the default tab.
- `sendToRendererIfAvailable()` is used during early startup where a renderer may still be absent.
- `sendToWebContents()` targets a specific webContents id.
- `sendToTab()` and `broadcastToTabs()` are compatibility aliases over webContents routing.
- `setTabPresenter()` is a compatibility hook; current tab routing goes through `WindowPresenter`.

Renderer-visible app state should use typed event contracts. Raw EventBus channels are reserved for
internal main events, bootstrapping, and explicit preload/window channels.

## Raw Event Constants

`src/main/events.ts` still defines main-process event names grouped by domain:

- `CONFIG_EVENTS`
- `PROVIDER_DB_EVENTS`
- `SYSTEM_EVENTS`
- `UPDATE_EVENTS`
- `WINDOW_EVENTS`
- `SETTINGS_EVENTS`
- `MCP_EVENTS`
- `SYNC_EVENTS`
- `DEEPLINK_EVENTS`
- `SHORTCUT_EVENTS`
- `TAB_EVENTS`
- `TRAY_EVENTS`
- `LIFECYCLE_EVENTS`

These constants are useful for presenter-to-presenter notifications and a few raw window flows.
Renderer business code should consume typed events through `window.deepchat.on()` or a renderer API
client wrapper.

## Request/Response Boundary

Events are one-way notifications. Renderer-to-main commands and queries use typed routes:

```text
Vue component/store
  -> renderer/api client
  -> window.deepchat.invoke(routeName, input)
  -> shared/contracts/routes validates input/output
  -> src/main/routes handler/service
  -> presenter-backed port or presenter
```

| Need | Boundary |
| --- | --- |
| Query data or run a command | typed route |
| Notify renderer of changed state | typed event |
| Publish startup or internal lifecycle state inside main | EventBus raw event |
| Target a single webContents | typed envelope via `publishDeepchatEventToWebContents` |

## Guardrails

- Add renderer-visible events to `src/shared/contracts/events*.ts`.
- Publish renderer-visible payloads through `publishDeepchatEvent()` or
  `publishDeepchatEventToWebContents()`.
- Keep raw IPC and broad `window.electron` access inside explicit preload/bridge boundaries.
- Keep retired legacy transport paths deleted: `useLegacyPresenter()`, `presenter:call`,
  `remoteControlPresenter:call`, and `src/renderer/api/legacy/**`.
- Update `test/main/**` or `test/renderer/api/createBridge.test.ts` when an event contract changes.

## Related Docs

- [Architecture Overview](../ARCHITECTURE.md)
- [Core Flows](../FLOWS.md)
- [Agent System](./agent-system.md)
- [Tool System](./tool-system.md)
