import type { DeepchatEventPayload, DeepchatEventPublisher } from '@shared/contracts/events'
import type { ProviderBatchUpdate, ProviderChange } from '@shared/provider-operations'

export function emitProvidersChanged(publishEvent: DeepchatEventPublisher): void {
  publishEvent('providers.changed', {
    reason: 'providers',
    version: Date.now()
  })
}

export function emitProviderAtomicUpdate(
  publishEvent: DeepchatEventPublisher,
  change: ProviderChange
): void {
  publishEvent('providers.changed', {
    reason: 'provider-atomic-update',
    providerIds: change.providerId ? [change.providerId] : undefined,
    version: Date.now()
  })
}

export function emitProviderBatchUpdate(
  publishEvent: DeepchatEventPublisher,
  batchUpdate: ProviderBatchUpdate
): void {
  publishEvent('providers.changed', {
    reason: 'provider-batch-update',
    providerIds: Array.isArray(batchUpdate.providers)
      ? batchUpdate.providers.map((provider) => provider.id)
      : undefined,
    version: Date.now()
  })
}

export function emitModelsChanged(publishEvent: DeepchatEventPublisher, providerId?: string): void {
  publishEvent('models.changed', {
    reason: 'runtime-refresh',
    providerId,
    version: Date.now()
  })
}

export function emitModelStatusChanged(
  payload: {
    providerId: string
    modelId: string
    enabled: boolean
  },
  publishEvent: DeepchatEventPublisher
): void {
  publishEvent('models.status.changed', {
    ...payload,
    version: Date.now()
  })
}

export function emitModelBatchStatusChanged(
  payload: {
    providerId: string
    updates: { modelId: string; enabled: boolean }[]
  },
  publishEvent: DeepchatEventPublisher
): void {
  publishEvent('models.batch.status.changed', {
    ...payload,
    version: Date.now()
  })
}

export function emitModelConfigChanged(
  publishEvent: DeepchatEventPublisher,
  providerId: string,
  modelId: string,
  config: NonNullable<DeepchatEventPayload<'models.config.changed'>['config']>
): void {
  publishEvent('models.config.changed', {
    changeType: 'updated',
    providerId,
    modelId,
    config,
    version: Date.now()
  })
}

export function emitModelConfigReset(
  publishEvent: DeepchatEventPublisher,
  providerId: string,
  modelId: string
): void {
  publishEvent('models.config.changed', {
    changeType: 'reset',
    providerId,
    modelId,
    version: Date.now()
  })
}

export function emitModelConfigsImported(
  publishEvent: DeepchatEventPublisher,
  overwrite: boolean
): void {
  publishEvent('models.config.changed', {
    changeType: 'imported',
    overwrite,
    version: Date.now()
  })
}
