import { eventBus, SendTarget } from '@/eventbus'
import { CONFIG_EVENTS } from '@/events'
import {
  checkRequiresRebuild,
  ProviderBatchUpdate,
  ProviderChange
} from '@shared/provider-operations'
import { LLM_PROVIDER } from '@shared/presenter'
import ElectronStore from 'electron-store'

type SetSetting = <T>(key: string, value: T) => void

const PROVIDERS_STORE_KEY = 'providers'

interface ProviderHelperOptions {
  store: ElectronStore<any>
  setSetting: SetSetting
  defaultProviders: LLM_PROVIDER[]
}

export class ProviderHelper {
  private readonly store: ElectronStore<any>
  private readonly setSetting: SetSetting
  private readonly defaultProviders: LLM_PROVIDER[]

  constructor(options: ProviderHelperOptions) {
    this.store = options.store
    this.setSetting = options.setSetting
    this.defaultProviders = options.defaultProviders
  }

  getProviders(): LLM_PROVIDER[] {
    const providers = this.store.get(PROVIDERS_STORE_KEY) as LLM_PROVIDER[] | undefined

    // Guard and self-heal if data is corrupted (e.g. ACP agents/models mistakenly stored here)
    if (Array.isArray(providers) && providers.length > 0) {
      const defaultMap = new Map(this.defaultProviders.map((p) => [p.id, p]))

      const repairedProviders: LLM_PROVIDER[] = []
      let hasValidProvider = false

      for (const item of providers) {
        if (!item || typeof item.id !== 'string') continue

        // Check if this is a valid provider entry (must have apiType)
        if ((item as any).apiType) {
          repairedProviders.push(item as LLM_PROVIDER)
          hasValidProvider = true
          continue
        }

        // Check if this looks like a MODEL_META (has providerId but no apiType) - skip it
        if ((item as any).providerId && !(item as any).apiType) {
          console.warn(
            `[Config] Ignoring MODEL_META entry in providers store (likely ACP model): ${item.id}`
          )
          continue
        }

        // Try to fill missing fields from default provider with the same id
        const template = defaultMap.get(item.id)
        if (template) {
          repairedProviders.push({ ...template, ...item })
          hasValidProvider = true
          continue
        }

        // Unknown item without apiType — likely an ACP agent or corrupted data; skip to avoid polluting provider list
        console.warn(
          `[Config] Ignoring non-provider entry in providers store: ${JSON.stringify(item)}`
        )
      }

      // If no valid providers were found, the store is completely corrupted - restore from defaults
      if (!hasValidProvider) {
        console.error(
          `[Config] Providers store is corrupted (no valid providers found), restoring from defaults`
        )
        this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, this.defaultProviders)
        return this.defaultProviders
      }

      // Add back any defaults that are still missing
      for (const def of this.defaultProviders) {
        if (!repairedProviders.some((p) => p.id === def.id)) {
          repairedProviders.push(def)
        }
      }

      // If repaired list matches original valid shape, return; otherwise persist the healed data
      const listChanged =
        repairedProviders.length !== providers.length ||
        repairedProviders.some((p) => !(p as any).apiType)

      if (listChanged) {
        console.log(
          `[Config] Repaired providers store: ${providers.length} entries -> ${repairedProviders.length} valid providers`
        )
        this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, repairedProviders)
        eventBus.send(CONFIG_EVENTS.PROVIDER_CHANGED, SendTarget.ALL_WINDOWS)
      }
      return repairedProviders
    }

    // If providers is empty or not an array, initialize with defaults
    if (!Array.isArray(providers) || providers.length === 0) {
      this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, this.defaultProviders)
      return this.defaultProviders
    }

    return this.defaultProviders
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    // Validate that all entries are valid providers (have apiType)
    const validProviders = providers.filter((p) => {
      if (!p || typeof p.id !== 'string' || !(p as any).apiType) {
        console.warn(
          `[Config] Skipping invalid provider entry in setProviders: ${JSON.stringify(p)}`
        )
        return false
      }
      return true
    })

    if (validProviders.length !== providers.length) {
      console.error(
        `[Config] setProviders: ${providers.length - validProviders.length} invalid entries filtered out`
      )
    }

    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, validProviders)
    eventBus.send(CONFIG_EVENTS.PROVIDER_CHANGED, SendTarget.ALL_WINDOWS)
  }

  getProviderById(id: string): LLM_PROVIDER | undefined {
    return this.getProviders().find((provider) => provider.id === id)
  }

  setProviderById(id: string, provider: LLM_PROVIDER): void {
    const providers = this.getProviders()
    const index = providers.findIndex((p) => p.id === id)
    if (index !== -1) {
      providers[index] = provider
      this.setProviders(providers)
    } else {
      console.error(`[Config] Provider ${id} not found`)
    }
  }

  updateProviderAtomic(id: string, updates: Partial<LLM_PROVIDER>): boolean {
    const providers = this.getProviders()
    const index = providers.findIndex((p) => p.id === id)

    if (index === -1) {
      console.error(`[Config] Provider ${id} not found`)
      return false
    }

    const requiresRebuild = checkRequiresRebuild(updates)
    providers[index] = { ...providers[index], ...updates }
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)

    const change: ProviderChange = {
      operation: 'update',
      providerId: id,
      requiresRebuild,
      updates
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)

    return requiresRebuild
  }

  updateProvidersBatch(batchUpdate: ProviderBatchUpdate): void {
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, batchUpdate.providers)
    eventBus.send(CONFIG_EVENTS.PROVIDER_BATCH_UPDATE, SendTarget.ALL_WINDOWS, batchUpdate)
  }

  addProviderAtomic(provider: LLM_PROVIDER): void {
    const providers = this.getProviders()
    providers.push(provider)
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)

    const change: ProviderChange = {
      operation: 'add',
      providerId: provider.id,
      requiresRebuild: true,
      provider
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)
  }

  removeProviderAtomic(providerId: string): void {
    const providers = this.getProviders()
    const filteredProviders = providers.filter((p) => p.id !== providerId)
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, filteredProviders)

    const change: ProviderChange = {
      operation: 'remove',
      providerId,
      requiresRebuild: true
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)
  }

  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void {
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)

    const change: ProviderChange = {
      operation: 'reorder',
      providerId: '',
      requiresRebuild: false
    }
    eventBus.send(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE, SendTarget.ALL_WINDOWS, change)
  }

  getDefaultProviders(): LLM_PROVIDER[] {
    return this.defaultProviders
  }

  getEnabledProviders(): LLM_PROVIDER[] {
    return this.getProviders().filter((provider) => provider.enable)
  }
}
