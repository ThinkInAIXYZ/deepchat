import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { AgentConfig, AgentType } from '@shared/agent'

export const useAgentStore = defineStore('agent', () => {
  const agentManager = usePresenter('agentManager')

  // 状态
  const agents = ref<AgentConfig[]>([])
  const currentAgentId = ref<string | null>(null)
  const agentStatuses = ref<Map<string, { isOk: boolean; errorMsg: string | null }>>(new Map())

  // Getters
  const currentAgent = computed(() => {
    if (!currentAgentId.value) return null
    return agents.value.find(agent => agent.id === currentAgentId.value) || null
  })

  const enabledAgents = computed(() => {
    return agents.value.filter(agent => agent.enabled)
  })

  const agentsByType = computed(() => {
    return (type: AgentType) => agents.value.filter(agent => agent.type === type)
  })

  const getAgentStatus = computed(() => {
    return (agentId: string) => agentStatuses.value.get(agentId) || { isOk: false, errorMsg: 'Unknown' }
  })

  // Actions
  const loadAgents = async () => {
    try {
      const allAgents = await agentManager.getAllAgents()
      agents.value = allAgents
      console.log('Loaded agents:', allAgents)
    } catch (error) {
      console.error('Failed to load agents:', error)
    }
  }

  const loadAgentStatus = async (agentId: string) => {
    try {
      const status = await agentManager.checkAgent(agentId)
      agentStatuses.value.set(agentId, status)
      return status
    } catch (error) {
      console.error(`Failed to check agent ${agentId}:`, error)
      const errorStatus = { isOk: false, errorMsg: 'Connection failed' }
      agentStatuses.value.set(agentId, errorStatus)
      return errorStatus
    }
  }

  const loadAllAgentStatuses = async () => {
    const promises = agents.value.map(agent => loadAgentStatus(agent.id))
    await Promise.all(promises)
  }

  const setCurrentAgent = (agentId: string | null) => {
    currentAgentId.value = agentId
  }

  const getAgentById = (agentId: string): AgentConfig | null => {
    return agents.value.find(agent => agent.id === agentId) || null
  }

  const createAgentTab = async (windowId: number, agentId: string, options?: any) => {
    try {
      const tabId = await agentManager.createAgentTab(windowId, agentId, options)
      console.log(`Created agent tab ${tabId} for agent ${agentId}`)
      return tabId
    } catch (error) {
      console.error('Failed to create agent tab:', error)
      return null
    }
  }

  const updateAgent = async (agentId: string, updates: Partial<AgentConfig>) => {
    try {
      await agentManager.updateAgent(agentId, updates)
      // 更新本地状态
      const agentIndex = agents.value.findIndex(agent => agent.id === agentId)
      if (agentIndex !== -1) {
        agents.value[agentIndex] = { ...agents.value[agentIndex], ...updates }
      }
      // 重新检查状态
      await loadAgentStatus(agentId)
    } catch (error) {
      console.error('Failed to update agent:', error)
      throw error
    }
  }

  const refreshAgent = async (agentId: string) => {
    try {
      const agent = await agentManager.getAgent(agentId)
      if (agent) {
        const agentIndex = agents.value.findIndex(a => a.id === agentId)
        if (agentIndex !== -1) {
          agents.value[agentIndex] = agent
        } else {
          agents.value.push(agent)
        }
        // 同时更新状态
        await loadAgentStatus(agentId)
      }
    } catch (error) {
      console.error(`Failed to refresh agent ${agentId}:`, error)
    }
  }

  // 根据类型获取默认 Agent
  const getDefaultAgentByType = (type: AgentType): AgentConfig | null => {
    const agentsOfType = agents.value.filter(agent => agent.type === type && agent.enabled)
    return agentsOfType.length > 0 ? agentsOfType[0] : null
  }

  // 检查是否支持某种 Agent 类型
  const supportsAgentType = (type: AgentType): boolean => {
    return agents.value.some(agent => agent.type === type && agent.enabled)
  }

  // 测试创建Agent Tab的方法
  const testCreateAgentTab = async () => {
    try {
      console.log('Testing Agent Tab creation...')

      // 获取所有Agent
      await loadAgents()
      console.log('Available agents:', agents.value)

      // 查找datlas agent
      const datlasAgent = agents.value.find(agent => agent.type === 'datlas')
      if (!datlasAgent) {
        console.error('Datlas agent not found')
        return false
      }

      console.log('Found datlas agent:', datlasAgent)

      // 检查agent状态
      const status = await loadAgentStatus(datlasAgent.id)
      console.log('Agent status:', status)

      // 获取当前窗口ID
      const windowId = window.api.getWindowId()
      console.log('Current window ID:', windowId)

      // 创建Agent Tab
      const tabId = await createAgentTab(windowId, datlasAgent.id)
      console.log('Created agent tab:', tabId)

      return tabId !== null
    } catch (error) {
      console.error('Test failed:', error)
      return false
    }
  }

  return {
    // 状态
    agents,
    currentAgentId,
    agentStatuses,

    // Getters
    currentAgent,
    enabledAgents,
    agentsByType,
    getAgentStatus,

    // Actions
    loadAgents,
    loadAgentStatus,
    loadAllAgentStatuses,
    setCurrentAgent,
    getAgentById,
    createAgentTab,
    updateAgent,
    refreshAgent,
    getDefaultAgentByType,
    supportsAgentType,
    testCreateAgentTab
  }
})
