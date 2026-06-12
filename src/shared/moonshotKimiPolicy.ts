const THINKING_SUFFIX = ':thinking'
const FIXED_TEMPERATURE_MODELS = new Set([
  'kimi-k2.5',
  'kimi-k2.6',
  'moonshotai/kimi-k2.5',
  'moonshotai/kimi-k2.6'
])

export const MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE = 1.0
export const MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE = 0.6

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
  thinkingType: 'enabled' | 'disabled'
}

const normalizeModelId = (modelId: string | null | undefined): string =>
  modelId
    ?.trim()
    .toLowerCase()
    .replace(/^models\//, '') ?? ''

export const getMoonshotKimiTemperaturePolicy = (
  _providerId: string | null | undefined,
  modelId: string | null | undefined
): MoonshotKimiTemperaturePolicy | null => {
  const normalizedModelId = normalizeModelId(modelId)
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
  reasoning: boolean | null | undefined
): ResolvedMoonshotKimiTemperaturePolicy | null => {
  const policy = getMoonshotKimiTemperaturePolicy(providerId, modelId)
  if (!policy) {
    return null
  }

  const reasoningEnabled = policy.isThinkingVariant ? true : reasoning === true

  return {
    ...policy,
    reasoningEnabled,
    temperature: reasoningEnabled
      ? policy.thinkingEnabledTemperature
      : policy.thinkingDisabledTemperature,
    thinkingType: reasoningEnabled ? 'enabled' : 'disabled'
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
