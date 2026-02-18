# Working ChatStatusBar (Model + Effort Selectors)

## Problem

ChatStatusBar shows hardcoded "Claude 4 Sonnet" / "High" / "Default permissions". It needs to read from and write to the active session's config via `chatStore.chatConfig` and `chatStore.updateChatConfig()`.

## Model Selector

- **Read**: `chatStore.chatConfig.providerId` + `chatStore.chatConfig.modelId`
- **Display**: Resolve model name via `modelStore.findModelByIdOrName(modelId)`
- **List**: Flatten `modelStore.enabledModels` (array of `{ providerId, models[] }`)
- **Write**: `chatStore.updateChatConfig({ providerId, modelId })` on selection

## Effort Selector

- **Read**: `chatStore.chatConfig.reasoningEffort` (Anthropic/others), `chatStore.chatConfig.thinkingBudget` (Google), `chatStore.chatConfig.verbosity` (OpenAI)
- **Display**: Unified effort label from the provider-appropriate field
- **Options**: Low, Medium, High (map to `reasoningEffort` values)
- **Write**: `chatStore.updateChatConfig({ reasoningEffort: value })` — the backend normalizes per provider

### Effort Type Reference

From `CONVERSATION_SETTINGS`:
- `reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'`
- `verbosity?: 'low' | 'medium' | 'high'`
- `thinkingBudget?: number`

## Permissions Indicator

Stream-driven (permissions are requested per tool call). Kept as read-only indicator. Actual permission handling is done by `MessageBlockPermissionRequest` in the message list.

## Initialization

`modelStore.initialize()` must be called during `ChatTabView.onMounted` to ensure models are loaded before the status bar renders.

## Files Modified

- `src/renderer/src/components/chat/ChatStatusBar.vue` — major rewrite with real data
- `src/renderer/src/views/ChatTabView.vue` — add `modelStore.initialize()` to onMounted
