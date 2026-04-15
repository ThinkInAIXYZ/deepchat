import { eventBus } from '@/eventbus'
import { PROVIDER_DB_EVENTS } from '@/events'
import {
  ProviderAggregate,
  ProviderModel,
  ReasoningPortrait,
  type ReasoningEffort,
  type Verbosity
} from '@shared/types/model-db'
import { providerDbLoader } from './providerDbLoader'
import { resolveProviderId as resolveProviderIdAlias } from './providerId'

export type ThinkingBudgetRange = {
  min?: number
  max?: number
  default?: number
}

export type SearchDefaults = {
  default?: boolean
  forced?: boolean
  strategy?: 'turbo' | 'max'
}

type IndexedPortrait = {
  providerId: string
  modelId: string
  portrait: ReasoningPortrait
  isUnprefixed: boolean
}

const OPENAI_REASONING_EFFORT_MODEL_FAMILIES = ['o1', 'o3', 'o4-mini', 'gpt-5']
const OPENAI_VERBOSITY_MODEL_FAMILIES = ['gpt-5']
const OPENAI_REASONING_FALLBACK_PROVIDERS = new Set(['openai', 'azure'])
const GROK_REASONING_EFFORT_MODEL_FAMILIES = ['grok-3-mini']
const DEFAULT_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']
const BINARY_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['low', 'high']
const DEFAULT_VERBOSITY_OPTIONS: Verbosity[] = ['low', 'medium', 'high']

const normalizeCapabilityModelId = (modelId: string): string => {
  const normalizedModelId = modelId.toLowerCase()
  return normalizedModelId.includes('/')
    ? normalizedModelId.slice(normalizedModelId.lastIndexOf('/') + 1)
    : normalizedModelId
}

const normalizeCapabilityProviderId = (providerId: string): string => {
  return resolveProviderIdAlias(providerId.toLowerCase())?.toLowerCase() ?? providerId.toLowerCase()
}

const matchesModelFamily = (modelId: string, families: string[]): boolean =>
  families.some(
    (family) =>
      modelId === family || modelId.startsWith(`${family}-`) || modelId.startsWith(`${family}.`)
  )

const hasReasoningPortrait = (
  portrait: ReasoningPortrait | undefined | null
): portrait is ReasoningPortrait =>
  Boolean(
    portrait &&
    Object.values(portrait).some((value) =>
      Array.isArray(value) ? value.length > 0 : value !== undefined
    )
  )

const normalizeEffortOptions = (
  options: ReasoningEffort[] | undefined
): ReasoningEffort[] | undefined => {
  if (!options || options.length === 0) {
    return undefined
  }
  return Array.from(new Set(options))
}

const normalizeVerbosityOptions = (options: Verbosity[] | undefined): Verbosity[] | undefined => {
  if (!options || options.length === 0) {
    return undefined
  }
  return Array.from(new Set(options))
}

const usesExtendedEffortDefaultWithoutOptions = (
  portrait: ReasoningPortrait | undefined
): boolean => {
  if (!portrait || portrait.effortOptions !== undefined || portrait.mode === 'budget') {
    return false
  }

  return Boolean(portrait.effort && !DEFAULT_REASONING_EFFORT_OPTIONS.includes(portrait.effort))
}

const supportsEffortControls = (portrait: ReasoningPortrait | undefined | null): boolean => {
  if (!portrait || portrait.supported === false) {
    return false
  }

  if (portrait.mode === 'budget' || portrait.mode === 'level' || portrait.mode === 'fixed') {
    return false
  }

  return Boolean(
    (portrait.effortOptions && portrait.effortOptions.length > 0) ||
    (portrait.mode !== 'mixed' && typeof portrait.effort === 'string')
  )
}

const supportsVerbosityControls = (portrait: ReasoningPortrait | undefined | null): boolean => {
  if (!portrait || portrait.supported === false) {
    return false
  }

  return Boolean(
    (portrait.verbosityOptions && portrait.verbosityOptions.length > 0) ||
    typeof portrait.verbosity === 'string'
  )
}

const clonePortrait = (portrait: ReasoningPortrait): ReasoningPortrait => ({
  ...portrait,
  ...(portrait.budget ? { budget: { ...portrait.budget } } : {}),
  ...(portrait.effortOptions ? { effortOptions: [...portrait.effortOptions] } : {}),
  ...(portrait.verbosityOptions ? { verbosityOptions: [...portrait.verbosityOptions] } : {}),
  ...(portrait.levelOptions ? { levelOptions: [...portrait.levelOptions] } : {}),
  ...(portrait.continuation ? { continuation: [...portrait.continuation] } : {}),
  ...(portrait.notes ? { notes: [...portrait.notes] } : {})
})

const mergeReasoningPortraits = (
  ...portraits: Array<ReasoningPortrait | undefined | null>
): ReasoningPortrait | undefined => {
  let merged: ReasoningPortrait | undefined

  for (const portrait of portraits) {
    if (!hasReasoningPortrait(portrait)) {
      continue
    }

    if (!merged) {
      merged = {}
    }

    if (portrait.supported !== undefined) merged.supported = portrait.supported
    if (portrait.defaultEnabled !== undefined) merged.defaultEnabled = portrait.defaultEnabled
    if (portrait.mode !== undefined) merged.mode = portrait.mode
    if (portrait.budget) {
      merged.budget = {
        ...merged.budget,
        ...portrait.budget
      }
    }
    if (portrait.effort !== undefined) merged.effort = portrait.effort
    if (portrait.effortOptions !== undefined) {
      merged.effortOptions = [...portrait.effortOptions]
    }
    if (portrait.verbosity !== undefined) merged.verbosity = portrait.verbosity
    if (portrait.verbosityOptions !== undefined) {
      merged.verbosityOptions = [...portrait.verbosityOptions]
    }
    if (portrait.level !== undefined) merged.level = portrait.level
    if (portrait.levelOptions !== undefined) merged.levelOptions = [...portrait.levelOptions]
    if (portrait.interleaved !== undefined) merged.interleaved = portrait.interleaved
    if (portrait.summaries !== undefined) merged.summaries = portrait.summaries
    if (portrait.visibility !== undefined) merged.visibility = portrait.visibility
    if (portrait.continuation !== undefined) merged.continuation = [...portrait.continuation]
    if (portrait.notes !== undefined) merged.notes = [...portrait.notes]
  }

  return hasReasoningPortrait(merged) ? merged : undefined
}

const portraitFromExtraCapabilities = (
  reasoning: NonNullable<NonNullable<ProviderModel['extra_capabilities']>['reasoning']> | undefined
): ReasoningPortrait | undefined => {
  if (!reasoning) {
    return undefined
  }

  return hasReasoningPortrait({
    supported: reasoning.supported,
    defaultEnabled: reasoning.default_enabled,
    mode: reasoning.mode,
    budget: reasoning.budget
      ? {
          default: reasoning.budget.default,
          min: reasoning.budget.min,
          max: reasoning.budget.max,
          auto: reasoning.budget.auto,
          off: reasoning.budget.off,
          unit: reasoning.budget.unit
        }
      : undefined,
    effort: reasoning.effort,
    effortOptions: normalizeEffortOptions(reasoning.effort_options),
    verbosity: reasoning.verbosity,
    verbosityOptions: normalizeVerbosityOptions(reasoning.verbosity_options),
    level: reasoning.level,
    levelOptions: reasoning.level_options ? [...reasoning.level_options] : undefined,
    interleaved: reasoning.interleaved,
    summaries: reasoning.summaries,
    visibility: reasoning.visibility,
    continuation: reasoning.continuation ? [...reasoning.continuation] : undefined,
    notes: reasoning.notes ? [...reasoning.notes] : undefined
  })
    ? {
        supported: reasoning.supported,
        defaultEnabled: reasoning.default_enabled,
        mode: reasoning.mode,
        budget: reasoning.budget
          ? {
              default: reasoning.budget.default,
              min: reasoning.budget.min,
              max: reasoning.budget.max,
              auto: reasoning.budget.auto,
              off: reasoning.budget.off,
              unit: reasoning.budget.unit
            }
          : undefined,
        effort: reasoning.effort,
        effortOptions: normalizeEffortOptions(reasoning.effort_options),
        verbosity: reasoning.verbosity,
        verbosityOptions: normalizeVerbosityOptions(reasoning.verbosity_options),
        level: reasoning.level,
        levelOptions: reasoning.level_options ? [...reasoning.level_options] : undefined,
        interleaved: reasoning.interleaved,
        summaries: reasoning.summaries,
        visibility: reasoning.visibility,
        continuation: reasoning.continuation ? [...reasoning.continuation] : undefined,
        notes: reasoning.notes ? [...reasoning.notes] : undefined
      }
    : undefined
}

const portraitFromLegacyReasoning = (
  reasoning: ProviderModel['reasoning']
): ReasoningPortrait | undefined => {
  if (!reasoning) {
    return undefined
  }

  return hasReasoningPortrait({
    supported: reasoning.supported,
    defaultEnabled: reasoning.default,
    budget: reasoning.budget
      ? {
          default: reasoning.budget.default,
          min: reasoning.budget.min,
          max: reasoning.budget.max
        }
      : undefined,
    effort: reasoning.effort,
    verbosity: reasoning.verbosity
  })
    ? {
        supported: reasoning.supported,
        defaultEnabled: reasoning.default,
        budget: reasoning.budget
          ? {
              default: reasoning.budget.default,
              min: reasoning.budget.min,
              max: reasoning.budget.max
            }
          : undefined,
        effort: reasoning.effort,
        verbosity: reasoning.verbosity
      }
    : undefined
}

export class ModelCapabilities {
  private index: Map<string, Map<string, ProviderModel>> = new Map()
  private portraitRegistry: Map<string, IndexedPortrait[]> = new Map()

  constructor() {
    this.rebuildIndexFromDb()
    eventBus.on(PROVIDER_DB_EVENTS.LOADED, () => this.rebuildIndexFromDb())
    eventBus.on(PROVIDER_DB_EVENTS.UPDATED, () => this.rebuildIndexFromDb())
  }

  private rebuildIndexFromDb(): void {
    const db = providerDbLoader.getDb()
    this.index.clear()
    this.portraitRegistry.clear()
    if (!db) return
    this.buildIndex(db)
  }

  private buildIndex(db: ProviderAggregate): void {
    const providers = db.providers || {}
    for (const [pid, provider] of Object.entries(providers)) {
      const pkey = pid.toLowerCase()
      const modelMap: Map<string, ProviderModel> = new Map()

      for (const model of provider.models || []) {
        const mid = model.id?.toLowerCase()
        if (!mid) continue

        modelMap.set(mid, model)

        const portrait = portraitFromExtraCapabilities(model.extra_capabilities?.reasoning)
        if (!portrait) continue

        const normalizedModelId = normalizeCapabilityModelId(model.id)
        const existingEntries = this.portraitRegistry.get(normalizedModelId) ?? []
        existingEntries.push({
          providerId: pkey,
          modelId: mid,
          portrait,
          isUnprefixed: !mid.includes('/')
        })
        this.portraitRegistry.set(normalizedModelId, existingEntries)
      }

      this.index.set(pkey, modelMap)
    }
  }

  private getProviderMatch(providerId: string, modelId: string): ProviderModel | undefined {
    const mid = modelId?.toLowerCase()
    if (!mid || !providerId) {
      return undefined
    }

    const resolvedProviderId = this.resolveProviderId(providerId.toLowerCase())
    if (!resolvedProviderId) {
      return undefined
    }

    return this.index.get(resolvedProviderId)?.get(mid)
  }

  private getModel(providerId: string, modelId: string): ProviderModel | undefined {
    const mid = modelId?.toLowerCase()
    if (!mid) return undefined

    const normalizedProviderId = providerId ? providerId.toLowerCase() : ''
    const hasProviderId = normalizedProviderId.length > 0
    const pid = hasProviderId ? this.resolveProviderId(normalizedProviderId) : undefined

    if (pid) {
      const providerModels = this.index.get(pid)
      if (providerModels) {
        const providerMatch = providerModels.get(mid)
        if (providerMatch) {
          return providerMatch
        }
        return undefined
      }

      return this.findModelAcrossProviders(mid)
    }

    if (!hasProviderId) {
      return undefined
    }

    return this.findModelAcrossProviders(mid)
  }

  private findModelAcrossProviders(modelId: string): ProviderModel | undefined {
    for (const models of this.index.values()) {
      const fallbackModel = models.get(modelId)
      if (fallbackModel) {
        return fallbackModel
      }
    }
    return undefined
  }

  private getRegistryPortrait(providerId: string, modelId: string): ReasoningPortrait | undefined {
    const entries = this.portraitRegistry.get(normalizeCapabilityModelId(modelId))
    if (!entries || entries.length === 0) {
      return undefined
    }

    const normalizedProviderId = normalizeCapabilityProviderId(providerId)
    const selected = [...entries].sort((left, right) => {
      const leftSameProvider =
        normalizeCapabilityProviderId(left.providerId) === normalizedProviderId ? 0 : 1
      const rightSameProvider =
        normalizeCapabilityProviderId(right.providerId) === normalizedProviderId ? 0 : 1
      if (leftSameProvider !== rightSameProvider) {
        return leftSameProvider - rightSameProvider
      }

      const leftPrefixedRank = left.isUnprefixed ? 0 : 1
      const rightPrefixedRank = right.isUnprefixed ? 0 : 1
      if (leftPrefixedRank !== rightPrefixedRank) {
        return leftPrefixedRank - rightPrefixedRank
      }

      const providerCompare = left.providerId.localeCompare(right.providerId)
      if (providerCompare !== 0) {
        return providerCompare
      }

      return left.modelId.localeCompare(right.modelId)
    })[0]

    return selected ? clonePortrait(selected.portrait) : undefined
  }

  resolveProviderId(providerId: string | undefined): string | undefined {
    const resolved = resolveProviderIdAlias(providerId)
    return resolved
  }

  private getFallbackReasoningPortrait(
    providerId: string,
    modelId: string
  ): ReasoningPortrait | undefined {
    const normalizedProviderId = normalizeCapabilityProviderId(providerId)
    const normalizedRawModelId = modelId.toLowerCase()
    const normalizedModelId = normalizeCapabilityModelId(modelId)
    const allowsOpenAIFallback =
      OPENAI_REASONING_FALLBACK_PROVIDERS.has(normalizedProviderId) ||
      normalizedRawModelId.startsWith('openai/')

    if (
      allowsOpenAIFallback &&
      matchesModelFamily(normalizedModelId, OPENAI_REASONING_EFFORT_MODEL_FAMILIES)
    ) {
      return {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'medium',
        effortOptions: [...DEFAULT_REASONING_EFFORT_OPTIONS],
        ...(matchesModelFamily(normalizedModelId, OPENAI_VERBOSITY_MODEL_FAMILIES)
          ? {
              verbosity: 'medium' as const,
              verbosityOptions: [...DEFAULT_VERBOSITY_OPTIONS]
            }
          : {})
      }
    }

    if (matchesModelFamily(normalizedModelId, GROK_REASONING_EFFORT_MODEL_FAMILIES)) {
      return {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'low',
        effortOptions: [...BINARY_REASONING_EFFORT_OPTIONS]
      }
    }

    return undefined
  }

  getReasoningPortrait(providerId: string, modelId: string): ReasoningPortrait | null {
    const exactModel = this.getProviderMatch(providerId, modelId)
    const legacyModel = exactModel ?? this.getModel(providerId, modelId)
    const legacyPortrait = portraitFromLegacyReasoning(legacyModel?.reasoning)
    const registryPortrait = this.getRegistryPortrait(providerId, modelId)
    const extraCapabilitiesPortrait = portraitFromExtraCapabilities(
      exactModel?.extra_capabilities?.reasoning
    )

    const portrait = mergeReasoningPortraits(
      this.getFallbackReasoningPortrait(providerId, modelId),
      legacyPortrait,
      registryPortrait,
      extraCapabilitiesPortrait
    )

    if (!portrait) {
      return null
    }

    const resolvedPortrait = clonePortrait(portrait)
    const explicitPortrait = mergeReasoningPortraits(
      legacyPortrait,
      registryPortrait,
      extraCapabilitiesPortrait
    )

    if (usesExtendedEffortDefaultWithoutOptions(explicitPortrait)) {
      delete resolvedPortrait.effortOptions
    }

    return resolvedPortrait
  }

  supportsReasoning(providerId: string, modelId: string): boolean {
    return this.getReasoningPortrait(providerId, modelId)?.supported === true
  }

  getThinkingBudgetRange(providerId: string, modelId: string): ThinkingBudgetRange {
    const budget = this.getReasoningPortrait(providerId, modelId)?.budget
    if (!budget) return {}
    const out: ThinkingBudgetRange = {}
    if (typeof budget.default === 'number') out.default = budget.default
    if (typeof budget.min === 'number') out.min = budget.min
    if (typeof budget.max === 'number') out.max = budget.max
    return out
  }

  supportsSearch(providerId: string, modelId: string): boolean {
    const model = this.getModel(providerId, modelId)
    return model?.search?.supported === true
  }

  supportsReasoningEffort(providerId: string, modelId: string): boolean {
    const portrait = this.getReasoningPortrait(providerId, modelId)
    return supportsEffortControls(portrait)
  }

  supportsVerbosity(providerId: string, modelId: string): boolean {
    const portrait = this.getReasoningPortrait(providerId, modelId)
    return supportsVerbosityControls(portrait)
  }

  getReasoningEffortDefault(providerId: string, modelId: string): ReasoningEffort | undefined {
    return this.getReasoningPortrait(providerId, modelId)?.effort
  }

  getVerbosityDefault(providerId: string, modelId: string): Verbosity | undefined {
    return this.getReasoningPortrait(providerId, modelId)?.verbosity
  }

  getSearchDefaults(providerId: string, modelId: string): SearchDefaults {
    const model = this.getModel(providerId, modelId)
    const search = model?.search
    if (!search) return {}
    const out: SearchDefaults = {}
    if (typeof search.default === 'boolean') out.default = search.default
    if (typeof search.forced_search === 'boolean') out.forced = search.forced_search
    if (typeof search.search_strategy === 'string') {
      if (search.search_strategy === 'turbo' || search.search_strategy === 'max') {
        out.strategy = search.search_strategy
      }
    }
    return out
  }

  supportsVision(providerId: string, modelId: string): boolean {
    const model = this.getModel(providerId, modelId)
    const inputs = model?.modalities?.input
    if (!Array.isArray(inputs)) return false
    return inputs.includes('image')
  }

  supportsToolCall(providerId: string, modelId: string): boolean {
    const model = this.getModel(providerId, modelId)
    return model?.tool_call === true
  }

  supportsImageOutput(providerId: string, modelId: string): boolean {
    const model = this.getModel(providerId, modelId)
    const outputs = model?.modalities?.output
    if (!Array.isArray(outputs)) return false
    return outputs.includes('image')
  }
}

export const modelCapabilities = new ModelCapabilities()
