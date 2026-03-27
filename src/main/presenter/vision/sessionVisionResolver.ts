import type { IConfigPresenter } from '@shared/presenter'

export type SessionVisionTarget = {
  providerId: string
  modelId: string
  source: 'session-model' | 'agent-vision-model'
}

type SessionVisionResolverParams = {
  providerId?: string | null
  modelId?: string | null
  agentId?: string | null
  signal?: AbortSignal
  configPresenter: Pick<
    IConfigPresenter,
    'getModelConfig' | 'resolveDeepChatAgentConfig' | 'isKnownModel'
  >
  logLabel?: string
}

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError')
  }

  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const throwIfAbortRequested = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

export async function resolveSessionVisionTarget(
  params: SessionVisionResolverParams
): Promise<SessionVisionTarget | null> {
  throwIfAbortRequested(params.signal)
  const sessionProviderId = params.providerId?.trim()
  const sessionModelId = params.modelId?.trim()
  const sessionModelConfig =
    sessionProviderId && sessionModelId
      ? params.configPresenter.getModelConfig(sessionModelId, sessionProviderId)
      : null

  if (
    sessionProviderId &&
    sessionModelId &&
    params.configPresenter.isKnownModel?.(sessionProviderId, sessionModelId) === true &&
    sessionModelConfig?.vision
  ) {
    return {
      providerId: sessionProviderId,
      modelId: sessionModelId,
      source: 'session-model'
    }
  }

  const agentId = params.agentId?.trim()
  if (!agentId) {
    return null
  }

  try {
    throwIfAbortRequested(params.signal)
    const agentConfig = await params.configPresenter.resolveDeepChatAgentConfig(agentId)
    throwIfAbortRequested(params.signal)
    const providerId = agentConfig.visionModel?.providerId?.trim()
    const modelId = agentConfig.visionModel?.modelId?.trim()
    if (providerId && modelId) {
      return {
        providerId,
        modelId,
        source: 'agent-vision-model'
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    console.warn('[Vision] Failed to resolve agent vision model:', {
      agentId,
      context: params.logLabel ?? 'unknown',
      error
    })
  }

  return null
}
