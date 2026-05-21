import type { LLM_PROVIDER, MODEL_META } from './presenter'

export const PROVIDER_IMPORT_SOURCE_IDS = [
  'cc-switch',
  'alma',
  'cherry-studio',
  'hermes',
  'openclaw'
] as const
export const PROVIDER_IMPORT_CUSTOM_API_TYPES = [
  'openai-completions',
  'openai',
  'openai-responses',
  'anthropic',
  'gemini',
  'ollama',
  'mistral'
] as const

export type ProviderImportSourceId = (typeof PROVIDER_IMPORT_SOURCE_IDS)[number]
export type ProviderImportCustomApiType = (typeof PROVIDER_IMPORT_CUSTOM_API_TYPES)[number]

export type ProviderImportSourceStatus = 'found' | 'not_found' | 'error' | 'unsupported_platform'

export type ProviderImportTargetKind = 'builtin' | 'custom' | 'unsupported'

export type ProviderImportProviderWarning =
  | 'already_configured'
  | 'missing_api_key'
  | 'unsupported_provider'
  | 'overwrites_previous_selection'
  | 'credential_only_import'

export type ProviderImportApplyStatus = 'created' | 'updated' | 'skipped' | 'overwritten'
export type ProviderImportApplyMode = 'full' | 'credentials_only'

export interface ProviderImportSourceScan {
  id: ProviderImportSourceId
  name: string
  status: ProviderImportSourceStatus
  configPath: string
  providerCount: number
  selectable: boolean
  defaultSelected: boolean
  message?: string
}

export interface ProviderImportProviderPreview {
  id: string
  sourceId: ProviderImportSourceId
  sourceName: string
  sourceProviderId: string
  name: string
  sourceType: string
  targetKind: ProviderImportTargetKind
  targetProviderId: string
  targetProviderName: string
  targetApiType: string
  apiKeyMasked: string
  baseUrl: string
  modelCount: number
  modelPreview: string[]
  configured: boolean
  selectable: boolean
  defaultSelected: boolean
  warnings: ProviderImportProviderWarning[]
}

export interface ProviderImportScanResult {
  sessionId: string
  sources: ProviderImportSourceScan[]
  providers: ProviderImportProviderPreview[]
  sourceOrder: ProviderImportSourceId[]
}

export interface ProviderImportSelection {
  sourceId: ProviderImportSourceId
  providerIds: string[]
  providerOptions?: Record<
    string,
    {
      targetApiType?: ProviderImportCustomApiType
    }
  >
}

export interface ProviderImportApplyResultItem {
  id: string
  sourceId: ProviderImportSourceId
  sourceName: string
  sourceProviderId: string
  name: string
  targetKind: ProviderImportTargetKind
  targetProviderId: string
  targetProviderName: string
  status: ProviderImportApplyStatus
  modelCount: number
  message?: string
}

export interface ProviderImportApplyResult {
  summary: {
    imported: number
    created: number
    updated: number
    skipped: number
    overwritten: number
    models: number
  }
  results: ProviderImportApplyResultItem[]
}

export interface ProviderImportRawModel {
  id: string
  name?: string
  group?: string
}

export interface ProviderImportRawProvider {
  id: string
  sourceId: ProviderImportSourceId
  sourceName: string
  sourceProviderId: string
  name: string
  type: string
  apiFormat?: string
  apiKey: string
  baseUrl: string
  enabled: boolean
  models: ProviderImportRawModel[]
}

export interface ProviderImportMapping {
  targetKind: ProviderImportTargetKind
  targetProviderId: string
  targetProviderName: string
  targetApiType: string
  importMode: ProviderImportApplyMode
}

export interface ProviderImportPlannedProvider {
  raw: ProviderImportRawProvider
  mapping: ProviderImportMapping
  targetProviderId: string
  provider: LLM_PROVIDER
  models: MODEL_META[]
}
