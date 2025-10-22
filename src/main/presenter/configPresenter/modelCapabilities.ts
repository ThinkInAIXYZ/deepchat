import { eventBus } from '@/eventbus'
import { PROVIDER_DB_EVENTS } from '@/events'
import { providerDbLoader } from './providerDbLoader'
import { ProviderAggregate, ProviderModel } from '@shared/types/model-db'

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

export class ModelCapabilities {
  private index: Map<string, Map<string, ProviderModel>> = new Map()
  private static readonly PROVIDER_ID_ALIASES: Record<string, string> = {
    dashscope: 'alibaba-cn',
    gemini: 'google'
  }

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
    if (!providerId) return undefined
    const alias = ModelCapabilities.PROVIDER_ID_ALIASES[providerId]
    return alias || providerId
  }

  supportsReasoning(providerId: string, modelId: string): boolean {
    const m = this.getModel(providerId, modelId)
    return m?.reasoning?.supported === true
  }

  getThinkingBudgetRange(providerId: string, modelId: string): ThinkingBudgetRange {
    const m = this.getModel(providerId, modelId)
    const b = m?.reasoning?.budget
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
    const m = this.getModel(providerId, modelId)
    return typeof m?.reasoning?.effort === 'string'
  }

  supportsVerbosity(providerId: string, modelId: string): boolean {
    const m = this.getModel(providerId, modelId)
    return typeof m?.reasoning?.verbosity === 'string'
  }

  getReasoningEffortDefault(
    providerId: string,
    modelId: string
  ): 'minimal' | 'low' | 'medium' | 'high' | undefined {
    const m = this.getModel(providerId, modelId)
    const v = m?.reasoning?.effort
    return v === 'minimal' || v === 'low' || v === 'medium' || v === 'high' ? v : undefined
  }

  getVerbosityDefault(providerId: string, modelId: string): 'low' | 'medium' | 'high' | undefined {
    const m = this.getModel(providerId, modelId)
    const v = m?.reasoning?.verbosity
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
