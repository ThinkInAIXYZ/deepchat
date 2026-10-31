import type { DeepchatBridge } from '@shared/contracts/bridge'
import { providersCatalogChangedEvent } from '@shared/contracts/events'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import {
  providersCatalogEnsureFreshRoute,
  providersCatalogGetRoute,
  providersCatalogListRoute,
  providersCatalogRefreshRoute
} from '@shared/contracts/routes'
import type { ProviderCatalogSnapshot } from '@shared/types/providerCatalog'
import { getDeepchatBridge } from './core'

export function createProviderCatalogClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getCatalog(providerId: string): Promise<ProviderCatalogSnapshot> {
    const result = await bridge.invoke(providersCatalogGetRoute.name, { providerId })
    return result.catalog
  }

  async function listCatalogs(providerIds?: string[]): Promise<ProviderCatalogSnapshot[]> {
    const result = await bridge.invoke(
      providersCatalogListRoute.name,
      providerIds ? { providerIds } : {}
    )
    return result.catalogs
  }

  async function refreshCatalog(providerId: string, reason: 'user' | 'config' = 'user') {
    return await bridge.invoke(providersCatalogRefreshRoute.name, { providerId, reason })
  }

  async function ensureFresh(providerId: string): Promise<boolean> {
    const result = await bridge.invoke(providersCatalogEnsureFreshRoute.name, { providerId })
    return result.scheduled
  }

  function onCatalogChanged(
    listener: (payload: DeepchatEventPayload<'providers.catalog.changed'>) => void
  ) {
    return bridge.on(providersCatalogChangedEvent.name, listener)
  }

  return {
    getCatalog,
    listCatalogs,
    refreshCatalog,
    ensureFresh,
    onCatalogChanged
  }
}

export type ProviderCatalogClient = ReturnType<typeof createProviderCatalogClient>
