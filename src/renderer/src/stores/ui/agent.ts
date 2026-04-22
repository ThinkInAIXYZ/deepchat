import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createConfigClient } from '../../../api/ConfigClient'
import { createModelClient } from '../../../api/ModelClient'
import { createSessionClient } from '../../../api/SessionClient'
import type { Agent, AgentBootstrapItem } from '@shared/types/agent-interface'

// --- Type Definitions ---

export interface UIAgent {
  id: string
  name: string
  type: 'deepchat' | 'acp'
  agentType?: 'deepchat' | 'acp'
  enabled: boolean
  protected?: boolean
  icon?: string
  description?: string
  source?: 'builtin' | 'registry' | 'manual'
  avatar?: Agent['avatar']
  config?: Agent['config']
  installState?: Agent['installState']
}

// --- Store ---

export const useAgentStore = defineStore('agent', () => {
  const sessionClient = createSessionClient()
  const configClient = createConfigClient()
  const modelClient = createModelClient()
  let listenersRegistered = false

  // --- State ---
  const agents = ref<UIAgent[]>([])
  const selectedAgentId = ref<string | null>(null) // null = "All Agents"
  const loading = ref(false)
  const error = ref<string | null>(null)

  // --- Getters ---
  const enabledAgents = computed(() => agents.value.filter((a) => a.enabled))
  const selectedAgent = computed(() => agents.value.find((a) => a.id === selectedAgentId.value))

  // --- Actions ---

  function mapAgentToUiAgent(agent: Agent | AgentBootstrapItem): UIAgent {
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      agentType: agent.agentType,
      enabled: agent.enabled,
      protected: agent.protected,
      icon: agent.icon,
      description: agent.description,
      source: agent.source,
      avatar: agent.avatar,
      config: 'config' in agent ? agent.config : undefined,
      installState: 'installState' in agent ? (agent.installState ?? null) : null
    }
  }

  function applyAgents(nextAgents: Array<Agent | AgentBootstrapItem>): void {
    agents.value = nextAgents.map(mapAgentToUiAgent)
    if (selectedAgentId.value !== null) {
      const currentSelectedAgent = agents.value.find((agent) => agent.id === selectedAgentId.value)
      if (!currentSelectedAgent || !currentSelectedAgent.enabled) {
        selectedAgentId.value = null
      }
    }
  }

  function applyBootstrapAgents(nextAgents: AgentBootstrapItem[]): void {
    applyAgents(nextAgents)
  }

  async function fetchAgents(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result: Agent[] = await sessionClient.getAgents()
      applyAgents(result)
    } catch (e) {
      error.value = `Failed to load agents: ${e}`
    } finally {
      loading.value = false
    }
  }

  function setSelectedAgent(id: string | null): void {
    selectedAgentId.value = id
  }

  function selectAgent(id: string | null): void {
    selectedAgentId.value = selectedAgentId.value === id ? null : id
  }

  if (!listenersRegistered) {
    listenersRegistered = true
    modelClient.onModelsChanged(({ providerId }) => {
      if (providerId === 'acp') {
        void fetchAgents()
      }
    })
    configClient.onAgentsChanged(() => {
      void fetchAgents()
    })
  }

  return {
    agents,
    selectedAgentId,
    loading,
    error,
    enabledAgents,
    selectedAgent,
    applyBootstrapAgents,
    setSelectedAgent,
    fetchAgents,
    selectAgent
  }
})
