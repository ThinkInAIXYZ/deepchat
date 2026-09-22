import {
  resolveNewApiEndpointTypeFromRoute,
  type NewApiRouteMeta,
  type NewApiEndpointType
} from '@shared/model'
import type { LLM_PROVIDER } from '@shared/types/provider'
import type { AiSdkProviderKind } from './aiSdk/providerFactory'
import type { AiSdkProviderDefinition } from './providerRegistry'
import { isApimartResponsesRoute, isOpenCodeGoAnthropicRoute } from './capabilityIdentity'

export function resolveProviderTransport(
  definition: AiSdkProviderDefinition,
  provider: LLM_PROVIDER,
  modelId: string,
  route: NewApiRouteMeta | null
): { providerKind: AiSdkProviderKind; endpointType?: NewApiEndpointType } {
  const strategy = definition.routeStrategy
  if (strategy === 'opencode-go' && isOpenCodeGoAnthropicRoute(provider.id, modelId)) {
    return { providerKind: 'anthropic' }
  }
  if (strategy !== 'new-api' && strategy !== 'apimart') {
    return { providerKind: definition.runtimeKind }
  }

  const endpointType =
    isApimartResponsesRoute(provider.id, modelId) ||
    isApimartResponsesRoute(provider.apiType, modelId)
      ? 'openai-response'
      : resolveNewApiEndpointTypeFromRoute(route, modelId)
  const providerKind =
    endpointType === 'anthropic'
      ? 'anthropic'
      : endpointType === 'gemini'
        ? 'gemini'
        : endpointType === 'openai-response'
          ? 'openai-responses'
          : 'openai-compatible'
  return { providerKind, endpointType }
}
