import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import type { Agent, TemplateAgent, AcpAgent } from '@shared/types/presenters/agentConfig.presenter'

export const LOCAL_AGENT_ID = 'local-agent'

export interface LocalAgentEntry {
  id: typeof LOCAL_AGENT_ID
  name: string
  type: 'local'
}

export type SidebarAgent = AcpAgent | LocalAgentEntry

export const useAgentStore = defineStore('agent', () => {
  const agentConfigPresenter = usePresenter('agentConfigPresenter')

  const agents = ref<Agent[]>([])
  const selectedAgentId = ref<string | null>(null)
  const loading = ref(false)

  const selectedAgent = computed(() => {
    if (selectedAgentId.value === null) return null
    if (selectedAgentId.value === LOCAL_AGENT_ID) {
      return { id: LOCAL_AGENT_ID, name: 'Local', type: 'local' } as LocalAgentEntry
    }
    return agents.value.find((a) => a.id === selectedAgentId.value) ?? null
  })

  const templateAgents = computed<TemplateAgent[]>(() =>
    agents.value.filter((a): a is TemplateAgent => a.type === 'template')
  )

  const acpAgents = computed<AcpAgent[]>(() =>
    agents.value.filter((a): a is AcpAgent => a.type === 'acp' && a.enabled)
  )

  const builtinAcpAgents = computed<AcpAgent[]>(() =>
    acpAgents.value.filter((a) => a.isBuiltin && a.builtinId)
  )

  const customAcpAgents = computed<AcpAgent[]>(() => acpAgents.value.filter((a) => !a.isBuiltin))

  const hasLocalAgents = computed(() => templateAgents.value.length > 0)

  const localAgentEntry = computed<LocalAgentEntry>(() => ({
    id: LOCAL_AGENT_ID,
    name: 'Local',
    type: 'local'
  }))

  const sidebarAgents = computed<SidebarAgent[]>(() => {
    const result: SidebarAgent[] = []
    result.push(...builtinAcpAgents.value)
    result.push(localAgentEntry.value)
    return result
  })

  const allAgents = computed(() => agents.value)

  async function loadAgents() {
    loading.value = true
    try {
      agents.value = await agentConfigPresenter.getAgents()
    } catch (error) {
      console.error('Failed to load agents:', error)
    } finally {
      loading.value = false
    }
  }

  function selectAgent(id: string | null) {
    selectedAgentId.value = id
  }

  function isBuiltinAgent(agent: Agent | LocalAgentEntry): agent is AcpAgent {
    return 'type' in agent && agent.type === 'acp' && agent.isBuiltin === true
  }

  function getAgentIconId(agent: Agent | LocalAgentEntry): string {
    if ('type' in agent && agent.type === 'local') {
      return 'local-agent'
    }
    if (isBuiltinAgent(agent)) {
      return (agent as AcpAgent).builtinId || agent.id
    }
    return agent.id
  }

  return {
    agents,
    selectedAgentId,
    loading,
    selectedAgent,
    templateAgents,
    acpAgents,
    builtinAcpAgents,
    customAcpAgents,
    hasLocalAgents,
    localAgentEntry,
    sidebarAgents,
    allAgents,
    loadAgents,
    selectAgent,
    isBuiltinAgent,
    getAgentIconId
  }
})
