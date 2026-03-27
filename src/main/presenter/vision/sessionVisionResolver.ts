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
  configPresenter: Pick<
    IConfigPresenter,
    'getModelConfig' | 'resolveDeepChatAgentConfig' | 'isKnownModel'
  >
  logLabel?: string
}

export async function resolveSessionVisionTarget(
  params: SessionVisionResolverParams
): Promise<SessionVisionTarget | null> {
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
    const agentConfig = await params.configPresenter.resolveDeepChatAgentConfig(agentId)
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
    console.warn('[Vision] Failed to resolve agent vision model:', {
      agentId,
      context: params.logLabel ?? 'unknown',
      error
    })
  }

  return null
}
