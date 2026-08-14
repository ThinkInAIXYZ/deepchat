import {
  isClaudeFamilyModelId,
  isDeepSeekSeriesModelId,
  isGeminiFamilyModelId,
  type NewApiCapabilityFamilyHint,
  type NewApiEndpointType
} from '@shared/model'
import type {
  CapabilitySnapshotQuery,
  ResolvedCapabilityIdentity,
  ResolvedModelCapabilitySnapshot
} from '@shared/types/model-capabilities'
import { modelCapabilities, type CapabilityModelMatch } from './modelCapabilities'
import {
  resolveCapabilityAwareRequestParameterPolicy,
  resolveModelRequestPolicy
} from '@shared/modelRequestPolicy'
import { normalizeCanonicalModelId } from '@shared/modelId'

export type CapabilityIdentityInput = {
  providerId: string
  modelId: string
  ownedBy?: string
  endpointType?: NewApiEndpointType
  explicitProviderId?: string
}

const OPENCODE_GO_ANTHROPIC_MODEL_IDS = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus'
])

export const isZenmuxAnthropicRoute = (providerId: string, modelId: string): boolean =>
  providerId.trim().toLowerCase() === 'zenmux' &&
  modelId.trim().toLowerCase().startsWith('anthropic/')

export const isOpenCodeGoAnthropicRoute = (providerId: string, modelId: string): boolean =>
  providerId.trim().toLowerCase() === 'opencode-go' &&
  OPENCODE_GO_ANTHROPIC_MODEL_IDS.has(modelId.trim().toLowerCase())

const normalizeHintValue = (value: string | undefined): string =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[./_-]+/g, ' ') ?? ''

const normalizeProviderId = (providerId: string): string =>
  modelCapabilities.resolveProviderId(providerId.trim().toLowerCase()) ??
  providerId.trim().toLowerCase()

const addUniqueProviderId = (providerIds: string[], providerId: string): void => {
  const normalizedProviderId = normalizeProviderId(providerId)
  if (normalizedProviderId && !providerIds.includes(normalizedProviderId)) {
    providerIds.push(normalizedProviderId)
  }
}

const getNamespaceProviderIds = (modelId: string): string[] => {
  const normalizedModelId = modelId.trim().toLowerCase()
  const namespace = normalizedModelId.includes('/')
    ? normalizedModelId.slice(0, normalizedModelId.indexOf('/'))
    : undefined
  if (!namespace) {
    return []
  }

  const providerIds: string[] = []
  const mappedProviderId = (
    {
      anthropic: 'anthropic',
      google: 'google',
      gemini: 'google',
      openai: 'openai',
      moonshot: 'moonshot',
      moonshotai: 'moonshot',
      kimi: 'moonshot',
      zhipuai: 'zhipuai',
      zai: 'zhipuai',
      'z-ai': 'zhipuai',
      'zai-org': 'zhipuai',
      minimax: 'minimax',
      minimaxai: 'minimax',
      stepfun: 'stepfun',
      'stepfun-ai': 'stepfun',
      mistral: 'mistral',
      mistralai: 'mistral',
      cohere: 'cohere',
      xai: 'xai',
      'x-ai': 'xai',
      deepseek: 'deepseek',
      qwen: 'alibaba-cn',
      alibaba: 'alibaba-cn',
      dashscope: 'alibaba-cn',
      doubao: 'doubao',
      volcengine: 'doubao',
      bytedance: 'doubao'
    } as Record<string, string>
  )[namespace]

  if (mappedProviderId) {
    addUniqueProviderId(providerIds, mappedProviderId)
  }
  addUniqueProviderId(providerIds, namespace)
  return providerIds
}

const getOwnerProviderIds = (ownedBy: string | undefined): string[] => {
  const owner = normalizeHintValue(ownedBy)
  const providerIds: string[] = []

  if (owner.includes('claude') || owner.includes('anthropic')) {
    addUniqueProviderId(providerIds, 'anthropic')
  }
  if (owner.includes('gemini') || owner.includes('google')) {
    addUniqueProviderId(providerIds, 'google')
  }
  if (owner.includes('moonshot') || owner.includes('kimi')) {
    addUniqueProviderId(providerIds, 'moonshot')
  }
  if (owner.includes('zhipu') || owner.includes('z ai') || owner.includes('zai')) {
    addUniqueProviderId(providerIds, 'zhipuai')
  }
  if (owner.includes('minimax')) {
    addUniqueProviderId(providerIds, 'minimax')
  }
  if (owner.includes('stepfun')) {
    addUniqueProviderId(providerIds, 'stepfun')
  }
  if (owner.includes('mistral')) {
    addUniqueProviderId(providerIds, 'mistral')
  }
  if (owner.includes('cohere')) {
    addUniqueProviderId(providerIds, 'cohere')
  }
  if (owner.includes('deepseek')) {
    addUniqueProviderId(providerIds, 'deepseek')
  }
  if (owner.includes('xai') || /(?:^| )x ai(?: |$)/.test(owner) || owner.includes('grok')) {
    addUniqueProviderId(providerIds, 'xai')
  }
  if (
    owner === 'ali' ||
    owner.includes('alibaba') ||
    owner.includes('qwen') ||
    owner.includes('dashscope')
  ) {
    addUniqueProviderId(providerIds, 'alibaba-cn')
    addUniqueProviderId(providerIds, 'alibaba')
  }
  if (owner.includes('volcengine') || owner.includes('doubao') || owner.includes('bytedance')) {
    addUniqueProviderId(providerIds, 'doubao')
  }
  if (owner.includes('openai')) {
    addUniqueProviderId(providerIds, 'openai')
  }

  return providerIds
}

const getModelFamilyProviderIds = (modelId: string): string[] => {
  const normalizedModelId = normalizeHintValue(modelId)
  const canonicalModelId = normalizeCanonicalModelId(modelId)
  const providerIds: string[] = []

  if (isClaudeFamilyModelId(modelId)) {
    addUniqueProviderId(providerIds, 'anthropic')
  }
  if (isGeminiFamilyModelId(modelId)) {
    addUniqueProviderId(providerIds, 'google')
  }
  if (normalizedModelId.includes('kimi') || normalizedModelId.includes('moonshot')) {
    addUniqueProviderId(providerIds, 'moonshot')
  }
  if (canonicalModelId.startsWith('glm-')) {
    addUniqueProviderId(providerIds, 'zhipuai')
  }
  if (canonicalModelId.startsWith('minimax-')) {
    addUniqueProviderId(providerIds, 'minimax')
  }
  if (/^step(?:audio)?-/.test(canonicalModelId)) {
    addUniqueProviderId(providerIds, 'stepfun')
  }
  if (
    [
      'mistral-',
      'mixtral-',
      'ministral-',
      'magistral-',
      'devstral-',
      'codestral-',
      'pixtral-'
    ].some((prefix) => canonicalModelId.startsWith(prefix))
  ) {
    addUniqueProviderId(providerIds, 'mistral')
  }
  if (canonicalModelId.startsWith('command-') || canonicalModelId.startsWith('c4ai-aya-')) {
    addUniqueProviderId(providerIds, 'cohere')
  }
  if (canonicalModelId.startsWith('gpt-oss-')) {
    addUniqueProviderId(providerIds, 'openai')
  }
  if (normalizedModelId.includes('qwen') || normalizedModelId.includes('qwq')) {
    addUniqueProviderId(providerIds, 'alibaba-cn')
    addUniqueProviderId(providerIds, 'alibaba')
  }
  if (isDeepSeekSeriesModelId(modelId)) {
    addUniqueProviderId(providerIds, 'deepseek')
  }
  if (normalizedModelId.includes('doubao')) {
    addUniqueProviderId(providerIds, 'doubao')
  }
  if (normalizedModelId.includes('grok') || normalizedModelId.includes('xai')) {
    addUniqueProviderId(providerIds, 'xai')
  }

  return providerIds
}

const getExplicitRouteCapabilityProviderId = (
  providerId: string,
  modelId: string
): string | undefined => {
  if (isZenmuxAnthropicRoute(providerId, modelId)) {
    return 'anthropic'
  }

  if (isOpenCodeGoAnthropicRoute(providerId, modelId)) {
    return 'anthropic'
  }

  return undefined
}

const toMatchedIdentity = (
  match: CapabilityModelMatch,
  requestModelId: string
): ResolvedCapabilityIdentity => ({
  providerId: match.providerId,
  requestModelId,
  catalogMatched: true,
  catalogModelId: match.modelId
})

const resolveProviderMatch = (
  providerIds: readonly string[],
  modelId: string
): ResolvedCapabilityIdentity | undefined => {
  for (const providerId of providerIds) {
    const match = modelCapabilities.getProviderCapabilityModelMatch(providerId, modelId)
    if (match) {
      return toMatchedIdentity(match, modelId)
    }
  }
  return undefined
}

export const resolveCapabilityFamilyHint = (
  modelId: string,
  ownedBy?: string
): NewApiCapabilityFamilyHint | undefined => {
  const normalizedOwner = normalizeHintValue(ownedBy)
  if (
    isClaudeFamilyModelId(modelId) ||
    normalizedOwner.includes('claude') ||
    normalizedOwner.includes('anthropic') ||
    modelCapabilities.getProviderCapabilityModelMatch('anthropic', modelId)
  ) {
    return 'anthropic'
  }

  if (
    isGeminiFamilyModelId(modelId) ||
    normalizedOwner.includes('gemini') ||
    normalizedOwner.includes('google') ||
    modelCapabilities.getProviderCapabilityModelMatch('google', modelId)
  ) {
    return 'gemini'
  }

  return undefined
}

const resolveTransportCapabilityFallback = (
  providerId: string,
  endpointType?: NewApiEndpointType
): string => {
  switch (endpointType) {
    case 'anthropic':
      return 'anthropic'
    case 'gemini':
      return 'google'
    case 'openai':
    case 'openai-response':
    case 'image-generation':
    case 'video-generation':
      return 'openai'
    default:
      return normalizeProviderId(providerId)
  }
}

export const resolveCapabilityIdentity = (
  input: CapabilityIdentityInput
): ResolvedCapabilityIdentity => {
  const explicitProviderId = input.explicitProviderId?.trim()
  if (explicitProviderId) {
    return (
      resolveProviderMatch([explicitProviderId], input.modelId) ?? {
        providerId: normalizeProviderId(explicitProviderId),
        requestModelId: input.modelId,
        catalogMatched: false,
        catalogModelId: null
      }
    )
  }

  const routeOverrideProviderId = getExplicitRouteCapabilityProviderId(
    input.providerId,
    input.modelId
  )
  if (routeOverrideProviderId) {
    return (
      resolveProviderMatch([routeOverrideProviderId], input.modelId) ?? {
        providerId: normalizeProviderId(routeOverrideProviderId),
        requestModelId: input.modelId,
        catalogMatched: false,
        catalogModelId: null
      }
    )
  }

  const providerModelIdentity = resolveProviderMatch([input.providerId], input.modelId)
  if (providerModelIdentity) {
    return providerModelIdentity
  }

  const identityCandidates = [
    getNamespaceProviderIds(input.modelId),
    getOwnerProviderIds(input.ownedBy),
    getModelFamilyProviderIds(input.modelId)
  ]

  for (const providerIds of identityCandidates) {
    const identity = resolveProviderMatch(providerIds, input.modelId)
    if (identity) {
      return identity
    }
  }

  const transportProviderId = resolveTransportCapabilityFallback(
    input.providerId,
    input.endpointType
  )
  const transportIdentity = resolveProviderMatch([transportProviderId], input.modelId)
  if (transportIdentity) {
    return transportIdentity
  }

  const uniqueMatch = modelCapabilities.findUniqueCapabilityModelMatch(input.modelId)
  if (uniqueMatch) {
    return toMatchedIdentity(uniqueMatch, input.modelId)
  }

  return {
    providerId: transportProviderId,
    requestModelId: input.modelId,
    catalogMatched: false,
    catalogModelId: null
  }
}

export const buildResolvedCapabilitySnapshot = (
  identity: ResolvedCapabilityIdentity,
  options: Pick<CapabilitySnapshotQuery, 'reasoningEnabled'> = {}
): ResolvedModelCapabilitySnapshot => {
  const catalogModelId = identity.catalogModelId ?? identity.requestModelId
  const catalog = modelCapabilities.getCatalogCapabilitySnapshot(
    identity.providerId,
    catalogModelId
  )
  const baseRequestPolicy = resolveModelRequestPolicy(
    identity.providerId,
    identity.requestModelId,
    options.reasoningEnabled
  )
  const temperaturePolicy = resolveCapabilityAwareRequestParameterPolicy(
    baseRequestPolicy.temperature,
    catalog.temperatureCapability
  )
  const capabilityAwareRequestPolicy =
    temperaturePolicy === baseRequestPolicy.temperature
      ? baseRequestPolicy
      : {
          ...baseRequestPolicy,
          temperature: temperaturePolicy
        }
  const omitAnthropicTopP =
    capabilityAwareRequestPolicy.topP.mode === 'passthrough' &&
    identity.providerId === 'anthropic' &&
    catalog.temperatureCapability === false
  const requestPolicy = omitAnthropicTopP
    ? {
        ...capabilityAwareRequestPolicy,
        topP: { mode: 'omit' as const }
      }
    : capabilityAwareRequestPolicy

  return {
    identity,
    ...(catalog.defaultToolMode ? { defaultToolMode: catalog.defaultToolMode } : {}),
    requestPolicy,
    supportsAudioInput: catalog.supportsAudioInput,
    supportsReasoning: catalog.supportsReasoning,
    reasoningPortrait: catalog.reasoningPortrait,
    thinkingBudgetRange: catalog.thinkingBudgetRange,
    supportsSearch: catalog.supportsSearch,
    searchDefaults: catalog.searchDefaults,
    temperatureCapability: catalog.temperatureCapability,
    supportsTemperatureControl: catalog.temperatureCapability !== false,
    supportsReasoningEffort: catalog.supportsReasoningEffort,
    reasoningEffortDefault: catalog.reasoningEffortDefault,
    supportsVerbosity: catalog.supportsVerbosity,
    verbosityDefault: catalog.verbosityDefault
  }
}
