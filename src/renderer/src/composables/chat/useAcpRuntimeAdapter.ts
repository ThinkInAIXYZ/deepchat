import { usePresenter } from '@/composables/usePresenter'
import type { IAcpPresenter } from '@shared/presenter'

/**
 * ACP runtime adapter for session-level and process-level ACP settings.
 * Uses acpPresenter for all ACP-specific operations.
 */
export function useAcpRuntimeAdapter() {
  // Use type assertion since acpPresenter may not be in IPresenter type yet
  const acpPresenter = usePresenter('acpPresenter' as any) as IAcpPresenter

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

  const getAcpWorkdir = (_conversationId: string, _agentId: string) => {
    // ACP workdir is now managed by acpPresenter sessions
    // Return null as this is deprecated - workdir is part of session creation
    return Promise.resolve(null as { path?: string; isCustom?: boolean } | null)
  }

  const setAcpWorkdir = async (
    _conversationId: string,
    _agentId: string,
    _workdir: string | null
  ) => {
    // ACP workdir is now managed by acpPresenter sessions
    // This is a no-op as workdir is set during session creation
    return Promise.resolve()
  }

  const warmupAcpProcess = async (agentId: string, workdir: string) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    ensureNonEmptyString(workdir, 'Workdir')
    return wrap('warmupAcpProcess', () => acpPresenter.warmupProcess(agentId, workdir))
  }

  const ensureAcpWarmup = async (agentId: string, workdir: string | null) => {
    ensureNonEmptyString(agentId, 'Agent ID')
    if (workdir) {
      return wrap('ensureAcpWarmup', () => acpPresenter.warmupProcess(agentId, workdir))
    }
    return Promise.resolve()
  }

  const getAcpProcessModes = (_agentId: string, _workdir: string) => {
    // Process modes are now returned via session info
    return Promise.resolve(
      null as {
        availableModes?: { id: string; name: string; description: string }[]
        currentModeId?: string
      } | null
    )
  }

  const getAcpProcessModels = (_agentId: string, _workdir: string) => {
    // Process models are now returned via session info
    return Promise.resolve(
      null as {
        availableModels?: { id: string; name: string; description?: string }[]
        currentModelId?: string
      } | null
    )
  }

  const setAcpPreferredProcessMode = async (
    _agentId: string,
    _workdir: string,
    _modeId: string
  ) => {
    // Mode is now set via session
    return Promise.resolve()
  }

  const setAcpPreferredProcessModel = async (
    _agentId: string,
    _workdir: string,
    _modelId: string
  ) => {
    // Model is now set via session
    return Promise.resolve()
  }

  const setAcpSessionMode = async (sessionId: string, modeId: string) => {
    ensureNonEmptyString(sessionId, 'Session ID')
    ensureNonEmptyString(modeId, 'Mode ID')
    return wrap('setAcpSessionMode', () => acpPresenter.setSessionMode(sessionId, modeId))
  }

  const setAcpSessionModel = async (sessionId: string, modelId: string) => {
    ensureNonEmptyString(sessionId, 'Session ID')
    ensureNonEmptyString(modelId, 'Model ID')
    return wrap('setAcpSessionModel', () => acpPresenter.setSessionModel(sessionId, modelId))
  }

  const getAcpSessionModes = (sessionId: string) => {
    ensureNonEmptyString(sessionId, 'Session ID')
    const sessionInfo = acpPresenter.getSessionInfo(sessionId)
    if (!sessionInfo?.availableModes) return null
    return {
      available: sessionInfo.availableModes as { id: string; name: string; description: string }[],
      current: sessionInfo.currentModeId ?? ''
    }
  }

  const getAcpSessionModels = (sessionId: string) => {
    ensureNonEmptyString(sessionId, 'Session ID')
    const sessionInfo = acpPresenter.getSessionInfo(sessionId)
    if (!sessionInfo?.availableModels) return null
    return {
      available: sessionInfo.availableModels as {
        id: string
        name: string
        description?: string
      }[],
      current: sessionInfo.currentModelId ?? ''
    }
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
