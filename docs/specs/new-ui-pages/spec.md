# Page Components Spec

## Overview

Three page components driven by the Page Router. No fallback to old ChatView — this is a full replacement.

## Reference Files

| Page | Mock File |
|------|-----------|
| WelcomePage | `components/mock/MockWelcomePage.vue` |
| NewThreadPage | `components/NewThreadMock.vue` |
| ChatPage | `components/mock/MockChatPage.vue` |

## File Locations

```
src/renderer/src/pages/
  WelcomePage.vue
  NewThreadPage.vue
  ChatPage.vue
```

---

## 1. ChatTabView.vue (Refactored)

**File**: `src/renderer/src/views/ChatTabView.vue`

Page entry. Routes to the correct page based on Page Router state. No legacy ChatView fallback.

```vue
<template>
  <div class="w-full h-full flex-row flex">
    <WindowSideBar />
    <div class="flex-1 w-0 h-full">
      <WelcomePage v-if="pageRouter.currentRoute === 'welcome'" />
      <NewThreadPage v-else-if="pageRouter.currentRoute === 'newThread'" />
      <ChatPage v-else-if="pageRouter.currentRoute === 'chat'" :session-id="pageRouter.chatSessionId!" />
    </div>
    <ArtifactDialog />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { usePageRouterStore } from '@/stores/ui/pageRouter'
import { useSessionStore } from '@/stores/ui/session'
import { useAgentStore } from '@/stores/ui/agent'
import { useProjectStore } from '@/stores/ui/project'
import WindowSideBar from '@/components/WindowSideBar.vue'
import ArtifactDialog from '@/components/artifacts/ArtifactDialog.vue'
import WelcomePage from '@/pages/WelcomePage.vue'
import NewThreadPage from '@/pages/NewThreadPage.vue'
import ChatPage from '@/pages/ChatPage.vue'

const pageRouter = usePageRouterStore()
const sessionStore = useSessionStore()
const agentStore = useAgentStore()
const projectStore = useProjectStore()

onMounted(async () => {
  // Initialize all stores in parallel
  await Promise.all([
    pageRouter.initialize(),
    sessionStore.fetchSessions(),
    agentStore.fetchAgents()
  ])
  // Derive projects from loaded sessions
  projectStore.deriveFromSessions(sessionStore.sessions)
})
</script>
```

**IPC calls on mount**:

| Call | Purpose |
|------|---------|
| `pageRouter.initialize()` | Determine initial route |
| `sessionStore.fetchSessions()` | Load session list for sidebar |
| `agentStore.fetchAgents()` | Load agent list for sidebar |

---

## 2. WelcomePage

**Mock reference**: `MockWelcomePage.vue` (copy layout and classes exactly)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│                    [Logo 16x16]                      │
│                                                      │
│          Welcome to DeepChat Agent                   │
│       Connect a model provider to start build        │
│                                                      │
│   ┌───────┐  ┌───────┐  ┌───────┐                  │
│   │Claude │  │OpenAI │  │DeepSeek│                  │
│   └───────┘  └───────┘  └───────┘                  │
│   ┌───────┐  ┌───────┐  ┌────────┐                 │
│   │Gemini │  │Ollama │  │OpenRouter│                │
│   └───────┘  └───────┘  └────────┘                 │
│                                                      │
│           Browse all providers...                    │
│                                                      │
│   ─────────── or connect an agent ───────────       │
│                                                      │
│   ┌─────────────────────────────────────────────┐   │
│   │ [Terminal]  Set up an ACP agent             │   │
│   │             Claude Code, Codex, Kimi...     │   │
│   └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Data**: Static provider list (hardcoded, matching mock).

**IPC**:

| Action | Presenter Call |
|--------|---------------|
| Click any provider / "Browse all" / ACP agent | `windowPresenter.openOrFocusSettingsTab(windowId)` |

**Key classes** (from mock):
- Container: `h-full w-full flex flex-col window-drag-region`
- Content: `flex-1 flex flex-col items-center justify-center px-6`
- Logo: `w-16 h-16`
- Title: `text-3xl font-semibold text-foreground mb-2`
- Subtitle: `text-sm text-muted-foreground text-center max-w-md mb-10`
- Provider grid: `grid grid-cols-3 gap-2 w-full max-w-sm mb-4`
- Provider button: `rounded-xl border border-border/60 bg-card/40 px-3 py-4 hover:bg-accent/50`

---

## 3. NewThreadPage

**Mock reference**: `NewThreadMock.vue` (copy layout and classes exactly)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│                    [Logo 14x14]                      │
│                                                      │
│              Build and explore                       │
│                                                      │
│               [folder deepchat v]                    │
│               ┌─────────────────────────────────┐   │
│               │ Ask DeepChat anything...        │   │
│               │                                  │   │
│               ├─────────────────────────────────┤   │
│               │ [+]                  [mic][send] │   │
│               └─────────────────────────────────┘   │
│                                                      │
│  [Model v]  [Effort v]            [Permissions v]   │
└─────────────────────────────────────────────────────┘
```

**Data sources**:

| UI Element | Store |
|------------|-------|
| Project list | `projectStore.projects` |
| Selected project | `projectStore.selectedProjectName` |
| Model/Effort | `chatStore.chatConfig` or defaults from `configPresenter` |

**Submit flow**:

```typescript
const handleSubmit = (message: string) => {
  sessionStore.createSession({
    title: message.slice(0, 50),
    message,
    projectDir: projectStore.selectedProject?.path,
    providerId: selectedProviderId.value,
    modelId: selectedModelId.value,
    reasoningEffort: selectedEffort.value
  })
}
```

**IPC**:

| Action | Presenter Call |
|--------|---------------|
| Open folder | `filePresenter.selectDirectory()` (via projectStore) |
| Submit message | `sessionStore.createSession()` → `sessionPresenter.createSession()` + `agentPresenter.chat()` |

---

## 4. ChatPage

**Mock reference**: `MockChatPage.vue` (copy layout and classes exactly)

**Props**:
```typescript
interface Props {
  sessionId: string
}
```

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│ ChatTopBar (sticky top)                              │
├─────────────────────────────────────────────────────┤
│                                                      │
│                 MessageList (scroll)                  │
│                                                      │
├─────────────────────────────────────────────────────┤
│ ChatInputBox + ChatInputToolbar (sticky bottom)      │
│ ChatStatusBar                                        │
└─────────────────────────────────────────────────────┘
```

**Data sources**:

```typescript
const sessionStore = useSessionStore()
const chatStore = useChatStore()

const session = computed(() => sessionStore.activeSession)
const title = computed(() => session.value?.title ?? 'Chat')
const project = computed(() => session.value?.projectDir ?? '')
```

**Submit flow**:

```typescript
const handleSubmit = (message: string) => {
  const tabId = window.api.getWebContentsId()
  agentPresenter.chat(sessionStore.activeSessionId!, message, tabId)
}
```

**IPC**:

| Action | Presenter Call |
|--------|---------------|
| Send message | `agentPresenter.chat(sessionId, message, tabId)` |
| Update settings | `sessionPresenter.updateSessionSettings(sessionId, settings)` |

**Key classes** (from mock):
- Container: `h-full overflow-y-auto`
- Input area: `sticky bottom-0 z-10 px-6 pt-3 pb-3`
- Input wrapper: `flex flex-col items-center`

---

## Route Transitions

```
┌─────────────┐     Provider configured    ┌─────────────┐
│   Welcome   │ ─────────────────────────► │  NewThread  │
└─────────────┘                            └──────┬──────┘
     ▲                                            │
     │                                            │ Submit message
     │ All providers                              │ (createSession)
     │ removed                                    ▼
     │                                     ┌─────────────┐
     └──────────────────────────────────── │    Chat     │
           closeSession                    └─────────────┘
```

## Test Points

1. ChatTabView renders correct page based on `pageRouter.currentRoute`
2. All stores initialize on mount
3. WelcomePage provider grid renders 6 providers
4. WelcomePage clicks open settings tab
5. NewThreadPage project selector shows projects from store
6. NewThreadPage submit creates session and navigates to chat
7. ChatPage displays title and project from active session
8. ChatPage submit sends message via agentPresenter
