import {
  ProviderAggregate,
  ProviderModel,
  ReasoningPortrait,
  type ReasoningEffort,
  type Verbosity
} from '@shared/types/model-db'
import { providerDbLoader } from './providerDbLoader'
import { resolveProviderId as resolveProviderIdAlias } from './providerId'
import {
  getDottedProviderUnqualifiedModelId,
  getUnqualifiedModelId,
  normalizeCanonicalModelId,
  normalizeModelIdText
} from '@shared/modelId'
import { isKimiK3ModelId } from '@shared/modelRequestPolicy'
import type { ToolMode } from '@shared/toolMode'

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

type IndexedProviderModel = {
  providerId: string
  modelId: string
  model: ProviderModel
  isUnprefixed: boolean
}

export type CapabilityModelMatch = {
  providerId: string
  modelId: string
  model: ProviderModel
}

export type CatalogCapabilitySnapshot = {
  modelMatched: boolean
  defaultToolMode?: ToolMode
  reasoningPortrait: ReasoningPortrait | null
  supportsReasoning: boolean
  thinkingBudgetRange: ThinkingBudgetRange
  supportsSearch: boolean
  searchDefaults: SearchDefaults
  temperatureCapability: boolean | undefined
  supportsAudioInput: boolean
  supportsReasoningEffort: boolean
  reasoningEffortDefault: ReasoningEffort | undefined
  supportsVerbosity: boolean
  verbosityDefault: Verbosity | undefined
}

const OPENAI_REASONING_EFFORT_MODEL_FAMILIES = ['o1', 'o3', 'o4-mini', 'gpt-5']
const OPENAI_REASONING_ONLY_MODEL_FAMILIES = ['gpt-oss']
const OPENAI_VERBOSITY_MODEL_FAMILIES = ['gpt-5']
const OPENAI_REASONING_FALLBACK_PROVIDERS = new Set(['openai', 'azure'])
const GROK_REASONING_EFFORT_MODEL_FAMILIES = ['grok-3-mini']
const DEFAULT_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']
const BINARY_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['low', 'high']
const KIMI_K3_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['low', 'high', 'max']
const DEFAULT_VERBOSITY_OPTIONS: Verbosity[] = ['low', 'medium', 'high']
const OPENAI_CODE_MODE_MODEL_IDS = new Set([
  'gpt-5.6',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra'
])

function resolveCatalogDefaultToolMode(
  providerId: string,
  modelId: string,
  model: ProviderModel | undefined
): ToolMode | undefined {
  if (model?.default_tool_mode) return model.default_tool_mode
  if (model?.tool_call !== true) return undefined
  if (providerId === 'deepseek') return 'code'
  if (providerId === 'openai' && OPENAI_CODE_MODE_MODEL_IDS.has(modelId)) return 'code'
  return undefined
}

const normalizeCapabilityProviderId = (providerId: string): string => {
  return resolveProviderIdAlias(providerId.toLowerCase())?.toLowerCase() ?? providerId.toLowerCase()
}

export const normalizeCapabilityModelId = (value: string | undefined): string =>
  normalizeCanonicalModelId(value)

const getCapabilityModelLookupKeys = (value: string | undefined): string[] => {
  const lookupKeys: string[] = []
  for (const key of [
    normalizeModelIdText(value),
    getUnqualifiedModelId(value),
    getDottedProviderUnqualifiedModelId(value),
    normalizeCapabilityModelId(value)
  ]) {
    if (key && !lookupKeys.includes(key)) {
      lookupKeys.push(key)
    }
  }
  return lookupKeys
}

const getProviderCapabilityModelLookupKeys = (value: string | undefined): string[] => {
  const lookupKeys = getCapabilityModelLookupKeys(value)
  if (isKimiK3ModelId(value) && !lookupKeys.includes('kimi-k3')) {
    lookupKeys.push('kimi-k3')
  }
  return lookupKeys
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

const removeInheritedIncompatibleModeFields = (
  resolved: ReasoningPortrait,
  explicit: ReasoningPortrait | undefined
): void => {
  if (!explicit?.mode || explicit.mode === 'mixed') {
    return
  }

  const removeInherited = (key: keyof ReasoningPortrait): void => {
    if (explicit[key] === undefined) {
      delete resolved[key]
    }
  }

  switch (explicit.mode) {
    case 'budget':
      removeInherited('effort')
      removeInherited('effortOptions')
      removeInherited('level')
      removeInherited('levelOptions')
      break
    case 'effort':
      removeInherited('budget')
      removeInherited('level')
      removeInherited('levelOptions')
      break
    case 'level':
      removeInherited('budget')
      removeInherited('effort')
      removeInherited('effortOptions')
      break
    case 'fixed':
      removeInherited('budget')
      removeInherited('effort')
      removeInherited('effortOptions')
      removeInherited('level')
      removeInherited('levelOptions')
      break
  }
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
  private modelLookupIndex: Map<string, Map<string, IndexedProviderModel[]>> = new Map()
  private globalModelLookupIndex: Map<string, IndexedProviderModel[]> = new Map()
  private portraitRegistry: Map<string, IndexedPortrait[]> = new Map()
  private reasoningCandidateModelIds: Set<string> = new Set()

  constructor() {
    this.rebuildIndexFromDb()
    providerDbLoader.subscribeCatalogChanges(() => this.rebuildIndexFromDb())
  }

  private rebuildIndexFromDb(): void {
    const db = providerDbLoader.getDb()
    this.index.clear()
    this.modelLookupIndex.clear()
    this.globalModelLookupIndex.clear()
    this.portraitRegistry.clear()
    this.reasoningCandidateModelIds.clear()
    if (!db) return
    this.buildIndex(db)
  }

  private buildIndex(db: ProviderAggregate): void {
    const providers = db.providers || {}
    for (const [pid, provider] of Object.entries(providers)) {
      const pkey = pid.toLowerCase()
      const modelMap: Map<string, ProviderModel> = new Map()
      const lookupMap: Map<string, IndexedProviderModel[]> = new Map()

      for (const model of provider.models || []) {
        const mid = model.id?.toLowerCase()
        if (!mid) continue

        modelMap.set(mid, model)
        const indexedModel = {
          providerId: pkey,
          modelId: mid,
          model,
          isUnprefixed: !mid.includes('/')
        }
        for (const lookupKey of getCapabilityModelLookupKeys(model.id)) {
          const entries = lookupMap.get(lookupKey) ?? []
          entries.push(indexedModel)
          lookupMap.set(lookupKey, entries)

          const globalEntries = this.globalModelLookupIndex.get(lookupKey) ?? []
          globalEntries.push(indexedModel)
          this.globalModelLookupIndex.set(lookupKey, globalEntries)
        }

        if (
          model.reasoning?.supported === true ||
          model.extra_capabilities?.reasoning?.supported === true
        ) {
          this.reasoningCandidateModelIds.add(normalizeCapabilityModelId(model.id))
        }

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
      this.modelLookupIndex.set(pkey, lookupMap)
    }
  }

  private selectIndexedProviderModelMatch(
    entries: IndexedProviderModel[] | undefined
  ): CapabilityModelMatch | undefined {
    if (!entries || entries.length === 0) {
      return undefined
    }

    let selected = entries[0]
    for (let index = 1; index < entries.length; index += 1) {
      const candidate = entries[index]
      const candidatePrefixedRank = candidate.isUnprefixed ? 0 : 1
      const selectedPrefixedRank = selected.isUnprefixed ? 0 : 1
      if (
        candidatePrefixedRank < selectedPrefixedRank ||
        (candidatePrefixedRank === selectedPrefixedRank &&
          candidate.modelId.localeCompare(selected.modelId) < 0)
      ) {
        selected = candidate
      }
    }

    return selected
      ? {
          providerId: selected.providerId,
          modelId: selected.modelId,
          model: selected.model
        }
      : undefined
  }

  private getCanonicalProviderModelMatch(
    providerId: string,
    modelId: string
  ): CapabilityModelMatch | undefined {
    const lookupMap = this.modelLookupIndex.get(providerId)
    if (!lookupMap) {
      return undefined
    }

    for (const lookupKey of getProviderCapabilityModelLookupKeys(modelId)) {
      const match = this.selectIndexedProviderModelMatch(lookupMap.get(lookupKey))
      if (match) {
        return match
      }
    }

    return undefined
  }

  private getProviderModelMatch(
    providerId: string,
    modelId: string
  ): CapabilityModelMatch | undefined {
    const mid = modelId?.toLowerCase()
    if (!mid || !providerId) {
      return undefined
    }

    const resolvedProviderId = this.resolveProviderId(providerId.toLowerCase())
    if (!resolvedProviderId) {
      return undefined
    }

    const exactMatch = this.index.get(resolvedProviderId)?.get(mid)
    if (exactMatch) {
      return {
        providerId: resolvedProviderId,
        modelId: mid,
        model: exactMatch
      }
    }

    return this.getCanonicalProviderModelMatch(resolvedProviderId, modelId)
  }

  private getProviderMatch(providerId: string, modelId: string): ProviderModel | undefined {
    return this.getProviderModelMatch(providerId, modelId)?.model
  }

  private getModelMatch(providerId: string, modelId: string): CapabilityModelMatch | undefined {
    const mid = modelId?.toLowerCase()
    if (!mid) return undefined

    const normalizedProviderId = providerId ? providerId.toLowerCase() : ''
    const hasProviderId = normalizedProviderId.length > 0
    const pid = hasProviderId ? this.resolveProviderId(normalizedProviderId) : undefined

    if (pid) {
      const providerModels = this.index.get(pid)
      if (providerModels) {
        const exactMatch = providerModels.get(mid)
        const providerMatch = exactMatch
          ? {
              providerId: pid,
              modelId: mid,
              model: exactMatch
            }
          : this.getCanonicalProviderModelMatch(pid, modelId)
        if (providerMatch) {
          return providerMatch
        }
        return undefined
      }

      return this.findModelAcrossProvidersMatch(mid)
    }

    if (!hasProviderId) {
      return undefined
    }

    return this.findModelAcrossProvidersMatch(mid)
  }

  private getModel(providerId: string, modelId: string): ProviderModel | undefined {
    return this.getModelMatch(providerId, modelId)?.model
  }

  private findModelAcrossProvidersMatch(modelId: string): CapabilityModelMatch | undefined {
    for (const [providerId, models] of this.index.entries()) {
      const fallbackModel = models.get(modelId)
      if (fallbackModel) {
        return {
          providerId,
          modelId,
          model: fallbackModel
        }
      }
    }
    for (const lookupMap of this.modelLookupIndex.values()) {
      for (const lookupKey of getProviderCapabilityModelLookupKeys(modelId)) {
        const fallbackMatch = this.selectIndexedProviderModelMatch(lookupMap.get(lookupKey))
        if (fallbackMatch) {
          return fallbackMatch
        }
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

  hasProvider(providerId: string | undefined): boolean {
    const resolvedProviderId = this.resolveProviderId(providerId?.trim().toLowerCase())
    return Boolean(resolvedProviderId && this.index.has(resolvedProviderId))
  }

  hasReasoningCandidate(modelId: string): boolean {
    const normalizedModelId = normalizeCapabilityModelId(modelId)

    return Boolean(
      this.reasoningCandidateModelIds.has(normalizedModelId) ||
      isKimiK3ModelId(modelId) ||
      matchesModelFamily(normalizedModelId, OPENAI_REASONING_EFFORT_MODEL_FAMILIES) ||
      matchesModelFamily(normalizedModelId, OPENAI_REASONING_ONLY_MODEL_FAMILIES) ||
      matchesModelFamily(normalizedModelId, GROK_REASONING_EFFORT_MODEL_FAMILIES)
    )
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

    if (
      allowsOpenAIFallback &&
      matchesModelFamily(normalizedModelId, OPENAI_REASONING_ONLY_MODEL_FAMILIES)
    ) {
      return {
        supported: true,
        defaultEnabled: true
      }
    }

    if (isKimiK3ModelId(modelId)) {
      return {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'max',
        effortOptions: [...KIMI_K3_REASONING_EFFORT_OPTIONS]
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

  getCapabilityModel(providerId: string, modelId: string): ProviderModel | undefined {
    return this.getProviderMatch(providerId, modelId) ?? this.getModel(providerId, modelId)
  }

  getCapabilityModelMatch(providerId: string, modelId: string): CapabilityModelMatch | undefined {
    return (
      this.getProviderModelMatch(providerId, modelId) ?? this.getModelMatch(providerId, modelId)
    )
  }

  getProviderCapabilityModelMatch(
    providerId: string,
    modelId: string
  ): CapabilityModelMatch | undefined {
    return this.getProviderModelMatch(providerId, modelId)
  }

  findUniqueCapabilityModelMatch(modelId: string): CapabilityModelMatch | undefined {
    for (const lookupKey of getProviderCapabilityModelLookupKeys(modelId)) {
      const entries = this.globalModelLookupIndex.get(lookupKey)
      if (!entries || entries.length === 0) {
        continue
      }

      let match = entries[0]
      for (let index = 1; index < entries.length; index += 1) {
        const candidate = entries[index]
        if (candidate.providerId !== match.providerId || candidate.modelId !== match.modelId) {
          return undefined
        }
        match = candidate
      }

      return {
        providerId: match.providerId,
        modelId: match.modelId,
        model: match.model
      }
    }

    return undefined
  }

  findCapabilityModelMatch(
    modelId: string,
    preferredProviderIds: string[] = []
  ): CapabilityModelMatch | undefined {
    const resolvedPreferredProviderIds = Array.from(
      new Set(
        preferredProviderIds
          .map((providerId) => this.resolveProviderId(providerId)?.toLowerCase())
          .filter((providerId): providerId is string =>
            Boolean(providerId && this.index.has(providerId))
          )
      )
    )

    for (const providerId of resolvedPreferredProviderIds) {
      const match = this.getProviderModelMatch(providerId, modelId)
      if (match) {
        return match
      }
    }

    return this.findModelAcrossProvidersMatch(normalizeModelIdText(modelId))
  }

  getCatalogCapabilitySnapshot(providerId: string, modelId: string): CatalogCapabilitySnapshot {
    const match = this.getProviderModelMatch(providerId, modelId)
    const resolvedProviderId = match?.providerId ?? normalizeCapabilityProviderId(providerId)
    const resolvedModelId = match?.modelId ?? modelId
    const model = match?.model
    const explicitReasoningPortrait = mergeReasoningPortraits(
      portraitFromLegacyReasoning(model?.reasoning),
      portraitFromExtraCapabilities(model?.extra_capabilities?.reasoning)
    )
    const reasoningPortrait =
      mergeReasoningPortraits(
        this.getFallbackReasoningPortrait(resolvedProviderId, resolvedModelId),
        explicitReasoningPortrait
      ) ?? null
    if (reasoningPortrait) {
      removeInheritedIncompatibleModeFields(reasoningPortrait, explicitReasoningPortrait)
    }
    const search = model?.search
    const searchDefaults: SearchDefaults = {}
    if (typeof search?.default === 'boolean') searchDefaults.default = search.default
    if (typeof search?.forced_search === 'boolean') searchDefaults.forced = search.forced_search
    if (search?.search_strategy === 'turbo' || search?.search_strategy === 'max') {
      searchDefaults.strategy = search.search_strategy
    }

    const thinkingBudgetRange: ThinkingBudgetRange = {}
    if (typeof reasoningPortrait?.budget?.default === 'number') {
      thinkingBudgetRange.default = reasoningPortrait.budget.default
    }
    if (typeof reasoningPortrait?.budget?.min === 'number') {
      thinkingBudgetRange.min = reasoningPortrait.budget.min
    }
    if (typeof reasoningPortrait?.budget?.max === 'number') {
      thinkingBudgetRange.max = reasoningPortrait.budget.max
    }
    const defaultToolMode = resolveCatalogDefaultToolMode(
      resolvedProviderId,
      resolvedModelId,
      model
    )

    return {
      modelMatched: Boolean(model),
      ...(defaultToolMode ? { defaultToolMode } : {}),
      reasoningPortrait: reasoningPortrait ? clonePortrait(reasoningPortrait) : null,
      supportsReasoning: reasoningPortrait?.supported === true,
      thinkingBudgetRange,
      supportsSearch: search?.supported === true,
      searchDefaults,
      temperatureCapability:
        typeof model?.temperature === 'boolean' ? model.temperature : undefined,
      supportsAudioInput: model?.modalities?.input?.includes('audio') === true,
      supportsReasoningEffort: supportsEffortControls(reasoningPortrait),
      reasoningEffortDefault: reasoningPortrait?.effort,
      supportsVerbosity: supportsVerbosityControls(reasoningPortrait),
      verbosityDefault: reasoningPortrait?.verbosity
    }
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
    removeInheritedIncompatibleModeFields(resolvedPortrait, explicitPortrait)

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

  getTemperatureCapability(providerId: string, modelId: string): boolean | undefined {
    const model = this.getProviderMatch(providerId, modelId)
    return typeof model?.temperature === 'boolean' ? model.temperature : undefined
  }

  supportsTemperatureControl(providerId: string, modelId: string): boolean {
    const capability = this.getTemperatureCapability(providerId, modelId)
    return typeof capability === 'boolean' ? capability : true
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

  supportsAudioInput(providerId: string, modelId: string): boolean {
    const model = this.getModel(providerId, modelId)
    const inputs = model?.modalities?.input
    if (!Array.isArray(inputs)) return false
    return inputs.includes('audio')
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
