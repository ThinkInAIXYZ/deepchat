import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { Agent } from '@shared/types/agent-interface'

// --- Type Definitions ---

export interface UIAgent {
  id: string
  name: string
  type: 'deepchat' | 'acp'
  enabled: boolean
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
  const selectedAgentName = computed(() => selectedAgent.value?.name ?? 'All Agents')

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
        enabled: a.enabled
      }))
    } catch (e) {
      error.value = `Failed to load agents: ${e}`
    } finally {
      loading.value = false
    }
  }

  function selectAgent(id: string | null): void {
    selectedAgentId.value = selectedAgentId.value === id ? null : id
  }

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
