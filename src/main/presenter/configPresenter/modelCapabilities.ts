import { eventBus } from '@/eventbus'
import { PROVIDER_DB_EVENTS } from '@/events'
import { providerDbLoader } from './providerDbLoader'
import { ProviderAggregate, ProviderModel } from '@shared/types/model-db'
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

type ReasoningCapability = NonNullable<ProviderModel['reasoning']>

const OPENAI_REASONING_EFFORT_MODEL_FAMILIES = ['o1', 'o3', 'o4-mini', 'gpt-5']
const OPENAI_VERBOSITY_MODEL_FAMILIES = ['gpt-5']
const OPENAI_REASONING_FALLBACK_PROVIDERS = new Set(['openai', 'azure'])
const GROK_REASONING_EFFORT_MODEL_FAMILIES = ['grok-3-mini']

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

export class ModelCapabilities {
  private index: Map<string, Map<string, ProviderModel>> = new Map()

  constructor() {
    this.rebuildIndexFromDb()
    eventBus.on(PROVIDER_DB_EVENTS.LOADED, () => this.rebuildIndexFromDb())
    eventBus.on(PROVIDER_DB_EVENTS.UPDATED, () => this.rebuildIndexFromDb())
  }

  private rebuildIndexFromDb(): void {
    const db = providerDbLoader.getDb()
    this.index.clear()
    if (!db) return
    this.buildIndex(db)
  }

  private buildIndex(db: ProviderAggregate): void {
    const providers = db.providers || {}
    for (const [pid, provider] of Object.entries(providers)) {
      const pkey = pid.toLowerCase()
      const modelMap: Map<string, ProviderModel> = new Map()
      for (const m of provider.models || []) {
        const mid = m.id?.toLowerCase()
        if (!mid) continue
        modelMap.set(mid, m)
      }
      this.index.set(pkey, modelMap)
    }
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

  resolveProviderId(providerId: string | undefined): string | undefined {
    const resolved = resolveProviderIdAlias(providerId)
    return resolved
  }

  private getFallbackReasoning(
    providerId: string,
    modelId: string
  ): ReasoningCapability | undefined {
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
        default: true,
        effort: 'medium',
        ...(matchesModelFamily(normalizedModelId, OPENAI_VERBOSITY_MODEL_FAMILIES)
          ? { verbosity: 'medium' as const }
          : {})
      }
    }

    if (matchesModelFamily(normalizedModelId, GROK_REASONING_EFFORT_MODEL_FAMILIES)) {
      return {
        supported: true,
        default: true,
        effort: 'low'
      }
    }

    return undefined
  }

  private getReasoningCapability(
    providerId: string,
    modelId: string
  ): ReasoningCapability | undefined {
    const dbReasoning = this.getModel(providerId, modelId)?.reasoning
    const fallbackReasoning = this.getFallbackReasoning(providerId, modelId)

    if (!dbReasoning) {
      return fallbackReasoning
    }

    if (!fallbackReasoning) {
      return dbReasoning
    }

    return {
      supported: dbReasoning.supported ?? fallbackReasoning.supported,
      default: dbReasoning.default ?? fallbackReasoning.default,
      budget: dbReasoning.budget ?? fallbackReasoning.budget,
      effort: dbReasoning.effort ?? fallbackReasoning.effort,
      verbosity: dbReasoning.verbosity ?? fallbackReasoning.verbosity
    }
  }

  supportsReasoning(providerId: string, modelId: string): boolean {
    return this.getReasoningCapability(providerId, modelId)?.supported === true
  }

  getThinkingBudgetRange(providerId: string, modelId: string): ThinkingBudgetRange {
    const b = this.getReasoningCapability(providerId, modelId)?.budget
    if (!b) return {}
    const out: ThinkingBudgetRange = {}
    if (typeof b.default === 'number') out.default = b.default
    if (typeof b.min === 'number') out.min = b.min
    if (typeof b.max === 'number') out.max = b.max
    return out
  }

  supportsSearch(providerId: string, modelId: string): boolean {
    const m = this.getModel(providerId, modelId)
    return m?.search?.supported === true
  }

  supportsReasoningEffort(providerId: string, modelId: string): boolean {
    const reasoning = this.getReasoningCapability(providerId, modelId)
    return reasoning?.supported !== false && typeof reasoning?.effort === 'string'
  }

  supportsVerbosity(providerId: string, modelId: string): boolean {
    const reasoning = this.getReasoningCapability(providerId, modelId)
    return reasoning?.supported !== false && typeof reasoning?.verbosity === 'string'
  }

  getReasoningEffortDefault(
    providerId: string,
    modelId: string
  ): 'minimal' | 'low' | 'medium' | 'high' | undefined {
    const v = this.getReasoningCapability(providerId, modelId)?.effort
    return v === 'minimal' || v === 'low' || v === 'medium' || v === 'high' ? v : undefined
  }

  getVerbosityDefault(providerId: string, modelId: string): 'low' | 'medium' | 'high' | undefined {
    const v = this.getReasoningCapability(providerId, modelId)?.verbosity
    return v === 'low' || v === 'medium' || v === 'high' ? v : undefined
  }

  getSearchDefaults(providerId: string, modelId: string): SearchDefaults {
    const m = this.getModel(providerId, modelId)
    const s = m?.search
    if (!s) return {}
    const out: SearchDefaults = {}
    if (typeof s.default === 'boolean') out.default = s.default
    if (typeof s.forced_search === 'boolean') out.forced = s.forced_search
    if (typeof s.search_strategy === 'string') {
      if (s.search_strategy === 'turbo' || s.search_strategy === 'max') {
        out.strategy = s.search_strategy
      }
    }
    return out
  }

  supportsVision(providerId: string, modelId: string): boolean {
    const m = this.getModel(providerId, modelId)
    const inputs = m?.modalities?.input
    if (!Array.isArray(inputs)) return false
    return inputs.includes('image')
  }

  supportsToolCall(providerId: string, modelId: string): boolean {
    const m = this.getModel(providerId, modelId)
    return m?.tool_call === true
  }

  supportsImageOutput(providerId: string, modelId: string): boolean {
    const m = this.getModel(providerId, modelId)
    const outputs = m?.modalities?.output
    if (!Array.isArray(outputs)) return false
    return outputs.includes('image')
  }
}

export const modelCapabilities = new ModelCapabilities()
