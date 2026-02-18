# Agent-Aware Session Creation

## Problem

`NewThreadPage.onSubmit()` calls `sessionStore.createSession()` without passing `agentId`. The `createSession` action already supports `agentId` in `CreateSessionInput` and handles ACP agent mode, but it is never provided from the UI.

## Solution

Import `useAgentStore` in `NewThreadPage.vue` and pass the selected agent to `createSession()`.

### Flow

1. User selects an agent in the sidebar (sets `agentStore.selectedAgentId`)
2. User opens NewThreadPage and types a message
3. On submit, `NewThreadPage` reads `agentStore.selectedAgentId`
4. Passes `agentId` to `sessionStore.createSession()`
5. `createSession()` already handles ACP mode:
   - If `agentId !== 'deepchat'`: sets `chatMode: 'acp agent'`, `acpWorkdirMap: { [agentId]: projectDir }`
   - If `agentId === 'deepchat'` or undefined: standard DeepChat session

### Key Types

- `CreateSessionInput.agentId?: string` — from `stores/ui/session.ts`
- `agentStore.selectedAgentId: string | null` — `null` means "All Agents" filter (default to 'deepchat')

### Files Modified

- `src/renderer/src/pages/NewThreadPage.vue` — add `useAgentStore` import, pass `agentId` and `providerId`/`modelId` for ACP agents
