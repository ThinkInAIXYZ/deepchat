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
    if (Array.isArray(providers) && providers.length > 0) {
      return providers
    }

    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, this.defaultProviders)
    return this.defaultProviders
  }

  setProviders(providers: LLM_PROVIDER[]): void {
    this.setSetting<LLM_PROVIDER[]>(PROVIDERS_STORE_KEY, providers)
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
