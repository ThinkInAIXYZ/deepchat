import type { RENDERER_MODEL_META } from './provider'

export type ProviderCatalogStatus = 'unknown' | 'fresh' | 'stale' | 'refreshing' | 'error'

export type ProviderCatalogSource =
  | 'remote'
  | 'provider-db'
  | 'config'
  | 'runtime'
  | 'ollama'
  | 'acp'

export type ProviderCatalogRefreshReason =
  | 'user'
  | 'stale'
  | 'config'
  | 'provider-db'
  | 'sync'
  | 'external-write'
  | 'acp'

export type ProviderCatalogErrorCode =
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid-response'
  | 'unknown'

export type ProviderCatalogState = {
  providerId: string
  revision: number
  fetchedAt: number | null
  source: ProviderCatalogSource | null
  lastRefreshReason: ProviderCatalogRefreshReason | null
  lastErrorCode: ProviderCatalogErrorCode | null
  lastErrorAt: number | null
}

export type ProviderCatalogStatePatch = {
  fetchedAt?: number | null
  source?: ProviderCatalogSource | null
  lastRefreshReason?: ProviderCatalogRefreshReason | null
  lastErrorCode?: ProviderCatalogErrorCode | null
  lastErrorAt?: number | null
}

export type ProviderCatalogSnapshot = {
  providerId: string
  revision: number
  status: ProviderCatalogStatus
  fetchedAt: number | null
  source: ProviderCatalogSource
  lastErrorCode: ProviderCatalogErrorCode | null
  models: RENDERER_MODEL_META[]
}

export type ProviderCatalogRefreshResult = {
  providerId: string
  status: 'ok' | 'not-modified' | 'failed'
  revision: number
  fetchedAt: number | null
  added: string[]
  removed: string[]
  updated: string[]
  errorCode: ProviderCatalogErrorCode | null
}
