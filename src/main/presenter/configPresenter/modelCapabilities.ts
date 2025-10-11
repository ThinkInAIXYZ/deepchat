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
    dashscope: 'alibaba-cn'
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
    const pid = this.resolveProviderId(providerId?.toLowerCase())
    const mid = modelId?.toLowerCase()
    if (!pid || !mid) return undefined
    const p = this.index.get(pid)
    if (!p) return undefined
    return p.get(mid)
  }

  private resolveProviderId(providerId: string | undefined): string | undefined {
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
}

export const modelCapabilities = new ModelCapabilities()
