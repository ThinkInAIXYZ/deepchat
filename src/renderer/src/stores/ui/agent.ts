import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'
import type { Agent } from '@shared/types/agent-interface'

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
  const newAgentPresenter = usePresenter('newAgentPresenter')

  // --- State ---
  const agents = ref<UIAgent[]>([])
  const selectedAgentId = ref<string | null>(null) // null = "All Agents"
  const loading = ref(false)
  const error = ref<string | null>(null)

  // --- Getters ---
  const enabledAgents = computed(() => agents.value.filter((a) => a.enabled))
  const selectedAgent = computed(() => agents.value.find((a) => a.id === selectedAgentId.value))

  // --- Actions ---

  async function fetchAgents(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result: Agent[] = await newAgentPresenter.getAgents()
      agents.value = result.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        agentType: a.agentType,
        enabled: a.enabled,
        protected: a.protected,
        icon: a.icon,
        description: a.description,
        source: a.source,
        avatar: a.avatar,
        config: a.config,
        installState: a.installState ?? null
      }))
      if (
        selectedAgentId.value !== null &&
        !agents.value.some((agent) => agent.id === selectedAgentId.value)
      ) {
        selectedAgentId.value = null
      }
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

  window.electron.ipcRenderer.on(
    CONFIG_EVENTS.MODEL_LIST_CHANGED,
    (_: unknown, providerId?: string) => {
      if (providerId === 'acp') {
        void fetchAgents()
      }
    }
  )

  window.electron.ipcRenderer.on(CONFIG_EVENTS.AGENTS_CHANGED, () => {
    void fetchAgents()
  })

  return {
    agents,
    selectedAgentId,
    loading,
    error,
    enabledAgents,
    selectedAgent,
    setSelectedAgent,
    fetchAgents,
    selectAgent
  }
})
