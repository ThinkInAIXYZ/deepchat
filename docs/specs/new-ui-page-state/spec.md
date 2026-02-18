# Page Router Spec

## Overview

The page router controls which page is displayed in the main content area. It is a pure routing mechanism — it holds no session data, no titles, no project paths. Those belong to the Session Store.

## File Location

`src/renderer/src/stores/ui/pageRouter.ts`

## Route Definitions

```typescript
type PageRoute =
  | { name: 'welcome' }
  | { name: 'newThread' }
  | { name: 'chat'; sessionId: string }
```

Three routes, each with clear entry/exit conditions:

| Route | Condition |
|-------|-----------|
| `welcome` | No enabled providers configured |
| `newThread` | Providers exist, no active session |
| `chat` | Active session selected |

## Store Design

```typescript
export const usePageRouterStore = defineStore('pageRouter', () => {
  const route = ref<PageRoute>({ name: 'newThread' })
  const error = ref<string | null>(null)

  // --- Actions ---

  async function initialize(): Promise<void>
  function goToWelcome(): void
  function goToNewThread(): void
  function goToChat(sessionId: string): void

  // --- Getters ---

  const currentRoute = computed(() => route.value.name)
  const chatSessionId = computed(() =>
    route.value.name === 'chat' ? route.value.sessionId : null
  )

  return { route, error, initialize, goToWelcome, goToNewThread, goToChat, currentRoute, chatSessionId }
})
```

## Actions

### `initialize(): Promise<void>`

Called once on ChatTabView mount. Determines the initial route.

```typescript
async function initialize() {
  try {
    // 1. Check if any provider is enabled
    const hasProviders = await configPresenter.hasEnabledProviders()
    if (!hasProviders) {
      route.value = { name: 'welcome' }
      return
    }

    // 2. Check for active session on this tab
    const tabId = window.api.getWebContentsId()
    const activeSession = await sessionPresenter.getActiveSession(tabId)
    if (activeSession) {
      route.value = { name: 'chat', sessionId: activeSession.sessionId }
      return
    }

    // 3. Default to new thread
    route.value = { name: 'newThread' }
  } catch (e) {
    error.value = String(e)
    route.value = { name: 'newThread' }
  }
}
```

### `goToWelcome(): void`

```typescript
function goToWelcome() {
  route.value = { name: 'welcome' }
}
```

### `goToNewThread(): void`

```typescript
function goToNewThread() {
  route.value = { name: 'newThread' }
}
```

### `goToChat(sessionId: string): void`

```typescript
function goToChat(sessionId: string) {
  route.value = { name: 'chat', sessionId }
}
```

## IPC Call Mapping

| Action | Presenter Call |
|--------|---------------|
| Check providers | `configPresenter.hasEnabledProviders()` (or check provider list length) |
| Get active session | `sessionPresenter.getActiveSession(tabId)` |

## Event Listeners

| Event | Handler |
|-------|---------|
| `CONFIG_EVENTS.PROVIDER_CHANGED` | Re-check provider state; if none left → `goToWelcome()` |

## Relationship to Other Stores

- **Page Router does NOT read session titles, project paths, or any session detail.** That data is consumed directly by components from the Session Store.
- **Session Store calls `pageRouter.goToChat(id)`** after creating or selecting a session.
- **Session Store calls `pageRouter.goToNewThread()`** after closing a session.

## Test Points

1. `initialize()` routes to `welcome` when no providers exist
2. `initialize()` routes to `chat` when an active session exists on this tab
3. `initialize()` routes to `newThread` as default fallback
4. `goToChat` sets route with correct sessionId
5. `goToNewThread` clears route to newThread
6. `goToWelcome` sets route to welcome
7. Error during `initialize()` falls back to `newThread`
