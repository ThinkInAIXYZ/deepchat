import { usePresenter } from '@/composables/usePresenter'

/**
 * ACP runtime adapter for session-level and process-level ACP settings.
 */
export function useAcpRuntimeAdapter() {
  const sessionPresenter = usePresenter('sessionPresenter')

  const ensureNonEmptyString = (value: string, label: string) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${label} is required`)
    }
  }

  const wrap = async <T>(label: string, fn: () => Promise<T>) => {
    try {
      return await fn()
    } catch (error) {
      console.error(`[AcpRuntimeAdapter] ${label} failed`, error)
      throw error
    }
  }

  const getAcpWorkdir = (conversationId: string, agentId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureNonEmptyString(agentId, 'Agent ID')
    return sessionPresenter.getAcpWorkdir(conversationId, agentId)
  }

  const setAcpWorkdir = async (conversationId: string, agentId: string, workdir: string | null) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureNonEmptyString(agentId, 'Agent ID')
    return wrap('setAcpWorkdir', () =>
      sessionPresenter.setAcpWorkdir(conversationId, agentId, workdir)
    )
  }

  const warmupAcpProcess = async (agentId: string, workdir: string) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    ensureNonEmptyString(workdir, 'Workdir')
    return wrap('warmupAcpProcess', () => sessionPresenter.warmupAcpProcess(agentId, workdir))
  }

  const ensureAcpWarmup = async (agentId: string, workdir: string | null) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    return wrap('ensureAcpWarmup', () => sessionPresenter.ensureAcpWarmup(agentId, workdir))
  }

  const getAcpProcessModes = (agentId: string, workdir: string) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    ensureNonEmptyString(workdir, 'Workdir')
    return sessionPresenter.getAcpProcessModes(agentId, workdir)
  }

  const getAcpProcessModels = (agentId: string, workdir: string) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    ensureNonEmptyString(workdir, 'Workdir')
    return sessionPresenter.getAcpProcessModels(agentId, workdir)
  }

  const setAcpPreferredProcessMode = async (agentId: string, workdir: string, modeId: string) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    ensureNonEmptyString(workdir, 'Workdir')
    ensureNonEmptyString(modeId, 'Mode ID')
    return wrap('setAcpPreferredProcessMode', () =>
      sessionPresenter.setAcpPreferredProcessMode(agentId, workdir, modeId)
    )
  }

  const setAcpPreferredProcessModel = async (agentId: string, workdir: string, modelId: string) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    ensureNonEmptyString(workdir, 'Workdir')
    ensureNonEmptyString(modelId, 'Model ID')
    return wrap('setAcpPreferredProcessModel', () =>
      sessionPresenter.setAcpPreferredProcessModel(agentId, workdir, modelId)
    )
  }

  const setAcpSessionMode = async (conversationId: string, modeId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureNonEmptyString(modeId, 'Mode ID')
    return wrap('setAcpSessionMode', () =>
      sessionPresenter.setAcpSessionMode(conversationId, modeId)
    )
  }

  const setAcpSessionModel = async (conversationId: string, modelId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    ensureNonEmptyString(modelId, 'Model ID')
    return wrap('setAcpSessionModel', () =>
      sessionPresenter.setAcpSessionModel(conversationId, modelId)
    )
  }

  const getAcpSessionModes = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.getAcpSessionModes(conversationId)
  }

  const getAcpSessionModels = (conversationId: string) => {
    ensureNonEmptyString(conversationId, 'Conversation ID')
    return sessionPresenter.getAcpSessionModels(conversationId)
  }

  return {
    getAcpWorkdir,
    setAcpWorkdir,
    warmupAcpProcess,
    ensureAcpWarmup,
    getAcpProcessModes,
    getAcpProcessModels,
    setAcpPreferredProcessMode,
    setAcpPreferredProcessModel,
    setAcpSessionMode,
    setAcpSessionModel,
    getAcpSessionModes,
    getAcpSessionModels
  }
}
