import type { IConfigPresenter } from '@shared/presenter'
import type { PermissionMode, SessionGenerationSettings } from '@shared/types/agent-interface'
import type { ReasoningPortrait } from '@shared/types/model-db'
import {
  getReasoningEffectiveEnabledForProvider,
  hasAnthropicReasoningToggle,
  isReasoningEffort,
  isVerbosity,
  normalizeAnthropicReasoningVisibilityValue,
  normalizeReasoningEffortValue,
  normalizeReasoningVisibilityValue
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
import { capAgentDefaultMaxTokens } from './contextBudget'
import type { RuntimeSharedState } from './runtimeSharedState'
import type { DeepChatSessionStore } from './sessionStore'

type PersistedSessionGenerationRow = {
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
}

type SessionSettingsInvalidation = {
  invalidateSystemPromptCache: (sessionId: string) => void
  invalidateToolProfileCache: (sessionId: string) => void
}

export function normalizePermissionMode(mode: PermissionMode | null | undefined): PermissionMode {
  return mode === 'default' || mode === 'auto_approve' ? mode : 'full_access'
}

function normalizeTopP(value: unknown): number | undefined {
  const numeric = parseFiniteNumericValue(value)
  return numeric !== undefined && numeric >= 0.1 && numeric <= 1 ? numeric : undefined
}

export class SessionSettingsService {
  private readonly sessionGenerationSettings = new Map<string, SessionGenerationSettings>()

  constructor(
    private readonly configPresenter: IConfigPresenter,
    private readonly sessionStore: DeepChatSessionStore,
    private readonly runtimeSharedState: RuntimeSharedState,
    private readonly invalidation: SessionSettingsInvalidation
  ) {}

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const normalizedMode = normalizePermissionMode(mode)
    const state = this.runtimeSharedState.runtimeState.get(sessionId)
    if (state) {
      state.permissionMode = normalizedMode
    }
    this.sessionStore.updatePermissionMode(sessionId, normalizedMode)
  }

  async setSessionModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    const nextProviderId = providerId?.trim()
    const nextModelId = modelId?.trim()
    if (!nextProviderId || !nextModelId) {
      throw new Error('Session model update requires providerId and modelId.')
    }

    const state = this.runtimeSharedState.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (state?.status === 'generating') {
      throw new Error('Cannot switch model while session is generating.')
    }

    const currentGeneration = await this.getEffectiveGenerationSettings(sessionId)
    const sanitized = await this.prepareGenerationSettings(nextProviderId, nextModelId, {
      systemPrompt: currentGeneration.systemPrompt
    })

    if (state) {
      state.providerId = nextProviderId
      state.modelId = nextModelId
    } else {
      this.runtimeSharedState.runtimeState.set(sessionId, {
        status: 'idle',
        providerId: nextProviderId,
        modelId: nextModelId,
        permissionMode: normalizePermissionMode(dbSession?.permission_mode)
      })
    }

    this.sessionStore.updateSessionModel(sessionId, nextProviderId, nextModelId)
    this.replaceGenerationSettings(sessionId, sanitized)
    this.invalidation.invalidateSystemPromptCache(sessionId)
    this.invalidation.invalidateToolProfileCache(sessionId)
  }

  async getPermissionMode(sessionId: string): Promise<PermissionMode> {
    const state = this.runtimeSharedState.runtimeState.get(sessionId)
    if (state) {
      return state.permissionMode
    }
    const dbSession = this.sessionStore.get(sessionId)
    return normalizePermissionMode(dbSession?.permission_mode)
  }

  async getGenerationSettings(sessionId: string): Promise<SessionGenerationSettings | null> {
    const state = this.runtimeSharedState.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      return null
    }
    return await this.getEffectiveGenerationSettings(sessionId)
  }

  async updateGenerationSettings(
    sessionId: string,
    settings: Partial<SessionGenerationSettings>
  ): Promise<SessionGenerationSettings> {
    const state = this.runtimeSharedState.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId)
    if (!state && !dbSession) {
      throw new Error(`Session ${sessionId} not found`)
    }
    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id
    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} model information is missing`)
    }

    const current = await this.getEffectiveGenerationSettings(sessionId)
    const sanitized = await this.prepareGenerationSettings(providerId, modelId, settings, current)
    this.sessionGenerationSettings.set(sessionId, sanitized)
    this.sessionStore.updateGenerationSettings(
      sessionId,
      this.buildPersistedGenerationSettingsPatch(settings, sanitized)
    )
    if (Object.prototype.hasOwnProperty.call(settings, 'systemPrompt')) {
      this.invalidation.invalidateSystemPromptCache(sessionId)
    }
    return sanitized
  }

  async prepareGenerationSettings(
    providerId: string,
    modelId: string,
    patch: Partial<SessionGenerationSettings>,
    baseSettings?: SessionGenerationSettings
  ): Promise<SessionGenerationSettings> {
    return await this.sanitizeGenerationSettings(providerId, modelId, patch, baseSettings)
  }

  cacheGenerationSettings(sessionId: string, settings: SessionGenerationSettings): void {
    this.sessionGenerationSettings.set(sessionId, settings)
  }

  replaceGenerationSettings(sessionId: string, settings: SessionGenerationSettings): void {
    this.sessionStore.updateGenerationSettings(
      sessionId,
      this.buildPersistedGenerationSettingsReplacement(settings)
    )
    this.sessionGenerationSettings.set(sessionId, settings)
  }

  clearSession(sessionId: string): void {
    this.sessionGenerationSettings.delete(sessionId)
  }

  async getEffectiveGenerationSettings(sessionId: string): Promise<SessionGenerationSettings> {
    const cached = this.sessionGenerationSettings.get(sessionId)
    if (cached) {
      return { ...cached }
    }

    const state = this.runtimeSharedState.runtimeState.get(sessionId)
    const dbSession = this.sessionStore.get(sessionId) as PersistedSessionGenerationRow | undefined
    const providerId = state?.providerId ?? dbSession?.provider_id
    const modelId = state?.modelId ?? dbSession?.model_id

    if (!providerId || !modelId) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const persistedPatch = dbSession ? this.mapPersistedGenerationPatch(dbSession) : {}
    const sanitized = await this.sanitizeGenerationSettings(providerId, modelId, persistedPatch)
    this.sessionGenerationSettings.set(sessionId, sanitized)
    return { ...sanitized }
  }

  private mapPersistedGenerationPatch(
    sessionRow: PersistedSessionGenerationRow
  ): Partial<SessionGenerationSettings> {
    const patch: Partial<SessionGenerationSettings> = {}

    if (sessionRow.system_prompt !== null) patch.systemPrompt = sessionRow.system_prompt
    if (sessionRow.temperature !== null) patch.temperature = sessionRow.temperature
    if (sessionRow.top_p !== null) patch.topP = sessionRow.top_p
    if (sessionRow.context_length !== null) patch.contextLength = sessionRow.context_length
    if (sessionRow.max_tokens !== null) patch.maxTokens = sessionRow.max_tokens
    if (sessionRow.timeout_ms !== null) patch.timeout = sessionRow.timeout_ms
    if (sessionRow.thinking_budget !== null) {
      patch.thinkingBudget = normalizeLegacyThinkingBudgetValue(sessionRow.thinking_budget)
    }
    if (sessionRow.reasoning_effort !== null) patch.reasoningEffort = sessionRow.reasoning_effort
    if (sessionRow.reasoning_visibility !== null) {
      const reasoningVisibility = this.normalizeReasoningVisibility(
        sessionRow.provider_id,
        sessionRow.model_id,
        sessionRow.reasoning_visibility
      )
      if (reasoningVisibility) patch.reasoningVisibility = reasoningVisibility
    }
    if (sessionRow.verbosity !== null) patch.verbosity = sessionRow.verbosity
    if (typeof sessionRow.force_interleaved_thinking_compat === 'number') {
      patch.forceInterleavedThinkingCompat = sessionRow.force_interleaved_thinking_compat === 1
    }

    return patch
  }

  private buildPersistedGenerationSettingsPatch(
    requestedPatch: Partial<SessionGenerationSettings>,
    sanitized: SessionGenerationSettings
  ): Partial<SessionGenerationSettings> {
    const patch: Partial<SessionGenerationSettings> = {}
    const copyIfRequested = <K extends keyof SessionGenerationSettings>(key: K): void => {
      if (Object.prototype.hasOwnProperty.call(requestedPatch, key)) {
        patch[key] = sanitized[key]
      }
    }

    copyIfRequested('systemPrompt')
    copyIfRequested('temperature')
    copyIfRequested('topP')
    copyIfRequested('contextLength')
    copyIfRequested('maxTokens')
    copyIfRequested('timeout')
    copyIfRequested('thinkingBudget')
    copyIfRequested('reasoningEffort')
    copyIfRequested('reasoningVisibility')
    copyIfRequested('verbosity')
    copyIfRequested('forceInterleavedThinkingCompat')
    copyIfRequested('imageGeneration')
    copyIfRequested('videoGeneration')
    return patch
  }

  private buildPersistedGenerationSettingsReplacement(
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

  private resolveProviderApiType(providerId: string): string | undefined {
    return this.configPresenter.getProviderById?.(providerId)?.apiType
  }

  private async buildDefaultGenerationSettings(
    providerId: string,
    modelId: string
  ): Promise<SessionGenerationSettings> {
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
    const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
      providerId,
      modelId,
      modelConfig.reasoning
    )
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const capabilityProviderId = this.resolveCapabilityProviderId(providerId, modelId)
    const anthropicReasoningToggle = hasAnthropicReasoningToggle(capabilityProviderId, portrait)
    const anthropicReasoningEnabled = anthropicReasoningToggle
      ? getReasoningEffectiveEnabledForProvider(capabilityProviderId, portrait, {
          reasoning: modelConfig.reasoning,
          reasoningEffort: modelConfig.reasoningEffort
        })
      : true
    const defaultSystemPrompt = await this.configPresenter.getDefaultSystemPrompt()
    const contextLengthDefault = toValidNonNegativeInteger(modelConfig.contextLength) ?? 32000
    const rawProviderMaxTokensDefault = toValidNonNegativeInteger(modelConfig.maxTokens)
    const providerMaxTokensDefault =
      rawProviderMaxTokensDefault && rawProviderMaxTokensDefault > 0
        ? rawProviderMaxTokensDefault
        : Math.min(4096, contextLengthDefault)
    const maxTokensDefault = capAgentDefaultMaxTokens(
      providerMaxTokensDefault,
      contextLengthDefault
    )
    const timeoutDefault = toValidNonNegativeInteger(modelConfig.timeout) ?? DEFAULT_MODEL_TIMEOUT

    const defaults: SessionGenerationSettings = {
      systemPrompt: defaultSystemPrompt ?? '',
      temperature:
        fixedTemperatureKimi?.temperature ??
        parseFiniteNumericValue(modelConfig.temperature) ??
        0.7,
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
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      const imageGeneration = normalizeImageGenerationOptions(modelConfig.imageGeneration)
      if (imageGeneration) defaults.imageGeneration = imageGeneration
    }

    if (
      supportsOpenAICompatibleVideoGeneration({
        providerId,
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      const videoGeneration = normalizeVideoGenerationOptions(modelConfig.videoGeneration)
      if (videoGeneration) defaults.videoGeneration = videoGeneration
    }

    const supportsReasoning =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    if (supportsReasoning) {
      const defaultBudget = normalizeLegacyThinkingBudgetValue(
        modelConfig.thinkingBudget ??
          this.configPresenter.getThinkingBudgetRange?.(providerId, modelId)?.default
      )
      if (defaultBudget !== undefined) defaults.thinkingBudget = defaultBudget
    }

    const supportsEffort =
      this.configPresenter.supportsReasoningEffortCapability?.(providerId, modelId) === true
    if (supportsEffort && (!anthropicReasoningToggle || anthropicReasoningEnabled)) {
      const rawEffort =
        modelConfig.reasoningEffort ??
        this.configPresenter.getReasoningEffortDefault?.(providerId, modelId)
      const normalizedEffort = this.normalizeReasoningEffort(providerId, modelId, rawEffort)
      if (normalizedEffort) defaults.reasoningEffort = normalizedEffort
    }

    if (anthropicReasoningToggle && anthropicReasoningEnabled) {
      const rawVisibility = modelConfig.reasoningVisibility ?? portrait?.visibility
      const normalizedVisibility = this.normalizeReasoningVisibility(
        providerId,
        modelId,
        rawVisibility
      )
      if (normalizedVisibility) defaults.reasoningVisibility = normalizedVisibility
    }

    const supportsVerbosity =
      this.configPresenter.supportsVerbosityCapability?.(providerId, modelId) === true
    if (supportsVerbosity) {
      const rawVerbosity =
        modelConfig.verbosity ?? this.configPresenter.getVerbosityDefault?.(providerId, modelId)
      const normalizedVerbosity = this.normalizeVerbosity(providerId, modelId, rawVerbosity)
      if (normalizedVerbosity) defaults.verbosity = normalizedVerbosity
    }

    return defaults
  }

  private async sanitizeGenerationSettings(
    providerId: string,
    modelId: string,
    patch: Partial<SessionGenerationSettings>,
    baseSettings?: SessionGenerationSettings
  ): Promise<SessionGenerationSettings> {
    const modelConfig = this.configPresenter.getModelConfig(modelId, providerId)
    const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
      providerId,
      modelId,
      modelConfig.reasoning
    )
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const capabilityProviderId = this.resolveCapabilityProviderId(providerId, modelId)
    const anthropicReasoningToggle = hasAnthropicReasoningToggle(capabilityProviderId, portrait)
    const anthropicReasoningEnabled = anthropicReasoningToggle
      ? getReasoningEffectiveEnabledForProvider(capabilityProviderId, portrait, {
          reasoning: modelConfig.reasoning,
          reasoningEffort: modelConfig.reasoningEffort
        })
      : true
    const base = baseSettings
      ? { ...baseSettings }
      : await this.buildDefaultGenerationSettings(providerId, modelId)
    const next: SessionGenerationSettings = { ...base }

    if (Object.prototype.hasOwnProperty.call(patch, 'systemPrompt')) {
      next.systemPrompt =
        typeof patch.systemPrompt === 'string' ? patch.systemPrompt : base.systemPrompt
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'temperature')) {
      const numeric = parseFiniteNumericValue(patch.temperature)
      if (numeric !== undefined) next.temperature = numeric
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'topP')) {
      const topP = normalizeTopP(patch.topP)
      if (topP !== undefined) next.topP = topP
      else delete next.topP
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'timeout')) {
      const error = validateGenerationNumericField('timeout', patch.timeout)
      const numeric = toValidNonNegativeInteger(parseFiniteNumericValue(patch.timeout))
      if (!error && numeric !== undefined) next.timeout = numeric
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
      if (!error && numeric !== undefined) next.contextLength = numeric
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'maxTokens')) {
      const error = validateGenerationNumericField('maxTokens', patch.maxTokens, {
        contextLength: nextContextReference
      })
      const numeric = toValidNonNegativeInteger(parsedMaxTokens)
      if (!error && numeric !== undefined) next.maxTokens = numeric
    }

    const supportsReasoning =
      this.configPresenter.supportsReasoningCapability?.(providerId, modelId) === true
    if (supportsReasoning) {
      if (Object.prototype.hasOwnProperty.call(patch, 'thinkingBudget')) {
        const raw = patch.thinkingBudget
        if (raw === undefined) delete next.thinkingBudget
        else if (!validateGenerationNumericField('thinkingBudget', raw)) {
          const numeric = toValidNonNegativeInteger(raw)
          if (numeric !== undefined) next.thinkingBudget = numeric
        }
      }
    } else {
      delete next.thinkingBudget
    }

    const supportsEffort =
      this.configPresenter.supportsReasoningEffortCapability?.(providerId, modelId) === true
    if (supportsEffort && (!anthropicReasoningToggle || anthropicReasoningEnabled)) {
      const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'reasoningEffort')
        ? patch.reasoningEffort
        : next.reasoningEffort
      const defaultEffort = this.configPresenter.getReasoningEffortDefault?.(providerId, modelId)
      const effort =
        this.normalizeReasoningEffort(providerId, modelId, fromPatch) ??
        this.normalizeReasoningEffort(providerId, modelId, defaultEffort)
      if (effort) next.reasoningEffort = effort
      else delete next.reasoningEffort
    } else {
      delete next.reasoningEffort
    }

    if (anthropicReasoningToggle && anthropicReasoningEnabled) {
      const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'reasoningVisibility')
        ? patch.reasoningVisibility
        : next.reasoningVisibility
      const defaultVisibility = this.normalizeReasoningVisibility(
        providerId,
        modelId,
        modelConfig.reasoningVisibility ?? portrait?.visibility
      )
      const visibility =
        this.normalizeReasoningVisibility(providerId, modelId, fromPatch) ?? defaultVisibility
      if (visibility) next.reasoningVisibility = visibility
      else delete next.reasoningVisibility
    } else {
      delete next.reasoningVisibility
    }

    const supportsVerbosity =
      this.configPresenter.supportsVerbosityCapability?.(providerId, modelId) === true
    if (supportsVerbosity) {
      const fromPatch = Object.prototype.hasOwnProperty.call(patch, 'verbosity')
        ? patch.verbosity
        : next.verbosity
      const defaultVerbosity = this.configPresenter.getVerbosityDefault?.(providerId, modelId)
      const verbosity =
        this.normalizeVerbosity(providerId, modelId, fromPatch) ??
        this.normalizeVerbosity(providerId, modelId, defaultVerbosity)
      if (verbosity) next.verbosity = verbosity
      else delete next.verbosity
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
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      const imageGeneration = normalizeImageGenerationOptions(
        Object.prototype.hasOwnProperty.call(patch, 'imageGeneration')
          ? patch.imageGeneration
          : next.imageGeneration
      )
      if (imageGeneration) next.imageGeneration = imageGeneration
      else delete next.imageGeneration
    } else {
      delete next.imageGeneration
    }

    if (
      supportsOpenAICompatibleVideoGeneration({
        providerId,
        providerApiType: this.resolveProviderApiType(providerId),
        modelId,
        apiEndpoint: modelConfig.apiEndpoint,
        endpointType: modelConfig.endpointType,
        type: modelConfig.type
      })
    ) {
      const videoGeneration = normalizeVideoGenerationOptions(
        Object.prototype.hasOwnProperty.call(patch, 'videoGeneration')
          ? patch.videoGeneration
          : next.videoGeneration
      )
      if (videoGeneration) next.videoGeneration = videoGeneration
      else delete next.videoGeneration
    } else {
      delete next.videoGeneration
    }

    if (fixedTemperatureKimi) next.temperature = fixedTemperatureKimi.temperature
    return next
  }

  private normalizeReasoningEffort(
    providerId: string,
    modelId: string | undefined,
    value: unknown
  ): SessionGenerationSettings['reasoningEffort'] | undefined {
    if (!isReasoningEffort(value)) return undefined
    if (!modelId) return value
    return normalizeReasoningEffortValue(this.getReasoningPortrait(providerId, modelId), value)
  }

  private normalizeReasoningVisibility(
    providerId: string,
    modelId: string | undefined,
    value: unknown
  ): SessionGenerationSettings['reasoningVisibility'] | undefined {
    if (!modelId) {
      return (
        normalizeAnthropicReasoningVisibilityValue(value) ??
        normalizeReasoningVisibilityValue(value)
      )
    }
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const capabilityProviderId = this.resolveCapabilityProviderId(providerId, modelId)
    if (hasAnthropicReasoningToggle(capabilityProviderId, portrait)) {
      return normalizeAnthropicReasoningVisibilityValue(value) ?? 'omitted'
    }
    return normalizeReasoningVisibilityValue(value)
  }

  private normalizeVerbosity(
    providerId: string,
    modelId: string,
    value: unknown
  ): SessionGenerationSettings['verbosity'] | undefined {
    if (!isVerbosity(value)) return undefined
    const portrait = this.getReasoningPortrait(providerId, modelId)
    const options = portrait?.verbosityOptions?.filter(isVerbosity)
    if (!options || options.length === 0) return value
    if (options.includes(value)) return value
    const defaultVerbosity = portrait?.verbosity
    if (defaultVerbosity && isVerbosity(defaultVerbosity) && options.includes(defaultVerbosity)) {
      return defaultVerbosity
    }
    return undefined
  }

  private getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null {
    return this.configPresenter.getReasoningPortrait?.(providerId, modelId) ?? null
  }

  private resolveCapabilityProviderId(providerId: string, modelId: string | undefined): string {
    if (!modelId) return providerId
    return this.configPresenter.getCapabilityProviderId?.(providerId, modelId) ?? providerId
  }
}
