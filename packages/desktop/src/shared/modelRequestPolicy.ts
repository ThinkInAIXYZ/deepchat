import { getUnqualifiedModelId, normalizeCanonicalModelId, normalizeModelIdText } from './modelId'

const THINKING_SUFFIX = ':thinking'
const MINIMAX_ADAPTIVE_THINKING_PROVIDER_IDS = new Set(['minimax', 'minimax-cn', 'minimax-global'])
const FIXED_TEMPERATURE_MODELS = new Set([
  'kimi-k2.5',
  'kimi-k2.6',
  'kimi-for-coding',
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed',
  'moonshotai/kimi-k2.5',
  'moonshotai/kimi-k2.6'
])

export const MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE = 1.0
export const MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE = 0.6

export type RequestParameterPolicy<T> =
  | { mode: 'passthrough' }
  | { mode: 'fixed'; value: T }
  | { mode: 'omit' }

export type LegacyThinkingType = 'enabled' | 'disabled'

export interface ModelRequestPolicy {
  temperature: RequestParameterPolicy<number>
  topP: RequestParameterPolicy<number>
  reasoning: RequestParameterPolicy<boolean>
  legacyThinking: RequestParameterPolicy<LegacyThinkingType>
}

export interface MoonshotKimiTemperaturePolicy {
  modelId: string
  baseModelId: string
  isThinkingVariant: boolean
  lockTemperatureControl: true
  thinkingEnabledTemperature: typeof MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE
  thinkingDisabledTemperature: typeof MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE
}

export interface ResolvedMoonshotKimiTemperaturePolicy extends MoonshotKimiTemperaturePolicy {
  reasoningEnabled: boolean
  temperature: number
  thinkingType: LegacyThinkingType
}

const passthrough = <T>(): RequestParameterPolicy<T> => ({ mode: 'passthrough' })

export const createPassthroughModelRequestPolicy = (): ModelRequestPolicy => ({
  temperature: passthrough(),
  topP: passthrough(),
  reasoning: passthrough(),
  legacyThinking: passthrough()
})

export const resolveCapabilityAwareRequestParameterPolicy = <T>(
  policy: RequestParameterPolicy<T>,
  supported: boolean | null | undefined
): RequestParameterPolicy<T> => {
  if (policy.mode !== 'passthrough' || supported !== false) {
    return policy
  }

  return { mode: 'omit' }
}

export const isKimiK3ModelId = (modelId: string | null | undefined): boolean => {
  const canonicalModelId = normalizeCanonicalModelId(modelId)
  return /^(?:coding-)?kimi-k3(?:-free)?$/.test(canonicalModelId)
}

export const isMiniMaxM3AdaptiveThinkingModel = (
  providerId: string | null | undefined,
  modelId: string | null | undefined
): boolean => {
  const normalizedProviderId = providerId?.trim().toLowerCase()
  if (!normalizedProviderId || !MINIMAX_ADAPTIVE_THINKING_PROVIDER_IDS.has(normalizedProviderId)) {
    return false
  }

  return getUnqualifiedModelId(modelId) === 'minimax-m3'
}

export const getMoonshotKimiTemperaturePolicy = (
  _providerId: string | null | undefined,
  modelId: string | null | undefined
): MoonshotKimiTemperaturePolicy | null => {
  const normalizedModelId = normalizeModelIdText(modelId)
  if (!normalizedModelId) {
    return null
  }

  const isThinkingVariant = normalizedModelId.endsWith(THINKING_SUFFIX)
  const baseModelId = isThinkingVariant
    ? normalizedModelId.slice(0, -THINKING_SUFFIX.length)
    : normalizedModelId

  if (!FIXED_TEMPERATURE_MODELS.has(baseModelId)) {
    return null
  }

  return {
    modelId: normalizedModelId,
    baseModelId,
    isThinkingVariant,
    lockTemperatureControl: true,
    thinkingEnabledTemperature: MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE,
    thinkingDisabledTemperature: MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE
  }
}

export const resolveMoonshotKimiTemperaturePolicy = (
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  reasoningEnabled: boolean | null | undefined
): ResolvedMoonshotKimiTemperaturePolicy | null => {
  const policy = getMoonshotKimiTemperaturePolicy(providerId, modelId)
  if (!policy) {
    return null
  }

  const effectiveReasoningEnabled = policy.isThinkingVariant ? true : reasoningEnabled === true

  return {
    ...policy,
    reasoningEnabled: effectiveReasoningEnabled,
    temperature: effectiveReasoningEnabled
      ? policy.thinkingEnabledTemperature
      : policy.thinkingDisabledTemperature,
    thinkingType: effectiveReasoningEnabled ? 'enabled' : 'disabled'
  }
}

export const resolveModelRequestPolicy = (
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  reasoningEnabled: boolean | null | undefined
): ModelRequestPolicy => {
  if (isKimiK3ModelId(modelId)) {
    return {
      temperature: { mode: 'omit' },
      topP: { mode: 'omit' },
      reasoning: { mode: 'fixed', value: true },
      legacyThinking: { mode: 'omit' }
    }
  }

  if (isMiniMaxM3AdaptiveThinkingModel(providerId, modelId) && reasoningEnabled === true) {
    return {
      temperature: { mode: 'omit' },
      topP: passthrough(),
      reasoning: passthrough(),
      legacyThinking: passthrough()
    }
  }

  const kimiPolicy = resolveMoonshotKimiTemperaturePolicy(providerId, modelId, reasoningEnabled)
  if (!kimiPolicy) {
    return createPassthroughModelRequestPolicy()
  }

  return {
    temperature: { mode: 'fixed', value: kimiPolicy.temperature },
    topP: passthrough(),
    reasoning: { mode: 'fixed', value: kimiPolicy.reasoningEnabled },
    legacyThinking: { mode: 'fixed', value: kimiPolicy.thinkingType }
  }
}

export const applyRequestParameterPolicy = <T>(
  policy: RequestParameterPolicy<T>,
  value: T | undefined
): T | undefined => {
  switch (policy.mode) {
    case 'fixed':
      return policy.value
    case 'omit':
      return undefined
    case 'passthrough':
    default:
      return value
  }
}

export const applyModelRequestPolicy = <
  T extends {
    reasoning?: boolean
    temperature?: number
    topP?: number
  }
>(
  value: T,
  policy: ModelRequestPolicy
): T => {
  if (
    policy.temperature.mode === 'passthrough' &&
    policy.topP.mode === 'passthrough' &&
    policy.reasoning.mode === 'passthrough'
  ) {
    return value
  }

  return {
    ...value,
    reasoning: applyRequestParameterPolicy(policy.reasoning, value.reasoning),
    temperature: applyRequestParameterPolicy(policy.temperature, value.temperature),
    topP: applyRequestParameterPolicy(policy.topP, value.topP)
  }
}

export const applyMoonshotKimiReasoningTemperaturePolicy = <
  T extends {
    reasoning?: boolean
    temperature?: number
  }
>(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  value: T
): T => {
  const resolved = resolveMoonshotKimiTemperaturePolicy(providerId, modelId, value.reasoning)
  if (!resolved) {
    return value
  }

  return {
    ...value,
    reasoning: resolved.reasoningEnabled,
    temperature: resolved.temperature
  }
}
