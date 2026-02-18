import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'
import type { AcpBuiltinAgent, AcpCustomAgent } from '@shared/types/presenters/legacy.presenters'

// --- Type Definitions ---

export interface UIAgent {
  id: string
  name: string
  type: 'deepchat' | 'builtin-acp' | 'custom-acp'
  enabled: boolean
}

// --- Helper Functions ---

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

// --- Store ---

export const useAgentStore = defineStore('agent', () => {
  const configPresenter = usePresenter('configPresenter')

  // --- State ---
  const agents = ref<UIAgent[]>([])
  const selectedAgentId = ref<string | null>(null) // null = "All Agents"
  const loading = ref(false)
  const error = ref<string | null>(null)

  // --- Getters ---
  const enabledAgents = computed(() => agents.value.filter((a) => a.enabled))
  const selectedAgent = computed(() => agents.value.find((a) => a.id === selectedAgentId.value))
  const selectedAgentName = computed(() => selectedAgent.value?.name ?? 'All Agents')

  // --- Actions ---

  async function fetchAgents(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const deepchatAgent: UIAgent = {
        id: 'deepchat',
        name: 'DeepChat',
        type: 'deepchat',
        enabled: true // Always enabled
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

  function selectAgent(id: string | null): void {
    selectedAgentId.value = selectedAgentId.value === id ? null : id
  }

  // --- Event Listeners ---

  window.electron.ipcRenderer.on(CONFIG_EVENTS.SETTING_CHANGED, () => {
    fetchAgents()
  })

  return {
    agents,
    selectedAgentId,
    loading,
    error,
    enabledAgents,
    selectedAgent,
    selectedAgentName,
    fetchAgents,
    selectAgent
  }
})
