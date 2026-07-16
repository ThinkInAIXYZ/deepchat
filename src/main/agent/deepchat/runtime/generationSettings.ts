import type { ProviderModelResolutionPort } from '@/provider/settings'
import type { PromptSettings } from '@/agent/promptSettings'
import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'
import type { ReasoningPortrait } from '@shared/types/model-db'
import {
  getReasoningEffectiveEnabledForProvider,
  hasAnthropicReasoningToggle,
  isReasoningEffort,
  normalizeAnthropicReasoningVisibilityValue,
  normalizeReasoningEffortValue,
  normalizeReasoningVisibilityValue,
  isVerbosity
} from '@shared/types/model-db'
import {
  normalizeLegacyThinkingBudgetValue,
  parseFiniteNumericValue,
  toValidNonNegativeInteger,
  validateGenerationNumericField
} from '@shared/utils/generationSettingsValidation'
import { resolveMoonshotKimiTemperaturePolicy } from '@shared/moonshotKimiPolicy'
import {
  DEFAULT_MODEL_TIMEOUT,
  MODEL_TIMEOUT_MAX_MS,
  MODEL_TIMEOUT_MIN_MS
} from '@shared/modelConfigDefaults'
import {
  normalizeImageGenerationOptions,
  supportsOpenAIImageGenerationSettings
} from '@shared/imageGenerationSettings'
import {
  normalizeVideoGenerationOptions,
  supportsOpenAICompatibleVideoGeneration
} from '@shared/videoGenerationSettings'
import { isDeepSeekSeriesModelId } from '@shared/model'
import { providerDbLoader } from '@/provider/providerDbLoader'
import { capAgentDefaultMaxTokens } from './contextBudget'
import type { InterleavedReasoningConfig } from './types'

export type PersistedSessionGenerationRow = {
  provider_id: string
  model_id: string
  permission_mode: PermissionMode
  system_prompt: string | null
  temperature: number | null
  top_p: number | null
  context_length: number | null
  max_tokens: number | null
  timeout_ms: number | null
  thinking_budget: number | null
  reasoning_effort: SessionGenerationSettings['reasoningEffort'] | null
  reasoning_visibility: SessionGenerationSettings['reasoningVisibility'] | null
  verbosity: SessionGenerationSettings['verbosity'] | null
  force_interleaved_thinking_compat: number | null
  image_generation_options_json: string | null
  video_generation_options_json: string | null
}

function normalizeTopP(value: unknown): number | undefined {
  const numeric = parseFiniteNumericValue(value)
  return numeric !== undefined && numeric >= 0.1 && numeric <= 1 ? numeric : undefined
}

function parsePersistedJson<T>(value: string | null): T | undefined {
  if (!value) {
    return undefined
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

export function mapPersistedGenerationPatch(
  providerSettings: ProviderModelResolutionPort,
  sessionRow: PersistedSessionGenerationRow
): Partial<SessionGenerationSettings> {
  const patch: Partial<SessionGenerationSettings> = {}

  if (sessionRow.system_prompt !== null) {
    patch.systemPrompt = sessionRow.system_prompt
  }
  if (sessionRow.temperature !== null) {
    patch.temperature = sessionRow.temperature
  }
  if (sessionRow.top_p !== null) {
    patch.topP = sessionRow.top_p
  }
  if (sessionRow.context_length !== null) {
    patch.contextLength = sessionRow.context_length
  }
  if (sessionRow.max_tokens !== null) {
    patch.maxTokens = sessionRow.max_tokens
  }
  if (sessionRow.timeout_ms !== null) {
    patch.timeout = sessionRow.timeout_ms
  }
  if (sessionRow.thinking_budget !== null) {
    patch.thinkingBudget = normalizeLegacyThinkingBudgetValue(sessionRow.thinking_budget)
  }
  if (sessionRow.reasoning_effort !== null) {
    patch.reasoningEffort = sessionRow.reasoning_effort
  }
  if (sessionRow.reasoning_visibility !== null) {
    const reasoningVisibility = normalizeReasoningVisibility(
      providerSettings,
      sessionRow.provider_id,
      sessionRow.model_id,
      sessionRow.reasoning_visibility
    )
    if (reasoningVisibility) {
      patch.reasoningVisibility = reasoningVisibility
    }
  }
  if (sessionRow.verbosity !== null) {
    patch.verbosity = sessionRow.verbosity
  }
  if (typeof sessionRow.force_interleaved_thinking_compat === 'number') {
    patch.forceInterleavedThinkingCompat = sessionRow.force_interleaved_thinking_compat === 1
  }
  const imageGeneration = normalizeImageGenerationOptions(
    parsePersistedJson(sessionRow.image_generation_options_json)
  )
  if (imageGeneration) {
    patch.imageGeneration = imageGeneration
  }
  const videoGeneration = normalizeVideoGenerationOptions(
    parsePersistedJson(sessionRow.video_generation_options_json)
  )
  if (videoGeneration) {
    patch.videoGeneration = videoGeneration
  }

  return patch
}

export function buildPersistedGenerationSettingsPatch(
  requestedPatch: Partial<SessionGenerationSettings>,
  sanitized: SessionGenerationSettings
): Partial<SessionGenerationSettings> {
  const patch: Partial<SessionGenerationSettings> = {}

  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'systemPrompt')) {
    patch.systemPrompt = sanitized.systemPrompt
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'temperature')) {
    patch.temperature = sanitized.temperature
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'topP')) {
    patch.topP = sanitized.topP
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'contextLength')) {
    patch.contextLength = sanitized.contextLength
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'maxTokens')) {
    patch.maxTokens = sanitized.maxTokens
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'timeout')) {
    patch.timeout = sanitized.timeout
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'thinkingBudget')) {
    patch.thinkingBudget = sanitized.thinkingBudget
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'reasoningEffort')) {
    patch.reasoningEffort = sanitized.reasoningEffort
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'reasoningVisibility')) {
    patch.reasoningVisibility = sanitized.reasoningVisibility
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'verbosity')) {
    patch.verbosity = sanitized.verbosity
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'forceInterleavedThinkingCompat')) {
    patch.forceInterleavedThinkingCompat = sanitized.forceInterleavedThinkingCompat
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'imageGeneration')) {
    patch.imageGeneration = sanitized.imageGeneration
  }
  if (Object.prototype.hasOwnProperty.call(requestedPatch, 'videoGeneration')) {
    patch.videoGeneration = sanitized.videoGeneration
  }

  return patch
}

export function buildPersistedGenerationSettingsReplacement(
  settings: SessionGenerationSettings
): Partial<SessionGenerationSettings> {
  return {
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    topP: settings.topP,
    contextLength: settings.contextLength,
    maxTokens: settings.maxTokens,
    timeout: settings.timeout,
    thinkingBudget: settings.thinkingBudget,
    reasoningEffort: settings.reasoningEffort,
    reasoningVisibility: settings.reasoningVisibility,
    verbosity: settings.verbosity,
    forceInterleavedThinkingCompat: settings.forceInterleavedThinkingCompat,
    imageGeneration: settings.imageGeneration,
    videoGeneration: settings.videoGeneration
  }
}

function resolveProviderApiType(
  providerSettings: ProviderModelResolutionPort,
  providerId: string
): string | undefined {
  return providerSettings.getProviderById(providerId)?.apiType
}

async function buildDefaultGenerationSettings(
  providerSettings: ProviderModelResolutionPort,
  promptSettings: Pick<PromptSettings, 'getDefaultSystemPrompt'>,
  providerId: string,
  modelId: string
): Promise<SessionGenerationSettings> {
  const modelConfig = providerSettings.getModelConfig(modelId, providerId)
  const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
    providerId,
    modelId,
    modelConfig.reasoning
  )
  const portrait = getReasoningPortrait(providerSettings, providerId, modelId)
  const capabilityProviderId = resolveCapabilityProviderId(providerSettings, providerId, modelId)
  const anthropicReasoningToggle = hasAnthropicReasoningToggle(capabilityProviderId, portrait)
  const anthropicReasoningEnabled = anthropicReasoningToggle
    ? getReasoningEffectiveEnabledForProvider(capabilityProviderId, portrait, {
        reasoning: modelConfig.reasoning,
        reasoningEffort: modelConfig.reasoningEffort
      })
    : true
  const defaultSystemPrompt = await promptSettings.getDefaultSystemPrompt()
  const contextLengthDefault = toValidNonNegativeInteger(modelConfig.contextLength) ?? 32000
  const rawProviderMaxTokensDefault = toValidNonNegativeInteger(modelConfig.maxTokens)
  const providerMaxTokensDefault =
    rawProviderMaxTokensDefault && rawProviderMaxTokensDefault > 0
      ? rawProviderMaxTokensDefault
      : Math.min(4096, contextLengthDefault)
  const maxTokensDefault = capAgentDefaultMaxTokens(providerMaxTokensDefault, contextLengthDefault)
  const timeoutDefault = toValidNonNegativeInteger(modelConfig.timeout) ?? DEFAULT_MODEL_TIMEOUT

  const defaults: SessionGenerationSettings = {
    systemPrompt: defaultSystemPrompt ?? '',
    temperature:
      fixedTemperatureKimi?.temperature ?? parseFiniteNumericValue(modelConfig.temperature) ?? 0.7,
    topP: normalizeTopP(modelConfig.topP),
    contextLength: contextLengthDefault,
    timeout:
      timeoutDefault >= MODEL_TIMEOUT_MIN_MS && timeoutDefault <= MODEL_TIMEOUT_MAX_MS
        ? timeoutDefault
        : DEFAULT_MODEL_TIMEOUT,
    maxTokens:
      maxTokensDefault <= contextLengthDefault
        ? maxTokensDefault
        : Math.min(4096, contextLengthDefault)
  }

  const interleavedThinkingDefault =
    typeof modelConfig.forceInterleavedThinkingCompat === 'boolean'
      ? modelConfig.forceInterleavedThinkingCompat
      : portrait?.interleaved === true
        ? true
        : undefined
  if (typeof interleavedThinkingDefault === 'boolean') {
    defaults.forceInterleavedThinkingCompat = interleavedThinkingDefault
  }

  if (
    supportsOpenAIImageGenerationSettings({
      providerId,
      providerApiType: resolveProviderApiType(providerSettings, providerId),
      modelId,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType,
      type: modelConfig.type
    })
  ) {
    const imageGeneration = normalizeImageGenerationOptions(modelConfig.imageGeneration)
    if (imageGeneration) {
      defaults.imageGeneration = imageGeneration
    }
  }

  if (
    supportsOpenAICompatibleVideoGeneration({
      providerId,
      providerApiType: resolveProviderApiType(providerSettings, providerId),
      modelId,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType,
      type: modelConfig.type
    })
  ) {
    const videoGeneration = normalizeVideoGenerationOptions(modelConfig.videoGeneration)
    if (videoGeneration) {
      defaults.videoGeneration = videoGeneration
    }
  }

  const supportsReasoning = providerSettings.supportsReasoningCapability(providerId, modelId)
  if (supportsReasoning) {
    const defaultBudget = normalizeLegacyThinkingBudgetValue(
      modelConfig.thinkingBudget ??
        providerSettings.getThinkingBudgetRange(providerId, modelId)?.default
    )
    if (defaultBudget !== undefined) {
      defaults.thinkingBudget = defaultBudget
    }
  }

  const supportsEffort = providerSettings.supportsReasoningEffortCapability(providerId, modelId)
  if (supportsEffort && (!anthropicReasoningToggle || anthropicReasoningEnabled)) {
    const rawEffort =
      modelConfig.reasoningEffort ?? providerSettings.getReasoningEffortDefault(providerId, modelId)
    const normalizedEffort = normalizeReasoningEffort(
      providerSettings,
      providerId,
      modelId,
      rawEffort
    )
    if (normalizedEffort) {
      defaults.reasoningEffort = normalizedEffort
    }
  }

  if (anthropicReasoningToggle && anthropicReasoningEnabled) {
    const rawVisibility = modelConfig.reasoningVisibility ?? portrait?.visibility
    const normalizedVisibility = normalizeReasoningVisibility(
      providerSettings,
      providerId,
      modelId,
      rawVisibility
    )
    if (normalizedVisibility) {
      defaults.reasoningVisibility = normalizedVisibility
    }
  }

  const supportsVerbosity = providerSettings.supportsVerbosityCapability(providerId, modelId)
  if (supportsVerbosity) {
    const rawVerbosity =
      modelConfig.verbosity ?? providerSettings.getVerbosityDefault(providerId, modelId)
    const normalizedVerbosity = normalizeVerbosity(
      providerSettings,
      providerId,
      modelId,
      rawVerbosity
    )
    if (normalizedVerbosity) {
      defaults.verbosity = normalizedVerbosity
    }
  }

  return defaults
}

export async function sanitizeGenerationSettings(
  providerSettings: ProviderModelResolutionPort,
  promptSettings: Pick<PromptSettings, 'getDefaultSystemPrompt'>,
  providerId: string,
  modelId: string,
  patch: Partial<SessionGenerationSettings>,
  baseSettings?: SessionGenerationSettings
): Promise<SessionGenerationSettings> {
  const modelConfig = providerSettings.getModelConfig(modelId, providerId)
  const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
    providerId,
    modelId,
    modelConfig.reasoning
  )
  const portrait = getReasoningPortrait(providerSettings, providerId, modelId)
  const capabilityProviderId = resolveCapabilityProviderId(providerSettings, providerId, modelId)
  const anthropicReasoningToggle = hasAnthropicReasoningToggle(capabilityProviderId, portrait)
  const anthropicReasoningEnabled = anthropicReasoningToggle
    ? getReasoningEffectiveEnabledForProvider(capabilityProviderId, portrait, {
        reasoning: modelConfig.reasoning,
        reasoningEffort: modelConfig.reasoningEffort
      })
    : true
  const base = baseSettings
    ? { ...baseSettings }
    : await buildDefaultGenerationSettings(providerSettings, promptSettings, providerId, modelId)
  const next: SessionGenerationSettings = { ...base }

  if (Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')) {
    next.systemPrompt =
      typeof patch.systemPrompt === 'string' ? patch.systemPrompt : base.systemPrompt
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'temperature')) {
    const numeric = parseFiniteNumericValue(patch.temperature)
    if (numeric !== undefined) {
      next.temperature = numeric
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'topP')) {
    const normalizedTopP = normalizeTopP(patch.topP)
    if (normalizedTopP !== undefined) {
      next.topP = normalizedTopP
    } else {
      delete next.topP
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'timeout')) {
    const error = validateGenerationNumericField('timeout', patch.timeout)
    const numeric = toValidNonNegativeInteger(parseFiniteNumericValue(patch.timeout))
    if (!error && numeric !== undefined) {
      next.timeout = numeric
    }
  }

  const parsedContextLength = parseFiniteNumericValue(patch.contextLength)
  const parsedMaxTokens = parseFiniteNumericValue(patch.maxTokens)
  const nextContextReference =
    Object.prototype.hasOwnProperty.call(patch, 'contextLength') &&
    toValidNonNegativeInteger(parsedContextLength) !== undefined
      ? toValidNonNegativeInteger(parsedContextLength)
      : next.contextLength
  const nextMaxTokensReference =
    Object.prototype.hasOwnProperty.call(patch, 'maxTokens') &&
    toValidNonNegativeInteger(parsedMaxTokens) !== undefined
      ? toValidNonNegativeInteger(parsedMaxTokens)
      : next.maxTokens

  if (Object.prototype.hasOwnProperty.call(patch, 'contextLength')) {
    const error = validateGenerationNumericField('contextLength', patch.contextLength, {
      maxTokens: nextMaxTokensReference
    })
    const numeric = toValidNonNegativeInteger(parsedContextLength)
    if (!error && numeric !== undefined) {
      next.contextLength = numeric
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'maxTokens')) {
    const error = validateGenerationNumericField('maxTokens', patch.maxTokens, {
      contextLength: nextContextReference
    })
    const numeric = toValidNonNegativeInteger(parsedMaxTokens)
    if (!error && numeric !== undefined) {
      next.maxTokens = numeric
    }
  }

  const supportsReasoning = providerSettings.supportsReasoningCapability(providerId, modelId)
  if (supportsReasoning) {
    if (Object.prototype.hasOwnProperty.call(patch, 'thinkingBudget')) {
      const raw = patch.thinkingBudget
      if (raw === undefined) {
        delete next.thinkingBudget
      } else if (!validateGenerationNumericField('thinkingBudget', raw)) {
        const numeric = toValidNonNegativeInteger(raw)
        if (numeric !== undefined) {
          next.thinkingBudget = numeric
        }
      }
    }
  } else {
    delete next.thinkingBudget
  }

  const supportsEffort = providerSettings.supportsReasoningEffortCapability(providerId, modelId)
  if (supportsEffort && (!anthropicReasoningToggle || anthropicReasoningEnabled)) {
    const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')
      ? patch.reasoningEffort
      : next.reasoningEffort
    const defaultEffort = providerSettings.getReasoningEffortDefault(providerId, modelId)
    const normalizedEffort =
      normalizeReasoningEffort(providerSettings, providerId, modelId, fromPatch) ??
      normalizeReasoningEffort(providerSettings, providerId, modelId, defaultEffort)
    if (normalizedEffort) {
      next.reasoningEffort = normalizedEffort
    } else {
      delete next.reasoningEffort
    }
  } else {
    delete next.reasoningEffort
  }

  if (anthropicReasoningToggle && anthropicReasoningEnabled) {
    const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'reasoningVisibility')
      ? patch.reasoningVisibility
      : next.reasoningVisibility
    const defaultVisibility = normalizeReasoningVisibility(
      providerSettings,
      providerId,
      modelId,
      modelConfig.reasoningVisibility ?? portrait?.visibility
    )
    const normalizedVisibility =
      normalizeReasoningVisibility(providerSettings, providerId, modelId, fromPatch) ??
      defaultVisibility
    if (normalizedVisibility) {
      next.reasoningVisibility = normalizedVisibility
    } else {
      delete next.reasoningVisibility
    }
  } else {
    delete next.reasoningVisibility
  }

  const supportsVerbosity = providerSettings.supportsVerbosityCapability(providerId, modelId)
  if (supportsVerbosity) {
    const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'verbosity')
      ? patch.verbosity
      : next.verbosity
    const defaultVerbosity = providerSettings.getVerbosityDefault(providerId, modelId)
    const normalizedVerbosity =
      normalizeVerbosity(providerSettings, providerId, modelId, fromPatch) ??
      normalizeVerbosity(providerSettings, providerId, modelId, defaultVerbosity)
    if (normalizedVerbosity) {
      next.verbosity = normalizedVerbosity
    } else {
      delete next.verbosity
    }
  } else {
    delete next.verbosity
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'forceInterleavedThinkingCompat')) {
    if (typeof patch.forceInterleavedThinkingCompat === 'boolean') {
      next.forceInterleavedThinkingCompat = patch.forceInterleavedThinkingCompat
    } else {
      delete next.forceInterleavedThinkingCompat
    }
  } else if (typeof base.forceInterleavedThinkingCompat !== 'boolean') {
    delete next.forceInterleavedThinkingCompat
  }

  if (
    supportsOpenAIImageGenerationSettings({
      providerId,
      providerApiType: resolveProviderApiType(providerSettings, providerId),
      modelId,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType,
      type: modelConfig.type
    })
  ) {
    if (Object.prototype.hasOwnProperty.call(patch, 'imageGeneration')) {
      const imageGeneration = normalizeImageGenerationOptions(patch.imageGeneration)
      if (imageGeneration) {
        next.imageGeneration = imageGeneration
      } else {
        delete next.imageGeneration
      }
    } else {
      const imageGeneration = normalizeImageGenerationOptions(next.imageGeneration)
      if (imageGeneration) {
        next.imageGeneration = imageGeneration
      } else {
        delete next.imageGeneration
      }
    }
  } else {
    delete next.imageGeneration
  }

  if (
    supportsOpenAICompatibleVideoGeneration({
      providerId,
      providerApiType: resolveProviderApiType(providerSettings, providerId),
      modelId,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType,
      type: modelConfig.type
    })
  ) {
    if (Object.prototype.hasOwnProperty.call(patch, 'videoGeneration')) {
      const videoGeneration = normalizeVideoGenerationOptions(patch.videoGeneration)
      if (videoGeneration) {
        next.videoGeneration = videoGeneration
      } else {
        delete next.videoGeneration
      }
    } else {
      const videoGeneration = normalizeVideoGenerationOptions(next.videoGeneration)
      if (videoGeneration) {
        next.videoGeneration = videoGeneration
      } else {
        delete next.videoGeneration
      }
    }
  } else {
    delete next.videoGeneration
  }

  if (fixedTemperatureKimi) {
    next.temperature = fixedTemperatureKimi.temperature
  }

  return next
}

export function resolveInterleavedReasoningConfig(
  providerSettings: ProviderModelResolutionPort,
  providerId: string,
  modelId: string,
  generationSettings: SessionGenerationSettings
): InterleavedReasoningConfig {
  const portrait = getReasoningPortrait(providerSettings, providerId, modelId)
  const isDeepSeekSeries = isDeepSeekSeriesModelId(modelId)
  const explicitSessionSetting =
    typeof generationSettings.forceInterleavedThinkingCompat === 'boolean'
      ? generationSettings.forceInterleavedThinkingCompat
      : undefined
  const forcedBySessionSetting = explicitSessionSetting === true
  const portraitInterleaved = portrait?.interleaved === true
  const reasoningSupported = providerSettings.supportsReasoningCapability(providerId, modelId)
  const preserveReasoningContent =
    isDeepSeekSeries ||
    (explicitSessionSetting !== undefined ? explicitSessionSetting : portraitInterleaved)

  return {
    preserveReasoningContent,
    preserveEmptyReasoningContent: isDeepSeekSeries,
    forcedBySessionSetting,
    portraitInterleaved,
    reasoningSupported,
    providerDbSourceUrl: providerDbLoader.getSourceUrl()
  }
}

function normalizeReasoningEffort(
  providerSettings: ProviderModelResolutionPort,
  providerId: string,
  modelId: string | undefined,
  value: unknown
): SessionGenerationSettings['reasoningEffort'] | undefined {
  if (!isReasoningEffort(value)) {
    return undefined
  }
  const normalizedValue = value

  if (!modelId) {
    return normalizedValue
  }

  const portrait = getReasoningPortrait(providerSettings, providerId, modelId)
  return normalizeReasoningEffortValue(portrait, normalizedValue)
}

function normalizeReasoningVisibility(
  providerSettings: ProviderModelResolutionPort,
  providerId: string,
  modelId: string | undefined,
  value: unknown
): SessionGenerationSettings['reasoningVisibility'] | undefined {
  if (!modelId) {
    return (
      normalizeAnthropicReasoningVisibilityValue(value) ?? normalizeReasoningVisibilityValue(value)
    )
  }

  const portrait = getReasoningPortrait(providerSettings, providerId, modelId)
  const capabilityProviderId = resolveCapabilityProviderId(providerSettings, providerId, modelId)
  if (hasAnthropicReasoningToggle(capabilityProviderId, portrait)) {
    return normalizeAnthropicReasoningVisibilityValue(value) ?? 'omitted'
  }

  return normalizeReasoningVisibilityValue(value)
}

function normalizeVerbosity(
  providerSettings: ProviderModelResolutionPort,
  providerId: string,
  modelId: string,
  value: unknown
): SessionGenerationSettings['verbosity'] | undefined {
  if (!isVerbosity(value)) {
    return undefined
  }
  const normalizedValue = value

  const portrait = getReasoningPortrait(providerSettings, providerId, modelId)
  const options = portrait?.verbosityOptions?.filter(isVerbosity)
  if (!options || options.length === 0) {
    return normalizedValue
  }

  if (options.includes(normalizedValue)) {
    return normalizedValue
  }

  const defaultVerbosity = portrait?.verbosity
  if (defaultVerbosity && isVerbosity(defaultVerbosity) && options.includes(defaultVerbosity)) {
    return defaultVerbosity
  }

  return undefined
}

export function getReasoningPortrait(
  providerSettings: ProviderModelResolutionPort,
  providerId: string,
  modelId: string
): ReasoningPortrait | null {
  return providerSettings.getReasoningPortrait(providerId, modelId)
}

export function resolveCapabilityProviderId(
  providerSettings: ProviderModelResolutionPort,
  providerId: string,
  modelId: string | undefined
): string {
  if (!modelId) {
    return providerId
  }

  return providerSettings.getCapabilityProviderId(providerId, modelId)
}
