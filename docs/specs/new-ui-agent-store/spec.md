# Agent Store Spec

## Overview

Agent Store manages the agent list (DeepChat built-in + ACP agents) and the sidebar agent filter selection.

## File Location

`src/renderer/src/stores/ui/agent.ts`

## Type Definitions

```typescript
interface UIAgent {
  id: string                         // 'deepchat', 'claude-code-acp', 'codex-acp', custom id
  name: string                       // Display name
  type: 'deepchat' | 'builtin-acp' | 'custom-acp'
  enabled: boolean
}
```

### Mapping from Presenter Types

DeepChat agent is hardcoded. ACP agents come from two presenter calls:

```typescript
// Built-in ACP agents (claude-code, codex, kimi)
const builtinAgents: AcpBuiltinAgent[] = await configPresenter.getAcpBuiltinAgents()

// Custom ACP agents (user-defined)
const customAgents: AcpCustomAgent[] = await configPresenter.getAcpCustomAgents()
```

Mapping:

```typescript
function mapBuiltinAgent(agent: AcpBuiltinAgent): UIAgent {
  return {
    id: agent.id,
    name: agent.name,
    type: 'builtin-acp',
    enabled: agent.enabled
  }
}

function mapCustomAgent(agent: AcpCustomAgent): UIAgent {
  return {
    id: agent.id,
    name: agent.name,
    type: 'custom-acp',
    enabled: agent.enabled
  }
}
```

## Store Design

```typescript
export const useAgentStore = defineStore('agent', () => {
  const configPresenter = usePresenter('configPresenter')

  // --- State ---
  const agents = ref<UIAgent[]>([])
  const selectedAgentId = ref<string | null>(null)   // null = "All Agents"
  const loading = ref(false)
  const error = ref<string | null>(null)

  // --- Getters ---
  const enabledAgents = computed(() => agents.value.filter(a => a.enabled))
  const selectedAgent = computed(() => agents.value.find(a => a.id === selectedAgentId.value))
  const selectedAgentName = computed(() => selectedAgent.value?.name ?? 'All Agents')

  // --- Actions ---
  async function fetchAgents(): Promise<void>
  function selectAgent(id: string | null): void

  return {
    agents, selectedAgentId, loading, error,
    enabledAgents, selectedAgent, selectedAgentName,
    fetchAgents, selectAgent
  }
})
```

## Actions

### `fetchAgents(): Promise<void>`

```typescript
async function fetchAgents() {
  loading.value = true
  error.value = null
  try {
    const deepchatAgent: UIAgent = {
      id: 'deepchat',
      name: 'DeepChat',
      type: 'deepchat',
      enabled: true       // Always enabled
    }

    const builtinAgents = await configPresenter.getAcpBuiltinAgents()
    const customAgents = await configPresenter.getAcpCustomAgents()

    agents.value = [
      deepchatAgent,
      ...builtinAgents.map(mapBuiltinAgent),
      ...customAgents.map(mapCustomAgent)
    ]
  } catch (e) {
    error.value = `Failed to load agents: ${e}`
  } finally {
    loading.value = false
  }
}
```

### `selectAgent(id: string | null): void`

Toggle agent filter. Passing the currently selected id deselects it (back to "All").

```typescript
function selectAgent(id: string | null) {
  selectedAgentId.value = selectedAgentId.value === id ? null : id
}
```

## IPC Call Mapping

| Action | Presenter Call |
|--------|---------------|
| Get built-in ACP agents | `configPresenter.getAcpBuiltinAgents()` |
| Get custom ACP agents | `configPresenter.getAcpCustomAgents()` |

## Event Listeners

| Event | Handler |
|-------|---------|
| `CONFIG_EVENTS.SETTING_CHANGED` | Re-fetch agents (ACP config may have changed) |

Note: There are no dedicated ACP_EVENTS.AGENT_ADDED/REMOVED events in the codebase. Agent changes propagate through `CONFIG_EVENTS.SETTING_CHANGED`.

## Error Handling

Errors are caught in `fetchAgents` and stored in `error` ref. The DeepChat agent is always present even if ACP agent fetching fails.

## Test Points

1. DeepChat agent is always present in agent list
2. Built-in ACP agents are mapped correctly from `getAcpBuiltinAgents()`
3. Custom ACP agents are mapped correctly from `getAcpCustomAgents()`
4. Disabled agents appear in list but `enabledAgents` filters them out
5. `selectAgent` toggles selection (same id deselects)
6. `selectedAgentName` returns 'All Agents' when nothing selected
7. Error during fetch sets `error` and still includes DeepChat agent
