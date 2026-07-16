import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { readAcpState } from '@/config/configRouteSupport'
import type { ConfigServicePort } from '@shared/presenter'
import type { ProviderBatchUpdate, ProviderChange } from '@shared/provider-operations'

export function emitAgentCatalogChanged(
  configService: ConfigServicePort,
  agentIds?: string[]
): void {
  void readAcpState(configService)
    .then((state) => {
      publishDeepchatEvent('config.agents.changed', {
        ...state,
        agentIds,
        version: Date.now()
      })
    })
    .catch((error) => {
      console.error('Failed to publish typed agents changed event:', error)
    })
}

export function emitAcpAgentModelsChanged(): void {
  publishDeepchatEvent('models.changed', {
    reason: 'agents',
    providerId: 'acp',
    version: Date.now()
  })
}

export function emitProvidersChanged(): void {
  publishDeepchatEvent('providers.changed', {
    reason: 'providers',
    version: Date.now()
  })
}

export function emitProviderAtomicUpdate(change: ProviderChange): void {
  publishDeepchatEvent('providers.changed', {
    reason: 'provider-atomic-update',
    providerIds: change.providerId ? [change.providerId] : undefined,
    version: Date.now()
  })
}

export function emitProviderBatchUpdate(batchUpdate: ProviderBatchUpdate): void {
  publishDeepchatEvent('providers.changed', {
    reason: 'provider-batch-update',
    providerIds: Array.isArray(batchUpdate.providers)
      ? batchUpdate.providers.map((provider) => provider.id)
      : undefined,
    version: Date.now()
  })
}

export function emitModelsChanged(providerId?: string): void {
  publishDeepchatEvent('models.changed', {
    reason: 'runtime-refresh',
    providerId,
    version: Date.now()
  })
}

export function emitModelStatusChanged(payload: {
  providerId: string
  modelId: string
  enabled: boolean
}): void {
  publishDeepchatEvent('models.status.changed', {
    ...payload,
    version: Date.now()
  })
}

export function emitModelBatchStatusChanged(payload: {
  providerId: string
  updates: { modelId: string; enabled: boolean }[]
}): void {
  publishDeepchatEvent('models.batch.status.changed', {
    ...payload,
    version: Date.now()
  })
}

export function emitModelConfigChanged(
  providerId: string,
  modelId: string,
  config: Record<string, unknown>
): void {
  publishDeepchatEvent('models.config.changed', {
    changeType: 'updated',
    providerId,
    modelId,
    config,
    version: Date.now()
  })
}

export function emitModelConfigReset(providerId: string, modelId: string): void {
  publishDeepchatEvent('models.config.changed', {
    changeType: 'reset',
    providerId,
    modelId,
    version: Date.now()
  })
}

export function emitModelConfigsImported(overwrite: boolean): void {
  publishDeepchatEvent('models.config.changed', {
    changeType: 'imported',
    overwrite,
    version: Date.now()
  })
}
