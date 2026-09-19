import type { AgentSettingsPort } from './agentSettings.js'
import type { ProviderModelResolutionPort } from './providerModelResolution.js'

export type SessionVisionTargetResolution = {
  providerId: string
  modelId: string
  source: 'session-model' | 'agent-vision-model'
}

/**
 * Session vision target resolution surface the built-in kernel needs. The host provides the
 * resolver implementation; kernel modules receive this port instead of importing the host module.
 */
export interface VisionTargetResolverPort {
  resolveSessionVisionTarget(params: {
    providerId?: string | null
    modelId?: string | null
    agentId?: string | null
    signal?: AbortSignal
    providerConfig: Pick<ProviderModelResolutionPort, 'getModelConfig' | 'isKnownModel'>
    agentSettings: Pick<AgentSettingsPort, 'resolveDeepChatAgentConfig'>
    logLabel?: string
  }): Promise<SessionVisionTargetResolution | null>
}
