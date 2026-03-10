# Chat Components Spec

## Overview

Chat components handle message display, input, and status configuration during active sessions. Each component's visual design must match its mock counterpart exactly.

## Reference Files

| Component | Mock File |
|-----------|-----------|
| ChatTopBar | `components/mock/MockTopBar.vue` |
| MessageList | `components/mock/MockMessageList.vue` |
| InputBox | `components/mock/MockInputBox.vue` |
| InputToolbar | `components/mock/MockInputToolbar.vue` |
| StatusBar | `components/mock/MockStatusBar.vue` |

## File Locations

```
src/renderer/src/components/chat/
  ChatTopBar.vue
  MessageList.vue
  ChatInputBox.vue
  ChatInputToolbar.vue
  ChatStatusBar.vue
```

---

## 1. ChatTopBar

**Mock reference**: `MockTopBar.vue` (copy layout and classes exactly)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│ [folder] project-name > Session Title    [Share][...]│
└─────────────────────────────────────────────────────┘
```

**Props**:
```typescript
interface Props {
  title: string
  project: string
}
```

**Data flow**: Props passed from ChatPage, which reads from `sessionStore.activeSession`.

**Key behavior**:
- `projectName` computed as `project.split('/').pop()`
- Sticky positioning: `sticky top-0 z-10`
- Window drag region with no-drag on buttons

---

## 2. MessageList

**Mock reference**: `MockMessageList.vue` (copy layout and classes exactly)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│            [User message - right-aligned]            │
│                                                      │
│ [Avatar] [Assistant message]                         │
│          [Model name label]                          │
│          [Message content]                           │
└─────────────────────────────────────────────────────┘
```

**Data flow**: Reads messages from the existing `useChatStore()`.

```typescript
const chatStore = useChatStore()
const messages = computed(() => chatStore.getCurrentThreadMessages())
```

**IPC call mapping**:

| Operation | Presenter Call |
|-----------|---------------|
| Load messages | `sessionPresenter.getMessages(conversationId, page, pageSize)` |
| Load message IDs | `sessionPresenter.getMessageIds(conversationId)` |

Note: The existing `useChatStore` already handles message fetching and caching via `STREAM_EVENTS.RESPONSE` and `STREAM_EVENTS.END`. The new MessageList component consumes from that store.

**Key behavior**:
- User messages: right-aligned, `bg-muted rounded-2xl`
- Assistant messages: left-aligned with model icon, model name label
- Container: `max-w-3xl mx-auto px-4 py-6 space-y-6`
- Scrollable overflow

---

## 3. ChatInputBox

**Mock reference**: `MockInputBox.vue` (copy layout and classes exactly)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│  Ask DeepChat anything, @ to mention files...       │
│                                                      │
├─────────────────────────────────────────────────────┤
│  [toolbar slot]                                      │
└─────────────────────────────────────────────────────┘
```

**Props/Events**:
```typescript
interface Props {
  modelValue?: string
  placeholder?: string
}

interface Emits {
  (e: 'update:modelValue', value: string): void
  (e: 'submit', message: string): void
}
```

**Slots**:
- `toolbar`: Slot for InputToolbar

**Key behavior**:
- Textarea with `min-h-[80px] resize-none border-0 bg-transparent`
- Container: `rounded-xl border bg-card/30 backdrop-blur-lg shadow-sm`
- Enter to submit (shift+enter for newline)

---

## 4. ChatInputToolbar

**Mock reference**: `MockInputToolbar.vue` (copy layout and classes exactly)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│ [+]                                    [mic] [send] │
└─────────────────────────────────────────────────────┘
```

**Events**:
```typescript
interface Emits {
  (e: 'send'): void
  (e: 'attach'): void
}
```

**Key behavior**:
- Attach button: `lucide:plus` icon, ghost variant
- Mic button: `lucide:mic` icon, ghost variant
- Send button: `lucide:arrow-up` icon, `rounded-full`, primary style

---

## 5. ChatStatusBar

**Mock reference**: `MockStatusBar.vue` (copy layout and classes exactly)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│ [ModelIcon Model ▼]  [Effort ▼]    [Permissions ▼] │
└─────────────────────────────────────────────────────┘
```

**Data flow**:

| Selector | Read from | Write to |
|----------|-----------|----------|
| Model | `chatStore.chatConfig.modelId` + `modelStore` for list | `sessionPresenter.updateSessionSettings()` |
| Effort (reasoningEffort) | `chatStore.chatConfig.reasoningEffort` | `sessionPresenter.updateSessionSettings()` |
| Permissions | TBD (permission system) | TBD |

**IPC call mapping**:

| Operation | Presenter Call |
|-----------|---------------|
| Change model | `sessionPresenter.updateSessionSettings(sessionId, { providerId, modelId })` |
| Change effort | `sessionPresenter.updateSessionSettings(sessionId, { reasoningEffort })` |
| Get model list | `configPresenter.getProviderDb()` or existing `modelStore` |

**Key behavior**:
- All buttons: `h-6 px-2 gap-1 text-xs text-muted-foreground`
- Model selector shows ModelIcon + model name + chevron-down
- Effort selector shows gauge icon + level + chevron-down
- Permissions selector shows shield icon + level name

---

## Shared Input Flow (NewThread + Chat)

Both NewThreadPage and ChatPage use the same InputBox + InputToolbar + StatusBar combination. The submit behavior differs:

| Context | On Submit |
|---------|-----------|
| NewThreadPage | `sessionStore.createSession({ title, message, projectDir, ... })` |
| ChatPage | `agentPresenter.chat(sessionId, message, tabId)` |

The parent page component handles the submit event and dispatches accordingly.

## Test Points

1. ChatTopBar displays project name and title correctly
2. MessageList renders user messages right-aligned and assistant messages left-aligned
3. ChatInputBox emits `submit` on Enter, `update:modelValue` on typing
4. ChatInputToolbar emits `send` on send button click
5. ChatStatusBar model dropdown shows available models
6. ChatStatusBar effort dropdown shows effort levels
7. All component styles match their mock counterparts exactly
