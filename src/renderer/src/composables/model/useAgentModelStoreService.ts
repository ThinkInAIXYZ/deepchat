import { ref } from 'vue'
import type {
  AgentProcessHandle,
  AgentSessionState,
  MODEL_META,
  RENDERER_MODEL_META
} from '@shared/presenter'
import { ModelType } from '@shared/model'
import { useAgentModelAdapter } from '@/composables/model/useAgentModelAdapter'

export interface AgentModelRefreshResult {
  rendererModels: RENDERER_MODEL_META[]
  modelMetas: MODEL_META[]
}

const PROCESS_KEY_SEPARATOR = ':'

const buildProcessKey = (providerId: string, agentId: string) =>
  `${providerId}${PROCESS_KEY_SEPARATOR}${agentId}`

export const useAgentModelStoreService = () => {
  const configAdapter = useAgentModelAdapter()

  const agentModels = ref<Record<string, RENDERER_MODEL_META[]>>({})
  const sessionStatus = ref<Record<string, AgentSessionState>>({})
  const processStatus = ref<Record<string, AgentProcessHandle>>({})

  const refreshAgentModels = async (providerId: string): Promise<AgentModelRefreshResult> => {
    if (providerId !== 'acp') {
      agentModels.value[providerId] = []
      return { rendererModels: [], modelMetas: [] }
    }

    const acpEnabled = await configAdapter.getAcpEnabled()
    if (!acpEnabled) {
      agentModels.value[providerId] = []
      return { rendererModels: [], modelMetas: [] }
    }

    const agents = await configAdapter.getAcpAgents()
    const rendererModels: RENDERER_MODEL_META[] = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      group: 'ACP',
      providerId,
      enabled: true,
      isCustom: true,
      contextLength: 8192,
      maxTokens: 4096,
      vision: false,
      functionCall: true,
      reasoning: false,
      enableSearch: false,
      type: ModelType.Chat
    }))

    agentModels.value[providerId] = rendererModels

    const modelMetas: MODEL_META[] = rendererModels.map((model) => ({
      id: model.id,
      name: model.name,
      group: model.group,
      providerId: model.providerId,
      isCustom: true,
      contextLength: model.contextLength,
      maxTokens: model.maxTokens,
      functionCall: model.functionCall,
      reasoning: model.reasoning,
      enableSearch: model.enableSearch,
      type: model.type
    }))

    return { rendererModels, modelMetas }
  }

  const getSessionStatus = (conversationId: string): AgentSessionState | null =>
    sessionStatus.value[conversationId] ?? null

  const upsertSessionStatus = (session: AgentSessionState) => {
    sessionStatus.value[session.conversationId] = session
    sessionStatus.value = { ...sessionStatus.value }
  }

  const removeSessionStatus = (conversationId: string) => {
    if (!sessionStatus.value[conversationId]) return
    delete sessionStatus.value[conversationId]
    sessionStatus.value = { ...sessionStatus.value }
  }

  const clearSessions = (providerId?: string) => {
    if (!providerId) {
      sessionStatus.value = {}
      return
    }
    const filteredEntries = Object.entries(sessionStatus.value).filter(
      ([, state]) => state.providerId !== providerId
    )
    sessionStatus.value = Object.fromEntries(filteredEntries)
  }

  const getProcessStatus = (providerId: string, agentId: string): AgentProcessHandle | null =>
    processStatus.value[buildProcessKey(providerId, agentId)] ?? null

  const upsertProcessStatus = (handle: AgentProcessHandle) => {
    processStatus.value[buildProcessKey(handle.providerId, handle.agentId)] = handle
    processStatus.value = { ...processStatus.value }
  }

  const clearProcesses = (providerId?: string) => {
    if (!providerId) {
      processStatus.value = {}
      return
    }
    const filteredEntries = Object.entries(processStatus.value).filter(
      ([key]) => !key.startsWith(`${providerId}${PROCESS_KEY_SEPARATOR}`)
    )
    processStatus.value = Object.fromEntries(filteredEntries)
  }

  const clearAll = () => {
    agentModels.value = {}
    sessionStatus.value = {}
    processStatus.value = {}
  }

  return {
    agentModels,
    sessionStatus,
    processStatus,
    refreshAgentModels,
    getSessionStatus,
    upsertSessionStatus,
    removeSessionStatus,
    clearSessions,
    getProcessStatus,
    upsertProcessStatus,
    clearProcesses,
    clearAll
  }
}
